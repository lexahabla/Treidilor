// Regresión C3: el comercio (y la marca / el distribuidor) de una ficha de Amazon NUNCA puede ser «[object Object]».
// Causa: `String(raw.merchant || raw.seller || 'Amazon')` convertía el objeto `seller` { name, url, … } del JSON real de Amazon en texto.
// Sin red, sin ScraperAPI, sin Apify y sin IA; los datos se escriben solo en un directorio temporal aislado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupIsolatedData, readCatalog, adminCookie, apiRequest, jsonOf, mockFetch } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-amazon-norm-');
const { normalizeScrapedAmazonData, importAmazonProductFromRawJson } = await import('../../src/lib/amazonImport.ts');
const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/amazon-real-sample-es.json', import.meta.url), 'utf8'));
const BAD = '[object Object]';
const ASIN = 'B0TEST0001';
const norm = (extra) => normalizeScrapedAmazonData({ asin: ASIN, title: 'Producto de prueba', ...extra }, ASIN);
/** Recorre el objeto normalizado y devuelve las rutas donde aparece «[object Object]». */
const rutasMalas = (v, path = '', out = []) => {
  if (typeof v === 'string') { if (v.includes(BAD)) out.push(path || '(raíz)'); }
  else if (Array.isArray(v)) v.forEach((x) => rutasMalas(x, path + '[]', out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) rutasMalas(x, path ? path + '.' + k : k, out);
  return out;
};

// ── Los diez registros REALES (el `seller` es un objeto en todos y no hay `merchant`) ─────────────────────────────
test('los 10 registros reales de amazon-real-sample-es.json: comercio válido y ningún «[object Object]» en el resultado', () => {
  assert.equal(sample.length, 10);
  for (const r of sample) {
    assert.equal(typeof r.seller, 'object', 'la muestra real trae el vendedor como objeto');
    assert.equal(r.merchant, undefined);
    const n = normalizeScrapedAmazonData(r, r.asin);
    assert.equal(n.merchant, r.seller.name, `${r.asin}: el comercio sale del nombre del vendedor`);
    assert.notEqual(n.merchant, BAD);
    assert.deepEqual(rutasMalas(n), [], `${r.asin}: ningún campo normalizado contiene «${BAD}»`);
  }
});

test('regresión de lo que ya funcionaba con los 10 registros reales: identidad, título, marca y precio no cambian', () => {
  for (const r of sample) {
    const n = normalizeScrapedAmazonData(r, r.asin);
    assert.equal(n.asin, r.asin);
    assert.equal(n.title, String(r.title).trim());
    assert.equal(n.brand, typeof r.brand === 'string' && r.brand.trim() ? r.brand.trim() : undefined);
    assert.equal(n.price, typeof r.price?.value === 'number' ? r.price.value : n.price);
  }
});

// ── Formatos admitidos (compatibilidad) ─────────────────────────────────────────────────────────────────────────
test('comercio: cadena, objeto con name, precedencia y valores por defecto', () => {
  assert.equal(norm({ seller: 'TiendaX' }).merchant, 'TiendaX', 'formato actual: vendedor como texto');
  assert.equal(norm({ merchant: 'Amazon' }).merchant, 'Amazon');
  assert.equal(norm({ merchant: 'Amazon', seller: 'TiendaX' }).merchant, 'Amazon', 'merchant manda sobre seller');
  assert.equal(norm({ seller: { name: 'Amazon', url: 'https://www.amazon.com' } }).merchant, 'Amazon');
  assert.equal(norm({ seller: { name: '  TiendaX  ' } }).merchant, 'TiendaX', 'se recorta');
  assert.equal(norm({ merchant: { name: 'Z' }, seller: 'TiendaX' }).merchant, 'Z', 'merchant como objeto con name');
  assert.equal(norm({}).merchant, 'Amazon', 'sin datos: valor por defecto de siempre');
  assert.equal(norm({ merchant: '', seller: 'TiendaX' }).merchant, 'TiendaX', 'cadena vacía: pasa a la alternativa');
});

test('comercio: valores que NO son texto utilizable → alternativa o «Amazon», nunca «[object Object]»', () => {
  for (const bad of [{}, { id: null, url: 'x' }, { name: 5 }, { name: null }, { name: { x: 1 } }, [], [{ name: 'A' }], ['a'], null, undefined, true, false, () => 1]) {
    const n = norm({ seller: bad, merchant: bad });
    assert.equal(n.merchant, 'Amazon', JSON.stringify(bad));
    assert.deepEqual(rutasMalas(n), []);
  }
  assert.equal(norm({ merchant: {}, seller: { name: 'TiendaX' } }).merchant, 'TiendaX', 'un merchant sin texto no tapa a un seller válido');
});

test('marca y distribuidor (sold_by): mismo criterio y mismos formatos que antes', () => {
  assert.equal(norm({ brand: 'ASUS' }).brand, 'ASUS');
  assert.equal(norm({ brand: { name: 'ASUS' } }).brand, 'ASUS');
  assert.equal(norm({ marca: 'Zeta' }).brand, 'Zeta');
  assert.equal(norm({ brand: 'ASUS', marca: 'Zeta' }).brand, 'ASUS', 'brand manda sobre marca');
  assert.equal(norm({ brand: {}, marca: 'Zeta' }).brand, 'Zeta');
  assert.equal(norm({ brand: {} }).brand, undefined, 'sin marca fiable queda sin marca (nunca el texto del objeto)');
  assert.equal(norm({}).brand, undefined);
  assert.equal(norm({ sold_by: 'Vendedor SL' }).extra.fulfillmentProvider, 'Vendedor SL');
  assert.equal(norm({ sold_by: { name: 'Vendedor SL' } }).extra.fulfillmentProvider, 'Vendedor SL');
  assert.equal(norm({ sold_by: {} }).extra.fulfillmentProvider, undefined);
  assert.equal(norm({}).extra.fulfillmentProvider, undefined);
});

test('ninguna combinación de objetos en comercio, marca o distribuidor produce «[object Object]»', () => {
  const rares = [{}, { name: 'N' }, { a: { b: 1 } }, [], [{}], null, 0, 12];
  for (const m of rares) for (const s of rares) for (const b of rares) for (const f of rares) {
    const n = norm({ merchant: m, seller: s, brand: b, marca: b, sold_by: f });
    assert.deepEqual(rutasMalas(n), [], JSON.stringify({ m, s, b, f }));
  }
});

test('el resto de la normalización no cambia (precio, imagen, ASIN, stock)', () => {
  const n = norm({ price: '1.329,00 €', list_price: '1.499,00 €', image: 'https://img.invalid/a.jpg', seller: { name: 'TiendaX' }, in_stock: true });
  assert.equal(n.price, 1329);
  assert.equal(n.originalPrice, 1499);
  assert.equal(n.image, 'https://img.invalid/a.jpg');
  assert.equal(n.asin, ASIN);
  assert.equal(n.merchant, 'TiendaX');
});

// ── De extremo a extremo: lo que se ALMACENA ─────────────────────────────────────────────────────────────────────
test('importación del JSON real (función y ruta de API, con guardado): la ficha se almacena con comercio válido', async () => {
  const restore = mockFetch(async () => new Response('', { status: 404 }));       // ninguna petición real: imágenes e IA no responden
  try {
    const cookie = await adminCookie();
    const route = await import('../../src/pages/api/admin/amazon/import-json.ts');
    // 1) la función directamente, SIN guardar (vista previa): el producto ya sale con comercio válido
    const vista = await importAmazonProductFromRawJson(sample[0].asin, sample[0], { save: false });
    assert.equal(vista.success, true, JSON.stringify(vista).slice(0, 300));
    assert.equal(vista.product.merchant, sample[0].seller.name);
    // 2) la ruta de API guardando (en el directorio temporal aislado)
    const res = await jsonOf(await route.POST({ request: apiRequest('/api/admin/amazon/import-json', { cookie, body: { asin: sample[1].asin, raw: sample[1], options: { save: true } } }) }));
    assert.equal(res.success, true, JSON.stringify(res).slice(0, 300));
    const stored = readCatalog(dir).find((p) => p.asin === sample[1].asin);
    assert.ok(stored, 'la ficha quedó guardada en el catálogo aislado');
    assert.equal(stored.merchant, sample[1].seller.name);
    assert.notEqual(stored.merchant, BAD);
    assert.ok(!JSON.stringify(readCatalog(dir)).includes(BAD), 'ningún campo del catálogo guardado contiene «[object Object]»');
  } finally { restore(); }
});
