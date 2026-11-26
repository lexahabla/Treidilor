/**
 * TREIDILOR — INTEGRACIÓN DE EXTREMO A EXTREMO (entorno aislado): panel web REAL → puente REAL del Director 1.3.2 → ledger REAL.
 *   propietario pide en el panel «Reanuda las rutinas suspendidas de los agentes 01, 02 y 07» → confirmación pendiente en el ledger →
 *   aparece en el panel → contraseña incorrecta: nada cambia → token de chat no puede confirmar → contraseña correcta: el Director reanuda
 *   y el ledger registra QUIÉN confirmó → repetir: rechazado. Cadencias, límites y preautorizaciones intactos; la 09 sigue igual.
 * Requiere la fuente del Director (TAI_DIRECTOR_FUENTE o .worktrees/autonomia); sin ella se omite indicando el motivo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';
import { FUENTE_DIRECTOR, OMITIR_SIN_DIRECTOR, importarDelDirector } from './_director-fuente.mjs';

const OP = { skip: OMITIR_SIN_DIRECTOR };
const cargar = (rel) => (FUENTE_DIRECTOR ? importarDelDirector(rel) : Promise.resolve({}));
const { montarDirectorAutonomo } = await cargar('automation/autonomia/analisis-comercial/montaje.mjs');
const { registroExtendido } = await cargar('automation/autonomia/analisis-comercial/capacidades.mjs');
const { crearManejadorChat } = await cargar('automation/autonomia/puente-chat.mjs');
const { AlmacenTokensRutinas } = await cargar('automation/autonomia/tokens-rutinas.mjs');

const json = (res, estado, cuerpo) => { const t = JSON.stringify(cuerpo); res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(t) }); res.end(t); };
const error = (res, estado, codigo, mensaje) => json(res, estado, { error: { codigo, mensaje } });
const leerCuerpo = (req) => new Promise((ok, ko) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); req.on('error', ko); });
let cola = Promise.resolve(); const enCola = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };

const IF = { canal: 'interfaz_autenticada' }; const dirs = []; let svc = null;
test.after(() => { try { svc?.close(); } catch {} for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

let E = null;
async function entorno() {
  if (E) return E;
  setupIsolatedData('tai-conf-int-');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-conf-int-dir-')); dirs.push(base);
  const m = montarDirectorAutonomo({ dirEstado: path.join(base, 'estado'), carpetasDatos: [], registro: registroExtendido() });
  for (const [agente, capacidad] of [['01', '01.analizar-senales-externas'], ['02', '02.examinar-programas-candidatos'], ['07', '07.proponer-estrategia-externa'], ['09', '09.analizar-referencias-de-competencia']]) {
    m.autonomia.fijarPreautorizacion({ capacidades: [capacidad], vence: new Date(Date.now() + 30 * 86_400_000).toISOString(), limites: { maxPorDia: 4 } }, IF);
    m.autonomia.crearRutina({ agente, capacidad, parametros: {}, cadencia: { tipo: 'cada', minutos: 60 } }, IF);
  }
  for (const r of m.autonomia.resumen().rutinas.filter((x) => ['01', '02', '07'].includes(x.agente))) m.autonomia.almacen.registrar('rutina', 'suspender', r.id, { motivo: '3_fallos_consecutivos' });
  const tokens = new AlmacenTokensRutinas();
  const chat = tokens.crear({ id: 'web-chat-prueba', alcances: ['chat'], dias: 1 }).token; const conf = tokens.crear({ id: 'web-confirmar-prueba', alcances: ['confirmar'], dias: 1 }).token;
  const manejar = crearManejadorChat({ chat: m.chat, chatAdmin: m.chat, tokens, ayudas: { json, error, leerCuerpo, limitar: () => 0, enCola } });
  svc = http.createServer((req, res) => { const ruta = (req.url || '').split('?')[0]; if (ruta.startsWith('/tai/v1/chat/')) { manejar(req, res, ruta).catch(() => { if (!res.headersSent) error(res, 500, 'interno', 'x'); }); return; } error(res, 404, 'no_encontrado', 'x'); });
  await new Promise((ok) => svc.listen(0, '127.0.0.1', ok));
  Object.assign(process.env, { TAI_PUENTE_HOST: '127.0.0.1', TAI_PUENTE_PORT: String(svc.address().port), TAI_PUENTE_TOKEN: chat, TAI_PUENTE_TOKEN_CONFIRMAR: conf, TAI_PUENTE_TIMEOUT: '10000' });
  const cookie = await adminCookie();
  const principal = await import('../../src/pages/api/admin/director-ia/principal.ts'); const panel = await import('../../src/pages/api/admin/director-ia/panel.ts'); const confirmar = await import('../../src/pages/api/admin/director-ia/confirmar.ts');
  const req = (u, metodo, cuerpo) => new Request('http://localhost' + u, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Director-IA': '1' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const llamar = async (ep, u, metodo, cuerpo) => { const r = await ep[metodo]({ request: req(u, metodo, cuerpo) }); const t = await r.text(); return { status: r.status, t, j: JSON.parse(t) }; };
  const estados = () => Object.fromEntries(m.autonomia.resumen().rutinas.map((r) => [r.agente, r.estado]));
  const ledger = () => { const leer = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? leer(path.join(d, e.name)) : e.name.endsWith('.jsonl') ? [fs.readFileSync(path.join(d, e.name), 'utf8')] : [])); return leer(path.join(base, 'estado')).join(String.fromCharCode(10)); };
  E = { m, chat, conf, llamar, principal, panel, confirmar, estados, ledger }; return E;
}

test('panel real → puente real 1.3.2 → ledger: pedir, ver pendiente, contraseña mala rechazada, token de chat no confirma, confirmar con contraseña, quién queda en el ledger', OP, async () => {
  const e = await entorno();
  const politicasAntes = JSON.stringify(e.m.autonomia.resumen().rutinas.map((r) => [r.id, r.cadencia, r.limites])); const preAntes = JSON.stringify([...e.m.autonomia.almacen.estado().preautorizaciones.values()]);
  const pide = await e.llamar(e.principal, '/api/admin/director-ia/principal', 'POST', { texto: 'Reanuda las rutinas suspendidas de los agentes 01, 02 y 07' });
  assert.equal(pide.status, 200, pide.t); assert.match(pide.j.respuesta.textoClaro, /Reanudar rutinas pendiente/);
  const pan = await e.llamar(e.panel, '/api/admin/director-ia/panel', 'GET'); assert.equal(pan.status, 200, pan.t);
  const pend = pan.j.confirmacionesPendientes.find((c) => c.tipo === 'reanudar_rutina'); assert.ok(pend, `aparece en «Confirmaciones pendientes»: ${pan.t.slice(0, 300)}`);
  assert.deepEqual(e.estados(), { '01': 'suspendida', '02': 'suspendida', '07': 'suspendida', '09': 'activa' }, 'pedirlo no cambia nada');

  const mala = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: pend.idConfirmacion, decision: 'confirmar', password: 'incorrecta' });
  assert.equal(mala.status, 403); assert.equal(e.estados()['01'], 'suspendida');
  const conChat = await fetch(`http://127.0.0.1:${process.env.TAI_PUENTE_PORT}/tai/v1/chat/confirmar`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${e.chat}` }, body: JSON.stringify({ idConfirmacion: pend.idConfirmacion, decision: 'confirmar', administrador: { id: 'x', usuario: 'x', reautenticadoEn: new Date().toISOString() } }) });
  assert.equal(conChat.status, 403, 'el token de chat NO puede confirmar'); assert.equal(e.estados()['01'], 'suspendida');

  const ok = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: pend.idConfirmacion, decision: 'confirmar', password: 'Test-pass-123' });
  assert.equal(ok.status, 200, ok.t); assert.ok(!ok.t.includes(e.conf) && !ok.t.includes(e.chat), 'ningún token en la respuesta');
  assert.deepEqual(e.estados(), { '01': 'activa', '02': 'activa', '07': 'activa', '09': 'activa' });
  assert.match(e.ledger(), new RegExp(`"id":"${pend.idConfirmacion}"[^\\n]*"resultado":"confirmada"[^\\n]*"usuario":"tester"|"resultado":"confirmada"[^\\n]*"usuario":"tester"`), 'el ledger registra la confirmación y QUIÉN la hizo');
  assert.equal(JSON.stringify(e.m.autonomia.resumen().rutinas.map((r) => [r.id, r.cadencia, r.limites])), politicasAntes, 'cadencias y límites intactos');
  assert.equal(JSON.stringify([...e.m.autonomia.almacen.estado().preautorizaciones.values()]), preAntes, 'preautorizaciones intactas');

  const otra = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: pend.idConfirmacion, decision: 'confirmar', password: 'Test-pass-123' });
  assert.notEqual(otra.status, 200, 'no se puede reutilizar'); assert.equal(otra.j.code, 'confirmacion_resuelta');
});
