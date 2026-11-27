/**
 * TREIDILOR — PRIVACIDAD Y PÁGINAS LEGALES (27/11/2026): analítica sin almacenamiento en el navegador (sesión anónima del servidor), sin
 * terceros por defecto (fuentes propias, traductor solo a petición), sin afirmaciones no acreditadas, clic de prueba excluido y páginas
 * legales que solo existen con los datos reales y revisados del titular.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupIsolatedData } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-privacidad-');
const { sesionAnonima, esEventoExcluido, cuentaParaTrafico } = await import('../../src/lib/analyticsFiltros.ts');
const { computeMetricas } = await import('../../src/lib/analyticsMonths.ts');
const { validarDatosLegales, cargarDatosLegales } = await import('../../src/lib/datosLegales.ts');
const evento = await import('../../src/pages/api/analytics/event.ts');
const { getAnalyticsEvents } = await import('../../src/lib/analytics.ts');
const raiz = new URL('../../', import.meta.url);
const leer = (rel) => fs.readFileSync(new URL(rel, raiz), 'utf8');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test('sesión anónima: estable el mismo día con la misma IP y navegador, cambia al día siguiente, nunca contiene la IP; sin IP no hay sesión', () => {
  const t = Date.parse('2026-11-28T10:00:00Z');
  const a = sesionAnonima('198.51.100.4', CHROME, t); assert.match(a, /^sa_[0-9a-f]{32}$/);
  assert.equal(sesionAnonima('198.51.100.4', CHROME, t + 3_600_000), a);
  assert.notEqual(sesionAnonima('198.51.100.5', CHROME, t), a); assert.notEqual(sesionAnonima('198.51.100.4', 'Otro navegador', t), a);
  assert.notEqual(sesionAnonima('198.51.100.4', CHROME, t + 86_400_000), a, 'la sal cambia cada día');
  assert.equal(sesionAnonima(undefined, CHROME, t), undefined); assert.doesNotMatch(a, /198/);
});

test('beacons: se ignoran los identificadores del navegador y se asigna la sesión anónima; robots y panel no se registran', async () => {
  const enviar = (cuerpo, ua = CHROME) => evento.POST({ request: new Request('http://localhost/api/analytics/event', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua, 'x-forwarded-for': '198.51.100.9' }, body: JSON.stringify(cuerpo) }) });
  const n0 = getAnalyticsEvents().length;
  assert.equal((await enviar({ type: 'page_view', path: '/catalogo', sessionId: 'del-navegador-1', visitorId: 'persistente-1', referrer: 'https://www.google.com/' })).status, 202);
  const e = getAnalyticsEvents().at(-1); assert.equal(e.path, '/catalogo'); assert.match(e.sessionId, /^sa_/); assert.equal(e.visitorId, undefined);
  assert.doesNotMatch(JSON.stringify(e), /del-navegador|persistente|198\.51/);
  await enviar({ type: 'page_view', path: '/' }, 'Mozilla/5.0 (compatible; bingbot/2.0)'); await enviar({ type: 'page_view', path: '/upayp1b4/director-ia' });
  assert.equal(getAnalyticsEvents().length, n0 + 1, 'ni el robot ni el panel se registran');
});

test('el clic de prueba conocido (27/11 19:53:21, amazon-b0gr1fc3tr) no cuenta en los indicadores, pero se conserva', () => {
  const prueba = { type: 'outbound_click', productId: 'amazon-b0gr1fc3tr', path: '/ofertas/offer:58fa733c4c', source: 'redirect', createdAt: '2026-11-27T18:53:21.736Z' };
  const otro = { ...prueba, createdAt: '2026-11-27T18:53:25.000Z', sessionId: 'sa_x' };
  assert.equal(esEventoExcluido(prueba), true); assert.equal(cuentaParaTrafico(prueba), false); assert.equal(cuentaParaTrafico(otro), true);
  assert.equal(computeMetricas([prueba, otro]).salidas, 1);
});

test('la web no guarda identificadores de analítica, no carga terceros por defecto y no afirma cumplimientos no acreditados', () => {
  const layout = leer('src/layouts/Layout.astro');
  assert.doesNotMatch(layout, /setItem\([^)]*tradylor_(vid|sid)|guardarId\(/, 'sin identificadores en el navegador');
  assert.match(layout, /localStorage\.removeItem\('tradylor_vid'\)/, 'se borran los antiguos');
  assert.doesNotMatch(layout, /fonts\.googleapis|fonts\.gstatic/, 'fuentes propias'); assert.match(layout, /\/fonts\/fuentes\.css/);
  assert.match(layout, /if \(active\) \{\s*const script = document\.createElement\('script'\);\s*script\.src = 'https:\/\/translate\.google\.com/, 'traductor solo si se eligió idioma');
  assert.doesNotMatch(layout, /GDPR Compliant/); assert.match(layout, /En calidad de Afiliado de Amazon, Treidilor obtiene ingresos por las compras adscritas que cumplen los requisitos aplicables\./);
  assert.doesNotMatch(leer('src/pages/checkout/[id].astro'), /tradylor_(vid|sid)/);
  const css = leer('public/fonts/fuentes.css'); for (const f of css.match(/\/fonts\/[a-z-]+\.woff2/g)) assert.ok(fs.existsSync(new URL('public' + f, raiz)), f);
});

test('datos legales: sin datos, incompletos o sin revisar → no hay páginas; completos y revisados → sí (sin datos ficticios)', () => {
  const completos = { titular: 'Nombre Apellido Apellido', nif: '12345678Z', domicilio: 'Calle Ejemplo 1, 28001 Madrid', email: 'contacto@example.com', textosRevisados: true };
  assert.equal(cargarDatosLegales(), null, 'sin archivo');
  assert.equal(validarDatosLegales({ ...completos, textosRevisados: false }), null, 'sin revisar');
  for (const k of ['titular', 'nif', 'domicilio', 'email']) assert.equal(validarDatosLegales({ ...completos, [k]: '' }), null, `falta ${k}`);
  assert.equal(validarDatosLegales({ ...completos, titular: '<script>x</script>' }), null, 'sin marcado');
  fs.writeFileSync(path.join(dir, 'legal-titular.json'), JSON.stringify(completos));
  const d = cargarDatosLegales(); assert.equal(d.nif, '12345678Z'); assert.equal(d.email, 'contacto@example.com');
  for (const pag of ['aviso-legal', 'privacidad', 'cookies']) assert.match(leer(`src/pages/${pag}.astro`), /if \(!d\) return new Response\('No disponible\.', \{ status: 404/, `${pag}: 404 sin datos`);
  assert.match(leer('src/layouts/Layout.astro'), /\{datosLegales \? \(/, 'el pie solo enlaza las páginas legales con datos');
});
