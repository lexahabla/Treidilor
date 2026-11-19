/**
 * Agente 00 · 3E.8.8 · ANCLAJE EXTERNO de la cabeza del diario en el ledger del Director (partición `integridad`).
 *
 * QUÉ GARANTIZA: el ancla (seq + huella de la última cabeza VERIFICADA como completa y correcta) vive en el ledger, que es un archivo de solo añadir, encadenado, con fsync, comparación de secuencia y detección de truncado,
 * escrito SOLO por el Director y en un directorio distinto del almacén (la política de rutas del almacén prohíbe que viva dentro del ledger). Una restauración antigua del almacén, hecha sin el ledger, queda en evidencia
 * porque el almacén no contiene la cabeza anclada. El ancla jamás se toma del registro del almacén.
 * LÍMITE: NO es independiente del equipo. Quien controle el disco/host puede reescribir ledger y almacén a la vez, o restaurar ambos juntos; y un ledger restaurado a una versión anterior hace retroceder el ancla
 * (detectable solo en parte: la propia ancla del ledger detecta el truncado, no la restauración conjunta de archivo y ancla). Para eso hace falta una copia fuera del equipo (p. ej. el comunicado al propietario).
 */
import { ErrorLedger } from '../ledger.mjs';
import { anclaDe, corta, leerEventosIntegridad } from './estado.mjs';

export const ESQUEMA_ANCLA = 'ancla-integridad/1';
const HUELLA = /^[A-Za-z0-9:_-]{8,100}$/;
export const ID_ALMACEN = /^[a-z0-9_-]{1,40}$/;
export class ErrorAncla extends Error { constructor(codigo, mensaje) { super(mensaje); this.name = 'ErrorAncla'; this.codigo = codigo; } }
const cabezaValida = (c) => Boolean(c) && Number.isInteger(c.seq) && c.seq >= 0 && typeof c.huella === 'string' && HUELLA.test(c.huella);

/** Ancla vigente: { estado: 'vigente'|'ausente'|'ilegible', ancla?, motivo? }. `ilegible` = el ledger no es íntegro: nunca se supone «ausente» (podría ser pérdida o manipulación). */
export function leerAncla(ledger, idAlmacen) {
  const l = leerEventosIntegridad(ledger, idAlmacen);
  if (!l.ok) return { estado: 'ilegible', motivo: l.motivo };
  const a = anclaDe(l.eventos);
  return a ? { estado: 'vigente', ancla: a } : { estado: 'ausente' };
}

/**
 * FUNCIÓN PURA. Decide qué hacer con el ancla tras una ejecución. Un resultado omitido, parcial, fallido o sin comprobar contra el ancla NUNCA avanza.
 * @param {{ancla:null|{seq:number,huella:string}, resultadoCli:object, reanclar?:null|{confirmar:boolean, motivo:string, autorizadoPor:string}}} e
 * @returns {{accion:'anclar'|'sin_cambio'|'discrepancia'|'no_anclar', motivo:string}}
 */
export function decidirAnclaje({ ancla, resultadoCli: r, reanclar = null }) {
  if (!r || r.omitida) return { accion: 'no_anclar', motivo: 'omitida' };
  const correcta = r.resultado === 'ok' && r.codigoSalida === 0 && r.completa === true && cabezaValida(r.cabeza);
  if (!correcta) return { accion: 'no_anclar', motivo: 'verificacion_no_correcta' };
  if (reanclar) {
    const ok = reanclar.confirmar === true && typeof reanclar.motivo === 'string' && reanclar.motivo.trim().length >= 10 && reanclar.autorizadoPor === 'propietario';
    return ok ? { accion: 'anclar', motivo: 'reanclaje_explicito' } : { accion: 'no_anclar', motivo: 'reanclaje_sin_autorizacion' };
  }
  if (ancla === null) {
    if (r.anclaExterna !== 'sin_ancla') return { accion: 'no_anclar', motivo: 'ancla_no_comprobada' };
    return r.comparacionRegistro === 'primera' && r.referencia === 'ausente' ? { accion: 'anclar', motivo: 'primera_ancla' } : { accion: 'no_anclar', motivo: 'ancla_ausente_con_historial' };
  }
  if (r.anclaExterna !== 'coincide') return { accion: 'no_anclar', motivo: 'ancla_no_comprobada' };
  if (r.cabeza.seq < ancla.seq) return { accion: 'discrepancia', motivo: 'cabeza_menor_que_ancla' };
  if (r.cabeza.seq === ancla.seq) return r.cabeza.huella === ancla.huella ? { accion: 'sin_cambio', motivo: 'misma_cabeza' } : { accion: 'discrepancia', motivo: 'misma_seq_distinta_huella' };
  return { accion: 'anclar', motivo: 'avance' };
}

/**
 * Escribe el ancla con comparación de secuencia (CAS) y reintentos; idempotente (mismo `idEvento` = misma cabeza). Monótono: sin `reanclar`, nunca acepta una cabeza anterior.
 * @returns {{accion:'anclado'|'sin_cambio'|'rechazado', motivo?:string, evento?:object}}
 */
export function anclar(ledger, { idAlmacen, cabeza, motivo, idEjecucion = null, segmentos = null, eventosTotales = null, reanclar = null, reintentos = 4 }) {
  if (!ID_ALMACEN.test(String(idAlmacen))) throw new ErrorAncla('almacen_invalido', 'Identificador de almacén no válido.');
  if (!cabezaValida(cabeza)) throw new ErrorAncla('cabeza_invalida', 'Cabeza no válida.');
  for (let i = 0; i < reintentos; i += 1) {
    const est = ledger.estado(); // solo para la comparación de secuencia; la ÚNICA guarda de integridad es `leerAncla` (errores, cola incompleta o lectura fallida → ilegible)
    const actual = leerAncla(ledger, idAlmacen);
    if (actual.estado === 'ilegible') throw new ErrorAncla('ledger_no_integro', 'El ledger no es íntegro: no se ancla.');
    const vigente = actual.estado === 'vigente' ? actual.ancla : null;
    if (!reanclar && vigente) {
      if (cabeza.seq < vigente.seq) return { accion: 'rechazado', motivo: 'retroceso_rechazado' };
      if (cabeza.seq === vigente.seq) return cabeza.huella === vigente.huella ? { accion: 'sin_cambio', motivo: 'misma_cabeza' } : { accion: 'rechazado', motivo: 'misma_seq_distinta_huella' };
    }
    if (!reanclar && !vigente && motivo !== 'primera_ancla') return { accion: 'rechazado', motivo: 'sin_ancla_previa_sin_primera' };
    const h16 = corta(cabeza.huella);
    const datos = { esquema: ESQUEMA_ANCLA, seq: cabeza.seq, huella: cabeza.huella, segmentos, eventosTotales, motivo, idEjecucion, previa: vigente ? { seq: vigente.seq, huella: vigente.huella } : null, permiteRetroceso: Boolean(reanclar), ...(reanclar ? { autorizadoPor: reanclar.autorizadoPor, motivoTexto: String(reanclar.motivo).slice(0, 300) } : {}) };
    const idEvento = `anc-${idAlmacen}-${cabeza.seq}-${h16}${reanclar ? `-r${est.ultimaSecuencia + 1}` : ''}`;
    try {
      const r = ledger.anadir({ tipo: 'ancla_integridad', actor: 'sistema', refs: { idAlmacen }, datos, idEvento }, est.ultimaSecuencia);
      return r.duplicado ? { accion: 'sin_cambio', motivo: 'idempotente', evento: r.evento } : { accion: 'anclado', evento: r.evento };
    } catch (e) {
      if (e instanceof ErrorLedger && e.codigo === 'conflicto_secuencia') continue; // otra escritura se adelantó: se relee y se reevalúa
      throw e;
    }
  }
  throw new ErrorAncla('conflicto_persistente', 'No se pudo anclar tras varios reintentos (el ledger cambia sin cesar).');
}
