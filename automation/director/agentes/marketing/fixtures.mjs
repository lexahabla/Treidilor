/**
 * FIXTURES SINTÉTICOS del Agente 07 (marketing y SEO): productos, categorías e informes inventados; nada procede de producción. Las categorías son las PREDEFINIDAS del proyecto
 * (`DEFAULT_CATEGORIES`, con sus palabras clave) para que la coincidencia con el calendario comercial sea la real. Fecha de referencia: 15/11/2026 (Black Friday = 27/11/2026).
 * Escenarios de producto: portátil con descuento VERIFICADO; teclado con descuento solo DECLARADO (no cuenta); monitor agotado; ratón sin imagen; auriculares con descuento
 * verificado; altavoz SIN fecha de captura del precio; producto sin precio; un id retirado; y casos SEO (título largo/corto, sin descripción, duplicados, disponibilidad desconocida).
 */
export const AHORA_MK = Date.parse('2026-11-15T09:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const verificada = (precio, anterior, ahora) => ({ observations: [{ price: precio, originalPrice: anterior, verifiedAt: iso(ahora - 6 * 3600000), capturedAt: iso(ahora - 6 * 3600000), context: { currency: 'EUR' } }] });

export function construirFuentesMarketing(motor, ahora = AHORA_MK) {
  const cat = (id) => motor.categories.DEFAULT_CATEGORIES.find((c) => c.id === id);
  const categorias = ['informatica', 'audio-sonido', 'hogar-inteligencia', 'gaming'].map((id) => ({ id, name: cat(id).name, keywords: cat(id).keywords, parentId: null }));
  const base = (o) => ({ currency: 'EUR', inStock: true, network: 'amazon', image: `https://img.example.com/mk/${o.id}.jpg`, description: `Descripción propia y factual de ${o.title}, con datos del producto y su uso habitual en casa.`, ...o });
  const sync = { Sincronizado: iso(ahora - 8 * 3600000) };
  const productos = [
    base({ id: 'inf-portatil', title: 'Portátil 15,6 pulgadas Intel i5 16 GB 512 GB SSD', price: 799, category_id: 'informatica', extra: { ...sync, ...verificada(799, 999, ahora) } }),
    base({ id: 'inf-teclado', title: 'Teclado mecánico inalámbrico compacto', price: 59, originalPrice: 99, category_id: 'informatica', extra: { ...sync } }),
    base({ id: 'inf-monitor', title: 'Monitor 27 pulgadas QHD 144 Hz para escritorio', price: 249, category_id: 'informatica', inStock: false, extra: { ...sync } }),
    base({ id: 'inf-raton', title: 'Ratón ergonómico inalámbrico', price: 29, category_id: 'informatica', image: '', extra: { ...sync } }),
    base({ id: 'aud-auriculares', title: 'Auriculares inalámbricos con cancelación de ruido', price: 89, category_id: 'audio-sonido', extra: { ...sync, ...verificada(89, 105, ahora) } }),
    base({ id: 'aud-altavoz', title: 'Altavoz Bluetooth resistente al agua portátil', price: 45, category_id: 'audio-sonido', extra: {} }),
    base({ id: 'aud-barra', title: 'Barra de sonido compacta', price: 119, category_id: 'audio-sonido', description: '', extra: { ...sync } }),
    base({ id: 'hog-robot', title: 'Robot aspirador inteligente con mapeo y app', price: 199, category_id: 'hogar-inteligencia', inStock: null, extra: { ...sync } }),
    base({ id: 'hog-sin-precio', title: 'Enchufe inteligente WiFi sin precio disponible', price: null, category_id: 'hogar-inteligencia', extra: {} }),
    base({ id: 'gam-retirado', title: 'Mando para consola retirado del catálogo', price: 39, category_id: 'gaming', extra: { ...sync } }),
    base({ id: 'gam-dup-1', title: 'Auriculares gaming con micrófono', price: 49, category_id: 'gaming', description: 'Descripción repetida idéntica para dos fichas distintas del catálogo de pruebas.', extra: { ...sync } }),
    base({ id: 'gam-dup-2', title: 'Auriculares gaming con micrófono', price: 55, category_id: 'gaming', description: 'Descripción repetida idéntica para dos fichas distintas del catálogo de pruebas.', extra: { ...sync } }),
    base({ id: 'gam-titulo-largo', title: 'Silla gaming ergonómica reclinable con reposapiés, soporte lumbar, cojín cervical y reposabrazos 4D ajustables', price: 189, category_id: 'gaming', extra: { ...sync } }),
    base({ id: 'gam-titulo-corto', title: 'Alfombrilla XL', price: 12, category_id: 'gaming', description: 'Corta', extra: { ...sync } }),
  ];
  return { productos, categorias, retiradas: ['gam-retirado'] };
}

/** Informe mínimo del Agente 05 (oportunidades CONFIRMADAS) con ids del fixture; origen de datos de prueba. */
export const informe05Fx = (ids) => ({ esquema: 'informe-agente/1', agente: '05', idEjecucion: 'pr-prueba-mk', fuente: { origenDatos: 'datos_de_prueba' }, hallazgos: ids.map((e, i) => ({ clave: `k${i}`, regla: 'oportunidad_ahorro', certeza: 'confirmado', elemento: e, evidencia: {} })) });
/** Informe mínimo del Agente 10 (señales de producto) con ids del fixture; origen de datos de prueba. */
export const informe10Fx = ({ potencial = [], revisar = [] }) => ({ esquema: 'informe-agente/1', agente: '10', idEjecucion: 'an-prueba-mk', fuente: { origenDatos: 'datos_de_prueba' }, hallazgos: [...potencial.map((e) => ({ clave: `p:${e}`, regla: 'producto_alta_salida_poco_trafico', certeza: 'confirmado', elemento: e, evidencia: {} })), ...revisar.map((e) => ({ clave: `r:${e}`, regla: 'producto_alto_trafico_baja_salida', certeza: 'confirmado', elemento: e, evidencia: {} }))] });
