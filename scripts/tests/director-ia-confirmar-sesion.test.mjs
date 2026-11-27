/**
 * TREIDILOR — APROBACIONES SIN CONTRASEÑA REPETIDA (web + Director 1.3.6), contra un puente de prueba que registra lo que recibe.
 *  · con huella: llega `metodo: 'sesion'` + `verificadoEn` + la huella exacta, SIN contraseña ni reautenticación;
 *  · sin sesión, sin CSRF o sin ser master: no llega nada al Director; huella mal formada: tampoco;
 *  · rechazar nunca pide contraseña; aprobar sin huella (Director anterior) sí, como antes;
 *  · si el Director decide que es sensible (`reautenticacion_requerida`), la web lo traslada y la contraseña vale unos minutos SOLO para esa sesión;
 *  · el panel muestra los textos de hora de Madrid y no pide contraseña a las ordinarias.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';

const TOKEN_CHAT = 'tai_chat_' + 'a'.repeat(24); const TOKEN_CONF = 'tai_confirmar_' + 'b'.repeat(24);
const HUELLA = `sha256:${'c'.repeat(64)}`; const SENSIBLE = 'cf_01M8CJ6KGSB01JRG5RCWR8539S';
let n = 0; const nuevoId = () => `cf_01M8CJ6KGSB01JRG5RCWR85${String(n++).padStart(3, '0')}`.replace(/[ILOU]/g, '0');
const recibidas = []; const resueltas = new Set();
const srv = http.createServer(async (req, res) => {
  const trozos = []; for await (const t of req) trozos.push(t); const cuerpo = JSON.parse(Buffer.concat(trozos).toString() || '{}');
  recibidas.push({ ruta: req.url, auth: req.headers.authorization, cuerpo });
  const r = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== `Bearer ${TOKEN_CONF}`) return r(403, { error: { codigo: 'permiso_denegado', mensaje: 'alcance' } });
  // el Director decide: SENSIBLE exige reautenticación reciente
  if (cuerpo.idConfirmacion === SENSIBLE && cuerpo.decision === 'confirmar' && !cuerpo.administrador?.reautenticadoEn) return r(400, { error: { codigo: 'reautenticacion_requerida', mensaje: 'Para confirmar esto hay que volver a introducir tu contraseña.' } });
  if (resueltas.has(cuerpo.idConfirmacion)) return r(409, { error: { codigo: 'confirmacion_resuelta', mensaje: 'ya resuelta' } });
  resueltas.add(cuerpo.idConfirmacion); return r(200, { esquema: 'tai-chat/1', resultado: { ok: true } });
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
setupIsolatedData('tai-confirmar-sesion-');
Object.assign(process.env, { TAI_PUENTE_HOST: '127.0.0.1', TAI_PUENTE_PORT: String(srv.address().port), TAI_PUENTE_TOKEN: TOKEN_CHAT, TAI_PUENTE_TOKEN_CONFIRMAR: TOKEN_CONF, TAI_PUENTE_TIMEOUT: '5000' });
const cookie = await adminCookie();
const ep = await import('../../src/pages/api/admin/director-ia/confirmar.ts');
const pedir = async (cuerpo, { ck = cookie, csrf = true } = {}) => { const r = await ep.POST({ request: new Request('http://localhost/api/admin/director-ia/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}), ...(csrf ? { 'X-Director-IA': '1' } : {}) }, body: JSON.stringify(cuerpo) }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = {}; } return { status: r.status, t, j }; };
test.after(() => srv.close());

test('APROBAR un encargo ordinario con la sesión: sin contraseña; llegan método, verificación y huella; ni contraseña ni token en la respuesta', async () => {
  const id = nuevoId(); const r = await pedir({ idConfirmacion: id, decision: 'confirmar', huella: HUELLA });
  assert.equal(r.status, 200, r.t); const env = recibidas.at(-1).cuerpo;
  assert.equal(recibidas.at(-1).auth, `Bearer ${TOKEN_CONF}`); assert.equal(env.huella, HUELLA); assert.equal(env.administrador.metodo, 'sesion'); assert.equal(env.administrador.usuario, 'tester');
  assert.ok(Math.abs(Date.now() - Date.parse(env.administrador.verificadoEn)) < 60_000); assert.equal(env.administrador.reautenticadoEn, undefined, 'no se inventa una reautenticación');
  assert.ok(!r.t.includes(TOKEN_CONF) && !r.t.includes(TOKEN_CHAT));
  const otra = await pedir({ idConfirmacion: id, decision: 'confirmar', huella: HUELLA }); assert.equal(otra.status, 409); assert.equal(otra.j.code, 'confirmacion_resuelta', 'un solo uso');
});

test('RECHAZAR sin contraseña, con o sin huella', async () => {
  assert.equal((await pedir({ idConfirmacion: nuevoId(), decision: 'rechazar', huella: HUELLA })).status, 200);
  const r = await pedir({ idConfirmacion: nuevoId(), decision: 'rechazar' }); assert.equal(r.status, 200, r.t);
  assert.deepEqual(Object.keys(recibidas.at(-1).cuerpo.administrador).sort(), ['id', 'usuario'], 'sin huella se usa la forma antigua (compatible con 1.3.5)');
});

test('se niegan sin llegar al Director: sin sesión, sin CSRF, huella mal formada; y aprobar sin huella sigue pidiendo contraseña', async () => {
  const antes = recibidas.length;
  assert.equal((await pedir({ idConfirmacion: nuevoId(), decision: 'confirmar', huella: HUELLA }, { ck: null })).status, 401);
  assert.equal((await pedir({ idConfirmacion: nuevoId(), decision: 'confirmar', huella: HUELLA }, { csrf: false })).status, 403);
  const mala = await pedir({ idConfirmacion: nuevoId(), decision: 'confirmar', huella: 'sha256:xyz' }); assert.equal(mala.status, 400); assert.equal(mala.j.code, 'solicitud_invalida');
  const sinHuella = await pedir({ idConfirmacion: nuevoId(), decision: 'confirmar' }); assert.equal(sinHuella.j.code, 'reautenticacion_requerida');
  assert.equal(recibidas.length, antes, 'ninguna petición al Director');
});

test('REFORZADA: el Director exige contraseña → la web lo traslada; con contraseña se aprueba y vale unos minutos solo para ESA sesión', async () => {
  const sin = await pedir({ idConfirmacion: SENSIBLE, decision: 'confirmar', huella: HUELLA }); assert.equal(sin.status, 400); assert.equal(sin.j.code, 'reautenticacion_requerida'); assert.match(sin.j.message, /contraseña/);
  const mala = await pedir({ idConfirmacion: SENSIBLE, decision: 'confirmar', huella: HUELLA, password: 'incorrecta' }); assert.equal(mala.status, 403); assert.equal(mala.j.code, 'reautenticacion_fallida');
  const ok = await pedir({ idConfirmacion: SENSIBLE, decision: 'confirmar', huella: HUELLA, password: 'Test-pass-123' }); assert.equal(ok.status, 200, ok.t);
  const env = recibidas.at(-1).cuerpo; assert.ok(env.administrador.reautenticadoEn); assert.equal(env.huella, HUELLA); assert.ok(!JSON.stringify(env).includes('Test-pass-123'), 'la contraseña nunca viaja al Director');
  // la reautenticación reciente se reutiliza en la MISMA sesión, no en otra
  await pedir({ idConfirmacion: nuevoId(), decision: 'confirmar', huella: HUELLA }); assert.ok(recibidas.at(-1).cuerpo.administrador.reautenticadoEn, 'misma sesión: vale unos minutos');
  const { createAdminSession } = await import('../../src/lib/adminAuth.ts'); const { findUserById } = await import('../../src/lib/userStore.ts'); const { getSessionUser } = await import('../../src/lib/adminAuth.ts');
  const yo = getSessionUser(new Request('http://localhost', { headers: { Cookie: cookie } })); await new Promise((ok) => setTimeout(ok, 5));
  const otraSesion = createAdminSession(findUserById(yo.id)).split(';')[0];
  await pedir({ idConfirmacion: nuevoId(), decision: 'confirmar', huella: HUELLA }, { ck: otraSesion }); assert.equal(recibidas.at(-1).cuerpo.administrador.reautenticadoEn, undefined, 'otra sesión no hereda la reautenticación');
});

test('límite de decisiones por cuenta', async () => {
  let ultimo; for (let i = 0; i < 31; i += 1) ultimo = await pedir({ idConfirmacion: nuevoId(), decision: 'rechazar' });
  assert.equal(ultimo.status, 429); assert.equal(ultimo.j.code, 'demasiadas_decisiones');
});

test('PANEL: describe agente, tarea, datos, consecuencias; hora de Madrid con su etiqueta y cuenta atrás aparte; contraseña solo para las sensibles', () => {
  const src = fs.readFileSync(new URL('../../src/pages/upayp1b4/director-ia.astro', import.meta.url), 'utf8');
  for (const s of ["timeZone: ZONA", "const ZONA = 'Europe/Madrid'", '(hora de Madrid)', 'quedan ${m} min', 'Agente ${p.agente}', 'c.consecuencias', 'Datos: ${p.datos}', 'Se aprueba con tu sesión, sin contraseña.', 'Aprobarla pide tu contraseña.', 'Resueltas recientemente', "c.huella ? { huella: c.huella }", "jr.code === 'reautenticacion_requerida'", 'clave.hidden = !necesitaClave'])
    assert.ok(src.includes(s), s);
  assert.doesNotMatch(src, /Se te pedirá la contraseña/, 'ya no se pide en todas');
  assert.match(src, /toLocaleTimeString\('es-ES', \{ timeZone: 'Europe\/Madrid'/, 'las horas del chat también en Madrid');
  assert.doesNotMatch(src, /toLocale(Time)?String\('es-ES'(\)|, \{ (?!timeZone))/, 'ninguna hora con la zona del navegador');
});
