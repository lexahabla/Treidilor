/**
 * TREIDILOR — PRUEBAS DEL ENDPOINT DE PANEL DEL DIRECTOR (Bloque 5).
 *
 * Valida el endpoint GET /api/admin/director-ia/panel: consulta el panel de
 * estado del Director a través del puente tai-chat/1. Devuelve información
 * SOLO LECTURA: agentes, estados, informes, tareas, resultados, limitaciones
 * y procedencia de los datos. No activa nuevas ejecuciones automáticas.
 *
 * Monta el servidor REAL de tai-chat/1 del worktree `autonomia` y usa
 * TaiPuenteClient.obtenerPanel() directamente contra él (que es lo que llama
 * el endpoint del panel).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import http from 'node:http';
import { TaiPuenteClient, resolverConfigPuente } from '../../src/lib/taiPuente.ts';

// ── Módulos reales del worktree `autonomia` ────────────────────────────────
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

// ── Entorno aislado ────────────────────────────────────────────────────────
const DATA_DIR = process.env.TRADYLOR_DATA_DIR || path.join(os.tmpdir(), 'tai-dir-ia-panel');
try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
fs.mkdirSync(DATA_DIR, { recursive: true });

const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const reloj = () => new Date(T0);
const registro = cargarRegistro();
const cierres = [];
const limpiar = (d) => { cierres.push(() => fs.rmSync(d, { recursive: true, force: true })); };
test.after(async () => {
  for (const c of cierres) { try { c(); } catch {} }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
});

const json = (res, estado, cuerpo) => { const t = JSON.stringify(cuerpo); res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(t), 'cache-control': 'no-store' }); res.end(t); };
const error = (res, estado, codigo, mensaje) => json(res, estado, { error: { codigo, mensaje } });
const leerCuerpo = (req) => new Promise((resolve, reject) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); req.on('error', reject); });
let cola = Promise.resolve(); const enCola = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };
const limitar = () => 0;

async function montarServidorChat() {
  const dirEstado = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-panel-estado-')); limpiar(dirEstado);
  const m = montarDirectorAutonomo({ dirEstado: path.join(dirEstado, 'estado'), carpetasDatos: [], registro });
  const chat = m.chat; const a = m.autonomia;
  const tokens = new AlmacenTokensRutinas();
  const { token } = tokens.crear({ id: 'panel-test', alcances: ['chat'], dias: 30 });
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
  return { puerto, token };
}

let servicio;

// ── Test 1: obtenerPanel devuelve información real de agentes y estados ────
test('panel: obtenerPanel devuelve información real de agentes, estados, encargos e informes', async () => {
  servicio = await montarServidorChat();
  const { puerto, token } = servicio;

  process.env.TAI_PUENTE_HOST = '127.0.0.1';
  process.env.TAI_PUENTE_PORT = String(puerto);
  process.env.TAI_PUENTE_TOKEN = token;
  const client = new TaiPuenteClient(resolverConfigPuente());

  const panel = await client.obtenerPanel();
  assert.equal(panel.esquema, 'tai-chat/1');
  assert.ok(Array.isArray(panel.agentes), 'agentes es un array');
  assert.ok(Array.isArray(panel.confirmacionesPendientes), 'confirmacionesPendientes es un array');
  assert.ok(panel.agentes.length >= 1, 'el panel expone al menos un agente del registro real');
  assert.ok(panel.en, 'hay marca de tiempo');

  // Verificar que los agentes tienen nombre y rutinas.
  const agente0 = panel.agentes[0];
  assert.ok(agente0.agente, 'el agente tiene id');
  assert.ok(agente0.nombre, 'el agente tiene nombre');
  assert.ok(Array.isArray(agente0.rutinas), 'el agente tiene rutinas');

  console.log(`  > agentes: ${panel.agentes.length}`);
  console.log(`  > encargos: ${panel.encargos.length}`);
  console.log(`  > confirmaciones pendientes: ${panel.confirmacionesPendientes.length}`);
});

// ── Test 2: El panel es solo lectura — no activa ejecuciones automáticas ──
test('panel: solo lectura — no activa nuevas ejecuciones automáticas', async () => {
  const { puerto, token } = servicio;
  process.env.TAI_PUENTE_HOST = '127.0.0.1';
  process.env.TAI_PUENTE_PORT = String(puerto);
  process.env.TAI_PUENTE_TOKEN = token;
  const client = new TaiPuenteClient(resolverConfigPuente());

  // El cliente del puente no expone operaciones de confirmar ni ejecución.
  assert.equal(typeof client.confirmar, 'undefined', 'sin alcance confirmar');
  assert.equal(typeof client.ejecutarEncargo, 'undefined', 'no hay ejecución automática');

  // Obtener panel es una operación de lectura (GET).
  const panel = await client.obtenerPanel();
  assert.equal(panel.esquema, 'tai-chat/1');
});

// ── Test 3: Procedencia de los datos ───────────────────────────────────────
test('panel: procedencia de los datos (Director 00, tai-chat/1)', async () => {
  const { puerto, token } = servicio;
  process.env.TAI_PUENTE_HOST = '127.0.0.1';
  process.env.TAI_PUENTE_PORT = String(puerto);
  process.env.TAI_PUENTE_TOKEN = token;
  const client = new TaiPuenteClient(resolverConfigPuente());

  const panel = await client.obtenerPanel();
  assert.equal(panel.esquema, 'tai-chat/1', 'el esquema es tai-chat/1');
  assert.ok(panel.en, 'fecha de generación del panel');

  // El alcance del token es chat: no permite confirmaciones.
  const verConfirmar = await (async () => {
    // usar el almacen directamente para verificar el alcance
    const { AlmacenTokensRutinas } = await import(fileUrl('automation/autonomia/tokens-rutinas.mjs'));
    const almacen = new AlmacenTokensRutinas();
    const { token: tk } = almacen.crear({ id: 'panel-procedencia', alcances: ['chat'], dias: 30 });
    return almacen.verificar(tk, 'confirmar');
  })();
  assert.equal(verConfirmar.ok, false, 'token de chat no permite confirmar');
});
