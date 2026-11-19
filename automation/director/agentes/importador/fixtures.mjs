/**
 * FIXTURES SINTÉTICOS del Agente 03 (importación). Ningún dato real: títulos, GTIN de prueba, ids y precios ficticios con la forma que admite el motor existente.
 * El catálogo de referencia se construye EJECUTANDO el propio motor sobre registros base (así sus fichas tienen exactamente la forma real).
 */
const GTIN_A = '4006381333931'; // EAN-13 válido de prueba
const GTIN_B = '5901234123457'; // EAN-13 válido de prueba
export const amazon = (over = {}) => ({ title: 'Auriculares Sony WH-1000XM5 Negro', brand: 'Sony', gtin: GTIN_A, image: 'https://img.example.com/sony.jpg', platform: 'amazon', asin: 'B09XS7JWHH', url: 'https://www.amazon.es/dp/B09XS7JWHH?tag=x&th=1', price: 299.99, currency: 'EUR', availability: 'in_stock', capturedAt: '2026-11-10T10:00:00Z', ...over });
export const temu = (over = {}) => ({ title: 'Sony WH-1000XM5 auriculares inalámbricos', brand: 'Sony', gtin: GTIN_A, image: 'https://img.example.com/sony-temu.jpg', platform: 'temu', externalId: '601099512345', sellerName: 'AudioShop', url: 'https://www.temu.com/goods.html?goods_id=601099512345', price: 279.5, currency: 'EUR', availability: 'in_stock', capturedAt: '2026-11-10T10:00:00Z', ...over });
export const ebay = (over = {}) => ({ title: 'Teclado mecánico Keychron K2 inalámbrico', brand: 'Keychron', gtin: GTIN_B, image: 'https://img.example.com/k2.jpg', platform: 'ebay', externalId: '305123456789', sellerName: 'TecladosPro', url: 'https://www.ebay.es/itm/305123456789', price: 89.9, currency: 'EUR', availability: 'in_stock', condition: 'new', capturedAt: '2026-11-10T10:00:00Z', ...over });
export const aliexpress = (over = {}) => ({ title: 'Ratón gaming inalámbrico RGB 16000 DPI', brand: 'Genérico', image: 'https://img.example.com/mouse.jpg', platform: 'aliexpress', externalId: '1005006123456789', sellerName: 'TechStore Official', url: 'https://es.aliexpress.com/item/1005006123456789.html', price: 14.99, currency: 'EUR', availability: 'in_stock', capturedAt: '2026-11-10T10:00:00Z', ...over });

/** Catálogo de referencia: se crea importando 2 registros base con el motor existente (Sony Amazon y teclado eBay). */
export function construirCatalogoSintetico(motor, ahora = Date.parse('2026-11-14T12:00:00Z')) {
  const r = motor.engine.runImport([], [amazon(), ebay()], { category: 'Prueba' }, { batchId: 'base-sintetica', nowIso: new Date(ahora).toISOString(), deletedIds: new Set() });
  return JSON.parse(JSON.stringify(r.products));
}

/** Lote de ejemplo con TODOS los casos: igual, otro comercio (vínculo), nuevo, inválido, y conflicto. */
export const LOTE_EJEMPLO = () => ({
  defaults: { category: 'Prueba' },
  products: [
    amazon(), // ya existe (misma oferta)
    temu(), // mismo GTIN en otro comercio → vínculo entre comercios
    aliexpress(), // producto nuevo
    { title: '', platform: 'temu', url: 'https://www.temu.com/x-g-1.html' }, // inválido
    amazon({ asin: 'B000000000', url: 'https://www.amazon.es/dp/B09XS7JWHH', title: 'Auriculares Sony WH-1000XM5 Negro' }), // id contradice su URL → revisión
  ],
});
