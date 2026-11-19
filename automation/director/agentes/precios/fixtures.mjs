/**
 * FIXTURES SINTÉTICOS del Agente 05 (precios): ningún precio, comercio ni observación son reales. El catálogo se crea IMPORTANDO registros base con el motor existente
 * (así las fichas tienen la forma real) y después se completan observaciones, historial y lecturas de envío para cada escenario.
 * Escenarios (ids estables): sony (descuento verificado + oferta de Temu SIN verificar), teclado (descuento DECLARADO sin verificar), raton (lectura desactualizada),
 * monitor (salto brusco), auriculares (misma ficha con 2 comercios verificados → ahorro entre comercios), lampara (precio publicado ≠ observado),
 * cargador (observación en USD), tablet (caída verificada y por debajo de su media verificada), libro (sin observaciones).
 */
const dias = (n, ahora) => new Date(ahora - n * 86400000).toISOString();
const horas = (n, ahora) => new Date(ahora - n * 3600000).toISOString();
function ean13(base12) { const d = [...base12].map(Number); const s = d.reduce((a, x, i) => a + x * (i % 2 ? 3 : 1), 0); return `${base12}${(10 - (s % 10)) % 10}`; }
const G = { sony: '400638133393', teclado: '590123412345', auric: '871010396427' };
const reg = (over) => ({ platform: 'amazon', currency: 'EUR', availability: 'in_stock', capturedAt: '2026-11-13T10:00:00Z', image: 'https://img.example.com/x.jpg', ...over });

export function construirCatalogoPrecios(motor, ahora = Date.parse('2026-11-14T12:00:00Z')) {
  const records = [
    reg({ title: 'Auriculares Sony WH-1000XM5 Negro', brand: 'Sony', gtin: `${G.sony}1`, asin: 'B09XS7JWHH', url: 'https://www.amazon.es/dp/B09XS7JWHH', price: 299.99 }),
    reg({ title: 'Sony WH-1000XM5 auriculares inalámbricos', brand: 'Sony', gtin: `${G.sony}1`, platform: 'temu', externalId: '601099512345', sellerName: 'AudioShop', url: 'https://www.temu.com/goods.html?goods_id=601099512345', price: 279.5 }),
    reg({ title: 'Teclado mecánico Keychron K2 inalámbrico', brand: 'Keychron', gtin: ean13(G.teclado), platform: 'ebay', externalId: '305123456789', sellerName: 'TecladosPro', url: 'https://www.ebay.es/itm/305123456789', price: 89.9, condition: 'new' }),
    reg({ title: 'Ratón gaming inalámbrico RGB 16000 DPI', brand: 'Genérico', platform: 'aliexpress', externalId: '1005006123456789', sellerName: 'TechStore Official', url: 'https://es.aliexpress.com/item/1005006123456789.html', price: 14.99 }),
    reg({ title: 'Monitor LED 27 pulgadas QHD', brand: 'Acme', asin: 'B0SALTO001', url: 'https://www.amazon.es/dp/B0SALTO001', price: 120 }),
    reg({ title: 'Auriculares Bluetooth Aurora A5', brand: 'Aurora', gtin: ean13(G.auric), asin: 'B0CROSS001', url: 'https://www.amazon.es/dp/B0CROSS001', price: 59.9, condition: 'new' }),
    reg({ title: 'Auriculares Bluetooth Aurora A5 (eBay)', brand: 'Aurora', gtin: ean13(G.auric), platform: 'ebay', externalId: '305000000001', sellerName: 'SonidoPlus', url: 'https://www.ebay.es/itm/305000000001', price: 52.5, condition: 'new' }),
    reg({ title: 'Lámpara de escritorio LED regulable', brand: 'Lumi', asin: 'B0DESAJUST', url: 'https://www.amazon.es/dp/B0DESAJUST', price: 49.9 }),
    reg({ title: 'Cargador USB-C 65W GaN', brand: 'Volt', asin: 'B0MONEDA01', url: 'https://www.amazon.es/dp/B0MONEDA01', price: 24.9 }),
    reg({ title: 'Tablet 10 pulgadas 128 GB', brand: 'Nova', asin: 'B0MEDIA0001', url: 'https://www.amazon.es/dp/B0MEDIA0001', price: 99 }),
    reg({ title: 'Libro de cocina mediterránea ilustrado', brand: 'Editorial Ejemplo', asin: 'B0SINOBS001', url: 'https://www.amazon.es/dp/B0SINOBS001', price: 18.5 }),
  ];
  const r = motor.engine.runImport([], records, { category: 'Prueba' }, { batchId: 'precios-sinteticos', nowIso: new Date(ahora).toISOString(), deletedIds: new Set() });
  const cat = JSON.parse(JSON.stringify(r.products));
  const por = (re) => cat.find((p) => re.test(p.title));
  const ctx = (moneda = 'EUR') => ({ currency: moneda, destination: 'ES', merchantId: null, variantId: null, condition: 'new', quantity: null, shippingCriterion: 'standard' });
  let corrida = 0;
  const obs = (precio, { original = null, cap, ver, stock = true, moneda = 'EUR', fuente = 'sintetico' }) => { const context = ctx(moneda); return { capturedAt: cap, verifiedAt: ver, price: precio, originalPrice: original, inStock: stock, shippingCost: 0, deliveryMinDays: 1, deliveryMaxDays: 3, context, contextKey: motor.obs.contextKey(context), source: { type: fuente, id: 'fixture' }, runId: `run-${++corrida}` }; };
  const ficha = (p, { precio = p.price, original, historial, observaciones, sync, envio }) => {
    p.price = precio;
    if (original !== undefined) p.originalPrice = original;
    if (historial) p.priceHistory = historial;
    p.extra = { ...(p.extra || {}), ...(observaciones ? { observations: observaciones } : {}) };
    if (sync !== undefined) p.lastPriceSync = sync;
    if (envio) p.extra.priceReading = { capturedAt: sync || dias(1, ahora), receivedAt: sync || dias(1, ahora), shipping: { cost: envio.cost, free: envio.cost === 0, days: envio.days ?? 2, asOf: sync } };
  };
  // sony: descuento verificado y vigente; la oferta de Temu NO está verificada (recibida por JSON)
  ficha(por(/WH-1000XM5 Negro/), { precio: 299.99, original: 349.99, observaciones: [obs(329, { cap: dias(5, ahora), ver: dias(5, ahora) }), obs(299.99, { original: 349.99, cap: horas(6, ahora), ver: horas(6, ahora) })], sync: horas(6, ahora), envio: { cost: 0 } });
  // teclado: «descuento» solo DECLARADO por el comercio (sin ninguna observación)
  ficha(por(/Keychron/), { precio: 89.9, original: 129.9 });
  // ratón: última lectura verificada hace 10 días
  ficha(por(/Ratón gaming/), { precio: 14.99, observaciones: [obs(14.99, { cap: dias(10, ahora), ver: dias(10, ahora) })], sync: dias(10, ahora) });
  // monitor: salto brusco 120 → 45 (-62,5 %)
  ficha(por(/Monitor LED/), { precio: 45, original: 150, observaciones: [obs(120, { cap: dias(3, ahora), ver: dias(3, ahora) }), obs(45, { original: 150, cap: horas(2, ahora), ver: horas(2, ahora) })], sync: horas(2, ahora), envio: { cost: 0 } });
  // auriculares Aurora: dos comercios VERIFICADOS con envío conocido; el de eBay es más barato por total
  const aur = por(/Aurora A5$/);
  ficha(aur, { precio: 59.9, observaciones: [obs(59.9, { cap: horas(5, ahora), ver: horas(5, ahora) })], sync: horas(5, ahora), envio: { cost: 0 } });
  const of = (aur.extra.offers || []).find((o) => o.platform === 'ebay');
  if (of) { of.verifiedAt = horas(4, ahora); of.capturedAt = horas(4, ahora); of.shipping = { cost: 4.5, free: false, days: 3, asOf: horas(4, ahora) }; }
  const eb = cat.find((p) => /Aurora A5 \(eBay\)/.test(p.title));
  if (eb) cat.splice(cat.indexOf(eb), 1);
  // lámpara: la observación (59,90) no coincide con el precio publicado (49,90)
  ficha(por(/Lámpara/), { precio: 49.9, observaciones: [obs(59.9, { cap: horas(8, ahora), ver: horas(8, ahora) })], sync: horas(8, ahora) });
  // cargador: lectura en USD
  ficha(por(/Cargador/), { precio: 24.9, observaciones: [obs(26.9, { cap: horas(7, ahora), ver: horas(7, ahora), moneda: 'USD' })], sync: horas(7, ahora) });
  // tablet: 4 lecturas verificadas ~119 € y ahora 99 € (caída verificada, descuento verificado)
  ficha(por(/Tablet/), { precio: 99, original: 139, observaciones: [obs(120, { cap: dias(40, ahora), ver: dias(40, ahora) }), obs(118, { cap: dias(30, ahora), ver: dias(30, ahora) }), obs(121, { cap: dias(20, ahora), ver: dias(20, ahora) }), obs(119, { cap: dias(10, ahora), ver: dias(10, ahora) }), obs(99, { original: 139, cap: horas(3, ahora), ver: horas(3, ahora) })], sync: horas(3, ahora), envio: { cost: 0 } });
  // libro: sin observaciones (queda como «no verificado»)
  return cat;
}
