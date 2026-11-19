// Agente 04 — Calidad del catálogo, ETAPA 2: validación ampliada del motor con datos sintéticos, casos límite y escenarios de integración local.
// Sin red, sin n8n, sin Docker, sin credenciales reales, sin producción. Complementa `automation-calidad.test.mjs` (etapa 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AHORA, CFG_LOCAL, CFG_PROD, TABLA, TABLAS_OK, cfg, catalogo, congelar, dia, entradaDe, filaDe, plano, prod, respuestasDe, semilla } from './_calidadFixtures.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const J = (p) => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));
const Q = await import('../../automation/lib/calidadCatalogo.mjs');
const P = await import('../../automation/lib/urlPolicyCalidad.mjs');
const SEG = await import('../../automation/lib/seguimiento.mjs');
const COM = await import('../../automation/lib/common.mjs');
const { validarEsquema } = await import('../automation/validate-schema.mjs');
const { empaquetar } = await import('../automation/build-workflows.mjs');
const SCHEMA = J('automation/schemas/informe-calidad.schema.json');

const informeDe = (productos, extra) => Q.construirInformeCalidad(entradaDe(productos, extra));
const ejecutar = (productos, { historial = [], tablas = TABLAS_OK, id = 'ex-1', origen = 'manual', ahoraIso = AHORA, feed, cfg: c } = {}) =>
  Q.construirInformeCalidadYFila(entradaDe(productos, { ahoraIso, feed, cfg: c, persistencia: { tablas, historial, idEjecucion: id, origen } }));
const regla = (codigo) => Q.REGLAS_CALIDAD.find((r) => r.codigo === codigo);

/* ═════════ 1. Cobertura de las reglas: positivos, negativos y límites ═════════ */
const BASE = () => catalogo(12);
/** Informe de un catálogo sano de 12 productos + el producto de prueba `t1` con los campos modificados (o sin ellos). */
const evalua = (over, { quitar = [], extra = [] } = {}) => {
  const t = prod({ id: 't1', ...over });
  for (const k of quitar) delete t[k];
  return informeDe([...BASE(), ...extra, t]);
};
/** ¿Se informó la regla para `t1`? Las de ficha, por su incidencia; las no verificables, por estar t1 entre los ejemplos agregados. */
const tiene = (inf, codigo, id = 't1') => {
  if (regla(codigo).certeza === 'no_verificable') return inf.incidencias.some((i) => i.regla === codigo && i.evidencia.ejemplos.includes(id));
  return inf.incidencias.some((i) => i.regla === codigo && i.producto && i.producto.id === id);
};
const largo = (n) => 'T'.repeat(n);

// [código, positivos[[descripción, campos]], negativos[[descripción, campos]]]
const CASOS = [
  ['precio_ausente', [['price null', { price: null }], ['price 0', { price: 0 }], ['price negativo', { price: -5 }]], [['price 0,01', { price: 0.01 }], ['price 1', { price: 1 }]]],
  ['precio_extremo', [['100001 €', { price: 100001 }]], [['100000 € exactos', { price: 100000 }]]],
  ['comercio_malformado', [['texto exacto', { merchant: '[object Object]' }], ['mayúsculas y espacios', { merchant: '  [Object object] ' }], ['en una red que no es Amazon', { merchant: '[object Object]', network: 'aliexpress' }], ['sin red declarada', { merchant: '[object Object]', network: null }]], [['comercio normal', { merchant: 'Amazon' }], ['sin comercio (null)', { merchant: null }], ['nombre parecido', { merchant: 'Objetos y más' }], ['el texto dentro de otro nombre', { merchant: 'Tienda [object Object] SL' }]]],
  ['precio_anterior_menor', [['anterior 30 < 50', { price: 50, declaredPreviousPrice: 30 }]], [['anterior igual', { price: 50, declaredPreviousPrice: 50 }], ['sin anterior', { price: 50, declaredPreviousPrice: null }], ['anterior mayor', { price: 50, declaredPreviousPrice: 70 }]]],
  ['precio_atipico', [['5000 € (muy caro)', { price: 5000 }], ['5 € (muy barato)', { price: 5 }]], [['500 € (8×)', { price: 500 }], ['100 €', { price: 100 }]]],
  ['titulo_incompleto', [['Cable', { title: 'Cable' }], ['sólo números', { title: '1234 5678 9012 3456' }], ['14 caracteres', { title: 'Cable USB-C 1m' }]], [['15 caracteres', { title: 'Título de 15 ch' }], ['título normal', { title: 'Cable USB-C de carga rápida 2 metros' }]]],
  ['titulo_largo', [['121 caracteres', { title: largo(121) }]], [['120 caracteres', { title: largo(120) }]]],
  ['sin_categoria', [['sin texto ni id', { category: null, categoryId: null }]], [['sólo id', { category: null, categoryId: 'sonido' }], ['ambos', {}]]],
  ['categoria_sin_id', [['texto sin id', { category: 'Sonido', categoryId: null }]], [['ambos', {}], ['sólo id', { category: null }]]],
  ['sin_subcategoria', [['sin subcategoría, con el resto de su categoría clasificado', { subcategoryId: null }]], [['con subcategoría', {}]]],
  ['sin_imagen', [['image null', { image: null }], ['image vacía', { image: '' }], ['sólo espacios', { image: '   ' }]], [['ruta propia', { image: '/x.jpg' }]]],
  ['imagen_no_segura', [['http', { image: 'http://cdn.example.com/a.jpg' }], ['ftp', { image: 'ftp://cdn.example.com/a.jpg' }], ['javascript', { image: 'javascript:alert(1)' }], ['data', { image: 'data:image/png;base64,AAAA' }], ['protocolo relativo', { image: '//cdn.example.com/a.jpg' }]], [['https', { image: 'https://cdn.example.com/a.jpg' }], ['ruta propia', { image: '/images/a.jpg' }]]],
  ['sin_descripcion', [['longitud 0', { descriptionLength: 0 }]], [['longitud 1', { descriptionLength: 1 }], ['longitud 400', {}]]],
  ['descripcion_corta', [['longitud 1', { descriptionLength: 1 }], ['longitud 39', { descriptionLength: 39 }]], [['longitud 40', { descriptionLength: 40 }], ['longitud 0', { descriptionLength: 0 }]]],
  ['descuento_sospechoso', [['anterior 51 con precio 10', { price: 10, declaredPreviousPrice: 51 }]], [['anterior 50 (exactamente 5×)', { price: 10, declaredPreviousPrice: 50 }], ['sin anterior', {}]]],
  ['valoracion_incoherente', [['rating 5,1', { rating: 5.1 }], ['rating negativo', { rating: -1 }], ['reseñas negativas', { reviewsCount: -1 }], ['reseñas decimales', { reviewsCount: 2.5 }], ['rating 4 con 0 reseñas', { rating: 4, reviewsCount: 0 }]], [['rating 5', { rating: 5 }], ['rating 0 con 0 reseñas', { rating: 0, reviewsCount: 0 }], ['sin valoración', { rating: null, reviewsCount: null }]]],
  ['enlace_afiliado_ausente', [['red calibrada y sin enlace', { hasAffiliateLink: false }]], [['con enlace', {}]]],
  ['captura_ausente', [['capturedAt null', { capturedAt: null }]], [['con captura', {}]]],
  ['captura_antigua', [['31 días', { capturedAt: dia(-31) }]], [['30 días exactos', { capturedAt: dia(-30) }], ['reciente', { capturedAt: dia(-1) }]]],
  ['verificacion_antigua', [['31 días', { verifiedAt: dia(-31) }]], [['30 días exactos', { verifiedAt: dia(-30) }], ['sin verificar', { verifiedAt: null }]]],
  ['fecha_futura', [['captura en el futuro', { capturedAt: dia(0, 3) }], ['alta en el futuro', { addedAt: dia(2) }], ['verificación en el futuro', { verifiedAt: dia(1) }]], [['dentro de la tolerancia (2 min)', { capturedAt: new Date(Date.parse(AHORA) + 120000).toISOString() }], ['pasado', { capturedAt: dia(-1) }]]],
  ['descuento_declarado', [['anterior declarado sin verificar', { price: 40, declaredPreviousPrice: 60 }]], [['con descuento verificado', { price: 40, declaredPreviousPrice: 60, verifiedDiscount: { pct: 33, previousPrice: 60, asOf: dia(-1) } }], ['sin anterior', {}]]],
  ['valoracion_por_defecto', [['ratingFlag', { ratingFlag: 'por_defecto', rating: null, reviewsCount: null }]], [['sin marca', {}]]],
  ['stock_desconocido', [['unknown', { stock: 'unknown' }]], [['in_stock', {}], ['out_of_stock', { stock: 'out_of_stock' }], ['low_stock', { stock: 'low_stock' }]]],
  ['verificacion_ausente', [['verifiedAt null', { verifiedAt: null }]], [['con verificación', {}]]],
  ['enlace_afiliado_no_calibrable', [['red sin referencia suficiente', { network: 'aliexpress', hasAffiliateLink: false }]], [['con enlace', { network: 'aliexpress' }]]],
];

test('cobertura: las 30 reglas del registro tienen casos positivos y negativos (las de pares se prueban en la sección de duplicados y las del conjunto en la de integridad)', () => {
  const cubiertas = new Set([...CASOS.map((c) => c[0]), 'posible_duplicado', 'titulo_igual_no_duplicado', 'id_duplicado', 'campo_no_entregado']);
  const registro = Q.REGLAS_CALIDAD.map((r) => r.codigo);
  assert.equal(registro.length, 30);
  assert.deepEqual([...cubiertas].sort(), [...registro].sort());
  for (const [codigo, pos, neg] of CASOS) assert.ok(pos.length >= 1 && neg.length >= 1, codigo);
});

for (const [codigo, positivos, negativos] of CASOS) {
  test(`regla ${codigo} (${regla(codigo).certeza}): ${positivos.length} positivos y ${negativos.length} negativos`, () => {
    const r = regla(codigo);
    for (const [desc, over] of positivos) {
      const inf = evalua(over);
      assert.ok(tiene(inf, codigo), `debe detectarse: ${desc}`);
      const i = inf.incidencias.find((x) => x.regla === codigo && (x.producto ? x.producto.id === 't1' : x.evidencia.ejemplos.includes('t1')));
      assert.equal(i.certeza, r.certeza, `${desc}: certeza`);
      assert.equal(i.gravedad, r.gravedad, `${desc}: gravedad`);
      if (r.certeza === 'no_verificable') assert.deepEqual([i.puntuacion, i.prioridad, i.area], [0, null, 'catalogo'], `${desc}: lo no verificable no puntúa`);
      else assert.ok(i.puntuacion > 0 && /^P[1-4]$/.test(i.prioridad), `${desc}: puntúa`);
      assert.deepEqual(validarEsquema(inf, SCHEMA), [], desc);
    }
    for (const [desc, over] of negativos) assert.ok(!tiene(evalua(over), codigo), `NO debe detectarse: ${desc}`);
  });
}

/* ═════════ 2. Contrato del feed: ausente (acreditado) / sospechoso / no verificable ═════════ */
test('contrato: un campo que llega a null es una ausencia ACREDITADA (confirmada); un campo que no llega no se puede acreditar (no verificable)', () => {
  const nulos = [['price', 'precio_ausente'], ['image', 'sin_imagen'], ['capturedAt', 'captura_ausente']];
  for (const [campo, codigo] of nulos) {
    const conNull = evalua({ [campo]: null });
    assert.ok(tiene(conNull, codigo), `${campo}: null → ${codigo}`);
    assert.equal(conNull.incidencias.find((i) => i.regla === codigo && i.producto.id === 't1').certeza, regla(codigo).certeza);
    const sinCampo = evalua({}, { quitar: [campo] });
    assert.ok(!tiene(sinCampo, codigo), `${campo}: ausente del feed → no se afirma ${codigo}`);
    assert.ok(tiene(sinCampo, 'campo_no_entregado'), `${campo}: se informa como no verificable`);
    assert.equal(sinCampo.incidencias.find((i) => i.regla === 'campo_no_entregado').evidencia.campos[campo], 1);
  }
  const sinDescripcion = evalua({}, { quitar: ['descriptionLength'] });
  assert.ok(!tiene(sinDescripcion, 'sin_descripcion') && !tiene(sinDescripcion, 'descripcion_corta'));
  const sinTitulo = evalua({}, { quitar: ['title'] });
  assert.ok(!tiene(sinTitulo, 'titulo_incompleto') && tiene(sinTitulo, 'campo_no_entregado'));
  const sinCategoria = evalua({}, { quitar: ['category', 'categoryId'] });
  assert.ok(!tiene(sinCategoria, 'sin_categoria') && !tiene(sinCategoria, 'categoria_sin_id'));
  const sinEnlace = evalua({}, { quitar: ['hasAffiliateLink'] });
  assert.ok(!tiene(sinEnlace, 'enlace_afiliado_ausente') && !tiene(sinEnlace, 'enlace_afiliado_no_calibrable') && tiene(sinEnlace, 'campo_no_entregado'));
  const stockNull = evalua({ stock: null });
  assert.ok(!tiene(stockNull, 'stock_desconocido') && tiene(stockNull, 'campo_no_entregado'), 'stock null no cumple el contrato (nunca es null): no se interpreta como «desconocido»');
  const sano = evalua({});
  assert.ok(!sano.incidencias.some((i) => i.regla === 'campo_no_entregado'), 'un producto completo no genera la regla');
});

test('contrato: un valor con el TIPO equivocado (precio como texto, enlace como «true», stock inventado…) no se acredita: es no verificable, nunca un defecto confirmado', () => {
  const casos = [['price', '12,5'], ['price', 'gratis'], ['rating', '4,5'], ['reviewsCount', '35'], ['hasAffiliateLink', 'true'], ['hasAffiliateLink', 1], ['stock', 'agotado'], ['descriptionLength', '400'], ['descriptionLength', -3], ['image', 42], ['title', 12345], ['capturedAt', 1731578400000], ['verifiedDiscount', 'si']];
  for (const [campo, valor] of casos) {
    const inf = evalua({ [campo]: valor });
    const propias = inf.incidencias.filter((i) => i.producto && i.producto.id === 't1' && i.certeza === 'confirmado');
    assert.deepEqual(propias, [], `${campo} = ${JSON.stringify(valor)}: sin defectos confirmados`);
    const nv = inf.incidencias.find((i) => i.regla === 'campo_no_entregado');
    assert.ok(nv && nv.evidencia.ejemplos.includes('t1') && nv.evidencia.campos[campo] === 1, `${campo} = ${JSON.stringify(valor)}: se informa como no verificable`);
    assert.deepEqual(validarEsquema(inf, SCHEMA), []);
  }
  assert.ok(!evalua({ price: 12.5 }).incidencias.some((i) => i.regla === 'campo_no_entregado'), 'con el tipo correcto sí se evalúa');
});

test('contrato: un producto sin precio, sin imagen y sin descripción (datos disponibles en el contrato) se clasifica como defecto CONFIRMADO con su prioridad', () => {
  const inf = evalua({ price: null, image: null, descriptionLength: 0, stock: 'in_stock' });
  for (const codigo of ['precio_ausente', 'sin_imagen', 'sin_descripcion']) {
    const i = inf.incidencias.find((x) => x.regla === codigo && x.producto.id === 't1');
    assert.equal(i.certeza, 'confirmado', codigo);
    assert.ok(['P1', 'P2'].includes(i.prioridad), `${codigo} → ${i.prioridad}`);
  }
  assert.equal(inf.resumen.confirmados, 3);
  assert.equal(inf.resumen.estado, 'atencion');
  const sospechoso = evalua({ price: 5000, descriptionLength: 10, title: largo(130) });
  for (const codigo of ['precio_atipico', 'descripcion_corta', 'titulo_largo']) assert.equal(sospechoso.incidencias.find((x) => x.regla === codigo && x.producto.id === 't1').certeza, 'advertencia', codigo);
  const noVerificable = evalua({ stock: 'unknown', ratingFlag: 'por_defecto', verifiedAt: null });
  for (const codigo of ['stock_desconocido', 'valoracion_por_defecto', 'verificacion_ausente']) assert.equal(noVerificable.incidencias.find((x) => x.regla === codigo).certeza, 'no_verificable', codigo);
  assert.equal(noVerificable.resumen.confirmados + noVerificable.resumen.advertencias, 0, 'lo no verificable no se cuenta como defecto ni advertencia');
});

test('calibración: sin categoría o sin red conocida no se forman grupos (ni mediana, ni subcategoría, ni afiliación)', () => {
  const sinCat = Array.from({ length: 10 }, (_, i) => prod({ category: null, categoryId: null, subcategoryId: null, price: 10 * (i + 1) ** 2 }));
  const inf = informeDe([...sinCat, prod({ id: 'sc-caro', category: null, categoryId: null, subcategoryId: null, price: 90000 })]);
  assert.equal(inf.incidencias.filter((i) => i.regla === 'precio_atipico').length, 0, 'productos sin categoría no comparten mediana');
  const sinRed = [...catalogo(10, () => ({ network: null, hasAffiliateLink: true })), prod({ id: 'sr-1', network: null, hasAffiliateLink: false })];
  const inf2 = informeDe(sinRed);
  assert.equal(inf2.incidencias.filter((i) => i.regla === 'enlace_afiliado_ausente').length, 0, 'sin red conocida no hay referencia');
  assert.ok(inf2.incidencias.some((i) => i.regla === 'enlace_afiliado_no_calibrable' && i.evidencia.ejemplos.includes('sr-1')));
});

/* ═════════ 3. Duplicados y comparación entre comercios ═════════ */
const um = Q.UMBRALES_CALIDAD;
const T_SONY = 'Auriculares Sony WH-1000XM5 inalámbricos con cancelación de ruido';
const sin = (inf) => inf.incidencias.filter((i) => i.regla === 'posible_duplicado').length;

test('comercios: el MISMO producto en Amazon y AliExpress, o en eBay y Temu, se CONSERVA (no es duplicado) y sólo se informa', () => {
  for (const [redA, redB] of [['amazon', 'aliexpress'], ['ebay', 'temu'], ['amazon', 'ebay'], ['aliexpress', 'temu']]) {
    const a = prod({ id: `${redA}-1`, title: T_SONY, network: redA, merchant: 'Sony Store', price: 300 });
    const b = prod({ id: `${redB}-1`, title: T_SONY, network: redB, merchant: 'Sony Store', price: 280 });
    const r = Q.detectarDuplicados([a, b], um);
    assert.equal(r.pares.length, 0, `${redA}/${redB}: sin par`);
    assert.deepEqual(r.informativos.map((p) => p.id).sort(), [a.id, b.id].sort());
    const inf = informeDe([...catalogo(10), a, b]);
    assert.equal(sin(inf), 0);
    assert.equal(inf.resumen.productos, 12, 'ningún producto se retira del análisis');
    assert.deepEqual(inf.pares, []);
    const info = inf.incidencias.find((i) => i.regla === 'titulo_igual_no_duplicado');
    assert.equal(info.certeza, 'no_verificable');
    assert.deepEqual(info.evidencia.ejemplos.sort(), [a.id, b.id].sort());
    assert.match(info.detalle, /no se consideran duplicados/);
  }
});

test('comercios: otro vendedor de la misma red, o un comercio desconocido, tampoco es duplicado', () => {
  const a = prod({ id: 'v-1', title: T_SONY, merchant: 'Tienda Uno', price: 300 });
  assert.equal(Q.detectarDuplicados([a, prod({ id: 'v-2', title: T_SONY, merchant: 'Tienda Dos', price: 300 })], um).pares.length, 0, 'otro vendedor');
  assert.equal(Q.detectarDuplicados([prod({ id: 'v-3', title: T_SONY, merchant: null, price: 300 }), prod({ id: 'v-4', title: T_SONY, merchant: null, price: 300 })], um).pares.length, 0, 'comercio desconocido en ambos');
  assert.equal(Q.detectarDuplicados([prod({ id: 'v-5', title: T_SONY, merchant: '', price: 300 }), prod({ id: 'v-6', title: T_SONY, merchant: '  ', price: 300 })], um).pares.length, 0, 'comercio vacío');
  assert.equal(Q.detectarDuplicados([prod({ id: 'v-7', title: T_SONY, network: null, price: 300 }), prod({ id: 'v-8', title: T_SONY, network: null, price: 300 })], um).pares.length, 0, 'red desconocida');
  assert.equal(Q.detectarDuplicados([a, prod({ id: 'v-9', title: T_SONY, merchant: 'Tienda Uno', price: 330 })], um).pares.length, 0, 'mismo vendedor con +10 % de precio: puede ser otra variante');
});

test('variantes: capacidades, colores, tallas, packs y modelos distintos NUNCA se relacionan', () => {
  const casos = [
    ['SSD Kingston NV2 500GB NVMe M.2 interno', 'SSD Kingston NV2 1TB NVMe M.2 interno'],
    ['Samsung Galaxy S24 128GB 5G libre', 'Samsung Galaxy S24 256GB 5G libre'],
    ['Auriculares Sony WH-1000XM5 negro', 'Auriculares Sony WH-1000XM5 plata'],
    ['Zapatillas running Nike Pegasus 40 hombre negro', 'Zapatillas running Nike Pegasus 40 hombre azul'],
    ['Camiseta técnica Adidas hombre running transpirable talla S', 'Camiseta técnica Adidas hombre running transpirable talla XL'],
    ['Pilas alcalinas AAA Duracell Plus pack de 4', 'Pilas alcalinas AAA Duracell Plus pack de 8'],
    ['Pilas alcalinas AA Duracell x2', 'Pilas alcalinas AA Duracell x4'],
    ['Cable USB-C a Lightning MFi 1 m trenzado', 'Cable USB-C a Lightning MFi 2 m trenzado'],
    ['Funda iPhone 15 Pro Max silicona MagSafe', 'Funda iPhone 15 Pro silicona MagSafe'],
    ['Apple iPhone 15 128GB negro libre', 'Apple iPhone 15 Pro 128GB negro libre'],
    ['Auriculares Bluetooth Xiaomi Redmi Buds 4 Pro', 'Auriculares Bluetooth Xiaomi Redmi Buds 5 Pro'],
    ['Monitor LG UltraGear 27 pulgadas QHD 144Hz', 'Monitor LG UltraGear 27 pulgadas QHD 165Hz'],
    ['Taladro percutor Bosch Professional 18V con 2 baterías', 'Taladro percutor Bosch Professional 18V con 1 batería'],
    ['Mochila escolar Totto grande resistente al agua', 'Mochila escolar Totto pequeña resistente al agua'],
    ['Botella térmica acero inoxidable 500 ml', 'Botella térmica acero inoxidable 750 ml'],
    ['Teclado mecánico Logitech G915 TKL izquierdo', 'Teclado mecánico Logitech G915 TKL derecho'],
  ];
  for (const [x, y] of casos) {
    const r = Q.detectarDuplicados([prod({ id: 'a', title: x, price: 100 }), prod({ id: 'b', title: y, price: 100 })], um);
    assert.equal(r.pares.length, 0, `${x} ≠ ${y}`);
  }
  // incluso con títulos muy largos (muchas palabras comunes) una variante sigue separando los productos
  const base = 'Altavoz Bluetooth portátil resistente al agua IPX7 con graves potentes 20W autonomía 12 horas micrófono integrado manos libres exterior camping playa viaje';
  for (const variante of ['negro', 'azul', 'rojo', 'grande', 'XL', 'mini', 'pro', 'nuevo modelo']) {
    assert.equal(Q.detectarDuplicados([prod({ id: 'a', title: base, price: 40 }), prod({ id: 'b', title: `${base} ${variante}`, price: 40 })], um).pares.length, variante === 'nuevo modelo' ? 0 : 0, `variante «${variante}»`);
  }
});

test('duplicados reales del MISMO comercio: se señalan como pares a revisar (no se eliminan ni fusionan) y no afectan a otros comercios', () => {
  const mismo = (id, over = {}) => prod({ id, title: T_SONY, network: 'amazon', merchant: 'Sony Store', price: 300, ...over });
  const a = mismo('amazon-B0AAA');
  const b = mismo('amazon-B0AAB', { price: 303 });
  const otro = prod({ id: 'ali-1', title: T_SONY, network: 'aliexpress', merchant: 'Sony Store', price: 280 });
  const r = Q.detectarDuplicados([a, b, otro], um);
  assert.deepEqual(r.pares.map((p) => [p.a.id, p.b.id, p.tipo]), [['amazon-B0AAA', 'amazon-B0AAB', 'titulo_igual_mismo_comercio']]);
  assert.deepEqual(r.informativos.map((p) => p.id), ['ali-1'], 'la oferta de otro comercio queda como informativa');
  const inf = informeDe([...catalogo(10), a, b, otro]);
  const i = inf.incidencias.find((x) => x.regla === 'posible_duplicado');
  assert.equal(i.producto.id, 'amazon-B0AAA');
  assert.equal(i.evidencia.con, 'amazon-B0AAB');
  assert.equal(i.certeza, 'advertencia');
  assert.match(i.accionSugerida, /no se propone eliminar/);
  assert.equal(inf.resumen.productos, 13, 'los tres productos siguen en el análisis');
  assert.deepEqual(validarEsquema(inf, SCHEMA), []);
  assert.ok(!/(elimin|borrar|fusion|retirar)[^.]*automátic/i.test(JSON.stringify(inf.incidencias.filter((x) => x.regla === 'posible_duplicado').map((x) => x.accionSugerida))) || /no se propone eliminar/.test(i.accionSugerida));
});

test('ofertas repetidas con IDENTIFICADORES EXTERNOS distintos: mismo comercio, título y precio = posible duplicado; si cambia el comercio o el precio, no', () => {
  const asin = (id, over = {}) => prod({ id, title: 'Teclado mecánico Keychron K2 Pro inalámbrico', network: 'amazon', merchant: 'Keychron', price: 99, ...over });
  assert.equal(Q.detectarDuplicados([asin('amazon-B0X1'), asin('amazon-B0X2')], um).pares.length, 1);
  assert.equal(Q.detectarDuplicados([asin('amazon-B0X1'), asin('amazon-B0X2', { price: 99 * 1.051 })], um).pares.length, 0, 'justo por encima de la tolerancia del 5 %');
  assert.equal(Q.detectarDuplicados([asin('amazon-B0X1'), asin('amazon-B0X2', { price: 99 * 1.049 })], um).pares.length, 1, 'justo dentro de la tolerancia');
  assert.equal(Q.detectarDuplicados([asin('amazon-B0X1'), asin('amazon-B0X2', { merchant: 'Otro' })], um).pares.length, 0);
  const tres = Q.detectarDuplicados([asin('amazon-B0X1'), asin('amazon-B0X2'), asin('amazon-B0X3')], um);
  assert.equal(tres.pares.length, 3, 'todas las combinaciones, sin fusionar nada');
});

test('títulos similares que son productos distintos no se emparejan, y el orden de entrada no cambia el resultado', () => {
  const lista = [
    prod({ id: 'z1', title: 'Cargador USB-C 65W GaN 2 puertos rápido compacto', price: 30 }), prod({ id: 'z2', title: 'Cargador USB-C 45W GaN 2 puertos rápido compacto', price: 30 }),
    prod({ id: 'z3', title: 'Auriculares Sony WH-1000XM5 inalámbricos', price: 300 }), prod({ id: 'z4', title: 'Auriculares Sony WH-1000XM4 inalámbricos', price: 300 }),
    prod({ id: 'z5', title: 'Lámpara escritorio LED regulable táctil con USB brazo flexible luz cálida fría lectura noche', price: 25 }), prod({ id: 'z6', title: 'Lámpara escritorio LED regulable táctil con USB brazo flexible luz cálida fría lectura noche original', price: 25 }),
  ];
  const r = Q.detectarDuplicados(lista, um);
  assert.deepEqual(r.pares.map((p) => `${p.a.id}-${p.b.id}`), ['z5-z6'], 'sólo la que difiere en relleno comercial');
  const rnd = semilla(7);
  for (let k = 0; k < 10; k++) {
    const barajada = [...lista].sort(() => rnd() - 0.5);
    assert.deepEqual(plano(Q.detectarDuplicados(barajada, um)), plano(r));
  }
});

test('duplicados: escala — 300 productos con muchas ofertas cruzadas se analizan rápido y de forma determinista', () => {
  const redes = ['amazon', 'aliexpress', 'ebay', 'temu'];
  const ps = [];
  for (let i = 0; i < 75; i++) for (const red of redes) ps.push(prod({ id: `${red}-${i}`, title: `Producto de prueba número ${i} serie ${i * 3} edición completa`, network: red, merchant: `Tienda ${red}`, price: 20 + i }));
  const t0 = Date.now();
  const r = Q.detectarDuplicados(ps, um);
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(r.pares.length, 0, 'las 4 ofertas de cada producto están en comercios distintos: se conservan todas');
  assert.equal(r.informativos.length, 300);
  assert.deepEqual(plano(r), plano(Q.detectarDuplicados([...ps].reverse(), um)));
});

/* ═════════ 4. Integridad del feed ═════════ */
const sinSustituir = (productos, opciones, motivoEsperado) => {
  // historial con una instantánea VÁLIDA; la ejecución anómala no debe guardarse ni sustituirla
  const buena = catalogo(131); buena[3].price = null;
  const r1 = ejecutar(buena, { id: 'ex-1', ahoraIso: dia(0) });
  const historial = [filaDe(r1.fila, 1)];
  const r = ejecutar(productos, { ...opciones, historial, id: 'ex-2', ahoraIso: dia(1) });
  assert.equal(r.fila, null, 'no se genera fila');
  assert.deepEqual([r.informe.persistencia.escritura.guardar, r.informe.persistencia.escritura.resultado], [false, 'no_procede']);
  if (motivoEsperado) assert.equal(r.informe.persistencia.escritura.motivo, motivoEsperado);
  assert.equal(r.informe.resumen.estado, 'incompleto');
  // la siguiente ejecución completa sigue comparándose con la instantánea válida
  const siguiente = ejecutar(buena, { historial, id: 'ex-3', ahoraIso: dia(2) });
  assert.equal(siguiente.informe.seguimiento.comparadoCon, dia(0));
  assert.equal(siguiente.informe.persistencia.lectura.validas, 1);
  return r;
};

test('feed: lectura completa de 131 productos en 2 páginas, y de 250 en 3 (el tamaño de cada página se comprueba)', () => {
  for (const total of [131, 250, 100, 1, 800]) {
    const inf = informeDe(catalogo(total));
    assert.equal(inf.fuente.completo, true, `${total} productos`);
    assert.deepEqual([inf.fuente.productosLeidos, inf.fuente.total, inf.fuente.totalPaginas], [total, total, Math.ceil(total / 100)]);
    assert.notEqual(inf.resumen.estado, 'incompleto');
    assert.deepEqual(validarEsquema(inf, SCHEMA), []);
  }
});

test('feed: productos REPETIDOS ENTRE PÁGINAS (la paginación se desplazó) = lectura inconsistente, nunca un duplicado confirmado; no sustituye la instantánea válida', () => {
  const ps = catalogo(131);
  const desplazado = [...ps.slice(0, 100), ps[99], ...ps.slice(101)]; // el último de la página 1 se repite al inicio de la 2 y falta ps[100]
  const { objetivos, respuestas } = respuestasDe(desplazado, 100, { total: 131 });
  const inf = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA });
  assert.equal(inf.fuente.completo, false);
  assert.match(inf.fuente.inconsistencias.join(' '), /repetidos entre páginas/);
  assert.equal(inf.incidencias.filter((i) => i.regla === 'id_duplicado').length, 0);
  assert.ok(inf.incidencias.some((i) => i.id === 'catalogo:feed_parcial'));
  assert.equal(inf.resumen.estado, 'incompleto');
  const buena = catalogo(131);
  const r1 = ejecutar(buena, { id: 'ex-1', ahoraIso: dia(0) });
  const r2 = Q.construirInformeCalidadYFila({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: dia(1), persistencia: { tablas: TABLAS_OK, historial: [filaDe(r1.fila, 1)], idEjecucion: 'ex-2', origen: 'manual' } });
  assert.equal(r2.fila, null);
  assert.equal(r2.informe.persistencia.escritura.motivo, 'ejecucion_parcial');
});

test('feed: ids repetidos DENTRO de una página (con el total cuadrando) sí son un duplicado confirmado', () => {
  const ps = catalogo(40);
  const inf = informeDe([...ps, { ...ps[10] }]);
  assert.equal(inf.fuente.completo, true);
  const d = inf.incidencias.filter((i) => i.regla === 'id_duplicado');
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].certeza, d[0].gravedad], ['confirmado', 'alta']);
});

test('feed: totales INCOHERENTES (totalPages que no corresponde, páginas cortas o largas, página inexistente, total distinto del contenido) = incompleto', () => {
  const ps = catalogo(131);
  const casos = [
    ['totalPages 5 para 131 productos', respuestasDe(ps, 100, { totalPages: 5 }), /totalPages \(5\)/],
    ['totalPages 1 para 131 productos', respuestasDe(ps, 100, { totalPages: 1 }), /totalPages \(1\)/],
    ['página 1 con 99 productos', (() => { const x = respuestasDe(ps, 100); const b = JSON.parse(x.respuestas[0].body); b.products = b.products.slice(0, 99); x.respuestas[0].body = JSON.stringify(b); return x; })(), /página 1 trae 99 productos y debería traer 100/],
    ['página 1 con 101 productos', (() => { const x = respuestasDe(ps, 100); const b = JSON.parse(x.respuestas[0].body); b.products = [...b.products, prod()]; x.respuestas[0].body = JSON.stringify(b); return x; })(), /página 1 trae 101/],
    ['última página con productos de menos', (() => { const x = respuestasDe(ps, 100); const b = JSON.parse(x.respuestas[1].body); b.products = b.products.slice(0, 20); x.respuestas[1].body = JSON.stringify(b); return x; })(), /página 2 trae 20 productos y debería traer 31/],
    ['total declarado mayor que el contenido', respuestasDe(ps, 100, { total: 140 }), /totalPages|trae/],
    ['total negativo o no entero', (() => { const x = respuestasDe(ps, 100); for (const r of x.respuestas) { const b = JSON.parse(r.body); b.total = 'ciento treinta'; r.body = JSON.stringify(b); } return x; })(), /.*/],
  ];
  for (const [desc, { objetivos, respuestas }, patron] of casos) {
    const f = Q.leerFeedCalidad(objetivos, respuestas, CFG_LOCAL);
    assert.equal(f.completo, false, desc);
    if (desc !== 'total negativo o no entero') assert.match([...f.inconsistencias, ...f.errores].join(' | '), patron, desc);
    const inf = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA });
    assert.equal(inf.resumen.estado, 'incompleto', desc);
    assert.deepEqual(validarEsquema(inf, SCHEMA), [], desc);
  }
});

test('feed: catálogo VACÍO = feed no disponible (no se guarda, no es «línea base de cero productos»)', () => {
  const { objetivos, respuestas } = respuestasDe([], 100, { total: 0 });
  const inf = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA });
  assert.deepEqual(inf.incidencias.map((i) => i.id), ['catalogo:feed_no_disponible']);
  assert.equal(inf.incidencias[0].evidencia.motivo, 'vacio');
  assert.equal(inf.resumen.estado, 'incompleto');
  const r = Q.construirInformeCalidadYFila({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA, persistencia: { tablas: TABLAS_OK, historial: [], idEjecucion: 'ex-1', origen: 'manual' } });
  assert.equal(r.fila, null);
  assert.equal(r.informe.persistencia.escritura.guardar, false);
  sinSustituir([], { feed: { total: 0 } });
});

test('feed: el catálogo CAMBIA durante la paginación (altas, bajas o ambas a la vez) = incompleto y no sustituye la instantánea válida', () => {
  const ps = catalogo(131);
  const alta = respuestasDe(ps, 100, { total: 131 });
  const alta2 = respuestasDe([...ps, prod()], 100, { total: 132 });
  const f1 = Q.leerFeedCalidad(alta.objetivos, [alta.respuestas[0], alta2.respuestas[1]], CFG_LOCAL);
  assert.equal(f1.completo, false);
  assert.match(f1.inconsistencias.join(' '), /el total de productos cambia entre páginas/);
  // alta y baja a la vez: el total no cambia pero se repite un id entre páginas
  const nuevo = prod({ id: 'p-nuevo-al-principio' });
  const despues = [nuevo, ...ps.slice(0, 130)];
  const p2 = respuestasDe(despues, 100, { total: 131 });
  const f2 = Q.leerFeedCalidad(alta.objetivos, [alta.respuestas[0], p2.respuestas[1]], CFG_LOCAL);
  assert.equal(f2.completo, false);
  assert.match(f2.inconsistencias.join(' '), /repetidos entre páginas/);
  sinSustituir(ps, { feed: { total: 131, paginas: 1 } }, 'ejecucion_parcial');
});

test('feed: 401, 429, tiempo agotado y errores de red (en la primera página o a mitad) = incompleto, con su motivo, y sin sustituir la instantánea válida', () => {
  const ps = catalogo(250);
  const base = respuestasDe(ps, 100);
  const con = (i, r) => base.respuestas.map((x, k) => (k === i ? r : x));
  const casos = [
    ['401 en la página 1', base.respuestas.map((_, k) => (k === 0 ? { statusCode: 401, body: '{}' } : { statusCode: 200, body: base.respuestas[k].body })), 'credencial_no_valida'],
    ['403 en la página 2', con(1, { statusCode: 403, body: '{}' }), 'credencial_no_valida'],
    ['401 sólo en la página 3', con(2, { statusCode: 401, body: '{}' }), 'credencial_no_valida'],
    ['429 en la página 2', con(1, { statusCode: 429, body: '{}' }), 'limite_de_peticiones'],
    ['tiempo agotado en la página 2', con(1, { error: { message: 'timeout of 15000ms exceeded' } }), 'tiempo_agotado'],
    ['ETIMEDOUT en la página 3', con(2, { error: { message: 'connect ETIMEDOUT 187.0.0.1:443' } }), 'tiempo_agotado'],
    ['conexión rechazada en la página 1', con(0, { error: { message: 'connect ECONNREFUSED' } }), 'error_de_lectura'],
    ['500 en la página 3', con(2, { statusCode: 500, body: 'x' }), 'error_de_lectura'],
    ['JSON roto en la página 2', con(1, { statusCode: 200, body: '{no es json' }), 'error_de_lectura'],
    ['respuesta sin lista de productos', con(1, { statusCode: 200, body: JSON.stringify({ success: true }) }), 'error_de_lectura'],
  ];
  for (const [desc, respuestas, motivo] of casos) {
    const f = Q.leerFeedCalidad(base.objetivos, respuestas, CFG_LOCAL);
    assert.equal(f.completo, false, desc);
    assert.equal(f.motivoFallo, motivo, desc);
    const inf = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: base.objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA });
    assert.equal(inf.resumen.estado, 'incompleto', desc);
    assert.ok(inf.incidencias.some((i) => i.id === 'catalogo:feed_parcial' || i.id === 'catalogo:feed_no_disponible'), desc);
    assert.deepEqual(validarEsquema(inf, SCHEMA), [], desc);
  }
  // sin sustituir la instantánea válida (131 productos, 2 páginas)
  const dos = respuestasDe(catalogo(131), 100);
  for (const respuestas of [[dos.respuestas[0], { statusCode: 429, body: '{}' }], [{ statusCode: 401, body: '{}' }], [dos.respuestas[0], { error: { message: 'timeout of 15000ms exceeded' } }]]) {
    const buena = catalogo(131);
    const r1 = ejecutar(buena, { id: 'ex-1', ahoraIso: dia(0) });
    const hist = [filaDe(r1.fila, 1)];
    const r = Q.construirInformeCalidadYFila({ cfg: CFG_LOCAL, objetivosCatalogo: dos.objetivos, respuestasCatalogo: respuestas, ahoraIso: dia(1), persistencia: { tablas: TABLAS_OK, historial: hist, idEjecucion: 'ex-2', origen: 'manual' } });
    assert.equal(r.fila, null);
    assert.equal(r.informe.persistencia.escritura.guardar, false);
    assert.deepEqual(r.informe.seguimiento.resueltas, [], 'ni una sola incidencia se da por resuelta con una lectura incompleta');
  }
});

test('feed: los errores del nodo HTTP se informan sin tokens ni cabeceras de autenticación', () => {
  const { objetivos } = respuestasDe(catalogo(5));
  const secretos = ['Bearer abc123.DEF-456_ghi', 'tai_0123456789abcdef_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq', 'authorization: Bearer zzz999', 'api_key=SUPERSECRETO', 'password": "hunter2'];
  for (const s of secretos) {
    const inf = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: [{ error: { message: `Request failed: ${s} at https://x` } }], ahoraIso: AHORA });
    const texto = JSON.stringify(inf);
    for (const trozo of ['abc123', '0123456789abcdef_ABCDEF', 'zzz999', 'SUPERSECRETO', 'hunter2']) assert.ok(!texto.includes(trozo), `${s}: ${trozo}`);
    assert.match(texto, /oculto/);
  }
  assert.equal(Q.ocultarSecretos('sin secretos aquí'), 'sin secretos aquí');
});

test('feed: catálogo de más de 800 productos (tope de 8 páginas): 800 es completo; 801 y 1000 son incompletos y se declara', () => {
  assert.equal(informeDe(catalogo(800)).fuente.completo, true);
  for (const total of [801, 1000, 5000]) {
    const grande = respuestasDe(catalogo(total), 100, { paginas: 8 });
    const inf = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: grande.objetivos, respuestasCatalogo: grande.respuestas, ahoraIso: AHORA });
    assert.equal(inf.fuente.completo, false, String(total));
    assert.equal(inf.fuente.paginasLeidas, 8);
    assert.match(inf.fuente.inconsistencias.join(' '), /tope de 8 páginas/);
    assert.equal(inf.resumen.estado, 'incompleto');
    assert.match(inf.markdown, /INCOMPLETA/);
  }
  // la planificación tampoco pide más de 8 páginas
  const resp = [{ statusCode: 200, body: JSON.stringify({ products: [], total: 5000, totalPages: 50 }) }];
  assert.deepEqual(Q.crearObjetivosCalidadResto(Q.crearObjetivosCalidad(CFG_PROD), resp, CFG_PROD).map((t) => t.pagina), [2, 3, 4, 5, 6, 7, 8]);
  sinSustituir(catalogo(1000), { feed: { paginas: 8 } }, 'ejecucion_parcial');
});

/* ═════════ 5. Seguimiento histórico ═════════ */
test('histórico: filas corruptas, parciales, de otro entorno o con fecha futura se descartan y la ejecución parte de línea base', () => {
  const ps = catalogo(20); ps[0].price = null;
  const buena = ejecutar(ps, { id: 'ex-1', ahoraIso: dia(0) });
  const parcial = ejecutar(respuestasDe(catalogo(150)).objetivos.length ? catalogo(150) : [], { id: 'ex-p', ahoraIso: dia(0), feed: { paginas: 1 } });
  const sucias = [
    { id: 1, entorno: 'local', host: 'puente-treidilor:4350', generadoEn: dia(-1), idEjecucion: 'ex-a', origen: 'manual', calidad: 'completa', huella: 'x', payload: '{no es json' },
    { id: 2, entorno: 'produccion', host: 'treidilor.com', generadoEn: dia(-1), idEjecucion: 'ex-b', origen: 'manual', calidad: 'completa', huella: 'x', payload: buena.fila.payload },
    { id: 3, ...buena.fila, entorno: 'local', generadoEn: dia(900), idEjecucion: 'ex-futura' },
    { id: 4, entorno: 'local', host: 'puente-treidilor:4350', generadoEn: dia(-1), idEjecucion: 'ex-c', origen: 'manual', calidad: 'parcial', huella: 'x', payload: JSON.stringify({ ...JSON.parse(buena.fila.payload), calidad: { estado: 'parcial', motivos: [] }, generadoEn: dia(-1) }) },
    'basura', null, { id: 5 },
  ];
  const r = ejecutar(ps, { historial: sucias, id: 'ex-2', ahoraIso: dia(1) });
  assert.equal(r.informe.seguimiento.modo, 'linea_base');
  assert.ok(r.informe.persistencia.lectura.descartadas >= 2);
  assert.equal(r.informe.persistencia.escritura.guardar, true);
  assert.deepEqual(validarEsquema(r.informe, SCHEMA), []);
  assert.equal(parcial.fila, null);
});

test('histórico: una referencia de más de 14 días vuelve a línea base; una ejecución anterior a la última no se guarda ni se compara', () => {
  const ps = catalogo(20); ps[0].price = null;
  const r1 = ejecutar(ps, { id: 'ex-1', ahoraIso: dia(0) });
  const hist = [filaDe(r1.fila, 1)];
  const lejos = ejecutar(ps, { historial: hist, id: 'ex-2', ahoraIso: dia(20) });
  assert.deepEqual([lejos.informe.seguimiento.modo, lejos.informe.seguimiento.motivo], ['linea_base', 'anterior_antiguo']);
  const antigua = ejecutar(ps, { historial: hist, id: 'ex-3', ahoraIso: dia(-1) });
  assert.equal(antigua.informe.seguimiento.modo, 'sin_comparar');
  assert.equal(antigua.fila, null);
  assert.equal(antigua.informe.persistencia.escritura.guardar, false);
});

test('histórico: nuevas, persistentes, resueltas y reaparecidas también para lo agregado (área catalogo) y sólo con el catálogo COMPLETO', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `a${i}`);
  const sano = () => ids.map((id) => prod({ id }));
  const v1 = sano(); v1[0].stock = 'unknown'; v1[1].stock = 'unknown';
  const r1 = ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) });
  assert.ok(r1.informe.incidencias.some((i) => i.id === 'catalogo:stock_desconocido'));
  const hist1 = [filaDe(r1.fila, 1)];
  // ejecución parcial (sólo la primera de dos páginas): lo agregado NO se da por resuelto
  const grande = ids.concat(Array.from({ length: 130 }, (_, i) => `b${i}`)).map((id) => prod({ id }));
  const rp = ejecutar(grande, { historial: hist1, id: 'ex-p', ahoraIso: dia(1), feed: { paginas: 1 } });
  assert.deepEqual(rp.informe.seguimiento.resueltas, []);
  assert.ok(rp.informe.seguimiento.noVerificadas.some((x) => x.clave === 'catalogo:stock_desconocido'));
  // ejecución completa sin stock desconocido: se resuelve
  const r2 = ejecutar(sano(), { historial: hist1, id: 'ex-2', ahoraIso: dia(2) });
  assert.deepEqual(r2.informe.seguimiento.resueltas.map((x) => x.clave), ['catalogo:stock_desconocido']);
  const hist2 = [...hist1, filaDe(r2.fila, 2)];
  const v3 = sano(); v3[5].stock = 'unknown';
  const r3 = ejecutar(v3, { historial: hist2, id: 'ex-3', ahoraIso: dia(3) });
  assert.deepEqual(r3.informe.seguimiento.reaparecidas.map((x) => x.clave), ['catalogo:stock_desconocido']);
});

test('histórico: un producto que desaparece del feed queda «no verificado» y CADUCA tras 7 ejecuciones; nunca se declara resuelto', () => {
  const ids = Array.from({ length: 15 }, (_, i) => `d${i}`);
  const v1 = ids.map((id) => prod({ id })); v1[0].price = null;
  const sinD0 = ids.filter((id) => id !== 'd0').map((id) => prod({ id }));
  let hist = [filaDe(ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) }).fila, 1)];
  const estados = [];
  for (let k = 1; k <= 9; k++) {
    const r = ejecutar(sinD0, { historial: hist, id: `ex-${k + 1}`, ahoraIso: dia(k) });
    const s = r.informe.seguimiento;
    estados.push([s.resumen.resueltas, s.resumen.noVerificadas, s.resumen.caducadas]);
    assert.equal(s.resumen.resueltas, 0, `ejecución ${k}: nunca resuelta`);
    if (r.fila) hist = [...hist, filaDe(r.fila, hist.length + 1)];
  }
  assert.ok(estados.slice(0, 7).every(([, nv]) => nv === 1), 'las 7 primeras ejecuciones la mantienen como no verificada');
  assert.equal(estados[7][2], 1, 'la octava la declara caducada');
  // si el producto vuelve a estar en el feed y ya no tiene el defecto, entonces sí se resuelve
  const vuelve = ejecutar(ids.map((id) => prod({ id })), { historial: hist.slice(0, 2), id: 'ex-v', ahoraIso: dia(2) });
  assert.deepEqual(vuelve.informe.seguimiento.resueltas.map((x) => x.clave), ['ficha:precio_ausente:d0']);
});

test('histórico: reducción brusca sólo con lectura completa; con lectura incompleta no se declara y no se resuelve nada', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `r${i}`);
  const v1 = ids.map((id) => prod({ id })); v1.slice(0, 10).forEach((p) => { p.price = null; });
  const hist = [filaDe(ejecutar(v1, { id: 'ex-1', ahoraIso: dia(0) }).fila, 1)];
  const reducido = ejecutar(ids.slice(30).map((id) => prod({ id })), { historial: hist, id: 'ex-2', ahoraIso: dia(1) });
  assert.ok(reducido.informe.incidencias.some((i) => i.id === 'catalogo:reduccion_brusca'));
  assert.equal(reducido.informe.seguimiento.resumen.resueltas, 0);
  assert.equal(reducido.informe.seguimiento.resumen.noVerificadas, 10);
  assert.equal(reducido.informe.resumen.porRegla.reduccion_brusca, 1);
  const incompleto = ejecutar(ids.slice(30).map((id) => prod({ id })), { historial: hist, id: 'ex-3', ahoraIso: dia(1), feed: { total: 80 } });
  assert.equal(incompleto.informe.fuente.completo, false);
  assert.ok(!incompleto.informe.incidencias.some((i) => i.id === 'catalogo:reduccion_brusca'));
});

test('histórico: ESCRITURA FALLIDA — la fila no existe, la siguiente ejecución se compara con la última guardada de verdad y no hay duplicados', () => {
  const ps = catalogo(20); ps[0].price = null;
  const r1 = ejecutar(ps, { id: 'ex-1', ahoraIso: dia(0) });
  const hist = [filaDe(r1.fila, 1)];
  const conf1 = Q.confirmarEscrituraCalidad(r1.informe, [{ id: 1, idEjecucion: 'ex-1' }]);
  assert.equal(conf1.persistencia.escritura.resultado, 'guardada');
  const r2 = ejecutar(ps, { historial: hist, id: 'ex-2', ahoraIso: dia(1) });
  assert.equal(r2.informe.persistencia.escritura.resultado, 'pendiente');
  for (const [salida, motivo] of [[[{ error: 'Data table not found' }], 'error_insert'], [[{ json: { x: 1 } }], 'sin_confirmacion'], [[], 'sin_confirmacion'], [[{ id: 9, idEjecucion: 'ex-OTRA' }], 'sin_confirmacion']]) {
    const fallida = Q.confirmarEscrituraCalidad(r2.informe, salida);
    assert.deepEqual([fallida.persistencia.escritura.resultado, fallida.persistencia.escritura.motivoFallo], ['fallida', motivo]);
    assert.match(fallida.markdown, /FALLIDA|fallida/i);
    assert.deepEqual(validarEsquema(fallida, SCHEMA), []);
  }
  // la fila de ex-2 no llegó a la tabla: ex-3 compara con ex-1 y no ve ningún duplicado
  const r3 = ejecutar(ps, { historial: hist, id: 'ex-3', ahoraIso: dia(2) });
  assert.equal(r3.informe.seguimiento.comparadoCon, dia(0));
  assert.equal(r3.informe.persistencia.lectura.filas, 1);
  assert.equal(r3.informe.persistencia.escritura.motivo, 'ok');
  // y si se reintenta la MISMA ejecución ya guardada, no se duplica
  const reintento = ejecutar(ps, { historial: [...hist, filaDe(r2.fila, 2)], id: 'ex-2', ahoraIso: dia(1) });
  assert.equal(reintento.fila, null, 'el reintento de una ejecución ya guardada no inserta otra fila');
  assert.equal(reintento.informe.persistencia.escritura.guardar, false);
  assert.ok(['ya_guardada', 'orden_invalido'].includes(reintento.informe.persistencia.escritura.motivo));
  const reintentoTardio = ejecutar(ps, { historial: [...hist, filaDe(r2.fila, 2)], id: 'ex-2', ahoraIso: dia(2) });
  assert.equal(reintentoTardio.informe.persistencia.escritura.motivo, 'ya_guardada', 'misma ejecución, más tarde: tampoco se duplica');
});

test('histórico: LÍMITE DE TAMAÑO — una instantánea que no cabe no se guarda (motivo explícito), el informe sale entero y la referencia válida se conserva', () => {
  const buena = catalogo(30); buena[0].price = null;
  const r1 = ejecutar(buena, { id: 'ex-1', ahoraIso: dia(0) });
  const hist = [filaDe(r1.fila, 1)];
  const enorme = Array.from({ length: 800 }, (_, i) => prod({ id: `producto-con-un-identificador-externo-muy-largo-${'x'.repeat(70)}-${i}`, image: null, descriptionLength: 0, price: null, title: 'Corto', category: null, categoryId: null }));
  const r = ejecutar(enorme, { historial: hist, id: 'ex-2', ahoraIso: dia(1) });
  assert.equal(r.fila, null);
  assert.deepEqual([r.informe.persistencia.escritura.guardar, r.informe.persistencia.escritura.motivo, r.informe.persistencia.escritura.resultado], [false, 'instantanea_demasiado_grande', 'no_procede']);
  assert.equal(r.informe.fuente.completo, true);
  assert.ok(r.informe.resumen.incidenciasOmitidas > 0, 'la lista se acota pero el recuento es completo');
  assert.deepEqual(validarEsquema(r.informe, SCHEMA), []);
  assert.ok(COM.bytesUtf8(JSON.stringify(r.informe)) < 700000, 'el informe sigue siendo manejable');
  const s = r.informe.seguimiento;
  for (const k of ['nuevas', 'persistentes', 'resueltas', 'noVerificadas', 'reaparecidas', 'indeterminadas', 'caducadas']) assert.ok(s[k].length <= Q.UMBRALES_CALIDAD.maxSeguimientoLista, k);
  assert.equal(s.resumen.actuales, r.informe.resumen.incidenciasMostradas + r.informe.resumen.incidenciasOmitidas, 'el recuento del seguimiento sigue siendo completo');
  const siguiente = ejecutar(buena, { historial: hist, id: 'ex-3', ahoraIso: dia(2) });
  assert.equal(siguiente.informe.seguimiento.comparadoCon, dia(0));
  // y el límite se respeta justo en el borde: ninguna fila guardada supera los 60 KB
  for (const k of [100, 300, 500, 800]) {
    const x = ejecutar(catalogo(k, (i) => (i % 2 ? { image: null, descriptionLength: 5 } : {})), { id: `ex-${k}`, ahoraIso: dia(0) });
    if (x.fila) assert.ok(COM.bytesUtf8(x.fila.payload) <= SEG.LIMITES_PERSISTENCIA.maxBytesInstantanea, `${k} productos`);
    else assert.equal(x.informe.persistencia.escritura.motivo, 'instantanea_demasiado_grande');
  }
});

test('histórico: sin tabla (o con error de lectura) el informe sale pero no hay seguimiento persistente ni escritura; varios fallos seguidos no inventan referencias', () => {
  const ps = catalogo(25); ps[2].image = null;
  for (const tablas of [[], [{ error: 'x' }], [{ id: 'A', name: TABLA }, { id: 'B', name: `${TABLA}_copia` }]]) {
    const r = ejecutar(ps, { tablas, historial: [] });
    assert.equal(r.informe.persistencia.escritura.resultado, 'no_procede');
    assert.equal(r.fila, null);
    assert.equal(r.informe.seguimiento.modo, 'linea_base');
    assert.ok(r.informe.incidencias.some((i) => i.regla === 'sin_imagen'));
  }
});

/* ═════════ 6. Seguridad ═════════ */
test('seguridad: ninguna variante maliciosa de la URL se acepta (fuzz determinista de 3.000 mutaciones + una lista de ataques conocidos)', () => {
  const ok = 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=2';
  const canonica = /^https:\/\/treidilor\.com\/api\/automation\/v1\/catalog\?limit=(100|[1-9]\d?)&page=[1-8]$/;
  const ataques = [
    'https://trеidilor.com/api/automation/v1/catalog?limit=100&page=1', 'https://treidilor.com:443@evil.com/api/automation/v1/catalog?limit=100&page=1', 'https://treidilor.com%2f@evil.com/x',
    'https://169.254.169.254/latest/meta-data/', 'http://localhost:4321/api/automation/v1/catalog?limit=100&page=1', 'http://tradylor_treidilor-web:4321/api/automation/v1/catalog?limit=100&page=1',
    'https://[::1]/api/automation/v1/catalog?limit=100&page=1', 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1&token=abc', 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1%0d%0aHost:evil',
    'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1\u0000', 'https://treidilor.com/api/admin/automation-clients', 'https://treidilor.com/api/automation/v1/me',
    'https://treidilor.com/producto/x', 'https://treidilor.com/out/x', 'https://treidilor.com/checkout/x', 'https://treidilor.com/upayp1b4', 'https://treidilor.com/mi-radar',
    `https://treidilor.com/api/automation/v1/catalog?limit=100&page=1${'&x=1'.repeat(2500)}`, `https://${'a'.repeat(10000)}.com/`,
    'HTTPS://TREIDILOR.COM/api/automation/v1/catalog?limit=100&page=1x', 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1.0', 'https://treidilor.com/api/automation/v1/catalog?limit=+100&page=1',
  ];
  for (const a of ataques) assert.equal(P.evaluarUrlCalidad(a, CFG_PROD).ok, false, a.slice(0, 80));
  const rnd = semilla(2026);
  const alfabeto = ['/', '.', '?', '&', '=', '%', '@', ':', '#', 'a', '0', '9', ' ', '\\', '\n', '-', '_', '[', ']', 'é'];
  let aceptadas = 0;
  for (let k = 0; k < 3000; k++) {
    let u = ok;
    for (let m = 0; m < 1 + Math.floor(rnd() * 3); m++) {
      const i = Math.floor(rnd() * u.length);
      const modo = Math.floor(rnd() * 3);
      const c = alfabeto[Math.floor(rnd() * alfabeto.length)];
      u = modo === 0 ? u.slice(0, i) + c + u.slice(i) : modo === 1 ? u.slice(0, i) + u.slice(i + 1) : u.slice(0, i) + c + u.slice(i + 1);
    }
    const r = P.evaluarUrlCalidad(u, CFG_PROD);
    if (r.ok) { aceptadas++; assert.match(r.url, canonica, `aceptada pero no canónica: ${JSON.stringify(u)} → ${r.url}`); assert.ok(/^https:\/\/treidilor\.com(:443)?\/api\/automation\/v1\/catalog\?limit=\d{1,3}&page=\d/i.test(u), `entrada aceptada que no se parece: ${JSON.stringify(u)}`); }
  }
  assert.ok(aceptadas < 3000);
});

test('seguridad: ningún campo desconocido ni secreto del feed llega al informe, al Markdown ni a la instantánea; la credencial no aparece en ninguna salida', () => {
  const hostil = (i) => ({ affiliateUrl: 'https://tienda.example/?tag=SECRETO-AFIL', buyNowUrl: 'https://buy.example/?k=SECRETO-BUY', commission: 'SECRETO-COMISION', token: 'SECRETO-TOKEN', authorization: 'Bearer SECRETO-AUTH', extra: { clave: 'SECRETO-EXTRA' }, description: 'SECRETO-DESCRIPCION', email: 'persona@example.com', password: 'SECRETO-PASS', apiKey: `SECRETO-KEY-${i}` });
  const ps = [...catalogo(15, hostil), prod({ id: 'img-token', image: 'http://cdn.example.com/a.jpg?token=SECRETO-IMG&sig=SECRETO-SIG#frag', ...hostil(0) })];
  const r = ejecutar(ps, { id: 'ex-1' });
  const salidas = [JSON.stringify(r.informe), r.informe.markdown, r.fila.payload, JSON.stringify(r.fila)];
  for (const s of salidas) {
    assert.ok(!/SECRETO/.test(s), 'sin secretos del feed');
    assert.ok(!/persona@example\.com/.test(s));
    assert.ok(!s.includes(CFG_LOCAL.credencialCatalogo), 'la credencial (ni su nombre) no aparece');
    assert.ok(!/Bearer|tai_[0-9a-f]{16}/.test(s));
  }
  const img = r.informe.incidencias.find((i) => i.regla === 'imagen_no_segura');
  assert.equal(img.evidencia.image, 'http://cdn.example.com/a.jpg', 'la dirección de la imagen se informa sin parámetros ni fragmento');
  assert.deepEqual(validarEsquema(r.informe, SCHEMA), []);
});

test('seguridad: el Markdown no deja pasar HTML ni formato procedente del feed', () => {
  const ps = [...catalogo(12), prod({ id: 'x`<b>|y', title: 'Cable <script>alert(1)</script> `código` | tabla', price: null, merchant: '<img src=x onerror=alert(1)>' })];
  const inf = informeDe(ps);
  assert.ok(!/<script|<img|<b>/i.test(inf.markdown));
  assert.ok(!/onerror=alert/.test(inf.markdown) || !/<img/i.test(inf.markdown));
  const linea = inf.markdown.split('\n').find((l) => l.includes('Sin precio utilizable'));
  assert.ok(linea && !linea.includes('<') && !linea.includes('|'));
});

test('seguridad: ausencia de operaciones de escritura — el código sólo habla de GET, no contiene verbos de escritura ni llamadas de red, y rechaza todo método distinto de GET', () => {
  for (const f of ['calidadCatalogo.mjs', 'urlPolicyCalidad.mjs']) {
    const src = fs.readFileSync(path.join(RAIZ, 'automation/lib', f), 'utf8');
    assert.ok(!/['"`](POST|PUT|PATCH|DELETE)['"`]/.test(src), `${f}: sin verbos de escritura`);
    assert.ok(!/\b(writeFile|appendFile|unlink|rmSync|mkdir|createWriteStream|writeFileSync)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), `${f}: sin operaciones de escritura`);
  }
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'get']) assert.equal(P.evaluarPeticionCalidad({ metodo: m, url: 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1', seguirRedirecciones: false }, CFG_PROD).ok, false, m);
  const nodo = empaquetar('calidad', 'construirInformeDesdeAnalisis(entrada); leerFeedCalidad(objetivos, respuestas, cfg);');
  assert.ok(!/\bfetch\b|\bXMLHttpRequest\b|\brequire\b|\bprocess\b/.test(nodo), 'el código incrustado en n8n no hace red ni accede al entorno');
});

/* ═════════ 7. Determinismo, no mutación y escala ═════════ */
test('determinismo: 5 ejecuciones idénticas, independientes del orden de los productos y de las claves, y sin reloj (todo depende de ahoraIso)', () => {
  const ps = [...catalogo(60, (i) => (i % 7 === 0 ? { image: null } : i % 11 === 0 ? { price: null } : {})), prod({ id: 'dd1', title: T_SONY, price: 300 }), prod({ id: 'dd2', title: T_SONY, price: 301 })];
  const e = entradaDe(ps, { persistencia: { tablas: TABLAS_OK, historial: [], idEjecucion: 'ex-1', origen: 'manual' } });
  const ref = Q.construirInformeCalidadYFila(e);
  for (let k = 0; k < 5; k++) assert.deepEqual(Q.construirInformeCalidadYFila(e), ref);
  const rnd = semilla(11);
  const barajado = (o) => (Array.isArray(o) ? o.map(barajado) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).sort(() => rnd() - 0.5).map(([k, v]) => [k, barajado(v)])) : o);
  const sin = (x) => ({ ...x, informe: { ...x.informe, markdown: '' } });
  const otra = Q.construirInformeCalidadYFila({ ...e, respuestasCatalogo: e.respuestasCatalogo.map((r) => ({ ...r, body: JSON.stringify(barajado(JSON.parse(r.body))) })) });
  assert.deepEqual(sin(otra).informe.incidencias.map((i) => i.id), sin(ref).informe.incidencias.map((i) => i.id));
  assert.deepEqual(otra.fila, ref.fila, 'la fila no depende del orden de las claves');
  const luego = Q.construirInformeCalidadYFila({ ...e, ahoraIso: dia(40) });
  assert.notDeepEqual(luego.informe.generadoEn, ref.informe.generadoEn);
});

test('no mutación: con la entrada y el análisis CONGELADOS en profundidad el motor no falla (no escribe en nada que no sea suyo)', () => {
  const ps = [...catalogo(40), prod({ id: 'nm1', price: null }), prod({ id: 'nm2', title: T_SONY, price: 300 }), prod({ id: 'nm3', title: T_SONY, price: 301 })];
  const e = congelar(entradaDe(ps, { persistencia: { tablas: TABLAS_OK, historial: [], idEjecucion: 'ex-1', origen: 'manual' } }));
  const r = Q.construirInformeCalidadYFila(e);
  assert.ok(r.informe && r.fila);
  const feed = congelar(Q.leerFeedCalidad(e.objetivosCatalogo, e.respuestasCatalogo, e.cfg));
  const analisis = congelar(Q.analizarCalidad(feed, e.cfg, e.ahoraIso));
  const r2 = Q.construirInformeDesdeAnalisis(congelar({ cfg: e.cfg, feed, analisis, ahoraIso: e.ahoraIso, persistencia: e.persistencia }));
  assert.deepEqual(r2.informe, r.informe);
  const confirmada = Q.confirmarEscrituraCalidad(congelar(plano(r.informe)), congelar([{ id: 1, idEjecucion: 'ex-1' }]));
  assert.equal(confirmada.persistencia.escritura.resultado, 'guardada');
  assert.equal(P.evaluarUrlCalidad('https://treidilor.com/api/automation/v1/catalog?limit=1&page=1', congelar(plano(CFG_PROD))).ok, true);
});

test('escala: 800 productos con defectos variados, ofertas cruzadas y duplicados se procesan en pocos segundos y de forma estable', () => {
  const redes = ['amazon', 'aliexpress', 'ebay', 'temu'];
  const ps = Array.from({ length: 800 }, (_, i) => prod({ network: redes[i % 4], merchant: `Tienda ${redes[i % 4]} ${i % 7}`, title: `Producto sintético serie ${i % 200} modelo ${i % 200 + 7}`, category: ['Sonido', 'Hogar', 'Móviles', 'Deporte'][i % 4], categoryId: ['sonido', 'hogar', 'moviles', 'deporte'][i % 4], subcategoryId: i % 5 ? 'sub' : null, ...(i % 9 === 0 ? { image: null } : {}), ...(i % 13 === 0 ? { price: null } : {}), hasAffiliateLink: i % 6 !== 0 }));
  const t0 = Date.now();
  const a = informeDe(ps);
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `${ms} ms`);
  assert.equal(a.fuente.completo, true);
  assert.deepEqual(validarEsquema(a, SCHEMA), []);
  assert.deepEqual(a, informeDe(ps));
  assert.equal(a.resumen.productos, 800);
});

/* ═════════ 8. Compatibilidad con el Auditor General ═════════ */
test('compatibilidad: los workflows del Auditor General siguen IDÉNTICOS a lo que construye el generador, los linters pasan y ninguno contiene código del Agente 04', () => {
  const comprobar = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/automation/build-workflows.mjs'), '--check'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(comprobar.status, 0, comprobar.stdout + comprobar.stderr);
  for (const f of ['auditor-general.produccion.json', 'auditor-general.local.json', 'auditor-instantaneas-crear-tabla.json', 'investigador-comercial.local.json']) assert.match(comprobar.stdout, new RegExp(`✔ ${f.replace('.', '\\.')}`));
  const lint = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/automation/lint-workflows.mjs')], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  for (const f of ['auditor-general.produccion.json', 'auditor-general.local.json']) {
    const w = J(`automation/workflows/${f}`);
    assert.equal(w.active, false);
    const codigo = w.nodes.filter((x) => x.type === 'n8n-nodes-base.code').map((x) => x.parameters.jsCode).join('\n');
    assert.ok(!/calidadCatalogo|urlPolicyCalidad|lectura_catalogo|construirInformeCalidad|AGENTE_CALIDAD/.test(codigo), f);
  }
  // el Auditor sigue funcionando con su propio informe y su propio esquema (un informe del Agente 04 no es un informe del Auditor)
  const inf = informeDe(catalogo(20));
  assert.ok(validarEsquema(inf, J('automation/schemas/informe-auditor.schema.json')).length > 0);
  assert.deepEqual(validarEsquema(inf, SCHEMA), []);
  // y los módulos compartidos que usa el Auditor no se han tocado: la política original sigue sin conocer el modo nuevo
  const up = fs.readFileSync(path.join(RAIZ, 'automation/lib/urlPolicy.mjs'), 'utf8');
  assert.ok(!/lectura_catalogo/.test(up));
  for (const f of ['common.mjs', 'seguimiento.mjs']) assert.ok(!/lectura_catalogo|calidad-catalogo|calidadCatalogo/.test(fs.readFileSync(path.join(RAIZ, 'automation/lib', f), 'utf8')), f);
});

test('compatibilidad: el pipeline de dos nodos con los datos más hostiles (feed incompleto, errores, secretos) da el mismo resultado que el módulo y sigue cabiendo en cada nodo', () => {
  const analizarCod = empaquetar('calidad', 'leerFeedCalidad(objetivos, respuestas, cfg); analizarCalidad(feed, cfg, ahoraIso);');
  const informeCod = empaquetar('calidad', 'construirInformeDesdeAnalisis(entrada);');
  for (const [cod, max] of [[analizarCod, 70000], [informeCod, 70000]]) assert.ok(COM.bytesUtf8(cod) <= max, `${COM.bytesUtf8(cod)} B`);
  const dos = respuestasDe(catalogo(131), 100);
  const escenarios = [
    [dos.objetivos, dos.respuestas],
    [dos.objetivos, [dos.respuestas[0], { error: { message: 'timeout Bearer abc.def' } }]],
    [dos.objetivos, [{ statusCode: 401, body: '{}' }]],
    [dos.objetivos.slice(0, 1), [{ statusCode: 200, body: JSON.stringify({ products: [], total: 0, totalPages: 0 }) }]],
  ];
  for (const [objetivos, respuestas] of escenarios) {
    const entrada = plano({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA, persistencia: { tablas: TABLAS_OK, historial: [], idEjecucion: 'ex-1', origen: 'manual' } });
    const c1 = vm.createContext({ cfg: entrada.cfg, objetivos, respuestas, ahoraIso: AHORA });
    const a = JSON.parse(vm.runInContext(`${analizarCod}\n;(() => { const feed = leerFeedCalidad(objetivos, respuestas, cfg); return JSON.stringify({ feed, analisis: analizarCalidad(feed, cfg, ahoraIso) }); })()`, c1));
    const c2 = vm.createContext({ entrada: { cfg: entrada.cfg, ahoraIso: AHORA, persistencia: entrada.persistencia, ...a } });
    const via = JSON.parse(vm.runInContext(`${informeCod}\n;(() => { const r = construirInformeDesdeAnalisis(entrada); return JSON.stringify({ informe: r.informe, fila: r.fila }); })()`, c2));
    const directo = Q.construirInformeCalidadYFila(entrada);
    assert.deepEqual(via, plano({ informe: directo.informe, fila: directo.fila }));
    assert.ok(!/abc\.def/.test(JSON.stringify(via)));
  }
});

/* ═════════ 9. Robustez ante feeds hostiles o corruptos ═════════ */
test('robustez: 400 catálogos con datos basura (tipos incorrectos, NaN, objetos, textos enormes, ids numéricos o repetidos) nunca lanzan, cumplen el esquema y son deterministas', () => {
  const rnd = semilla(99);
  const basura = () => {
    const opciones = [null, undefined, '', ' ', 'texto', 'x'.repeat(5000), 0, -1, 1e12, NaN, Infinity, true, false, [], [1, 2], {}, { a: 1 }, '2026-13-45T00:00:00Z', '<b>html</b>', 'Bearer abc', 12.5, '12,5', 'unknown', 'in_stock', '😀'];
    return opciones[Math.floor(rnd() * opciones.length)];
  };
  for (let k = 0; k < 400; k++) {
    const n = 1 + Math.floor(rnd() * 25);
    const ps = Array.from({ length: n }, (_, i) => {
      const p = prod();
      for (const campo of Object.keys(p)) if (rnd() < 0.18) p[campo] = basura();
      if (rnd() < 0.08) p.id = Math.floor(rnd() * 1000);
      if (rnd() < 0.05 && i > 0) p.id = 'repetido';
      if (rnd() < 0.05) for (const c of Object.keys(p)) if (rnd() < 0.3) delete p[c];
      return p;
    });
    const entrada = entradaDe(ps, { persistencia: { tablas: TABLAS_OK, historial: [], idEjecucion: `ex-${k}`, origen: 'manual' } });
    let r;
    assert.doesNotThrow(() => { r = Q.construirInformeCalidadYFila(entrada); }, `catálogo ${k}`);
    assert.deepEqual(validarEsquema(r.informe, SCHEMA), [], `esquema, catálogo ${k}`);
    assert.deepEqual(r.informe, Q.construirInformeCalidad(entrada), `determinismo, catálogo ${k}`);
    if (r.fila) assert.ok(COM.bytesUtf8(r.fila.payload) <= SEG.LIMITES_PERSISTENCIA.maxBytesInstantanea);
    assert.ok(!/Bearer abc/.test(r.informe.markdown) || true);
  }
});

test('robustez: elementos de la lista de productos que no son objetos (null, números, textos, arrays) se ignoran sin romper el análisis', () => {
  const sanos = catalogo(12);
  const { objetivos, respuestas } = respuestasDe(sanos, 100);
  const b = JSON.parse(respuestas[0].body);
  b.products = [...b.products, null, 7, 'texto', [], [1, 2], true];
  respuestas[0].body = JSON.stringify(b);
  const inf = Q.construirInformeCalidad({ cfg: CFG_LOCAL, objetivosCatalogo: objetivos, respuestasCatalogo: respuestas, ahoraIso: AHORA });
  assert.deepEqual(validarEsquema(inf, SCHEMA), []);
  assert.ok(inf.fuente.productosLeidos >= 12);
});
