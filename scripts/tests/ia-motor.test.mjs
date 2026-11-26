import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferir,
  recordar,
  leerMemoria,
  olvidar,
  construirMensajes,
  obtenerConsumo,
  reactivarProveedor,
  apagarProveedorManual,
  ejecutarLlamadasHerramienta,
} from '../../src/lib/iaMotor.ts';

test('iaMotor: construirMensajes ordena system + historial + usuario', () => {
  const historial = [
    { rol: 'user', contenido: 'Hola' },
    { rol: 'assistant', contenido: 'Hola, ¿en qué te ayudo?' },
  ];
  const mensajes = construirMensajes('Eres el Director.', historial, '¿Cómo estás?');
  assert.equal(mensajes.length, 4);
  assert.equal(mensajes[0].rol, 'system');
  assert.equal(mensajes[0].contenido, 'Eres el Director.');
  assert.equal(mensajes[1].rol, 'user');
  assert.equal(mensajes[2].rol, 'assistant');
  assert.equal(mensajes[3].rol, 'user');
  assert.equal(mensajes[3].contenido, '¿Cómo estás?');
});

test('iaMotor: recordar y leerMemoria mantienen el historial', () => {
  const agente = 'agente-prueba';
  const conv = 'conv-1';
  recordar(agente, { rol: 'user', contenido: 'primero' }, conv);
  recordar(agente, { rol: 'assistant', contenido: 'respuesta' }, conv);
  const memoria = leerMemoria(agente, conv);
  assert.equal(memoria.length, 2);
  assert.equal(memoria[0].contenido, 'primero');
  assert.equal(memoria[1].contenido, 'respuesta');
});

test('iaMotor: olvidar borra la memoria de un agente/conversación', () => {
  const agente = 'agente-olvido';
  const conv = 'conv-olvido';
  recordar(agente, { rol: 'user', contenido: 'a borrar' }, conv);
  assert.equal(leerMemoria(agente, conv).length, 1);
  olvidar(agente, conv);
  assert.equal(leerMemoria(agente, conv).length, 0);
});

test('iaMotor: obtenerConsumo devuelve los 6 proveedores con estado', () => {
  const consumo = obtenerConsumo();
  assert.equal(consumo.length, 6);
  const ids = new Set(consumo.map((c) => c.proveedor));
  for (const p of ['openai', 'anthropic', 'groq', 'nvidia', 'openrouter', 'gemini']) {
    assert.ok(ids.has(p), `falta proveedor ${p}`);
    const consumoP = consumo.find((c) => c.proveedor === p);
    assert.ok(consumoP, `no hay entrada de consumo para ${p}`);
    assert.ok(typeof consumoP.llamadas === 'number');
    assert.ok(typeof consumoP.errores === 'number');
    assert.ok(typeof consumoP.apagado === 'boolean');
    assert.ok(typeof consumoP.libre === 'boolean');
  }
});

test('iaMotor: apagar y reactivar un proveedor', () => {
  const p = 'groq';
  apagarProveedorManual(p);
  const antes = obtenerConsumo().find((c) => c.proveedor === p);
  assert.ok(antes.apagado);
  reactivarProveedor(p);
  const despues = obtenerConsumo().find((c) => c.proveedor === p);
  assert.ok(!despues.apagado);
});

test('iaMotor: ejecutarLlamadasHerramienta ejecuta herramientas conocidas y falla en desconocidas', async () => {
  const herramientas = [
    {
      name: 'sumar',
      descripcion: 'Suma dos números',
      parametros: { tipo: 'objeto', propiedades: {} },
      ejecutar: async (args) => ({ ok: true, datos: Number(args.a) + Number(args.b) }),
    },
  ];

  const res = await ejecutarLlamadasHerramienta(
    [
      { id: 'c1', nombre: 'sumar', argumentos: { a: 2, b: 3 } },
      { id: 'c2', nombre: 'inexistente', argumentos: {} },
    ],
    herramientas
  );

  assert.equal(res.length, 2);
  assert.ok(res[0].ok);
  assert.equal(res[0].datos, 5);
  assert.ok(!res[1].ok);
  assert.ok(res[1].motivo.includes('desconocida'));
});
