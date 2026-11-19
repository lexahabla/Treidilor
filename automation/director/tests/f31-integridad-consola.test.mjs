// Agente 00 · 3E.8.10 · Integración de la integridad en la CONSOLA del Director: solo consulta, desactivada por defecto, sin efectos secundarios.
// Todo con ledgers, claves y carpetas SINTÉTICOS en el directorio temporal; el «comando de integridad» es un programa falso. Nada toca almacenes, VPS ni producción.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LedgerLocal } from '../ledger.mjs';
import { CONFIG_INTEGRIDAD } from '../integridad/config.mjs';
import { anclar } from '../integridad/ancla.mjs';
import { ejecutarIntegridadSupervisada } from '../integridad/ejecucion.mjs';
import { firmarDocumento, generarParClaves } from '../integridad/copia-ancla.mjs';
import { ARCHIVO_ACTIVACION, ESQUEMA_ACTIVACION, USO_INTEGRIDAD, comandoIntegridad, leerActivacion, sanear, validarActivacion } from '../integridad/consola.mjs';
import { calcularArchivos, EXCLUIDOS, FORMATO } from '../../../scripts/automation/empaquetar-director.mjs';
import { ejecutarComando, construirDirector } from '../../../scripts/automation/director.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = path.join(AQUI, '..', 'integridad', 'consola.mjs');
const CONSOLA = path.join(AQUI, '..', '..', '..', 'scripts', 'automation', 'director.mjs');
const dirs = []; after(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-int810-')); dirs.push(d); return d; };
const H = 3600000; const T0 = Date.parse('2027-03-31T10:00:00.000Z'); let ahoraL = T0;
const crearLedger = (dir) => new LedgerLocal({ dir, particion: 'integridad', reloj: () => new Date(ahoraL), raiz: '/__sin_raiz__' });
const cab = (seq, c = 'c') => ({ seq, huella: `sha256:${String(seq).padStart(2, '0')}${c.repeat(62)}` });
const claves = generarParClaves();
const BASE = { esquema: ESQUEMA_ACTIVACION, habilitada: true, autorizadoPor: 'propietario', idAlmacen: 'g' };
const activar = (dir, extra = {}) => { fs.writeFileSync(path.join(dir, ARCHIVO_ACTIVACION), JSON.stringify({ ...BASE, ...extra })); return dir; };
const consulta = (dir, sub = 'estado', env = {}, ahora = ahoraL) => comandoIntegridad({ sub, ledgerDir: dir, env, ahora });
// instantánea de una carpeta: nombres, tamaños, fechas y contenido (para probar «sin efectos»)
const foto = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((n) => { const f = path.join(dir, n); const st = fs.statSync(f); return [n, st.isDirectory() ? 'd' : `${st.size}:${st.mtimeMs}:${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}`]; });
const falso = (cuerpo) => { const f = path.join(tmp(), 'cli-falso.mjs'); fs.writeFileSync(f, cuerpo); return f; };
const salidaOk = (extra = {}) => ({ formato: 'integridad-ejecucion/1', resultado: 'ok', nivel: 'ok', codigoSalida: 0, omitida: false, tentativa: { completa: true, cabeza: cab(9), segmentos: 1, eventosTotales: 9, comparacion: 'primera', referencia: 'ausente', anclaExterna: 'sin_ancla', reintento: false, motivos: [] }, registroEscrito: true, recursos: { cpuMs: 1, maxRssMiB: 40 }, ...extra });
const cliQue = (obj, codigo) => falso(`console.log(JSON.stringify(${JSON.stringify(obj)})); process.exitCode = ${codigo};`);
const correr = (l, cli, extra = {}) => ejecutarIntegridadSupervisada({ ledger: l, idAlmacen: 'g', almacenDir: path.join(tmp(), 'almacen-falso'), cli, reloj: () => ahoraL, config: { ...CONFIG_INTEGRIDAD, timeoutMs: 8000 }, forzar: true, ...extra });
const conHistorial = async (dir) => { const l = crearLedger(dir); ahoraL = T0; const r = await correr(l, cliQue(salidaOk(), 0)); assert.equal(r.resultado, 'ok'); return l; };

test('DESACTIVADA POR DEFECTO · sin configuración la consulta responde «desactivada», no abre el ledger de integridad, no escribe ni crea nada y no se confunde con un error', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'ledger-principal.jsonl'), ''); const antes = foto(d);
  for (const sub of [undefined, 'estado', 'ancla']) { const r = consulta(d, sub); assert.deepEqual([r.codigo, r.datos.activa, r.datos.motivo], [0, false, 'sin_configuracion']); assert.match(r.texto, /DESACTIVADA/); }
  assert.deepEqual(foto(d), antes, 'ni un archivo creado ni tocado'); assert.equal(fs.existsSync(path.join(d, 'ledger-integridad.jsonl')), false);
  assert.equal(consulta(path.join(d, 'no-existe')).datos.activa, false); assert.equal(fs.existsSync(path.join(d, 'no-existe')), false, 'la carpeta inexistente tampoco se crea');
});

test('LA AUSENCIA O EL ERROR DE CONFIGURACIÓN EQUIVALE A DESACTIVADO · cada causa por separado (no booleano, sin autorización, esquema, campo desconocido, JSON roto, secreto, tamaño, directorio, interruptor, permisos)', () => {
  const casos = [
    ['habilitada: false', { habilitada: false }, 'habilitada_no_es_true'], ['habilitada: "true" (texto)', { habilitada: 'true' }, 'habilitada_no_es_true'], ['habilitada: 1', { habilitada: 1 }, 'habilitada_no_es_true'],
    ['sin autorización del propietario', { autorizadoPor: 'cualquiera' }, 'configuracion_invalida:autorizacion'], ['esquema distinto', { esquema: 'otro/9' }, 'configuracion_invalida:esquema'],
    ['campo desconocido', { politica: { intervaloMs: 1 } }, 'configuracion_invalida:campo_desconocido'], ['idAlmacen inválido', { idAlmacen: '../x' }, 'configuracion_invalida:idAlmacen'],
    ['copiaExterna incompleta', { copiaExterna: { destino: 'x' } }, 'configuracion_invalida:copiaExterna'], ['copiaExterna con campo extra', { copiaExterna: { destino: 'x', clavePublicaArchivo: 'y', clavePrivada: 'z' } }, 'configuracion_invalida:copiaExterna'],
    ['referencia negativa', { referenciaFrescura: { contadorMinimo: -1 } }, 'configuracion_invalida:referenciaFrescura'], ['ledgerDir vacío', { ledgerDir: '' }, 'configuracion_invalida:ledgerDir'],
  ];
  for (const [nombre, extra, motivo] of casos) { const d = tmp(); activar(d, extra); const r = consulta(d); assert.deepEqual([r.datos.activa, r.datos.motivo], [false, motivo], nombre); }
  const d = tmp(); const f = path.join(d, ARCHIVO_ACTIVACION);
  fs.writeFileSync(f, '{roto'); assert.equal(consulta(d).datos.motivo, 'configuracion_ilegible');
  fs.writeFileSync(f, JSON.stringify({ ...BASE, idAlmacen: 'g', ledgerDir: `${'pass'}${'word'}: abcdefghijklmnop1234` })); assert.equal(consulta(d).datos.motivo, 'configuracion_con_secretos');
  fs.writeFileSync(f, ' '.repeat(20000)); assert.equal(consulta(d).datos.motivo, 'configuracion_invalida:tamano_o_tipo');
  fs.rmSync(f); fs.mkdirSync(f); assert.equal(consulta(d).datos.motivo, 'configuracion_invalida:tamano_o_tipo', 'un directorio con ese nombre no es una configuración');
  fs.rmdirSync(f); activar(d); assert.equal(leerActivacion({ ledgerDir: d, env: {} }).activa, true, 'control: la configuración correcta sí activa');
  assert.equal(consulta(d, 'estado', { TAI_INTEGRIDAD_DESACTIVAR: 'si' }).datos.motivo, 'desactivada_por_variable'); assert.equal(consulta(d, 'estado', { TAI_INTEGRIDAD_DESACTIVAR: 'SI' }).datos.activa, false); assert.equal(consulta(d, 'estado', { TAI_INTEGRIDAD_DESACTIVAR: 'no' }).datos.activa === false && consulta(d, 'estado', { TAI_INTEGRIDAD_DESACTIVAR: 'no' }).datos.motivo === 'desactivada_por_variable', false, 'otro valor del interruptor no desactiva');
  const lee = fs.readFileSync; fs.readFileSync = (p, ...a) => { if (String(p).endsWith(ARCHIVO_ACTIVACION)) { const e = new Error('denegado'); e.code = 'EACCES'; throw e; } return lee(p, ...a); };
  try { const r = consulta(d); assert.deepEqual([r.datos.activa, r.datos.motivo], [false, 'configuracion_sin_permiso'], 'permisos insuficientes = desactivada, sin lanzar'); } finally { fs.readFileSync = lee; }
});

test('VALIDACIÓN PURA · la activación exige exactamente el esquema, `habilitada === true` y la autorización del propietario; los opcionales se validan', () => {
  assert.equal(validarActivacion(BASE).ok, true); assert.equal(validarActivacion({ ...BASE, ledgerDir: 'x', copiaExterna: { destino: 'a', clavePublicaArchivo: 'b' }, referenciaFrescura: { contadorMinimo: 0 } }).ok, true);
  for (const mal of [null, [], 'x', 7, {}, { ...BASE, habilitada: undefined }]) assert.equal(validarActivacion(mal).ok, false);
});

test('ACTIVACIÓN EXPLÍCITA (simulada) · muestra última satisfactoria, última tentativa, próxima prevista, vencimiento, alteración y errores; nada de rutas, claves ni huellas completas', async () => {
  const d = tmp(); await conHistorial(d); activar(d); const r = consulta(d, 'estado', {}, T0 + H);
  assert.equal(r.codigo, 0); const x = r.datos; assert.deepEqual([x.activa, x.nivel, x.vencimiento, x.alteracionConfirmada, x.errorOperativo], [true, 'ok', 'vigente', false, false]);
  assert.equal(x.ultimaSatisfactoria.resultado, 'ok'); assert.equal(x.ultimaTentativa.resultado, 'ok'); assert.equal(x.siguienteComprobacion, new Date(T0 + 6 * H).toISOString()); assert.equal(x.tocaVerificar.debe, false); assert.equal(x.ancla.estado, 'vigente');
  const todo = `${r.texto}\n${JSON.stringify(x)}`; assert.ok(!todo.includes(d), 'ninguna ruta'); assert.ok(!/sha256:[0-9a-f]{64}/.test(todo), 'ninguna huella completa'); assert.ok(!/PRIVATE KEY/.test(todo)); assert.match(r.texto, /no se ha ejecutado ninguna verificación/);
  const v = consulta(d, 'estado', {}, T0 + 13 * H).datos; assert.deepEqual([v.vencimiento, v.nivel], ['vencida', 'aviso']); const c = consulta(d, 'estado', {}, T0 + 25 * H).datos; assert.deepEqual([c.vencimiento, c.nivel], ['caducada', 'fallo']); assert.equal(c.tocaVerificar.debe, true);
});

test('LA CONSULTA NO TIENE EFECTOS · estado y ancla, activadas o no, dejan la carpeta idéntica (nombres, tamaños, fechas y contenido) y no lanzan ningún proceso', async () => {
  const d = tmp(); await conHistorial(d); activar(d); const antes = foto(d);
  const sp = spawnSync; const lanzados = []; const cp = await import('node:child_process'); const orig = cp.default.spawn; cp.default.spawn = (...a) => { lanzados.push(a[0]); return orig(...a); };
  try { for (let i = 0; i < 3; i += 1) for (const sub of ['estado', 'ancla', 'ayuda']) consulta(d, sub, {}, T0 + i * H); } finally { cp.default.spawn = orig; }
  assert.deepEqual(foto(d), antes, 'idéntica'); assert.deepEqual(lanzados, [], 'ningún proceso'); assert.ok(sp);
  const fuente = fs.readFileSync(FUENTE, 'utf8'); assert.equal(/child_process|ejecucion\.mjs|setInterval|setTimeout|writeFileSync|appendFileSync|mkdirSync|\.anadir\(|anclar\(|exportarAncla/.test(fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), false, 'el módulo no puede ejecutar, escribir ni programar nada');
});

test('NO HAY COMANDO PARA EJECUTAR · «ejecutar», «verificar», «anclar», «reanclar» o «exportar» son subcomandos desconocidos (código 1) incluso con la funcionalidad activada; no se escribe nada', async () => {
  const d = tmp(); await conHistorial(d); activar(d); const antes = foto(d);
  for (const sub of ['ejecutar', 'verificar', 'anclar', 'reanclar', 'exportar', 'forzar', '--forzar']) { const r = consulta(d, sub); assert.equal(r.codigo, 1, sub); assert.match(r.texto, /solo CONSULTA/); }
  assert.deepEqual(foto(d), antes);
});

test('ACTIVADA PERO SIN LEDGER · si la carpeta del ledger de integridad no existe se informa (código 2) sin crearla; un ledger vacío sale como «nunca verificada» (aviso), no como error', () => {
  const d = tmp(); activar(d, { ledgerDir: path.join(d, 'otra') }); const r = consulta(d); assert.deepEqual([r.codigo, r.datos.motivo], [2, 'ledger_integridad_inexistente']); assert.equal(fs.existsSync(path.join(d, 'otra')), false);
  const e = tmp(); activar(e); const antes = foto(e); const v = consulta(e); assert.deepEqual([v.codigo, v.datos.nivel, v.datos.vencimiento], [0, 'aviso', 'nunca_verificada']); assert.deepEqual(foto(e), antes);
});

test('ERRORES OPERATIVOS Y ALTERACIÓN · un error del comando se ve como error operativo (no alteración); un retroceso confirmado como alteración (fallo); el estado lo refleja tal cual lo escribió el supervisor', async () => {
  const d = tmp(); const l = await conHistorial(d); activar(d); ahoraL = T0 + 6 * H;
  await correr(l, cliQue({ ...salidaOk(), resultado: 'error', nivel: 'aviso', codigoSalida: 3, tentativa: { ...salidaOk().tentativa, completa: false, motivos: ['almacen_inestable_durante_la_verificacion'] } }, 3)); let x = consulta(d, 'estado', {}, ahoraL).datos;
  assert.deepEqual([x.errorOperativo, x.alteracionConfirmada, x.ultimaTentativa.resultado], [true, false, 'error']);
  ahoraL = T0 + 7 * H; await correr(l, cliQue({ ...salidaOk(), resultado: 'retroceso', nivel: 'fallo', codigoSalida: 1, tentativa: { ...salidaOk().tentativa, completa: false, anclaExterna: 'posterior', motivos: ['ancla_externa_posterior'] } }, 1)); x = consulta(d, 'estado', {}, ahoraL).datos;
  assert.deepEqual([x.alteracionConfirmada, x.nivel], [true, 'fallo']); assert.ok(x.alertas.some((a) => a.codigo === 'integridad_alteracion_confirmada' && a.nivel === 'fallo'));
});

test('ANCLA Y COPIA EXTERNA · sin copia configurada; con copia vigente, obsoleta (referencia del propietario), discrepante y con clave pública inválida; nunca rutas ni claves', async () => {
  const d = tmp(); const l = crearLedger(d); ahoraL = T0; anclar(l, { idAlmacen: 'g', cabeza: cab(9), motivo: 'primera_ancla' }); activar(d);
  let r = consulta(d, 'ancla'); assert.deepEqual([r.datos.ancla.estado, r.datos.copiaExterna.configurada], ['vigente', false]); assert.match(r.texto, /no configurada/);
  const destino = path.join(tmp(), 'copias'); fs.mkdirSync(destino); const pub = path.join(tmp(), 'publica.pem'); fs.writeFileSync(pub, claves.publica);
  const doc = (contador, seq, x = 'c') => fs.writeFileSync(path.join(destino, `ancla-g-${String(contador).padStart(8, '0')}.json`), `${JSON.stringify(firmarDocumento({ esquema: 'ancla-externa/1', idAlmacen: 'g', contador, seq, huella: cab(seq, x).huella, emitidoEn: new Date(T0).toISOString(), ledgerSecuencia: 1, previa: null }, claves.privada))}\n`);
  doc(1, 9); activar(d, { copiaExterna: { destino, clavePublicaArchivo: pub } }); r = consulta(d, 'ancla'); assert.deepEqual([r.datos.copiaExterna.estado, r.datos.copiaExterna.contraste, r.datos.copiaExterna.discrepante], ['sin_referencia_de_frescura', 'coinciden', false]);
  activar(d, { copiaExterna: { destino, clavePublicaArchivo: pub }, referenciaFrescura: { contadorMinimo: 1 } }); assert.equal(consulta(d, 'ancla').datos.copiaExterna.estado, 'vigente');
  activar(d, { copiaExterna: { destino, clavePublicaArchivo: pub }, referenciaFrescura: { contadorMinimo: 4 } }); r = consulta(d, 'ancla'); assert.equal(r.datos.copiaExterna.estado, 'obsoleta'); assert.match(r.texto, /más antigua que la referencia/);
  fs.rmSync(path.join(destino, 'ancla-g-00000001.json')); doc(1, 9, 'e'); activar(d, { copiaExterna: { destino, clavePublicaArchivo: pub } }); r = consulta(d, 'ancla'); assert.deepEqual([r.datos.copiaExterna.discrepante, r.datos.copiaExterna.contraste], [true, 'distintas']); assert.match(r.texto, /discrepan/);
  const priv = path.join(tmp(), 'privada.pem'); fs.writeFileSync(priv, claves.privada); activar(d, { copiaExterna: { destino, clavePublicaArchivo: priv } }); r = consulta(d, 'ancla'); assert.equal(r.datos.copiaExterna.estado, 'clave_publica_no_disponible', 'una clave privada nunca se lee como pública');
  const todo = `${r.texto}${JSON.stringify(r.datos)}`; assert.ok(!todo.includes(destino) && !todo.includes(pub) && !todo.includes(priv) && !/PRIVATE KEY/.test(todo));
  activar(d, { copiaExterna: { destino: path.join(destino, 'no-hay'), clavePublicaArchivo: pub } }); assert.equal(consulta(d, 'ancla').datos.copiaExterna.estado, 'destino_inexistente');
});

test('INTEGRIDAD DEL LEDGER Y REINICIO · un ledger con cola incompleta se informa como fallo `ancla_ilegible` sin lanzar ni escribir; tras recuperarla con el mecanismo existente y «reiniciar» (instancias nuevas) el estado vuelve a ser el mismo', async () => {
  const d = tmp(); const l = await conHistorial(d); activar(d); const normal = JSON.stringify(consulta(d, 'estado', {}, T0 + H).datos);
  fs.appendFileSync(l.archivo, '{"incompleto'); const roto = fs.readFileSync(l.archivo); const x = consulta(d, 'estado', {}, T0 + H).datos; assert.deepEqual([x.nivel, x.ancla.estado], ['fallo', 'ilegible']); assert.ok(x.alertas.some((a) => a.codigo === 'ancla_ilegible')); assert.deepEqual(fs.readFileSync(l.archivo), roto, 'la consulta no repara ni toca');
  assert.equal(crearLedger(d).recuperarColaIncompleta().recuperado, true); assert.equal(JSON.stringify(consulta(d, 'estado', {}, T0 + H).datos), normal, 'misma respuesta tras reiniciar');
});

test('ESTADO PERSISTE ENTRE PROCESOS · la consola real (proceso nuevo) lee lo escrito antes, desactivada por defecto y con el mismo contrato; el texto libre que empieza por «integridad» sigue yendo al intérprete', async () => {
  const d = tmp(); await conHistorial(d);
  const lanzar = (args, entrada) => spawnSync(process.execPath, [CONSOLA, ...args], { input: entrada, encoding: 'utf8', env: { ...process.env, TAI_DIRECTOR_DIR: d, TAI_INTEGRIDAD_CONFIG: '', TAI_INTEGRIDAD_DESACTIVAR: '' }, timeout: 60000 });
  const off = lanzar(['integridad', 'estado', '--json']); assert.equal(off.status, 0); assert.equal(JSON.parse(off.stdout).datos.activa, false);
  activar(d); const on = lanzar(['integridad', 'estado', '--json', '--ahora', new Date(T0 + H).toISOString()]); assert.equal(on.status, 0); assert.deepEqual([JSON.parse(on.stdout).datos.activa, JSON.parse(on.stdout).datos.nivel], [true, 'ok']);
  const libre = lanzar(['consola'], 'integridad del diario\nsalir\n'); assert.ok(!/desconocido|solo CONSULTA/.test(libre.stdout), 'el texto libre no se interpreta como el comando'); const cmd = lanzar(['consola'], 'integridad estado\nsalir\n'); assert.match(cmd.stdout, /Integridad del diario/);
});

test('COMPATIBILIDAD · desactivada, la ayuda de la consola y los comandos anteriores no cambian; el comando nuevo solo añade una rama y se lleva el mismo `ctx`', () => {
  const d = tmp(); const { director, ledger } = construirDirector({ ledger: d }, { ...process.env, TAI_DIRECTOR_DIR: d }); const ctx = { director, ledger };
  const ayuda = ejecutarComando(['ayuda'], {}, ctx).texto; assert.ok(!/integridad/i.test(ayuda), 'la ayuda de la consola anterior queda idéntica'); assert.equal(ejecutarComando(['agentes'], {}, ctx).codigo, 0); assert.equal(ejecutarComando(['ledger', 'verificar'], {}, ctx).codigo, 0);
  const r = ejecutarComando(['integridad', 'estado'], {}, { ...ctx, env: { ...process.env, TAI_INTEGRIDAD_CONFIG: '' } }); assert.deepEqual([r.codigo, r.datos.activa], [0, false]); assert.equal(ejecutarComando(['integridad', 'ayuda'], {}, ctx).texto, USO_INTEGRIDAD);
  assert.equal(fs.existsSync(path.join(d, 'ledger-integridad.jsonl')), false, 'consultar no crea el ledger de integridad');
});

test('SANEADO · ninguna ruta absoluta (Windows, POSIX o UNC) ni cadena con forma de credencial sale por la consola', () => {
  assert.equal(sanear('C:\\Users\\x\\a.json'), '[ruta oculta]'); assert.equal(sanear('/var/lib/tai/ledger'), '[ruta oculta]'); assert.equal(sanear('\\\\srv\\share'), '[ruta oculta]'); assert.equal(sanear(`${'Bea'}${'rer'} abcdefghijklmnopqrstuvwxyz0123`), '[oculto]');
  assert.deepEqual(sanear({ a: ['C:/x/y', 'ok'], b: { c: `${'sk'}-${'ant'}-abcdefghijklmnop` } }), { a: ['[ruta oculta]', 'ok'], b: { c: '[oculto]' } }); assert.equal(sanear('texto normal 12/05'), 'texto normal 12/05'); assert.equal(sanear(5), 5);
});

test('DISTRIBUIBLE · el árbol incluye consola.mjs con todas sus dependencias dentro del cierre de imports; el formato del manifiesto no cambia; la configuración de activación nunca entra en un paquete', () => {
  const lista = calcularArchivos(); for (const f of ['automation/director/integridad/consola.mjs', 'automation/director/integridad/estado.mjs', 'automation/director/integridad/ancla.mjs', 'automation/director/integridad/copia-ancla.mjs', 'automation/director/integridad/config.mjs', 'scripts/automation/director.mjs']) assert.ok(lista.includes(f), f);
  assert.equal(FORMATO, 'treidilor-director-tar/1'); assert.ok(!lista.some((f) => /integridad-activacion/.test(f))); assert.ok(EXCLUIDOS.some((rx) => rx.test('automation/director/integridad-activacion.json')) && EXCLUIDOS.some((rx) => rx.test('automation/config/integridad-activacion.local.json')), 'si alguien lo deja en el árbol, no se empaqueta');
  assert.ok(!lista.some((f) => /tests\//.test(f)));
});

test('RUTA ALTERNATIVA Y ENTORNO · `TAI_INTEGRIDAD_CONFIG` sustituye al archivo junto al ledger (no se suman); el entorno de la consola llega al comando, así que el interruptor de desactivación también manda desde la consola', async () => {
  const d = tmp(); await conHistorial(d); const otra = tmp(); const f = path.join(otra, 'activacion-externa.json'); fs.writeFileSync(f, JSON.stringify(BASE));
  assert.equal(consulta(d).datos.activa, false, 'junto al ledger no hay nada'); assert.equal(consulta(d, 'estado', { TAI_INTEGRIDAD_CONFIG: f }, T0 + H).datos.activa, true, 'la ruta alternativa activa');
  activar(d); fs.writeFileSync(f, JSON.stringify({ ...BASE, habilitada: false })); assert.deepEqual([consulta(d, 'estado', { TAI_INTEGRIDAD_CONFIG: f }).datos.activa, consulta(d, 'estado', { TAI_INTEGRIDAD_CONFIG: f }).datos.motivo], [false, 'habilitada_no_es_true'], 'con ruta alternativa, el archivo junto al ledger se ignora');
  const { director, ledger } = construirDirector({ ledger: d }, { ...process.env, TAI_DIRECTOR_DIR: d }); const ctx = { director, ledger, env: { TAI_INTEGRIDAD_CONFIG: '', TAI_INTEGRIDAD_DESACTIVAR: '' } };
  assert.equal(ejecutarComando(['integridad', 'estado'], {}, ctx).datos.activa, true); assert.deepEqual([ejecutarComando(['integridad', 'estado'], {}, { ...ctx, env: { TAI_INTEGRIDAD_DESACTIVAR: 'si' } }).datos.activa, ejecutarComando(['integridad', 'estado'], {}, { ...ctx, env: { TAI_INTEGRIDAD_DESACTIVAR: 'si' } }).datos.motivo], [false, 'desactivada_por_variable']);
});
