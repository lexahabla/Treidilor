// Metadatos técnicos del Director fuera de la conversación (27/11/2026): el propietario veía bajo la respuesta «Naturaleza: modo, conversacion, esquema,
// modelo, tokensEntrada, tokensSalida, costeEur, simulado, descartadas, marcadoresInvalidos» porque la web convertía TODAS las claves de `datos` en etiquetas.
// Ahora solo se muestran naturalezas comprensibles; los datos técnicos siguen en los registros del Director (manifiestos y consumo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { naturalezaLegible } from '../../src/lib/taiPuente.ts';

const DATOS_ANALISTA = { modo: 'analista', conversacion: 'charla', esquema: 'tai-analista/1', modelo: 'gemini-3.5-flash-lite', tokensEntrada: 1508, tokensSalida: 82, costeEur: 0.00066, simulado: false, descartadas: 0, marcadoresInvalidos: 0 };

test('la respuesta del modelo de conversación no lleva sus datos técnicos a la vista del propietario', () => {
  assert.deepEqual(naturalezaLegible(DATOS_ANALISTA), []);
  const texto = JSON.stringify(naturalezaLegible({ ...DATOS_ANALISTA, modo: 'canal', corregido: 'x' }));
  for (const clave of ['modo', 'conversacion', 'esquema', 'modelo', 'tokensEntrada', 'tokensSalida', 'costeEur', 'descartadas', 'marcadoresInvalidos', 'corregido']) assert.ok(!texto.includes(clave), clave);
});

test('solo naturalezas que sirven al propietario', () => {
  assert.deepEqual(naturalezaLegible({ datosReales: true, modo: 'documentos' }).map((n) => n.etiqueta), ['Tus documentos (leídos en local)']);
  assert.deepEqual(naturalezaLegible({ datosReales: true }).map((n) => n.etiqueta), ['Datos reales del negocio (no salen del sistema)']);
  assert.deepEqual(naturalezaLegible({ confidencial: true, datosReales: true }).map((n) => n.etiqueta), ['Datos reales del negocio (no salen del sistema)', 'Chat confidencial']);
  assert.deepEqual(naturalezaLegible({ ...DATOS_ANALISTA, simulado: true }).map((n) => n.etiqueta), ['Respuesta simulada (sin modelo real)']);
  assert.deepEqual(naturalezaLegible(null), []); assert.deepEqual(naturalezaLegible('x'), []);
});

test('el cliente del puente usa esa vista (también en las respuestas habladas) y la voz no lee estos datos', () => {
  const cliente = fs.readFileSync(new URL('../../src/lib/taiPuente.ts', import.meta.url), 'utf8');
  assert.match(cliente, /const naturalezaDatos = naturalezaLegible\(datos\);/); assert.doesNotMatch(cliente, /Object\.entries\(datos\)/);
  const panel = fs.readFileSync(new URL('../../src/pages/upayp1b4/director-ia.astro', import.meta.url), 'utf8');
  assert.match(panel, /const textoVoz = j\.respuesta\.detalle \|\| j\.respuesta\.textoClaro;/, 'la voz rápida lee el texto de la respuesta, no sus metadatos');
  assert.doesNotMatch(panel, /naturalezaDatos[^\n]*(speak|SpeechSynthesisUtterance|textoVoz)/);
});
