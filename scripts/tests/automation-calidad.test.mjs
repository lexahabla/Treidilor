// Agente 04 — Calidad del catálogo, ETAPA 1: motor local y política de lectura del feed. Sin red, sin n8n, sin Docker, sin credenciales reales.
// Cubre: política de URLs `lectura_catalogo`, lectura e integridad del feed, reglas por ficha (confirmado / advertencia / no verificable), duplicados conservadores,
// prioridad, informe `informe-calidad/1`, compatibilidad con el motor de seguimiento, determinismo, límites de tamaño y NO regresión del Auditor General.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const J = (p) => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));
const Q = await import('../../automation/lib/calidadCatalogo.mjs');
const P = await import('../../automation/lib/urlPolicyCalidad.mjs');
const UP = await import('../../automation/lib/urlPolicy.mjs');
const COM = await import('../../automation/lib/common.mjs');
const SEG = await import('../../automation/lib/seguimiento.mjs');
const { validarEsquema } = await import('../automation/validate-schema.mjs');
const { empaquetar } = await import('../automation/build-workflows.mjs');

const SCHEMA = J('automation/schemas/informe-calidad.schema.json');
const TABLA = 'calidad_catalogo_instantaneas';
const AHORA = '2026-11-14T10:00:00.000Z';
const dia = (n, h = 0) => new Date(Date.parse(AHORA) + n * 86400000 + h * 3600000).toISOString();
const plano = (x) => JSON.parse(JSON.stringify(x));

const CFG_PROD = {
  entorno: 'produccion', baseUrl: 'https://treidilor.com', hostsPermitidos: ['treidilor.com'], modo: 'lectura_catalogo',
  maxPaginasCatalogo: 8, limitePorPagina: 100, peticionesPorMinuto: 10, pausaMs: 7000, credencialCatalogo: 'Treidilor — Catálogo (solo lectura)', umbrales: {},
  seguimiento: { tabla: TABLA, maxHistorial: 60, origenesValidos: ['manual', 'programada'] },
};
const CFG_LOCAL = { ...CFG_PROD, entorno: 'local', baseUrl: 'http://puente-treidilor:4350', hostsPermitidos: ['puente-treidilor:4350'] };
const cfg = (over = {}) => ({ ...CFG_LOCAL, ...over });

/* ───────── fixtures ───────── */
let n = 0;
const prod = (over = {}) => {
  n += 1;
  return {
    id: `p${String(n).padStart(4, '0')}`, title: `Auriculares inalámbricos modelo X${n} con cancelación de ruido`, category: 'Sonido', categoryId: 'sonido', subcategoryId: 'auriculares',
    network: 'amazon', merchant: 'Tienda Uno', price: 50 + (n % 40), currency: 'EUR', declaredPreviousPrice: null, verifiedDiscount: null, stock: 'in_stock', rating: 4.2, reviewsCount: 35, ratingFlag: null,
    image: `/images/products/p${n}.jpg`, descriptionLength: 400, hasAffiliateLink: true, capturedAt: dia(-2), verifiedAt: dia(-3), addedAt: dia(-40), ...over,
  };
};
const catalogo = (k, over = (i) => ({})) => Array.from({ length: k }, (_, i) => prod(over(i)));
const respuestasDe = (productos, limit = 100, { total = productos.length, paginas = null } = {}) => {
  const totalPages = Math.ceil(total / limit);
  const out = [];
  const objetivos = [];
  for (let page = 1; page <= (paginas ?? totalPages); page++) {
    objetivos.push({ id: `catalogo:${page}`, tipo: 'catalogo', url: `http://puente-treidilor:4350/api/automation/v1/catalog?limit=${limit}&page=${page}`, pagina: page });
    out.push({ statusCode: 200, body: JSON.stringify({ success: true, schema: 'automation-catalog/1', total, page, limit, totalPages, products: productos.slice((page - 1) * limit, page * limit) }) });
  }
  return { objetivos, respuestas: out };
};
const entradaDe = (productos, extra = {}) => {
  const { objetivos, respuestas } = respuestasDe(productos, extra.limit ?? 100, extra.feed ?? {});
  return { cfg: extra.cfg ?? cfg(), objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: extra.ahoraIso ?? AHORA, ...(extra.persistencia ? { persistencia: extra.persistencia } : {}) };
};
const informeDe = (productos, extra) => Q.construirInformeCalidad(entradaDe(productos, extra));
const hallazgos = (informe, codigo) => informe.incidencias.filter((i) => i.regla === codigo);
const deFicha = (informe, codigo, id) => informe.incidencias.find((i) => i.regla === codigo && i.producto && i.producto.id === id);
const TABLAS_OK = [{ id: 'T1', name: TABLA }];
const filaDe = (fila, id) => ({ id, ...fila });

/* ═════════ 1. Política de URLs `lectura_catalogo` ═════════ */
const U = (u, c = CFG_PROD) => P.evaluarUrlCalidad(u, c);
const OK_URL = 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=2';

test('política: acepta únicamente la URL canónica del feed (https, host exacto, ruta, limit y page)', () => {
  assert.deepEqual(U(OK_URL), { ok: true, url: OK_URL });
  assert.deepEqual(U('https://TREIDILOR.com/api/automation/v1/catalog?limit=1&page=1'), { ok: true, url: 'https://treidilor.com/api/automation/v1/catalog?limit=1&page=1' }, 'el host se normaliza');
  assert.deepEqual(U('https://treidilor.com:443/api/automation/v1/catalog?limit=100&page=8'), { ok: true, url: 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=8' });
  assert.equal(U('http://puente-treidilor:4350/api/automation/v1/catalog?limit=100&page=1', CFG_LOCAL).ok, true, 'http sólo en local y sobre el host local declarado');
});

test('política: RECHAZA otros destinos, hosts, esquemas, puertos, rutas y formas de escribirlos', () => {
  const malos = [
    ['http://treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'http_fuera_de_local'],
    ['https://treidilor.com/api/automation/v1/me', 'ruta_no_permitida'],
    ['https://treidilor.com/api/health', 'ruta_no_permitida'],
    ['https://treidilor.com/api/v1/products?limit=100&page=1', 'ruta_no_permitida'],
    ['https://treidilor.com/api/admin/automation-clients', 'ruta_no_permitida'],
    ['https://treidilor.com/producto/p1', 'ruta_no_permitida'],
    ['https://treidilor.com/out/p1', 'ruta_no_permitida'],
    ['https://treidilor.com/api/automation/v1/catalog/', 'ruta_no_permitida'],
    ['https://treidilor.com/API/automation/v1/catalog?limit=100&page=1', 'ruta_no_permitida'],
    ['https://treidilor.com//api/automation/v1/catalog?limit=100&page=1', 'ruta_no_permitida'],
    ['https://treidilor.com/api/automation/v1/%63atalog?limit=100&page=1', 'ruta_no_permitida'],
    ['https://treidilor.com/api/automation/v1/../v1/catalog?limit=100&page=1', 'ruta_no_permitida'],
    ['https://evil.com/api/automation/v1/catalog?limit=100&page=1', 'host_no_permitido'],
    ['https://treidilor.com.evil.com/api/automation/v1/catalog?limit=100&page=1', 'host_no_permitido'],
    ['https://evil-treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'host_no_permitido'],
    ['https://treidilor.com./api/automation/v1/catalog?limit=100&page=1', 'host_no_permitido'],
    ['https://www.treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'host_no_permitido'],
    ['https://treidilor.com:8443/api/automation/v1/catalog?limit=100&page=1', 'host_no_permitido'],
    ['https://treidilor.com@evil.com/api/automation/v1/catalog?limit=100&page=1', 'credenciales_en_url'],
    ['https://user:pass@treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'credenciales_en_url'],
    ['ftp://treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'url_no_absoluta'],
    ['javascript:alert(1)', 'url_no_absoluta'],
    ['file:///etc/passwd', 'url_no_absoluta'],
    ['//treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'url_no_absoluta'],
    ['/api/automation/v1/catalog?limit=100&page=1', 'url_no_absoluta'],
    ['https://treidilor.com/api/automation/v1/catalog', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?page=1&limit=100', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1&category=sonido', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1&network=amazon', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1&limit=1', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1&sort=precio', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?category=sonido&limit=100&page=1', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=abc&page=1', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=1e2&page=1', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=-1&page=1', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1%00', 'parametros_no_permitidos'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=0&page=1', 'limit_fuera_de_rango'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=101&page=1', 'limit_fuera_de_rango'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=010&page=1', 'limit_fuera_de_rango'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=0', 'page_fuera_de_rango'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=9', 'page_fuera_de_rango'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=01', 'page_fuera_de_rango'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1#x', 'fragmento_no_permitido'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1 ', 'url_no_valida'],
    ['https://treidilor.com/api/automation/v1/catalog?limit=100&page=1\n', 'url_no_valida'],
    ['https://treidilor.com\\api\\automation\\v1\\catalog?limit=100&page=1', 'url_no_valida'],
    ['', 'url_no_valida'],
    [null, 'url_no_valida'],
    [42, 'url_no_valida'],
  ];
  for (const [url, motivo] of malos) {
    const r = U(url);
    assert.equal(r.ok, false, `debe rechazarse: ${JSON.stringify(url)}`);
    assert.equal(r.motivo, motivo, `motivo de ${JSON.stringify(url)}`);
  }
});

test('política: el entorno decide los hosts (local nunca treidilor.com; producción nunca hosts locales) y el tope de páginas sale de la configuración', () => {
  assert.equal(U('https://treidilor.com/api/automation/v1/catalog?limit=100&page=1', CFG_LOCAL).ok, false);
  assert.equal(U('http://localhost:4350/api/automation/v1/catalog?limit=100&page=1', CFG_PROD).ok, false);
  assert.equal(U('http://puente-treidilor:4350/api/automation/v1/catalog?limit=100&page=1', CFG_LOCAL).ok, true);
  assert.equal(U('http://127.0.0.1:4350/api/automation/v1/catalog?limit=100&page=1', CFG_LOCAL).ok, false, 'sólo el host declarado');
  assert.equal(U('https://treidilor.com/api/automation/v1/catalog?limit=100&page=3', { ...CFG_PROD, maxPaginasCatalogo: 2 }).motivo, 'page_fuera_de_rango');
  assert.equal(U('https://treidilor.com/api/automation/v1/catalog?limit=50&page=1', { ...CFG_PROD, limitePorPagina: 40 }).motivo, 'limit_fuera_de_rango');
});

test('política: una configuración no válida lo rechaza todo (config_no_valida) y la validación señala cada fallo', () => {
  const peores = [
    { ...CFG_PROD, modo: 'publico' }, { ...CFG_PROD, modo: 'completo' }, { ...CFG_PROD, entorno: 'otro' },
    { ...CFG_PROD, hostsPermitidos: ['treidilor.com', 'evil.com'] }, { ...CFG_PROD, hostsPermitidos: ['otro.com'] }, { ...CFG_PROD, hostsPermitidos: [] },
    { ...CFG_PROD, baseUrl: 'http://treidilor.com' }, { ...CFG_PROD, baseUrl: 'https://treidilor.com/api' }, { ...CFG_PROD, baseUrl: 'https://u:p@treidilor.com' },
    { ...CFG_PROD, maxPaginasCatalogo: 0 }, { ...CFG_PROD, maxPaginasCatalogo: 9 }, { ...CFG_PROD, limitePorPagina: 101 },
    { ...CFG_PROD, pausaMs: 5000 }, { ...CFG_PROD, peticionesPorMinuto: 0 }, { ...CFG_PROD, credencialCatalogo: undefined },
    { ...CFG_PROD, seguimiento: { ...CFG_PROD.seguimiento, tabla: 'auditor_general_instantaneas' } }, { ...CFG_PROD, seguimiento: { ...CFG_PROD.seguimiento, tabla: 'Calidad-Mala' } },
    { ...CFG_LOCAL, baseUrl: 'https://treidilor.com', hostsPermitidos: ['treidilor.com'] }, { ...CFG_PROD, baseUrl: 'http://localhost:4350', hostsPermitidos: ['localhost:4350'] },
    null, 'x', [],
  ];
  for (const c of peores) {
    assert.ok(P.validarConfigCalidad(c).length > 0, `debe fallar: ${JSON.stringify(c)?.slice(0, 120)}`);
    assert.equal(P.evaluarUrlCalidad(OK_URL, c).ok, false);
  }
  assert.deepEqual(P.validarConfigCalidad(CFG_PROD), []);
  assert.deepEqual(P.validarConfigCalidad(CFG_LOCAL), []);
});

test('política: sólo se permite GET, sin cuerpo, sin redirecciones y con cabeceras declaradas (la autenticación la pone la credencial de n8n)', () => {
  const buena = { metodo: 'GET', url: OK_URL, cabeceras: { 'User-Agent': 'TreidilorAI-calidad/0.1 (solo lectura)', 'X-Treidilor-Agente': 'calidad-catalogo', Accept: 'application/json' }, seguirRedirecciones: false };
  assert.equal(P.evaluarPeticionCalidad(buena, CFG_PROD).ok, true);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'get', 'Get', '', undefined]) assert.equal(P.evaluarPeticionCalidad({ ...buena, metodo: m }, CFG_PROD).motivo, 'metodo_no_permitido', String(m));
  assert.equal(P.evaluarPeticionCalidad({ ...buena, cuerpo: '{}' }, CFG_PROD).motivo, 'cuerpo_no_permitido');
  assert.equal(P.evaluarPeticionCalidad({ ...buena, seguirRedirecciones: true }, CFG_PROD).motivo, 'redirecciones_no_permitidas');
  assert.equal(P.evaluarPeticionCalidad({ ...buena, seguirRedirecciones: undefined }, CFG_PROD).motivo, 'redirecciones_no_permitidas');
  for (const h of ['Authorization', 'Cookie', 'X-Forwarded-For', 'Host', 'X-Api-Key']) assert.match(P.evaluarPeticionCalidad({ ...buena, cabeceras: { [h]: 'x' } }, CFG_PROD).motivo, /^cabecera_no_permitida:/, h);
  assert.equal(P.evaluarPeticionCalidad({ ...buena, url: 'https://treidilor.com/api/automation/v1/me' }, CFG_PROD).ok, false);
  assert.equal(P.evaluarPeticionCalidad(null, CFG_PROD).ok, false);
});

test('NO REGRESIÓN de la política del Auditor: el modo `publico` sigue rechazando el catálogo y las fichas, y `lectura_catalogo` no existe en su validador', () => {
  const pub = { entorno: 'produccion', baseUrl: 'https://treidilor.com', hostsPermitidos: ['treidilor.com'], modo: 'publico' };
  assert.equal(UP.evaluarUrl('https://treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'catalogo', pub).ok, false);
  assert.equal(UP.evaluarUrl('https://treidilor.com/producto/x', 'ficha', pub).ok, false);
  assert.equal(UP.evaluarUrl('https://treidilor.com/api/health', 'salud', pub).ok, true);
  assert.ok(COM.validarConfig({ ...CFG_PROD, rutas: ['/'], maxEnlaces: 1, maxFichas: 0 }).some((e) => /modo/.test(e)), 'el validador del Auditor no acepta el modo nuevo');
  assert.ok(P.validarConfigCalidad({ ...CFG_PROD, modo: 'publico' }).length > 0, 'y la política nueva no acepta el modo `publico`');
});

/* ═════════ 2. Objetivos a pedir ═════════ */
test('objetivos: primera página canónica; las siguientes sólo las que existen y hasta el tope; sin trabajo, un marcador AUTORIZADO que no se analiza', () => {
  assert.deepEqual(Q.crearObjetivosCalidad(CFG_PROD), [{ id: 'catalogo:1', tipo: 'catalogo', url: 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1', pagina: 1 }]);
  const resp = (totalPages) => [{ statusCode: 200, body: JSON.stringify({ products: [], total: totalPages * 100, totalPages }) }];
  const base = Q.crearObjetivosCalidad(CFG_PROD);
  assert.deepEqual(Q.crearObjetivosCalidadResto(base, resp(3), CFG_PROD).map((t) => t.pagina), [2, 3]);
  assert.deepEqual(Q.crearObjetivosCalidadResto(base, resp(20), CFG_PROD).map((t) => t.pagina), [2, 3, 4, 5, 6, 7, 8], 'tope de 8 páginas');
  const unaPagina = Q.crearObjetivosCalidadResto(base, resp(1), CFG_PROD);
  assert.equal(unaPagina.length, 1);
  assert.equal(unaPagina[0].marcador, true);
  assert.equal(P.evaluarUrlCalidad(unaPagina[0].url, CFG_PROD).ok, true, 'el marcador sólo apunta a una URL que la política admite (limit=1)');
  const roto = Q.crearObjetivosCalidad({ ...CFG_PROD, modo: 'publico' });
  assert.deepEqual([roto[0].marcador, roto[0].url], [true, ''], 'configuración no válida: no se pide nada');
  assert.equal(Q.crearObjetivosCalidadResto(base, resp(3), { ...CFG_PROD, hostsPermitidos: ['x.com'] })[0].marcador, true);
});

/* ═════════ 3. Lectura e integridad del feed ═════════ */
test('feed completo: todas las páginas, total coincidente y ids únicos', () => {
  const ps = catalogo(131);
  const { objetivos, respuestas } = respuestasDe(ps);
  const f = Q.leerFeedCalidad(objetivos, respuestas, CFG_LOCAL);
  assert.deepEqual([f.completo, f.productos.length, f.total, f.totalPaginas, f.paginasLeidas, f.errores.length, f.inconsistencias.length, f.repetidos.length], [true, 131, 131, 2, 2, 0, 0, 0]);
});

test('feed INCOMPLETO nunca es completo: página con error, página sin pedir, tope de páginas, total que cambia, productos distintos del total, vacío', () => {
  const ps = catalogo(131);
  const { objetivos, respuestas } = respuestasDe(ps);
  const conError = Q.leerFeedCalidad(objetivos, [respuestas[0], { statusCode: 500, body: 'x' }], CFG_LOCAL);
  assert.deepEqual([conError.completo, conError.motivoFallo], [false, 'error_de_lectura']);
  assert.equal(conError.errores.length, 1);
  const sinPedir = Q.leerFeedCalidad(objetivos.slice(0, 1), respuestas.slice(0, 1), CFG_LOCAL);
  assert.equal(sinPedir.completo, false);
  assert.match(sinPedir.inconsistencias.join(' '), /1 página\(s\) sin leer de 2/);
  const grande = respuestasDe(catalogo(1000), 100, { paginas: 8 });
  const f8 = Q.leerFeedCalidad(grande.objetivos, grande.respuestas, CFG_LOCAL);
  assert.equal(f8.completo, false);
  assert.match(f8.inconsistencias.join(' '), /tope de 8 páginas/);
  const a = respuestasDe(ps, 100, { total: 131 });
  const b = respuestasDe(ps, 100, { total: 132 });
  const cambia = Q.leerFeedCalidad(a.objetivos, [a.respuestas[0], b.respuestas[1]], CFG_LOCAL);
  assert.equal(cambia.completo, false);
  assert.match(cambia.inconsistencias.join(' '), /total de productos cambia/);
  const menos = respuestasDe(ps.slice(0, 120), 100, { total: 131 });
  assert.equal(Q.leerFeedCalidad(menos.objetivos, menos.respuestas, CFG_LOCAL).completo, false);
  const vacio = respuestasDe([], 100, { total: 0 });
  const fv = Q.leerFeedCalidad(vacio.objetivos, vacio.respuestas, CFG_LOCAL);
  assert.equal(fv.completo, false);
  assert.equal(fv.productos.length, 0);
});

test('feed: 401/403 = credencial no válida, 429 = límite; el análisis lo dice y no inventa productos', () => {
  const { objetivos } = respuestasDe(catalogo(5));
  const f401 = Q.leerFeedCalidad(objetivos, [{ statusCode: 401, body: '{}' }], CFG_LOCAL);
  assert.equal(f401.motivoFallo, 'credencial_no_valida');
  const f429 = Q.leerFeedCalidad(objetivos, [{ statusCode: 429, body: '{}' }], CFG_LOCAL);
  assert.equal(f429.motivoFallo, 'limite_de_peticiones');
  const informe = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: [{ statusCode: 401, body: '{}' }], ahoraIso: AHORA });
  assert.equal(informe.resumen.estado, 'incompleto');
  assert.equal(informe.resumen.productos, 0);
  assert.deepEqual(informe.incidencias.map((i) => i.id), ['catalogo:feed_no_disponible']);
  assert.match(informe.incidencias[0].detalle, /credencial/i);
  const sinRed = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: [{ error: { message: 'connect ECONNREFUSED' } }], ahoraIso: AHORA });
  assert.equal(sinRed.incidencias[0].id, 'catalogo:feed_no_disponible');
});

test('feed: ids repetidos con el total cuadrando = id_duplicado confirmado; si el total no cuadra es una lectura inconsistente, no un duplicado', () => {
  const ps = catalogo(10);
  const dup = [...ps, { ...ps[3] }];
  const informe = informeDe(dup);
  assert.equal(informe.fuente.completo, true);
  assert.equal(hallazgos(informe, 'id_duplicado').length, 1);
  assert.equal(hallazgos(informe, 'id_duplicado')[0].certeza, 'confirmado');
  const { objetivos, respuestas } = respuestasDe(dup, 100, { total: 12 });
  const inconsistente = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA });
  assert.equal(inconsistente.fuente.completo, false);
  assert.equal(hallazgos(inconsistente, 'id_duplicado').length, 0, 'sin lectura completa no se afirma un duplicado');
  assert.equal(inconsistente.resumen.estado, 'incompleto');
});

/* ═════════ 4. Reglas por ficha ═════════ */
const regla = (codigo) => Q.REGLAS_CALIDAD.find((r) => r.codigo === codigo);

test('registro de reglas: certezas y gravedades coherentes; lo no verificable es siempre «info» y no puntúa', () => {
  const codigos = Q.REGLAS_CALIDAD.map((r) => r.codigo);
  assert.equal(new Set(codigos).size, codigos.length);
  for (const r of Q.REGLAS_CALIDAD) {
    assert.ok(['confirmado', 'advertencia', 'no_verificable'].includes(r.certeza), r.codigo);
    assert.ok(['alta', 'media', 'baja', 'info'].includes(r.gravedad), r.codigo);
    if (r.certeza === 'no_verificable') assert.equal(r.gravedad, 'info', r.codigo);
    assert.ok(r.titulo && r.accion && r.clase, r.codigo);
    assert.ok(!/^(sin_titulo|h1|contenido_minimo|error_interno_200)$/.test(r.codigo), 'no choca con los códigos de contenido HTML del motor de seguimiento');
    assert.ok(!/^(sin_respuesta|sin_datos)$/.test(r.codigo), 'no choca con los códigos de error de petición del motor');
  }
});

test('reglas CONFIRMADAS: precio, categoría, imagen, descripción, valoración y fechas', () => {
  const ps = [
    ...catalogo(12),
    prod({ id: 'x-precio-null', price: null }), prod({ id: 'x-precio-extremo', price: 150000 }), prod({ id: 'x-anterior-menor', price: 50, declaredPreviousPrice: 30 }),
    prod({ id: 'x-sin-cat', category: null, categoryId: null, subcategoryId: null }), prod({ id: 'x-sin-img', image: null }), prod({ id: 'x-img-http', image: 'http://cdn.example.com/a.jpg' }),
    prod({ id: 'x-img-js', image: 'javascript:alert(1)' }), prod({ id: 'x-sin-desc', descriptionLength: 0 }), prod({ id: 'x-rating-7', rating: 7 }), prod({ id: 'x-resenas-neg', reviewsCount: -3 }),
    prod({ id: 'x-rating-sin-resenas', rating: 4.5, reviewsCount: 0 }), prod({ id: 'x-futuro', capturedAt: dia(3) }),
  ];
  const inf = informeDe(ps);
  const esperado = { 'x-precio-null': 'precio_ausente', 'x-precio-extremo': 'precio_extremo', 'x-anterior-menor': 'precio_anterior_menor', 'x-sin-cat': 'sin_categoria', 'x-sin-img': 'sin_imagen', 'x-img-http': 'imagen_no_segura', 'x-img-js': 'imagen_no_segura', 'x-sin-desc': 'sin_descripcion', 'x-rating-7': 'valoracion_incoherente', 'x-resenas-neg': 'valoracion_incoherente', 'x-rating-sin-resenas': 'valoracion_incoherente', 'x-futuro': 'fecha_futura' };
  for (const [id, codigo] of Object.entries(esperado)) {
    const i = deFicha(inf, codigo, id);
    assert.ok(i, `${id} → ${codigo}`);
    assert.equal(i.certeza, 'confirmado', `${id} ${codigo}`);
    assert.equal(i.gravedad, regla(codigo).gravedad);
    assert.equal(i.id, `ficha:${codigo}:${id}`);
  }
  assert.equal(inf.incidencias.filter((i) => i.producto && /^p\d{4}$/.test(i.producto.id) && i.certeza !== 'no_verificable' && i.area === 'ficha').length, 0, 'las fichas sanas no generan incidencias de ficha');
});

test('un dato AUSENTE o no informado no se convierte en defecto confirmado', () => {
  const ps = [...catalogo(12), prod({ id: 'y-desc-null', descriptionLength: null }), prod({ id: 'y-sin-rating', rating: null, reviewsCount: null }), prod({ id: 'y-afil-undef', hasAffiliateLink: undefined }), prod({ id: 'y-stock-null', stock: null })];
  const inf = informeDe(ps);
  for (const id of ['y-desc-null', 'y-sin-rating', 'y-afil-undef', 'y-stock-null']) {
    const propias = inf.incidencias.filter((i) => i.producto && i.producto.id === id);
    assert.deepEqual(propias.filter((i) => i.certeza === 'confirmado'), [], `${id} no tiene defectos confirmados`);
  }
  assert.equal(hallazgos(inf, 'sin_descripcion').length, 0);
  assert.equal(hallazgos(inf, 'valoracion_incoherente').length, 0);
  const campos = hallazgos(inf, 'campo_no_entregado')[0];
  assert.ok(campos && campos.certeza === 'no_verificable', 'un campo que el feed no entrega se informa como no verificable');
  assert.ok(campos.evidencia.ejemplos.includes('y-stock-null') && campos.evidencia.ejemplos.includes('y-desc-null') && campos.evidencia.ejemplos.includes('y-afil-undef'));
});

test('reglas de ADVERTENCIA: título, categoría sin id, subcategoría, descripción corta, precio atípico, descuento sospechoso, fechas antiguas', () => {
  const cat = catalogo(12);
  const ps = [
    ...cat, prod({ id: 'w-tit-corto', title: 'Cable USB' }), prod({ id: 'w-tit-num', title: '1234567890123456789' }), prod({ id: 'w-tit-largo', title: 'A'.repeat(130) }),
    prod({ id: 'w-cat-sin-id', categoryId: null }), prod({ id: 'w-sin-sub', subcategoryId: null }), prod({ id: 'w-desc-corta', descriptionLength: 12 }),
    prod({ id: 'w-atipico', price: 5000 }), prod({ id: 'w-desc-sospechoso', price: 10, declaredPreviousPrice: 80 }), prod({ id: 'w-capt-antigua', capturedAt: dia(-45) }),
    prod({ id: 'w-capt-ausente', capturedAt: null }), prod({ id: 'w-verif-antigua', verifiedAt: dia(-60) }),
  ];
  const inf = informeDe(ps);
  const esperado = { 'w-tit-corto': 'titulo_incompleto', 'w-tit-num': 'titulo_incompleto', 'w-tit-largo': 'titulo_largo', 'w-cat-sin-id': 'categoria_sin_id', 'w-sin-sub': 'sin_subcategoria', 'w-desc-corta': 'descripcion_corta', 'w-atipico': 'precio_atipico', 'w-desc-sospechoso': 'descuento_sospechoso', 'w-capt-antigua': 'captura_antigua', 'w-capt-ausente': 'captura_ausente', 'w-verif-antigua': 'verificacion_antigua' };
  for (const [id, codigo] of Object.entries(esperado)) {
    const i = deFicha(inf, codigo, id);
    assert.ok(i, `${id} → ${codigo}`);
    assert.equal(i.certeza, 'advertencia', `${id} ${codigo}`);
  }
  // umbrales: justo en el límite NO se marca
  const lim = informeDe([...catalogo(12), prod({ id: 'v-tit-15', title: 'Título de 15 ch' }), prod({ id: 'v-desc-40', descriptionLength: 40 }), prod({ id: 'v-capt-30', capturedAt: dia(-30) }), prod({ id: 'v-x5', price: 10, declaredPreviousPrice: 50 })]);
  for (const [id, codigo] of [['v-tit-15', 'titulo_incompleto'], ['v-desc-40', 'descripcion_corta'], ['v-capt-30', 'captura_antigua'], ['v-x5', 'descuento_sospechoso']]) assert.equal(deFicha(lim, codigo, id), undefined, `${id} en el límite no se marca`);
});

test('precio atípico y subcategoría sólo se evalúan con muestra suficiente (no hay mediana con pocos productos)', () => {
  const raros = [prod({ id: 'u-caro', price: 9000, category: 'Hogar', categoryId: 'hogar', subcategoryId: 'cocina' }), prod({ id: 'u-barato', price: 10, category: 'Hogar', categoryId: 'hogar', subcategoryId: 'cocina' }), prod({ id: 'u-sin-sub', category: 'Hogar', categoryId: 'hogar', subcategoryId: null })];
  const pocos = informeDe([...catalogo(12), ...raros]);
  assert.equal(hallazgos(pocos, 'precio_atipico').length, 0, 'con menos de 8 productos en la categoría no hay mediana');
  assert.equal(hallazgos(pocos, 'sin_subcategoria').length, 0, 'con menos de 4 productos en la categoría no hay referencia');
  const mitad = informeDe([...Array.from({ length: 6 }, () => prod({ subcategoryId: null })), ...Array.from({ length: 4 }, () => prod())]);
  assert.equal(hallazgos(mitad, 'sin_subcategoria').length, 0, 'si la mayoría de la categoría tampoco la tiene, no es un defecto');
});

test('enlace de afiliación: sólo es advertencia donde casi toda la red lo tiene; en redes donde no es lo habitual es NO VERIFICABLE', () => {
  const ps = [
    ...catalogo(10, () => ({ network: 'aliexpress', hasAffiliateLink: true })), prod({ id: 'z-ali-sin', network: 'aliexpress', hasAffiliateLink: false }),
    ...catalogo(8, () => ({ network: 'amazon', hasAffiliateLink: false })),
    ...catalogo(3, () => ({ network: 'ebay', hasAffiliateLink: false })),
  ];
  const inf = informeDe(ps);
  const adv = hallazgos(inf, 'enlace_afiliado_ausente');
  assert.deepEqual(adv.map((i) => i.producto.id), ['z-ali-sin']);
  assert.equal(adv[0].certeza, 'advertencia');
  const nv = hallazgos(inf, 'enlace_afiliado_no_calibrable')[0];
  assert.equal(nv.certeza, 'no_verificable');
  assert.equal(nv.evidencia.total, 11, 'amazon (8) y ebay (3), no aliexpress');
  assert.deepEqual(Object.keys(nv.evidencia.porRed).sort(), ['amazon', 'ebay']);
  assert.equal(nv.puntuacion, 0);
  assert.equal(nv.prioridad, null);
});

test('NO VERIFICABLE: descuentos declarados, valoración por defecto, stock desconocido y verificación ausente se agregan, no puntúan y no son defectos', () => {
  const ps = [
    prod({ id: 'n1', price: 40, declaredPreviousPrice: 60, verifiedDiscount: null }), prod({ id: 'n2', price: 40, declaredPreviousPrice: 60, verifiedDiscount: { pct: 33, previousPrice: 60, asOf: dia(-1) } }),
    prod({ id: 'n3', ratingFlag: 'por_defecto', rating: null, reviewsCount: null }), prod({ id: 'n4', stock: 'unknown' }), prod({ id: 'n5', verifiedAt: null }), ...catalogo(8),
  ];
  const inf = informeDe(ps);
  const nv = Object.fromEntries(inf.incidencias.filter((i) => i.certeza === 'no_verificable').map((i) => [i.regla, i]));
  assert.deepEqual(nv.descuento_declarado.evidencia.ejemplos, ['n1'], 'un descuento verificado no es «sin verificar»');
  assert.deepEqual(nv.valoracion_por_defecto.evidencia.ejemplos, ['n3']);
  assert.deepEqual(nv.stock_desconocido.evidencia.ejemplos, ['n4']);
  assert.deepEqual(nv.verificacion_ausente.evidencia.ejemplos, ['n5']);
  for (const i of Object.values(nv)) { assert.equal(i.gravedad, 'info'); assert.equal(i.puntuacion, 0); assert.equal(i.prioridad, null); assert.equal(i.area, 'catalogo'); }
  assert.equal(inf.resumen.confirmados, 0);
  assert.equal(inf.resumen.advertencias, 0);
  assert.equal(inf.resumen.estado, 'ok', 'lo no verificable no cambia el estado');
});

/* ═════════ 5. Duplicados conservadores ═════════ */
const um = Q.UMBRALES_CALIDAD;
test('duplicados: mismo título, misma red, mismo comercio y precio parecido = posible duplicado (se informa el par, no se propone eliminar)', () => {
  const a = prod({ id: 'd1', title: 'Auriculares Sony WH-1000XM5 negros inalámbricos', price: 300 });
  const b = prod({ id: 'd2', title: 'AURICULARES Sony WH-1000XM5 Negros, Inalámbricos!', price: 305 });
  const r = Q.detectarDuplicados([b, a, ...catalogo(5)], um);
  assert.equal(r.pares.length, 1);
  assert.deepEqual([r.pares[0].a.id, r.pares[0].b.id, r.pares[0].tipo], ['d1', 'd2', 'titulo_igual_mismo_comercio']);
  assert.match(r.pares[0].motivo, /Mismo título/);
  const inf = informeDe([a, b, ...catalogo(5)]);
  assert.equal(hallazgos(inf, 'posible_duplicado').length, 1);
  assert.equal(hallazgos(inf, 'posible_duplicado')[0].certeza, 'advertencia');
  assert.ok(!/elimin/i.test(JSON.stringify(inf.incidencias.filter((i) => i.regla === 'posible_duplicado').map((i) => i.titulo + i.detalle))) || /no se propone eliminar|no eliminar/i.test(JSON.stringify(hallazgos(inf, 'posible_duplicado'))), 'nunca propone eliminar');
});

test('duplicados: el MISMO título en otro comercio u otra red, o con otro precio, NO es duplicado (sólo informativo)', () => {
  const t = 'Teclado mecánico Logitech G915 TKL inalámbrico';
  const a = prod({ id: 'e1', title: t, merchant: 'Tienda Uno', price: 150 });
  const otroComercio = prod({ id: 'e2', title: t, merchant: 'Tienda Dos', price: 150 });
  const otraRed = prod({ id: 'e3', title: t, network: 'aliexpress', price: 150 });
  const otroPrecio = prod({ id: 'e4', title: t, merchant: 'Tienda Uno', price: 220 });
  const r = Q.detectarDuplicados([a, otroComercio, otraRed, otroPrecio], um);
  assert.equal(r.pares.length, 0);
  assert.deepEqual(r.informativos.map((p) => p.id).sort(), ['e1', 'e2', 'e3', 'e4']);
  const inf = informeDe([a, otroComercio, otraRed, otroPrecio, ...catalogo(5)]);
  assert.equal(hallazgos(inf, 'posible_duplicado').length, 0);
  const info = hallazgos(inf, 'titulo_igual_no_duplicado')[0];
  assert.equal(info.certeza, 'no_verificable');
  assert.equal(info.gravedad, 'info');
  assert.equal(info.puntuacion, 0);
});

test('duplicados: modelos, capacidades y cantidades distintos NUNCA se agrupan', () => {
  const casos = [
    ['Apple iPhone 15 128GB negro libre', 'Apple iPhone 15 Pro 128GB negro libre'],
    ['Samsung Galaxy S24 128GB 5G negro', 'Samsung Galaxy S24 256GB 5G negro'],
    ['Pilas alcalinas AA Duracell pack de 8 unidades', 'Pilas alcalinas AA Duracell pack de 12 unidades'],
    ['Camiseta deportiva hombre talla M transpirable', 'Camiseta deportiva hombre talla L transpirable'],
    ['Funda móvil iPhone 14 silicona transparente', 'Funda móvil iPhone 15 silicona transparente'],
    ['Auriculares Bluetooth Xiaomi Redmi Buds 4 Pro', 'Auriculares Bluetooth Xiaomi Redmi Buds 5 Pro'],
  ];
  for (const [x, y] of casos) {
    const r = Q.detectarDuplicados([prod({ id: 'm1', title: x, price: 100 }), prod({ id: 'm2', title: y, price: 100 })], um);
    assert.equal(r.pares.length, 0, `${x} ≠ ${y}`);
  }
});

test('duplicados: títulos casi iguales sólo se emparejan si difieren únicamente en relleno comercial (mismos dígitos, misma categoría, comercio y precio parecido); color, talla o una palabra distinta no bastan', () => {
  const largo = 'Altavoz Bluetooth portátil resistente al agua IPX7 con graves potentes 20W autonomía 12 horas';
  const relleno = 'Altavoz Bluetooth portátil resistente al agua IPX7 con graves potentes 20W autonomía 12 horas original';
  const a = prod({ id: 's1', title: largo, price: 40 });
  const b = prod({ id: 's2', title: relleno, price: 41 });
  const par = Q.detectarDuplicados([a, b], um).pares;
  assert.equal(par.length, 1, 'sólo se diferencian en «original»');
  assert.equal(par[0].tipo, 'titulo_similar_mismo_comercio');
  const otroOrden = prod({ id: 's8', title: 'autonomía 12 horas Altavoz Bluetooth portátil resistente al agua IPX7 con graves potentes 20W', price: 40 });
  assert.equal(Q.detectarDuplicados([a, otroOrden], um).pares[0].tipo, 'titulo_mismos_terminos', 'mismos términos en otro orden');
  const palabra = prod({ id: 's9', title: largo.replace('potentes', 'profundos'), price: 40 });
  assert.equal(Q.detectarDuplicados([a, palabra], um).pares.length, 0, 'una palabra distinta que no es relleno (título largo)');
  const color = prod({ id: 's10', title: largo + ' negro', price: 40 });
  assert.equal(Q.detectarDuplicados([a, color], um).pares.length, 0, 'un color de más');
  const corto1 = prod({ id: 's3', title: 'Altavoz Bluetooth negro portátil', price: 40 });
  const corto2 = prod({ id: 's4', title: 'Altavoz Bluetooth blanco portátil', price: 40 });
  assert.equal(Q.detectarDuplicados([corto1, corto2], um).pares.length, 0, 'color distinto en un título corto');
  assert.equal(Q.detectarDuplicados([a, prod({ id: 's5', title: relleno, price: 80 })], um).pares.length, 0, 'precio muy distinto');
  assert.equal(Q.detectarDuplicados([a, prod({ id: 's6', title: relleno, price: 41, categoryId: 'hogar' })], um).pares.length, 0, 'otra categoría');
  assert.equal(Q.detectarDuplicados([a, prod({ id: 's7', title: relleno, price: 41, merchant: 'Otra' })], um).pares.length, 0, 'otro comercio');
});

test('duplicados: resultado determinista (independiente del orden de entrada), acotado y con los bloques enormes omitidos y declarados', () => {
  const mk = () => [prod({ id: 'k1', title: 'Monitor Dell 27 pulgadas QHD IPS 75Hz', price: 200 }), prod({ id: 'k2', title: 'Monitor Dell 27 pulgadas QHD IPS 75Hz', price: 201 }), prod({ id: 'k3', title: 'Ratón Logitech MX Master 3S gris', price: 90 }), prod({ id: 'k4', title: 'Ratón Logitech MX Master 3S gris', price: 91 })];
  const ps = mk();
  assert.deepEqual(plano(Q.detectarDuplicados(ps, um)), plano(Q.detectarDuplicados([...ps].reverse(), um)));
  const enorme = catalogo(30, (i) => ({ title: `Producto distinto número ${i} de la serie larga ${i * 7}` }));
  const r = Q.detectarDuplicados(enorme, { ...um, maxGrupoSimilitud: 10 });
  assert.equal(r.omitidos.length, 1);
  const inf = informeDe(enorme, { cfg: cfg({ umbrales: { maxGrupoSimilitud: 10 } }) });
  assert.match(inf.cobertura.noRevisado.join(' '), /Comparación de títulos similares omitida/);
});

/* ═════════ 6. Prioridad ═════════ */
test('prioridad: peso de la regla × certeza × factor del producto; agotado baja, stock/descuento verificado/precio alto suben; bandas P1-P4', () => {
  const base = catalogo(12);
  const ctx = { p75: 60 };
  const regAlta = regla('precio_ausente');
  const sano = prod({ id: 'q0', price: 10, stock: 'in_stock' });
  assert.equal(Q.factorProducto(prod({ stock: 'in_stock', price: 10 }), ctx), 1.25);
  assert.equal(Q.factorProducto(prod({ stock: 'out_of_stock', price: 10 }), ctx), 0.5);
  assert.equal(Q.factorProducto(prod({ stock: 'unknown', price: 10 }), ctx), 1);
  assert.equal(Q.factorProducto(prod({ stock: 'in_stock', price: 100, verifiedDiscount: { pct: 20 } }), ctx), 1.75);
  assert.equal(Q.puntuar(regAlta, sano, ctx), 100, 'alta confirmada × 1,25');
  assert.equal(Q.puntuar(regla('enlace_afiliado_ausente'), sano, ctx), 60, 'alta advertencia: 80 × 0,6 × 1,25');
  assert.equal(Q.puntuar(regla('descripcion_corta'), sano, ctx), 15);
  assert.deepEqual([100, 80, 79, 50, 49, 20, 19, 0].map(Q.bandaDePuntuacion), ['P1', 'P1', 'P2', 'P2', 'P3', 'P3', 'P4', 'P4']);
  const inf = informeDe([...base, prod({ id: 'r-agotado', price: null, stock: 'out_of_stock' }), prod({ id: 'r-stock', price: null, stock: 'in_stock' })]);
  assert.ok(deFicha(inf, 'precio_ausente', 'r-stock').puntuacion > deFicha(inf, 'precio_ausente', 'r-agotado').puntuacion);
  const lista = inf.incidencias.filter((i) => i.puntuacion > 0).map((i) => i.puntuacion);
  assert.deepEqual(lista, [...lista].sort((a, b) => b - a), 'el informe va de mayor a menor puntuación');
});

/* ═════════ 7. Informe `informe-calidad/1` ═════════ */
test('informe: cumple el esquema y distingue confirmados, advertencias y no verificables', () => {
  const ps = [...catalogo(20), prod({ id: 'i1', price: null }), prod({ id: 'i2', title: 'Corto' }), prod({ id: 'i3', stock: 'unknown' })];
  const inf = informeDe(ps);
  assert.deepEqual(validarEsquema(inf, SCHEMA), []);
  assert.deepEqual([inf.esquema, inf.agente, inf.modo, inf.soloLectura], ['informe-calidad/1', 'calidad-catalogo', 'lectura_catalogo', true]);
  assert.equal(inf.resumen.confirmados, 1);
  assert.ok(inf.resumen.advertencias >= 1);
  assert.ok(inf.resumen.noVerificables >= 1);
  assert.equal(inf.resumen.estado, 'atencion');
  assert.equal(inf.resumen.incidenciasOmitidas, 0);
  assert.match(inf.markdown, /^# Calidad del catálogo/);
  for (const trozo of ['defectos confirmados', 'advertencias', 'datos no verificables', 'Datos que el feed no permite verificar', '## Cobertura', 'No revisado']) assert.ok(inf.markdown.includes(trozo), trozo);
  assert.ok(/imágenes carguen/.test(inf.cobertura.noRevisado.join(' ')), 'declara lo que no revisa');
  // un informe con campos de más o de menos no pasa el esquema
  assert.ok(validarEsquema({ ...inf, extra: 1 }, SCHEMA).length > 0);
  const sinCampo = plano(inf); delete sinCampo.fuente;
  assert.ok(validarEsquema(sinCampo, SCHEMA).length > 0);
  assert.ok(validarEsquema({ ...plano(inf), agente: 'auditor-general' }, SCHEMA).length > 0);
});

test('informe: estado ok con un catálogo sano; «incompleto» con un feed incompleto (nunca «ok»); el informe no lleva enlaces de afiliado, tokens ni secretos', () => {
  const sano = informeDe(catalogo(30));
  assert.equal(sano.resumen.estado, 'ok');
  assert.deepEqual(validarEsquema(sano, SCHEMA), []);
  const parcial = respuestasDe(catalogo(150), 100, { paginas: 1 });
  const inc = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: parcial.objetivos, respuestasCatalogo: parcial.respuestas, ahoraIso: AHORA });
  assert.equal(inc.resumen.estado, 'incompleto');
  assert.equal(inc.fuente.completo, false);
  assert.ok(inc.incidencias.some((i) => i.id === 'catalogo:feed_parcial'));
  assert.match(inc.markdown, /INCOMPLETA/);
  const texto = JSON.stringify(sano) + JSON.stringify(inc);
  for (const prohibido of ['affiliateUrl', 'buyNowUrl', 'commission', 'Bearer ', 'tai_', 'password', 'authorization']) assert.ok(!texto.toLowerCase().includes(prohibido.toLowerCase()), prohibido);
});

test('informe: DETERMINISTA (misma entrada, mismo informe), no muta la entrada y no depende del orden de los productos', () => {
  const ps = [...catalogo(40), prod({ id: 'det1', price: null }), prod({ id: 'det2', title: 'Auriculares Sony WH-1000XM5 negros', price: 300 }), prod({ id: 'det3', title: 'Auriculares Sony WH-1000XM5 negros', price: 301 })];
  const entrada = entradaDe(ps);
  const copia = plano(entrada);
  const a = Q.construirInformeCalidad(entrada);
  const b = Q.construirInformeCalidad(entrada);
  assert.deepEqual(a, b);
  assert.deepEqual(plano(entrada), copia, 'la entrada no se modifica');
  const mezclados = [...ps].reverse();
  const c = informeDe(mezclados);
  assert.deepEqual(plano(c.incidencias.map((i) => i.id).sort()), plano(a.incidencias.map((i) => i.id).sort()));
  assert.deepEqual(c.resumen.porRegla, a.resumen.porRegla);
});

test('informe: la lista se acota (`maxIncidenciasInforme`) pero el recuento y el seguimiento usan TODAS las incidencias', () => {
  const ps = catalogo(60, () => ({ image: null, descriptionLength: 5, title: 'Corto' }));
  const inf = informeDe(ps, { cfg: cfg({ umbrales: { maxIncidenciasInforme: 20 } }) });
  assert.equal(inf.incidencias.length, 20);
  assert.equal(inf.resumen.incidenciasMostradas, 20);
  assert.ok(inf.resumen.incidenciasOmitidas > 0);
  assert.equal(inf.seguimiento.resumen.actuales, inf.resumen.incidenciasMostradas + inf.resumen.incidenciasOmitidas, 'el seguimiento ve todas');
  assert.match(inf.markdown, /Se muestran 20 incidencias/);
  assert.deepEqual(validarEsquema(inf, SCHEMA), []);
});

/* ═════════ 8. Compatibilidad con el motor de seguimiento ═════════ */
const ejecutar = (productos, { historial = [], tablas = TABLAS_OK, id = 'ex-1', origen = 'manual', ahoraIso = AHORA, feed, cfg: c } = {}) => {
  const e = entradaDe(productos, { ahoraIso, feed, cfg: c, persistencia: { tablas, historial, idEjecucion: id, origen } });
  return Q.construirInformeCalidadYFila(e);
};

test('seguimiento: la primera ejecución completa es LÍNEA BASE y guarda una instantánea rotulada para este agente', () => {
  const { informe, fila } = ejecutar([...catalogo(20), prod({ id: 'b1', price: null })]);
  assert.equal(informe.seguimiento.modo, 'linea_base');
  assert.equal(informe.seguimiento.resumen.nuevas, 0, 'la línea base no genera «nuevas»');
  assert.deepEqual([informe.persistencia.escritura.guardar, informe.persistencia.escritura.resultado, informe.persistencia.escritura.motivo], [true, 'pendiente', 'ok']);
  assert.ok(fila);
  assert.deepEqual(Object.keys(fila).sort(), [...SEG.COLUMNAS_INSTANTANEAS].sort());
  const inst = JSON.parse(fila.payload);
  assert.equal(inst.agente, 'calidad-catalogo');
  assert.equal(inst.calidad.estado, 'completa');
  assert.ok(inst.incidencias.some((i) => i.clave === 'ficha:precio_ausente:b1'));
  assert.equal(inst.alcance.fichas.length, 21);
  assert.ok(COM.bytesUtf8(fila.payload) <= SEG.LIMITES_PERSISTENCIA.maxBytesInstantanea);
  assert.ok(!fila.payload.includes('Producto'), 'la instantánea sólo lleva claves y fechas, no textos');
});

test('seguimiento: segunda ejecución = nuevas / persistentes / resueltas / reaparecidas con el mismo motor del Auditor', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `h${i}`);
  const sano = () => ids.map((id) => prod({ id }));
  const v1 = sano(); v1[0].price = null; v1[1].image = null;
  const r1 = ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) });
  const hist1 = [filaDe(r1.fila, 1)];
  const v2 = sano(); v2[1].image = null; v2[2].descriptionLength = 0;
  const r2 = ejecutar(v2, { historial: hist1, id: 'ex-2', ahoraIso: dia(1) });
  const s = r2.informe.seguimiento;
  assert.equal(s.modo, 'comparacion');
  assert.deepEqual(s.nuevas.map((x) => x.clave), ['ficha:sin_descripcion:h2']);
  assert.deepEqual(s.persistentes.map((x) => x.clave), ['ficha:sin_imagen:h1']);
  assert.deepEqual(s.resueltas.map((x) => x.clave), ['ficha:precio_ausente:h0'], 'h0 se leyó y ya no tiene el defecto');
  const hist2 = [...hist1, filaDe(r2.fila, 2)];
  const v3 = sano(); v3[0].price = null; v3[1].image = null;
  const r3 = ejecutar(v3, { historial: hist2, id: 'ex-3', ahoraIso: dia(2) });
  assert.deepEqual(r3.informe.seguimiento.reaparecidas.map((x) => x.clave), ['ficha:precio_ausente:h0']);
  assert.deepEqual(validarEsquema(r3.informe, SCHEMA), []);
});

test('seguimiento: un producto que DESAPARECE del feed no se da por resuelto (queda no verificado); sí se resuelve si se leyó', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `g${i}`);
  const v1 = ids.map((id) => prod({ id })); v1[0].price = null; v1[1].price = null;
  const r1 = ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) });
  const hist = [filaDe(r1.fila, 1)];
  const v2 = ids.filter((id) => id !== 'g0').map((id) => prod({ id }));
  const s = ejecutar(v2, { historial: hist, id: 'ex-2', ahoraIso: dia(1) }).informe.seguimiento;
  assert.deepEqual(s.resueltas.map((x) => x.clave), ['ficha:precio_ausente:g1'], 'g1 se leyó y está arreglado');
  assert.deepEqual(s.noVerificadas.map((x) => [x.clave, x.motivo]), [['ficha:precio_ausente:g0', 'objetivo_no_revisado']], 'g0 ya no está en el feed: no se puede afirmar que se arregló');
});

test('seguimiento: una ejecución con páginas pendientes NO se guarda, no resuelve incidencias y no sustituye la referencia', () => {
  const ids = Array.from({ length: 150 }, (_, i) => `f${i}`);
  const v1 = ids.map((id) => prod({ id })); v1[120].price = null; v1[5].price = null;
  const r1 = ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) });
  assert.equal(r1.informe.fuente.completo, true);
  const hist = [filaDe(r1.fila, 1)];
  const v2 = ids.map((id) => prod({ id }));
  const r2 = ejecutar(v2, { historial: hist, id: 'ex-2', ahoraIso: dia(1), feed: { paginas: 1 } });
  assert.equal(r2.informe.fuente.completo, false);
  assert.equal(r2.informe.resumen.estado, 'incompleto');
  assert.deepEqual([r2.informe.persistencia.escritura.guardar, r2.informe.persistencia.escritura.motivo, r2.informe.persistencia.escritura.resultado], [false, 'ejecucion_parcial', 'no_procede']);
  assert.equal(r2.fila, null);
  assert.deepEqual(r2.informe.seguimiento.resueltas.map((x) => x.clave), ['ficha:precio_ausente:f5'], 'sólo la ficha leída puede resolverse');
  assert.deepEqual(r2.informe.seguimiento.noVerificadas.map((x) => x.clave), ['ficha:precio_ausente:f120'], 'la de la página que no se leyó queda sin verificar');
  const r3 = ejecutar(v1, { historial: hist, id: 'ex-3', ahoraIso: dia(2) });
  assert.equal(r3.informe.seguimiento.comparadoCon, dia(0), 'la referencia sigue siendo la última ejecución completa');
});

test('seguimiento: sin credencial (401), sin red o con el feed vacío no se guarda nada ni se resuelve nada', () => {
  const v1 = catalogo(15); v1[0].price = null;
  const r1 = ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) });
  const hist = [filaDe(r1.fila, 1)];
  const { objetivos } = respuestasDe(v1);
  for (const respuestas of [[{ statusCode: 401, body: '{}' }], [{ error: { message: 'timeout' } }], [{ statusCode: 200, body: JSON.stringify({ products: [], total: 0, totalPages: 0 }) }]]) {
    const r = Q.construirInformeCalidadYFila({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos.slice(0, 1), respuestasCatalogo: respuestas, ahoraIso: dia(1), persistencia: { tablas: TABLAS_OK, historial: hist, idEjecucion: 'ex-x', origen: 'manual' } });
    assert.equal(r.fila, null);
    assert.equal(r.informe.persistencia.escritura.guardar, false);
    assert.deepEqual(r.informe.seguimiento.resueltas, []);
    assert.equal(r.informe.resumen.estado, 'incompleto');
  }
});

test('seguimiento: reducción brusca del catálogo = incidencia alta, y lo que desaparece queda «no verificado», nunca «resuelto»', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `c${i}`);
  const v1 = ids.map((id) => prod({ id })); v1.forEach((p, i) => { if (i < 10) p.price = null; });
  const r1 = ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) });
  const hist = [filaDe(r1.fila, 1)];
  const v2 = ids.slice(30).map((id) => prod({ id }));
  const r2 = ejecutar(v2, { historial: hist, id: 'ex-2', ahoraIso: dia(1) });
  assert.ok(r2.informe.incidencias.some((i) => i.id === 'catalogo:reduccion_brusca' && i.gravedad === 'alta'));
  assert.equal(r2.informe.seguimiento.resumen.resueltas, 0);
  assert.equal(r2.informe.seguimiento.resumen.noVerificadas, 10);
  const pocos = ejecutar(ids.slice(0, 15).map((id) => prod({ id })), { id: 'ex-1', ahoraIso: dia(0) });
  const r3 = ejecutar(ids.slice(0, 5).map((id) => prod({ id })), { historial: [filaDe(pocos.fila, 1)], id: 'ex-2', ahoraIso: dia(1) });
  assert.ok(!r3.informe.incidencias.some((i) => i.id === 'catalogo:reduccion_brusca'), 'con menos de 20 fichas previas no se declara reducción brusca');
});

test('seguimiento: tabla ausente, ambigua o con error de lectura = sin memoria (no_procede) y el informe sale igualmente; sólo se guardan orígenes válidos', () => {
  const ps = catalogo(15);
  for (const [tablas, estado] of [[[], 'no_encontrada'], [[{ id: 'A', name: TABLA }, { id: 'B', name: `${TABLA}_2` }], 'ambigua'], [[{ error: 'x' }], 'error_lectura']]) {
    const r = ejecutar(ps, { tablas });
    assert.equal(r.informe.persistencia.tabla.estado, estado);
    assert.equal(r.informe.persistencia.escritura.resultado, 'no_procede');
    assert.equal(r.fila, null);
    assert.deepEqual(validarEsquema(r.informe, SCHEMA), []);
  }
  assert.equal(ejecutar(ps, { origen: 'webhook' }).informe.persistencia.escritura.motivo, 'origen_no_valido');
  assert.equal(ejecutar(ps, { id: '' }).informe.persistencia.escritura.motivo, 'sin_id_ejecucion');
  const r = ejecutar(ps, { id: 'ex-1' });
  assert.equal(ejecutar(ps, { id: 'ex-1', historial: [filaDe(r.fila, 1)], ahoraIso: dia(1) }).informe.persistencia.escritura.motivo, 'ya_guardada');
});

test('escritura: «guardada» sólo con la fila real devuelta por el Insert; «pendiente» si no hay confirmación; «fallida» con error o sin fila', () => {
  const { informe } = ejecutar(catalogo(15));
  assert.equal(informe.persistencia.escritura.resultado, 'pendiente');
  const ok = Q.confirmarEscrituraCalidad(informe, [{ id: 7, idEjecucion: 'ex-1', entorno: 'local' }]);
  assert.deepEqual([ok.persistencia.escritura.resultado, ok.persistencia.escritura.filaId], ['guardada', 7]);
  assert.match(ok.markdown, /guardada/);
  assert.match(ok.markdown, /^# Calidad del catálogo/, 'el Markdown es el de este agente, no el del Auditor');
  const otra = Q.confirmarEscrituraCalidad(informe, [{ id: 7, idEjecucion: 'ex-OTRA' }]);
  assert.deepEqual([otra.persistencia.escritura.resultado, otra.persistencia.escritura.motivoFallo], ['fallida', 'sin_confirmacion']);
  const err = Q.confirmarEscrituraCalidad(informe, [{ error: 'Data table not found' }]);
  assert.deepEqual([err.persistencia.escritura.resultado, err.persistencia.escritura.motivoFallo], ['fallida', 'error_insert']);
  assert.equal(Q.confirmarEscrituraCalidad(informe, []).persistencia.escritura.resultado, 'fallida');
  const noGuardar = ejecutar(catalogo(15), { tablas: [] }).informe;
  assert.equal(Q.confirmarEscrituraCalidad(noGuardar, [{ id: 1, idEjecucion: 'ex-1' }]), noGuardar, 'sin intención de guardar, no cambia nada');
  assert.deepEqual(validarEsquema(ok, SCHEMA), []);
});

test('persistentes: una ADVERTENCIA que persiste sube su puntuación un 25 % (una vez); lo confirmado no cambia', () => {
  const ps = () => [...Array.from({ length: 10 }, (_, i) => prod({ id: `pp${i}` })), prod({ id: 'pp-adv', descriptionLength: 10 }), prod({ id: 'pp-conf', image: null })];
  const r1 = ejecutar(ps(), { id: 'ex-1', ahoraIso: dia(0) });
  const adv1 = deFicha(r1.informe, 'descripcion_corta', 'pp-adv');
  const r2 = ejecutar(ps(), { historial: [filaDe(r1.fila, 1)], id: 'ex-2', ahoraIso: dia(1) });
  const adv2 = deFicha(r2.informe, 'descripcion_corta', 'pp-adv');
  assert.equal(adv2.persistente, true);
  assert.equal(adv2.puntuacion, Math.round(adv1.puntuacion * 1.25));
  assert.equal(deFicha(r2.informe, 'sin_imagen', 'pp-conf').puntuacion, deFicha(r1.informe, 'sin_imagen', 'pp-conf').puntuacion);
  assert.equal(deFicha(r2.informe, 'sin_imagen', 'pp-conf').persistente, undefined);
});

/* ═════════ 9. Límites de tamaño ═════════ */
test('límites: 800 productos con muchas incidencias → la fila cabe, o NO se guarda con el motivo explícito (nunca se trunca en silencio ni se guarda a medias)', () => {
  const ps = catalogo(800, (i) => (i % 2 ? { image: null, descriptionLength: 5, title: 'Corto', price: null } : { descriptionLength: 5 }));
  const t0 = Date.now();
  const r = ejecutar(ps, { cfg: cfg() });
  assert.ok(Date.now() - t0 < 10000, 'rápido');
  assert.equal(r.informe.fuente.completo, true);
  assert.deepEqual(validarEsquema(r.informe, SCHEMA), []);
  assert.ok(r.informe.incidencias.length <= Q.UMBRALES_CALIDAD.maxIncidenciasInforme);
  if (r.fila) { assert.ok(COM.bytesUtf8(r.fila.payload) <= SEG.LIMITES_PERSISTENCIA.maxBytesInstantanea); assert.equal(r.informe.persistencia.escritura.guardar, true); }
  else { assert.equal(r.informe.persistencia.escritura.motivo, 'instantanea_demasiado_grande'); assert.equal(r.informe.persistencia.escritura.resultado, 'no_procede'); }
  const tipico = ejecutar(catalogo(131, (i) => (i % 5 === 0 ? { image: null } : {})));
  assert.ok(tipico.fila, 'un catálogo como el actual (131 fichas) se guarda');
  assert.ok(COM.bytesUtf8(tipico.fila.payload) < 30000, `instantánea típica pequeña (${COM.bytesUtf8(tipico.fila.payload)} B)`);
  assert.ok(COM.bytesUtf8(JSON.stringify(tipico.informe)) < 200000);
});

/* ═════════ 10. Compatibilidad con el Auditor General y seguridad del código ═════════ */
test('NO REGRESIÓN: los workflows generados del Auditor General siguen idénticos a lo construido (sincronía) y el linter de producción pasa', () => {
  const comprobar = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/automation/build-workflows.mjs'), '--check'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(comprobar.status, 0, comprobar.stdout + comprobar.stderr);
  assert.match(comprobar.stdout, /✔ auditor-general\.produccion\.json/);
  assert.match(comprobar.stdout, /✔ auditor-general\.local\.json/);
  const lint = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/automation/lint-workflows.mjs'), 'automation/workflows/auditor-general.produccion.json', 'automation/workflows/auditor-general.local.json'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  for (const f of ['auditor-general.produccion.json', 'auditor-general.local.json']) {
    const w = J(`automation/workflows/${f}`);
    const codigo = w.nodes.filter((x) => x.type === 'n8n-nodes-base.code').map((x) => x.parameters.jsCode).join('\n');
    assert.ok(!/calidadCatalogo|urlPolicyCalidad|lectura_catalogo|construirInformeCalidad/.test(codigo), `${f} no incorpora nada del Agente 04`);
  }
});

test('seguridad del código: los módulos nuevos son puros (sin red, disco, reloj, aleatoriedad, entorno ni evaluación dinámica) y sólo importan módulos de la biblioteca', () => {
  for (const f of ['calidadCatalogo.mjs', 'urlPolicyCalidad.mjs']) {
    const src = fs.readFileSync(path.join(RAIZ, 'automation/lib', f), 'utf8');
    for (const prohibido of [/\bfetch\s*\(/, /\brequire\s*\(/, /\bprocess\./, /\bDate\.now\s*\(/, /\bnew Date\s*\(\s*\)/, /Math\.random/, /\beval\s*\(/, /new Function/, /\bimport\s*\(/, /child_process/, /\bfs\./, /XMLHttpRequest/, /TRADYLOR_API_TOKEN/, /\bsetTimeout\b|\bsetInterval\b/, /structuredClone/, /\bURL\s*\(/, /\bTextEncoder\b|\bBuffer\b/]) {
      assert.ok(!prohibido.test(src), `${f}: ${prohibido}`);
    }
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    for (const im of imports) assert.match(im, /^\.\/(common|urlPolicy|urlPolicyCalidad|seguimiento|auditor)\.mjs$/, `${f} importa ${im}`);
    assert.ok(!/^[ \t]*`[^`\n]*$/m.test(src.replace(/`[^`\n]*`/g, '')), `${f}: sin plantillas multilínea (el constructor no las admite)`);
  }
});

test('incrustación: dos nodos «Code» podados (Analizar → Informe) dan el MISMO resultado que el módulo, sin imports, y cada uno cabe holgadamente en el límite de 80 kB', () => {
  const analizarCod = empaquetar('calidad', 'leerFeedCalidad(objetivos, respuestas, cfg); analizarCalidad(feed, cfg, ahoraIso);');
  const informeCod = empaquetar('calidad', 'construirInformeDesdeAnalisis(entrada);');
  const confirmarCod = empaquetar('calidad', 'confirmarEscrituraCalidad(informe, salida);');
  const tam = { analizar: COM.bytesUtf8(analizarCod), informe: COM.bytesUtf8(informeCod), confirmar: COM.bytesUtf8(confirmarCod) };
  console.log(`  ℹ bytes de la biblioteca podada por nodo: Analizar ${tam.analizar} · Informe ${tam.informe} · Confirmar ${tam.confirmar} (límite del linter por nodo: 80000, con el código propio del nodo)`);
  assert.ok(tam.analizar <= 70000, `Analizar: ${tam.analizar} B`);
  assert.ok(tam.informe <= 70000, `Informe: ${tam.informe} B`);
  assert.ok(tam.confirmar <= 30000, `Confirmar: ${tam.confirmar} B`);
  assert.ok(Math.max(tam.analizar, tam.informe) < COM.bytesUtf8(empaquetar('calidad', 'construirInformeCalidadYFila(entrada);')), 'dividir en dos nodos reduce el tamaño de cada uno');
  const ps = [...catalogo(30), prod({ id: 'emb1', price: null }), prod({ id: 'emb2', title: 'Monitor Dell 27 pulgadas QHD', price: 200 }), prod({ id: 'emb3', title: 'Monitor Dell 27 pulgadas QHD', price: 201 })];
  const entrada = plano(entradaDe(ps, { persistencia: { tablas: TABLAS_OK, historial: [], idEjecucion: 'ex-1', origen: 'manual' } }));
  // nodo «Analizar» (recibe objetivos y respuestas de los nodos HTTP) → items JSON → nodo «Informe»
  const ctx1 = vm.createContext({ cfg: entrada.cfg, objetivos: entrada.objetivosCatalogo, respuestas: entrada.respuestasCatalogo, ahoraIso: entrada.ahoraIso });
  const salidaAnalizar = JSON.parse(vm.runInContext(`${analizarCod}
;(() => { const feed = leerFeedCalidad(objetivos, respuestas, cfg); return JSON.stringify({ feed, analisis: analizarCalidad(feed, cfg, ahoraIso) }); })()`, ctx1));
  const ctx2 = vm.createContext({ entrada: { cfg: entrada.cfg, ahoraIso: entrada.ahoraIso, persistencia: entrada.persistencia, ...salidaAnalizar } });
  const salidaInforme = JSON.parse(vm.runInContext(`${informeCod}
;(() => { const r = construirInformeDesdeAnalisis(entrada); return JSON.stringify({ informe: r.informe, fila: r.fila }); })()`, ctx2));
  const directo = Q.construirInformeCalidadYFila(entrada);
  assert.deepEqual(salidaInforme, plano({ informe: directo.informe, fila: directo.fila }));
  const conf = vm.runInContext(`${confirmarCod}
;JSON.stringify(confirmarEscrituraCalidad(informe, [{ id: 3, idEjecucion: 'ex-1' }]).persistencia.escritura)`, vm.createContext({ informe: salidaInforme.informe }));
  assert.equal(JSON.parse(conf).resultado, 'guardada');
  for (const cod of [analizarCod, informeCod, confirmarCod]) assert.ok(!/(^|[\r\n])\s*(import|export)\s/.test(cod), 'sin import ni export en el código incrustado');
  assert.ok(!/analizarCalidad|leerFeedCalidad|detectarDuplicados/.test(informeCod), 'el nodo Informe no arrastra las reglas');
  assert.ok(!/ejecutarSeguimiento|resumirInstantanea|compararConEstado/.test(analizarCod), 'el nodo Analizar no arrastra el seguimiento');
});

test('dos nodos: el análisis sobrevive al paso por JSON, no se muta al construir el informe y es el mismo que el del envoltorio', () => {
  const ps = [...catalogo(25), prod({ id: 'dn1', price: null }), prod({ id: 'dn2', descriptionLength: 10 })];
  const e = entradaDe(ps, { persistencia: { tablas: TABLAS_OK, historial: [], idEjecucion: 'ex-1', origen: 'manual' } });
  const feed = Q.leerFeedCalidad(e.objetivosCatalogo, e.respuestasCatalogo, e.cfg);
  const analisis = Q.analizarCalidad(feed, e.cfg, e.ahoraIso);
  const viaJson = { feed: plano(feed), analisis: plano(analisis) };
  const antes = plano(viaJson);
  const r = Q.construirInformeDesdeAnalisis({ cfg: e.cfg, ahoraIso: e.ahoraIso, persistencia: e.persistencia, ...viaJson });
  assert.deepEqual(viaJson, antes, 'la entrada no se modifica');
  assert.deepEqual(r.informe, Q.construirInformeCalidad(e));
  assert.throws(() => Q.construirInformeDesdeAnalisis({ cfg: { ...e.cfg, modo: 'publico' }, ahoraIso: e.ahoraIso, ...viaJson }), /configuración del agente de calidad no válida/);
  assert.throws(() => Q.construirInformeCalidad({ ...e, cfg: { ...e.cfg, modo: 'publico' } }), /configuración del agente de calidad no válida/);
});

test('rendimiento y estabilidad con un catálogo del tamaño actual (131 fichas, con defectos variados)', () => {
  const ps = catalogo(131, (i) => ({ ...(i % 9 === 0 ? { image: null } : {}), ...(i % 11 === 0 ? { price: null } : {}), ...(i % 13 === 0 ? { descriptionLength: 10 } : {}), network: ['amazon', 'aliexpress', 'ebay', 'temu'][i % 4], hasAffiliateLink: i % 4 !== 0 || i % 3 === 0 }));
  const t0 = Date.now();
  const a = informeDe(ps);
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(validarEsquema(a, SCHEMA), []);
  assert.deepEqual(a, informeDe(ps));
  assert.ok(a.resumen.productosConIncidencias > 0);
});

/* ═════════ C3 (comercio «[object Object]»): al final del archivo para no alterar el contador de fixtures `prod()` que usan las pruebas anteriores ═════════ */
test('C3: comercio «[object Object]» → defecto CONFIRMADO de calidad de datos con id, red y campo; sólo informa y no presume la red', () => {
  const ps = [
    ...catalogo(12),
    prod({ id: 'c3-amazon', network: 'amazon', merchant: '[object Object]' }), prod({ id: 'c3-ali', network: 'aliexpress', merchant: '[object Object]' }),
    prod({ id: 'c3-ebay', network: 'ebay', merchant: '[object Object]' }), prod({ id: 'c3-sinred', network: null, merchant: '[object Object]' }),
    prod({ id: 'c3-ok', network: 'amazon', merchant: 'Amazon' }),
  ];
  const antes = JSON.stringify(ps);
  const inf = informeDe(ps);
  assert.equal(JSON.stringify(ps), antes, 'el motor no modifica los productos del feed');
  const afectadas = hallazgos(inf, 'comercio_malformado');
  assert.deepEqual(afectadas.map((i) => i.producto.id).sort(), ['c3-ali', 'c3-amazon', 'c3-ebay', 'c3-sinred'], 'sólo las fichas con el valor exacto; no se asume ninguna red');
  for (const i of afectadas) {
    assert.equal(i.certeza, 'confirmado');
    assert.equal(i.clase, 'calidad_datos');
    assert.equal(i.area, 'ficha');
    assert.equal(i.id, `ficha:comercio_malformado:${i.producto.id}`, 'id estable para el seguimiento');
    assert.equal(i.evidencia.campo, 'merchant');
    assert.equal(i.evidencia.valor, '[object Object]');
    assert.equal(i.evidencia.red, i.producto.red, 'la red es la que declara el feed (o null), nunca una deducida');
    assert.ok(i.puntuacion > 0 && /^P[1-4]$/.test(i.prioridad));
    assert.match(i.accionSugerida, /sin reparación automática/);
    assert.deepEqual(Object.keys(i).filter((k) => /patch|repar|correc|fix/i.test(k)), [], 'la incidencia no lleva ninguna corrección propuesta ejecutable');
  }
  assert.deepEqual(Object.fromEntries(afectadas.map((i) => [i.producto.id, i.producto.red])), { 'c3-amazon': 'amazon', 'c3-ali': 'aliexpress', 'c3-ebay': 'ebay', 'c3-sinred': null });
  assert.ok(!deFicha(inf, 'comercio_malformado', 'c3-ok'), 'un comercio normal no se marca');
  assert.deepEqual(validarEsquema(inf, SCHEMA), []);
  assert.equal(inf.resumen.confirmados >= 4, true);
  const md = Q.informeMarkdownCalidad(inf);
  for (const id of ['c3-amazon', 'c3-ali', 'c3-ebay', 'c3-sinred']) assert.ok(md.includes(id), `el Markdown nombra la ficha ${id}`);
  assert.match(md, /Comercio con valor malformado/);
});

test('C3: si el feed no entrega `merchant` no se afirma el defecto (queda como dato no verificable) y las demás reglas siguen igual', () => {
  const sin = prod({ id: 'c3-sin-campo' });
  delete sin.merchant;
  const inf = informeDe([...catalogo(12), sin]);
  assert.equal(hallazgos(inf, 'comercio_malformado').length, 0);
  assert.ok(hallazgos(inf, 'campo_no_entregado').length >= 1);
  // Una ficha con el defecto sigue evaluándose con TODAS las demás reglas (el defecto no las sustituye ni las oculta).
  const mixta = prod({ id: 'c3-mixta', merchant: '[object Object]', image: null, price: null });
  const i2 = informeDe([...catalogo(12), mixta]);
  for (const c of ['comercio_malformado', 'sin_imagen', 'precio_ausente']) assert.ok(deFicha(i2, c, 'c3-mixta'), c);
});

test('C3: la misma entrada da el mismo informe (determinismo) y el seguimiento reconoce la incidencia como persistente en la segunda ejecución', () => {
  const ps = [...catalogo(12), prod({ id: 'c3-x', merchant: '[object Object]' })];
  const a = informeDe(ps), b = informeDe(ps);
  assert.deepEqual(plano(a), plano(b));
  const clave = a.incidencias.find((i) => i.regla === 'comercio_malformado');
  assert.ok(clave && /^ficha:comercio_malformado:c3-x$/.test(clave.id));
});
