/**
 * TREIDILOR — PRUEBAS DE SEGURIDAD: ROTACIÓN DEL TOKEN CHAT (Bloque 1).
 *
 * Valida el procedimiento de rotación del token chat comprometido:
 *  1. Generar token nuevo con alcance 'chat' (procedimiento administrativo existente).
 *  2. Verificar que el nuevo token es válido para 'chat' y no para 'confirmar'.
 *  3. Revocar el token y verificar que ya no se acepta.
 *  4. Un token diferente (simulando el anterior comprometido) no se acepta.
 *  5. El secreto en claro no se persiste (solo hash SHA-256).
 *
 * Usa AlmacenTokensRutinas del worktree `autonomia` (sin modificar archivos del Director).
 * Todo en memoria, sin red, sin producción.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AlmacenTokensRutinas } from '../../.worktrees/autonomia/automation/autonomia/tokens-rutinas.mjs';

const almacen = new AlmacenTokensRutinas();

// ── Test 1: Generar token nuevo con alcance 'chat' ─────────────────────────
test('token: generar token nuevo con alcance chat (procedimiento administrativo)', () => {
  const { id, token, caduca } = almacen.crear({ id: 'panel-chat-rotacion', alcances: ['chat'], dias: 30 });

  // Patrón tai_<id>_<secreto>.
  assert.match(token, /^tai_[a-z0-9-]{3,24}_[A-Za-z0-9_-]{20,80}$/, 'patrón tai_<id>_<secreto>');
  assert.equal(id, 'panel-chat-rotacion');
  assert.ok(caduca, 'hay fecha de caducidad');
  assert.ok(new Date(caduca) > new Date(), 'caducidad en el futuro');

  // El alcance es solo 'chat'.
  const ver = almacen.verificar(token, 'chat');
  assert.equal(ver.ok, true, 'token válido para chat');
  assert.deepEqual(ver.alcances, ['chat'], 'alcance solo chat');

  console.log(`  > token generado: id=${id}, caduca=${caduca}`);
  const segundoGuion = token.indexOf('_', token.indexOf('_') + 1);
  const secretoVisible = token.substring(segundoGuion + 1);
  console.log(`  > secreto (una sola vez, para TAI_PUENTE_TOKEN): ${secretoVisible}`);
});

// ── Test 2: El token de chat no permite confirmar ──────────────────────────
test('token: alcance chat no permite confirmar (seguridad)', () => {
  const { token } = almacen.crear({ id: 'panel-chat-no-confirmar', alcances: ['chat'], dias: 30 });

  const verConfirmar = almacen.verificar(token, 'confirmar');
  assert.equal(verConfirmar.ok, false, 'no permite confirmar');
  assert.equal(verConfirmar.codigo, 'permiso_denegado', 'código permiso_denegado');
});

// ── Test 3: Revocar token y verificar que ya no se acepta ──────────────────
test('token: revocar y verificar que ya no se acepta', () => {
  const { id, token } = almacen.crear({ id: 'panel-chat-revocar', alcances: ['chat'], dias: 30 });

  // Antes de revocar: válido.
  assert.equal(almacen.verificar(token, 'chat').ok, true);

  // Revocar.
  const revocado = almacen.revocar(id);
  assert.equal(revocado, true, 'token revocado');

  // Después de revocar: no se acepta.
  const ver = almacen.verificar(token, 'chat');
  assert.equal(ver.ok, false, 'token revocado no se acepta');
  assert.equal(ver.codigo, 'no_autenticado', 'código no_autenticado (no revela cuál falló)');
});

// ── Test 4: Token diferente (anterior comprometido) no se acepta ──────────
test('token: token anterior (diferente) no se acepta', () => {
  // Crear un token válido primero para que exista el cliente.
  almacen.crear({ id: 'panel-chat-valido', alcances: ['chat'], dias: 30 });

  // Simular el token anterior comprometido (secreto distinto, no existe en el almacén).
  const tokenAnterior = 'tai_panel-chat-valido_secreto_comprometido_falso_abcdef1234567890';
  const ver = almacen.verificar(tokenAnterior, 'chat');
  assert.equal(ver.ok, false, 'token anterior comprometido no se acepta');
  assert.equal(ver.codigo, 'no_autenticado', 'no revela si el id existe o el secreto es erróneo');
});

// ── Test 5: El secreto en claro no se persiste (solo hash SHA-256) ─────────
test('token: el secreto en claro no se persiste, solo el hash SHA-256', () => {
  const { id, token } = almacen.crear({ id: 'panel-chat-hash', alcances: ['chat'], dias: 30 });

  const segundoGuion = token.indexOf('_', token.indexOf('_') + 1);
  const secreto = token.substring(segundoGuion + 1);
  const c = almacen._clientes.get(id);
  assert.ok(c, 'cliente guardado');
  assert.equal(c.hash.length, 64, 'hash SHA-256 de 64 caracteres');
  assert.equal(c.token, undefined, 'el secreto en claro NO se persiste');
  assert.equal(c.revocado, false, 'no está revocado inicialmente');

  // Verificar que el hash coincide con el secreto.
  const hashEsperado = createHash('sha256').update(secreto).digest('hex');
  assert.equal(c.hash, hashEsperado, 'el hash almacenado coincide con el secreto');
});
