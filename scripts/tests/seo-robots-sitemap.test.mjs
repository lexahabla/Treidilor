/** TREIDILOR — /robots.txt y /sitemap.xml (antes 404 en producción, comprobado el 27/11/2026). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupIsolatedData, writeCatalog } from './_helpers.mjs';

const dir = setupIsolatedData('treidilor-seo-');
const robots = await import('../../src/pages/robots.txt.ts');
const sitemap = await import('../../src/pages/sitemap.xml.ts');
const site = new URL('https://treidilor.com');

test('robots.txt: permite el sitio público, excluye panel, API y salidas, y declara el sitemap', async () => {
  const r = await robots.GET({ site }); const t = await r.text();
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/plain/);
  for (const linea of ['User-agent: *', 'Allow: /', 'Disallow: /upayp1b4', 'Disallow: /api/', 'Disallow: /checkout/', 'Sitemap: https://treidilor.com/sitemap.xml']) assert.ok(t.includes(linea), linea);
});

test('sitemap.xml: páginas públicas y una URL canónica por ficha del catálogo, XML válido y escapado, sin panel ni API', async () => {
  writeCatalog(dir, [
    { id: 'amazon-b0prueba01', slug: 'amazon-b0prueba01', title: 'Uno', price: 10, affiliateUrl: 'https://www.amazon.es/dp/B0PRUEBA01?tag=x-21', merchant: 'amazon', category: 'Hogar', status: 'active', lastPriceSync: '2026-11-20T10:00:00Z' },
    { id: 'p&2', slug: 'auriculares-x', title: 'Dos', price: 20, affiliateUrl: 'https://example.com/a?b=1&c=2', merchant: 'x', category: 'Sonido', status: 'active' },
  ]);
  const r = await sitemap.GET({ site }); const x = await r.text();
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/xml/);
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.ok(x.includes('<loc>https://treidilor.com/</loc>')); assert.ok(x.includes('<loc>https://treidilor.com/catalogo</loc>'));
  assert.ok(x.includes('<loc>https://treidilor.com/producto/amazon-b0prueba01</loc><lastmod>2026-11-20</lastmod>'));
  assert.ok(x.includes('<loc>https://treidilor.com/producto/auriculares-x</loc>'));
  assert.doesNotMatch(x, /upayp1b4|\/api\/|tag=|[^;]&[^a]/, 'sin panel, sin API, sin enlaces de afiliado y con & escapado');
});
