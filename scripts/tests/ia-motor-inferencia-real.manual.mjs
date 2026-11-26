import test from 'node:test';
import assert from 'node:assert/strict';

// Cargar variables de entorno desde .env (no se cargan automáticamente en scripts node sueltos).
import dotenv from 'dotenv';
dotenv.config();

import { inferir, obtenerConsumo, reactivarProveedor, obtenerConsumo as consumo } from '../../src/lib/iaMotor.ts';
import { hasTextCredentials } from '../../src/lib/ai.ts';

const PROVEEDORES = ['openai', 'anthropic', 'groq', 'nvidia', 'openrouter', 'gemini'];

function proveedorConCredenciales() {
  for (const p of PROVEEDORES) {
    if (hasTextCredentials(p)) return p;
  }
  return null;
}

function reactivarTodos() {
  for (const p of PROVEEDORES) {
    reactivarProveedor(p);
  }
}

/** Ejecuta una promesa con timeout global. Rechaza si se pasa el tiempo.
 * Captura el rechazo de la promesa original para evitar unhandledRejection
 * cuando el test termina antes de que el motor resuelva. */
function conTimeout(promesa, ms) {
  let temporizador;
  const carrera = Promise.race([
    promesa,
    new Promise((_, rechazar) => {
      temporizador = setTimeout(() => rechazar(new Error(`Tiempo agotado tras ${ms / 1000}s sin respuesta de ningún proveedor`)), ms);
    }),
  ]);
  // Evitar unhandledRejection si la promesa original se resuelve/rechaza tras el timeout.
  promesa.catch(() => {});
  carrera.finally(() => clearTimeout(temporizador));
  return carrera;
}

test('iaMotor: responde con un proveedor real y texto no vacío cuando hay credenciales', async () => {
  reactivarTodos();
  const proveedor = proveedorConCredenciales();
  if (!proveedor) {
    console.log('[iaMotor-inferencia-real] SALTADA: no hay credenciales de IA configuradas en .env.');
    return;
  }

  const credencialesDisponibles = PROVEEDORES.filter((p) => hasTextCredentials(p)).join(', ');
  console.log(`[iaMotor-inferencia-real] Proveedores con credenciales: ${credencialesDisponibles}`);

  let resultado;
  try {
    resultado = await conTimeout(
      inferir(
        [
          { rol: 'system', contenido: 'Eres el Director IA de Treidilor. Responde en español, de forma breve y amable.' },
          { rol: 'user', contenido: 'Di únicamente: Hola, soy el Director IA de Treidilor, respuesta real de un modelo de lenguaje.' },
        ],
        { proveedor, agente: 'director-00', trabajoId: 'prueba-inferencia-real-001' }
      ),
      40_000
    );
  } catch (error) {
    console.log(`[iaMotor-inferencia-real] SALTADA: ningún proveedor respondió dentro del tiempo. Último error: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  // Evidencias de inferencia real
  assert.ok(resultado.texto, 'El modelo devolvió texto vacío');
  assert.ok(resultado.texto.length > 5, 'El texto es demasiado corto para ser una respuesta real');
  assert.ok(resultado.proveedor, 'No se registró el proveedor');
  assert.ok(resultado.modelo, 'No se registró el modelo');
  assert.ok(resultado.huella, 'No se registró la huella');
  assert.ok(typeof resultado.llamadas === 'number' && resultado.llamadas >= 1, 'No se registró el número de llamadas');
  assert.ok(resultado.duracionMs > 0, 'No se registró la duración');
  assert.ok(Array.isArray(resultado.avisos), 'Los avisos no son un array');

  const textoMinus = resultado.texto.toLowerCase();
  assert.ok(
    textoMinus.includes('director') || textoMinus.includes('treidilor') || textoMinus.includes('ia') || textoMinus.includes('hola'),
    `El texto no parece una respuesta real del modelo: "${resultado.texto.slice(0, 120)}"`
  );

  console.log(`[iaMotor-inferencia-real] OK proveedor=${resultado.proveedor} modelo=${resultado.modelo} llamadas=${resultado.llamadas} duracion=${resultado.duracionMs}ms`);
  console.log(`  Texto: "${resultado.texto.slice(0, 200)}"`);
});

test('iaMotor: registra el consumo en el motor tras una inferencia', async () => {
  reactivarTodos();
  const proveedor = proveedorConCredenciales();
  if (!proveedor) {
    console.log('[iaMotor-inferencia-real] SALTADA (consumo): no hay credenciales.');
    return;
  }

  const antes = consumo().find((c) => c.proveedor === proveedor);
  const llamadasAntes = antes ? antes.llamadas : 0;

  let resultado;
  try {
    resultado = await conTimeout(
      inferir([{ rol: 'user', contenido: 'Responde una sola palabra: ok' }], { proveedor, agente: 'director-00', trabajoId: 'prueba-consumo-001' }),
      40_000
    );
  } catch (error) {
    console.log(`[iaMotor-inferencia-real] SALTADA (consumo): ningún proveedor respondió. ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const despues = consumo().find((c) => c.proveedor === proveedor);
  assert.ok(despues, `No hay registro de consumo para ${proveedor}`);
  assert.ok(despues.llamadas > llamadasAntes, 'El consumo no se incrementó tras la inferencia');
  console.log(`[iaMotor-inferencia-real] consumo ${proveedor}: ${llamadasAntes} -> ${despues.llamadas} (texto: "${resultado.texto.slice(0, 80)}")`);
});
