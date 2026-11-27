/**
 * TREIDILOR — INTERFAZ CONVERSACIONAL DEL PANEL (script REAL de director-ia.astro en `vm`, DOM mínimo y `fetch` controlado).
 *  · Markdown SEGURO: tablas, código, listas y enlaces http(s); ningún HTML, `javascript:` ni atributo del mensaje llega al DOM.
 *  · Chats: carga la lista, abre la principal y, al cambiar o crear un chat, los mensajes van a SU conversación.
 *  · Historial: carga progresiva (40 + «ver anteriores»); desplazamiento automático solo si estás al final (si no, aviso).
 *  · Escritura: Enter envía y Mayús+Enter no; si el envío falla, lo escrito no se pierde y se puede reintentar.
 *  · Sin la API de chats (servidor antiguo) funciona como antes con la conversación principal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const fuente = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'pages', 'upayp1b4', 'director-ia.astro'), 'utf8');
const ini = fuente.indexOf('<script is:inline>'); const SCRIPT = fuente.slice(ini + '<script is:inline>'.length, fuente.indexOf('</script>', ini));
const espera = (ms = 0) => new Promise((r) => setTimeout(r, ms)); const tic = async () => { for (let i = 0; i < 10; i += 1) await espera(0); };

function elemento(id = '', tag = 'div') {
  const oyentes = {};
  const el = { id, tag, value: '', disabled: false, hidden: false, textContent: '', innerHTML: '', className: '', children: [], scrollTop: 0, scrollHeight: 0, clientHeight: 500, style: {}, dataset: {}, atributos: {}, parentNode: null,
    addEventListener(t, fn) { (oyentes[t] ||= []).push(fn); }, dispatch(t, ev = {}) { for (const fn of oyentes[t] || []) fn({ preventDefault() {}, ...ev }); },
    click() { if (!el.disabled) el.dispatch('click'); }, appendChild(h) { h.parentNode = el; el.children.push(h); return h; }, removeChild(h) { el.children = el.children.filter((x) => x !== h); h.parentNode = null; return h; },
    remove() {}, focus() {}, select() {}, scrollIntoView() {}, setAttribute(k, v) { el.atributos[k] = String(v); }, getAttribute(k) { return el.atributos[k]; }, removeAttribute(k) { delete el.atributos[k]; },
    querySelector: () => null, querySelectorAll: () => [], classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c) { if (this._s.has(c)) { this._s.delete(c); return false; } this._s.add(c); return true; }, contains(c) { return this._s.has(c); } } };
  return el;
}
const textoDe = (el) => [el.textContent, el.innerHTML, ...el.children.map(textoDe)].join(' ');

function montar(manejar, { conChats = true } = {}) {
  const elementos = new Map(); const peticiones = [];
  const document = { getElementById: (id) => { if (!elementos.has(id)) elementos.set(id, elemento(id)); return elementos.get(id); }, createElement: (t) => elemento('', t), createDocumentFragment: () => elemento(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: elemento('body') };
  const jsonRes = (c, e = 200) => new Response(JSON.stringify(c), { status: e, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const fetch = async (url, init = {}) => { url = String(url); peticiones.push({ url, init }); if (url.includes('/status')) return jsonRes({ success: true, conectado: true }); if (url.includes('/panel')) return jsonRes({ success: true, confirmacionesPendientes: [] }); if (url.includes('/chats') && !conChats) return jsonRes({ success: false }, 404); return jsonRes(await manejar(url, init)); };
  const almacen = new Map();
  const ventana = { fetch, document, navigator: {}, prompt: () => null, confirm: () => true, Event: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v), removeItem: (k) => almacen.delete(k) },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5)), clearTimeout, setInterval: () => 0, clearInterval() {}, console: { log() {}, info() {}, warn() {}, error() {} },
    Date, JSON, Math, Promise, URL, encodeURIComponent, Error, Number, String, Array, Object, Boolean, RegExp, Intl, Response, Set, Map };
  ventana.window = ventana; vm.createContext(ventana); vm.runInContext(SCRIPT, ventana, { filename: 'director-ia.astro<script>' });
  const el = (id) => document.getElementById(id);
  return { el, peticiones, posts: () => peticiones.filter((p) => p.init.method === 'POST' && p.url.includes('/principal')), almacen };
}
const CHATS = { success: true, chats: [{ id: 'cv_aaaaaaaaaaaaaaaa', titulo: 'Principal · Telegram', proyectoId: null, principal: true, archivada: false, eliminadaEn: null, creadoEn: '2026-11-20T10:00:00Z', actualizadoEn: '2026-11-27T10:00:00Z' }, { id: 'cv_bbbbbbbbbbbbbbbb', titulo: 'Precios', proyectoId: null, principal: false, archivada: false, eliminadaEn: null, creadoEn: '2026-11-26T10:00:00Z', actualizadoEn: '2026-11-26T10:00:00Z' }], proyectos: [] };
const historia = (n, extra = []) => ({ success: true, conversacion: { mensajes: [...Array.from({ length: n }, (_, i) => ({ rol: i % 2 ? 'director' : 'usuario', contenido: `m${i}`, en: '2026-11-27T10:00:00Z' })), ...extra] } });
const respuesta = (t) => ({ success: true, respuesta: { estado: 'respondida', textoClaro: t, generadoEn: new Date().toISOString(), fuentes: [], tareas: [], solicitudesAutorizacion: [], limitaciones: [], avisos: [] } });

test('MARKDOWN SEGURO: tablas, código, listas y enlaces; nada de HTML, atributos ni javascript: del mensaje', async () => {
  const malicioso = '## Título\n**negrita** y `código`\n\n| a | b |\n|---|---|\n| 1 | <img src=x onerror=alert(1)> |\n\n- uno\n- dos\n\n```\n<script>alert(1)</script>\n```\n[enlace](javascript:alert(1)) [bueno](https://treidilor.com/x?a=1&b=2) <b onclick="x">t</b>';
  const p = montar(async (url) => (url.includes('/chats') ? CHATS : historia(0, [{ rol: 'director', contenido: malicioso, en: '2026-11-27T10:00:00Z' }])));
  await tic(); await tic();
  const html = textoDe(p.el('contenedorMensajes'));
  assert.match(html, /<table><thead><tr><th>a<\/th>/); assert.match(html, /<pre><code>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code><\/pre>/); assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/); assert.match(html, /<strong>negrita<\/strong>/); assert.match(html, /<h4>Título<\/h4>/);
  assert.match(html, /<a href="https:\/\/treidilor\.com\/x\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">bueno<\/a>/);
  assert.doesNotMatch(html, /<img|<script|<b /i, 'ningún HTML del mensaje se interpreta'); assert.doesNotMatch(html, /<[a-z][^>]*\son\w+=/i, 'ninguna etiqueta real con atributos de evento'); assert.doesNotMatch(html, /href="javascript/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'se muestra como texto');
});

test('CHATS: abre la principal; al elegir otro chat los mensajes van a SU conversación; crear un chat nuevo lo abre', async () => {
  let creado = false;
  const p = montar(async (url, init) => {
    if (url.includes('/chats') && init.method === 'POST') { creado = true; return { ...CHATS, chats: [...CHATS.chats, { id: 'cv_cccccccccccccccc', titulo: 'Chat nuevo', proyectoId: null, principal: false, archivada: false, eliminadaEn: null, creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString() }], chat: { id: 'cv_cccccccccccccccc' } }; }
    if (url.includes('/chats')) return CHATS; if (init.method === 'POST') return respuesta('ok'); return historia(2);
  });
  await tic(); await tic();
  const gets = () => p.peticiones.filter((x) => x.url.includes('/principal') && !x.init.method).map((x) => x.url);
  assert.match(gets().at(-1), /conversacionId=cv_aaaaaaaaaaaaaaaa/, 'abre la principal');
  assert.equal(p.el('tituloConversacion').textContent, 'Principal · Telegram');
  const lista = p.el('listaChats'); const boton = (txt) => { const buscar = (e) => (e.className === 'director-ia-chat-abrir' && e.textContent.includes(txt) ? e : e.children.map(buscar).find(Boolean)); return buscar(lista); };
  boton('Precios').click(); await tic(); assert.match(gets().at(-1), /conversacionId=cv_bbbbbbbbbbbbbbbb/); assert.equal(p.almacen.get('directorIa_conversacionId'), 'cv_bbbbbbbbbbbbbbbb', 'se recuerda');
  p.el('inputMensaje').value = 'hola chat'; p.el('inputMensaje').dispatch('keydown', { key: 'Enter' }); await tic();
  assert.match(p.posts().at(-1).url, /conversacionId=cv_bbbbbbbbbbbbbbbb/, 'el mensaje va a la conversación del chat elegido');
  p.el('btnNuevoChat').click(); await tic(); await tic(); assert.equal(creado, true); assert.match(gets().at(-1), /conversacionId=cv_cccccccccccccccc/, 'el chat nuevo se abre');
});

test('HISTORIAL: carga progresiva de 40 en 40 y desplazamiento automático solo si estás al final', async () => {
  let lento; const p = montar(async (url, init) => (url.includes('/chats') ? CHATS : init.method === 'POST' ? new Promise((ok) => { lento = () => ok(respuesta('respuesta')); }) : historia(100)));
  await tic(); await tic();
  const c = p.el('contenedorMensajes');
  const burbujas = () => c.children.filter((x) => String(x.className).includes('director-ia-burbuja')).length;
  assert.equal(burbujas(), 40, 'solo los 40 últimos al abrir'); const ver = c.children.find((x) => String(x.className).includes('cargar-anteriores')); assert.ok(ver, 'botón «ver anteriores»');
  ver.click(); assert.equal(burbujas(), 80);
  // el usuario está leyendo arriba: una respuesta nueva no le mueve la vista y aparece el aviso
  c.scrollHeight = 5000; c.clientHeight = 500; c.scrollTop = 1000;
  p.el('inputMensaje').value = 'pregunta'; p.el('inputMensaje').dispatch('keydown', { key: 'Enter' }); await tic();
  assert.equal(c.scrollTop, 5000, 'lo que envías tú sí baja al final');
  c.scrollTop = 1000; lento(); await tic(); await tic();
  assert.equal(c.scrollTop, 1000, 'no te arrastra mientras lees'); assert.equal(p.el('btnIrAlFinal').hidden, false, 'aviso de mensajes nuevos');
  p.el('btnIrAlFinal').click(); assert.equal(c.scrollTop, 5000);
});

test('ESCRITURA: Mayús+Enter no envía; si el envío falla lo escrito no se pierde y se puede reintentar', async () => {
  let k = 0; const p = montar(async (url, init) => (url.includes('/chats') ? CHATS : init.method === 'POST' ? (++k === 1 ? { success: false, message: 'El Director no responde' } : respuesta('ya')) : historia(0)));
  await tic(); await tic();
  const t = p.el('inputMensaje'); t.value = 'línea 1'; t.dispatch('keydown', { key: 'Enter', shiftKey: true }); await tic(); assert.equal(p.posts().length, 0, 'Mayús+Enter es salto de línea');
  t.dispatch('keydown', { key: 'Enter' }); await tic();
  assert.equal(p.posts().length, 1); assert.equal(t.value, 'línea 1', 'el texto vuelve al campo'); assert.match(p.el('alertaForm').textContent, /no responde/);
  const buscar = (e) => (e.textContent === 'Reintentar' ? e : e.children.map(buscar).find(Boolean)); const reintentar = buscar(p.el('contenedorMensajes')); assert.ok(reintentar, 'botón reintentar');
  reintentar.click(); await tic(); assert.equal(p.posts().length, 2);
});

test('COMPATIBLE: sin la API de chats (servidor antiguo) abre la conversación principal como antes', async () => {
  const p = montar(async () => historia(3), { conChats: false });
  await tic(); await tic();
  assert.ok(p.peticiones.some((x) => x.url.endsWith('/principal') && !x.init.method), 'pide la principal sin conversacionId');
  assert.equal(p.el('contenedorMensajes').children.filter((x) => String(x.className).includes('director-ia-burbuja')).length, 3);
});

test('ADJUNTOS en la interfaz: elegir archivos los sube al chat abierto, el mensaje los lleva, pegar una captura la adjunta y al cambiar de chat se descartan los no enviados', async () => {
  let k = 0; const borrados = [];
  const p = montar(async (url, init) => {
    if (url.includes('/adjuntos') && init.method === 'POST') { const nombre = decodeURIComponent(init.headers['X-Nombre-Archivo']); return { success: true, adjunto: { id: `ad_${String(++k).padStart(16, '0')}`, nombre, tipo: nombre.endsWith('.png') ? 'png' : 'pdf', texto: { estado: nombre.endsWith('.png') ? 'no_disponible' : 'ok' } } }; }
    if (url.includes('/adjuntos') && init.method === 'DELETE') { borrados.push(url); return { success: true }; }
    if (url.includes('/chats')) return CHATS; if (init.method === 'POST') return respuesta('recibido'); return historia(0);
  });
  await tic(); await tic();
  const input = p.el('inputArchivos'); input.files = [{ name: 'contrato.pdf', size: 2048, type: 'application/pdf' }]; input.dispatch('change'); await tic();
  const subida = p.peticiones.find((x) => x.url.includes('/adjuntos') && x.init.method === 'POST'); assert.match(subida.url, /conversacionId=cv_aaaaaaaaaaaaaaaa/); assert.equal(subida.init.headers['X-Director-IA'], '1');
  assert.match(textoDe(p.el('listaAdjuntos')), /contrato\.pdf/); assert.match(textoDe(p.el('listaAdjuntos')), /listo para leer/);
  p.el('inputMensaje').value = ''; p.el('inputMensaje').dispatch('keydown', { key: 'Enter' }); await tic();
  const env = JSON.parse(p.posts().at(-1).init.body); assert.deepEqual(env.adjuntos, ['ad_0000000000000001'], 'se puede enviar solo con adjuntos'); assert.equal(p.el('listaAdjuntos').hidden, true, 'tras enviar, la lista se vacía');
  p.el('inputMensaje').dispatch('paste', { clipboardData: { files: [{ name: 'captura.png', size: 900, type: 'image/png' }] } }); await tic();
  assert.match(textoDe(p.el('listaAdjuntos')), /captura\.png/); assert.match(textoDe(p.el('listaAdjuntos')), /sin análisis visual/, 'se dice que no hay análisis visual');
  const buscar = (e, txt) => (e.className === 'director-ia-chat-abrir' && e.textContent.includes(txt) ? e : e.children.map((x) => buscar(x, txt)).find(Boolean)); buscar(p.el('listaChats'), 'Precios').click(); await tic();
  assert.equal(borrados.length, 1, 'el adjunto sin enviar del chat anterior se borra'); assert.match(borrados[0], /id=ad_0000000000000002/);
});

test('CONFIDENCIAL en la interfaz: candado en la lista, aviso en el subtítulo y micrófono desactivado en ese chat', async () => {
  const conf = { ...CHATS, chats: [CHATS.chats[0], { ...CHATS.chats[1], confidencial: true }] };
  const p = montar(async (url) => (url.includes('/chats') ? conf : historia(0)));
  await tic(); await tic();
  const buscar = (e, txt) => (e.className === 'director-ia-chat-abrir' && e.textContent.includes(txt) ? e : e.children.map((x) => buscar(x, txt)).find(Boolean));
  const item = buscar(p.el('listaChats'), 'Precios'); assert.match(item.textContent, /🔒/);
  assert.equal(p.el('btnVoz').disabled, false, 'en la principal la voz sigue disponible');
  item.click(); await tic(); assert.equal(p.el('btnVoz').disabled, true); assert.match(p.el('subtituloConversacion').textContent, /Confidencial: sin modelo externo ni voz/);
});
