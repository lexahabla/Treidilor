/**
 * TREIDILOR — PRUEBA DE REGRESIÓN: listener de botones de voz (Problema 1).
 *
 * Detecta el error confirmado en el commit 73dabf5: en
 * src/pages/upayp1b4/director-ia.astro los controles btnVoz y btnDetenerVoz
 * se recuperan dentro de elsVoz, pero los listeners externos usan
 * els.btnVoz / els.btnDetenerVoz, propiedades que NO existían en el objeto
 * `els`. Como resultado, los listeners nunca se registraban y el botón
 * «Hablar» no hacía nada.
 *
 * Esta prueba lee el archivo .astro y verifica que:
 *  1. btnVoz y btnDetenerVoz están definidos en el objeto `els` (no solo en elsVoz).
 *  2. Los event listeners usan els.btnVoz / els.btnDetenerVoz (coherentes con la definición).
 *
 * Es una prueba de código fuente (no requiere navegador ni DOM).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';

const ASTRO_PATH = path.join(process.cwd(), 'src/pages/upayp1b4/director-ia.astro');

test('Botón Hablar: btnVoz y btnDetenerVoz están definidos en el objeto els', () => {
  const src = fs.readFileSync(ASTRO_PATH, 'utf8');

  // Verificar que el objeto els existe y contiene ambas claves
  assert.ok(/const\s+els\s*=\s*\{/.test(src), 'debe existir el objeto const els = {...}');

  // btnVoz y btnDetenerVoz deben aparecer como claves del objeto els (seguido de :)
  assert.match(src, /btnVoz\s*:/, 'btnVoz debe ser una clave del objeto els');
  assert.match(src, /btnDetenerVoz\s*:/, 'btnDetenerVoz debe ser una clave del objeto els');

  // Ambos deben obtenerse por document.getElementById con el id correcto
  assert.match(src, /btnVoz\s*:\s*document\.getElementById\('btnVoz'\)/,
    'btnVoz debe obtenerse con document.getElementById("btnVoz")');
  assert.match(src, /btnDetenerVoz\s*:\s*document\.getElementById\('btnDetenerVoz'\)/,
    'btnDetenerVoz debe obtenerse con document.getElementById("btnDetenerVoz")');
});

test('Botón Hablar: los listeners externos usan els.btnVoz / els.btnDetenerVoz', () => {
  const src = fs.readFileSync(ASTRO_PATH, 'utf8');

  // Los listeners deben referenciar els.btnVoz y els.btnDetenerVoz
  assert.match(src, /els\.btnVoz\.addEventListener/,
    'debe registrar listener en els.btnVoz');
  assert.match(src, /els\.btnDetenerVoz\.addEventListener/,
    'debe registrar listener en els.btnDetenerVoz');

  // Y ambos deben estar protegidos por if (els.btnVoz) / if (els.btnDetenerVoz)
  assert.match(src, /if\s*\(els\.btnVoz\)/, 'els.btnVoz debe estar protegido por if');
  assert.match(src, /if\s*\(els\.btnDetenerVoz\)/, 'els.btnDetenerVoz debe estar protegido por if');
});

test('Botón Hablar: elsVoz también obtiene los elementos por su id (doble cobertura)', () => {
  const src = fs.readFileSync(ASTRO_PATH, 'utf8');

  assert.match(src, /document\.getElementById\('btnVoz'\)/,
    'elsVoz.btn debe obtener btnVoz por id');
  assert.match(src, /document\.getElementById\('btnDetenerVoz'\)/,
    'elsVoz.btnDetener debe obtener btnDetenerVoz por id');
});

test.after(async () => { /* nada que limpiar */ });
