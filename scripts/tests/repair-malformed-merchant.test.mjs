// C3 — reparación `malformed-merchant` (catalogRepair.ts): fichas antiguas de Amazon cuyo comercio quedó en «[object Object]».
// Solo funciones puras y copias temporales: no toca el catálogo real, sin red, sin importaciones y sin IA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planRepairs, applyPlan, applyRollback, amazonProvenance, recoverVendorName, MALFORMED_MERCHANT_VALUE } from '../../src/lib/catalogRepair.ts';
import { projectProduct } from '../../src/lib/automationCatalog.ts';
import { prod, catalogo, entradaDe, plano } from './_calidadFixtures.mjs';

const Q = await import('../../automation/lib/calidadCatalogo.mjs');
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BAD = '[object Object]';
const clone = (x) => structuredClone(x);
const solo = (plan) => plan.items.filter((i) => i.kind === 'malformed-merchant');

/** Ficha como la dejó el importador antiguo de Amazon: comercio «[object Object]» y el JSON crudo guardado en `extra.scraperApiSource`. */
const ficha = (id, vendor, over = {}) => ({
  id, slug: id, title: `Producto ${id}`, description: 'Descripción de prueba', price: 49.9, originalPrice: 59.9, image: '/images/products/x.jpg', category: 'Informática',
  merchant: BAD, brand: 'Zeta', network: 'amazon', asin: 'B0TEST0001', affiliateUrl: 'https://www.amazon.es/dp/B0TEST0001?tag=x-21',
  buyNowUrl: 'https://www.amazon.es/gp/aws/cart/add.html?ASIN.1=B0TEST0001&Quantity.1=1', rating: 4.2, reviewsCount: 35, inStock: true, priceHistory: [], pros: ['a'], cons: ['b'],
  extra: { importSource: 'scraperapi-amazon-json', scraperApiSource: { asin: 'B0TEST0001', seller: vendor === undefined ? undefined : { id: null, url: 'https://www.amazon.com', name: vendor, phone: '1' } }, fulfillmentProvider: 'Amazon Logistics' },
  ...over,
});
/** Las seis de producción: 2 vendidas por Amazon y 4 por vendedores externos. */
const SEIS = () => [
  ficha('amz-1', 'Amazon'), ficha('amz-2', 'Amazon'), ficha('ext-1', 'TecnoOfertas SL'), ficha('ext-2', 'ElectroHogar'), ficha('ext-3', 'Gadgets Norte'), ficha('ext-4', '  Mundo   Sonido  '),
];
const sanas = () => [{ id: 'ok-1', title: 'Sana', merchant: 'Amazon', network: 'amazon', brand: 'Zeta' }, { id: 'ok-2', title: 'Otra', merchant: 'TiendaY', network: 'ebay' }];

// ── 1. El caso real ─────────────────────────────────────────────────────────────────────────────────────────────
test('las seis fichas: cada comercio pasa a su vendedor ORIGINAL (los externos NO se sustituyen por «Amazon»); solo cambia `merchant`', () => {
  const entrada = [...SEIS(), ...sanas()];
  const antes = JSON.stringify(entrada);
  const plan = planRepairs(entrada);
  assert.equal(JSON.stringify(entrada), antes, 'planificar no muta la entrada');
  const items = solo(plan);
  assert.equal(items.length, 6);
  assert.equal(plan.summary['malformed-merchant'], 6);
  assert.deepEqual(Object.fromEntries(items.map((i) => [i.id, i.patch])), {
    'amz-1': { merchant: 'Amazon' }, 'amz-2': { merchant: 'Amazon' }, 'ext-1': { merchant: 'TecnoOfertas SL' }, 'ext-2': { merchant: 'ElectroHogar' }, 'ext-3': { merchant: 'Gadgets Norte' }, 'ext-4': { merchant: 'Mundo Sonido' },
  });
  const { products: reparados } = applyPlan(entrada, plan);
  for (const p of reparados.filter((x) => /^(amz|ext)-/.test(x.id))) {
    assert.notEqual(p.merchant, BAD);
    const orig = entrada.find((x) => x.id === p.id);
    const { merchant, ...resto } = p;
    const { merchant: _m, ...restoOrig } = orig;
    assert.deepEqual(resto, restoOrig, `${p.id}: ningún otro campo cambia (ni extra.scraperApiSource ni fulfillmentProvider)`);
  }
  assert.deepEqual(reparados.filter((x) => /^ok-/.test(x.id)), sanas(), 'las fichas sanas no se tocan');
});

// ── 2. Solo el valor exacto ─────────────────────────────────────────────────────────────────────────────────────
test('solo `merchant === "[object Object]"`: variantes, otros valores y comercios normales no generan ninguna acción', () => {
  assert.equal(MALFORMED_MERCHANT_VALUE, BAD);
  for (const valor of [' [object Object] ', '[Object object]', '[object  object]', 'Amazon', 'TiendaX', '', null, undefined, 'Tienda [object Object] SL', { name: 'x' }]) {
    assert.deepEqual(solo(planRepairs([ficha('v1', 'TiendaX', { merchant: valor })])), [], JSON.stringify(valor));
  }
});

// ── 3. Procedencia Amazon ───────────────────────────────────────────────────────────────────────────────────────
test('evidencia POSITIVA suficiente por cualquiera de las tres señales (red explícita, URL de Amazon, importSource del importador antiguo)', () => {
  const base = { affiliateUrl: undefined, buyNowUrl: undefined, network: undefined };
  const casos = [
    ['solo network', ficha('p1', 'TiendaX', { ...base, network: 'amazon', extra: { scraperApiSource: { seller: 'TiendaX' } } })],
    ['solo URL de afiliado', ficha('p2', 'TiendaX', { ...base, affiliateUrl: 'https://www.amazon.es/dp/B0TEST0002', extra: { scraperApiSource: { seller: 'TiendaX' } } })],
    ['solo URL de compra', ficha('p3', 'TiendaX', { ...base, buyNowUrl: 'https://www.amazon.es/gp/aws/cart/add.html?ASIN.1=B0', extra: { scraperApiSource: { seller: 'TiendaX' } } })],
    ['solo importSource', ficha('p4', 'TiendaX', { ...base, extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller: 'TiendaX' } } })],
  ];
  for (const [desc, p] of casos) {
    assert.equal(amazonProvenance(p).ok, true, desc);
    assert.deepEqual(solo(planRepairs([p]))[0].patch, { merchant: 'TiendaX' }, desc);
  }
});

test('SIN evidencia positiva → solo informe (el ASIN solo no cuenta; ni el nombre del vendedor ni el texto del comercio)', () => {
  const sinSenales = ficha('s1', 'Amazon', { network: undefined, affiliateUrl: undefined, buyNowUrl: undefined, asin: 'B0TEST0009', extra: { scraperApiSource: { seller: { name: 'Amazon' } } } });
  const item = solo(planRepairs([sinSenales]))[0];
  assert.deepEqual(item.patch, {});
  assert.match(item.detail, /sin procedencia Amazon demostrable/);
  assert.equal(amazonProvenance(sinSenales).ok, false);
});

test('cualquier señal CONTRARIA anula la reparación aunque haya evidencia positiva', () => {
  const contrarias = [
    ['network ebay + URL de Amazon', ficha('c1', 'X', { network: 'ebay' })],
    ['network aliexpress', ficha('c2', 'X', { network: 'aliexpress' })],
    ['network amazon + URL de AliExpress', ficha('c3', 'X', { affiliateUrl: 'https://es.aliexpress.com/item/1005001.html' })],
    ['network amazon + URL de eBay', ficha('c4', 'X', { buyNowUrl: 'https://www.ebay.es/itm/123456789012' })],
    ['crossMerchant con otra red', ficha('c5', 'X', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller: 'X' }, crossMerchant: { networks: ['amazon', 'ebay'] } } })],
    ['marcador de red Awin en una URL de otro dominio', ficha('c6', 'X', { affiliateUrl: 'https://tienda.example/p/1?awc=1234_5678_abcdef' })],
  ];
  for (const [desc, p] of contrarias) {
    const r = amazonProvenance(p);
    assert.equal(r.ok, false, desc);
    assert.match(r.reason, /señales contrarias/, desc);
    const item = solo(planRepairs([p]))[0];
    assert.deepEqual(item.patch, {}, desc);
    assert.match(item.detail, /solo informe/, desc);
  }
});

// ── 4. Recuperar el nombre del vendedor; nunca inventarlo ───────────────────────────────────────────────────────
test('el nombre sale de `seller.name` o de `seller` como cadena; sin nombre utilizable NO se inventa (ni siquiera «Amazon»)', () => {
  const conSeller = (seller, extraRaw = {}) => ficha('n', 'x', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller, ...extraRaw } } });
  assert.equal(recoverVendorName(conSeller({ name: 'Vendedor Uno' })), 'Vendedor Uno');
  assert.equal(recoverVendorName(conSeller('Vendedor Dos')), 'Vendedor Dos');
  assert.equal(recoverVendorName(conSeller({ name: '  Vendedor   Tres ' })), 'Vendedor Tres');
  for (const malo of [undefined, null, {}, { id: 1 }, { name: '' }, { name: '   ' }, { name: 7 }, { name: { x: 1 } }, ['A'], 7, true, { name: BAD }, BAD, { name: '<b>x</b>' }, { name: 'x'.repeat(121) }]) {
    assert.equal(recoverVendorName(conSeller(malo)), null, JSON.stringify(malo));
    const item = solo(planRepairs([conSeller(malo)]))[0];
    assert.deepEqual(item.patch, {}, 'sin nombre original no hay parche');
    assert.match(item.detail, /no conserva el nombre del vendedor; no se inventa/);
  }
  const sinRaw = ficha('r', 'x', { extra: { importSource: 'scraperapi-amazon' } });
  assert.equal(recoverVendorName(sinRaw), null);
  assert.deepEqual(solo(planRepairs([sinRaw]))[0].patch, {});
  assert.equal(recoverVendorName({ extra: { scraperApiSource: [] } }), null);
  assert.equal(recoverVendorName({}), null);
});

// ── 5. Bloqueos manuales ────────────────────────────────────────────────────────────────────────────────────────
test('respeta `lockedFields` con merchant y `fieldSources.merchant = manual` (solo informe); otros bloqueos no impiden la reparación', () => {
  const base = SEIS()[2].extra;
  const l1 = ficha('l1', 'TiendaX', { extra: { ...base, lockedFields: ['merchant'] } });
  const l2 = ficha('l2', 'TiendaX', { extra: { ...base, fieldSources: { merchant: 'manual' } } });
  const l3 = ficha('l3', 'TiendaX', { extra: { ...base, lockedFields: ['brand', 'rating'] } });
  const l4 = ficha('l4', 'TiendaX', { extra: { ...base, fieldSources: { merchant: 'import', brand: 'manual' } } });
  const items = Object.fromEntries(solo(planRepairs([l1, l2, l3, l4])).map((i) => [i.id, i]));
  assert.deepEqual(items.l1.patch, {}); assert.match(items.l1.detail, /bloqueado o editado a mano/);
  assert.deepEqual(items.l2.patch, {}); assert.match(items.l2.detail, /bloqueado o editado a mano/);
  assert.deepEqual(items.l3.patch, { merchant: 'TecnoOfertas SL' });
  assert.deepEqual(items.l4.patch, { merchant: 'TecnoOfertas SL' });
});

// ── 6. Idempotencia y reversión con los mecanismos existentes ──────────────────────────────────────────────────
test('idempotente (un segundo plan no propone nada) y reversible (applyRollback restaura el original exacto)', () => {
  const entrada = [...SEIS(), ...sanas()];
  const plan = planRepairs(entrada);
  const { products: una, rollback } = applyPlan(entrada, plan);
  assert.equal(solo(planRepairs(una)).length, 0, 'tras reparar ya no hay defecto');
  const { products: dos } = applyPlan(una, planRepairs(una));
  assert.deepEqual(plano(dos.filter((p) => /^(amz|ext)-/.test(p.id))), plano(una.filter((p) => /^(amz|ext)-/.test(p.id))), 'aplicar dos veces = aplicar una');
  assert.equal(rollback.filter((r) => r.before.merchant === BAD).length, 6);
  assert.deepEqual(applyRollback(una, rollback), entrada, 'la reversión devuelve exactamente la entrada original');
});

test('las fichas que solo se informan no entran en el parche inverso ni cambian al aplicar', () => {
  const entrada = [ficha('i1', 'X', { network: 'ebay' }), ficha('i2', 'Y', { extra: { importSource: 'scraperapi-amazon' } }), ficha('ok', 'Z')];
  const { products, rollback } = applyPlan(entrada, planRepairs(entrada));
  assert.deepEqual(products.filter((p) => p.id !== 'ok'), entrada.filter((p) => p.id !== 'ok'), 'informadas: intactas');
  assert.deepEqual(rollback.map((r) => r.id), ['ok']);
});

// ── 7. Los demás tipos de reparación no cambian ────────────────────────────────────────────────────────────────
test('los otros tipos de reparación se comportan como antes (contadores y detalle)', () => {
  const plan = planRepairs([{ id: 'a', title: 'A', brand: 'Amazon', merchant: 'Amazon', network: 'amazon', specs: { Marca: 'Fineblue' } }]);
  assert.equal(plan.summary['brand-is-merchant'], 1);
  assert.equal(plan.summary['brand-spec-mismatch'], 1);
  assert.equal(plan.summary['malformed-merchant'], 0);
});

// ── 8. Simulación segura con el script sobre una COPIA ─────────────────────────────────────────────────────────
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const correr = (...args) => spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', 'scripts/repair-catalog.mjs', ...args], { cwd: RAIZ, encoding: 'utf8' });

test('script: simulación sin escribir nada; `--solo malformed-merchant` restringe la copia reparada a este tipo; `--undo` restaura', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treidilor-c3-'));
  try {
    const copia = path.join(dir, 'products-copia.json');
    // Las seis + una ficha con OTRO defecto antiguo (marca = tienda) que `--solo` NO debe tocar.
    const datos = [...SEIS(), ...sanas(), { id: 'otro-defecto', title: 'Otro', brand: 'Amazon', merchant: 'Amazon', network: 'amazon' }];
    fs.writeFileSync(copia, JSON.stringify(datos, null, 2));
    const huella = sha(copia);

    const seco = correr(copia, '--solo', 'malformed-merchant');
    assert.equal(seco.status, 0, seco.stderr);
    assert.match(seco.stdout, /solo «malformed-merchant»/);
    assert.match(seco.stdout, /'malformed-merchant': 6/);
    assert.match(seco.stdout, /Dry-run: no se ha escrito nada/);
    assert.equal((seco.stdout.match(/\[malformed-merchant\]/g) || []).length, 6);
    assert.ok(!/brand-is-merchant\]/.test(seco.stdout), 'con --solo no se muestran otros tipos');
    assert.equal(sha(copia), huella, 'la simulación no modifica el archivo');
    assert.deepEqual(fs.readdirSync(dir), ['products-copia.json'], 'y no crea archivos');

    const out = path.join(dir, 'reparado.json'); const rb = path.join(dir, 'reversion.json');
    const aplicado = correr(copia, '--solo', 'malformed-merchant', '--out', out, '--rollback', rb);
    assert.equal(aplicado.status, 0, aplicado.stderr);
    assert.equal(sha(copia), huella, 'la entrada nunca se sobrescribe');
    const reparado = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(reparado.filter((p) => /^(amz|ext)-/.test(p.id)).map((p) => p.merchant), ['Amazon', 'Amazon', 'TecnoOfertas SL', 'ElectroHogar', 'Gadgets Norte', 'Mundo Sonido']);
    assert.deepEqual(reparado.find((p) => p.id === 'otro-defecto'), datos.find((p) => p.id === 'otro-defecto'), '--solo no aplica otros tipos de reparación');

    const sinSolo = correr(copia, '--out', path.join(dir, 'todo.json'), '--rollback', path.join(dir, 'todo.rb.json'));
    assert.equal(sinSolo.status, 0, sinSolo.stderr);
    assert.notDeepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'todo.json'), 'utf8')).find((p) => p.id === 'otro-defecto'), datos.find((p) => p.id === 'otro-defecto'), 'sin --solo se aplican TODOS los tipos (por eso se recomienda --solo)');

    const undo = correr(out, '--undo', rb, '--out', path.join(dir, 'restaurado.json'));
    assert.equal(undo.status, 0, undo.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'restaurado.json'), 'utf8')), datos, 'la reversión devuelve la copia original');

    const malo = correr(copia, '--solo', 'no-existe');
    assert.equal(malo.status, 1); assert.match(malo.stderr, /--solo debe ser uno de/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── 9. Flujo del Agente 04: detecta el defecto antes y deja de detectarlo tras una reparación SIMULADA ─────────
test('Agente 04: `comercio_malformado` detecta las seis fichas ANTES de reparar y ninguna DESPUÉS (reparación simulada sobre la copia)', () => {
  const catalogoReal = SEIS();
  const proyectar = (lista) => lista.map((p) => projectProduct(p));
  const informe = (lista) => Q.construirInformeCalidad(entradaDe([...catalogo(12), ...proyectar(lista)]));
  const antes = informe(catalogoReal);
  const detectadas = antes.incidencias.filter((i) => i.regla === 'comercio_malformado');
  assert.deepEqual(detectadas.map((i) => i.producto.id).sort(), ['amz-1', 'amz-2', 'ext-1', 'ext-2', 'ext-3', 'ext-4']);
  for (const i of detectadas) { assert.equal(i.producto.red, 'amazon'); assert.equal(i.evidencia.campo, 'merchant'); assert.equal(i.certeza, 'confirmado'); }
  const { products: reparado } = applyPlan(catalogoReal, planRepairs(catalogoReal));
  const despues = informe(reparado);
  assert.equal(despues.incidencias.filter((i) => i.regla === 'comercio_malformado').length, 0, 'tras la reparación simulada el agente ya no lo identifica');
  assert.deepEqual(despues.incidencias.find((i) => i.regla === 'comercio_malformado'), undefined);
  // y lo que el feed muestra como comercio es el vendedor original
  assert.deepEqual(proyectar(reparado).map((p) => p.merchant), ['Amazon', 'Amazon', 'TecnoOfertas SL', 'ElectroHogar', 'Gadgets Norte', 'Mundo Sonido']);
  // una ficha NO reparable (otra red) sigue detectándose: el agente no se silencia
  const mixta = [...SEIS(), ficha('ali-1', 'Z', { network: 'aliexpress' })];
  const { products: medio } = applyPlan(mixta, planRepairs(mixta));
  assert.deepEqual(informe(medio).incidencias.filter((i) => i.regla === 'comercio_malformado').map((i) => i.producto.id), ['ali-1']);
});
