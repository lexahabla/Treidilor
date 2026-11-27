/**
 * TREIDILOR — CHATS Y PROYECTOS DEL PANEL DIRECTOR IA.
 * API real `/api/admin/director-ia/chats` + `principal` contra un puente de prueba que crea conversaciones como el Director:
 *  · solo el master y con CSRF; la principal (Telegram) se registra sola, fijada, y no se puede archivar ni eliminar;
 *  · cada chat nuevo es una conversación NUEVA del Director (contexto propio); renombrar, mover a proyecto, archivar, papelera y restaurar;
 *  · `principal?conversacionId=` solo acepta chats registrados (o la principal real): nunca un id arbitrario;
 *  · el primer mensaje titula el chat; todo persiste en disco (se relee el archivo); la papelera se purga a los 30 días.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';

const PRINCIPAL = 'cv_aaaaaaaaaaaaaaaa'; let n = 0; const recibidos = [];
const srv = http.createServer(async (req, res) => {
  const t = []; for await (const x of req) t.push(x); const cuerpo = JSON.parse(Buffer.concat(t).toString() || '{}'); const ruta = req.url.split('?')[0]; recibidos.push({ ruta, cuerpo });
  const r = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (ruta === '/tai/v1/chat/conversacion') return cuerpo.principal ? r(200, { conversacion: PRINCIPAL, principal: true }) : r(200, { conversacion: `cv_${String(++n).padStart(16, '0')}` });
  if (ruta === '/tai/v1/chat/historial') { const c = new URL(req.url, 'http://x').searchParams.get('conversacion'); return c === 'cv_ffffffffffffffff' ? r(404, { error: { codigo: 'conversacion_desconocida', mensaje: 'x' } }) : r(200, { conversacion: c, turnos: [] }); }
  if (ruta === '/tai/v1/chat/mensaje') return r(200, { conversacion: cuerpo.conversacion, idInstruccion: 'i1', en: new Date().toISOString(), via: 'panel', textoOriginal: cuerpo.texto, respuesta: { estado: 'respondida', mensaje: 'ok' } });
  return r(404, { error: { codigo: 'no_encontrado', mensaje: 'x' } });
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const dir = setupIsolatedData('tai-chats-');
Object.assign(process.env, { TAI_PUENTE_HOST: '127.0.0.1', TAI_PUENTE_PORT: String(srv.address().port), TAI_PUENTE_TOKEN: 'tai_chat_' + 'c'.repeat(24), TAI_PUENTE_TIMEOUT: '5000' });
const cookie = await adminCookie();
const chats = await import('../../src/pages/api/admin/director-ia/chats.ts'); const principal = await import('../../src/pages/api/admin/director-ia/principal.ts');
test.after(() => srv.close());
const req = (url, metodo, cuerpo, { csrf = true } = {}) => new Request('http://localhost' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(csrf ? { 'X-Director-IA': '1' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
const llamar = async (ep, url, metodo, cuerpo, o) => { const r = await ep[metodo]({ request: req(url, metodo, cuerpo, o) }); const t = await r.text(); return { status: r.status, j: JSON.parse(t) }; };
const accion = (cuerpo, o) => llamar(chats, '/api/admin/director-ia/chats', 'POST', cuerpo, o);

test('la principal (Telegram) se registra sola, fijada, y no se puede archivar ni eliminar; sin CSRF no se modifica nada', async () => {
  const l = await llamar(chats, '/api/admin/director-ia/chats', 'GET'); assert.equal(l.status, 200);
  const p = l.j.chats.find((c) => c.principal); assert.equal(p.id, PRINCIPAL); assert.equal(l.j.chats.length, 1); assert.equal(p.userId, undefined, 'no se expone el userId');
  for (const a of ['archivar', 'eliminar']) { const r = await accion({ accion: a, id: PRINCIPAL }); assert.equal(r.status, 409); assert.equal(r.j.code, 'principal_protegida'); }
  assert.equal((await accion({ accion: 'crear' }, { csrf: false })).status, 403);
});

test('chat nuevo = conversación NUEVA del Director; renombrar, proyecto, archivar, papelera y restaurar; persiste en disco', async () => {
  const c = await accion({ accion: 'crear' }); assert.equal(c.status, 201); const id = c.j.chat.id; assert.match(id, /^cv_\d{16}$/);
  assert.ok(recibidos.some((x) => x.ruta === '/tai/v1/chat/conversacion' && !x.cuerpo.principal), 'el Director crea la conversación');
  assert.equal((await accion({ accion: 'renombrar', id, titulo: '  Plan\u0000 de\nprecios  ' })).j.chats.find((x) => x.id === id).titulo, 'Plan de precios', 'título limpio');
  const pr = await accion({ accion: 'crearProyecto', nombre: 'Lanzamiento', instrucciones: 'Responde en tablas.' }); assert.equal(pr.status, 201); const prId = pr.j.proyecto.id;
  assert.equal((await accion({ accion: 'mover', id, proyectoId: prId })).j.chats.find((x) => x.id === id).proyectoId, prId);
  assert.equal((await accion({ accion: 'mover', id, proyectoId: 'pr_000000000000' })).status, 404);
  assert.equal((await accion({ accion: 'archivar', id })).j.chats.find((x) => x.id === id).archivada, true);
  assert.equal((await accion({ accion: 'desarchivar', id })).j.chats.find((x) => x.id === id).archivada, false);
  assert.ok((await accion({ accion: 'eliminar', id })).j.chats.find((x) => x.id === id).eliminadaEn, 'en la papelera');
  assert.equal((await accion({ accion: 'restaurar', id })).j.chats.find((x) => x.id === id).eliminadaEn, null);
  const enDisco = JSON.parse(fs.readFileSync(path.join(dir, 'director-ia-chats.json'), 'utf8')); assert.equal(enDisco.chats.find((x) => x.id === id).titulo, 'Plan de precios'); assert.equal(enDisco.proyectos[0].instrucciones, 'Responde en tablas.');
  assert.equal((await accion({ accion: 'eliminarProyecto', id: prId })).j.chats.find((x) => x.id === id).proyectoId, null, 'el chat queda sin proyecto, no se borra');
});

test('principal?conversacionId= solo acepta chats registrados o la principal real; el primer mensaje titula el chat', async () => {
  const ajeno = await llamar(principal, '/api/admin/director-ia/principal?conversacionId=cv_1234567890abcdef', 'GET'); assert.equal(ajeno.status, 403); assert.equal(ajeno.j.code, 'conversacion_no_autorizada');
  const c = (await accion({ accion: 'crear' })).j.chat.id;
  const env = await llamar(principal, `/api/admin/director-ia/principal?conversacionId=${c}`, 'POST', { texto: 'Analiza los precios de los auriculares' }); assert.equal(env.status, 200, JSON.stringify(env.j));
  assert.equal(recibidos.filter((x) => x.ruta === '/tai/v1/chat/mensaje').at(-1).cuerpo.conversacion, c, 'el mensaje va a SU conversación del Director');
  assert.equal((await llamar(chats, '/api/admin/director-ia/chats', 'GET')).j.chats.find((x) => x.id === c).titulo, 'Analiza los precios de los auriculares');
  assert.equal((await llamar(principal, `/api/admin/director-ia/principal?conversacionId=${PRINCIPAL}`, 'GET')).status, 200, 'la principal real siempre vale');
  await accion({ accion: 'eliminar', id: c }); assert.equal((await llamar(principal, `/api/admin/director-ia/principal?conversacionId=${c}`, 'GET')).status, 403, 'un chat en la papelera no se usa');
});

test('vincular una conversación existente del Director (y rechazar una que el Director no conoce); papelera purgada a los 30 días', async () => {
  assert.equal((await accion({ accion: 'vincular', id: 'cv_ffffffffffffffff' })).status, 404);
  assert.equal((await accion({ accion: 'vincular', id: 'cv_0123456789abcdef' })).j.chats.some((x) => x.id === 'cv_0123456789abcdef'), true);
  const f = path.join(dir, 'director-ia-chats.json'); const d = JSON.parse(fs.readFileSync(f, 'utf8')); d.chats.find((x) => x.id === 'cv_0123456789abcdef').eliminadaEn = new Date(Date.now() - 31 * 86_400_000).toISOString(); fs.writeFileSync(f, JSON.stringify(d));
  assert.equal((await llamar(chats, '/api/admin/director-ia/chats', 'GET')).j.chats.some((x) => x.id === 'cv_0123456789abcdef'), false, 'purgado del panel');
  assert.equal((await accion({ accion: 'vincular', id: '../../etc' })).status, 400);
});
