/**
 * PUENTE · SOBRES ESTRICTOS del servicio del Director (`tai-puente/1`). Validación sin tolerancia: campos desconocidos, tipos erróneos o tamaños fuera de rango se rechazan enteros.
 * Solicitud (cliente → Director): sólo un MENSAJE de texto para el Canal 13. No existe ningún tipo de sobre que apruebe, ejecute o escriba: las decisiones y las autorizaciones
 * permanecen en el Director y en su interfaz autenticada.
 */
import { LIMITE_ENTRADA } from '../canal/canal13.mjs';

export const ESQUEMA_PUENTE = 'tai-puente/1';
export const ESQUEMA_PUENTE_RESPUESTA = 'tai-puente-respuesta/1';
export const MAX_CUERPO_BYTES = 8 * 1024;

const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Valida el cuerpo ya parseado de `POST /tai/v1/mensajes`. */
export function validarSolicitudPuente(s) {
  const errores = [];
  if (!esObjeto(s)) return { ok: false, errores: ['el cuerpo debe ser un objeto JSON'], solicitud: null };
  for (const k of Object.keys(s)) if (!['esquema', 'idSolicitud', 'claveIdempotencia', 'canal', 'texto'].includes(k)) errores.push(`campo no admitido: ${k}`);
  if (s.esquema !== ESQUEMA_PUENTE) errores.push('esquema no admitido');
  if (typeof s.idSolicitud !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(s.idSolicitud)) errores.push('idSolicitud inválido');
  if (typeof s.claveIdempotencia !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(s.claveIdempotencia)) errores.push('claveIdempotencia inválida');
  if (s.canal !== 'texto') errores.push('canal no admitido (sólo texto: la voz sigue desactivada)');
  if (typeof s.texto !== 'string' || !s.texto.trim()) errores.push('texto vacío');
  else if (s.texto.length > LIMITE_ENTRADA) errores.push(`texto demasiado largo (máx. ${LIMITE_ENTRADA})`);
  if (errores.length) return { ok: false, errores, solicitud: null };
  return { ok: true, errores: [], solicitud: { esquema: s.esquema, idSolicitud: s.idSolicitud, claveIdempotencia: s.claveIdempotencia, canal: 'texto', texto: s.texto } };
}

/** Evidencia y trazabilidad de una respuesta: se lee del ledger (no de lo que dice el texto). */
export function trazabilidadDeTareas(director, idsTarea) {
  const tareas = [];
  for (const idTarea of idsTarea) {
    let eventos = [];
    try { eventos = director.ledger.leer({ idTarea }); } catch { eventos = []; }
    const ev = eventos.filter((e) => e.tipo === 'evidencia').map((e) => ({ idEvidencia: (e.refs || {}).idEvidencia ?? null, referencia: e.datos.referencia, hash: e.datos.hash, capturadaEn: e.datos.capturadaEn, origen: e.datos.origen }));
    const ver = eventos.filter((e) => e.tipo === 'verificacion').map((e) => ({ idEvidencia: (e.refs || {}).idEvidencia ?? null, resultado: e.datos.resultado, metodo: e.datos.metodo }));
    const estados = eventos.filter((e) => e.tipo === 'tarea_estado').map((e) => e.datos.estado);
    const creada = eventos.find((e) => e.tipo === 'tarea_creada');
    tareas.push({ idTarea, capacidad: creada ? creada.datos.sobre.capacidad : null, estados, evidencias: ev, verificaciones: ver, secuencias: eventos.map((e) => e.secuencia) });
  }
  return tareas;
}

export function sobreRespuesta({ solicitud, mensaje, director, cliente, repetida = false }) {
  const idsTarea = (mensaje.tareas || []).map((t) => t.idTarea);
  return {
    esquema: ESQUEMA_PUENTE_RESPUESTA,
    idSolicitud: solicitud.idSolicitud,
    claveIdempotencia: solicitud.claveIdempotencia,
    cliente,
    repetida,
    // El mensaje del Canal 13 tal cual lo produjo el Director (texto, estado, avisos, naturaleza de los datos, fuentes).
    mensaje,
    trazabilidad: { tareas: trazabilidadDeTareas(director, idsTarea) },
    // n8n y los clientes del puente NO aprueban: si el Director pide autorización, la persona decide en su interfaz autenticada.
    autorizacion: { apruebaElPuente: false, pendientes: (mensaje.solicitudesAutorizacion || []).map((s) => s.idAprobacion) },
  };
}
