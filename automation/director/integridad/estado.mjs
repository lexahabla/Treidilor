/**
 * Agente 00 · 3E.8.8 · ESTADO y ALERTAS de la integridad del diario, derivados del LEDGER (partición `integridad`), no del registro del almacén.
 * PURO salvo la lectura del ledger. Sin canales ni mensajes: devuelve `alertas` estructuradas con las que el Director compone lo que ya comunica.
 * No expone secretos ni rutas: solo contadores, secuencias, instantes y los 16 primeros caracteres de la huella de la cabeza.
 */
import { CONFIG_INTEGRIDAD } from './config.mjs';

const NIVELES = ['ok', 'aviso', 'fallo'];
export const corta = (h) => (typeof h === 'string' ? h.replace(/^sha256:/, '').slice(0, 16) : null);

/** FUNCIÓN PURA. Valida la política (aviso > intervalo; fallo > aviso; entero positivo; intervalo entre 1 min y 7 días). */
export function validarPoliticaIntegridad(p = CONFIG_INTEGRIDAD.politica) {
  const e = [];
  for (const k of ['intervaloMs', 'avisoMs', 'falloMs']) if (!Number.isInteger(p?.[k]) || p[k] <= 0) e.push(`${k}_no_valido`);
  if (!e.length) { if (p.intervaloMs < 60000) e.push('intervalo_menor_de_1_minuto'); if (p.intervaloMs > 7 * 24 * 3600000) e.push('intervalo_mayor_de_7_dias'); if (p.avisoMs <= p.intervaloMs) e.push('aviso_no_posterior_al_intervalo'); if (p.falloMs <= p.avisoMs) e.push('fallo_no_posterior_al_aviso'); }
  return e.length ? { ok: false, errores: e } : { ok: true };
}

/** FUNCIÓN PURA. ¿Estamos en una franja prohibida (hora de Madrid, límites «desde» incluido y «hasta» excluido)? Admite franjas que cruzan la medianoche. */
export function enVentanaProhibida(ahoraMs, ventanas = CONFIG_INTEGRIDAD.ventanasProhibidas, zona = CONFIG_INTEGRIDAD.zonaHoraria) {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ahoraMs));
  const m = Number(partes.find((x) => x.type === 'hour').value) * 60 + Number(partes.find((x) => x.type === 'minute').value);
  const aMin = (t) => { const [h, mi] = t.split(':').map(Number); return h * 60 + mi; };
  return ventanas.some((v) => { const d = aMin(v.desde); const h = aMin(v.hasta); return d <= h ? m >= d && m < h : m >= d || m < h; });
}

/** Eventos de integridad de UN almacén, en orden. Si el ledger no es íntegro NO se interpreta nada: `{ok:false, motivo}`. */
export function leerEventosIntegridad(ledger, idAlmacen) {
  let est;
  try { est = ledger.estado(); } catch { return { ok: false, motivo: 'ledger_no_disponible' }; }
  if (est.errores && est.errores.length) return { ok: false, motivo: 'ledger_no_integro' };
  if (est.colaIncompleta) return { ok: false, motivo: 'ledger_cola_incompleta' };
  let ev;
  try { ev = ledger.leer((x) => ['ancla_integridad', 'integridad_ejecucion', 'integridad_discrepancia'].includes(x.tipo) && x.refs && x.refs.idAlmacen === idAlmacen); } catch { return { ok: false, motivo: 'ledger_lectura_fallida' }; } // motivo propio: así la guarda de `estado()` de arriba es verificable por separado
  return { ok: true, eventos: ev, ultimaSecuencia: est.ultimaSecuencia, sinEventosEnLedger: est.ultimaSecuencia === 0 };
}

const esSatisfactoria = (d) => d && d.resultado === 'ok' && d.completa === true && d.codigoSalida === 0;
const ultimo = (a) => (a.length ? a[a.length - 1] : null);

/** Ancla vigente (último evento `ancla_integridad`) a partir de los eventos ya leídos. */
export const anclaDe = (eventos) => { const e = ultimo(eventos.filter((x) => x.tipo === 'ancla_integridad')); return e ? { seq: e.datos.seq, huella: e.datos.huella, instante: e.instante, secuencia: e.secuencia, motivo: e.datos.motivo } : null; };

/**
 * FUNCIÓN PURA sobre los eventos. ¿Toca ejecutar? Toca si nunca hubo una verificación satisfactoria («primera obligatoria»), si la última tentativa no fue satisfactoria o si venció el intervalo.
 * @returns {{debe:boolean, motivo:string, edadMs:number|null}}
 */
export function debeEjecutar({ eventos, ahora, politica = CONFIG_INTEGRIDAD.politica }) {
  const ej = eventos.filter((x) => x.tipo === 'integridad_ejecucion');
  const sat = ultimo(ej.filter((x) => esSatisfactoria(x.datos)));
  if (!sat) return { debe: true, motivo: 'primera_obligatoria', edadMs: null };
  if (!esSatisfactoria(ultimo(ej).datos)) return { debe: true, motivo: 'ultima_tentativa_no_satisfactoria', edadMs: ahora - Date.parse(sat.instante) };
  const edad = ahora - Date.parse(sat.instante);
  if (!Number.isFinite(edad) || edad < 0) return { debe: true, motivo: 'marca_de_tiempo_no_valida', edadMs: Number.isFinite(edad) ? edad : null };
  return edad >= politica.intervaloMs ? { debe: true, motivo: 'intervalo_vencido', edadMs: edad } : { debe: false, motivo: 'vigente', edadMs: edad };
}

const TEXTOS = {
  integridad_nunca_verificada: 'La integridad del diario nunca se ha verificado.',
  integridad_vencida: 'La última verificación correcta de la integridad del diario es antigua.',
  integridad_caducada: 'La última verificación correcta de la integridad del diario CADUCÓ.',
  integridad_alteracion_confirmada: 'Se ha CONFIRMADO una alteración o un retroceso del diario. No se repara nada automáticamente.',
  integridad_error_operativo: 'La última verificación no pudo completarse (error operativo).',
  integridad_errores_repetidos: 'La verificación de integridad falla de forma repetida por errores operativos.',
  integridad_incompleta: 'La cadena del diario está incompleta (faltan segmentos): no se da por verificada.',
  ancla_no_fiable: 'El almacén verifica, pero la cabeza no se pudo contrastar o anclar: no cuenta como verificación satisfactoria. Requiere el reanclaje explícito del propietario.',
  copia_externa_obsoleta: 'La copia externa del ancla es MÁS ANTIGUA que la referencia de frescura del propietario: posible sustitución por una versión antigua.',
  ancla_copia_discrepante: 'La copia externa y el ledger discrepan en la misma secuencia: no se ancla nada hasta aclararlo.',
  copia_externa_sin_referencia: 'Hay copia externa pero ninguna referencia de frescura independiente: una copia antigua también válida no se distinguiría.',
  copia_externa_con_anomalias: 'La carpeta de copias externas contiene archivos inválidos, huecos de contador o una cadena rota.',
  copia_externa_no_escrita: 'No se pudo escribir la copia externa del ancla (el ancla del ledger sí está guardada).',
  ancla_ausente: 'No hay ancla externa vigente: el retroceso del almacén no se puede detectar hasta anclarla (acción explícita).',
  ancla_ilegible: 'El ledger de integridad no es íntegro o no se puede leer: no hay ancla fiable.',
};

/**
 * Estado completo para el Director. `ahora` en ms. Nunca lanza. nivel = el peor de los motivos.
 * @returns {{nivel:'ok'|'aviso'|'fallo', motivos:string[], alertas:object[], ultimaSatisfactoria:object|null, ultimaTentativa:object|null, siguienteComprobacion:string, toca:object, ancla:object, alteracionConfirmada:boolean, errorOperativo:boolean}}
 */
export function estadoIntegridad({ ledger, idAlmacen, ahora, config = CONFIG_INTEGRIDAD }) {
  const pol = config.politica; const motivos = []; let nivel = 'ok';
  const sube = (n, m) => { if (NIVELES.indexOf(n) > NIVELES.indexOf(nivel)) nivel = n; motivos.push(m); };
  const lec = leerEventosIntegridad(ledger, idAlmacen);
  const base = { ultimaSatisfactoria: null, ultimaTentativa: null, siguienteComprobacion: new Date(ahora).toISOString(), alteracionConfirmada: false, errorOperativo: false };
  if (!lec.ok) { sube('fallo', 'ancla_ilegible'); return finalizar({ nivel, motivos, ...base, toca: { debe: true, motivo: lec.motivo, edadMs: null }, ancla: { estado: 'ilegible', motivo: lec.motivo } }, ahora); }
  const ej = lec.eventos.filter((x) => x.tipo === 'integridad_ejecucion'); const sat = ultimo(ej.filter((x) => esSatisfactoria(x.datos))); const tent = ultimo(ej);
  const ancla = anclaDe(lec.eventos); const toca = debeEjecutar({ eventos: lec.eventos, ahora, politica: pol });
  const resumir = (e) => (e ? { instante: e.instante, secuencia: e.secuencia, resultado: e.datos.resultado, codigoSalida: e.datos.codigoSalida, duracionMs: e.datos.duracionMs ?? null, segmentos: e.datos.segmentos ?? null, eventosTotales: e.datos.eventosTotales ?? null, cabezaSeq: e.datos.cabeza ? e.datos.cabeza.seq : null, cabeza: e.datos.cabeza ? corta(e.datos.cabeza.huella) : null, anclaExterna: e.datos.anclaExterna ?? null, accionAncla: e.datos.accionAncla ?? null, recursos: e.datos.recursos ?? null } : null);
  // vigencia
  if (!sat) sube('aviso', 'integridad_nunca_verificada');
  else { const edad = ahora - Date.parse(sat.instante); if (edad >= pol.falloMs) sube('fallo', 'integridad_caducada'); else if (edad >= pol.avisoMs) sube('aviso', 'integridad_vencida'); }
  // última tentativa
  let alteracion = false; let errorOp = false;
  if (tent && !esSatisfactoria(tent.datos)) {
    if (['alterada', 'retroceso'].includes(tent.datos.resultado)) { alteracion = true; sube('fallo', 'integridad_alteracion_confirmada'); }
    else if (tent.datos.resultado === 'incompleta') sube('aviso', 'integridad_incompleta');
    else if (tent.datos.resultado === 'sin_ancla') sube('aviso', 'ancla_no_fiable');
    else { errorOp = true; sube('aviso', 'integridad_error_operativo'); }
  }
  let seguidos = 0; for (let i = ej.length - 1; i >= 0 && ej[i].datos.resultado === 'error'; i -= 1) seguidos += 1;
  if (seguidos >= config.erroresSeguidosParaFallo) sube('fallo', 'integridad_errores_repetidos');
  // ancla
  if (!ancla && ej.length) sube('aviso', 'ancla_ausente');
  // copia externa firmada (según lo anotado en la última ejecución)
  const cx = tent && tent.datos.copiaExterna ? tent.datos.copiaExterna : null;
  if (cx) { if (cx.estado === 'obsoleta') sube('fallo', 'copia_externa_obsoleta'); if (cx.contraste === 'distintas') sube('fallo', 'ancla_copia_discrepante'); if (cx.estado === 'sin_referencia_de_frescura') sube('aviso', 'copia_externa_sin_referencia'); if (cx.invalidas > 0 || cx.huecos > 0 || cx.cadenaOk === false) sube('aviso', 'copia_externa_con_anomalias'); if (cx.exportacion && !['exportada', 'sin_cambio'].includes(cx.exportacion)) sube('aviso', 'copia_externa_no_escrita'); }
  const siguiente = sat && esSatisfactoria(tent.datos) ? new Date(Date.parse(sat.instante) + pol.intervaloMs).toISOString() : new Date(ahora).toISOString();
  return finalizar({ nivel, motivos: [...new Set(motivos)], ultimaSatisfactoria: resumir(sat), ultimaTentativa: resumir(tent), siguienteComprobacion: siguiente, toca, alteracionConfirmada: alteracion, errorOperativo: errorOp, erroresSeguidos: seguidos, ancla: ancla ? { estado: 'vigente', seq: ancla.seq, cabeza: corta(ancla.huella), instante: ancla.instante, motivo: ancla.motivo } : { estado: 'ausente' } }, ahora);
}

function finalizar(r, ahora) {
  const desde = r.ultimaSatisfactoria ? r.ultimaSatisfactoria.instante : null;
  const alertas = r.motivos.map((m) => ({ codigo: m, nivel: ['integridad_caducada', 'integridad_alteracion_confirmada', 'integridad_errores_repetidos', 'ancla_ilegible', 'copia_externa_obsoleta', 'ancla_copia_discrepante'].includes(m) ? 'fallo' : 'aviso', mensaje: TEXTOS[m] ?? m, ultimaSatisfactoria: desde }));
  return { ...r, alertas, calculadoEn: new Date(ahora).toISOString() };
}

/** Líneas de texto (sin secretos ni rutas) para las interfaces existentes del Director (p. ej. el estado del canal). No envía nada. */
export function lineasEstadoIntegridad(e) {
  const fecha = (x) => (x ? x.slice(0, 16).replace('T', ' ') + ' UTC' : 'nunca');
  const l = [`Integridad del diario: ${e.nivel === 'ok' ? 'correcta' : e.nivel === 'aviso' ? 'AVISO' : 'FALLO'}`];
  l.push(`Última verificación satisfactoria: ${fecha(e.ultimaSatisfactoria && e.ultimaSatisfactoria.instante)} · última tentativa: ${e.ultimaTentativa ? `${fecha(e.ultimaTentativa.instante)} (${e.ultimaTentativa.resultado})` : 'ninguna'}`);
  l.push(`Siguiente comprobación prevista: ${fecha(e.siguienteComprobacion)} · ancla: ${e.ancla.estado === 'vigente' ? `#${e.ancla.seq} (${e.ancla.cabeza})` : e.ancla.estado}`);
  for (const a of e.alertas) l.push(`${a.nivel === 'fallo' ? '⚠ ' : '• '}${a.mensaje}`);
  return l;
}
