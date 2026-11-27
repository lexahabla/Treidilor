/**
 * TREIDILOR — ADJUNTOS DE LOS CHATS DEL DIRECTOR IA (archivos REALES generados en la prueba: PDF, XLSX, DOCX, PNG, CSV).
 *  · Subida solo del propietario, a SUS chats, con CSRF; tipo por contenido (un PNG disfrazado de PDF, un ejecutable o un DOCX con macros se rechazan); 10 MB máx.
 *  · Extracción LOCAL del texto; descarga protegida (imágenes en línea con nosniff y sandbox; documentos como descarga); borrar; purga con el chat.
 *  · Al enviar, el Director recibe el texto extraído y las instrucciones del proyecto del chat; un adjunto de otro chat → 403.
 *  · Con un Director 1.3.3 (sin adjuntos) el mensaje se envía igualmente, avisando.
 *  · Integración con el Director 1.3.4 REAL (TAI_DIRECTOR_FUENTE): «total de la columna Precio» de un Excel adjuntado se responde en local.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';
import { pdfTexto, xlsx, docx, PNG } from './_fixtures-adjuntos.mjs';
import { FUENTE_DIRECTOR, OMITIR_SIN_DIRECTOR, importarDelDirector } from './_director-fuente.mjs';

let modo = 'actual'; const recibidos = []; let n = 0;
const srv = http.createServer(async (req, res) => {
  const t = []; for await (const x of req) t.push(x); const cuerpo = JSON.parse(Buffer.concat(t).toString() || '{}'); const ruta = req.url.split('?')[0]; recibidos.push({ ruta, cuerpo });
  const r = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (ruta === '/tai/v1/chat/conversacion') return r(200, { conversacion: cuerpo.principal ? 'cv_aaaaaaaaaaaaaaaa' : `cv_${String(++n).padStart(16, '0')}`, principal: Boolean(cuerpo.principal) });
  if (ruta === '/tai/v1/chat/mensaje') { if (modo === 'antiguo' && (cuerpo.adjuntos || cuerpo.proyecto || cuerpo.privado)) return r(400, { error: { codigo: 'solicitud_invalida', mensaje: 'Campos no permitidos: adjuntos.' } }); return r(200, { conversacion: cuerpo.conversacion, idInstruccion: 'i', en: new Date().toISOString(), via: 'panel', textoOriginal: cuerpo.texto, respuesta: { estado: 'respondida', tipo: 'documentos', mensaje: 'ok' } }); }
  return r(404, { error: { codigo: 'no_encontrado', mensaje: 'x' } });
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const dir = setupIsolatedData('tai-adjuntos-');
Object.assign(process.env, { TAI_PUENTE_HOST: '127.0.0.1', TAI_PUENTE_PORT: String(srv.address().port), TAI_PUENTE_TOKEN: 'tai_chat_' + 'c'.repeat(24), TAI_PUENTE_TIMEOUT: '5000' });
const cookie = await adminCookie();
const adj = await import('../../src/pages/api/admin/director-ia/adjuntos.ts'); const chats = await import('../../src/pages/api/admin/director-ia/chats.ts'); const principal = await import('../../src/pages/api/admin/director-ia/principal.ts');
test.after(() => srv.close());
const H = (extra = {}) => ({ Cookie: cookie, 'X-Director-IA': '1', ...extra });
const subir = async (chat, nombre, bytes, { csrf = true } = {}) => { const r = await adj.POST({ request: new Request(`http://localhost/api/admin/director-ia/adjuntos?conversacionId=${chat}`, { method: 'POST', headers: { ...(csrf ? H() : { Cookie: cookie }), 'Content-Type': 'application/octet-stream', 'X-Nombre-Archivo': encodeURIComponent(nombre) }, body: bytes }) }); return { status: r.status, j: await r.json() }; };
const accion = async (cuerpo) => (await chats.POST({ request: new Request('http://localhost/api/admin/director-ia/chats', { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }) })).json();
const enviar = async (chat, cuerpo) => { const r = await principal.POST({ request: new Request(`http://localhost/api/admin/director-ia/principal?conversacionId=${chat}`, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }) }); return { status: r.status, j: await r.json() }; };

test('subida: tipos reales con su texto extraído en local; disfraces, macros, tamaño, chat ajeno y sin CSRF se rechazan', async () => {
  const chat = (await accion({ accion: 'crear' })).chat.id;
  const pdf = await subir(chat, 'contrato.pdf', pdfTexto(['Comision del 4%', 'Pago a 30 dias'])); assert.equal(pdf.status, 201, JSON.stringify(pdf.j)); assert.equal(pdf.j.adjunto.tipo, 'pdf'); assert.equal(pdf.j.adjunto.texto.paginas, 2); assert.equal(pdf.j.adjunto.texto.estado, 'ok');
  const x = await subir(chat, 'ventas.xlsx', await xlsx({ Enero: [['Producto', 'Precio'], ['A', 10], ['B', 5.5]] })); assert.equal(x.j.adjunto.tipo, 'xlsx'); assert.deepEqual(x.j.adjunto.texto.hojas, ['Enero']);
  const d = await subir(chat, 'notas.docx', await docx(['Hola'])); assert.equal(d.j.adjunto.tipo, 'docx');
  const im = await subir(chat, 'captura.png', PNG); assert.equal(im.j.adjunto.tipo, 'png'); assert.equal(im.j.adjunto.texto.estado, 'no_disponible');
  assert.equal((await subir(chat, 'datos.csv', Buffer.from('a;b\n1;2\n'))).j.adjunto.tipo, 'csv');
  assert.equal((await subir(chat, 'falso.pdf', PNG)).status, 415, 'contenido que no coincide con la extensión');
  assert.equal((await subir(chat, 'virus.exe', Buffer.from('MZ\x90\x00binario'))).status, 415);
  assert.equal((await subir(chat, 'macro.docx', await docx(['x'], { conMacros: true }))).status, 400);
  assert.equal((await subir(chat, 'enorme.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61))).status, 413);
  assert.equal((await subir('cv_1234567890abcdef', 'a.txt', Buffer.from('hola'))).status, 403, 'chat ajeno');
  assert.equal((await subir(chat, 'a.txt', Buffer.from('hola'), { csrf: false })).status, 403);
  assert.ok(!JSON.stringify(pdf.j).includes(dir), 'nunca se devuelven rutas internas'); assert.equal(pdf.j.adjunto.userId, undefined);
  const enDisco = fs.readdirSync(path.join(dir, 'director-ia-adjuntos')); assert.ok(enDisco.every((f) => /^ad_[0-9a-f]{16}\.(bin|json|txt)$/.test(f)), 'el nombre original nunca forma una ruta');
});

test('descarga protegida y borrado: imagen en línea con nosniff y sandbox; documento como descarga; id ajeno o inventado → 404', async () => {
  const chat = (await accion({ accion: 'crear' })).chat.id; const im = (await subir(chat, 'c.png', PNG)).j.adjunto; const pdf = (await subir(chat, 'c.pdf', pdfTexto(['x']))).j.adjunto;
  const g = await adj.GET({ request: new Request(`http://localhost/api/admin/director-ia/adjuntos?id=${im.id}`, { headers: { Cookie: cookie } }) });
  assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/png'); assert.equal(g.headers.get('x-content-type-options'), 'nosniff'); assert.match(g.headers.get('content-security-policy'), /sandbox/); assert.match(g.headers.get('content-disposition'), /^inline/);
  assert.deepEqual(Buffer.from(await g.arrayBuffer()), PNG);
  const gp = await adj.GET({ request: new Request(`http://localhost/api/admin/director-ia/adjuntos?id=${pdf.id}`, { headers: { Cookie: cookie } }) }); assert.match(gp.headers.get('content-disposition'), /^attachment/);
  assert.equal((await adj.GET({ request: new Request('http://localhost/api/admin/director-ia/adjuntos?id=ad_0000000000000000', { headers: { Cookie: cookie } }) })).status, 404);
  assert.equal((await adj.GET({ request: new Request(`http://localhost/api/admin/director-ia/adjuntos?id=${im.id}`) })).status, 401, 'sin sesión');
  const del = await adj.DELETE({ request: new Request(`http://localhost/api/admin/director-ia/adjuntos?id=${im.id}`, { method: 'DELETE', headers: H() }) }); assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(dir, 'director-ia-adjuntos', `${im.id}.bin`)), 'sus archivos se borran');
});

test('enviar: el Director recibe el texto extraído y las instrucciones del proyecto; adjunto de otro chat → 403; Director 1.3.3 → se envía el texto y se avisa', async () => {
  const pr = await accion({ accion: 'crearProyecto', nombre: 'Precios', instrucciones: 'Responde con tablas.' });
  const chat = (await accion({ accion: 'crear', proyectoId: pr.proyecto.id })).chat.id; const otro = (await accion({ accion: 'crear' })).chat.id;
  const a = (await subir(chat, 'ventas.xlsx', await xlsx({ Enero: [['Producto', 'Precio'], ['A', 10]] }))).j.adjunto; const ajeno = (await subir(otro, 'n.txt', Buffer.from('hola'))).j.adjunto;
  const r = await enviar(chat, { texto: '', adjuntos: [a.id] }); assert.equal(r.status, 200, JSON.stringify(r.j));
  const m = recibidos.filter((x) => x.ruta === '/tai/v1/chat/mensaje').at(-1).cuerpo;
  assert.equal(m.texto, 'Te adjunto estos documentos.'); assert.equal(m.adjuntos[0].id, a.id); assert.match(m.adjuntos[0].texto, /## Hoja: Enero\nProducto,Precio\nA,10/); assert.deepEqual(m.proyecto, { nombre: 'Precios', instrucciones: 'Responde con tablas.' });
  assert.ok(!JSON.stringify(m).includes(dir), 'sin rutas internas hacia el Director');
  assert.equal((await enviar(chat, { texto: 'mira', adjuntos: [ajeno.id] })).status, 403, 'un adjunto de otro chat no se puede usar');
  modo = 'antiguo'; const viejo = await enviar(chat, { texto: 'otro', adjuntos: [a.id] }); modo = 'actual';
  assert.equal(viejo.status, 200); assert.match(viejo.j.respuesta.avisos.join(' '), /1\.3\.4/); assert.equal(recibidos.filter((x) => x.ruta === '/tai/v1/chat/mensaje').at(-1).cuerpo.adjuntos, undefined);
});

test('retención: al purgarse un chat de la papelera (30 días) se borran sus adjuntos', async () => {
  const chat = (await accion({ accion: 'crear' })).chat.id; const a = (await subir(chat, 'x.txt', Buffer.from('dato'))).j.adjunto;
  await accion({ accion: 'eliminar', id: chat }); const f = path.join(dir, 'director-ia-chats.json'); const d = JSON.parse(fs.readFileSync(f, 'utf8')); d.chats.find((c) => c.id === chat).eliminadaEn = new Date(Date.now() - 31 * 86_400_000).toISOString(); fs.writeFileSync(f, JSON.stringify(d));
  await chats.GET({ request: new Request('http://localhost/api/admin/director-ia/chats', { headers: { Cookie: cookie } }) });
  assert.ok(!fs.existsSync(path.join(dir, 'director-ia-adjuntos', `${a.id}.bin`)));
});

test('INTEGRACIÓN con el Director 1.3.4 REAL: el Excel adjuntado se responde en local («total de la columna Precio») sin el analista', { skip: OMITIR_SIN_DIRECTOR }, async () => {
  const { ChatDirector } = await importarDelDirector('automation/autonomia/chat.mjs');
  const { Instrucciones } = await importarDelDirector('automation/autonomia/instrucciones.mjs'); const { Autonomia } = await importarDelDirector('automation/autonomia/orquestador.mjs'); const { AlmacenAutonomia } = await importarDelDirector('automation/autonomia/almacen.mjs'); const { registroExtendido } = await importarDelDirector('automation/autonomia/analisis-comercial/capacidades.mjs');
  const { validarAdjuntos } = await importarDelDirector('automation/autonomia/documentos-conversacion.mjs').catch(() => ({}));
  if (!validarAdjuntos) return; // fuente anterior a 1.3.4
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-adj-int-')); const registro = registroExtendido(); const a = new Autonomia({ almacen: new AlmacenAutonomia({ dir: path.join(base, 'l') }), registro });
  const llamadas = []; const chat = new ChatDirector({ instrucciones: new Instrucciones({ autonomia: a, registro }), autonomia: a, registro, dir: path.join(base, 'c'), analista: { async responder(x) { llamadas.push(x); return { estado: 'respondida', mensaje: 'analista' }; } } });
  const cv = chat.crearConversacion().conversacion;
  const { paraDirector, guardarAdjunto } = await import('../../src/lib/directorIaAdjuntos.ts');
  const meta = await guardarAdjunto('u-int', cv, 'precios.xlsx', await xlsx({ Hoja1: [['Producto', 'Precio'], ['A', 10], ['B', 5.5], ['C', '1.234,50']] }));
  await chat.enviar({ conversacion: cv, id: 'msg-int-0001', texto: 'Te adjunto el Excel', adjuntos: [paraDirector(meta)] });
  const r = await chat.enviar({ conversacion: cv, id: 'msg-int-0002', texto: '¿Cuál es el total de la columna Precio?' });
  assert.match(r.respuesta.mensaje, /total = \*\*1\.?250\*\* \(3 valores\)/); assert.equal(llamadas.length, 0, 'nada al analista externo');
  fs.rmSync(base, { recursive: true, force: true });
});

test('CHAT CONFIDENCIAL: desactivado por defecto; activado, el Director recibe privado:true, la voz se bloquea en el servidor y con un Director 1.3.3 el mensaje NO se envía', async () => {
  const chat = (await accion({ accion: 'crear' })).chat; assert.equal(chat.confidencial, undefined, 'desactivado por defecto');
  const principalId = (await (await chats.GET({ request: new Request('http://localhost/api/admin/director-ia/chats', { headers: { Cookie: cookie } }) })).json()).chats.find((c) => c.principal).id;
  const r0 = await chats.POST({ request: new Request('http://localhost/api/admin/director-ia/chats', { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'confidencial', id: principalId, valor: true }) }) }); assert.equal(r0.status, 409, 'la principal (Telegram) no puede ser confidencial');
  assert.equal((await accion({ accion: 'confidencial', id: chat.id, valor: true })).chats.find((c) => c.id === chat.id).confidencial, true);
  await enviar(chat.id, { texto: 'dato confidencial' }); assert.equal(recibidos.filter((x) => x.ruta === '/tai/v1/chat/mensaje').at(-1).cuerpo.privado, true);
  const voz = await principal.POST({ request: new Request(`http://localhost/api/admin/director-ia/principal?conversacionId=${chat.id}`, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: 'AAAA', mime: 'audio/webm', segundos: 2 }) }) });
  assert.equal(voz.status, 403); assert.equal((await voz.json()).code, 'voz_no_permitida'); assert.ok(!recibidos.some((x) => x.ruta === '/tai/v1/chat/voz'), 'el audio no sale');
  modo = 'antiguo'; const antes = recibidos.length; const viejo = await enviar(chat.id, { texto: 'otro dato' }); modo = 'actual';
  assert.equal(viejo.status, 409); assert.equal(viejo.j.code, 'confidencial_no_disponible'); assert.equal(recibidos.slice(antes).filter((x) => x.ruta === '/tai/v1/chat/mensaje').length, 1, 'solo el intento rechazado: no se reenvía sin protección');
  assert.equal((await accion({ accion: 'confidencial', id: chat.id, valor: false })).chats.find((c) => c.id === chat.id).confidencial, false);
});
