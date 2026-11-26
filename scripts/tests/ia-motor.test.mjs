import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupIsolatedData } from './_helpers.mjs';

// Datos AISLADOS en un directorio temporal: la prueba nunca escribe en src/data ni depende de
// ejecuciones anteriores (antes fallaba al reutilizar la memoria persistida por otra ejecución).
const DATA_DIR = setupIsolatedData('tai-ia-motor-');
delete process.env.IA_PROVEEDOR;
delete process.env.IA_PROVEEDORES_DE_PAGO_AUTORIZADOS;
const {
  inferir, recordar, leerMemoria, olvidar, construirMensajes, obtenerConsumo, reactivarProveedor,
  apagarProveedorManual, ejecutarLlamadasHerramienta, ordenCandidatos, pagoAutorizado,
} = await import('../../src/lib/iaMotor.ts');
test.after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

/** Ruta del archivo de persistencia de una clave de memoria (replica la lógica de iaMotor). */
function rutaMemoria(agente, conversacion) {
  const clave = `${agente}::${conversacion}`.replace(/[^a-z0-9_-]/gi, '_');
  return path.join(DATA_DIR, 'ia-motor', `${clave}.json`);
}

/** Deja la memoria de una clave completamente vacía (disco y proceso). */
function limpiarMemoriaPrueba(agente, conversacion) {
  try { fs.unlinkSync(rutaMemoria(agente, conversacion)); } catch { /* no existe aún */ }
}

test('iaMotor: sin fallback oculto — solo el principal y las alternativas declaradas', () => {
  const credenciales = { ollama: true, openai: true, anthropic: true, gemini: true, groq: true, nvidia: false, openrouter: false };
  assert.deepEqual(ordenCandidatos('ollama', credenciales, [], {}), ['ollama'], 'nunca añade proveedores por su cuenta');
  assert.deepEqual(ordenCandidatos('ollama', credenciales, ['groq'], {}), ['ollama', 'groq']);
  assert.deepEqual(ordenCandidatos('ollama', credenciales, ['nvidia'], {}), ['ollama'], 'sin credenciales no se intenta');
});

test('iaMotor: un proveedor de pago exige autorización explícita, aunque tenga clave', () => {
  const credenciales = { ollama: true, openai: true, anthropic: true, gemini: true };
  assert.equal(pagoAutorizado('openai', {}), false);
  assert.equal(pagoAutorizado('ollama', {}), true);
  assert.deepEqual(ordenCandidatos('openai', credenciales, ['anthropic', 'ollama'], {}), ['ollama'], 'los de pago se descartan sin autorización');
  assert.deepEqual(
    ordenCandidatos('gemini', credenciales, ['openai'], { IA_PROVEEDORES_DE_PAGO_AUTORIZADOS: 'gemini' }),
    ['gemini'],
    'solo el proveedor autorizado por nombre',
  );
});

test('iaMotor: pedir un proveedor de pago no autorizado falla ANTES de llamar y no gasta', async () => {
  process.env.OPENAI_API_KEY = 'sk-prueba-sin-red';
  const fetchOriginal = globalThis.fetch;
  let llamadasDeRed = 0;
  globalThis.fetch = async () => { llamadasDeRed += 1; throw new Error('no debería haber red'); };
  try {
    await assert.rejects(
      inferir([{ rol: 'user', contenido: 'hola' }], { proveedor: 'openai', reintentos: 0 }),
      /no está autorizado/,
    );
    assert.equal(llamadasDeRed, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
    delete process.env.OPENAI_API_KEY;
  }
});

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
  limpiarMemoriaPrueba(agente, conv);
  recordar(agente, { rol: 'user', contenido: 'primero' }, conv);
  recordar(agente, { rol: 'assistant', contenido: 'respuesta' }, conv);
  const memoria = leerMemoria(agente, conv);
  assert.equal(memoria.length, 2);
  assert.equal(memoria[0].contenido, 'primero');
  assert.equal(memoria[1].contenido, 'respuesta');
  limpiarMemoriaPrueba(agente, conv);
});

test('iaMotor: olvidar borra la memoria de un agente/conversación', () => {
  const agente = 'agente-olvido';
  const conv = 'conv-olvido';
  limpiarMemoriaPrueba(agente, conv);
  recordar(agente, { rol: 'user', contenido: 'a borrar' }, conv);
  assert.equal(leerMemoria(agente, conv).length, 1);
  olvidar(agente, conv);
  assert.equal(leerMemoria(agente, conv).length, 0);
});

test('iaMotor: obtenerConsumo devuelve los 7 proveedores con estado (incluye ollama)', () => {
  const consumo = obtenerConsumo();
  assert.equal(consumo.length, 7);
  const ids = new Set(consumo.map((c) => c.proveedor));
  for (const p of ['ollama', 'openai', 'anthropic', 'groq', 'nvidia', 'openrouter', 'gemini']) {
    assert.ok(ids.has(p), `falta proveedor ${p}`);
    const consumoP = consumo.find((c) => c.proveedor === p);
    assert.ok(consumoP, `no hay entrada de consumo para ${p}`);
    assert.ok(typeof consumoP.llamadas === 'number');
    assert.ok(typeof consumoP.errores === 'number');
    assert.ok(typeof consumoP.apagado === 'boolean');
    assert.ok(typeof consumoP.libre === 'boolean');
  }
  // Ollama es local y debe marcarse como libre (sin facturación).
  const ollama = consumo.find((c) => c.proveedor === 'ollama');
  assert.ok(ollama, 'ollama debe aparecer en el consumo');
  assert.ok(ollama.libre, 'ollama debe ser libre');
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
