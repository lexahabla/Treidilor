/**
 * Agente 11 · WEBS NICHO (ficha `automation/agents/11-webs-nicho.md`; riesgo bajo; «decisión del propietario»; alcance previsto `research:write`; honestidad: «hipótesis marcadas como tales»;
 * medición: «estudios con decisión»). COMPONENTES PUROS que preparan un ESTUDIO DE VIABILIDAD de un nicho con hipótesis y riesgos a partir de los informes ya existentes («informes de mercado y
 * afiliación»): 02 (programas de afiliación), 09 (competencia y huecos), 10 (analítica propia) y, opcionalmente, 05/07/08 y nuestro catálogo de referencia. NO están registrados como capacidades
 * (el 11 no tiene ninguna aprobada: ver `propuesta-capacidades-11.json`, NO aprobada). No crean webs, no compran dominios, no contratan alojamiento, no publican, no activan campañas, no consultan
 * ninguna fuente externa y no escriben nada: todo llega por parámetro y se devuelve en memoria.
 * Dentro de la ficha: `estudiarNicho`, `analizarOportunidades` (ordena por MADUREZ DE LA EVIDENCIA, nunca por beneficio previsto) e `informeNichos`. FUERA de la ficha (la ficha no menciona estructuras
 * de sitio ni estrategias de contenido): `proponerEstructuraSitio` y `proponerEstrategiaContenido`, marcadas `fueraDeFicha` y «propuesta pendiente de autorización»; no se exponen en ningún informe del estudio.
 * Rigor: cada dimensión (demanda, competencia, afiliación, coste, catálogo propio) lleva su estado — `verificado`, `observacion`, `estimacion`, `hipotesis` o `no_disponible` — y su evidencia. Nada se
 * inventa: ni demanda, ni tráfico, ni ingresos, ni rentabilidad (se declaran no disponibles); los costes solo suman lo aportado y se rotulan «parcial» si falta algo.
 * Reutiliza el contenido de los informes `informe-agente/1` de otros agentes (sin recalcular su lógica) y, del 07, `momentosEnHorizonte` y las categorías con palabras clave.
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';
import { momentosEnHorizonte } from '../marketing/marketing.mjs';

/** Umbrales iniciales CONFIGURABLES (se declaran en el informe; no son verdades del mercado). */
export const UMBRALES = Object.freeze({ minProductosPropios: 5, costesRequeridos: ['dominio', 'alojamiento', 'contenido', 'herramientas'], maxNichos: 12, minDimensionesRazonable: 3, horizonteDias: 120 });
const PESO = { verificado: 4, observacion: 3, estimacion: 3, hipotesis: 1, parcial: 1, no_disponible: 0 };
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s));
const mejor = (estados) => estados.reduce((m, e) => (PESO[e] > PESO[m] ? e : m), 'no_disponible');
const h = (clave, regla, elemento, evidencia, { certeza = null, prioridad = null, accion = null } = {}) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida: accion });

/** Carga lo necesario (el módulo del 07 carga las funciones TypeScript existentes). */
export async function cargarMotorNichos() {
  const { cargarMotorMarketing } = await import('../marketing/marketing.mjs');
  try { return { marketing: await cargarMotorMarketing() }; } catch (e) {
    if (e instanceof ErrorProtocolo) throw e;
    throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes no están disponibles (hace falta el cargador de TypeScript del proyecto).');
  }
}
const exigir = (m) => { if (!m || !m.marketing) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes no están cargadas.'); return m; };

// ── dimensiones ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Clasifica un dato APORTADO por el propietario (demanda o coste). Nunca lo eleva: una estimación sin método o un «verificado» sin fuente y fecha se degradan. */
function claseAportada(it) {
  const avisos = [];
  let clase = ['hecho_verificado', 'estimacion', 'hipotesis', 'no_disponible'].includes(it.clase) ? it.clase : 'hipotesis';
  if (!['hecho_verificado', 'estimacion', 'hipotesis', 'no_disponible'].includes(it.clase)) avisos.push('clase_invalida: se trata como hipótesis');
  if (clase === 'hecho_verificado' && !(it.fuente && esFecha(it.fecha))) { clase = 'hipotesis'; avisos.push('verificado_sin_fuente_y_fecha: se trata como hipótesis'); }
  if (clase === 'estimacion' && !(typeof it.metodo === 'string' && it.metodo.trim())) { clase = 'hipotesis'; avisos.push('estimacion_sin_metodo: se trata como hipótesis'); }
  const valor = it.valor === null || it.valor === undefined ? null : Number(it.valor);
  if (clase !== 'no_disponible' && !(Number.isFinite(valor) && valor >= 0)) { clase = 'no_disponible'; avisos.push('sin_valor_numerico: no disponible'); }
  const estado = clase === 'hecho_verificado' ? 'verificado' : clase;
  return { estado, valor: estado === 'no_disponible' ? null : valor, avisos };
}

function dimensionDemanda(nicho) {
  const items = (nicho.datosAportados && Array.isArray(nicho.datosAportados.demanda) ? nicho.datosAportados.demanda : []).map((it, i) => {
    const c = claseAportada(it);
    return { id: String(it.id ?? `d${i + 1}`).slice(0, 40), descripcion: String(it.descripcion ?? '').slice(0, 160), valor: c.valor, unidad: String(it.unidad ?? '').slice(0, 30), estado: c.estado, fuente: it.fuente ? String(it.fuente).slice(0, 100) : null, fecha: esFecha(it.fecha) ? it.fecha.slice(0, 10) : null, metodo: it.metodo ? String(it.metodo).slice(0, 120) : null, avisos: c.avisos, origen: 'aportado_por_el_propietario' };
  });
  return { estado: mejor(items.map((x) => x.estado)), items, nota: 'La demanda no la calcula ningún agente: son cifras aportadas por una persona; no se suman ni se proyectan.' };
}

function dimensionCoste(nicho, u) {
  const items = (nicho.datosAportados && Array.isArray(nicho.datosAportados.costes) ? nicho.datosAportados.costes : []).map((it, i) => {
    const c = claseAportada({ ...it, valor: it.importeEur });
    return { concepto: fold(it.concepto).replace(/ /g, '-').slice(0, 40) || `coste-${i + 1}`, importeEur: c.valor, estado: c.estado, fuente: it.fuente ? String(it.fuente).slice(0, 100) : null, fecha: esFecha(it.fecha) ? it.fecha.slice(0, 10) : null, metodo: it.metodo ? String(it.metodo).slice(0, 120) : null, avisos: c.avisos, origen: 'aportado_por_el_propietario' };
  });
  const presentes = new Set(items.filter((x) => x.estado !== 'no_disponible').map((x) => x.concepto));
  const faltan = u.costesRequeridos.filter((c) => !presentes.has(c));
  const total = items.filter((x) => x.importeEur !== null).reduce((s, x) => s + x.importeEur, 0);
  const completo = items.length > 0 && faltan.length === 0 && !items.some((x) => x.estado === 'no_disponible');
  const hayDato = items.some((x) => x.estado !== 'no_disponible');
  return { estado: completo ? mejor(items.map((x) => x.estado)) : hayDato ? 'parcial' : 'no_disponible', items, totalAportadoEur: items.some((x) => x.importeEur !== null) ? Math.round(total * 100) / 100 : null, totalCompleto: completo, conceptosSinDato: faltan, nota: completo ? 'Suma de los importes aportados.' : 'Suma PARCIAL de lo aportado: faltan conceptos o datos; no es el coste del proyecto.' };
}

function dimensionAfiliacion(informe02) {
  if (!informe02 || informe02.agente !== '02') return { estado: 'no_disponible', programas: [], motivo: 'no se aportó informe del Agente 02 para este nicho' };
  const prog = new Map();
  for (const x of informe02.hallazgos || []) {
    const p = prog.get(x.elemento) || { id: x.elemento, comisionPct: null, verificacion: null, fuente: null, fecha: null, noVigente: false, sinDatos: [] };
    if (x.regla === 'dato_declarado' && x.evidencia && x.evidencia.campo === 'comisionPct') Object.assign(p, { comisionPct: x.evidencia.valor, verificacion: x.evidencia.verificacion, fuente: x.evidencia.fuente ?? null, fecha: x.evidencia.fecha ?? null });
    if (x.regla === 'datos_no_vigentes') p.noVigente = true;
    if (x.regla === 'dato_ausente' && x.evidencia) p.sinDatos.push(x.evidencia.campo);
    if (x.elemento) prog.set(x.elemento, p);
  }
  const programas = [...prog.values()].filter((p) => p.comisionPct !== null || p.sinDatos.length).sort((a, b) => (b.comisionPct ?? -1) - (a.comisionPct ?? -1) || a.id.localeCompare(b.id));
  const conComision = programas.filter((p) => p.comisionPct !== null);
  const estado = !conComision.length ? 'no_disponible' : conComision.some((p) => p.verificacion === 'verificado' && !p.noVigente) ? 'observacion' : 'hipotesis';
  return { estado, programas, origenDatos: informe02.fuente && informe02.fuente.origenDatos, nota: 'Comisiones DECLARADAS por cada programa (no incluyen conversión ni ticket medio); el alta en un programa es una acción humana (L4).' };
}

function dimensionCompetencia(informe09, nicho) {
  if (!informe09 || informe09.agente !== '09') return { estado: 'no_disponible', motivo: 'no se aportó informe del Agente 09' };
  const claves = new Set((nicho.palabrasClave || []).map(fold));
  const toca = (x) => (x.evidencia && x.evidencia.categoria && x.evidencia.categoria === nicho.categoria) || (x.elemento && [...claves].some((k) => fold(x.elemento).includes(k)));
  const huecos = (informe09.hallazgos || []).filter((x) => x.regla === 'hueco_detectado' && toca(x)).map((x) => ({ clave: x.elemento, fuentes: x.evidencia.nFuentes, hipotesis: true }));
  const debiles = (informe09.hallazgos || []).filter((x) => x.regla === 'hueco_senal_debil' && toca(x)).map((x) => ({ clave: x.elemento, fuentes: x.evidencia.nFuentes }));
  const cubiertos = (informe09.hallazgos || []).filter((x) => x.regla === 'tema_ya_cubierto' && toca(x)).map((x) => x.elemento);
  const brechas = (informe09.hallazgos || []).filter((x) => x.regla === 'brecha_de_precio_observada').length;
  const fuentes = (informe09.hallazgos || []).filter((x) => x.regla === 'fuente_citada' && x.evidencia.utilizable).length;
  const hay = huecos.length + debiles.length + cubiertos.length > 0;
  return { estado: hay ? 'observacion' : 'no_disponible', huecos, senalesDebiles: debiles, temasYaCubiertos: cubiertos, brechasDePrecioObservadas: brechas, fuentesUtilizablesDelInforme: fuentes, origenDatos: informe09.fuente && informe09.fuente.origenDatos, motivo: hay ? undefined : 'el informe del 09 no trae observaciones de este nicho', nota: 'Observaciones aportadas y citadas por una persona (informe del Agente 09); un hueco es una hipótesis.' };
}

function dimensionCatalogo(nicho, fuentes, u) {
  const prods = (fuentes.productos || []).filter((p) => nicho.categoria && (p.category_id === nicho.categoria || p.subcategory_id === nicho.categoria) && Number(p.price) > 0 && p.inStock !== false);
  const cats = (fuentes.categorias || []).filter((c) => c.id === nicho.categoria || c.parentId === nicho.categoria);
  return { estado: nicho.categoria ? 'verificado' : 'no_disponible', categoria: nicho.categoria ?? null, existeEnElCatalogo: cats.length > 0, productosConPrecio: prods.length, minimoRecomendable: u.minProductosPropios, nota: 'Dato de NUESTRAS fichas de referencia (aportadas); no mide el potencial del nicho.', productos: prods.map((p) => p.id).sort() };
}

function indicioPropio(informe10, productosDelNicho) {
  if (!informe10 || informe10.agente !== '10') return null;
  const ids = new Set(productosDelNicho);
  const alta = (informe10.hallazgos || []).filter((x) => x.regla === 'producto_alta_salida_poco_trafico' && ids.has(x.elemento)).map((x) => x.elemento);
  const baja = (informe10.hallazgos || []).filter((x) => x.regla === 'producto_alto_trafico_baja_salida' && ids.has(x.elemento)).map((x) => x.elemento);
  return { altaSalidaPocoTrafico: alta, altoTraficoBajaSalida: baja, origenDatos: informe10.fuente && informe10.fuente.origenDatos, nota: 'Indicio sobre NUESTRO tráfico, no demanda del nicho.' };
}

/**
 * Estudio de viabilidad de UN nicho (borrador; lo decide el propietario). `informes` = { afiliacionPorNicho:{id:informe02}, competencia:informe09, analitica:informe10 }. PURO.
 */
export function estudiarNicho({ motor, nicho, fuentes = {}, informes = {}, sintetico = true, umbrales = {} }) {
  exigir(motor);
  const u = { ...UMBRALES, ...umbrales };
  const d = { demanda: dimensionDemanda(nicho), competencia: dimensionCompetencia(informes.competencia, nicho), afiliacion: dimensionAfiliacion((informes.afiliacionPorNicho || {})[nicho.id]), coste: dimensionCoste(nicho, u), catalogoPropio: dimensionCatalogo(nicho, fuentes, u) };
  const indicio = indicioPropio(informes.analitica, d.catalogoPropio.productos);
  const conEvidencia = ['demanda', 'competencia', 'afiliacion', 'coste'].filter((k) => ['verificado', 'observacion', 'estimacion'].includes(d[k].estado));
  const nivel = conEvidencia.length >= u.minDimensionesRazonable ? 'razonable' : conEvidencia.length >= 2 ? 'parcial' : 'insuficiente';
  const riesgos = [];
  const R = (codigo, severidad, texto) => riesgos.push({ codigo, severidad, texto });
  if (['no_disponible', 'hipotesis'].includes(d.demanda.estado)) R('demanda_no_demostrada', 'alta', 'No hay una cifra de demanda verificada ni estimada con método: no se sabe si hay audiencia suficiente.');
  if (d.competencia.estado === 'no_disponible') R('competencia_sin_datos', 'media', 'No hay observaciones de competidores ni expertos para este nicho.');
  if (d.afiliacion.estado === 'no_disponible') R('afiliacion_sin_datos', 'alta', 'No consta ningún programa con comisión declarada para este nicho.');
  else {
    const con = d.afiliacion.programas.filter((p) => p.comisionPct !== null);
    if (con.length <= 1) R('dependencia_de_un_programa', 'media', 'Como máximo un programa declara comisión: el nicho dependería de él.');
    if (con.some((p) => p.noVigente || p.verificacion !== 'verificado')) R('comisiones_no_vigentes_o_sin_verificar', 'media', 'Alguna comisión no está verificada o sus datos no son vigentes.');
  }
  R('alta_en_programas_no_garantizada', 'media', 'Riesgo general (no es un dato): el alta de un sitio nuevo en un programa de afiliación la decide el programa y la solicita una persona (L4).');
  if (!d.coste.totalCompleto) R('coste_incompleto', 'media', `Faltan datos de coste${d.coste.conceptosSinDato.length ? ` (${d.coste.conceptosSinDato.join(', ')})` : ''}: no se puede acotar la inversión.`);
  if (d.catalogoPropio.productosConPrecio < u.minProductosPropios) R('catalogo_propio_escaso', 'media', `Solo ${d.catalogoPropio.productosConPrecio} ficha(s) propia(s) con precio en la categoría (mínimo orientativo ${u.minProductosPropios}).`);
  if (sintetico) R('datos_de_prueba', 'info', 'Los datos del estudio son sintéticos: no reflejan el mercado.');
  const hipotesis = [
    { id: 'H1', texto: 'Existe demanda suficiente en el nicho.', estado: 'hipotesis', base: d.demanda.items.map((x) => `${x.id}:${x.estado}`), comoValidar: 'Una persona aporta una cifra con fuente, fecha y método (p. ej. de una herramienta de palabras clave).' },
    { id: 'H2', texto: 'Hay un hueco editorial frente a la competencia.', estado: 'hipotesis', base: (d.competencia.huecos || []).map((x) => x.clave), comoValidar: 'Una persona valida los huecos del informe del Agente 09 con más fuentes.' },
    { id: 'H3', texto: 'La afiliación del nicho es viable con al menos un programa.', estado: 'hipotesis', base: (d.afiliacion.programas || []).filter((p) => p.comisionPct !== null).map((p) => `${p.id}:${p.comisionPct}%`), comoValidar: 'Una persona revisa los términos y solicita el alta (L4); la comisión declarada no implica ingresos.' },
    { id: 'H4', texto: 'El coste inicial es asumible.', estado: 'hipotesis', base: d.coste.items.map((x) => `${x.concepto}:${x.estado}`), comoValidar: 'Una persona completa los costes con presupuestos reales.' },
  ];
  return { id: nicho.id, nombre: String(nicho.nombre ?? nicho.id).slice(0, 80), estado: 'estudio_borrador', requiereDecisionDelPropietario: true, dimensiones: d, indicioPropio: indicio, hipotesis, riesgos, madurezDeLaEvidencia: { nivel, dimensionesConEvidencia: conEvidencia, de: 4, nota: 'Mide cuánta evidencia hay, NO si el nicho es rentable ni viable.' }, noDisponible: ['ingresos_y_rentabilidad', 'trafico_potencial', ...(d.demanda.estado === 'no_disponible' ? ['demanda'] : [])] };
}

/** Ordena los estudios por madurez de la evidencia (no por beneficio previsto). Desempate por id. PURO. */
export function analizarOportunidades({ motor, nichos, fuentes = {}, informes = {}, sintetico = true, umbrales = {} }) {
  const u = { ...UMBRALES, ...umbrales };
  const estudios = (Array.isArray(nichos) ? nichos.slice(0, u.maxNichos) : []).filter((n) => n && n.id).map((n) => estudiarNicho({ motor, nicho: n, fuentes, informes, sintetico, umbrales }));
  const puntos = (e) => ['demanda', 'competencia', 'afiliacion', 'coste'].reduce((s, k) => s + PESO[e.dimensiones[k].estado], 0);
  const ranking = estudios.map((e) => ({ id: e.id, nombre: e.nombre, puntosDeEvidencia: puntos(e), nivel: e.madurezDeLaEvidencia.nivel })).sort((a, b) => b.puntosDeEvidencia - a.puntosDeEvidencia || a.id.localeCompare(b.id));
  return { estudios, ranking };
}

// ── informe normalizado ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Informe `informe-agente/1` del Agente 11 (modo `viabilidad` = estudios completos; `oportunidades` = solo el orden por madurez y los riesgos). PURO. */
export function informeNichos({ motor, nichos, fuentes = {}, informes = {}, modo = 'viabilidad', ahora = Date.now(), sintetico = true, capacidad = '11.estudiar-viabilidad-nicho', umbrales = {} }) {
  const { estudios, ranking } = analizarOportunidades({ motor, nichos, fuentes, informes, sintetico, umbrales });
  const H = [];
  const sup = [
    'Los estudios son BORRADORES con hipótesis y riesgos; la decisión es del propietario.',
    'Cada dimensión lleva su estado (verificado, observación, estimación, hipótesis o no disponible); la demanda y los costes los aporta una persona y el agente no los eleva ni los proyecta.',
    'El orden por «madurez de la evidencia» mide cuánta evidencia hay, no el beneficio esperado.',
  ];
  sup.forEach((t, i) => H.push(h(`suposicion:${i + 1}`, 'suposicion', null, { texto: t })));
  for (const [pos, r] of ranking.entries()) H.push(h(`ranking:${r.id}`, 'oportunidad_ordenada', r.id, { posicion: pos + 1, puntosDeEvidencia: r.puntosDeEvidencia, nivel: r.nivel, criterio: 'madurez de la evidencia, no beneficio previsto' }, { certeza: 'confirmado', prioridad: 'P4' }));
  for (const e of estudios) {
    const dims = e.dimensiones;
    if (modo === 'viabilidad') {
      H.push(h(`nicho:${e.id}`, 'nicho_estudiado', e.id, { nombre: e.nombre, madurez: e.madurezDeLaEvidencia, dimensiones: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v.estado])), requiereDecisionDelPropietario: true }, { certeza: 'confirmado', prioridad: 'P3', accion: 'Estudio en borrador: decide el propietario; no se crea ninguna web ni se contrata nada.' }));
      for (const [k, v] of Object.entries(dims)) H.push(h(`nicho:${e.id}:dim:${k}`, 'dimension_del_estudio', `${e.id}:${k}`, { dimension: k, estado: v.estado, detalle: k === 'demanda' ? v.items : k === 'coste' ? { items: v.items, totalAportadoEur: v.totalAportadoEur, totalCompleto: v.totalCompleto, conceptosSinDato: v.conceptosSinDato } : k === 'afiliacion' ? v.programas : k === 'competencia' ? { huecos: v.huecos, senalesDebiles: v.senalesDebiles, temasYaCubiertos: v.temasYaCubiertos } : { productosConPrecio: v.productosConPrecio, categoria: v.categoria }, nota: v.nota ?? v.motivo ?? null }, { certeza: ['verificado'].includes(v.estado) ? 'confirmado' : v.estado === 'no_disponible' ? 'no_verificable' : 'advertencia', prioridad: 'P4' }));
      for (const hi of e.hipotesis) H.push(h(`nicho:${e.id}:${hi.id}`, 'hipotesis', `${e.id}:${hi.id}`, { texto: hi.texto, estado: 'hipotesis', base: hi.base, comoValidar: hi.comoValidar }, { certeza: 'no_verificable', prioridad: 'P4', accion: 'HIPÓTESIS: no está demostrada.' }));
      if (e.indicioPropio && (e.indicioPropio.altaSalidaPocoTrafico.length || e.indicioPropio.altoTraficoBajaSalida.length)) H.push(h(`nicho:${e.id}:indicio`, 'indicio_propio', e.id, e.indicioPropio, { certeza: 'advertencia', prioridad: 'P4' }));
    }
    for (const r of e.riesgos) H.push(h(`nicho:${e.id}:riesgo:${r.codigo}`, 'riesgo', `${e.id}:${r.codigo}`, { codigo: r.codigo, severidad: r.severidad, texto: r.texto }, { certeza: r.severidad === 'info' ? 'confirmado' : 'advertencia', prioridad: r.severidad === 'alta' ? 'P2' : r.severidad === 'media' ? 'P3' : 'P4' }));
  }
  H.push(h('no_disponible', 'datos_no_disponibles', null, { metricas: [
    { metrica: 'ingresos_y_rentabilidad', motivo: 'ninguna fuente los verifica y el agente no los proyecta' },
    { metrica: 'trafico_potencial', motivo: 'no hay datos de buscadores ni de audiencia' },
    { metrica: 'demanda_no_aportada', motivo: 'solo se registran cifras de demanda aportadas por una persona, con fuente, fecha y método' },
    { metrica: 'estudios_con_decision', motivo: 'no existe registro de las decisiones del propietario sobre cada estudio' },
  ] }, { certeza: 'no_verificable', prioridad: 'P4' }));
  const limitaciones = [
    'Solo estudios en borrador: no se crea ninguna web, no se compra ningún dominio, no se contrata alojamiento, no se publica contenido ni se activa ninguna campaña (todo ello es L4 humano).',
    'No se inventan demanda, tráfico, ingresos ni rentabilidad; lo que no se aporta se declara no disponible.',
    'Los informes de los Agentes 02, 09 y 10 se usan tal cual (sin recalcular su lógica) y heredan sus limitaciones.',
    'No se consultan fuentes externas (sin red, sin créditos).',
  ];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: nichos, costes, demanda y observaciones sintéticos; no reflejan el mercado.');
  const incid = H.filter((x) => x.regla === 'riesgo' && ['P2', 'P3'].includes(x.prioridad)).length;
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '11', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `nc-${createHash('sha256').update(canonico({ modo, n: estudios.map((e) => [e.id, Object.values(e.dimensiones).map((d) => d.estado), e.riesgos.map((r) => r.codigo)]) })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: estudios.length > 0 && estudios.every((e) => e.madurezDeLaEvidencia.nivel === 'razonable'),
    fuente: { sistema: 'informes_de_agentes', tabla: 'estudios_de_nicho', host: null, registrosLeidos: estudios.length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico(estudios.map((e) => [e.id, e.dimensiones.demanda.items, e.dimensiones.coste.items]))) },
    resumen: { estadoCalidad: estudios.length && estudios.every((e) => e.madurezDeLaEvidencia.nivel === 'razonable') ? 'completa' : 'evidencia_insuficiente', incidencias: incid, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: estudios.filter((e) => e.madurezDeLaEvidencia.nivel !== 'razonable').length, elementosTotales: estudios.length, nichos: estudios.length, nichosEvidenciaRazonable: estudios.filter((e) => e.madurezDeLaEvidencia.nivel === 'razonable').length, nichosEvidenciaParcial: estudios.filter((e) => e.madurezDeLaEvidencia.nivel === 'parcial').length, nichosEvidenciaInsuficiente: estudios.filter((e) => e.madurezDeLaEvidencia.nivel === 'insuficiente').length, hipotesis: modo === 'viabilidad' ? estudios.reduce((s, e) => s + e.hipotesis.length, 0) : 0, riesgos: estudios.reduce((s, e) => s + e.riesgos.length, 0), estudiosConDecision: 0 },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe, estudios, ranking };
}

// ── FUERA DE LA FICHA: propuestas pendientes de autorización (no se exponen en los informes de estudio) ───────────────────────────────────────────────────────
const PENDIENTE = 'propuesta_pendiente_de_autorizacion';

/** Esqueleto de estructura de un sitio de nicho a partir de NUESTRAS categorías y fichas y de los huecos del 09. NO crea nada. FUERA DE LA FICHA. PURO. */
export function proponerEstructuraSitio({ motor, nicho, fuentes = {}, informes = {} }) {
  exigir(motor);
  const cats = (fuentes.categorias || []).filter((c) => c.id === nicho.categoria || c.parentId === nicho.categoria);
  const prods = (fuentes.productos || []).filter((p) => nicho.categoria && (p.category_id === nicho.categoria || p.subcategory_id === nicho.categoria) && Number(p.price) > 0 && p.inStock !== false);
  const huecos = (informes.competencia && informes.competencia.hallazgos || []).filter((x) => x.regla === 'hueco_detectado' && x.evidencia && x.evidencia.categoria === nicho.categoria).map((x) => x.elemento);
  return {
    tipo: 'estructura_de_sitio', fueraDeFicha: true, estado: PENDIENTE, nicho: nicho.id,
    secciones: [
      { id: 'inicio', tipo: 'portada', nota: 'Presentación del nicho y accesos a categorías y guías.' },
      ...cats.map((c) => ({ id: `categoria:${c.id}`, tipo: 'categoria', nombre: c.name, fichasDisponibles: prods.length })),
      ...huecos.map((k) => ({ id: `guia:${k}`, tipo: 'guia', origen: 'hueco_hipotetico_del_agente_09', nota: 'Hipótesis: validar antes de redactar.' })),
      ...(prods.length >= 2 ? [{ id: 'comparativas', tipo: 'comparativa', fichasDisponibles: prods.length, nota: 'Solo con fichas con precio y fecha.' }] : []),
      { id: 'afiliacion', tipo: 'pagina_legal', nota: 'Aviso de afiliación visible; el texto legal lo valida una persona.' },
      { id: 'privacidad', tipo: 'pagina_legal', nota: 'Privacidad y cookies; el texto legal lo redacta y valida una persona.' },
    ],
    noIncluye: ['nombre ni dominio del sitio', 'tecnología ni alojamiento', 'diseño visual', 'contenido redactado'],
    pendientes: ['Requiere autorización: la ficha del Agente 11 no incluye proponer estructuras de sitios.', 'Crear la web, comprar el dominio o contratar alojamiento es L4 humano.'],
  };
}

/** Estrategia de contenido del nicho: piezas a redactar derivadas de huecos del 09, de nuestras fichas y de la estacionalidad del calendario del 07. NO redacta ni publica. FUERA DE LA FICHA. PURO. */
export function proponerEstrategiaContenido({ motor, nicho, fuentes = {}, informes = {}, ahora = Date.now(), umbrales = {} }) {
  const m = exigir(motor);
  const u = { ...UMBRALES, ...umbrales };
  const prods = (fuentes.productos || []).filter((p) => nicho.categoria && (p.category_id === nicho.categoria || p.subcategory_id === nicho.categoria) && Number(p.price) > 0 && p.inStock !== false).sort((a, b) => a.id.localeCompare(b.id));
  const cat = (fuentes.categorias || []).find((c) => c.id === nicho.categoria);
  const palabras = new Set([...(nicho.palabrasClave || []), ...(cat ? [cat.name, ...(cat.keywords || [])] : [])].map(fold));
  const estacionales = momentosEnHorizonte(m.marketing, ahora, u.horizonteDias).filter((mo) => mo.keywords.some((k) => palabras.has(fold(k)))).map((mo) => ({ momento: mo.id, nombre: mo.nombre, fecha: mo.fecha, preparacionDesde: mo.alertaDesde, estado: mo.estado }));
  const huecos = (informes.competencia && informes.competencia.hallazgos || []).filter((x) => x.regla === 'hueco_detectado' && x.evidencia && x.evidencia.categoria === nicho.categoria).map((x) => x.elemento);
  return {
    tipo: 'estrategia_de_contenido', fueraDeFicha: true, estado: PENDIENTE, nicho: nicho.id,
    piezas: [
      ...huecos.map((k) => ({ tipo: 'guia', tema: k, origen: 'hueco_hipotetico_del_agente_09', producePara: 'Agentes 07 y 08 (propuesta)', nota: 'Hipótesis: validar antes.' })),
      ...prods.slice(0, 5).map((p) => ({ tipo: 'ficha', producto: p.id, producePara: '08.proponer-borrador-ficha' })),
      ...estacionales.map((e) => ({ tipo: 'campana_estacional', ...e, producePara: '07.proponer-plan-campanas' })),
    ],
    noIncluye: ['textos redactados', 'calendario con fechas propias inventadas', 'volumen de tráfico esperado', 'ingresos esperados'],
    pendientes: ['Requiere autorización: la ficha del Agente 11 no incluye proponer estrategias de contenido.', 'Publicar contenido o activar campañas es L4 humano.'],
  };
}
