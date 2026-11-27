/**
 * TREIDILOR — DESTINO DE COMPRA CON AFILIADO (27/11/2026). En producción, las 87 fichas de AliExpress tenían como «compra directa» la ficha
 * normal del artículo (sin afiliado) y la redirección se saltaba su enlace de afiliado (s.click); las 12 de eBay salían sin campaña.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EBAY_CAMPAIGN_ID = '5338000001'; process.env.AMAZON_ASSOCIATE_TAG = 'prueba-21';
const { buildPurchaseUrl, hasAffiliateTracking, withEbayCampaign } = await import('../../src/lib/purchaseUrl.ts');

test('AliExpress: compra directa SIN afiliado + enlace de afiliado s.click → sale por el de afiliado', () => {
  assert.equal(buildPurchaseUrl({ affiliateUrl: 'https://s.click.aliexpress.com/s/ABC123', buyNowUrl: 'https://es.aliexpress.com/item/1005006995239298.html?pdp_npi=4' }), 'https://s.click.aliexpress.com/s/ABC123');
});

test('AliExpress: si la compra directa YA lleva afiliado, se respeta', () => {
  const directa = 'https://es.aliexpress.com/item/1005006995239298.html?aff_fcid=x&aff_platform=portals-tool';
  assert.equal(buildPurchaseUrl({ affiliateUrl: 'https://s.click.aliexpress.com/s/ABC123', buyNowUrl: directa }), directa);
});

test('eBay: se añade la campaña configurada (EPN) a la compra directa y al enlace; sin duplicarla', () => {
  const u = new URL(buildPurchaseUrl({ affiliateUrl: 'https://www.ebay.es/itm/167256651525?_skw=x', buyNowUrl: 'https://www.ebay.es/itm/167256651525' }));
  assert.equal(u.searchParams.get('campid'), '5338000001'); assert.equal(u.searchParams.get('mkcid'), '1'); assert.equal(u.searchParams.get('mkrid'), '1185-53479-19255-0'); assert.equal(u.searchParams.get('mkevt'), '1'); assert.equal(u.pathname, '/itm/167256651525');
  const ya = 'https://www.ebay.es/itm/1?campid=999999';
  assert.equal(withEbayCampaign(ya), ya, 'no se cambia una campaña existente');
});

test('Amazon sin cambios: etiqueta añadida, la de la ficha se respeta; otros comercios (Temu) sin tocar', () => {
  assert.equal(buildPurchaseUrl({ affiliateUrl: 'https://www.amazon.es/dp/B0TEST0001' }), 'https://www.amazon.es/dp/B0TEST0001?tag=prueba-21');
  assert.match(buildPurchaseUrl({ affiliateUrl: 'https://www.amazon.es/dp/B0TEST0001?tag=otra-21' }), /tag=otra-21/);
  assert.equal(buildPurchaseUrl({ affiliateUrl: 'https://www.temu.com/es/x-g-601099512345678.html' }), 'https://www.temu.com/es/x-g-601099512345678.html');
});

test('reconoce el seguimiento de afiliado de cada red', () => {
  for (const [u, si] of [['https://www.amazon.es/dp/B0TEST0001?tag=a-21', true], ['https://www.amazon.es/dp/B0TEST0001', false], ['https://s.click.aliexpress.com/s/x', true], ['https://es.aliexpress.com/item/1.html?pdp_npi=4', false], ['https://www.ebay.es/itm/1?campid=123456', true], ['https://www.ebay.es/itm/1', false], ['https://www.temu.com/es/x.html', false]])
    assert.equal(hasAffiliateTracking(u), si, u);
});
