// Distribución del chat del Director (tipo ChatGPT): solo el hilo se desplaza; cabecera y editor quedan fijos.
// Estas comprobaciones fijan la ESTRUCTURA que lo garantiza; el comportamiento se verificó además en un navegador real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fuente = fs.readFileSync(new URL('../../src/pages/upayp1b4/director-ia.astro', import.meta.url), 'utf8');
const css = fuente.slice(fuente.indexOf('<style'), fuente.indexOf('</style>'));
const regla = (sel) => { const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, `falta la regla ${sel}`); return css.slice(i, css.indexOf('}', i)); };

test('los estilos alcanzan lo que crea el script (burbujas, lista de chats, adjuntos)', () => {
  assert.match(fuente, /<style is:global>/, 'un estilo con ámbito no llega a los nodos creados por JavaScript');
  assert.doesNotMatch(regla('.director-ia-lista'), /display:\s*none/, 'la lista de chats debe verse');
  assert.match(css, /\.director-ia-page \[hidden\] \{ display: none !important; \}/, 'el atributo hidden manda sobre display:flex (estado de voz, aviso…)');
  for (const generico of ['.btn-primary', '.btn-secondary', '.btn-sm', '.punto ']) assert.doesNotMatch(css, new RegExp(`\\n\\s*\\${generico.trim()}[ ,{]`), `${generico} debe ir limitado a .director-ia-page`);
});

test('estructura: cabecera fija · hilo con scroll propio · editor fuera del scroll', () => {
  const hilo = fuente.indexOf('<div class="director-ia-hilo">'); const mensajes = fuente.indexOf('id="contenedorMensajes"'); const aviso = fuente.indexOf('id="btnIrAlFinal"'); const form = fuente.indexOf('<form id="formMensaje"');
  assert.ok(hilo > 0 && hilo < mensajes && mensajes < aviso && aviso < form, 'el aviso flota dentro del hilo y el editor va después, fuera del desplazamiento');
  assert.match(regla('.director-ia-page'), /height: var\(--di-alto/); assert.match(regla('.director-ia-page'), /overflow: hidden/);
  for (const sel of ['.director-ia-chat', '.director-ia-hilo', '.director-ia-mensajes', '.director-ia-sidebar', '.director-ia-lista']) assert.match(regla(sel), /min-height: 0/, `${sel} necesita min-height: 0 para no empujar el editor`);
  assert.match(regla('.director-ia-mensajes'), /overflow-y: auto/); assert.match(regla('.director-ia-mensajes'), /overscroll-behavior: contain/);
  assert.match(regla('.director-ia-lista'), /overflow-y: auto/);
  assert.match(regla('.director-ia-chat-header'), /flex: none/); assert.match(regla('.director-ia-form'), /flex: none/);
  assert.match(regla('.director-ia-ir-final'), /position: absolute/);
  assert.match(css, /html\.director-ia-max, html\.director-ia-max body \{ height: 100%; overflow: hidden;/, 'ampliado, la página no se desplaza: nada de dos barras de scroll');
  assert.doesNotMatch(css, /html\.director-ia-app, html\.director-ia-app body \{[^}]*overflow: hidden/, 'en la vista normal del panel la página SÍ se desplaza (rueda, panel táctil, dedo)');
});

test('campo de escritura con tope y scroll interno; 16 px en móvil (iOS no amplía al enfocar)', () => {
  assert.match(regla('#inputMensaje'), /max-height: min\(12rem, 30vh\)/); assert.match(regla('#inputMensaje'), /overflow-y: auto/);
  assert.match(css, /#inputMensaje \{ font-size: 16px; \}/);
  assert.match(fuente, /Math\.min\(t\.scrollHeight \|\| 0, 192, Math\.max\(64, Math\.round\(visible \* 0\.3\)\)\)/);
});

test('altura visible real: visualViewport (teclado) y modo compacto con poca altura', () => {
  assert.match(fuente, /vv\.addEventListener\('resize', pedir\)/);
  assert.match(fuente, /vv \? vv\.offsetTop \+ vv\.height : window\.innerHeight/);
  assert.match(fuente, /raiz\.classList\.toggle\('director-ia-compacto', max && visible < 560\)/);
  assert.match(fuente, /pagina\.style\.setProperty\('--di-alto', Math\.max\(420, Math\.floor\(visible - 24\)\) \+ 'px'\)/, 'vista normal: alto de la ventana, independiente del scroll de la página');
  assert.match(css, /html\.director-ia-compacto \.site-header, html\.director-ia-compacto \.admin-section-nav \{ display: none !important; \}/);
});

test('lo nuevo se decide ANTES de añadirlo: una respuesta larga no te despega del final', () => {
  assert.match(fuente, /function alHilo\(\.\.\.nodos\) \{ const estaba = cercaDelFinal\(\);/);
  assert.doesNotMatch(fuente, /appendChild\(nodoDirector\);\s*scrollFinal\(\);/, 'todas las respuestas pasan por alHilo');
  assert.match(fuente, /behavior: 'smooth'/, 'acompañar lo nuevo es suave');
});
