// Agente 00 · 3E.8.11 · Ejecución manual explícita en DOS etapas de una verificación de integridad. Todo sintético: ledgers, almacenes, códigos y «comandos de verificación» falsos en el directorio temporal.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LedgerLocal } from '../ledger.mjs';
import { ARCHIVO_ACTIVACION, ESQUEMA_ACTIVACION, comandoIntegridad, validarActivacion } from '../integridad/consola.mjs';
import { CADUCA_SOLICITUD_MS, VAR_CODIGO, comprobarCodigo, confirmarEjecucion, crearVerificador, ejecutarManualConsola, prepararEjecucion } from '../integridad/ejecutar-manual.mjs';
import { calcularArchivos } from '../../../scripts/automation/empaquetar-director.mjs';
import { crearEntornoSintetico, ejecutarAutomatico, exigirSintetico, sellarCliPaquete } from './_sintetico.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONSOLA = path.join(AQUI, '..', '..', '..', 'scripts', 'automation', 'director.mjs'); const FUENTE = path.join(AQUI, '..', 'integridad', 'ejecutar-manual.mjs');
const entornos = []; after(() => { for (const e of entornos.splice(0)) e.limpiar(); });
const T0 = Date.parse('2027-03-31T12:00:00.000Z'); // 14:00 en Madrid: fuera de la franja 08:50–10:05
const cab = (seq, c = 'c') => ({ seq, huella: `sha256:${String(seq).padStart(2, '0')}${c.repeat(62)}` });
const salidaOk = (extra = {}) => ({ formato: 'integridad-ejecucion/1', resultado: 'ok', nivel: 'ok', codigoSalida: 0, omitida: false, tentativa: { completa: true, cabeza: cab(9), segmentos: 1, eventosTotales: 9, comparacion: 'primera', referencia: 'ausente', anclaExterna: 'sin_ancla', reintento: false, motivos: [] }, registroEscrito: true, recursos: { cpuMs: 1, maxRssMiB: 40 }, ...extra });
// «comando de verificación» falso: cuenta sus invocaciones en un archivo (para demostrar que NO se lanzó) y devuelve una salida fija
const cliFalso = (dirContador, obj = salidaOk(), codigo = 0, dormirMs = 0) => { const f = path.join(dirContador, 'cli', 'src', 'integridad-cli.mjs'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(path.join(dirContador, 'invocaciones.txt'))}, 'x'); await new Promise((r) => setTimeout(r, ${dormirMs})); console.log(JSON.stringify(${JSON.stringify(obj)})); process.exitCode = ${codigo};`); return sellarCliPaquete(f); };
const invocaciones = (e) => { try { return fs.readFileSync(path.join(e.raiz, 'invocaciones.txt'), 'utf8').length; } catch { return 0; } };
const nuevo = (opts = {}) => { const e = crearEntornoSintetico({ cli: path.join(os.tmpdir(), 'placeholder-cli.mjs') }); const cli = cliFalso(e.raiz, opts.obj, opts.codigo, opts.dormirMs); const act = { ...e.activacion, ejecucion: { ...e.activacion.ejecucion, cli } }; fs.writeFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(act)); e.activacion = act; entornos.push(e); return e; };
const env = (e, extra = {}) => ({ [VAR_CODIGO]: e.codigo, ...extra });
const archivosSolicitud = (e) => fs.readdirSync(e.ledgerDir).filter((n) => n.startsWith('integridad-solicitud-'));
const eventos = (e) => new LedgerLocal({ dir: e.ledgerDir, particion: 'integridad', raiz: '/__sin_raiz__' }).leer((x) => x.refs && x.refs.idAlmacen === 'g');
const reescribir = (e, cambio) => { const act = { ...e.activacion, ...cambio }; fs.writeFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(act)); return act; };

test('DESACTIVADO POR DEFECTO · sin activación, sin bloque `ejecucion` o con la variable de desactivación, ninguna etapa se acepta y no se crea ni se ejecuta nada; sin banderas solo muestra el uso', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-vacio-')); entornos.push({ limpiar: () => fs.rmSync(d, { recursive: true, force: true }) });
  for (const o of [{ preparar: true }, { confirmar: 'a'.repeat(32) }]) { const r = await ejecutarManualConsola({ o, ledgerDir: d, env: { [VAR_CODIGO]: 'x'.repeat(20) }, ahora: T0 }); assert.deepEqual([r.codigo, r.datos.ejecutado, r.datos.motivo], [4, false, 'integridad_desactivada']); }
  assert.deepEqual(fs.readdirSync(d), [], 'ni un archivo');
  const e = nuevo(); reescribir(e, { ejecucion: undefined }); assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }).datos.motivo, 'ejecucion_no_habilitada'); assert.deepEqual(archivosSolicitud(e), []);
  fs.writeFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(e.activacion)); assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e, { TAI_INTEGRIDAD_DESACTIVAR: 'si' }), ahora: T0 }).datos.motivo, 'integridad_desactivada');
  const u = await ejecutarManualConsola({ o: {}, ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); assert.deepEqual([u.codigo, u.datos.ejecutado], [1, false]); const u2 = await ejecutarManualConsola({ o: { preparar: true, confirmar: 'a'.repeat(32) }, ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); assert.equal(u2.codigo, 1, 'las dos banderas a la vez no hacen nada');
  assert.equal(invocaciones(e), 0); assert.deepEqual(archivosSolicitud(e), []);
});

test('CONSULTA ≠ AUTORIZACIÓN · «integridad estado/ancla/ejecutar» del comando de consulta nunca ejecuta ni prepara nada, ni con la funcionalidad activada y el bloque `ejecucion` completo', () => {
  const e = nuevo(); for (const sub of ['estado', 'ancla', 'ejecutar', 'confirmar', 'preparar']) comandoIntegridad({ sub, ledgerDir: e.ledgerDir, env: env(e), ahora: T0 });
  assert.equal(invocaciones(e), 0); assert.deepEqual(archivosSolicitud(e), []); assert.equal(comandoIntegridad({ sub: 'ejecutar', ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }).codigo, 1);
});

test('VERIFICADOR · el código del propietario nunca se guarda: scrypt con sal propia; mínimo de longitud, formato estricto y comparación exacta', () => {
  const codigo = 'una-frase-larga-del-propietario'; const v = crearVerificador(codigo); assert.match(v, /^scrypt1\$[0-9a-f]{32}\$[0-9a-f]{128}$/); assert.ok(!v.includes(codigo)); assert.notEqual(v, crearVerificador(codigo), 'sal distinta cada vez');
  assert.equal(comprobarCodigo(codigo, v), true); for (const mal of ['', 'corto', codigo + ' ', codigo.toUpperCase(), undefined, 5, null]) assert.equal(comprobarCodigo(mal, v), false);
  for (const v2 of [undefined, '', 'scrypt1$aa$bb', v.replace('scrypt1', 'scrypt2'), `${v}0`]) assert.equal(comprobarCodigo(codigo, v2), false); assert.throws(() => crearVerificador('corto'));
});

test('ACTIVACIÓN · el bloque `ejecucion` es estricto: rutas absolutas, sin segmentos protegidos (producción, secretos), verificador con formato, sin campos extra ni valores fuera de rango', () => {
  const v = crearVerificador('x'.repeat(20)); const base = { esquema: ESQUEMA_ACTIVACION, habilitada: true, autorizadoPor: 'propietario', idAlmacen: 'g' }; const ok = { almacenDir: path.resolve('/tmp/a'), cli: path.resolve('/tmp/c.mjs'), verificador: v };
  assert.equal(validarActivacion({ ...base, ejecucion: ok }).ok, true);
  for (const mal of [{ ...ok, almacenDir: 'relativa' }, { ...ok, cli: 'c.mjs' }, { ...ok, verificador: 'abc' }, { ...ok, extra: 1 }, { ...ok, maxTareas: 0 }, { ...ok, maxTareas: 99999 }, { ...ok, almacenDir: path.resolve('/x/secretos-e3/a') }, { ...ok, almacenDir: path.resolve('/x/treidilor_web/a') }, { ...ok, almacenDir: path.resolve('/x/TRADYLOR_WEB/a') }, { ...ok, frioDir: 'rel' }, { ...ok, verificador: undefined }, null, []]) assert.equal(validarActivacion({ ...base, ejecucion: mal }).motivo, 'configuracion_invalida:ejecucion', JSON.stringify(mal)?.slice(0, 60));
});

test('DOS ETAPAS · la etapa 1 solo escribe la solicitud (un archivo, sin ejecutar); la 2 exige solicitud vigente y código; la solicitud es de un solo uso; ejecuta exactamente UNA pasada y queda registrada', async () => {
  const e = nuevo(); const p = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); assert.deepEqual([p.codigo, p.datos.ejecutado, p.datos.preparada], [0, false, true]); assert.equal(invocaciones(e), 0); assert.equal(archivosSolicitud(e).length, 1); assert.match(p.datos.solicitud, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(p).includes(e.codigo) && !p.texto.includes(e.raiz), 'ni código ni rutas'); assert.ok(!fs.readFileSync(path.join(e.ledgerDir, archivosSolicitud(e)[0]), 'utf8').includes(p.datos.solicitud), 'la solicitud se guarda solo como huella');
  const r = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 1000, solicitud: p.datos.solicitud }); assert.deepEqual([r.codigo, r.datos.ejecutado, r.datos.resultado, r.datos.registrado], [0, true, 'ok', true]); assert.equal(invocaciones(e), 1);
  assert.deepEqual(archivosSolicitud(e), [], 'solicitud consumida'); assert.ok(eventos(e).some((x) => x.tipo === 'integridad_ejecucion')); assert.ok(eventos(e).some((x) => x.tipo === 'ancla_integridad'), 'primera verificación completa → ancla por el contrato existente');
  const otra = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 2000, solicitud: p.datos.solicitud }); assert.deepEqual([otra.codigo, otra.datos.motivo], [4, 'sin_solicitud_preparada']); assert.equal(invocaciones(e), 1, 'un solo uso');
  assert.ok(!r.texto.includes(e.codigo) && !r.texto.includes(e.raiz) && !JSON.stringify(r.datos).includes(e.raiz));
});

test('CONFIRMACIONES INCOMPLETAS O FALSAS · sin solicitud, formato, solicitud ajena, sin código, código incorrecto (invalida), caducada, configuración cambiada: todas denegadas y sin lanzar nada', async () => {
  const e = nuevo(); const conf = (extra = {}) => confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 1000, ...extra });
  assert.equal((await conf({ solicitud: 'a'.repeat(32) })).datos.motivo, 'sin_solicitud_preparada'); for (const mal of [undefined, '', 'corta', 'g'.repeat(32), 5]) assert.equal((await conf({ solicitud: mal })).datos.motivo, 'solicitud_ausente_o_invalida');
  const p = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); const s = p.datos.solicitud;
  assert.equal((await conf({ solicitud: 'b'.repeat(32) })).datos.motivo, 'solicitud_distinta'); assert.equal(archivosSolicitud(e).length, 1, 'adivinar mal no invalida la solicitud del propietario');
  assert.equal((await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: {}, ahora: T0 + 1000, solicitud: s })).datos.motivo, 'codigo_ausente'); assert.equal((await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: { [VAR_CODIGO]: '' }, ahora: T0 + 1000, solicitud: s })).datos.motivo, 'codigo_ausente'); assert.equal(archivosSolicitud(e).length, 1);
  assert.equal((await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: { [VAR_CODIGO]: `${e.codigo}x` }, ahora: T0 + 1000, solicitud: s })).datos.motivo, 'codigo_incorrecto'); assert.deepEqual(archivosSolicitud(e), [], 'un código incorrecto invalida la solicitud');
  assert.equal((await conf({ solicitud: s })).datos.motivo, 'sin_solicitud_preparada', 'ni con el código bueno después');
  const p2 = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); assert.equal((await conf({ solicitud: p2.datos.solicitud, ahora: T0 + CADUCA_SOLICITUD_MS })).datos.motivo, 'solicitud_caducada'); assert.deepEqual(archivosSolicitud(e), []);
  const p3 = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); reescribir(e, { ejecucion: { ...e.activacion.ejecucion, maxTareas: 5 } }); assert.equal((await conf({ solicitud: p3.datos.solicitud })).datos.motivo, 'configuracion_cambiada');
  assert.equal(invocaciones(e), 0, 'ninguna de las denegaciones lanzó el comando');
});

test('ALMACENES NO AUTORIZADOS · solo el configurado; otro id, uno con trazos de ruta o ausente de disco se rechazan en ambas etapas sin dejar solicitud', async () => {
  const e = nuevo(); for (const a of ['otro', '../g', 'g/../h', 'G']) { assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0, almacenSolicitado: a }).datos.motivo, 'almacen_no_autorizado', a); assert.equal((await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0, solicitud: 'a'.repeat(32), almacenSolicitado: a })).datos.motivo, 'almacen_no_autorizado'); }
  assert.deepEqual(archivosSolicitud(e), []); const via = await ejecutarManualConsola({ o: { preparar: true, almacen: 'otro' }, ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); assert.equal(via.datos.motivo, 'almacen_no_autorizado');
  fs.rmSync(e.almacenDir, { recursive: true }); assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }).datos.motivo, 'almacen_inexistente'); fs.mkdirSync(e.almacenDir);
  fs.rmSync(e.activacion.ejecucion.cli); assert.equal(prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }).datos.motivo, 'comando_inexistente'); assert.equal(prepararEjecucion({ ledgerDir: path.join(e.raiz, 'no'), env: env(e), ahora: T0 }).datos.activa ?? false, false);
});

test('SIN REANCLAJE AUTOMÁTICO · con historial en el almacén y el ledger vacío la ejecución termina en `sin_ancla` (aviso, código 2) y NO escribe ningún ancla; el módulo fija `reanclar: null`', async () => {
  const e = nuevo({ obj: salidaOk({ tentativa: { ...salidaOk().tentativa, referencia: 'valida', comparacion: 'coincide' } }) }); const r = await ejecutarAutomatico(e, { ahora: T0 });
  assert.deepEqual([r.datos.resultado, r.codigo, r.datos.accionAncla, r.datos.motivoAncla], ['sin_ancla', 2, 'no_anclar', 'ancla_ausente_con_historial']); assert.equal(eventos(e).filter((x) => x.tipo === 'ancla_integridad').length, 0);
  assert.match(r.texto, /No se ha reanclado nada/); const src = fs.readFileSync(FUENTE, 'utf8'); assert.match(src, /reanclar: null/); assert.ok(!/reanclar: *\{|confirmar: *true/.test(src));
});

test('NO ELUDE LAS GUARDAS · en la franja del gestor/vigilante o con el almacén escribiéndose la confirmación se aplaza (código 3), la solicitud queda consumida y no se lanza nada', async () => {
  const e = nuevo(); const manana = Date.parse('2027-03-31T08:00:00.000Z'); // 10:00 en Madrid en horario de verano: dentro de 08:50–10:05
  const p = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: manana }); assert.ok(p.datos.avisos.some((a) => /franja/.test(a))); const r = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: manana + 1000, solicitud: p.datos.solicitud });
  assert.deepEqual([r.codigo, r.datos.ejecutado, r.datos.estado], [3, false, 'aplazada_ventana']); assert.deepEqual(archivosSolicitud(e), []);
  fs.writeFileSync(path.join(e.almacenDir, 'bloqueo.json'), '{}'); const ahora = Date.now(); const p2 = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora }); assert.ok(p2.datos.avisos.some((a) => /escribiendo/.test(a)));
  const r2 = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: ahora + 1000, solicitud: p2.datos.solicitud, reloj: () => T0 }); assert.deepEqual([r2.codigo, r2.datos.ejecutado, r2.datos.estado], [3, false, 'aplazada_escritura_en_curso']); assert.equal(invocaciones(e), 0);
});

test('CONCURRENCIA · una segunda ejecución confirmada mientras otra está en marcha recibe `ya_en_ejecucion` y no lanza un segundo comando', async () => {
  const e = nuevo({ dormirMs: 1500 }); const a = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); const pa = confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 1000, solicitud: a.datos.solicitud });
  await new Promise((r) => setTimeout(r, 400)); const b = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 1000 }); const rb = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 1000, solicitud: b.datos.solicitud });
  assert.deepEqual([rb.datos.ejecutado, rb.datos.estado, rb.codigo], [false, 'ya_en_ejecucion', 3]); const ra = await pa; assert.equal(ra.datos.ejecutado, true); assert.equal(invocaciones(e), 1);
});

test('ERRORES Y CÓDIGOS · alteración (1), aviso (2), error operativo (3) y denegación (4) mantienen la semántica del motor y quedan en el ledger; el error no es alteración', async () => {
  const casos = [[{ obj: salidaOk({ resultado: 'retroceso', nivel: 'fallo', codigoSalida: 1, tentativa: { ...salidaOk().tentativa, completa: false, anclaExterna: 'posterior' } }), codigo: 1 }, 1, 'retroceso'], [{ obj: salidaOk({ resultado: 'incompleta', nivel: 'aviso', codigoSalida: 2, tentativa: { ...salidaOk().tentativa, completa: false } }), codigo: 2 }, 2, 'incompleta'], [{ obj: salidaOk({ resultado: 'error', nivel: 'aviso', codigoSalida: 3, tentativa: { ...salidaOk().tentativa, completa: false, motivos: ['almacen_inestable_durante_la_verificacion'] } }), codigo: 3 }, 3, 'error']];
  for (const [o, cod, res] of casos) { const e = nuevo(o); const r = await ejecutarAutomatico(e, { ahora: T0 }); assert.deepEqual([r.codigo, r.datos.resultado], [cod, res]); assert.ok(eventos(e).some((x) => x.tipo === 'integridad_ejecucion' && x.datos.resultado === res)); const est = comandoIntegridad({ sub: 'estado', ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 1000 }).datos; assert.equal(est.alteracionConfirmada, res === 'retroceso'); assert.equal(est.errorOperativo, res === 'error'); }
  const e = nuevo({ codigo: 0, obj: 'no-es-json' }); fs.writeFileSync(e.activacion.ejecucion.cli, 'console.log("ruido sin json")'); sellarCliPaquete(e.activacion.ejecucion.cli); const r = await ejecutarAutomatico(e, { ahora: T0 }); assert.equal(r.codigo, 3); assert.ok(r.datos.motivos.includes('salida_no_valida'));
});

test('SIN PROGRAMACIÓN · el módulo no usa temporizadores, planificadores ni procesos propios; tras ejecutar no quedan cerrojos ni procesos', async () => {
  const src = fs.readFileSync(FUENTE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); assert.equal(/setInterval|setTimeout|cron|schtasks|systemd|child_process|spawn\(|exec\(|\.unref\(/.test(src), false);
  const e = nuevo(); await ejecutarAutomatico(e, { ahora: T0 }); assert.deepEqual(fs.readdirSync(e.ledgerDir).filter((n) => /\.lock$|solicitud/.test(n) && !/ledger-integridad\.lock/.test(n)), []);
});

test('MODO SINTÉTICO · solo acepta entornos creados por este proceso bajo el directorio temporal, con marca; se deniega fuera del aislamiento y no existe en el código de producción', async () => {
  const e = nuevo(); assert.equal(exigirSintetico(e), true);
  assert.throws(() => exigirSintetico({ ...e, raiz: AQUI }), /fuera_del_directorio_temporal/); assert.throws(() => exigirSintetico({ ...e, token: 'otro' }), /marca_no_coincide/); assert.throws(() => exigirSintetico(null), /sin_entorno/);
  const sinMarca = nuevo(); fs.rmSync(path.join(sinMarca.raiz, '.tai-sintetico.json')); assert.throws(() => exigirSintetico(sinMarca), /sin_marca/);
  const ajena = nuevo(); const m = path.join(ajena.raiz, '.tai-sintetico.json'); fs.writeFileSync(m, fs.readFileSync(m, 'utf8').replace(`"pid":${process.pid}`, '"pid":1')); assert.throws(() => exigirSintetico(ajena), /marca_no_coincide/);
  const otro = nuevo(); const e2 = nuevo(); assert.throws(() => exigirSintetico({ ...otro, almacenDir: e2.almacenDir }), /subcarpeta_fuera_del_entorno/);
  const desvio = nuevo(); reescribir(desvio, { ejecucion: { ...desvio.activacion.ejecucion, almacenDir: e2.almacenDir } }); assert.throws(() => exigirSintetico(desvio), /la_activacion_apunta_a_otro_almacen/);
  await assert.rejects(() => ejecutarAutomatico({ ...e, raiz: AQUI }), /entorno_no_sintetico/); assert.equal(invocaciones(e), 0);
  const prod = fs.readFileSync(FUENTE, 'utf8') + fs.readFileSync(path.join(AQUI, '..', 'integridad', 'consola.mjs'), 'utf8'); assert.ok(!/sint[eé]tico|TAI_PRUEBAS|bypass|omitir.*confirm/i.test(prod), 'ningún atajo de pruebas en producción');
  assert.ok(!calcularArchivos().some((f) => /_sintetico|tests\//.test(f)), 'el ayudante no viaja en el paquete');
});

test('CONSOLA REAL (proceso nuevo) · las dos etapas por línea de comandos: el código solo por entorno, sin eco; sin la etapa 1 no ejecuta; la consulta no la sustituye', () => {
  const e = nuevo(); const lanzar = (args, extra = {}) => spawnSync(process.execPath, [CONSOLA, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, TAI_DIRECTOR_DIR: e.ledgerDir, TAI_INTEGRIDAD_CONFIG: '', TAI_INTEGRIDAD_DESACTIVAR: '', ...extra } });
  let r = lanzar(['integridad', 'ejecutar', '--confirmar', 'a'.repeat(32)], { [VAR_CODIGO]: e.codigo }); assert.equal(r.status, 4); assert.equal(invocaciones(e), 0);
  r = lanzar(['integridad', 'estado', '--ahora', new Date(T0).toISOString()]); assert.equal(r.status, 0); assert.equal(invocaciones(e), 0);
  r = lanzar(['integridad', 'ejecutar', '--preparar', '--json', '--ahora', new Date(T0).toISOString()]); assert.equal(r.status, 0); const sol = JSON.parse(r.stdout).datos.solicitud;
  r = lanzar(['integridad', 'ejecutar', '--confirmar', sol, '--ahora', new Date(T0 + 1000).toISOString()], {}); assert.equal(r.status, 4, 'sin el código del propietario no se ejecuta'); assert.equal(invocaciones(e), 0);
  r = lanzar(['integridad', 'ejecutar', '--preparar', '--json', '--ahora', new Date(T0).toISOString()]); const sol2 = JSON.parse(r.stdout).datos.solicitud;
  r = lanzar(['integridad', 'ejecutar', '--confirmar', sol2, '--json', '--ahora', new Date(T0 + 1000).toISOString()], { [VAR_CODIGO]: e.codigo }); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(JSON.parse(r.stdout).datos.ejecutado, true); assert.equal(invocaciones(e), 1);
  assert.ok(!r.stdout.includes(e.codigo) && !r.stderr.includes(e.codigo) && !r.stdout.includes(e.raiz), 'sin eco del código ni de rutas');
  r = lanzar(['integridad', 'ejecutar', '--confirmar', sol2], { [VAR_CODIGO]: e.codigo }); assert.equal(r.status, 4);
  const libre = spawnSync(process.execPath, [CONSOLA, 'consola'], { input: 'integridad ejecutar --preparar\nsalir\n', encoding: 'utf8', timeout: 60000, env: { ...process.env, TAI_DIRECTOR_DIR: e.ledgerDir, TAI_INTEGRIDAD_CONFIG: '', [VAR_CODIGO]: e.codigo } }); assert.equal(archivosSolicitud(e).length, 0, 'el modo interactivo no ofrece la ejecución');
});

test('EMPAQUETADO Y AISLAMIENTO ESTÁTICO · la consulta no importa el ejecutor; la consola solo lo carga bajo demanda; el módulo nuevo entra en el cierre de imports y no hay cambios en el manifiesto', () => {
  const dir = path.join(AQUI, '..', 'integridad'); assert.ok(!/ejecutar-manual|ejecucion\.mjs|child_process/.test(fs.readFileSync(path.join(dir, 'consola.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
  const c = fs.readFileSync(CONSOLA, 'utf8'); assert.ok(!/^import .*ejecutar-manual/m.test(c)); assert.equal((c.match(/await import\('\.\.\/\.\.\/automation\/director\/integridad\/ejecutar-manual\.mjs'\)/g) ?? []).length, 1);
  const lista = calcularArchivos(); assert.ok(lista.includes('automation/director/integridad/ejecutar-manual.mjs')); assert.ok(lista.includes('automation/director/integridad/ejecucion.mjs'));
});

/* ───────── supervivientes de la ronda de mutaciones de 3E.8.11: una prueba aislada por causa ───────── */
test('VERIFICADOR · un verificador construido a mano sobre un código CORTO tampoco se acepta (el mínimo de longitud se exige también al comprobar)', async () => {
  const crypto = await import('node:crypto'); const sal = crypto.randomBytes(16); const v = `scrypt1$${sal.toString('hex')}$${crypto.scryptSync('corto', sal, 64).toString('hex')}`;
  assert.match(v, /^scrypt1\$[0-9a-f]{32}\$[0-9a-f]{128}$/); assert.equal(comprobarCodigo('corto', v), false);
});

test('LEDGER AJENO A LA ACTIVACIÓN · si `ledgerDir` apunta a una carpeta que no existe, la ejecución se deniega y NO la crea', () => {
  const e = nuevo(); const otra = path.join(e.raiz, 'ledger-que-no-existe'); reescribir(e, { ledgerDir: otra });
  const r = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); assert.deepEqual([r.codigo, r.datos.motivo], [4, 'ledger_inexistente']); assert.equal(fs.existsSync(otra), false);
});

test('SOLICITUD NO ESCRITA · si no se puede escribir la solicitud la etapa 1 se deniega (no hay «preparada» sin archivo)', () => {
  const e = nuevo(); const escribir = fs.writeFileSync; fs.writeFileSync = (p, ...a) => { if (String(p).includes('integridad-solicitud-')) { const x = new Error('sin espacio'); x.code = 'ENOSPC'; throw x; } return escribir(p, ...a); };
  try { const r = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); assert.deepEqual([r.codigo, r.datos.motivo, r.datos.preparada], [4, 'solicitud_no_escrita', undefined]); } finally { fs.writeFileSync = escribir; }
  assert.deepEqual(archivosSolicitud(e), []);
});

test('SOLICITUD MANIPULADA · una solicitud con otro esquema o de otro almacén (aunque traiga la huella correcta) se descarta como inválida y no ejecuta nada', async () => {
  const e = nuevo(); for (const cambio of [{ esquema: 'otro/1' }, { idAlmacen: 'otro' }]) {
    const p = prepararEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 }); const f = path.join(e.ledgerDir, archivosSolicitud(e)[0]); fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...cambio }));
    const r = await confirmarEjecucion({ ledgerDir: e.ledgerDir, env: env(e), ahora: T0 + 1000, solicitud: p.datos.solicitud }); assert.deepEqual([r.codigo, r.datos.motivo], [4, 'solicitud_invalida']); assert.deepEqual(archivosSolicitud(e), []);
  }
  assert.equal(invocaciones(e), 0);
});
