/**
 * Agente 03 · IMPORTADOR (ficha `automation/agents/03-importador.md`; riesgo medio): CAPA DE INTELIGENCIA Y COORDINACIÓN sobre el motor de importación JSON
 * que YA existe (`src/lib/jsonImport/`). NO es un segundo sistema de importación: no normaliza, no detecta duplicados y no fusiona por su cuenta; reutiliza
 *   · `normalize.extractRecords / normalizeRecord / platformFromUrl` (validación y normalización de registros),
 *   · `engine.runImport` (identidad por oferta/GTIN/marca+MPN, vínculo entre comercios, conflictos → revisión, protección de lo enriquecido/editado),
 *   · `reasonLabels.explainReason` (motivos en español) y `temuShortLink.isTemuShortLink`.
 * `runImport` es PURO (devuelve el catálogo resultante sin escribir): aquí solo se usa como SIMULACIÓN sobre una COPIA del catálogo de referencia que se aporta;
 * el módulo comprueba que el catálogo de entrada no cambió y NO tiene ninguna operación de escritura ni de red.
 * Lo que el agente hace: identificar plataforma y tipo de entrada; validar y detectar incidencias; detectar duplicados y conflictos entre comercios; preparar la
 * propuesta/simulación; generar el informe normalizado `informe-agente/1`; y PREPARAR (no enviar) la solicitud de autorización de la importación REAL, que es
 * L4 y la ejecuta una persona en el panel. El motor (TypeScript) se INYECTA ya cargado: sin él, el agente se declara no disponible (nunca finge).
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';
import { detectarSecreto } from '../../ledger.mjs';

export const MAX_ENTRADA = 20000;
const MAX_REGISTROS_SIMULACION = 500;

/** Carga el motor existente (requiere el cargador de TypeScript del proyecto). Devuelve { engine, normalize, labels, temu }. */
export async function cargarMotor() {
  if (!process.env.TRADYLOR_DATA_DIR) process.env.TRADYLOR_DATA_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/tai-importador-sin-datos`; // el motor nunca debe apuntar a datos reales
  const base = new URL('../../../../src/lib/', import.meta.url);
  try {
    const [engine, normalize, labels, temu] = await Promise.all(['jsonImport/engine.ts', 'jsonImport/normalize.ts', 'jsonImport/reasonLabels.ts', 'temuShortLink.ts'].map((f) => import(new URL(f, base).href)));
    return { engine, normalize, labels, temu };
  } catch (e) {
    throw new ErrorProtocolo('origen_no_disponible', 'El motor de importación existente no está disponible (hace falta el cargador de TypeScript del proyecto).', { causa: String(e && e.code ? e.code : 'import') });
  }
}
const exigirMotor = (m) => { if (!m || !m.engine || !m.normalize) throw new ErrorProtocolo('origen_no_disponible', 'El motor de importación existente no está disponible: no se puede analizar ni simular.'); return m; };
const plano = (x) => JSON.parse(JSON.stringify(x));
const huella = (x) => sha256(canonico(x));

// ── 1. identificar plataforma y tipo de entrada ───────────────────────────────────────────────────────────────────────────────
/** Fuentes que haría falta para obtener datos de una entrada que NO es JSON (documentado en AGENTS.md; de pago o con red: no disponible aquí). */
const FUENTE_EXTERNA = { amazon: 'ScraperAPI (ASIN/URL) o Apify (categoría): de pago', temu: 'Apify (de pago)', aliexpress: 'API oficial por id (opt-in) o extracción', ebay: 'API oficial por id (opt-in) o extracción', etsy: 'sin conector de extracción', '': 'sin fuente identificada' };

/**
 * Identifica la entrada: { tipo, plataforma, id, requiereFuenteExterna, fuenteExterna, avisos }. tipo: json | asin | url_producto | url_categoria | enlace_corto | url_desconocida | desconocido.
 * No abre ninguna URL: solo la analiza como texto. Un JSON se devuelve ya parseado en `datos`.
 */
export function identificarEntrada(entrada, motor) {
  const m = exigirMotor(motor);
  const avisos = [];
  let datos = null;
  if (entrada !== null && typeof entrada === 'object') datos = entrada;
  else if (typeof entrada === 'string') {
    const t = entrada.trim();
    if (t.length > MAX_ENTRADA) return { tipo: 'desconocido', plataforma: '', id: null, requiereFuenteExterna: false, fuenteExterna: null, avisos: [`La entrada supera ${MAX_ENTRADA} caracteres: se rechaza.`] };
    if (/^[[{]/.test(t)) { try { datos = JSON.parse(t); } catch { return { tipo: 'desconocido', plataforma: '', id: null, requiereFuenteExterna: false, fuenteExterna: null, avisos: ['La entrada parece JSON pero no es JSON válido.'] }; } }
    else {
      const asin = /^(B0[A-Z0-9]{8})$/i.exec(t);
      if (asin) return { tipo: 'asin', plataforma: 'amazon', id: asin[1].toUpperCase(), requiereFuenteExterna: true, fuenteExterna: FUENTE_EXTERNA.amazon, avisos };
      const url = /https?:\/\/[^\s"'<>]+/.exec(t);
      if (m.temu && m.temu.isTemuShortLink && m.temu.isTemuShortLink(t)) return { tipo: 'enlace_corto', plataforma: 'temu', id: null, requiereFuenteExterna: true, fuenteExterna: FUENTE_EXTERNA.temu, avisos: ['Enlace corto de afiliado de Temu: habría que resolverlo (red) antes de extraer.'] };
      if (url) {
        const u = url[0];
        const plataforma = m.normalize.platformFromUrl(u);
        let tipo = 'url_desconocida';
        let id = null;
        let mm;
        if (plataforma === 'amazon') { if ((mm = /\/(?:dp|gp\/product)\/(B0[A-Z0-9]{8})/i.exec(u))) { tipo = 'url_producto'; id = mm[1].toUpperCase(); } else if (/[?&]node=|\/s[/?]|\/b[/?]|\/zgbs|bestsellers|\/gp\/(?:bestsellers|new-releases)/i.test(u)) tipo = 'url_categoria'; }
        else if (plataforma === 'aliexpress') { if ((mm = /\/item\/(\d{6,})/.exec(u))) { tipo = 'url_producto'; id = mm[1]; } else if (/\/category\/|\/w\/|\/wholesale/.test(u)) tipo = 'url_categoria'; }
        else if (plataforma === 'ebay') { if ((mm = /\/itm\/(?:[^/]+\/)?(\d{9,})/.exec(u))) { tipo = 'url_producto'; id = mm[1]; } else if (/\/sch\/|\/b\//.test(u)) tipo = 'url_categoria'; }
        else if (plataforma === 'temu') { if ((mm = /-g-(\d{6,})\.html/.exec(u))) { tipo = 'url_producto'; id = mm[1]; } else if (/-o3-\d+\.html/.test(u)) tipo = 'url_categoria'; }
        if (tipo === 'url_desconocida') avisos.push('No se reconoce el tipo de la URL (producto o categoría).');
        return { tipo, plataforma, id, requiereFuenteExterna: true, fuenteExterna: FUENTE_EXTERNA[plataforma] ?? FUENTE_EXTERNA[''], avisos };
      }
      return { tipo: 'desconocido', plataforma: '', id: null, requiereFuenteExterna: false, fuenteExterna: null, avisos: ['No se reconoce la entrada (ni JSON, ni ASIN, ni URL).'] };
    }
  } else return { tipo: 'desconocido', plataforma: '', id: null, requiereFuenteExterna: false, fuenteExterna: null, avisos: ['Entrada vacía.'] };
  const { records, defaults } = m.normalize.extractRecords(datos);
  const plataformas = [...new Set(records.map((r) => String((r && (r.platform || r.plataforma)) || (defaults.platform ?? '')).toLowerCase()).filter(Boolean))];
  if (!records.length) avisos.push('El JSON no contiene registros.');
  if (records.length > MAX_REGISTROS_SIMULACION) avisos.push(`El JSON tiene ${records.length} registros; la simulación local admite ${MAX_REGISTROS_SIMULACION}.`);
  return { tipo: 'json', plataforma: plataformas.length === 1 ? plataformas[0] : plataformas.length ? 'varias' : (defaults.platform ?? ''), plataformas, id: null, registros: records.length, requiereFuenteExterna: false, fuenteExterna: null, datos, avisos };
}

// ── 2–4. validar, detectar incidencias, duplicados y conflictos (motor existente) ────────────────────────────────────────────────
const CLASE = { created: 'creada', linked: 'vinculada', updated: 'actualizada', unchanged: 'sin_cambios', review: 'revision', rejected: 'rechazada', error: 'error' };
const RAZONES_CONFLICTO = /contradictor|conflict|no_verificable|distint|repetid|parecido|varias_fichas|ambig/i;

/**
 * Simula la importación con `runImport` sobre una COPIA del catálogo de referencia. Devuelve el análisis completo; NO escribe nada.
 * `catalogo`: lista de fichas (puede ser []). Lanza si el catálogo de entrada se hubiera modificado (no debe ocurrir).
 */
export function simularImportacion({ motor, catalogo = [], entrada, ahora = Date.now(), batchId = 'simulacion-local' }) {
  const m = exigirMotor(motor);
  const id = identificarEntrada(entrada, m);
  if (id.tipo !== 'json') return { identificacion: id, simulado: false, motivo: id.requiereFuenteExterna ? 'requiere_fuente_externa' : 'entrada_no_reconocida', resultados: [], resumen: null };
  const { records, defaults } = m.normalize.extractRecords(id.datos);
  if (!records.length || records.length > MAX_REGISTROS_SIMULACION) return { identificacion: id, simulado: false, motivo: !records.length ? 'sin_registros' : 'demasiados_registros', resultados: [], resumen: null };
  const antes = huella(catalogo);
  const nowIso = new Date(ahora).toISOString();
  const salida = m.engine.runImport(plano(catalogo), plano(records), defaults, { batchId, nowIso, deletedIds: new Set(), onlyNew: false });
  if (huella(catalogo) !== antes) throw new ErrorProtocolo('interno', 'El catálogo de referencia cambió durante la simulación (no debe ocurrir).');
  const explica = (codes) => (m.labels && m.labels.explainReasons ? m.labels.explainReasons(codes || []) : codes || []);
  const resultados = salida.results.map((r) => ({ indice: r.index, resultado: CLASE[r.outcome] || r.outcome, titulo: r.title ?? null, idFicha: r.productId ?? null, claveOferta: r.offerKey ?? null, motivos: r.reasons || [], textos: explica(r.reasons), avisos: r.warnings || [], candidatos: (r.candidates || []).map((c) => ({ idFicha: c.productId, titulo: c.title, motivo: c.reason })) }));
  const cuenta = (c) => resultados.filter((r) => r.resultado === c).length;
  const resumen = { registros: resultados.length, nuevas: cuenta('creada'), vinculadas: cuenta('vinculada'), actualizadas: cuenta('actualizada'), sinCambios: cuenta('sin_cambios'), revisiones: cuenta('revision'), rechazadas: cuenta('rechazada'), errores: cuenta('error') };
  // «Solo productos nuevos» (el modo por defecto del panel) omitiría todo lo que ya existe: se calcula sin ejecutarlo.
  resumen.omitiriaConSoloNuevos = resumen.vinculadas + resumen.actualizadas + resumen.sinCambios;
  const duplicados = resultados.filter((r) => ['vinculada', 'actualizada', 'sin_cambios'].includes(r.resultado)).map((r) => ({ indice: r.indice, titulo: r.titulo, idFicha: r.idFicha, tipo: r.resultado === 'vinculada' ? 'misma identidad en otro comercio/oferta' : 'oferta ya existente' }));
  const conflictos = resultados.filter((r) => r.resultado === 'revision' || r.motivos.some((x) => RAZONES_CONFLICTO.test(x))).map((r) => ({ indice: r.indice, titulo: r.titulo, motivos: r.motivos, textos: r.textos, candidatos: r.candidatos }));
  const incidencias = resultados.filter((r) => r.resultado === 'rechazada' || r.resultado === 'error').map((r) => ({ indice: r.indice, titulo: r.titulo, motivos: r.motivos, textos: r.textos }));
  const advertencias = resultados.filter((r) => r.avisos.length).map((r) => ({ indice: r.indice, titulo: r.titulo, avisos: r.avisos }));
  return { identificacion: { ...id, datos: undefined }, simulado: true, huellaLote: huella(records), huellaCatalogo: antes, defaults, resultados, resumen, duplicados, conflictos, incidencias, advertencias, productosResultantes: salida.products.length };
}

// ── 5. informe normalizado y solicitud de autorización ────────────────────────────────────────────────────────────────────────────
/** Solicitud de autorización de la importación REAL (L4): se PREPARA, nunca se envía ni se ejecuta; la confirma una persona en el panel. */
export function prepararSolicitudAutorizacion(sim, { catalogoDescripcion = 'catálogo de referencia aportado' } = {}) {
  const r = sim.resumen;
  return {
    esquema: 'solicitud-importacion/1', nivelRiesgo: 'L4', ejecutor: 'humano', estado: 'no_enviada', accionAutomatica: false,
    huellaLote: sim.huellaLote, huellaCatalogoBase: sim.huellaCatalogo,
    efectosPrevistos: { fichasNuevas: r.nuevas, ofertasVinculadas: r.vinculadas, actualizaciones: r.actualizadas, sinCambios: r.sinCambios, aRevisar: r.revisiones, rechazadas: r.rechazadas },
    modoRecomendado: 'solo productos nuevos (los existentes no se tocan)',
    requisitosPrevios: ['copia de seguridad de los datos del catálogo (la hace el panel antes de aplicar)', 'confirmar categoría de destino de las fichas nuevas', `revisar a mano las ${r.revisiones} revisión(es) y las ${r.rechazadas} rechazada(s) antes de aplicar`, 'repetir la simulación si cambia el JSON o el catálogo (la huella no coincidiría)'],
    advertencias: [`La simulación se hizo sobre un ${catalogoDescripcion}, no necesariamente sobre el catálogo vivo de producción.`, 'La importación real modifica el catálogo público y no se puede deshacer salvo restaurando la copia.'],
    canal: 'panel de administración (interfaz autenticada)',
  };
}

const idEj = (cap, x) => `im-${createHash('sha256').update(canonico({ cap, x })).digest('hex').slice(0, 10)}`;
const hallazgo = (clave, regla, elemento, evidencia, accionSugerida = null) => ({ clave, regla, certeza: null, prioridad: null, gravedad: null, elemento, evidencia, accionSugerida });

/**
 * Informe normalizado de una simulación o propuesta. `capacidad`: '03.simular-importacion' | '03.proponer-lote'. Devuelve `informe-agente/1`.
 * Sin fuente externa disponible, el informe lo DECLARA (completo=false) y no inventa registros.
 */
export function construirInforme({ sim, capacidad, ahora = Date.now(), catalogoSintetico = true, catalogoDescripcion }) {
  const id = sim.identificacion;
  const hallazgos = [];
  const limitaciones = ['El motor de importación existente es la única fuente de decisión: este informe no añade reglas de identidad propias.', 'La simulación usa una copia del catálogo de REFERENCIA aportado; no lee ni escribe el catálogo de producción.', 'No se consultan fuentes externas (sin red, sin créditos): solo se analizan datos ya aportados.'];
  if (catalogoSintetico) limitaciones.push('DATOS DE PRUEBA: catálogo y registros sintéticos; no reflejan la producción.');
  hallazgos.push(hallazgo('entrada:identificacion', 'entrada_identificada', null, { tipo: id.tipo, plataforma: id.plataforma, id: id.id ?? null, registros: id.registros ?? null, requiereFuenteExterna: id.requiereFuenteExterna, fuenteExterna: id.fuenteExterna }));
  for (const [i, a] of (id.avisos || []).entries()) hallazgos.push(hallazgo(`entrada:aviso:${i + 1}`, 'aviso_de_entrada', null, { texto: a }));
  let completo = false;
  let solicitud = null;
  let resumenExtra = {};
  if (!sim.simulado) {
    hallazgos.push(hallazgo('entrada:sin_simulacion', 'entrada_requiere_fuente_externa', null, { motivo: sim.motivo, fuenteExterna: id.fuenteExterna }, id.requiereFuenteExterna ? 'Aportar el JSON de la extracción (Importar › JSON), o solicitar la extracción como operación L2 con coste (no disponible en local)' : 'Corregir la entrada'));
    limitaciones.push(id.requiereFuenteExterna ? `No se puede simular una entrada de tipo «${id.tipo}» sin obtener sus datos de una fuente externa (${id.fuenteExterna}); coste: no disponible.` : 'La entrada no se pudo analizar.');
  } else {
    for (const r of sim.resultados) hallazgos.push(hallazgo(`registro:${r.indice}`, r.resultado, r.titulo, { indice: r.indice, idFicha: r.idFicha, claveOferta: r.claveOferta, motivos: r.motivos, textos: r.textos, avisos: r.avisos, candidatos: r.candidatos }, r.resultado === 'revision' ? 'Resolver a mano en la revisión del panel; no se aplica solo' : r.resultado === 'rechazada' ? 'Corregir el dato de origen' : null));
    for (const d of sim.duplicados) hallazgos.push(hallazgo(`duplicado:${d.indice}`, 'posible_duplicado', d.titulo, { indice: d.indice, idFicha: d.idFicha, tipo: d.tipo }, 'Con «solo productos nuevos» se omite; sin esa opción se vincula o actualiza la ficha existente'));
    for (const c of sim.conflictos) hallazgos.push(hallazgo(`conflicto:${c.indice}`, 'conflicto_de_identidad', c.titulo, { indice: c.indice, motivos: c.motivos, textos: c.textos, candidatos: c.candidatos }, 'Decisión humana: el motor no fusiona ante la duda'));
    solicitud = prepararSolicitudAutorizacion(sim, { catalogoDescripcion: catalogoDescripcion ?? (catalogoSintetico ? 'catálogo sintético de referencia' : 'catálogo de referencia aportado') });
    hallazgos.push(hallazgo('propuesta:solicitud_autorizacion', 'solicitud_autorizacion', null, solicitud, 'La importación real es L4: la confirma una persona en el panel; esta solicitud NO se ha enviado'));
    completo = sim.resumen.errores === 0;
    resumenExtra = { ...sim.resumen };
  }
  const incidencias = hallazgos.filter((h) => ['revision', 'rechazada', 'error', 'conflicto_de_identidad', 'entrada_requiere_fuente_externa'].includes(h.regla)).length;
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '03', capacidad, version: '0.1.0', entorno: 'local', idEjecucion: idEj(capacidad, { l: sim.huellaLote ?? null, c: sim.huellaCatalogo ?? null, t: id.tipo, p: id.plataforma, id: id.id ?? null }),
    generadoEn: new Date(ahora).toISOString(), completo,
    fuente: { sistema: 'motor_importacion_json', tabla: 'catalogo_de_referencia', host: null, registrosLeidos: sim.resumen ? sim.resumen.registros : 0, origenDatos: catalogoSintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sim.huellaLote ?? null },
    resumen: { estadoCalidad: completo ? 'completa' : 'incompleta', incidencias, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: sim.resumen ? sim.resumen.revisiones + sim.resumen.rechazadas + sim.resumen.errores : null, elementosTotales: sim.resumen ? sim.resumen.registros : null, ...resumenExtra },
    hallazgos, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe, solicitudAutorizacion: solicitud };
}

/** Atajo: identifica, simula y construye el informe. */
export function analizarImportacion({ motor, catalogo, entrada, ahora, capacidad, catalogoSintetico = true, catalogoDescripcion }) {
  if (typeof entrada === 'string' && detectarSecreto(entrada)) throw new ErrorProtocolo('solicitud_invalida', 'La entrada contiene algo que parece una credencial: no se analiza.');
  const sim = simularImportacion({ motor, catalogo, entrada, ahora });
  return { sim, ...construirInforme({ sim, capacidad, ahora, catalogoSintetico, catalogoDescripcion }) };
}
