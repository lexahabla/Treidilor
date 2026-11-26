/**
 * TREIDILOR — CLASE BASE DE AGENTES IA (01-13).
 *
 * Cada agente especializado extiende esta clase y:
 *  - Define su misión, system prompt y herramientas disponibles.
 *  - Conecta el LLM real a través de `iaMotor.inferir` (único servicio de inferencia).
 *  - Integra memoria persistente por agente/conversación (iaMotor.recordar/leerMemoria).
 *  - Valida argumentos de entrada antes de ejecutar.
 *  - Aplica permisos mínimos; nunca ejecuta acciones con efectos sin autorización.
 *  - Prepara planes, ejecuta tareas autorizadas y registra evidencias.
 *  - Informa al Director 00 con resultado, estado y limitaciones.
 *  - Gestiona errores y reintentos; recupera trabajos interrumpidos.
 *
 * Nunca genera texto propio: todo pasa por el LLM vía iaMotor. Si no hay proveedor
 * disponible, lanza error (no simula, no inventa).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../paths';
import {
  inferir,
  construirMensajes,
  recordar,
  leerMemoria,
  olvidar,
  type IaMensaje,
  type IaOpcion,
  type IaResultado,
  type IaTool,
} from '../iaMotor';

/** Identificador estable de un agente (00 = Director, 01-13 = especialistas). */
export type AgenteId = string;

/** Resultado estandarizado de una tarea ejecutada por un agente. */
export interface ResultadoAgente {
  /** Identificador del agente que ejecutó la tarea. */
  agente: AgenteId;
  /** Identificador de la tarea/trabajo. */
  trabajoId: string;
  /** Estado final: completada | pendiente | rechazada | error | aclaracion. */
  estado: 'completada' | 'pendiente' | 'rechazada' | 'error' | 'aclaracion';
  /** Respuesta en lenguaje natural del agente (generada por el LLM). */
  respuesta: string;
  /** Evidencias recogidas durante la ejecución (solo lectura, deterministas). */
  evidencias: Array<{ id: string; tipo: string; referencia: string; capturadaEn: string; datos: unknown }>;
  /** Herramientas usadas y sus resultados. */
  herramientasUsadas: Array<{ nombre: string; argumentos: unknown; ok: boolean; datos?: unknown; motivo?: string }>;
  /** Limitaciones detectadas (datos que no constan, acciones no autorizadas, etc.). */
  limitaciones: string[];
  /** Avisos para el propietario (proveedor caído, cuota, etc.). */
  avisos: string[];
  /** Proveedor y modelo reales usados. */
  proveedor: string;
  modelo: string;
  duracionMs: number;
  /** Solicitudes de autorización pendientes (si la tarea requiere aprobación humana). */
  solicitudesAutorizacion: Array<{
    idAprobacion: string;
    que: string;
    efectos: string;
    reversible: boolean;
    caduca: string;
  }>;
}

/** Contexto de ejecución de un agente. */
export interface ContextoAgente {
  /** Identificador de la conversación (memoria compartida). */
  conversacion?: string;
  /** Identificador del trabajo/tarea. */
  trabajoId?: string;
  /** Proveedor forzado (opcional). */
  proveedor?: 'ollama' | 'openai' | 'anthropic' | 'groq' | 'nvidia' | 'openrouter' | 'gemini';
  /** Modelo forzado (opcional). */
  modelo?: string;
  /** Datos de entrada de la tarea. */
  entrada: Record<string, unknown>;
  /** Si la tarea requiere autorización humana antes de ejecutar efectos. */
  requiereAutorizacion?: boolean;
  /** Datos del propietario (preferencias, instrucciones). */
  propietario?: Record<string, unknown>;
}

/** Resultado de ejecutar una herramienta del agente. */
export interface ResultadoHerramienta {
  nombre: string;
  argumentos: Record<string, unknown>;
  ok: boolean;
  datos: unknown;
  motivo?: string;
}

/** Definición de una herramienta disponible para un agente. */
export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
  /** Solo lectura (true) o con efectos (false). Las con efectos requieren autorización. */
  soloLectura: boolean;
  ejecutar: (argumentos: Record<string, unknown>) => Promise<ResultadoHerramienta>;
}

/** Configuración estática de un agente (declarada por cada subclase). */
export interface ConfigAgente {
  id: AgenteId;
  nombre: string;
  mision: string;
  especialidad: string;
  systemPrompt: string;
  herramientas: DefinicionHerramienta[];
  /** Permisos mínimos que el agente debe tener para operar. */
  permisos: string[];
  /** Nivel de riesgo del agente. */
  riesgo: 'bajo' | 'medio' | 'alto';
  /** Si el agente puede ejecutar acciones con efectos (necesita autorización). */
  permiteEfectos: boolean;
}

/**
 * Estado persistente de un agente (memoria de trabajo + disco).
 */
interface EstadoAgente {
  id: AgenteId;
  ultimaActualizacion: string;
  tareasCompletadas: number;
  tareasPendientes: number;
  errores: number;
}

/**
 * Clase base de todos los agentes de Treidilor.
 * Recibe la configuración estática por constructor.
 */
export abstract class AgenteBase {
  /** Configuración del agente. */
  public readonly cfg: ConfigAgente;

  /** Herramientas indexadas por nombre. */
  protected readonly herramientasMap: Map<string, DefinicionHerramienta>;

  /** Estado persistente en memoria. */
  protected estado: EstadoAgente;

  /** Clave de memoria para este agente (agente::conversacion). */
  protected claveMemoria: string;

  constructor(cfg: ConfigAgente, conversacion?: string) {
    this.cfg = cfg;
    this.claveMemoria = `${cfg.id}::${conversacion ?? 'default'}`;
    this.herramientasMap = new Map(cfg.herramientas.map((h) => [h.nombre, h]));
    this.estado = {
      id: cfg.id,
      ultimaActualizacion: new Date().toISOString(),
      tareasCompletadas: 0,
      tareasPendientes: 0,
      errores: 0,
    };
    this.cargarEstado();
  }

  /* ─── Identidad y metadatos ─── */

  /** Identificador del agente. */
  get id(): AgenteId { return this.cfg.id; }
  /** Nombre legible del agente. */
  get nombre(): string { return this.cfg.nombre; }
  /** Misión del agente. */
  get mision(): string { return this.cfg.mision; }
  /** Especialidad del agente. */
  get especialidad(): string { return this.cfg.especialidad; }
  /** Permisos mínimos del agente. */
  get permisos(): string[] { return this.cfg.permisos; }
  /** Nivel de riesgo. */
  get riesgo(): 'bajo' | 'medio' | 'alto' { return this.cfg.riesgo; }
  /** ¿Puede ejecutar acciones con efectos? */
  get permiteEfectos(): boolean { return this.cfg.permiteEfectos; }
  /** Herramientas disponibles (metadatos, sin las funciones ejecutables). */
  get herramientasDisponibles(): Omit<DefinicionHerramienta, 'ejecutar'>[] {
    return this.cfg.herramientas.map(({ ejecutar, ...resto }) => resto);
  }

  /* ─── Memoria persistente ─── */

  private rutaEstado(): string {
    const dataDir = path.join(DATA_DIR, 'agentes');
    return path.join(dataDir, `${this.cfg.id}.json`);
  }

  private cargarEstado(): void {
    try {
      const raw = fs.readFileSync(this.rutaEstado(), 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.estado = {
          id: this.cfg.id,
          ultimaActualizacion: parsed.ultimaActualizacion ?? this.estado.ultimaActualizacion,
          tareasCompletadas: typeof parsed.tareasCompletadas === 'number' ? parsed.tareasCompletadas : 0,
          tareasPendientes: typeof parsed.tareasPendientes === 'number' ? parsed.tareasPendientes : 0,
          errores: typeof parsed.errores === 'number' ? parsed.errores : 0,
        };
      }
    } catch {
      // No hay estado previo: empieza en cero.
    }
  }

  private guardarEstado(): void {
    try {
      const dir = path.dirname(this.rutaEstado());
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.estado.ultimaActualizacion = new Date().toISOString();
      const tmp = this.rutaEstado() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.estado, null, 2), 'utf-8');
      fs.renameSync(tmp, this.rutaEstado());
    } catch {
      /* no bloqueante */
    }
  }

  /** Registra una evidencia en la memoria de trabajo del agente. */
  protected registrarEvidencia(evidencias: ResultadoAgente['evidencias'], id: string, tipo: string, referencia: string, datos: unknown): void {
    evidencias.push({ id, tipo, referencia, capturadaEn: new Date().toISOString(), datos });
  }

  /** Construye los mensajes para iaMotor: system prompt + historial + usuario. */
  protected construirMensajesIA(mensajeUsuario: string, historialPrevio: IaMensaje[]): IaMensaje[] {
    return construirMensajes(this.cfg.systemPrompt, historialPrevio, mensajeUsuario);
  }

  /**
   * Ejecuta una inferencia real con el LLM a través de iaMotor.
   * Incluye el historial de memoria para continuidad de conversación.
   */
  protected async inferirConMemoria(
    mensajeUsuario: string,
    ctx: ContextoAgente,
    opcionExtra: Partial<IaOpcion> = {}
  ): Promise<IaResultado> {
    const historial = leerMemoria(this.cfg.id, ctx.conversacion ?? '');
    const mensajes = this.construirMensajesIA(mensajeUsuario, historial);

    const resultado = await inferir(mensajes, {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId,
      proveedor: ctx.proveedor,
      modelo: ctx.modelo,
      herramientas: opcionExtra.herramientas,
      usarHerramientas: opcionExtra.usarHerramientas,
      temperatura: opcionExtra.temperatura,
      maxTokens: opcionExtra.maxTokens,
      onFragmento: opcionExtra.onFragmento,
    });

    // Recordar el turno en memoria para continuidad.
    recordar(this.cfg.id, { rol: 'user', contenido: mensajeUsuario }, ctx.conversacion);
    recordar(this.cfg.id, { rol: 'assistant', contenido: resultado.texto }, ctx.conversacion);

    return resultado;
  }

  /**
   * Ejecuta las llamadas a herramientas que el modelo solicitó.
   * Valida que la herramienta exista, que sea de solo lectura o que tenga autorización.
   */
  protected async ejecutarHerramientasSolicitadas(
    llamadas: Array<{ nombre: string; argumentos: Record<string, unknown>; id: string }>,
    autorizadas: boolean = false
  ): Promise<ResultadoAgente['herramientasUsadas']> {
    const resultados: ResultadoAgente['herramientasUsadas'] = [];

    for (const llamada of llamadas) {
      const herramienta = this.herramientasMap.get(llamada.nombre);
      if (!herramienta) {
        resultados.push({
          nombre: llamada.nombre,
          argumentos: llamada.argumentos,
          ok: false,
          datos: null,
          motivo: `Herramienta desconocida: ${llamada.nombre}`,
        });
        continue;
      }

      // Las herramientas con efectos requieren autorización explícita.
      if (!herramienta.soloLectura && !autorizadas) {
        resultados.push({
          nombre: llamada.nombre,
          argumentos: llamada.argumentos,
          ok: false,
          datos: null,
          motivo: 'Acceso denegado: la herramienta requiere autorización explícita del propietario.',
        });
        continue;
      }

      try {
        const resultado = await herramienta.ejecutar(llamada.argumentos);
        resultados.push({
          nombre: llamada.nombre,
          argumentos: llamada.argumentos,
          ok: resultado.ok,
          datos: resultado.datos,
          motivo: resultado.motivo,
        });
      } catch (error: any) {
        resultados.push({
          nombre: llamada.nombre,
          argumentos: llamada.argumentos,
          ok: false,
          datos: null,
          motivo: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return resultados;
  }

  /**
   * Valida los argumentos de entrada contra un esquema simple.
   * Devuelve { valido, motivo }.
   */
  protected validarEntrada(entrada: Record<string, unknown>, camposObligatorios: string[]): { valido: boolean; motivo?: string } {
    for (const campo of camposObligatorios) {
      const valor = entrada[campo];
      if (valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')) {
        return { valido: false, motivo: `Campo obligatorio faltante o vacío: ${campo}` };
      }
    }
    return { valido: true };
  }

  /**
   * Método principal que cada agente implementa. Recibe el contexto y debe
   * devolver un ResultadoAgente completo.
   */
  abstract ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente>;

  /**
   * Punto de entrada seguro para ejecutar el agente. Envuelve la ejecución
   * en manejo de errores, actualiza el estado persistente y registra evidencias.
   */
  async run(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const trabajoId = ctx.trabajoId ?? `trabajo-${this.cfg.id}-${Date.now().toString(36).slice(-6)}`;
    const inicio = Date.now();
    const evidencias: ResultadoAgente['evidencias'] = [];

    try {
      this.registrarEvidencia(evidencias, `inicio-${trabajoId}`, 'tarea', `agente:${this.cfg.id}`, {
        trabajoId,
        entrada: ctx.entrada,
        requiereAutorizacion: ctx.requiereAutorizacion ?? false,
      });

      const resultado = await this.ejecutar({ ...ctx, trabajoId });

      // Actualizar estado persistente.
      if (resultado.estado === 'completada') {
        this.estado.tareasCompletadas += 1;
      } else if (resultado.estado === 'error') {
        this.estado.errores += 1;
      } else {
        this.estado.tareasPendientes += 1;
      }
      this.guardarEstado();

      return {
        ...resultado,
        agente: this.cfg.id,
        trabajoId,
        proveedor: resultado.proveedor ?? 'desconocido',
        modelo: resultado.modelo ?? 'desconocido',
        duracionMs: resultado.duracionMs ?? (Date.now() - inicio),
        evidencias,
      };
    } catch (error: any) {
      this.estado.errores += 1;
      this.guardarEstado();

      const mensajeError = error instanceof Error ? error.message : String(error);
      return {
        agente: this.cfg.id,
        trabajoId,
        estado: 'error',
        respuesta: `El agente ${this.cfg.nombre} no pudo completar la tarea: ${mensajeError}. No se inventaron datos; la tarea requiere revisión manual.`,
        evidencias,
        herramientasUsadas: [],
        limitaciones: [`Error durante la ejecución: ${mensajeError}`],
        avisos: [`El agente ${this.cfg.id} encontró un error interno. Consulte los registros para más detalles.`],
        proveedor: 'ninguno',
        modelo: 'ninguno',
        duracionMs: Date.now() - inicio,
        solicitudesAutorizacion: [],
      };
    }
  }

  /** Informa al Director con un resumen estructurado del resultado. */
  informeParaDirector(resultado: ResultadoAgente): string {
    const partes: string[] = [];
    partes.push(`**Agente ${this.cfg.id} — ${this.cfg.nombre}**`);
    partes.push(`Estado: ${resultado.estado}`);
    partes.push(`Respuesta: ${resultado.respuesta}`);
    if (resultado.evidencias.length) {
      partes.push(`Evidencias (${resultado.evidencias.length}): ${resultado.evidencias.map((e) => `${e.tipo}: ${e.referencia}`).join('; ')}`);
    }
    if (resultado.limitaciones.length) {
      partes.push(`Limitaciones: ${resultado.limitaciones.join('; ')}`);
    }
    if (resultado.solicitudesAutorizacion.length) {
      partes.push(`Autorizaciones pendientes: ${resultado.solicitudesAutorizacion.map((s) => s.que).join('; ')}`);
    }
    partes.push(`Proveedor: ${resultado.proveedor} | Modelo: ${resultado.modelo} | ${resultado.duracionMs}ms`);
    return partes.join('\n');
  }
}
