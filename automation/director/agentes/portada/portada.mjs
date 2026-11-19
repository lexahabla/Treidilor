/**
 * Agente 06 · DISEÑADOR DE CATEGORÍAS, PORTADA E HISTORIAS (ficha `automation/agents/06-portada-historias.md`; riesgo medio; «nunca publica»).
 * CAPA DE PROPUESTA sobre el sistema de portada editable que YA existe (`src/lib/homeLayout/`); NO es otro editor ni otro sistema de categorías. Reutiliza:
 *   · `initialLayout.deriveInitialContext / buildInitialBlocks` — el diseño (maqueta v4) y su selección de categorías e imágenes reales;
 *   · `validate.validateBlocks / emptyDocument` y `resolve.resolveBlocks` — validación y comprobación de referencias (qué se mostraría y qué no);
 *   · `initialStories.buildInitialStories` + `stories.checkStories / prepareStoriesSave / validateStories` — historias reales y sus comprobaciones;
 *   · `draft.prepareDraftSave`, `draftBackups.protectDraft / planRestoreBackup` y `publish.diffBlocks` — guardado de borrador, copia previa, DESHACER y vista previa de cambios.
 * Capacidades (registro): `06.proponer-portada` (L1: informe + borrador propuesto, sin efectos) y `06.guardar-borrador-portada` (L3 REVERSIBLE: aquí SOLO se
 * simula, sobre un área PRIVADA del Director —nunca `home-layout.json`—, con copia previa y deshacer). Publicar y activar son L4 humano y NO existen aquí:
 * ninguna función de este módulo publica, activa, reorganiza categorías reales ni escribe en la portada o el catálogo.
 * Honestidad: lo que se propone sale de los datos disponibles; se declaran las SUPOSICIONES, los datos de prueba y las limitaciones; los textos editoriales son los
 * del generador existente (no los inventa el agente). Los módulos TypeScript se INYECTAN ya cargados (`cargarMotorPortada`).
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';

export const UMBRALES_CATEGORIAS = Object.freeze({ minProductosSinSubcategorias: 8, minProductosParaDestacar: 1 });
const plano = (x) => JSON.parse(JSON.stringify(x));

/** Carga los módulos existentes de portada (requiere el cargador de TypeScript del proyecto). */
export async function cargarMotorPortada() {
  if (!process.env.TRADYLOR_DATA_DIR) process.env.TRADYLOR_DATA_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/tai-portada-sin-datos`; // nunca datos reales
  const base = new URL('../../../../src/lib/', import.meta.url);
  const nombres = { initial: 'homeLayout/initialLayout.ts', validate: 'homeLayout/validate.ts', resolve: 'homeLayout/resolve.ts', initStories: 'homeLayout/initialStories.ts', stories: 'homeLayout/stories.ts', draft: 'homeLayout/draft.ts', backups: 'homeLayout/draftBackups.ts', publish: 'homeLayout/publish.ts', claims: 'commercialClaims.ts' };
  try {
    const mods = await Promise.all(Object.values(nombres).map((f) => import(new URL(f, base).href)));
    return Object.fromEntries(Object.keys(nombres).map((k, i) => [k, mods[i]]));
  } catch (e) {
    throw new ErrorProtocolo('origen_no_disponible', 'Los módulos existentes de portada no están disponibles (hace falta el cargador de TypeScript del proyecto).', { causa: String(e && e.code ? e.code : 'import') });
  }
}
const exigir = (m) => { if (!m || !m.initial || !m.validate || !m.resolve || !m.draft) throw new ErrorProtocolo('origen_no_disponible', 'Los módulos existentes de portada no están cargados: no se puede proponer.'); return m; };

/** Convierte los datos de referencia (JSON sintético con la forma de las fichas) en el `ReferenceSources` de solo lectura del sistema existente. */
export function construirFuentes(m, datos) {
  const productos = new Map();
  const bruto = Array.isArray(datos.productos) ? datos.productos : [];
  for (const p of bruto) {
    const d = m.claims.shownDiscount(p);
    productos.set(p.id, { id: p.id, title: p.title, price: Number(p.price) > 0 ? Number(p.price) : null, hasImage: Boolean(p.image), inStock: typeof p.inStock === 'boolean' ? p.inStock : null, network: p.network ?? '', category: p.category ?? '', linkStatus: 'ok', categoryId: p.category_id, subcategoryId: p.subcategory_id, image: p.image, addedAt: null, discountPct: d ? d.pct : null });
  }
  const categorias = new Map((datos.categorias || []).map((c) => [c.id, { id: c.id, name: c.name, slug: c.slug ?? c.id, parentId: c.parentId ?? null, icon: c.icon }]));
  const secciones = (datos.secciones || []).map((s) => ({ id: s.id, title: s.title, published: Boolean(s.published), order: s.order ?? 0, position: s.position ?? 'below', speed: s.speed ?? 'normal', productIds: s.productIds || [] }));
  const redes = new Map();
  for (const p of productos.values()) if (p.network) redes.set(p.network, (redes.get(p.network) || 0) + 1);
  return { products: productos, retiredIds: new Set(datos.retiradas || []), categories: categorias, networks: redes, sections: new Map(secciones.map((s) => [s.id, s])), sectionList: secciones, status: { products: { status: 'ok', count: productos.size }, categories: { status: 'ok', count: categorias.size, origin: 'file' }, sections: { status: 'ok', count: secciones.length, invalidEntries: 0 } } };
}

// ── organización de categorías (propuestas informativas; reorganizar categorías reales es L4 humano) ──────────────────────────────
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const STOP = new Set(['para', 'con', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'un', 'una', 'por', 'sin', 'pulgadas', 'negro', 'blanco']);

/** Analiza la estructura de categorías con los datos de referencia. Devuelve una lista de propuestas con evidencia (ninguna se aplica). */
export function analizarCategorias(fuentes) {
  const props = [];
  const cats = [...fuentes.categories.values()];
  const hijos = (id) => cats.filter((c) => c.parentId === id);
  const enCat = (c) => [...fuentes.products.values()].filter((p) => p.price !== null && (p.categoryId === c.id || (p.subcategoryId && (p.subcategoryId === c.id || p.subcategoryId === `${c.parentId}--${c.id}`))));
  const conteo = new Map(cats.map((c) => [c.id, enCat(c).length]));
  const totalRaiz = (c) => (conteo.get(c.id) || 0) + hijos(c.id).reduce((s, h) => s + (conteo.get(h.id) || 0), 0);
  for (const c of cats) {
    if (c.parentId && !fuentes.categories.has(c.parentId)) props.push({ regla: 'categoria_huerfana', categoria: c.id, evidencia: { padre: c.parentId }, texto: `La categoría «${c.name}» apunta a un padre inexistente (${c.parentId}).` });
    if (!c.parentId && totalRaiz(c) === 0) props.push({ regla: 'categoria_vacia', categoria: c.id, evidencia: { productos: 0 }, texto: `La categoría «${c.name}» no tiene productos con precio: no conviene destacarla; valorar ocultarla o fusionarla (decisión humana).` });
    if (!c.parentId && hijos(c.id).length === 0 && (conteo.get(c.id) || 0) >= UMBRALES_CATEGORIAS.minProductosSinSubcategorias) {
      const cuentas = new Map();
      for (const p of enCat(c)) for (const w of fold(p.title).split(/[^a-z0-9]+/).filter((x) => x.length >= 4 && !STOP.has(x))) cuentas.set(w, (cuentas.get(w) || 0) + 1);
      const frecuentes = [...cuentas.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([w, n]) => ({ palabra: w, productos: n }));
      props.push({ regla: 'categoria_sin_subcategorias', categoria: c.id, evidencia: { productos: conteo.get(c.id), umbral: UMBRALES_CATEGORIAS.minProductosSinSubcategorias, palabrasFrecuentesEnTitulos: frecuentes }, texto: `«${c.name}» tiene ${conteo.get(c.id)} productos y ninguna subcategoría: considerar dividirla${frecuentes.length ? ` (palabras frecuentes en los títulos: ${frecuentes.map((f) => f.palabra).join(', ')}; son una pista, no una taxonomía)` : ''}.` });
    }
    if (c.parentId && fuentes.categories.has(c.parentId) && (conteo.get(c.id) || 0) === 1) props.push({ regla: 'subcategoria_con_un_producto', categoria: c.id, evidencia: { productos: 1, padre: c.parentId }, texto: `La subcategoría «${c.name}» solo tiene 1 producto: valorar fusionarla con otra.` });
  }
  const nombres = new Map();
  for (const c of cats) nombres.set(fold(c.name), [...(nombres.get(fold(c.name)) || []), c.id]);
  for (const [n, ids] of nombres) if (ids.length > 1) props.push({ regla: 'categorias_duplicadas', categoria: ids[0], evidencia: { ids }, texto: `Hay ${ids.length} categorías con el mismo nombre normalizado («${n}»): ${ids.join(', ')}.` });
  for (const p of fuentes.products.values()) if (p.categoryId && !fuentes.categories.has(p.categoryId)) props.push({ regla: 'producto_con_categoria_invalida', categoria: null, evidencia: { producto: p.id, categoria: p.categoryId }, texto: `El producto ${p.id} referencia una categoría inexistente (${p.categoryId}).` });
  return props.sort((a, b) => a.regla.localeCompare(b.regla) || String(a.categoria).localeCompare(String(b.categoria)));
}

const h = (clave, regla, elemento, evidencia, accionSugerida = null, certeza = null, prioridad = null) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida });
const SEV = { error: 'P2', warning: 'P3', info: 'P4' };

/** Ids de producto citados por informes de los Agentes 05 (oportunidades/descuentos/bajadas verificados) que EXISTEN y son presentables en las fuentes. */
function productosDeInformes(informes, fuentes) {
  const ids = [];
  const usados = [];
  for (const inf of informes || []) {
    if (!inf || inf.agente !== '05' || !Array.isArray(inf.hallazgos)) continue;
    usados.push({ agente: '05', idEjecucion: inf.idEjecucion, origenDatos: inf.fuente && inf.fuente.origenDatos });
    for (const x of inf.hallazgos) if (['oportunidad_ahorro', 'descuento_verificado', 'caida_verificada'].includes(x.regla) && x.certeza === 'confirmado' && x.elemento && fuentes.products.has(x.elemento) && fuentes.products.get(x.elemento).price !== null && !fuentes.retiredIds.has(x.elemento) && !ids.includes(x.elemento)) ids.push(x.elemento);
  }
  return { ids: ids.slice(0, 8), usados };
}

/**
 * Propone portada, historias y organización de categorías. PURO: no escribe nada. Devuelve { informe, propuesta, resumen } donde `propuesta` = { esquema, blocks, stories }
 * (el borrador que se podría guardar) y `informe` es `informe-agente/1`. `informes`: informes normalizados de otros agentes (solo el 05 se integra hoy).
 */
export function proponerPortada({ motor, fuentes, productosBrutos = [], informes = [], ahora = Date.now(), sintetico = true, capacidad = '06.proponer-portada' }) {
  const m = exigir(motor);
  const antes = sha256(canonico({ p: [...fuentes.products.values()], c: [...fuentes.categories.values()], r: [...fuentes.retiredIds] }));
  const ctx = m.initial.deriveInitialContext(fuentes);
  let bloques = plano(m.initial.buildInitialBlocks(ctx));
  const origen = new Map(bloques.map((b) => [b.id, 'diseno_existente_maqueta_v4']));
  const suposiciones = [
    'Se parte del diseño de la portada rediseñada que ya existe (maqueta v4): el agente selecciona categorías e imágenes con los datos y no redacta textos editoriales propios.',
    'Las categorías destacadas son las que tienen más productos con precio; el orden y los criterios automáticos son los del generador existente.',
    'Un bloque solo se da por «visible» si hay productos presentables (título y precio); la falta de stock nunca lo oculta.',
  ];
  const { ids: dePrecios, usados } = productosDeInformes(informes, fuentes);
  if (dePrecios.length >= 2) {
    const nuevo = { id: 'oportunidades', modality: 'manual', format: 'carrusel', width: 12, title: 'Oportunidades verificadas', subtitle: 'Seleccionadas con observaciones verificadas del Analista de precios', card: 'producto', visible: true, config: {}, refs: dePrecios.map((id) => ({ kind: 'product', id })) };
    const i = bloques.findIndex((b) => b.id === 'bajadas');
    bloques.splice(i >= 0 ? i + 1 : bloques.length, 0, nuevo);
    origen.set('oportunidades', 'informe_agente_05');
    suposiciones.push(`El bloque «Oportunidades verificadas» se construye con ${dePrecios.length} producto(s) citados con certeza «confirmado» en el informe del Agente 05 (${usados.map((u) => `${u.idEjecucion}${u.origenDatos === 'datos_de_prueba' ? ', datos de prueba' : ''}`).join('; ')}) que existen en las fuentes; no se re-verifican aquí.`);
  } else if (usados.length) suposiciones.push('El informe del Agente 05 no aporta al menos 2 productos con oportunidad confirmada y presentable: no se propone bloque de oportunidades.');
  const validado = m.validate.validateBlocks(bloques);
  if (!validado.ok) throw new ErrorProtocolo('interno', `La propuesta de bloques no supera la validación existente: ${validado.errores ? validado.errores.slice(0, 3).join('; ') : validado.errors.slice(0, 3).join('; ')}`);
  bloques = plano(validado.value);
  const res = m.resolve.resolveBlocks(bloques, fuentes, { runAutomatic: true });
  const categorias = analizarCategorias(fuentes);
  const listaCats = [...fuentes.categories.values()].map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId }));
  const hist = m.initStories.buildInitialStories({ products: productosBrutos, categories: listaCats, retiredIds: fuentes.retiredIds, imageOk: () => true, now: new Date(ahora) });
  const incHist = m.stories.checkStories(hist.stories, fuentes);
  const hallazgos = [];
  for (const [i, s] of suposiciones.entries()) hallazgos.push(h(`suposicion:${i + 1}`, 'suposicion', null, { texto: s }));
  for (const r of res.blocks) {
    const id = r.id;
    const b = bloques.find((x) => x.id === id) || {};
    hallazgos.push(h(`bloque:${id}`, 'bloque_propuesto', id, { id, modalidad: b.modality, formato: b.format, ancho: b.width, titulo: b.title ?? null, visible: r.visible ?? null, elementos: r.items ?? null, origen: origen.get(id) ?? 'desconocido', incidencias: (r.issues || []).map((x) => ({ severidad: x.severity, codigo: x.code, mensaje: x.message })) }, r.visible === false ? 'No se mostraría con los datos actuales: no forzarlo' : null, r.visible === false ? 'advertencia' : 'confirmado', r.visible === false ? 'P3' : 'P4'));
    for (const [j, x] of (r.issues || []).entries()) if (x.severity !== 'info') hallazgos.push(h(`bloque:${id}:incidencia:${j + 1}`, 'incidencia_bloque', id, { severidad: x.severity, codigo: x.code, mensaje: x.message }, null, x.severity === 'error' ? 'confirmado' : 'advertencia', SEV[x.severity]));
  }
  for (const s of hist.stories) hallazgos.push(h(`historia:${s.id}`, 'historia_propuesta', s.id, { id: s.id, nombre: s.name, estado: s.status, pantallas: s.screens.length, productos: (hist.report.find((x) => x.id === s.id) || {}).products || [] }, 'Se propone como BORRADOR; publicarla es decisión humana', 'confirmado', 'P4'));
  for (const r of hist.report.filter((x) => x.status === 'omitida')) hallazgos.push(h(`historia:${r.id}:omitida`, 'historia_omitida', r.id, { id: r.id, nombre: r.name, motivo: r.reason }, null, 'no_verificable', 'P4'));
  for (const [i, x] of incHist.filter((y) => y.severity !== 'info').entries()) hallazgos.push(h(`historia:${x.storyId}:incidencia:${i + 1}`, 'incidencia_historia', x.storyId, { severidad: x.severity, codigo: x.code, mensaje: x.message }, null, x.severity === 'error' ? 'confirmado' : 'advertencia', SEV[x.severity]));
  for (const [i, p] of categorias.entries()) hallazgos.push(h(`categoria:${p.regla}:${p.categoria ?? i}`, 'propuesta_categoria', p.categoria, { ...p.evidencia, texto: p.texto, requiereAutorizacion: true, nivel: 'L4' }, 'Reorganizar categorías reales es L4 humano: esto es una propuesta informativa', 'advertencia', 'P3'));
  const visibles = res.blocks.filter((r) => r.visible === true).length;
  const ocultos = res.blocks.filter((r) => r.visible === false).length;
  const errores = hallazgos.filter((x) => (x.regla === 'incidencia_bloque' || x.regla === 'incidencia_historia') && x.certeza === 'confirmado').length;
  const propuesta = { esquema: 'propuesta-portada/1', blocks: bloques, stories: plano(hist.stories) };
  const huella = sha256(canonico(propuesta));
  const limitaciones = [
    'El borrador es una PROPUESTA: no se guarda, no se publica ni se activa nada; publicar y activar son L4 humano.',
    'La vista de «qué se mostraría» usa las fuentes de referencia aportadas; la portada pública también depende de los candados de activación.',
    'El agente no inventa textos ni imágenes: usa los del generador existente y los del catálogo de referencia.',
    'Reorganizar categorías reales es L4 humano: las propuestas de categorías son informativas.',
    'No se consultan fuentes externas (sin red, sin créditos).',
  ];
  if (!informes.some((i) => i && i.agente === '05')) limitaciones.push('No se aportó informe del Agente 05: no hay bloque de oportunidades verificadas.');
  if (informes.some((i) => i && i.agente === '01')) limitaciones.push('El informe del Agente 01 (formato propio) aún no se integra: no se usa.');
  if (informes.some((i) => i && i.agente === '10')) limitaciones.push('El informe del Agente 10 (analítica) está disponible pero aún no se integra en la propuesta: no se usa para ordenar ni destacar; falta decidir cómo y con qué datos reales.');
  if (sintetico) limitaciones.push('DATOS DE PRUEBA: catálogo, categorías e imágenes sintéticos; no reflejan la producción.');
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '06', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `po-${createHash('sha256').update(canonico({ antes, informes: usados.map((u) => u.idEjecucion) })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(ahora).toISOString(), completo: errores === 0 && bloques.length > 0,
    fuente: { sistema: 'portada_editable_existente', tabla: 'fuentes_de_referencia', host: null, registrosLeidos: fuentes.products.size, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: antes },
    resumen: { estadoCalidad: errores === 0 ? 'completa' : 'incompleta', incidencias: errores, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: ocultos + errores, elementosTotales: bloques.length, bloques: bloques.length, bloquesVisibles: visibles, bloquesOcultos: ocultos, historias: hist.stories.length, historiasOmitidas: hist.report.filter((x) => x.status === 'omitida').length, propuestasCategorias: categorias.length },
    hallazgos, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe, propuesta, huellaPropuesta: huella, resolucion: res.totals, informesUsados: usados };
}

// ── L3 simulado: guardar el borrador en un área PRIVADA, con copia previa y deshacer ────────────────────────────────────────────────
/**
 * Decide (sin escribir) el guardado SIMULADO de una propuesta como borrador. `estado` = { layout:{status,doc}, backups, historias:{status,doc} } del ÁREA PRIVADA.
 * Usa las decisiones existentes: `prepareDraftSave` (conflicto/validación), `protectDraft` (copia previa) y `prepareStoriesSave`. Devuelve un plan o un rechazo.
 */
export function planGuardarBorradorSimulado({ motor, estado, propuesta, ahora = Date.now(), por = 'agente-06' }) {
  const m = exigir(motor);
  const now = new Date(ahora);
  const rev = m.draft.revisionOf(estado.layout.doc.draft.updatedAt);
  const plan = m.draft.prepareDraftSave(estado.layout, { baseRevision: rev, blocks: propuesta.blocks }, now);
  if (!plan.ok) return { ok: false, razon: plan.reason, errores: plan.errors };
  const copia = m.backups.protectDraft(estado.backups, estado.layout.doc.draft, 'antes_de_cargar_diseno', now, por);
  if (!copia.ok) return { ok: false, razon: copia.reason, errores: copia.errors };
  const hrev = m.stories.revisionOf(estado.historias.doc.draft.updatedAt);
  const ph = m.stories.prepareStoriesSave(estado.historias, { baseRevision: hrev, stories: propuesta.stories }, now);
  if (!ph.ok) return { ok: false, razon: `historias_${ph.reason}`, errores: ph.errors };
  const diff = m.publish.diffBlocks(estado.layout.doc.draft.blocks, plan.doc.draft.blocks);
  return { ok: true, layout: plan.doc, backups: copia.doc, historias: ph.doc, idCopia: copia.id, copiaCreada: copia.created, diff, revision: plan.revision, borradorAnteriorVacio: estado.layout.doc.draft.blocks.length === 0 };
}

/** Deshace un guardado simulado: restaura la copia previa con `planRestoreBackup`; si el borrador anterior estaba vacío, lo deja vacío. Devuelve un plan (sin escribir). */
export function planDeshacerBorradorSimulado({ motor, estado, idCopia, anteriorVacio, historiasAnteriores = null, ahora = Date.now(), por = 'propietario' }) {
  const m = exigir(motor);
  const now = new Date(ahora);
  let layout;
  let backups = estado.backups;
  if (idCopia) {
    const p = m.backups.planRestoreBackup(estado.layout, estado.backups, { action: 'restore', id: idCopia, baseRevision: m.draft.revisionOf(estado.layout.doc.draft.updatedAt), confirm: true }, now, por);
    if (!p.ok) return { ok: false, razon: p.reason, errores: p.errors };
    layout = p.layout;
    backups = p.backups;
  } else if (anteriorVacio) {
    const prot = m.backups.protectDraft(estado.backups, estado.layout.doc.draft, 'antes_de_recuperar_copia', now, por);
    if (!prot.ok) return { ok: false, razon: prot.reason, errores: prot.errors };
    backups = prot.doc;
    layout = { ...estado.layout.doc, draft: { blocks: [], updatedAt: new Date(Math.max(ahora, Date.parse(estado.layout.doc.draft.updatedAt || 0) + 1)).toISOString() } };
  } else return { ok: false, razon: 'sin_copia_previa', errores: ['No consta la copia previa ni que el borrador anterior estuviera vacío: no se puede deshacer con garantías.'] };
  return { ok: true, layout, backups, historias: historiasAnteriores };
}
