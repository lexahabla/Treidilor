// Correcciones tras la primera prueba con instantáneas reales: (1) copia transformada y huellas, (2) recuperación segura de las tablas de pruebas, (3) falso positivo «simulado».
// Todo con datos SINTÉTICOS y una API falsa en memoria: nunca se usan datos reales ni se toca ningún n8n.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { aEntornoPruebas, planRecuperacion, recuperarTablas, ejecutarPrueba } from '../../../scripts/automation/instantanea-real.mjs';
import { crearEntorno, AHORA } from '../evaluacion/entorno.mjs';
import { exportacion, fila } from '../fixtures/construir.mjs';
import { Canal13 } from '../canal/canal13.mjs';
import { LectorInstantaneas, textoCopia } from '../lectores.mjs';
import { filaDeInstantanea } from '../../lib/seguimiento.mjs';

const iso = (ms) => new Date(ms).toISOString();
// la huella de una fila REAL es `filaDeInstantanea(...).huella` (hash de las claves de incidencias); el fixture genérico usa otro cálculo, así que se rehace aquí
const filaProd = (agente = '12', horas = 1) => { const { id, ...f } = { id: 1, ...fila({ id: 1, agente, idEjecucion: 'ex-17', entorno: 'produccion', generadoEn: iso(AHORA - horas * 3600000), incidencias: [['ficha:sin_categoria:p-1', 'media'], ['ficha:captura_ausente:p-2', 'baja']] }) }; f.huella = filaDeInstantanea(JSON.parse(f.payload), { idEjecucion: f.idEjecucion, origen: f.origen }).huella; return f; };

// ── 1) Huellas y copia transformada ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('aEntornoPruebas: conserva la huella, recalcula y declara la copia (sha-256 original ≠ copia, entorno original y de la copia)', () => {
  const orig = filaProd();
  const { fila: copia, copia: meta } = aEntornoPruebas(orig);
  assert.equal(copia.entorno, 'local');
  assert.equal(JSON.parse(copia.payload).entorno, 'local');
  assert.equal(copia.huella, orig.huella, 'la huella de la fila (hash de claves de incidencias) se conserva y se ha RECALCULADO igual');
  assert.equal(copia.host, orig.host); assert.equal(copia.idEjecucion, orig.idEjecucion); assert.equal(copia.generadoEn, orig.generadoEn);
  assert.equal(meta.entornoOriginal, 'produccion'); assert.equal(meta.entornoCopia, 'local');
  assert.equal(meta.sha256PayloadOriginal, crypto.createHash('sha256').update(orig.payload).digest('hex'));
  assert.equal(meta.sha256PayloadCopia, crypto.createHash('sha256').update(copia.payload).digest('hex'));
  assert.notEqual(meta.sha256PayloadOriginal, meta.sha256PayloadCopia, 'una copia transformada no se presenta como idéntica');
  assert.equal(meta.huellaFilaCoincide, true); assert.equal(meta.huellaOriginalCoincide, true);
});

test('aEntornoPruebas: si la huella no corresponde a las incidencias, la copia se RECHAZA', () => {
  assert.throws(() => aEntornoPruebas({ ...filaProd(), huella: '0000000000000000' }), /no coincide al recalcularla/);
});

test('el Director muestra el aviso de copia transformada (con las dos huellas) y no la presenta como idéntica', async () => {
  const E = crearEntorno({ fix: {} });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f19-'));
    const { fila: f, copia } = aEntornoPruebas(filaProd('04'));
    fs.writeFileSync(path.join(dir, '04.json'), JSON.stringify({ ...exportacion({ agente: '04', filas: [f], sintetico: false }), saneado: true, copia }));
    E.d.lector = new LectorInstantaneas({ dir });
    const m = await new Canal13({ director: E.d }).recibir('¿Cómo está el catálogo?');
    const aviso = m.avisos.find((a) => /COPIA DE PRUEBAS TRANSFORMADA/.test(a));
    assert.ok(aviso, 'hay aviso de copia transformada');
    assert.match(aviso, /«produccion»/); assert.match(aviso, /«local»/); assert.match(aviso, /no acredita que la copia sea idéntica/);
    assert.ok(aviso.includes(copia.sha256PayloadOriginal.slice(0, 12)) && aviso.includes(copia.sha256PayloadCopia.slice(0, 12)));
    assert.ok(m.avisos.some((a) => /DATOS REALES SANEADOS/.test(a)), 'sigue constando que es una instantánea real histórica');
    assert.equal(textoCopia({ ...copia, huellaFilaCoincide: false }).includes('NO coincide'), true);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { E.limpiar(); }
});

// ── 3) Falso positivo «simulado» ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function naturaleza(agente, extra = {}) {
  const E = crearEntorno({ fix: {} });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f19n-'));
    const { fila: f } = aEntornoPruebas(filaProd(agente, 36));
    fs.writeFileSync(path.join(dir, `${agente}.json`), JSON.stringify({ ...exportacion({ agente, filas: [f], sintetico: false }), saneado: true, ...extra }));
    E.d.lector = new LectorInstantaneas({ dir });
    const m = await new Canal13({ director: E.d }).recibir(agente === '12' ? '¿Cómo está el sitio?' : '¿Cómo está el catálogo?');
    fs.rmSync(dir, { recursive: true, force: true });
    return m;
  } finally { E.limpiar(); }
}

test('regresión: el ofrecimiento «en F1 sería simulada» del Agente 12 NO rotula la instantánea real como «simulado»', async () => {
  const m = await naturaleza('12');
  assert.match(m.detalle, /sería simulada/, 'el ofrecimiento sigue presente en el texto');
  const et = m.naturalezaDatos.map((n) => n.etiqueta);
  assert.ok(et.includes('real_saneado')); assert.ok(!et.includes('simulado'), `etiquetas: ${et.join(',')}`);
  assert.ok(m.avisos.some((a) => /NO está verificado/.test(a)), 'se mantiene la advertencia de estado actual no verificado');
});

test('el etiquetado de datos sintéticos se conserva: fixtures y textos de datos simulados siguen siendo «simulado»', async () => {
  const E = crearEntorno({ fix: {} });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f19s-'));
    const { id, ...f } = { id: 1, ...fila({ id: 1, agente: '12', idEjecucion: 'fx-12-01', entorno: 'local', generadoEn: iso(AHORA - 3600000), incidencias: [] }) };
    fs.writeFileSync(path.join(dir, '12.json'), JSON.stringify(exportacion({ agente: '12', filas: [f], sintetico: true })));
    E.d.lector = new LectorInstantaneas({ dir });
    const m = await new Canal13({ director: E.d }).recibir('¿Cómo está el sitio?');
    assert.ok(m.naturalezaDatos.map((n) => n.etiqueta).includes('simulado'), 'sintético → simulado');
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { E.limpiar(); }
  const c = new Canal13({ director: { procesarSolicitudAsync() {}, ahora: () => 0 } });
  assert.ok(c._naturaleza({ texto: 'Resultado con DATOS SIMULADOS de la ejecución', avisos: [] }).some((n) => n.etiqueta === 'simulado'));
  assert.ok(c._naturaleza({ texto: 'La ejecución simulada terminó', avisos: [] }).some((n) => n.etiqueta === 'simulado'));
  assert.ok(!c._naturaleza({ texto: 'Dato.\nPuedo solicitar una auditoría nueva (L2; en F1 sería simulada).', avisos: [] }).some((n) => n.etiqueta === 'simulado'));
});

// ── 2) Recuperación segura de las tablas de pruebas ───────────────────────────────────────────────────────────────────────────────────────────
const SIN = 'sintetico.example';
function mundo({ fallos = {}, ciclos = null } = {}) {
  let n = 100; const tablas = []; const log = []; let activos = 0;
  const add = (name, hosts) => { const t = { id: `t${++n}`, name, filas: hosts.map((h, i) => ({ host: h, idEjecucion: `${name}-${i}` })) }; tablas.push(t); return t; };
  const s04 = add('calidad_catalogo_instantaneas', [SIN, SIN]); const s12 = add('auditor_general_instantaneas', [SIN]);
  const api = {
    async listar() { return tablas.map((t) => ({ id: t.id, name: t.name, filas: t.filas.map((f) => ({ ...f })) })); },
    async leerFilas(id) { return tablas.find((t) => t.id === id).filas.map((f) => ({ ...f })); },
    async renombrar(id, name) { if (fallos.renombrar && fallos.renombrar(id, name)) throw new Error('fallo al renombrar'); tablas.find((t) => t.id === id).name = name; log.push(`ren ${id}→${name}`); },
    async borrar(id) { if (fallos.borrar && fallos.borrar(id)) throw new Error('404 al borrar'); const i = tablas.findIndex((t) => t.id === id); log.push(`del ${id}`); tablas.splice(i, 1); },
    async crear(name) { return add(name, []).id; },
    async anadir(id, rows) { tablas.find((t) => t.id === id).filas.push(...rows.map((r) => ({ host: r.host, idEjecucion: r.idEjecucion }))); },
    async publicar() { activos = 1; }, async despublicar() { activos = 0; }, async activos() { return activos; },
  };
  return { api, tablas, log, s04, s12, nombres: () => tablas.map((t) => t.name).sort() };
}
const datosReales = () => ({ '04': { filas: [filaProd('04')] }, '12': { filas: [filaProd('12')] } });
const ruta = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f19r-')), 'respaldo.json');
const silencio = () => {};

test('ejecución normal: las tablas sintéticas vuelven con los mismos ids y filas y no queda nada temporal ni workflow activo', async () => {
  const w = mundo(); let vistoCopias = null;
  await ejecutarPrueba({ api: w.api, datos: datosReales(), rutaRespaldo: ruta(), mostrar: silencio, circuito: async (c) => { vistoCopias = c; assert.equal(await w.api.activos(), 1); } });
  assert.deepEqual(w.nombres(), ['auditor_general_instantaneas', 'calidad_catalogo_instantaneas']);
  assert.equal(w.tablas.find((t) => t.name === 'calidad_catalogo_instantaneas').id, w.s04.id);
  assert.equal(w.tablas.find((t) => t.name === 'auditor_general_instantaneas').id, w.s12.id);
  assert.equal(w.s04.filas.length, 2); assert.equal(w.s12.filas.length, 1);
  assert.equal(await w.api.activos(), 0);
  assert.equal(vistoCopias['12'].entornoOriginal, 'produccion');
});

test('un error DENTRO del circuito restaura igualmente y propaga el fallo', async () => {
  const w = mundo();
  await assert.rejects(ejecutarPrueba({ api: w.api, datos: datosReales(), rutaRespaldo: ruta(), mostrar: silencio, circuito: async () => { throw new Error('circuito roto'); } }), /circuito roto/);
  assert.deepEqual(w.nombres(), ['auditor_general_instantaneas', 'calidad_catalogo_instantaneas']);
  assert.equal(w.tablas.find((t) => t.name === 'calidad_catalogo_instantaneas').id, w.s04.id);
  assert.equal(await w.api.activos(), 0);
});

test('un fallo al cargar (tras apartar las sintéticas) también restaura', async () => {
  const w = mundo(); let n = 0; const anadir = w.api.anadir;
  w.api.anadir = async (...a) => { if (++n === 2) throw new Error('fallo al añadir filas'); return anadir(...a); };
  await assert.rejects(ejecutarPrueba({ api: w.api, datos: datosReales(), rutaRespaldo: ruta(), mostrar: silencio, circuito: async () => {} }), /fallo al añadir/);
  assert.deepEqual(w.nombres(), ['auditor_general_instantaneas', 'calidad_catalogo_instantaneas']);
  assert.equal(w.tablas.find((t) => t.name === 'auditor_general_instantaneas').id, w.s12.id);
});

test('si el borrado falla (404) la restauración se declara INCOMPLETA, nunca borra una sintética, y «recuperar» lo arregla después', async () => {
  let romper = true; const w = mundo({ fallos: { borrar: () => romper } });
  await assert.rejects(ejecutarPrueba({ api: w.api, datos: datosReales(), rutaRespaldo: ruta(), mostrar: silencio, circuito: async () => {} }), /404 al borrar|Restauración incompleta/);
  assert.ok(w.tablas.some((t) => t.id === w.s04.id) && w.tablas.some((t) => t.id === w.s12.id), 'las sintéticas siguen existiendo');
  assert.ok(w.nombres().some((n) => n.endsWith('_sintetico_respaldo')), 'el estado incompleto queda a la vista');
  // una nueva prueba se NIEGA a empezar sobre un estado incompleto
  await assert.rejects(ejecutarPrueba({ api: w.api, datos: datosReales(), rutaRespaldo: ruta(), mostrar: silencio, circuito: async () => {} }), /NO está en el estado normal/);
  romper = false;
  const r = await recuperarTablas(w.api, { filasSinteticas: { '04': 2, '12': 1 } });
  assert.equal(r.ok, true, r.problemas.join(';'));
  assert.deepEqual(w.nombres(), ['auditor_general_instantaneas', 'calidad_catalogo_instantaneas']);
  assert.equal(w.tablas.find((t) => t.name === 'calidad_catalogo_instantaneas').id, w.s04.id);
  assert.equal(w.log.filter((l) => l.startsWith('del')).every((l) => !l.includes(w.s04.id) && !l.includes(w.s12.id)), true, 'nunca se borró una sintética');
});

test('interrupción en frío (proceso muerto tras apartar y cargar): «recuperar» identifica sin ambigüedad y restaura', async () => {
  const w = mundo();
  // estado dejado por una interrupción: sintéticas renombradas + tablas reales con nombre canónico
  await w.api.renombrar(w.s04.id, 'calidad_catalogo_instantaneas_sintetico_respaldo'); await w.api.renombrar(w.s12.id, 'auditor_general_instantaneas_sintetico_respaldo');
  const a = await w.api.crear('calidad_catalogo_instantaneas'); await w.api.anadir(a, [{ host: 'treidilor.com', idEjecucion: 'ex-19' }]);
  const b = await w.api.crear('auditor_general_instantaneas'); await w.api.anadir(b, [{ host: 'treidilor.com', idEjecucion: 'ex-17' }]);
  const plan = planRecuperacion(await w.api.listar());
  assert.equal(plan.ok, true); assert.equal(plan.plan.filter((p) => p.accion === 'borrar').length, 2);
  const r = await recuperarTablas(w.api);
  assert.equal(r.ok, true, r.problemas.join(';'));
  assert.deepEqual(w.nombres(), ['auditor_general_instantaneas', 'calidad_catalogo_instantaneas']);
  assert.equal(w.tablas.find((t) => t.name === 'calidad_catalogo_instantaneas').id, w.s04.id);
});

test('ambigüedades: ningún borrado ni renombrado sin identificar (dos sintéticas, sin respaldo, respaldo no sintético)', async () => {
  // dos tablas sintéticas con el nombre canónico + respaldo
  let w = mundo(); await w.api.renombrar(w.s04.id, 'calidad_catalogo_instantaneas_sintetico_respaldo');
  const dup = await w.api.crear('calidad_catalogo_instantaneas'); await w.api.anadir(dup, [{ host: SIN, idEjecucion: 'otra-sintetica' }]);
  let p = planRecuperacion(await w.api.listar()); assert.equal(p.ok, false); assert.deepEqual(p.plan.filter((x) => x.agente === '04'), []);
  const r = await recuperarTablas(w.api); assert.equal(r.ok, false); assert.equal(w.log.filter((l) => l.startsWith('del')).length, 0);
  // canónica real sin ningún respaldo sintético: no hay con qué restaurar
  w = mundo(); await w.api.borrar(w.s12.id); const c = await w.api.crear('auditor_general_instantaneas'); await w.api.anadir(c, [{ host: 'treidilor.com', idEjecucion: 'ex-17' }]);
  p = planRecuperacion(await w.api.listar()); assert.equal(p.ok, false); assert.match(p.problemas.join(' '), /no hay tabla sintética/);
  // respaldo con filas no sintéticas
  w = mundo(); await w.api.renombrar(w.s12.id, 'auditor_general_instantaneas_sintetico_respaldo'); w.s12.filas[0].host = 'treidilor.com';
  p = planRecuperacion(await w.api.listar()); assert.equal(p.ok, false);
});

test('recuperación verificada: si tras restaurar faltan filas sintéticas respaldadas, no se declara correcta', async () => {
  const w = mundo(); w.s04.filas.pop();
  const r = await recuperarTablas(w.api, { filasSinteticas: { '04': 2, '12': 1 } });
  assert.equal(r.ok, false); assert.match(r.problemas.join(' '), /04: filas sintéticas 1 ≠ 2/);
});
