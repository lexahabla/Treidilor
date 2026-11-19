/**
 * Agente 00 · F1.1 · FRESCURA DE INFORMES Y DATOS (A-01: valores iniciales configurables; PURO).
 * La frescura depende de la PREGUNTA, no solo de la fecha, y la asigna el código (no el modelo):
 *   · histórica o comparativa → cualquier edad, siempre con su fecha e id;
 *   · de presente → un dato `vigente`; si no lo hay, lo dice y ofrece actualizar;
 *   · de decisión → dato `vigente` y COMPLETO.
 * Los históricos se conservan y se consultan siempre: `solo_historico` cambia cómo se PRESENTA, nunca si existe.
 */
const UNIDADES = { s: 1000, min: 60000, h: 3600000, d: 86400000 };

/** «7d», «24h», «60s», «5min» → milisegundos (null si no es válido). */
export function parseDuracion(texto) {
  const m = /^(\d+)(s|min|h|d)$/.exec(String(texto ?? '').trim());
  return m ? Number(m[1]) * UNIDADES[m[2]] : null;
}

export const ESTADOS_FRESCURA = ['vigente', 'a_actualizar', 'solo_historico', 'desconocida'];

/** Umbrales de respaldo (A-01), por agente; la ficha de capacidad (`frescura`) los sustituye cuando existe. */
export const FRESCURA_DEFECTO = Object.freeze({
  '12': Object.freeze({ vigenteHasta: '24h', actualizarHasta: '7d' }),
  '04': Object.freeze({ vigenteHasta: '7d', actualizarHasta: '30d' }),
  vivo: Object.freeze({ salud: '60s', tareasYConsumo: '5min' }),
  comunicadoAviso: '30d',
});

function edadTexto(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'menos de 1 min';
  if (m < 120) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/**
 * Clasifica un dato por su edad. `dato`: { generadoEn, completo }; `umbrales`: { vigenteHasta, actualizarHasta }; `ahora` en ms.
 * Reglas: `completo=false` nunca es `vigente` (mínimo `a_actualizar`); fecha futura o ilegible → `desconocida` (no se afirma nada).
 */
export function clasificarFrescura(dato, umbrales, ahora) {
  const vig = parseDuracion(umbrales && umbrales.vigenteHasta);
  const act = parseDuracion(umbrales && umbrales.actualizarHasta);
  const t = Date.parse(dato && dato.generadoEn);
  if (vig === null || act === null) return { estado: 'desconocida', edadMs: null, edad: null, motivos: ['umbrales_no_definidos'] };
  if (Number.isNaN(t)) return { estado: 'desconocida', edadMs: null, edad: null, motivos: ['fecha_ilegible'] };
  if (t > ahora + 60000) return { estado: 'desconocida', edadMs: null, edad: null, motivos: ['fecha_futura'] };
  const edadMs = Math.max(0, ahora - t);
  const motivos = [];
  let estado = edadMs <= vig ? 'vigente' : edadMs <= act ? 'a_actualizar' : 'solo_historico';
  if (dato.completo === false) {
    motivos.push('informe_parcial');
    if (estado === 'vigente') estado = 'a_actualizar';
  }
  return { estado, edadMs, edad: edadTexto(edadMs), motivos };
}

/**
 * Qué puede decir el Director sobre un dato para una pregunta concreta.
 * Devuelve `{ puedeAfirmarComoActual, tono:'responder'|'responder_con_aviso'|'solo_historico'|'no_consta', aviso, ofrecerActualizar }`.
 */
export function aplicarPregunta(clasif, tipoPregunta) {
  const tipo = ['historica', 'presente', 'decision'].includes(tipoPregunta) ? tipoPregunta : 'presente';
  const { estado, edad, motivos } = clasif;
  const parcial = motivos.includes('informe_parcial');
  if (estado === 'desconocida') return { puedeAfirmarComoActual: false, tono: tipo === 'historica' ? 'responder_con_aviso' : 'no_consta', aviso: 'No consta la fecha del dato: no se puede afirmar que sea actual.', ofrecerActualizar: tipo !== 'historica' };
  if (tipo === 'historica') return { puedeAfirmarComoActual: false, tono: 'responder', aviso: estado === 'vigente' ? null : `Registro histórico (${edad}).`, ofrecerActualizar: false };
  if (tipo === 'presente') {
    if (estado === 'vigente') return { puedeAfirmarComoActual: true, tono: 'responder', aviso: null, ofrecerActualizar: false };
    if (estado === 'a_actualizar') return { puedeAfirmarComoActual: false, tono: 'responder_con_aviso', aviso: `El dato tiene ${edad}${parcial ? ' y el informe es parcial' : ''}: puede no reflejar el estado actual.`, ofrecerActualizar: true };
    return { puedeAfirmarComoActual: false, tono: 'no_consta', aviso: `No consta un dato actual: el último informe tiene ${edad} (solo histórico).`, ofrecerActualizar: true };
  }
  // decisión: exige vigente y completo
  if (estado === 'vigente' && !parcial) return { puedeAfirmarComoActual: true, tono: 'responder', aviso: null, ofrecerActualizar: false };
  return { puedeAfirmarComoActual: false, tono: 'no_consta', aviso: `No se debe basar una decisión en este dato (${estado}${parcial ? ', informe parcial' : ''}, ${edad}): actualízalo antes.`, ofrecerActualizar: true };
}

/** Lo comunicado por el propietario y sin verificar: tras 30 d se avisa («comunicado hace N días, sin verificar»). */
export function avisoComunicado(fechaIso, ahora, umbral = FRESCURA_DEFECTO.comunicadoAviso) {
  const t = Date.parse(fechaIso);
  const lim = parseDuracion(umbral);
  if (Number.isNaN(t) || lim === null) return null;
  const edad = ahora - t;
  return edad >= lim ? `comunicado hace ${Math.floor(edad / 86400000)} días, sin verificar` : null;
}
