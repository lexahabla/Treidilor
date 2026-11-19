// Agente 00 · 3E.8.12 · Paquete candidato 1.1.0 del Director, CLI de integridad independiente, firma de PRUEBAS Ed25519 e instalador de ensayo. Todo en carpetas temporales con claves de usar y tirar.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verificarFirmaPaquete } from '../../../scripts/automation/verificar-firma-paquete.mjs';
import { calcularArchivos, construirTar, leerTar, prepararPaquete, verificarTar, sha256Hex, FORMATO, cabecera } from '../../../scripts/automation/empaquetar-director.mjs';
import { calcularArchivosCli, construirTarCli, prepararPaqueteCli, verificarTarCli, PROHIBIDOS, ENTRADA_CLI, VERSION_CLI } from '../../../scripts/automation/empaquetar-cli-integridad.mjs';
import { firmarPaquete, generarParClaves, rutaPrivadaPermitida } from '../../../scripts/automation/firmar-paquete.mjs';
import { instalarEnsayo, revertirEnsayo, rutaActual } from '../../../scripts/automation/instalar-paquete-ensayo.mjs';
import { CONTRATO_CLI, VERSION_DIRECTOR, comprobarCli, compararVersiones } from '../integridad/cli-contrato.mjs';
import { confirmarEjecucion, prepararEjecucion, VAR_CODIGO } from '../integridad/ejecutar-manual.mjs';
import { crearEntornoSintetico, sellarCliPaquete } from './_sintetico.mjs';
import { ARCHIVO_ACTIVACION } from '../integridad/consola.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url)); const WEB = path.resolve(AQUI, '..', '..', '..'); const VERIF = path.join(WEB, 'scripts', 'automation', 'verificar-firma-paquete.mjs');
const PROTO = path.resolve(process.env.TAI_PROTOTIPO_INCIDENCIAS || path.join(WEB, '..', 'treidilor-ai', 'prototipo-incidencias-director')); const hayProto = fs.existsSync(path.join(PROTO, ENTRADA_CLI));
const itest = (n, f) => test(n, { skip: !hayProto && 'prototipo no disponible' }, f);
const dirs = []; after(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-pq-')); dirs.push(d); return d; };
const claves = generarParClaves(); const otras = generarParClaves();
const verificarProceso = (tar, firma, pub, extra = []) => spawnSync(process.execPath, [VERIF, tar, firma, pub, ...extra], { encoding: 'utf8' });
const escribirTrio = (buf, nombre, tipo, par = claves) => { const d = tmp(); const t = path.join(d, nombre); fs.writeFileSync(t, buf); const f = path.join(d, `${nombre}.firma.json`); fs.writeFileSync(f, JSON.stringify(firmarPaquete({ tar: buf, artefacto: nombre, tipo, privadaPem: par.privada }))); const p = path.join(d, 'publica.pem'); fs.writeFileSync(p, par.publica); fs.writeFileSync(`${t}.sha256`, `${sha256Hex(buf)}  ${nombre}\n`); return { d, t, f, p }; };
const tarDirector = () => construirTar(prepararPaquete(WEB, '1.1.0'), '1.1.0');
const tarCli = () => construirTarCli(prepararPaqueteCli(PROTO, VERSION_CLI), VERSION_CLI);
// reconstruye un TAR a partir de entradas (para fabricar manipulaciones que conservan una estructura válida)
const montar = (entradas) => Buffer.concat([...entradas.flatMap((e) => [cabecera(e.ruta, e.contenido.length), e.contenido, Buffer.alloc((512 - (e.contenido.length % 512)) % 512, 0)]), Buffer.alloc(1024, 0)]);

test('INVENTARIO · el Director 1.1.0 contiene EXACTAMENTE los archivos autorizados; añadir o quitar uno exige actualizar el inventario a propósito', () => {
  const esperado = JSON.parse(fs.readFileSync(path.join(AQUI, 'inventario-1.1.0.json'), 'utf8')); assert.deepEqual(calcularArchivos(WEB), esperado.archivos); assert.equal(esperado.version, '1.1.0');
  const pq = prepararPaquete(WEB, '1.1.0').map((a) => a.ruta).sort(); assert.equal(pq.length, esperado.archivos.length + 1); assert.ok(pq.includes('package.json'));
  assert.ok(!pq.some((r) => /(^|\/)tests\/|\.test\.mjs$|_sintetico|_ensayo|integridad-activacion|integridad-solicitud|\.env|\.pem$|\.key$|node_modules|\.git\//.test(r)), 'nada de pruebas, activación, solicitudes, claves ni temporales');
  assert.ok(!pq.some((r) => r.startsWith('/') || r.includes('..') || r.includes('\\') || /^[A-Za-z]:/.test(r)), 'rutas relativas seguras');
});

test('VERSIONES · el manifiesto declara 1.1.0, coincide con la versión del conjunto de integridad y con el package.json generado; el formato del manifiesto no cambia (compatibilidad con 1.0.0-f2)', () => {
  const buf = tarDirector(); const e = leerTar(buf); const man = JSON.parse(e[0].contenido.toString('utf8')); const pj = JSON.parse(e.find((x) => x.ruta === 'package.json').contenido.toString('utf8'));
  assert.deepEqual([man.formato, man.version, pj.version, pj.type], [FORMATO, '1.1.0', '1.1.0', 'module']); assert.equal(VERSION_DIRECTOR, '1.1.0'); assert.equal(FORMATO, 'treidilor-director-tar/1');
  assert.equal(verificarTar(buf, null).ok, true); assert.equal(sha256Hex(buf), sha256Hex(tarDirector()), 'determinista: mismo código, mismo SHA-256');
  assert.deepEqual([compararVersiones('1.0.0', '1.1.0'), compararVersiones('1.1.0', '1.1.0'), compararVersiones('2.0.0', '1.9.9'), compararVersiones('1.0.0-f2', '1.1.0')], [-1, 0, 1, null]);
});

test('PAQUETE DEL DIRECTOR · una alteración, un manifiesto manipulado, un archivo de más o de menos, una ruta absoluta o un enlace no verifican; sin secretos ni configuración de activación', () => {
  const buf = tarDirector(); const sha = sha256Hex(buf); assert.equal(verificarTar(buf, sha).ok, true); const entradas = leerTar(buf);
  assert.equal(verificarTar(buf, 'a'.repeat(64)).ok, false, 'otro SHA-256 esperado');
  const alterado = Buffer.from(buf); alterado[600] ^= 1; assert.equal(verificarTar(alterado, null).ok, false);
  const man = JSON.parse(entradas[0].contenido.toString('utf8')); man.archivos[0].sha256 = '0'.repeat(64); const e1 = [{ ruta: 'MANIFIESTO.json', contenido: Buffer.from(JSON.stringify(man)) }, ...entradas.slice(1)]; assert.match(verificarTar(montar(e1), null).errores.join('|'), /distinto del manifiesto/);
  assert.match(verificarTar(montar([...entradas, { ruta: 'automation/director/extra.mjs', contenido: Buffer.from('x') }]), null).errores.join('|'), /fuera del manifiesto/);
  assert.match(verificarTar(montar(entradas.slice(0, -1)), null).errores.join('|'), /Falta un archivo/);
  assert.match(verificarTar(montar([...entradas, { ruta: '/etc/passwd', contenido: Buffer.from('x') }]), null).errores.join('|'), /no permitida/);
  assert.match(verificarTar(montar([...entradas, { ruta: 'automation/../../x.mjs', contenido: Buffer.from('x') }]), null).errores.join('|'), /no permitida/);
  const enlace = Buffer.from(buf); enlace[156] = '2'.charCodeAt(0); assert.equal(verificarTar(enlace, null).ok, false, 'un enlace simbólico no es un archivo regular');
  assert.ok(!entradas.some((e) => /integridad-activacion|integridad-solicitud|\.pem|\.key/.test(e.ruta)));
  for (const e of entradas) assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._~+/-]{20,}/.test(e.contenido.toString('utf8')), e.ruta);
});

itest('CLI INDEPENDIENTE · el cierre de imports del prototipo (18 archivos) entra sin duplicar ni modificar nada; ni pruebas, ni simulación, ni la vía de autorización «solo para tests», ni datos reales', () => {
  const lista = calcularArchivosCli(PROTO); assert.equal(lista.length, 18); assert.ok(lista.includes(ENTRADA_CLI)); assert.ok(!lista.some((r) => PROHIBIDOS.some((rx) => rx.test(r))));
  const buf = tarCli(); const v = verificarTarCli(buf, null); assert.equal(v.ok, true, v.errores.join()); assert.equal(sha256Hex(buf), sha256Hex(tarCli()), 'determinista');
  for (const e of leerTar(buf)) { if (e.ruta === 'MANIFIESTO.json' || e.ruta === 'package.json') continue; assert.deepEqual(e.contenido, fs.readFileSync(path.join(PROTO, e.ruta)), `${e.ruta}: byte a byte igual al del prototipo`); }
  const man = JSON.parse(leerTar(buf)[0].contenido.toString('utf8')); assert.deepEqual([man.contrato, man.versionCli, man.directorMinimo, man.entrada], [CONTRATO_CLI, VERSION_CLI, '1.1.0', ENTRADA_CLI]);
});

itest('CLI INDEPENDIENTE · manipulaciones del paquete: archivo prohibido añadido, contrato cambiado, entrada distinta, contenido alterado y archivo ausente no verifican', () => {
  const buf = tarCli(); const entradas = leerTar(buf); const man = JSON.parse(entradas[0].contenido.toString('utf8')); const con = (m, resto) => montar([{ ruta: 'MANIFIESTO.json', contenido: Buffer.from(JSON.stringify(m)) }, ...resto]); const resto = entradas.slice(1);
  assert.match(verificarTarCli(montar([...entradas, { ruta: 'src/almacen/autorizacionTest.mjs', contenido: Buffer.from('x') }]), null).errores.join('|'), /no permitida/);
  assert.match(verificarTarCli(con({ ...man, contrato: 'integridad-ejecucion/2' }, resto), null).errores.join('|'), /Contrato/); assert.match(verificarTarCli(con({ ...man, entrada: 'src/otro.mjs' }, resto), null).errores.join('|'), /Entrada/);
  const alt = resto.map((e, i) => (i === 3 ? { ...e, contenido: Buffer.concat([e.contenido, Buffer.from('//x')]) } : e)); assert.match(verificarTarCli(con(man, alt), null).errores.join('|'), /distinto del manifiesto/); assert.match(verificarTarCli(con(man, resto.slice(1)), null).errores.join('|'), /Falta/);
});

itest('CONTRATO CLI ↔ DIRECTOR · sin manifiesto (desarrollo) se permite salvo que la activación lo exija; con manifiesto todo debe cuadrar: contrato, versión mínima, entrada, hash de cada archivo y ningún archivo de más', () => {
  const dir = tmp(); for (const e of leerTar(tarCli())) { const d = path.join(dir, ...e.ruta.split('/')); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, e.contenido); }
  const cli = path.join(dir, ENTRADA_CLI); const man = path.join(dir, 'MANIFIESTO.json'); const original = fs.readFileSync(man, 'utf8'); const m = JSON.parse(original); const poner = (x) => fs.writeFileSync(man, JSON.stringify(x));
  assert.deepEqual(comprobarCli({ cli, exigir: true }), { ok: true, verificado: true, versionCli: VERSION_CLI });
  poner({ ...m, contrato: 'integridad-ejecucion/2' }); assert.equal(comprobarCli({ cli }).motivo, 'cli_incompatible:contrato'); poner({ ...m, directorMinimo: '1.2.0' }); assert.equal(comprobarCli({ cli }).motivo, 'cli_incompatible:version_del_director'); assert.equal(comprobarCli({ cli, versionDirector: '1.2.0' }).ok, true);
  poner({ ...m, formato: 'otro/1' }); assert.equal(comprobarCli({ cli }).motivo, 'cli_manifiesto_invalido'); poner({ ...m, entrada: 'src/almacen/almacen.mjs' }); assert.equal(comprobarCli({ cli }).motivo, 'cli_no_es_la_entrada_del_paquete');
  poner({ ...m, archivos: [...m.archivos, { ruta: 'src/fantasma.mjs', sha256: 'a'.repeat(64), bytes: 1 }] }); assert.equal(comprobarCli({ cli }).motivo, 'cli_archivo_ausente'); poner({ ...m, archivos: [...m.archivos, { ruta: '../fuera.mjs', sha256: 'a'.repeat(64), bytes: 1 }] }); assert.equal(comprobarCli({ cli }).motivo, 'cli_manifiesto_invalido');
  fs.writeFileSync(man, '{roto'); assert.equal(comprobarCli({ cli }).motivo, 'cli_manifiesto_ilegible'); fs.writeFileSync(man, original);
  fs.appendFileSync(path.join(dir, 'src', 'canonico.mjs'), '\n//x'); assert.equal(comprobarCli({ cli }).motivo, 'cli_archivo_alterado'); fs.writeFileSync(path.join(dir, 'src', 'canonico.mjs'), leerTar(tarCli()).find((e) => e.ruta === 'src/canonico.mjs').contenido);
  fs.writeFileSync(path.join(dir, 'src', 'extra.mjs'), 'x'); assert.equal(comprobarCli({ cli }).motivo, 'cli_archivos_inesperados'); fs.rmSync(path.join(dir, 'src', 'extra.mjs'));
  fs.rmSync(path.join(dir, 'src', 'fechas.mjs')); assert.equal(comprobarCli({ cli }).motivo, 'cli_archivo_ausente');
  fs.rmSync(man); assert.deepEqual(comprobarCli({ cli, exigir: false }), { ok: true, verificado: false }); assert.equal(comprobarCli({ cli, exigir: true }).motivo, 'cli_sin_manifiesto'); assert.equal(comprobarCli({ cli: 'relativa/cli.mjs' }).motivo, 'cli_ruta_invalida');
});

test('EJECUCIÓN MANUAL ↔ CONTRATO CLI · el manifiesto del CLI es SIEMPRE obligatorio: sin él, o con uno incompatible, se deniega en ambas etapas y nunca se lanza; `exigirManifiestoCli: false` ya no existe; con manifiesto válido se ejecuta', async () => {
  const cli0 = path.join(tmp(), 'src', 'integridad-cli.mjs'); fs.mkdirSync(path.dirname(cli0), { recursive: true }); const marca = path.join(path.dirname(cli0), 'ejecutado.txt');
  fs.writeFileSync(cli0, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marca)}, 'x'); console.log(JSON.stringify({ formato: 'integridad-ejecucion/1', resultado: 'ok', nivel: 'ok', codigoSalida: 0, omitida: false, tentativa: { completa: true, cabeza: { seq: 3, huella: 'sha256:${'a'.repeat(64)}' }, segmentos: 1, eventosTotales: 3, comparacion: 'primera', referencia: 'ausente', anclaExterna: 'sin_ancla', reintento: false, motivos: [] } }));`);
  const e = crearEntornoSintetico({ cli: cli0 }); after(() => e.limpiar()); const env = { [VAR_CODIGO]: e.codigo }; const T = Date.parse('2027-03-31T12:00:00Z');
  const p = prepararEjecucion({ ledgerDir: e.ledgerDir, env, ahora: T }); assert.deepEqual([p.codigo, p.datos.motivo], [4, 'cli_sin_manifiesto'], 'sin el campo en la activación, igualmente se exige el manifiesto');
  const c = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env, ahora: T, solicitud: 'a'.repeat(32) }); assert.equal(c.datos.motivo, 'cli_sin_manifiesto'); assert.equal(fs.existsSync(marca), false);
  const act = JSON.parse(fs.readFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), 'utf8')); for (const valor of [false, 'si', 1]) { act.ejecucion.exigirManifiestoCli = valor; fs.writeFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(act)); assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env, ahora: T }).datos.motivo, 'integridad_desactivada', `exigirManifiestoCli: ${valor} = configuración inválida = desactivada`); }
  act.ejecucion.exigirManifiestoCli = true; fs.writeFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(act)); assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env, ahora: T }).datos.motivo, 'cli_sin_manifiesto', 'el valor true (compatibilidad con 3E.8.12) sigue exigiendo');
  sellarCliPaquete(cli0); const p2 = prepararEjecucion({ ledgerDir: e.ledgerDir, env, ahora: T }); assert.equal(p2.codigo, 0); const r = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env, ahora: T + 1000, solicitud: p2.datos.solicitud }); assert.equal(r.datos.ejecutado, true); assert.equal(fs.existsSync(marca), true);
  sellarCliPaquete(cli0, { contrato: 'integridad-ejecucion/2' }); assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env, ahora: T }).datos.motivo, 'cli_incompatible:contrato');
});

test('FIRMA DE PRUEBAS · verifica en un proceso INDEPENDIENTE; detecta paquete alterado, manifiesto manipulado, otra clave, firma o claveId alterados, nombre cambiado y firma de otro tipo reutilizada; avisa que NO es de producción', () => {
  const buf = tarDirector(); const { d, t, f, p } = escribirTrio(buf, 'treidilor-director-1.1.0.tar', 'director'); const r = verificarProceso(t, f, p); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /PRUEBAS.*NO es una firma de producción/);
  const doc = JSON.parse(fs.readFileSync(f, 'utf8')); assert.equal(doc.entorno, 'PRUEBAS'); assert.match(doc.aviso, /PRUEBAS/); assert.ok(!JSON.stringify(doc).includes('PRIVATE'));
  const t2 = path.join(d, 'alterado.tar'); const a = Buffer.from(buf); a[5000] ^= 1; fs.writeFileSync(t2, a); fs.copyFileSync(f, path.join(d, 'alterado.tar.firma.json')); assert.equal(verificarProceso(t2, path.join(d, 'alterado.tar.firma.json'), p).status, 1);
  const entradas = leerTar(buf); const man = JSON.parse(entradas[0].contenido.toString('utf8')); man.archivos[0].sha256 = '1'.repeat(64); const t3 = path.join(d, 'manifiesto.tar'); fs.writeFileSync(t3, montar([{ ruta: 'MANIFIESTO.json', contenido: Buffer.from(`${JSON.stringify(man, null, 1)}\n`) }, ...entradas.slice(1)])); fs.copyFileSync(f, path.join(d, 'manifiesto.tar.firma.json'));
  const rm = verificarProceso(t3, path.join(d, 'manifiesto.tar.firma.json'), p); assert.equal(rm.status, 1); assert.match(rm.stdout, /SHA-256 del paquete|MANIFIESTO/);
  const po = path.join(d, 'otra.pem'); fs.writeFileSync(po, otras.publica); assert.match(verificarProceso(t, f, po).stdout, /NO es válida|claveId distinto/);
  for (const [campo, valor] of [['firma', 'AAAA'], ['claveId', '0'.repeat(16)], ['version', '9.9.9'], ['tipo', 'cli'], ['entorno', 'PRODUCCION'], ['sha256Tar', '2'.repeat(64)]]) { const x = path.join(d, `x-${campo}.json`); fs.writeFileSync(x, JSON.stringify({ ...doc, [campo]: valor })); assert.equal(verificarProceso(t, x, p).status, 1, campo); }
  const nombre = path.join(d, 'otro-nombre.tar'); fs.copyFileSync(t, nombre); assert.match(verificarProceso(nombre, f, p).stdout, /nombre del archivo/);
  assert.equal(verificarProceso(t, f, p, ['--clave-id', '0'.repeat(16)]).status, 1); assert.equal(verificarProceso(t, f, path.join(d, 'no-existe.pem')).status, 1); assert.equal(verificarProceso(t, f, f).status, 1, 'una firma no es una clave');
});

itest('FIRMA DE PRUEBAS · la firma de un paquete no vale para otro (el CLI no se instala con la firma del Director) y el instalador de ensayo exige firma, SHA-256 y manifiesto', () => {
  const dir = escribirTrio(tarDirector(), 'treidilor-director-1.1.0.tar', 'director'); const cli = escribirTrio(tarCli(), 'treidilor-integridad-cli-0.1.0.tar', 'cli');
  assert.equal(verificarProceso(cli.t, dir.f, dir.p).status, 1, 'firma cruzada'); assert.equal(verificarProceso(cli.t, cli.f, cli.p).status, 0);
  const base = tmp(); assert.equal(instalarEnsayo({ base, tar: cli.t, firma: dir.f, publica: dir.p, tipo: 'cli' }).motivo, 'firma_no_verifica'); assert.equal(fs.existsSync(path.join(base, 'versiones')), false, 'nada se extrae si la firma no verifica');
  assert.equal(instalarEnsayo({ base, tar: dir.t, firma: dir.f, publica: dir.p, tipo: 'director', sha256: 'b'.repeat(64) }).motivo, 'paquete_no_verifica');
  const ok = instalarEnsayo({ base, tar: dir.t, firma: dir.f, publica: dir.p, tipo: 'director' }); assert.deepEqual([ok.ok, ok.version], [true, '1.1.0']); assert.equal(fs.readFileSync(path.join(base, 'actual'), 'utf8').trim(), '1.1.0');
  assert.equal(instalarEnsayo({ base, tar: dir.t, firma: dir.f, publica: dir.p, tipo: 'director' }).motivo, 'version_ya_instalada', 'no se sobrescribe una versión instalada');
});

test('INSTALACIÓN Y REVERSIÓN (ensayo) · instalar deja `actual`/`anterior`; revertir intercambia sin borrar versiones; sin versión anterior no revierte; no se instala si la firma falla; las versiones antiguas no se tocan', () => {
  const base = tmp(); const a = escribirTrio(construirTar(prepararPaquete(WEB, '1.0.0'), '1.0.0'), 'treidilor-director-1.0.0.tar', 'director'); const b = escribirTrio(tarDirector(), 'treidilor-director-1.1.0.tar', 'director');
  assert.equal(revertirEnsayo({ base }).motivo, 'sin_version_anterior'); assert.equal(instalarEnsayo({ base, tar: a.t, firma: a.f, publica: a.p, tipo: 'director' }).ok, true); const antes = fs.readFileSync(path.join(base, 'versiones', '1.0.0', 'package.json'));
  const i = instalarEnsayo({ base, tar: b.t, firma: b.f, publica: b.p, tipo: 'director' }); assert.deepEqual([i.ok, i.anterior], [true, '1.0.0']); assert.equal(fs.readFileSync(path.join(base, 'anterior'), 'utf8').trim(), '1.0.0'); assert.deepEqual(fs.readFileSync(path.join(base, 'versiones', '1.0.0', 'package.json')), antes);
  assert.equal(rutaActual(base), path.join(base, 'versiones', '1.1.0')); const r = revertirEnsayo({ base }); assert.deepEqual([r.ok, r.actual], [true, '1.0.0']); assert.equal(fs.existsSync(path.join(base, 'versiones', '1.1.0')), true, 'la versión descartada se conserva'); assert.equal(rutaActual(base), path.join(base, 'versiones', '1.0.0'));
  fs.rmSync(path.join(base, 'versiones', '1.1.0'), { recursive: true }); assert.equal(revertirEnsayo({ base }).motivo, 'version_anterior_ausente');
});

test('CLAVES DE PRUEBAS · la privada no puede guardarse en el repositorio, en paquetes\\ ni en informes\\ y los artefactos firmados no la contienen', () => {
  assert.equal(rutaPrivadaPermitida(path.join(WEB, 'x.pem')), false); assert.equal(rutaPrivadaPermitida(path.join(WEB, '..', 'paquetes', 'director', 'x.pem')), false); assert.equal(rutaPrivadaPermitida(path.join(WEB, '..', 'informes', 'x.pem')), false); assert.equal(rutaPrivadaPermitida(path.join(os.tmpdir(), 'x.pem')), true);
  const t = escribirTrio(tarDirector(), 'treidilor-director-1.1.0.tar', 'director'); const pem = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/; assert.ok(!pem.test(fs.readFileSync(t.f, 'utf8')) && !pem.test(fs.readFileSync(t.t, 'latin1')) && !pem.test(fs.readFileSync(t.p, 'utf8')) && pem.test(claves.privada), 'control: el patrón sí detecta una clave privada');
  const r = spawnSync(process.execPath, [path.join(WEB, 'scripts', 'automation', 'firmar-paquete.mjs'), 'generar-claves', '--publica', path.join(tmp(), 'p.pem'), '--privada', path.join(WEB, 'no-debe-existir.pem')], { encoding: 'utf8' }); assert.equal(r.status, 2); assert.equal(fs.existsSync(path.join(WEB, 'no-debe-existir.pem')), false);
});

/* ───────── supervivientes de la ronda de mutaciones de 3E.8.12: una prueba aislada por causa ───────── */
import crypto from 'node:crypto';
import { canonico } from '../../../scripts/automation/firmar-paquete.mjs';
// firma «a mano» de un documento arbitrario con la clave de pruebas (para aislar cada comprobación del verificador)
const firmaManual = (tar, cambios = {}, par = claves) => { const e = leerTar(tar); const base = { esquema: 'treidilor-firma-paquete/1', entorno: 'PRUEBAS', aviso: 'x', tipo: 'director', artefacto: 'p.tar', version: '1.1.0', sha256Tar: sha256Hex(tar), sha256Manifiesto: sha256Hex(e[0].contenido), archivos: e.length - 1, firmadoEn: '2027-03-31T12:00:00.000Z', claveId: crypto.createHash('sha256').update(crypto.createPublicKey(par.publica).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16), ...cambios }; return JSON.stringify({ ...base, firma: crypto.sign(null, Buffer.from(canonico(base)), crypto.createPrivateKey(par.privada)).toString('base64') }); };
const conFirma = (tar, firma, pub = claves.publica) => { const d = tmp(); const t = path.join(d, 'p.tar'); fs.writeFileSync(t, tar); const fj = path.join(d, 'f.json'); fs.writeFileSync(fj, firma); const p = path.join(d, 'pub.pem'); fs.writeFileSync(p, pub); return verificarProceso(t, fj, p); };

test('VERIFICADOR · cada comprobación por separado con documentos bien firmados: SHA-256 del paquete, manifiesto, entorno de PRUEBAS, claveId y tipo de clave', () => {
  const buf = tarDirector(); assert.equal(conFirma(buf, firmaManual(buf)).status, 0, 'control: el documento fabricado a mano con la clave de pruebas verifica');
  const a = Buffer.from(buf); a[buf.length - 3000] ^= 1; assert.match(conFirma(a, firmaManual(buf)).stdout, /SHA-256 del paquete NO es el firmado/, 'contenido alterado fuera del manifiesto');
  assert.match(conFirma(buf, firmaManual(buf, { sha256Manifiesto: '3'.repeat(64) })).stdout, /MANIFIESTO.json del paquete NO es el firmado/, 'manifiesto distinto del firmado');
  assert.match(conFirma(buf, firmaManual(buf, { entorno: 'PRODUCCION' })).stdout, /formato de firma no reconocido/, 'una firma bien hecha pero que no es de PRUEBAS se rechaza');
  assert.match(conFirma(buf, firmaManual(buf, { claveId: '0'.repeat(16) })).stdout, /claveId distinto de la clave pública/, 'claveId que no es el de la clave');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }); assert.match(conFirma(buf, firmaManual(buf), rsa).stdout, /no es una clave Ed25519/, 'solo Ed25519');
});

test('INSTALADOR DE ENSAYO · sin SHA-256 esperado (ni parámetro ni archivo .sha256) no se instala nada', () => {
  const t = escribirTrio(tarDirector(), 'treidilor-director-1.1.0.tar', 'director'); fs.rmSync(`${t.t}.sha256`); const base = tmp(); const r = instalarEnsayo({ base, tar: t.t, firma: t.f, publica: t.p, tipo: 'director' });
  assert.deepEqual([r.ok, r.motivo], [false, 'sin_sha256_esperado']); assert.equal(fs.existsSync(path.join(base, 'versiones')), false);
});

itest('CLI INDEPENDIENTE · si el cierre de imports alcanzara la autorización «solo para tests», la simulación o datos reales, el empaquetado se ABORTA', () => {
  for (const [prohibido, nombre] of [['almacen/autorizacionTest.mjs', 'autorizacionTest'], ['simulacion/datos.mjs', 'simulacion'], ['almacen/informe-real.mjs', 'informe-real']]) {
    const p = tmp(); fs.mkdirSync(path.join(p, 'src', path.dirname(prohibido)), { recursive: true }); fs.writeFileSync(path.join(p, 'src', 'integridad-cli.mjs'), `import './${prohibido}';\n`); fs.writeFileSync(path.join(p, 'src', prohibido), 'export const x = 1;\n');
    assert.throws(() => calcularArchivosCli(p), /prohibido/, nombre);
  }
  const p = tmp(); fs.mkdirSync(path.join(p, 'src')); fs.writeFileSync(path.join(p, 'src', 'integridad-cli.mjs'), "import './no-existe.mjs';\n"); assert.throws(() => calcularArchivosCli(p), /irresoluble/);
});

itest('CONTRATO CLI · un enlace simbólico dentro del paquete instalado se rechaza (si el sistema permite crearlo)', () => {
  const dir = tmp(); for (const e of leerTar(tarCli())) { const d = path.join(dir, ...e.ruta.split('/')); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, e.contenido); }
  const cli = path.join(dir, ENTRADA_CLI); assert.equal(comprobarCli({ cli, exigir: true }).ok, true);
  try { fs.symlinkSync(path.join(dir, 'src', 'canonico.mjs'), path.join(dir, 'src', 'enlace.mjs')); } catch { return; } // sin privilegios para crear enlaces (Windows): se comprueba en el contenedor
  assert.equal(comprobarCli({ cli, exigir: true }).motivo, 'cli_estructura_no_permitida');
});

/* ───────── 3E.8.13 · verificador independiente de árboles y primer elemento del TAR ───────── */
import { verificarArbol } from '../../../scripts/automation/verificar-arbol-paquete.mjs';
const extraer = (buf) => { const d = tmp(); for (const e of leerTar(buf)) { const f = path.join(d, ...e.ruta.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, e.contenido); } return d; };
test('VERIFICADOR DE ÁRBOLES (independiente) · un árbol íntegro verifica; alterado, archivo de más, archivo ausente, manifiesto ilegible o con rutas peligrosas y enlaces no verifican', () => {
  const d = extraer(tarDirector()); assert.equal(verificarArbol(d).ok, true); const cfg = path.join(d, 'automation', 'director', 'config.mjs'); const orig = fs.readFileSync(cfg);
  fs.appendFileSync(cfg, '\n//x'); assert.match(verificarArbol(d).errores.join(), /alterado: automation\/director\/config\.mjs/); fs.writeFileSync(cfg, orig);
  fs.writeFileSync(path.join(d, 'automation', 'extra.mjs'), 'x'); assert.match(verificarArbol(d).errores.join(), /archivo de más: automation\/extra\.mjs/); fs.rmSync(path.join(d, 'automation', 'extra.mjs'));
  fs.rmSync(cfg); assert.match(verificarArbol(d).errores.join(), /falta: automation\/director\/config\.mjs/); fs.writeFileSync(cfg, orig);
  try { fs.symlinkSync(cfg, path.join(d, 'automation', 'enlace.mjs')); assert.match(verificarArbol(d).errores.join(), /enlace simbólico/); fs.rmSync(path.join(d, 'automation', 'enlace.mjs')); } catch { /* sin privilegios para enlaces */ }
  const man = path.join(d, 'MANIFIESTO.json'); const m = JSON.parse(fs.readFileSync(man, 'utf8')); fs.writeFileSync(man, JSON.stringify({ ...m, archivos: [...m.archivos, { ruta: '../fuera.mjs', sha256: 'a'.repeat(64), bytes: 1 }] })); assert.equal(verificarArbol(d).ok, false); fs.writeFileSync(man, '{roto'); assert.equal(verificarArbol(d).ok, false); fs.writeFileSync(man, JSON.stringify({ ...m, formato: 'otro/1' })); assert.equal(verificarArbol(d).ok, false); fs.rmSync(man); assert.equal(verificarArbol(d).ok, false);
  const r = spawnSync(process.execPath, [path.join(WEB, 'scripts', 'automation', 'verificar-arbol-paquete.mjs'), extraer(tarDirector())], { encoding: 'utf8' }); assert.equal(r.status, 0); assert.match(r.stdout, /ARBOL_INTEGRO/);
});

test('PRIMER ELEMENTO · el verificador de firma exige que el TAR empiece por MANIFIESTO.json (por eso el script de instalación no puede recibir un TAR firmado con otro orden)', () => {
  const ent = leerTar(tarDirector()); const raro = montar([...ent.slice(1), ent[0]]); const f = JSON.stringify({ esquema: 'treidilor-firma-paquete/1', entorno: 'PRUEBAS', tipo: 'director', sha256Tar: sha256Hex(raro), sha256Manifiesto: sha256Hex(ent[0].contenido), claveId: 'x', firma: 'x' });
  assert.match(verificarFirmaPaquete({ tar: raro, firma: f, publicaPem: claves.publica }).errores.join(), /no empieza por MANIFIESTO\.json/);
});
