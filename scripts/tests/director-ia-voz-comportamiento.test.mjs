/**
 * TREIDILOR — COMPORTAMIENTO REAL DE LA VOZ DEL PANEL (no solo presencia de código).
 *
 * Ejecuta el script REAL de `src/pages/upayp1b4/director-ia.astro` en un contexto `vm` con un DOM mínimo,
 * un reconocimiento de voz y una síntesis simulados y un `fetch` controlado. El reconocimiento simulado se
 * comporta como el de Chrome: `stop()` dispara `onend` de forma ASÍNCRONA, que es donde aparecen las carreras.
 *
 * Comprueba los defectos señalados por el propietario:
 *  · conversación continua de cinco turnos con una sola pulsación (escucha → envía → habla → vuelve a escuchar);
 *  · «Finalizar sesión» se puede pulsar también mientras el Director procesa;
 *  · una respuesta tardía tras finalizar no se lee en voz alta ni reactiva la escucha;
 *  · una respuesta HTML o de texto (sesión caducada, proxy) da un mensaje comprensible, no «Unexpected token».
 *
 * NO sustituye la prueba física con micrófono y altavoces del propietario (pendiente de extremo a extremo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const PAGINA = path.join(import.meta.dirname, '..', '..', 'src', 'pages', 'upayp1b4', 'director-ia.astro');
const fuente = fs.readFileSync(PAGINA, 'utf8');
const ini = fuente.indexOf('<script is:inline>');
const fin = fuente.indexOf('</script>', ini);
const SCRIPT = fuente.slice(ini + '<script is:inline>'.length, fin);

const espera = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const tic = async () => { for (let i = 0; i < 5; i += 1) await espera(0); };

/** Elemento DOM mínimo, suficiente para el script del panel. */
function elemento(id = '') {
  const oyentes = {};
  const el = {
    id, value: '', disabled: false, hidden: false, textContent: '', innerHTML: '', className: '', children: [],
    scrollTop: 0, scrollHeight: 0, style: {}, dataset: {}, atributos: {},
    addEventListener(tipo, fn) { (oyentes[tipo] ||= []).push(fn); },
    dispatch(tipo, evento = {}) { for (const fn of oyentes[tipo] || []) fn({ preventDefault() {}, ...evento }); },
    click() { if (!el.disabled) el.dispatch('click'); },
    appendChild(h) { el.children.push(h); return h; },
    remove() {}, focus() {}, scrollIntoView() {}, scrollTo() {},
    setAttribute(k, v) { el.atributos[k] = String(v); }, removeAttribute(k) { delete el.atributos[k]; },
    querySelector: () => elemento(), querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  return el;
}

/** Monta el panel con un `fetch` dado y devuelve los mandos de la simulación. */
function montarPanel(manejarFetch) {
  const elementos = new Map();
  const document = {
    getElementById: (id) => { if (!elementos.has(id)) elementos.set(id, elemento(id)); return elementos.get(id); },
    createElement: () => elemento(),
    querySelector: () => elemento(),
    addEventListener() {},
  };
  const reconocimientos = [];
  class SpeechRecognition {
    constructor() { this.activo = false; reconocimientos.push(this); }
    start() { this.activo = true; }
    stop() { if (!this.activo) return; this.activo = false; setTimeout(() => this.onend?.(), 0); }
    abort() { this.stop(); }
    /** El propietario dice algo. */
    decir(texto, confianza = 0.92) { this.onresult?.({ results: [[{ transcript: texto, confidence: confianza }]] }); }
  }
  const locuciones = [];
  const speechSynthesis = { speaking: false, speak(u) { locuciones.push(u); }, cancel() {} };
  class SpeechSynthesisUtterance { constructor(texto) { this.text = texto; } }
  const peticiones = [];
  const fetch = async (url, init = {}) => { peticiones.push({ url: String(url), init }); return manejarFetch(String(url), init); };
  const almacen = new Map();
  const ventana = {
    SpeechRecognition, speechSynthesis, SpeechSynthesisUtterance, fetch, document,
    localStorage: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v), removeItem: (k) => almacen.delete(k) },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5)),
    clearTimeout, setInterval: () => 0, clearInterval() {},
    console: { log() {}, info() {}, warn() {}, error() {} },
    Date, JSON, Math, Promise, URL, encodeURIComponent, Error, Number, String, Array, Object, Boolean, RegExp, Intl,
  };
  ventana.window = ventana;
  vm.createContext(ventana);
  vm.runInContext(SCRIPT, ventana, { filename: 'director-ia.astro<script>' });
  const el = (id) => document.getElementById(id);
  return {
    el, peticiones, locuciones,
    ultimoReconocimiento: () => reconocimientos.at(-1),
    reconocimientosActivos: () => reconocimientos.filter((r) => r.activo).length,
    totalReconocimientos: () => reconocimientos.length,
  };
}

const jsonRes = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json; charset=utf-8' } });
const respuestaDirector = (texto) => jsonRes({
  success: true,
  conversacion: { id: 'cv_0123456789abcdef', principal: true },
  respuesta: { estado: 'respondida', textoClaro: texto, detalle: '', generadoEn: new Date().toISOString(), fuentes: [], tareas: [], solicitudesAutorizacion: [], limitaciones: [], avisos: [] },
});
/** Responde a la carga inicial (estado e historial) y delega los POST de voz. */
function servidor(alPost) {
  return async (url, init) => {
    if (url.includes('/status')) return jsonRes({ success: true, conectado: true });
    if (url.includes('/principal') && (!init.method || init.method === 'GET')) return jsonRes({ success: true, conversacion: { id: 'cv_0123456789abcdef', mensajes: [], principal: true } });
    if (url.includes('/principal') && init.method === 'POST') return alPost(JSON.parse(init.body));
    return jsonRes({ success: false }, 404);
  };
}

test('voz: cinco turnos seguidos con una sola pulsación (escucha → Director → habla → vuelve a escuchar)', async () => {
  const p = montarPanel(servidor(async (cuerpo) => respuestaDirector(`Respuesta a «${cuerpo.texto}»`)));
  await tic();
  p.el('btnVoz').click();
  assert.equal(p.reconocimientosActivos(), 1, 'una sola pulsación abre la escucha');
  for (let turno = 1; turno <= 5; turno += 1) {
    p.ultimoReconocimiento().decir(`mensaje ${turno}`);
    await tic();
    const post = p.peticiones.filter((x) => x.init.method === 'POST').at(-1);
    const cuerpo = JSON.parse(post.init.body);
    assert.equal(cuerpo.texto, `mensaje ${turno}`);
    assert.equal(cuerpo.origen, 'voz');
    assert.equal(p.locuciones.at(-1).text, `Respuesta a «mensaje ${turno}»`, 'el Director responde en voz alta');
    p.locuciones.at(-1).onend();
    await tic();
    assert.equal(p.reconocimientosActivos(), 1, `tras el turno ${turno} vuelve a escuchar (sin duplicar reconocimientos)`);
  }
  assert.equal(p.peticiones.filter((x) => x.init.method === 'POST').length, 5, 'cinco envíos, sin duplicados');
  assert.equal(p.el('btnVoz').disabled, false);
  p.el('btnVoz').click(); // finalizar
  await tic();
  assert.equal(p.reconocimientosActivos(), 0, 'finalizar detiene la escucha');
});

test('voz: «Finalizar sesión» funciona mientras el Director procesa y la respuesta tardía no se lee', async () => {
  let liberar;
  const pendiente = new Promise((r) => { liberar = r; });
  const p = montarPanel(servidor(async () => { await pendiente; return respuestaDirector('Respuesta que llega tarde'); }));
  await tic();
  p.el('btnVoz').click();
  p.ultimoReconocimiento().decir('analiza las ventas');
  await tic();
  assert.equal(p.el('btnVoz').disabled, false, 'el botón Finalizar está disponible durante el procesamiento');
  p.el('btnVoz').click(); // finalizar mientras procesa
  await tic();
  const reconocimientosAntes = p.totalReconocimientos();
  liberar();
  await tic();
  await espera(10);
  assert.equal(p.locuciones.length, 0, 'una respuesta que llega tras finalizar NO se lee en voz alta');
  assert.equal(p.totalReconocimientos(), reconocimientosAntes, 'ni reactiva la escucha');
  assert.equal(p.reconocimientosActivos(), 0);
});

test('voz: una respuesta HTML o de texto se explica al propietario (no «Unexpected token»)', async () => {
  for (const [respuesta, esperado] of [
    [new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } }), /no respondió con datos válidos \(HTTP 502\)/],
    [new Response('Autenticacion requerida', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } }), /sesión ha caducado/],
  ]) {
    const p = montarPanel(servidor(async () => respuesta));
    await tic();
    p.el('btnVoz').click();
    p.ultimoReconocimiento().decir('hola');
    await tic();
    const alerta = p.el('alertaForm').textContent;
    assert.match(alerta, esperado);
    assert.doesNotMatch(alerta, /Unexpected token|JSON/);
    p.el('btnVoz').click();
    await tic();
  }
});
