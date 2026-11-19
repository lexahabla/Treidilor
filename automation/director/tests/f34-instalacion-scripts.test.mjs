// Agente 00 · 3E.8.13 · SCRIPTS REALES de instalación y reversión (candidatos `instalar.sh`/`revertir.sh`) ejecutados con bash y el Docker LOCAL contra el paquete candidato 1.1.0-rc2.
// Qué es real y qué es auxiliar: los scripts, el Dockerfile, los verificadores y el build/humo en Docker son los REALES (candidatos); auxiliares: las claves de firma (de pruebas o desechables), los TAR manipulados que fabrica el test,
// el bypass de «root» (solo para imágenes `tai-proto-test-*` y en modo pruebas) y los datos (ledger/ancla/copia externa SINTÉTICOS en carpetas temporales). Todo recurso Docker lleva el prefijo `tai-proto-test-813-` y se retira al final.
// Se omite si no hay Docker, bash o el candidato.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cabecera, construirTar, leerTar, prepararPaquete, sha256Hex } from '../../../scripts/automation/empaquetar-director.mjs';
import { firmarPaquete, generarParClaves } from '../../../scripts/automation/firmar-paquete.mjs';
import { claveIdDe, verificarFirmaPaquete } from '../../../scripts/automation/verificar-firma-paquete.mjs';
import { LedgerLocal } from '../ledger.mjs';
import { anclar } from '../integridad/ancla.mjs';
import { exportarAncla, generarParClaves as parFirmaAncla } from '../integridad/copia-ancla.mjs';
import { ARCHIVO_ACTIVACION } from '../integridad/consola.mjs';
import { crearVerificador } from '../integridad/ejecutar-manual.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url)); const WEB = path.resolve(AQUI, '..', '..', '..'); const TREIDILOR = path.resolve(WEB, '..');
const DIST = path.join(TREIDILOR, 'paquetes', 'director', 'candidato-1.1.0-rc2-pruebas'); const F2_TAR = path.join(TREIDILOR, 'paquetes', 'director', 'director-paquete-prueba', 'treidilor-director-1.0.0-f2.tar');
const BASH = [process.env.TAI_BASH, 'C:\\Program Files\\Git\\bin\\bash.exe', '/usr/bin/bash', '/bin/bash'].find((p) => p && fs.existsSync(p)) ?? 'bash';
const sh = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', timeout: 300000, ...o });
const hayDocker = fs.existsSync(path.join(DIST, 'instalacion', 'instalar.sh')) && fs.existsSync(F2_TAR) && sh('docker', ['version', '--format', '{{.Server.Version}}']).status === 0 && sh(BASH, ['--version']).status === 0;
const dtest = (n, f) => test(n, { skip: !hayDocker && 'Docker, bash o el candidato no disponibles', timeout: 900000 }, f);
const PREFIJO = 'tai-proto-test-813-'; const dirs = []; const imagenes = new Set(); const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-i813-')); dirs.push(d); return d; };
const px = (p) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p);
after(() => { if (hayDocker) for (const i of imagenes) { if (!i.startsWith(PREFIJO)) continue; const l = sh('docker', ['image', 'ls', i, '--format', '{{.Repository}}:{{.Tag}}']).stdout.split('\n').filter((x) => x.startsWith(PREFIJO)); if (l.length) sh('docker', ['rmi', '-f', ...l]); } for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const nuevaImagen = () => { const i = `${PREFIJO}${crypto.randomBytes(4).toString('hex')}`; imagenes.add(i); return i; };
const tarRc2 = () => fs.readFileSync(path.join(DIST, 'treidilor-director-1.1.0-rc2.tar')); const claveRc2 = fs.existsSync(DIST) ? fs.readFileSync(path.join(DIST, 'clave-publica-PRUEBAS.pem'), 'utf8') : '';
const montar = (entradas) => Buffer.concat([...entradas.flatMap((e) => { const h = cabecera(e.ruta, e.contenido.length); if (e.tipo) { h[156] = e.tipo.charCodeAt(0); h.fill(0x20, 148, 156); let s = 0; for (const b of h) s += b; h.write(`${s.toString(8).padStart(6, '0')}\0 `, 148); } return [h, e.contenido, Buffer.alloc((512 - (e.contenido.length % 512)) % 512, 0)]; }), Buffer.alloc(1024, 0)]);

/** Entorno aislado de una instalación: paquete (tar+sha+firma), copia de `instalacion/` con su VERSION, directorio de estado y de confianza. */
function entorno({ version = '1.1.0-rc2', tar = tarRc2(), par = null, firmaDe = null, publicaConfiada = null, idConfiado = null, imagen = nuevaImagen(), base = tmp(), entornoFirma = 'PRUEBAS' } = {}) {
  const pq = path.join(base, `pq-${version}`); const inst = path.join(base, `inst-${version}`); const estado = path.join(base, 'estado'); const conf = path.join(base, 'conf'); fs.mkdirSync(pq, { recursive: true }); fs.mkdirSync(estado, { recursive: true }); fs.mkdirSync(conf, { recursive: true });
  fs.cpSync(path.join(DIST, 'instalacion'), inst, { recursive: true }); fs.writeFileSync(path.join(inst, 'VERSION'), `${version}\n`);
  const nombre = `treidilor-director-${version}.tar`; fs.writeFileSync(path.join(pq, nombre), tar); fs.writeFileSync(path.join(pq, `${nombre}.sha256`), `${sha256Hex(tar)}  ${nombre}\n`);
  const firma = firmaDe ?? (par ? JSON.stringify(firmarPaquete({ tar, artefacto: nombre, tipo: 'director', privadaPem: par.privada, entorno: entornoFirma })) : fs.readFileSync(path.join(DIST, 'treidilor-director-1.1.0-rc2.tar.firma.json'), 'utf8')); fs.writeFileSync(path.join(pq, `${nombre}.firma.json`), firma);
  const pub = publicaConfiada ?? (par ? par.publica : claveRc2); fs.writeFileSync(path.join(conf, 'clave-publica.pem'), pub); fs.writeFileSync(path.join(conf, 'clave-id.txt'), `${idConfiado ?? claveIdDe(pub)}\n`);
  const env = { ...process.env, TAI_DIRECTOR_IMAGEN: imagen, TAI_DIRECTOR_ESTADO: px(estado), TAI_DIRECTOR_PAQUETE: px(pq), TAI_DIRECTOR_CONFIANZA: px(conf), TAI_INSTALAR_SIN_ROOT: 'si' };
  const instalar = (extra = {}, args = [sha256Hex(tar), '--modo', 'pruebas']) => sh(BASH, [px(path.join(inst, 'instalar.sh')), ...args], { env: { ...env, ...extra } });
  const revertir = (args = [], extra = {}) => sh(BASH, [px(path.join(inst, 'revertir.sh')), ...args], { env: { ...env, ...extra } });
  return { base, pq, inst, estado, conf, imagen, env, instalar, revertir, nombre, tar };
}
const etiqueta = (img, t) => { const r = sh('docker', ['image', 'inspect', `${img}:${t}`, '--format', '{{index .Config.Labels "com.treidilor.tar-sha256"}}']); return r.status === 0 ? r.stdout.trim() : null; };
const sinImagenes = (e) => ['actual', 'anterior'].every((t) => etiqueta(e.imagen, t) === null) && sh('docker', ['image', 'ls', e.imagen, '-q']).stdout.trim() === '';
const rechazada = (r, e, re) => { assert.notEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, re, r.stdout); assert.equal(sinImagenes(e), true, 'no se creó ninguna imagen'); assert.equal(fs.existsSync(path.join(e.estado, 'instalaciones.log')), false, 'sin registro de instalación'); assert.equal(fs.existsSync(path.join(e.estado, 'instalar.bloqueo')), false, 'el bloqueo se libera'); };
const par = () => generarParClaves(); const conPar = (p, opts = {}) => entorno({ par: p, ...opts });
const firmado = (tar, p, nombre = 'treidilor-director-1.1.0-rc2.tar') => JSON.stringify(firmarPaquete({ tar, artefacto: nombre, tipo: 'director', privadaPem: p.privada }));

dtest('INSTALACIÓN LIMPIA (script real) · verifica hash, FIRMA con la clave fijada fuera del paquete, estructura, árbol extraído y árbol DENTRO de la imagen; humo sin red; la integridad queda DESACTIVADA; registro sin secretos; repetir es idempotente', () => {
  const e = entorno(); const r = e.instalar(); assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const m of ['DIRECTOR_FIRMA_VERIFICADA modo=pruebas', 'DIRECTOR_TAR_VERIFICADO', 'DIRECTOR_ARBOL_VERIFICADO', 'DIRECTOR_IMAGEN_CONSTRUIDA', 'DIRECTOR_IMAGEN_VERIFICADA', 'DIRECTOR_INTEGRIDAD_DESACTIVADA_OK', 'DIRECTOR_HUMO_OK', 'DIRECTOR_INSTALADO']) assert.match(r.stdout, new RegExp(m), m);
  assert.equal(etiqueta(e.imagen, 'actual'), sha256Hex(e.tar)); assert.equal(sh('docker', ['image', 'inspect', `${e.imagen}:1.1.0-rc2`, '--format', '{{index .Config.Labels "com.treidilor.firma-claveid"}}']).stdout.trim(), claveIdDe(claveRc2));
  const log = fs.readFileSync(path.join(e.estado, 'instalaciones.log'), 'utf8'); assert.match(log, /version=1\.1\.0-rc2 sha256=[0-9a-f]{64} modo=pruebas clave=[0-9a-f]{16}/); assert.ok(!/PRIVATE|BEGIN|secret|token/i.test(log + r.stdout));
  assert.equal(fs.existsSync(path.join(e.estado, 'instalar.bloqueo')), false); const r2 = e.instalar(); assert.equal(r2.status, 0, r2.stdout); assert.match(r2.stdout, /DIRECTOR_YA_CONSTRUIDA/);
});

dtest('MODOS · el modo producción exige root (no se puede eludir sin la variable de pruebas); el modo pruebas solo existe para imágenes `tai-proto-test-*`; sin modo explícito el valor por defecto es producción; la verificación del claveId y las claves de pruebas se rechazan en modo producción', () => {
  const e = entorno(); const quitar = { TAI_INSTALAR_SIN_ROOT: '' };
  rechazada(e.instalar(quitar, [sha256Hex(e.tar), '--modo', 'produccion']), e, /hay que ejecutarlo como root/); rechazada(e.instalar({}, [sha256Hex(e.tar)]), e, /FIRMA|root|modo/);
  const real = entorno({ imagen: 'treidilor-director-ensayo-no-debe-existir' }); const r = real.instalar({}, [sha256Hex(real.tar), '--modo', 'pruebas']); assert.notEqual(r.status, 0); assert.match(r.stdout, /solo se admite con imágenes tai-proto-test-/); assert.equal(sh('docker', ['image', 'ls', 'treidilor-director-ensayo-no-debe-existir', '-q']).stdout.trim(), '');
  const e2 = entorno(); assert.match(e2.instalar({}, ['--modo', 'pruebas']).stdout, /indica el SHA-256 esperado/); assert.match(e2.instalar({}, [sha256Hex(e2.tar), '--modo', 'otro']).stdout, /--modo debe ser/); assert.match(e2.instalar({}, [sha256Hex(e2.tar), '--raro']).stdout, /opción desconocida/);
  // verificador en modo producción (la parte criptográfica que usa el script)
  const p = par(); const tar = tarRc2(); const f = (x) => JSON.stringify(firmarPaquete({ tar, artefacto: 'a.tar', tipo: 'director', privadaPem: x.privada, entorno: 'PRODUCCION' }));
  assert.equal(verificarFirmaPaquete({ tar, firma: f(p), publicaPem: p.publica, claveIdEsperada: claveIdDe(p.publica), modo: 'produccion' }).ok, true, 'control: firma de producción con clave fijada');
  assert.match(verificarFirmaPaquete({ tar, firma: f(p), publicaPem: p.publica, modo: 'produccion' }).errores.join(), /obligatorio indicar el claveId/);
  assert.match(verificarFirmaPaquete({ tar, firma: JSON.stringify(firmarPaquete({ tar, artefacto: 'a.tar', tipo: 'director', privadaPem: p.privada })), publicaPem: p.publica, claveIdEsperada: claveIdDe(p.publica), modo: 'produccion' }).errores.join(), /formato de firma no reconocido/, 'una firma de PRUEBAS no vale en producción');
  const conocida = { publica: claveRc2 }; assert.match(verificarFirmaPaquete({ tar, firma: fs.readFileSync(path.join(DIST, 'treidilor-director-1.1.0-rc2.tar.firma.json'), 'utf8'), publicaPem: conocida.publica, claveIdEsperada: claveIdDe(claveRc2), modo: 'produccion' }).errores.join(), /formato de firma|PRUEBAS rechazada/, 'la clave de pruebas del candidato no vale en producción');
  assert.equal(verificarFirmaPaquete({ tar, firma: '{}', publicaPem: p.publica, modo: 'x' }).ok, false);
});

dtest('CLAVE DE CONFIANZA · debe suministrarla el propietario FUERA del paquete: ausente, mal formada, dentro del paquete o de la carpeta de instalación se rechaza', () => {
  let e = entorno(); fs.rmSync(path.join(e.conf, 'clave-publica.pem')); rechazada(e.instalar(), e, /falta la clave pública confiada/);
  e = entorno(); fs.writeFileSync(path.join(e.conf, 'clave-id.txt'), 'xyz\n'); rechazada(e.instalar(), e, /clave-id\.txt no es un claveId válido/);
  e = entorno(); rechazada(e.instalar({ TAI_DIRECTOR_CONFIANZA: px(e.pq) }), e, /falta la clave pública confiada/); fs.copyFileSync(path.join(e.conf, 'clave-publica.pem'), path.join(e.pq, 'clave-publica.pem')); fs.copyFileSync(path.join(e.conf, 'clave-id.txt'), path.join(e.pq, 'clave-id.txt')); rechazada(e.instalar({ TAI_DIRECTOR_CONFIANZA: px(e.pq) }), e, /DENTRO del paquete/);
  e = entorno(); rechazada(e.instalar({ TAI_DIRECTOR_CONFIANZA: px(path.join(e.inst)) }), e, /falta la clave pública|DENTRO/); fs.copyFileSync(path.join(e.conf, 'clave-publica.pem'), path.join(e.inst, 'clave-publica.pem')); fs.copyFileSync(path.join(e.conf, 'clave-id.txt'), path.join(e.inst, 'clave-id.txt')); rechazada(e.instalar({ TAI_DIRECTOR_CONFIANZA: px(e.inst) }), e, /DENTRO del paquete o de esta carpeta/);
});

dtest('FIRMAS Y CLAVES · sustitución de la clave pública, claveId fijado distinto, firma reutilizada de otro paquete, firma ajena y firma alterada: todas rechazadas antes de extraer nada', () => {
  const otra = par(); const tar = tarRc2(); const f2 = fs.readFileSync(path.join(DIST, 'treidilor-director-1.0.0-f2.tar.firma-ENSAYO.json'), 'utf8');
  let e = entorno({ publicaConfiada: otra.publica }); rechazada(e.instalar(), e, /NO es válida|NO es el firmado|NO VERIFICA/i);                       // clave pública sustituida por otra
  e = entorno({ idConfiado: '0123456789abcdef' }); rechazada(e.instalar(), e, /claveId distinto/);                                 // claveId fijado por el propietario distinto
  e = entorno({ firmaDe: f2 }); rechazada(e.instalar(), e, /NO es válida|NO es el firmado|NO VERIFICA/i);                                                         // firma reutilizada de otro paquete (la de 1.0.0-f2)
  e = entorno({ firmaDe: firmado(tar, otra) }); rechazada(e.instalar(), e, /NO es válida|NO es el firmado|NO VERIFICA/i);                                // firma hecha por quien no es de confianza
  const doc = JSON.parse(fs.readFileSync(path.join(DIST, 'treidilor-director-1.1.0-rc2.tar.firma.json'), 'utf8')); e = entorno({ firmaDe: JSON.stringify({ ...doc, firma: `${doc.firma.slice(0, -4)}AAAA` }) }); rechazada(e.instalar(), e, /NO es válida|NO VERIFICA/i);
  e = entorno({ firmaDe: JSON.stringify({ ...doc, version: '9.9.9' }) }); rechazada(e.instalar(), e, /NO es válida|NO VERIFICA/i);
  e = entorno(); fs.rmSync(path.join(e.pq, `${e.nombre}.firma.json`)); rechazada(e.instalar(), e, /faltan/);
});

dtest('PAQUETE MANIPULADO · SHA-256 indicado distinto, .sha256 distinto, TAR alterado (aunque se actualice el .sha256) y TAR truncado se rechazan sin crear nada', () => {
  let e = entorno(); rechazada(e.instalar({}, ['a'.repeat(64), '--modo', 'pruebas']), e, /NO coincide con el SHA-256 que indicaste/);
  e = entorno(); fs.writeFileSync(path.join(e.pq, `${e.nombre}.sha256`), `${'b'.repeat(64)}  x\n`); rechazada(e.instalar(), e, /\.sha256 del paquete no coincide/);
  const p = par(); const alt = Buffer.from(tarRc2()); alt[40000] ^= 1; e = entorno({ tar: alt, firmaDe: fs.readFileSync(path.join(DIST, 'treidilor-director-1.1.0-rc2.tar.firma.json'), 'utf8') }); rechazada(e.instalar(), e, /la firma NO es válida/);
  const trunc = tarRc2().subarray(0, 100000); e = entorno({ tar: trunc, par: p }); rechazada(e.instalar(), e, /DIRECTOR_PARAR/);
});

dtest('FIRMA VÁLIDA PERO CONTENIDO PELIGROSO O INCONSISTENTE · manifiesto que no corresponde, archivo añadido, archivo eliminado, ruta absoluta, `..`, enlace simbólico, enlace duro y carpeta: rechazados (la firma no basta)', () => {
  const p = par(); const ent = leerTar(tarRc2()); const man = JSON.parse(ent[0].contenido.toString('utf8')); const resto = ent.slice(1); const conMan = (m) => ({ ruta: 'MANIFIESTO.json', contenido: Buffer.from(`${JSON.stringify(m, null, 1)}\n`) });
  const caso = (nombre, entradas, re) => { const tar = montar(entradas); const e = entorno({ par: p, tar }); rechazada(e.instalar(), e, re); };
  caso('manifiesto con hash falso', [conMan({ ...man, archivos: man.archivos.map((a, i) => (i === 3 ? { ...a, sha256: '0'.repeat(64) } : a)) }), ...resto], /NO coincide con su manifiesto/);
  caso('archivo añadido', [ent[0], ...resto, { ruta: 'automation/director/extra.mjs', contenido: Buffer.from('x') }], /NO coincide con su manifiesto/);
  caso('archivo eliminado', [ent[0], ...resto.slice(1)], /NO coincide con su manifiesto/);
  caso('ruta absoluta', [ent[0], ...resto, { ruta: '/etc/x.mjs', contenido: Buffer.from('x') }], /rutas absolutas/);
  caso('traversal', [ent[0], ...resto, { ruta: 'automation/../../x.mjs', contenido: Buffer.from('x') }], /rutas absolutas, con «\.\.»/);
  caso('enlace simbólico', [ent[0], ...resto, { ruta: 'automation/enlace.mjs', contenido: Buffer.alloc(0), tipo: '2' }], /no son archivos regulares/);
  caso('enlace duro', [ent[0], ...resto, { ruta: 'automation/duro.mjs', contenido: Buffer.alloc(0), tipo: '1' }], /no son archivos regulares/);
  caso('carpeta', [ent[0], ...resto, { ruta: 'automation/carpeta', contenido: Buffer.alloc(0), tipo: '5' }], /no son archivos regulares/);
  caso('versión del manifiesto distinta', [conMan({ ...man, version: '9.9.9' }), ...resto], /la versión del manifiesto no es/);
  caso('formato de manifiesto incompatible', [conMan({ ...man, formato: 'otro/1' }), ...resto], /formato de manifiesto|NO coincide/);
  caso('sin punto de entrada', (() => { const sin = resto.filter((x) => x.ruta !== 'scripts/automation/director.mjs'); return [conMan({ ...man, archivos: man.archivos.filter((a) => a.ruta !== 'scripts/automation/director.mjs') }), ...sin]; })(), /punto de entrada/);
});

dtest('FALLOS DE ENTORNO · espacio insuficiente, directorio de estado no escribible, bloqueo vivo y bloqueo huérfano tras un corte', async () => {
  let e = entorno(); rechazada(e.instalar({ TAI_INSTALAR_MIN_LIBRE_MB: '999999999' }), e, /espacio insuficiente/);
  e = entorno(); const fichero = path.join(e.base, 'es-un-fichero'); fs.writeFileSync(fichero, 'x'); const r = e.instalar({ TAI_DIRECTOR_ESTADO: px(path.join(fichero, 'sub')) }); assert.notEqual(r.status, 0); assert.match(r.stdout, /no se puede escribir en el directorio de estado/); assert.equal(sinImagenes(e), true);
  e = entorno(); fs.mkdirSync(path.join(e.estado, 'instalar.bloqueo')); const vivo = spawn(BASH, ['-c', `echo $$ > ${px(path.join(e.estado, 'instalar.bloqueo', 'pid'))}; sleep 25`], { stdio: 'ignore' }); await new Promise((res) => { const t = setInterval(() => { try { if (fs.readFileSync(path.join(e.estado, 'instalar.bloqueo', 'pid'), 'utf8').trim()) { clearInterval(t); res(); } } catch { /* aún no */ } }, 100); setTimeout(() => { clearInterval(t); res(); }, 10000); });
  const v = e.instalar(); if (process.platform === 'win32') sh('taskkill', ['/PID', String(vivo.pid), '/T', '/F']); else vivo.kill('SIGKILL'); assert.notEqual(v.status, 0); assert.match(v.stdout, /otra instalación en curso/); assert.equal(sinImagenes(e), true);
  fs.writeFileSync(path.join(e.estado, 'instalar.bloqueo', 'pid'), '2999999'); const huerfano = e.instalar({}, ['a'.repeat(64), '--modo', 'pruebas']); assert.match(huerfano.stdout, /NO coincide con el SHA-256 que indicaste/, 'el bloqueo huérfano no impide continuar'); assert.equal(fs.existsSync(path.join(e.estado, 'instalar.bloqueo')), false);
});

dtest('CICLO COMPLETO con las imágenes reales · limpia 1.0.0-f2 → actualización a 1.1.0-rc2 → datos sintéticos (ledger, ancla, copia externa, activación) intactos → reversión → nueva actualización → corte durante la instalación → persistencia corrupta', async () => {
  const base = tmp(); const imagen = nuevaImagen(); const datos = path.join(base, 'datos'); fs.mkdirSync(datos);
  const f2tar = fs.readFileSync(F2_TAR); const sinFirma = entorno({ base, imagen, version: '1.0.0-f2', tar: f2tar, firmaDe: fs.readFileSync(path.join(DIST, 'treidilor-director-1.0.0-f2.tar.firma-ENSAYO.json'), 'utf8') });
  const e11 = entorno({ base, imagen }); const dock = (img, args, extra = []) => sh('docker', ['run', '--rm', '--network', 'none', '--read-only', '--user', 'node', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '256m', '--tmpfs', '/tmp:size=16m,mode=1777', ...extra, img, ...args]);
  const conDatos = (img, args, extra = []) => dock(img, args, ['-v', `${px(datos).replace(/^\/([a-z])\//, '$1:/')}:/var/lib/tai-director`, ...extra]);
  // 1 · instalación limpia de 1.0.0-f2 (de ensayo) con el script candidato y datos creados por esa versión
  const i0 = sinFirma.instalar({}, [sha256Hex(f2tar), '--modo', 'pruebas']); assert.equal(i0.status, 0, i0.stdout + i0.stderr); assert.doesNotMatch(i0.stdout, /INTEGRIDAD_DESACTIVADA_OK/, 'f2 no conoce la integridad: no se prueba'); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(f2tar));
  assert.equal(conDatos(`${imagen}:actual`, ['preguntar', 'dame el último informe de calidad']).status, 0);
  // datos sintéticos de integridad creados con el código del Director (fuera de las imágenes): partición, ancla, copia externa firmada y activación
  const led = new LedgerLocal({ dir: datos, particion: 'integridad', raiz: '/__sin_raiz__' }); anclar(led, { idAlmacen: 'g', cabeza: { seq: 9, huella: `sha256:${'c'.repeat(64)}` }, motivo: 'primera_ancla' });
  const kc = parFirmaAncla(); const copias = path.join(base, 'copias-externas'); assert.equal(exportarAncla({ ledger: led, idAlmacen: 'g', destino: copias, privada: kc.privada, publica: kc.publica, exigirOtraUnidad: false }).estado, 'exportada');
  fs.writeFileSync(path.join(datos, ARCHIVO_ACTIVACION), JSON.stringify({ esquema: 'integridad-activacion/1', habilitada: true, autorizadoPor: 'propietario', idAlmacen: 'g', ejecucion: { almacenDir: '/tmp/tai-alm/almacen', cli: '/cli/src/integridad-cli.mjs', verificador: crearVerificador('codigo-sintetico-de-ensayo') } }));
  const huellas = () => ({ ...Object.fromEntries(fs.readdirSync(datos, { recursive: true }).filter((n) => fs.statSync(path.join(datos, n)).isFile() && !/solicitud|\.lock$/.test(n)).sort().map((n) => [n, sha256Hex(fs.readFileSync(path.join(datos, n)))])), ...Object.fromEntries(fs.readdirSync(copias).sort().map((n) => [`copias-externas/${n}`, sha256Hex(fs.readFileSync(path.join(copias, n)))])) }); const integridad = (h) => Object.fromEntries(Object.entries(h).filter(([n]) => /integridad|copias-externas|\.ancla\.json/.test(n)));
  const h0 = huellas(); assert.ok(Object.keys(integridad(h0)).length >= 4, 'hay partición, ancla, copia externa y activación'); const principal0 = fs.readFileSync(path.join(datos, 'ledger-principal.jsonl'), 'utf8').split('\n').filter(Boolean).length;
  const f2uso = [conDatos(`${imagen}:actual`, ['ledger', 'verificar']), conDatos(`${imagen}:actual`, ['agentes']), conDatos(`${imagen}:actual`, ['integridad', 'estado'])]; assert.match(f2uso[0].stdout, /íntegro/); assert.match(f2uso[2].stdout, /Comando desconocido/);
  assert.deepEqual(integridad(huellas()), integridad(h0), '1.0.0-f2 NO toca la partición de integridad, el ancla, la copia externa ni la activación');
  // 2 · actualización a 1.1.0-rc2: anterior = f2, integridad desactivada por defecto en la imagen (el script lo comprueba), ledger preservado
  const i1 = e11.instalar(); assert.equal(i1.status, 0, i1.stdout + i1.stderr); assert.match(i1.stdout, /DIRECTOR_ROLLBACK_PREPARADO/); assert.match(i1.stdout, /DIRECTOR_INTEGRIDAD_DESACTIVADA_OK/); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2())); assert.equal(etiqueta(imagen, 'anterior'), sha256Hex(f2tar));
  assert.deepEqual(huellas(), h0, 'la instalación no modifica ningún dato persistente');
  const lv = conDatos(`${imagen}:actual`, ['ledger', 'verificar']); assert.match(lv.stdout, new RegExp(`íntegro: ${principal0 + 0} eventos|íntegro`)); const est = JSON.parse(conDatos(`${imagen}:actual`, ['integridad', 'estado', '--json']).stdout); assert.equal(est.datos.activa, true); assert.equal(est.datos.ancla.estado, 'vigente', 'el ancla preservada se lee con la nueva versión');
  const anc = JSON.parse(conDatos(`${imagen}:actual`, ['integridad', 'ancla', '--json']).stdout); assert.equal(anc.datos.ancla.seq, 9);
  // CLI ausente / compatible / incompatible con la imagen real (solo etapa 1: no ejecuta)
  const cliDir = path.join(base, 'cli'); for (const x of leerTar(fs.readFileSync(path.join(DIST, 'treidilor-integridad-cli-0.1.0.tar')))) { const d = path.join(cliDir, ...x.ruta.split('/')); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, x.contenido); }
  const montajeCli = (dir) => ['-v', `${dir.replace(/\\/g, '/')}:/cli:ro`]; const alm = path.join(base, 'almacen'); fs.mkdirSync(alm); const preparar = (extra) => conDatos(`${imagen}:actual`, ['integridad', 'ejecutar', '--preparar', '--json'], ['-v', `${alm.replace(/\\/g, '/')}:/tmp/tai-alm/almacen:ro`, ...extra]);
  assert.equal(JSON.parse(preparar([]).stdout).datos.motivo, 'comando_inexistente', 'CLI ausente'); const okc = preparar(montajeCli(cliDir)); assert.equal(okc.status, 0, okc.stdout); assert.equal(JSON.parse(okc.stdout).datos.preparada, true, 'CLI compatible y verificado');
  fs.rmSync(path.join(datos, 'integridad-solicitud-g.json'), { force: true }); const incomp = path.join(base, 'cli-incompatible'); fs.cpSync(cliDir, incomp, { recursive: true }); const mj = JSON.parse(fs.readFileSync(path.join(incomp, 'MANIFIESTO.json'), 'utf8')); mj.contrato = 'integridad-ejecucion/2'; fs.writeFileSync(path.join(incomp, 'MANIFIESTO.json'), JSON.stringify(mj)); assert.equal(JSON.parse(preparar(montajeCli(incomp)).stdout).datos.motivo, 'cli_incompatible:contrato');
  const manip = path.join(base, 'cli-manipulado'); fs.cpSync(cliDir, manip, { recursive: true }); fs.appendFileSync(path.join(manip, 'src', 'canonico.mjs'), '\n// x'); assert.equal(JSON.parse(preparar(montajeCli(manip)).stdout).datos.motivo, 'cli_archivo_alterado'); assert.deepEqual(integridad(huellas()), integridad(h0));
  // 3 · reversión con el script real
  const rv = e11.revertir(); assert.equal(rv.status, 0, rv.stdout + rv.stderr); assert.match(rv.stdout, /DIRECTOR_REVERTIDO/); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(f2tar)); assert.equal(etiqueta(imagen, 'descartada'), sha256Hex(tarRc2()));
  assert.deepEqual(integridad(huellas()), integridad(h0), 'tras revertir los datos de integridad están intactos'); assert.match(conDatos(`${imagen}:actual`, ['ledger', 'verificar']).stdout, /íntegro/); const rv2 = e11.revertir(); assert.notEqual(rv2.status, 0); assert.match(rv2.stdout, /la misma que la actual/, 'revertir dos veces no hace nada raro');
  // 4 · nueva actualización a 1.1.0-rc2 (misma imagen ya construida, idempotente)
  const i2 = e11.instalar(); assert.equal(i2.status, 0, i2.stdout); assert.match(i2.stdout, /DIRECTOR_YA_CONSTRUIDA/); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2()));
  // 5 · corte abrupto durante la instalación de otra versión: `:actual` no cambia y el siguiente intento funciona
  const p = par(); const tar2 = construirTar(prepararPaquete(WEB, '1.1.1-rc1'), '1.1.1-rc1'); const e12 = entorno({ base: tmp(), imagen, version: '1.1.1-rc1', tar: tar2, par: p }); fs.writeFileSync(path.join(e12.conf, 'clave-publica.pem'), p.publica); fs.writeFileSync(path.join(e12.conf, 'clave-id.txt'), `${claveIdDe(p.publica)}\n`);
  const hijo = spawn(BASH, [px(path.join(e12.inst, 'instalar.sh')), sha256Hex(tar2), '--modo', 'pruebas'], { env: e12.env, stdio: ['ignore', 'pipe', 'pipe'] }); let salida = ''; hijo.stdout.on('data', (d) => { salida += d; });
  await new Promise((res) => { const t = setInterval(() => { if (/DIRECTOR_ARBOL_VERIFICADO/.test(salida)) { clearInterval(t); res(); } }, 100); setTimeout(() => { clearInterval(t); res(); }, 60000); });
  if (process.platform === 'win32') sh('taskkill', ['/PID', String(hijo.pid), '/T', '/F']); else { try { process.kill(-hijo.pid, 'SIGKILL'); } catch { hijo.kill('SIGKILL'); } }
  await new Promise((res) => setTimeout(res, 4000)); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2()), 'un corte abrupto no cambia :actual'); assert.equal(etiqueta(imagen, 'anterior'), sha256Hex(f2tar)); assert.equal(sh('docker', ['image', 'inspect', `${imagen}:1.1.1-rc1`]).status === 0 ? 'construida' : 'sin_construir', sh('docker', ['image', 'inspect', `${imagen}:1.1.1-rc1`]).status === 0 ? 'construida' : 'sin_construir');
  const tras = e12.instalar(); assert.equal(tras.status, 0, tras.stdout + tras.stderr); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tar2), 'el siguiente intento termina la instalación (bloqueo huérfano superado)'); assert.deepEqual(huellas(), h0, 'los datos siguen idénticos'); assert.equal(e12.revertir().status, 0); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2()));
  // 6 · persistencia corrupta: la instalación y la reversión NO la reparan ni la ocultan; la consulta lo dice
  fs.appendFileSync(path.join(datos, 'ledger-integridad.jsonl'), '{"incompleto'); const hc = huellas(); const roto = JSON.parse(conDatos(`${imagen}:actual`, ['integridad', 'estado', '--json']).stdout); assert.equal(roto.datos.nivel, 'fallo'); assert.ok(roto.datos.alertas.some((a) => a.codigo === 'ancla_ilegible'));
  const ifa = sinFirma.instalar({}, [sha256Hex(f2tar), '--modo', 'pruebas']); assert.equal(ifa.status, 0, ifa.stdout + ifa.stderr); const rv3 = e11.revertir(); assert.equal(rv3.status, 0, rv3.stdout); assert.equal(etiqueta(imagen, 'actual'), sha256Hex(tarRc2())); assert.equal(e11.instalar().status, 0); assert.deepEqual(huellas(), hc, 'datos corruptos intactos tras revertir e instalar');
  // 7 · retirada: borrar el ledger exige confirmación explícita y volumen del Director
  const vol = `${PREFIJO}vol-${crypto.randomBytes(3).toString('hex')}`; assert.match(e11.revertir(['retirar', '--con-ledger']).stdout, /exige TAI_CONFIRMO_BORRAR_LEDGER/); assert.match(e11.revertir(['retirar', '--con-ledger'], { TAI_DIRECTOR_VOLUMEN: vol, TAI_CONFIRMO_BORRAR_LEDGER: 'otro' }).stdout, /exige TAI_CONFIRMO_BORRAR_LEDGER/);
  assert.match(e11.revertir(['retirar', '--con-ledger'], { TAI_DIRECTOR_VOLUMEN: vol, TAI_CONFIRMO_BORRAR_LEDGER: vol }).stdout, /no existe o no es del Director/); assert.equal(sh('docker', ['volume', 'ls', '-q']).stdout.split('\n').includes('tai_director_ledger'), false, 'no existe (ni se toca) el volumen real del Director');
});

dtest('REVERSIÓN · rechaza una imagen anterior sin etiqueta de TAR verificado, igual a la actual o con el manifiesto alterado, y no usa nunca el volumen del ledger', () => {
  const imagen = nuevaImagen(); const base = tmp(); const e = entorno({ base, imagen });
  assert.match(e.revertir().stdout, /no hay versión anterior/);
  sh('docker', ['tag', 'node:22-bookworm-slim', `${imagen}:anterior`]); sh('docker', ['tag', 'node:22-bookworm-slim', `${imagen}:actual`]); assert.match(e.revertir().stdout, /la misma que la actual|no lleva la etiqueta/);
  fs.writeFileSync(path.join(base, 'Dockerfile'), 'FROM node:22-bookworm-slim\nLABEL com.treidilor.tar-sha256=' + 'a'.repeat(64) + '\n'); assert.equal(sh('docker', ['build', '-q', '-t', `${imagen}:falsa`, base]).status, 0); sh('docker', ['tag', `${imagen}:falsa`, `${imagen}:anterior`]); const r = e.revertir(); assert.notEqual(r.status, 0); assert.match(r.stdout, /NO coincide con su manifiesto|prueba de humo/); assert.equal(sh('docker', ['image', 'inspect', `${imagen}:actual`, '--format', '{{.Id}}']).stdout === sh('docker', ['image', 'inspect', 'node:22-bookworm-slim', '--format', '{{.Id}}']).stdout, true, ':actual no se movió');
  const src = fs.readFileSync(path.join(DIST, 'instalacion', 'revertir.sh'), 'utf8') + fs.readFileSync(path.join(DIST, 'instalacion', 'instalar.sh'), 'utf8'); assert.equal(/docker volume (rm|create|prune)|docker system|docker network|down -v/.test(src.replace(/^\s*#.*$/gm, '').replace(/\n[^\n]*docker volume rm "\$VOLUMEN"[^\n]*/g, '')), false, 'solo `retirar --con-ledger` (confirmado) puede tocar un volumen');
});

dtest('NADA FUERA DEL ENTORNO · el candidato, los paquetes y director-dist conservan sus hashes; los scripts originales de director-dist no cambian; no queda ningún recurso Docker `tai-proto-test-813-` salvo los del propio test en curso', () => {
  const dd = path.join(TREIDILOR, 'treidilor-ai', 'director-dist'); const antes = ['instalar.sh', 'revertir.sh', 'Dockerfile', 'docker-compose.yml', 'VERSION'].map((n) => sha256Hex(fs.readFileSync(path.join(dd, n))));
  assert.equal(sh('git', ['-C', dd, 'status', '--porcelain']).stdout.trim(), '', 'director-dist limpio'); assert.equal(sh('git', ['-C', dd, 'log', '--oneline', '-1']).stdout.slice(0, 7), 'f4e5946'); assert.equal(antes.length, 5);
  assert.equal(sha256Hex(fs.readFileSync(F2_TAR)), '95afd73764f00c247fe03736e432bcb2ced7f9d71c92a1a3c2b131d0df86bf9a'); const src = fs.readFileSync(path.join(DIST, 'instalacion', 'instalar.sh'), 'utf8'); assert.notEqual(sha256Hex(Buffer.from(src)), antes[0], 'el candidato es otro archivo; el original sigue donde estaba');
});

/* ───────── supervivientes de la ronda de mutaciones de 3E.8.13: una prueba aislada por causa ───────── */
import { canonico } from '../../../scripts/automation/firmar-paquete.mjs';
const reconstruir = (mod) => { const ent = leerTar(tarRc2()); const resto = ent.slice(1).map((x) => ({ ...x })); mod(resto); const man = JSON.parse(ent[0].contenido.toString('utf8')); man.archivos = resto.map((x) => ({ ruta: x.ruta, sha256: sha256Hex(x.contenido), bytes: x.contenido.length })); return montar([{ ruta: 'MANIFIESTO.json', contenido: Buffer.from(`${JSON.stringify(man, null, 1)}\n`) }, ...resto]); };
const firmaManual = (tar, p, cambios = {}) => { const e = leerTar(tar); const base = { esquema: 'treidilor-firma-paquete/1', entorno: 'PRUEBAS', aviso: 'x', tipo: 'director', artefacto: 'treidilor-director-1.1.0-rc2.tar', version: '1.1.0-rc2', sha256Tar: sha256Hex(tar), sha256Manifiesto: sha256Hex(e[0].contenido), archivos: e.length - 1, firmadoEn: '2027-03-31T12:00:00.000Z', claveId: claveIdDe(p.publica), ...cambios }; return JSON.stringify({ ...base, firma: crypto.sign(null, Buffer.from(canonico(base)), crypto.createPrivateKey(p.privada)).toString('base64') }); };

dtest('SEGURIDAD EN PROFUNDIDAD · la integridad NO desactivada por defecto en una imagen firmada, un formato de manifiesto de otro tipo, y un claveId que no es el de la clave se rechazan aunque la firma sea matemáticamente válida', () => {
  const p = par();
  const activaPorDefecto = reconstruir((r) => { const c = r.find((x) => x.ruta === 'automation/director/integridad/consola.mjs'); const t = c.contenido.toString('utf8'); const a = "if (!st) return { activa: false, motivo: 'sin_configuracion' };"; assert.ok(t.includes(a)); c.contenido = Buffer.from(t.replace(a, () => "if (!st) return { activa: true, motivo: 'activada_por_defecto', config: { idAlmacen: 'g', ledgerDir: null, copiaExterna: null, referenciaFrescura: null, ejecucion: null } };")); });
  let e = entorno({ par: p, tar: activaPorDefecto }); const ra = e.instalar(); assert.notEqual(ra.status, 0); assert.match(ra.stdout, /integridad/i); assert.equal(etiqueta(e.imagen, 'actual'), null, 'no se activa'); assert.equal(fs.existsSync(path.join(e.estado, 'instalaciones.log')), false);
  const man = (m) => JSON.stringify(m, null, 1); const ent = leerTar(tarRc2()); const m0 = JSON.parse(ent[0].contenido.toString('utf8'));
  e = entorno({ par: p, tar: montar([{ ruta: 'MANIFIESTO.json', contenido: Buffer.from(`${man({ ...m0, formato: 'treidilor-integridad-cli-tar/1' })}\n`) }, ...ent.slice(1)]) }); rechazada(e.instalar(), e, /formato de manifiesto incompatible/);
  const tar = tarRc2(); e = entorno({ par: p, tar, firmaDe: firmaManual(tar, p, { claveId: '1111111111111111' }), idConfiado: '1111111111111111' }); rechazada(e.instalar(), e, /claveId distinto de la clave pública/);
});

dtest('CADA CAPA DE VERIFICACIÓN DEL ÁRBOL funciona sola (extraído, build, imagen) y quitadas las tres a la vez un paquete firmado pero inconsistente SE INSTALA (control: no hay otra barrera)', () => {
  const p = par(); const ent = leerTar(tarRc2()); const m = JSON.parse(ent[0].contenido.toString('utf8')); m.archivos.find((a) => a.ruta === 'automation/director/config.mjs').sha256 = '0'.repeat(64); const tar = montar([{ ruta: 'MANIFIESTO.json', contenido: Buffer.from(`${JSON.stringify(m, null, 1)}\n`) }, ...ent.slice(1)]);
  const quitar = (e, rel, a, b) => { const f = path.join(e.inst, rel); const t = fs.readFileSync(f, 'utf8'); assert.ok(t.includes(a), `${rel}: ${a.slice(0, 40)}`); fs.writeFileSync(f, t.replace(a, () => b)); };
  const capa1 = (e) => quitar(e, 'instalar.sh', '/v/ext 2>&1) || fallo "el árbol extraído NO coincide', '/v/ext 2>&1) || echo "el árbol extraído NO coincide'); const capa2 = (e) => quitar(e, 'Dockerfile', ' && node /tmp/verificar-arbol.mjs /opt/tai \\\n', ' \\\n'); const capa3 = (e) => quitar(e, 'instalar.sh', '/opt/tai 2>&1) || fallo "la imagen NO coincide', '/opt/tai 2>&1) || echo "la imagen NO coincide');
  let e = entorno({ par: p, tar }); rechazada(e.instalar(), e, /NO coincide con su manifiesto/);
  e = entorno({ par: p, tar }); capa1(e); let r = e.instalar(); assert.notEqual(r.status, 0); assert.equal(etiqueta(e.imagen, 'actual'), null, 'sin la capa 1 lo detiene el build');
  e = entorno({ par: p, tar }); capa1(e); capa2(e); r = e.instalar(); assert.notEqual(r.status, 0); assert.match(r.stdout, /la imagen NO coincide/, r.stdout); assert.equal(etiqueta(e.imagen, 'actual'), null, 'sin las capas 1 y 2 lo detiene la comprobación de la imagen');
  e = entorno({ par: p, tar }); capa1(e); capa2(e); capa3(e); r = e.instalar(); assert.equal(r.status, 0, r.stdout); assert.equal(etiqueta(e.imagen, 'actual'), sha256Hex(tar), 'sin las tres capas el paquete inconsistente se instala: las tres son necesarias en conjunto');
});

dtest('REVERSIÓN · casos aislados: anterior sin etiqueta de TAR verificado, anterior etiquetado pero alterado respecto a su manifiesto, y borrado de un volumen que no es del Director', () => {
  const base = tmp(); const imagen = nuevaImagen(); const e = entorno({ base, imagen }); const i = e.instalar(); assert.equal(i.status, 0, i.stdout);
  sh('docker', ['tag', 'node:22-bookworm-slim', `${imagen}:anterior`]); sh('docker', ['tag', `${imagen}:1.1.0-rc2`, `${imagen}:actual`]); let r = e.revertir(); assert.notEqual(r.status, 0); assert.match(r.stdout, /no lleva la etiqueta del TAR verificado/);
  fs.writeFileSync(path.join(base, 'Dockerfile'), `FROM ${imagen}:1.1.0-rc2\nUSER root\nRUN echo '// alterado' >> /opt/tai/automation/director/config.mjs\nUSER node\n`); assert.equal(sh('docker', ['build', '-q', '-t', `${imagen}:alterada`, base]).status, 0);
  sh('docker', ['tag', `${imagen}:alterada`, `${imagen}:anterior`]); sh('docker', ['tag', 'node:22-bookworm-slim', `${imagen}:actual`]); r = e.revertir(); assert.notEqual(r.status, 0); assert.match(r.stdout, /la imagen anterior NO coincide con su manifiesto/); assert.equal(sh('docker', ['image', 'inspect', `${imagen}:actual`, '--format', '{{.Id}}']).stdout, sh('docker', ['image', 'inspect', 'node:22-bookworm-slim', '--format', '{{.Id}}']).stdout, ':actual no se movió');
  const vol = `${PREFIJO}vol-${crypto.randomBytes(3).toString('hex')}`; assert.equal(sh('docker', ['volume', 'create', vol]).status, 0);
  try { r = e.revertir(['retirar', '--con-ledger'], { TAI_DIRECTOR_VOLUMEN: vol, TAI_CONFIRMO_BORRAR_LEDGER: vol }); assert.match(r.stdout, /no existe o no es del Director/); assert.equal(sh('docker', ['volume', 'ls', '-q']).stdout.split('\n').includes(vol), true, 'el volumen sigue existiendo'); } finally { if (vol.startsWith(PREFIJO)) sh('docker', ['volume', 'rm', vol]); }
});

dtest('IMAGEN YA CONSTRUIDA · si la misma versión y el mismo TAR se firman con OTRA clave de confianza, no se reutiliza la imagen anterior: se reconstruye con la nueva etiqueta de clave', () => {
  const imagen = nuevaImagen(); const p1 = par(); const p2 = par(); const e1 = entorno({ par: p1, imagen }); const r1 = e1.instalar(); assert.equal(r1.status, 0, r1.stdout); assert.match(r1.stdout, /DIRECTOR_IMAGEN_CONSTRUIDA/);
  const e2 = entorno({ par: p2, imagen }); const r2 = e2.instalar(); assert.equal(r2.status, 0, r2.stdout); assert.doesNotMatch(r2.stdout, /DIRECTOR_YA_CONSTRUIDA/); assert.match(r2.stdout, /DIRECTOR_IMAGEN_CONSTRUIDA/);
  assert.equal(sh('docker', ['image', 'inspect', `${imagen}:1.1.0-rc2`, '--format', '{{index .Config.Labels "com.treidilor.firma-claveid"}}']).stdout.trim(), claveIdDe(p2.publica));
});
