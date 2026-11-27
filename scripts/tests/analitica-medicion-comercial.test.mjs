/**
 * TREIDILOR — MEDICIÓN COMERCIAL CORREGIDA (27/11/2026). Reproduce con datos sintéticos el patrón real de noviembre:
 * vista de ficha duplicada (servidor sin sesión + navegador), panel contado como tráfico, clics de salida sin sesión (→ «conversión» 128 %),
 * rastreadores y comprobadores contando como clics y el mismo clic repetido en menos de 2 s.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupIsolatedData, writeCatalog } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-medicion-');
const { esAgenteAutomatico, cuentaParaTrafico, esRutaAdmin, crearDeduplicador, idAnalitica } = await import('../../src/lib/analyticsFiltros.ts');
const { computeMetricas, computeFuentes, computeTopReferrers, computeEvolucion } = await import('../../src/lib/analyticsMonths.ts');
const { getAnalyticsEvents } = await import('../../src/lib/analytics.ts');
const redirect = await import('../../src/pages/api/redirect.ts');

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const t = (s) => `2026-11-20T10:00:${String(s).padStart(2, '0')}.000Z`;

test('agentes automáticos: robots, vistas previas, librerías HTTP y vacío SÍ; navegadores reales (también CUBOT o Telegram integrado) NO', () => {
  for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'TelegramBot (like TwitterBot)', 'WhatsApp/2.23.20.0', 'curl/8.4.0', 'node', 'undici', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120.0', 'n8n', '', null])
    assert.equal(esAgenteAutomatico(ua), true, String(ua));
  for (const ua of [CHROME, 'Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/121 Mobile Safari/537.36 Telegram-Android/10.5'])
    assert.equal(esAgenteAutomatico(ua), false, ua);
});

test('tráfico: fuera el panel y la vista duplicada del servidor; ids válidos; repeticiones en 10 s', () => {
  assert.equal(esRutaAdmin('/upayp1b4/director-ia'), true); assert.equal(esRutaAdmin('/producto/x'), false);
  assert.equal(cuentaParaTrafico({ type: 'page_view', source: 'middleware', path: '/producto/x' }), false);
  assert.equal(cuentaParaTrafico({ type: 'page_view', source: 'api', path: '/upayp1b4' }), false);
  assert.equal(cuentaParaTrafico({ type: 'page_view', source: 'api', path: '/producto/x', sessionId: 'abcdefgh1' }), true);
  assert.equal(cuentaParaTrafico({ type: 'outbound_click', source: 'redirect', path: '/ofertas' }), true);
  assert.equal(idAnalitica('0f6b1c2e-1d2a-4c55-9a1b-1234567890ab'), '0f6b1c2e-1d2a-4c55-9a1b-1234567890ab'); assert.equal(idAnalitica('<script>'), undefined); assert.equal(idAnalitica('abc'), undefined);
  const rep = crearDeduplicador(10_000); assert.equal(rep('k', 0), false); assert.equal(rep('k', 900), true); assert.equal(rep('k', 11_000), false);
});

test('métricas con el patrón real: sesiones reales, fuentes reales y conversión = sesiones con clic / sesiones (no 128 %)', () => {
  const ev = [
    // sesión A: llega desde Google, ve la portada y una ficha (la ficha también la registra el servidor sin sesión), y hace clic dos veces
    { type: 'page_view', source: 'api', path: '/', sessionId: 'sesionAAAA', visitorId: 'visitante1', referrer: 'https://www.google.com/', createdAt: t(1) },
    { type: 'page_view', source: 'middleware', path: '/producto/p1', productId: 'p1', createdAt: t(2) },
    { type: 'page_view', source: 'api', path: '/producto/p1', sessionId: 'sesionAAAA', visitorId: 'visitante1', referrer: 'https://treidilor.com/', createdAt: t(2) },
    { type: 'outbound_click', source: 'redirect', productId: 'p1', sessionId: 'sesionAAAA', createdAt: t(3) },
    { type: 'outbound_click', source: 'redirect', productId: 'p2', sessionId: 'sesionAAAA', createdAt: t(4) },
    // sesión B: entra directa y no hace clic
    { type: 'page_view', source: 'api', path: '/catalogo', sessionId: 'sesionBBBB', visitorId: 'visitante2', referrer: '', createdAt: t(5) },
    // rastreador que solo pidió fichas (servidor, sin sesión) y clics antiguos sin sesión
    { type: 'page_view', source: 'middleware', path: '/producto/p2', productId: 'p2', createdAt: t(6) },
    { type: 'page_view', source: 'middleware', path: '/producto/p3', productId: 'p3', createdAt: t(7) },
    { type: 'outbound_click', source: 'redirect', productId: 'p3', createdAt: t(8) },
    // el propietario en el panel
    { type: 'page_view', source: 'api', path: '/upayp1b4/director-ia', sessionId: 'sesionPANEL', visitorId: 'propietario', createdAt: t(9) },
  ];
  const m = computeMetricas(ev);
  assert.equal(m.sesiones, 2, 'solo A y B: ni el panel ni las vistas del servidor');
  assert.equal(m.visitas, 3, 'tres páginas vistas por personas');
  assert.equal(m.salidas, 3, 'los clics de salida se siguen contando todos');
  assert.equal(m.conversionPct, 50, 'una de dos sesiones hizo clic (antes: 3 clics / 4+ «sesiones»)');
  assert.ok(m.conversionPct <= 100, 'una tasa de sesiones nunca supera el 100 %');
  const f = Object.fromEntries(computeFuentes(ev).map((x) => [x.id, x.sesiones]));
  assert.equal(f.organico, 1); assert.equal(f.directo, 1, 'el rastreador sin sesión ya no suma tráfico «directo»');
  assert.deepEqual(computeTopReferrers(ev).map((r) => r.host).sort(), ['(directo)', 'google.com']);
  assert.equal(computeEvolucion(ev).at(-1).visitas, 3);
});

test('/api/redirect: un robot o comprobador NO cuenta (pero se le redirige igual); un navegador SÍ, con la sesión anónima del servidor; el mismo clic repetido en 10 s cuenta una vez', async () => {
  writeCatalog(dir, [{ id: 'amazon-b0prueba01', slug: 'amazon-b0prueba01', title: 'Producto de prueba', price: 10, affiliateUrl: 'https://www.amazon.es/dp/B0PRUEBA01?tag=prueba-21', merchant: 'amazon', category: 'Hogar', status: 'active' }]);
  const llamar = (ua, extra = '') => redirect.GET({ url: new URL(`http://localhost/api/redirect?id=amazon-b0prueba01&src=checkout${extra}`), request: new Request('http://localhost/api/redirect', { headers: { ...(ua ? { 'user-agent': ua } : {}), 'x-forwarded-for': '203.0.113.7' } }) });
  const clics = () => getAnalyticsEvents().filter((e) => e.type === 'outbound_click' && e.productId === 'amazon-b0prueba01');
  const antes = clics().length;
  const r1 = await llamar('Mozilla/5.0 (compatible; Googlebot/2.1)'); assert.equal(r1.status, 302); assert.match(r1.headers.get('location'), /amazon\.es/);
  const r2 = await llamar('node'); assert.equal(r2.status, 302);
  assert.equal(clics().length, antes, 'robots y comprobadores no cuentan');
  const r3 = await llamar(CHROME, '&sid=inyectado1&vid=inyectado2'); assert.equal(r3.status, 302); assert.match(r3.headers.get('location'), /tag=prueba-21/, 'el identificador de afiliado se conserva');
  await llamar(CHROME);
  const ahora = clics(); assert.equal(ahora.length, antes + 1, 'el clic repetido en 10 s cuenta una vez');
  assert.match(ahora.at(-1).sessionId, /^sa_[0-9a-f]{32}$/, 'sesión anónima del servidor'); assert.equal(ahora.at(-1).visitorId, undefined, 'sin identificador de visitante');
  assert.doesNotMatch(JSON.stringify(ahora.at(-1)), /203\.0\.113\.7|inyectado/, 'ni la IP ni identificadores del navegador se guardan');
  void fs;
});
