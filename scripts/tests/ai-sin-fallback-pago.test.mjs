/**
 * TREIDILOR — EL ENRIQUECIMIENTO DEL CATÁLOGO NO SALTA EN SILENCIO A PROVEEDORES DE PAGO.
 *
 * Antes, si el proveedor elegido (p. ej. Groq) fallaba, `enrichProductText` probaba OpenAI y Anthropic
 * con solo tener la clave configurada (como en producción). Ahora un proveedor de pago solo entra como
 * alternativa si figura en IA_PROVEEDORES_DE_PAGO_AUTORIZADOS. Se comprueba con un `fetch` simulado qué
 * servidores se llaman de verdad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupIsolatedData } from './_helpers.mjs';

setupIsolatedData('tai-ai-pago-');
process.env.TEXT_AI_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'gsk_prueba';
process.env.OPENAI_API_KEY = 'sk-prueba';
process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
delete process.env.IA_PROVEEDORES_DE_PAGO_AUTORIZADOS;

const ai = await import('../../src/lib/ai.ts');

/** fetch simulado: Groq responde 429 (cuota agotada); el resto también falla. Registra los hosts llamados. */
function simularRed() {
  const hosts = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    hosts.push(new URL(String(url)).host);
    return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  };
  return { hosts, restaurar: () => { globalThis.fetch = original; } };
}

test('candidatos: sin autorización, ninguna alternativa de pago', () => {
  assert.deepEqual(ai.textFallbackCandidates('groq', {}).filter((p) => ['openai', 'anthropic', 'gemini'].includes(p)), []);
  assert.ok(ai.textFallbackCandidates('groq', { IA_PROVEEDORES_DE_PAGO_AUTORIZADOS: 'openai' }).includes('openai'));
  assert.ok(!ai.textFallbackCandidates('groq', { IA_PROVEEDORES_DE_PAGO_AUTORIZADOS: 'openai' }).includes('anthropic'));
  assert.equal(ai.textFallbackCandidates('openai', {})[0], 'openai', 'el proveedor elegido expresamente se respeta');
});

test('Groq falla y NO se llama a OpenAI ni a Anthropic sin autorización', async () => {
  const red = simularRed();
  try {
    await assert.rejects(ai.enrichProductText({ title: 'Auriculares de prueba' }));
  } finally {
    red.restaurar();
  }
  assert.ok(red.hosts.some((h) => h.includes('groq')), 'se intentó el proveedor elegido');
  assert.ok(!red.hosts.some((h) => h.includes('openai.com') || h.includes('anthropic.com')), `sin llamadas de pago: ${red.hosts.join(', ')}`);
});

test('con autorización expresa, OpenAI sí puede actuar de alternativa', async () => {
  process.env.IA_PROVEEDORES_DE_PAGO_AUTORIZADOS = 'openai';
  const red = simularRed();
  try {
    await assert.rejects(ai.enrichProductText({ title: 'Auriculares de prueba' }));
  } finally {
    red.restaurar();
    delete process.env.IA_PROVEEDORES_DE_PAGO_AUTORIZADOS;
  }
  assert.ok(red.hosts.some((h) => h.includes('openai.com')));
  assert.ok(!red.hosts.some((h) => h.includes('anthropic.com')), 'solo el autorizado por nombre');
});
