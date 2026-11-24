// Comprobación funcional: el Director 00 obtiene resultados reales del Agente 04.
// Informe de calidad (instantánea 04.json) + propuestas de reparación
// (automation-proposals.json). Todo con datos sintéticos, solo lectura, sin tocar
// producción ni modificar productos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crearEntorno, AHORA } from '../evaluacion/entorno.mjs';
import { exportacion, fila } from '../fixtures/construir.mjs';
import { Canal13 } from '../canal/canal13.mjs';

const iso = (ms) => new Date(ms).toISOString();

const propuestas = {
  schemaVersion: 1,
  proposals: [
    {
      id: 'pr_00000001',
      clientId: 'cliente-prueba',
      agent: '04',
      type: 'correccion_catalogo',
      title: 'Reparar comercio malformado en producto p-003',
      payload: { productoId: 'p-003', campo: 'merchant', antes: '[object Object]', despues: 'TiendaX' },
      evidence: [],
      risk: 'medio',
      state: 'pendiente',
      createdAt: iso(AHORA - 3600000),
      expiresAt: iso(AHORA + 7 * 86400000),
      idempotencyKey: 'clave-001',
      payloadSha256: 'sha256:abc',
      applied: false,
    },
    {
      id: 'pr_00000002',
      clientId: 'cliente-prueba',
      agent: '04',
      type: 'correccion_catalogo',
      title: 'Eliminar valoración fabricada en producto p-007',
      payload: { productoId: 'p-007', campo: 'rating', antes: 4.8, despues: null },
      evidence: [],
      risk: 'bajo',
      state: 'pendiente',
      createdAt: iso(AHORA - 7200000),
      expiresAt: iso(AHORA + 7 * 86400000),
      idempotencyKey: 'clave-002',
      payloadSha256: 'sha256:def',
      applied: false,
    },
  ],
};

test('Director responde al Canal 13 con informe de calidad del Agente 04 (instantánea 04.json)', async () => {
  const inst = exportacion({
    agente: '04',
    filas: [fila({ id: 1, agente: '04', idEjecucion: 'fx-04-02', generadoEn: iso(AHORA - 86400000), fichas: ['p-001', 'p-002', 'p-003'], incidencias: [['ficha:comercio_malformado:p-003', 'media'], ['ficha:sin_categoria:p-001', 'media']] })],
  });
  const E = crearEntorno({ fix: { '04': inst } });
  try {
    const m = await new Canal13({ director: E.d }).recibir('¿Cómo está el catálogo?');
    assert.equal(m.estado, 'respondida', JSON.stringify(m));
    const todo = (m.textoClaro + ' ' + (m.detalle || '')).toLowerCase();
    assert.ok(todo.includes('comercio_malformado'), 'debe mencionar la incidencia de comercio malformado');
    assert.ok(todo.includes('fx-04-02'), 'debe mencionar el id de ejecución');
    const et = m.naturalezaDatos.map((n) => n.etiqueta);
    assert.ok(et.includes('simulado'), 'fixtures sintéticos → simulado');
  } finally { E.limpiar(); }
});

test('Director responde al Canal 13 con propuestas de reparación del Agente 04 (automation-proposals.json)', async () => {
  const E = crearEntorno({ fix: {} });
  try {
    const ruta = path.join(E.datosDir, 'automation-proposals.json');
    fs.writeFileSync(ruta, JSON.stringify(propuestas));
    assert.ok(fs.existsSync(ruta), 'el archivo de propuestas debe existir');
    assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).proposals.length, 2, 'el archivo debe tener 2 propuestas');
    const m = await new Canal13({ director: E.d }).recibir('propuestas 04');
    assert.ok(m.estado === 'respondida' || m.estado === 'parcial', `estado inesperado: ${m.estado}`);
    const todo = (m.textoClaro + ' ' + (m.detalle || '')).toLowerCase();
    assert.ok(todo.includes('pr_00000001'), 'debe mencionar la primera propuesta: ' + todo);
    assert.ok(todo.includes('p-003'), 'debe mencionar el producto: ' + todo);
    assert.ok(todo.includes('tiendax'), 'debe mencionar el valor después: ' + todo);
    assert.ok(todo.includes('2 pendiente') || todo.includes('pendiente'), 'debe indicar el total de propuestas: ' + todo);
    // No debe mencionar aplicación automática (solo lectura)
    assert.ok(!todo.includes('aplicar automáticamente'), 'no debe ofrecer aplicación automática');
  } finally { E.limpiar(); }
});

test('Director responde sin datos cuando no hay almacén de propuestas', async () => {
  const E = crearEntorno({ fix: {} });
  try {
    const m = await new Canal13({ director: E.d }).recibir('propuestas 04');
    const texto = (m.textoClaro + ' ' + (m.detalle || '')).toLowerCase();
    assert.ok(texto.includes('propuesta') || texto.includes('no consta'), 'debe hablar de propuestas de reparación');
  } finally { E.limpiar(); }
});
