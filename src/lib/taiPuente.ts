/**
 * TREIDILOR — CLIENTE DEL PUENTE DE CHAT DEL DIRECTOR (Agente 00).
 *
 * Comunica el panel de administración con el servicio conversacional PERSISTENTE
 * que ya usa Telegram (Canal 13 + Director 00), a través del contrato
 * `tai-chat/1`:
 *
 *   POST <host>:<puerto>/tai/v1/chat/conversacion  { principal: true }
 *   POST <host>:<puerto>/tai/v1/chat/mensaje       { conversacion, id, texto, origen, idioma, via }
 *   GET  <host>:<puerto>/tai/v1/chat/historial?conversacion=...&ultimos=50
 *   GET  <host>:<puerto>/tai/v1/chat/panel
 *   GET  <host>:<puerto>/tai/v1/salud               (sin autenticación, estado del servicio)
 *
 * El panel NO instancia un Director propio: reenvía al puente existente, que lo
 * entrega al Director compartido (mismo núcleo, estado, ledger y capacidades que
 * el canal de Telegram). La conversación principal del Director es la fuente de
 * verdad del historial; el panel no duplica mensajes ni crea una conversación
 * paralela.
 *
 * Seguridad:
 *   - Sólo llama a direcciones de bucle local (127.0.0.1 / ::1 / localhost) o a
 *     hosts privados incluidos en TAI_PUENTE_HOSTS_PERMITIDOS (red Docker
 *     privada, puerto 4361). Nunca alcanza 4360 por DNS de contenedor: el
 *     Director escucha exclusivamente en loopback.
 *   - Autenticación con Bearer `tai_<id>_<secreto>` de alcance `chat` (sólo
 *     conversar y consultar). Nunca hay alcance `confirmar` en esta fase.
 *   - El token viaja SOLO de servidor a servidor (nunca al navegador).
 *   - Cuerpo ≤ 8 KiB, validación estricta del sobre (`tai-chat/1`).
 *   - Sin ruta de aprobación ni escritura sensible: el puente no aprueba ni
 *     ejecuta nada.
 *
 * Variables de entorno (servidor, nunca en el repositorio):
 *   TAI_PUENTE_HOST        host del puente (default 127.0.0.1)
 *   TAI_PUENTE_PORT        puerto del puente (default 4361)
 *   TAI_PUENTE_TOKEN       token Bearer `tai_<id>_<secreto>` alcance `chat`
 *   TAI_PUENTE_TIMEOUT     ms de timeout de la petición (default 30000)
 *   TAI_PUENTE_HOSTS_PERMITIDOS hosts privados extra (p. ej. puente en red Docker)
 */

import { createHash, randomBytes } from 'node:crypto';

const HOSTS_LOCALES = new Set(['127.0.0.1', '::1', 'localhost']);
const ESQUEMA_CHAT = 'tai-chat/1';
const ESQUEMA_PUENTE = 'tai-chat/1';
const MAX_TEXTO = 2000;
const TIMEOUT_DEFECTO = 30_000;
const PUERTO_DEFECTO = 4361;

function esHostPermitido(host: string, env: Record<string, string | undefined> = process.env): boolean {
  const h = host.toLowerCase();
  if (HOSTS_LOCALES.has(h)) return true;
  const extra = String(env.TAI_PUENTE_HOSTS_PERMITIDOS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return extra.includes(h);
}

function idAleatorio(): string {
  return `${randomBytes(6).toString('hex')}-${randomBytes(4).toString('hex')}`;
}

function idMensaje(): string {
  // id de mensaje de 8-80 chars (requisito del contrato tai-chat/1)
  return `msg-${randomBytes(8).toString('hex')}`;
}

/** Configuración del cliente del puente. Se resuelve del entorno del servidor. */
export interface TaiPuenteConfig {
  host: string;
  puerto: number;
  token: string;
  /** Token de alcance `confirmar` (TAI_PUENTE_TOKEN_CONFIRMAR): SOLO servidor, distinto del de `chat`; vacío = sin confirmaciones desde el panel. */
  tokenConfirmar?: string;
  timeoutMs: number;
}

export function resolverConfigPuente(env: Record<string, string | undefined> = process.env): TaiPuenteConfig {
  const host = String(env.TAI_PUENTE_HOST ?? '127.0.0.1');
  if (!esHostPermitido(host, env)) {
    throw new Error(`TAI_PUENTE_HOST no permitido: «${host}». Sólo se admite bucle local (127.0.0.1, ::1, localhost) o un host privado incluido en TAI_PUENTE_HOSTS_PERMITIDOS.`);
  }
  const puertoRaw = Number(env.TAI_PUENTE_PORT);
  const puerto = Number.isFinite(puertoRaw) && puertoRaw > 0 && puertoRaw < 65536 ? puertoRaw : PUERTO_DEFECTO;
  const token = String(env.TAI_PUENTE_TOKEN ?? '').trim();
  const tokenConfirmar = String(env.TAI_PUENTE_TOKEN_CONFIRMAR ?? '').trim();
  const timeoutMs = Number(env.TAI_PUENTE_TIMEOUT);
  return {
    host,
    puerto,
    token,
    tokenConfirmar,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIMEOUT_DEFECTO,
  };
}

/** Turno del historial conversacional del Director (fuente de verdad). */
export interface TurnoDirector {
  idInstruccion: string;
  en: string;
  origen: 'texto' | 'voz';
  via?: 'telegram' | 'panel';
  texto: string;
  respuesta: {
    tipo: string;
    estado: string;
    mensaje: string;
    textoParaVoz?: string;
    datos?: unknown;
    fuentes?: Array<{ texto: string; procedencia?: string | null }>;
  };
  interrumpido?: boolean;
  repetido?: boolean;
}

/** Panel de estado del Director (sólo lectura): agentes, encargos, confirmaciones, directrices, informes. */

/** Quién decide una confirmación y con qué garantía (lo valida el Director). */
export interface AdministradorDecision {
  id: string;
  usuario: string;
  /** Reautenticación con contraseña (reciente). */
  reautenticadoEn?: string;
  /** 1.3.6: «sesion» = sesión del propietario verificada ahora por la web (solo con huella). */
  metodo?: 'sesion' | 'reautenticacion';
  verificadoEn?: string;
}

/** Confirmación descrita por el Director 1.3.6 (campos opcionales: un Director anterior solo envía id, tipo y caducidad). */
export interface ConfirmacionDescrita {
  idConfirmacion: string;
  tipo: string;
  caduca: string | null;
  titulo?: string;
  estado?: string;
  origen?: string;
  encargo?: { id: string | null; texto: string | null; estado: string; firma: string | null; vence: string | null } | null;
  pasos?: Array<{ agente: string; nombreAgente: string | null; capacidad: string; descripcion: string | null; clase: string; efecto: string; soloLectura: boolean; datosReales: boolean; datos: string; nivel: string | null; cargaSobreProduccion: boolean }>;
  clase?: 'consulta' | 'propuesta' | 'modificacion' | 'sensible';
  efecto?: string;
  soloLectura?: boolean;
  datosReales?: boolean;
  gasto?: boolean;
  afectaProduccion?: boolean;
  consecuencias?: string[];
  riesgo?: 'ordinaria' | 'reforzada';
  confirmacion?: 'sesion' | 'reautenticacion';
  huella?: string;
}

export interface PanelDirector {
  esquema: string;
  en: string;
  agentes: Array<{
    agente: string;
    nombre: string;
    rutinas: Array<{ id: string; capacidad: string; estado: string; proxima: string | null }>;
  }>;
  prioridades: unknown[];
  directrices: unknown[];
  encargos: Array<{ id: string; texto: string; estado: string; progreso: { completados: number; total: number } | null }>;
  /** Desde Director 1.3.6 cada confirmación llega DESCRITA (agente, tarea, efecto, consecuencias, riesgo y huella); antes solo id, tipo y caducidad. */
  confirmacionesPendientes: Array<ConfirmacionDescrita>;
  confirmacionesRecientes?: Array<ConfirmacionDescrita & { resueltaEn?: string | null; por?: string | null; metodo?: string | null }>;
  hoy: unknown;
  investigacionesProgramadas?: unknown;
  informesDeAgentes?: unknown;
}

/** Respuesta normalizada del puente, lista para usar en el panel. */
export interface RespuestaDirector {
  ok: boolean;
  estado: 'respondida' | 'fallida' | 'sin_datos' | 'aclaracion' | 'pendiente' | 'rechazada' | 'sin_entender' | 'linea_base' | 'parcial';
  categoria: string;
  textoClaro: string;
  detalle: string;
  tareas: Array<{ idTarea: string; estado: string; nivel?: string }>;
  solicitudesAutorizacion: Array<{
    idAprobacion: string;
    idTarea: string;
    capacidad: string;
    nivel: string;
    estado: string;
    simulada: boolean;
    que: string;
    efectos: string;
    reversible: boolean | null;
    costeEstimado: any;
    caduca: string;
    minutosRestantes: number | null;
    huellaCorta: string;
    comoConfirmar: string;
    alternativas: Array<{ id: string; texto: string; requiere?: string | null }>;
    consecuencias: string[];
  }>;
  alternativas: Array<{ id: string; texto: string; idAprobacion?: string }>;
  consecuencias: string[];
  limitaciones: string[];
  naturalezaDatos: Array<{ etiqueta: string; detalle: string }>;
  fuentes: Array<{ texto: string; procedencia: string | null }>;
  avisos: string[];
  controles: {
    registrada: boolean;
    paradaActiva: boolean | null;
    secretoDetectado: boolean;
    tipoDeControl: { tipo: string; explicacion: string } | null;
    instruccionesSospechosas: number;
    confirmaPorEsteCanal: boolean;
    canal: string;
  };
  registrada: boolean;
  tipoIntencion: string | null;
  agentes: string[] | null;
  idSolicitud: string;
  claveIdempotencia: string;
  repetida: boolean;
  autorizacion: { apruebaElPuente: boolean; pendientes: string[] };
  trazabilidad: { tareas: Array<{ idTarea: string; capacidad: string | null; estados: string[]; evidencias: Array<{ idEvidencia: string | null; referencia: string; hash: string; capturadaEn: string; origen: string }>; verificaciones: Array<{ idEvidencia: string | null; resultado: string; metodo: string }>; secuencias: number[] }> };
  resumenHablado: string;
  generadoEn: string;
  /** Cuerpo crudo del puente (para depuración del admin, nunca al cliente sin saneado). */
  _raw?: unknown;
  /** Identificador de la conversación del Director (fuente de verdad del historial). */
  conversacion?: string;
}

/** Error tipificado del puente. */
export class TaiPuenteError extends Error {
  constructor(public codigo: string, public status: number, mensaje: string, public detalle?: unknown) {
    super(mensaje);
    this.name = 'TaiPuenteError';
  }
}

/**
 * «Naturaleza» de una respuesta, para el PROPIETARIO: solo lo que le sirve para entenderla (datos reales, sus documentos, chat confidencial, simulación…).
 * Antes se mostraban TODAS las claves técnicas de `datos` (modo, conversacion, esquema, modelo, tokensEntrada, tokensSalida, costeEur, simulado, descartadas,
 * marcadoresInvalidos) mezcladas con la respuesta. Esos datos siguen en los registros técnicos del Director (manifiestos y consumo); aquí no se muestran ni se leen.
 */
export function naturalezaLegible(datos: unknown): Array<{ etiqueta: string; detalle: string }> {
  if (!datos || typeof datos !== 'object') return [];
  const d = datos as Record<string, unknown>; const n: Array<{ etiqueta: string; detalle: string }> = [];
  if (d.modo === 'documentos') n.push({ etiqueta: 'Tus documentos (leídos en local)', detalle: 'documentos' });
  else if (d.datosReales === true) n.push({ etiqueta: 'Datos reales del negocio (no salen del sistema)', detalle: 'datosReales' });
  if (d.confidencial === true) n.push({ etiqueta: 'Chat confidencial', detalle: 'confidencial' });
  if (d.simulado === true) n.push({ etiqueta: 'Respuesta simulada (sin modelo real)', detalle: 'simulado' });
  return n;
}

/** Cliente del puente de chat del Director. Una instancia por configuración. */

/**
 * Estado de la SALIDA de voz del panel (Director 1.3.7): solo claves y valores de una lista cerrada, nunca texto libre.
 * altavoz: respuestas habladas activadas o no · motor: voz del Director o del navegador · ultimaReproduccion: lo que informó el navegador.
 */
const SALIDA_VOZ: Record<string, readonly string[]> = { altavoz: ['activado', 'desactivado'], motor: ['director', 'rapida'], ultimaReproduccion: ['completada', 'fallida', 'cortada', 'ninguna'] };
export function limpiarSalidaVoz(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o: Record<string, string> = {}; for (const [k, permitidos] of Object.entries(SALIDA_VOZ)) { const x = (v as Record<string, unknown>)[k]; if (typeof x === 'string' && permitidos.includes(x)) o[k] = x; }
  return Object.keys(o).length ? o : null;
}

export class TaiPuenteClient {
  private readonly config: TaiPuenteConfig;
  /** Conversación principal creada en esta instancia del cliente (idempotencia). */
  private _conversacionPrincipal: string | null = null;

  constructor(config: TaiPuenteConfig) {
    this.config = config;
  }

  private baseUrl(): string {
    return `http://${this.config.host}:${this.config.puerto}`;
  }

  private authHeaders(idSolicitud?: string): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${this.config.token}`,
      'x-tai-cliente': 'panel-admin',
    };
    if (idSolicitud) h['x-tai-id-solicitud'] = idSolicitud;
    return h;
  }

  async peticion<T>(ruta: string, init: RequestInit, timeoutMs: number = this.config.timeoutMs): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${ruta}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'Error de red';
      if (mensaje.includes('aborted') || mensaje.includes('timeout')) {
        throw new TaiPuenteError('tiempo_espera_agotado', 504, 'El servicio conversacional no respondió a tiempo. Inténtalo de nuevo.');
      }
      throw new TaiPuenteError('servicio_no_disponible', 502, 'No se pudo contactar con el servicio conversacional del Director.', { causa: mensaje });
    }
    const textoRespuesta = await res.text().catch(() => '');
    let cuerpo: unknown;
    try { cuerpo = textoRespuesta ? JSON.parse(textoRespuesta) : null; } catch { cuerpo = null; }
    if (!res.ok) {
      const codigo = (cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo && typeof (cuerpo as any).error === 'object')
        ? String((cuerpo as any).error.codigo ?? 'error_desconocido')
        : 'error_desconocido';
      const mensaje = (cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo && typeof (cuerpo as any).error === 'object')
        ? String((cuerpo as any).error.mensaje ?? 'Error del servicio conversacional.')
        : `El servicio respondió ${res.status}.`;
      // 401/403 del puente significan que el TOKEN del servidor no vale, no que la sesión del
      // propietario haya caducado: se devuelven como 502 para que el panel no cierre la sesión.
      let status = res.status;
      if (status === 401 || status === 403 || status >= 500) status = 502;
      throw new TaiPuenteError(codigo, status, mensaje, { detalle: cuerpo, http: res.status });
    }
    return cuerpo as T;
  }

  /** Estado del servicio (sin datos de negocio, sin autenticación). */
  async salud(): Promise<{ ok: boolean; estado: string; version: string; lector: Array<{ agente: string; ok: boolean; en: string }> } | null> {
    try {
      return await this.peticion<{ ok: boolean; estado: string; version: string; lector: Array<{ agente: string; ok: boolean; en: string }> }>('/tai/v1/salud', {
        method: 'GET',
        headers: { 'cache-control': 'no-store' },
      });
    } catch {
      return null;
    }
  }

  /**
   * Conversación principal del propietario, COMPARTIDA por todos los canales (Telegram + panel).
   * Es la fuente de verdad del historial.
   *
   *  · Con `conversacionId` se reutiliza esa conversación (p. ej. la de Telegram); no se crea ninguna.
   *  · Sin él, se pide al Director su conversación PRINCIPAL (`{ principal: true }`, Director >= 1.3.1).
   *    Un Director 1.3.0 rechaza ese campo (`solicitud_invalida`): entonces se abre una conversación
   *    con el cuerpo vacío, que es el único contrato que admite esa versión.
   *  · El resultado se recuerda en el cliente para no crear dos conversaciones en la misma sesión.
   */
  async abrirConversacionPrincipal(conversacionId?: string): Promise<{ conversacion: string; principal: boolean }> {
    if (conversacionId && typeof conversacionId === 'string' && conversacionId.trim()) {
      const id = conversacionId.trim();
      this._conversacionPrincipal = id;
      return { conversacion: id, principal: true };
    }
    if (this._conversacionPrincipal) {
      return { conversacion: this._conversacionPrincipal, principal: true };
    }
    const pedir = (cuerpo: Record<string, unknown>) => this.peticion<{ esquema: string; conversacion: string; principal?: boolean }>('/tai/v1/chat/conversacion', {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(cuerpo),
    });
    let r: { esquema: string; conversacion: string; principal?: boolean };
    try {
      r = await pedir({ principal: true });
    } catch (e) {
      if (!(e instanceof TaiPuenteError && e.status === 400 && e.codigo === 'solicitud_invalida')) throw e;
      r = await pedir({});
    }
    if (!r || !r.conversacion) throw new TaiPuenteError('respuesta_invalida', 502, 'El servicio no devolvió una conversación principal.');
    this._conversacionPrincipal = String(r.conversacion);
    return { conversacion: this._conversacionPrincipal, principal: Boolean(r.principal) };
  }

  /**
   * CONFIRMAR o RECHAZAR una confirmación pendiente del Director en nombre del propietario, ya REAUTENTICADO por el servidor del panel.
   * Usa SOLO el token de alcance `confirmar` (nunca el de `chat`, nunca en el navegador). El Director comprueba caducidad, un solo uso y
   * reautenticación reciente, aplica el cambio con su política y registra en el ledger QUIÉN confirmó.
   */
  async decidirConfirmacion(idConfirmacion: string, decision: 'confirmar' | 'rechazar', administrador: AdministradorDecision, huella?: string): Promise<unknown> {
    if (huella !== undefined && !/^sha256:[0-9a-f]{64}$/.test(huella)) throw new TaiPuenteError('solicitud_invalida', 400, 'Huella de la operación no válida.');
    if (!/^cf_[0-9A-HJKMNP-TV-Z]{26}$/i.test(String(idConfirmacion))) throw new TaiPuenteError('confirmacion_invalida', 400, 'Identificador de confirmación no válido.');
    if (decision !== 'confirmar' && decision !== 'rechazar') throw new TaiPuenteError('decision_invalida', 400, 'La decisión debe ser confirmar o rechazar.');
    if (!this.config.tokenConfirmar) throw new TaiPuenteError('confirmacion_no_configurada', 503, 'Las confirmaciones desde el panel no están configuradas en el servidor.');
    const r = await this.peticion<{ resultado?: unknown }>('/tai/v1/chat/confirmar', {
      method: 'POST',
      headers: { ...this.authHeaders(), authorization: `Bearer ${this.config.tokenConfirmar}` },
      body: JSON.stringify({ idConfirmacion, decision, administrador, ...(huella !== undefined ? { huella } : {}) }),
    });
    return r?.resultado ?? null;
  }

  /** Conversación PRINCIPAL real del Director (la de Telegram), sin usar la que recuerda el cliente. */
  async conversacionPrincipalDelDirector(): Promise<string> {
    const r = await this.peticion<{ conversacion?: string }>('/tai/v1/chat/conversacion', { method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ principal: true }) });
    if (!r || !r.conversacion) throw new TaiPuenteError('respuesta_invalida', 502, 'El servicio no devolvió la conversación principal.');
    return String(r.conversacion);
  }

  /** Crea una conversación NUEVA e independiente en el Director (otro chat: su propio historial y contexto). */
  async crearConversacionNueva(): Promise<string> {
    const r = await this.peticion<{ conversacion?: string }>('/tai/v1/chat/conversacion', { method: 'POST', headers: this.authHeaders(), body: '{}' });
    if (!r || !r.conversacion) throw new TaiPuenteError('respuesta_invalida', 502, 'El servicio no creó la conversación.');
    return String(r.conversacion);
  }

  /** Olvida la conversación recordada (p. ej. si el Director ya no la conoce). */
  olvidarConversacionPrincipal(): void {
    this._conversacionPrincipal = null;
  }

  /**
   * Envía un mensaje de texto al Director identificando el canal como `panel`.
   * `conversacion` es el id de la conversación principal (fuente de verdad).
   * `origen` solo admite 'texto' o 'voz'; confirmar es un control aparte (no en esta fase).
   */
  async enviarMensaje(texto: string, { conversacion, id = idMensaje(), via = 'panel', origen = 'texto', confianza = 0, idioma = 'es', adjuntos, proyecto, privado = false, salidaVoz }: { salidaVoz?: unknown; conversacion: string; id?: string; via?: 'telegram' | 'panel'; origen?: 'texto' | 'voz'; confianza?: number; idioma?: string; adjuntos?: unknown[]; proyecto?: { nombre: string; instrucciones: string } | null; privado?: boolean }): Promise<RespuestaDirector> {
    if (!conversacion || typeof conversacion !== 'string') {
      throw new TaiPuenteError('conversacion_invalida', 400, 'Se requiere el identificador de la conversación del Director.');
    }
    if (typeof texto !== 'string' || !texto.trim()) {
      throw new TaiPuenteError('texto_vacio', 400, 'El mensaje no puede ir vacío.');
    }
    const limpio = texto.trim();
    if (limpio.length > MAX_TEXTO) {
      throw new TaiPuenteError('texto_demasiado_largo', 400, `El mensaje supera los ${MAX_TEXTO} caracteres.`);
    }
    if (!this.config.token) {
      throw new TaiPuenteError('token_no_configurado', 500, 'No se ha configurado el token de acceso al puente del Director.');
    }

    const idSolicitud = idAleatorio();
    const r = await this.peticion<{ esquema: string; conversacion: string; idInstruccion: string; en: string; origen: string; via?: string; textoOriginal: string; respuesta: any; controles?: any[]; interrumpido?: boolean; repetido?: boolean }>('/tai/v1/chat/mensaje', {
      method: 'POST',
      headers: this.authHeaders(idSolicitud),
      body: JSON.stringify({
        conversacion,
        id,
        texto: limpio,
        origen,
        confianza: typeof confianza === 'number' ? Math.max(0, Math.min(1, confianza)) : 0,
        idioma,
        ...(adjuntos && adjuntos.length ? { adjuntos } : {}),
        ...(proyecto ? { proyecto } : {}),
        ...(privado ? { privado: true } : {}),
        ...(origen === 'voz' && limpiarSalidaVoz(salidaVoz) ? { salidaVoz: limpiarSalidaVoz(salidaVoz) } : {}),
      }),
    }).catch((e) => {
      // Director anterior a 1.3.7: no admite `salidaVoz` → se repite sin ese campo (el mensaje no se pierde).
      if (e instanceof TaiPuenteError && e.status === 400 && /salidaVoz/.test(e.message)) return this.enviarMensaje(texto, { conversacion, id, via, origen, confianza, idioma, adjuntos, proyecto, privado }).then((x) => ({ __mapeado: x }) as any);
      throw e;
    });
    if ((r as any)?.__mapeado) return (r as any).__mapeado;

    const turno = r;
    const resp = turno.respuesta || {};
    return this.mapearRespuesta(turno, resp, idSolicitud);
  }

  /**
   * Turno HABLADO del panel: el audio del propietario va al Director (`/tai/v1/chat/voz`), que lo transcribe, responde con su núcleo
   * (memoria, permisos y ledger únicos) y devuelve el audio con la MISMA voz que en Telegram. Si la respuesta lleva datos reales del
   * negocio, el Director no la sintetiza fuera y devuelve `vozLocal` (texto breve) para que la lea el navegador. Alcance chat: no confirma nada.
   */
  async hablar(audioBase64: string, { conversacion, mime, segundos, id = idMensaje(), privado = false, salidaVoz }: { conversacion: string; mime: string; segundos: number; id?: string; privado?: boolean; salidaVoz?: unknown }): Promise<{ estado: string; mensaje: string | null; transcripcion: string; respuesta: RespuestaDirector | null; audio: { base64: string; mime: string } | null; vozLocal: string | null; requiereRepeticion: boolean }> {
    if (!conversacion) throw new TaiPuenteError('conversacion_invalida', 400, 'Se requiere el identificador de la conversación del Director.');
    if (!this.config.token) throw new TaiPuenteError('token_no_configurado', 500, 'No se ha configurado el token de acceso al puente del Director.');
    const idSolicitud = idAleatorio();
    let r: any;
    try {
      r = await this.peticion<any>('/tai/v1/chat/voz', {
        method: 'POST',
        headers: this.authHeaders(idSolicitud),
        body: JSON.stringify({ conversacion, id, audio: audioBase64, mime, segundos, ...(privado ? { privado: true } : {}), ...(limpiarSalidaVoz(salidaVoz) ? { salidaVoz: limpiarSalidaVoz(salidaVoz) } : {}) }),
      }, Math.max(this.config.timeoutMs, 90_000));
    } catch (e) {
      // Director anterior a 1.3.7: no admite `salidaVoz` → mismo turno sin ese campo.
      if (e instanceof TaiPuenteError && e.status === 400 && /salidaVoz/.test(e.message)) return this.hablar(audioBase64, { conversacion, mime, segundos, id, privado });
      // Un Director anterior a 1.3.3 no tiene la ruta de voz: el panel debe usar la voz del navegador, no mostrar un error.
      if (e instanceof TaiPuenteError && e.codigo === 'no_encontrado') throw new TaiPuenteError('voz_no_disponible', 503, 'La voz del Director no está disponible en esta versión del servicio.');
      throw e;
    }
    const turno = r?.turno ?? null;
    const audio = r?.audio && typeof r.audio.base64 === 'string' && typeof r.audio.mime === 'string' ? { base64: r.audio.base64, mime: r.audio.mime } : null;
    return {
      estado: String(r?.estado ?? 'error'),
      mensaje: typeof r?.mensaje === 'string' ? r.mensaje : null,
      transcripcion: turno ? String(turno.textoOriginal ?? turno.texto ?? '') : '',
      respuesta: turno ? this.mapearRespuesta(turno, turno.respuesta || {}, idSolicitud) : null,
      audio,
      vozLocal: typeof r?.vozLocal === 'string' && r.vozLocal ? r.vozLocal : null,
      requiereRepeticion: Boolean(r?.requiereRepeticion),
      motivoSinVoz: ['cuota_agotada', 'fallo_sintesis', 'limite_diario', 'datos_del_negocio'].includes(r?.motivoSinVoz) ? r.motivoSinVoz : null,
      vozDirector: ['disponible', 'sin_cupo', 'no_disponible'].includes(r?.vozDirector) ? r.vozDirector : null,
    };
  }

  /** Historial conversacional real de una conversación (fuente de verdad del Director). */
  async obtenerHistorial(conversacion: string, { ultimos = 50 }: { ultimos?: number } = {}): Promise<{ conversacion: string; turnos: TurnoDirector[] }> {
    if (!conversacion) throw new TaiPuenteError('conversacion_invalida', 400, 'Se requiere el identificador de la conversación.');
    const url = `/tai/v1/chat/historial?conversacion=${encodeURIComponent(conversacion)}&ultimos=${Math.max(1, Math.min(Math.floor(Number(ultimos) || 50), 200))}`;
    const r = await this.peticion<{ esquema: string; conversacion: string; turnos: TurnoDirector[] }>(url, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!r) throw new TaiPuenteError('respuesta_invalida', 502, 'El servicio no devolvió el historial.', { detalle: r });
    return { conversacion: r.conversacion, turnos: Array.isArray(r.turnos) ? r.turnos : [] };
  }

  /** Panel de estado del Director: agentes, encargos, confirmaciones pendientes, directrices, informes (sólo lectura). */
  async obtenerPanel(): Promise<PanelDirector> {
    const r = await this.peticion<PanelDirector>('/tai/v1/chat/panel', {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!r) throw new TaiPuenteError('respuesta_invalida', 502, 'El servicio no devolvió el panel del Director.', { detalle: r });
    return r;
  }

  /** Mapea un turno del contrato tai-chat/1 a la interfaz RespuestaDirector del panel. */
  private mapearRespuesta(turno: any, resp: any, idSolicitud: string): RespuestaDirector {
    const estado = this.normalizarEstado(resp?.estado);
    const confirmaciones = Array.isArray(turno.controles) ? turno.controles.filter((c: any) => c?.tipo === 'confirmacion') : [];
    const encargos = Array.isArray(turno.controles) ? turno.controles.filter((c: any) => c?.tipo === 'encargo') : [];
    const fuentes = Array.isArray(resp?.fuentes) ? resp.fuentes : [];
    const datos = resp?.datos;
    const naturalezaDatos = naturalezaLegible(datos);

    return {
      ok: true,
      estado,
      categoria: String(resp?.tipo ?? 'consulta'),
      textoClaro: String(resp?.mensaje ?? ''),
      detalle: String(resp?.textoParaVoz ?? ''),
      tareas: encargos.map((e: any) => ({ idTarea: String(e.idEncargo ?? ''), estado: 'ejecutada', nivel: undefined })),
      solicitudesAutorizacion: confirmaciones.map((c: any) => ({
        idAprobacion: String(c.idConfirmacion ?? ''),
        idTarea: '',
        capacidad: '',
        nivel: '',
        estado: 'pendiente',
        simulada: false,
        que: String(c.nota ?? ''),
        efectos: '',
        reversible: null,
        costeEstimado: null,
        caduca: String(c.caduca ?? ''),
        minutosRestantes: null,
        huellaCorta: '',
        comoConfirmar: '',
        alternativas: [],
        consecuencias: [],
      })),
      alternativas: [],
      consecuencias: [],
      limitaciones: [],
      naturalezaDatos,
      fuentes: fuentes.map((f: any) => ({ texto: String(f.texto ?? ''), procedencia: f.procedencia ?? null })),
      avisos: [],
      controles: {
        registrada: true,
        paradaActiva: null,
        secretoDetectado: false,
        tipoDeControl: null,
        instruccionesSospechosas: 0,
        confirmaPorEsteCanal: false,
        canal: turno.via ?? 'panel',
      },
      registrada: true,
      tipoIntencion: resp?.tipo ?? null,
      agentes: null,
      idSolicitud: String(turno.idInstruccion ?? idSolicitud),
      claveIdempotencia: String(turno.idInstruccion ?? idSolicitud),
      repetida: Boolean(turno.repetido),
      autorizacion: {
        apruebaElPuente: false,
        pendientes: confirmaciones.map((c: any) => String(c.idConfirmacion ?? '')),
      },
      trazabilidad: { tareas: [] },
      resumenHablado: String(resp?.textoParaVoz ?? ''),
      generadoEn: turno.en ?? new Date().toISOString(),
      conversacion: turno.conversacion ?? undefined,
      _raw: resp,
    };
  }

  private normalizarEstado(estado: any): RespuestaDirector['estado'] {
    const e = String(estado ?? '').toLowerCase();
    if (e === 'respondida' || e === 'ejecutada') return 'respondida';
    if (e === 'requiere_confirmacion') return 'pendiente';
    if (e === 'rechazada') return 'rechazada';
    if (e === 'aclaracion') return 'aclaracion';
    if (e === 'no_entendida') return 'sin_entender';
    if (e === 'idempotencia') return 'linea_base';
    if (e === 'investigacion' || e === 'investigacion_comercial') return 'respondida';
    if (e === 'investigacion_aclaracion') return 'aclaracion';
    return 'sin_datos';
  }

  /** Huella corta (sin secreto) para registrar en logs del panel: identificador del cliente a partir del token. */
  clienteId(): string {
    if (!this.config.token) return 'sin_configurar';
    const m = /^tai_([a-z0-9-]{3,24})_/.exec(this.config.token);
    return m ? `panel:${m[1]}` : 'panel:token_invalido';
  }

  /** Datos de configuración expuestos (sin el token). */
  obtenerInfoConfig(): { host: string; puerto: number; cliente: string } {
    return { host: this.config.host, puerto: this.config.puerto, cliente: this.clienteId() };
  }
}

/** Huella de un texto para depuración (no es el secreto ni el mensaje completo). */
export function huellaTexto(texto: string): string {
  return createHash('sha256').update(texto.trim()).digest('hex').slice(0, 12);
}

/**
 * Escapa HTML para prevenir XSS. Convierte los caracteres que pueden abrir
 * etiquetas o atributos en entidades. Se aplica a todo texto de usuario,
 * Director, fuentes, avisos, limitaciones y metadatos antes de insertarlo en
 * el DOM. Los saltos de línea se conservan: el llamante los convierte a <br>
 * después del escape, o confía en CSS `white-space: pre-wrap`.
 */
export function escapeHtml(texto: unknown): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
