// Instantáneas REALES saneadas: lectura del CSV exportado de n8n, elección de la última fila de producción, saneado, y rotulado «real saneado» (≠ sintético) en el Director y el Canal 13.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsearCsv, sanear, prepararFila } from '../../../scripts/automation/instantanea-real.mjs';
import { crearEntorno, AHORA } from '../evaluacion/entorno.mjs';
import { exportacion, fila } from '../fixtures/construir.mjs';
import { Canal13 } from '../canal/canal13.mjs';

const iso = (ms) => new Date(ms).toISOString();
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const CAB = ['id', 'entorno', 'host', 'generadoEn', 'idEjecucion', 'origen', 'calidad', 'huella', 'payload', 'createdAt', 'updatedAt'];
const csvDe = (filas) => [CAB.join(','), ...filas.map((f) => CAB.map((c) => q(f[c] ?? '')).join(','))].join('\r\n');
const f = (id, ej, ms, entorno = 'produccion', incidencias = [['ficha:sin_categoria:p-1', 'media']]) => ({ id, ...fila({ id, agente: '04', idEjecucion: ej, entorno, generadoEn: iso(ms), incidencias, fichas: ['p-1', 'p-2'] }), createdAt: iso(ms), updatedAt: iso(ms) });

test('CSV: comillas, comas y saltos de línea dentro de los campos', () => {
  const r = parsearCsv('a,b,c\r\n1,"x, y",2\r\n"l1\nl2","comillas ""dobles""",3\r\n');
  assert.deepEqual(r, [{ a: '1', b: 'x, y', c: '2' }, { a: 'l1\nl2', b: 'comillas "dobles"', c: '3' }]);
});

test('preparar: elige SOLO la última fila de producción, sin las demás ni las de otro entorno', () => {
  const csv = csvDe([f(1, 'ex-16', AHORA - 4 * 86400000), f(2, 'ex-18', AHORA - 86400000), f(3, 'ex-99-local', AHORA, 'local')]);
  const r = prepararFila({ csv, agente: '04' });
  assert.equal(r.datos.filas.length, 1);
  assert.equal(r.datos.filas[0].idEjecucion, 'ex-18');
  assert.equal(r.resumen.filasEnArchivo, 3);
  assert.equal(r.resumen.filasDeProduccion, 2);
  assert.equal(r.datos.sintetico, false);
  assert.equal(r.datos.saneado, true);
  assert.deepEqual(Object.keys(r.datos.filas[0]).sort(), ['calidad', 'entorno', 'generadoEn', 'host', 'huella', 'idEjecucion', 'origen', 'payload']);
});

test('preparar: sin filas de producción se rechaza (salvo ensayo explícito) y las columnas son obligatorias', () => {
  assert.throws(() => prepararFila({ csv: csvDe([f(1, 'x', AHORA, 'local')]), agente: '04' }), /produccion/);
  assert.equal(prepararFila({ csv: csvDe([f(1, 'x', AHORA, 'local')]), agente: '04', permitirNoProduccion: true }).datos.filas.length, 1);
  assert.throws(() => prepararFila({ csv: 'a,b\n1,2', agente: '04' }), /Faltan columnas/);
  assert.throws(() => prepararFila({ csv: csvDe([]), agente: '04' }), /no tiene filas/);
  assert.throws(() => prepararFila({ csv: csvDe([f(1, 'x', AHORA)]), agente: '99' }), /04 o 12/);
});

test('saneado: retira secretos, correos e IPs y la fila sigue siendo legible por el Director', () => {
  const secreto = `${'sk-'}${'ant-FALSA-DE-PRUEBA-NO-ES-UNA-CLAVE-REAL-0000000000'}`;
  const s = sanear(`clave ${secreto} correo persona@ejemplo.com ip 10.1.2.3 Bearer ${'abcdefghijklmnopqrstuvwxyz012345'}`);
  assert.doesNotMatch(s.texto, /sk-ant|@ejemplo|10\.1\.2\.3|abcdefghijkl/);
  assert.equal(Object.values(s.cuenta).reduce((a, b) => a + b, 0), 4);
  const base = f(1, 'ex-18', AHORA - 3600000);
  const sucio = { ...base, idEjecucion: 'ex-18', huella: 'h-persona@ejemplo.com' };
  const r = prepararFila({ csv: csvDe([sucio]), agente: '04' });
  assert.match(r.datos.filas[0].huella, /REDACTADO/);
  assert.equal(r.resumen.redacciones['correo electrónico'], 1);
});

test('el Director y el Canal 13 distinguen «real saneado», no lo llaman prueba y no afirman el estado actual', async () => {
  const E = crearEntorno({ fix: {} });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-real-t-'));
    const vieja = f(1, 'ex-18', AHORA - 5 * 86400000);
    const { id, createdAt, updatedAt, ...limpia } = vieja;
    fs.writeFileSync(path.join(dir, '04.json'), JSON.stringify({ ...exportacion({ agente: '04', filas: [limpia], sintetico: false }), saneado: true }));
    const { LectorInstantaneas } = await import('../lectores.mjs');
    E.d.lector = new LectorInstantaneas({ dir });
    const m = await new Canal13({ director: E.d }).recibir('¿Cómo está el catálogo?');
    const et = m.naturalezaDatos.map((n) => n.etiqueta);
    assert.ok(et.includes('real_saneado'));
    assert.ok(!et.includes('simulado'), 'no se rotula como prueba');
    assert.ok(m.avisos.some((a) => /DATOS REALES SANEADOS/.test(a) && /NO está verificado/.test(a)));
    assert.ok(!m.avisos.some((a) => /DATOS DE PRUEBA/.test(a)));
    assert.match(`${m.textoClaro} ${m.detalle}`, /5 d|días|hist[oó]ric|No consta un dato actual|puede no reflejar/i, 'avisa de la antigüedad');
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { E.limpiar(); }
});
