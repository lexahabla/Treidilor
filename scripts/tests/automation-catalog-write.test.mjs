// OPERACIONES DE CATÁLOGO DEL DIRECTOR IA (API de automatización): crear categorías y asignar categorías a fichas, SOLO con el alcance exclusivo
// `catalog:write` y el interruptor `AUTOMATION_WRITE_ENABLED`; idempotentes por clave, optimistas (no pisan cambios ajenos) y con registro de antes/después.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupIsolatedData } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-automation-write-');
process.env.AUTOMATION_API_ENABLED = 'true'; delete process.env.AUTOMATION_WRITE_ENABLED;
const f = (n) => path.join(dir, n);
fs.writeFileSync(f('products.json'), JSON.stringify([
  { id: 'p1', slug: 'p1', title: 'Auriculares inalámbricos con cancelación de ruido', price: 30, category: '', network: 'amazon', merchant: 'T', currency: 'EUR', inStock: true, image: '/x.jpg', affiliateUrl: 'https://x.example', tags: ['auriculares', 'bluetooth'] },
  { id: 'p2', slug: 'p2', title: 'Cosa rara sin pistas', price: 9, category: '', network: 'amazon', merchant: 'T', currency: 'EUR', inStock: true, image: '/x.jpg', affiliateUrl: 'https://x.example' },
  { id: 'p3', slug: 'p3', title: 'Portátil 14 pulgadas', price: 500, category: 'Informática', category_id: 'informatica', network: 'amazon', merchant: 'T', currency: 'EUR', inStock: true, image: '/x.jpg', affiliateUrl: 'https://x.example' },
  { id: 'p4', slug: 'p4', title: 'Maleta de cabina con candado', price: 60, category: '', network: 'amazon', merchant: 'T', currency: 'EUR', inStock: true, image: '/x.jpg', affiliateUrl: 'https://x.example' },
  // fichas YA clasificadas: la convención real de la tienda con la que se comparan las que no tienen categoría
  { id: 'k1', slug: 'k1', title: 'Auriculares inalámbricos deportivos', price: 25, category: 'Sonido', category_id: 'sonido', network: 'amazon', merchant: 'T', currency: 'EUR', inStock: true, image: '/x.jpg', affiliateUrl: 'https://x.example' },
  { id: 'k2', slug: 'k2', title: 'Auriculares inalámbricos con micrófono', price: 35, category: 'Sonido', category_id: 'sonido', network: 'amazon', merchant: 'T', currency: 'EUR', inStock: true, image: '/x.jpg', affiliateUrl: 'https://x.example' },
]));
fs.writeFileSync(f('categories.json'), JSON.stringify([
  { id: 'sonido', name: 'Sonido', slug: 'sonido', icon: '🎧', keywords: ['auriculares', 'bluetooth', 'altavoz'], parentId: null },
  { id: 'informatica', name: 'Informática', slug: 'informatica', icon: '💻', keywords: ['portatil', 'teclado'], parentId: null },
]));
for (const n of ['sections.json', 'deleted-product-ids.json']) fs.writeFileSync(f(n), '[]');

const A = await import('../../src/lib/automationApi.ts');
const cats = await import('../../src/pages/api/automation/v1/categories/index.ts');
const sug = await import('../../src/pages/api/automation/v1/categories/suggestions.ts');
const asig = await import('../../src/pages/api/automation/v1/categories/assign.ts');
const B = 'http://localhost';
const req = (url, { method = 'GET', token, body } = {}) => new Request(B + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const js = async (r) => ({ status: r.status, j: await r.json() });
const lector = A.createClient({ name: 'director-lecturas', scopes: ['catalog:read'] }).token;
const escritor = A.createClient({ name: 'director-escritura', scopes: ['catalog:write'] }).token;
const productos = () => JSON.parse(fs.readFileSync(f('products.json'), 'utf8'));
const categorias = () => JSON.parse(fs.readFileSync(f('categories.json'), 'utf8'));

test('PERMISOS: catalog:write es exclusivo; leer no permite escribir; escribir exige el interruptor (404 si está apagado, como una ruta inexistente)', async () => {
  assert.equal(A.createClient({ name: 'mezcla', scopes: ['catalog:read', 'catalog:write'] }).code, 'alcance_exclusivo');
  const crear = (token) => cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token, body: { nombre: 'Viaje', clave: 'cf_prueba_0001' } }) });
  assert.equal((await crear(escritor)).status, 404, 'interruptor apagado');
  process.env.AUTOMATION_WRITE_ENABLED = 'true';
  assert.equal((await crear(lector)).status, 403, 'el token de lectura no escribe');
  assert.equal((await crear('tai_0000000000000000_falso')).status, 401);
  assert.equal((await cats.GET({ request: req('/api/automation/v1/categories', { token: escritor }) })).status, 403, 'el de escritura no lee');
  assert.equal(categorias().length, 2, 'nada creado');
});

test('CREAR CATEGORÍA: la misma función del panel, verificable, idempotente por clave y sin duplicar si ya existe', async () => {
  process.env.AUTOMATION_WRITE_ENABLED = 'true';
  const r = await js(await cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token: escritor, body: { nombre: 'Accesorios de viaje', clave: 'cf_crear_0001' } }) }));
  assert.equal(r.status, 201); assert.equal(r.j.categoria.id, 'accesorios-de-viaje'); assert.equal(r.j.existente, false);
  assert.ok(categorias().some((c) => c.id === 'accesorios-de-viaje' && c.name === 'Accesorios de viaje'), 'persistida en categories.json');
  const lista = await js(await cats.GET({ request: req('/api/automation/v1/categories', { token: lector }) }));
  assert.ok(lista.j.categorias.some((c) => c.id === 'accesorios-de-viaje' && c.productos === 0), 'visible aunque esté vacía');
  const otra = await js(await cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token: escritor, body: { nombre: 'Accesorios de viaje', clave: 'cf_crear_0001' } }) }));
  assert.equal(otra.j.repetida, true, 'misma clave → mismo resultado, sin escribir otra vez');
  const dup = await js(await cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token: escritor, body: { nombre: 'accesorios DE viaje', clave: 'cf_crear_0002' } }) }));
  assert.equal(dup.status, 200); assert.equal(dup.j.existente, true, 'otro nombre equivalente: no se duplica');
  assert.equal(categorias().filter((c) => /viaje/.test(c.id)).length, 1);
  const sub = await js(await cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token: escritor, body: { nombre: 'Maletas', padre: 'accesorios-de-viaje', clave: 'cf_crear_0003' } }) }));
  assert.equal(sub.j.categoria.padre, 'accesorios-de-viaje');
  assert.equal((await cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token: escritor, body: { nombre: 'Nieta', padre: sub.j.categoria.id, clave: 'cf_crear_0004' } }) })).status, 409, 'un solo nivel');
  assert.equal((await cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token: escritor, body: { nombre: '<script>', clave: 'cf_crear_0005' } }) })).status, 400);
  assert.equal((await cats.POST({ request: req('/api/automation/v1/categories', { method: 'POST', token: escritor, body: { nombre: 'X y', clave: 'cf_crear_0006', borrar: true } }) })).status, 400, 'campos fuera de la lista');
  const reg = fs.readFileSync(f('automation-writes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(reg.every((e) => e.clientId && e.operacion && e.clave && e.resultado), 'cada escritura queda registrada');
});

test('SUGERENCIAS Y ASIGNACIÓN: fichas sin categoría con certeza; asignar es atómico, optimista (no pisa cambios ajenos), idempotente y registra antes/después', async () => {
  process.env.AUTOMATION_WRITE_ENABLED = 'true';
  const s = await js(await sug.GET({ request: req('/api/automation/v1/categories/suggestions', { token: lector }) }));
  assert.equal(s.j.total, 3);
  const porId = Object.fromEntries(s.j.sugerencias.map((x) => [x.productId, x]));
  assert.equal(porId.p1.certeza, 'segura', 'muy parecida a fichas ya clasificadas en Sonido'); assert.equal(porId.p1.propuesta.categoryId, 'sonido'); assert.equal(porId.p1.metodo, 'parecido'); assert.ok(porId.p1.propuesta.parecidas.length >= 1, 'con las fichas parecidas como prueba');
  assert.equal(porId.p2.certeza, 'sin_propuesta');
  // otra persona clasifica p4 en el panel ENTRE la propuesta y la aprobación
  const ps = productos(); ps.find((p) => p.id === 'p4').category_id = 'informatica'; fs.writeFileSync(f('products.json'), JSON.stringify(ps));
  const body = { clave: 'cf_asignar_0001', asignaciones: [{ productId: 'p1', categoryId: 'sonido', antes: { category_id: null } }, { productId: 'p4', categoryId: 'accesorios-de-viaje', antes: { category_id: null } }, { productId: 'p9', categoryId: 'sonido', antes: { category_id: null } }, { productId: 'p2', categoryId: 'no-existe' }] };
  const r = await js(await asig.POST({ request: req('/api/automation/v1/categories/assign', { method: 'POST', token: escritor, body }) }));
  assert.equal(r.status, 200); assert.deepEqual(r.j.aplicadas.map((a) => a.productId), ['p1']);
  assert.deepEqual(Object.fromEntries(r.j.omitidas.map((o) => [o.productId, o.motivo])), { p4: 'cambiada_mientras_tanto', p9: 'producto_no_existe', p2: 'categoria_no_valida' });
  const p1 = productos().find((p) => p.id === 'p1'); assert.equal(p1.category_id, 'sonido'); assert.equal(p1.category, 'Sonido', 'mismo formato que el panel');
  assert.equal(productos().find((p) => p.id === 'p4').category_id, 'informatica', 'el cambio ajeno se respeta');
  assert.deepEqual(r.j.aplicadas[0].antes, { category: '', category_id: null, subcategory_id: null });
  const rep = await js(await asig.POST({ request: req('/api/automation/v1/categories/assign', { method: 'POST', token: escritor, body }) }));
  assert.equal(rep.j.repetida, true);
  assert.equal((await asig.POST({ request: req('/api/automation/v1/categories/assign', { method: 'POST', token: lector, body: { ...body, clave: 'cf_asignar_0002' } }) })).status, 403);
  assert.equal((await asig.POST({ request: req('/api/automation/v1/categories/assign', { method: 'POST', token: escritor, body: { clave: 'cf_asignar_0003', asignaciones: Array.from({ length: 201 }, () => ({ productId: 'p1', categoryId: 'sonido' })) } }) })).status, 400, 'lote acotado');
});
