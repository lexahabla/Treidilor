/**
 * Agente 01 · INVESTIGADOR (ficha `automation/agents/01-investigador-mercado.md`; riesgo bajo; «sólo propone; no importa nada»). Capacidad registrada: `01.investigar-tendencias` (L1, propuesta,
 * sin alcances). ADAPTADOR al protocolo del Director sobre la lógica que YA existe y está probada: `automation/lib/researcher.mjs` (la misma que incrusta el workflow local
 * `investigador-comercial.local.json`). No reimplementa ninguna regla: construye el informe del investigador con `construirInformeInvestigador` a partir de un feed del catálogo APORTADO
 * por parámetro y lo traduce a `informe-agente/1`.
 * ALCANCE REAL (v0, y así lo declara el informe): identifica CANDIDATOS e HIPÓTESIS comerciales con reglas deterministas sobre el feed (descuentos solo DECLARADOS por la fuente y nunca
 * verificados; sin valoraciones, reseñas ni ventas como señal). NO analiza tendencias temporales (no hay serie temporal), NO usa IA ni fuentes externas y NO afirma que ningún producto o
 * categoría «esté en tendencia». El identificador de la capacidad conserva el nombre provisional del diseño aprobado, pero sus textos no prometen más de lo que hace.
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';
import { construirInformeInvestigador } from '../../../lib/researcher.mjs';

const h = (clave, regla, elemento, evidencia, { certeza = null, prioridad = null, accion = null } = {}) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida: accion });

/** Informe del investigador (formato existente `informe-investigador`) a partir del feed aportado. Usa la MISMA función que el workflow local. PURO. */
export function informeInvestigadorDesdeFeed({ feed, cfg, ahora = Date.now() }) {
  const productos = Array.isArray(feed && feed.products) ? feed.products : Array.isArray(feed && feed.productos) ? feed.productos : null;
  if (!productos) throw new ErrorProtocolo('origen_no_disponible', 'El feed aportado no tiene una lista de productos (products).');
  if (!cfg || typeof cfg !== 'object' || !cfg.umbrales) throw new ErrorProtocolo('origen_no_disponible', 'Falta la configuración del investigador (umbrales).');
  const total = Number.isInteger(feed.total) ? feed.total : productos.length;
  return construirInformeInvestigador({
    cfg,
    objetivosCatalogo: [{ tipo: 'catalogo', pagina: 1 }],
    respuestasCatalogo: [{ statusCode: 200, body: JSON.stringify({ products: productos, total, totalPages: 1 }) }],
    ahoraIso: new Date(ahora).toISOString(),
  });
}

/** `informe-investigador` → `informe-agente/1`. PURO. Los candidatos son HIPÓTESIS de interés comercial, nunca tendencias ni recomendaciones. */
export function aInformeAgenteInvestigador({ inf, ahora = Date.now(), sintetico = true, capacidad = '01.investigar-tendencias' }) {
  const H = [];
  const sup = [
    'Un «candidato» es un producto que merece la pena MIRAR por tener un descuento DECLARADO por la fuente; no es una recomendación ni una tendencia.',
    'La puntuación es explicable (cada punto tiene su motivo) y de confianza baja: el descuento no está verificado.',
    'La v0 no analiza tendencias temporales: no hay serie temporal en el feed y no se afirma que nada «esté en tendencia».',
  ];
  sup.forEach((t, i) => H.push(h(`suposicion:${i + 1}`, 'suposicion', null, { texto: t })));
  for (const c of inf.candidatos) H.push(h(`candidato:${c.id}`, 'candidato_comercial', c.id, { titulo: c.titulo, categoria: c.categoria, comercio: c.comercio, precio: c.precio, precioAnteriorDeclarado: c.precioAnteriorDeclarado, descuentoDeclaradoPct: c.descuentoDeclaradoPct, descuentoVerificado: false, puntuacion: c.puntuacion, confianza: c.confianza, motivos: c.motivos }, { certeza: 'no_verificable', prioridad: 'P4', accion: c.advertencias[0] }));
  for (const c of inf.candidatos.slice(0, 5)) H.push(h(`hipotesis:${c.id}`, 'hipotesis_comercial', c.id, { texto: `Hipótesis (NO verificada): «${c.titulo}» podría merecer atención por su descuento declarado del ${c.descuentoDeclaradoPct} %.`, estado: 'hipotesis', comoValidar: 'Contrastar el precio anterior con una observación verificada (Agente 05) antes de mostrarlo como descuento o promocionarlo.' }, { certeza: 'no_verificable', prioridad: 'P4', accion: 'HIPÓTESIS: no está demostrada; decide una persona.' }));
  for (const s of inf.sospechosos) H.push(h(`sospechoso:${s.id}`, 'descuento_declarado_sospechoso', s.id, { titulo: s.titulo, precio: s.precio, precioAnteriorDeclarado: s.precioAnteriorDeclarado, descuentoDeclaradoPct: s.descuentoDeclaradoPct, motivo: s.motivo }, { certeza: 'advertencia', prioridad: 'P3', accion: 'Descuento poco creíble: no destacarlo sin verificarlo.' }));
  if (inf.calidad.total) H.push(h('calidad', 'fichas_con_datos_faltantes', null, { total: inf.calidad.total, ejemplos: inf.calidad.ejemplos.slice(0, 5) }, { certeza: 'confirmado', prioridad: 'P3', accion: 'Completar las fichas antes de considerarlas candidatas (el detalle completo lo da el Agente 04).' }));
  for (const x of inf.huecos) H.push(h(`hueco:${x.categoria}`, 'categoria_con_pocos_productos', x.categoria, { categoria: x.categoria, productos: x.productos }, { certeza: 'confirmado', prioridad: 'P4' }));
  for (const d of inf.duplicados) H.push(h(`duplicado:${d.ids.join('+')}`, 'duplicado_probable', d.ids[0], { titulo: d.titulo, ids: d.ids }, { certeza: 'advertencia', prioridad: 'P3' }));
  H.push(h('distribucion', 'distribucion_del_catalogo', null, inf.distribucion, { certeza: 'confirmado', prioridad: 'P4' }));
  for (const [i, e] of inf.resumen.errores.entries()) H.push(h(`error:${i + 1}`, 'error_de_lectura', null, { texto: e }, { certeza: 'confirmado', prioridad: 'P2' }));
  H.push(h('no_disponible', 'datos_no_disponibles', null, { metricas: [
    { metrica: 'tendencias_temporales', motivo: 'el feed no trae serie temporal; la v0 no analiza evolución' },
    { metrica: 'descuentos_verificados', motivo: 'el feed no incluye observaciones verificadas; los descuentos son los declarados' },
    { metrica: 'ventas_valoraciones_y_resenas', motivo: 'no se usan como señal: pueden ser valores por defecto' },
    { metrica: 'demanda_y_fuentes_externas', motivo: 'la v0 no usa IA ni búsqueda web' },
    { metrica: 'candidatos_aceptados_sobre_propuestos', motivo: 'no existe registro de las decisiones del propietario' },
  ] }, { certeza: 'no_verificable', prioridad: 'P4' }));
  const limitaciones = [
    'Solo propone: no importa nada, no cambia precios ni fichas y no publica (todo ello es L4 humano).',
    ...inf.limitaciones.filter((x) => !/^v0 sin IA/.test(x)),
    'v0 sin IA ni búsqueda web: solo reglas deterministas sobre un feed de lectura del catálogo APORTADO; identifica candidatos e hipótesis comerciales, no tendencias.',
  ];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: feed del catálogo sintético; no refleja la producción.');
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '01', capacidad, version: String(inf.version), entorno: 'local',
    idEjecucion: `iv-${createHash('sha256').update(canonico({ c: inf.candidatos.map((x) => [x.id, x.puntuacion]), s: inf.sospechosos.map((x) => x.id), n: inf.resumen.productosAnalizados })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: inf.resumen.errores.length === 0 && inf.resumen.productosAnalizados > 0,
    fuente: { sistema: 'feed_del_catalogo_aportado', tabla: 'automation-catalog/1', host: null, registrosLeidos: inf.resumen.productosAnalizados, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico({ c: inf.candidatos, s: inf.sospechosos, r: inf.resumen })) },
    resumen: { estadoCalidad: inf.resumen.errores.length === 0 && inf.resumen.productosAnalizados > 0 ? 'completa' : 'incompleta', incidencias: inf.sospechosos.length + inf.duplicados.length + inf.resumen.errores.length, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: inf.calidad.total, elementosTotales: inf.resumen.productosAnalizados, productos: inf.resumen.productosAnalizados, candidatosElegibles: inf.resumen.candidatosElegibles, candidatos: inf.candidatos.length, sospechosos: inf.sospechosos.length, fichasConDatosFaltantes: inf.calidad.total, categoriasConPocosProductos: inf.huecos.length, duplicadosProbables: inf.duplicados.length, errores: inf.resumen.errores.length },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe };
}

/** Atajo: feed → informe `informe-agente/1` (más el informe original del investigador, que no se pierde). PURO. */
export function investigarCandidatos({ feed, cfg, ahora = Date.now(), sintetico = true, capacidad = '01.investigar-tendencias' }) {
  const inf = informeInvestigadorDesdeFeed({ feed, cfg, ahora });
  return { ...aInformeAgenteInvestigador({ inf, ahora, sintetico, capacidad }), investigador: inf };
}
