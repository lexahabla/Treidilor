// Datos sintéticos compartidos por las pruebas del Agente 04 (no es una prueba). Sin red, sin credenciales reales.
export const TABLA = 'calidad_catalogo_instantaneas';
export const AHORA = '2026-11-14T10:00:00.000Z';
export const dia = (n, h = 0) => new Date(Date.parse(AHORA) + n * 86400000 + h * 3600000).toISOString();
export const plano = (x) => JSON.parse(JSON.stringify(x));
export const TABLAS_OK = [{ id: 'T1', name: TABLA }];

export const CFG_PROD = {
  entorno: 'produccion', baseUrl: 'https://treidilor.com', hostsPermitidos: ['treidilor.com'], modo: 'lectura_catalogo',
  maxPaginasCatalogo: 8, limitePorPagina: 100, peticionesPorMinuto: 10, pausaMs: 7000, credencialCatalogo: 'Treidilor — Catálogo (solo lectura)', umbrales: {},
  seguimiento: { tabla: TABLA, maxHistorial: 60, origenesValidos: ['manual', 'programada'] },
};
export const CFG_LOCAL = { ...CFG_PROD, entorno: 'local', baseUrl: 'http://puente-treidilor:4350', hostsPermitidos: ['puente-treidilor:4350'] };
export const cfg = (over = {}) => ({ ...CFG_LOCAL, ...over });

let n = 0;
/** Producto sano del feed `automation-catalog/1` (todos los campos del contrato). */
export const prod = (over = {}) => {
  n += 1;
  return {
    id: `p${String(n).padStart(5, '0')}`, title: `Auriculares inalámbricos modelo X${n} con cancelación de ruido`, category: 'Sonido', categoryId: 'sonido', subcategoryId: 'auriculares',
    network: 'amazon', merchant: 'Tienda Uno', price: 50 + (n % 40), currency: 'EUR', declaredPreviousPrice: null, verifiedDiscount: null, stock: 'in_stock', rating: 4.2, reviewsCount: 35, ratingFlag: null,
    image: `/images/products/p${n}.jpg`, descriptionLength: 400, hasAffiliateLink: true, capturedAt: dia(-2), verifiedAt: dia(-3), addedAt: dia(-40), ...over,
  };
};
export const catalogo = (k, over = () => ({})) => Array.from({ length: k }, (_, i) => prod(over(i)));

/** Páginas del feed tal como las devuelve el nodo HTTP de n8n. `paginas` limita cuántas se devuelven; `total` fuerza el total declarado. */
export const respuestasDe = (productos, limit = 100, { total = productos.length, paginas = null, totalPages = null } = {}) => {
  const tp = totalPages ?? Math.ceil(total / limit);
  const objetivos = [];
  const respuestas = [];
  for (let page = 1; page <= (paginas ?? Math.max(1, Math.ceil(productos.length / limit))); page++) {
    objetivos.push({ id: `catalogo:${page}`, tipo: 'catalogo', url: `http://puente-treidilor:4350/api/automation/v1/catalog?limit=${limit}&page=${page}`, pagina: page });
    respuestas.push({ statusCode: 200, body: JSON.stringify({ success: true, schema: 'automation-catalog/1', total, page, limit, totalPages: tp, products: productos.slice((page - 1) * limit, page * limit) }) });
  }
  return { objetivos, respuestas };
};
export const entradaDe = (productos, extra = {}) => {
  const { objetivos, respuestas } = respuestasDe(productos, extra.limit ?? 100, extra.feed ?? {});
  return { cfg: extra.cfg ?? cfg(), objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: extra.ahoraIso ?? AHORA, ...(extra.persistencia ? { persistencia: extra.persistencia } : {}) };
};
export const filaDe = (fila, id) => ({ id, ...fila });

/** Generador pseudoaleatorio determinista (mulberry32). */
export const semilla = (s) => () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Congela un objeto en profundidad: cualquier escritura posterior lanza en módulos ES (modo estricto). */
export const congelar = (x) => {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) congelar(v); }
  return x;
};
