// Agente 00 · F1.5 · conjunto mínimo de pruebas REALES (preparado, NO ejecutable hoy) y comandos de consola del cerebro, el consumo y las suscripciones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRUEBAS_REALES_MINIMAS, REPETICIONES_REALES, ejecutarPruebasReales, prepararPruebasReales } from '../evaluacion/pruebas-reales.mjs';
import { CASOS } from '../evaluacion/casos.mjs';
import { Presupuesto } from '../llm/presupuesto.mjs';
import { AHORA, iso } from '../evaluacion/entorno.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
const CLI = path.join(RAIZ, 'scripts', 'automation', 'director.mjs');
const FIXTURES = path.join(AQUI, '..', 'fixtures');

test('pruebas reales mínimas: son los casos que solo un modelo real demuestra, con plan de llamadas y tokens, SIN ejecutar nada', () => {
  const idsModelo = new Set(CASOS.filter((c) => c.modeloReal.length).map((c) => c.id));
  for (const p of PRUEBAS_REALES_MINIMAS) assert.ok(idsModelo.has(p.caso), `${p.caso} es un caso que requiere modelo real`);
  assert.equal(PRUEBAS_REALES_MINIMAS.length, 10);
  assert.ok(PRUEBAS_REALES_MINIMAS.some((p) => p.caso === 'EV-40') && PRUEBAS_REALES_MINIMAS.some((p) => p.caso === 'EV-45'), 'incluye las dos inyecciones críticas');
  const plan = prepararPruebasReales();
  assert.equal(plan.ejecutado, false);
  assert.equal(plan.llamadas, 10 * REPETICIONES_REALES);
  assert.equal(plan.costePeorCasoTotalEur, null, 'sin tarifa declarada no se inventa un coste');
  assert.ok(plan.tokensEntradaTotales > 0 && plan.estimacionDeTokens);
  assert.ok(plan.condicionesParaEjecutar.some((c) => /GPT-6.1 Terra: sin verificar/.test(c)));
  const conTarifa = prepararPruebasReales({ tarifa: { entradaEurPor1M: 5, salidaEurPor1M: 15, verificacion: 'estimada' } });
  assert.equal(typeof conTarifa.costePeorCasoTotalEur, 'number');
  assert.ok(conTarifa.costePeorCasoTotalEur < 1, 'el conjunto mínimo cabe holgadamente en el tope de 1 €/día con esa tarifa de ejemplo');
});

test('las pruebas reales se NIEGAN a ejecutarse mientras falte alguna condición, y no tocan ningún transporte', async () => {
  let llamadas = 0;
  const cerebroFalso = { interpretar: async () => { llamadas += 1; return {}; } };
  const aut = { idAutorizacion: 'a', por: 'propietario', caducaEn: iso(AHORA + 86400000), topeDiarioEur: 1 };
  const tarifa = { entradaEurPor1M: 5, salidaEurPor1M: 15, verificacion: 'estimada' };
  const sinNada = await assert.rejects(() => ejecutarPruebasReales({}), (e) => e.codigo === 'permiso_denegado' && e.error.detalle.faltan.length >= 5);
  const pres = new Presupuesto({ config: { consumoRealActivado: true }, reloj: () => AHORA });
  // casi todo, pero sin revisión de privacidad
  await assert.rejects(() => ejecutarPruebasReales({ cerebroReal: cerebroFalso, presupuesto: pres, autorizacion: aut, tarifa, ahora: AHORA }), (e) => e.error.detalle.faltan.includes('revisión de privacidad D6 aprobada'));
  // con TODO: aun así este entregable no las ejecuta
  await assert.rejects(() => ejecutarPruebasReales({ cerebroReal: cerebroFalso, presupuesto: pres, autorizacion: aut, tarifa, privacidadAprobada: true, ahora: AHORA }), /solo las prepara/);
  assert.equal(llamadas, 0, 'ningún cerebro ni transporte se invocó');
  assert.equal(sinNada, undefined);
});

function cli(args, env = {}) {
  const l = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-cli15-'));
  const r = spawnSync(process.execPath, [CLI, ...args, '--ledger', l, '--instantaneas', FIXTURES, '--ahora', '2026-11-14T12:00:00Z'], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
  fs.rmSync(l, { recursive: true, force: true });
  return { codigo: r.status, out: r.stdout, err: r.stderr };
}

test('consola F1.5: cerebro simulado, consumo desactivado, suscripciones simuladas, batería y plan de pruebas reales; un proveedor real se rechaza', () => {
  const p = cli(['preguntar', 'dame el último informe de calidad', '--cerebro', 'simulado']);
  assert.equal(p.codigo, 0);
  assert.match(p.out, /fx-04-02/);
  const c = cli(['consumo']);
  assert.match(c.out, /DESACTIVADO \(por defecto\)/);
  assert.match(c.out, /Ningún gasto está autorizado/);
  const s = cli(['suscripciones']);
  assert.match(s.out, /^DATOS SIMULADOS/);
  const r = cli(['suscripciones', '--recomendar']);
  assert.match(r.out, /Recomendación por tarea/);
  const e = cli(['evaluar', '--caso', 'EV-10']);
  assert.equal(e.codigo, 0);
  assert.match(e.out, /EV-10 C PASA/);
  const real = cli(['evaluar-reales']);
  assert.equal(real.codigo, 0);
  assert.match(real.out, /"ejecutado": false/);
  assert.match(real.out, /NO ejecutado/);
  const x = cli(['preguntar', 'hola', '--cerebro', 'openai']);
  assert.equal(x.codigo, 1);
  assert.match(x.err, /no hay proveedor real configurado ni gasto autorizado/);
});
