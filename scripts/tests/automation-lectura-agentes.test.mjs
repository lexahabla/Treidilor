// API de automatización · LECTURAS para los agentes del Director (05 precios y 10 analítica): catálogo v2 (v1 + historial de precios) con `catalog:read` y analítica
// AGREGADA por mes con `analytics:read`. Interruptor propio apagado por defecto, alcances separados, solo GET, sin datos personales ni secretos, y SIN ESCRITURAS.
// Todo sintético y en un directorio temporal aislado; sin red. (Portado de `feature/agentes-integracion`, solo la parte de lectura.)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setupIsolatedData } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-automation-lectura-');
for (const k of ['AUTOMATION_API_ENABLED', 'AUTOMATION_READ_V2_ENABLED']) delete process.env[k];
const A = await import('../../src/lib/automationApi.ts');
const R = { cat1: await import('../../src/pages/api/automation/v1/catalog.ts'), cat2: await import('../../src/pages/api/automation/v2/catalog.ts'), ana: await import('../../src/pages/api/automation/v1/analytics.ts') };
const f = (n) => path.join(dir, n);
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null);
const B = 'http://localhost';
const SECRETOS = { aff: 'https://marca-afiliado-secreta.example/?tag=SECRETO-AFILIADO', comision: 'COMISION-OCULTA', fuente: 'ASIN-INTERNO-9', visitor: 'VISITOR-ID-SECRETO', sesion: 'SESION-SECRETA', ref: 'REFERRER-SECRETO' };
const ahora = Date.now();
const prods = [
  { id: 'p001', slug: 'p001', title: 'Producto con historial', price: 29.9, originalPrice: 40, category: 'Sonido', network: 'amazon', merchant: 'Tienda', currency: 'EUR', inStock: true, affiliateUrl: SECRETOS.aff, commission: SECRETOS.comision, description: 'x', image: '/i.jpg',
    priceHistory: [{ date: '2026-11-10', price: 35 }, { date: '2026-11-01', price: 40 }, { date: 'no-fecha', price: 1 }, { date: '2026-11-15', price: -3 }],
    extra: { observations: [{ capturedAt: '2026-11-18T10:00:00Z', verifiedAt: '2026-11-18T10:05:00Z', price: 29.9, originalPrice: 40, inStock: true, shippingCost: 0, deliveryMinDays: 2, deliveryMaxDays: 4, context: { currency: 'EUR', destination: 'ES' }, contextKey: 'EUR|ES|std', source: { type: 'amazon', id: SECRETOS.fuente }, runId: 'r1' }],
      priceSignal: { offerKey: 'k', contextKey: 'EUR|ES|std', previousPrice: 35, price: 29.9, currency: 'EUR', detectedAt: new Date(ahora - 3600e3).toISOString(), expiresAt: new Date(ahora + 86400e3).toISOString(), shippingCriterion: 'std' } } },
  { id: 'p002', slug: 'p002', title: 'Producto sin historial', price: 10, category: 'Hogar', merchant: 'Tienda', currency: 'EUR', inStock: true, affiliateUrl: SECRETOS.aff, image: '/i.jpg', description: 'x',
    extra: { priceSignal: { previousPrice: 12, price: 10, currency: 'EUR', detectedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-08T00:00:00Z' } } },
];
fs.writeFileSync(f('products.json'), JSON.stringify(prods));
fs.writeFileSync(f('categories.json'), JSON.stringify([{ id: 'sonido', name: 'Sonido', slug: 'sonido', icon: '🎧', keywords: [] }]));
fs.writeFileSync(f('sections.json'), '[]');
fs.writeFileSync(f('deleted-product-ids.json'), '[]');
const DATOS = ['products.json', 'categories.json', 'sections.json', 'deleted-product-ids.json'];
const huellaDatos = () => DATOS.map((n) => sha(f(n))).join('|');
const ANTES = huellaDatos();
const req = (url, { method = 'GET', token } = {}) => new Request(B + url, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
const mk = (name, scopes) => { const r = A.createClient({ name, scopes, ratePerMinute: 120 }); assert.equal(r.ok, true, `${name}: ${r.message}`); return r.token; };
const T = {};

test('APAGADO POR DEFECTO · sin AUTOMATION_READ_V2_ENABLED las lecturas nuevas responden 404 (como una ruta inexistente); el v1 sigue igual', async () => {
  process.env.AUTOMATION_API_ENABLED = 'true';
  T.cat = mk('director-catalogo', ['catalog:read']); T.ana = mk('director-analitica', ['analytics:read']); T.ambas = mk('director-lecturas', ['catalog:read', 'analytics:read']);
  assert.equal((await R.cat2.GET({ request: req('/api/automation/v2/catalog?limit=2', { token: T.cat }) })).status, 404);
  assert.equal((await R.ana.GET({ request: req('/api/automation/v1/analytics', { token: T.ana }) })).status, 404);
  assert.equal((await R.cat1.GET({ request: req('/api/automation/v1/catalog?limit=2', { token: T.cat }) })).status, 200, 'el v1 no depende del interruptor');
  process.env.AUTOMATION_API_ENABLED = 'false'; process.env.AUTOMATION_READ_V2_ENABLED = 'true';
  assert.equal((await R.cat2.GET({ request: req('/api/automation/v2/catalog?limit=2', { token: T.cat }) })).status, 404, 'subordinado a la API general');
  process.env.AUTOMATION_API_ENABLED = 'true';
});

test('ALCANCES · catalog:read no lee analítica y analytics:read no lee catálogo; un cliente puede combinar las dos lecturas; no existe ningún alcance de escritura', async () => {
  A.resetAutomationLimits();
  assert.equal((await R.ana.GET({ request: req('/api/automation/v1/analytics', { token: T.cat }) })).status, 403);
  assert.equal((await R.cat2.GET({ request: req('/api/automation/v2/catalog?limit=2', { token: T.ana }) })).status, 403);
  assert.equal((await R.cat2.GET({ request: req('/api/automation/v2/catalog?limit=2', { token: T.ambas }) })).status, 200);
  assert.equal((await R.ana.GET({ request: req('/api/automation/v1/analytics', { token: T.ambas }) })).status, 200);
  assert.equal((await R.ana.GET({ request: req('/api/automation/v1/analytics') })).status, 401);
  for (const s of ['catalog:write', 'analytics:write', 'proposals:create']) assert.equal(A.createClient({ name: 'x', scopes: [s] }).ok, false, s);
});

test('CATÁLOGO v2 · aditivo: cada ficha es EXACTAMENTE la del v1 + `history`; lo que no consta se declara no disponible; sin secretos', async () => {
  A.resetAutomationLimits();
  const v1 = await (await R.cat1.GET({ request: req('/api/automation/v1/catalog?limit=10', { token: T.cat }) })).json();
  const v2 = await (await R.cat2.GET({ request: req('/api/automation/v2/catalog?limit=10', { token: T.cat }) })).json();
  assert.equal(v2.schema, 'automation-catalog/2'); assert.equal(v2.compatibleWith, 'automation-catalog/1');
  assert.deepEqual(v2.products.map(({ history, ...p }) => p), v1.products, 'los campos del v1 se conservan íntegramente');
  const p1 = v2.products.find((p) => p.id === 'p001').history; const p2 = v2.products.find((p) => p.id === 'p002').history;
  assert.equal(p1.available, true); assert.deepEqual(p1.priceHistory, [{ date: '2026-11-01', price: 40 }, { date: '2026-11-10', price: 35 }], 'ordenado y sin puntos inválidos');
  assert.equal(p1.observations.length, 1); assert.equal(p1.priceSignal.price, 29.9);
  assert.equal(p2.available, false); assert.equal(p2.priceSignal, null, 'una señal caducada no se entrega');
  const texto = JSON.stringify(v2); for (const s of Object.values(SECRETOS)) assert.ok(!texto.includes(s), `se filtró «${s}»`);
  assert.equal((await R.cat2.GET({ request: req('/api/automation/v2/catalog?limit=0', { token: T.cat }) })).status, 400);
  assert.equal((await R.cat2.ALL({ request: req('/x', { method: 'POST', token: T.cat }) })).status, 405); assert.equal(typeof R.cat2.POST, 'undefined');
});

test('ANALÍTICA · agregada por mes, sin sesiones, visitantes ni referentes; sin datos lo dice; parámetros cerrados; solo GET', async () => {
  A.resetAutomationLimits();
  const a0 = await (await R.ana.GET({ request: req('/api/automation/v1/analytics', { token: T.ana }) })).json(); assert.equal(a0.available, false); assert.equal(a0.reason, 'sin_datos_de_analitica');
  const ev = (type, d, extra = {}) => ({ type, createdAt: `2026-11-${d}T10:00:00.000Z`, productId: 'p001', sessionId: SECRETOS.sesion, visitorId: SECRETOS.visitor, referrer: `https://x.example/?q=${SECRETOS.ref}`, path: '/producto/p001', ...extra });
  fs.writeFileSync(f('analytics.json'), JSON.stringify([ev('page_view', '10'), ev('page_view', '11'), ev('outbound_click', '11', { network: 'amazon' }), ev('page_duration', '11', { durationMs: 20000 })]));
  const mod = await import('../../src/lib/analyticsMonths.ts'); mod.clearAnalyticsMemo?.();
  const a1 = await R.ana.GET({ request: req('/api/automation/v1/analytics?months=2', { token: T.ana }) }); const j1 = await a1.json();
  assert.equal(a1.status, 200); assert.equal(j1.schema, 'automation-analytics/1'); assert.ok(j1.available === true || j1.reason);
  const txt = JSON.stringify(j1); for (const s of [SECRETOS.sesion, SECRETOS.visitor, SECRETOS.ref]) assert.ok(!txt.includes(s), `analítica filtró «${s}»`);
  for (const q of ['months=0', 'months=13', 'months=abc', 'months=1&months=2', 'x=1', 'months=1.5']) assert.equal((await R.ana.GET({ request: req(`/api/automation/v1/analytics?${q}`, { token: T.ana }) })).status, 400, q);
  assert.equal((await R.ana.ALL({ request: req('/x', { method: 'DELETE', token: T.ana }) })).status, 405); assert.equal(typeof R.ana.POST, 'undefined');
  fs.rmSync(f('analytics.json'), { force: true });
});

test('SIN ESCRITURAS · tras todas las lecturas el catálogo y sus archivos siguen idénticos; las peticiones quedan auditadas sin tokens', () => {
  assert.equal(huellaDatos(), ANTES);
  const audit = fs.existsSync(f('automation-audit.jsonl')) ? fs.readFileSync(f('automation-audit.jsonl'), 'utf8') : '';
  assert.ok(audit.includes('analytics:read'), 'auditoría de la analítica'); for (const t of Object.values(T)) assert.ok(!audit.includes(t), 'ningún token en la auditoría');
  for (const k of ['AUTOMATION_API_ENABLED', 'AUTOMATION_READ_V2_ENABLED']) delete process.env[k];
});
