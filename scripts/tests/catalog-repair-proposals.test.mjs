// Prueba de recorrido completo de la ruta de reparación usando
// automationProposals.ts (almacén existente) + automationApply.ts (aplicación simulada)
// + repairCounter.ts (contador persistente con reserva antes de escribir).
// Todos los tests comparten un único directorio aislado (setupIsolatedData al
// principio) y se limpian los ficheros de datos entre tests.
// Red e IA simuladas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { setupIsolatedData, adminCookie } from './_helpers.mjs';

const TEST_TOKEN = 'test-token-123';

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

async function buildEnv(dir) {
  const suffix = '?' + dir.replace(/[^a-zA-Z0-9]/g, '');
  const repairRoute = await import('../../src/pages/api/admin/catalog/repair.ts' + suffix);
  const counter = await import('../../src/lib/repairCounter.ts' + suffix);
  const store = await import('../../src/lib/productStore.ts' + suffix);

  function makeRequest(body, token, cookie) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cookie) headers.Cookie = cookie;
    return new Request('http://localhost/api/admin/catalog/repair', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  // Decidir, previsualizar, aplicar y reconciliar una corrección del catálogo exigen al administrador
  // principal con SESIÓN (persona); el token de API solo lista y propone. Se usa la cookie del
  // propietario salvo que la prueba fuerce el token para comprobar que se rechaza.
  const ACCIONES_HUMANAS = new Set(['decide', 'preview', 'apply', 'reconciliar']);
  async function post(body, token = TEST_TOKEN, { comoApi = false } = {}) {
    const humano = ACCIONES_HUMANAS.has(body?.action) && !comoApi;
    const res = await repairRoute.POST({ request: makeRequest(body, humano ? undefined : token, humano ? await adminCookie() : undefined) });
    const bodyJson = await res.json();
    return { res, body: bodyJson };
  }

  async function enablePolicy() {
    process.env.CATALOG_REPAIR_ENABLED = 'true';
  }

  async function disablePolicy() {
    delete process.env.CATALOG_REPAIR_ENABLED;
  }

  function resetDataFiles() {
    const counterFile = path.join(dir, 'repair-counter.json');
    const proposalsFile = path.join(dir, 'automation-proposals.json');
    const productsFile = path.join(dir, 'products.json');
    for (const f of [counterFile, proposalsFile, productsFile]) {
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
    fs.writeFileSync(productsFile, '[]');
  }

  return { repairRoute, counter, store, post, enablePolicy, disablePolicy, resetDataFiles, TEST_TOKEN, baseProduct };
}

// Un único directorio aislado para todos los tests de esta suite.
const dir = setupIsolatedData('treidilor-rp-');
const env = await buildEnv(dir);
env.resetDataFiles();

test('reparación: sin política habilitada → 403', async () => {
  env.disablePolicy();
  env.resetDataFiles();

  const { res, body } = await env.post({ action: 'list' });
  assert.equal(res.status, 403, 'sin política habilitada devuelve 403');
  assert.equal(body.success, false);
  assert.ok(/desactivadas/.test(body.message ?? ''));
});

test('reparación: contador ausente → create bloqueado (409)', async () => {
  env.enablePolicy();
  env.resetDataFiles();

  const { res, body } = await env.post({ action: 'create', productId: 'p1', kind: 'malformed-merchant' });
  assert.equal(res.status, 409, 'contador ausente bloquea la creación: ' + JSON.stringify(body));
  assert.equal(body.success, false);
  assert.ok(/no disponible|bloqueadas/.test(body.message ?? ''), 'mensaje: ' + body.message);

  // Verificar que no se creó propuesta
  const proposalsFile = path.join(dir, 'automation-proposals.json');
  assert.ok(!fs.existsSync(proposalsFile), 'no se creó fichero de propuestas');

  env.disablePolicy();
});

test('reparación: crear propuesta → 201', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter(); // inicialización explícita y controlada

  env.store.upsertProduct(env.baseProduct('p1', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));

  const { res, body } = await env.post({ action: 'create', productId: 'p1', kind: 'malformed-merchant' });
  assert.equal(res.status, 201, 'propuesta creada: ' + JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.proposal.type, 'correccion_catalogo');
  assert.equal(body.proposal.state, 'pendiente');
  assert.ok(body.proposal.id, 'la propuesta tiene id');
  env.disablePolicy();
});

test('reparación: decidir (aprobada) → 200', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  env.store.upsertProduct(env.baseProduct('p1', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));

  const { res: createRes, body: createBody } = await env.post({ action: 'create', productId: 'p1', kind: 'malformed-merchant' });
  const proposalId = createBody.proposal.id;

  const { res: decideRes, body: decideBody } = await env.post({ action: 'decide', id: proposalId, decision: 'aprobada', note: 'Reparación autorizada.' });
  assert.equal(decideRes.status, 200, 'decisión registrada: ' + JSON.stringify(decideBody));
  assert.equal(decideBody.success, true);
  assert.equal(decideBody.decided, true);
  env.disablePolicy();
});

test('reparación: el token de API NO puede aprobar en lugar de una persona → 403', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();
  env.store.upsertProduct(env.baseProduct('p1', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));
  const { body: createBody } = await env.post({ action: 'create', productId: 'p1', kind: 'malformed-merchant' });
  const proposalId = createBody.proposal.id;
  assert.ok(!JSON.stringify(createBody).includes('tradylor_admin_session'), 'la propuesta no guarda la cookie de sesión');

  const { res, body } = await env.post({ action: 'decide', id: proposalId, decision: 'aprobada' }, TEST_TOKEN, { comoApi: true });
  assert.equal(res.status, 403);
  assert.equal(body.code, 'decision_humana_requerida');
  const lista = await env.post({ action: 'list' });
  assert.equal(lista.body.proposals.find((p) => p.id === proposalId).state, 'pendiente', 'sigue pendiente de decisión humana');

  // Aunque una persona apruebe, el token tampoco puede previsualizar ni aplicar una corrección del catálogo.
  await env.post({ action: 'decide', id: proposalId, decision: 'aprobada' });
  const prevApi = await env.post({ action: 'preview', id: proposalId }, TEST_TOKEN, { comoApi: true });
  assert.equal(prevApi.res.status, 403);
  const applyApi = await env.post({ action: 'apply', id: proposalId, previewToken: 'x', confirm: true }, TEST_TOKEN, { comoApi: true });
  assert.ok([403, 409].includes(applyApi.res.status), 'el token no aplica: ' + JSON.stringify(applyApi.body));
  assert.equal(env.store.readProductsFromFile().find((p) => p.id === 'p1').merchant, '[object Object]', 'el catálogo no cambió');
  env.disablePolicy();
});

test('reparación: preview de aplicación simulada → 200', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  env.store.upsertProduct(env.baseProduct('p1', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));

  const { res: createRes, body: createBody } = await env.post({ action: 'create', productId: 'p1', kind: 'malformed-merchant' });
  const proposalId = createBody.proposal.id;

  await env.post({ action: 'decide', id: proposalId, decision: 'aprobada' });

  const { res: previewRes, body: previewBody } = await env.post({ action: 'preview', id: proposalId });
  assert.equal(previewRes.status, 200, 'preview: ' + JSON.stringify(previewBody));
  assert.equal(previewBody.success, true);
  assert.equal(previewBody.simulation, true);
  assert.equal(previewBody.writes, false);
  assert.ok(previewBody.previewToken, 'tiene previewToken');
  assert.ok(Array.isArray(previewBody.changes), 'tiene cambios');
  assert.equal(previewBody.changes[0]?.campo, 'merchant', 'el cambio es sobre merchant');
  env.disablePolicy();
});

test('reparación: apply → catálogo corregido + aplicación real registrada', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  env.store.upsertProduct(env.baseProduct('p1', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));

  const { res: createRes, body: createBody } = await env.post({ action: 'create', productId: 'p1', kind: 'malformed-merchant' });
  const proposalId = createBody.proposal.id;

  await env.post({ action: 'decide', id: proposalId, decision: 'aprobada' });

  const { res: previewRes, body: previewBody } = await env.post({ action: 'preview', id: proposalId });
  const previewToken = previewBody.previewToken;

  const { res: applyRes, body: applyBody } = await env.post({ action: 'apply', id: proposalId, previewToken, confirm: true });
  assert.equal(applyRes.status, 200, 'apply: ' + JSON.stringify(applyBody));
  assert.equal(applyBody.success, true);
  assert.equal(applyBody.status, 'aplicada');
  assert.equal(applyBody.simulated, false);
  assert.equal(applyBody.wroteData, true);

  // Verificar catálogo corregido
  const productsFile = path.join(dir, 'products.json');
  const all = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p = all.find((x) => x.id === 'p1');
  assert.equal(p.merchant, 'TiendaX', 'el comercio se reparó con el vendedor original');

  // Verificar que la propuesta aparece en la lista como aplicada
  const { res: listRes, body: listBody } = await env.post({ action: 'list' });
  assert.equal(listBody.success, true);
  const aplicadas = listBody.proposals.filter((pr) => pr.id === proposalId);
  assert.equal(aplicadas.length, 1, 'la propuesta aparece en la lista');

  // Verificar contador persistente
  const c = env.counter.readRepairCounter();
  assert.equal(c.count, 1, 'el contador registró la reparación');
  env.disablePolicy();
});

test('reparación: idempotencia al re-aplicar', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  env.store.upsertProduct(env.baseProduct('p1', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));

  const { res: createRes, body: createBody } = await env.post({ action: 'create', productId: 'p1', kind: 'malformed-merchant' });
  const proposalId = createBody.proposal.id;
  await env.post({ action: 'decide', id: proposalId, decision: 'aprobada' });
  const { res: previewRes, body: previewBody } = await env.post({ action: 'preview', id: proposalId });
  const previewToken = previewBody.previewToken;

  // Primera apply
  const { res: apply1 } = await env.post({ action: 'apply', id: proposalId, previewToken, confirm: true });
  assert.equal(apply1.status, 200, 'primera apply');

  // Segunda apply (idempotente: ya fue aplicada, no se toca el catálogo)
  const { res: apply2, body: apply2Body } = await env.post({ action: 'apply', id: proposalId, previewToken, confirm: true });
  assert.equal(apply2.status, 200, 'segunda apply es idempotente: ' + JSON.stringify(apply2Body));
  assert.equal(apply2Body.success, true);
  assert.equal(apply2Body.idempotent, true, 'se reconoce como idempotente');

  // El comerciante se reparó una sola vez
  const productsFile = path.join(dir, 'products.json');
  const all = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p = all.find((x) => x.id === 'p1');
  assert.equal(p.merchant, 'TiendaX', 'el comerciante se reparó una sola vez');

  // El contador no se incrementó por la re-aplicación
  const c = env.counter.readRepairCounter();
  assert.equal(c.count, 1, 'el contador no se incrementó por re-aplicación');
  env.disablePolicy();
});

test('reparación: parche no autorizado → 403', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  // Escribir directamente el producto (sin upsertProduct, para evitar withResolvedBrand
  // que eliminaría brand='Amazon' al considerarla tienda, no marca).
  const productsFile = path.join(dir, 'products.json');
  fs.writeFileSync(productsFile, JSON.stringify([{
    id: 'p2', title: 'Producto p2', description: '', price: 10,
    image: 'https://img.invalid/x.jpg', category: 'Audio',
    affiliateUrl: 'https://tienda.invalid/p2', pros: [], cons: [],
    brand: 'Amazon', merchant: 'Amazon', network: 'amazon', specs: {}, extra: {}
  }]));

  const { res, body } = await env.post({ action: 'create', productId: 'p2', kind: 'brand-is-merchant' });
  assert.equal(res.status, 403, 'campo no autorizado devuelve 403: ' + JSON.stringify(body));
  assert.equal(body.success, false);
  assert.ok(/no es reparable automáticamente/.test(body.message ?? ''), 'mensaje: ' + body.message);

  // Verificar que el producto no se modificó
  const all = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p = all.find((x) => x.id === 'p2');
  assert.equal(p.brand, 'Amazon', 'el producto no se modificó');
  env.disablePolicy();
});

test('reparación: almacén de propuestas corrupto → 423', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  // Escribir almacén de propuestas corrupto directamente
  const proposalsFile = path.join(dir, 'automation-proposals.json');
  fs.writeFileSync(proposalsFile, '{ corrupto');

  env.store.upsertProduct(env.baseProduct('p3', { merchant: '[object Object]', network: 'amazon', extra: { scraperApiSource: { seller: 'TiendaX' } } }));

  const { res, body } = await env.post({ action: 'create', productId: 'p3', kind: 'malformed-merchant' });
  assert.equal(res.status, 423, 'almacén corrupto bloquea la creación: ' + JSON.stringify(body));
  assert.equal(body.success, false);

  // Verificar que el producto no se modificó
  const productsFile = path.join(dir, 'products.json');
  const all = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p = all.find((x) => x.id === 'p3');
  assert.equal(p.merchant, '[object Object]', 'el producto no se modificó');
  env.disablePolicy();
});

test('reparación: contador corrupto → create bloqueado (409)', async () => {
  env.enablePolicy();
  env.resetDataFiles();

  // Escribir contador corrupto directamente
  const counterFile = path.join(dir, 'repair-counter.json');
  fs.writeFileSync(counterFile, '{ corrupto');

  // Verificar que el módulo lo lee como corrupto (aislamiento de directorios)
  const cs = env.counter.readRepairCounterSafe();
  assert.equal(cs.status, 'corrupto', 'el módulo debe leer el contador como corrupto: ' + JSON.stringify(cs));
  assert.equal(env.counter.canPerformRepair(), false, 'canPerformRepair debe devolver false con contador corrupto');

  env.store.upsertProduct(env.baseProduct('p4', { merchant: '[object Object]', network: 'amazon', extra: { scraperApiSource: { seller: 'TiendaX' } } }));

  const { res: createRes, body: createBody } = await env.post({ action: 'create', productId: 'p4', kind: 'malformed-merchant' });
  assert.equal(createRes.status, 409, 'contador corrupto bloquea la creación: ' + JSON.stringify(createBody));

  env.disablePolicy();
});

test('reparación: fallo de registro después de escribir catálogo → no segunda aplicación', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  // 1. Crear producto con defecto
  env.store.upsertProduct(env.baseProduct('p5', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));

  // 2. Crear propuesta
  const { res: createRes, body: createBody } = await env.post({ action: 'create', productId: 'p5', kind: 'malformed-merchant' });
  assert.equal(createRes.status, 201, 'propuesta creada: ' + JSON.stringify(createBody));
  const proposalId = createBody.proposal.id;

  // 3. Aprobar
  await env.post({ action: 'decide', id: proposalId, decision: 'aprobada' });

  // 4. Preview para obtener previewToken
  const { res: previewRes, body: previewBody } = await env.post({ action: 'preview', id: proposalId });
  assert.equal(previewRes.status, 200, 'preview: ' + JSON.stringify(previewBody));
  const previewToken = previewBody.previewToken;

  // 5. Primera apply - escribe el catálogo y registra la aplicación
  const { res: apply1, body: apply1Body } = await env.post({ action: 'apply', id: proposalId, previewToken, confirm: true });
  assert.equal(apply1.status, 200, 'primera apply: ' + JSON.stringify(apply1Body));
  assert.equal(apply1Body.success, true);
  assert.equal(apply1Body.status, 'aplicada');

  // 6. Verificar que el catálogo se modificó
  const productsFile = path.join(dir, 'products.json');
  const allAfterApply1 = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p1 = allAfterApply1.find((x) => x.id === 'p5');
  assert.equal(p1.merchant, 'TiendaX', 'el comercio se reparó en la primera apply');

  // 7. Contador incrementó una vez
  const c1 = env.counter.readRepairCounter();
  assert.equal(c1.count, 1, 'el contador tiene 1 después de la primera apply');

  // 8. Resetear el application de la propuesta (simular que el registro se perdió)
  //    pero mantener el catálogo ya modificado
  const proposalsFile = path.join(dir, 'automation-proposals.json');
  const proposalsData = JSON.parse(fs.readFileSync(proposalsFile, 'utf8'));
  const propIdx = proposalsData.proposals.findIndex((p) => p.id === proposalId);
  assert.ok(propIdx >= 0, 'la propuesta existe en el almacén');
  proposalsData.proposals[propIdx].application = null;
  fs.writeFileSync(proposalsFile, JSON.stringify(proposalsData, null, 2));

  // 9. Corromper el archivo de propuestas
  fs.writeFileSync(proposalsFile, '{ corrupto');

  // 10. Intentar apply de nuevo con el mismo previewToken
  //     readProposalRaw fallará porque el archivo está corrupto → 423
  const { res: apply2, body: apply2Body } = await env.post({ action: 'apply', id: proposalId, previewToken, confirm: true });
  assert.equal(apply2.status, 423, 'segunda apply falla con almacén corrupto: ' + JSON.stringify(apply2Body));
  assert.equal(apply2Body.success, false);

  // 11. Verificar que el catálogo NO se modificó nuevamente (sigue siendo TiendaX del paso 1)
  const allAfterApply2 = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p2 = allAfterApply2.find((x) => x.id === 'p5');
  assert.equal(p2.merchant, 'TiendaX', 'el comerciante sigue siendo TiendaX (no se escribió de nuevo)');

  // 12. Verificar que el contador NO se incrementó por la segunda apply fallida
  const c2 = env.counter.readRepairCounter();
  assert.equal(c2.count, 1, 'el contador sigue en 1 (no se consumió presupuesto adicional)');

  env.disablePolicy();
});

test('reparación: fallo de registro tras escribir catálogo → reconciliar completa como real', async () => {
  env.enablePolicy();
  env.resetDataFiles();
  env.counter.initRepairCounter();

  // 1. Crear producto con defecto
  env.store.upsertProduct(env.baseProduct('p6', { merchant: '[object Object]', network: 'amazon', price: 100, extra: { scraperApiSource: { seller: 'TiendaX' } }, specs: {} }));

  // 2. Crear propuesta
  const { res: createRes, body: createBody } = await env.post({ action: 'create', productId: 'p6', kind: 'malformed-merchant' });
  assert.equal(createRes.status, 201, 'propuesta creada: ' + JSON.stringify(createBody));
  const proposalId = createBody.proposal.id;

  // 3. Aprobar
  await env.post({ action: 'decide', id: proposalId, decision: 'aprobada' });

  // 4. Preview para obtener previewToken
  const { res: previewRes, body: previewBody } = await env.post({ action: 'preview', id: proposalId });
  assert.equal(previewRes.status, 200, 'preview: ' + JSON.stringify(previewBody));
  const previewToken = previewBody.previewToken;

  // 5. Primera apply - escribe el catálogo y registra la aplicación como real
  const { res: apply1, body: apply1Body } = await env.post({ action: 'apply', id: proposalId, previewToken, confirm: true });
  assert.equal(apply1.status, 200, 'primera apply: ' + JSON.stringify(apply1Body));
  assert.equal(apply1Body.success, true);
  assert.equal(apply1Body.status, 'aplicada');

  // 6. Verificar que el catálogo se modificó
  const productsFile = path.join(dir, 'products.json');
  const allAfterApply1 = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p1 = allAfterApply1.find((x) => x.id === 'p6');
  assert.equal(p1.merchant, 'TiendaX', 'el comercio se reparó en la primera apply');

  // 7. Contador incrementó una vez
  const c1 = env.counter.readRepairCounter();
  assert.equal(c1.count, 1, 'el contador tiene 1 después de la primera apply');

  // 8. Simular que el registro de aplicación se perdió (application = null)
  //    pero el catálogo ya tiene el valor modificado
  const proposalsFile = path.join(dir, 'automation-proposals.json');
  const proposalsData = JSON.parse(fs.readFileSync(proposalsFile, 'utf8'));
  const propIdx = proposalsData.proposals.findIndex((p) => p.id === proposalId);
  assert.ok(propIdx >= 0, 'la propuesta existe en el almacén');
  proposalsData.proposals[propIdx].application = null;
  fs.writeFileSync(proposalsFile, JSON.stringify(proposalsData, null, 2));

  // 9. Reconciliar: el sistema debe detectar que el catálogo ya tiene el valor deseado
  //    y completar el registro como real sin volver a escribir el catálogo.
  //    Pasar el previewToken guardado (la aplicación se perdió, no hay token en el almacén).
  const { res: reconRes, body: reconBody } = await env.post({ action: 'reconciliar', id: proposalId, previewToken });
  assert.equal(reconRes.status, 200, 'reconciliar: ' + JSON.stringify(reconBody));
  assert.equal(reconBody.success, true);
  assert.equal(reconBody.status, 'aplicada');
  assert.equal(reconBody.simulated, false);
  assert.equal(reconBody.wroteData, false, 'no se volvió a escribir el catálogo');

  // 10. Verificar que el catálogo sigue teniendo el valor corregido (no se escribió de nuevo)
  const allAfterReconcile = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  const p2 = allAfterReconcile.find((x) => x.id === 'p6');
  assert.equal(p2.merchant, 'TiendaX', 'el comerciante sigue siendo TiendaX');

  // 11. Verificar que el contador NO se incrementó (no se consumió presupuesto adicional)
  const c2 = env.counter.readRepairCounter();
  assert.equal(c2.count, 1, 'el contador sigue en 1 (no se consumió presupuesto adicional)');

  // 12. Verificar que la propuesta ahora tiene application como real
  const proposalsData2 = JSON.parse(fs.readFileSync(proposalsFile, 'utf8'));
  const propAfter = proposalsData2.proposals.find((p) => p.id === proposalId);
  assert.ok(propAfter.application, 'la propuesta tiene registro de aplicación');
  assert.equal(propAfter.application.mode, 'real', 'la aplicación está registrada como real');

  env.disablePolicy();
});
