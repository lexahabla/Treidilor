/**
 * Agente 00 · F1.1 · NÚCLEO DEL PROTOCOLO `tai-protocolo/1` (PURO: sin red, sin disco, sin variables de entorno).
 * Implementa lo definido en automation/docs/PROTOCOLO-AGENTES.md: identificadores, estados y transiciones de una tarea,
 * catálogo de errores y validadores del sobre de tarea, de la respuesta y del informe normalizado `informe-agente/1`.
 * El tiempo y el azar se INYECTAN (reloj, aleatorio): el mismo contexto da siempre el mismo resultado.
 */
import { createHash, randomBytes } from 'node:crypto';

export const PROTOCOLO = 'tai-protocolo/1';
export const ESQUEMA_INFORME_AGENTE = 'informe-agente/1';
export const PROFUNDIDAD_MAXIMA = 2;
export const PRIORIDADES = ['P1', 'P2', 'P3', 'P4'];
export const NIVELES = ['L0', 'L1', 'L2', 'L3', 'L4'];
export const MODOS = ['consulta', 'propuesta', 'accion'];

// ── identificadores ordenables (estilo ULID: 10 caracteres de tiempo + 16 de azar, alfabeto de Crockford) ─────────────────────────
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PATRON_ID = (prefijo) => new RegExp(`^${prefijo}_[0-9A-HJKMNP-TV-Z]{26}$`);

function codificar(valor, longitud) {
  let v = BigInt(valor);
  let s = '';
  for (let i = 0; i < longitud; i++) {
    s = ALFABETO[Number(v & 31n)] + s;
    v >>= 5n;
  }
  return s;
}

/**
 * Generador MONÓTONO: dos ids pedidos en el mismo milisegundo siguen ordenados (se incrementa la parte aleatoria).
 * `reloj()` devuelve milisegundos; `aleatorio(n)` devuelve n bytes (inyectables para pruebas deterministas).
 */
export function crearGeneradorIds({ reloj = () => Date.now(), aleatorio = (n) => randomBytes(n) } = {}) {
  let ultimoMs = -1;
  let ultimoAzar = 0n;
  return {
    nuevo(prefijo) {
      if (!/^[a-z]{1,4}$/.test(prefijo)) throw new Error('prefijo_invalido');
      let ms = Math.floor(reloj());
      let azar;
      if (ms <= ultimoMs) {
        ms = ultimoMs;
        azar = ultimoAzar + 1n;
        if (azar >= 1n << 80n) throw new Error('azar_agotado');
      } else {
        azar = BigInt('0x' + Buffer.from(aleatorio(10)).toString('hex'));
      }
      ultimoMs = ms;
      ultimoAzar = azar;
      return `${prefijo}_${codificar(ms, 10)}${codificar(azar, 16)}`;
    },
  };
}

// ── estados de una tarea ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const ESTADOS_TAREA = ['creada', 'esperando_aprobacion', 'aceptada', 'en_curso', 'completada', 'parcial', 'fallida', 'cancelada', 'expirada', 'rechazada'];
export const TERMINALES = new Set(['completada', 'parcial', 'fallida', 'cancelada', 'expirada', 'rechazada']);
const TRANSICIONES = {
  creada: ['esperando_aprobacion', 'aceptada', 'en_curso', 'completada', 'cancelada', 'rechazada', 'fallida'],
  esperando_aprobacion: ['aceptada', 'rechazada', 'cancelada', 'expirada'],
  aceptada: ['en_curso', 'cancelada', 'expirada', 'rechazada'],
  en_curso: ['completada', 'parcial', 'fallida', 'cancelada', 'expirada'],
};
/** Una terminal NO vuelve atrás: un reintento es una tarea nueva. */
export function transicionValida(de, a) {
  if (!ESTADOS_TAREA.includes(de) || !ESTADOS_TAREA.includes(a)) return false;
  return (TRANSICIONES[de] || []).includes(a);
}
export const esTerminal = (estado) => TERMINALES.has(estado);

// ── errores ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Catálogo (PROTOCOLO §7). `reintentable` describe el error, NO autoriza reintentos automáticos de tareas (A-07). */
export const CATALOGO_ERRORES = {
  solicitud_invalida: { reintentable: false },
  capacidad_desconocida: { reintentable: false },
  agente_no_operativo: { reintentable: false },
  permiso_denegado: { reintentable: false },
  aprobacion_requerida: { reintentable: 'tras_nueva_aprobacion' },
  aprobacion_caducada: { reintentable: 'tras_nueva_aprobacion' },
  aprobacion_no_coincide: { reintentable: 'tras_nueva_aprobacion' },
  limite_alcanzado: { reintentable: 'tras_espera' },
  duplicada: { reintentable: false },
  profundidad_excedida: { reintentable: false },
  ciclo_detectado: { reintentable: false },
  origen_no_disponible: { reintentable: 'una_vez_con_pausa' },
  tiempo_agotado: { reintentable: 'nueva_tarea' },
  resultado_no_confirmado: { reintentable: false },
  cancelada_por_usuario: { reintentable: false },
  parada_emergencia: { reintentable: false },
  interno: { reintentable: 'una_vez_con_pausa' },
  // Códigos propios de F1 (aditivos; no cambian los de tai-protocolo/1):
  ledger_no_disponible: { reintentable: 'tras_recuperar_ledger' },
  reautenticacion_requerida: { reintentable: 'tras_reautenticar' },
  canal_no_permitido: { reintentable: false },
};

/** Error con forma `{codigo, mensaje, reintentable, detalle?}`; sin secretos ni trazas internas. */
export function crearError(codigo, mensaje, detalle) {
  const base = CATALOGO_ERRORES[codigo] ? codigo : 'interno';
  const e = { codigo: base, mensaje: String(mensaje), reintentable: CATALOGO_ERRORES[base].reintentable };
  if (detalle !== undefined) e.detalle = detalle;
  return e;
}

/** Excepción con el mismo contenido (para el flujo interno del Director). */
export class ErrorProtocolo extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.name = 'ErrorProtocolo';
    this.error = crearError(codigo, mensaje, detalle);
    this.codigo = this.error.codigo;
  }
}

// ── utilidades de validación ─────────────────────────────────────────────────────────────────────────────────────────────────────
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const esIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) && !Number.isNaN(Date.parse(s));
const esSha = (s) => typeof s === 'string' && /^sha256:[0-9a-f]{64}$/.test(s);
export { esObjeto, esIso, esSha };

/** JSON canónico: claves ordenadas, sin espacios; base de huellas y claves. */
export function canonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor === undefined ? null : valor);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  return `{${Object.keys(valor).filter((k) => valor[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
}
export const sha256 = (texto) => `sha256:${createHash('sha256').update(texto).digest('hex')}`;

/** Huella de lo que se aprueba: capacidad + versión + parámetros + entorno (MATRIZ §1.2). Si algo cambia, la aprobación no vale. */
export function calcularHuella({ capacidad, version = '', parametros = {}, entorno = '' }) {
  return sha256(canonico({ capacidad, version, parametros, entorno }));
}
/** A-02: la clave NO depende del tiempo; una aprobación = una ejecución. */
export function claveIdempotencia(huella, idAprobacion) {
  return sha256(`${huella}|${idAprobacion}`);
}

const err = (codigo, mensaje, campo) => ({ codigo, mensaje, ...(campo ? { campo } : {}) });

/**
 * Valida un sobre de tarea contra el contrato y el registro (PROTOCOLO §3). Devuelve `{ ok, errores:[{codigo,mensaje,campo?}] }`.
 * Opciones: `registro` (objeto con `buscarCapacidad(id)` y `agente(id)`), `ahora` (ms), `exigirAprobacion` (por defecto true).
 */
export function validarSobreTarea(sobre, { registro, ahora = Date.now(), exigirAprobacion = true } = {}) {
  const errores = [];
  if (!esObjeto(sobre)) return { ok: false, errores: [err('solicitud_invalida', 'El sobre no es un objeto.')] };
  if (sobre.protocolo !== PROTOCOLO) errores.push(err('solicitud_invalida', `Protocolo no soportado (${String(sobre.protocolo)}).`, 'protocolo'));
  if (sobre.tipo !== 'solicitud') errores.push(err('solicitud_invalida', 'tipo debe ser «solicitud».', 'tipo'));
  if (typeof sobre.idTarea !== 'string' || !PATRON_ID('t').test(sobre.idTarea)) errores.push(err('solicitud_invalida', 'idTarea inválido.', 'idTarea'));
  if (typeof sobre.idCorrelacion !== 'string' || !PATRON_ID('c').test(sobre.idCorrelacion)) errores.push(err('solicitud_invalida', 'idCorrelacion inválido.', 'idCorrelacion'));
  if (!Number.isInteger(sobre.profundidad) || sobre.profundidad < 0) errores.push(err('solicitud_invalida', 'profundidad inválida.', 'profundidad'));
  else if (sobre.profundidad > PROFUNDIDAD_MAXIMA) errores.push(err('profundidad_excedida', `Profundidad ${sobre.profundidad} > ${PROFUNDIDAD_MAXIMA}.`, 'profundidad'));
  if (!PRIORIDADES.includes(sobre.prioridad)) errores.push(err('solicitud_invalida', 'prioridad debe ser P1-P4.', 'prioridad'));
  if (!Number.isInteger(sobre.plazoMs) || sobre.plazoMs <= 0) errores.push(err('solicitud_invalida', 'plazoMs debe ser un entero positivo.', 'plazoMs'));
  if (!esIso(sobre.creadaEn)) errores.push(err('solicitud_invalida', 'creadaEn inválida.', 'creadaEn'));
  if (!esObjeto(sobre.parametros)) errores.push(err('solicitud_invalida', 'parametros debe ser un objeto.', 'parametros'));
  if (!Array.isArray(sobre.alcancesSolicitados) || sobre.alcancesSolicitados.some((a) => typeof a !== 'string')) errores.push(err('solicitud_invalida', 'alcancesSolicitados debe ser una lista de textos.', 'alcancesSolicitados'));
  if (errores.length) return { ok: false, errores };

  if (!registro) return { ok: false, errores: [err('interno', 'Falta el registro para validar.')] };
  const cap = registro.buscarCapacidad(sobre.capacidad);
  if (!cap) return { ok: false, errores: [err('capacidad_desconocida', `La capacidad «${String(sobre.capacidad)}» no está en el registro.`, 'capacidad')] };
  if (cap.agente !== sobre.agente) errores.push(err('solicitud_invalida', 'El agente no coincide con el de la capacidad.', 'agente'));
  const ag = registro.agente(cap.agente);
  if (!ag || !['operativo', 'construido_local'].includes(ag.estado)) errores.push(err('agente_no_operativo', `El agente ${cap.agente} no está operativo.`, 'agente'));
  if (sobre.modo !== cap.modo) errores.push(err('solicitud_invalida', 'El modo no coincide con el de la capacidad.', 'modo'));
  const ajenos = sobre.alcancesSolicitados.filter((a) => !cap.alcances.includes(a));
  if (ajenos.length) errores.push(err('permiso_denegado', `Alcances fuera de la capacidad: ${ajenos.join(', ')}.`, 'alcancesSolicitados'));
  if (cap.nivelRiesgo === 'L4' && sobre.ejecutor !== 'humano') errores.push(err('permiso_denegado', 'Una acción L4 la ejecuta una persona en el panel; el Director no la envía.', 'ejecutor'));
  if (cap.nivelRiesgo === 'L4' && sobre.ejecutor === 'humano') errores.push(err('permiso_denegado', 'Una tarea L4 (ejecutor humano) no se envía a ningún agente.', 'ejecutor'));

  const necesita = NIVELES.indexOf(cap.nivelRiesgo) >= 2;
  if (necesita && exigirAprobacion) {
    const a = sobre.aprobacion;
    if (!esObjeto(a)) errores.push(err('aprobacion_requerida', `La capacidad ${cap.id} (${cap.nivelRiesgo}) exige aprobación.`, 'aprobacion'));
    else {
      if (a.nivel !== cap.nivelRiesgo) errores.push(err('aprobacion_no_coincide', 'El nivel aprobado no es el de la capacidad.', 'aprobacion.nivel'));
      const huellaEsperada = calcularHuella({ capacidad: cap.id, version: cap.version, parametros: sobre.parametros, entorno: sobre.parametros.entorno ?? '' });
      if (a.huella !== huellaEsperada) errores.push(err('aprobacion_no_coincide', 'La huella aprobada no coincide con lo que se envía.', 'aprobacion.huella'));
      if (!esIso(a.expiraEn)) errores.push(err('aprobacion_requerida', 'La aprobación no tiene caducidad válida.', 'aprobacion.expiraEn'));
      else if (Date.parse(a.expiraEn) < ahora) errores.push(err('aprobacion_caducada', 'La aprobación ha caducado.', 'aprobacion.expiraEn'));
      if (typeof a.ref !== 'string' || !a.ref) errores.push(err('aprobacion_requerida', 'La aprobación no tiene referencia.', 'aprobacion.ref'));
      else if (sobre.claveIdempotencia !== claveIdempotencia(a.huella, a.ref)) errores.push(err('aprobacion_no_coincide', 'La clave de idempotencia no deriva de la huella y la aprobación.', 'claveIdempotencia'));
    }
  }
  return { ok: errores.length === 0, errores };
}

/** Valida una respuesta de agente y aplica la regla de «ejecutada» (PROTOCOLO §5): sin evidencia no hay confirmación. */
export function validarRespuesta(r) {
  const errores = [];
  if (!esObjeto(r)) return { ok: false, errores: [err('solicitud_invalida', 'La respuesta no es un objeto.')], confirmada: false };
  if (r.protocolo !== PROTOCOLO) errores.push(err('solicitud_invalida', 'Protocolo no soportado.', 'protocolo'));
  if (r.tipo !== 'respuesta') errores.push(err('solicitud_invalida', 'tipo debe ser «respuesta».', 'tipo'));
  if (typeof r.idTarea !== 'string' || !PATRON_ID('t').test(r.idTarea)) errores.push(err('solicitud_invalida', 'idTarea inválido.', 'idTarea'));
  if (!ESTADOS_TAREA.includes(r.estado)) errores.push(err('solicitud_invalida', 'estado desconocido.', 'estado'));
  const conEvidencia = esObjeto(r.efectos) && Array.isArray(r.efectos.evidencia) && r.efectos.evidencia.length > 0;
  return { ok: errores.length === 0, errores, confirmada: errores.length === 0 && r.estado === 'completada' && conEvidencia };
}

/** Valida el informe normalizado `informe-agente/1` (PROTOCOLO §6). */
export function validarInformeAgente(i) {
  const errores = [];
  if (!esObjeto(i)) return { ok: false, errores: [err('solicitud_invalida', 'El informe no es un objeto.')] };
  if (i.esquema !== ESQUEMA_INFORME_AGENTE) errores.push(err('solicitud_invalida', 'esquema debe ser informe-agente/1.', 'esquema'));
  for (const c of ['agente', 'capacidad', 'version', 'entorno', 'idEjecucion']) if (typeof i[c] !== 'string' || !i[c]) errores.push(err('solicitud_invalida', `${c} obligatorio.`, c));
  if (!esIso(i.generadoEn)) errores.push(err('solicitud_invalida', 'generadoEn inválida.', 'generadoEn'));
  if (typeof i.completo !== 'boolean') errores.push(err('solicitud_invalida', 'completo debe ser booleano.', 'completo'));
  if (!esObjeto(i.fuente)) errores.push(err('solicitud_invalida', 'fuente obligatoria.', 'fuente'));
  if (!esObjeto(i.resumen)) errores.push(err('solicitud_invalida', 'resumen obligatorio.', 'resumen'));
  if (!Array.isArray(i.hallazgos)) errores.push(err('solicitud_invalida', 'hallazgos debe ser una lista.', 'hallazgos'));
  else for (const [n, h] of i.hallazgos.entries()) if (!esObjeto(h) || typeof h.clave !== 'string' || !h.clave || !esObjeto(h.evidencia)) errores.push(err('solicitud_invalida', `hallazgo ${n} sin clave estable o sin evidencia literal.`, `hallazgos[${n}]`));
  if (!Array.isArray(i.limitaciones)) errores.push(err('solicitud_invalida', 'limitaciones es obligatorio (puede ser vacío).', 'limitaciones'));
  if (!esObjeto(i.honestidad) || i.honestidad.datosAusentesDeclarados !== true) errores.push(err('solicitud_invalida', 'honestidad.datosAusentesDeclarados debe ser true.', 'honestidad'));
  return { ok: errores.length === 0, errores };
}
