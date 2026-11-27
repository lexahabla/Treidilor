/**
 * TREIDILOR — DIRECTOR IA A PANTALLA COMPLETA (script REAL de director-ia.astro en `vm`, con un DOM que sí monta la vista).
 *  · Al abrir DIRECTOR IA la conversación ocupa toda la ventana desde el primer pintado (clase puesta en <html> por el script de la cabecera).
 *  · La X ROJA (y Escape, si no hay nada encima) vuelve al panel de administración SIN tocar la conversación: borrador, adjuntos y voz siguen.
 *  · «Director IA» del menú, estando ya en la página, vuelve a la pantalla completa sin recargar.
 *  · Vista normal: la PÁGINA se desplaza entera (no se fuerza la ventana arriba ni se bloquea el scroll); ampliada: solo el hilo se desplaza.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fuente = fs.readFileSync(new URL('../../src/pages/upayp1b4/director-ia.astro', import.meta.url), 'utf8');
const ini = fuente.indexOf('<script is:inline>'); const SCRIPT = fuente.slice(ini + '<script is:inline>'.length, fuente.indexOf('</script>', ini));
const css = fuente.slice(fuente.indexOf('<style'), fuente.indexOf('</style>'));
const espera = (ms = 0) => new Promise((r) => setTimeout(r, ms)); const tic = async () => { for (let i = 0; i < 10; i += 1) await espera(0); };

const clases = () => { const s = new Set(); return { _s: s, add: (c) => s.add(c), remove: (c) => s.delete(c), toggle: (c, f) => { const v = f === undefined ? !s.has(c) : Boolean(f); if (v) s.add(c); else s.delete(c); return v; }, contains: (c) => s.has(c) }; };
function elemento(id = '', tag = 'div') {
  const oyentes = {};
  const el = { id, tag, tagName: tag.toUpperCase(), value: '', disabled: false, hidden: false, textContent: '', innerHTML: '', children: [], scrollTop: 0, scrollHeight: 0, clientHeight: 500, dataset: {}, atributos: {}, parentNode: null,
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, classList: clases(),
    addEventListener(t, fn) { (oyentes[t] ||= []).push(fn); }, dispatch(t, ev = {}) { const e = { preventDefault() { e.prevenido = true; }, ...ev }; for (const fn of oyentes[t] || []) fn(e); return e; },
    click() { if (!el.disabled) el.dispatch('click', { target: el }); }, appendChild(h) { h.parentNode = el; el.children.push(h); return h; }, removeChild(h) { el.children = el.children.filter((x) => x !== h); return h; },
    remove() {}, focus() {}, select() {}, scrollIntoView() {}, scrollTo() {}, getBoundingClientRect: () => ({ top: 0, height: 500 }), setAttribute(k, v) { el.atributos[k] = String(v); }, getAttribute(k) { return el.atributos[k]; }, removeAttribute(k) { delete el.atributos[k]; },
    querySelector: () => null, querySelectorAll: () => [], contains: () => false };
  return el;
}

function montar({ altoVentana = 900 } = {}) {
  const elementos = new Map(); const peticiones = []; const oyentesVentana = {};
  const raiz = elemento('html', 'html'); raiz.classList.add('director-ia-max'); // lo hace el script de la cabecera antes de pintar
  const pagina = elemento('directorIaApp', 'main'); const zona = elemento('', 'section'); pagina.querySelector = (s) => (s === '.director-ia-chat' ? zona : null);
  const enlaceMenu = elemento('', 'a'); enlaceMenu.atributos.href = '/upayp1b4/director-ia'; const enlaceOtro = elemento('', 'a'); enlaceOtro.atributos.href = '/upayp1b4/catalogo';
  const document = { documentElement: raiz, getElementById: (id) => { if (!elementos.has(id)) elementos.set(id, elemento(id)); return elementos.get(id); }, createElement: (t) => elemento('', t), createDocumentFragment: () => elemento(),
    querySelector: (s) => (s === '.director-ia-page' ? pagina : null), querySelectorAll: (s) => (s === 'a[href]' ? [enlaceMenu, enlaceOtro] : []), addEventListener() {}, body: elemento('body'), activeElement: null };
  const jsonRes = (c, e = 200) => new Response(JSON.stringify(c), { status: e, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const fetch = async (url, init = {}) => { url = String(url); peticiones.push({ url, init }); if (url.includes('/status')) return jsonRes({ success: true, conectado: true }); if (url.includes('/panel')) return jsonRes({ success: true, confirmacionesPendientes: [] }); if (url.includes('/principal')) return jsonRes({ success: true, conversacion: { id: 'cv_aaaaaaaaaaaaaaaa', mensajes: [], principal: true } }); return jsonRes({ success: false }, 404); };
  const almacen = new Map(); const sesion = new Map(); const desplazamientos = [];
  const ventana = { fetch, document, navigator: {}, prompt: () => null, confirm: () => true, innerHeight: altoVentana, scrollY: 0,
    Event: class { constructor(t) { this.type = t; } }, dispatchEvent(e) { for (const fn of oyentesVentana[e.type] || []) fn(e); return true; },
    addEventListener(t, fn) { (oyentesVentana[t] ||= []).push(fn); }, scrollTo(x, y) { desplazamientos.push([x, y]); }, matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn) => setTimeout(fn, 0), getSelection: () => '',
    location: { href: 'https://treidilor.com/upayp1b4/director-ia' },
    localStorage: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v), removeItem: (k) => almacen.delete(k) },
    sessionStorage: { getItem: (k) => sesion.get(k) ?? null, setItem: (k, v) => sesion.set(k, v), removeItem: (k) => sesion.delete(k) },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5)), clearTimeout, setInterval: () => 0, clearInterval() {}, console: { log() {}, info() {}, warn() {}, error() {} },
    Date, JSON, Math, Promise, URL, encodeURIComponent, Error, Number, String, Array, Object, Boolean, RegExp, Intl, Response, Set, Map };
  ventana.window = ventana; vm.createContext(ventana); vm.runInContext(SCRIPT, ventana, { filename: 'director-ia.astro<script>' });
  const tecla = (key) => { for (const fn of oyentesVentana.keydown || []) fn({ key }); };
  return { el: (id) => document.getElementById(id), raiz, pagina, enlaceMenu, enlaceOtro, peticiones, desplazamientos, tecla, ventana, max: () => raiz.classList.contains('director-ia-max') };
}

test('ABRE A PANTALLA COMPLETA: la clase se pone en <html> antes de pintar y el script lo confirma al cargar (sin pasar por una vista reducida)', async () => {
  const cabecera = fuente.indexOf('<Fragment slot="header-end">'); const temprano = fuente.indexOf("<script is:inline data-director-ia-max>try { document.documentElement.classList.add('director-ia-max');");
  assert.ok(cabecera > 0 && temprano > cabecera && temprano < fuente.indexOf('<AdminUserMenu'), 'el script va en la cabecera, antes del contenido');
  const p = montar(); await tic();
  assert.equal(p.max(), true); assert.equal(p.el('btnCerrarMax').hidden, false, 'X visible'); assert.equal(p.el('btnMaximizar').hidden, true);
  assert.match(css, /html\.director-ia-max \.site-header, html\.director-ia-max \.admin-wrapper > \.admin-header, html\.director-ia-max \.admin-section-nav \{ display: none !important; \}/, 'sin cabecera ni menú del panel');
});

test('X ROJA: vuelve al panel de administración sin tocar la conversación (borrador, sin peticiones, sin cancelar nada) y Escape hace lo mismo', async () => {
  const p = montar(); await tic();
  p.el('inputMensaje').value = 'borrador a medias'; const antes = p.peticiones.filter((x) => x.init.method === 'POST').length;
  p.el('btnCerrarMax').click(); await tic();
  assert.equal(p.max(), false, 'vista normal del panel'); assert.equal(p.el('btnCerrarMax').hidden, true); assert.equal(p.el('btnMaximizar').hidden, false);
  assert.equal(p.el('inputMensaje').value, 'borrador a medias', 'el borrador sigue'); assert.equal(p.peticiones.filter((x) => x.init.method === 'POST').length, antes, 'cerrar no envía, borra ni cancela nada');
  assert.deepEqual(p.desplazamientos.at(-1), [0, 0], 'el panel se muestra desde arriba, con su cabecera y su menú');
  p.el('btnMaximizar').click(); await tic(); assert.equal(p.max(), true);
  p.tecla('Escape'); await tic(); assert.equal(p.max(), false, 'Escape también cierra');
  const c = css.slice(css.indexOf('.director-ia-cerrar-max {'), css.indexOf('}', css.indexOf('.director-ia-cerrar-max {')));
  assert.match(c, /background: #dc2626/); assert.match(c, /color: #fff/); assert.match(c, /width: 44px; height: 44px/); assert.match(c, /border: 2px solid #fff/, 'contrasta sobre fondos claros y oscuros');
});

test('MENÚ «Director IA» estando ya aquí: vuelve a la pantalla completa SIN recargar; los demás enlaces navegan como siempre', async () => {
  const p = montar(); await tic();
  p.el('btnCerrarMax').click(); await tic(); assert.equal(p.max(), false);
  const e = p.enlaceMenu.dispatch('click', { button: 0 }); await tic();
  assert.equal(e.prevenido, true, 'no recarga la página (no se pierden adjuntos ni la sesión de voz)'); assert.equal(p.max(), true);
  const o = p.enlaceOtro.dispatch('click', { button: 0 }); assert.notEqual(o.prevenido, true);
  const nueva = p.enlaceMenu.dispatch('click', { button: 0, ctrlKey: true }); assert.notEqual(nueva.prevenido, true, 'Ctrl+clic abre otra pestaña como siempre');
});

test('SCROLL: en la vista normal la página se desplaza (no se fuerza arriba, alto fijo a la ventana); ampliada, la ventana queda quieta y solo el hilo se desplaza', async () => {
  const p = montar({ altoVentana: 900 }); await tic();
  p.el('btnCerrarMax').click(); await tic(); await tic();
  const n = p.desplazamientos.length; p.ventana.scrollY = 600; p.ventana.dispatchEvent(new p.ventana.Event('resize')); await tic(); await tic();
  assert.equal(p.desplazamientos.length, n, 'en la vista normal nada devuelve la ventana arriba: se puede bajar por toda la página');
  assert.equal(p.pagina.style.props['--di-alto'], '876px', 'el chat mide la ventana visible, sin depender del scroll de la página');
  assert.equal(p.raiz.classList.contains('director-ia-compacto'), false);
  assert.doesNotMatch(css, /html\.director-ia-app, html\.director-ia-app body \{[^}]*overflow: hidden/, 'nada bloquea el scroll de la página en la vista normal');
  p.el('btnMaximizar').click(); await tic(); await tic();
  assert.ok(p.desplazamientos.length > n, 'ampliada: la ventana vuelve arriba'); assert.match(css, /html\.director-ia-max, html\.director-ia-max body \{ height: 100%; overflow: hidden;/);
  for (const sel of ['.director-ia-mensajes {', '.director-ia-lista {']) assert.match(css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel))), /overflow-y: auto/, `${sel} con scroll propio`);
});
