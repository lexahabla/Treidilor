#!/usr/bin/env node
// SITIO DE PRUEBAS del Agente 04 — Calidad del catálogo (Treidilor AI). Amplía el sitio sintético del Auditor (`sitio-prueba.mjs`, que NO se toca) con un feed que reproduce el
// contrato `automation-catalog/1` con DATOS SINTÉTICOS: fichas completas, precios ausentes e incoherentes, descripciones incompletas, imágenes inválidas, valoraciones no verificables,
// afiliación incompleta, posibles duplicados, productos equivalentes de distintos comercios y variantes que NO deben agruparse.
//   · Paginación real (`limit` 1-100, `page`), `total` y `totalPages` como el servidor de Treidilor.
//   · Escenarios controlados de error (401, 403, 429, 500 en una página, conexión cortada, tiempo agotado, redirección, total incoherente, página corta, catálogo vacío,
//     catálogo que cambia durante la paginación, ids repetidos entre páginas, más de 800 productos) y un LÍMITE DE RITMO por minuto (con reloj virtual del simulador).
//   · REGISTRO de todas las solicitudes (método, ruta, cabeceras de identificación, forma de la credencial, estado): la comprobación independiente de lo que hizo el agente.
//
// AISLAMIENTO: no hace ninguna conexión saliente (sin fetch, sin http.request, sin DNS, sin procesos). Nunca guarda el valor de ninguna credencial: sólo si tiene la FORMA de un token
// ficticio. No usa credenciales reales ni datos de Treidilor.
//
//   servidor (sólo local):  node sitio-calidad.mjs        (variables: PUERTO, PUERTO_CONTROL, ESCENARIO_INICIAL, ANFITRION)
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMA_TOKEN_FICTICIO, RUTA_CATALOGO } from './sitio-prueba.mjs';

export const FECHA_BASE = '2026-11-14T10:00:00.000Z';
export const AGENTE_ESPERADO = 'calidad-catalogo';
export const MAX_REGISTRO = 5000;
export const RETARDO_TIEMPO_AGOTADO_MS = 17000; // por encima del timeout de 15 s del nodo HTTP
export const LIMITE_POR_MINUTO = 10;
const dia = (n) => new Date(Date.parse(FECHA_BASE) + n * 86400000).toISOString();
const pad = (n, k = 3) => String(n).padStart(k, '0');

/* ───────────────────────── Catálogo sintético ───────────────────────── */
const REDES = ['amazon', 'aliexpress', 'ebay', 'temu'];
const CATEGORIAS = [['Sonido', 'sonido', ['auriculares', 'altavoces']], ['Informática', 'informatica', ['portatiles', 'perifericos']], ['Hogar', 'hogar', ['cocina', 'iluminacion']], ['Móviles', 'moviles', ['smartphones', 'accesorios']]];
const MARCAS = ['Nortek', 'Valmora', 'Kenzo', 'Aurelia', 'Brisa', 'Cobalto', 'Delta', 'Eolo', 'Fenix', 'Gaviota'];
const TIPOS = ['auriculares', 'altavoz', 'portátil', 'ratón', 'teclado', 'cafetera', 'lámpara', 'batidora', 'funda', 'cargador', 'monitor', 'tablet', 'robot', 'báscula', 'ventilador', 'termo', 'cámara', 'router', 'reloj', 'mochila'];
const LETRAS = ['alfa', 'beta', 'gamma', 'delta', 'épsilon', 'zeta', 'eta'];

/** Producto SANO (mismas claves que el feed real: todos los campos del contrato). Sin ningún hallazgo de ficha: sólo informativos (verificación, enlace no calibrable en Temu). */
export function productoSano(i, cambios = {}) {
  const [categoria, categoriaId, subs] = CATEGORIAS[i % 4];
  const red = REDES[i % 4];
  const p = {
    id: `c${pad(i)}`, title: `${MARCAS[i % 10]} ${TIPOS[(i * 3) % 20]} serie ${100 + i} edición ${LETRAS[i % 7]}`, category: categoria, categoryId: categoriaId, subcategoryId: subs[i % 2], network: red,
    merchant: `${red[0].toUpperCase()}${red.slice(1)} Store ${i % 3}`, price: 20 + ((i * 7) % 180), currency: 'EUR', declaredPreviousPrice: null, verifiedDiscount: null, stock: i % 9 === 0 ? 'low_stock' : 'in_stock',
    rating: 3.5 + (i % 15) / 10, reviewsCount: 10 + i, ratingFlag: null, image: `/images/products/c${pad(i)}.jpg`, descriptionLength: 200 + i, hasAffiliateLink: red !== 'temu',
    capturedAt: dia(-1 - (i % 5)), verifiedAt: i % 3 === 0 ? dia(-2) : null, addedAt: dia(-60), ...cambios,
  };
  // el enlace de afiliación sigue a la red FINAL del producto (Temu no lo trae en este catálogo sintético), salvo que el caso lo fije
  if (cambios.hasAffiliateLink === undefined) p.hasAffiliateLink = p.network !== 'temu';
  return p;
}

const T_ALTAVOZ = 'Altavoz portátil Bluetooth impermeable IPX7 20W negro edición limitada';
const T_CAMARA = 'Cámara de seguridad WiFi exterior 2K visión nocturna';
const T_MOCHILA = 'Mochila impermeable portátil 25L con puerto USB';
/** Hallazgos esperados del catálogo con defectos (id → reglas): lo que el agente debe encontrar, y nada más, en `calidad_base`. */
export const CALIDAD_ESPERADO = {
  c101: ['precio_ausente'], c102: ['precio_ausente'], c103: ['precio_extremo', 'precio_atipico'], c104: ['precio_anterior_menor'], c105: ['sin_imagen'], c106: ['imagen_no_segura'], c107: ['sin_descripcion'],
  c108: ['descripcion_corta'], c109: ['titulo_incompleto'], c110: ['sin_categoria'], c111: ['categoria_sin_id'], c112: ['sin_subcategoria'], c113: ['valoracion_incoherente'], c114: ['valoracion_por_defecto'],
  c115: ['stock_desconocido'], c116: ['captura_antigua'], c117: ['verificacion_antigua'], c118: ['enlace_afiliado_ausente'], c119: ['posible_duplicado'],
  c121: ['titulo_igual_no_duplicado'], c122: ['titulo_igual_no_duplicado'], c123: ['titulo_igual_no_duplicado'], c124: ['titulo_igual_no_duplicado'],
};
/** Productos que el agente NO debe relacionar nunca (variantes y packs) ni marcar como duplicados. */
export const VARIANTES_DISTINTAS = [['c125', 'c126'], ['c127', 'c128'], ['c129', 'c130']];
/** Las ofertas del mismo producto en distintos comercios (se conservan para comparar precios). */
export const OFERTAS_EQUIVALENTES = [['c121', 'c122'], ['c123', 'c124']];

/** Catálogo de 131 productos con los defectos anteriores. `arreglado`: los mismos productos con los defectos corregidos y sin duplicados. */
export function catalogoCalidad({ arreglado = false } = {}) {
  const lista = Array.from({ length: 100 }, (_, i) => productoSano(i + 1));
  const d = (i, c = {}) => lista.push(productoSano(i, c));
  const a = arreglado;
  d(101, a ? {} : { price: null }); d(102, a ? {} : { price: 0 }); d(103, a ? {} : { price: 150000 }); d(104, a ? {} : { price: 50, declaredPreviousPrice: 30 });
  d(105, a ? {} : { image: null }); d(106, a ? {} : { image: 'http://cdn.example.invalid/x.jpg' }); d(107, a ? {} : { descriptionLength: 0 }); d(108, a ? {} : { descriptionLength: 12 });
  d(109, a ? {} : { title: 'Cable' }); d(110, a ? {} : { category: null, categoryId: null, subcategoryId: null }); d(111, a ? {} : { categoryId: null }); d(112, a ? {} : { subcategoryId: null });
  d(113, a ? {} : { rating: 7 }); d(114, a ? {} : { ratingFlag: 'por_defecto', rating: null, reviewsCount: null }); d(115, a ? {} : { stock: 'unknown' }); d(116, a ? {} : { capturedAt: dia(-45) });
  d(117, a ? {} : { verifiedAt: dia(-45) }); d(118, a ? {} : { network: 'aliexpress', merchant: 'Aliexpress Store 0', hasAffiliateLink: false });
  // posible duplicado real (mismo comercio, mismo título, precio parecido): en `arreglado` el segundo pasa a ser un título distinto
  d(119, { title: T_ALTAVOZ, network: 'amazon', merchant: 'Amazon Store 0', price: 40 });
  d(120, { title: a ? `${T_ALTAVOZ} versión 2` : T_ALTAVOZ, network: 'amazon', merchant: 'Amazon Store 0', price: 41 });
  // el MISMO producto en comercios distintos: se conserva todo
  d(121, { title: T_CAMARA, network: 'amazon', merchant: 'Amazon Store 1', price: 45 }); d(122, { title: T_CAMARA, network: 'aliexpress', merchant: 'Aliexpress Store 1', price: 38 });
  d(123, { title: T_MOCHILA, network: 'ebay', merchant: 'Ebay Store 2', price: 30 }); d(124, { title: T_MOCHILA, network: 'temu', merchant: 'Temu Store 2', price: 22, hasAffiliateLink: false });
  // variantes que NO deben agruparse
  const ssd = { network: 'amazon', merchant: 'Amazon Store 0' };
  d(125, { ...ssd, title: 'Disco SSD portátil USB-C 500GB', price: 60 }); d(126, { ...ssd, title: 'Disco SSD portátil USB-C 1TB', price: 60 });
  d(127, { ...ssd, title: 'Auriculares inalámbricos Bluetooth 5.3 negro', price: 35 }); d(128, { ...ssd, title: 'Auriculares inalámbricos Bluetooth 5.3 plata', price: 35 });
  d(129, { ...ssd, title: 'Pilas alcalinas AA pack de 4 unidades', price: 15 }); d(130, { ...ssd, title: 'Pilas alcalinas AA pack de 8 unidades', price: 15 });
  d(131);
  return lista;
}
/** Catálogo de `n` productos sanos (p. ej. 801 para probar el tope de 8 páginas). */
export const catalogoGrande = (n) => Array.from({ length: n }, (_, i) => productoSano(i + 1));

/* ───────────────────────── Escenarios ───────────────────────── */
/**
 * `productos`: lo que devuelve el feed. Opciones: `auth` (401|403|'ok'), `paginas[n]` ({estado}|{reset}|{retardoMs}|{redireccion}|{productos}), `total`, `totalPages` (valores declarados), `limiteMinuto`,
 * `cambiaTrasLaPrimera` (productos desde la 2.ª petición del feed), `repiteEntrePaginas` (la pág. 2 empieza con el último producto de la 1.ª).
 */
export const ESCENARIOS_CALIDAD = {
  calidad_base: { productos: () => catalogoCalidad() },
  calidad_arreglado: { productos: () => catalogoCalidad({ arreglado: true }) },
  // 2.ª ejecución típica tras `calidad_arreglado`: reaparece un defecto (c101), uno nuevo (c040), un producto desaparece (c113) y otro persiste (c107)
  calidad_mixto: {
    productos: () => catalogoCalidad({ arreglado: true }).filter((p) => p.id !== 'c113').map((p) => (p.id === 'c101' ? { ...p, price: null } : p.id === 'c040' ? { ...p, image: null } : p.id === 'c107' ? { ...p, descriptionLength: 0 } : p)),
  },
  calidad_sano: { productos: () => Array.from({ length: 131 }, (_, i) => productoSano(i + 1)) },
  calidad_401: { productos: () => catalogoCalidad(), auth: 401 },
  calidad_403: { productos: () => catalogoCalidad(), auth: 403 },
  calidad_429_pagina2: { productos: () => catalogoCalidad(), paginas: { 2: { estado: 429 } } },
  calidad_500_pagina2: { productos: () => catalogoCalidad(), paginas: { 2: { estado: 500 } } },
  calidad_conexion_cortada: { productos: () => catalogoCalidad(), paginas: { 2: { reset: true } } },
  calidad_tiempo_agotado: { productos: () => catalogoCalidad(), paginas: { 2: { retardoMs: RETARDO_TIEMPO_AGOTADO_MS } } },
  calidad_redireccion: { productos: () => catalogoCalidad(), paginas: { 2: { redireccion: 'https://evil.example.invalid/robo?x=1' } } },
  calidad_total_incoherente: { productos: () => catalogoCalidad(), totalPages: 5 },
  calidad_pagina_corta: { productos: () => catalogoCalidad(), paginas: { 2: { productos: (todos) => todos.slice(100, 120) } } },
  calidad_vacio: { productos: () => [] },
  calidad_cambia: { productos: () => catalogoCalidad(), cambiaTrasLaPrimera: () => [...catalogoCalidad(), productoSano(900)] },
  calidad_repetidos: { productos: () => catalogoCalidad(), repiteEntrePaginas: true },
  calidad_pequeno: { productos: () => catalogoGrande(50) },
  calidad_grande: { productos: () => catalogoGrande(801) },
  calidad_800: { productos: () => catalogoGrande(800) },
  calidad_limite_ritmo: { productos: () => catalogoGrande(800), limiteMinuto: LIMITE_POR_MINUTO },
};

/* ───────────────────────── Núcleo puro (sin sockets) ───────────────────────── */
const json = (estado, cuerpo, extra = {}) => ({ estado, cabeceras: { 'content-type': 'application/json; charset=utf-8', ...(extra.cabeceras ?? {}) }, cuerpo: JSON.stringify(cuerpo), retardoMs: extra.retardoMs ?? 0, destruir: false });
const cortada = () => ({ estado: 0, cabeceras: {}, cuerpo: '', retardoMs: 0, destruir: true });
const formaAuth = (v) => (typeof v !== 'string' || !v ? 'ausente' : FORMA_TOKEN_FICTICIO.test(v) ? 'ficticia' : 'invalida');

export function crearEstado(escenario = 'calidad_base') {
  if (!ESCENARIOS_CALIDAD[escenario]) throw new Error(`escenario desconocido: ${escenario}`);
  return { escenario, registro: [], n: 0, peticionesFeed: 0, tiempos: [] };
}

/**
 * Procesa UNA solicitud. `peticion` = { metodo, url (ruta + consulta), cabeceras (en minúsculas), t? (ms; reloj virtual del simulador, o el real si falta) }.
 * Devuelve { estado, cabeceras, cuerpo, retardoMs, destruir } y la anota en el registro (sin el valor de ninguna credencial).
 */
export function procesar(peticion, estado) {
  const esc = ESCENARIOS_CALIDAD[estado.escenario];
  const metodo = String(peticion.metodo || 'GET').toUpperCase();
  const [ruta, consulta = ''] = String(peticion.url || '/').split('?');
  const cab = peticion.cabeceras || {};
  const t = Number.isFinite(peticion.t) ? peticion.t : Date.now();
  let r;
  if (metodo !== 'GET') r = json(405, { success: false, code: 'metodo_no_permitido' });
  else if (ruta !== RUTA_CATALOGO) r = { estado: 404, cabeceras: { 'content-type': 'text/plain' }, cuerpo: 'no existe', retardoMs: 0, destruir: false };
  else r = responderFeed(consulta, cab, esc, estado, t);
  if (estado.registro.length < MAX_REGISTRO) {
    estado.registro.push({ n: ++estado.n, escenario: estado.escenario, metodo, ruta: consulta ? `${ruta}?${consulta}` : ruta, ua: cab['user-agent'] || '', agente: cab['x-treidilor-agente'] || '', auth: formaAuth(cab.authorization), estado: r.destruir ? 'cortada' : r.estado, t, tieneCuerpo: peticion.cuerpo !== undefined && peticion.cuerpo !== null && peticion.cuerpo !== '' });
  }
  return r;
}

function responderFeed(consulta, cab, esc, estado, t) {
  estado.peticionesFeed += 1;
  if (formaAuth(cab.authorization) !== 'ficticia') return json(401, { success: false, code: 'no_autorizado' });
  if (esc.auth === 401) return json(401, { success: false, code: 'no_autorizado' });
  if (esc.auth === 403) return json(403, { success: false, code: 'alcance_insuficiente' });
  if (esc.limiteMinuto) {
    estado.tiempos = estado.tiempos.filter((x) => t - x < 60000);
    if (estado.tiempos.length >= esc.limiteMinuto) return json(429, { success: false, code: 'limite_por_minuto' }, { cabeceras: { 'retry-after': '60' } });
    estado.tiempos.push(t);
  }
  const q = new Map(consulta.split('&').filter(Boolean).map((p) => p.split('=')));
  const limit = Math.min(Math.max(Number(q.get('limit')) || 100, 1), 100);
  const page = Math.max(Number(q.get('page')) || 1, 1);
  const especial = (esc.paginas || {})[page] || {};
  if (especial.reset) return cortada();
  if (especial.redireccion) return { estado: 302, cabeceras: { location: especial.redireccion, 'content-type': 'text/plain' }, cuerpo: '', retardoMs: 0, destruir: false };
  if (typeof especial.estado === 'number' && especial.estado !== 200) return json(especial.estado, { success: false, code: 'error_interno' });
  let todos = esc.cambiaTrasLaPrimera && estado.peticionesFeed > 1 ? esc.cambiaTrasLaPrimera() : esc.productos();
  const total = todos.length;
  const totalPages = esc.totalPages ?? Math.max(0, Math.ceil(total / limit));
  let pagina = todos.slice((page - 1) * limit, page * limit);
  if (esc.repiteEntrePaginas && page > 1) pagina = [todos[(page - 1) * limit - 1], ...todos.slice((page - 1) * limit, page * limit - 1)];
  if (especial.productos) pagina = especial.productos(todos);
  return json(200, { success: true, schema: 'automation-catalog/1', generatedAt: FECHA_BASE, total, page, limit, totalPages, products: pagina }, { retardoMs: especial.retardoMs ?? 0 });
}

/**
 * Comprobación INDEPENDIENTE de lo que hizo el agente (a partir del registro del sitio): sólo GET, sólo el feed con `limit` y `page` en forma canónica, siempre con las dos cabeceras de
 * identificación y una credencial con FORMA ficticia, sin cuerpo y sin ninguna otra ruta. Devuelve { ok, problemas, resumen }.
 */
export function verificarRegistroCalidad(registro, { maxPeticionesPorMinuto = LIMITE_POR_MINUTO, pausaMinMs = null } = {}) {
  const problemas = [];
  const canonica = /^\/api\/automation\/v1\/catalog\?limit=(100|[1-9]\d?)&page=[1-8]$/;
  for (const r of registro) {
    if (r.metodo !== 'GET') problemas.push(`#${r.n}: método ${r.metodo}`);
    if (!canonica.test(r.ruta)) problemas.push(`#${r.n}: ruta no autorizada ${r.ruta}`);
    if (!/^TreidilorAI-calidad-catalogo\/\d+\.\d+ \(solo lectura\)$/.test(r.ua)) problemas.push(`#${r.n}: User-Agent inesperado «${r.ua}»`);
    if (r.agente !== AGENTE_ESPERADO) problemas.push(`#${r.n}: cabecera de agente inesperada «${r.agente}»`);
    if (r.auth !== 'ficticia') problemas.push(`#${r.n}: credencial ${r.auth}`);
    if (r.tieneCuerpo) problemas.push(`#${r.n}: con cuerpo`);
  }
  // ritmo: ninguna ventana de 60 s con más peticiones que las permitidas al cliente
  const ts = registro.map((r) => r.t).sort((a, b) => a - b);
  let maximo = 0;
  for (let i = 0; i < ts.length; i++) maximo = Math.max(maximo, ts.filter((x) => x >= ts[i] && x < ts[i] + 60000).length);
  if (maximo > maxPeticionesPorMinuto) problemas.push(`ritmo: ${maximo} peticiones en 60 s (máximo ${maxPeticionesPorMinuto})`);
  // pausa: hueco mínimo entre dos peticiones consecutivas (con `pausaMinMs` se exige; en n8n real se mide con el reloj del sitio)
  const huecos = ts.slice(1).map((x, i) => x - ts[i]);
  const minHuecoMs = huecos.length ? Math.min(...huecos) : null;
  if (pausaMinMs !== null && minHuecoMs !== null && minHuecoMs < pausaMinMs) problemas.push(`pausa: hueco mínimo de ${minHuecoMs} ms entre peticiones (mínimo ${pausaMinMs} ms)`);
  return { ok: problemas.length === 0, problemas, resumen: { total: registro.length, maxEnUnMinuto: maximo, minHuecoMs, estados: [...new Set(registro.map((r) => r.estado))] } };
}

/* ───────────────────────── Servidor local (sólo escucha; nunca se conecta hacia fuera) ───────────────────────── */
export function iniciarServidorCalidad({ puerto = 4350, puertoControl = 4351, escenario = 'calidad_base', anfitrion = '127.0.0.1' } = {}) {
  const estado = crearEstado(escenario);
  const sitio = http.createServer((req, res) => {
    const r = procesar({ metodo: req.method, url: req.url, cabeceras: req.headers }, estado);
    if (r.destruir) { req.socket.destroy(); return; }
    setTimeout(() => { if (!res.destroyed) { res.writeHead(r.estado, r.cabeceras); res.end(r.cuerpo); } }, r.retardoMs);
  });
  const control = http.createServer((req, res) => {
    const responder = (cod, o) => { res.writeHead(cod, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const url = String(req.url || '');
    if (req.method === 'GET' && url === '/registro') return responder(200, estado.registro);
    if (req.method === 'GET' && url === '/escenarios') return responder(200, Object.keys(ESCENARIOS_CALIDAD));
    if (req.method === 'POST' && url === '/reiniciar') { estado.registro.length = 0; estado.n = 0; estado.peticionesFeed = 0; estado.tiempos = []; return responder(200, { ok: true }); }
    const m = url.match(/^\/escenario\/([a-z_0-9]+)$/);
    if (req.method === 'POST' && m) { if (!ESCENARIOS_CALIDAD[m[1]]) return responder(404, { ok: false }); estado.escenario = m[1]; estado.peticionesFeed = 0; estado.tiempos = []; return responder(200, { ok: true, escenario: m[1] }); }
    return responder(404, { ok: false });
  });
  sitio.listen(puerto, anfitrion);
  control.listen(puertoControl, '127.0.0.1');
  return { sitio, control, estado, cerrar: () => { sitio.close(); control.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const escenario = process.env.ESCENARIO_INICIAL || 'calidad_base';
  iniciarServidorCalidad({ puerto: Number(process.env.PUERTO || 4350), puertoControl: Number(process.env.PUERTO_CONTROL || 4351), escenario, anfitrion: process.env.ANFITRION || '127.0.0.1' });
  console.log(`[sitio-calidad] escucha en :${process.env.PUERTO || 4350} (control sólo en 127.0.0.1:${process.env.PUERTO_CONTROL || 4351}) · escenario «${escenario}»`);
}
