// LECTOR DE PRODUCCIÓN (puente Director ↔ n8n de producción) · lógica PURA y de SÓLO LECTURA. Se apoya en el lector compartido (`lectorPuente.mjs`) y sólo añade lo propio de producción:
// un único entorno («produccion»), ventana de validez de la solicitud (protección contra repetición), selección de la instantánea MÁS RECIENTE por `generadoEn` validado
// (sin depender del orden de las filas) y negativa a responder si la lectura pudiera estar truncada. Se incrusta en los nodos Code del workflow y la usa el Director.
import { armarRespuestaLector, filaDeTabla, MAX_PAYLOAD_LECTOR, validarSolicitudLector } from './lectorPuente.mjs';

export const ENTORNO_PRODUCCION = 'produccion';
export const PREFIJO_RUTA_PRODUCCION = 'tai-lector-prod-';
export const CREDENCIAL_LECTOR_PRODUCCION = 'Treidilor — Lector puente PRODUCCIÓN (solo lectura)';
export const CABECERA_LECTOR_PRODUCCION = 'x-treidilor-lector-prod';
export const VENTANA_SOLICITUD_MS = 120000;
export const MAX_LECTURA_TABLA = 200;
export const TOLERANCIA_FUTURO_MS = 5 * 60000;

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const fechaIsoValida = (t) => typeof t === 'string' && FECHA_ISO.test(t) && Number.isFinite(Date.parse(t));

/** Solicitud de producción: la del lector compartido (sólo entorno «produccion») + `emitidoEn` dentro de la ventana de validez (una solicitud capturada deja de servir pasados 2 min). */
export function validarSolicitudProduccion(s, { agentes, ahoraMs = Date.now() } = {}) {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return { ok: false, errores: ['la solicitud debe ser un objeto'], solicitud: null };
  const { emitidoEn, ...resto } = s;
  const r = validarSolicitudLector(resto, { agentes, entornos: [ENTORNO_PRODUCCION] });
  const errores = [...r.errores];
  if (!fechaIsoValida(emitidoEn)) errores.push('emitidoEn ilegible o ausente');
  else if (Math.abs(ahoraMs - Date.parse(emitidoEn)) > VENTANA_SOLICITUD_MS) errores.push('solicitud fuera de la ventana de validez (posible repetición)');
  if (errores.length) return { ok: false, errores, solicitud: null };
  return { ok: true, errores: [], solicitud: r.solicitud };
}

/**
 * Respuesta de producción. Se descartan (y se cuentan) las filas de otro entorno, sin `idEjecucion`, con `generadoEn` ilegible o futuro, o demasiado grandes; el resto se ordena por
 * fecha PARSEADA descendente (desempate por `idEjecucion`), de modo que la primera es la más reciente aunque la tabla venga desordenada. Si la tabla devuelve tantas filas como el límite
 * de lectura no se puede asegurar que la más reciente esté incluida: se rechaza en lugar de responder con algo que podría ser antiguo.
 */
export function armarRespuestaProduccion({ solicitud, filas, ahoraIso }) {
  const ahora = Date.parse(ahoraIso);
  const crudas = (Array.isArray(filas) ? filas : []).filter((f) => f && typeof f === 'object' && Object.keys(f).length);
  if (crudas.length >= MAX_LECTURA_TABLA) throw new Error(`LECTURA INCOMPLETA: la tabla devolvió ${crudas.length} filas (límite de lectura ${MAX_LECTURA_TABLA}); no se puede asegurar que la más reciente esté incluida`);
  const buenas = [];
  let descartadas = 0;
  for (const f of crudas) {
    const x = filaDeTabla(f);
    if (x && x.entorno === ENTORNO_PRODUCCION && x.idEjecucion && x.payload.length <= MAX_PAYLOAD_LECTOR && fechaIsoValida(x.generadoEn) && Date.parse(x.generadoEn) <= ahora + TOLERANCIA_FUTURO_MS) buenas.push(x);
    else descartadas += 1;
  }
  buenas.sort((a, b) => Date.parse(b.generadoEn) - Date.parse(a.generadoEn) || (a.idEjecucion < b.idEjecucion ? 1 : a.idEjecucion > b.idEjecucion ? -1 : 0));
  const r = armarRespuestaLector({ solicitud, filas: buenas, ahoraIso, sintetico: false });
  return { ...r, descartadasEnOrigen: r.descartadasEnOrigen + descartadas };
}
