/**
 * Agente 04 — CALIDAD DEL CATÁLOGO v0 («detectar»). Lógica PURA y determinista: sin red, sin disco, sin reloj (el «ahora» es siempre `ahoraIso`), sin IA y sin coste.
 * SOLO LECTURA: analiza el feed `automation-catalog/1` que ya entregan los nodos HTTP de n8n; no modifica nada y no inventa datos que el feed no traiga.
 * Se incrusta en los nodos «Code» de n8n (sin imports reales; los `import` de abajo los resuelve el constructor y la poda se queda con lo que el nodo alcanza).
 *
 * Responsabilidades (frente al Auditor General, que sigue supervisando la disponibilidad del sistema y no cambia):
 *  · Lee el feed con `leerCatalogo` (del Auditor) y comprueba su INTEGRIDAD: sólo es «completo» con todas las páginas, ids coherentes y `total` coincidente.
 *  · Evalúa REGLAS por ficha con tres grados de certeza: CONFIRMADO (el dato es objetivamente incorrecto o falta), ADVERTENCIA (heurística: revisar) y
 *    NO VERIFICABLE (el feed no permite comprobarlo: se informa, nunca puntúa ni se presenta como defecto).
 *  · Puntúa y prioriza (P1-P4) sólo con datos del feed. Sin tráfico no hay prioridad por visitas.
 *  · Detecta posibles duplicados de forma CONSERVADORA: nunca declara «idéntico» ni propone eliminar; ofertas de otro comercio no son duplicados.
 *  · Reutiliza el motor de seguimiento (`seguimiento.mjs`) tal cual: las incidencias por ficha usan el área `ficha` (clave `ficha:codigo:idProducto`); las del conjunto, `catalogo`.
 *    Una incidencia sólo se da por RESUELTA si su ficha se leyó en esa ejecución; si el producto desaparece del feed queda «no verificada».
 */
import { bytesUtf8, diasEntre, estadoGlobal, fechaValida, mediana, ordenarIncidencias, plegar, precioAnteriorDeclarado, recortar, resumenIncidencias } from './common.mjs';
import { emparejar, imagenAceptable, incidencia, leerCatalogo, markdownSeguimiento } from './auditor.mjs';
import { evaluarUrlCalidad, validarConfigCalidad } from './urlPolicyCalidad.mjs';
import { LIMITES_PERSISTENCIA, claveSeguimiento, ejecutarSeguimiento, ejecutarSeguimientoConHistorial, estadoDeTabla, estadoDesdeInstantanea, resumirInstantanea } from './seguimiento.mjs';

export const VERSION_CALIDAD = '0.1.0';
export const ESQUEMA_INFORME_CALIDAD = 'informe-calidad/1';
export const AGENTE_CALIDAD = 'calidad-catalogo';

/** Umbrales por defecto (la configuración puede sobrescribirlos en `cfg.umbrales`). */
export const UMBRALES_CALIDAD = {
  tituloMinimo: 15,
  tituloMaximo: 120,
  descripcionCorta: 40,
  precioExtremo: 100000,
  descuentoSospechosoFactor: 5,
  precioAtipicoFactor: 10,
  minProductosMediana: 8,
  minGrupoSubcategoria: 4,
  fraccionSubcategoria: 0.5,
  minProductosRed: 5,
  fraccionAfiliadoRed: 0.9,
  capturaAntiguaDias: 30,
  verificacionAntiguaDias: 30,
  toleranciaFuturoMin: 5,
  tituloMinimoDuplicado: 12,
  toleranciaPrecioDuplicado: 0.05,
  toleranciaPrecioSimilar: 0.15,
  similitudMinima: 0.9,
  maxGrupoSimilitud: 300,
  maxParesInforme: 50,
  reduccionBruscaFraccion: 0.5,
  reduccionBruscaMinimo: 20,
  maxIncidenciasInforme: 300,
  maxSeguimientoLista: 100,
  maxEjemplos: 10,
};

/** Límites del seguimiento propios de este agente (el motor los admite sin cambios). */
export const LIMITES_SEGUIMIENTO_CALIDAD = { maxIncidencias: 300 };

/** Certezas. `peso` de la certeza en la puntuación; lo no verificable no puntúa. */
export const CERTEZAS = { confirmado: 1, advertencia: 0.6, no_verificable: 0 };
const PESO_GRAVEDAD = { critica: 100, alta: 80, media: 50, baja: 20, info: 0 };

/** REGISTRO de reglas por ficha: código, certeza, gravedad base, clase del problema, título y acción sugerida. */
export const REGLAS_CALIDAD = [
  { codigo: 'precio_ausente', certeza: 'confirmado', gravedad: 'alta', clase: 'integridad_datos', titulo: 'Sin precio utilizable', accion: 'Corregir o retirar la ficha: sin precio no se puede comprar ni comparar.' },
  { codigo: 'precio_extremo', certeza: 'confirmado', gravedad: 'media', clase: 'integridad_datos', titulo: 'Precio extremadamente alto', accion: 'Comprobar el dato de origen.' },
  { codigo: 'precio_anterior_menor', certeza: 'confirmado', gravedad: 'media', clase: 'integridad_datos', titulo: 'Precio anterior declarado inferior al actual', accion: 'Revisar el precio anterior: el descuento no tiene sentido.' },
  { codigo: 'sin_categoria', certeza: 'confirmado', gravedad: 'media', clase: 'calidad_datos', titulo: 'Sin categoría', accion: 'Asignar categoría.' },
  { codigo: 'comercio_malformado', certeza: 'confirmado', gravedad: 'media', clase: 'calidad_datos', titulo: 'Comercio con valor malformado («[object Object]»)', accion: 'Informativo, sin reparación automática: el campo merchant guarda un objeto convertido a texto. Revisar la ficha y su procedencia antes de corregirla; no asumir que pertenece a una red concreta.' },
  { codigo: 'sin_imagen', certeza: 'confirmado', gravedad: 'media', clase: 'calidad_datos', titulo: 'Sin imagen', accion: 'Añadir la imagen principal.' },
  { codigo: 'imagen_no_segura', certeza: 'confirmado', gravedad: 'media', clase: 'seguridad', titulo: 'Imagen con dirección no admisible', accion: 'Corregir la URL de la imagen (https o ruta propia).' },
  { codigo: 'sin_descripcion', certeza: 'confirmado', gravedad: 'media', clase: 'calidad_datos', titulo: 'Sin descripción', accion: 'Completar la ficha.' },
  { codigo: 'valoracion_incoherente', certeza: 'confirmado', gravedad: 'media', clase: 'honestidad_comercial', titulo: 'Valoración incoherente', accion: 'Revisar la valoración y el recuento: no pueden mostrarse así.' },
  { codigo: 'fecha_futura', certeza: 'confirmado', gravedad: 'media', clase: 'integridad_datos', titulo: 'Fecha posterior a la hora del informe', accion: 'Revisar las fechas de captura, verificación o alta.' },
  { codigo: 'id_duplicado', certeza: 'confirmado', gravedad: 'alta', clase: 'integridad_datos', titulo: 'Identificador repetido en el feed', accion: 'Revisar el origen de la importación: dos fichas comparten identificador.' },
  { codigo: 'precio_atipico', certeza: 'advertencia', gravedad: 'baja', clase: 'calidad_datos', titulo: 'Precio muy distinto del resto de su categoría', accion: 'Comprobar que el precio y la categoría son correctos.' },
  { codigo: 'titulo_incompleto', certeza: 'advertencia', gravedad: 'media', clase: 'calidad_datos', titulo: 'Título demasiado corto o sin texto', accion: 'Completar el título.' },
  { codigo: 'titulo_largo', certeza: 'advertencia', gravedad: 'baja', clase: 'calidad_datos', titulo: 'Título muy largo', accion: 'Acortar el título.' },
  { codigo: 'categoria_sin_id', certeza: 'advertencia', gravedad: 'baja', clase: 'calidad_datos', titulo: 'Categoría solo como texto (sin identificador)', accion: 'Vincular la ficha a una categoría del catálogo.' },
  { codigo: 'sin_subcategoria', certeza: 'advertencia', gravedad: 'baja', clase: 'calidad_datos', titulo: 'Sin subcategoría, aunque la mayoría de su categoría la tiene', accion: 'Asignar subcategoría si procede.' },
  { codigo: 'descripcion_corta', certeza: 'advertencia', gravedad: 'baja', clase: 'calidad_datos', titulo: 'Descripción muy corta', accion: 'Ampliar la descripción con datos reales de la ficha.' },
  { codigo: 'descuento_sospechoso', certeza: 'advertencia', gravedad: 'media', clase: 'honestidad_comercial', titulo: 'Descuento declarado muy alto', accion: 'No presentarlo como descuento sin verificación.' },
  { codigo: 'enlace_afiliado_ausente', certeza: 'advertencia', gravedad: 'alta', clase: 'monetizacion', titulo: 'Sin enlace de afiliación, cuando casi todos los de su red lo tienen', accion: 'Comprobar el enlace de salida de la ficha.' },
  { codigo: 'captura_ausente', certeza: 'advertencia', gravedad: 'baja', clase: 'actualidad', titulo: 'Sin fecha de captura del precio', accion: 'Actualizar la ficha desde su fuente.' },
  { codigo: 'captura_antigua', certeza: 'advertencia', gravedad: 'baja', clase: 'actualidad', titulo: 'Precio capturado hace mucho tiempo', accion: 'Actualizar la ficha desde su fuente.' },
  { codigo: 'verificacion_antigua', certeza: 'advertencia', gravedad: 'baja', clase: 'actualidad', titulo: 'Última verificación de precio antigua', accion: 'Volver a verificar el precio.' },
  { codigo: 'posible_duplicado', certeza: 'advertencia', gravedad: 'media', clase: 'integridad_datos', titulo: 'Posible duplicado (revisar; no eliminar sin comprobar)', accion: 'Comprobar si son la misma oferta; no se propone eliminar nada automáticamente.' },
  { codigo: 'descuento_declarado', certeza: 'no_verificable', gravedad: 'info', clase: 'honestidad_comercial', titulo: 'Descuento declarado sin verificación', accion: 'Informativo: la web sólo muestra descuentos verificados.' },
  { codigo: 'valoracion_por_defecto', certeza: 'no_verificable', gravedad: 'info', clase: 'honestidad_comercial', titulo: 'Valoración sin procedencia fiable (valor por defecto del alta)', accion: 'Informativo: no debe presentarse como valoración real.' },
  { codigo: 'stock_desconocido', certeza: 'no_verificable', gravedad: 'info', clase: 'actualidad', titulo: 'Stock no indicado por la fuente', accion: 'Informativo: el feed no permite saber si hay stock.' },
  { codigo: 'verificacion_ausente', certeza: 'no_verificable', gravedad: 'info', clase: 'actualidad', titulo: 'Precio sin lectura verificada', accion: 'Informativo: normal en fichas importadas.' },
  { codigo: 'campo_no_entregado', certeza: 'no_verificable', gravedad: 'info', clase: 'integridad_datos', titulo: 'Campos que el feed no entrega o entrega fuera de contrato (no se pueden evaluar)', accion: 'Informativo: el feed no cumple el contrato automation-catalog/1 para estos productos (campo ausente o con un tipo no admitido); las reglas que dependen de esos campos no se aplican.' },
  { codigo: 'enlace_afiliado_no_calibrable', certeza: 'no_verificable', gravedad: 'info', clase: 'monetizacion', titulo: 'Sin enlace de afiliación en redes donde no es lo habitual', accion: 'Informativo: el feed sólo dice si hay enlace guardado; en algunas redes el enlace se construye al salir.' },
  { codigo: 'titulo_igual_no_duplicado', certeza: 'no_verificable', gravedad: 'info', clase: 'integridad_datos', titulo: 'Mismo título en otro comercio o con otro precio (no se considera duplicado)', accion: 'Informativo: pueden ser ofertas distintas del mismo producto.' },
];
const REGLA = {};
for (const r of REGLAS_CALIDAD) REGLA[r.codigo] = r;

/* ───────────────────────── Utilidades ───────────────────────── */

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Identificador utilizable del producto (texto no vacío; un número finito se admite como texto). '' si no tiene. */
export const idDe = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? (typeof p.id === 'string' ? p.id.trim() : Number.isFinite(p.id) ? `${p.id}` : '') : '');
const esProducto = (p) => idDe(p) !== '';
const claveCategoria = (p) => (texto(p.categoryId) || plegar(p.category) || '~');
const claveRed = (p) => plegar(p.network) || '~';
const umbrales = (cfg) => ({ ...UMBRALES_CALIDAD, ...((cfg && cfg.umbrales) || {}) });
const ejemplos = (ids, n) => ids.slice(0, n);
const porRedDe = (lista) => {
  const out = {};
  for (const p of lista) out[claveRed(p)] = (out[claveRed(p)] ?? 0) + 1;
  return out;
};

/** Título normalizado para comparar: sin tildes, mayúsculas ni signos. */
export function tituloNormalizado(t) {
  return plegar(t).replace(/[^a-z0-9]+/g, ' ').trim();
}
const PALABRAS_VACIAS = ['de', 'la', 'el', 'para', 'con', 'y', 'en', 'por', 'un', 'una', 'los', 'las', 'del', 'al'];
const tokensDe = (t) => [...new Set(tituloNormalizado(t).split(' ').filter((x) => x && !PALABRAS_VACIAS.includes(x)))].sort();
const jaccard = (a, b) => {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const comun = a.filter((x) => sb.has(x)).length;
  return comun / (a.length + b.length - comun);
};
const mismosConDigitos = (a, b) => {
  const da = a.filter((x) => /\d/.test(x)).join(' ');
  const db = b.filter((x) => /\d/.test(x)).join(' ');
  return da === db;
};
const cuartilSuperior = (precios) => {
  const v = precios.filter((n) => n > 0).sort((a, b) => a - b);
  if (!v.length) return Infinity;
  return v[Math.min(v.length - 1, Math.ceil(0.75 * v.length) - 1)];
};

/* ───────────────────────── Objetivos a pedir (política lectura_catalogo) ───────────────────────── */

const urlPagina = (cfg, pagina, limite) => evaluarUrlCalidad(`${cfg.baseUrl.replace(/\/$/, '')}/api/automation/v1/catalog?limit=${limite}&page=${pagina}`, cfg);

/** Primera página del feed. Sólo si la configuración y la URL pasan la política; si no, un marcador (que NO se analiza) para que el flujo no se corte. */
export function crearObjetivosCalidad(cfg) {
  const e = validarConfigCalidad(cfg).length ? { ok: false } : urlPagina(cfg, 1, cfg.limitePorPagina);
  return e.ok ? [{ id: 'catalogo:1', tipo: 'catalogo', url: e.url, pagina: 1 }] : [marcadorCalidad(cfg)];
}

/** Páginas 2..N, sólo las que existen (según `totalPages` de la primera respuesta) y hasta el tope `maxPaginasCatalogo`. */
export function crearObjetivosCalidadResto(objetivos, respuestas, cfg) {
  const out = [];
  if (!validarConfigCalidad(cfg).length) {
    const primera = leerCatalogo(objetivos, respuestas);
    if (Number.isInteger(primera.totalPaginas)) {
      for (let p = 2; p <= Math.min(primera.totalPaginas, cfg.maxPaginasCatalogo); p++) {
        const e = urlPagina(cfg, p, cfg.limitePorPagina);
        if (e.ok) out.push({ id: `catalogo:${p}`, tipo: 'catalogo', url: e.url, pagina: p });
      }
    }
  }
  return out.length ? out : [marcadorCalidad(cfg)];
}

/** Marcador: una URL AUTORIZADA mínima (1 producto) que no se analiza. Sólo se pide si el flujo no tiene otra página que pedir. */
export function marcadorCalidad(cfg) {
  const e = validarConfigCalidad(cfg).length ? { ok: false } : evaluarUrlCalidad(`${cfg.baseUrl.replace(/\/$/, '')}/api/automation/v1/catalog?limit=1&page=1`, cfg);
  return { id: 'marcador', tipo: 'marcador', marcador: true, url: e.ok ? e.url : '' };
}

/* ───────────────────────── Lectura e integridad del feed ───────────────────────── */

/** Campos que el contrato `automation-catalog/1` entrega SIEMPRE en cada producto (los que pueden no tener valor llegan como null). */
export const CAMPOS_CONTRATO = ['id', 'title', 'category', 'categoryId', 'subcategoryId', 'network', 'merchant', 'price', 'currency', 'declaredPreviousPrice', 'verifiedDiscount', 'stock', 'rating', 'reviewsCount', 'ratingFlag', 'image', 'descriptionLength', 'hasAffiliateLink', 'capturedAt', 'verifiedAt', 'addedAt'];

const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const esTexto = (v) => typeof v === 'string';
/** Tipo que el contrato `automation-catalog/1` fija para cada campo (los anulables admiten null). */
const TIPO_CAMPO = {
  id: (v) => esTexto(v) && v.trim() !== '', title: esTexto, currency: esTexto, stock: (v) => ['in_stock', 'low_stock', 'out_of_stock', 'unknown'].includes(v), descriptionLength: (v) => esNumero(v) && v >= 0, hasAffiliateLink: (v) => typeof v === 'boolean',
  category: (v) => v === null || esTexto(v), categoryId: (v) => v === null || esTexto(v), subcategoryId: (v) => v === null || esTexto(v), network: (v) => v === null || esTexto(v), merchant: (v) => v === null || esTexto(v),
  image: (v) => v === null || esTexto(v), capturedAt: (v) => v === null || esTexto(v), verifiedAt: (v) => v === null || esTexto(v), addedAt: (v) => v === null || esTexto(v), ratingFlag: (v) => v === null || esTexto(v),
  price: (v) => v === null || esNumero(v), declaredPreviousPrice: (v) => v === null || esNumero(v), rating: (v) => v === null || esNumero(v), reviewsCount: (v) => v === null || esNumero(v),
  verifiedDiscount: (v) => v === null || (typeof v === 'object' && !Array.isArray(v)),
};

/**
 * Campos que el feed NO entrega para este producto: no vienen, o vienen con un tipo que el contrato no admite (p. ej. un precio como texto, o null en un campo que nunca es null).
 * Un dato que llega como null en un campo anulable SÍ es una ausencia acreditada por el contrato (defecto confirmado); un campo que no llega o llega mal formado no se puede acreditar:
 * es «no verificable» y las reglas que dependen de él no se aplican.
 */
export function camposNoEntregados(p) {
  return CAMPOS_CONTRATO.filter((k) => !(k in p) || !TIPO_CAMPO[k](p[k]));
}

/** Oculta tokens y credenciales que pudieran venir en un texto de error (nada sensible llega a un informe). */
export function ocultarSecretos(t) {
  return String(t ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [oculto]')
    .replace(/tai_[0-9a-f]{16}_[A-Za-z0-9_-]+/g, '[token oculto]')
    .replace(/(authorization|api[_-]?key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2[oculto]');
}
const sinConsulta = (u) => String(u ?? '').split(/[?#]/)[0];

/**
 * Lee las páginas del feed y comprueba su integridad. `completo` sólo si: ningún error de página, `total` y `totalPages` coherentes entre páginas y entre sí, todas las páginas 1..N leídas
 * con el número de productos que les corresponde, ningún id repetido ENTRE páginas, tantos productos como `total` y al menos uno. Una lectura incompleta no es una auditoría completa:
 * no se guarda ni sirve para resolver incidencias.
 */
export function leerFeedCalidad(objetivos, respuestas, cfg) {
  const limite = cfg && Number.isInteger(cfg.limitePorPagina) ? cfg.limitePorPagina : 100;
  const paginas = [];
  const errores = [];
  const erroresCrudos = [];
  const productos = [];
  const paginaDe = [];
  const cuenta = new Map();
  const totales = new Set();
  const totalesPaginas = new Set();
  const pedidas = emparejar(objetivos, respuestas).filter((x) => x.t.tipo === 'catalogo');
  for (const { t, r } of pedidas) {
    const una = leerCatalogo([t], [r]);
    if (una.errores.length) {
      erroresCrudos.push(...una.errores);
      errores.push(...una.errores.map(ocultarSecretos));
      continue;
    }
    if (paginas.includes(t.pagina)) continue;
    paginas.push(t.pagina);
    cuenta.set(t.pagina, una.productos.length);
    for (const p of una.productos) { productos.push(p); paginaDe.push(t.pagina); }
    if (Number.isInteger(una.total)) totales.add(una.total);
    if (Number.isInteger(una.totalPaginas)) totalesPaginas.add(una.totalPaginas);
  }
  paginas.sort((a, b) => a - b);
  const inconsistencias = [];
  if (totales.size > 1) inconsistencias.push('el total de productos cambia entre páginas (el catálogo se modificó durante la lectura)');
  if (totalesPaginas.size > 1) inconsistencias.push('el número de páginas cambia entre páginas');
  const total = totales.size === 1 ? [...totales][0] : null;
  const totalPaginas = totalesPaginas.size === 1 ? [...totalesPaginas][0] : null;
  if (total !== null && totalPaginas !== null && totalPaginas !== Math.ceil(total / limite)) inconsistencias.push(`totalPages (${totalPaginas}) no corresponde a ${total} productos con ${limite} por página`);
  if (total !== null && totalPaginas !== null && totalPaginas === Math.ceil(total / limite)) {
    for (const [pg, n] of [...cuenta.entries()].sort((a, b) => a[0] - b[0])) {
      const esperado = pg < totalPaginas ? limite : total - limite * (totalPaginas - 1);
      if (pg > totalPaginas) inconsistencias.push(`la página ${pg} no debería existir (hay ${totalPaginas})`);
      else if (n !== esperado) inconsistencias.push(`la página ${pg} trae ${n} productos y debería traer ${esperado}`);
    }
  }
  const ids = new Map();
  let sinId = 0;
  const paginasPorId = new Map();
  productos.forEach((p, i) => {
    const id = idDe(p);
    if (!id) { sinId += 1; return; }
    ids.set(id, (ids.get(id) ?? 0) + 1);
    paginasPorId.set(id, new Set([...(paginasPorId.get(id) ?? []), paginaDe[i]]));
  });
  const repetidos = [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort();
  const entrePaginas = repetidos.filter((id) => paginasPorId.get(id).size > 1);
  if (entrePaginas.length) inconsistencias.push(`${entrePaginas.length} id(s) repetidos entre páginas: la paginación pudo desplazarse mientras se leía el catálogo`);
  if (sinId) inconsistencias.push(`${sinId} elemento(s) del feed sin identificador utilizable: no se pueden seguir ni analizar`);
  const pendientes = totalPaginas !== null ? Math.max(0, totalPaginas - paginas.length) : null;
  if (pendientes) inconsistencias.push(`${pendientes} página(s) sin leer de ${totalPaginas}${cfg && totalPaginas > cfg.maxPaginasCatalogo ? ` (tope de ${cfg.maxPaginasCatalogo} páginas por ejecución)` : ''}`);
  if (total !== null && productos.length !== total && !pendientes) inconsistencias.push(`se leyeron ${productos.length} productos y el feed declara ${total}`);
  const lecturaCompleta = totalPaginas !== null && paginas.length === totalPaginas && paginas.every((p, i) => p === i + 1);
  const completo = !errores.length && !inconsistencias.length && lecturaCompleta && total !== null && productos.length === total && productos.length > 0;
  const motivo = erroresCrudos.some((e) => /HTTP 40[13]\b/.test(e)) ? 'credencial_no_valida' : erroresCrudos.some((e) => /HTTP 429\b/.test(e)) ? 'limite_de_peticiones' : erroresCrudos.some((e) => /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(e)) ? 'tiempo_agotado' : errores.length ? 'error_de_lectura' : null;
  return { productos, total, totalPaginas, peticiones: objetivos.filter((t) => t && !t.marcador).length, paginasLeidas: paginas.length, paginasPedidas: pedidas.length, errores, inconsistencias, repetidos, completo, motivoFallo: motivo };
}

/* ───────────────────────── Análisis por ficha ───────────────────────── */

/** Contexto común (medianas, cuartil de precio, reparto de subcategorías y de enlaces por red). Una sola pasada, determinista. Lo que no tiene categoría o red conocida no forma grupos. */
function contextoDe(productos, um) {
  const preciosPorCat = new Map();
  const subPorCat = new Map();
  const redes = new Map();
  for (const p of productos) {
    const c = claveCategoria(p);
    const precio = num(p.price);
    if (c !== '~' && precio !== null && precio > 0) preciosPorCat.set(c, [...(preciosPorCat.get(c) ?? []), precio]);
    if (c !== '~' && 'subcategoryId' in p) {
      const s = subPorCat.get(c) ?? { total: 0, con: 0 };
      s.total += 1;
      if (texto(p.subcategoryId)) s.con += 1;
      subPorCat.set(c, s);
    }
    const r = claveRed(p);
    if (r !== '~' && typeof p.hasAffiliateLink === 'boolean') {
      const x = redes.get(r) ?? { total: 0, conEnlace: 0 };
      x.total += 1;
      if (p.hasAffiliateLink === true) x.conEnlace += 1;
      redes.set(r, x);
    }
  }
  const medianas = new Map();
  for (const [c, v] of preciosPorCat) if (v.length >= um.minProductosMediana) medianas.set(c, mediana(v));
  return { medianas, subPorCat, redes, p75: cuartilSuperior(productos.filter((p) => claveCategoria(p) !== '~').map((p) => num(p.price)).filter((n) => n !== null)) };
}

/** Si la red de la ficha tiene calibrado el enlace de afiliación (≥ umbral de sus productos lo tienen), devuelve su recuento; si no, null. */
function afiliadoCalibrado(p, ctx, um) {
  const r = ctx.redes.get(claveRed(p));
  return r && r.total >= um.minProductosRed && r.conEnlace / r.total >= um.fraccionAfiliadoRed ? r : null;
}

/**
 * Reglas por ficha. Devuelve la lista de hallazgos { codigo, detalle, evidencia }. Sólo usa campos del feed y sólo evalúa una regla si el contrato entrega el campo de que depende:
 * un campo que llega a null es una ausencia acreditada (defecto confirmado); un campo que no llega no se puede acreditar (se informa como «no verificable», no aquí).
 */
function evaluarFicha(p, ctx, um, ahoraIso, faltan) {
  const hallazgos = [];
  const hit = (codigo, detalle, evidencia) => hallazgos.push({ codigo, detalle, evidencia: evidencia ?? {} });
  const ok = (...campos) => campos.every((c) => !faltan.has(c));
  const precio = num(p.price);
  const anterior = ok('declaredPreviousPrice') ? precioAnteriorDeclarado(p) : null;
  const titulo = texto(p.title);
  const ahoraMs = Date.parse(ahoraIso);

  if (ok('price')) {
    if (precio === null || precio <= 0) hit('precio_ausente', 'El feed no trae un precio utilizable (ausente, cero o negativo).', { price: p.price ?? null });
    else if (precio > um.precioExtremo) hit('precio_extremo', `Precio superior a ${um.precioExtremo} €.`, { price: precio });
    if (precio !== null && precio > 0 && anterior !== null && anterior < precio) hit('precio_anterior_menor', 'El precio anterior declarado es menor que el actual.', { price: precio, declaredPreviousPrice: anterior });
    if (precio !== null && precio > 0) {
      const m = ctx.medianas.get(claveCategoria(p));
      if (m && (precio >= m * um.precioAtipicoFactor || precio <= m / um.precioAtipicoFactor)) hit('precio_atipico', `Precio muy distinto de la mediana de su categoría (${m} €).`, { price: precio, medianaCategoria: m });
    }
    if (anterior !== null && precio !== null && precio > 0 && anterior > precio * um.descuentoSospechosoFactor) hit('descuento_sospechoso', `Precio anterior declarado más de ${um.descuentoSospechosoFactor} veces el actual (dato declarado, no verificado).`, { price: precio, declaredPreviousPrice: anterior });
  }

  // C3: un objeto guardado como texto en el comercio. Defecto CONFIRMADO de calidad de datos (el feed entrega el campo y su valor es el texto exacto del defecto). Sólo se informa:
  // no se repara ni se presume la red de la ficha (se informa la que declara el feed, sea cual sea).
  if (ok('merchant') && /^\[object\s+object\]$/i.test(texto(p.merchant))) {
    hit('comercio_malformado', 'El campo merchant contiene el texto «[object Object]» (un objeto convertido a texto), no el nombre de un comercio.', { campo: 'merchant', valor: texto(p.merchant), red: texto(p.network) || null });
  }

  if (ok('title')) {
    if (titulo.length < um.tituloMinimo || /^[\d\s.,\-]+$/.test(titulo)) hit('titulo_incompleto', `Título de ${titulo.length} caracteres o sin texto.`, { longitud: titulo.length });
    else if (titulo.length > um.tituloMaximo) hit('titulo_largo', `Título de ${titulo.length} caracteres.`, { longitud: titulo.length });
  }

  const categoria = texto(p.category);
  const categoriaId = texto(p.categoryId);
  if (ok('category', 'categoryId')) {
    if (!categoria && !categoriaId) hit('sin_categoria', 'La ficha no tiene categoría.', {});
    else if (!categoriaId) hit('categoria_sin_id', 'Hay texto de categoría pero no identificador de categoría.', { category: recortar(categoria, 60) });
  }
  const grupo = ctx.subPorCat.get(claveCategoria(p));
  if (ok('subcategoryId') && !texto(p.subcategoryId) && grupo && grupo.total >= um.minGrupoSubcategoria && grupo.con / grupo.total >= um.fraccionSubcategoria) {
    hit('sin_subcategoria', `${grupo.con} de ${grupo.total} productos de su categoría tienen subcategoría y este no.`, { conSubcategoria: grupo.con, enCategoria: grupo.total });
  }

  if (ok('image')) {
    if (!texto(p.image)) hit('sin_imagen', 'La ficha no tiene imagen.', {});
    else if (!imagenAceptable(p.image)) hit('imagen_no_segura', 'La dirección de la imagen no es https ni una ruta propia.', { image: recortar(sinConsulta(p.image), 80) });
  }

  if (ok('descriptionLength')) {
    const longitud = num(p.descriptionLength);
    if (longitud === 0) hit('sin_descripcion', 'La ficha no tiene descripción.', { descriptionLength: 0 });
    else if (longitud !== null && longitud < um.descripcionCorta) hit('descripcion_corta', `Descripción de ${longitud} caracteres (mínimo recomendado ${um.descripcionCorta}).`, { descriptionLength: longitud });
  }

  const valoracion = ok('rating') ? num(p.rating) : null;
  const resenas = ok('reviewsCount') ? num(p.reviewsCount) : null;
  if ((valoracion !== null && (valoracion < 0 || valoracion > 5)) || (resenas !== null && (resenas < 0 || !Number.isInteger(resenas))) || (valoracion !== null && valoracion > 0 && resenas === 0)) {
    hit('valoracion_incoherente', 'Valoración o recuento de reseñas imposibles o contradictorios.', { rating: valoracion, reviewsCount: resenas });
  }
  if (ok('hasAffiliateLink') && p.hasAffiliateLink === false) {
    const r = afiliadoCalibrado(p, ctx, um);
    if (r) hit('enlace_afiliado_ausente', `${r.conEnlace} de ${r.total} productos de su red tienen enlace de afiliación y este no.`, { red: claveRed(p), conEnlace: r.conEnlace, enRed: r.total });
  }

  const captura = ok('capturedAt') ? fechaValida(p.capturedAt) : null;
  const verificada = ok('verifiedAt') ? fechaValida(p.verifiedAt) : null;
  const alta = ok('addedAt') ? fechaValida(p.addedAt) : null;
  const futura = [['capturedAt', captura], ['verifiedAt', verificada], ['addedAt', alta]].filter(([, f]) => f && Date.parse(f) > ahoraMs + um.toleranciaFuturoMin * 60000);
  if (futura.length) hit('fecha_futura', `Fecha posterior a la hora del informe: ${futura.map(([k]) => k).join(', ')}.`, Object.fromEntries(futura));
  if (ok('capturedAt') && !futura.some(([k]) => k === 'capturedAt')) {
    if (p.capturedAt === null) hit('captura_ausente', 'El feed no trae fecha de captura del precio.', {});
    else if (captura && diasEntre(captura, ahoraIso) > um.capturaAntiguaDias) hit('captura_antigua', `Precio capturado hace ${diasEntre(captura, ahoraIso)} días.`, { capturedAt: captura });
  }
  if (verificada && !futura.some(([k]) => k === 'verifiedAt') && diasEntre(verificada, ahoraIso) > um.verificacionAntiguaDias) hit('verificacion_antigua', `Última verificación de precio hace ${diasEntre(verificada, ahoraIso)} días.`, { verifiedAt: verificada });
  return hallazgos;
}

/** Datos que el feed no permite verificar o no entrega (agregados por regla). Devuelve { codigo: [productos] }. */
function noVerificables(productos, ctx, um) {
  const out = {};
  const add = (codigo, p) => { (out[codigo] ??= []).push(p); };
  for (const p of productos) {
    const faltan = camposNoEntregados(p);
    const tiene = (c) => !faltan.includes(c);
    const precio = num(p.price);
    const anterior = tiene('declaredPreviousPrice') ? precioAnteriorDeclarado(p) : null;
    if (faltan.length) add('campo_no_entregado', p);
    if (anterior !== null && tiene('price') && precio !== null && anterior > precio && tiene('verifiedDiscount') && !p.verifiedDiscount) add('descuento_declarado', p);
    if (tiene('ratingFlag') && p.ratingFlag) add('valoracion_por_defecto', p);
    if (tiene('stock') && p.stock === 'unknown') add('stock_desconocido', p);
    if (tiene('verifiedAt') && p.verifiedAt === null) add('verificacion_ausente', p);
    if (tiene('hasAffiliateLink') && p.hasAffiliateLink === false && !afiliadoCalibrado(p, ctx, um)) add('enlace_afiliado_no_calibrable', p);
  }
  return out;
}

/* ───────────────────────── Duplicados (conservador) ───────────────────────── */

/** Palabras de relleno comercial: la ÚNICA diferencia que se tolera entre dos títulos casi iguales (colores, tallas, modelos y variantes nunca son relleno). */
const PALABRAS_RELLENO = ['original', 'nuevo', 'nueva', 'nuevos', 'nuevas', 'oferta', 'ofertas', 'oficial', 'envio', 'gratis', 'rapido', 'rapida', 'garantia', 'garantizado', 'premium', 'calidad', 'alta', 'mejor', 'precio', 'barato', 'barata', 'chollo', 'outlet', 'stock', 'disponible', 'ultimas', 'unidades'];

/**
 * Posibles duplicados. NUNCA declara «idéntico», NUNCA propone eliminar ni fusionar y conserva las ofertas de distintos comercios (sirven para comparar precios):
 *  · Misma red + mismo comercio CONOCIDO + mismo título normalizado + precio dentro de la tolerancia → par «posible duplicado».
 *  · Misma red + mismo comercio conocido + mismos términos en otro orden (mismos dígitos: modelo, capacidad, cantidad) + precio parecido → par.
 *  · Misma red + mismo comercio conocido + títulos que sólo difieren en palabras de relleno comercial, mismos dígitos, similitud alta, misma categoría/subcategoría y precio parecido → par.
 *  · Cualquier otra coincidencia de título (otro comercio u otra red, comercio desconocido, otro precio) → sólo informativo: pueden ser ofertas distintas del mismo producto.
 *  · Otro modelo, capacidad, cantidad, color, talla o variante → no se relaciona nunca.
 * Devuelve { pares, informativos, omitidos }.
 */
export function detectarDuplicados(productos, um) {
  const validos = productos.filter((p) => esProducto(p) && typeof p.id === 'string').sort((a, b) => cmp(a.id, b.id));
  const pares = [];
  const claves = new Set();
  const omitidos = [];
  const comercio = (p) => plegar(p.merchant);
  const mismaOferta = (a, b) => claveRed(a) !== '~' && claveRed(a) === claveRed(b) && comercio(a) !== '' && comercio(a) === comercio(b);
  const precioCerca = (a, b, tol) => {
    const x = num(a.price);
    const y = num(b.price);
    return x !== null && y !== null && x > 0 && y > 0 && Math.max(x, y) / Math.min(x, y) <= 1 + tol;
  };
  const MOTIVOS = {
    titulo_igual_mismo_comercio: 'Mismo título, misma red, mismo comercio y precio parecido.',
    titulo_mismos_terminos: 'Mismos términos del título en otro orden (mismos modelo y capacidad), misma red y comercio y precio parecido.',
    titulo_similar_mismo_comercio: 'Títulos que sólo difieren en palabras de relleno comercial, misma categoría, red y comercio y precio parecido.',
  };
  const registrar = (a, b, tipo, similitud) => {
    const k = `${a.id}\u0001${b.id}`;
    if (claves.has(k)) return;
    claves.add(k);
    pares.push({ tipo, a: { id: a.id, titulo: recortar(a.title, 80), precio: num(a.price) }, b: { id: b.id, titulo: recortar(b.title, 80), precio: num(b.price) }, similitud, motivo: MOTIVOS[tipo] });
  };
  const porTitulo = new Map();
  for (const p of validos) {
    const k = tituloNormalizado(p.title);
    if (k.length >= um.tituloMinimoDuplicado) porTitulo.set(k, [...(porTitulo.get(k) ?? []), p]);
  }
  const conPareja = new Set();
  const informativos = [];
  for (const grupo of [...porTitulo.entries()].sort((a, b) => cmp(a[0], b[0])).map((x) => x[1]).filter((g) => g.length > 1)) {
    const emparejados = new Set();
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        if (grupo[i].id !== grupo[j].id && mismaOferta(grupo[i], grupo[j]) && precioCerca(grupo[i], grupo[j], um.toleranciaPrecioDuplicado)) { registrar(grupo[i], grupo[j], 'titulo_igual_mismo_comercio', 1); emparejados.add(grupo[i].id); emparejados.add(grupo[j].id); }
      }
    }
    for (const p of grupo) { if (emparejados.has(p.id)) conPareja.add(p.id); else informativos.push(p); }
  }
  const porBloque = new Map();
  for (const p of validos) {
    const k = `${claveCategoria(p)}|${texto(p.subcategoryId) || '~'}`;
    porBloque.set(k, [...(porBloque.get(k) ?? []), p]);
  }
  for (const [k, grupo] of [...porBloque.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    if (grupo.length > um.maxGrupoSimilitud) { omitidos.push({ bloque: k, productos: grupo.length }); continue; }
    const toks = grupo.map((p) => tokensDe(p.title));
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const a = grupo[i];
        const b = grupo[j];
        if (a.id === b.id || tituloNormalizado(a.title) === tituloNormalizado(b.title) || !mismaOferta(a, b) || !precioCerca(a, b, um.toleranciaPrecioSimilar)) continue;
        if (!mismosConDigitos(toks[i], toks[j])) continue;
        const sb = new Set(toks[j]);
        const sa = new Set(toks[i]);
        const diferencia = [...toks[i].filter((x) => !sb.has(x)), ...toks[j].filter((x) => !sa.has(x))];
        if (!diferencia.length) { registrar(a, b, 'titulo_mismos_terminos', 1); continue; }
        if (diferencia.every((x) => PALABRAS_RELLENO.includes(x))) {
          const s = jaccard(toks[i], toks[j]);
          if (s >= um.similitudMinima) registrar(a, b, 'titulo_similar_mismo_comercio', Math.round(s * 100) / 100);
        }
      }
    }
  }
  pares.sort((x, y) => cmp(x.a.id, y.a.id) || cmp(x.b.id, y.b.id));
  const vistos = new Set();
  const unicosInformativos = informativos.filter((p) => (vistos.has(p.id) ? false : vistos.add(p.id)));
  return { pares, informativos: unicosInformativos, omitidos };
}

/* ───────────────────────── Prioridad ───────────────────────── */

export const BANDAS = [['P1', 80], ['P2', 50], ['P3', 20], ['P4', 0]];
export const bandaDePuntuacion = (n) => (BANDAS.find(([, minimo]) => n >= minimo) ?? BANDAS[BANDAS.length - 1])[0];

/** Factor del producto (sólo datos del feed): +0,25 con stock, +0,25 con descuento verificado, +0,25 en el cuartil de precio superior, −0,5 si está agotado. */
export function factorProducto(p, ctx) {
  let f = 1;
  if (p.stock === 'in_stock' || p.stock === 'low_stock') f += 0.25;
  if (p.stock === 'out_of_stock') f -= 0.5;
  if (p.verifiedDiscount) f += 0.25;
  const precio = num(p.price);
  if (precio !== null && precio >= ctx.p75) f += 0.25;
  return Math.min(1.75, Math.max(0.5, f));
}
export function puntuar(regla, p, ctx) {
  return Math.round(PESO_GRAVEDAD[regla.gravedad] * CERTEZAS[regla.certeza] * factorProducto(p, ctx));
}

/* ───────────────────────── Análisis del feed ───────────────────────── */

const resumenProducto = (p) => ({ id: idDe(p), titulo: recortar(p.title, 80), red: texto(p.network) || null, comercio: texto(p.merchant) || null, categoria: texto(p.category) || null });

/**
 * Analiza el feed ya leído. Devuelve { incidencias, pares, estadisticas }. Cada incidencia lleva además de los campos del Auditor: `certeza`, `prioridad`, `puntuacion`,
 * `producto` (las de ficha) y `regla`. Las del conjunto (feed incompleto, reducción brusca) y las no verificables usan el área `catalogo`.
 */
export function analizarCalidad(feed, cfg, ahoraIso) {
  const um = umbrales(cfg);
  const incidencias = [];
  const productos = feed.productos.filter(esProducto);
  const grupo = (area, regla, ids, detalle, evidencia, gravedad, certeza) => incidencias.push({ ...incidencia(area, regla.codigo, gravedad ?? regla.gravedad, `${regla.titulo} (${ids.length})`, detalle, { total: ids.length, ejemplos: ejemplos(ids, um.maxEjemplos), ...(evidencia ?? {}) }, regla.accion), clase: regla.clase, ambito: 'datos', certeza: certeza ?? regla.certeza, regla: regla.codigo, prioridad: null, puntuacion: 0 });

  // Conjunto: estado de la lectura
  if (!productos.length) {
    const motivo = feed.motivoFallo === 'credencial_no_valida' ? 'La credencial fue rechazada (HTTP 401/403): puede estar caducada o revocada.' : feed.motivoFallo === 'limite_de_peticiones' ? 'Se superó el límite de peticiones del cliente (HTTP 429).' : feed.motivoFallo === 'tiempo_agotado' ? 'La petición al feed agotó el tiempo de espera.' : feed.total === 0 ? 'El feed no devuelve productos.' : 'No se pudo leer ninguna página del feed.';
    incidencias.push({ ...incidencia('catalogo', 'feed_no_disponible', 'alta', 'No se pudo leer el catálogo', `${motivo} ${feed.errores.join(' · ')}`.trim(), { errores: feed.errores, motivo: feed.motivoFallo ?? (feed.total === 0 ? 'vacio' : 'sin_paginas') }, 'Revisar la credencial de lectura y el servicio; no se guarda esta ejecución.'), clase: 'disponibilidad', ambito: 'datos', certeza: 'confirmado', regla: 'feed_no_disponible', prioridad: null, puntuacion: 0 });
    return { incidencias, pares: [], estadisticas: { porRegla: {}, porRed: {}, porCerteza: {}, informativos: 0, omitidosSimilitud: [] } };
  }
  if (!feed.completo) {
    const partes = [...feed.errores, ...feed.inconsistencias];
    incidencias.push({ ...incidencia('catalogo', 'feed_parcial', 'media', 'La lectura del catálogo no está completa', partes.join(' · ') || 'La lectura no se pudo comprobar completa.', { errores: feed.errores, inconsistencias: feed.inconsistencias, paginasLeidas: feed.paginasLeidas, totalPaginas: feed.totalPaginas, productosLeidos: productos.length, total: feed.total }, 'Repetir la ejecución. Esta ejecución no se guarda y no resuelve incidencias de fichas que no se leyeron.'), clase: 'disponibilidad', ambito: 'datos', certeza: 'confirmado', regla: 'feed_parcial', prioridad: null, puntuacion: 0 });
  }
  if (feed.repetidos.length && feed.completo) {
    const regla = REGLA.id_duplicado;
    for (const id of feed.repetidos) {
      const p = productos.find((x) => idDe(x) === id);
      incidencias.push({ ...incidencia('ficha', regla.codigo, regla.gravedad, regla.titulo, `El identificador aparece ${productos.filter((x) => idDe(x) === id).length} veces en el feed.`, { id }, regla.accion, id), clase: regla.clase, ambito: 'datos', certeza: regla.certeza, regla: regla.codigo, producto: resumenProducto(p), prioridad: null, puntuacion: 0 });
    }
  }
  // Fichas
  const ctx = contextoDe(productos, um);
  const porId = new Map();
  for (const p of productos) if (!porId.has(idDe(p))) porId.set(idDe(p), p);
  const unicos = [...porId.values()].sort((a, b) => cmp(idDe(a), idDe(b)));
  const dup = detectarDuplicados(unicos, um);
  const pareja = new Map();
  for (const par of dup.pares) if (!pareja.has(par.a.id)) pareja.set(par.a.id, par);
  for (const p of unicos) {
    const id = idDe(p);
    const hallazgos = evaluarFicha(p, ctx, um, ahoraIso, new Set(camposNoEntregados(p)));
    const par = pareja.get(id);
    if (par) hallazgos.push({ codigo: 'posible_duplicado', detalle: `${par.motivo} Con ${par.b.id}.`, evidencia: { con: par.b.id, tipo: par.tipo, similitud: par.similitud } });
    for (const h of hallazgos) {
      const regla = REGLA[h.codigo];
      const puntos = puntuar(regla, p, ctx);
      incidencias.push({ ...incidencia('ficha', regla.codigo, regla.gravedad, regla.titulo, h.detalle, h.evidencia, regla.accion, id), clase: regla.clase, ambito: 'datos', certeza: regla.certeza, regla: regla.codigo, producto: resumenProducto(p), prioridad: bandaDePuntuacion(puntos), puntuacion: puntos });
    }
  }

  // Datos que el feed no permite verificar (agregados; no puntúan)
  const nv = noVerificables(unicos, ctx, um);
  for (const regla of REGLAS_CALIDAD.filter((r) => r.certeza === 'no_verificable' && r.codigo !== 'titulo_igual_no_duplicado')) {
    const lista = nv[regla.codigo] ?? [];
    if (!lista.length) continue;
    const extra = { porRed: porRedDe(lista) };
    if (regla.codigo === 'campo_no_entregado') { extra.campos = {}; for (const p of lista) for (const c of camposNoEntregados(p)) extra.campos[c] = (extra.campos[c] ?? 0) + 1; }
    grupo('catalogo', regla, lista.map((p) => idDe(p)).sort(), `${lista.length} de ${unicos.length} productos.`, extra);
  }
  if (dup.informativos.length) grupo('catalogo', REGLA.titulo_igual_no_duplicado, dup.informativos.map((p) => idDe(p)).sort(), `${dup.informativos.length} productos comparten título con otro de otro comercio o con otro precio: no se consideran duplicados.`, { porRed: porRedDe(dup.informativos) });

  const ordenadas = ordenarIncidencias(incidencias);
  const porRegla = {};
  const porCerteza = {};
  const porRed = {};
  for (const i of ordenadas) {
    porRegla[i.regla] = (porRegla[i.regla] ?? 0) + (i.area === 'catalogo' && i.evidencia && Number.isFinite(i.evidencia.total) ? i.evidencia.total : 1);
    porCerteza[i.certeza] = (porCerteza[i.certeza] ?? 0) + 1;
    if (i.area === 'ficha' && i.producto && i.certeza !== 'no_verificable') porRed[i.producto.red ?? '~'] = (porRed[i.producto.red ?? '~'] ?? 0) + 1;
  }
  return { incidencias: ordenadas, pares: dup.pares.slice(0, um.maxParesInforme), estadisticas: { porRegla, porCerteza, porRed, informativos: dup.informativos.length, omitidosSimilitud: dup.omitidos, totalPares: dup.pares.length } };
}

/* ───────────────────────── Informe ───────────────────────── */

/** Incidencia de reducción brusca del catálogo (necesita el historial, por eso no forma parte del análisis del feed). null si no procede. */
export function incidenciaReduccionBrusca(feed, cfg, fichasPrevias) {
  const um = umbrales(cfg);
  const n = feed.productos.length;
  if (!(feed.completo && Number.isInteger(fichasPrevias) && fichasPrevias >= um.reduccionBruscaMinimo && n < fichasPrevias * um.reduccionBruscaFraccion)) return null;
  return { ...incidencia('catalogo', 'reduccion_brusca', 'alta', 'El catálogo se ha reducido bruscamente', `Se leyeron ${n} productos y la última auditoría completa tenía ${fichasPrevias}.`, { total: n, anterior: fichasPrevias }, 'Comprobar que no ha habido un borrado o una importación errónea. Las incidencias de fichas que ya no están quedan «no verificadas», no «resueltas».'), clase: 'integridad_datos', ambito: 'datos', certeza: 'confirmado', regla: 'reduccion_brusca', prioridad: null, puntuacion: 0 };
}

const ETIQUETA_BANDA = { P1: 'P1 · Prioridad máxima', P2: 'P2 · Prioridad alta', P3: 'P3 · Prioridad media', P4: 'P4 · Prioridad baja' };

/** Número de fichas de la última instantánea COMPLETA del historial (para detectar una reducción brusca). null si no hay. */
export function fichasDeLaUltimaCompleta(historial, entorno) {
  let mejor = null;
  for (const f of Array.isArray(historial) ? historial : []) {
    if (!f || typeof f.payload !== 'string' || f.entorno !== entorno || bytesUtf8(f.payload) > LIMITES_PERSISTENCIA.maxBytesInstantanea) continue;
    let inst = null;
    try { inst = JSON.parse(f.payload); } catch (e) { inst = null; }
    if (!inst || !inst.calidad || inst.calidad.estado !== 'completa' || !inst.alcance || !Array.isArray(inst.alcance.fichas) || typeof inst.generadoEn !== 'string') continue;
    if (!mejor || inst.generadoEn > mejor.generadoEn) mejor = { generadoEn: inst.generadoEn, fichas: inst.alcance.fichas.length };
  }
  return mejor ? mejor.fichas : null;
}

/** Alcance para el motor de seguimiento: «salud» = la fuente (el feed) respondió; `fichas` = ids LEÍDOS (sólo esas incidencias pueden darse por resueltas). */
function alcanceDe(cfg, feed) {
  const host = String(cfg.hostsPermitidos[0]).toLowerCase();
  const ids = [...new Set(feed.productos.filter(esProducto).map((p) => idDe(p)))].sort();
  const pedidas = feed.peticiones;
  return {
    host,
    salud: feed.productos.length > 0,
    rutas: [],
    enlaces: [],
    fichas: ids,
    contenido: { rutas: [], fichas: [] },
    catalogo: { leido: feed.productos.length > 0, completo: feed.completo },
    sinRespuesta: feed.errores.map((e) => ({ tipo: 'catalogo', destino: e.slice(0, 60), motivo: feed.motivoFallo ?? 'error_de_lectura' })),
    incompletas: [],
    resumen: { solicitadas: pedidas, respondieron: feed.paginasLeidas, correctas: feed.paginasLeidas, sinRespuesta: feed.errores.length, incompletas: 0, noVisitados: 0 },
  };
}

/**
 * Construye el informe y, si procede, la fila de historial, a partir de un ANÁLISIS ya hecho (nodo «Analizar»). Es lo que ejecuta el nodo «Informe»: no lee el feed ni aplica reglas, sólo
 * añade la reducción brusca (necesita el historial), calcula el seguimiento y compone el informe. `entrada`: { cfg, feed, analisis, ahoraIso, persistencia?: { tablas, historial, idEjecucion, origen },
 * estadoAnterior?, instantaneaAnterior? } (las dos últimas sólo para pruebas). El seguimiento se calcula con TODAS las incidencias; el informe lista las `maxIncidenciasInforme` de mayor
 * prioridad (el resto se cuenta, no se pierde).
 */
export function construirInformeDesdeAnalisis(entrada) {
  const { cfg, feed, analisis, ahoraIso } = entrada;
  const errCfg = validarConfigCalidad(cfg);
  if (errCfg.length) throw new Error(`configuración del agente de calidad no válida: ${errCfg.join('; ')}`);
  const um = umbrales(cfg);
  const per = entrada.persistencia;
  const reduccion = per ? incidenciaReduccionBrusca(feed, cfg, fichasDeLaUltimaCompleta(per.historial, cfg.entorno)) : null;
  const todas = (reduccion ? ordenarIncidencias([...analisis.incidencias, reduccion]) : analisis.incidencias).map((i) => ({ ...i }));
  const estadisticas = { ...analisis.estadisticas, porRegla: { ...analisis.estadisticas.porRegla, ...(reduccion ? { reduccion_brusca: 1 } : {}) } };
  const alcance = alcanceDe(cfg, feed);
  const contador = resumenIncidencias(todas);
  const porCerteza = { confirmado: 0, advertencia: 0, no_verificable: 0 };
  for (const i of todas) porCerteza[i.certeza] = (porCerteza[i.certeza] ?? 0) + 1;
  const productosConIncidencias = new Set(todas.filter((i) => i.area === 'ficha' && i.certeza !== 'no_verificable').map((i) => i.producto.id)).size;
  const porPrioridad = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const i of todas) if (i.prioridad) porPrioridad[i.prioridad] += 1;
  const informeCompleto = {
    esquema: ESQUEMA_INFORME_CALIDAD,
    agente: AGENTE_CALIDAD,
    version: VERSION_CALIDAD,
    entorno: cfg.entorno,
    modo: cfg.modo,
    generadoEn: ahoraIso,
    soloLectura: true,
    fuente: { esquemaFeed: 'automation-catalog/1', paginasPedidas: feed.paginasPedidas, paginasLeidas: feed.paginasLeidas, totalPaginas: feed.totalPaginas, total: feed.total, productosLeidos: feed.productos.length, completo: feed.completo, errores: feed.errores.slice(0, 10), inconsistencias: feed.inconsistencias },
    resumen: {
      estado: feed.completo ? estadoGlobal(contador) : 'incompleto',
      peticiones: feed.peticiones,
      productos: feed.productos.length,
      productosConIncidencias,
      incidencias: contador,
      confirmados: porCerteza.confirmado,
      advertencias: porCerteza.advertencia,
      noVerificables: porCerteza.no_verificable,
      porPrioridad,
      porRegla: estadisticas.porRegla,
      porRed: estadisticas.porRed,
      incidenciasMostradas: 0,
      incidenciasOmitidas: 0,
    },
    incidencias: todas,
    pares: analisis.pares,
    alcance,
    cobertura: {
      revisado: [`${feed.productos.length} productos del feed automation-catalog/1 (${feed.paginasLeidas} de ${feed.totalPaginas ?? '?'} páginas)`, 'reglas por ficha: precio, título, categoría, imagen, descripción, valoración, enlace de afiliación, fechas y posibles duplicados'],
      noRevisado: [
        'Que las imágenes carguen realmente: el agente no hace peticiones a imágenes (sólo ve su dirección)',
        'Si un descuento declarado es real: sólo consta el verificado que entrega el feed',
        'Stock, tráfico y conversión: el feed no los permite evaluar (la prioridad no incluye visitas)',
        'Fichas, rutas, enlaces y salud del sitio: responsabilidad del Auditor General',
        ...(estadisticas.omitidosSimilitud.length ? [`Comparación de títulos similares omitida en ${estadisticas.omitidosSimilitud.length} bloque(s) demasiado grandes`] : []),
      ],
    },
    markdown: '',
  };
  let fila = null;
  const host = alcance.host;
  const opcionesSeg = { host, limites: LIMITES_SEGUIMIENTO_CALIDAD };
  if (per) {
    const nombre = cfg.seguimiento && cfg.seguimiento.tabla;
    const tabla = nombre ? estadoDeTabla(per.tablas, nombre) : 'sin_configurar';
    const lecturaConError = (per.historial || []).some((x) => x && x.error !== undefined && x.idEjecucion === undefined);
    const usable = tabla === 'ok' && !lecturaConError;
    const opc = { ...opcionesSeg, idEjecucion: per.idEjecucion, origen: per.origen, persistencia: { origenesValidos: cfg.seguimiento && cfg.seguimiento.origenesValidos } };
    if (!opc.persistencia.origenesValidos) delete opc.persistencia.origenesValidos;
    const r = usable ? ejecutarSeguimientoConHistorial(per.historial, informeCompleto, opc) : null;
    fila = r ? r.fila : null;
    let guardar = Boolean(r && r.guardar);
    let motivoGuardado = r ? r.motivoGuardado : 'persistencia_no_disponible';
    // La instantánea es de ESTE agente: se etiqueta (el motor la rotula con el nombre del Auditor) y se vuelve a comprobar su tamaño.
    if (fila) {
      const rotulada = { ...r.instantanea, agente: AGENTE_CALIDAD };
      const payload = JSON.stringify(rotulada);
      if (bytesUtf8(payload) > LIMITES_PERSISTENCIA.maxBytesInstantanea) { fila = null; guardar = false; motivoGuardado = 'instantanea_demasiado_grande'; } else fila = { ...fila, payload };
    }
    informeCompleto.seguimiento = r ? { ...r.seguimiento, origenReferencia: r.previo.estado ? 'historial' : 'ninguna' } : { ...ejecutarSeguimiento(null, informeCompleto, opcionesSeg).seguimiento, origenReferencia: 'ninguna' };
    informeCompleto.persistencia = {
      tabla: { nombre: nombre || '', estado: lecturaConError && tabla === 'ok' ? 'error_lectura' : tabla },
      lectura: r ? { filas: r.previo.leidas, validas: r.previo.validas, duplicadas: r.previo.duplicadas, descartadas: r.previo.descartadas.length, ultimaInstantanea: r.previo.ultimaGeneradoEn } : { filas: 0, validas: 0, duplicadas: 0, descartadas: 0, ultimaInstantanea: null },
      escritura: { guardar, motivo: motivoGuardado, origen: String(per.origen), idEjecucion: String(per.idEjecucion), resultado: guardar ? 'pendiente' : 'no_procede' },
    };
  } else {
    const ia = entrada.instantaneaAnterior;
    const referencia = entrada.estadoAnterior ?? (ia ? estadoDesdeInstantanea(ia.esquema === 1 ? ia : resumirInstantanea(ia, opcionesSeg), opcionesSeg) : null);
    informeCompleto.seguimiento = { ...ejecutarSeguimiento(referencia, informeCompleto, opcionesSeg).seguimiento, origenReferencia: entrada.estadoAnterior ? 'estado' : ia ? 'instantanea' : 'ninguna' };
  }
  // Prioridad: una ADVERTENCIA que persiste de una auditoría a otra sube un 25 % su puntuación (una sola vez) y puede cambiar de banda.
  const persistentes = new Set((informeCompleto.seguimiento.persistentes || []).map((x) => x.clave));
  if (persistentes.size) {
    for (const i of todas) {
      if (i.certeza === 'advertencia' && persistentes.has(claveSeguimiento(i, opcionesSeg)) && i.puntuacion > 0) {
        i.puntuacion = Math.round(i.puntuacion * 1.25);
        i.prioridad = bandaDePuntuacion(i.puntuacion);
        i.persistente = true;
      }
    }
    for (const b of Object.keys(porPrioridad)) porPrioridad[b] = 0;
    for (const i of todas) if (i.prioridad) porPrioridad[i.prioridad] += 1;
  }
  // Lista del informe: por prioridad y puntuación; el tope sólo afecta a lo que se MUESTRA.
  const mostrar = [...todas].sort((a, b) => b.puntuacion - a.puntuacion || cmp(a.id, b.id)).slice(0, um.maxIncidenciasInforme);
  // Las listas del seguimiento también se acotan (con miles de incidencias el informe crecería sin límite): el recuento completo queda en `seguimiento.resumen` y lo recortado en `seguimiento.omitidas`.
  const seguimiento = { ...informeCompleto.seguimiento };
  const omitidas = {};
  for (const k of ['nuevas', 'persistentes', 'resueltas', 'noVerificadas', 'reaparecidas', 'indeterminadas', 'caducadas']) {
    if (Array.isArray(seguimiento[k]) && seguimiento[k].length > um.maxSeguimientoLista) { omitidas[k] = seguimiento[k].length - um.maxSeguimientoLista; seguimiento[k] = seguimiento[k].slice(0, um.maxSeguimientoLista); }
  }
  if (Object.keys(omitidas).length) seguimiento.omitidas = omitidas;
  const informe = { ...informeCompleto, incidencias: mostrar, seguimiento, resumen: { ...informeCompleto.resumen, porPrioridad, incidenciasMostradas: mostrar.length, incidenciasOmitidas: todas.length - mostrar.length } };
  informe.markdown = informeMarkdownCalidad(informe);
  return { informe, fila };
}

/**
 * Todo en uno (pruebas y ejecución local): lee el feed, lo analiza y construye el informe. `entrada`: { cfg, objetivosCatalogo, respuestasCatalogo, objetivosCatalogoResto,
 * respuestasCatalogoResto, ahoraIso, persistencia?, estadoAnterior?, instantaneaAnterior? }. En n8n lo hacen dos nodos: «Analizar» (feed + reglas) e «Informe» (seguimiento + informe).
 */
export function construirInformeCalidadYFila(entrada) {
  const { cfg, objetivosCatalogo: o1 = [], respuestasCatalogo: r1 = [], objetivosCatalogoResto: o2 = [], respuestasCatalogoResto: r2 = [], ahoraIso } = entrada;
  const errCfg = validarConfigCalidad(cfg);
  if (errCfg.length) throw new Error(`configuración del agente de calidad no válida: ${errCfg.join('; ')}`);
  const feed = leerFeedCalidad([...o1, ...o2], [...r1, ...r2], cfg);
  const analisis = analizarCalidad(feed, cfg, ahoraIso);
  return construirInformeDesdeAnalisis({ ...entrada, feed, analisis });
}

/** Informe del agente (sin la fila). */
export function construirInformeCalidad(entrada) {
  return construirInformeCalidadYFila(entrada).informe;
}

/* ───────────────────────── Markdown ───────────────────────── */

/** Texto procedente del feed o de errores, apto para Markdown: sin HTML, comillas invertidas ni barras que rompan la tabla o el formato. */
const md = (t) => String(t ?? '').replace(/[<>`|]/g, ' ').replace(/\s+/g, ' ').trim();

export function informeMarkdownCalidad(informe) {
  const l = [];
  const r = informe.resumen;
  l.push(`# Calidad del catálogo — ${informe.entorno} (${informe.generadoEn.slice(0, 16).replace('T', ' ')} UTC)`);
  l.push('');
  l.push(`**Estado:** ${r.estado.toUpperCase()} · **Sólo lectura** · versión ${informe.version} · modo ${informe.modo}`);
  l.push(`**Lectura del feed:** ${informe.fuente.productosLeidos} productos, ${informe.fuente.paginasLeidas} de ${informe.fuente.totalPaginas ?? '?'} páginas · ${informe.fuente.completo ? '**completa**' : '**INCOMPLETA: esta ejecución no se guarda ni resuelve incidencias**'}`);
  for (const e of informe.fuente.errores) l.push(`- ⚠ ${md(e)}`);
  for (const e of informe.fuente.inconsistencias) l.push(`- ⚠ ${md(e)}`);
  l.push(`**Resultados:** ${r.confirmados} defectos confirmados · ${r.advertencias} advertencias · ${r.noVerificables} datos no verificables · ${r.productosConIncidencias} productos con incidencias de ${r.productos}`);
  l.push(`**Prioridad:** P1 ${r.porPrioridad.P1} · P2 ${r.porPrioridad.P2} · P3 ${r.porPrioridad.P3} · P4 ${r.porPrioridad.P4}`);
  l.push('');
  const dePorBanda = (banda) => informe.incidencias.filter((i) => i.prioridad === banda);
  for (const banda of ['P1', 'P2', 'P3', 'P4']) {
    const lista = dePorBanda(banda);
    if (!lista.length) continue;
    l.push(`## ${ETIQUETA_BANDA[banda]} (${lista.length})`);
    for (const i of lista.slice(0, 25)) l.push(`- \`${md(i.producto ? i.producto.id : i.id)}\` **${i.titulo}** [${i.certeza}] — ${md(i.detalle)} _Acción: ${i.accionSugerida}_`);
    if (lista.length > 25) l.push(`- … y ${lista.length - 25} más (ver JSON).`);
    l.push('');
  }
  const conjunto = informe.incidencias.filter((i) => i.area === 'catalogo' && i.certeza !== 'no_verificable');
  if (conjunto.length) {
    l.push('## Estado del catálogo');
    for (const i of conjunto) l.push(`- **${i.titulo}** (${i.gravedad}) — ${md(i.detalle)} _Acción: ${i.accionSugerida}_`);
    l.push('');
  }
  if (informe.pares.length) {
    l.push(`## Posibles duplicados (${informe.pares.length}) — revisar; no se propone eliminar nada`);
    for (const p of informe.pares.slice(0, 15)) l.push(`- \`${md(p.a.id)}\` «${md(p.a.titulo)}» (${p.a.precio ?? 's/p'} €) ↔ \`${md(p.b.id)}\` «${md(p.b.titulo)}» (${p.b.precio ?? 's/p'} €) — ${p.motivo}`);
    if (informe.pares.length > 15) l.push(`- … y ${informe.pares.length - 15} más (ver JSON).`);
    l.push('');
  }
  const nv = informe.incidencias.filter((i) => i.certeza === 'no_verificable');
  if (nv.length) {
    l.push('## Datos que el feed no permite verificar (no son defectos)');
    for (const i of nv) l.push(`- **${i.titulo}** — ${md(i.detalle)} _${i.accionSugerida}_`);
    l.push('');
  }
  if (!informe.incidencias.length) l.push('Sin incidencias.\n');
  if (r.incidenciasOmitidas) l.push(`_Se muestran ${r.incidenciasMostradas} incidencias de ${r.incidenciasMostradas + r.incidenciasOmitidas}; el resto se cuenta en el resumen y en el seguimiento._\n`);
  if (informe.seguimiento) l.push(...markdownSeguimiento(informe.seguimiento, informe.persistencia));
  l.push('## Cobertura');
  l.push(`- Revisado: ${informe.cobertura.revisado.join('; ') || '—'}`);
  l.push(`- **No revisado:** ${informe.cobertura.noRevisado.join('; ') || '—'}`);
  return l.join('\n');
}

/**
 * CONFIRMACIÓN de la escritura (misma regla que la del Auditor): sólo es «guardada» si el Insert devolvió la fila (id numérico y NUESTRO idEjecucion). Si no, «fallida».
 * Duplica a propósito la lógica de `confirmarEscritura` del Auditor (que regenera el Markdown del Auditor) para no tocar sus workflows.
 */
export function confirmarEscrituraCalidad(informe, salidaInsert) {
  const p = informe && informe.persistencia;
  if (!p || !p.escritura || !p.escritura.guardar) return informe;
  const lista = (Array.isArray(salidaInsert) ? salidaInsert : []).filter((x) => x && typeof x === 'object');
  const fila = lista.find((x) => Number.isFinite(Number(x.id)) && x.idEjecucion === p.escritura.idEjecucion);
  const conError = lista.find((x) => x.error !== undefined && x.error !== null);
  const textoError = conError ? recortar(typeof conError.error === 'string' ? conError.error : (conError.error && conError.error.message) || JSON.stringify(conError.error), 200) : '';
  const escritura = fila
    ? { ...p.escritura, resultado: 'guardada', filaId: Number(fila.id) }
    : { ...p.escritura, resultado: 'fallida', motivoFallo: conError ? 'error_insert' : 'sin_confirmacion', error: conError ? textoError : 'el Insert no devolvió la fila guardada (la Data table no confirmó la escritura)' };
  const nuevo = { ...informe, persistencia: { ...p, escritura } };
  nuevo.markdown = informeMarkdownCalidad(nuevo);
  return nuevo;
}
