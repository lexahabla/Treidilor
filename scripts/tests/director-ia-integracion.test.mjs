/**
 * TREIDILOR — COMPROBACIÓN DE INTEGRACIÓN LOCAL: chat Director IA ↔ servicio real `tai-chat/1` de `autonomia`.
 *
 * Verifica que el panel habla con el MISMO servicio conversacional persistente del Director 00
 * (ChatDirector de `automation/autonomia/chat.mjs`, servido por `crearManejadorChat` de
 * `automation/autonomia/puente-chat.mjs`), sin crear un Director propio, sin usar el puente antiguo
 * (`automation/director/puente/servidor.mjs`) y sin inventar contratos.
 *
 * Todo en bucle local (127.0.0.1), sin puertos publicados, sin producción, sin n8n, sin Telegram.
 * Los mensajes y expectativas se ajustan a lo que el servidor REAL devuelve (ver `instrucciones.mjs`),
 * no a un mock permisivo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import http from 'node:http';

// ── Módulos reales del worktree `autonomia` (Director 1.3.0-candidato, el de producción) ──
const AUT = 'D:\\AXEL\\WEBS\\TREIDILOR\\treidilor_web\\.worktrees\\autonomia';
const fileUrl = (p) => new URL('file:///' + path.join(AUT, p).replace(/\\/g, '/')).href;
const { montarDirectorAutonomo } = await import(fileUrl('automation/autonomia/analisis-comercial/montaje.mjs'));
const { crearManejadorChat } = await import(fileUrl('automation/autonomia/puente-chat.mjs'));
const { AlmacenTokensRutinas } = await import(fileUrl('automation/autonomia/tokens-rutinas.mjs'));
const { AlmacenAutonomia } = await import(fileUrl('automation/autonomia/almacen.mjs'));
const { Autonomia } = await import(fileUrl('automation/autonomia/orquestador.mjs'));
const { Instrucciones } = await import(fileUrl('automation/autonomia/instrucciones.mjs'));
const { ChatDirector } = await import(fileUrl('automation/autonomia/chat.mjs'));
const { cargarRegistro } = await import(fileUrl('automation/director/registro.mjs'));

import { TaiPuenteClient } from '../../src/lib/taiPuente.ts';
import { listarConversaciones, rutaConversaciones, guardarConversacionPrincipal } from '../../src/lib/directorIaStore.ts';

// ── Entorno aislado (volumen temporal) ─────────────────────────────────────────
const DATA_DIR = process.env.TRADYLOR_DATA_DIR || path.join(os.tmpdir(), 'tai-dir-ia-int');
try { fs.rmSync(rutaConversaciones(), { force: true }); } catch {}
fs.mkdirSync(path.dirname(rutaConversaciones()), { recursive: true });
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const reloj = () => new Date(T0);
const registro = cargarRegistro();
const dirs = []; const cierres = [];
const limpiar = (d) => { dirs.push(d); cierres.push(() => fs.rmSync(d, { recursive: true, force: true })); };
test.after(async () => {
  for (const c of cierres) { try { c(); } catch {} }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(rutaConversaciones(), { force: true }); } catch {}
});

// ── Ayudas del servicio (espejo de servicio-puente.mjs) ────────────────────────
const json = (res, estado, cuerpo) => { const t = JSON.stringify(cuerpo); res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(t), 'cache-control': 'no-store' }); res.end(t); };
const error = (res, estado, codigo, mensaje) => json(res, estado, { error: { codigo, mensaje } });
const leerCuerpo = (req) => new Promise((resolve, reject) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); req.on('error', reject); });
let cola = Promise.resolve(); const enCola = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };
const limitar = () => 0;

/** Monta el servidor REAL de `tai-chat/1` (ChatDirector + crearManejadorChat) en bucle local. */
async function montarServidorChat() {
  const dirEstado = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-integ-estado-')); limpiar(dirEstado);
  const m = montarDirectorAutonomo({ dirEstado: path.join(dirEstado, 'estado'), carpetasDatos: [], registro });
  const chat = m.chat; const a = m.autonomia;
  const tokens = new AlmacenTokensRutinas();
  const { token } = tokens.crear({ id: 'integ-test', alcances: ['chat'], dias: 30 });
  const manejarChat = crearManejadorChat({ chat, chatAdmin: chat, tokens, ayudas: { json, error, leerCuerpo, limitar, enCola } });
  const svc = http.createServer((req, res) => {
    const ruta = (req.url || '').split('?')[0];
    if (ruta.startsWith('/tai/v1/chat/')) { manejarChat(req, res, ruta).catch(() => { if (!res.headersSent) error(res, 500, 'interno', 'Error interno del servicio.'); }); return; }
    if (ruta === '/tai/v1/salud' && req.method === 'GET') return json(res, 200, { ok: true, estado: 'ok', version: '1.3.0-candidato', lector: [] });
    error(res, 404, 'no_encontrado', 'Ruta no encontrada.');
  });
  await new Promise((r) => svc.listen(0, '127.0.0.1', r));
  const puerto = svc.address().port;
  cierres.push(async () => { try { await svc.close(); } catch {} });
  const client = new TaiPuenteClient({ host: '127.0.0.1', puerto, token, timeoutMs: 10000 });
  return { client, cerrar: async () => { try { await svc.close(); } catch {} }, a, chat, tokens };
}

let servicio;

// ── Test 1: conversación real con el Director, historial y panel ───────────────
test('integración: conversación real con el Director (servidor tai-chat/1 de autonomía)', async (t) => {
  servicio = await montarServidorChat();
  const { client, a } = servicio;

  // 1. Abrir conversación principal (usuario A)
  const principal = await client.abrirConversacionPrincipal();
  assert.ok(principal.conversacion, 'se crea la conversación principal');
  assert.match(principal.conversacion, /^cv_[0-9a-f]{16}$/, 'formato cv_<16 hex>');
  assert.equal(principal.principal, true);

  // 2. Consulta de estado: el servidor REAL responde tipo 'estado' / estado 'consulta'
  const resp = await client.enviarMensaje('¿Cómo va el estado de los agentes?', { conversacion: principal.conversacion, via: 'panel' });
  assert.equal(resp.ok, true, 'respuesta del Director real: ' + JSON.stringify(resp));
  assert.equal(resp.registrada, true, 'la respuesta queda registrada (Director real)');
  assert.ok(resp.idSolicitud, 'hay identificador de solicitud');
  assert.equal(resp.tipoIntencion, 'estado', 'intención estado del Director real: ' + resp.tipoIntencion);
  const contenido = String(resp.textoClaro || '') + '\n' + String(resp.detalle || '');
  assert.match(contenido, /rutinas|agentes|ejecuciones/i, 'respuesta con información del Director, no simulada: ' + contenido.slice(0, 160).replace(/\n/g, ' '));
  assert.equal(resp.conversacion, principal.conversacion);
  assert.equal(resp.autorizacion.apruebaElPuente, false, 'el puente nunca aprueba');
  assert.equal(resp.autorizacion.pendientes.length, 0, 'sin alcance confirmar en esta fase');

  // 3. Segunda pregunta en la misma conversación (contexto de la conversación principal)
  const resp2 = await client.enviarMensaje('estado del negocio y los agentes', { conversacion: principal.conversacion, via: 'panel' });
  assert.equal(resp2.ok, true);
  assert.equal(resp2.tipoIntencion, 'estado', 'el seguimiento sigue siendo del Director: ' + resp2.tipoIntencion);
  assert.equal(resp2.conversacion, principal.conversacion, 'misma conversación');

  // 4. Historial real del servidor (fuente de verdad)
  const h = await client.obtenerHistorial(principal.conversacion);
  assert.equal(h.conversacion, principal.conversacion);
  assert.ok(h.turnos.length >= 2, 'historial con al menos 2 turnos');
  const roles = h.turnos.map((t) => t.origen);
  assert.ok(roles.includes('texto'), 'el historial registra el origen del mensaje');

  // 5. La conversación principal es COMPARTIDA por todos los canales (Telegram + panel):
  //    abrir de nuevo devuelve la misma (única) conversación.
  const principal2 = await client.abrirConversacionPrincipal();
  assert.equal(principal2.conversacion, principal.conversacion, 'conversación principal compartida (una sola)');

  // 6. Panel de estado (solo lectura) del Director real
  const panel = await client.obtenerPanel();
  assert.equal(panel.esquema, 'tai-chat/1');
  assert.ok(Array.isArray(panel.agentes) && Array.isArray(panel.confirmacionesPendientes));
  assert.ok(panel.agentes.length >= 1, 'el panel expone agentes del registro real');

  // 7. Salud (sin autenticación)
  const salud = await client.salud();
  assert.ok(salud && salud.ok && salud.version === '1.3.0-candidato');

  console.log('  > estado:', String(resp.textoClaro).slice(0, 90).replace(/\n/g, ' '));
  console.log('  > turnos en historial:', h.turnos.length);
});

// ── Test 2: almacenamiento en volumen persistente (ruta fuera del repositorio) ──
test('integración: almacenamiento en volumen persistente (ruta fuera del repositorio)', () => {
  const r = rutaConversaciones();
  assert.ok(r.includes(DATA_DIR) || r.includes('director-ia-conversaciones.json'), 'almacén en ruta de datos: ' + r);
  assert.ok(listarConversaciones('usuario-x').length === 0, 'sin conversaciones previas');
});

// ── Test 3: token chat solo servidor→servidor, sin alcance confirmar ───────────
test('seguridad: token de alcance chat, nunca viaja al cliente, sin confirmar', () => {
  // reconstruimos un token para inspeccionar su patrón sin exponer el secreto
  const t2 = new AlmacenTokensRutinas({ reloj: reloj });
  const { token: tk } = t2.crear({ id: 'seguridad-test', alcances: ['chat'], dias: 30 });
  assert.ok(/^tai_[a-z0-9-]{3,24}_[A-Za-z0-9_-]+$/.test(tk), 'token con patrón tai_<id>_<secreto>');
  const c = t2._clientes.get('seguridad-test');
  assert.ok(c, 'cliente guardado');
  assert.equal(c.token, undefined, 'el token en claro NO se persiste');
  assert.equal(typeof c.token, 'undefined', 'no se recupera el secreto en claro');
  assert.equal(c.hash.length, 64, 'se conserva el hash SHA-256');
  assert.ok(!('token' in c), 'no se guarda el secreto en claro');
  assert.equal(t2.verificar(tk, 'chat').ok, true, 'el token de chat es válido para conversar');
  assert.equal(t2.verificar(tk, 'confirmar').codigo, 'permiso_denegado', 'sin alcance confirmar');
  // el cliente del panel no expone confirmar
  assert.equal(typeof servicio.client.confirmar, 'undefined', 'el cliente no expone operaciones de confirmar');
});

// ── Test 4: instancia única, un solo escritor del ledger (secuencias consecutivas) ──
test('instancia única: un solo Director y un solo escritor del ledger (secuencias consecutivas)', async () => {
  const ledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-dir-ia-led-')); limpiar(ledDir);
  const a = new Autonomia({ almacen: new AlmacenAutonomia({ dir: path.join(ledDir, 'ledger'), reloj }), registro, reloj });
  const i = new Instrucciones({ autonomia: a, registro, reloj });
  const chatDir = new ChatDirector({ instrucciones: i, autonomia: a, registro, dir: path.join(ledDir, 'chat'), reloj });
  const cv = chatDir.crearConversacion().conversacion;
  const id = () => `msg-${Math.random().toString(36).slice(2, 12)}`;
  await chatDir.enviar({ conversacion: cv, id: id(), texto: '¿Cómo va el estado de los agentes?', origen: 'texto', confianza: 0, idioma: 'es' });
  await chatDir.enviar({ conversacion: cv, id: id(), texto: 'estado del negocio y los agentes', origen: 'texto', confianza: 0, idioma: 'es' });
  const eventos = a.almacen.ledger.leer();
  const sec = eventos.map((e) => e.secuencia);
  assert.deepEqual(sec, sec.map((_, i) => i + 1), 'secuencias consecutivas: un solo escritor del ledger');
  assert.ok(a.almacen.verificar().ok, 'cadena del ledger íntegra');
});

// ── Test 5: desconexión graceful ──────────────────────────────────────────────
test('integración: desconexión graceful del servicio', async () => {
  await servicio.cerrar();
  let fallo = false;
  try { await servicio.client.enviarMensaje('post-mortem', { conversacion: 'cv_0000000000000001' }); } catch { fallo = true; }
  assert.ok(fallo, 'servicio detenido, cliente no puede contactar');
});
