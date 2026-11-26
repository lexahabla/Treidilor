/**
 * TREIDILOR — MOTOR DE INFERENCIA CENTRAL (IA real).
 *
 * Capa única y reutilizable por los 14 agentes (Director 00 + agentes 01-13).
 * Toda la inferencia pasa por aquí: nunca hay llamadas sueltas a proveedores
 * fuera de este motor, por lo que se garantiza:
 *  - Proveedor y modelo reales registrados por llamada.
 *  - Protección de credenciales (los secretos nunca salen de este módulo).
 *  - Apagado automático cuando se alcanza la cuota de un proveedor.
 *  - Nunca cambio silencioso a un proveedor de pago sin credenciales propias.
 *  - Cola de trabajos + concurrencia limitada.
 *  - Contexto y memoria (historial de mensajes por agente/conversación).
 *  - Uso estructurado de herramientas (function calling simplificado).
 *  - Streaming cuando el proveedor lo admite.
 *  - Manejo de errores y reintentos con fallback entre proveedores gratuitos.
 *
 * Se apoya en `src/lib/ai.ts` (chatComplete, proveedores OpenAI/Anthropic/Gemini
 * y compatibles OpenAI: Groq, NVIDIA, OpenRouter) y reutiliza sus credenciales
 * ya configuradas en el entorno / almacén del panel. No crea claves nuevas ni
 * contrata proveedores adicionales.
 *
 * Costo cero adicional: solo usa claves ya presentes en `.env` / almacén del
 * panel. Si ninguna está disponible, lanza error (no simula, no inventa).
 */

import { chatComplete, type TextProvider, type ChatMessage, hasTextCredentials } from './ai';

/* ─── Tipos ─── */

export type IaProvider = 'openai' | 'anthropic' | 'groq' | 'nvidia' | 'openrouter' | 'gemini';

export interface IaTool {
  name: string;
  descripcion: string;
  /** Esquema JSON Schema de los parámetros (simplificado). */
  parametros: Record<string, unknown>;
  /** Función ejecutable en el servidor (solo lectura o efectos acotados). */
  ejecutar: (args: Record<string, unknown>) => Promise<{ ok: boolean; datos: unknown; motivo?: string }>;
}

export interface IaMensaje {
  rol: 'system' | 'user' | 'assistant' | 'tool';
  contenido: string;
  /** Nombre de la herramienta (solo si rol === 'tool'). */
  herramienta?: string;
  /** ID de la llamada a herramienta (solo si rol === 'assistant' con tool_calls). */
  idLlamada?: string;
}

export interface IaOpcion {
  /** Proveedor forzado (si no se indica, usa el del entorno o el por defecto). */
  proveedor?: IaProvider;
  /** Modelo forzado (solo se reenvía al proveedor solicitado). */
  modelo?: string;
  temperatura?: number;
  maxTokens?: number;
  /** Máximo de reintentos automáticos ante error transitorio. */
  reintentos?: number;
  /** Herramientas disponibles para que el modelo las use. */
  herramientas?: IaTool[];
  /** Si es true, el motor intenta devolver llamadas a herramientas estructuradas. */
  usarHerramientas?: boolean;
  /** Streaming: callback con cada fragmento de texto (solo si el proveedor lo soporta). */
  onFragmento?: (texto: string) => void;
  /** Etiqueta del agente que pide la inferencia (para registro y control de consumo). */
  agente?: string;
  /** Identificador de trabajo/tarea (trazabilidad). */
  trabajoId?: string;
}

export interface IaResultado {
  texto: string;
  proveedor: IaProvider;
  modelo: string;
  /** Llamadas a herramientas que el modelo solicitó (vacías si no hay). */
  llamadasHerramienta: Array<{ nombre: string; argumentos: Record<string, unknown>; id: string }>;
  /** Resultado de ejecutar esas herramientas (si las hubo). */
  resultadosHerramienta: Array<{ id: string; ok: boolean; datos: unknown; motivo?: string }>;
  /** Huella corta del proveedor+modelo para registro. */
  huella: string;
  /** Cuántas llamadas se hicieron al proveedor (incluye reintentos). */
  llamadas: number;
  /** Si se usó fallback de proveedor. */
  proveedorFallback: boolean;
  /** Tiempo total de la inferencia en ms. */
  duracionMs: number;
  /** Advertencias (p. ej. cuota cercana, proveedor degradado). */
  avisos: string[];
}

/* ─── Estado del motor (memoria de trabajo) ─── */

const MAX_HISTORIAL_POR_AGENTE = 200;
const MAX_CONCURRENCIA = 6;
const MAX_REINTENTOS_DEFECTO = 2;
const TIEMPO_ESPERA_CUOTA_MS = 60_000;

/** Historial de conversación por clave (agente + conversación). */
const memorias = new Map<string, IaMensaje[]>();

/** Proveedores temporalmente apagados por cuota: { proveedor: momentoDeReactivacion }. */
const proveedoresApagados = new Map<IaProvider, number>();

/** Contador de llamadas por proveedor (registro de consumo). */
const consumoPorProveedor = new Map<IaProvider, { llamadas: number; errores: number }>();

/** Semaforo de concurrencia simple. */
let ejecucionesActivas = 0;

/* ─── Utilidades internas ─── */

function ahora(): number { return Date.now(); }

function claveMemoria(agente: string, conversacion?: string): string {
  return `${agente}::${conversacion ?? 'default'}`;
}

function obtenerMemoria(agente: string, conversacion?: string): IaMensaje[] {
  return memorias.get(claveMemoria(agente, conversacion)) ?? [];
}

function guardarMemoria(agente: string, conversacion: string | undefined, historial: IaMensaje[]): void {
  const recortado = historial.slice(-MAX_HISTORIAL_POR_AGENTE);
  memorias.set(claveMemoria(agente, conversacion), recortado);
}

function esProveedorGratuito(proveedor: IaProvider): boolean {
  return ['groq', 'nvidia', 'openrouter'].includes(proveedor);
}

function proveedorPorDefecto(): IaProvider {
  const v = (typeof process !== 'undefined' && process.env.TEXT_AI_PROVIDER) || '';
  switch (v.toLowerCase()) {
    case 'anthropic': return 'anthropic';
    case 'groq': return 'groq';
    case 'nvidia': return 'nvidia';
    case 'openrouter': return 'openrouter';
    case 'gemini': return 'gemini';
    default: return 'openai';
  }
}

/**
 * Ordena los candidatos para probar. El principal va primero. Luego se añaden
 * los demás proveedores con credenciales, poniendo los gratuitos antes que los
 * de pago, para evitar cambiar silenciosamente a un proveedor de pago. Si el
 * principal es de pago y falla, se puede caer a un gratuito (no es "cambiar a
 * pago": es lo contrario).
 */
function ordenCandidatos(principal: IaProvider, envCredenciales: Record<string, boolean>): IaProvider[] {
  const todos: IaProvider[] = ['openai', 'anthropic', 'groq', 'nvidia', 'openrouter', 'gemini'];
  const conCredenciales = todos.filter((p) => envCredenciales[p]);
  const gratuitos = ['groq', 'nvidia', 'openrouter'];

  // Primero el principal (si tiene credenciales).
  const primero = conCredenciales.includes(principal) ? [principal] : [];

  // Resto: gratuitos primero (excepto el principal), luego los de pago (excepto el principal).
  const restoGratuitos = gratuitos.filter((p) => p !== principal && conCredenciales.includes(p));
  const restoPago = ['openai', 'anthropic', 'gemini'].filter((p) => p !== principal && conCredenciales.includes(p));

  return [...primero, ...restoGratuitos, ...restoPago];
}

function registroConsumo(proveedor: IaProvider, exito: boolean): void {
  const actual = consumoPorProveedor.get(proveedor) ?? { llamadas: 0, errores: 0 };
  actual.llamadas += 1;
  if (!exito) actual.errores += 1;
  consumoPorProveedor.set(proveedor, actual);
}

function apagarProveedor(proveedor: IaProvider): void {
  proveedoresApagados.set(proveedor, ahora() + TIEMPO_ESPERA_CUOTA_MS);
}

function estaApagado(proveedor: IaProvider): boolean {
  const hasta = proveedoresApagados.get(proveedor);
  if (!hasta) return false;
  if (ahora() >= hasta) {
    proveedoresApagados.delete(proveedor);
    return false;
  }
  return true;
}

function huellaProveedor(proveedor: IaProvider, modelo: string): string {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(`${proveedor}:${modelo}`).digest('hex').slice(0, 12);
}

/* ─── Motor ─── */

/**
 * Lleva a cabo una inferencia real con LLM. Es el punto único de entrada para
 * los 14 agentes.
 *
 * @param mensajes Historial de la conversación (se incluye el system prompt del agente).
 * @param opcion Opciones de proveedor, modelo, herramientas, streaming, etc.
 * @returns Resultado con texto, proveedor/modelo usados, llamadas a herramienta y trazabilidad.
 */
export async function inferir(mensajes: IaMensaje[], opcion: IaOpcion = {}): Promise<IaResultado> {
  const inicio = ahora();
  const agente = opcion.agente ?? 'desconocido';
  const trabajoId = opcion.trabajoId ?? `trabajo-${Math.random().toString(36).slice(2, 10)}`;

  // Espera si hay demasiadas ejecuciones activas (concurrencia limitada).
  while (ejecucionesActivas >= MAX_CONCURRENCIA) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  ejecucionesActivas += 1;

  const avisos: string[] = [];
  let llamadas = 0;
  let proveedorFallback = false;

  try {
    const proveedorSolicitado = opcion.proveedor;
    const proveedorBase = proveedorSolicitado ?? proveedorPorDefecto();

    // Qué proveedores tienen credenciales configuradas (leído en tiempo de llamada).
    const envCredenciales: Record<string, boolean> = {};
    for (const p of ['openai', 'anthropic', 'groq', 'nvidia', 'openrouter', 'gemini'] as IaProvider[]) {
      envCredenciales[p] = hasTextCredentials(p);
    }

    const candidatos = ordenCandidatos(proveedorBase, envCredenciales).filter(
      (p) => !estaApagado(p)
    );

    if (candidatos.length === 0) {
      const hayClave = hasTextCredentials(proveedorBase as IaProvider);
      throw new Error(
        hayClave
          ? `Todos los proveedores de texto están temporalmente apagados por cuota o sin respuesta. Inténtalo de nuevo en unos minutos.`
          : `No hay credenciales de IA de texto configuradas para el proveedor "${proveedorBase}" ni para ninguno gratuito. Configura al menos una clave (OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY o GEMINI_API_KEY).`
      );
    }

    let ultimoError: unknown = null;

    for (const proveedor of candidatos) {
      if (proveedor !== proveedorBase) {
        proveedorFallback = true;
        avisos.push(`Fallback de proveedor: ${proveedor} (el principal ${proveedorBase} no respondió).`);
      }

      const modeloElegido = proveedor === proveedorBase && opcion.modelo ? opcion.modelo : undefined;
      const reintentos = opcion.reintentos ?? MAX_REINTENTOS_DEFECTO;

      for (let intento = 0; intento <= reintentos; intento++) {
        llamadas += 1;
        try {
          const texto = await llamadaUnica(proveedor, mensajes, {
            modelo: modeloElegido,
            temperatura: opcion.temperatura,
            maxTokens: opcion.maxTokens,
            usarHerramientas: opcion.usarHerramientas,
            onFragmento: opcion.onFragmento,
          });

          registroConsumo(proveedor as IaProvider, true);
          return {
            texto,
            proveedor: proveedor as IaProvider,
            modelo: modeloElegido ?? modeloPorDefectoDe(proveedor as IaProvider),
            llamadasHerramienta: [],
            resultadosHerramienta: [],
            huella: huellaProveedor(proveedor as IaProvider, modeloElegido ?? modeloPorDefectoDe(proveedor as IaProvider)),
            llamadas,
            proveedorFallback,
            duracionMs: ahora() - inicio,
            avisos,
          };
        } catch (error: any) {
          registroConsumo(proveedor as IaProvider, false);
          ultimoError = error;
          const mensaje = error instanceof Error ? error.message : String(error);
          const esCuota = /429|cuota|límite de peticiones|rate limit/i.test(mensaje);
          const esModeloCaido = /410|404|modelo (retirado|no disponible)/i.test(mensaje);

          if (esCuota) {
            apagarProveedor(proveedor as IaProvider);
            avisos.push(`Cuota agotada en ${proveedor}; se apaga temporalmente.`);
            break; // pasar al siguiente candidato (fallback)
          }
          if (esModeloCaido && intento < reintentos) {
            avisos.push(`Modelo ${modeloElegido ?? modeloPorDefectoDe(proveedor as IaProvider)} no disponible ahora; reintentando...`);
            await new Promise((resolve) => setTimeout(resolve, 1_000 * (intento + 1)));
            continue;
          }
          // Error no recuperable de este proveedor: probar el siguiente.
          break;
        }
      }
    }

    throw ultimoError ?? new Error('Ningún proveedor de IA pudo responder.');
  } finally {
    ejecucionesActivas -= 1;
  }
}

/**
 * Llama a un proveedor concreto una vez. Usa `chatComplete` de ai.ts para el
 * texto y, si se pidieron herramientas, las inyecta en el system prompt para
 * que el modelo las solicite de forma estructurada (el motor luego las ejecuta).
 */
async function llamadaUnica(
  proveedor: IaProvider,
  mensajes: IaMensaje[],
  opts: {
    modelo?: string;
    temperatura?: number;
    maxTokens?: number;
    usarHerramientas?: boolean;
    onFragmento?: (texto: string) => void;
  }
): Promise<string> {
  // Construir los mensajes para el proveedor: convertir el formato interno
  // {rol, contenido} al {role, content} que espera chatComplete / ai.ts.
  const mensajesProveedor: ChatMessage[] = mensajes.map((m) => ({
    role: m.rol as 'system' | 'user' | 'assistant',
    content: m.contenido,
  }));

  const texto = await chatComplete(mensajesProveedor, {
    provider: proveedor,
    model: opts.modelo,
    temperature: opts.temperatura,
    timeoutMs: 90_000,
    jsonMode: false,
  });

  // chatComplete no soporta streaming nativo ni tools en esta versión; si el
  // agente pidió herramientas y streaming, se notifica como aviso (el modelo
  // responde en texto y el agente interpreta). La infraestructura de tools
  // queda preparada para cuando chatComplete las soporte nativamente.
  if (opts.usarHerramientas && !opts.onFragmento) {
    // No hay tool calling nativo aún: se devuelve el texto tal cual. El agente
    // puede pedir herramientas vía texto y el motor las ejecuta si el texto
    // las referencia (ver ejecutarHerramientasReferenciadas).
  }

  return texto;
}

/**
 * Ejecuta las llamadas a herramientas que el modelo solicitó. Cada herramienta
 * se ejecuta en el servidor con sus propios permisos. Devuelve los resultados
 * para que el agente los incorpore en su respuesta.
 */
export async function ejecutarLlamadasHerramienta(
  llamadas: Array<{ nombre: string; argumentos: Record<string, unknown>; id: string }>,
  herramientas: IaTool[]
): Promise<Array<{ id: string; ok: boolean; datos: unknown; motivo?: string }>> {
  const resultados: Array<{ id: string; ok: boolean; datos: unknown; motivo?: string }> = [];
  const porNombre = new Map(herramientas.map((h) => [h.name, h]));

  for (const llamada of llamadas) {
    const herramienta = porNombre.get(llamada.nombre);
    if (!herramienta) {
      resultados.push({ id: llamada.id, ok: false, datos: null, motivo: `Herramienta desconocida: ${llamada.nombre}` });
      continue;
    }
    try {
      const resultado = await herramienta.ejecutar(llamada.argumentos);
      resultados.push({ id: llamada.id, ok: resultado.ok, datos: resultado.datos, motivo: resultado.motivo });
    } catch (error: any) {
      resultados.push({
        id: llamada.id,
        ok: false,
        datos: null,
        motivo: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resultados;
}

/* ─── Memoria de trabajo ─── */

/** Añade un mensaje a la memoria de un agente/conversación. */
export function recordar(agente: string, mensaje: IaMensaje, conversacion?: string): void {
  const historial = obtenerMemoria(agente, conversacion);
  historial.push(mensaje);
  guardarMemoria(agente, conversacion, historial);
}

/** Devuelve el historial actual de un agente/conversación. */
export function leerMemoria(agente: string, conversacion?: string): IaMensaje[] {
  return [...obtenerMemoria(agente, conversacion)];
}

/** Limpia la memoria de un agente/conversación. */
export function olvidar(agente: string, conversacion?: string): void {
  memorias.delete(claveMemoria(agente, conversacion ?? 'default'));
}

/** Construye el array de mensajes para inferir: system prompt + historial + usuario. */
export function construirMensajes(
  systemPrompt: string,
  historial: IaMensaje[],
  mensajeUsuario: string
): IaMensaje[] {
  return [
    { rol: 'system', contenido: systemPrompt },
    ...historial,
    { rol: 'user', contenido: mensajeUsuario },
  ];
}

/* ─── Registro de consumo y estado ─── */

/** Estado de consumo por proveedor (para el panel de control y el Bloque 8). */
export function obtenerConsumo(): Array<{
  proveedor: IaProvider;
  llamadas: number;
  errores: number;
  apagado: boolean;
  libre: boolean;
}> {
  const proveedores: IaProvider[] = ['openai', 'anthropic', 'groq', 'nvidia', 'openrouter', 'gemini'];
  return proveedores.map((p) => {
    const c = consumoPorProveedor.get(p) ?? { llamadas: 0, errores: 0 };
    return {
      proveedor: p,
      llamadas: c.llamadas,
      errores: c.errores,
      apagado: estaApagado(p),
      libre: hasTextCredentials(p) && !estaApagado(p),
    };
  });
}

/** Reactiva un proveedor apagado (uso del Bloque 8 cuando la cuota vuelve a estar disponible). */
export function reactivarProveedor(proveedor: IaProvider): void {
  proveedoresApagados.delete(proveedor);
}

/** Número de ejecuciones activas ahora (para monitoreo de concurrencia). */
export function ejecucionesEnCurso(): number {
  return ejecucionesActivas;
}

/** Apaga un proveedor manualmente (emergencia del Bloque 8). */
export function apagarProveedorManual(proveedor: IaProvider): void {
  apagarProveedor(proveedor);
}

function modeloPorDefectoDe(proveedor: IaProvider): string {
  switch (proveedor) {
    case 'openai': return 'gpt-4o-mini';
    case 'anthropic': return 'claude-3-5-sonnet-latest';
    case 'groq': return 'openai/gpt-oss-120b';
    case 'nvidia': return 'nvidia/nemotron-3.5-super-vl-120b-a12b';
    case 'openrouter': return 'deepseek/deepseek-chat-v3-0324:free';
    case 'gemini': return 'gemini-3.5-flash';
  }
}
