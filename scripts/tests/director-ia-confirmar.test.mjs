/**
 * TREIDILOR — CONFIRMACIONES DEL DIRECTOR DESDE EL PANEL (opción A).
 * Endpoint real `/api/admin/director-ia/confirmar` contra un puente de prueba que registra lo que recibe:
 *  · solo el master, desde el propio sitio, REAUTENTICÁNDOSE con su contraseña (incorrecta → no llega al Director);
 *  · el servidor usa el token de alcance `confirmar` (nunca el de chat) y envía quién confirma con su reautenticación;
 *  · ningún token aparece en la respuesta; una confirmación ya resuelta se rechaza (lo decide el Director); límite de intentos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';

const TOKEN_CHAT = 'tai_chat_' + 'a'.repeat(24); const TOKEN_CONF = 'tai_confirmar_' + 'b'.repeat(24);
const ID = 'cf_01M8CJ6KGSB01JRG5RCWR8539Y'; const recibidas = []; const resueltas = new Set();
const srv = http.createServer(async (req, res) => {
  const trozos = []; for await (const t of req) trozos.push(t); const cuerpo = JSON.parse(Buffer.concat(trozos).toString() || '{}');
  recibidas.push({ ruta: req.url, auth: req.headers.authorization, cuerpo });
  const r = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.url !== '/tai/v1/chat/confirmar') return r(404, { error: { codigo: 'no_encontrado', mensaje: 'x' } });
  if (req.headers.authorization !== `Bearer ${TOKEN_CONF}`) return r(403, { error: { codigo: 'permiso_denegado', mensaje: 'alcance' } });
  if (resueltas.has(cuerpo.idConfirmacion)) return r(409, { error: { codigo: 'confirmacion_resuelta', mensaje: 'Esa confirmación ya está «confirmada».' } });
  resueltas.add(cuerpo.idConfirmacion); return r(200, { esquema: 'tai-chat/1', resultado: { reanudadas: ['01', '02', '07'], omitidas: [] } });
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
setupIsolatedData('tai-confirmar-');
Object.assign(process.env, { TAI_PUENTE_HOST: '127.0.0.1', TAI_PUENTE_PORT: String(srv.address().port), TAI_PUENTE_TOKEN: TOKEN_CHAT, TAI_PUENTE_TOKEN_CONFIRMAR: TOKEN_CONF, TAI_PUENTE_TIMEOUT: '5000' });
const cookie = await adminCookie();
const ep = await import('../../src/pages/api/admin/director-ia/confirmar.ts');
const pedir = async (cuerpo, { ck = cookie, csrf = true } = {}) => { const r = await ep.POST({ request: new Request('http://localhost/api/admin/director-ia/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck, ...(csrf ? { 'X-Director-IA': '1' } : {}) }, body: JSON.stringify(cuerpo) }) }); const t = await r.text(); return { status: r.status, t, j: JSON.parse(t) }; };
test.after(() => srv.close());

test('sin CSRF, sin contraseña o con contraseña incorrecta NO llega al Director', async () => {
  assert.equal((await pedir({ idConfirmacion: ID, decision: 'confirmar', password: 'Test-pass-123' }, { csrf: false })).status, 403);
  assert.equal((await pedir({ idConfirmacion: ID, decision: 'confirmar' })).j.code, 'reautenticacion_requerida');
  const mal = await pedir({ idConfirmacion: ID, decision: 'confirmar', password: 'incorrecta' }); assert.equal(mal.status, 403); assert.equal(mal.j.code, 'reautenticacion_fallida');
  assert.equal(recibidas.length, 0, 'ninguna petición al Director');
});

test('un administrador que NO es el master no puede confirmar', async () => {
  const { createUser, findUserById } = await import('../../src/lib/userStore.ts'); const { createAdminSession, getSessionUser } = await import('../../src/lib/adminAuth.ts');
  const master = getSessionUser(new Request('http://localhost', { headers: { Cookie: cookie } }));
  const otro = createUser({ username: 'otroadmin', password: 'Otro-pass-12345', name: 'Otro', role: 'admin' }, master);
  const ck = createAdminSession(findUserById(otro.id)).split(';')[0];
  const r = await pedir({ idConfirmacion: ID, decision: 'confirmar', password: 'Otro-pass-12345' }, { ck }); assert.equal(r.status, 403); assert.equal(r.j.code, 'no_autorizado');
  assert.equal(recibidas.length, 0);
});

test('éxito: token de alcance confirmar, quién confirma y reautenticación reciente; ningún token en la respuesta; repetir → rechazada', async () => {
  const r = await pedir({ idConfirmacion: ID, decision: 'confirmar', password: 'Test-pass-123' });
  assert.equal(r.status, 200, r.t); assert.deepEqual(r.j.resultado.reanudadas, ['01', '02', '07']);
  const env = recibidas.at(-1); assert.equal(env.auth, `Bearer ${TOKEN_CONF}`, 'usa el token de confirmar, no el de chat');
  assert.equal(env.cuerpo.decision, 'confirmar'); assert.equal(env.cuerpo.administrador.usuario, 'tester'); assert.ok(Date.now() - Date.parse(env.cuerpo.administrador.reautenticadoEn) < 60_000);
  assert.ok(!r.t.includes(TOKEN_CONF) && !r.t.includes(TOKEN_CHAT), 'ningún token en la respuesta');
  const otra = await pedir({ idConfirmacion: ID, decision: 'confirmar', password: 'Test-pass-123' }); assert.equal(otra.status, 409); assert.equal(otra.j.code, 'confirmacion_resuelta');
});

test('límite de intentos de reautenticación', async () => {
  let ultimo; for (let i = 0; i < 6; i += 1) ultimo = await pedir({ idConfirmacion: ID, decision: 'rechazar', password: 'mal' + i });
  assert.equal(ultimo.status, 429);
});
