// LECTOR COMPARTIDO DE INSTANTÁNEAS (puente Director ↔ n8n) · lógica PURA y de SÓLO LECTURA.
// La misma función valida la solicitud en el nodo Code del workflow (n8n) y en el Director, y valida la respuesta en el Director.
// n8n NO decide nada: sólo devuelve filas de una tabla de instantáneas elegida por una lista cerrada (agente → tabla fija).
import { COLUMNAS_INSTANTANEAS } from './seguimiento.mjs';

export const ESQUEMA_SOLICITUD_LECTOR = 'tai-lector/1';
export const ESQUEMA_RESPUESTA_LECTOR = 'tai-lector-respuesta/1';
export const TABLAS_LECTOR = { '04': 'calidad_catalogo_instantaneas', '12': 'auditor_general_instantaneas' };
export const MAX_FILAS_LECTOR = 60;
export const MAX_PAYLOAD_LECTOR = 200000;

const esObjetoL = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const sinClavesExtra = (obj, permitidas) => Object.keys(obj).filter((k) => !permitidas.includes(k));

/** Valida la solicitud del lector. `opts.agentes`/`opts.entornos` restringen aún más lo que admite este workflow (p. ej. sólo «local»). */
export function validarSolicitudLector(s, opts = {}) {
  const errores = [];
  const agentes = opts.agentes || Object.keys(TABLAS_LECTOR);
  const entornos = opts.entornos || ['local'];
  if (!esObjetoL(s)) return { ok: false, errores: ['la solicitud debe ser un objeto'], solicitud: null };
  for (const k of sinClavesExtra(s, ['esquema', 'idSolicitud', 'agente', 'entorno', 'limite'])) errores.push(`campo no admitido: ${k}`);
  if (s.esquema !== ESQUEMA_SOLICITUD_LECTOR) errores.push('esquema no admitido');
  if (typeof s.idSolicitud !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(s.idSolicitud)) errores.push('idSolicitud inválido');
  if (typeof s.agente !== 'string' || !agentes.includes(s.agente) || !TABLAS_LECTOR[s.agente]) errores.push('agente no admitido');
  if (typeof s.entorno !== 'string' || !entornos.includes(s.entorno)) errores.push('entorno no admitido');
  const limite = s.limite === undefined ? 20 : s.limite;
  if (!Number.isInteger(limite) || limite < 1 || limite > MAX_FILAS_LECTOR) errores.push('limite fuera de rango');
  if (errores.length) return { ok: false, errores, solicitud: null };
  return { ok: true, errores: [], solicitud: { esquema: ESQUEMA_SOLICITUD_LECTOR, idSolicitud: s.idSolicitud, agente: s.agente, entorno: s.entorno, limite } };
}

/** Normaliza una fila de la Data Table: sólo las columnas del historial (nada más sale del workflow). Devuelve null si no es una fila válida. */
export function filaDeTabla(f) {
  if (!esObjetoL(f)) return null;
  const out = {};
  for (const c of COLUMNAS_INSTANTANEAS) {
    if (typeof f[c] !== 'string') return null;
    out[c] = f[c];
  }
  if (f.id !== undefined && f.id !== null) out.id = typeof f.id === 'number' || typeof f.id === 'string' ? f.id : null;
  return out;
}

/** Arma la respuesta del workflow. Las filas incompletas se DESCARTAN y se cuentan (nunca se rellenan). */
export function armarRespuestaLector({ solicitud, filas, ahoraIso, sintetico }) {
  const validas = [];
  let descartadas = 0;
  for (const f of Array.isArray(filas) ? filas : []) {
    const x = filaDeTabla(f);
    if (x && x.payload.length <= MAX_PAYLOAD_LECTOR) validas.push(x); else if (f && Object.keys(f).length) descartadas += 1;
  }
  return {
    esquema: ESQUEMA_RESPUESTA_LECTOR,
    idSolicitud: solicitud.idSolicitud,
    agente: solicitud.agente,
    entorno: solicitud.entorno,
    tabla: TABLAS_LECTOR[solicitud.agente],
    sintetico: sintetico === true,
    exportadoEn: ahoraIso,
    filas: validas.slice(0, solicitud.limite),
    descartadasEnOrigen: descartadas,
  };
}

/**
 * Validación ESTRICTA de la respuesta (lado Director): esquema, eco del idSolicitud, agente, entorno, tabla y filas bien formadas. Cualquier desviación
 * la rechaza entera (no se aprovecha «lo que sirva»). Devuelve { ok, errores, respuesta } con una copia limpia.
 */
export function validarRespuestaLector(r, esperada) {
  const errores = [];
  if (!esObjetoL(r)) return { ok: false, errores: ['la respuesta no es un objeto'], respuesta: null };
  for (const k of sinClavesExtra(r, ['esquema', 'idSolicitud', 'agente', 'entorno', 'tabla', 'sintetico', 'exportadoEn', 'filas', 'descartadasEnOrigen'])) errores.push(`campo no admitido: ${k}`);
  if (r.esquema !== ESQUEMA_RESPUESTA_LECTOR) errores.push('esquema de respuesta no admitido');
  if (r.idSolicitud !== esperada.idSolicitud) errores.push('el idSolicitud de la respuesta no coincide (posible respuesta ajena o repetida)');
  if (r.agente !== esperada.agente) errores.push('agente distinto del pedido');
  if (r.entorno !== esperada.entorno) errores.push('entorno distinto del pedido');
  if (r.tabla !== TABLAS_LECTOR[esperada.agente]) errores.push('tabla distinta de la esperada');
  if (typeof r.sintetico !== 'boolean') errores.push('sintetico debe ser booleano');
  if (typeof r.exportadoEn !== 'string' || Number.isNaN(Date.parse(r.exportadoEn))) errores.push('exportadoEn ilegible');
  if (!Array.isArray(r.filas)) errores.push('filas debe ser una lista');
  else {
    if (r.filas.length > Math.min(esperada.limite, MAX_FILAS_LECTOR)) errores.push('más filas de las pedidas');
    r.filas.forEach((f, i) => {
      if (!esObjetoL(f)) { errores.push(`fila ${i + 1}: no es un objeto`); return; }
      for (const k of sinClavesExtra(f, [...COLUMNAS_INSTANTANEAS, 'id'])) errores.push(`fila ${i + 1}: columna no admitida (${k})`);
      for (const c of COLUMNAS_INSTANTANEAS) if (typeof f[c] !== 'string') errores.push(`fila ${i + 1}: falta la columna ${c}`);
      if (typeof f.payload === 'string' && f.payload.length > MAX_PAYLOAD_LECTOR) errores.push(`fila ${i + 1}: payload demasiado grande`);
      if (f.entorno !== esperada.entorno) errores.push(`fila ${i + 1}: entorno distinto del pedido`);
    });
  }
  if (r.descartadasEnOrigen !== undefined && (!Number.isInteger(r.descartadasEnOrigen) || r.descartadasEnOrigen < 0)) errores.push('descartadasEnOrigen inválido');
  if (errores.length) return { ok: false, errores, respuesta: null };
  return { ok: true, errores: [], respuesta: { ...r, filas: r.filas.map((f) => ({ ...f })) } };
}
