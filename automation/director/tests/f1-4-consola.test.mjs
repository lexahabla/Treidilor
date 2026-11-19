// Agente 00 · F1.4 · consola del Director (scripts/automation/director.mjs) ejecutada como PROCESO real con ledger y fixtures temporales.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
const CLI = path.join(RAIZ, 'scripts', 'automation', 'director.mjs');
const FIXTURES = path.join(AQUI, '..', 'fixtures');
const ENT = '2026-11-14T12:00:00Z';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tai-cli-'));

function cli(args, { ledger, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--ledger', ledger, '--instantaneas', FIXTURES, '--ahora', ENT], { encoding: 'utf8', env: { ...process.env, ...env }, input, timeout: 30000 });
  return { codigo: r.status, out: r.stdout, err: r.stderr };
}
const json = (args, ledger) => JSON.parse(cli([...args, '--json'], { ledger }).out);

test('ayuda y comando desconocido', () => {
  const l = tmp();
  const a = cli(['ayuda'], { ledger: l });
  assert.equal(a.codigo, 0);
  assert.match(a.out, /preguntar/);
  assert.match(a.out, /SIMULADAS/);
  const x = cli(['inventado'], { ledger: l });
  assert.equal(x.codigo, 1);
  assert.match(x.out, /Comando desconocido/);
  fs.rmSync(l, { recursive: true, force: true });
});

test('preguntar: informe con fuente y verificación; --json estructurado; el ledger queda íntegro', () => {
  const l = tmp();
  const r = cli(['preguntar', 'dame el último informe de calidad'], { ledger: l });
  assert.equal(r.codigo, 0);
  assert.match(r.out, /fx-04-02/);
  assert.match(r.out, /DATOS DE PRUEBA/);
  assert.match(r.err, /AVISO: --ahora/, 'avisa de que el reloj está fijado');
  const j = json(['preguntar', 'compara los informes del auditor'], l);
  assert.equal(j.codigo, 0);
  assert.equal(j.datos.categoria, 'consulta');
  assert.equal(j.datos.registrada, true);
  const v = cli(['ledger', 'verificar'], { ledger: l });
  assert.equal(v.codigo, 0);
  assert.match(v.out, /Ledger íntegro: \d+ eventos/);
  fs.rmSync(l, { recursive: true, force: true });
});

test('flujo L2 entre procesos distintos: preguntar → aprobar --simulada → nada enviado; sin --simulada se rechaza; la aprobación no se reutiliza', () => {
  const l = tmp();
  const p = json(['preguntar', 'lanza una auditoria del catalogo'], l);
  const id = p.datos.aprobaciones[0];
  assert.match(id, /^a_/);
  const sin = cli(['aprobar', id], { ledger: l });
  assert.equal(sin.codigo, 1);
  assert.match(sin.out, /solo existen aprobaciones SIMULADAS/);
  const voz = cli(['aprobar', id, '--simulada', '--canal', 'voz'], { ledger: l });
  assert.equal(voz.codigo, 2);
  assert.match(voz.out, /canal_no_permitido/);
  const ok = cli(['aprobar', id, '--simulada'], { ledger: l });
  assert.equal(ok.codigo, 0);
  assert.match(ok.out, /NO se envió nada al agente/);
  const otra = cli(['aprobar', id, '--simulada'], { ledger: l });
  assert.equal(otra.codigo, 2);
  assert.match(otra.out, /una aprobación = una ejecución/);
  const t = cli(['tareas', '--todas'], { ledger: l });
  assert.match(t.out, /cancelada/);
  const ver = cli(['tarea', 'ver', p.datos.tareas[0]], { ledger: l });
  assert.match(ver.out, /Aprobación: .*"estado":"consumida","simulada":true/);
  const eventos = fs.readFileSync(path.join(l, 'ledger-principal.jsonl'), 'utf8');
  assert.equal(/delegacion_enviada/.test(eventos), false);
  assert.match(eventos, /delegacion_simulada/);
  fs.rmSync(l, { recursive: true, force: true });
});

test('tarea crear: una capacidad L0 se ejecuta y se verifica; una L2 queda esperando; parámetros ajenos y capacidades inexistentes se rechazan', () => {
  const l = tmp();
  assert.match(cli(['tarea', 'crear', '12.leer-ultimo-informe'], { ledger: l }).out, /completada \(verificada releyendo la fuente\)/);
  const l2 = cli(['tarea', 'crear', '04.auditar-catalogo'], { ledger: l });
  assert.equal(l2.codigo, 0);
  assert.match(l2.out, /en espera de aprobación SIMULADA/);
  assert.equal(cli(['tarea', 'crear', '04.auditar-catalogo', 'foo=1'], { ledger: l }).codigo, 2);
  assert.equal(cli(['tarea', 'crear', '99.x'], { ledger: l }).codigo, 2);
  assert.equal(cli(['tarea', 'crear', '04.proponer-correcciones'], { ledger: l }).codigo, 2);
  assert.equal(cli(['tarea', 'crear'], { ledger: l }).codigo, 1);
  assert.equal(cli(['tarea', 'crear', '04.leer-ultimo-informe', 'malformado'], { ledger: l }).codigo, 1);
  fs.rmSync(l, { recursive: true, force: true });
});

test('informe, agentes, parada de emergencia, reanudar y reconciliar', () => {
  const l = tmp();
  assert.match(cli(['informe', '12'], { ledger: l }).out, /Auditor General \(12\) · fx-12-02/);
  assert.match(cli(['informe', '04', '--comparar'], { ledger: l }).out, /Nuevas 1 · persistentes 3 · resueltas 1/);
  assert.match(cli(['informe', '04', '--historial'], { ledger: l }).out, /fx-04-01/);
  assert.equal(cli(['informe', '99'], { ledger: l }).codigo, 1);
  assert.match(cli(['agentes'], { ledger: l }).out, /04 Calidad del catálogo: operativo \(estado comunicado\)/);
  const pre = json(['preguntar', 'lanza una auditoria del catalogo'], l);
  assert.match(cli(['parada', 'prueba'], { ledger: l }).out, /canceladas: 1/);
  assert.match(cli(['preguntar', 'último informe de calidad'], { ledger: l }).out, /parada_emergencia/);
  assert.match(cli(['reanudar'], { ledger: l }).out, /levantada/);
  assert.match(cli(['preguntar', 'último informe de calidad'], { ledger: l }).out, /fx-04-02/);
  assert.match(cli(['reconciliar'], { ledger: l }).out, /Nada que reconciliar/);
  assert.ok(pre.datos.tareas.length === 1);
  fs.rmSync(l, { recursive: true, force: true });
});

test('ledger: verificar detecta manipulación; copia y restauración probadas; recuperación de una escritura interrumpida', () => {
  const l = tmp();
  cli(['preguntar', 'último informe de calidad'], { ledger: l });
  const copia = path.join(tmp(), 'copia');
  assert.match(cli(['ledger', 'copia', copia], { ledger: l }).out, /Copia verificada: \d+ eventos/);
  const rest = path.join(tmp(), 'rest');
  assert.match(cli(['ledger', 'restaurar', copia, rest], { ledger: l }).out, /Restaurado y verificado/);
  assert.match(cli(['ledger', 'verificar'], { ledger: rest }).out, /Ledger íntegro/);
  // escritura interrumpida
  fs.appendFileSync(path.join(l, 'ledger-principal.jsonl'), '{"idEvento":"e_roto","secuencia":99');
  const v = cli(['ledger', 'verificar'], { ledger: l });
  assert.equal(v.codigo, 2);
  assert.match(v.out, /cola incompleta/);
  const bloqueado = cli(['preguntar', 'lanza una auditoria del catalogo'], { ledger: l });
  assert.match(bloqueado.out, /NO queda registrada|No se inicia ninguna acción nueva/, 'con el ledger roto no arranca ninguna acción');
  assert.match(cli(['ledger', 'recuperar'], { ledger: l }).out, /Cola incompleta apartada/);
  assert.match(cli(['ledger', 'verificar'], { ledger: l }).out, /Ledger íntegro/);
  assert.ok(fs.readdirSync(l).some((f) => f.startsWith('huerfano-')), 'lo apartado se conserva');
  // manipulación
  const f = path.join(l, 'ledger-principal.jsonl');
  const lineas = fs.readFileSync(f, 'utf8').trimEnd().split('\n');
  const e = JSON.parse(lineas[1]); e.datos = { manipulado: true }; lineas[1] = JSON.stringify(e);
  fs.writeFileSync(f, `${lineas.join('\n')}\n`);
  const m = cli(['ledger', 'verificar'], { ledger: l });
  assert.equal(m.codigo, 2);
  assert.match(m.out, /NO íntegro/);
  fs.rmSync(l, { recursive: true, force: true });
});

test('D3: la consola se niega a usar un ledger DENTRO del repositorio', () => {
  const dentro = path.join(RAIZ, 'automation', 'ledger-prohibido');
  const r = spawnSync(process.execPath, [CLI, 'agentes', '--ledger', dentro], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FUERA del repositorio/);
  assert.equal(fs.existsSync(dentro), false);
});

test('variables de entorno: TAI_DIRECTOR_DIR y TAI_DIRECTOR_INSTANTANEAS se respetan (sin --ledger ni --instantaneas)', () => {
  const l = tmp();
  const r = spawnSync(process.execPath, [CLI, 'preguntar', 'último informe del auditor'], { encoding: 'utf8', env: { ...process.env, TAI_DIRECTOR_DIR: l, TAI_DIRECTOR_INSTANTANEAS: FIXTURES } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fx-12-02/);
  assert.ok(fs.existsSync(path.join(l, 'ledger-principal.jsonl')));
  fs.rmSync(l, { recursive: true, force: true });
});

test('modo consola interactivo: instrucciones y comandos por la entrada estándar; salir termina', async () => {
  const l = tmp();
  const salida = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [CLI, 'consola', '--ledger', l, '--instantaneas', FIXTURES, '--ahora', ENT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out));
    p.on('error', reject);
    p.stdin.write('último informe del auditor\nagentes\nlanza una auditoria del catalogo\npublica la portada\nsalir\n');
    p.stdin.end();
  });
  assert.match(salida, /Director de Treidilor AI \(F1, sin LLM/);
  assert.match(salida, /fx-12-02/);
  assert.match(salida, /04 Calidad del catálogo: operativo/);
  assert.match(salida, /Requiere tu aprobación \(L2\)/);
  assert.match(salida, /nivel L4/);
  fs.rmSync(l, { recursive: true, force: true });
});
