/**
 * TREIDILOR — PRUEBA DE RESPUESTAS NATURALES DEL DIRECTOR (Problema 2).
 *
 * Valida que la capa conversacional local (`src/lib/directorIaConversacion.ts`)
 * distingue mensajes sociales de consultas de negocio y genera respuestas
 * naturales y cordiales para saludos y preguntas cotidianas, sin clasificar
 * como `no_entendida`.
 *
 * Mensajes obligatorios del propietario:
 *  - "Hola"
 *  - "Buenos días"
 *  - "¿Cómo estás?"
 *  - "¿Qué tal va todo?"
 *  - "¿Qué puedes hacer?"
 *  - "Cuéntame cómo va Treidilor."        → consulta de negocio (va al puente)
 *  - "¿Qué han hecho nuestros agentes?"  → consulta de negocio (va al puente)
 *  - "Explícame mejor lo último que me has dicho." → consulta de negocio
 *
 * También valida conversación libre de 5+ turnos y que no se inventan datos
 * del negocio.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

let clasificarIntencion, respuestaSocial, respuestaSinDatos;
test('setup: importar directorIaConversacion', async () => {
  const mod = await import('../../src/lib/directorIaConversacion.ts');
  clasificarIntencion = mod.clasificarIntencion;
  respuestaSocial = mod.respuestaSocial;
  respuestaSinDatos = mod.respuestaSinDatos;
  assert.ok(typeof clasificarIntencion === 'function');
  assert.ok(typeof respuestaSocial === 'function');
  assert.ok(typeof respuestaSinDatos === 'function');
});

// ── Mensajes sociales: deben clasificarse como 'social' y obtener respuesta natural ──
const MENSAJES_SOCIALES = [
  { texto: 'Hola', espera: 'social' },
  { texto: 'Buenos días', espera: 'social' },
  { texto: 'Buenas tardes', espera: 'social' },
  { texto: '¿Cómo estás?', espera: 'social' },
  { texto: '¿Qué tal va todo?', espera: 'social' },
  { texto: '¿Qué puedes hacer?', espera: 'social' },
  { texto: '¿Quién eres?', espera: 'social' },
  { texto: 'Gracias', espera: 'social' },
  { texto: 'Adiós', espera: 'social' },
];

for (const { texto, espera } of MENSAJES_SOCIALES) {
  test(`Conversación: «${texto}» se clasifica como social`, () => {
    const intencion = clasificarIntencion(texto);
    assert.equal(intencion, espera, `«${texto}» debería ser ${espera}, fue ${intencion}`);

    const respuesta = respuestaSocial(texto);
    assert.ok(typeof respuesta === 'string' && respuesta.trim().length > 0,
      `«${texto}» debe generar una respuesta natural no vacía`);
    assert.ok(!respuesta.includes('No he entendido'),
      `«${texto}» no debe responder con «No he entendido»`);
    assert.ok(!respuesta.includes('no_entendida'),
      `«${texto}» no debe usar la clasificación «no_entendida»`);
  });
}

// ── Consultas de negocio: deben ir al puente (no son sociales) ──
const MENSAJES_NEGOCIO = [
  { texto: '¿Cómo va el estado de los agentes?' },
  { texto: '¿Qué han hecho nuestros agentes?' },
  { texto: 'Cuéntame cómo va Treidilor.' },
  { texto: 'Explícame mejor lo último que me has dicho.' },
  { texto: '¿Cuántas ventas hubo ayer?' },
];

for (const { texto } of MENSAJES_NEGOCIO) {
  test(`Negocio: «${texto}» NO es social (va al puente)`, () => {
    const intencion = clasificarIntencion(texto);
    assert.notEqual(intencion, 'social',
      `«${texto}» no debe clasificarse como social; fue ${intencion}`);
    assert.ok(intencion === 'consulta_negocio' || intencion === 'desconocida',
      `«${texto}» debe ser consulta_negocio o desconocida, fue ${intencion}`);
  });
}

// ── Respuesta sin datos (fallback cuando el puente no entiende una consulta no social) ──
test('Respuesta sin datos: fallback natural para consultas no entendidas', () => {
  const texto = '¿Cuál es el precio del producto XYZ?';
  const fallback = respuestaSinDatos(texto);
  assert.ok(typeof fallback === 'string' && fallback.trim().length > 0,
    'respuestaSinDatos debe devolver texto no vacío');
  assert.ok(!fallback.includes('No he entendido'),
    'el fallback no debe decir «No he entendido»');
  assert.ok(fallback.includes('¿') || fallback.includes('ayudar') || fallback.includes('puedo'),
    'el fallback debe ofrecer ayuda, no solo rechazar');
});

// ── Conversación libre de 5+ turnos relacionados ──
test('Conversación libre: 5 turnos relacionados mantienen coherencia', () => {
  const turno1 = clasificarIntencion('Hola');
  assert.equal(turno1, 'social');

  const turno2 = clasificarIntencion('¿Cómo estás?');
  assert.equal(turno2, 'social');

  const turno3 = clasificarIntencion('¿Qué puedes hacer?');
  assert.equal(turno3, 'social');

  const turno4 = clasificarIntencion('¿Cómo va el estado de los agentes?');
  assert.equal(turno4, 'consulta_negocio');

  const turno5 = clasificarIntencion('Gracias');
  assert.equal(turno5, 'social');

  // Cada respuesta social debe ser distinta y natural
  const r1 = respuestaSocial('Hola');
  const r2 = respuestaSocial('Buenos días');
  const r3 = respuestaSocial('¿Cómo estás?');
  assert.notEqual(r1, r2, 'respuestas a distintos saludos deben diferir');
  assert.ok(r1.length > 10 && r2.length > 10 && r3.length > 10,
    'las respuestas sociales deben ser sustanciales');
});

// ── No inventar datos del negocio ──
test('No inventar datos: las respuestas sociales no afirman hechos del negocio', () => {
  const respuestas = MENSAJES_SOCIALES.map((m) => respuestaSocial(m.texto));
  const palabrasNegocio = ['venta', 'ventas', 'agente', 'agentes', 'informe', 'informe',
    'comisión', 'precio', 'stock', 'ganancia', 'beneficio'];
  for (const r of respuestas) {
    const bajo = r.toLowerCase();
    for (const p of palabrasNegocio) {
      assert.ok(!bajo.includes(p),
        `respuesta social no debe afirmar dato de negocio («${p}» en: ${r.slice(0, 60)}…)`);
    }
  }
});

test.after(async () => { /* nada que limpiar */ });
