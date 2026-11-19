// Distribución privada del Director: generador, instalar.sh / revertir.sh (con DOCKER LOCAL real, imagen de prueba propia y SIN red) y consultar-real.sh (con un docker falso). Nada toca el VPS, GitHub ni n8n.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RAIZ, calcularArchivos, construirTar, leerArchivos, sha256Hex } from '../../../scripts/automation/empaquetar-director.mjs';
import { ordenVps, preparar } from '../../../scripts/automation/preparar-distribucion-director.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASH = fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe') ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const posix = (p) => p.replace(/\\/g, '/');
const IMAGEN = 'tai-test-director-f28';
let dockerOk = false; try { execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe', timeout: 20000 }); dockerOk = true; } catch { /* sin docker */ }

function crearTar(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f28-tar-'));
  const archivos = leerArchivos(RAIZ, calcularArchivos(RAIZ)); const tar = construirTar(archivos, version);
  const nombre = `treidilor-director-${version}.tar`; const ruta = path.join(dir, nombre);
  fs.writeFileSync(ruta, tar); fs.writeFileSync(`${ruta}.sha256`, `${sha256Hex(tar)}  ${nombre}\n`);
  return { dir, ruta, sha: sha256Hex(tar) };
}
const salidaNueva = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f28-dist-')), 'dist');
const limpiar = (...ds) => { for (const d of ds) fs.rmSync(d, { recursive: true, force: true }); };

test('generador: carpeta completa y reproducible, sha256 = ancla, sin secretos, scripts con LF, .gitattributes binario; nada de git ni de red', () => {
  const t = crearTar('9.9.9-t1'); const s = salidaNueva();
  try {
    const r = preparar({ tar: t.ruta, salida: s, repo: 'ejemplo/treidilor-director-dist' });
    assert.equal(r.sha256, t.sha); assert.equal(r.version, '9.9.9-t1');
    for (const f of ['paquete/treidilor-director-9.9.9-t1.tar', 'paquete/treidilor-director-9.9.9-t1.tar.sha256', 'Dockerfile', 'docker-compose.yml', 'docker-compose.real.yml', 'instalar.sh', 'revertir.sh', 'consultar-real.sh', 'verificar-canario.sh', 'evidencia-e3.sh', 'VERSION', '.gitattributes', '.gitignore', 'LEEME.md']) assert.ok(fs.existsSync(path.join(s, f)), f);
    assert.ok(!fs.existsSync(path.join(s, '.git')), 'no hace git');
    assert.equal(sha256Hex(fs.readFileSync(path.join(s, 'paquete', 'treidilor-director-9.9.9-t1.tar'))), t.sha);
    for (const f of ['instalar.sh', 'revertir.sh', 'consultar-real.sh', 'verificar-canario.sh', 'evidencia-e3.sh', 'Dockerfile', 'VERSION']) assert.ok(!fs.readFileSync(path.join(s, f), 'utf8').includes('\r'), `${f} con CR`);
    assert.match(fs.readFileSync(path.join(s, '.gitattributes'), 'utf8'), /^\* -text$/m);
    assert.match(fs.readFileSync(path.join(s, '.gitignore'), 'utf8'), /\*\.token/);
    const l = fs.readFileSync(path.join(s, 'LEEME.md'), 'utf8'); assert.ok(l.includes(t.sha) && l.includes(r.orden));
  } finally { limpiar(t.dir, path.dirname(s)); }
});

test('generador: rechaza salida dentro del repositorio o no vacía, TAR alterado o sin .sha256, nombre incorrecto y repositorio mal formado', () => {
  const t = crearTar('9.9.9-t2'); const s = salidaNueva();
  try {
    assert.throws(() => preparar({ tar: t.ruta, salida: path.join(RAIZ, 'salida-prueba') }), /FUERA del repositorio/);
    fs.mkdirSync(s, { recursive: true }); fs.writeFileSync(path.join(s, 'x'), '1'); assert.throws(() => preparar({ tar: t.ruta, salida: s }), /no está vacía/);
    const alt = Buffer.from(fs.readFileSync(t.ruta)); alt[2000] ^= 1; const dAlt = path.join(t.dir, 'alt'); fs.mkdirSync(dAlt); const rAlt = path.join(dAlt, 'treidilor-director-9.9.9-t2.tar'); fs.writeFileSync(rAlt, alt); fs.copyFileSync(`${t.ruta}.sha256`, `${rAlt}.sha256`);
    assert.throws(() => preparar({ tar: rAlt, salida: salidaNueva() }), /no coincide con su \.sha256|verificación/);
    const sin = path.join(dAlt, 'sin.tar'); fs.copyFileSync(t.ruta, sin); assert.throws(() => preparar({ tar: sin, salida: salidaNueva() }), /\.sha256/);
    const otro = path.join(dAlt, 'otro-nombre.tar'); fs.copyFileSync(t.ruta, otro); fs.copyFileSync(`${t.ruta}.sha256`, `${otro}.sha256`); assert.throws(() => preparar({ tar: otro, salida: salidaNueva() }), /nombre del TAR/);
    for (const mal of ['sin-barra', 'a/b c', '../x/y', 'a/b;rm']) assert.throws(() => ordenVps({ repo: mal, sha256: t.sha }), /propietario\/nombre/);
  } finally { limpiar(t.dir, path.dirname(s)); }
});

test('orden del VPS: una sola línea, solo curl + tar (sin git), token pedido sin eco, en variable y borrado, nunca en el disco ni en la URL; SHA-256 de ancla; no borra nada más que su carpeta', () => {
  const sha = 'a'.repeat(64); const o = ordenVps({ repo: 'ejemplo/treidilor-director-dist', sha256: sha });
  assert.ok(!o.includes('\n')); assert.match(o, /read -rsp/); assert.match(o, /Authorization: Bearer \$T/); assert.match(o, /unset T/); assert.match(o, /set -o pipefail/);
  assert.ok(!/\bgit\b|x-access-token|https:\/\/[^/\s]*@/.test(o), 'sin git ni credencial en la URL'); assert.ok(o.includes(`instalar.sh" ${sha}`));
  assert.deepEqual([...o.matchAll(/rm -rf ("[^"]+")/g)].map((m) => m[1]).sort(), ['"$D"', '"$D.nuevo"']);
  assert.throws(() => ordenVps({ repo: 'a/b', sha256: 'zz' }), /SHA-256/);
});

test('instalar.sh / revertir.sh con Docker LOCAL real: verifica el SHA-256 ancla, construye, prueba de humo sin red, prepara el rollback, revierte y retira; con hash erróneo no cambia nada', { skip: !dockerOk && 'sin Docker local', timeout: 600000 }, async () => {
  const t1 = crearTar('9.9.9-t3'); const t2 = crearTar('9.9.9-t4'); const s1 = salidaNueva(); const s2 = salidaNueva(); const estado = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f28-est-'));
  const entorno = path.join(estado, 'entorno.sh'); fs.writeFileSync(entorno, 'id() { echo 0; }\n');
  const correr = (script, args) => new Promise((resolve) => execFile(BASH, [posix(script), ...args], { env: { ...process.env, MSYS_NO_PATHCONV: '1', BASH_ENV: posix(entorno), TAI_DIRECTOR_IMAGEN: IMAGEN, TAI_DIRECTOR_ESTADO: posix(path.join(estado, 'e')) }, timeout: 500000 }, (err, stdout, stderr) => resolve({ codigo: err ? (typeof err.code === 'number' ? err.code : 99) : 0, stdout, stderr })));
  const idDe = (tag) => { try { return execFileSync('docker', ['image', 'inspect', `${IMAGEN}:${tag}`, '--format', '{{.Id}}'], { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { return null; } };
  try {
    preparar({ tar: t1.ruta, salida: s1 }); preparar({ tar: t2.ruta, salida: s2 });
    const mal = await correr(path.join(s1, 'instalar.sh'), ['0'.repeat(64)]); assert.equal(mal.codigo, 1); assert.match(mal.stdout, /NO coincide/); assert.equal(idDe('actual'), null, 'con hash erróneo no se construye ni se activa nada');
    const sinArg = await correr(path.join(s1, 'instalar.sh'), []); assert.equal(sinArg.codigo, 1);
    const a = await correr(path.join(s1, 'instalar.sh'), [t1.sha]); assert.equal(a.codigo, 0, a.stdout + a.stderr);
    for (const m of ['DIRECTOR_TAR_VERIFICADO', 'DIRECTOR_IMAGEN_CONSTRUIDA', 'DIRECTOR_HUMO_OK', 'DIRECTOR_INSTALADO']) assert.match(a.stdout, new RegExp(m));
    assert.ok(idDe('actual') && idDe('actual') === idDe('9.9.9-t3')); assert.equal(idDe('anterior'), null);
    const re = await correr(path.join(s1, 'instalar.sh'), [t1.sha]); assert.equal(re.codigo, 0); assert.match(re.stdout, /YA_CONSTRUIDA/, 'idempotente');
    const b = await correr(path.join(s2, 'instalar.sh'), [t2.sha]); assert.equal(b.codigo, 0, b.stdout + b.stderr); assert.match(b.stdout, /ROLLBACK_PREPARADO/);
    assert.equal(idDe('actual'), idDe('9.9.9-t4')); assert.equal(idDe('anterior'), idDe('9.9.9-t3'));
    // el Director de la imagen activa funciona (sintético, sin red) y no tiene nada de la web
    const informe = execFileSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--user', 'node', '--tmpfs', '/tmp:size=16m,mode=1777', '-e', 'TAI_DIRECTOR_DIR=/tmp/d', `${IMAGEN}:actual`, 'informe', '04'], { encoding: 'utf8', stdio: 'pipe' }); assert.match(informe, /Calidad del catálogo \(04\)/);
    const r = await correr(path.join(s2, 'revertir.sh'), []); assert.equal(r.codigo, 0, r.stdout); assert.match(r.stdout, /DIRECTOR_REVERTIDO/); assert.equal(idDe('actual'), idDe('9.9.9-t3'));
    const q = await correr(path.join(s2, 'revertir.sh'), ['retirar']); assert.equal(q.codigo, 0); assert.equal(idDe('actual'), null);
    assert.match(fs.readFileSync(path.join(estado, 'e', 'instalaciones.log'), 'utf8'), /version=9\.9\.9-t4/);
  } finally {
    for (const tag of ['actual', 'anterior', 'descartada', '9.9.9-t3', '9.9.9-t4']) { try { execFileSync('docker', ['rmi', '-f', `${IMAGEN}:${tag}`], { stdio: 'pipe' }); } catch { /* ya no existe */ } }
    limpiar(t1.dir, t2.dir, path.dirname(s1), path.dirname(s2), estado);
  }
});

// ── consultar-real.sh con un docker FALSO ──
const FALSO = `
const fs=require('fs');const E=process.env.TAI_FALSO_ESTADO;const s=JSON.parse(fs.readFileSync(E,'utf8'));const a=process.argv.slice(2);s.llamadas.push(a);fs.writeFileSync(E,JSON.stringify(s));
const j=a.join(' ');
if(a[0]==='image'&&a[1]==='inspect'){process.exit(s.sinImagen?1:0);}
if(a[0]==='service'&&a[1]==='ls'){for(const l of s.servicios)console.log(l);process.exit(0);}
if(a[0]==='service'&&a[1]==='inspect'){console.log(s.redesIds.join(' ')+' ');process.exit(0);}
if(a[0]==='network'&&a[1]==='inspect'){const r=a[2];const n=s.redes[r];if(!n)process.exit(1);console.log(/Attachable/.test(j)?String(n.attachable):n.nombre);process.exit(0);}
if(a[0]==='run'){console.log('SALIDA_FALSA '+a.slice(a.indexOf(s.imagen)+1).join(' '));process.exit(0);}
process.exit(0);
`;
function montarConsulta(estado = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f28c-'));
  fs.writeFileSync(path.join(dir, 'falso.cjs'), FALSO);
  const entorno = path.join(dir, 'entorno.sh'); fs.writeFileSync(entorno, `docker() { "${posix(process.execPath)}" "${posix(path.join(dir, 'falso.cjs'))}" "$@"; }\nid() { echo 0; }\n`);
  const est = path.join(dir, 'estado.json'); const sec = path.join(dir, 'sec'); fs.mkdirSync(sec); fs.writeFileSync(path.join(sec, 'lector-prod.token'), 'valor-secreto-del-lector-0123456789abcdef');
  fs.writeFileSync(est, JSON.stringify({ imagen: 'treidilor-director:actual', servicios: ['practice_project_n8n_n8n docker.n8n.io/n8nio/n8n:2.38.6', 'practice_project_n8n_runner n8nio/runners:2.38.6', 'easypanel-traefik traefik:3.6.7'], redesIds: ['idIngress', 'idEasy'], redes: { idIngress: { nombre: 'ingress', attachable: false }, idEasy: { nombre: 'easypanel', attachable: true }, easypanel: { nombre: 'easypanel', attachable: true }, otra: { nombre: 'otra', attachable: false } }, llamadas: [], ...estado }));
  const script = path.join(AQUI, '..', '..', 'dev', 'director-distribucion', 'consultar-real.sh');
  const correr = (args, extra = {}) => new Promise((resolve) => execFile(BASH, [posix(script), ...args], { env: { ...process.env, BASH_ENV: posix(entorno), TAI_FALSO_ESTADO: est, TAI_DIRECTOR_SECRETOS: posix(sec), ...extra }, timeout: 60000 }, (err, stdout, stderr) => resolve({ codigo: err ? (typeof err.code === 'number' ? err.code : 99) : 0, stdout, stderr })));
  return { dir, correr, llamadas: () => JSON.parse(fs.readFileSync(est, 'utf8')).llamadas };
}

test('consultar-real.sh: descubre el servicio de n8n y su red, y ejecuta la secuencia completa con un contenedor sin puertos, solo lectura, sin capacidades y con la credencial en solo lectura', async () => {
  const E = montarConsulta();
  try {
    const r = await E.correr([]); assert.equal(r.codigo, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DIRECTOR_DESTINO servicio=practice_project_n8n_n8n red=easypanel attachable=true/); assert.match(r.stdout, /DIRECTOR_CONSULTA_REAL_OK/);
    const runs = E.llamadas().filter((l) => l[0] === 'run'); assert.equal(runs.length, 5, 'informe 04, 12, dos comparaciones y ledger');
    for (const l of runs) {
      const j = l.join(' ');
      assert.ok(l.includes('--read-only') && l.includes('--cap-drop') && l.includes('ALL') && j.includes('--network easypanel') && j.includes('--user node') && j.includes('no-new-privileges:true'));
      assert.ok(!/(^| )(-p|--publish|--privileged|--pid|--network host|--cap-add)( |$)/.test(j) && !j.includes('docker.sock'));
      assert.equal((j.match(/ -v /g) ?? []).length, 2, 'solo el ledger (escribible) y la credencial (:ro)'); assert.match(j, /lector-prod\.token:\/run\/secrets\/lector_prod_token:ro/); assert.match(j, /TAI_LECTOR_PROD_URL=http:\/\/practice_project_n8n_n8n:5678\/webhook/);
      assert.ok(j.includes('treidilor-director:actual') && (j.endsWith('--lector real') || j.endsWith('ledger verificar')), 'los informes llevan --lector real; la verificación del ledger no necesita red de lectura');
    }
    assert.ok(!r.stdout.includes('valor-secreto-del-lector') && !JSON.stringify(E.llamadas()).includes('valor-secreto-del-lector'), 'la credencial no se imprime ni viaja en la línea de órdenes');
  } finally { limpiar(E.dir); }
});

test('consultar-real.sh: se detiene ante red no «attachable», varios servicios de n8n, sin imagen, sin credencial u órdenes no permitidas; orden suelta permitida lleva --lector real', async () => {
  let E = montarConsulta({ redesIds: ['otra'], redes: { otra: { nombre: 'otra', attachable: false } } });
  try { const r = await E.correr([]); assert.equal(r.codigo, 1); assert.match(r.stdout, /no es «attachable»/); assert.equal(E.llamadas().filter((l) => l[0] === 'run').length, 0); } finally { limpiar(E.dir); }
  E = montarConsulta({ servicios: ['n8n_a n8nio/n8n:2.38.6', 'n8n_b n8nio/n8n:2.38.6'] });
  try { const r = await E.correr([]); assert.equal(r.codigo, 1); assert.match(r.stdout, /exactamente un servicio de n8n/); } finally { limpiar(E.dir); }
  E = montarConsulta({ sinImagen: true });
  try { const r = await E.correr([]); assert.equal(r.codigo, 1); assert.match(r.stdout, /no hay imagen/); } finally { limpiar(E.dir); }
  E = montarConsulta();
  try {
    fs.rmSync(path.join(E.dir, 'sec', 'lector-prod.token')); const r = await E.correr([]); assert.equal(r.codigo, 1); assert.match(r.stdout, /falta .*lector-prod\.token/);
    fs.writeFileSync(path.join(E.dir, 'sec', 'lector-prod.token'), 'x'.repeat(40));
    const mala = await E.correr(['aprobar', 'a_1', '--simulada']); assert.equal(mala.codigo, 1); assert.match(mala.stdout, /no permitida/);
    const buena = await E.correr(['informe', '04']); assert.equal(buena.codigo, 0); assert.match(buena.stdout, /informe 04 --lector real/);
    const host = await E.correr([], { TAI_LECTOR_HOST: 'n8n.midominio.com' }); assert.equal(host.codigo, 1); assert.match(host.stdout, /sin puntos/);
  } finally { limpiar(E.dir); }
});

test('los tres scripts: sin comandos de PowerShell, sin cambios en servicios/redes/Traefik/n8n, sin puertos, LF y sintaxis válida', () => {
  for (const f of ['instalar.sh', 'revertir.sh', 'consultar-real.sh']) {
    const ruta = path.join(AQUI, '..', '..', 'dev', 'director-distribucion', f); const t = fs.readFileSync(ruta, 'utf8'); const activo = t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.ok(!t.includes('\r'), `${f} CR`); assert.match(t, /^#!\/usr\/bin\/env bash/); execFileSync(BASH, ['-n', posix(ruta)]);
    assert.ok(!/docker (service (create|update|rm|scale)|network (create|rm|connect|disconnect)|stack|swarm)|systemctl|\bufw\b|iptables|Get-|Set-|Invoke-|-p \d|--publish/.test(activo), `${f}: operación fuera de alcance`);
    assert.ok(!/etc\/easypanel|traefik\/config|\/webhook\/tai-lector-prod-canario/.test(activo), `${f}: no toca Traefik ni el canario`);
  }
});
