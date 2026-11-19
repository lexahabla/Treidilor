// Agente 00 · F1.2 · ledger local de solo adición: integridad, recuperación ante fallos, concurrencia, secretos, copias.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ErrorLedger, GENESIS, LedgerLocal, detectarSecreto } from '../ledger.mjs';
import { crearGeneradorIds, sha256 } from '../protocolo.mjs';
import { proyectar } from '../proyecciones.mjs';
import { validarEsquema } from '../../../scripts/automation/validate-schema.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'evento-ledger.schema.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tai-ledger-'));
let reloj = Date.parse('2026-11-14T12:00:00.000Z');
const nuevo = (dir = tmp(), extra = {}) => new LedgerLocal({ dir, reloj: () => new Date((reloj += 1000)), ids: crearGeneradorIds({ reloj: () => reloj }), ...extra });
const ev = (n = 0, extra = {}) => ({ tipo: 'lectura_estado', actor: 'sistema', refs: {}, datos: { n }, ...extra });
const limpiar = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

test('añadir: secuencia sin huecos, instante asignado por el ledger, cadena de huellas y esquema evento-ledger/1', () => {
  const dir = tmp();
  const l = nuevo(dir);
  assert.equal(l.ultimaSecuencia(), 0);
  const a = l.anadir(ev(1, { instante: '1999-01-01T00:00:00Z' })).evento; // el cliente NO fija el instante
  const b = l.anadir(ev(2)).evento;
  assert.equal(a.secuencia, 1);
  assert.equal(b.secuencia, 2);
  assert.equal(a.huellaPrevia, GENESIS);
  assert.equal(b.huellaPrevia, a.huella);
  assert.ok(a.instante.startsWith('2026-11-14'), 'instante del ledger, no del cliente');
  assert.deepEqual(validarEsquema(a, ESQ), []);
  assert.deepEqual(validarEsquema(b, ESQ), []);
  assert.equal(l.verificarCadena().ok, true);
  assert.equal(l.leer().length, 2);
  assert.deepEqual(l.leer({ tipo: 'lectura_estado', desde: 2 }).map((e) => e.secuencia), [2]);
  limpiar(dir);
});

test('solo añadir: el ledger no ofrece ninguna operación de borrado ni de edición', () => {
  const l = nuevo();
  for (const m of ['borrar', 'eliminar', 'editar', 'actualizar', 'sobrescribir', 'delete', 'update', 'truncate']) assert.equal(typeof l[m], 'undefined', m);
  limpiar(l.dir);
});

test('comparación de secuencia: si otra escritura se coló, falla y no escribe', () => {
  const l = nuevo();
  l.anadir(ev(1));
  l.anadir(ev(2));
  assert.throws(() => l.anadir(ev(3), 1), (e) => e.codigo === 'conflicto_secuencia' && e.detalle.actual === 2);
  assert.equal(l.ultimaSecuencia(), 2, 'nada se escribió');
  assert.equal(l.anadir(ev(3), 2).evento.secuencia, 3);
  limpiar(l.dir);
});

test('idempotencia por idEvento: el mismo contenido no duplica; otro contenido es un error', () => {
  const l = nuevo();
  const a = l.anadir(ev(1, { idEvento: 'e_fijo' }));
  const b = l.anadir(ev(1, { idEvento: 'e_fijo' }));
  assert.equal(a.duplicado, false);
  assert.equal(b.duplicado, true);
  assert.equal(b.evento.huella, a.evento.huella);
  assert.equal(l.ultimaSecuencia(), 1);
  assert.throws(() => l.anadir(ev(2, { idEvento: 'e_fijo' })), (e) => e.codigo === 'idEvento_duplicado_distinto');
  limpiar(l.dir);
});

test('integridad: alterar un evento, borrar uno intermedio o reordenar rompe la cadena (se detecta, no se repara)', () => {
  for (const manipular of [
    (lineas) => { const e = JSON.parse(lineas[1]); e.datos.n = 999; lineas[1] = JSON.stringify(e); return lineas; },
    (lineas) => lineas.filter((_, i) => i !== 1),
    (lineas) => [lineas[0], lineas[2], lineas[1], lineas[3]],
  ]) {
    const l = nuevo();
    for (let i = 0; i < 4; i++) l.anadir(ev(i));
    const lineas = fs.readFileSync(l.archivo, 'utf8').trimEnd().split('\n');
    fs.writeFileSync(l.archivo, `${manipular(lineas).join('\n')}\n`);
    const v = new LedgerLocal({ dir: l.dir }).verificarCadena();
    assert.equal(v.ok, false);
    assert.ok(v.errores.length > 0);
    const l2 = new LedgerLocal({ dir: l.dir });
    assert.throws(() => l2.anadir(ev(9)), (e) => e.codigo === 'ledger_corrupto', 'un ledger corrupto no admite más eventos');
    assert.throws(() => l2.leer(), (e) => e.codigo === 'ledger_corrupto');
    limpiar(l.dir);
  }
});

test('truncado de líneas completas: lo detecta el archivo ancla', () => {
  const l = nuevo();
  for (let i = 0; i < 5; i++) l.anadir(ev(i));
  const lineas = fs.readFileSync(l.archivo, 'utf8').trimEnd().split('\n');
  fs.writeFileSync(l.archivo, `${lineas.slice(0, 3).join('\n')}\n`); // se pierden los 2 últimos eventos limpiamente
  const v = new LedgerLocal({ dir: l.dir }).verificarCadena();
  assert.equal(v.ok, false);
  assert.match(v.errores[0], /truncado/);
  limpiar(l.dir);
});

test('recuperación ante fallos: una escritura interrumpida se detecta, se aparta SIN borrarla y queda constancia', () => {
  const l = nuevo();
  l.anadir(ev(1));
  l.anadir(ev(2));
  const antes = fs.readFileSync(l.archivo);
  fs.appendFileSync(l.archivo, '{"idEvento":"e_roto","secuencia":3,"tipo":"lectura_es'); // cola truncada a mitad de línea
  const l2 = new LedgerLocal({ dir: l.dir });
  const est = l2.estado();
  assert.equal(est.ok, false);
  assert.ok(est.colaIncompleta && est.colaIncompleta.bytes > 0);
  assert.equal(est.errores.length, 0, 'no es corrupción: es una cola incompleta');
  assert.equal(l2.leer().length, 2, 'los eventos íntegros siguen legibles');
  assert.throws(() => l2.anadir(ev(3)), (e) => e.codigo === 'ledger_cola_incompleta', 'no se añade encima de una cola rota');
  const r = l2.recuperarColaIncompleta();
  assert.equal(r.recuperado, true);
  assert.ok(fs.existsSync(path.join(l.dir, r.archivoHuerfano)), 'los bytes apartados se conservan');
  assert.match(fs.readFileSync(path.join(l.dir, r.archivoHuerfano), 'utf8'), /e_roto/);
  const ev3 = l2.leer();
  assert.equal(ev3.length, 3);
  assert.equal(ev3[2].tipo, 'error');
  assert.equal(ev3[2].datos.motivo, 'cola_incompleta_recuperada');
  assert.equal(l2.verificarCadena().ok, true);
  assert.deepEqual(fs.readFileSync(l.archivo).subarray(0, antes.length), antes, 'los eventos anteriores no cambiaron ni un byte');
  assert.equal(l2.recuperarColaIncompleta().recuperado, false, 'sin cola rota no hay nada que hacer');
  limpiar(l.dir);
});

test('recuperación: un último evento completo al que solo falta el salto de línea se conserva', () => {
  const l = nuevo();
  l.anadir(ev(1));
  l.anadir(ev(2));
  const t = fs.readFileSync(l.archivo, 'utf8');
  fs.writeFileSync(l.archivo, t.slice(0, -1)); // quita solo el \n final
  const l2 = new LedgerLocal({ dir: l.dir });
  assert.equal(l2.verificarCadena().ok, true);
  assert.equal(l2.anadir(ev(3)).evento.secuencia, 3, 'el siguiente evento repara el salto sin perder nada');
  assert.equal(new LedgerLocal({ dir: l.dir }).verificarCadena().ok, true);
  limpiar(l.dir);
});

test('un fallo de escritura se traduce a ledger_no_disponible y no deja medio evento', () => {
  const l = nuevo();
  l.anadir(ev(1));
  const tam = fs.statSync(l.archivo).size;
  l._escribirLinea = () => { const e = new Error('disco lleno'); e.code = 'ENOSPC'; throw e; };
  assert.throws(() => l.anadir(ev(2)), (e) => e instanceof ErrorLedger && e.codigo === 'ledger_no_disponible' && !/disco lleno/.test(e.message));
  assert.equal(fs.statSync(l.archivo).size, tam);
  assert.equal(fs.existsSync(l.cerrojo), false, 'el cerrojo se libera aunque falle');
  limpiar(l.dir);
});

test('si falla solo el ancla, el evento ya está escrito y encadenado y la siguiente escritura la regenera', () => {
  const l = nuevo();
  l.anadir(ev(1));
  l._escribirAncla = () => { throw new Error('x'); };
  assert.equal(l.anadir(ev(2)).evento.secuencia, 2);
  delete l._escribirAncla; // vuelve el método original del prototipo
  assert.equal(l.verificarCadena().ok, true);
  l.anadir(ev(3));
  assert.equal(JSON.parse(fs.readFileSync(l.ancla, 'utf8')).ultimaSecuencia, 3);
  limpiar(l.dir);
});

test('filtro de secretos: se rechaza el evento y el mensaje NO repite el valor', () => {
  const l = nuevo();
  const casos = [
    'sk-' + 'a1B2c3D4e5F6g7H8i9J0kL', 'Bearer ' + 'abcdefghijklmnopqrstuvwx', 'tai_' + '0123456789abcdef' + '_' + 'Z'.repeat(32),
    ['-----BEGIN', ' PRIVATE', ' KEY-----'].join(''), ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkw', 'abc'].join('.'), 'ghp_' + 'A'.repeat(30), 'password=' + 'hunter2hunter2xx',
  ];
  for (const secreto of casos) {
    assert.ok(detectarSecreto(secreto), `se detecta ${secreto.slice(0, 6)}…`);
    assert.throws(() => l.anadir(ev(0, { datos: { texto: `mira esto ${secreto}` } })), (e) => e.codigo === 'secreto_detectado' && !e.message.includes(secreto.slice(0, 12)));
  }
  assert.equal(l.ultimaSecuencia(), 0, 'nada se escribió');
  assert.equal(detectarSecreto('un texto normal sobre el catálogo y 04.auditar-catalogo'), null);
  limpiar(l.dir);
});

test('validación de entrada y tamaño: tipo, actor, forma y límite de bytes', () => {
  const l = nuevo(tmp(), { limites: { maxBytesEvento: 600 } });
  assert.throws(() => l.anadir(ev(0, { tipo: 'inventado' })), (e) => e.codigo === 'evento_invalido');
  assert.throws(() => l.anadir(ev(0, { actor: 'hacker' })), (e) => e.codigo === 'evento_invalido');
  assert.throws(() => l.anadir(ev(0, { datos: [] })), (e) => e.codigo === 'evento_invalido');
  assert.throws(() => l.anadir(null), (e) => e.codigo === 'evento_invalido');
  assert.throws(() => l.anadir(ev(0, { datos: { x: 'y'.repeat(2000) } })), (e) => e.codigo === 'evento_demasiado_grande');
  assert.equal(l.ultimaSecuencia(), 0);
  assert.ok(l.anadir(ev(0, { actor: 'agente:04' })).evento);
  limpiar(l.dir);
});

test('D3: el ledger vive FUERA del repositorio (se rechaza uno dentro) y la copia también', () => {
  const dentro = path.resolve(AQUI, '..', '..', '..', 'automation', 'ledger-no-permitido');
  assert.throws(() => new LedgerLocal({ dir: dentro }), (e) => e.codigo === 'ledger_dentro_del_repositorio');
  assert.equal(fs.existsSync(dentro), false, 'ni siquiera se crea el directorio');
  const l = nuevo();
  l.anadir(ev(1));
  assert.throws(() => l.copiaSeguridad(dentro), (e) => e.codigo === 'ledger_dentro_del_repositorio');
  assert.throws(() => l.exportar(dentro), (e) => e.codigo === 'ledger_dentro_del_repositorio');
  assert.throws(() => new LedgerLocal({ dir: tmp(), particion: '../mala' }), (e) => e.codigo === 'particion_invalida');
  assert.throws(() => new LedgerLocal({}), (e) => e.codigo === 'ledger_sin_directorio');
  limpiar(l.dir);
});

test('copia de seguridad y restauración PROBADAS: la copia es idéntica, verificable y no pisa un ledger existente', () => {
  const l = nuevo();
  for (let i = 0; i < 6; i++) l.anadir(ev(i));
  const copia = tmp();
  const dest = path.join(tmp(), 'restaurado');
  const c = l.copiaSeguridad(copia);
  assert.equal(c.eventos, 6);
  const r = LedgerLocal.restaurar(copia, dest, { raiz: '/__sin_raiz__' });
  assert.equal(r.eventos, 6);
  const rest = new LedgerLocal({ dir: dest, raiz: '/__sin_raiz__' });
  assert.deepEqual(rest.leer(), l.leer(), 'contenido idéntico');
  assert.equal(rest.anadir(ev(7)).evento.secuencia, 7, 'el restaurado sigue funcionando');
  assert.throws(() => LedgerLocal.restaurar(copia, dest, { raiz: '/__sin_raiz__' }), (e) => e.codigo === 'destino_no_vacio');
  // una copia manipulada no se restaura
  const lineas = fs.readFileSync(path.join(copia, path.basename(l.archivo)), 'utf8').trimEnd().split('\n');
  const e0 = JSON.parse(lineas[2]); e0.datos.n = 'manipulado'; lineas[2] = JSON.stringify(e0);
  fs.writeFileSync(path.join(copia, path.basename(l.archivo)), `${lineas.join('\n')}\n`);
  assert.throws(() => LedgerLocal.restaurar(copia, path.join(tmp(), 'otro'), { raiz: '/__sin_raiz__' }), (e) => e.codigo === 'copia_corrupta');
  limpiar(l.dir, copia, path.dirname(dest));
});

test('exportación íntegra con manifiesto y huella del archivo', () => {
  const l = nuevo();
  l.anadir(ev(1)); l.anadir(ev(2));
  const d = tmp();
  const m = l.exportar(d);
  assert.equal(m.eventos, 2);
  assert.equal(m.sha256Archivo, sha256(fs.readFileSync(path.join(d, path.basename(l.archivo)), 'utf8')));
  assert.ok(fs.existsSync(path.join(d, `${path.basename(l.archivo)}.manifiesto.json`)));
  limpiar(l.dir, d);
});

test('concurrencia entre PROCESOS: tres escritores a la vez no pierden ni duplican eventos y la cadena sigue íntegra', async () => {
  const dir = tmp();
  const lanzar = (prefijo) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(AQUI, '_escritor-ledger.mjs'), dir, prefijo, '15'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 ? resolve(JSON.parse(out)) : reject(new Error(`salida ${c}: ${err}`))));
  });
  const res = await Promise.all([lanzar('A'), lanzar('B'), lanzar('C')]);
  assert.deepEqual(res.map((r) => r.errores), [0, 0, 0], JSON.stringify(res.map((r) => r.codigos)));
  const l = new LedgerLocal({ dir, raiz: '/__sin_raiz__' });
  const v = l.verificarCadena();
  assert.equal(v.ok, true);
  assert.equal(v.ultimaSecuencia, 45);
  const porEscritor = {};
  for (const e of l.leer()) porEscritor[e.datos.escritor] = (porEscritor[e.datos.escritor] || 0) + 1;
  assert.deepEqual(porEscritor, { A: 15, B: 15, C: 15 });
  assert.equal(fs.existsSync(l.cerrojo), false);
  limpiar(dir);
});

test('un cerrojo huérfano antiguo se retira; uno reciente espera y acaba en ledger_ocupado', () => {
  const l = nuevo(tmp(), { limites: { esperaBloqueoMs: 150, bloqueoCaducaMs: 60000 } });
  fs.writeFileSync(l.cerrojo, '{}');
  assert.throws(() => l.anadir(ev(1)), (e) => e.codigo === 'ledger_ocupado');
  const viejo = new Date(Date.now() - 120000);
  fs.utimesSync(l.cerrojo, viejo, viejo);
  assert.equal(l.anadir(ev(1)).evento.secuencia, 1, 'el cerrojo caducado de un proceso muerto no bloquea para siempre');
  limpiar(l.dir);
});

test('proyecciones: se reconstruyen desde el ledger y una transición imposible NO se aplica (queda como anomalía)', () => {
  const l = nuevo();
  const sobre = { agente: '04', capacidad: '04.leer-ultimo-informe', prioridad: 'P3', profundidad: 0, parametros: {}, idCorrelacion: 'c_x' };
  l.anadir({ tipo: 'tarea_creada', actor: 'director', refs: { idTarea: 't_1', idCorrelacion: 'c_x' }, datos: { sobre, nivel: 'L0', huella: sha256('h') } });
  l.anadir({ tipo: 'tarea_estado', actor: 'director', refs: { idTarea: 't_1' }, datos: { estado: 'aceptada' } });
  l.anadir({ tipo: 'tarea_estado', actor: 'director', refs: { idTarea: 't_1' }, datos: { estado: 'en_curso' } });
  l.anadir({ tipo: 'tarea_estado', actor: 'director', refs: { idTarea: 't_1' }, datos: { estado: 'completada' } });
  l.anadir({ tipo: 'tarea_estado', actor: 'director', refs: { idTarea: 't_1' }, datos: { estado: 'en_curso' } }); // imposible: terminal → en_curso
  l.anadir({ tipo: 'tarea_estado', actor: 'director', refs: { idTarea: 't_inexistente' }, datos: { estado: 'aceptada' } });
  const p = proyectar(l.leer(), { ahora: reloj });
  assert.equal(p.tareas.get('t_1').estado, 'completada');
  assert.equal(p.anomalias.length, 2);
  assert.match(p.anomalias[0].motivo, /no permitida/);
  assert.equal(p.secuencia, 6);
  assert.equal(proyectar(new LedgerLocal({ dir: l.dir }).leer(), { ahora: reloj }).tareas.get('t_1').estado, 'completada', 'tras reiniciar se reconstruye igual');
  limpiar(l.dir);
});
