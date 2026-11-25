/**
 * TREIDILOR — PRUEBAS ENFOCADAS DE SEGURIDAD: apartado Director IA.
 *
 * Valida exclusivamente el apartado Director IA (fase 1 de cierre):
 *  - escapeHtml evita la ejecución de HTML/JavaScript recibido (XSS).
 *  - resolverConfigPuente rechaza hosts no permitidos (solo bucle local o
 *    privados declarados en TAI_PUENTE_HOSTS_PERMITIDOS).
 *  - El cliente del puente no expone alcance confirmar (ya validado en
 *    director-ia-chat-contrato, se reafirma aquí).
 *
 * Son pruebas locales, sin red, sin producción y sin desplegar nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, resolverConfigPuente, TaiPuenteClient } from '../../src/lib/taiPuente.ts';

test('seguridad: escapeHtml neutraliza HTML y JavaScript inyectados', () => {
  // Etiquetas de script y eventos en línea deben quedar como texto plano.
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
  // Comillas en atributos.
  assert.equal(escapeHtml('<a href="x" onclick="y">'), '&lt;a href=&quot;x&quot; onclick=&quot;y&quot;&gt;');
  // Texto seguro y saltos de línea se conservan.
  assert.equal(escapeHtml('Hola\nDirector'), 'Hola\nDirector');
  // Valores nulos/undefined no rompen.
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
  // Sin comillas sin escapar que permitan romper atributos.
  assert.ok(!escapeHtml('texto "apelido" x\'y').includes('<'));
  assert.ok(!escapeHtml('texto "apelido" x\'y').includes('>'));
});

test('seguridad: escapeHtml no reintroduce caracteres peligrosos tras doble escape', () => {
  const una = escapeHtml('<script>');
  const dos = escapeHtml(una);
  assert.equal(dos, '&amp;lt;script&amp;gt;');
  assert.ok(!dos.includes('<script'));
  assert.ok(!dos.includes('onerror'));
});

test('seguridad: resolverConfigPuente solo permite bucle local o hosts privados declarados', () => {
  const base = { TAI_PUENTE_TOKEN: 'tai_xyz_abc' };
  assert.equal(resolverConfigPuente(base).host, '127.0.0.1');
  assert.equal(resolverConfigPuente({ ...base, TAI_PUENTE_HOST: 'localhost' }).host, 'localhost');
  assert.equal(resolverConfigPuente({ ...base, TAI_PUENTE_HOST: '::1' }).host, '::1');

  assert.throws(
    () => resolverConfigPuente({ ...base, TAI_PUENTE_HOST: 'treidilor.example' }),
    /no permitido/,
    'host público no declarado se rechaza',
  );
  assert.throws(
    () => resolverConfigPuente({ ...base, TAI_PUENTE_HOST: '185.220.101.44' }),
    /no permitido/,
    'host público IP se rechaza',
  );

  assert.doesNotThrow(
    () => resolverConfigPuente({ ...base, TAI_PUENTE_HOST: '10.0.0.5', TAI_PUENTE_HOSTS_PERMITIDOS: '10.0.0.5' }),
    'host privado declarado se admite',
  );
  assert.doesNotThrow(
    () => resolverConfigPuente({ ...base, TAI_PUENTE_HOST: '172.16.0.1', TAI_PUENTE_HOSTS_PERMITIDOS: '172.16.0.1' }),
    'host de red Docker privada declarado se admite',
  );
});

test('seguridad: el cliente del puente no expone operaciones de confirmar (alcance chat solo)', () => {
  const client = new TaiPuenteClient({
    host: '127.0.0.1', puerto: 1, token: 'tai_x_abc', timeoutMs: 1000,
  });
  assert.equal(typeof client.confirmar, 'undefined', 'no hay alcance confirmar en esta fase');
  assert.equal(typeof client.enviarMensaje, 'function');
  assert.equal(typeof client.obtenerHistorial, 'function');
  assert.equal(typeof client.abrirConversacionPrincipal, 'function');
  assert.equal(typeof client.obtenerPanel, 'function');
});
