// Empaquetado del Director 00 (D-3 provisional: TAR verificado con SHA-256), 17/11/2026. Sin Docker y sin red: árboles sintéticos en un directorio temporal, el árbol real solo se LEE y los archivos de la imagen se revisan como texto.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAIZ, cabecera, calcularArchivos, construirTar, importsRelativos, leerArchivos, leerTar, rutaSegura, sha256Hex, verificarTar } from '../../../scripts/automation/empaquetar-director.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IMAGEN = path.join(AQUI, '..', '..', 'dev', 'director-imagen');
const archivo = (ruta, texto) => ({ ruta, contenido: Buffer.from(texto, 'utf8') });
const arbol = (ficheros) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-emp-'));
  for (const [r, t] of Object.entries(ficheros)) { fs.mkdirSync(path.dirname(path.join(dir, r)), { recursive: true }); fs.writeFileSync(path.join(dir, r), t); }
  return dir;
};
const base = () => ({
  'scripts/automation/director.mjs': "import { a } from '../../automation/director/a.mjs';\nexport const x = a;\n",
  'automation/director/a.mjs': "import fs from 'node:fs';\nimport {\n  b,\n} from '../lib/b.mjs';\nexport const a = b;\n",
  'automation/lib/b.mjs': 'export const b = 1;\n',
  'automation/director/datos.json': '{"sintetico":true}\n',
  'automation/director/tests/a.test.mjs': "import '../a.mjs';\n",
  'automation/config/local.json': '{}\n',
});

test('rutas: solo relativas, sin .., sin barra invertida, sin unidad, sin NUL', () => {
  for (const r of ['automation/director/a.mjs', 'package.json']) assert.equal(rutaSegura(r), true);
  for (const r of ['/etc/passwd', '../x', 'a/../b', 'a\\b', 'C:/x', 'a//b', './a', 'a/./b', '', 'a\0b', 'x'.repeat(300)]) assert.equal(rutaSegura(r), false, r);
});

test('imports: se siguen los relativos (varias líneas, export from, import dinámico con literal) y se ignoran node: y paquetes', () => {
  const t = "import fs from 'node:fs';\nimport x from 'paquete';\nimport {\n a,\n b\n} from './uno.mjs';\nexport * from '../dos.mjs';\nimport './tres.mjs';\nconst m = await import('./cuatro.mjs');\nconst n = new URL('../config/local.json', import.meta.url);\n";
  assert.deepEqual(importsRelativos(t).sort(), ['../dos.mjs', './cuatro.mjs', './tres.mjs', './uno.mjs']);
});

test('cierre de archivos: entradas + directorio del Director (sin pruebas) + imports + extras; ordenado y sin duplicados', () => {
  const dir = arbol(base());
  try {
    const r = calcularArchivos(dir);
    assert.deepEqual(r, ['automation/config/local.json', 'automation/director/a.mjs', 'automation/director/datos.json', 'automation/lib/b.mjs', 'scripts/automation/director.mjs']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('el cierre FALLA en voz alta ante un import a TypeScript, fuera de lo permitido o inexistente', () => {
  for (const [import_, esperado] of [["import '../../src/lib/x.ts';", /TypeScript/], ["import '../../src/lib/x.mjs';", /fuera de lo permitido/], ["import './no-existe.mjs';", /no existe/]]) {
    const dir = arbol({ ...base(), 'automation/director/a.mjs': `${import_}\nexport const a = 1;\n` });
    try { assert.throws(() => calcularArchivos(dir), esperado); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('un archivo con forma de credencial ABORTA el empaquetado; los límites se aplican', () => {
  const dir = arbol({ ...base(), 'automation/director/datos.json': '{"token": "' + ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_') + '"}\n' });
  try { assert.throws(() => leerArchivos(dir, calcularArchivos(dir)), /forma de credencial/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const ok = arbol(base());
  try { assert.equal(leerArchivos(ok, calcularArchivos(ok)).length, 5); } finally { fs.rmSync(ok, { recursive: true, force: true }); }
});

test('el TAR es determinista, lleva MANIFIESTO.json primero y se lee de vuelta igual (rutas largas incluidas)', () => {
  const larga = `automation/director/${'carpeta-larga/'.repeat(6)}archivo.json`;
  assert.ok(larga.length > 100 && larga.length < 240);
  const archivos = [archivo('automation/director/a.mjs', 'export const a = 1;\n'), archivo(larga, '{}\n'), archivo('package.json', '{"type":"module"}\n'), archivo('automation/lib/vacio.json', '')];
  const t1 = construirTar(archivos, '9.9.9'); const t2 = construirTar([...archivos].reverse(), '9.9.9');
  assert.equal(sha256Hex(t1), sha256Hex(t2), 'mismo contenido ⇒ mismo SHA-256, sin depender del orden de entrada');
  assert.notEqual(sha256Hex(construirTar(archivos, '9.9.10')), sha256Hex(t1));
  const leidos = leerTar(t1);
  assert.equal(leidos[0].ruta, 'MANIFIESTO.json');
  assert.deepEqual(leidos.slice(1).map((e) => e.ruta).sort(), archivos.map((a) => a.ruta).sort());
  assert.equal(String(leidos.find((e) => e.ruta === larga).contenido), '{}\n');
  assert.equal(t1.length % 512, 0);
  const v = verificarTar(t1, sha256Hex(t1));
  assert.equal(v.ok, true, v.errores.join(';')); assert.equal(v.archivos, 4); assert.equal(v.version, '9.9.9');
});

test('verificación estricta: hash distinto, contenido alterado, ruta peligrosa, duplicados, archivos fuera del manifiesto, enlaces, truncado y datos tras el final', () => {
  const t = construirTar([archivo('automation/director/a.mjs', 'export const a = 1;\n'), archivo('package.json', '{}\n')], '1.0.0');
  const sha = sha256Hex(t);
  assert.equal(verificarTar(t, sha).ok, true);
  assert.equal(verificarTar(t, '0'.repeat(64)).ok, false);
  // contenido alterado (un byte dentro del primer archivo, tras el manifiesto)
  const alt = Buffer.from(t); const i = alt.indexOf('export const a'); alt[i] ^= 1;
  const va = verificarTar(alt, null); assert.equal(va.ok, false); assert.ok(va.errores.some((e) => /Contenido distinto/.test(e)));
  // enlace simbólico (tipo '2'): se rechaza aunque se recalcule algo
  const enlace = Buffer.from(t); enlace[156] = '2'.charCodeAt(0);   // el tipo de la PRIMERA entrada (el manifiesto) pasa a enlace simbólico
  assert.equal(verificarTar(enlace, null).ok, false);
  // truncado y basura final
  assert.equal(verificarTar(t.subarray(0, t.length - 1024 - 100), null).ok, false);
  assert.equal(verificarTar(Buffer.concat([t, Buffer.from('x')]), null).ok, false);
  // ruta con .., absoluta y archivo no declarado en el manifiesto: se construyen a mano con `cabecera`
  const man = Buffer.from(JSON.stringify({ formato: 'treidilor-director-tar/1', version: '1', archivos: [] }));
  const pad = (b) => Buffer.alloc((512 - (b.length % 512)) % 512, 0);
  const crudo = (rutas) => Buffer.concat([cabecera('MANIFIESTO.json', man.length), man, pad(man), ...rutas.flatMap((r) => { const c = Buffer.from('x'); return [cabecera(r, 1), c, pad(c)]; }), Buffer.alloc(1024, 0)]);
  for (const r of ['../evil', '/abs', 'otro/lugar.txt']) { const v = verificarTar(crudo([r]), null); assert.equal(v.ok, false, r); }
  const dup = verificarTar(crudo(['automation/a.mjs', 'automation/a.mjs']), null); assert.equal(dup.ok, false); assert.ok(dup.errores.some((e) => /duplicadas/.test(e)));
  assert.ok(verificarTar(crudo(['automation/a.mjs']), null).errores.some((e) => /fuera del manifiesto/.test(e)));
});

test('el árbol REAL (solo lectura): el cierre del Director incluye lo necesario, excluye pruebas, src y datos, y no se sale de automation/ ni scripts/automation/', () => {
  const r = calcularArchivos(RAIZ);
  for (const f of ['scripts/automation/director.mjs', 'automation/director/director.mjs', 'automation/director/lectores.mjs', 'automation/director/registro.mjs', 'automation/director/registro-agentes.v1.json', 'automation/lib/seguimiento.mjs', 'automation/config/local.json']) assert.ok(r.includes(f), `falta ${f}`);
  assert.ok(r.every((f) => /^(automation|scripts\/automation)\//.test(f)), 'nada fuera de las dos carpetas permitidas');
  assert.ok(!r.some((f) => /(^|\/)tests\//.test(f) || /\.test\.mjs$/.test(f)), 'sin pruebas');
  assert.ok(!r.some((f) => /^src\/|^public\/|\.env|credentials|node_modules/.test(f)));
  assert.ok(!r.includes('scripts/automation/empaquetar-director.mjs'), 'el empaquetador no viaja en el paquete');
});

test('imagen y compose: build solo desde el TAR con hash comprobado, sin puertos, sin red, sin privilegios, un único volumen escribible y sin secretos', () => {
  const d = fs.readFileSync(path.join(IMAGEN, 'Dockerfile'), 'utf8'); const c = fs.readFileSync(path.join(IMAGEN, 'docker-compose.yml'), 'utf8');
  assert.match(d, /^FROM node:22-bookworm-slim$/m); assert.match(d, /sha256sum -c -/); assert.match(d, /^USER node$/m);
  assert.ok(!/\bEXPOSE\b|\bADD\b|curl|wget|apt-get|npm (i|install)|docker\.sock/.test(d), 'sin puertos, sin descargas y sin instalar nada');
  assert.equal((d.match(/^COPY /gm) ?? []).length, 1, 'solo se copia el TAR');
  assert.match(d, /TAR_SHA256/); assert.match(d, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(c, /profiles: \["cli"\]/); assert.match(c, /network_mode: none/); assert.match(c, /read_only: true/); assert.match(c, /cap_drop: \[ALL\]/); assert.match(c, /no-new-privileges:true/); assert.match(c, /user: node/);
  const sinComentarios = c.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/^\s*ports:/m.test(sinComentarios) && !/privileged|docker\.sock|network_mode: host|pid: host|cap_add/.test(sinComentarios));
  assert.ok(!/(KEY|TOKEN|SECRET|PASSWORD)/i.test(sinComentarios.replace(/TAI_DIRECTOR_DIR/g, '')), 'sin variables de claves');
  assert.equal((sinComentarios.match(/tai_director_ledger:\/var\/lib\/tai-director/g) ?? []).length, 1, 'único volumen escribible: el ledger');
});
