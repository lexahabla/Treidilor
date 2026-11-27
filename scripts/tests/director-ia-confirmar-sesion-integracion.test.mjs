/**
 * TREIDILOR — INTEGRACIÓN DE EXTREMO A EXTREMO (entorno aislado) de las APROBACIONES PROPORCIONADAS: panel web REAL → puente REAL del Director 1.3.6 → ledger REAL.
 *  · encargo ordinario al agente 05: el panel lo DESCRIBE (agente, tarea, datos, efecto, consecuencias, caducidad, huella) → se aprueba SIN contraseña →
 *    el ledger registra quién y «sesion» → repetir: rechazado; huella manipulada: rechazada; rechazar otro sin contraseña;
 *  · reanudar rutinas (sensible): sin contraseña NO (reautenticacion_requerida, nada cambia) → con contraseña sí, «reautenticacion» en el ledger;
 *  · el historial del panel muestra lo resuelto, por quién y con qué método.
 * Requiere la fuente del Director 1.3.6 (TAI_DIRECTOR_FUENTE); sin ella se omite. Con una fuente anterior (sin descripción) también se omite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';
import { FUENTE_DIRECTOR, OMITIR_SIN_DIRECTOR, importarDelDirector } from './_director-fuente.mjs';

const cargar = (rel) => (FUENTE_DIRECTOR ? importarDelDirector(rel).catch(() => ({})) : Promise.resolve({}));
const { montarDirectorAutonomo } = await cargar('automation/autonomia/analisis-comercial/montaje.mjs');
const { registroExtendido } = await cargar('automation/autonomia/analisis-comercial/capacidades.mjs');
const { crearManejadorChat } = await cargar('automation/autonomia/puente-chat.mjs');
const { AlmacenTokensRutinas } = await cargar('automation/autonomia/tokens-rutinas.mjs');
const { describirConfirmacion } = await cargar('automation/autonomia/confirmaciones-descripcion.mjs');
const OP = { skip: OMITIR_SIN_DIRECTOR || (typeof describirConfirmacion !== 'function' && 'la fuente del Director es anterior a 1.3.6 (sin confirmaciones descritas)') };

const json = (res, estado, cuerpo) => { const t = JSON.stringify(cuerpo); res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(t) }); res.end(t); };
const error = (res, estado, codigo, mensaje) => json(res, estado, { error: { codigo, mensaje } });
const leerCuerpo = (req) => new Promise((ok, ko) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); req.on('error', ko); });
let cola = Promise.resolve(); const enCola = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };
const IF = { canal: 'interfaz_autenticada' }; const dirs = []; let svc = null;
test.after(() => { try { svc?.close(); } catch {} for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

let E = null;
async function entorno() {
  if (E) return E;
  setupIsolatedData('tai-conf-ses-');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-conf-ses-dir-')); dirs.push(base);
  const m = montarDirectorAutonomo({ dirEstado: path.join(base, 'estado'), carpetasDatos: [], registro: registroExtendido() });
  m.autonomia.fijarPreautorizacion({ capacidades: ['01.analizar-senales-externas'], vence: new Date(Date.now() + 30 * 86_400_000).toISOString(), limites: { maxPorDia: 4 } }, IF);
  m.autonomia.crearRutina({ agente: '01', capacidad: '01.analizar-senales-externas', parametros: {}, cadencia: { tipo: 'cada', minutos: 60 } }, IF);
  for (const r of m.autonomia.resumen().rutinas) m.autonomia.almacen.registrar('rutina', 'suspender', r.id, { motivo: '3_fallos_consecutivos' });
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
  const confs = () => m.autonomia.almacen.estado().confirmaciones;
  E = { m, chat, conf, llamar, principal, panel, confirmar, confs }; return E;
}
const pedirEncargo05 = async (e, texto = 'encarga al agente 05 la capacidad 05.detectar-caidas-precio') => {
  const r = await e.llamar(e.principal, '/api/admin/director-ia/principal', 'POST', { texto }); assert.equal(r.status, 200, r.t);
  const pan = await e.llamar(e.panel, '/api/admin/director-ia/panel', 'GET'); const c = pan.j.confirmacionesPendientes.find((x) => x.tipo === 'encargo' && !e.confs().get(x.idConfirmacion)?.resueltaEn);
  assert.ok(c, `${r.j.respuesta?.textoClaro?.slice(0, 600)} || ${JSON.stringify(pan.j.confirmacionesPendientes).slice(0, 300)} || ${JSON.stringify(pan.j.encargos).slice(0, 400)}`); return c;
};

test('encargo ORDINARIO: el panel lo describe y se aprueba sin contraseña; el ledger registra quién y «sesion»; un solo uso; huella manipulada rechazada; rechazar sin contraseña', OP, async () => {
  const e = await entorno(); const c = await pedirEncargo05(e);
  assert.equal(c.titulo, 'Encargo a un agente'); assert.equal(c.pasos[0].agente, '05'); assert.ok(c.pasos[0].descripcion); assert.equal(c.pasos[0].soloLectura, true);
  assert.ok(c.encargo.id); assert.ok(c.consecuencias.length > 0); assert.equal(c.riesgo, 'ordinaria'); assert.equal(c.confirmacion, 'sesion'); assert.match(c.huella, /^sha256:/); assert.ok(Date.parse(c.caduca) > Date.now());
  const manip = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: c.idConfirmacion, decision: 'confirmar', huella: `sha256:${'0'.repeat(64)}` });
  assert.notEqual(manip.status, 200); assert.equal(manip.j.code, 'confirmacion_modificada'); assert.equal(e.confs().get(c.idConfirmacion).estado, 'pendiente');
  const ok = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: c.idConfirmacion, decision: 'confirmar', huella: c.huella });
  assert.equal(ok.status, 200, ok.t); assert.ok(!ok.t.includes(e.conf) && !ok.t.includes(e.chat));
  const reg = e.confs().get(c.idConfirmacion); assert.equal(reg.estado, 'confirmada'); assert.equal(reg.por, 'tester'); assert.equal(reg.metodo, 'sesion');
  const otra = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: c.idConfirmacion, decision: 'confirmar', huella: c.huella }); assert.equal(otra.j.code, 'confirmacion_resuelta');
  const c2 = await pedirEncargo05(e, 'encarga al agente 02 la capacidad 02.comparar-programas');
  const no = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: c2.idConfirmacion, decision: 'rechazar', huella: c2.huella }); assert.equal(no.status, 200, no.t);
  assert.equal(e.confs().get(c2.idConfirmacion).estado, 'rechazada'); assert.equal(e.confs().get(c2.idConfirmacion).metodo, 'sesion');
  const pan = await e.llamar(e.panel, '/api/admin/director-ia/panel', 'GET');
  const h = pan.j.confirmacionesRecientes.find((x) => x.idConfirmacion === c.idConfirmacion); assert.ok(h); assert.equal(h.por, 'tester'); assert.equal(h.metodo, 'sesion'); assert.ok(h.resueltaEn);
});

test('SENSIBLE (reanudar rutinas): sin contraseña NO se aprueba y nada cambia; con contraseña sí, con «reautenticacion» en el ledger', OP, async () => {
  const e = await entorno();
  await e.llamar(e.principal, '/api/admin/director-ia/principal', 'POST', { texto: 'Reanuda las rutinas suspendidas del agente 01' });
  const pan = await e.llamar(e.panel, '/api/admin/director-ia/panel', 'GET'); const c = pan.j.confirmacionesPendientes.find((x) => x.tipo === 'reanudar_rutina'); assert.ok(c, pan.t.slice(0, 400));
  assert.equal(c.riesgo, 'reforzada'); assert.equal(c.confirmacion, 'reautenticacion'); assert.equal(c.afectaProduccion, true);
  const sin = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: c.idConfirmacion, decision: 'confirmar', huella: c.huella });
  assert.equal(sin.status, 400); assert.equal(sin.j.code, 'reautenticacion_requerida'); assert.equal(e.m.autonomia.resumen().rutinas[0].estado, 'suspendida', 'nada cambia');
  const ok = await e.llamar(e.confirmar, '/api/admin/director-ia/confirmar', 'POST', { idConfirmacion: c.idConfirmacion, decision: 'confirmar', huella: c.huella, password: 'Test-pass-123' });
  assert.equal(ok.status, 200, ok.t); assert.equal(e.m.autonomia.resumen().rutinas[0].estado, 'activa');
  const reg = e.confs().get(c.idConfirmacion); assert.equal(reg.metodo, 'reautenticacion'); assert.equal(reg.por, 'tester');
});

test('HISTORIAL con el Director real: al recargar, las respuestas del Director siguen en el hilo (el historial real entrega la respuesta como texto)', OP, async () => {
  const e = await entorno();
  const env = await e.llamar(e.principal, '/api/admin/director-ia/principal', 'POST', { texto: '¿Qué agentes están activos?' }); assert.equal(env.status, 200, env.t);
  const g = await e.llamar(e.principal, '/api/admin/director-ia/principal', 'GET'); assert.equal(g.status, 200, g.t);
  const ms = g.j.conversacion.mensajes; const ultimoUsuario = ms.map((m) => m.rol).lastIndexOf('usuario');
  assert.ok(ultimoUsuario >= 0); assert.equal(ms[ultimoUsuario].contenido, '¿Qué agentes están activos?');
  const resp = ms[ultimoUsuario + 1]; assert.ok(resp && resp.rol === 'director', `tras el mensaje del propietario va la respuesta del Director: ${JSON.stringify(ms.slice(-3)).slice(0, 300)}`);
  assert.ok(String(resp.contenido).trim().length > 0); assert.equal(resp.contenido, env.j.respuesta.textoClaro, 'el historial contiene lo mismo que se mostró al enviar');
  assert.ok(resp.estado, 'conserva el estado del turno');
});
