// Agente 00 · 3E.8.14 · Scripts candidatos v2 de instalación/reversión CON POLÍTICA DE CONFIANZA (paquetes\director\confianza-pruebas-3e8-14\instalacion) ejecutados de verdad con bash.
// Parte A (Docker local, usuario no-root del host): política válida e inválida, rotación, corte, recuperación, instalación y reversión con imágenes reales.
// Parte B (Linux en contenedor, UID 0 REAL, sin red, sin docker.sock ni privilegios): lo que se puede probar SIN daemon (`--solo-verificar` con TAI_NODE_BIN); lo que exige el daemon queda registrado como pendiente.
// Todo sintético: claves desechables, políticas de pruebas, carpetas temporales; recursos Docker con prefijo `tai-proto-test-814-`. Se omite sin Docker/bash/candidato. No toca el rc2 ni `director-dist`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../../scripts/automation/empaquetar-director.mjs';
import { firmarPaquete, generarParClaves } from '../../../scripts/automation/firmar-paquete.mjs';
import { autorizar, iniciar, recuperar, revocar } from '../../../scripts/automation/confianza-admin.mjs';
import { claveIdDe } from '../../../scripts/automation/confianza-politica.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url)); const WEB = path.resolve(AQUI, '..', '..', '..'); const TRE = path.resolve(WEB, '..');
const V2 = path.join(TRE, 'paquetes', 'director', 'confianza-pruebas-3e8-14', 'instalacion'); const RC2 = path.join(TRE, 'paquetes', 'director', 'candidato-1.1.0-rc2-pruebas'); const F2 = path.join(TRE, 'paquetes', 'director', 'director-paquete-prueba', 'treidilor-director-1.0.0-f2.tar');
const BASH = [process.env.TAI_BASH, 'C:\\Program Files\\Git\\bin\\bash.exe', '/usr/bin/bash', '/bin/bash'].find((p) => p && fs.existsSync(p)) ?? 'bash';
const sh = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', timeout: 300000, ...o });
const hay = fs.existsSync(path.join(V2, 'instalar.sh')) && fs.existsSync(path.join(RC2, 'treidilor-director-1.1.0-rc2.tar')) && sh('docker', ['version', '--format', '{{.Server.Version}}']).status === 0 && sh(BASH, ['--version']).status === 0;
const dtest = (n, f) => test(n, { skip: !hay && 'Docker, bash o los candidatos no disponibles', timeout: 900000 }, f);
const PREFIJO = 'tai-proto-test-814-'; const dirs = []; const imagenes = new Set(); const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-i814-')); dirs.push(d); return d; };
const px = (p) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p); const hp = (p) => p.replace(/\\/g, '/');
after(() => { if (hay) for (const i of imagenes) { if (!i.startsWith(PREFIJO)) continue; const l = sh('docker', ['image', 'ls', i, '--format', '{{.Repository}}:{{.Tag}}']).stdout.split('\n').filter((x) => x.startsWith(PREFIJO)); if (l.length) sh('docker', ['rmi', '-f', ...l]); } for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const T0 = Date.now(); const DIA = 86400000;
const tarRc2 = () => fs.readFileSync(path.join(RC2, 'treidilor-director-1.1.0-rc2.tar')); const nuevaImagen = () => { const i = `${PREFIJO}${crypto.randomBytes(4).toString('hex')}`; imagenes.add(i); return i; };
const raizNueva = () => { const k = crypto.generateKeyPairSync('ed25519'); return { publica: k.publicKey.export({ type: 'spki', format: 'pem' }), privada: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };
const etiqueta = (img, t, l = 'com.treidilor.tar-sha256') => { const r = sh('docker', ['image', 'inspect', `${img}:${t}`, '--format', `{{index .Config.Labels "${l}"}}`]); return r.status === 0 ? r.stdout.trim() : null; };

/** Mundo de confianza + paquete rc2 firmado por la clave A de esa política. */
function mundo({ entorno = 'PRUEBAS', version = '1.1.0-rc2', tar = tarRc2(), base = tmp(), imagen = nuevaImagen(), desde, hasta, firmaPor = 'A' } = {}) {
  const conf = path.join(base, 'confianza'); const raiz = raizNueva(); const rp = path.join(base, 'raiz.pem'); fs.writeFileSync(rp, raiz.publica); iniciar({ dir: conf, raizPublica: rp, raizPrivada: raiz.privada, entorno, ahora: T0 - 20 * DIA });
  const A = generarParClaves(); const B = generarParClaves(); autorizar({ dir: conf, raizPrivada: raiz.privada, publica: A.publica, desde: desde ?? new Date(T0 - 10 * DIA).toISOString(), hasta: hasta ?? new Date(T0 + 300 * DIA).toISOString(), ahora: T0 - 19 * DIA });
  const pq = path.join(base, `pq-${version}`); const inst = path.join(base, `inst-${version}`); const estado = path.join(base, 'estado'); fs.mkdirSync(pq, { recursive: true }); fs.mkdirSync(estado, { recursive: true }); fs.cpSync(V2, inst, { recursive: true }); fs.writeFileSync(path.join(inst, 'VERSION'), `${version}\n`);
  const nombre = `treidilor-director-${version}.tar`; const firmar = (par, ent = entorno) => JSON.stringify(firmarPaquete({ tar, artefacto: nombre, tipo: 'director', privadaPem: par.privada, entorno: ent })); fs.writeFileSync(path.join(pq, nombre), tar); fs.writeFileSync(path.join(pq, `${nombre}.sha256`), `${sha256Hex(tar)}  ${nombre}\n`); fs.writeFileSync(path.join(pq, `${nombre}.firma.json`), firmar(firmaPor === 'B' ? B : A));
  const env = { ...process.env, TAI_DIRECTOR_IMAGEN: imagen, TAI_DIRECTOR_ESTADO: px(estado), TAI_DIRECTOR_PAQUETE: px(pq), TAI_DIRECTOR_CONFIANZA: px(conf), TAI_INSTALAR_SIN_ROOT: 'si', TAI_DIRECTOR_MODO: 'pruebas' };
  const instalar = (args = [sha256Hex(tar), '--modo', 'pruebas'], extra = {}) => sh(BASH, [px(path.join(inst, 'instalar.sh')), ...args], { env: { ...env, ...extra } }); const verificar = (extra = {}, args = []) => instalar([sha256Hex(tar), '--modo', 'pruebas', '--solo-verificar', ...args], extra); const revertir = (args = [], extra = {}) => sh(BASH, [px(path.join(inst, 'revertir.sh')), ...args], { env: { ...env, ...extra } });
  const refirmar = (par, ent) => fs.writeFileSync(path.join(pq, `${nombre}.firma.json`), firmar(par, ent));
  return { base, conf, raiz, A, B, idA: claveIdDe(A.publica), idB: claveIdDe(B.publica), pq, inst, estado, imagen, env, instalar, verificar, revertir, refirmar, nombre, tar };
}
const sinEfectos = (e) => assert.equal(sh('docker', ['image', 'ls', e.imagen, '-q']).stdout.trim() === '' && !fs.existsSync(path.join(e.estado, 'instalaciones.log')) && !fs.existsSync(path.join(e.estado, 'instalar.bloqueo')), true, 'sin imagen, sin registro y sin bloqueo');
const rechaza = (r, e, re) => { assert.notEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, re, r.stdout); sinEfectos(e); };
const leerArch = (e, n) => fs.readFileSync(path.join(e.conf, n), 'utf8');

dtest('POLÍTICA VÁLIDA · instalación completa con el script v2 (política + firma con clave autorizada + estructura + árbol + imagen); queda anotada la versión de política y la clave; --solo-verificar no construye ni activa nada', () => {
  const e = mundo(); const v = e.verificar(); assert.equal(v.status, 0, v.stdout + v.stderr); assert.match(v.stdout, /DIRECTOR_CONFIANZA_VERIFICADA modo=pruebas politica=2 clave=[0-9a-f]{16}/); assert.match(v.stdout, /DIRECTOR_VERIFICACION_COMPLETA/); sinEfectos(e);
  const r = e.instalar(); assert.equal(r.status, 0, r.stdout + r.stderr); for (const m of ['DIRECTOR_CONFIANZA_VERIFICADA', 'DIRECTOR_ARBOL_VERIFICADO', 'DIRECTOR_IMAGEN_VERIFICADA', 'DIRECTOR_INTEGRIDAD_DESACTIVADA_OK', 'DIRECTOR_INSTALADO']) assert.match(r.stdout, new RegExp(m), m);
  assert.equal(etiqueta(e.imagen, 'actual', 'com.treidilor.politica-version'), '2'); assert.equal(etiqueta(e.imagen, 'actual', 'com.treidilor.firma-claveid'), e.idA); const log = fs.readFileSync(path.join(e.estado, 'instalaciones.log'), 'utf8'); assert.match(log, /modo=pruebas clave=[0-9a-f]{16} politica=2/); assert.ok(!/PRIVATE|BEGIN|secret/i.test(log + r.stdout));
});

dtest('POLÍTICA INVÁLIDA O AUSENTE · sin política, corrupta, sin firma de la raíz, registro ausente/corrupto, raíz ausente: no se instala NADA (ni siquiera la verificación completa)', () => {
  const casos = { 'política ausente': (e) => fs.rmSync(path.join(e.conf, 'politica.json')), 'registro ausente': (e) => fs.rmSync(path.join(e.conf, 'registro-confianza.jsonl')), 'raíz ausente': (e) => fs.rmSync(path.join(e.conf, 'raiz-publica.pem')), 'raiz-id ausente': (e) => fs.rmSync(path.join(e.conf, 'raiz-id.txt')) };
  for (const [n, f] of Object.entries(casos)) { const e = mundo(); f(e); rechaza(e.instalar(), e, /falta .* en la carpeta de confianza|sin política de confianza/); }
  const m2 = { 'política no JSON': (e) => fs.writeFileSync(path.join(e.conf, 'politica.json'), '{roto'), 'política sin firma': (e) => { const p = JSON.parse(leerArch(e, 'politica.json')); delete p.firma; fs.writeFileSync(path.join(e.conf, 'politica.json'), JSON.stringify(p)); }, 'política editada (clave B añadida sin firmar)': (e) => { const p = JSON.parse(leerArch(e, 'politica.json')); p.claves.push({ ...p.claves[0], claveId: e.idB, publica: e.B.publica }); fs.writeFileSync(path.join(e.conf, 'politica.json'), JSON.stringify(p)); }, 'registro con basura': (e) => fs.appendFileSync(path.join(e.conf, 'registro-confianza.jsonl'), 'basura\n'), 'registro editado': (e) => fs.writeFileSync(path.join(e.conf, 'registro-confianza.jsonl'), leerArch(e, 'registro-confianza.jsonl').replace('alta_clave', 'revocacion')) };
  for (const [n, f] of Object.entries(m2)) { const e = mundo(); f(e); rechaza(e.instalar(), e, /la CONFIANZA no se cumple/); }
});

dtest('CLAVES · revocada, desconocida, caducada y aún no vigente se rechazan con el script real; tras revocar la clave firmante no hay forma de instalar un paquete firmado con ella', () => {
  let e = mundo({ firmaPor: 'B' }); rechaza(e.instalar(), e, /desconocida/);
  e = mundo(); revocar({ dir: e.conf, raizPrivada: e.raiz.privada, claveId: e.idA, motivo: 'A comprometida en el ensayo 814', ahora: T0 - 1 }); rechaza(e.instalar(), e, /REVOCADA/);
  e = mundo({ hasta: new Date(T0 - DIA).toISOString() }); rechaza(e.instalar(), e, /CADUCADA/); e = mundo({ desde: new Date(T0 + 5 * DIA).toISOString() }); rechaza(e.instalar(), e, /aún no vigente/);
});

dtest('ROTACIÓN · alta de B + revocación de A: lo firmado con A deja de valer, lo firmado con B vale; la versión mínima superior a la de la política rechaza una política antigua', () => {
  const e = mundo(); assert.equal(e.verificar().status, 0); autorizar({ dir: e.conf, raizPrivada: e.raiz.privada, publica: e.B.publica, hasta: new Date(T0 + 100 * DIA).toISOString(), ahora: T0 - 5 }); revocar({ dir: e.conf, raizPrivada: e.raiz.privada, claveId: e.idA, motivo: 'rotación programada en el ensayo', ahora: T0 - 4 });
  rechaza(e.verificar(), e, /REVOCADA/); e.refirmar(e.B); const v = e.verificar(); assert.equal(v.status, 0, v.stdout); assert.match(v.stdout, /politica=4 clave=/);
  rechaza(e.verificar({ TAI_CONFIANZA_VERSION_MINIMA: '9' }), e, /política ANTIGUA: versión 4 < la mínima/);
});

dtest('SUSTITUCIÓN Y RETROCESO · carpeta de confianza sustituida por otra raíz (detectada con la raíz fijada por otro canal), política antigua con el registro (detectada solo por el registro o por la versión mínima)', () => {
  const e = mundo(); const otro = mundo(); for (const n of ['raiz-publica.pem', 'raiz-id.txt', 'politica.json', 'registro-confianza.jsonl']) fs.copyFileSync(path.join(otro.conf, n), path.join(e.conf, n)); e.refirmar(otro.A);
  rechaza(e.verificar({ TAI_CONFIANZA_RAIZ_ID: claveIdDe(e.raiz.publica) }), e, /NO es la fijada por el propietario/);
  const m = mundo(); const v2 = { politica: leerArch(m, 'politica.json'), registro: leerArch(m, 'registro-confianza.jsonl') }; autorizar({ dir: m.conf, raizPrivada: m.raiz.privada, publica: m.B.publica, ahora: T0 - 5 }); revocar({ dir: m.conf, raizPrivada: m.raiz.privada, claveId: m.idA, motivo: 'A comprometida, ensayo 814 retroceso', ahora: T0 - 4 });
  fs.writeFileSync(path.join(m.conf, 'politica.json'), v2.politica); rechaza(m.verificar(), m, /política ANTIGUA respecto al registro/);
  fs.writeFileSync(path.join(m.conf, 'registro-confianza.jsonl'), v2.registro); rechaza(m.verificar({ TAI_CONFIANZA_VERSION_MINIMA: '4' }), m, /política ANTIGUA: versión 2 < la mínima/);
});

dtest('CORTE DURANTE LA ACTUALIZACIÓN DE CONFIANZA Y RECUPERACIÓN · política nueva sin anotar se acepta («pendiente»), registro por delante se rechaza; política perdida: se rechaza y solo una recuperación expresamente autorizada la restaura', () => {
  const m = mundo(); const antesReg = leerArch(m, 'registro-confianza.jsonl'); const antesPol = leerArch(m, 'politica.json'); autorizar({ dir: m.conf, raizPrivada: m.raiz.privada, publica: m.B.publica, ahora: T0 - 5 }); const copia = path.join(tmp(), 'politica-copia.json'); fs.copyFileSync(path.join(m.conf, 'politica.json'), copia);
  fs.writeFileSync(path.join(m.conf, 'registro-confianza.jsonl'), antesReg); assert.equal(m.verificar().status, 0, 'pendiente de anotar: se acepta'); fs.writeFileSync(path.join(m.conf, 'politica.json'), antesPol); fs.writeFileSync(path.join(m.conf, 'registro-confianza.jsonl'), `${antesReg}${JSON.parse('{"x":1}') && ''}`);
  const x = mundo(); autorizar({ dir: x.conf, raizPrivada: x.raiz.privada, publica: x.B.publica, ahora: T0 - 5 }); const c2 = path.join(tmp(), 'c2.json'); fs.copyFileSync(path.join(x.conf, 'politica.json'), c2); fs.rmSync(path.join(x.conf, 'politica.json')); rechaza(x.instalar(), x, /falta politica\.json/);
  assert.throws(() => recuperar({ dir: x.conf, copia: c2, versionMinima: 3, confirmo: claveIdDe(x.raiz.publica), motivo: 'corto', ahora: T0 }), /motivo/); assert.equal(fs.existsSync(path.join(x.conf, 'politica.json')), false); recuperar({ dir: x.conf, copia: c2, versionMinima: 3, confirmo: claveIdDe(x.raiz.publica), motivo: 'restauración tras pérdida en el ensayo 814', ahora: T0 - 1 });
  const v = x.verificar(); assert.equal(v.status, 0, v.stdout + v.stderr); assert.ok(copia);
});

dtest('INSTALACIÓN Y REVERSIÓN con imágenes reales y política · instalar 1.0.0-f2 → 1.1.0-rc2; revertir con política válida; con política corrupta, con la clave de la imagen anterior revocada o sin firma etiquetada se REHÚSA; los datos no se tocan', () => {
  const base = tmp(); const imagen = nuevaImagen(); const f2tar = fs.readFileSync(F2); const e = mundo({ base, imagen }); const ef2 = mundo({ base: tmp(), imagen, version: '1.0.0-f2', tar: f2tar });
  // el 1.0.0-f2 se instala con SU política (misma raíz y clave que e): copiamos la confianza de e a ef2
  for (const n of ['raiz-publica.pem', 'raiz-id.txt', 'politica.json', 'registro-confianza.jsonl']) fs.copyFileSync(path.join(e.conf, n), path.join(ef2.conf, n)); ef2.refirmar(e.A);
  const i0 = ef2.instalar(); assert.equal(i0.status, 0, i0.stdout + i0.stderr); const i1 = e.instalar(); assert.equal(i1.status, 0, i1.stdout + i1.stderr); assert.equal(etiqueta(imagen, 'anterior'), sha256Hex(f2tar)); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2()));
  const rv = e.revertir(); assert.equal(rv.status, 0, rv.stdout + rv.stderr); assert.match(rv.stdout, /DIRECTOR_REVERTIDO/); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(f2tar));
  assert.equal(e.instalar().status, 0); const pol = leerArch(e, 'politica.json'); fs.writeFileSync(path.join(e.conf, 'politica.json'), '{roto'); const rc = e.revertir(); assert.notEqual(rc.status, 0); assert.match(rc.stdout, /la CONFIANZA no permite revertir/); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2()), 'no se movió nada'); fs.writeFileSync(path.join(e.conf, 'politica.json'), pol);
  fs.rmSync(path.join(e.conf, 'registro-confianza.jsonl')); const rr = e.revertir(); assert.notEqual(rr.status, 0); assert.match(rr.stdout, /falta registro-confianza\.jsonl/);
  // la imagen anterior sin firma etiquetada: se rechaza salvo decisión expresa
  sh('docker', ['tag', 'node:22-bookworm-slim', `${imagen}:anterior`]); const e5 = mundo({ base: tmp(), imagen }); const rs = e5.revertir(); assert.notEqual(rs.status, 0); assert.match(rs.stdout, /no lleva etiqueta de firma/); const rs2 = e5.revertir([], { TAI_REVERTIR_ACEPTA_SIN_FIRMA: 'si' }); assert.notEqual(rs2.status, 0); assert.doesNotMatch(rs2.stdout, /no lleva etiqueta de firma/);
});

dtest('REVERSIÓN CON LA CLAVE DE LA IMAGEN ANTERIOR REVOCADA · la política vigente no la autoriza: no se revierte (y la imagen vigente no cambia)', () => {
  const base = tmp(); const imagen = nuevaImagen(); const e = mundo({ base, imagen }); const f2tar = fs.readFileSync(F2); const ef2 = mundo({ base: tmp(), imagen, version: '1.0.0-f2', tar: f2tar }); for (const n of ['raiz-publica.pem', 'raiz-id.txt', 'politica.json', 'registro-confianza.jsonl']) fs.copyFileSync(path.join(e.conf, n), path.join(ef2.conf, n)); ef2.refirmar(e.A);
  assert.equal(ef2.instalar().status, 0); assert.equal(e.instalar().status, 0); autorizar({ dir: e.conf, raizPrivada: e.raiz.privada, publica: e.B.publica, ahora: T0 - 3 }); revocar({ dir: e.conf, raizPrivada: e.raiz.privada, claveId: e.idA, motivo: 'A comprometida: ya no se revierte a lo firmado con ella', ahora: T0 - 2 });
  const r = e.revertir(); assert.notEqual(r.status, 0); assert.match(r.stdout, /REVOCADA/); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2()), 'la imagen vigente no cambia');
});

dtest('LINUX CON UID 0 REAL (sin red, sin docker.sock, sin privilegios) · el instalador corre como root de verdad y verifica todo salvo lo que exige el daemon; modo producción con raíz y versión fijadas; claves de pruebas rechazadas; revertir exige docker', () => {
  const base = tmp(); const e = mundo({ base, entorno: 'PRODUCCION' }); e.refirmar(e.A, 'PRODUCCION'); const raizId = claveIdDe(e.raiz.publica); const imagen = 'treidilor-director-no-existe-en-el-ensayo';
  const docker = (script, { user = null, extraEnv = {}, extraMounts = [], conf = e.conf } = {}) => sh('docker', ['run', '--rm', ...(user ? ['--user', user] : []), '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--pids-limit', '128', '--cpus', '0.5', '--tmpfs', '/tmp:size=400m,mode=1777', '-v', `${hp(e.inst)}:/inst:ro`, '-v', `${hp(e.pq)}:/pq:ro`, '-v', `${hp(conf)}:/conf:ro`, ...extraMounts, '-e', 'TAI_DIRECTOR_ESTADO=/tmp/estado', '-e', 'TAI_DIRECTOR_PAQUETE=/pq', '-e', 'TAI_DIRECTOR_CONFIANZA=/conf', '-e', `TAI_DIRECTOR_IMAGEN=${imagen}`, '-e', 'TAI_NODE_BIN=/usr/local/bin/node', ...Object.entries(extraEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]), 'node:22-bookworm-slim', 'bash', '-c', script]);
  const sha = sha256Hex(e.tar); const pins = { TAI_CONFIANZA_RAIZ_ID: raizId, TAI_CONFIANZA_VERSION_MINIMA: '2' };
  const ok = docker(`echo "uid=$(id -u)"; bash /inst/instalar.sh ${sha} --modo produccion --solo-verificar`, { extraEnv: pins }); assert.match(ok.stdout, /uid=0/); assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /DIRECTOR_CONFIANZA_VERIFICADA modo=produccion politica=2/); assert.match(ok.stdout, /DIRECTOR_VERIFICACION_COMPLETA/);
  const sin = (extra, re, modo = 'produccion') => { const r = docker(`bash /inst/instalar.sh ${sha} --modo ${modo} --solo-verificar`, { extraEnv: extra }); assert.notEqual(r.status, 0, r.stdout); assert.match(r.stdout, re, r.stdout); return r; };
  sin({ TAI_CONFIANZA_VERSION_MINIMA: '2' }, /hay que fijar TAI_CONFIANZA_RAIZ_ID/); sin({ TAI_CONFIANZA_RAIZ_ID: raizId }, /TAI_CONFIANZA_VERSION_MINIMA/); sin({ ...pins, TAI_CONFIANZA_VERSION_MINIMA: '9' }, /política ANTIGUA: versión 2 < la mínima/); sin({ ...pins, TAI_CONFIANZA_RAIZ_ID: '0'.repeat(16) }, /NO es la fijada por el propietario/);
  sin({}, /solo se admite con imágenes tai-proto-test-/, 'pruebas');
  const noroot = docker(`bash /inst/instalar.sh ${sha} --modo produccion --solo-verificar`, { user: '1000:1000', extraEnv: pins }); assert.notEqual(noroot.status, 0); assert.match(noroot.stdout, /hay que ejecutarlo como root/);
  const rv = docker('bash /inst/revertir.sh', { extraEnv: { ...pins } }); assert.notEqual(rv.status, 0); assert.match(rv.stdout, /falta docker/, 'revertir.sh necesita el daemon: PENDIENTE de un host Linux');
  const ins = docker(`bash /inst/instalar.sh ${sha} --modo produccion`, { extraEnv: pins }); assert.notEqual(ins.status, 0); assert.match(ins.stdout, /falta la utilidad «docker»/, 'la instalación completa (build, etiquetas, humo) necesita el daemon: PENDIENTE de un host Linux');
  const pruebasEnProd = mundo({ base: tmp(), entorno: 'PRUEBAS' }); const rp = docker(`bash /inst/instalar.sh ${sha} --modo produccion --solo-verificar`, { extraEnv: { TAI_CONFIANZA_RAIZ_ID: claveIdDe(pruebasEnProd.raiz.publica), TAI_CONFIANZA_VERSION_MINIMA: '2' }, conf: pruebasEnProd.conf }); assert.notEqual(rp.status, 0); assert.match(rp.stdout, /entorno PRUEBAS, no PRODUCCION/);
  const conocida = docker(`node /inst/verificar-confianza.mjs --confianza /conf --modo produccion --version-minima 2 --raiz-id ${raizId} --solo-clave 3f16a232123fa7e6`); assert.notEqual(conocida.status, 0); assert.match(conocida.stdout, /clave de PRUEBAS rechazada en modo producción/);
  const rel = docker(`bash /inst/instalar.sh ${sha} --modo produccion --solo-verificar`, { extraEnv: { ...pins, TAI_NODE_BIN: 'node' } }); assert.notEqual(rel.status, 0); assert.match(rel.stdout, /TAI_NODE_BIN debe ser una ruta absoluta/);
  const alt = docker(`bash /inst/instalar.sh ${'a'.repeat(64)} --modo produccion --solo-verificar`, { extraEnv: pins }); assert.match(alt.stdout, /NO coincide con el SHA-256 que indicaste/);
});

dtest('NADA FUERA DEL ENTORNO · el rc2, sus firmas, 1.0.0-f2 y director-dist conservan sus hashes y no queda ningún recurso Docker de esta fase', () => {
  const dd = path.join(TRE, 'treidilor-ai', 'director-dist'); assert.equal(sh('git', ['-C', dd, 'status', '--porcelain']).stdout.trim(), ''); assert.equal(sh('git', ['-C', dd, 'log', '--oneline', '-1']).stdout.slice(0, 7), 'f4e5946'); assert.equal(sha256Hex(fs.readFileSync(F2)), '95afd73764f00c247fe03736e432bcb2ced7f9d71c92a1a3c2b131d0df86bf9a');
  assert.equal(sha256Hex(tarRc2()), '8dacad109eb77a5d6f3e9cda44429ddcea1f6587a8719cfa69ad0456a463bc05'); assert.equal(sha256Hex(fs.readFileSync(path.join(RC2, 'treidilor-integridad-cli-0.1.0.tar'))), 'ce5866bf7c131defbde20ba380df94b745c17ef3a31a91b7c298dc23aa11f027');
});

/* ───────── supervivientes de la ronda de mutaciones de 3E.8.14 ───────── */
dtest('TRES CAPAS DE LA CONFIANZA (código de salida, marcador CONFIANZA_OK y lectura de la versión/clave) funcionan por separado; quitadas las tres, una clave REVOCADA pasaría (control de que no hay otra barrera)', () => {
  const e = mundo(); revocar({ dir: e.conf, raizPrivada: e.raiz.privada, claveId: e.idA, motivo: 'A comprometida, ensayo de las tres capas', ahora: T0 - 1 });
  const quitar = (a, b) => { const f = path.join(e.inst, 'instalar.sh'); const t = fs.readFileSync(f, 'utf8'); assert.ok(t.includes(a), a.slice(0, 50)); fs.writeFileSync(f, t.replace(a, () => b)); };
  const capa1 = () => quitar('--firma /v/in/firma.json 2>&1) || fallo "la CONFIANZA no se cumple', '--firma /v/in/firma.json 2>&1) || echo "la CONFIANZA no se cumple'); const capa2 = () => quitar("grep -q '^CONFIANZA_OK ' || fallo \"el verificador de confianza no devolvió CONFIANZA_OK\"", "grep -q '^CONFIANZA_OK ' || true"); const capa3 = () => quitar('[ -n "$POL_VER" ] && [ -n "$CLAVE_ID" ] || fallo "no se pudo leer la versión de política ni la clave de la salida del verificador"', 'true');
  rechaza(e.verificar(), e, /REVOCADA/); capa1(); rechaza(e.verificar(), e, /no devolvió CONFIANZA_OK/); capa2(); rechaza(e.verificar(), e, /no se pudo leer la versión de política/);
  capa3(); const v = e.verificar(); assert.equal(v.status, 0, 'sin las tres capas una clave revocada pasa: las tres son necesarias en conjunto'); assert.match(v.stdout, /DIRECTOR_VERIFICACION_COMPLETA/);
});

/* ───────── 3E.8.16 · SOLO COMO ROOT REAL (se omite en cualquier otro usuario): instalación y reversión en MODO PRODUCCIÓN con una política SINTÉTICA de entorno PRODUCCION ─────────
   Preparada para el ensayo en un host Linux de pruebas con su propio daemon (ver automation/docs/ENSAYO-LINUX-HOST-REAL.md). NO se ha ejecutado en Windows (se omite aquí). No usa la variable de «sin root». */
const esRoot = typeof process.getuid === 'function' && process.getuid() === 0;
test('PRODUCCIÓN COMPLETA COMO ROOT REAL · instalar --modo produccion con raíz y versión mínima fijadas (claves y política SINTÉTICAS), humo, integridad desactivada, y reversión en modo producción; sin los pines, nada', { skip: (!hay && 'Docker, bash o los candidatos no disponibles') || (!esRoot && 'requiere UID 0 real (host Linux de pruebas)'), timeout: 900000 }, () => {
  const base = tmp(); const imagen = nuevaImagen(); const e = mundo({ base, imagen, entorno: 'PRODUCCION' }); e.refirmar(e.A, 'PRODUCCION'); const f2tar = fs.readFileSync(F2); const ef2 = mundo({ base: tmp(), imagen, version: '1.0.0-f2', tar: f2tar, entorno: 'PRODUCCION' });
  for (const n of ['raiz-publica.pem', 'raiz-id.txt', 'politica.json', 'registro-confianza.jsonl']) fs.copyFileSync(path.join(e.conf, n), path.join(ef2.conf, n)); ef2.refirmar(e.A, 'PRODUCCION');
  const pines = { TAI_CONFIANZA_RAIZ_ID: claveIdDe(e.raiz.publica), TAI_CONFIANZA_VERSION_MINIMA: '2', TAI_INSTALAR_SIN_ROOT: '', TAI_DIRECTOR_MODO: 'produccion' }; const prod = (x, extra = {}) => x.instalar([sha256Hex(x.tar), '--modo', 'produccion'], { ...pines, ...extra });
  assert.notEqual(prod(e, { TAI_CONFIANZA_RAIZ_ID: '' }).status, 0); assert.notEqual(prod(e, { TAI_CONFIANZA_VERSION_MINIMA: '' }).status, 0); sinEfectos(e);
  const i0 = prod(ef2); assert.equal(i0.status, 0, i0.stdout + i0.stderr); const i1 = prod(e); assert.equal(i1.status, 0, i1.stdout + i1.stderr); assert.match(i1.stdout, /DIRECTOR_CONFIANZA_VERIFICADA modo=produccion politica=2/); assert.match(i1.stdout, /DIRECTOR_INTEGRIDAD_DESACTIVADA_OK/);
  assert.equal(etiqueta(imagen, 'actual', 'com.treidilor.firma-modo'), 'produccion'); const rv = e.revertir([], pines); assert.equal(rv.status, 0, rv.stdout + rv.stderr); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(f2tar));
  assert.notEqual(e.revertir([], { ...pines, TAI_CONFIANZA_VERSION_MINIMA: '9' }).status, 0, 'versión mínima superior a la política: no se revierte');
});
