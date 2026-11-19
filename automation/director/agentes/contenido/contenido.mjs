/**
 * Agente 08 · CONTENIDO Y RECURSOS VISUALES (ficha `automation/agents/08-contenido-visual.md`; riesgo medio; «revisión humana antes de publicar»; honestidad: «imágenes con derechos
 * claros; sin precios ni descuentos inventados»). COMPONENTES PUROS: borradores de texto para fichas, propuestas de recursos visuales, borradores de historias y de publicaciones
 * para redes a partir de un brief del Agente 07, y un informe normalizado de todo ello. NO están registrados como capacidades (el 08 no tiene ninguna aprobada: ver
 * `propuesta-capacidades-08.json`, NO aprobada). No publican, no generan imágenes ni llaman a ninguna IA (solo proponen el TEXTO de un prompt), no suben archivos, no envían nada y no
 * modifican contenido real: reciben las fuentes por parámetro y devuelven borradores en memoria.
 * Reutilizan lo que YA existe: `ai.synthesizeTitleLocally` y `ai.buildProductImagePrompt` (solo las funciones puras locales), `imageQuality.toHiResImageUrl`,
 * `homeLayout/publicSafety` (imágenes y rutas seguras), el modelo de historias del 06 (`stories.validateStories/checkStories`) con las fuentes que construye `portada.construirFuentes`,
 * `commercialClaims` y `publicClaims`, y del 07: `planificarCampanas`, `redactarBrief` y `revisarTextoPublicitario`.
 * Naturaleza de cada elemento: `real` (dato literal de una ficha NO sintética), `simulado` (dato literal de una ficha sintética), `generado` (texto compuesto por plantilla a partir de
 * datos; no es IA) y `pendiente_verificacion` (lo que una persona debe comprobar: derechos de imagen, texto legal, afirmaciones). Nada se inventa: sin datos suficientes no se redacta.
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';
import { buscarCampana, cargarMotorMarketing, planificarCampanas, redactarBrief, revisarTextoPublicitario } from '../marketing/marketing.mjs';
import { cargarMotorPortada, construirFuentes as construirFuentesPortada } from '../portada/portada.mjs';

export const UMBRALES = Object.freeze({ maxSpecs: 5, maxValorSpec: 60, maxPantallasHistoria: 4, maxTextoPantalla: 200, maxTituloPantalla: 80, maxPost: 280, maxSpecsPuntos: 4 });
const HOSTS_TIENDA = /(^|\.)(media-amazon\.com|images-amazon\.com|ssl-images-amazon\.com|alicdn\.com|ebayimg\.com|ebaystatic\.com|temu\.com|kwcdn\.com)$/i;
const DIVULGACION = 'Contiene enlaces de afiliado: podemos recibir una comisión sin coste para ti.';

/** Carga las funciones existentes de contenido (requiere el cargador de TypeScript del proyecto). */
export async function cargarMotorContenido() {
  if (!process.env.TRADYLOR_DATA_DIR) process.env.TRADYLOR_DATA_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/tai-contenido-sin-datos`; // nunca datos reales
  const base = new URL('../../../../src/lib/', import.meta.url);
  try {
    const [ai, imagenes, seguridad, historias] = await Promise.all(['ai.ts', 'imageQuality.ts', 'homeLayout/publicSafety.ts', 'homeLayout/stories.ts'].map((f) => import(new URL(f, base).href)));
    const marketing = await cargarMotorMarketing();
    const portada = await cargarMotorPortada();
    return { ai, imagenes, seguridad, historias, marketing, portada };
  } catch (e) {
    if (e instanceof ErrorProtocolo) throw e;
    throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de contenido no están disponibles (hace falta el cargador de TypeScript del proyecto).', { causa: String(e && e.code ? e.code : 'import') });
  }
}
const exigir = (m) => { if (!m || !m.ai || !m.imagenes || !m.seguridad || !m.historias || !m.marketing || !m.portada) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de contenido no están cargadas.'); return m; };
const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const corta = (t, n) => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length <= n ? x : `${x.slice(0, n - 1).replace(/[\s,.;:–—-]+$/, '')}…`; };
const fechaEs = (d) => { const [y, m, da] = String(d).slice(0, 10).split('-'); return `${da}/${m}/${y}`; };
const eur = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const el = (campo, valor, naturaleza, extra = {}) => ({ campo, valor, naturaleza, ...extra });
const h = (clave, regla, elemento, evidencia, { certeza = null, prioridad = null, accion = null } = {}) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida: accion });

/** Naturaleza de un dato LITERAL de ficha: real si la fuente no es sintética; simulado si lo es. */
const literal = (sintetico) => (sintetico ? 'simulado' : 'real');

/** Pares «característica: valor» legibles y breves de una ficha (solo cadenas o números; nada se inventa). */
function especificaciones(p, max) {
  const out = [];
  for (const [k, v] of Object.entries(p.specs && typeof p.specs === 'object' ? p.specs : {})) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const val = String(v).trim();
    if (!val || val.length > UMBRALES.maxValorSpec) continue;
    out.push([String(k).trim(), val]);
    if (out.length >= max) break;
  }
  return out;
}

// ── 1. borrador de texto para una ficha ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Borrador de título, descripción y puntos clave de UNA ficha, solo con sus datos. Sin datos suficientes no redacta. PURO. */
export function borradorFicha({ motor, producto, sintetico = true, ahora = Date.now() }) {
  const m = exigir(motor);
  const p = producto;
  const lit = literal(sintetico);
  const elementos = [];
  const pendientes = [];
  const titulo = String(p.title ?? '').trim();
  if (!titulo) return { tipo: 'ficha', producto: p.id, estado: 'no_redactable', motivo: 'La ficha no tiene título: no se redacta nada.', elementos: [], pendientes: [], revision: { ok: true, problemas: [] }, requiereRevisionHumana: true };
  const t = m.ai.synthesizeTitleLocally(titulo);
  elementos.push(el('titulo_original', titulo, lit));
  elementos.push(el('titulo_propuesto', t, t === titulo ? lit : 'generado', { cambio: t !== titulo }));
  const specs = especificaciones(p, UMBRALES.maxSpecs);
  const frases = [];
  frases.push(`${t}${p.brand ? `, de ${p.brand}` : ''}.`);
  if (p.brand) elementos.push(el('marca', p.brand, lit));
  if (specs.length) {
    frases.push(`Características declaradas en la ficha: ${specs.map(([k, v]) => `${k}: ${v}`).join('; ')}.`);
    for (const [k, v] of specs) elementos.push(el(`caracteristica:${plano(k)}`, `${k}: ${v}`, lit));
  }
  const captura = m.marketing.claims.captureDateOf(p);
  if (Number(p.price) > 0 && captura) {
    frases.push(`Precio de ${eur(p.price)} registrado el ${fechaEs(captura)}; puede haber cambiado en la tienda.`);
    elementos.push(el('precio', Number(p.price), lit, { fechaCaptura: captura }));
    const d = m.marketing.claims.shownDiscount(p);
    if (d) { frases.push(`Descuento verificado del ${d.pct} % (antes ${eur(d.previousPrice)}, lectura del ${fechaEs(d.asOf)}).`); elementos.push(el('descuento_verificado', d.pct, lit, { lecturaDel: d.asOf })); }
  } else if (Number(p.price) > 0) pendientes.push('No consta la fecha de captura del precio: el borrador no cita ningún precio.');
  if (!specs.length && !p.brand) pendientes.push('La ficha no trae marca ni características: la descripción se limita al título; hace falta aportar datos.');
  const descripcion = frases.join(' ');
  elementos.push(el('descripcion', descripcion, 'generado', { origen: 'plantilla_local_con_datos_de_la_ficha' }));
  const puntos = specs.slice(0, UMBRALES.maxSpecsPuntos).map(([k, v]) => `${k}: ${v}`);
  if (puntos.length) elementos.push(el('puntos_clave', puntos, 'generado', { origen: 'plantilla_local_con_datos_de_la_ficha' }));
  pendientes.push('Comprobar que los datos de la ficha siguen vigentes antes de publicar.');
  const revision = revisarTextoPublicitario({ motor: m.marketing, texto: descripcion, productos: [p], conEnlaces: false });
  return { tipo: 'ficha', producto: p.id, estado: 'borrador_no_publicado', requiereRevisionHumana: true, elementos, pendientes, revision, generadoEn: new Date(ahora).toISOString() };
}

// ── 2. recursos visuales ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function clasificarImagen(m, url, sintetico) {
  const u = String(url ?? '').trim();
  if (!u) return { url: u, origen: 'ausente', seguraParaWeb: false, derechos: 'no_hay_imagen' };
  const segura = m.seguridad.isPublicSafeImage(u);
  if (u.startsWith('/images/products/')) return { url: u, origen: 'generada_ia_existente', seguraParaWeb: segura, derechos: 'propia_del_proyecto (generada con IA; revisar que no reproduzca marcas o personas)', naturaleza: 'generado' };
  let host = '';
  try { host = new URL(u).hostname; } catch { /* ruta o URL no válida */ }
  if (sintetico && /(^|\.)example\.(com|test)$/i.test(host)) return { url: u, origen: 'simulada', seguraParaWeb: segura, derechos: 'no_aplica (imagen de prueba)', naturaleza: 'simulado' };
  if (HOSTS_TIENDA.test(host)) return { url: u, urlAltaResolucion: m.imagenes.toHiResImageUrl(u) ?? null, origen: 'imagen_de_tienda', seguraParaWeb: segura, derechos: 'pendiente_de_verificacion: propiedad del comercio; su uso depende de las condiciones del programa de afiliación, no verificadas aquí', naturaleza: 'pendiente_verificacion' };
  return { url: u, origen: 'origen_desconocido', seguraParaWeb: segura, derechos: 'pendiente_de_verificacion: no consta quién tiene los derechos', naturaleza: 'pendiente_verificacion' };
}

/** Propuesta de recursos visuales de una ficha: imágenes existentes clasificadas por origen y derechos, texto alternativo, prompt PROPUESTO (sin generar) y vídeo no disponible. PURO. */
export function proponerRecursosVisuales({ motor, producto, sintetico = true }) {
  const m = exigir(motor);
  const p = producto;
  const urls = [p.image, ...(Array.isArray(p.images) ? p.images : [])].filter((u, i, a) => typeof u === 'string' && u && a.indexOf(u) === i);
  const imagenes = urls.length ? urls.map((u) => clasificarImagen(m, u, sintetico)) : [clasificarImagen(m, '', sintetico)];
  const alt = `Imagen de ${m.ai.synthesizeTitleLocally(String(p.title ?? '')) || 'producto'}`;
  const prompt = p.title ? m.ai.buildProductImagePrompt(String(p.title)) : null;
  return {
    tipo: 'recursos_visuales', producto: p.id, estado: 'propuesta_no_publicada', requiereRevisionHumana: true,
    imagenes, textoAlternativo: { valor: alt, naturaleza: 'generado' },
    promptPropuesto: prompt ? { texto: corta(prompt, 600), generada: false, naturaleza: 'generado', coste: 'no estimado: generar una imagen consume crédito de IA y exige autorización; aquí NO se genera' } : null,
    video: { estado: 'no_disponible', motivo: 'no hay fuente ni capacidad de vídeo' },
    pendientes: imagenes.filter((i) => i.naturaleza === 'pendiente_verificacion').map((i) => `Verificar los derechos de la imagen ${corta(i.url, 70)} antes de usarla.`).concat(imagenes.some((i) => i.origen === 'ausente') ? ['La ficha no tiene imagen: no se propone ninguna.'] : []),
  };
}

// ── 3. historia (modelo del Agente 06) y 4. publicación para redes, desde un brief del Agente 07 ────────────────────────────────────────────────────────────
/** Borrador de historia con el MODELO del 06 (siempre `borrador`), una pantalla por mensaje redactado del brief con imagen segura. Validado con `validateStories` y `checkStories`. PURO. */
export function borradorHistoria({ motor, brief, fuentes, sintetico = true }) {
  const m = exigir(motor);
  const por = new Map((fuentes.productos || []).map((p) => [p.id, p]));
  const pantallas = [];
  const omitidas = [];
  for (const mm of brief.mensajes) {
    const p = por.get(mm.producto);
    if (!mm.texto || !p) { omitidas.push({ producto: mm.producto, motivo: mm.texto ? 'la ficha no está en las fuentes' : mm.motivo }); continue; }
    if (!m.seguridad.isPublicSafeImage(p.image) || p.image.startsWith('http://')) { omitidas.push({ producto: mm.producto, motivo: 'la imagen no es segura o no existe' }); continue; }
    if (mm.texto.length > UMBRALES.maxTextoPantalla) { omitidas.push({ producto: mm.producto, motivo: `el mensaje verificado supera ${UMBRALES.maxTextoPantalla} caracteres y no se recorta (perdería la fecha)` }); continue; }
    if (pantallas.length >= UMBRALES.maxPantallasHistoria) { omitidas.push({ producto: mm.producto, motivo: 'se alcanzó el máximo de pantallas' }); continue; }
    pantallas.push({ id: `${brief.campana.id}-${pantallas.length + 1}`, image: p.image, title: corta(p.title, UMBRALES.maxTituloPantalla), text: mm.texto, buttonLabel: 'Ver producto', link: { type: 'product', target: p.id }, duration: 7 });
  }
  if (!pantallas.length) return { tipo: 'historia', estado: 'no_redactable', motivo: 'Ningún mensaje del brief tiene texto verificado e imagen segura: no se redacta historia.', omitidas, pantallas: [], revision: { ok: true, problemas: [] }, incidencias: [], requiereRevisionHumana: true };
  const historia = { id: `campana-${plano(brief.campana.id)}`.slice(0, 40), name: corta(`Campaña ${brief.campana.nombre}`, 60), status: 'borrador', screens: pantallas };
  const valida = m.historias.validateStories([historia]);
  const datos = { productos: fuentes.productos || [], categorias: fuentes.categorias || [], retiradas: fuentes.retiradas || [] };
  const src = construirFuentesPortada(m.portada, datos);
  const incidencias = valida.ok ? m.historias.checkStories(valida.value, src).filter((x) => x.severity !== 'info').map((x) => ({ severidad: x.severity, codigo: x.code, mensaje: x.message })) : [];
  const revision = revisarTextoPublicitario({ motor: m.marketing, texto: pantallas.map((x) => x.text).join(' '), productos: fuentes.productos || [], conEnlaces: false });
  return { tipo: 'historia', estado: valida.ok ? 'borrador_no_publicado' : 'invalida', requiereRevisionHumana: true, historia: valida.ok ? valida.value[0] : historia, erroresDeModelo: valida.ok ? [] : valida.errors.slice(0, 5), incidencias, omitidas, revision, naturaleza: sintetico ? 'simulado' : 'real', pendientes: ['Las imágenes de las pantallas son de tienda o de prueba: verificar derechos antes de publicar.', 'Una historia publicada la decide una persona (L4); aquí queda como borrador interno.'] };
}

/** Publicaciones para redes (borradores de texto) a partir de los mensajes verificados de un brief. Incluyen la divulgación de afiliación y un marcador de enlace pendiente (nunca un enlace real). PURO. */
export function borradorPostsRedes({ motor, brief, fuentes }) {
  const m = exigir(motor);
  const posts = [];
  const omitidos = [];
  for (const mm of brief.mensajes) {
    if (!mm.texto) { omitidos.push({ producto: mm.producto, motivo: mm.motivo }); continue; }
    const base = `${mm.texto} [enlace pendiente]`;
    const texto = `${base} ${DIVULGACION}`;
    if (texto.length > UMBRALES.maxPost) { omitidos.push({ producto: mm.producto, motivo: `con la divulgación supera ${UMBRALES.maxPost} caracteres` }); continue; }
    const revision = revisarTextoPublicitario({ motor: m.marketing, texto, productos: fuentes.productos || [], conEnlaces: true });
    posts.push({ producto: mm.producto, texto, caracteres: texto.length, revision, naturaleza: 'generado', canal: 'sin_asignar' });
  }
  return { tipo: 'posts_redes', estado: posts.length ? 'borrador_no_publicado' : 'no_redactable', requiereRevisionHumana: true, posts, omitidos, pendientes: ['Publicar en una red es decisión y acción humana (L4).', 'El texto de divulgación de afiliación debe validarlo el propietario.', 'Cada red tiene normas propias sobre contenido afiliado: no verificadas aquí.'] };
}

// ── 5. revisión de una pieza y paquete de contenido de una campaña ────────────────────────────────────────────────────────────────────────────────────────
/** Revisión de cualquier pieza propuesta: problemas de texto (reglas del 07), imágenes sin derechos verificados o no seguras y huecos. */
export function revisarPieza(pieza) {
  const problemas = [];
  const revs = [];
  if (pieza.revision) revs.push(pieza.revision);
  for (const p of pieza.posts || []) revs.push(p.revision);
  for (const r of revs) for (const x of r.problemas) problemas.push({ tipo: 'texto', regla: x.regla, fragmento: x.fragmento, accion: x.accion });
  for (const i of pieza.imagenes || []) {
    if (i.origen === 'ausente') problemas.push({ tipo: 'imagen', regla: 'sin_imagen', fragmento: '', accion: 'Aportar una imagen con derechos claros.' });
    else if (!i.seguraParaWeb) problemas.push({ tipo: 'imagen', regla: 'imagen_no_segura', fragmento: corta(i.url, 80), accion: 'No usar: la URL no es pública y segura.' });
    if (i.naturaleza === 'pendiente_verificacion') problemas.push({ tipo: 'imagen', regla: 'derechos_pendientes_de_verificar', fragmento: corta(i.url, 80), accion: 'Verificar derechos de uso antes de publicar.' });
  }
  for (const i of pieza.incidencias || []) if (i.severidad === 'error') problemas.push({ tipo: 'historia', regla: i.codigo, fragmento: '', accion: i.mensaje });
  return { ok: problemas.length === 0, problemas };
}

/** Informe `informe-agente/1` del Agente 08 sobre un conjunto de piezas propuestas. PURO. La métrica «aprobadas / generadas» se declara no disponible (no hay registro de aprobaciones). */
export function informeContenido({ piezas, ahora = Date.now(), sintetico = true, capacidad = '08.proponer-contenido' }) {
  const H = [];
  let conProblemas = 0; let imagenes = 0; let imagenesPendientes = 0; let noRedactables = 0;
  for (const [i, pz] of piezas.entries()) {
    const rev = revisarPieza(pz);
    if (pz.estado === 'no_redactable') noRedactables += 1;
    if (!rev.ok) conProblemas += 1;
    const id = `${pz.tipo}:${pz.producto ?? pz.historia?.id ?? i + 1}`;
    H.push(h(`pieza:${id}`, 'pieza_propuesta', id, { tipo: pz.tipo, estado: pz.estado, requiereRevisionHumana: true, naturaleza: pz.naturaleza ?? (sintetico ? 'simulado' : 'real'), elementos: (pz.elementos || []).map((e) => ({ campo: e.campo, naturaleza: e.naturaleza })), pendientes: pz.pendientes || [], omitidas: pz.omitidas || pz.omitidos || [] }, { certeza: pz.estado === 'no_redactable' ? 'no_verificable' : 'confirmado', prioridad: 'P4', accion: 'Borrador interno: lo revisa una persona antes de cualquier uso; nada se publica.' }));
    for (const x of rev.problemas) H.push(h(`pieza:${id}:${x.regla}:${H.length}`, x.tipo === 'imagen' ? (x.regla === 'derechos_pendientes_de_verificar' ? 'imagen_derechos_pendientes' : x.regla === 'imagen_no_segura' ? 'imagen_no_segura' : 'sin_imagen') : x.tipo === 'texto' ? 'problema_texto' : 'incidencia_historia', id, { regla: x.regla, fragmento: x.fragmento }, { certeza: x.regla === 'derechos_pendientes_de_verificar' ? 'no_verificable' : 'confirmado', prioridad: x.tipo === 'texto' ? 'P2' : 'P3', accion: x.accion }));
    for (const im of pz.imagenes || []) { imagenes += 1; if (im.naturaleza === 'pendiente_verificacion') imagenesPendientes += 1; }
    if (pz.promptPropuesto) H.push(h(`pieza:${id}:prompt`, 'prompt_propuesto_no_generado', id, { generada: false, coste: pz.promptPropuesto.coste }, { certeza: 'confirmado', prioridad: 'P4', accion: 'Generar la imagen exigiría crédito de IA y tu autorización.' }));
  }
  H.push(h('no_disponible', 'datos_no_disponibles', null, { metricas: [{ metrica: 'piezas_aprobadas_sobre_generadas', motivo: 'no existe registro de aprobaciones humanas de piezas' }, { metrica: 'video', motivo: 'no hay fuente ni capacidad de vídeo' }, { metrica: 'derechos_de_imagen', motivo: 'no consta licencia ni permiso de ninguna imagen: se declaran pendientes de verificar' }] }, { certeza: 'no_verificable', prioridad: 'P4' }));
  const limitaciones = [
    'Son BORRADORES internos: nada se publica en la web ni en canales externos, no se generan imágenes ni se llama a ninguna IA, no se envía nada y no se modifica contenido real (L4 humano).',
    'Los textos salen de plantillas locales con datos de la ficha (no es IA) y las reglas de afirmaciones del Agente 07; no sustituyen una revisión humana ni legal.',
    'Los derechos de las imágenes no están verificados: las de tienda y las de origen desconocido quedan pendientes.',
  ];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: fichas, imágenes y briefs sintéticos.');
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '08', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `ct-${createHash('sha256').update(canonico(piezas.map((p) => [p.tipo, p.producto ?? p.historia?.id ?? null, p.estado, (p.elementos || []).map((e) => e.valor)]))).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: piezas.length > 0 && noRedactables === 0 && conProblemas === 0,
    fuente: { sistema: 'contenido_existente', tabla: 'piezas_propuestas', host: null, registrosLeidos: piezas.length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico(piezas.map((p) => [p.tipo, p.producto ?? null, p.estado]))) },
    resumen: { estadoCalidad: piezas.length && !conProblemas && !noRedactables ? 'completa' : 'incompleta', incidencias: H.filter((x) => ['problema_texto', 'imagen_no_segura', 'sin_imagen', 'incidencia_historia'].includes(x.regla)).length, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: conProblemas + noRedactables, elementosTotales: piezas.length, piezas: piezas.length, piezasConProblemas: conProblemas, piezasNoRedactables: noRedactables, imagenes, imagenesDerechosPendientes: imagenesPendientes, piezasAprobadas: 0 },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe };
}

/**
 * Paquete de contenido de UNA campaña del plan del Agente 07: borradores de ficha y recursos de los candidatos con mensaje, historia y publicaciones para redes, más el informe.
 * Reutiliza `planificarCampanas` y `redactarBrief` del 07. PURO: no publica ni guarda nada.
 */
export function prepararContenidoCampana({ motor, fuentes, campana, informes = [], ahora = Date.now(), sintetico = true, maxFichas = 2 }) {
  const m = exigir(motor);
  const plan = planificarCampanas({ motor: m.marketing, fuentes, informes, ahora, sintetico });
  const b = buscarCampana(plan.campanas, campana);
  if (!b.campana) return { piezas: [], informe: null, motivo: b.motivo, disponibles: b.disponibles };
  const brief = redactarBrief({ motor: m.marketing, campana: b.campana, fuentes, ahora });
  const por = new Map((fuentes.productos || []).map((p) => [p.id, p]));
  const piezas = [];
  for (const c of b.campana.candidatos.slice(0, maxFichas)) {
    const p = por.get(c.producto);
    if (!p) continue;
    piezas.push(borradorFicha({ motor: m, producto: p, sintetico, ahora }));
    piezas.push(proponerRecursosVisuales({ motor: m, producto: p, sintetico }));
  }
  piezas.push(borradorHistoria({ motor: m, brief, fuentes, sintetico }));
  piezas.push(borradorPostsRedes({ motor: m, brief, fuentes }));
  const { informe } = informeContenido({ piezas, ahora, sintetico });
  return { piezas, brief, campana: b.campana, informe };
}

// ── utilidades para el Director (sin lógica nueva de negocio) ───────────────────────────────────────────────────────────────────────────────────────────
/** Elige UNA ficha por id exacto o por título que contenga el texto (sin tildes). Devuelve { producto } o { motivo, disponibles } si no hay una única coincidencia. */
export function buscarProducto(productos, texto) {
  const f = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const t = f(texto);
  if (!t) return { motivo: 'sin_nombre', disponibles: productos.slice(0, 8).map((p) => p.id) };
  const exacto = productos.filter((p) => f(p.id) === t);
  if (exacto.length === 1) return { producto: exacto[0] };
  const empieza = productos.filter((p) => f(p.title).startsWith(t));
  if (empieza.length === 1) return { producto: empieza[0] };
  const hits = productos.filter((p) => f(p.title).includes(t) || t.includes(f(p.id)));
  if (hits.length === 1) return { producto: hits[0] };
  return { motivo: hits.length ? 'ambiguo' : 'no_encontrado', disponibles: (hits.length ? hits : productos).slice(0, 8).map((p) => p.id) };
}

/** Pieza APORTADA (texto e imágenes por URL) lista para `revisarPieza`/`informeContenido`: el texto con las reglas del 07 y cada imagen clasificada por origen y derechos. PURO. */
export function piezaAportada({ motor, texto, imagenes = [], fuentes = {}, sintetico = true }) {
  const m = exigir(motor);
  const revision = revisarTextoPublicitario({ motor: m.marketing, texto: String(texto ?? ''), productos: fuentes.productos || [], conEnlaces: /https?:\/\/|www\./i.test(String(texto ?? '')) });
  return { tipo: 'pieza_aportada', estado: 'revisada', requiereRevisionHumana: true, revision, imagenes: imagenes.map((u) => clasificarImagen(m, u, sintetico)), pendientes: ['La validación de derechos de imagen y la decisión de publicar son humanas (L4).'] };
}
