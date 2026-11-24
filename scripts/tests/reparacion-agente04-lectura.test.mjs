// Prueba de SOLO LECTURA del puente Agente 04 → Director 00.
// No modifica products.json ni ningún dato comercial.
// Lee propuestas de reparación y contador desde almacenes locales isolados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setupIsolatedData } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-ag04-read-');

const bridge = await import('../../src/lib/reparacionAgente04.ts');
const counter = await import('../../src/lib/repairCounter.ts');
const proposals = await import('../../src/lib/automationProposals.ts');

const counterFile = path.join(dir, 'repair-counter.json');
const proposalsFile = path.join(dir, 'automation-proposals.json');
const productsFile = path.join(dir, 'products.json');

const resetCounter = () => {
  if (fs.existsSync(counterFile)) fs.rmSync(counterFile, { force: true });
};
const resetProposals = () => {
  if (fs.existsSync(proposalsFile)) fs.rmSync(proposalsFile, { force: true });
};
const resetProducts = () => fs.writeFileSync(productsFile, '[]');

test('puenteOperativo con contador ausente → contador false, propuestas true (almacén legible, vacío)', () => {
  resetCounter();
  resetProposals();
  resetProducts();
  const p = bridge.puenteOperativo();
  assert.equal(p.contador, false, 'contador no disponible sin archivo');
  assert.equal(p.propuestas, true, 'almacén de propuestas legible (inicializa vacío)');
});

test('estadoAgente04 con contador ausente y propuestas ausente → ok, disponible false, totalPendientes 0', () => {
  resetCounter();
  resetProposals();
  resetProducts();
  const r = bridge.estadoAgente04();
  assert.equal(r.ok, true, 'estadoAgente04 devuelve ok aunque falten almacenes');
  assert.equal(r.datos.agente, '04');
  assert.equal(r.datos.modulo, 'calidad-catalogo');
  assert.equal(r.datos.contador.disponible, false, 'contador no disponible');
  assert.equal(r.datos.propuestas.totalPendientes, 0, 'sin propuestas pendientes');
  assert.equal(r.datos.lecturasDisponibles.informeCalidadN8n, false, 'informe de n8n no accesible desde aquí');
});

test('estadoAgente04 con contador válido y una propuesta pendiente', async () => {
  resetCounter();
  resetProposals();
  resetProducts();

  counter.initRepairCounter();
  counter.reserveAndRecord('malformed-merchant');

  // Crear una propuesta pendiente de tipo correccion_catalogo para el agente 04
  const creada = proposals.createProposal(
    'cliente-prueba',
    {
      agent: '04',
      type: 'correccion_catalogo',
      title: 'Reparar comercio malformado en producto p1',
      payload: {
        productoId: 'p1',
        campo: 'merchant',
        antes: '[object Object]',
        despues: 'TiendaX',
      },
      evidence: [],
      risk: 'medio',
      ttlDays: 14,
    },
    { idempotencyKey: 'clave-prueba-001' },
    new Date(),
  );
  assert.equal(creada.ok, true, JSON.stringify(creada));
  assert.ok(creada.proposal.id, 'la propuesta tiene id');

  const r = bridge.estadoAgente04();
  assert.equal(r.ok, true);
  assert.equal(r.datos.contador.disponible, true);
  assert.equal(r.datos.contador.totalAplicadas, 1);
  assert.equal(r.datos.propuestas.totalPendientes, 1);
  assert.equal(r.datos.propuestas.pendientes[0].id, creada.proposal.id);
  assert.equal(r.datos.propuestas.pendientes[0].productoId, 'p1');
  assert.equal(r.datos.propuestas.pendientes[0].campo, 'merchant');
  assert.equal(r.datos.propuestas.pendientes[0].valorAntes, '[object Object]');
  assert.equal(r.datos.propuestas.pendientes[0].valorDespues, 'TiendaX');
});

test('obtenerPropuestaReparacion rechaza si no es de tipo correccion_catalogo', async () => {
  resetCounter();
  resetProposals();
  resetProducts();

  counter.initRepairCounter();

  const creada = proposals.createProposal(
    'cliente-prueba',
    {
      agent: '04',
      type: 'categoria',
      title: 'Propuesta de categoría',
      payload: {},
      evidence: [],
      risk: 'bajo',
      ttlDays: 14,
    },
    { idempotencyKey: 'clave-prueba-002' },
    new Date(),
  );
  assert.equal(creada.ok, true);

  const r = bridge.obtenerPropuestaReparacion(creada.proposal.id);
  assert.equal(r.ok, false);
  assert.ok(r.mensaje?.includes('no es de tipo'), 'debe rechazar tipo no reparación');
});

test('listarPropuestasReparacion sólo devuelve tipo correccion_catalogo', async () => {
  resetCounter();
  resetProposals();
  resetProducts();

  counter.initRepairCounter();

  await proposals.createProposal(
    'cliente-prueba',
    {
      agent: '04',
      type: 'correccion_catalogo',
      title: 'Reparar p1',
      payload: { productoId: 'p1', campo: 'merchant', antes: 'X', despues: 'Y' },
      evidence: [],
      risk: 'medio',
      ttlDays: 14,
    },
    { idempotencyKey: 'clave-prueba-003' },
    new Date(),
  );
  await proposals.createProposal(
    'cliente-prueba',
    {
      agent: '04',
      type: 'categoria',
      title: 'Categoría nueva',
      payload: {},
      evidence: [],
      risk: 'bajo',
      ttlDays: 14,
    },
    { idempotencyKey: 'clave-prueba-004' },
    new Date(),
  );

  const r = bridge.listarPropuestasReparacion();
  assert.equal(r.ok, true);
  assert.equal(r.propuestas.length, 1, 'solo una propuesta de tipo correccion_catalogo');
  assert.equal(r.propuestas[0].title, 'Reparar p1');
});

test('no modifica products.json durante las lecturas', () => {
  resetCounter();
  resetProposals();
  resetProducts();

  const antes = fs.readFileSync(productsFile, 'utf8');

  bridge.estadoAgente04();
  bridge.puenteOperativo();
  bridge.listarPropuestasReparacion();
  bridge.readReparacionCounter();

  const despues = fs.readFileSync(productsFile, 'utf8');
  assert.equal(antes, despues, 'products.json no se modificó');
  assert.equal(antes, '[]', 'products.json sigue vacío');
});
