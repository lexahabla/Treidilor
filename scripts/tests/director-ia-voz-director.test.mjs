/**
 * TREIDILOR — VOZ DEL DIRECTOR EN EL PANEL (1.3.3): conversación hablada continua con la MISMA voz que Telegram.
 *
 * 1) Endpoint real `POST /api/admin/director-ia/principal` con `{ audio, mime, segundos }` contra un puente de prueba:
 *    solo el master y con CSRF; valida formato y duración ANTES de tocar el Director; usa el token de chat (nunca el de confirmar);
 *    devuelve la transcripción, la respuesta registrada y el audio de la voz del Director, o `vozLocal` si hay datos reales.
 * 2) Comportamiento REAL del script del panel en `vm` con micrófono, nivel de audio, grabador y reproductor simulados:
 *    detección de inicio y final de la intervención, varios turnos seguidos con una sola pulsación, interrupción hablando encima,
 *    respuesta de datos reales leída por la voz local, ruido corto descartado y paso a la voz del navegador si el Director no tiene voz.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';

// ───────────────────────────── 1) endpoint ─────────────────────────────
const TOKEN_CHAT = 'tai_chat_' + 'c'.repeat(24); const TOKEN_CONF = 'tai_confirmar_' + 'd'.repeat(24);
const recibidas = []; let modo = 'ok';
const srv = http.createServer(async (req, res) => {
  const trozos = []; for await (const t of req) trozos.push(t); const cuerpo = JSON.parse(Buffer.concat(trozos).toString() || '{}');
  recibidas.push({ ruta: req.url.split('?')[0], auth: req.headers.authorization, cuerpo });
  const r = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.url === '/tai/v1/chat/conversacion') return r(200, { esquema: 'tai-chat/1', conversacion: 'cv_0123456789abcdef', principal: true });
  if (req.url === '/tai/v1/chat/voz/muestra' && modo !== 'antigua') return r(200, { esquema: 'tai-chat/1', voz: cuerpo.voz, audio: { base64: Buffer.from('RIFF....WAVE').toString('base64'), mime: 'audio/wav' } });
  if (req.url !== '/tai/v1/chat/voz') return r(404, { error: { codigo: 'no_encontrado', mensaje: 'x' } });
  if (modo === 'antigua') return r(404, { error: { codigo: 'no_encontrado', mensaje: 'Ruta no encontrada.' } });
  if (modo === 'sin_voz') return r(503, { error: { codigo: 'voz_no_disponible', mensaje: 'La voz del Director no está activa en el servicio.' } });
  const turno = { conversacion: cuerpo.conversacion, idInstruccion: 'ins_1', en: new Date().toISOString(), origen: 'voz', via: 'panel', textoOriginal: 'hola Director', respuesta: { estado: 'respondida', tipo: 'conversacion', mensaje: 'Hola, aquí estoy.', textoParaVoz: 'Hola, aquí estoy.' } };
  if (modo === 'real') return r(200, { esquema: 'tai-chat/1', estado: 'voz_local', turno, audio: null, vozLocal: 'Hay tres hallazgos nuevos.', requiereRepeticion: false });
  return r(200, { esquema: 'tai-chat/1', estado: 'ok', turno, audio: { base64: Buffer.from('OggS').toString('base64'), mime: 'audio/ogg' }, vozLocal: null, requiereRepeticion: false });
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
setupIsolatedData('tai-voz-director-');
Object.assign(process.env, { TAI_PUENTE_HOST: '127.0.0.1', TAI_PUENTE_PORT: String(srv.address().port), TAI_PUENTE_TOKEN: TOKEN_CHAT, TAI_PUENTE_TOKEN_CONFIRMAR: TOKEN_CONF, TAI_PUENTE_TIMEOUT: '5000' });
const cookie = await adminCookie();
const ep = await import('../../src/pages/api/admin/director-ia/principal.ts');
const pedir = async (cuerpo, { csrf = true } = {}) => { const r = await ep.POST({ request: new Request('http://localhost/api/admin/director-ia/principal', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(csrf ? { 'X-Director-IA': '1' } : {}) }, body: JSON.stringify(cuerpo) }) }); const t = await r.text(); return { status: r.status, t, j: JSON.parse(t) }; };
test.after(() => srv.close());
const AUDIO = Buffer.from('webm-de-prueba').toString('base64');

test('endpoint: sin CSRF, formato o duración inválidos NO llegan al Director', async () => {
  const antes = recibidas.length;
  assert.equal((await pedir({ audio: AUDIO, mime: 'audio/webm', segundos: 3 }, { csrf: false })).status, 403);
  assert.equal((await pedir({ audio: AUDIO, mime: 'video/mp4', segundos: 3 })).status, 400);
  assert.equal((await pedir({ audio: AUDIO, mime: 'audio/webm', segundos: 61 })).status, 400);
  assert.equal((await pedir({ audio: 'no base64!', mime: 'audio/webm', segundos: 3 })).status, 400);
  assert.equal((await pedir({ audio: 'A'.repeat(1_800_004), mime: 'audio/webm', segundos: 3 })).status, 400);
  assert.equal(recibidas.length, antes);
});

test('endpoint: turno hablado → voz del Director, con el token de chat; datos reales → vozLocal; sin voz → voz_no_disponible', async () => {
  modo = 'ok';
  const r = await pedir({ audio: AUDIO, mime: 'audio/webm;codecs=opus', segundos: 3.2 }); assert.equal(r.status, 200, r.t);
  const env = recibidas.filter((x) => x.ruta === '/tai/v1/chat/voz').at(-1); assert.equal(env.auth, `Bearer ${TOKEN_CHAT}`, 'el token de chat, nunca el de confirmar'); assert.equal(env.cuerpo.mime, 'audio/webm'); assert.equal(env.cuerpo.audio, AUDIO); assert.equal(env.cuerpo.conversacion, 'cv_0123456789abcdef');
  assert.equal(r.j.voz.transcripcion, 'hola Director'); assert.equal(r.j.respuesta.textoClaro, 'Hola, aquí estoy.'); assert.equal(r.j.voz.audio.mime, 'audio/ogg'); assert.equal(r.j.voz.vozLocal, null);
  assert.ok(!r.t.includes(TOKEN_CHAT) && !r.t.includes(TOKEN_CONF), 'ningún token en la respuesta');
  modo = 'real'; const real = await pedir({ audio: AUDIO, mime: 'audio/webm', segundos: 2 }); assert.equal(real.j.voz.audio, null); assert.equal(real.j.voz.vozLocal, 'Hay tres hallazgos nuevos.');
  modo = 'sin_voz'; const sin = await pedir({ audio: AUDIO, mime: 'audio/webm', segundos: 2 }); assert.equal(sin.j.success, false); assert.equal(sin.j.code, 'voz_no_disponible');
  modo = 'antigua'; const vieja = await pedir({ audio: AUDIO, mime: 'audio/webm', segundos: 2 }); assert.equal(vieja.j.code, 'voz_no_disponible', 'con un Director 1.3.2 (sin ruta de voz) el panel pasa a la voz del navegador'); modo = 'ok';
});

// ───────────────────────────── 2) comportamiento del panel ─────────────────────────────
const PAGINA = path.join(import.meta.dirname, '..', '..', 'src', 'pages', 'upayp1b4', 'director-ia.astro');
const fuente = fs.readFileSync(PAGINA, 'utf8'); const ini = fuente.indexOf('<script is:inline>'); const SCRIPT = fuente.slice(ini + '<script is:inline>'.length, fuente.indexOf('</script>', ini));
const espera = (ms = 0) => new Promise((r) => setTimeout(r, ms)); const tic = async () => { for (let i = 0; i < 8; i += 1) await espera(0); };

function elemento(id = '') {
  const oyentes = {};
  const el = { id, value: '', disabled: false, hidden: false, textContent: '', innerHTML: '', className: '', children: [], scrollTop: 0, scrollHeight: 0, style: {}, dataset: {}, atributos: {},
    addEventListener(tipo, fn) { (oyentes[tipo] ||= []).push(fn); }, dispatch(tipo, evento = {}) { for (const fn of oyentes[tipo] || []) fn({ preventDefault() {}, ...evento }); },
    click() { if (!el.disabled) el.dispatch('click'); }, appendChild(h) { el.children.push(h); return h; }, remove() {}, focus() {}, scrollIntoView() {}, scrollTo() {},
    setAttribute(k, v) { el.atributos[k] = String(v); }, removeAttribute(k) { delete el.atributos[k]; }, querySelector: () => elemento(), querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
  return el;
}

function montarPanel(alVoz, { conMicrofono = true, habladas = true } = {}) {
  const elementos = new Map();
  const document = { getElementById: (id) => { if (!elementos.has(id)) elementos.set(id, elemento(id)); return elementos.get(id); }, createElement: () => elemento(), querySelector: () => elemento(), addEventListener() {} };
  const sim = { t: 1_000_000, nivel: 0, intervalos: [], grabadores: [], audios: [], locuciones: [], reconocimientos: 0, pistasParadas: 0 };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [sim.t])); } static now() { return sim.t; } }
  class MediaRecorder { constructor(stream, o = {}) { this.mimeType = o.mimeType || 'audio/webm'; this.state = 'inactive'; sim.grabadores.push(this); } static isTypeSupported(t) { return t.startsWith('audio/webm'); }
    start() { this.state = 'recording'; } stop() { if (this.state === 'inactive') return; this.state = 'inactive'; this.ondataavailable?.({ data: { size: 10, type: this.mimeType } }); setTimeout(() => this.onstop?.(), 0); } }
  class AudioContext { createMediaStreamSource() { return { connect() {} }; } createAnalyser() { return { fftSize: 0, getFloatTimeDomainData(b) { b.fill(sim.nivel); } }; } close() {} }
  class Blob { constructor(partes, o) { this.type = o?.type; } async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } }
  class Audio { constructor(url) { this.url = url; this.pausado = false; sim.audios.push(this); } play() { return Promise.resolve(); } pause() { this.pausado = true; } }
  class SpeechSynthesisUtterance { constructor(t) { this.text = t; } }
  class SpeechRecognition { constructor() { sim.reconocimientos += 1; } start() {} stop() {} }
  const navigator = conMicrofono ? { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { sim.pistasParadas += 1; } }] }) } } : {};
  const peticiones = [];
  const jsonRes = (c, e = 200) => new Response(JSON.stringify(c), { status: e, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const fetch = async (url, init = {}) => {
    url = String(url); peticiones.push({ url, init });
    if (url.includes('/status')) return jsonRes({ success: true, conectado: true });
    if (url.includes('/principal') && (!init.method || init.method === 'GET')) return jsonRes({ success: true, conversacion: { id: 'cv_0123456789abcdef', mensajes: [], principal: true } });
    if (url.includes('/principal') && init.method === 'POST') return jsonRes(await alVoz(JSON.parse(init.body), peticiones.filter((p) => p.init.method === 'POST').length));
    return jsonRes({ success: false }, 404);
  };
  const almacen = new Map(); if (habladas !== null) almacen.set('directorIA.respuestasHabladas', habladas ? 'si' : 'no'); // null = sin preferencia guardada (por defecto, activadas)
  const ventana = { MediaRecorder, AudioContext, Blob, Audio, SpeechSynthesisUtterance, SpeechRecognition, navigator, fetch, document, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), Float32Array, Uint8Array,
    speechSynthesis: { speak(u) { sim.locuciones.push(u); }, cancel() {} },
    localStorage: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v), removeItem: (k) => almacen.delete(k) },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5)), clearTimeout, setInterval: (fn) => { sim.intervalos.push(fn); return sim.intervalos.length; }, clearInterval: (i) => { sim.intervalos[i - 1] = null; },
    console: { log() {}, info() {}, warn() {}, error() {} }, Date: FakeDate, JSON, Math, Promise, URL, encodeURIComponent, Error, Number, String, Array, Object, Boolean, RegExp, Intl, Response };
  ventana.window = ventana; vm.createContext(ventana); vm.runInContext(SCRIPT, ventana, { filename: 'director-ia.astro<script>' });
  const el = (id) => document.getElementById(id);
  /** Avanza el reloj `ms` con el nivel de micrófono dado, ejecutando el vigilante como lo haría el navegador cada 50 ms. */
  const pasar = async (ms, nivel) => { sim.nivel = nivel; for (let t = 0; t < ms; t += 50) { sim.t += 50; for (const f of sim.intervalos) f?.(); } await tic(); };
  const posts = () => peticiones.filter((p) => p.init.method === 'POST' && p.url.includes('/principal'));
  return { el, sim, pasar, posts };
}
const respuestaVoz = (n, extra = {}) => ({ success: true, conversacion: { id: 'cv_0123456789abcdef', principal: true }, voz: { estado: 'ok', transcripcion: `frase ${n}`, audio: { base64: 'T2dnUw==', mime: 'audio/ogg' }, vozLocal: null, ...extra }, respuesta: { estado: 'respondida', textoClaro: `Respuesta ${n}`, generadoEn: new Date().toISOString(), fuentes: [], tareas: [], solicitudesAutorizacion: [], limitaciones: [], avisos: [] } });

test('panel: varios turnos seguidos con una sola pulsación: detecta el final de cada intervención, responde con la voz del Director y vuelve a escuchar', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  assert.equal(p.el('textoBtnVoz').textContent, 'Finalizar sesión'); assert.equal(p.sim.reconocimientos, 0, 'no usa el reconocimiento del navegador');
  for (let n = 1; n <= 3; n += 1) {
    await p.pasar(1200, 0.2); // habla 1,2 s
    assert.equal(p.posts().length, n - 1, 'mientras habla no se envía nada');
    await p.pasar(1500, 0.0); // silencio (≥ 1,3 s) → fin de la intervención
    assert.equal(p.posts().length, n, `turno ${n} enviado al detectar el final`);
    const cuerpo = JSON.parse(p.posts().at(-1).init.body); assert.equal(cuerpo.mime, 'audio/webm;codecs=opus'); assert.ok(cuerpo.segundos >= 1 && cuerpo.segundos <= 3); assert.ok(cuerpo.audio);
    assert.equal(p.posts().at(-1).init.headers['X-Director-IA'], '1');
    assert.equal(p.sim.audios.length, n, 'suena la voz del Director'); assert.match(p.sim.audios.at(-1).url, /^data:audio\/ogg;base64,/);
    p.sim.audios.at(-1).onended(); await tic();
    assert.equal(p.el('textoEstadoVoz').textContent, 'Escuchando…', `tras el turno ${n} vuelve a escuchar`);
  }
  p.el('btnVoz').click(); await tic(); assert.equal(p.sim.pistasParadas, 1, 'finalizar libera el micrófono'); assert.equal(p.el('textoBtnVoz').textContent, 'Hablar');
});

test('panel: hablar encima del Director lo interrumpe y graba lo nuevo; el botón de interrumpir corta la voz sin cerrar la sesión', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(800, 0.2); await p.pasar(1500, 0); assert.equal(p.sim.audios.length, 1);
  await p.pasar(700, 0.3); // el propietario habla mientras suena la respuesta
  assert.equal(p.sim.audios[0].pausado, true, 'la voz del Director se corta'); assert.equal(p.el('textoEstadoVoz').textContent, 'Te escucho…');
  await p.pasar(1500, 0); assert.equal(p.posts().length, 2, 'lo dicho encima se envía como nuevo turno');
  p.el('btnDetenerVoz').click(); await tic(); assert.equal(p.sim.audios[1].pausado, true); assert.equal(p.el('textoEstadoVoz').textContent, 'Escuchando…'); assert.equal(p.el('textoBtnVoz').textContent, 'Finalizar sesión');
});

test('panel: datos reales → SIN voz sintética del navegador (respuesta escrita); ruido corto descartado; Director sin voz → reconocimiento del navegador', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n, { audio: null, vozLocal: 'Hay tres hallazgos nuevos.' }));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(200, 0.2); await p.pasar(1500, 0); assert.equal(p.posts().length, 0, 'un ruido de 0,2 s no es una intervención');
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.posts().length, 1);
  assert.equal(p.sim.audios.length, 0, 'nada de audio externo'); assert.equal(p.sim.locuciones.length, 0, 'no se sustituye por la voz robótica del navegador'); assert.match(p.el('textoEstadoVoz').textContent, /por escrito \(datos del negocio/);
  const q = montarPanel(async () => ({ success: false, code: 'voz_no_disponible', message: 'x' }));
  await tic(); q.el('btnVoz').click(); await tic(); await q.pasar(700, 0); /* calibración del micrófono */ await q.pasar(900, 0.2); await q.pasar(1500, 0);
  assert.equal(q.sim.reconocimientos, 1, 'continúa con el reconocimiento del navegador'); assert.match(q.el('alertaForm').textContent, /voz del navegador/);
});

test('panel: sin grabación en el navegador se usa la voz del navegador como antes', async () => {
  const p = montarPanel(async () => ({ success: true }), { conMicrofono: false });
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */ assert.equal(p.sim.reconocimientos, 1);
});

// ───────── reproducciones de los fallos observados por el propietario el 27/11 ─────────
const lento = (ms, valor) => new Promise((ok) => setTimeout(() => ok(valor), ms));

test('PAUSA NATURAL: una pausa de 0,9 s dentro de la frase NO parte la intervención (antes: dos turnos a 1–4 s)', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(800, 0.2); await p.pasar(900, 0); await p.pasar(800, 0.2); assert.equal(p.posts().length, 0, 'la pausa no cierra el turno');
  await p.pasar(1500, 0); assert.equal(p.posts().length, 1, 'un solo turno'); assert.ok(JSON.parse(p.posts()[0].init.body).segundos >= 2.4, 'incluye las dos partes');
});

test('RUIDO DE FONDO: con un ruido constante por encima del umbral fijo antiguo (0,03) el final de la intervención se detecta igual', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(4000, 0.03); await p.pasar(2000, 0.03); assert.equal(p.posts().length, 0, 'un ruido constante que aparece después no se envía como intervención'); assert.equal(p.el('textoEstadoVoz').textContent, 'Escuchando…');
  await p.pasar(1200, 0.3); await p.pasar(1500, 0.03); assert.equal(p.posts().length, 1, 'termina aunque el ruido siga');
});

test('SIN VOZ DEL DIRECTOR (cuota de síntesis agotada → respuesta_solo_texto): NO se usa la voz robótica; la respuesta queda escrita y se sigue escuchando', async () => {
  const p = montarPanel(async (c, n) => ({ ...respuestaVoz(n, { estado: 'respuesta_solo_texto', audio: null, vozLocal: null }) }));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.equal(p.sim.locuciones.length, 0, 'sin voz del navegador'); assert.match(p.el('textoEstadoVoz').textContent, /Te respondo por escrito \(voz del Director no disponible ahora\)\. Escuchando…/);
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.posts().length, 2, 'la conversación sigue: el siguiente turno se envía');
});

test('TRANSCRIPCIÓN FALLIDA (503 del proveedor): se reintenta una vez sola y el turno sigue; si vuelve a fallar se avisa en voz alta y se sigue escuchando', async () => {
  let k = 0; const p = montarPanel(async (c, n) => (++k === 1 ? { success: true, voz: { estado: 'error_transcripcion', mensaje: 'No he podido oírte bien' }, respuesta: null } : respuestaVoz(n)));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */ await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.equal(p.posts().length, 2, 'un reintento automático'); assert.equal(p.posts()[0].init.body, p.posts()[1].init.body, 'mismo audio'); assert.equal(p.sim.audios.length, 1, 'y responde');
  const q = montarPanel(async () => ({ success: true, voz: { estado: 'error_transcripcion', mensaje: 'No he podido oírte bien: repítelo o escribe.' }, respuesta: null }));
  await tic(); q.el('btnVoz').click(); await tic(); await q.pasar(700, 0); /* calibración del micrófono */ await q.pasar(900, 0.2); await q.pasar(1500, 0);
  assert.equal(q.posts().length, 2, 'solo un reintento'); assert.equal(q.sim.locuciones.length, 0, 'el aviso no se dice con voz sintética'); assert.match(q.el('textoEstadoVoz').textContent, /oírte bien.*Escuchando…/, 'se muestra y la sesión sigue');
});

test('SIN RESPUESTA DEL SERVIDOR: el turno caduca, se avisa (por escrito) y la conversación sigue sin reiniciar', async () => {
  let k = 0; const p = montarPanel(async (c, n) => (++k === 1 ? new Promise(() => {}) : respuestaVoz(n)));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */ await p.pasar(900, 0.2); await p.pasar(1500, 0);
  await p.pasar(20000, 0); assert.equal(p.sim.locuciones.length, 0, 'a los 20 s sigue esperando'); assert.match(p.el('textoEstadoVoz').textContent, /pensando/, 'indica que sigue procesando');
  await p.pasar(16000, 0); await tic();
  assert.match(p.el('alertaForm').textContent, /no respondió a tiempo/); assert.equal(p.sim.locuciones.length, 0, 'sin voz sintética'); assert.match(p.el('textoEstadoVoz').textContent, /No he podido procesarlo.*Escuchando…/);
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.sim.audios.length, 1, 'el siguiente turno funciona');
});

test('DOS PREGUNTAS SEGUIDAS: si hablas mientras procesa, la respuesta vieja no se lee encima y solo suena la última, en orden', async () => {
  let liberar1; const p = montarPanel(async (c, n) => (n === 1 ? new Promise((ok) => { liberar1 = () => ok(respuestaVoz(1)); }) : respuestaVoz(n)));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.posts().length, 1);
  await p.pasar(600, 0.2); assert.equal(p.el('textoEstadoVoz').textContent, 'Te escucho…');
  liberar1(); await tic(); assert.equal(p.sim.audios.length, 0, 'la respuesta 1 llega mientras hablas: no se lee encima de ti');
  await p.pasar(1500, 0); await tic(); assert.equal(p.posts().length, 2);
  assert.equal(p.sim.audios.length, 1, 'solo suena una respuesta (la de la última pregunta)'); assert.ok(p.el('contenedorMensajes').children.length >= 4, 'las dos respuestas quedan en el historial');
});

test('RUIDO MIENTRAS PROCESA: si lo que se oyó era solo ruido, la respuesta pendiente se dice igualmente', async () => {
  const p = montarPanel(async (c, n) => lento(40, respuestaVoz(n)));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(900, 0.2); await p.pasar(1500, 0); await p.pasar(200, 0.2); await espera(60); await tic();
  await p.pasar(1500, 0); assert.equal(p.sim.audios.length, 1, 'la respuesta se dice tras descartar el ruido');
});

test('ENVIAR YA: pulsar ■ mientras hablas envía la intervención sin esperar al silencio', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */ await p.pasar(900, 0.2);
  p.el('btnDetenerVoz').click(); await tic(); await tic(); assert.equal(p.posts().length, 1);
});

test('MODO RÁPIDO: elegido «Voz rápida», el botón usa el reconocimiento y la voz del navegador (sin pasar por la transcripción del Director) y se recuerda', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('modoVoz').value = 'rapida'; p.el('modoVoz').dispatch('change'); p.el('btnVoz').click(); await tic();
  assert.equal(p.sim.reconocimientos, 1, 'reconocimiento del navegador'); assert.equal(p.sim.grabadores.length, 0, 'no graba audio para el Director');
});

// ───────── respuestas habladas: ACTIVADAS por defecto desde la voz local sin cupo (1.3.7); si el propietario las desactiva, se respeta ─────────
test('ALTAVOZ DESACTIVADO POR EL PROPIETARIO: hablas, tu voz se transcribe y la respuesta llega escrita; no suena nada (ni la voz del Director ni la del navegador)', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n), { habladas: false });
  await tic(); assert.equal(p.el('btnAltavoz').atributos['aria-pressed'], 'false');
  p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.posts().length, 1, 'la intervención se envía');
  assert.equal(p.sim.audios.length, 0, 'no se reproduce audio'); assert.equal(p.sim.locuciones.length, 0, 'ni voz sintética');
  assert.equal(p.el('textoEstadoVoz').textContent, 'Escuchando… · te respondo por escrito', 'sigue escuchando y dice que responde por escrito'); assert.equal(p.el('textoBtnVoz').textContent, 'Finalizar sesión');
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.posts().length, 2, 'conversación continuada');
});

test('ALTAVOZ: el botón activa y desactiva las respuestas habladas y la preferencia se guarda; silenciar CORTA la respuesta en curso sin cerrar la sesión', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n), { habladas: false });
  await tic(); p.el('btnAltavoz').click(); assert.equal(p.el('btnAltavoz').atributos['aria-pressed'], 'true');
  p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.sim.audios.length, 1, 'con el altavoz activado suena la voz del Director');
  p.el('btnAltavoz').click(); await tic();
  assert.equal(p.sim.audios[0].pausado, true, 'silenciar corta lo que suena'); assert.equal(p.el('btnAltavoz').atributos['aria-pressed'], 'false');
  assert.equal(p.el('textoEstadoVoz').textContent, 'Escuchando… · te respondo por escrito', 'y vuelve a escuchar'); assert.equal(p.el('textoBtnVoz').textContent, 'Finalizar sesión', 'la sesión sigue');
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.sim.audios.length, 1, 'la siguiente respuesta ya no suena');
  const q = montarPanel(async (c, n) => respuestaVoz(n)); await tic(); assert.equal(q.el('btnAltavoz').atributos['aria-pressed'], 'true', 'una preferencia guardada «si» se respeta al recargar');
});

test('SIN RESPALDO ROBÓTICO: con el altavoz activado, si el audio natural no se puede reproducir, no se sustituye por la voz del navegador', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración del micrófono */
  await p.pasar(900, 0.2); await p.pasar(1500, 0); assert.equal(p.sim.audios.length, 1);
  p.sim.audios[0].onerror(); await tic();
  assert.equal(p.sim.locuciones.length, 0, 'ninguna voz sintética de respaldo'); assert.match(p.el('textoEstadoVoz').textContent, /por escrito/);
});

// ───────── salida de voz conocida por el Director (1.3.7): el 27/11 20:46–20:49 el propietario no oía nada y el Director no sabía por qué ─────────
const cuerpoDe = (post) => JSON.parse(post.init.body);
test('SALIDA DE VOZ: cada turno lleva el estado del altavoz, el modo y cómo acabó la última reproducción (lista cerrada)', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); /* calibración */
  await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.deepEqual(cuerpoDe(p.posts()[0]).salidaVoz, { altavoz: 'activado', motor: 'director', ultimaReproduccion: 'ninguna', voz: 'alex' });
  p.sim.audios.at(-1).onended(); await tic();
  await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.equal(cuerpoDe(p.posts()[1]).salidaVoz.ultimaReproduccion, 'completada', 'el navegador reprodujo la respuesta anterior hasta el final');
  const q = montarPanel(async (c, n) => respuestaVoz(n), { habladas: false });
  await tic(); q.el('btnVoz').click(); await tic(); await q.pasar(700, 0); await q.pasar(900, 0.2); await q.pasar(1500, 0);
  assert.equal(cuerpoDe(q.posts()[0]).salidaVoz.altavoz, 'desactivado', 'el Director sabe que las respuestas habladas están desactivadas');
});

test('CUPO DE VOZ AGOTADO: el panel lo dice claramente, marca el altavoz y NO usa una voz robótica', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n, { estado: 'respuesta_solo_texto', audio: null, motivoSinVoz: 'cuota_agotada', vozDirector: 'sin_cupo' }));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.match(p.el('textoEstadoVoz').textContent, /Te respondo por escrito \(mi voz ha agotado su cupo gratuito de hoy\)\. Escuchando…/);
  assert.ok(p.el('btnAltavoz').classList._s ? p.el('btnAltavoz').classList._s.has('sin-cupo') : true, 'el altavoz queda marcado');
  assert.match(p.el('btnAltavoz').title, /voz del Director no está disponible/); assert.equal(p.sim.locuciones.length, 0, 'sin voz robótica'); assert.equal(p.sim.audios.length, 0);
});

// ───────── VOZ LOCAL DEL DIRECTOR (1.3.7): sin cupo, voz elegible con muestra, altavoz activado por defecto ─────────
test('endpoint MUESTRA DE VOZ: lista cerrada (sin llegar al Director si no vale), CSRF obligatorio y compatible con el Director 1.3.6', async () => {
  modo = 'ok'; const antes = recibidas.length;
  assert.equal((await pedir({ muestraVoz: 'kore' })).status, 400); assert.equal((await pedir({ muestraVoz: 'dora' }, { csrf: false })).status, 403);
  assert.equal(recibidas.length, antes, 'nada inválido llega al Director');
  const ok = await pedir({ muestraVoz: 'dora' }); assert.equal(ok.status, 200, ok.t); assert.equal(ok.j.voz, 'dora'); assert.equal(ok.j.audio.mime, 'audio/wav');
  const env = recibidas.at(-1); assert.equal(env.ruta, '/tai/v1/chat/voz/muestra'); assert.deepEqual(env.cuerpo, { voz: 'dora' }); assert.equal(env.auth, `Bearer ${TOKEN_CHAT}`);
  modo = 'antigua'; const vieja = await pedir({ muestraVoz: 'alex' }); assert.equal(vieja.j.code, 'voz_no_disponible'); assert.match(vieja.j.message, /actualización del Director/); modo = 'ok';
});

test('ALTAVOZ ACTIVADO POR DEFECTO: sin preferencia guardada, el Director responde en voz alta (y el turno lo dice)', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n), { habladas: null });
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.equal(cuerpoDe(p.posts()[0]).salidaVoz.altavoz, 'activado'); assert.equal(p.sim.audios.length, 1, 'suena la respuesta'); assert.equal(p.sim.locuciones.length, 0, 'nunca la voz robótica');
});

test('SELECTOR DE VOZ y MUESTRA: la voz elegida viaja con cada turno, se recuerda, la muestra suena y se detiene; también en «Voz rápida»', async () => {
  const p = montarPanel(async (c, n) => (c.muestraVoz ? { success: true, voz: c.muestraVoz, audio: { base64: 'UklGRg==', mime: 'audio/wav' } } : respuestaVoz(n)));
  await tic(); assert.equal(p.el('vozElegida').value, 'alex', 'provisional por defecto'); assert.equal(p.el('vozElegida').hidden, false);
  p.el('vozElegida').value = 'dora'; p.el('vozElegida').dispatch('change');
  p.el('btnMuestraVoz').click(); await tic();
  const m = p.posts().at(-1); assert.deepEqual(JSON.parse(m.init.body), { muestraVoz: 'dora' }); assert.equal(m.init.headers['X-Director-IA'], '1');
  const audio = p.sim.audios.at(-1); assert.match(audio.url, /^data:audio\/wav;base64,/); assert.equal(p.el('btnMuestraVoz').atributos['aria-pressed'], 'true');
  p.el('btnMuestraVoz').click(); await tic(); assert.equal(audio.pausado, true, 'pulsar otra vez detiene la muestra'); assert.equal(p.el('btnMuestraVoz').atributos['aria-pressed'], 'false');
  p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.equal(cuerpoDe(p.posts().at(-1)).salidaVoz.voz, 'dora', 'el Director responde con la voz elegida');
  const q = montarPanel(async (c, n) => respuestaVoz(n)); await tic();
  q.el('modoVoz').value = 'rapida'; q.el('modoVoz').dispatch('change'); assert.equal(q.el('vozElegida').hidden, false, 'el modo rápido también responde con la voz elegida (1.3.8)'); assert.equal(q.el('btnMuestraVoz').hidden, false);
});

test('VOZ LOCAL QUE FALLA: se dice por escrito y claro (sin voz robótica) y el altavoz queda marcado', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n, { estado: 'respuesta_solo_texto', audio: null, motivoSinVoz: 'fallo_voz_local', vozDirector: 'fallo_voz_local' }));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); await p.pasar(900, 0.2); await p.pasar(1500, 0);
  assert.match(p.el('textoEstadoVoz').textContent, /Te respondo por escrito \(mi voz local no ha respondido; lo intento en la próxima\)/);
  assert.equal(p.sim.locuciones.length, 0); assert.equal(p.sim.audios.length, 0);
});

// ───────── HABLA POR FRASES (Director 1.3.8): la primera frase suena en cuanto llega; las siguientes se piden mientras suena la anterior ─────────
const conFrases = (n, total) => respuestaVoz(n, { audio: { base64: 'SUQzbXAz', mime: 'audio/mpeg' }, habla: { id: 'hb_0123456789abcdef', total } });
const frase = (c) => ({ success: true, audio: { base64: Buffer.from(`frase${c.fraseVoz.n}`).toString('base64'), mime: 'audio/mpeg' }, ultima: c.fraseVoz.n === 2 });
test('POR FRASES: suena la primera al llegar, la siguiente se pide ya mientras suena (sin huecos de espera) y al terminar la última vuelve a escuchar', async () => {
  const p = montarPanel(async (c, n) => (c.fraseVoz ? frase(c) : conFrases(n, 3)));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); await p.pasar(900, 0.2); await p.pasar(1300, 0);
  assert.equal(p.sim.audios.length, 1); assert.match(p.sim.audios[0].url, /^data:audio\/mpeg;base64,/);
  const pedidas = () => p.posts().map((x) => JSON.parse(x.init.body)).filter((b) => b.fraseVoz);
  assert.deepEqual(pedidas().map((b) => b.fraseVoz), [{ id: 'hb_0123456789abcdef', n: 1 }], 'la frase 2 se pide mientras suena la 1');
  await p.sim.audios[0].onended(); await tic();
  assert.equal(p.sim.audios.length, 2); assert.match(p.sim.audios[1].url, /;base64,ZnJhc2Ux$/); assert.equal(pedidas().length, 2, 'y la 3 mientras suena la 2');
  await p.sim.audios[1].onended(); await tic(); await p.sim.audios[2].onended(); await tic();
  assert.equal(p.sim.audios.length, 3); assert.equal(p.el('textoEstadoVoz').textContent, 'Escuchando…'); assert.equal(p.sim.locuciones.length, 0, 'sin voz robótica');
});

test('POR FRASES: interrumpir (■ o hablar encima) corta lo que suena y NO reproduce las frases pendientes; el siguiente turno sigue normal', async () => {
  const p = montarPanel(async (c, n) => (c.fraseVoz ? frase(c) : conFrases(n, 3)));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); await p.pasar(900, 0.2); await p.pasar(1300, 0);
  await p.sim.audios[0].onended(); await tic(); assert.equal(p.sim.audios.length, 2);
  p.el('btnDetenerVoz').click(); await tic(); assert.equal(p.sim.audios[1].pausado, true);
  await p.sim.audios[1].onended?.(); await tic(); assert.equal(p.sim.audios.length, 2, 'la frase 3 ya no suena');
  assert.equal(p.el('textoEstadoVoz').textContent, 'Escuchando…'); assert.equal(p.el('textoBtnVoz').textContent, 'Finalizar sesión');
  await p.pasar(900, 0.2); await p.pasar(1300, 0); assert.equal(p.sim.audios.length, 3, 'el turno siguiente se oye');
});

test('FIN DE LA INTERVENCIÓN en 1,1 s de silencio (antes 1,3 s): con 1,0 s aún no se envía; con 1,15 s sí', async () => {
  const p = montarPanel(async (c, n) => respuestaVoz(n));
  await tic(); p.el('btnVoz').click(); await tic(); await p.pasar(700, 0); await p.pasar(900, 0.2);
  await p.pasar(1000, 0); assert.equal(p.posts().length, 0, '1,0 s de silencio: todavía puede seguir hablando');
  await p.pasar(150, 0); assert.equal(p.posts().length, 1);
});
