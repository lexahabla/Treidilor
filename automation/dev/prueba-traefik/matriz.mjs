// MATRIZ DE AISLAMIENTO de los webhooks del lector de producción (lógica PURA: sin red, sin Docker). La usan la prueba local con Traefik 3.6.7 y, más adelante, la comprobación en el VPS.
// Una celda EXTERIOR es correcta si la petición NO llegó a n8n: ni cuerpo del canario ni cuerpos propios de n8n, y (cuando hay registro de acceso) sin respuesta del origen.
// Una celda de CONTROL es correcta si la ruta legítima SÍ llegó a n8n (el bloqueo no es demasiado amplio). Una celda INTERIOR es correcta si el canario responde por la red interna.
export const RUTA_CANARIO = 'tai-lector-prod-canario';
export const RUTA_PUBLICA_CONTROL = 'tai-publico-prueba';
export const HOST_N8N = 'n8n.prueba.local';
export const MARCAS_N8N = [/not registered/i, /Authorization data is wrong/i, /IP is not allowed/i, /Cannot (GET|POST|HEAD|OPTIONS)/i, /"canario"/i, /Workflow Webhook Error/i, /n8n/i];
export const ESTADOS_BLOQUEO = [400, 403, 404, 405, 414, 421];

const P = RUTA_CANARIO;
/** Variantes de ruta que podrían esquivar un bloqueo por prefijo. `crudo` = línea de petición tal cual (no se normaliza). */
export const VARIANTES_RUTA = [
  ['exacta', `/webhook/${P}`], ['mayusculas-prefijo', `/WEBHOOK/${P}`], ['capitalizada', `/Webhook/${P}`], ['mayusculas-ruta', `/webhook/${P.toUpperCase()}`],
  ['barras-dobles', `//webhook//${P}`], ['barra-final', `/webhook/${P}/`], ['punto-segmento', `/webhook/./${P}`], ['punto-punto', `/webhook/x/../${P}`],
  ['codificada-letra', `/webhook/%74ai-lector-prod-canario`], ['codificada-barra', `/webhook%2F${P}`], ['con-consulta', `/webhook/${P}?x=1`], ['con-punto-y-coma', `/webhook/${P};x=1`],
  ['test', `/webhook-test/${P}`], ['waiting', `/webhook-waiting/${P}`], ['test-mayusculas', `/WEBHOOK-TEST/${P}`],
];

/**
 * Variantes CODIFICADAS ADICIONALES (no forman parte de las 68): Traefik 3.6 deja codificados los caracteres reservados (%2F, %5C, %25…) al enrutar y n8n/Express puede interpretarlos de otra forma.
 * Se pasan siempre además de las 68 y deben quedar bloqueadas igual.
 */
export const VARIANTES_CODIFICADAS = [
  ['enc-barra-mayuscula', `/webhook%2F${P}`], ['enc-barra-minuscula', `/webhook%2f${P}`], ['enc-barra-inicial', `%2Fwebhook/${P}`], ['enc-doble-separador', `%2Fwebhook%2F${P}`],
  ['enc-barra-tras-barra', `/webhook/%2F${P}`], ['enc-barra-mixta-letra', `/webhook%2F%74ai-lector-prod-canario`], ['enc-doble-codificada', `/webhook%252F${P}`], ['enc-doble-codificada-min', `/webhook%252f${P}`],
  ['enc-barra-invertida', `/webhook%5C${P}`], ['enc-barra-invertida-min', `/webhook%5c${P}`], ['enc-test', `/webhook-test%2F${P}`], ['enc-waiting', `/webhook-waiting%2f${P}`],
  ['enc-prefijo-codificado', `/%77ebhook/${P}`], ['enc-guion', `/webhook/tai-lector-prod%2Dcanario`], ['enc-barra-doble', `/webhook%2F%2F${P}`], ['enc-mayusculas', `/WEBHOOK%2F${P.toUpperCase()}`],
];
export function matrizCodificada() {
  const celdas = [];
  for (const [nombre, ruta] of VARIANTES_CODIFICADAS) for (const entrada of ['http', 'https']) for (const cred of [false, true]) celdas.push({ id: `${nombre}|${entrada}|${cred ? 'con-cred' : 'sin-cred'}|POST`, tipo: 'codificada', metodo: 'POST', ruta, entrada, host: HOST_N8N, credencial: cred });
  return celdas;
}

/** Celdas exteriores: cada variante × {sin credencial, con la credencial del canario} × {http, https}; más métodos alternativos en la ruta exacta y otros Host. */
export function matrizExterior() {
  const celdas = [];
  for (const [nombre, ruta] of VARIANTES_RUTA) {
    for (const entrada of ['http', 'https']) {
      for (const cred of [false, true]) celdas.push({ id: `${nombre}|${entrada}|${cred ? 'con-cred' : 'sin-cred'}|POST`, tipo: 'exterior', metodo: 'POST', ruta, entrada, host: HOST_N8N, credencial: cred });
    }
  }
  for (const metodo of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) celdas.push({ id: `exacta|http|con-cred|${metodo}`, tipo: 'exterior', metodo, ruta: `/webhook/${P}`, entrada: 'http', host: HOST_N8N, credencial: true });
  for (const host of ['otro.ejemplo', '127.0.0.1', 'web.prueba.local']) celdas.push({ id: `exacta|http|con-cred|host=${host}`, tipo: 'exterior', metodo: 'POST', ruta: `/webhook/${P}`, entrada: 'http', host, credencial: true });
  return celdas;
}
export const matrizControles = () => [
  { id: 'control|healthz', tipo: 'control', metodo: 'GET', ruta: '/healthz', entrada: 'http', host: HOST_N8N, esperaEstado: [200] },
  { id: 'control|interfaz', tipo: 'control', metodo: 'GET', ruta: '/', entrada: 'http', host: HOST_N8N, esperaEstado: [200, 302] },
  { id: 'control|webhook-publico', tipo: 'control', metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, entrada: 'http', host: HOST_N8N, esperaEstado: [200], esperaCuerpo: /"publico"\s*:\s*true/ },
  { id: 'control|webhook-publico-https', tipo: 'control', metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, entrada: 'https', host: HOST_N8N, esperaEstado: [200], esperaCuerpo: /"publico"\s*:\s*true/ },
];

/** `r`: { estado, cuerpo, cabeceras, log } con `log` = línea del registro de acceso de Traefik de esa petición (o null si no se pudo leer). */
export function evaluarExterior(celda, r) {
  const motivos = [];
  const cuerpo = String(r.cuerpo ?? '');
  if (r.error && !r.estado) return { id: celda.id, ok: true, nota: `sin respuesta (${r.error}): no llegó a n8n`, motivos };
  if (!ESTADOS_BLOQUEO.includes(r.estado)) motivos.push(`estado ${r.estado} (se esperaba uno de ${ESTADOS_BLOQUEO.join('/')})`);
  for (const re of MARCAS_N8N) if (re.test(cuerpo)) motivos.push(`el cuerpo contiene una marca de n8n (${re.source})`);
  if (r.cabeceras && /express/i.test(String(r.cabeceras['x-powered-by'] ?? ''))) motivos.push('cabecera propia de n8n (x-powered-by)');
  if (r.log) {
    if (Number(r.log.OriginStatus ?? 0) > 0 || (r.log.ServiceName && !/noop@internal/.test(String(r.log.ServiceName)))) motivos.push(`el registro de Traefik indica que se reenvió al origen (${r.log.ServiceName ?? '?'} ${r.log.OriginStatus ?? ''})`);
  } else if (!/^\s*(Forbidden|404 page not found|Bad Request|400 Bad Request)?\s*$/i.test(cuerpo)) motivos.push('sin registro de acceso y con un cuerpo que no es de Traefik: no se puede asegurar que no llegara a n8n');
  const cls = clasificarRespuesta(r);
  if (celda.metodo === 'HEAD' && r.estado) {
    // HEAD no tiene cuerpo, así que NO se atribuye por él ni por `content-type`. Se atribuye por la petición GEMELA (mismo destino, método GET, mismo lote): su cuerpo debe ser el de Traefik y el estado del HEAD
    // debe ser el mismo; si el HEAD trae `content-length`, debe coincidir con el cuerpo del gemelo (evidencia complementaria, no obligatoria). La ausencia de línea de registro NO basta por sí sola.
    const g = r.gemelo;
    if (!g || !g.estado) motivos.push('HEAD: falta la petición GET gemela para atribuir la respuesta a Traefik');
    else {
      const cg = clasificarRespuesta(g);
      if (!/^traefik:/.test(cg)) motivos.push(`HEAD: el gemelo GET no es una respuesta de Traefik (${cg})`);
      if (r.estado !== g.estado) motivos.push(`HEAD: estado ${r.estado} distinto del gemelo GET (${g.estado})`);
      const len = r.cabeceras?.['content-length'];
      if (len !== undefined && len !== String(Buffer.byteLength(String(g.cuerpo ?? '')))) motivos.push(`HEAD: content-length «${len}» no coincide con el cuerpo del gemelo`);
    }
  } else if (r.estado && !/^traefik:/.test(cls)) motivos.push(`la respuesta no es atribuible a Traefik (${cls})`);
  return { id: celda.id, ok: motivos.length === 0, motivos, router: r.log ? (r.log.RouterName ?? null) : null, servicio: r.log ? (r.log.ServiceName ?? null) : null, originStatus: r.log ? (r.log.OriginStatus ?? null) : null, sinRegistro: !r.log };
}
export function evaluarControl(celda, r) {
  const motivos = [];
  if (!celda.esperaEstado.includes(r.estado)) motivos.push(`estado ${r.estado} (se esperaba ${celda.esperaEstado.join('/')}): el bloqueo podría ser demasiado amplio o n8n no responde`);
  if (celda.esperaCuerpo && !celda.esperaCuerpo.test(String(r.cuerpo ?? ''))) motivos.push('el cuerpo no es el esperado de la ruta legítima');
  return { id: celda.id, ok: motivos.length === 0, motivos };
}
export function evaluarInterior(r, conCredencial) {
  const motivos = [];
  if (conCredencial) { if (r.estado !== 200 || !/"canario"\s*:\s*true/.test(String(r.cuerpo ?? ''))) motivos.push(`el canario no respondió por la red interna con credencial (estado ${r.estado})`); }
  else if (![401, 403].includes(r.estado)) motivos.push(`sin credencial se esperaba 401/403 de n8n y llegó ${r.estado}`);
  return { id: `interior|${conCredencial ? 'con-cred' : 'sin-cred'}`, ok: motivos.length === 0, motivos };
}

/** Veredicto global: cada celda debe cumplirse; una sola celda exterior filtrada = ABORTAR. */
export function veredicto({ exterior, controles, interior, regeneracion = null }) {
  const fallos = [...exterior, ...controles, ...interior, ...(regeneracion ? [regeneracion] : [])].filter((c) => !c.ok);
  const sinRegistro = exterior.filter((c) => c.sinRegistro).length;
  return { ok: fallos.length === 0, celdas: exterior.length + controles.length + interior.length + (regeneracion ? 1 : 0), fallos, avisos: sinRegistro ? [`${sinRegistro} celdas exteriores sin registro de acceso de Traefik (la evidencia es solo la respuesta)`] : [] };
}

/** Qué respondió realmente (para explicar cada celda de la fase A): canario, n8n (varias formas) o el propio Traefik. */
export function clasificarRespuesta(r) {
  const c = String(r.cuerpo ?? '');
  if (r.error && !r.estado) return 'sin-respuesta';
  if (/"canario"\s*:\s*true/.test(c)) return 'canario-alcanzado';
  if (/IP is not allowed/i.test(c)) return 'n8n:lista-de-IP-deniega';
  if (/Authorization data is wrong/i.test(c)) return 'n8n:credencial-rechazada';
  if (/not registered/i.test(c)) return 'n8n:webhook-no-registrado';
  if (/Cannot (GET|POST|HEAD|OPTIONS|PUT|DELETE)/i.test(c)) return 'n8n:ruta-no-existe';
  if (/^\s*Forbidden\s*$/i.test(c)) return 'traefik:403';
  if (/404 page not found/i.test(c)) return 'traefik:404-sin-router';
  if (/Bad Request/i.test(c) && !/n8n/i.test(c)) return 'traefik:400';
  return `otra:${r.estado}`;
}
/** Canario ABIERTO (sin lista de IP): sin regla debe responder el canario; con regla debe quedar bloqueado. */
export const matrizAbierto = () => ['http', 'https'].map((entrada) => ({ id: `abierto|exacta|${entrada}|con-cred|POST`, tipo: 'abierto', metodo: 'POST', ruta: `/webhook/${RUTA_CANARIO}-abierto`, entrada, host: HOST_N8N, credencial: true }));

/**
 * Estado INEQUÍVOCO de la regla a partir de tres sondas (la ruta del canario con lista de IP, el canario ABIERTO y una ruta legítima). No se basa en el código 403: n8n también lo devuelve.
 *   cargada  → las dos rutas del lector responden con el cuerpo `Forbidden` del proxy y la ruta legítima llega a n8n (200).
 *   ausente  → la ruta con lista de IP llega a n8n (la rechaza su lista de IP o no existe) y el canario abierto devuelve su JSON: el proxy las entrega.
 * Cualquier otra combinación es `indeterminado` (no se avanza).
 */
export function diagnosticarRegla({ exacta, abierto, control }) {
  const ce = clasificarRespuesta(exacta); const ca = clasificarRespuesta(abierto);
  const base = { exacta: ce, abierto: ca, control: control.estado };
  if (control.estado !== 200) return { estado: 'no-sano', ...base };
  if (ce === 'traefik:403' && ca === 'traefik:403') return { estado: 'cargada', ...base };
  if ((/^n8n:/.test(ce) || ce === 'canario-alcanzado') && ca === 'canario-alcanzado') return { estado: 'ausente', ...base };
  return { estado: 'indeterminado', ...base };
}

/**
 * CONTROLES NEGATIVOS: rutas públicas AJENAS al lector que la expresión `webhook.*tai-lector-prod-` NO debe bloquear. Deben llegar a n8n por el router normal (línea de registro con router `n8n-*` y OriginStatus > 0).
 * Incluye los límites del patrón: el lector LOCAL (`tai-lector-04/12`), `tai-lector-produccion` (contiene `tai-lector-prod` pero no `tai-lector-prod-`), rutas con la palabra `webhook` que no empiezan por ella, etc.
 */
export const RUTAS_CONTROL_NEGATIVO = [
  ['publico-prueba', `/webhook/${RUTA_PUBLICA_CONTROL}`, 'POST'], ['lector-local-04', '/webhook/tai-lector-04', 'POST'], ['lector-local-12', '/webhook/tai-lector-12', 'POST'],
  ['prod-sin-guion', '/webhook/tai-lector-produccion', 'POST'], ['otro-webhook', '/webhook/otro-webhook-publico', 'POST'], ['test-ajeno', `/webhook-test/${RUTA_PUBLICA_CONTROL}`, 'POST'],
  ['waiting-ajeno', '/webhook-waiting/1', 'GET'], ['activo-con-webhook', '/assets/webhook-icon.svg', 'GET'], ['healthz', '/healthz', 'GET'], ['interfaz', '/', 'GET'],
];
export function matrizControlesNegativos() {
  const celdas = [];
  for (const [nombre, ruta, metodo] of RUTAS_CONTROL_NEGATIVO) for (const entrada of ['http', 'https']) celdas.push({ id: `neg|${nombre}|${entrada}`, tipo: 'control-negativo', metodo, ruta, entrada, host: HOST_N8N, credencial: false });
  return celdas;
}
/** Correcto = NO bloqueado: llegó a n8n por su router normal (registro con router n8n-* y OriginStatus > 0) y la respuesta no es la del bloqueo de Traefik. */
export function evaluarControlNegativo(celda, r) {
  const motivos = [];
  const cls = clasificarRespuesta(r);
  if (cls === 'traefik:403') motivos.push('la ruta pública ajena fue bloqueada por la regla (sobre-bloqueo)');
  if (!r.log) motivos.push('sin línea en el registro de acceso: no se puede afirmar que llegara a n8n');
  else {
    if (!/^n8n-/.test(String(r.log.RouterName ?? ''))) motivos.push(`no pasó por el router normal de n8n (${r.log.RouterName ?? 'sin router'})`);
    if (!(Number(r.log.OriginStatus ?? 0) > 0)) motivos.push('el origen (n8n) no respondió');
  }
  return { id: celda.id, ok: motivos.length === 0, motivos };
}

// ───────────────────────────── E0b (16/11/2026): forwardedHeaders.insecure=true ─────────────────────────────
// Suplantación de cabeceras de reenvío. IP_BLOQUEO es la ÚNICA que admitiría el middleware `tai-denegar-todo` (ipAllowList 192.0.2.1/32) si leyera la IP de una cabecera en vez de la dirección remota.
export const IP_BLOQUEO = '192.0.2.1';
export const HOST_ECO = 'eco.prueba.local';
/** `ipInterna`: IP de un contenedor de la red interna (la que admitiría la lista de IP del canario). */
export function variantesSuplantacion(ipInterna) {
  return [
    ['xff-ip-bloqueo', { 'X-Forwarded-For': IP_BLOQUEO }],
    ['xff-lista-bloqueo-primero', { 'X-Forwarded-For': `${IP_BLOQUEO}, 10.255.255.1` }],
    ['xff-lista-bloqueo-ultimo', { 'X-Forwarded-For': `10.255.255.1, ${IP_BLOQUEO}` }],
    ['xff-ip-interna', { 'X-Forwarded-For': ipInterna }],
    ['xff-interna-y-bloqueo', { 'X-Forwarded-For': `${ipInterna}, ${IP_BLOQUEO}` }],
    ['xff-ipv6-mapeada', { 'X-Forwarded-For': `::ffff:${IP_BLOQUEO}` }],
    ['xff-con-puerto', { 'X-Forwarded-For': `${IP_BLOQUEO}:4000` }],
    ['xff-doble-cabecera', { 'X-Forwarded-For': [IP_BLOQUEO, '10.255.255.1'] }],
    ['x-real-ip-bloqueo', { 'X-Real-IP': IP_BLOQUEO }],
    ['x-real-ip-interna', { 'X-Real-IP': ipInterna }],
    ['forwarded-bloqueo', { Forwarded: `for=${IP_BLOQUEO};proto=https` }],
    ['forwarded-interna', { Forwarded: `for=${ipInterna}` }],
    ['xff-y-proto-host', { 'X-Forwarded-For': IP_BLOQUEO, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Port': '443', 'X-Real-IP': IP_BLOQUEO }],
  ];
}
/** Con la regla ACTIVA: cada variante × {ruta exacta, canario abierto, `%2F`} × {http, https} (POST con credencial) + GET en la ruta exacta. TODAS deben quedar bloqueadas por Traefik y con 0 ejecuciones en n8n. */
export function matrizSuplantacionBloqueo(ipInterna) {
  const rutas = [['exacta', `/webhook/${P}`], ['abierto', `/webhook/${P}-abierto`], ['enc-barra', `/webhook%2F${P}`]];
  const celdas = [];
  for (const [vn, cab] of variantesSuplantacion(ipInterna)) {
    for (const [rn, ruta] of rutas) for (const entrada of ['http', 'https']) celdas.push({ id: `supl|${vn}|${rn}|${entrada}|POST`, tipo: 'suplantacion', metodo: 'POST', ruta, entrada, host: HOST_N8N, credencial: true, cabeceras: cab });
    for (const entrada of ['http', 'https']) celdas.push({ id: `supl|${vn}|exacta|${entrada}|GET`, tipo: 'suplantacion', metodo: 'GET', ruta: `/webhook/${P}`, entrada, host: HOST_N8N, credencial: true, cabeceras: cab });
  }
  return celdas;
}
/** SIN regla (capa 2): ruta exacta del canario CON lista de IP (la subred interna) y credencial correcta; cada variante × {http, https}. */
export function matrizSuplantacionCapa2(ipInterna) {
  const celdas = [{ id: 'capa2|sin-suplantacion|http', tipo: 'capa2', metodo: 'POST', ruta: `/webhook/${P}`, entrada: 'http', host: HOST_N8N, credencial: true, cabeceras: {} }];
  for (const [vn, cab] of variantesSuplantacion(ipInterna)) for (const entrada of ['http', 'https']) celdas.push({ id: `capa2|${vn}|${entrada}`, tipo: 'capa2', metodo: 'POST', ruta: `/webhook/${P}`, entrada, host: HOST_N8N, credencial: true, cabeceras: cab });
  return celdas;
}
/** Resultado de la lista de IP de n8n frente a una suplantación: BYPASS = el canario respondió (la lista dejó pasar al cliente externo). */
export function clasificarCapa2(r) {
  const c = clasificarRespuesta(r);
  if (c === 'canario-alcanzado') return 'BYPASS';
  if (c === 'n8n:lista-de-IP-deniega') return 'deniega';
  return `otro:${c}`;
}
/** Eco: lo que RECIBIÓ el origen (control de que insecure=true está realmente activo y de qué hace Traefik con las cabeceras). */
export function resumenEco(cuerpo) { try { const j = JSON.parse(cuerpo); return { remote: j.remote ?? null, xff: j.xff ?? null, xri: j.xri ?? null, fwd: j.fwd ?? null, proto: j.proto ?? null, host: j.host ?? null }; } catch { return null; } }

// — Registro de acceso en formato CLF (el real del VPS). Traefik: IP - usuario [fecha] "MÉTODO ruta PROTOCOLO" estado bytes "referer" "agente" contador "router" "URL-servidor" duraciónms —
const RE_CLF = /^(\S+) - (\S+) \[([^\]]+)\] "(\S+) (.*?) (HTTP\/[\d.]+)" (\d{3}|-) (\d+|-) "([^"]*)" "([^"]*)" (\d+|-) "([^"]*)" "([^"]*)" (\d+)ms$/;
export function analizarClf(linea) {
  const m = RE_CLF.exec(String(linea).replace(/\x1b\[[0-9;]*m/g, '').trim());
  if (!m) return null;
  return { ip: m[1], usuario: m[2], fecha: m[3], metodo: m[4], ruta: m[5], protocolo: m[6], estado: m[7] === '-' ? null : Number(m[7]), bytes: m[8] === '-' ? null : Number(m[8]), contador: m[11], router: m[12], servidor: m[13], ms: Number(m[14]) };
}
/** idPrueba → línea CLF analizada. El id viaja en la CONSULTA (`?tai=<id>`): el CLF no lleva cabeceras. */
export function indexarClf(texto) {
  const mapa = new Map();
  for (const l of String(texto).split('\n')) {
    const p = analizarClf(l); if (!p) continue;
    const m = /[?&]tai=([0-9a-f]+)/.exec(p.ruta); if (m) mapa.set(m[1], p);
  }
  return mapa;
}
/** Sonda BLOQUEADA vista en CLF: respuesta de Traefik (cuerpo/estado) y, si hay línea, que NO sea del router/servidor de n8n. La ausencia de línea se informa pero no decide. */
export function evaluarClfBloqueada(celda, r, p) {
  const ev = evaluarExterior(celda, { ...r, log: null });
  const motivos = ev.motivos.filter((m) => !/sin registro de acceso/.test(m));
  if (p && (/^n8n-/.test(p.router) || /n8n-interno/.test(p.servidor))) motivos.push(`el CLF muestra el router/servidor de n8n (${p.router} ${p.servidor}): FUGA`);
  return { id: celda.id, ok: motivos.length === 0, motivos, linea: p ? 'presente' : 'ausente', router: p?.router ?? null, servidor: p?.servidor ?? null, estadoClf: p?.estado ?? null };
}
/** Sonda que DEBE llegar a n8n (centinela o ruta pública): estado esperado y línea CLF con router n8n-* y mismo estado. */
export function evaluarClfAbierta(celda, r, p) {
  const motivos = [];
  if (!celda.esperaEstado.includes(r.estado)) motivos.push(`estado ${r.estado} (se esperaba ${celda.esperaEstado.join('/')})`);
  if (!p) motivos.push('sin línea CLF: el registro no funciona o la sonda no llegó');
  else { if (!/^n8n-/.test(p.router)) motivos.push(`router ${p.router} (se esperaba n8n-*)`); if (p.estado !== r.estado) motivos.push(`estado del CLF ${p.estado} ≠ respuesta ${r.estado}`); }
  return { id: celda.id, ok: motivos.length === 0, motivos, linea: p ? 'presente' : 'ausente', router: p?.router ?? null, servidor: p?.servidor ?? null, estadoClf: p?.estado ?? null };
}

// ───────────── Verificación complementaria del evaluador CLF (16/11/2026) ─────────────
// El criterio original de la fase CLF exigía 0 ejecuciones en TODA la fase, pero las rutas públicas legítimas ejecutan su workflow. El criterio correcto separa GRUPOS:
//   bloqueada / sin-ejecucion → 0 ejecuciones nuevas · publica → exactamente 1 (atribuida al webhook público) · control-canario (SIN regla) → exactamente 1 (atribuida al canario: control positivo del contador).
export const HASH_REGLA_VALIDADA = '2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39';
const NODOS_ESPERADOS = { publica: ['publico'], 'control-canario': ['abierto', 'canario'] };
/** `nodos`: nodos «Recibir (...)» de cada ejecución NUEVA según n8n (`null` si no se pudo consultar; `desconocido` si la ejecución no guardó datos). Sin atribución por nodo se decide solo por el contador de la sonda. */
export function evaluarSondaEjecuciones({ grupo, delta, nodos }) {
  const motivos = [];
  const esperado = grupo === 'publica' || grupo === 'control-canario' ? 1 : 0;
  if (delta !== esperado) motivos.push(`ejecuciones nuevas ${delta} (se esperaban ${esperado} para el grupo «${grupo}»)`);
  const lista = Array.isArray(nodos) ? nodos : null;
  const porNodo = Boolean(lista && lista.length > 0 && lista.every((n) => n !== 'desconocido'));
  if (porNodo) {
    if (lista.length !== delta) motivos.push(`n8n registra ${lista.length} ejecuciones nuevas y el contador ${delta}`);
    if (esperado === 0) motivos.push(`ejecución atribuida a «${lista.join(', ')}» en un grupo que no debe ejecutar nada`);
    else if (!NODOS_ESPERADOS[grupo].includes(lista[0])) motivos.push(`ejecución atribuida a «${lista[0]}» y se esperaba ${NODOS_ESPERADOS[grupo].join(' o ')}`);
  } else if (lista && lista.length > delta) motivos.push(`n8n registra ${lista.length} ejecuciones nuevas y el contador ${delta}`);
  return { ok: motivos.length === 0, motivos, atribucion: porNodo ? 'por-nodo' : 'por-sonda' };
}
/** Decisión AGREGADA de la fase CLF (la misma lógica que usa `faseClf`): reglas, correlación por consulta, todas las sondas y 0 ejecuciones alrededor de las BLOQUEADAS. */
export function decidirClf({ reglaCargada, correlacionPorConsulta, celdas, ejecucionesN8nGeneradas }) {
  return Boolean(reglaCargada && correlacionPorConsulta && celdas.every((c) => c.ok) && ejecucionesN8nGeneradas === 0);
}
/** Veredicto de la verificación complementaria. `d.sondas`: { id, grupo, ok, delta, linea } ; resto: ver `verificarClf`. */
export function veredictoVerificacionClf(d) {
  const fallos = [];
  const s = d.sondas ?? [];
  const grupo = (g) => s.filter((x) => x.grupo === g);
  const malas = s.filter((x) => !x.ok);
  if (malas.length) fallos.push(`${malas.length} sondas no cumplen: ${malas.slice(0, 6).map((x) => x.id).join(', ')}`);
  const cc = grupo('control-canario');
  if (cc.length < 1 || cc.some((x) => x.delta !== 1)) fallos.push('control positivo del contador: el canario SIN regla no sumó exactamente 1 ejecución');
  const bl = grupo('bloqueada');
  if (bl.length < 8) fallos.push(`solo ${bl.length} sondas bloqueadas (se exigen al menos 8)`);
  const ejBloq = bl.reduce((a, x) => a + x.delta, 0);
  if (ejBloq !== 0) fallos.push(`las sondas bloqueadas generaron ${ejBloq} ejecuciones (debe ser 0)`);
  const pu = grupo('publica').filter((x) => x.id.startsWith('v3|'));
  const ejPub = pu.reduce((a, x) => a + x.delta, 0);
  if (pu.length < 2 || ejPub !== pu.length) fallos.push(`las rutas públicas legítimas generaron ${ejPub} ejecuciones con ${pu.length} sondas (debe haber exactamente 1 por sonda)`);
  const cen = s.filter((x) => /centinela/.test(x.id));
  if (cen.length < 4 || cen.some((x) => x.linea !== 'presente')) fallos.push(`centinelas con línea CLF: ${cen.filter((x) => x.linea === 'presente').length}/${cen.length} (se exigen al menos 4 y todos presentes)`);
  const r = d.reproduccion ?? {};
  if (r.ok !== true) fallos.push('el evaluador CLF corregido (faseClf, la secuencia original) no dio ok');
  if (r.ejecucionesN8nGeneradas !== 0) fallos.push(`faseClf: ejecuciones alrededor de las bloqueadas = ${r.ejecucionesN8nGeneradas} (debe ser 0)`);
  if (r.ejecucionesDeLasRutasPublicasLegitimas !== 2) fallos.push(`faseClf: ejecuciones de las rutas públicas legítimas = ${r.ejecucionesDeLasRutasPublicasLegitimas} (deben ser 2, las observadas en E0b)`);
  const rg = d.regla ?? {};
  if (rg.hashAntes !== HASH_REGLA_VALIDADA || rg.hashDespues !== HASH_REGLA_VALIDADA || rg.hashEnVolumen !== HASH_REGLA_VALIDADA) fallos.push('la regla no coincide con la validada (antes / después / en el volumen de Traefik)');
  const io = d.informeOriginal ?? {};
  if (!io.esperado || io.antes !== io.esperado || io.despues !== io.esperado) fallos.push('el informe.json original de E0b no está intacto');
  if (d.existentesIntactos !== true) fallos.push('los tres contenedores locales preexistentes cambiaron (id, arranque o estado)');
  if (d.proyectoLimpio !== true) fallos.push('quedaron recursos de tai-prueba-tf sin limpiar');
  if (d.contexto !== 'desktop-linux') fallos.push(`contexto de Docker «${d.contexto}»`);
  return { ok: fallos.length === 0, fallos };
}

// ───────────── Fase TLS (17/11/2026): router antiguo (sin `tls`) frente al candidato con router https + `tls: {}` ─────────────
// Causa de E2: en el VPS las diez sondas https llegaron al router de n8n porque un router SIN `tls` no atiende conexiones TLS. Las pruebas locales anteriores usaban un entrypoint https SIN TLS y no podían verlo.
// Esta fase NO repite E0b: reproduce el fallo con la regla ORIGINAL sobre TLS real, comprueba el candidato con una matriz reducida y la reversión. Todo es lógica pura; el lanzador solo envía las peticiones.
export const ARCHIVO_CANDIDATA_TLS = 'tai-bloqueo-lector-tls.yaml';
export const HASH_CANDIDATA_TLS = '75703a2ca62f4793203952e4fb4f7729acf23526eb4e8a62a2592a4c96e81746';
const NOMBRES_TLS_BASE = ['exacta', 'mayusculas-prefijo', 'barras-dobles', 'punto-punto', 'codificada-barra', 'test'];
const NOMBRES_TLS_COD = ['enc-barra-minuscula', 'enc-doble-codificada', 'enc-barra-invertida', 'enc-barra-inicial'];

/**
 * Celdas de la fase TLS. `decisiva`: reproducen E2 con la regla antigua (deben LLEGAR a n8n por https) y las bloquea el candidato. `fase: 'nuevo'`: solo se evalúan con el candidato (SNI, Host, h2).
 * Las variantes de ruta reutilizan las de la matriz ya validada (no se redefinen).
 */
export function matrizTls() {
  const rutas = new Map([...VARIANTES_RUTA, ...VARIANTES_CODIFICADAS]);
  const celdas = [];
  const cel = (id, extra) => celdas.push({ id: `tls|${id}`, tipo: 'tls', metodo: 'POST', entrada: 'https', host: HOST_N8N, credencial: false, fase: 'ambas', ...extra });
  cel('exacta|https|con-cred|POST', { ruta: `/webhook/${P}`, credencial: true, decisiva: true });
  cel('abierto|https|con-cred|POST', { ruta: `/webhook/${P}-abierto`, credencial: true, decisiva: true });
  for (const nombre of [...NOMBRES_TLS_BASE, ...NOMBRES_TLS_COD]) cel(`${nombre}|https|sin-cred|POST`, { ruta: rutas.get(nombre) });
  cel('exacta|https|con-cred|GET', { ruta: `/webhook/${P}`, metodo: 'GET', credencial: true });
  cel('exacta|https|con-cred|HEAD', { ruta: `/webhook/${P}`, metodo: 'HEAD', credencial: true });
  cel('exacta|http|con-cred|POST', { ruta: `/webhook/${P}`, entrada: 'http', credencial: true, decisivaHttp: true });
  // SNI y Host (solo con el candidato): el bloqueo no depende del nombre de servidor ni del Host.
  cel('sni=otro|https', { ruta: `/webhook/${P}`, credencial: true, sni: 'otro.ejemplo', fase: 'nuevo' });
  cel('sni=ninguno|https', { ruta: `/webhook/${P}`, credencial: true, sni: null, fase: 'nuevo' });
  cel('host=otro|sni=n8n|https', { ruta: `/webhook/${P}`, credencial: true, host: 'otro.ejemplo', fase: 'nuevo' });
  cel('host=n8n|sni=otro|https', { ruta: `/webhook/${P}`, credencial: true, sni: 'web.prueba.local', fase: 'nuevo' });
  // HTTP/2 (lo que negocian navegadores y la mayoría de llamadores reales).
  cel('exacta|https|h2|POST', { ruta: `/webhook/${P}`, credencial: true, h2: true, fase: 'nuevo' });
  cel('abierto|https|h2|POST', { ruta: `/webhook/${P}-abierto`, credencial: true, h2: true, fase: 'nuevo' });
  cel('codificada-barra|https|h2|POST', { ruta: rutas.get('codificada-barra'), h2: true, fase: 'nuevo' });
  return celdas;
}
/** Controles de la fase TLS (rutas legítimas): por https llegan a n8n; por http, con la redirección del router, se redirige a https (no llegan al origen). */
export function controlesTls() {
  const n8n = (id, extra) => ({ tipo: 'control', host: HOST_N8N, entrada: 'https', ...extra, id: `tlsctl|${id}` });
  return {
    https: [
      n8n('healthz', { metodo: 'GET', ruta: '/healthz', esperaEstado: [200] }),
      n8n('interfaz', { metodo: 'GET', ruta: '/', esperaEstado: [200, 302] }),
      n8n('webhook-publico', { metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, esperaEstado: [200], esperaCuerpo: /"publico"\s*:\s*true/ }),
      n8n('webhook-publico|h2', { metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, esperaEstado: [200], esperaCuerpo: /"publico"\s*:\s*true/, h2: true }),
    ],
    http: [
      { id: 'tlsctl|healthz|http', tipo: 'control-redireccion', metodo: 'GET', ruta: '/healthz', entrada: 'http', host: HOST_N8N },
      { id: 'tlsctl|webhook-publico|http', tipo: 'control-redireccion', metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, entrada: 'http', host: HOST_N8N },
    ],
    negativos: matrizControlesNegativos().filter((c) => c.entrada === 'https'),
  };
}
/** Fase 1 (regla ANTIGUA): una celda https decisiva debe LLEGAR a n8n por su router https (no bloqueada); es lo que ocurrió en el VPS. Con la ruta abierta debe alcanzarse el canario. */
export function evaluarAntiguoNoBloquea(celda, r) {
  const motivos = [];
  const cls = clasificarRespuesta(r);
  if (r.error && !r.estado) motivos.push(`sin respuesta (${r.error})`);
  if (cls === 'traefik:403') motivos.push('la regla antigua bloqueó por TLS: NO se reproduce el fallo de E2');
  if (/\|abierto\|/.test(celda.id) && cls !== 'canario-alcanzado') motivos.push(`la ruta abierta no alcanzó el canario (${cls})`);
  if (!/\|abierto\|/.test(celda.id) && !/^n8n:/.test(cls) && cls !== 'canario-alcanzado') motivos.push(`la respuesta no es de n8n (${cls})`);
  if (!r.log) motivos.push('sin línea en el registro de acceso');
  else if (!/^n8n-https/.test(String(r.log.RouterName ?? ''))) motivos.push(`el router no es el de n8n por https (${r.log.RouterName ?? 'sin router'})`);
  return { id: celda.id, ok: motivos.length === 0, motivos, router: r.log?.RouterName ?? null };
}
/** Un control http con redirección: 301/302/307/308 hacia https, sin llegar al origen. */
export function evaluarRedireccion(celda, r) {
  const motivos = [];
  if (![301, 302, 307, 308].includes(r.estado)) motivos.push(`estado ${r.estado} (se esperaba una redirección)`);
  const loc = String(r.cabeceras?.location ?? '');
  if (!/^https:\/\//i.test(loc)) motivos.push(`Location «${loc.slice(0, 60)}» no apunta a https`);
  if (r.log && Number(r.log.OriginStatus ?? 0) > 0) motivos.push('la petición llegó al origen en lugar de redirigirse');
  return { id: celda.id, ok: motivos.length === 0, motivos, estado: r.estado ?? null };
}
/** Redirección en el ENTRYPOINT: la petición http a la ruta del lector se redirige (el router http del bloqueo no llega a verla) y la redirigida a https queda bloqueada por el router con TLS. */
export function evaluarRedirEntrypoint({ http, https }) {
  const motivos = [];
  if (![301, 308].includes(http?.estado)) motivos.push(`http: estado ${http?.estado} (se esperaba una redirección permanente)`);
  if (!/^https:\/\//i.test(String(http?.cabeceras?.location ?? ''))) motivos.push('http: Location no apunta a https');
  if (clasificarRespuesta(https ?? {}) !== 'traefik:403') motivos.push(`https tras la redirección: ${clasificarRespuesta(https ?? {})} (se esperaba traefik:403)`);
  return { ok: motivos.length === 0, motivos };
}
/** Veredicto de la fase TLS. Cada bloque es una lista de { id, ok } ya evaluada; los demás datos los aporta el lanzador. */
export function veredictoTls(d) {
  const fallos = [];
  const mal = (lista) => (lista ?? []).filter((c) => !c.ok);
  const exigir = (nombre, lista, minimo) => {
    const l = lista ?? [];
    if (l.length < minimo) fallos.push(`${nombre}: solo ${l.length} celdas (se exigen al menos ${minimo})`);
    const m = mal(l);
    if (m.length) fallos.push(`${nombre}: ${m.length} no cumplen (${m.slice(0, 4).map((c) => c.id).join(', ')})`);
  };
  exigir('T0 · base sin regla (https llega a n8n)', d.base, 2);
  exigir('T1 · regla ANTIGUA sobre TLS (reproduce E2: no bloquea por https)', d.antiguoHttps, 2);
  exigir('T1 · regla ANTIGUA por http (sí bloquea)', d.antiguoHttp, 1);
  exigir('T2 · candidato: bloqueo por TLS (matriz reducida)', d.nuevoBloqueo, 15);
  exigir('T2 · candidato: SNI, Host y HTTP/2', d.nuevoSniH2, 7);
  exigir('T2 · candidato: controles https', d.nuevoControles, 4);
  exigir('T2 · candidato: controles negativos https', d.nuevoNegativos, 10);
  exigir('T2 · candidato: controles http (redirección)', d.nuevoHttpControles, 2);
  if (d.reversion?.restaurado !== true) fallos.push('T3 · tras retirar el candidato el canario abierto no vuelve a alcanzarse por https');
  if (d.reversion?.cfgIgualAlInicio !== true) fallos.push('T3 · el volumen de configuración no queda idéntico al inicial (solo main.yaml, mismo hash)');
  if (d.redirEntrypoint?.ok !== true) fallos.push(`T4 · redirección en el entrypoint: ${(d.redirEntrypoint?.motivos ?? ['no ejecutada']).join('; ')}`);
  if (d.hashes?.original !== HASH_REGLA_VALIDADA || d.hashes?.originalDespues !== HASH_REGLA_VALIDADA) fallos.push('la regla ORIGINAL (custom.yaml) no está intacta');
  if (d.hashes?.candidata !== HASH_CANDIDATA_TLS || d.hashes?.candidataEnVolumen !== HASH_CANDIDATA_TLS) fallos.push('el candidato no coincide con el hash fijado (archivo y volumen)');
  if (d.existentesIntactos !== true) fallos.push('los tres contenedores locales preexistentes cambiaron (id, arranque o estado)');
  if (d.proyectoLimpio !== true) fallos.push('quedaron recursos de tai-prueba-tf sin limpiar');
  if (d.contexto !== 'desktop-linux') fallos.push(`contexto de Docker «${d.contexto}»`);
  return { ok: fallos.length === 0, fallos };
}
