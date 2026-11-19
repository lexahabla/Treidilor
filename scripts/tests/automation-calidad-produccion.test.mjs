// Agente 04 — Calidad del catálogo, ETAPA 5: el workflow de PRODUCCIÓN (generado, SIN importar ni ejecutar) sólo contiene los destinos y operaciones autorizados.
// Todo en memoria: el «fetch» es el sitio sintético puro (sin sockets, sin red, sin Docker, sin credenciales reales, sin producción).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const J = (p) => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));
const plano = (x) => JSON.parse(JSON.stringify(x));
const { simularWorkflow, crearAlmacenSimulado } = await import('../automation/simulate-workflow.mjs');
const { comprobarWorkflow } = await import('../automation/lint-workflows.mjs');
const { construirTodo } = await import('../automation/build-workflows.mjs');
const S = await import('../../automation/dev/prueba-data-tables/sitio-calidad.mjs');
const SEG = await import('../../automation/lib/seguimiento.mjs');
const POL = await import('../../automation/lib/urlPolicyCalidad.mjs');

const PROD = J('automation/workflows/calidad-catalogo.produccion.json');
const LOCAL = J('automation/workflows/calidad-catalogo.local.json');
const TABLA_WF = J('automation/workflows/calidad-instantaneas-crear-tabla.json');
const AUD_PROD = J('automation/workflows/auditor-general.produccion.json');
const CFG = J('automation/config/calidad.produccion.json');
const CFG_LOCAL = J('automation/config/calidad.local.json');
const TABLA = 'calidad_catalogo_instantaneas';
const CRED = 'Treidilor — Catálogo (solo lectura)';
const TOKEN_FICTICIO = `Bearer tai_0123456789abcdef_${'A'.repeat(43)}`; // forma del token, valor FICTICIO: el «fetch» lo añade como lo haría n8n con la credencial
const nodo = (n, wf = PROD) => wf.nodes.find((x) => x.name === n);
const lint = (wf, nombreArchivo = 'calidad-catalogo.produccion.json') => comprobarWorkflow(wf, { nombreArchivo });
const columnas = { [TABLA]: SEG.COLUMNAS_INSTANTANEAS };
/** Todas las reglas que aplica la guardia de producción: la política general + las reglas de producción. */
const errs = (cfg) => POL.validarConfigCalidad(cfg).concat(POL.validarProduccionCalidad(cfg));

/** Ejecuta el workflow de PRODUCCIÓN en el simulador. El «fetch» sólo acepta https://treidilor.com y lo responde el sitio sintético; cualquier otro destino lanza. */
function ejecutar({ escenario = 'calidad_base', wf = PROD, almacen, sitio, id = 1, mode = 'test', ahora = S.FECHA_BASE, host = 'treidilor.com' } = {}) {
  const estado = sitio ?? S.crearEstado(escenario);
  if (sitio) estado.escenario = escenario;
  const vistas = [];
  const puente = ({ url, metodo, credencial, cabeceras, t, redirecciones }) => {
    const u = new URL(url);
    vistas.push({ url, metodo, credencial, host: u.host, protocolo: u.protocol, redirecciones, t });
    if (u.host !== host || u.protocol !== 'https:') throw new Error(`DESTINO NO AUTORIZADO: ${url}`);
    const r = S.procesar({ metodo, url: u.pathname + u.search, cabeceras: { ...cabeceras, ...(credencial ? { authorization: TOKEN_FICTICIO } : {}) }, t }, estado);
    if (r.destruir) throw new Error('socket hang up');
    if (r.retardoMs > 15000) throw new Error('timeout of 15000ms exceeded');
    return { statusCode: r.estado, headers: r.cabeceras, body: r.cuerpo };
  };
  const res = simularWorkflow(wf, { fetchSimulado: puente, ahora, hostsPermitidos: [host], almacen, ejecucion: { mode, id } });
  const informe = plano(res.salidas.get('Informe')[0].json);
  const conf = res.salidas.get('Confirmar escritura')?.[0]?.json;
  return { res, informe, final: conf ? plano(conf) : informe, vistas, almacen };
}
const almacenNuevo = () => crearAlmacenSimulado([TABLA], columnas);
const filas = (a) => a.tablas[TABLA]?.filas ?? [];

/* ═════════ 1. Configuración y política de producción ═════════ */
test('configuración de producción: válida, host único treidilor.com, límites del cliente (10/min, 8 páginas, 7 s) y credencial por nombre; distinta de la local', () => {
  assert.deepEqual(errs(CFG), []);
  assert.equal(CFG.entorno, 'produccion');
  assert.equal(CFG.baseUrl, 'https://treidilor.com');
  assert.deepEqual(CFG.hostsPermitidos, ['treidilor.com']);
  assert.equal(CFG.modo, 'lectura_catalogo');
  assert.equal(CFG.maxPaginasCatalogo, 8);
  assert.equal(CFG.limitePorPagina, 100);
  assert.equal(CFG.peticionesPorMinuto, 10);
  assert.equal(CFG.pausaMs, 7000);
  assert.equal(CFG.credencialCatalogo, CRED);
  assert.equal(CFG.seguimiento.tabla, TABLA);
  assert.notEqual(CFG.seguimiento.tabla, 'auditor_general_instantaneas');
  assert.equal(CFG_LOCAL.seguimiento.tabla, TABLA, 'misma tabla (en otra instalación de n8n); el entorno separa las filas');
  assert.ok(!JSON.stringify(CFG).match(/tai_[0-9a-f]{16}|Bearer|authorization|password|secret/i), 'sin secretos');
});

test('la política de producción rechaza cualquier configuración que se salga de los límites autorizados', () => {
  const malas = {
    'otro host': { ...CFG, baseUrl: 'https://otro.example', hostsPermitidos: ['otro.example'] },
    'subdominio': { ...CFG, baseUrl: 'https://www.treidilor.com', hostsPermitidos: ['www.treidilor.com'] },
    'http': { ...CFG, baseUrl: 'http://treidilor.com' },
    'host local en producción': { ...CFG, baseUrl: 'http://puente-treidilor:4350', hostsPermitidos: ['puente-treidilor:4350'] },
    'dos hosts': { ...CFG, hostsPermitidos: ['treidilor.com', 'otro.example'] },
    'pausa 6999 ms': { ...CFG, pausaMs: 6999 },
    'pausa 0': { ...CFG, pausaMs: 0 },
    '11 peticiones/min': { ...CFG, peticionesPorMinuto: 11, pausaMs: 7000 },
    '9 páginas': { ...CFG, maxPaginasCatalogo: 9 },
    '101 por página': { ...CFG, limitePorPagina: 101 },
    'sin credencial': { ...CFG, credencialCatalogo: '' },
    'credencial en blanco': { ...CFG, credencialCatalogo: '   ' },
    'tabla del Auditor': { ...CFG, seguimiento: { ...CFG.seguimiento, tabla: 'auditor_general_instantaneas' } },
    'modo distinto': { ...CFG, modo: 'publico' },
    'baseUrl con ruta': { ...CFG, baseUrl: 'https://treidilor.com/api' },
    'credenciales en la URL': { ...CFG, baseUrl: 'https://usuario:clave@treidilor.com' },
    'entorno desconocido': { ...CFG, entorno: 'staging' },
  };
  for (const [que, cfg] of Object.entries(malas)) assert.notDeepEqual(errs(cfg), [], `debería rechazar: ${que}`);
  // la configuración local sigue siendo válida y no puede apuntar a producción
  assert.deepEqual(errs(CFG_LOCAL), []);
  assert.notDeepEqual(errs({ ...CFG_LOCAL, baseUrl: 'https://treidilor.com', hostsPermitidos: ['treidilor.com'] }), []);
  assert.equal(fs.readFileSync(path.join(RAIZ, 'automation/workflows/calidad-catalogo.local.json'), 'utf8').includes('validarProduccionCalidad'), false, 'el workflow local no lleva las reglas de producción ni menciona el dominio real');
  // la URL: sólo el feed, sólo limit y page, sólo https://treidilor.com
  const ok = (u) => POL.evaluarUrlCalidad(u, CFG);
  assert.equal(ok('https://treidilor.com/api/automation/v1/catalog?limit=100&page=2').ok, true);
  for (const u of ['https://treidilor.com/api/automation/v1/me', 'https://treidilor.com/api/v1/products', 'https://treidilor.com/out/x', 'https://treidilor.com/api/redirect?id=1', 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=9', 'https://treidilor.com/api/automation/v1/catalog?limit=101&page=1', 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1&category=x', 'http://treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'https://www.treidilor.com/api/automation/v1/catalog?limit=100&page=1', 'https://treidilor.com:8443/api/automation/v1/catalog?limit=100&page=1', 'https://treidilor.com/api/automation/v1/catalog?limit=100&page=1#x', 'https://u:p@treidilor.com/api/automation/v1/catalog?limit=100&page=1']) assert.equal(ok(u).ok, false, u);
});

/* ═════════ 2. El archivo generado ═════════ */
test('estructura: inactivo, sólo disparador manual, sin Schedule ni webhooks, mismos nodos y orden que el local validado en n8n real', () => {
  assert.equal(PROD.name, 'Treidilor AI · Calidad del catálogo v0 (produccion)');
  assert.equal(PROD.active, false);
  assert.ok(!('pinData' in PROD));
  assert.deepEqual(PROD.nodes.map((n) => n.name), LOCAL.nodes.map((n) => n.name));
  assert.deepEqual(PROD.nodes.map((n) => n.type), LOCAL.nodes.map((n) => n.type));
  assert.deepEqual(PROD.nodes.map((n) => n.typeVersion), LOCAL.nodes.map((n) => n.typeVersion));
  assert.deepEqual(PROD.connections, LOCAL.connections, 'mismas conexiones');
  const disparadores = PROD.nodes.filter((n) => /Trigger$/i.test(n.type));
  assert.deepEqual(disparadores.map((n) => n.type), ['n8n-nodes-base.manualTrigger']);
  assert.ok(!PROD.nodes.some((n) => /schedule|webhook|cron|interval|formTrigger|chatTrigger|executeWorkflow|mcp|emailSend|slack/i.test(n.type)), 'sin disparadores automáticos ni servicios externos');
  assert.ok(PROD.nodes.every((n) => !n.disabled || n.type === 'n8n-nodes-base.stickyNote'));
  assert.equal(PROD.settings.executionTimeout, 900);
  assert.match(nodo('Aviso').parameters.content, /PRODUCCIÓN · INACTIVO/);
  assert.match(nodo('Aviso').parameters.content, /10 peticiones\/minuto, 500\/día, 8 páginas/);
});

test('el comprobador acepta el workflow de producción y lo generado está sincronizado con automation/lib byte a byte (determinista)', () => {
  const r = lint(PROD);
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, []);
  const todo = construirTodo();
  for (const f of ['calidad-catalogo.produccion.json', 'calidad-catalogo.local.json', 'calidad-instantaneas-crear-tabla.json']) {
    assert.equal(fs.readFileSync(path.join(RAIZ, 'automation/workflows', f), 'utf8').replace(/\r\n/g, '\n'), todo[f], f);
  }
  assert.equal(construirTodo()['calidad-catalogo.produccion.json'], todo['calidad-catalogo.produccion.json']);
});

test('compatibilidad con n8n 2.38.6: sólo tipos y versiones del Auditor de producción más el nodo Wait v1.1 (núcleo de n8n, validado en n8n 2.38.6 local con runner interno y externo)', () => {
  const par = (wf) => new Set(wf.nodes.map((n) => `${n.type}@${n.typeVersion}`));
  const aud = par(AUD_PROD);
  const nuevos = [...par(PROD)].filter((p) => !aud.has(p));
  assert.deepEqual(nuevos, ['n8n-nodes-base.wait@1.1'], 'el único tipo que el Auditor de producción no usa es el Wait');
  assert.ok(Buffer.byteLength(JSON.stringify(PROD)) < 300000);
  for (const n of PROD.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) assert.ok(Buffer.byteLength(n.parameters.jsCode) < 80000, `${n.name} < 80 kB`);
});

/* ═════════ 3. Destinos y operaciones autorizados ═════════ */
test('destinos: sólo dos nodos HTTP, GET, URL fijada por el código, sin cuerpo ni redirecciones, pausa de 7 s, cabeceras mínimas y credencial por NOMBRE', () => {
  const https = PROD.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.deepEqual(https.map((n) => n.name), ['Pedir catálogo', 'Pedir catálogo (resto)']);
  for (const n of https) {
    const p = n.parameters;
    assert.equal(p.method, 'GET');
    assert.equal(p.url, '={{ $json.url }}', 'la URL la fija el código con la política, no el workflow');
    assert.ok(!p.sendBody && !p.jsonBody && !p.bodyParameters && !p.sendQuery && !p.queryParameters);
    assert.equal(p.options.redirect.redirect.followRedirects, false);
    assert.equal(p.options.timeout, 15000);
    assert.equal(p.options.batching.batch.batchSize, 1);
    assert.ok(p.options.batching.batch.batchInterval >= 7000);
    assert.equal(n.retryOnFail, false, 'sin reintentos automáticos: cada reintento gastaría cuota');
    assert.equal(p.authentication, 'genericCredentialType');
    assert.equal(p.genericAuthType, 'httpHeaderAuth');
    assert.deepEqual(n.credentials, { httpHeaderAuth: { id: 'REEMPLAZAR_AL_IMPORTAR', name: CRED } }, 'por nombre; id de relleno, nunca el de una instalación');
    assert.deepEqual(p.headerParameters.parameters.map((h) => h.name).sort(), ['User-Agent', 'X-Treidilor-Agente']);
  }
  assert.ok(PROD.nodes.filter((n) => n.credentials).length === 2, 'ningún otro nodo lleva credenciales');
});

test('no hay secretos ni credenciales incrustados, ni otros dominios, ni salida de afiliado, API de escritura, panel o IA', () => {
  const texto = JSON.stringify(PROD);
  assert.ok(!/tai_[0-9a-f]{16}_[A-Za-z0-9]{20,}/.test(texto), 'sin token de automatización');
  assert.ok(!/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/.test(texto), 'sin Bearer con valor');
  assert.ok(!/"authorization"\s*:/i.test(texto));
  assert.ok(!/(password|secret|apiKey|api_key|token)\s*[:=]\s*['"][^'"\s]{3,}['"]/i.test(texto), 'sin valores asignados a claves (la palabra «password» sólo aparece en el código que RECHAZA credenciales en URLs)');
  assert.ok(!/TRADYLOR_API_TOKEN|ADMIN_PASSWORD|OPENAI|ANTHROPIC|GROQ|GEMINI|SCRAPER_API|APIFY/i.test(texto), 'sin nombres de claves de servicios');
  // dominios: sólo treidilor.com (el resto de la biblioteca no contiene URLs absolutas)
  const urls = [...texto.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)].map((m) => m[0]);
  assert.ok(urls.length > 0 && urls.every((u) => u === 'https://treidilor.com'), `dominios: ${[...new Set(urls)].join(', ')}`);
  // los nodos Code no contienen llamadas de red directas, ni escritura, ni IA
  for (const n of PROD.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    const js = n.parameters.jsCode;
    assert.ok(!/\b(fetch|XMLHttpRequest|require|process|child_process|eval|Function)\s*\(/.test(js), `${n.name}: sin llamadas directas`);
    assert.ok(!/\$helpers|httpRequest\s*\(|\$env|\$secrets|\$credentials/.test(js), `${n.name}: sin helpers de red ni acceso a secretos`);
  }
  // tipos de nodo: sin nada que escriba hacia fuera
  assert.deepEqual([...new Set(PROD.nodes.map((n) => n.type.replace('n8n-nodes-base.', '')))].sort(), ['code', 'dataTable', 'httpRequest', 'manualTrigger', 'stickyNote', 'wait']);
});

test('Data Table: sólo listar, leer e insertar en calidad_catalogo_instantaneas (propia), filtrando por entorno «produccion»; nunca la del Auditor ni borrar/actualizar', () => {
  const dts = PROD.nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable');
  assert.deepEqual(dts.map((n) => `${n.name}:${n.parameters.operation}`), ['Comprobar tabla:list', 'Leer historial:get', 'Guardar instantánea:insert']);
  assert.equal(dts[0].parameters.options.filterName, TABLA);
  for (const n of dts.slice(1)) assert.deepEqual(n.parameters.dataTableId, { __rl: true, mode: 'name', value: TABLA });
  assert.deepEqual(nodo('Leer historial').parameters.filters.conditions, [{ condition: 'eq', keyName: 'entorno', keyValue: 'produccion' }]);
  assert.equal(nodo('Leer historial').parameters.limit, 60);
  assert.equal(nodo('Guardar instantánea').onError, 'continueErrorOutput');
  assert.equal(nodo('Guardar instantánea').retryOnFail, false, 'el Insert no se reintenta solo (duplicaría la instantánea)');
  assert.ok(!/delete|update|upsert|deleteRows|drop|truncate/i.test(JSON.stringify(dts.map((n) => n.parameters.operation))));
  const parametros = JSON.stringify(PROD.nodes.map((n) => n.parameters && (n.type === 'n8n-nodes-base.code' ? null : n.parameters)));
  assert.ok(!parametros.includes('auditor_general_instantaneas'), 'ningún nodo referencia la tabla del Auditor');
  // el workflow de preparación: sólo crea la tabla propia, sin red ni credenciales ni tabla del Auditor
  assert.deepEqual(TABLA_WF.nodes.map((n) => n.type.replace('n8n-nodes-base.', '')), ['manualTrigger', 'stickyNote', 'dataTable']);
  const crear = TABLA_WF.nodes.find((n) => n.type === 'n8n-nodes-base.dataTable').parameters;
  assert.equal(crear.operation, 'create');
  assert.equal(crear.tableName, TABLA);
  assert.equal(crear.options.createIfNotExists, true);
  assert.deepEqual(crear.columns.column.map((c) => c.name), SEG.COLUMNAS_INSTANTANEAS);
  assert.ok(!TABLA_WF.nodes.some((n) => n.credentials) && TABLA_WF.active === false);
  assert.deepEqual(lint(TABLA_WF, 'calidad-instantaneas-crear-tabla.json').errores, []);
});

test('el comprobador rechaza manipulaciones del workflow de producción (programación, webhook, credencial con id, host, pausa, escritura, workflow activo)', () => {
  const prueba = (cambia, patron) => { const w = plano(PROD); cambia(w); const e = lint(w).errores; assert.ok(e.some((x) => patron.test(x)), `${patron} ← ${e.join(' | ') || '(sin errores)'}`); };
  prueba((w) => { w.active = true; }, /inactivo/);
  prueba((w) => { w.nodes.push({ id: 'x', name: 'Programación', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300], parameters: {}, disabled: true }); }, /disparadores automáticos/);
  prueba((w) => { w.nodes.push({ id: 'x', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300], parameters: {} }); }, /no permitido|disparadores/);
  prueba((w) => { nodo('Pedir catálogo', w).credentials.httpHeaderAuth.id = 'AbCdEf123456'; }, /id de relleno/);
  prueba((w) => { nodo('Pedir catálogo', w).credentials.httpHeaderAuth.name = 'Otra credencial (solo lectura)'; }, /credencial/);
  prueba((w) => { nodo('Pedir catálogo', w).parameters.options.batching.batch.batchInterval = 1000; }, /pausa/);
  prueba((w) => { nodo('Pedir catálogo', w).parameters.method = 'POST'; }, /GET|método/i);
  prueba((w) => { nodo('Pedir catálogo (resto)', w).parameters.options.redirect.redirect.followRedirects = true; }, /redirecc/i);
  prueba((w) => { nodo('Guardar instantánea', w).parameters.operation = 'deleteRows'; }, /operación|operation|insert/i);
  prueba((w) => { const c = nodo('Configuración', w); c.parameters.jsCode = c.parameters.jsCode.replace('"hostsPermitidos": [\n    "treidilor.com"', '"hostsPermitidos": [\n    "otro.example"'); }, /aislamiento|política|host/i);
  prueba((w) => { const c = nodo('Configuración', w); c.parameters.jsCode = c.parameters.jsCode.replace('"pausaMs": 7000', '"pausaMs": 100'); }, /pausa|política/i);
  prueba((w) => { nodo('Informe', w).parameters.jsCode += "\nawait fetch('https://otro.example/x');"; }, /código con|fetch|red/i);
  prueba((w) => { const c = nodo('Configuración', w); c.parameters.jsCode = c.parameters.jsCode.split('.concat(validarProduccionCalidad(CONFIG))').join(''); }, /guardia de producción/);
  // un workflow de producción que NO es el del Agente 04 sigue sin poder llevar credenciales
  const aud = plano(AUD_PROD); const h = aud.nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest'); h.credentials = { httpHeaderAuth: { id: 'REEMPLAZAR_AL_IMPORTAR', name: 'Treidilor automatización (solo lectura)' } };
  assert.ok(comprobarWorkflow(aud, { nombreArchivo: 'auditor-general.produccion.json' }).errores.some((e) => /no pueden referenciar credenciales/.test(e)));
});

/* ═════════ 4. Comportamiento (simulador con el «fetch» sólo hacia treidilor.com) ═════════ */
test('simulación: toda petición es GET https a https://treidilor.com/api/automation/v1/catalog?limit&page, con credencial y sin redirecciones; nada más', () => {
  const almacen = almacenNuevo();
  const r = ejecutar({ almacen });
  assert.equal(r.vistas.length, 2, '131 productos → 2 páginas');
  for (const v of r.vistas) {
    assert.equal(v.metodo, 'GET');
    assert.equal(v.credencial, true);
    assert.equal(v.redirecciones, false);
    assert.match(v.url, /^https:\/\/treidilor\.com\/api\/automation\/v1\/catalog\?limit=100&page=[1-8]$/);
  }
  assert.deepEqual(r.vistas.map((v) => v.url.slice(-6)), ['page=1', 'page=2']);
  assert.equal(r.final.entorno, 'produccion');
  assert.equal(r.final.fuente?.host ?? r.final.alcance?.host ?? 'treidilor.com', 'treidilor.com');
  const f = filas(almacen);
  assert.equal(f.length, 1);
  assert.equal(f[0].entorno, 'produccion');
  assert.equal(f[0].host, 'treidilor.com');
  assert.equal(r.final.persistencia.escritura.resultado, 'guardada');
  const reg = S.verificarRegistroCalidad ? null : null; void reg;
});

test('comportamiento idéntico al validado en n8n real: misma cadena de ejecuciones en local y en producción da los mismos informes (salvo entorno y host)', () => {
  const secuencia = ['calidad_base', 'calidad_base', 'calidad_arreglado', 'calidad_mixto', 'calidad_sano', 'calidad_401', 'calidad_429_pagina2', 'calidad_pagina_corta', 'calidad_mixto'];
  const aP = almacenNuevo(); const aL = almacenNuevo(); let n = 0;
  const WFL = LOCAL;
  const alt = (x) => JSON.parse(JSON.stringify(x, (k, v) => (['generadoEn', 'idEjecucion', 'filaId', 'host', 'entorno', 'markdown', 'ahora'].includes(k) ? undefined : v)));
  for (const e of secuencia) {
    n++;
    const ahoraN = new Date(Date.parse(S.FECHA_BASE) + n * 3600000).toISOString();
    const rp = ejecutar({ escenario: e, almacen: aP, id: n, ahora: ahoraN });
    // local: otro host del «fetch» (la guardia del nodo exige su propia configuración)
    const estado = S.crearEstado(e);
    const puente = ({ url, metodo, credencial, cabeceras, t }) => { const u = new URL(url); const r = S.procesar({ metodo, url: u.pathname + u.search, cabeceras: { ...cabeceras, ...(credencial ? { authorization: TOKEN_FICTICIO } : {}) }, t }, estado); if (r.destruir) throw new Error('socket hang up'); if (r.retardoMs > 15000) throw new Error('timeout of 15000ms exceeded'); return { statusCode: r.estado, headers: r.cabeceras, body: r.cuerpo }; };
    const resL = simularWorkflow(WFL, { fetchSimulado: puente, ahora: ahoraN, hostsPermitidos: ['puente-treidilor:4350'], almacen: aL, ejecucion: { mode: 'test', id: n } });
    const rl = plano((resL.salidas.get('Confirmar escritura')?.[0] ?? resL.salidas.get('Informe')[0]).json);
    assert.deepEqual(alt(rp.final), alt(rl), `paso ${n} (${e})`);
  }
  assert.equal(filas(aP).length, filas(aL).length);
  assert.ok(filas(aP).every((f) => f.entorno === 'produccion' && f.host === 'treidilor.com'));
});

test('los fallos del feed (401, 403, 429, 500, corte, redirección, total incoherente, vacío, 801 productos) no guardan nada y no cambian la referencia', () => {
  const almacen = almacenNuevo();
  const h = (n) => new Date(Date.parse(S.FECHA_BASE) + n * 3600000).toISOString();
  ejecutar({ escenario: 'calidad_base', almacen, id: 1, ahora: h(0) });
  assert.equal(filas(almacen).length, 1);
  let id = 1;
  for (const e of ['calidad_401', 'calidad_403', 'calidad_429_pagina2', 'calidad_500_pagina2', 'calidad_conexion_cortada', 'calidad_redireccion', 'calidad_total_incoherente', 'calidad_vacio', 'calidad_repetidos', 'calidad_grande']) {
    const r = ejecutar({ escenario: e, almacen, id: ++id, ahora: h(id) });
    assert.equal(filas(almacen).length, 1, `${e}: no debe guardar`);
    assert.equal(r.final.persistencia.escritura.resultado, 'no_procede', e);
  }
  const r = ejecutar({ escenario: 'calidad_mixto', almacen, id: ++id, ahora: h(id) });
  assert.equal(r.final.seguimiento.modo, 'comparacion');
  assert.equal(filas(almacen).length, 2);
});

test('una sola página: se hace la petición marcador (limit=1&page=1), que evita la parada silenciosa de n8n, y se guarda la instantánea', () => {
  const almacen = almacenNuevo();
  const r = ejecutar({ escenario: 'calidad_pequeno', almacen });
  assert.deepEqual(r.vistas.map((v) => v.url.slice(v.url.indexOf('?'))), ['?limit=100&page=1', '?limit=1&page=1']);
  assert.equal(r.final.persistencia.escritura.resultado, 'guardada');
  assert.equal(filas(almacen).length, 1);
});

test('la configuración manipulada DENTRO del nodo detiene la ejecución antes de pedir nada', () => {
  for (const [de, a] of [['"pausaMs": 7000', '"pausaMs": 100'], ['"peticionesPorMinuto": 10', '"peticionesPorMinuto": 60'], ['"maxPaginasCatalogo": 8', '"maxPaginasCatalogo": 30'], ['"https://treidilor.com"', '"https://otro.example"']]) {
    const wf = plano(PROD);
    nodo('Configuración', wf).parameters.jsCode = nodo('Configuración', wf).parameters.jsCode.replace(de, a);
    assert.notEqual(nodo('Configuración', wf).parameters.jsCode, nodo('Configuración').parameters.jsCode);
    const vistas = [];
    assert.throws(() => simularWorkflow(wf, { fetchSimulado: (p) => { vistas.push(p); return { statusCode: 200, headers: {}, body: '{}' }; }, ahora: S.FECHA_BASE, hostsPermitidos: ['treidilor.com'], almacen: almacenNuevo(), ejecucion: { mode: 'test', id: 1 } }), /CONFIGURACI|configuraci/);
    assert.equal(vistas.length, 0, 'no se hizo ninguna petición');
  }
});

/* ═════════ 5. Límites: 10/min, 500/día, 8 páginas, pausa de 7 s ═════════ */
/** Modelo del limitador del servidor (src/lib/rateLimit.ts + automationApi.ts): ventana FIJA de 60 s por cliente, que se abre con la primera petición; cuota diaria por día UTC. */
function ventanaFija(instantes, max = 10, ventanaMs = 60000) {
  let inicio = null; let n = 0; let rechazadas = 0; let maxVisto = 0;
  for (const t of [...instantes].sort((a, b) => a - b)) {
    if (inicio === null || t - inicio >= ventanaMs) { inicio = t; n = 0; }
    n++; maxVisto = Math.max(maxVisto, n); if (n > max) rechazadas++;
  }
  return { rechazadas, maxVisto };
}
const deslizante = (instantes, ventanaMs = 60000) => Math.max(0, ...instantes.map((t) => instantes.filter((x) => x >= t && x < t + ventanaMs).length));

test('límites: una ejecución de 8 páginas hace 8 peticiones (≤ 10/min), con 7 s entre CUALESQUIERA dos peticiones (Wait + batching) y nunca más de 8 páginas', () => {
  const r = ejecutar({ escenario: 'calidad_800', almacen: almacenNuevo() });
  const t = r.vistas.map((v) => v.t);
  assert.equal(r.vistas.length, 8);
  assert.deepEqual(r.vistas.map((v) => v.url.match(/page=(\d)/)[1]), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.ok(deslizante(t) <= 10, `máximo en 60 s: ${deslizante(t)}`);
  assert.deepEqual(ventanaFija(t), { rechazadas: 0, maxVisto: 8 });
  // huecos: 7 s exactos entre todas las peticiones; el Wait cubre el salto entre la página 1 y la 2 (nodos distintos)
  const huecos = t.slice(1).map((x, i) => x - t[i]);
  assert.deepEqual(huecos, [7000, 7000, 7000, 7000, 7000, 7000, 7000]);
  assert.ok(huecos.every((h) => h >= CFG.pausaMs));
  assert.equal(r.res.virtualMs, 49000, 'duración virtual de la lectura: 7 pausas de 7 s');
  // 801 productos: nunca se pide una novena página
  const g = ejecutar({ escenario: 'calidad_grande', almacen: almacenNuevo() });
  assert.equal(g.vistas.length, 8);
  assert.ok(g.vistas.every((v) => Number(v.url.match(/page=(\d+)/)[1]) <= 8));
  // el catálogo actual (131 productos) son 2 peticiones
  assert.equal(ejecutar({ almacen: almacenNuevo() }).vistas.length, 2);
});

test('intervalo mínimo seguro entre ejecuciones manuales: ≥ 2 minutos (y ≥ 60 s tras la última petición); dos ejecuciones de 8 páginas seguidas SÍ superarían las 10/min', () => {
  const una = ejecutar({ escenario: 'calidad_800', almacen: almacenNuevo() }).vistas.map((v) => v.t); // 0,0,7,…,42 s
  const corrida = (separacionMs, veces) => Array.from({ length: veces }, (_, k) => una.map((t) => t + k * separacionMs)).flat();
  // seguidas (sin esperar): el servidor devolvería 429
  assert.ok(ventanaFija(corrida(una.at(-1), 6)).rechazadas > 0, 'sin esperar, se supera');
  assert.ok(deslizante(corrida(una.at(-1), 6)) > 10);
  // 2 minutos entre ejecuciones (inicio a inicio 120 s): nunca más de 8 por ventana, ni fija ni deslizante, con muchas ejecuciones seguidas
  for (const sep of [120000, 150000, 180000]) {
    const t = corrida(sep, 12);
    assert.deepEqual(ventanaFija(t), { rechazadas: 0, maxVisto: 8 }, `${sep} ms`);
    assert.ok(deslizante(t) <= 8, `${sep} ms: ${deslizante(t)}`);
  }
  // incluso con el peor desfase de la ventana fija (anclada por OTRAS peticiones del mismo token, hasta 2 de ellas justo antes): sigue sin pasar de 10
  for (const desfase of [0, 10000, 30000, 59000]) {
    const otras = [-desfase, -desfase];
    assert.ok(ventanaFija([...otras, ...corrida(120000, 6)]).rechazadas === 0, `desfase ${desfase}`);
  }
  // la ventana fija sólo admite 8 + 2 peticiones: el límite teórico de una 2.ª ejecución anclada en la 1.ª es ~53 s; se recomienda NO apurarlo
  const ajustado = corrida(53000, 6);
  assert.equal(ventanaFija(ajustado).rechazadas, 0, 'el teórico se cumple…');
  assert.ok(ventanaFija(corrida(40000, 3)).rechazadas > 0, '…pero a 40 s ya se supera: por eso se recomiendan ≥ 120 s');
});

test('cuota diaria: el catálogo actual gasta 2 peticiones por ejecución y el peor caso 8; con 500/día quedan ≥ 62 ejecuciones máximas y un margen amplio para otros usos del token', () => {
  const peor = 8;
  const actual = ejecutar({ almacen: almacenNuevo() }).vistas.length;
  assert.equal(actual, 2);
  assert.equal(Math.floor(500 / peor), 62);
  assert.equal(Math.floor(500 / actual), 250);
  const recomendado = 20; // ejecuciones manuales por día recomendadas mientras se calibra
  assert.ok(recomendado * peor <= 0.35 * 500, `${recomendado * peor} de 500 en el peor caso`);
  assert.ok(CFG.maxPaginasCatalogo * 1 <= 8);
});

/* ═════════ 6. El Auditor General y la web no cambian ═════════ */
test('los workflows del Auditor, el Investigador y el diagnóstico siguen idénticos a HEAD, y el feed y la web no se tocan', () => {
  const git = (...a) => spawnSync('git', a, { cwd: RAIZ, encoding: 'utf8' });
  if (git('rev-parse', '--is-inside-work-tree').stdout.trim() !== 'true') return;
  for (const f of ['automation/workflows/auditor-general.local.json', 'automation/workflows/auditor-general.produccion.json', 'automation/workflows/auditor-instantaneas-crear-tabla.json', 'automation/workflows/investigador-comercial.local.json', 'automation/dev/diagnostico-auditor-produccion.json', 'automation/lib/urlPolicy.mjs', 'automation/lib/common.mjs', 'automation/lib/seguimiento.mjs', 'src/pages/api/automation/v1/catalog.ts', 'src/lib/automationApi.ts']) {
    assert.equal(git('diff', '--quiet', 'HEAD', '--', f).status, 0, `${f} no debe cambiar`);
  }
});

test('la guía de despliegue cita las huellas SHA-256 VIGENTES de los dos archivos (si cambian, hay que regenerar la guía) y describe el Wait y los límites del runner reproducido', async () => {
  const { createHash } = await import('node:crypto');
  const sha = (p) => createHash('sha256').update(fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  const guia = fs.readFileSync(path.join(RAIZ, 'automation/docs/GUIA-DESPLIEGUE-AGENTE-04-PRODUCCION.md'), 'utf8');
  assert.ok(guia.includes(sha('automation/workflows/calidad-catalogo.produccion.json')), 'huella vigente del workflow de producción');
  assert.ok(guia.includes(sha('automation/workflows/calidad-instantaneas-crear-tabla.json')), 'huella vigente del workflow de preparación');
  assert.match(guia, /Wait/);
  assert.match(guia, /16 nodos/);
  assert.match(guia, /no es la imagen oficial/i);
  const doc = fs.readFileSync(path.join(RAIZ, 'automation/docs/AGENTE-04-CALIDAD.md'), 'utf8');
  assert.ok(doc.includes(sha('automation/workflows/calidad-catalogo.produccion.json')), 'el documento del agente cita la huella vigente');
});

test('runner externo de prueba: el Compose no publica puertos ni lleva el token (sólo una variable obligatoria del .env fuera del repo) y el lanzador no imprime secretos ni habla con otro destino', () => {
  const t = fs.readFileSync(path.join(RAIZ, 'automation/dev/prueba-data-tables/docker-compose.runner.yml'), 'utf8').replace(/\r\n/g, '\n');
  const sin = t.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, '')).join('\n');
  assert.ok(!/^\s*ports:/m.test(sin) && !/extra_hosts|network_mode|privileged|docker\.sock|cap_add/.test(sin));
  assert.ok(!/^networks:/m.test(sin), 'no define ni toca redes');
  assert.equal((sin.match(/\$\{PRUEBA_DT_RUNNER_TOKEN:\?[^}]+\}/g) ?? []).length, 2, 'el token viene de una variable obligatoria (n8n y runner)');
  assert.ok(!/N8N_RUNNERS_AUTH_TOKEN:\s*['"]?[A-Za-z0-9]{8,}/.test(sin), 'ningún token literal');
  assert.match(sin, /N8N_RUNNERS_MODE: external/);
  assert.match(sin, /read_only: true/);
  assert.match(sin, /cap_drop: \[ALL\]/);
  assert.match(sin, /no-new-privileges:true/);
  assert.match(sin, /N8N_RUNNERS_TASK_BROKER_URI: http:\/\/n8n:5679/);
  assert.ok(!/treidilor\.com/.test(sin));
  const l = fs.readFileSync(path.join(RAIZ, 'automation/dev/prueba-data-tables/lanzador-runner-prueba.mjs'), 'utf8');
  assert.deepEqual([...l.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['node:child_process']);
  assert.ok(!/console\.(log|error|warn)\([^)]*\b(TOKEN|grant|env)\b/i.test(l.replace(/log\(`grant token obtenido[^`]*`\)/, '')), 'no imprime tokens');
  assert.ok(!/treidilor\.com|https:\/\//.test(l), 'sólo habla con el broker declarado por variable (http, red aislada)');
  assert.ok(l.includes('[a-z0-9.-]+:') && l.includes('process.exit(2)'), 'el lanzador exige un broker http://host:puerto y se niega a arrancar sin él');
});
