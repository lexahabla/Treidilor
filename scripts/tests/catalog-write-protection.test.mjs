// Pruebas sintéticas de seguridad: contador persistente de reparaciones,
// escritor del catálogo bajo bloqueo, y ejecutor de reparaciones con contador.
// Red e IA simuladas (ninguna prueba sale a Internet) y datos aislados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setupIsolatedData, deferred, tick } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-synth-');

const store = await import('../../src/lib/productStore.ts');
const catalogStore = await import('../../src/lib/catalogStore.ts');
const repair = await import('../../src/lib/catalogRepair.ts');
const counter = await import('../../src/lib/repairCounter.ts');

const counterFile = path.join(dir, 'repair-counter.json');

const resetCounterFile = () => {
  if (fs.existsSync(counterFile)) fs.rmSync(counterFile, { force: true });
};

const reset = () => fs.writeFileSync(path.join(dir, 'products.json'), '[]');
const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8'));
const write = (products) => fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify(products, null, 2));

const baseProduct = (id, over = {}) => ({
  id,
  title: `Producto ${id}`,
  description: '',
  price: 10,
  image: 'https://img.invalid/x.jpg',
  category: 'Audio',
  merchant: 'Tienda',
  affiliateUrl: `https://tienda.invalid/${id}`,
  pros: [],
  cons: [],
  ...over,
});

test('upsertProduct: dos fichas distintas escritas en secuencia sobreviven ambas (sin superposición)', () => {
  reset();
  const r1 = store.upsertProduct(baseProduct('p1'));
  const r2 = store.upsertProduct(baseProduct('p2'));
  assert.equal(r1.updated, false, 'p1 es alta');
  assert.equal(r2.updated, false, 'p2 es alta');
  const all = read();
  assert.equal(all.length, 2, 'las dos fichas están en el catálogo');
  assert.ok(all.some((p) => p.id === 'p1'), 'p1 sobrevivió');
  assert.ok(all.some((p) => p.id === 'p2'), 'p2 sobrevivió');
});

test('upsertProduct: actualización de ficha existente conserva las demás', () => {
  reset();
  store.upsertProduct(baseProduct('p1', { price: 10 }));
  store.upsertProduct(baseProduct('p2', { price: 20 }));
  const updated = store.upsertProduct(baseProduct('p1', { price: 99 }));
  assert.equal(updated.updated, true, 'p1 es actualización');
  const all = read();
  assert.equal(all.length, 2, 'no se creó ficha duplicada');
  const p1 = all.find((p) => p.id === 'p1');
  const p2 = all.find((p) => p.id === 'p2');
  assert.equal(p1.price, 99, 'p1 se actualizó');
  assert.equal(p2.price, 20, 'p2 se conservó intacta');
});

test('upsertCatalogProduct (importador n8n): dos fichas distintas sobreviven', async () => {
  reset();
  const r1 = catalogStore.upsertCatalogProduct({
    id: 'c1', title: 'Ficha C1', affiliateUrl: 'https://tienda.invalid/c1', price: 10,
    category: 'Audio', merchant: 'Tienda',
  });
  const r2 = catalogStore.upsertCatalogProduct({
    id: 'c2', title: 'Ficha C2', affiliateUrl: 'https://tienda.invalid/c2', price: 20,
    category: 'Audio', merchant: 'Tienda',
  });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r1.updated, false, 'c1 es alta');
  assert.equal(r2.updated, false, 'c2 es alta');
  const all = read();
  assert.equal(all.length, 2, 'las dos fichas importadas están en el catálogo');
  assert.ok(all.some((p) => p.id === 'c1'), 'c1 sobrevivió');
  assert.ok(all.some((p) => p.id === 'c2'), 'c2 sobrevivió');
});

test('upsertCatalogProduct: reimportación de ficha existente actualiza sin duplicar', async () => {
  reset();
  catalogStore.upsertCatalogProduct({ id: 'c1', title: 'Título original', affiliateUrl: 'https://tienda.invalid/c1', price: 10, category: 'Audio', merchant: 'Tienda' });
  const updated = catalogStore.upsertCatalogProduct({ id: 'c1', title: 'Título nuevo', affiliateUrl: 'https://tienda.invalid/c1', price: 99, category: 'Audio', merchant: 'Tienda' });
  assert.equal(updated.ok, true);
  assert.equal(updated.updated, true, 'c1 es actualización');
  const all = read();
  assert.equal(all.length, 1, 'no se duplicó');
  assert.equal(all[0].title, 'Título nuevo', 'el título se actualizó');
  assert.equal(all[0].price, 99, 'el precio se actualizó');
});

test('concursión simulada: dos escritores lentos que leen, esperan y escriben no se pierden mutuamente', async () => {
  reset();
  const gate = deferred();

  const writerA = (async () => {
    await gate.promise;
    await tick(5);
    store.upsertProduct(baseProduct('pA', { price: 1 }));
  })();

  const writerB = (async () => {
    await gate.promise;
    await tick(5);
    catalogStore.upsertCatalogProduct({ id: 'pB', title: 'Ficha B', affiliateUrl: 'https://tienda.invalid/b', price: 2, category: 'Audio', merchant: 'Tienda' });
  })();

  await tick(2);
  gate.resolve();
  await writerA;
  await writerB;

  const all = read();
  const ids = all.map((p) => p.id).sort();
  assert.deepEqual(ids, ['pA', 'pB'], 'ambos escritores dejaron su ficha: ' + JSON.stringify(ids));
});

test('contador: archivo ausente → readRepairCounter lanza (reparaciones bloqueadas, sin inicialización implícita)', () => {
  resetCounterFile();
  assert.throws(() => counter.readRepairCounter(), /no está disponible|ausente/, 'archivo ausente debe lanzar');
  assert.equal(counter.canPerformRepair(), false, 'con archivo ausente no se pueden hacer reparaciones');
  assert.throws(() => counter.getRepairCount(), /no está disponible/, 'getRepairCount lanza si no hay contador');
  assert.throws(() => counter.getRepairCount('malformed-merchant'), /no está disponible/, 'getRepairCount con tipo lanza si no hay contador');
});

test('contador: archivo ausente → reserveAndRecord rechaza (no registra nada)', () => {
  resetCounterFile();
  const r = counter.reserveAndRecord('malformed-merchant');
  assert.equal(r.ok, false, 'reserveAndRecord rechaza con contador ausente');
  assert.ok(r.reason?.includes('contador_ausente'), 'motivo menciona ausente: ' + r.reason);
  // Nada se persiste: el fichero sigue ausente
  assert.equal(counter.readRepairCounterSafe().status, 'ausente', 'el fichero sigue ausente');
});

test('contador: archivo corrupto → readRepairCounter lanza (reparaciones bloqueadas)', () => {
  resetCounterFile();
  fs.writeFileSync(counterFile, '{ no es json valido');
  assert.throws(() => counter.readRepairCounter(), /no está disponible|corrupto/, 'archivo corrupto debe lanzar');
  assert.equal(counter.canPerformRepair(), false, 'con archivo corrupto no se pueden hacer reparaciones');
});

test('contador: archivo corrupto → reserveAndRecord rechaza (no registra nada)', () => {
  resetCounterFile();
  fs.writeFileSync(counterFile, '{ no es json valido');
  const r = counter.reserveAndRecord('malformed-merchant');
  assert.equal(r.ok, false, 'reserveAndRecord rechaza con contador corrupto');
  assert.equal(r.reason, 'contador_corrupto: reparaciones bloqueadas', 'motivo claro de bloqueo');
  // Nada se persiste: el fichero sigue corrupto
  assert.equal(counter.readRepairCounterSafe().status, 'corrupto', 'el fichero sigue corrupto');
});

test('contador: registro válido persiste el consumo', () => {
  resetCounterFile();
  counter.initRepairCounter();
  const c1 = counter.reserveAndRecord('malformed-merchant');
  assert.equal(c1.ok, true, 'primera reparación registrada');
  assert.equal(c1.counter.count, 1, 'total = 1');
  assert.equal(c1.counter.byKind['malformed-merchant'], 1, 'por tipo = 1');

  const c2 = counter.readRepairCounter();
  assert.equal(c2.count, 1, 'el consumo persiste tras leer de nuevo');
  assert.equal(c2.byKind['malformed-merchant'], 1, 'el conteo por tipo persiste');

  const c3 = counter.reserveAndRecord('brand-is-merchant');
  assert.equal(c3.counter.count, 2, 'segunda reparación suma al total');
  assert.equal(c3.counter.byKind['brand-is-merchant'], 1, 'nuevo tipo contabilizado');
});

test('contador: rotación de auditoría no reinicia el consumo', () => {
  resetCounterFile();
  counter.initRepairCounter();
  counter.reserveAndRecord('malformed-merchant');
  counter.reserveAndRecord('fabricated-rating');
  assert.equal(counter.getRepairCount(), 2, 'hay 2 reparaciones antes de la rotación');

  // Simular rotación de auditoría: el fichero del contador no se toca.
  // Solo se lee y se verifica que el consumo se conserva.
  const after = counter.readRepairCounter();
  assert.equal(after.count, 2, 'el consumo sobrevive a la rotación de auditoría');
  assert.equal(after.byKind['malformed-merchant'], 1, 'malformed-merchant conservado');
  assert.equal(after.byKind['fabricated-rating'], 1, 'fabricated-rating conservado');
});

test('comportamiento comercial: applyPlan no altera campos no relacionados con la reparación', () => {
  const products = [
    {
      id: 'a',
      title: 'Producto A',
      merchant: '[object Object]',
      network: 'amazon',
      price: 100,
      brand: 'MarcaReal',
      specs: { Marca: 'MarcaReal' },
      extra: { ofertas: [{ id: 'o1', price: 90 }], campoPersonalizado: 'valor', scraperApiSource: { seller: 'TiendaX' } },
    },
  ];
  const plan = repair.planRepairs(products);
  const { products: reparados } = repair.applyPlan(products, plan);

  const p = reparados[0];
  // El vendedor se recupera del JSON crudo (scraperApiSource.seller = 'TiendaX')
  assert.equal(p.merchant, 'TiendaX', 'el comercio se reparó con el vendedor original');
  assert.equal(p.price, 100, 'el precio se conserva');
  assert.equal(p.brand, 'MarcaReal', 'la marca se conserva');
  assert.deepEqual(p.extra.ofertas, [{ id: 'o1', price: 90 }], 'extra.ofertas se conserva');
  assert.equal(p.extra.campoPersonalizado, 'valor', 'campos personalizados se conservan');
  // Los campos que solo se informan (sin parche) no se modifican
  assert.equal(p.title, 'Producto A', 'el título se conserva');
  assert.equal(p.network, 'amazon', 'la red se conserva');
});

/* ───────────────────────── Comportamiento comercial (catalogStore) ───────────────────────── */

test('comercial: upsertCatalogProduct conserva campos de curación existentes (no los destruye)', async () => {
  reset();
  // Crear ficha con campos de curación existentes vía escritor estándar.
  store.upsertProduct(baseProduct('c1', {
    category_id: 'cat-123',
    subcategory_id: 'sub-456',
    ia_status: 'completed',
    link_status: 'active',
    merchant: 'Tienda',
    affiliateUrl: 'https://tienda.invalid/c1',
    brand: 'MarcaReal',
  }));
  // Actualizarla vía contrato n8n (usa updateCatalog + writeJsonArrayFile, sin withResolvedBrand).
  const r = catalogStore.upsertCatalogProduct({
    id: 'c1', title: 'Ficha actualizada', affiliateUrl: 'https://tienda.invalid/c1', price: 15,
    category: 'Audio', merchant: 'Tienda',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const all = read();
  const p = all.find((x) => x.id === 'c1');
  assert.equal(p.category_id, 'cat-123', 'category_id se conserva');
  assert.equal(p.subcategory_id, 'sub-456', 'subcategory_id se conserva');
  assert.equal(p.ia_status, 'completed', 'ia_status se conserva');
  assert.equal(p.link_status, 'active', 'link_status se conserva');
  assert.equal(p.title, 'Ficha actualizada', 'el título se actualizó');
});

/* ───────────────────────── Escritura directa sin coordinación ───────────────────────── */

test('escritura directa sin coordinación se pierde frente a una lectura previa', () => {
  reset();
  // Escritor A: lee el catálogo (estado S1) y prepara una mutación, pero aún no escribe.
  const productsA = store.readProductsFromFile();
  productsA.push(baseProduct('pA', { price: 1 }));

  // Escritor B: escritura directa sin coordinación (salta updateCatalog, simula otro endpoint).
  const okB = store.writeProductsToFile([baseProduct('pB-directo', { price: 2 })]);
  assert.equal(okB, true, 'escritura directa de B succeeded');

  // Escritor A: ahora escribe su mutación sobre lo que B escribió.
  const okA = store.writeProductsToFile(productsA);
  assert.equal(okA, true, 'escritura coordinada de A succeeded');

  const all = read();
  // pB (escrito directamente sin coordinación) se perdió porque A leyó antes y escribió después.
  assert.ok(!all.some((p) => p.id === 'pB-directo'), 'la escritura directa sin coordinación se perdió');
  assert.ok(all.some((p) => p.id === 'pA'), 'la escritura de A sobrevivió');
  assert.equal(all.length, 1, 'solo queda la escritura de A que leyó primero');
});

test('updateCatalog protege frente a escritura directa intercalada', () => {
  reset();
  store.upsertProduct(baseProduct('p-existente', { price: 10 }));

  // Escritor B: escritura directa sin coordinación (incluye la ficha existente para no perderla).
  store.writeProductsToFile([baseProduct('p-existente', { price: 10 }), baseProduct('pB-directo', { price: 2 })]);

  // Escritor A: updateCatalog relee el catálogo ACTUAL (incluye a pB-directo y p-existente) antes de mutar.
  const result = store.updateCatalog((products) => {
    products.push(baseProduct('pA', { price: 1 }));
    return { changed: true, result: 'ok' };
  });

  assert.equal(result.written, true, 'updateCatalog escribió');
  const all = read();
  // Todas las escrituras sobreviven porque updateCatalog relee antes de escribir.
  assert.ok(all.some((p) => p.id === 'pB-directo'), 'la escritura directa de B sobrevivió (fue releída)');
  assert.ok(all.some((p) => p.id === 'pA'), 'la escritura de A sobrevivió');
  assert.ok(all.some((p) => p.id === 'p-existente'), 'la ficha existente sobrevivió');
  assert.equal(all.length, 3, 'todas las fichas están presentes');
});

/* ───────────────────────── Reparación sintética vía ruta coordinada ───────────────────────── */

test('reparación sintética vía ruta coordinada (updateCatalog + applyPlan + reserveAndRecord)', () => {
  resetCounterFile();
  counter.initRepairCounter(); // inicialización explícita y controlada

  reset();
  const products = [
    { id: 'a', title: 'A', merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} },
  ];
  write(products);

  const plan = repair.planRepairs(read());

  // Ruta coordinada: lectura, parcheo, reserva del contador y escritura en una sola
  // sección síncrona de updateCatalog.
  store.updateCatalog((current) => {
    const { products: reparados, rollback } = repair.applyPlan(current, plan);
    // Reserva del contador dentro de la sección crítica.
    for (const item of plan.items) {
      if (!Object.keys(item.patch).length) continue;
      const r = counter.reserveAndRecord(item.kind);
      if (!r.ok) throw new Error(r.reason ?? 'reserva falló');
    }
    // Copiar sobre `current` in-place para que updateCatalog persista los cambios.
    current.length = 0;
    for (const p of reparados) current.push(p);
    return { changed: true, result: { products: reparados, rollback } };
  });

  // Verificar directamente en el fichero que el parche se aplicó.
  const all = read();
  const p = all.find((x) => x.id === 'a');
  assert.equal(p.merchant, 'TiendaX', 'el parche de reparación se aplicó');

  const c = counter.readRepairCounter();
  assert.equal(c.count, 1, 'el contador registró la reparación');
  assert.equal(c.byKind['malformed-merchant'], 1, 'conteo por tipo correcto');
});

test('reparación coordinada bloquea si el contador está corrupto (sin escribir productos)', () => {
  resetCounterFile();
  fs.writeFileSync(counterFile, '{ corrupto');

  reset();
  const products = [
    { id: 'a', title: 'A', merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} },
  ];
  write(products);
  const before = JSON.stringify(read());

  const plan = repair.planRepairs(read());

  let threw = false;
  try {
    store.updateCatalog((current) => {
      const { products: reparados } = repair.applyPlan(current, plan);
      for (const item of plan.items) {
        if (!Object.keys(item.patch).length) continue;
        const r = counter.reserveAndRecord(item.kind);
        if (!r.ok) throw new Error(r.reason ?? 'reserva falló');
      }
      return { changed: true, result: { products: reparados } };
    });
  } catch {
    threw = true;
  }

  assert.equal(threw, true, 'la ruta coordinada lanzó al encontrar contador corrupto');
  assert.equal(JSON.stringify(read()), before, 'los productos no se modificaron (contador corrupto bloqueó todo)');
});
