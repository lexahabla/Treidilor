/**
 * Agente 07 · MARKETING MULTICANAL Y SEO (ficha `automation/agents/07-marketing-seo.md`; riesgo medio; «nada se publica sin aprobación»; honestidad: «cumplir normas de
 * afiliación y publicidad; sin afirmaciones no demostrables»). COMPONENTES PUROS del agente: planificación de campañas, briefs, revisión de textos publicitarios y auditoría SEO
 * de contenido. NO están registrados como capacidades (el registro no define ninguna para el 07: ver `propuesta-capacidades-07.json`, NO aprobada) y por tanto el Director aún
 * no los invoca. No publican, no envían mensajes, no invierten en publicidad, no modifican contenido real y no tocan datos: reciben las fuentes por parámetro (fixtures
 * sintéticos en las pruebas) y devuelven informes `informe-agente/1` y artefactos de borrador.
 * Reutilizan lo que YA existe: `marketingCalendar` (momentos comerciales, antelación, canales, ángulos de copy y checklist), `commercialClaims` (descuento VERIFICADO, fecha de
 * captura y de verificación), `publicClaims.claimProblem` (reglas R1–R6 contra afirmaciones no respaldadas), `categories.DEFAULT_CATEGORIES` (palabras clave de categoría) y los
 * informes de los Agentes 05, 06 y 10 (solo ids y la naturaleza de sus datos). No se reutiliza `marketingInsights.getCampanaCatalogo` porque lee el catálogo REAL de disco; se
 * aplica la misma regla de coincidencia (nombre o palabras clave de la categoría ∩ palabras clave del momento) sobre las fuentes aportadas.
 * Nunca se inventa: sin datos de gasto no hay «coste por visita»; sin analítica no hay «tráfico cualificado»; sin fecha de captura no se afirma un precio.
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';

/** Umbrales iniciales CONFIGURABLES (convenciones habituales de SEO, no reglas de ningún buscador). */
export const UMBRALES = Object.freeze({ horizonteDias: 75, maxCandidatosPorCampana: 5, titulo: { min: 30, max: 65 }, descripcion: { min: 70 }, minProductosCategoria: 3 });
const DIA = 86400000;

/** Carga las funciones existentes de marketing (requiere el cargador de TypeScript del proyecto). */
export async function cargarMotorMarketing() {
  if (!process.env.TRADYLOR_DATA_DIR) process.env.TRADYLOR_DATA_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/tai-marketing-sin-datos`; // nunca datos reales
  const base = new URL('../../../../src/lib/', import.meta.url);
  try {
    const [calendar, claims, publicClaims, categories] = await Promise.all(['marketingCalendar.ts', 'commercialClaims.ts', 'publicClaims.ts', 'categories.ts'].map((f) => import(new URL(f, base).href)));
    return { calendar, claims, publicClaims, categories };
  } catch (e) {
    throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de marketing no están disponibles (hace falta el cargador de TypeScript del proyecto).', { causa: String(e && e.code ? e.code : 'import') });
  }
}
const exigir = (m) => { if (!m || !m.calendar || !m.claims || !m.publicClaims || !m.categories) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de marketing no están cargadas.'); return m; };
const h = (clave, regla, elemento, evidencia, { certeza = null, prioridad = null, accion = null } = {}) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida: accion });
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA);
const sumar = (f, n) => iso(Date.parse(`${f}T00:00:00Z`) + n * DIA);
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const PRIORIDAD = { alta: 'P2', media: 'P3', baja: 'P4' };

/** Momentos comerciales que caen en el horizonte, con su estado calculado respecto a `ahora` (no al reloj del sistema). */
export function momentosEnHorizonte(motor, ahora, horizonteDias = UMBRALES.horizonteDias) {
  const m = exigir(motor);
  const hoy = iso(ahora);
  const y = new Date(ahora).getUTCFullYear();
  const todos = [...m.calendar.getMomentosComerciales(y), ...m.calendar.getMomentosComerciales(y + 1)];
  const vistos = new Set();
  const out = [];
  for (const x of todos) {
    const k = `${x.id}:${x.fecha}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (x.fin < hoy) continue;
    if (dias(hoy, x.alertaDesde) > horizonteDias) continue;
    const estado = hoy >= x.fecha && hoy <= x.fin ? 'en_curso' : hoy >= x.alertaDesde ? 'preparacion' : 'programada';
    out.push({ ...x, estado, diasHasta: dias(hoy, x.fecha), diasParaPreparar: dias(hoy, x.alertaDesde) });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
}

/** ¿La categoría encaja en el momento? Misma regla que `getCampanaCatalogo`: nombre o palabra clave de la categoría dentro de las palabras clave del momento. */
const encaja = (momento, categoria) => { const set = new Set(momento.keywords.map(fold)); return set.has(fold(categoria.name)) || (categoria.keywords || []).some((k) => set.has(fold(k))); };

const idsDeInformes = (informes) => {
  const precios = new Set(); const potencial = new Set(); const revisar = new Set(); const usados = [];
  for (const inf of informes || []) {
    if (!inf) continue;
    if (inf.agente === '05' && Array.isArray(inf.hallazgos)) {
      usados.push({ agente: '05', idEjecucion: inf.idEjecucion, origenDatos: inf.fuente && inf.fuente.origenDatos });
      for (const x of inf.hallazgos) if (['oportunidad_ahorro', 'descuento_verificado', 'caida_verificada'].includes(x.regla) && x.certeza === 'confirmado' && x.elemento) precios.add(x.elemento);
    } else if (inf.agente === '10' && Array.isArray(inf.hallazgos)) {
      usados.push({ agente: '10', idEjecucion: inf.idEjecucion, origenDatos: inf.fuente && inf.fuente.origenDatos });
      for (const x of inf.hallazgos) { if (x.regla === 'producto_alta_salida_poco_trafico') potencial.add(x.elemento); if (x.regla === 'producto_alto_trafico_baja_salida') revisar.add(x.elemento); }
    }
  }
  return { precios, potencial, revisar, usados };
};

const elegible = (p) => p && p.id && Number(p.price) > 0 && p.inStock !== false && Boolean(p.image) && p.title;

function candidatos(m, momento, fuentes, senales, u) {
  const cats = (fuentes.categorias || []).filter((c) => encaja(momento, c));
  const idsCat = new Set(cats.flatMap((c) => [c.id, ...(fuentes.categorias || []).filter((x) => x.parentId === c.id).map((x) => x.id)]));
  const retiradas = new Set(fuentes.retiradas || []);
  const lista = [];
  for (const p of fuentes.productos || []) {
    if (!elegible(p) || retiradas.has(p.id)) continue;
    if (!(idsCat.has(p.category_id) || idsCat.has(p.subcategory_id))) continue;
    const d = m.claims.shownDiscount(p);
    const captura = m.claims.captureDateOf(p);
    const verificado = m.claims.verifiedAtOf(p);
    const señales = [];
    if (senales.precios.has(p.id)) señales.push('informe_05_precio_confirmado');
    if (senales.potencial.has(p.id)) señales.push('informe_10_alta_salida_poco_trafico');
    lista.push({ producto: p.id, titulo: p.title, precio: Number(p.price), moneda: 'EUR', fechaCapturaPrecio: captura, verificadoEn: verificado, descuentoVerificado: d ? { porcentaje: d.pct, precioAnterior: d.previousPrice, lecturaDel: d.asOf } : null, señales, avisos: [...(captura ? [] : ['sin_fecha_de_captura_del_precio']), ...(senales.revisar.has && senales.revisar.has(p.id) ? ['informe_10_alto_trafico_baja_salida: revisar la ficha antes de promocionar'] : [])] });
  }
  lista.sort((a, b) => (b.descuentoVerificado ? b.descuentoVerificado.porcentaje : 0) - (a.descuentoVerificado ? a.descuentoVerificado.porcentaje : 0) || b.señales.length - a.señales.length || a.producto.localeCompare(b.producto));
  return { categorias: cats.map((c) => ({ id: c.id, nombre: c.name })), candidatos: lista.slice(0, u.maxCandidatosPorCampana), totalElegibles: lista.length };
}

/**
 * Plan de campañas PROPUESTO para los momentos comerciales del horizonte. PURO. `fuentes` = { productos, categorias, retiradas? }; `informes` = informes normalizados de los
 * Agentes 05 y 10 (opcionales). Devuelve { informe, campanas } donde `campanas` son los borradores de campaña (ninguna se publica).
 */
export function planificarCampanas({ motor, fuentes, informes = [], ahora = Date.now(), sintetico = true, capacidad = '07.proponer-plan-campanas', umbrales = {} }) {
  const m = exigir(motor);
  const u = { ...UMBRALES, ...umbrales };
  const momentos = momentosEnHorizonte(m, ahora, u.horizonteDias);
  const senales = idsDeInformes(informes);
  const H = [];
  const campanas = [];
  const suposiciones = [
    'Las campañas salen del calendario comercial existente (fechas, antelación, canales, ángulos y checklist); el agente no inventa fechas ni canales.',
    'Un producto solo es candidato si tiene precio, imagen y no consta agotado; el orden usa el descuento VERIFICADO y las señales de los informes 05 y 10, con desempate por id.',
    'Un precio solo se cita con su fecha de captura; sin ella el candidato lo declara.',
  ];
  suposiciones.forEach((t, i) => H.push(h(`suposicion:${i + 1}`, 'suposicion', null, { texto: t })));
  for (const mo of momentos) {
    const c = candidatos(m, mo, fuentes, senales, u);
    const canales = mo.canales.map((x) => ({ id: x.id, etiqueta: x.etiqueta, peso: x.peso, accionHumana: ['email', 'social', 'afiliados'].includes(x.id) ? 'publicar_o_enviar_es_L4' : x.id === 'editorial' ? 'publicar_contenido_es_L4' : 'cambio_de_catalogo_es_L4' }));
    const campana = { id: mo.id, nombre: mo.nombre, tipo: mo.tipo, prioridad: mo.prioridad, estado: mo.estado, fecha: mo.fecha, fin: mo.fin, preparacionDesde: mo.alertaDesde, diasHasta: mo.diasHasta, accionComercial: mo.accion, canales, categorias: c.categorias, candidatos: c.candidatos, totalElegibles: c.totalElegibles, preparacion: mo.preparacion, angulos: mo.copy };
    campanas.push(campana);
    H.push(h(`campana:${mo.id}`, 'campana_propuesta', mo.id, { nombre: mo.nombre, estado: mo.estado, fecha: mo.fecha, fin: mo.fin, preparacionDesde: mo.alertaDesde, diasHasta: mo.diasHasta, categorias: c.categorias.map((x) => x.id), candidatos: c.candidatos.length, totalElegibles: c.totalElegibles, canales: canales.map((x) => x.id) }, { certeza: 'confirmado', prioridad: PRIORIDAD[mo.prioridad] ?? 'P4', accion: mo.estado === 'preparacion' || mo.estado === 'en_curso' ? 'Ventana de preparación abierta: revisar el brief y decidir.' : 'Aún no toca preparar.' }));
    if (!c.categorias.length) H.push(h(`campana:${mo.id}:sin_categorias`, 'campana_sin_categorias', mo.id, { palabrasClave: mo.keywords.length }, { certeza: 'advertencia', prioridad: 'P3', accion: 'Ninguna categoría del catálogo encaja con la campaña: no hay nada que promocionar con datos propios.' }));
    else if (!c.candidatos.length) H.push(h(`campana:${mo.id}:sin_candidatos`, 'campana_sin_candidatos', mo.id, { categorias: c.categorias.map((x) => x.id) }, { certeza: 'advertencia', prioridad: 'P3', accion: 'Hay categorías pero ningún producto elegible (precio, imagen y sin agotar).' }));
    for (const p of c.candidatos) H.push(h(`campana:${mo.id}:producto:${p.producto}`, 'candidato_producto', p.producto, { campana: mo.id, ...p }, { certeza: 'confirmado', prioridad: 'P4', accion: p.fechaCapturaPrecio ? null : 'No citar el precio: no consta su fecha de captura.' }));
  }
  H.push(h('no_disponible', 'datos_no_disponibles', null, { metricas: [
    { metrica: 'coste_por_visita', motivo: 'no hay datos de gasto publicitario ni de coste por canal' },
    { metrica: 'trafico_cualificado_por_campana', motivo: senales.usados.some((x) => x.agente === '10') ? 'el informe del Agente 10 no separa el tráfico por campaña' : 'no se aportó informe de analítica (Agente 10)' },
    { metrica: 'consentimiento_para_email', motivo: 'no constan en estos datos las bases de consentimiento ni de baja; no se propone ningún envío' },
    { metrica: 'ventas_o_comisiones_atribuidas', motivo: 'ninguna fuente disponible las verifica' },
  ] }, { certeza: 'no_verificable', prioridad: 'P4' }));
  const sinInformes = ['05', '10'].filter((a) => !senales.usados.some((x) => x.agente === a));
  const limitaciones = [
    'Es una PROPUESTA de borradores: no se publica, no se envía ningún mensaje, no se invierte en publicidad y no se modifica contenido real; todo eso es L4 humano.',
    'No hay datos de gasto, coste por visita ni ventas atribuidas: no se calcula ningún retorno ni se promete un resultado.',
    'No se consultan fuentes externas (sin red, sin créditos).',
  ];
  if (sinInformes.length) limitaciones.push(`No se aportó informe de los Agentes ${sinInformes.join(' ni ')}: el orden de candidatos no usa sus señales.`);
  if (senales.usados.some((x) => x.origenDatos === 'datos_de_prueba')) limitaciones.push('Los informes de otros agentes aportados son de DATOS DE PRUEBA.');
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: catálogo, categorías y señales sintéticos; no reflejan la producción.');
  const afectadas = campanas.filter((c) => !c.candidatos.length).length;
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '07', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `mk-${createHash('sha256').update(canonico({ f: iso(ahora), campanas: campanas.map((c) => [c.id, c.candidatos.map((p) => p.producto)]), s: [...senales.precios, ...senales.potencial].sort() })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: campanas.length > 0 && afectadas === 0,
    fuente: { sistema: 'marketing_existente', tabla: 'calendario_y_catalogo_de_referencia', host: null, registrosLeidos: (fuentes.productos || []).length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico({ p: (fuentes.productos || []).map((p) => [p.id, p.price, p.inStock]), c: (fuentes.categorias || []).map((c) => c.id) })) },
    resumen: { estadoCalidad: campanas.length && !afectadas ? 'completa' : 'incompleta', incidencias: H.filter((x) => x.certeza === 'advertencia').length, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: afectadas, elementosTotales: campanas.length, campanas: campanas.length, campanasEnPreparacion: campanas.filter((c) => ['preparacion', 'en_curso'].includes(c.estado)).length, candidatosTotales: campanas.reduce((s, c) => s + c.candidatos.length, 0), horizonteDias: u.horizonteDias },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe, campanas, senales: { usados: senales.usados } };
}

// ── revisión de textos publicitarios (cumplimiento y afirmaciones demostrables) ───────────────────────────────────────────────────────────────────────────
const ABSOLUTAS = /\b(el|la|lo)\s+(mejor|peor|m[aá]s barat[oa]|m[aá]s econ[oó]mic[oa])\b|\bel n[uú]mero (1|uno)\b|\bgarantizad[oa]s?\b|\b100\s?%\b|\bsin riesgo\b|\bmejor precio\b|\bprecio m[ií]nimo\b|\bunico\b|\búnico\b/i;
const URGENCIA = /\b(solo hoy|s[oó]lo hoy|[uú]ltimas? unidades|date prisa|corre\b|[uú]ltima oportunidad|se agota|oferta limitada|solo quedan|s[oó]lo quedan|hasta fin de existencias)\b/i;
const DIVULGACION = /enlaces? de afiliad|comisi[oó]n (sin coste|por las compras|si compras)|programas? de afiliaci[oó]n/i;
const CIFRA_INTERNA = /(comisi[oó]n|epn|cpa)[^.]{0,40}\d+(?:[.,]\d+)?\s*(%|€|eur)|\d+(?:[.,]\d+)?\s*(%|€|eur)[^.]{0,20}(de )?(comisi[oó]n|epn|cpa)/i;
const PRECIO = /\d[\d.,]*\s?(€|eur)/i;
const FECHA = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\bprecio del\b|\bleído el\b|\bverificado el\b/i;

/** Revisa un texto publicitario. Devuelve { ok, problemas:[{regla, fragmento, accion}] }. PURO. `productos` aporta la evidencia (títulos y especificaciones) para las reglas de rendimiento. */
export function revisarTextoPublicitario({ motor, texto, productos = [], conEnlaces = false }) {
  const m = exigir(motor);
  const evidencia = productos.map((p) => `${p.title ?? ''} ${p.brand ?? ''} ${Object.entries(p.specs || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`).join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const problemas = [];
  const verificados = new Set(productos.map((p) => m.claims.shownDiscount(p)).filter(Boolean).map((d) => d.pct));
  const frases = String(texto ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
  const anotar = (regla, fragmento, accion) => problemas.push({ regla, fragmento: String(fragmento).slice(0, 100), accion });
  for (const f of frases) {
    const r = m.publicClaims.claimProblem(f, evidencia, { checkPerformance: true });
    const pcts = [...f.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((x) => Math.round(Number(x[1].replace(',', '.'))));
    const descuentoVerificado = r === 'descuento_no_verificado' && /verificad/i.test(f) && pcts.length > 0 && pcts.every((x) => verificados.has(x));
    if (descuentoVerificado) { /* descuento VERIFICADO de la ficha (`shownDiscount`): sí se puede citar, con su fecha */ } else if (r === 'dato_interno' && DIVULGACION.test(f) && !CIFRA_INTERNA.test(f)) { /* la divulgación de afiliación es obligatoria: no es un dato interno */ } else if (r) anotar(r, f, 'Eliminar o sustituir por un dato verificable de la ficha.');
    if (CIFRA_INTERNA.test(f)) anotar('cifra_interna_de_comision', f, 'No publicar importes ni porcentajes de comisión.');
    if (ABSOLUTAS.test(f)) anotar('afirmacion_absoluta_no_demostrable', f, 'Quitar superlativos y garantías que no se puedan demostrar con datos de la ficha.');
    if (URGENCIA.test(f)) anotar('urgencia_no_demostrable', f, 'No afirmar escasez ni urgencia sin dato verificable de stock o de fin de oferta.');
  }
  if (PRECIO.test(texto) && !FECHA.test(texto)) anotar('precio_sin_fecha', String(texto).match(PRECIO)[0], 'Citar el precio con la fecha de captura («precio del dd/mm/aaaa»).');
  if (conEnlaces && !DIVULGACION.test(texto)) anotar('falta_divulgacion_afiliacion', 'texto con enlaces', 'Añadir una divulgación visible de que hay enlaces de afiliado.');
  return { ok: problemas.length === 0, problemas };
}

/** Brief de una campaña (borrador NO publicado): ángulos evaluados, mensajes factuales, cumplimiento, calendario de acciones y medición. PURO. */
export function redactarBrief({ motor, campana, fuentes, ahora = Date.now() }) {
  const m = exigir(motor);
  const prods = (campana.candidatos || []).map((c) => (fuentes.productos || []).find((p) => p.id === c.producto)).filter(Boolean);
  const evidencia = prods.map((p) => p.title).join(' ');
  const angulos = (campana.angulos || []).map((a) => { const r = m.publicClaims.claimProblem(a, fold(evidencia), {}) || (ABSOLUTAS.test(a) ? 'afirmacion_absoluta_no_demostrable' : URGENCIA.test(a) ? 'urgencia_no_demostrable' : null); return { texto: a, utilizable: !r, motivo: r }; });
  const fmt = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const fechaEs = (d) => { const [y, mo, da] = String(d).slice(0, 10).split('-'); return `${da}/${mo}/${y}`; };
  const mensajes = (campana.candidatos || []).map((c) => {
    if (!c.fechaCapturaPrecio) return { producto: c.producto, texto: null, motivo: 'No consta la fecha de captura del precio: no se redacta ningún mensaje con precio.' };
    const dto = c.descuentoVerificado ? ` Descuento verificado del ${c.descuentoVerificado.porcentaje} % (antes ${fmt(c.descuentoVerificado.precioAnterior)}, lectura del ${fechaEs(c.descuentoVerificado.lecturaDel)}).` : '';
    return { producto: c.producto, texto: `${c.titulo}: ${fmt(c.precio)} (precio del ${fechaEs(c.fechaCapturaPrecio)}).${dto}`, motivo: null };
  });
  const textoTodo = mensajes.filter((x) => x.texto).map((x) => x.texto).join(' ');
  const revision = revisarTextoPublicitario({ motor: m, texto: textoTodo, productos: prods, conEnlaces: false });
  const n = (campana.preparacion || []).length;
  const lead = Math.max(1, dias(campana.preparacionDesde, campana.fecha));
  const acciones = (campana.preparacion || []).map((t, i) => ({ fecha: sumar(campana.preparacionDesde, Math.floor(((i + 1) * lead) / (n + 1))), accion: t, tipo: 'preparacion' }));
  for (const c of campana.canales || []) acciones.push({ fecha: campana.fecha, accion: `Canal «${c.etiqueta}» (peso ${c.peso}): ${c.accionHumana === 'publicar_o_enviar_es_L4' ? 'publicar o enviar lo decide y hace una persona (L4)' : c.accionHumana === 'publicar_contenido_es_L4' ? 'publicar el contenido lo decide y hace una persona (L4)' : 'cambiar el catálogo es una acción humana (L4)'}`, tipo: 'decision_humana' });
  acciones.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.accion.localeCompare(b.accion));
  return {
    esquema: 'brief-campana/1', estado: 'borrador_no_publicado', requiereAprobacion: true, campana: { id: campana.id, nombre: campana.nombre, fecha: campana.fecha, fin: campana.fin, estado: campana.estado },
    objetivo: 'Dirigir tráfico cualificado a las fichas del catálogo; la métrica es el clic de salida a tienda por sesión (Agente 10). No se promete ningún resultado numérico.',
    audiencia: { descripcion: `Visitantes interesados en: ${(campana.categorias || []).map((c) => c.nombre).join(', ') || 'sin categorías que encajen'}.`, datosPersonales: false },
    angulos, mensajes, revisionDeMensajes: revision,
    cumplimiento: [
      'Divulgar de forma visible que hay enlaces de afiliado (texto a validar por el propietario).',
      'Citar precios solo con su fecha de captura; descuentos solo si están verificados.',
      'No usar superlativos, garantías ni urgencia que no se puedan demostrar; no inventar reseñas ni valoraciones.',
      'Email: exige base de consentimiento y baja (RGPD/LSSI); no constan en estos datos, así que no se propone ningún envío.',
      'Redes: respetar las normas de cada plataforma sobre contenido afiliado (no verificadas aquí).',
    ],
    calendarioAcciones: acciones,
    medicion: { principal: 'clic de salida a tienda por sesión (informe del Agente 10)', costePorVisita: 'no disponible: no hay datos de gasto', trafico: 'tráfico por campaña: no disponible salvo que se etiquete (UTM sin datos personales)' },
    noHace: ['publicar', 'enviar mensajes', 'invertir en publicidad', 'modificar contenido real'],
    generadoEn: new Date(ahora).toISOString(),
  };
}

// ── auditoría SEO del contenido aportado ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Auditoría SEO de CONTENIDO de fichas y categorías aportadas (no rastrea la web: eso lo hace el Agente 12). Devuelve { informe }. PURO. */
export function auditarSEO({ motor, fuentes, ahora = Date.now(), sintetico = true, capacidad = '07.auditar-seo-contenido', umbrales = {} }) {
  const m = exigir(motor);
  const u = { ...UMBRALES, ...umbrales, titulo: { ...UMBRALES.titulo, ...(umbrales.titulo || {}) }, descripcion: { ...UMBRALES.descripcion, ...(umbrales.descripcion || {}) } };
  const retiradas = new Set(fuentes.retiradas || []);
  const prods = (fuentes.productos || []).filter((p) => p && p.id && !retiradas.has(p.id));
  const H = [];
  const porTitulo = new Map();
  const porDesc = new Map();
  for (const p of prods) { const t = fold(p.title); if (t) porTitulo.set(t, [...(porTitulo.get(t) || []), p.id]); const d = fold(p.description); if (d.length > 20) porDesc.set(d, [...(porDesc.get(d) || []), p.id]); }
  const add = (id, regla, evidencia, accion, certeza = 'confirmado', prioridad = 'P3') => H.push(h(`producto:${id}:${regla}`, regla, id, evidencia, { certeza, prioridad, accion }));
  for (const p of prods) {
    const t = String(p.title ?? '').trim();
    if (!t) add(p.id, 'seo_sin_titulo', {}, 'La ficha no tiene título.', 'confirmado', 'P2');
    else if (t.length > u.titulo.max) add(p.id, 'seo_titulo_largo', { longitud: t.length, maximo: u.titulo.max }, 'Acortar el título: se suele truncar en los resultados (convención configurable).');
    else if (t.length < u.titulo.min) add(p.id, 'seo_titulo_corto', { longitud: t.length, minimo: u.titulo.min }, 'Ampliar el título con marca, modelo y característica clave.');
    const d = String(p.description ?? '').trim();
    if (!d) add(p.id, 'seo_sin_descripcion', {}, 'Añadir una descripción propia y factual.', 'confirmado', 'P2');
    else if (d.length < u.descripcion.min) add(p.id, 'seo_descripcion_corta', { longitud: d.length, minimo: u.descripcion.min }, 'Ampliar la descripción (contenido escaso).');
    if (!p.image) add(p.id, 'seo_sin_imagen', {}, 'Sin imagen no hay vista previa ni datos estructurados completos.', 'confirmado', 'P2');
    if (!(Number(p.price) > 0)) add(p.id, 'seo_sin_precio', {}, 'Los datos estructurados de producto necesitan precio.', 'confirmado', 'P2');
    if (p.inStock === null || p.inStock === undefined) add(p.id, 'seo_disponibilidad_desconocida', {}, 'No se puede declarar disponibilidad en los datos estructurados sin dato fiable.', 'no_verificable', 'P4');
    if (!p.category_id && !p.category) add(p.id, 'seo_sin_categoria', {}, 'Asignar categoría para el enlazado interno.');
  }
  for (const [t, ids] of porTitulo) if (ids.length > 1) H.push(h(`titulo_duplicado:${ids.join('+')}`, 'seo_titulo_duplicado', ids[0], { productos: ids, titulo: t.slice(0, 80) }, { certeza: 'confirmado', prioridad: 'P3', accion: 'Diferenciar los títulos duplicados (variante, marca, modelo).' }));
  for (const [, ids] of porDesc) if (ids.length > 1) H.push(h(`descripcion_duplicada:${ids.join('+')}`, 'seo_descripcion_duplicada', ids[0], { productos: ids }, { certeza: 'confirmado', prioridad: 'P3', accion: 'Redactar descripciones distintas para cada ficha.' }));
  for (const c of fuentes.categorias || []) {
    const n = prods.filter((p) => (p.category_id === c.id || p.subcategory_id === c.id) && Number(p.price) > 0).length;
    if (n > 0 && n < u.minProductosCategoria) H.push(h(`categoria:${c.id}:fina`, 'seo_categoria_fina', c.id, { productos: n, minimo: u.minProductosCategoria }, { certeza: 'advertencia', prioridad: 'P4', accion: 'Categoría con muy pocas fichas: contenido escaso para esa página.' }));
  }
  H.push(h('no_disponible', 'datos_no_disponibles', null, { metricas: [
    { metrica: 'posiciones_impresiones_y_clics_en_buscadores', motivo: 'no hay datos de un buscador (p. ej. Search Console)' },
    { metrica: 'trafico_organico_real', motivo: 'solo lo aportaría el informe del Agente 10; no se aportó' },
    { metrica: 'estado_tecnico_de_las_paginas_publicadas', motivo: 'no se rastrea la web aquí: lo hace el Agente 12 (Auditor)' },
  ] }, { certeza: 'no_verificable', prioridad: 'P4' }));
  const problemas = H.filter((x) => x.regla.startsWith('seo_'));
  const afectados = new Set(problemas.map((x) => x.elemento)).size;
  const limitaciones = [
    'Auditoría de CONTENIDO sobre los datos aportados: no rastrea páginas ni consulta buscadores; los umbrales de longitud son convenciones configurables, no reglas de ningún buscador.',
    'No hay datos de posiciones, impresiones ni clics: no se estima ninguna mejora de tráfico.',
    'Es una propuesta: no modifica títulos, descripciones ni contenido real.',
  ];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: fichas y categorías sintéticas.');
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '07', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `sg-${createHash('sha256').update(canonico({ p: prods.map((p) => [p.id, p.title, p.description, Boolean(p.image), p.price, p.inStock ?? null]), c: (fuentes.categorias || []).map((c) => c.id), u })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: prods.length > 0,
    fuente: { sistema: 'marketing_existente', tabla: 'fichas_de_referencia', host: null, registrosLeidos: prods.length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico(prods.map((p) => [p.id, p.title, p.description ?? null]))) },
    resumen: { estadoCalidad: prods.length ? 'completa' : 'sin_datos', incidencias: problemas.length, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: afectados, elementosTotales: prods.length, problemasSeo: problemas.length },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe };
}

// ── adaptadores a informe normalizado y utilidades para el Director (sin lógica nueva de negocio) ────────────────────────────────────────────────────────
/** Elige la campaña de un plan cuyo nombre o id aparece en el texto (sin tildes). Devuelve { campana } o { motivo, disponibles } si no hay una única coincidencia. */
export function buscarCampana(campanas, texto) {
  const t = fold(texto);
  if (!t) return { motivo: 'sin_nombre', disponibles: campanas.map((c) => c.nombre) };
  const hits = campanas.filter((c) => t.includes(fold(c.nombre)) || t.includes(fold(c.id)) || fold(c.nombre).includes(t));
  if (hits.length === 1) return { campana: hits[0] };
  return { motivo: hits.length ? 'ambigua' : 'no_encontrada', disponibles: (hits.length ? hits : campanas).map((c) => c.nombre) };
}

/** Informe `informe-agente/1` de una revisión de texto publicitario (capacidad L0). El informe cita fragmentos de ≤ 100 caracteres, nunca el texto completo. */
export function revisionComoInforme({ motor, texto, fuentes = {}, conEnlaces = false, ahora = Date.now(), sintetico = true, capacidad = '07.revisar-texto-publicitario' }) {
  const r = revisarTextoPublicitario({ motor, texto, productos: fuentes.productos || [], conEnlaces });
  const H = [h('texto', 'texto_revisado', null, { caracteres: String(texto ?? '').length, conEnlaces, conforme: r.ok, problemas: r.problemas.length }, { certeza: 'confirmado', prioridad: 'P4' })];
  r.problemas.forEach((p, i) => H.push(h(`problema:${i + 1}:${p.regla}`, 'problema_texto', p.regla, { regla: p.regla, fragmento: p.fragmento }, { certeza: 'confirmado', prioridad: ['afirmacion_absoluta_no_demostrable', 'descuento_no_verificado', 'falta_divulgacion_afiliacion', 'cifra_interna_de_comision'].includes(p.regla) ? 'P2' : 'P3', accion: p.accion })));
  const limitaciones = ['Solo analiza el texto recibido con reglas de afirmaciones demostrables y de cumplimiento; no sustituye a una revisión legal.', 'No publica ni modifica nada: corregir y publicar es decisión humana (L4).'];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: las fichas usadas como evidencia son sintéticas.');
  return { informe: {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '07', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `rt-${createHash('sha256').update(canonico({ t: String(texto ?? ''), c: conEnlaces })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: true,
    fuente: { sistema: 'marketing_existente', tabla: 'texto_aportado', host: null, registrosLeidos: 1, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico(String(texto ?? ''))) },
    resumen: { estadoCalidad: r.ok ? 'completa' : 'con_problemas', incidencias: r.problemas.length, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: r.problemas.length ? 1 : 0, elementosTotales: 1, problemasTexto: r.problemas.length },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  }, revision: r };
}

/** Informe `informe-agente/1` de un brief de campaña (el brief completo viaja aparte como borrador). */
export function briefComoInforme({ brief, campana, ahora = Date.now(), sintetico = true, capacidad = '07.redactar-briefs' }) {
  const H = [h(`brief:${brief.campana.id}`, 'brief_campana', brief.campana.id, { nombre: brief.campana.nombre, estado: brief.campana.estado, fecha: brief.campana.fecha, estadoBrief: brief.estado, requiereAprobacion: brief.requiereAprobacion, mensajes: brief.mensajes.length, acciones: brief.calendarioAcciones.length }, { certeza: 'confirmado', prioridad: PRIORIDAD[campana.prioridad] ?? 'P4', accion: 'Borrador NO publicado: lo revisa y decide una persona.' })];
  for (const a of brief.angulos) H.push(h(`angulo:${fold(a.texto).slice(0, 24)}`, a.utilizable ? 'angulo_utilizable' : 'angulo_descartado', brief.campana.id, { texto: a.texto, motivo: a.motivo }, { certeza: 'confirmado', prioridad: 'P4' }));
  for (const mm of brief.mensajes) H.push(h(`mensaje:${mm.producto}`, mm.texto ? 'mensaje_redactado' : 'mensaje_no_redactado', mm.producto, { producto: mm.producto, texto: mm.texto, motivo: mm.motivo }, { certeza: mm.texto ? 'confirmado' : 'no_verificable', prioridad: 'P4', accion: mm.texto ? null : mm.motivo }));
  for (const p of brief.revisionDeMensajes.problemas) H.push(h(`revision:${p.regla}`, 'problema_texto', p.regla, { regla: p.regla, fragmento: p.fragmento }, { certeza: 'confirmado', prioridad: 'P2', accion: p.accion }));
  for (const [i, c] of brief.cumplimiento.entries()) H.push(h(`cumplimiento:${i + 1}`, 'requisito_de_cumplimiento', brief.campana.id, { texto: c }, { certeza: 'confirmado', prioridad: 'P3' }));
  H.push(h('no_disponible', 'datos_no_disponibles', null, { metricas: [{ metrica: 'coste_por_visita', motivo: brief.medicion.costePorVisita }, { metrica: 'trafico_por_campana', motivo: brief.medicion.trafico }] }, { certeza: 'no_verificable', prioridad: 'P4' }));
  const limitaciones = ['Es un BORRADOR: no se publica, no se envía ningún mensaje, no se invierte en publicidad y no se modifica contenido real (L4 humano).', 'La divulgación de afiliación y el texto legal los valida el propietario.', 'No se promete ningún resultado numérico.'];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: catálogo y señales sintéticos.');
  const sinTexto = brief.mensajes.filter((x) => !x.texto).length;
  return { informe: {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '07', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `bf-${createHash('sha256').update(canonico({ c: brief.campana, m: brief.mensajes, a: brief.angulos })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: brief.revisionDeMensajes.ok && sinTexto === 0,
    fuente: { sistema: 'marketing_existente', tabla: 'brief_de_campana', host: null, registrosLeidos: brief.mensajes.length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico({ c: brief.campana, m: brief.mensajes })) },
    resumen: { estadoCalidad: brief.revisionDeMensajes.ok && sinTexto === 0 ? 'completa' : 'incompleta', incidencias: brief.revisionDeMensajes.problemas.length + sinTexto, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: sinTexto, elementosTotales: brief.mensajes.length, mensajes: brief.mensajes.length, mensajesSinRedactar: sinTexto, angulosUtilizables: brief.angulos.filter((a) => a.utilizable).length, problemasTexto: brief.revisionDeMensajes.problemas.length },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  } };
}
