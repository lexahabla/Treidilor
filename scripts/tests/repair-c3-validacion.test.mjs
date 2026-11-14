// C3 — validación con una copia REAL del catálogo: proyección mínima (docs/c3-validacion-copia-real.md) + `repair-catalog.mjs --c3`.
// Solo datos sintéticos en directorios temporales: sin red, sin importaciones y sin tocar ningún catálogo real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planRepairs } from '../../src/lib/catalogRepair.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = fs.readFileSync(path.join(RAIZ, 'docs', 'c3-validacion-copia-real.md'), 'utf8').replace(/\r\n/g, '\n');
const EXTRACTOR = DOC.match(/node - <<'JS'\n([\s\S]*?)\nJS\n/)[1];
const BAD = '[object Object]';
const SECRETOS = ['SECRETO-API-KEY', '+34 600 111 222', 'Calle Reservada 99', 'DESCRIPCION-PRIVADA', 'api_key=SECRETO-API-KEY', 'ancla-privada'];

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const clone = (x) => structuredClone(x);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'treidilor-c3v-'));

/** Ficha antigua afectada, con datos que NO deben salir del contenedor. */
const afectada = (id, vendor, over = {}) => ({
  id, title: `Producto ${id}`, description: 'DESCRIPCION-PRIVADA', price: 49.9, merchant: BAD, network: 'amazon', brand: 'Zeta', asin: 'B0TEST0001',
  affiliateUrl: 'https://www.amazon.es/dp/B0TEST0001?tag=x-21#ancla-privada', buyNowUrl: 'https://www.amazon.es/gp/aws/cart/add.html?ASIN.1=B0TEST0001',
  extra: {
    importSource: 'scraperapi-amazon-json', apiKey: 'SECRETO-API-KEY', fulfillmentProvider: 'Amazon Logistics',
    scraperApiSource: { asin: 'B0TEST0001', request: { url: 'https://api.scraperapi.com/?api_key=SECRETO-API-KEY' }, seller: { id: null, url: 'https://www.amazon.com', name: vendor, phone: '+34 600 111 222', address: ['Calle Reservada 99', 'Madrid'] } },
  },
  ...over,
});
const sana = (i) => ({ id: `ok-${i}`, title: `Sana ${i}`, description: 'DESCRIPCION-PRIVADA', price: 10 + i, merchant: i % 2 ? 'Amazon' : 'TiendaY', network: i % 2 ? 'amazon' : 'ebay', extra: { apiKey: 'SECRETO-API-KEY' } });
/** Catálogo de 136 productos: 130 sanos + las seis fichas de C3 (2 de Amazon y 4 de vendedores externos). */
const catalogoReal = (afectadas) => [...Array.from({ length: 130 }, (_, i) => sana(i)), ...afectadas];
const SEIS = () => [afectada('c3-1', 'Amazon'), afectada('c3-2', 'Amazon'), afectada('c3-3', 'TecnoOfertas SL'), afectada('c3-4', 'ElectroHogar'), afectada('c3-5', 'Gadgets Norte'), afectada('c3-6', 'Mundo Sonido')];

/** Ejecuta el EXTRACTOR del documento sobre un directorio de datos temporal y devuelve su salida. */
const extraer = (productos) => {
  const dir = tmp();
  const archivo = path.join(dir, 'products.json');
  fs.writeFileSync(archivo, JSON.stringify(productos, null, 2));
  const antes = { hash: sha(fs.readFileSync(archivo)), mtime: fs.statSync(archivo).mtimeMs, ls: fs.readdirSync(dir) };
  const r = spawnSync(process.execPath, ['-'], { input: EXTRACTOR, env: { ...process.env, TRADYLOR_DATA_DIR: dir }, encoding: 'utf8' });
  const despues = { hash: sha(fs.readFileSync(archivo)), mtime: fs.statSync(archivo).mtimeMs, ls: fs.readdirSync(dir) };
  fs.rmSync(dir, { recursive: true, force: true });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, antes, despues };
};
const validar = (texto, ...args) => {
  const dir = tmp();
  const f = path.join(dir, 'c3-salida.txt');
  fs.writeFileSync(f, texto);
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', 'scripts/repair-catalog.mjs', f, '--c3', ...args], { cwd: RAIZ, encoding: 'utf8' });
  const ls = fs.readdirSync(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...r, ls };
};
const items = (productos) => planRepairs(productos).items.filter((i) => i.kind === 'malformed-merchant').map((i) => ({ id: i.id, patch: i.patch, detail: i.detail }));
const bloqueDe = (salida) => salida.split('-----JSON-----\n')[1].split('\n-----FIN-----')[0];
const proyeccionDe = (salida) => JSON.parse(bloqueDe(salida));

// ── 1. La extracción: solo lectura y proyección mínima ──────────────────────────────────────────────────────────
test('extractor: solo lectura (el archivo no cambia), cabecera correcta y NINGÚN dato privado en la salida', () => {
  const productos = catalogoReal(SEIS());
  const r = extraer(productos);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.despues, r.antes, 'ni contenido, ni fecha, ni nuevos archivos');
  assert.match(r.stdout, /#TOTAL=136\n/);
  assert.match(r.stdout, /#MERCHANT_EXACTO=6\n/);
  assert.match(r.stdout, /#ORIGINAL_SIN_CAMBIOS=SI\n/);
  assert.ok(r.stdout.includes(`#SHA256_ORIGINAL=${r.antes.hash}\n`));
  assert.ok(r.stdout.includes(`#SHA256_PROYECCION=${sha(bloqueDe(r.stdout))}\n`));
  for (const secreto of SECRETOS) assert.ok(!r.stdout.includes(secreto), `la salida no contiene «${secreto}»`);
  for (const campo of ['description', 'price', 'title', 'brand', 'asin', 'apiKey', 'phone', 'address', 'fulfillmentProvider', 'request']) assert.ok(!r.stdout.includes(`"${campo}"`), `sin el campo ${campo}`);
  const proy = proyeccionDe(r.stdout);
  assert.equal(proy.length, 136);
  for (const p of proy.filter((x) => !x.id.startsWith('c3-'))) assert.deepEqual(Object.keys(p).sort(), ['id', 'merchant', 'network'], 'las 130 no afectadas: solo id, comercio y red');
  for (const p of proy.filter((x) => x.id.startsWith('c3-'))) {
    assert.deepEqual(Object.keys(p).sort(), ['affiliateUrl', 'buyNowUrl', 'extra', 'id', 'merchant', 'network']);
    assert.deepEqual(Object.keys(p.extra).sort(), ['importSource', 'scraperApiSource']);
    assert.deepEqual(Object.keys(p.extra.scraperApiSource), ['seller'], 'del vendedor solo el nombre');
    assert.equal(typeof p.extra.scraperApiSource.seller, 'string');
    assert.ok(!p.affiliateUrl.includes('#'), 'URL sin ancla');
  }
});

test('extractor: errores claros y sin escribir (archivo que no es una lista)', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify({ a: 1 }));
  const r = spawnSync(process.execPath, ['-'], { input: EXTRACTOR, env: { ...process.env, TRADYLOR_DATA_DIR: dir }, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1); assert.match(r.stdout, /#ERROR=/);
});

// ── 2. La proyección no pierde nada de lo que necesita el planificador ──────────────────────────────────────────
test('equivalencia: el plan de `malformed-merchant` sobre la proyección es IDÉNTICO al plan sobre las fichas completas (incluidos casos límite)', () => {
  const raros = [
    afectada('r-contraria', 'X', { network: 'ebay' }),
    afectada('r-url-otra-red', 'X', { affiliateUrl: 'https://es.aliexpress.com/item/1.html#a' }),
    afectada('r-awin', 'X', { affiliateUrl: 'https://tienda.example/p?awc=1_2_3', network: undefined }),
    afectada('r-sin-red', 'X', { network: undefined, affiliateUrl: undefined, buyNowUrl: undefined, extra: { scraperApiSource: { seller: 'X' } } }),
    afectada('r-red-objeto', 'X', { network: { n: 1 } }),
    afectada('r-cross', 'X', { extra: { importSource: 'scraperapi-amazon', crossMerchant: { networks: ['amazon', { x: 1 }] }, scraperApiSource: { seller: 'X' } } }),
    afectada('r-cross-ok', 'X', { extra: { importSource: 'scraperapi-amazon', crossMerchant: { networks: ['amazon'] }, scraperApiSource: { seller: { name: 'Y' } } } }),
    afectada('r-bloqueada', 'X', { extra: { importSource: 'scraperapi-amazon', lockedFields: ['merchant', 5], scraperApiSource: { seller: 'X' } } }),
    afectada('r-manual', 'X', { extra: { importSource: 'scraperapi-amazon', fieldSources: { merchant: 'manual' }, scraperApiSource: { seller: 'X' } } }),
    afectada('r-otro-bloqueo', 'X', { extra: { importSource: 'scraperapi-amazon', lockedFields: ['brand'], fieldSources: { merchant: 'import' }, scraperApiSource: { seller: 'Z' } } }),
    afectada('r-sin-raw', 'X', { extra: { importSource: 'scraperapi-amazon' } }),
    afectada('r-raw-no-objeto', 'X', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: 'texto' } }),
    afectada('r-seller-array', 'X', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller: ['A'] } } }),
    afectada('r-seller-vacio', 'X', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller: { name: '  ' } } } }),
    afectada('r-seller-malo', 'X', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller: { name: BAD } } } }),
    afectada('r-seller-largo', 'X', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller: 'x'.repeat(130) } } }),
    afectada('r-extra-no-objeto', 'X', { extra: 'cadena' }),
    { ...afectada('r-variante', 'X'), merchant: ' [object Object] ' },
  ];
  for (const catalogo of [catalogoReal(SEIS()), catalogoReal(raros), catalogoReal([...SEIS(), ...raros])]) {
    const r = extraer(catalogo);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(items(proyeccionDe(r.stdout)), items(catalogo));
  }
});

// ── 3. Validación local con --c3 ────────────────────────────────────────────────────────────────────────────────
test('--c3 ACEPTA la salida real del extractor con las seis fichas: criterios OK, informe agregado y nada escrito', () => {
  const salida = extraer(catalogoReal(SEIS())).stdout;
  const r = validar(salida);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULTADO: ACEPTADA/);
  assert.ok(!/FALLA/.test(r.stdout), r.stdout);
  assert.match(r.stdout, /Proyección verificada: 136 productos/);
  assert.match(r.stdout, /Fichas a reparar: 6 · por red declarada \{"amazon":6\} · comercio resultante «Amazon»: 2 · vendedor externo: 4/);
  for (const [id, despues] of [['c3-1', 'Amazon'], ['c3-2', 'Amazon'], ['c3-3', 'TecnoOfertas SL'], ['c3-4', 'ElectroHogar'], ['c3-5', 'Gadgets Norte'], ['c3-6', 'Mundo Sonido']]) {
    assert.ok(r.stdout.includes(`- ${id} [amazon]: «${BAD}» → «${despues}»`), id);
  }
  assert.equal((r.stdout.match(/^OK /gm) || []).length, 13, 'trece criterios, todos OK');
  for (const secreto of SECRETOS) assert.ok(!r.stdout.includes(secreto));
  assert.deepEqual(r.ls, ['c3-salida.txt'], 'no crea ningún archivo');
});

test('--c3 tolera lo que añade una terminal al copiar (espacios finales, saltos CRLF, líneas ajenas antes y después)', () => {
  const salida = extraer(catalogoReal(SEIS())).stdout;
  const sucio = 'root@app:/app# node - <<JS ...\n' + salida.split('\n').map((l) => l + '   ').join('\r\n') + '\nroot@app:/app# ';
  assert.equal(validar(sucio).status, 0);
});

// ── 4. Si algún criterio falla: DETENER ─────────────────────────────────────────────────────────────────────────
const detiene = (r, criterio) => {
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /RESULTADO: DETENER/);
  if (criterio) assert.match(r.stdout, new RegExp(`FALLA .*${criterio}`), r.stdout);
  assert.ok(!/RESULTADO: ACEPTADA/.test(r.stdout));
};

test('DETENER: proyección alterada o copiada incompleta (el hash no cuadra)', () => {
  const salida = extraer(catalogoReal(SEIS())).stdout;
  detiene(validar(salida.replace('"TecnoOfertas SL"', '"Otro Nombre"')), 'hash de la proyección');
  detiene(validar(salida.replace(/\n\{"id":"ok-7".*\n/, '\n')), 'hash de la proyección');
  detiene(validar(salida.split('-----FIN-----')[0]), null);
  detiene(validar(salida.replace('-----JSON-----', '')), null);
  detiene(validar(JSON.stringify(catalogoReal(SEIS()))), null);
});

test('DETENER: cabecera inconsistente (total, original modificado, número de afectadas)', () => {
  const salida = extraer(catalogoReal(SEIS())).stdout;
  detiene(validar(salida.replace('#TOTAL=136', '#TOTAL=135')), 'número de productos');
  detiene(validar(salida.replace('#ORIGINAL_SIN_CAMBIOS=SI', '#ORIGINAL_SIN_CAMBIOS=NO')), 'no cambió durante la extracción');
  detiene(validar(salida.replace('#MERCHANT_EXACTO=6', '#MERCHANT_EXACTO=5')), 'esperadas');
});

test('DETENER: número de afectadas distinto del esperado (5, 7, 0)', () => {
  const salida6 = extraer(catalogoReal(SEIS())).stdout;
  detiene(validar(salida6, '--esperadas', '5'), 'esperadas');
  detiene(validar(extraer(catalogoReal([...SEIS(), afectada('c3-7', 'Otro')])).stdout), 'esperadas');
  detiene(validar(extraer(catalogoReal([])).stdout), 'esperadas');
});

test('DETENER: una ficha no reparable (señal contraria, sin evidencia, sin nombre de vendedor o bloqueada) impide aceptar', () => {
  const sustituyendo = (ficha) => extraer(catalogoReal([...SEIS().slice(0, 5), ficha])).stdout;
  detiene(validar(sustituyendo(afectada('c3-6', 'X', { network: 'ebay' }))), 'reparables');
  detiene(validar(sustituyendo(afectada('c3-6', 'X', { network: undefined, affiliateUrl: undefined, buyNowUrl: undefined, extra: { scraperApiSource: { seller: 'X' } } }))), 'reparables');
  detiene(validar(sustituyendo(afectada('c3-6', 'X', { extra: { importSource: 'scraperapi-amazon', scraperApiSource: { seller: {} } } }))), 'reparables');
  detiene(validar(sustituyendo(afectada('c3-6', 'X', { extra: { importSource: 'scraperapi-amazon', lockedFields: ['merchant'], scraperApiSource: { seller: 'X' } } }))), 'reparables');
});

test('el informe de un DETENER sigue sin mostrar datos privados', () => {
  const r = validar(extraer(catalogoReal([...SEIS().slice(0, 5), afectada('c3-6', 'X', { network: 'ebay' })])).stdout);
  for (const secreto of SECRETOS) assert.ok(!r.stdout.includes(secreto) && !r.stderr.includes(secreto));
});
