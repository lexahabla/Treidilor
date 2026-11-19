// Agente 00 · F1.3 · lectores de solo lectura de las instantáneas de los Agentes 04 y 12 (fixtures sintéticos, sin n8n en vivo).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LectorInstantaneas, aInformeAgente, huellaInforme } from '../lectores.mjs';
import { validarInformeAgente } from '../protocolo.mjs';
import { exportacion, fila, fixturesPorDefecto } from '../fixtures/construir.mjs';
import { validarEsquema } from '../../../scripts/automation/validate-schema.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
const FIXTURES_DIR = path.join(AQUI, '..', 'fixtures');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tai-lect-'));
const escribir = (dir, agente, datos) => fs.writeFileSync(path.join(dir, `${agente}.json`), typeof datos === 'string' ? datos : JSON.stringify(datos));
const hashDir = (dir) => createHash('sha256').update(fs.readdirSync(dir).sort().map((f) => `${f}:${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('|')).digest('hex');
const conFixtures = () => { const d = tmp(); for (const [a, x] of Object.entries(fixturesPorDefecto())) escribir(d, a, x); return d; };

test('los fixtures versionados coinciden con el constructor (determinista) y están rotulados como sintéticos', () => {
  for (const [a, x] of Object.entries(fixturesPorDefecto())) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${a}.json`), 'utf8')), x, `fixtures/${a}.json está al día (regenerar con fixtures/generar.mjs)`);
    assert.equal(x.sintetico, true);
    assert.ok(x.filas.every((f) => /^fx-/.test(f.idEjecucion)), 'ids de prueba que no se confunden con los reales (ex-…)');
  }
});

test('última instantánea: informe-agente/1 válido por validador y por esquema, con fuente, huella y limitaciones declaradas', () => {
  const d = conFixtures();
  const l = new LectorInstantaneas({ dir: d });
  assert.deepEqual(l.disponibles(), ['04', '12']);
  const { informe, carga } = l.ultima('04');
  assert.equal(informe.idEjecucion, 'fx-04-02');
  assert.equal(informe.agente, '04');
  assert.equal(informe.capacidad, '04.leer-ultimo-informe');
  assert.equal(informe.completo, true);
  assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
  assert.equal(informe.fuente.tabla, 'calidad_catalogo_instantaneas');
  assert.equal(informe.resumen.incidencias, 4);
  assert.deepEqual(informe.resumen.porGravedad, { critica: 0, alta: 0, media: 2, baja: 2, info: 0 });
  assert.equal(informe.resumen.porCerteza, null, 'lo que no consta en la instantánea se declara null, no se inventa');
  assert.equal(informe.hallazgos.length, 4);
  assert.ok(informe.hallazgos.every((h) => h.clave && h.evidencia.clave === h.clave && h.certeza === null));
  assert.ok(informe.limitaciones.some((x) => /no constan aquí/.test(x)));
  assert.ok(informe.limitaciones.some((x) => /DATOS DE PRUEBA/.test(x)));
  assert.deepEqual(validarInformeAgente(informe), { ok: true, errores: [] });
  assert.deepEqual(validarEsquema(informe, ESQ), []);
  assert.equal(carga.sintetico, true);
  assert.equal(huellaInforme(informe), huellaInforme(new LectorInstantaneas({ dir: d }).ultima('04').informe), 'dos lecturas independientes dan la misma huella');
  fs.rmSync(d, { recursive: true, force: true });
});

test('SOLO LECTURA: leer no cambia ni un byte del directorio, y las clases no tienen operaciones de escritura', () => {
  const d = conFixtures();
  const antes = hashDir(d);
  const l = new LectorInstantaneas({ dir: d });
  l.ultima('04'); l.ultima('12'); l.listar('04', {}); l.obtener('12', 'fx-12-01'); l.comparar('04', {}); l.comparar('12', {});
  assert.equal(hashDir(d), antes);
  for (const m of ['escribir', 'guardar', 'borrar', 'eliminar', 'actualizar', 'insertar', 'write', 'save', 'delete']) assert.equal(typeof l[m], 'undefined');
  const codigo = fs.readFileSync(path.join(AQUI, '..', 'lectores.mjs'), 'utf8');
  assert.equal(/writeFile|appendFile|unlink|rmSync|rename|mkdir|createWriteStream|fetch\(|https?\.request|net\.|child_process/.test(codigo), false, 'el módulo no escribe, no borra y no abre red');
  fs.rmSync(d, { recursive: true, force: true });
});

test('listar: más reciente primero, límite acotado y los históricos se conservan siempre', () => {
  const d = tmp();
  const filas = Array.from({ length: 8 }, (_, i) => fila({ id: i + 1, agente: '04', idEjecucion: `fx-${i + 1}`, generadoEn: `2026-11-0${i + 1}T09:00:00.000Z`, incidencias: i % 2 ? [] : [['ficha:x:1', 'baja']] }));
  escribir(d, '04', exportacion({ agente: '04', filas }));
  const l = new LectorInstantaneas({ dir: d });
  const r = l.listar('04', { n: 3 });
  assert.deepEqual(r.informes.map((i) => i.idEjecucion), ['fx-8', 'fx-7', 'fx-6']);
  assert.equal(r.total, 8);
  assert.equal(l.listar('04', { n: 999 }).informes.length, 8, 'tope 50, pero hay 8: se devuelven todas');
  assert.equal(l.listar('04', { n: 0 }).informes.length, 1, 'mínimo 1');
  assert.equal(l.obtener('04', 'fx-1').informe.idEjecucion, 'fx-1', 'la más antigua sigue consultable');
  assert.equal(l.obtener('04', 'fx-404').informe, null);
  fs.rmSync(d, { recursive: true, force: true });
});

test('comparar: reutiliza el motor de seguimiento (nuevas, persistentes, resueltas) y respeta ids explícitos', () => {
  const d = conFixtures();
  const l = new LectorInstantaneas({ dir: d });
  const r = l.comparar('04', {});
  const s = r.informe.seguimiento;
  assert.equal(r.informe.capacidad, '04.comparar-informes');
  assert.equal(s.modo, 'comparacion');
  assert.equal(s.comparadoCon, 'fx-04-01');
  assert.deepEqual(s.nuevas, ['ficha:red_no_identificada:p-005']);
  assert.deepEqual(s.resueltas, ['ficha:sin_categoria:p-002']);
  assert.equal(s.resumen.persistentes, 3);
  assert.deepEqual(validarEsquema(r.informe, ESQ), []);
  assert.equal(l.comparar('04', { anterior: 'fx-04-01', actual: 'fx-04-02' }).informe.seguimiento.comparadoCon, 'fx-04-01');
  assert.equal(l.comparar('04', { anterior: 'fx-04-02', actual: 'fx-04-01' }).informe.seguimiento.modo, 'sin_comparar', 'orden inválido: no se compara (motor existente)');
  const sola = tmp();
  escribir(sola, '04', exportacion({ agente: '04', filas: [fila({ id: 1, agente: '04', idEjecucion: 'u', generadoEn: '2026-11-14T09:00:00.000Z', incidencias: [] })] }));
  const r1 = new LectorInstantaneas({ dir: sola }).comparar('04', {});
  assert.equal(r1.informe, null);
  assert.equal(r1.motivo, 'no_hay_instantanea_anterior', 'con una sola instantánea no se inventa una comparación');
  fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(sola, { recursive: true, force: true });
});

test('filas inválidas: se descartan CON su motivo (nunca en silencio) y no bloquean las válidas', () => {
  const d = tmp();
  const buena = fila({ id: 1, agente: '04', idEjecucion: 'ok-1', generadoEn: '2026-11-14T09:00:00.000Z', incidencias: [['ficha:a:1', 'media']] });
  const incoherente = { ...fila({ id: 2, agente: '04', idEjecucion: 'inc', generadoEn: '2026-11-14T10:00:00.000Z', incidencias: [] }), generadoEn: '2026-11-14T11:00:00.000Z' };
  const roto = { ...buena, id: 3, idEjecucion: 'roto', payload: '{no es json' };
  const antiguo = { ...buena, id: 4, idEjecucion: 'esq', payload: JSON.stringify({ esquema: 99, incidencias: [] }) };
  const sinCol = { id: 5, idEjecucion: 'x' };
  const grande = { ...buena, id: 6, idEjecucion: 'big', payload: 'x'.repeat(70000) };
  const sinCalidad = (() => { const f = fila({ id: 7, agente: '04', idEjecucion: 'sc', generadoEn: '2026-11-14T12:00:00.000Z', incidencias: [] }); const p = JSON.parse(f.payload); delete p.calidad; return { ...f, payload: JSON.stringify(p) }; })();
  escribir(d, '04', exportacion({ agente: '04', filas: [buena, incoherente, roto, antiguo, sinCol, grande, sinCalidad, 'basura', null] }));
  const r = new LectorInstantaneas({ dir: d }).cargar('04');
  assert.equal(r.filas.length, 1);
  assert.equal(r.leidas, 9);
  const motivos = Object.fromEntries(r.descartadas.map((x) => [x.fila, x.motivo]));
  assert.equal(motivos.inc, 'fila_incoherente');
  assert.equal(motivos.roto, 'payload_invalido');
  assert.equal(motivos.esq, 'esquema_incompatible');
  assert.equal(motivos.x, 'fila_incompleta');
  assert.equal(motivos.big, 'payload_invalido');
  assert.equal(motivos.sc, 'sin_calidad');
  assert.equal(r.descartadas.length, 8);
  assert.equal(new LectorInstantaneas({ dir: d }).ultima('04').informe.idEjecucion, 'ok-1');
  fs.rmSync(d, { recursive: true, force: true });
});

test('filas duplicadas (misma ejecución): se conserva la de menor id y se cuenta', () => {
  const d = tmp();
  const a = fila({ id: 5, agente: '12', idEjecucion: 'dup', generadoEn: '2026-11-14T09:00:00.000Z', incidencias: [] });
  const b = fila({ id: 9, agente: '12', idEjecucion: 'dup', generadoEn: '2026-11-14T09:00:00.000Z', incidencias: [['ruta:x:/a', 'baja']] });
  escribir(d, '12', exportacion({ agente: '12', filas: [b, a] }));
  const r = new LectorInstantaneas({ dir: d }).cargar('12');
  assert.equal(r.filas.length, 1);
  assert.equal(r.duplicadas, 1);
  assert.equal(r.filas[0].fila.id, 5);
  fs.rmSync(d, { recursive: true, force: true });
});

test('un informe PARCIAL se marca como tal y nunca se presenta como completo', () => {
  const d = tmp();
  escribir(d, '04', exportacion({ agente: '04', filas: [fila({ id: 1, agente: '04', idEjecucion: 'p', generadoEn: '2026-11-14T09:00:00.000Z', estado: 'parcial', motivos: ['catalogo_no_leido_completo'], incidencias: [] })] }));
  const i = new LectorInstantaneas({ dir: d }).ultima('04').informe;
  assert.equal(i.completo, false);
  assert.ok(i.limitaciones.some((x) => /no completo/.test(x)) && i.limitaciones.some((x) => /catalogo_no_leido_completo/.test(x)));
  fs.rmSync(d, { recursive: true, force: true });
});

test('entorno: por defecto produccion si hay filas; si no, el que haya; filtrable', () => {
  const d = tmp();
  escribir(d, '12', exportacion({ agente: '12', filas: [
    fila({ id: 1, agente: '12', idEjecucion: 'l1', entorno: 'local', generadoEn: '2026-11-14T10:00:00.000Z', incidencias: [] }),
    fila({ id: 2, agente: '12', idEjecucion: 'p1', entorno: 'produccion', generadoEn: '2026-11-13T10:00:00.000Z', incidencias: [] }),
  ] }));
  const l = new LectorInstantaneas({ dir: d });
  assert.equal(l.ultima('12').informe.idEjecucion, 'p1', 'prefiere producción aunque haya una local más reciente');
  assert.equal(l.ultima('12', { entorno: 'local' }).informe.idEjecucion, 'l1');
  assert.equal(l.ultima('12', { entorno: 'inexistente' }).informe, null);
  fs.rmSync(d, { recursive: true, force: true });
});

test('errores de origen: archivo ausente, JSON ilegible, formato desconocido, agente inválido o sin tablas, archivo enorme', () => {
  const d = tmp();
  const l = new LectorInstantaneas({ dir: d });
  const cod = (f) => { try { f(); return null; } catch (e) { return e.codigo; } };
  assert.equal(cod(() => l.ultima('04')), 'origen_no_disponible');
  escribir(d, '04', '{ esto no es json');
  assert.equal(cod(() => l.ultima('04')), 'origen_no_disponible');
  escribir(d, '04', { formato: 'otro/9', filas: [] });
  assert.equal(cod(() => l.ultima('04')), 'origen_no_disponible');
  escribir(d, '04', { formato: 'instantaneas-exportadas/1' });
  assert.equal(cod(() => l.ultima('04')), 'origen_no_disponible', 'sin filas');
  assert.equal(cod(() => l.ultima('../04')), 'solicitud_invalida', 'sin recorrido de directorios');
  assert.equal(cod(() => l.ultima('07')), 'capacidad_desconocida', 'agente sin instantáneas');
  assert.equal(cod(() => new LectorInstantaneas({})), 'solicitud_invalida');
  fs.writeFileSync(path.join(d, '12.json'), Buffer.alloc(9 * 1024 * 1024, 32));
  assert.equal(cod(() => l.ultima('12')), 'origen_no_disponible');
  fs.rmSync(d, { recursive: true, force: true });
});

test('se admite también una lista de filas «cruda» (exportación directa de la tabla), sin rótulo de prueba', () => {
  const d = tmp();
  const f = fila({ id: 1, agente: '04', idEjecucion: 'ex-real-1', generadoEn: '2026-11-14T09:00:00.000Z', incidencias: [['ficha:a:1', 'media']] });
  escribir(d, '04', [f]);
  const { informe, carga } = new LectorInstantaneas({ dir: d }).ultima('04');
  assert.equal(informe.fuente.origenDatos, 'exportacion');
  assert.equal(carga.sintetico, false);
  assert.equal(informe.limitaciones.some((x) => /DATOS DE PRUEBA/.test(x)), false);
  fs.rmSync(d, { recursive: true, force: true });
});

test('hallazgos acotados: por encima del límite se omiten y se DECLARA', () => {
  const inc = Array.from({ length: 250 }, (_, i) => [`ficha:x:${i}`, 'baja']);
  const f = fila({ id: 1, agente: '04', idEjecucion: 'g', generadoEn: '2026-11-14T09:00:00.000Z', incidencias: inc });
  const i = aInformeAgente({ fila: f, inst: JSON.parse(f.payload), agente: '04', sintetico: false, tabla: 't' });
  assert.equal(i.hallazgos.length, 200);
  assert.equal(i.resumen.incidencias, 250);
  assert.ok(i.limitaciones.some((x) => /omiten 50 hallazgos/.test(x)));
});
