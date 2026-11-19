// Agente 04 — Calidad del catálogo, ETAPA 3: el WORKFLOW local de n8n (generado por el constructor) validado en el simulador contra el sitio sintético.
// Sin red, sin n8n, sin Docker, sin credenciales reales, sin producción. Complementa las pruebas del motor (etapas 1 y 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const J = (p) => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));
const plano = (x) => JSON.parse(JSON.stringify(x));
const { simularWorkflow, crearAlmacenSimulado } = await import('../automation/simulate-workflow.mjs');
const { comprobarWorkflow } = await import('../automation/lint-workflows.mjs');
const { construirTodo } = await import('../automation/build-workflows.mjs');
const { validarEsquema } = await import('../automation/validate-schema.mjs');
const S = await import('../../automation/dev/prueba-data-tables/sitio-calidad.mjs');
const SEG = await import('../../automation/lib/seguimiento.mjs');
const COM = await import('../../automation/lib/common.mjs');

const WF = J('automation/workflows/calidad-catalogo.local.json');
const WF_TABLA = J('automation/workflows/calidad-instantaneas-crear-tabla.json');
const CFG = J('automation/config/calidad.local.json');
const SCHEMA = J('automation/schemas/informe-calidad.schema.json');
const TABLA = CFG.seguimiento.tabla;
const TABLA_AUDITOR = 'auditor_general_instantaneas';
const TOKEN_FICTICIO = `Bearer tai_0123456789abcdef_${'A'.repeat(43)}`;
const HOST = 'puente-treidilor:4350';
const T0 = Date.parse(S.FECHA_BASE);
const horas = (n) => new Date(T0 + n * 3600000).toISOString();

/** Una ejecución del workflow en el simulador contra el sitio sintético. */
function ejecutar({ escenario = 'calidad_base', wf = WF, almacen, sitio, id = 1, mode = 'test', ahora = S.FECHA_BASE, sinCredencial = false } = {}) {
  const estado = sitio ?? S.crearEstado(escenario);
  if (sitio) estado.escenario = escenario;
  const puente = ({ url, metodo, credencial, cabeceras, t }) => {
    const u = new URL(url);
    const r = S.procesar({ metodo, url: u.pathname + u.search, cabeceras: { ...cabeceras, ...(credencial && !sinCredencial ? { authorization: TOKEN_FICTICIO } : {}) }, t }, estado);
    if (r.destruir) throw new Error('socket hang up');
    if (r.retardoMs > 15000) throw new Error('timeout of 15000ms exceeded');
    return { statusCode: r.estado, headers: r.cabeceras, body: r.cuerpo };
  };
  const res = simularWorkflow(wf, { fetchSimulado: puente, ahora, hostsPermitidos: [HOST], almacen, ejecucion: { mode, id } });
  // JSON ida y vuelta: los valores vienen de otro contexto de ejecución (vm) y sus prototipos no coinciden con los de esta prueba
  const informe = plano(res.salidas.get('Informe')[0].json); // lo que sale del nodo Informe (antes de confirmar la escritura)
  const confirmado = res.salidas.get('Confirmar escritura')?.[0]?.json ? plano(res.salidas.get('Confirmar escritura')[0].json) : null;
  return { res, informe, confirmado, final: confirmado ?? informe, estado, almacen };
}
const almacenNuevo = (...tablas) => crearAlmacenSimulado(tablas.length ? tablas : [TABLA]);
const filas = (almacen, tabla = TABLA) => almacen.tablas[tabla]?.filas ?? [];
const incs = (informe, codigo) => informe.incidencias.filter((i) => i.regla === codigo);
const clavesDe = (lista) => lista.map((x) => x.clave).sort();
const nodo = (nombre, wf = WF) => wf.nodes.find((n) => n.name === nombre);
const bytes = (nombre, wf = WF) => Buffer.byteLength(nodo(nombre, wf).parameters.jsCode, 'utf8');
const lint = (wf, nombreArchivo = 'calidad-catalogo.local.json') => comprobarWorkflow(wf, { nombreArchivo });

/* ═════════ 1. Estructura del workflow generado ═════════ */
test('estructura: nodos, orden y conexiones del workflow (inicio manual, configuración, lectura paginada, análisis, informe, histórico, persistencia, confirmación)', () => {
  assert.equal(WF.name, 'Treidilor AI · Calidad del catálogo v0 (local)');
  assert.equal(WF.active, false);
  assert.deepEqual(WF.nodes.map((n) => n.name), ['Ejecutar a mano', 'Aviso', 'Configuración', 'Pedir catálogo', 'Páginas restantes', 'Pausa entre páginas', 'Pedir catálogo (resto)', 'Analizar', 'Uno tabla', 'Comprobar tabla', 'Uno historial', 'Leer historial', 'Informe', 'Solo la fila', 'Guardar instantánea', 'Confirmar escritura']);
  assert.deepEqual(WF.nodes.map((n) => n.type.replace('n8n-nodes-base.', '')), ['manualTrigger', 'stickyNote', 'code', 'httpRequest', 'code', 'wait', 'httpRequest', 'code', 'code', 'dataTable', 'code', 'dataTable', 'code', 'code', 'dataTable', 'code']);
  const cadena = ['Ejecutar a mano', 'Configuración', 'Pedir catálogo', 'Páginas restantes', 'Pausa entre páginas', 'Pedir catálogo (resto)', 'Analizar', 'Uno tabla', 'Comprobar tabla', 'Uno historial', 'Leer historial', 'Informe', 'Solo la fila', 'Guardar instantánea'];
  cadena.slice(0, -1).forEach((de, i) => assert.deepEqual(WF.connections[de], { main: [[{ node: cadena[i + 1], type: 'main', index: 0 }]] }, `${de} → ${cadena[i + 1]}`));
  assert.deepEqual(WF.connections['Guardar instantánea'], { main: [[{ node: 'Confirmar escritura', type: 'main', index: 0 }], [{ node: 'Confirmar escritura', type: 'main', index: 0 }]] }, 'las dos salidas del Insert llegan a «Confirmar escritura»');
  assert.equal(WF.connections['Confirmar escritura'], undefined);
  assert.equal(WF.settings.executionTimeout, 900);
  assert.equal(WF.settings.timezone, 'Europe/Madrid');
  assert.ok(!WF.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger' || n.type.includes('webhook')), 'sin programación ni webhooks');
  assert.match(nodo('Aviso').parameters.content, /SÓLO LECTURA/);
  assert.match(nodo('Aviso').parameters.content, new RegExp(TABLA));
  assert.match(nodo('Aviso').parameters.content, /Sólo se guardan ejecuciones COMPLETAS/);
});

test('el workflow cumple el comprobador de seguridad (sin errores ni avisos) y el generador lo reproduce byte a byte (sincronía)', () => {
  const r = lint(WF);
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(lint(WF_TABLA, 'calidad-instantaneas-crear-tabla.json').errores, []);
  const todo = construirTodo();
  for (const f of ['calidad-catalogo.local.json', 'calidad-instantaneas-crear-tabla.json']) {
    assert.equal(fs.readFileSync(path.join(RAIZ, 'automation/workflows', f), 'utf8').replace(/\r\n/g, '\n'), todo[f], f);
  }
  assert.equal(construirTodo()['calidad-catalogo.local.json'], todo['calidad-catalogo.local.json'], 'determinista');
});

test('tamaño de los nodos Code: «Analizar», «Informe» y «Confirmar escritura» quedan holgadamente por debajo de 80 kB y están separados por responsabilidad', () => {
  const tam = Object.fromEntries(WF.nodes.filter((n) => n.type === 'n8n-nodes-base.code').map((n) => [n.name, bytes(n.name)]));
  console.log(`  ℹ bytes por nodo Code: ${Object.entries(tam).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  for (const [n, b] of Object.entries(tam)) assert.ok(b <= 80000, `${n}: ${b} B`);
  assert.ok(tam.Analizar <= 55000 && tam.Informe <= 65000 && tam['Confirmar escritura'] <= 35000, 'margen holgado frente al límite');
  assert.ok(Math.max(...Object.values(tam)) <= 0.8 * 80000, 'ningún nodo supera el 80 % del límite');
  const js = (n) => nodo(n).parameters.jsCode;
  assert.ok(/function analizarCalidad/.test(js('Analizar')) && !/function (ejecutarSeguimiento|resumirInstantanea|compararConEstado)/.test(js('Analizar')), 'Analizar: reglas sin seguimiento');
  assert.ok(/function construirInformeDesdeAnalisis/.test(js('Informe')) && !/function (analizarCalidad|leerFeedCalidad|detectarDuplicados)/.test(js('Informe')), 'Informe: seguimiento sin reglas');
  assert.ok(/function confirmarEscrituraCalidad/.test(js('Confirmar escritura')) && !/function (analizarCalidad|leerFeedCalidad|resumirInstantanea)/.test(js('Confirmar escritura')), 'Confirmar: sólo la confirmación');
  assert.ok(Buffer.byteLength(JSON.stringify(WF)) < 300000, 'el workflow entero es manejable');
});

test('nodos HTTP: sólo GET, URL fijada por el código, sin cuerpo, sin redirecciones, con pausa entre peticiones, cabeceras mínimas y credencial por NOMBRE', () => {
  const https = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.deepEqual(https.map((n) => n.name), ['Pedir catálogo', 'Pedir catálogo (resto)']);
  for (const n of https) {
    const p = n.parameters;
    assert.equal(p.method, 'GET');
    assert.equal(p.url, '={{ $json.url }}');
    assert.ok(!p.sendBody && !p.jsonBody && !p.bodyParameters);
    assert.equal(p.options.redirect.redirect.followRedirects, false, 'redirecciones desactivadas');
    assert.equal(p.options.timeout, 15000);
    assert.equal(p.options.batching.batch.batchSize, 1);
    assert.ok(p.options.batching.batch.batchInterval >= CFG.pausaMs && p.options.batching.batch.batchInterval >= 60000 / CFG.peticionesPorMinuto, 'la pausa respeta las peticiones por minuto del cliente');
    assert.deepEqual(p.headerParameters.parameters.map((h) => h.name).sort(), ['User-Agent', 'X-Treidilor-Agente']);
    assert.equal(p.headerParameters.parameters.find((h) => h.name === 'X-Treidilor-Agente').value, 'calidad-catalogo');
    assert.equal(p.authentication, 'genericCredentialType');
    assert.equal(p.genericAuthType, 'httpHeaderAuth');
    assert.deepEqual(n.credentials, { httpHeaderAuth: { id: 'REEMPLAZAR_AL_IMPORTAR', name: CFG.credencialCatalogo } }, 'sólo el NOMBRE de la credencial; el id se asigna al importar');
    assert.equal(n.retryOnFail, false);
    assert.equal(n.onError, 'continueRegularOutput');
    assert.equal(p.options.response.response.neverError, true);
  }
  assert.ok(WF.nodes.filter((n) => n.credentials).every((n) => /^Pedir catálogo/.test(n.name)), 'ningún otro nodo lleva credenciales');
});

test('seguridad de credenciales: ningún token ni secreto en el JSON, ni siquiera de prueba; el token general de Treidilor ni se menciona', () => {
  for (const f of ['calidad-catalogo.local.json', 'calidad-instantaneas-crear-tabla.json']) {
    const texto = fs.readFileSync(path.join(RAIZ, 'automation/workflows', f), 'utf8');
    assert.ok(!/tai_[0-9a-f]{16}_/.test(texto), `${f}: sin tokens de la API de automatización`);
    assert.ok(!/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/.test(texto), `${f}: sin cabeceras Bearer con valor`);
    assert.ok(!/TRADYLOR_API_TOKEN|ADMIN_PASSWORD|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY/.test(texto), f);
    assert.ok(!/"(password|token|secret|apiKey|authorization)"\s*:\s*"[^"]{8,}"/i.test(texto), `${f}: sin valores en claves sensibles`);
    assert.ok(!/treidilor\.com/i.test(texto), `${f}: un workflow local no menciona producción`);
  }
  assert.ok(!JSON.stringify(WF).includes(TOKEN_FICTICIO));
  assert.equal(CFG.credencialCatalogo, 'Treidilor — Catálogo local (solo lectura)');
  assert.ok(!/api[_-]?key|token|secret|password/i.test(JSON.stringify(CFG)), 'la configuración tampoco lleva secretos');
});

test('el comprobador RECHAZA variantes inseguras del workflow (escritura, URL libre, redirecciones, ritmo, credenciales, secretos, tabla compartida, código con red)', () => {
  const malo = (cambia, esperado) => {
    const wf = plano(WF);
    cambia(wf);
    const r = lint(wf);
    assert.ok(r.errores.length > 0, `debe fallar: ${esperado}`);
    assert.ok(r.errores.some((e) => esperado.test(e)), `${esperado}: ${r.errores.join(' | ')}`);
  };
  const http = (wf, n = 'Pedir catálogo') => wf.nodes.find((x) => x.name === n);
  malo((wf) => { http(wf).parameters.method = 'POST'; }, /sólo se permiten peticiones GET/);
  malo((wf) => { http(wf).parameters.url = 'https://evil.example/x'; }, /URL debe ser exactamente/);
  malo((wf) => { http(wf).parameters.sendBody = true; }, /no se permite enviar cuerpo/);
  malo((wf) => { http(wf).parameters.options.redirect.redirect.followRedirects = true; }, /followRedirects debe ser false/);
  malo((wf) => { http(wf).parameters.options.batching.batch.batchInterval = 700; }, /pausa entre peticiones/);
  malo((wf) => { http(wf).parameters.options.batching.batch.batchSize = 2; }, /de una en una/);
  malo((wf) => { http(wf).parameters.headerParameters.parameters.push({ name: 'Authorization', value: 'Bearer tai_0123456789abcdef_' + 'A'.repeat(43) }); }, /sólo se permiten las cabeceras|Bearer/);
  malo((wf) => { http(wf).credentials.httpHeaderAuth.name = 'Credencial cualquiera'; }, /solo lectura|debe usar la credencial/);
  malo((wf) => { delete http(wf).credentials; }, /debe usar la credencial/);
  malo((wf) => { http(wf).name = 'Pedir otra cosa'; wf.connections['Pedir otra cosa'] = wf.connections['Pedir catálogo']; delete wf.connections['Pedir catálogo']; wf.connections.Configuración.main[0][0].node = 'Pedir otra cosa'; }, /sólo los nodos «Pedir catálogo…»/);
  malo((wf) => { wf.active = true; }, /active/);
  malo((wf) => { nodo('Analizar', wf).parameters.jsCode += '\nfetch("https://evil.example/x");'; }, /fetch/);
  malo((wf) => { nodo('Analizar', wf).parameters.jsCode += '\nconst k = "Bearer abcdefghijklmnopqrstuvwxyz0123456789";'; }, /Bearer|secreto/);
  malo((wf) => { nodo('Informe', wf).parameters.jsCode = nodo('Informe', wf).parameters.jsCode.replace(/"modo": "lectura_catalogo"/, '"modo": "publico"'); }, /lectura_catalogo|modo/);
  malo((wf) => { nodo('Informe', wf).parameters.jsCode = nodo('Informe', wf).parameters.jsCode.replace(TABLA, TABLA_AUDITOR); }, /tabla|Data table/);
  malo((wf) => { nodo('Informe', wf).parameters.jsCode = nodo('Informe', wf).parameters.jsCode.replace(/"baseUrl": "[^"]+"/, '"baseUrl": "https://treidilor.com"'); }, /aislamiento|lectura_catalogo|local/);
  malo((wf) => { nodo('Configuración', wf).parameters.jsCode = nodo('Configuración', wf).parameters.jsCode.replace('validarConfigCalidad(CONFIG)', 'true'); }, /guardia/);
  malo((wf) => { nodo('Guardar instantánea', wf).retryOnFail = true; }, /reintentar/);
  malo((wf) => { nodo('Guardar instantánea', wf).parameters.operation = 'upsert'; }, /operación de Data table no permitida/);
  malo((wf) => { nodo('Guardar instantánea', wf).parameters.columns.value.extra = '={{ $json.x }}'; }, /columnas del historial/);
  malo((wf) => { nodo('Leer historial', wf).parameters.dataTableId = { __rl: true, mode: 'id', value: '123' }; }, /NOMBRE fijo/);
  malo((wf) => { wf.nodes.push({ parameters: {}, name: 'Programación', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1, position: [0, 0] }); }, /programación debe ir desactivada/);
  malo((wf) => { wf.nodes.push({ parameters: {}, name: 'Comando', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, position: [0, 0] }); }, /tipo no permitido/);
});

/* ═════════ 2. Sitio sintético ═════════ */
test('sitio sintético: catálogo de 131 productos con los defectos, duplicados, equivalentes y variantes previstos; contrato automation-catalog/1 con paginación', () => {
  const ps = S.catalogoCalidad();
  assert.equal(ps.length, 131);
  assert.equal(new Set(ps.map((p) => p.id)).size, 131, 'ids únicos');
  const claves = ['id', 'title', 'category', 'categoryId', 'subcategoryId', 'network', 'merchant', 'price', 'currency', 'declaredPreviousPrice', 'verifiedDiscount', 'stock', 'rating', 'reviewsCount', 'ratingFlag', 'image', 'descriptionLength', 'hasAffiliateLink', 'capturedAt', 'verifiedAt', 'addedAt'];
  for (const p of ps) assert.deepEqual(Object.keys(p).sort(), [...claves].sort(), p.id);
  assert.equal(S.catalogoCalidad({ arreglado: true }).length, 131);
  const estado = S.crearEstado('calidad_base');
  const get = (url, auth = TOKEN_FICTICIO, t) => JSON.parse((() => { const r = S.procesar({ metodo: 'GET', url, cabeceras: auth ? { authorization: auth } : {}, t }, estado); return r.cuerpo; })());
  const p1 = get('/api/automation/v1/catalog?limit=100&page=1');
  assert.deepEqual([p1.success, p1.schema, p1.total, p1.page, p1.limit, p1.totalPages, p1.products.length], [true, 'automation-catalog/1', 131, 1, 100, 2, 100]);
  const p2 = get('/api/automation/v1/catalog?limit=100&page=2');
  assert.equal(p2.products.length, 31);
  assert.deepEqual([...p1.products, ...p2.products].map((p) => p.id), ps.map((p) => p.id), 'orden estable');
  assert.equal(get('/api/automation/v1/catalog?limit=10&page=14').products.length, 1);
  assert.equal(get('/api/automation/v1/catalog?limit=100&page=3').products.length, 0);
  assert.equal(get('/api/automation/v1/catalog?limit=100&page=1', null).code, 'no_autorizado');
  assert.equal(S.procesar({ metodo: 'POST', url: '/api/automation/v1/catalog?limit=1&page=1', cabeceras: { authorization: TOKEN_FICTICIO } }, estado).estado, 405);
  assert.equal(S.procesar({ metodo: 'GET', url: '/api/health', cabeceras: { authorization: TOKEN_FICTICIO } }, estado).estado, 404, 'el sitio de calidad sólo sirve el feed');
  assert.equal(S.procesar({ metodo: 'GET', url: '/api/automation/v1/catalog?limit=1&page=1', cabeceras: { authorization: 'Bearer token-real-no-ficticio' } }, estado).estado, 401, 'sólo acepta la FORMA de un token ficticio');
  assert.ok(Object.keys(S.ESCENARIOS_CALIDAD).length >= 17);
  assert.ok(!JSON.stringify(estado.registro).includes('0123456789abcdef'), 'el registro nunca guarda el valor de la credencial');
});

test('sitio sintético: el servidor local responde por HTTP real (loopback) con paginación, 401, 405 y 404', async () => {
  const puerto = 21000 + Math.floor(Math.random() * 2000);
  const srv = S.iniciarServidorCalidad({ puerto, puertoControl: puerto + 1, escenario: 'calidad_base', anfitrion: '127.0.0.1' });
  const pedir = (ruta, { metodo = 'GET', auth = TOKEN_FICTICIO } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: puerto, path: ruta, method: metodo, headers: auth ? { authorization: auth } : {} }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ estado: res.statusCode, cuerpo: t })); });
    r.on('error', reject); r.end();
  });
  try {
    await new Promise((r) => setTimeout(r, 100));
    const ok = await pedir('/api/automation/v1/catalog?limit=100&page=2');
    assert.equal(ok.estado, 200);
    assert.equal(JSON.parse(ok.cuerpo).products.length, 31);
    assert.equal((await pedir('/api/automation/v1/catalog?limit=100&page=1', { auth: null })).estado, 401);
    assert.equal((await pedir('/api/automation/v1/catalog?limit=100&page=1', { metodo: 'DELETE' })).estado, 405);
    assert.equal((await pedir('/otra')).estado, 404);
    const registro = srv.estado.registro;
    assert.equal(registro.length, 4);
    assert.ok(registro.every((r) => r.auth !== 'invalida'));
  } finally { srv.cerrar(); }
});

/* ═════════ 3. Ejecución completa del workflow ═════════ */
test('lectura completa de varias páginas (131 productos, 2): la ejecución es completa, el informe cumple el esquema y cada nodo entrega lo que el siguiente necesita', () => {
  const a = almacenNuevo();
  const { res, informe, final, estado } = ejecutar({ almacen: a });
  assert.equal(estado.registro.length, 2, 'dos páginas, dos peticiones');
  assert.deepEqual(res.peticiones.map((p) => [p.nodo, p.metodo, new URL(p.url).search]), [['Pedir catálogo', 'GET', '?limit=100&page=1'], ['Pedir catálogo (resto)', 'GET', '?limit=100&page=2']]);
  assert.ok(res.peticiones.every((p) => p.credencial === true));
  assert.deepEqual([informe.fuente.completo, informe.fuente.productosLeidos, informe.fuente.paginasLeidas, informe.fuente.totalPaginas], [true, 131, 2, 2]);
  assert.deepEqual(validarEsquema(final, SCHEMA), []);
  assert.deepEqual(plano(res.salidas.get('Configuración').map((x) => x.json.pagina)), [1]);
  assert.deepEqual(plano(res.salidas.get('Páginas restantes').map((x) => x.json.pagina)), [2]);
  const an = res.salidas.get('Analizar');
  assert.equal(an.length, 1);
  assert.deepEqual(Object.keys(an[0].json).sort(), ['ahoraIso', 'analisis', 'feed']);
  assert.equal(an[0].json.ahoraIso, S.FECHA_BASE, 'una sola hora para todo el análisis');
  assert.equal(informe.generadoEn, S.FECHA_BASE);
  assert.equal(res.salidas.get('Solo la fila').length, 1);
  assert.equal(res.salidas.get('Guardar instantánea').length, 1);
  assert.match(final.markdown, /^# Calidad del catálogo — local/);
  assert.equal(S.verificarRegistroCalidad(estado.registro).ok, true);
});

test('informe del catálogo con defectos: encuentra EXACTAMENTE lo sembrado, distingue confirmados / advertencias / no verificables y prioriza', () => {
  const { final } = ejecutar({ almacen: almacenNuevo() });
  const porId = {};
  for (const i of final.incidencias) {
    if (i.area === 'ficha') (porId[i.producto.id] ??= []).push(i.regla);
    else if (i.certeza === 'no_verificable') for (const id of i.evidencia.ejemplos) (porId[id] ??= []).push(i.regla);
  }
  const util = (l) => l.filter((c) => !['verificacion_ausente', 'enlace_afiliado_no_calibrable'].includes(c)).sort();
  for (const id of Object.keys(porId)) assert.deepEqual(util(porId[id]), [...(S.CALIDAD_ESPERADO[id] ?? [])].sort(), id);
  for (const id of Object.keys(S.CALIDAD_ESPERADO)) assert.ok(porId[id], `${id} debe aparecer`);
  assert.deepEqual([final.resumen.confirmados, final.resumen.advertencias, final.resumen.productos], [9, 9, 131]);
  assert.equal(final.resumen.estado, 'atencion');
  const conf = final.incidencias.filter((i) => i.certeza === 'confirmado');
  assert.equal(conf.length, 9);
  for (const i of final.incidencias.filter((x) => x.certeza === 'no_verificable')) assert.deepEqual([i.puntuacion, i.prioridad, i.gravedad], [0, null, 'info']);
  // prioridad: lo más grave primero y de mayor a menor puntuación
  const puntos = final.incidencias.filter((i) => i.puntuacion > 0).map((i) => i.puntuacion);
  assert.deepEqual(puntos, [...puntos].sort((a, b) => b - a));
  for (const id of ['c101', 'c102']) assert.equal(final.incidencias.find((i) => i.regla === 'precio_ausente' && i.producto.id === id).prioridad, 'P1');
  assert.ok(['P1', 'P2'].includes(final.incidencias.find((i) => i.regla === 'enlace_afiliado_ausente').prioridad));
  assert.equal(final.incidencias.find((i) => i.regla === 'captura_antigua').prioridad, 'P4');
  assert.equal(final.resumen.porPrioridad.P1 + final.resumen.porPrioridad.P2 + final.resumen.porPrioridad.P3 + final.resumen.porPrioridad.P4, 9 + 9);
});

test('duplicados y variantes en el sitio sintético: sólo el duplicado real del mismo comercio se señala; las ofertas de otros comercios se CONSERVAN; las variantes no se agrupan', () => {
  const { final } = ejecutar({ almacen: almacenNuevo() });
  assert.deepEqual(final.pares.map((p) => [p.a.id, p.b.id, p.tipo]), [['c119', 'c120', 'titulo_igual_mismo_comercio']]);
  assert.equal(final.resumen.productos, 131, 'ningún producto se retira ni se fusiona');
  const enPares = new Set(final.pares.flatMap((p) => [p.a.id, p.b.id]));
  for (const par of [...S.VARIANTES_DISTINTAS, ...S.OFERTAS_EQUIVALENTES]) for (const id of par) assert.ok(!enPares.has(id), `${id} no es duplicado`);
  const info = final.incidencias.find((i) => i.regla === 'titulo_igual_no_duplicado');
  assert.deepEqual(info.evidencia.ejemplos, ['c121', 'c122', 'c123', 'c124']);
  assert.equal(info.certeza, 'no_verificable');
  for (const [a, b] of S.VARIANTES_DISTINTAS) assert.ok(!final.incidencias.some((i) => i.regla === 'posible_duplicado' && [a, b].includes(i.producto.id)));
  assert.match(final.incidencias.find((i) => i.regla === 'posible_duplicado').accionSugerida, /no se propone eliminar/);
});

test('un catálogo sin defectos da estado ok (sólo datos no verificables) y el arreglado deja de tener incidencias de ficha', () => {
  const sano = ejecutar({ escenario: 'calidad_sano', almacen: almacenNuevo() }).final;
  assert.equal(sano.resumen.estado, 'ok');
  assert.equal(sano.resumen.confirmados + sano.resumen.advertencias, 0);
  assert.ok(sano.resumen.noVerificables >= 1);
  const arreglado = ejecutar({ escenario: 'calidad_arreglado', almacen: almacenNuevo() }).final;
  assert.equal(arreglado.resumen.confirmados + arreglado.resumen.advertencias, 0);
  assert.equal(arreglado.pares.length, 0);
});

test('el workflow sólo habla con el feed: todas las peticiones son GET autorizadas por la política, con credencial de forma ficticia, y la ejecución no escribe en ningún sitio salvo en SU tabla', () => {
  const a = almacenNuevo(TABLA, TABLA_AUDITOR);
  a.tablas[TABLA_AUDITOR].filas.push({ id: 99, entorno: 'local', idEjecucion: 'ex-aud', origen: 'manual' });
  const { res, estado } = ejecutar({ almacen: a });
  assert.ok(res.peticiones.every((p) => p.metodo === 'GET' && new URL(p.url).host === HOST && new URL(p.url).pathname === '/api/automation/v1/catalog'));
  const v = S.verificarRegistroCalidad(estado.registro);
  assert.deepEqual(v.problemas, []);
  assert.equal(filas(a, TABLA_AUDITOR).length, 1, 'la tabla del Auditor no se toca');
  assert.equal(filas(a, TABLA).length, 1);
  assert.deepEqual(a.operaciones.filter((o) => o.operacion === 'insert').map((o) => o.nodo), ['Guardar instantánea']);
  assert.deepEqual([...new Set(a.operaciones.map((o) => `${o.recurso}/${o.operacion}`))].sort(), ['row/get', 'row/insert', 'table/list']);
});

/* ═════════ 4. Fallos del feed: ninguna ejecución incompleta guarda ni sustituye la referencia ═════════ */
const ESCENARIOS_FALLO = [
  ['calidad_401', /credencial/i, 'credencial_no_valida'], ['calidad_403', /credencial/i, 'credencial_no_valida'], ['calidad_429_pagina2', /429|límite/i, 'limite_de_peticiones'],
  ['calidad_500_pagina2', /HTTP 500/, 'error_de_lectura'], ['calidad_conexion_cortada', /socket hang up/, 'error_de_lectura'], ['calidad_tiempo_agotado', /timeout/i, 'tiempo_agotado'],
  ['calidad_redireccion', /HTTP 302/, 'error_de_lectura'], ['calidad_total_incoherente', /totalPages \(5\)/, null], ['calidad_pagina_corta', /página 2 trae 20 productos y debería traer 31/, null],
  ['calidad_vacio', /no devuelve productos/, null], ['calidad_cambia', /total de productos cambia/, null], ['calidad_repetidos', /repetidos entre páginas/, null], ['calidad_grande', /tope de 8 páginas/, null],
];
for (const [escenario, patron, motivo] of ESCENARIOS_FALLO) {
  test(`fallo «${escenario}»: informe incompleto, nada se guarda, la referencia válida se conserva y la siguiente ejecución completa sigue comparándose con ella`, () => {
    const a = almacenNuevo();
    const ok1 = ejecutar({ escenario: 'calidad_base', almacen: a, id: 1, ahora: horas(0) });
    assert.equal(ok1.confirmado.persistencia.escritura.resultado, 'guardada');
    const antes = JSON.stringify(filas(a));
    const r = ejecutar({ escenario, almacen: a, id: 2, ahora: horas(24) });
    assert.equal(r.final.resumen.estado, 'incompleto', escenario);
    assert.equal(r.final.fuente.completo, false);
    assert.match([...r.final.fuente.errores, ...r.final.fuente.inconsistencias, ...r.final.incidencias.map((i) => i.detalle)].join(' | '), patron, escenario);
    assert.equal(r.final.persistencia.escritura.guardar, false);
    assert.equal(r.final.persistencia.escritura.resultado, 'no_procede');
    assert.equal(r.res.salidas.get('Guardar instantánea').length, 0, 'el Insert ni se ejecuta');
    assert.equal(r.confirmado, null, 'no hay confirmación de una escritura que no se intentó');
    assert.equal(JSON.stringify(filas(a)), antes, 'la tabla no cambia');
    // sólo puede resolverse lo que se LEYÓ en esta ejecución (y nunca lo agregado, que exige el catálogo completo); si no se leyó ninguna ficha, nada se resuelve
    const leidos = new Set(r.final.alcance.fichas);
    for (const x of r.final.seguimiento.resueltas) assert.ok(x.area === 'ficha' && leidos.has(x.clave.split(':').slice(2).join(':')), `resuelta sin haberse leído: ${x.clave}`);
    if (leidos.size === 0) assert.deepEqual(r.final.seguimiento.resueltas, [], 'sin fichas leídas no se resuelve nada');
    assert.deepEqual(validarEsquema(r.final, SCHEMA), []);
    if (motivo) assert.ok(r.final.incidencias.some((i) => i.id === 'catalogo:feed_no_disponible' || i.id === 'catalogo:feed_parcial'));
    if (escenario === 'calidad_redireccion') assert.ok(!r.estado.registro.some((x) => /evil/.test(x.ruta)), 'la redirección no se sigue');
    const sig = ejecutar({ escenario: 'calidad_base', almacen: a, id: 3, ahora: horas(48) });
    assert.equal(sig.final.seguimiento.comparadoCon, horas(0));
    assert.equal(sig.final.seguimiento.modo, 'comparacion');
    assert.equal(sig.final.seguimiento.resumen.nuevas, 0);
  });
}

test('sin credencial en el nodo HTTP el sitio responde 401: el agente lo informa como credencial no válida y no guarda nada (la credencial es imprescindible)', () => {
  const a = almacenNuevo();
  const r = ejecutar({ almacen: a, sinCredencial: true });
  assert.equal(r.final.resumen.estado, 'incompleto');
  assert.equal(r.informe.incidencias[0].id, 'catalogo:feed_no_disponible');
  assert.equal(r.informe.incidencias[0].evidencia.motivo, 'credencial_no_valida');
  assert.equal(filas(a).length, 0);
  assert.ok(r.estado.registro.every((x) => x.auth === 'ausente' && x.estado === 401));
});

test('catálogo de exactamente 800 productos (8 páginas) es completo y respeta el ritmo; con 801 el tope de páginas lo deja incompleto y se declara', () => {
  const a = almacenNuevo();
  const ok = ejecutar({ escenario: 'calidad_800', almacen: a });
  assert.equal(ok.final.fuente.completo, true);
  assert.equal(ok.final.fuente.paginasLeidas, 8);
  assert.equal(ok.estado.registro.length, 8);
  const v = S.verificarRegistroCalidad(ok.estado.registro);
  assert.deepEqual(v.problemas, []);
  assert.ok(v.resumen.maxEnUnMinuto <= 10);
  assert.equal(ok.res.virtualMs, 7 * CFG.pausaMs, 'Wait de 7 s tras la página 1 y 6 pausas del HTTP: 8 peticiones separadas por 7 s');
  assert.deepEqual(validarEsquema(ok.final, SCHEMA), []);
  const grande = ejecutar({ escenario: 'calidad_grande', almacen: almacenNuevo() });
  assert.equal(grande.estado.registro.length, 8, 'nunca más de 8 páginas');
  assert.equal(grande.final.fuente.completo, false);
});

test('catálogo de una sola página (50 productos): el nodo «Páginas restantes» usa el marcador autorizado (limit=1) y el catálogo se lee completo sin confundirlo con una página', () => {
  const a = almacenNuevo();
  const r = ejecutar({ escenario: 'calidad_pequeno', almacen: a });
  assert.deepEqual(r.estado.registro.map((x) => x.ruta), ['/api/automation/v1/catalog?limit=100&page=1', '/api/automation/v1/catalog?limit=1&page=1']);
  assert.equal(r.final.fuente.completo, true);
  assert.deepEqual([r.final.fuente.productosLeidos, r.final.fuente.paginasLeidas, r.final.fuente.totalPaginas], [50, 1, 1], 'el marcador no cuenta como página ni añade productos');
  assert.equal(r.final.resumen.peticiones, 1, 'el informe cuenta las páginas reales, no el marcador');
  assert.equal(S.verificarRegistroCalidad(r.estado.registro).ok, true, 'incluso el marcador es una petición autorizada');
  assert.equal(r.confirmado.persistencia.escritura.resultado, 'guardada');
  assert.equal(JSON.parse(filas(a)[0].payload).alcance.fichas.length, 50);
});

test('segunda barrera en ejecución: si alguien cambia la configuración incrustada a otro entorno o host, el nodo se detiene ANTES de hacer ninguna petición', () => {
  const intentos = [
    [/"baseUrl": "[^"]+"/, '"baseUrl": "https://treidilor.com"'],
    [/"modo": "lectura_catalogo"/, '"modo": "completo"'],
    [/"puente-treidilor:4350"/, '"puente-treidilor:4350", "evil.example"'],
    [/"pausaMs": 7000/, '"pausaMs": 100'],
    [/"maxPaginasCatalogo": 8/, '"maxPaginasCatalogo": 50'],
    [/"tabla": "calidad_catalogo_instantaneas"/, '"tabla": "auditor_general_instantaneas"'],
  ];
  for (const [de, a] of intentos) {
    const wf = plano(WF);
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code' && /const CONFIG/.test(x.parameters.jsCode))) n.parameters.jsCode = n.parameters.jsCode.replace(de, a);
    assert.ok(wf.nodes.some((x) => x.parameters.jsCode && x.parameters.jsCode.includes(a.replace(/^"[^"]+": /, ''))), `el cambio se aplicó: ${a}`);
    const estado = S.crearEstado('calidad_base');
    assert.throws(() => ejecutar({ wf, almacen: almacenNuevo(), sitio: estado }), /CONFIGURACIÓN|AISLAMIENTO/, a);
    assert.equal(estado.registro.length, 0, `ninguna petición con la configuración alterada: ${a}`);
  }
});

test('límite de ritmo del cliente: dos ejecuciones seguidas en el mismo minuto superan las 10 peticiones y la segunda sale incompleta (429) sin guardar ni sustituir nada', () => {
  const a = almacenNuevo();
  const sitio = S.crearEstado('calidad_limite_ritmo');
  const r1 = ejecutar({ escenario: 'calidad_limite_ritmo', almacen: a, sitio, id: 1, ahora: horas(0) });
  assert.equal(r1.final.fuente.completo, true);
  assert.equal(filas(a).length, 1);
  const r2 = ejecutar({ escenario: 'calidad_limite_ritmo', almacen: a, sitio, id: 2, ahora: horas(0.01) });
  assert.ok(sitio.registro.some((x) => x.estado === 429));
  assert.equal(r2.final.fuente.completo, false);
  assert.equal(r2.final.persistencia.escritura.guardar, false);
  assert.equal(filas(a).length, 1);
  assert.equal(S.verificarRegistroCalidad(sitio.registro).ok, false, 'el registro independiente detecta el exceso de ritmo');
  assert.match(S.verificarRegistroCalidad(sitio.registro).problemas.join(' '), /ritmo/);
});

/* ═════════ 5. Memoria histórica ═════════ */
test('histórico: la tabla propia se crea con el workflow de preparación (8 columnas, sin duplicar ni tocar otras tablas) y la ejecución la usa', () => {
  const crear = WF_TABLA.nodes.find((n) => n.type === 'n8n-nodes-base.dataTable');
  assert.deepEqual([crear.parameters.resource, crear.parameters.operation, crear.parameters.tableName, crear.parameters.options], ['table', 'create', TABLA, { createIfNotExists: true }]);
  assert.deepEqual(crear.parameters.columns.column.map((c) => c.name), SEG.COLUMNAS_INSTANTANEAS);
  assert.ok(crear.parameters.columns.column.every((c) => c.type === 'string'));
  assert.notEqual(TABLA, TABLA_AUDITOR);
  assert.ok(!TABLA.includes(TABLA_AUDITOR) && !TABLA_AUDITOR.includes(TABLA), 'los nombres no se contienen (la búsqueda de n8n es por subcadena)');
  assert.ok(!WF_TABLA.nodes.some((n) => n.credentials) && !WF_TABLA.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest'), 'sin credenciales ni peticiones');
  const a = crearAlmacenSimulado([TABLA_AUDITOR]);
  const r = simularWorkflow(WF_TABLA, { fetchSimulado: () => { throw new Error('sin red'); }, almacen: a, ejecucion: { mode: 'test', id: 1 } });
  assert.deepEqual(Object.keys(a.tablas).sort(), [TABLA, TABLA_AUDITOR].sort());
  assert.deepEqual(a.tablas[TABLA].columnas, SEG.COLUMNAS_INSTANTANEAS);
  assert.equal(r.peticiones.length, 0);
  simularWorkflow(WF_TABLA, { fetchSimulado: () => { throw new Error('sin red'); }, almacen: a, ejecucion: { mode: 'test', id: 2 } });
  assert.equal(Object.keys(a.tablas).length, 2, 'ejecutarlo dos veces no crea otra tabla');
  assert.equal(filas(a).length, 0, 'se crea vacía');
  assert.equal(ejecutar({ almacen: a }).final.persistencia.tabla.estado, 'ok');
});

test('histórico: primera ejecución = línea base; sólo se guarda una ejecución completa; la fila lleva las 8 columnas, el agente rotulado y se confirma al comprobar que existe', () => {
  const a = almacenNuevo();
  const r = ejecutar({ almacen: a, id: 1 });
  assert.equal(r.informe.persistencia.escritura.resultado, 'pendiente', 'el nodo Informe nunca da la escritura por hecha');
  assert.equal(r.confirmado.persistencia.escritura.resultado, 'guardada');
  assert.equal(r.confirmado.persistencia.escritura.filaId, 1);
  assert.equal(r.final.seguimiento.modo, 'linea_base');
  assert.equal(r.final.seguimiento.resumen.nuevas, 0);
  const [fila] = filas(a);
  for (const c of SEG.COLUMNAS_INSTANTANEAS) assert.equal(typeof fila[c], 'string', c);
  assert.deepEqual([fila.entorno, fila.host, fila.idEjecucion, fila.origen, fila.calidad, fila.generadoEn], ['local', HOST, 'ex-1', 'manual', 'completa', S.FECHA_BASE]);
  const inst = JSON.parse(fila.payload);
  assert.equal(inst.agente, 'calidad-catalogo');
  assert.equal(inst.alcance.fichas.length, 131);
  assert.ok(COM.bytesUtf8(fila.payload) < 60000);
  assert.ok(!fila.payload.includes('Producto'), 'sin textos del catálogo');
});

test('histórico: segunda ejecución con el mismo catálogo = todo persistente; tras arreglarlo, resuelto; si reaparece, reaparecida; si el producto desaparece, no verificada', () => {
  const a = almacenNuevo();
  ejecutar({ escenario: 'calidad_base', almacen: a, id: 1, ahora: horas(0) });
  const r2 = ejecutar({ escenario: 'calidad_base', almacen: a, id: 2, ahora: horas(24) });
  assert.equal(r2.final.seguimiento.modo, 'comparacion');
  assert.deepEqual([r2.final.seguimiento.resumen.nuevas, r2.final.seguimiento.resumen.resueltas], [0, 0]);
  assert.ok(r2.final.seguimiento.resumen.persistentes >= 18);
  assert.equal(filas(a).length, 2);
  // el catálogo mejora: lo corregido se resuelve (sólo lo que se leyó) y el producto que desaparece queda sin verificar
  const r3 = ejecutar({ escenario: 'calidad_mixto', almacen: a, id: 3, ahora: horas(48) });
  const s3 = r3.final.seguimiento;
  assert.ok(clavesDe(s3.resueltas).includes('ficha:precio_ausente:c102') && clavesDe(s3.resueltas).includes('ficha:sin_imagen:c105'));
  assert.deepEqual(clavesDe(s3.persistentes).filter((k) => /c101|c107/.test(k)), ['ficha:precio_ausente:c101', 'ficha:sin_descripcion:c107']);
  assert.deepEqual(clavesDe(s3.nuevas), ['ficha:sin_imagen:c040']);
  assert.deepEqual(s3.noVerificadas.map((x) => [x.clave, x.motivo]), [['ficha:valoracion_incoherente:c113', 'objetivo_no_revisado']], 'c113 ya no está en el feed: no se puede decir que se arregló');
  assert.ok(!clavesDe(s3.resueltas).includes('ficha:valoracion_incoherente:c113'));
  // arreglado del todo: resuelve lo que quedaba y c113 (vuelve al feed ya corregido)
  const r4 = ejecutar({ escenario: 'calidad_arreglado', almacen: a, id: 4, ahora: horas(72) });
  assert.ok(clavesDe(r4.final.seguimiento.resueltas).includes('ficha:valoracion_incoherente:c113'));
  assert.deepEqual(r4.final.seguimiento.noVerificadas, []);
  assert.equal(r4.final.resumen.confirmados + r4.final.resumen.advertencias, 0);
  // y si los defectos vuelven pronto, reaparecen
  const r5 = ejecutar({ escenario: 'calidad_base', almacen: a, id: 5, ahora: horas(96) });
  assert.ok(r5.final.seguimiento.resumen.reaparecidas >= 18);
  assert.equal(r5.final.seguimiento.resumen.nuevas, 0);
  assert.equal(filas(a).length, 5);
});

test('histórico: una ejecución incompleta intercalada no sustituye la referencia (la siguiente se compara con la última COMPLETA)', () => {
  const a = almacenNuevo();
  ejecutar({ escenario: 'calidad_base', almacen: a, id: 1, ahora: horas(0) });
  ejecutar({ escenario: 'calidad_arreglado', almacen: a, id: 2, ahora: horas(24) });
  for (const [k, esc] of ['calidad_401', 'calidad_500_pagina2', 'calidad_cambia', 'calidad_vacio'].entries()) ejecutar({ escenario: esc, almacen: a, id: 10 + k, ahora: horas(25 + k) });
  assert.equal(filas(a).length, 2);
  const r = ejecutar({ escenario: 'calidad_arreglado', almacen: a, id: 20, ahora: horas(48) });
  assert.equal(r.final.seguimiento.comparadoCon, horas(24));
  assert.equal(r.final.seguimiento.resumen.nuevas + r.final.seguimiento.resumen.resueltas, 0);
});

test('histórico: ESCRITURA FALLIDA queda reflejada (error de tabla o validación silenciosa), no se reintenta y no deja fila; la siguiente ejecución parte de lo realmente guardado', () => {
  for (const [fallo, motivo] of [['tabla', 'error_insert'], [true, 'sin_confirmacion']]) {
    const a = almacenNuevo();
    ejecutar({ escenario: 'calidad_base', almacen: a, id: 1, ahora: horas(0) });
    a.falloInsert = fallo;
    const r = ejecutar({ escenario: 'calidad_base', almacen: a, id: 2, ahora: horas(24) });
    assert.equal(r.informe.persistencia.escritura.resultado, 'pendiente', 'el Informe no da la escritura por hecha');
    assert.deepEqual([r.confirmado.persistencia.escritura.resultado, r.confirmado.persistencia.escritura.motivoFallo], ['fallida', motivo]);
    assert.match(r.confirmado.markdown, /FALLIDA|fallida/i);
    assert.equal(filas(a).length, 1, 'no hay fila de la ejecución 2');
    assert.equal(a.operaciones.filter((o) => o.operacion === 'insert' && o.nodo === 'Guardar instantánea').length, 2, 'un intento por ejecución (ejecución 1 y 2), sin reintentos');
    assert.deepEqual(validarEsquema(r.confirmado, SCHEMA), []);
    a.falloInsert = false;
    const r3 = ejecutar({ escenario: 'calidad_base', almacen: a, id: 3, ahora: horas(48) });
    assert.equal(r3.final.seguimiento.comparadoCon, horas(0), 'se compara con la última fila que sí existe');
    assert.equal(r3.confirmado.persistencia.escritura.resultado, 'guardada');
    assert.equal(filas(a).length, 2);
  }
});

test('histórico: ESCRITURA FALLIDA en la primera ejecución = no hay referencia; la siguiente vuelve a ser línea base (nunca se inventa un histórico)', () => {
  const a = almacenNuevo();
  a.falloInsert = 'tabla';
  const r1 = ejecutar({ almacen: a, id: 1, ahora: horas(0) });
  assert.equal(r1.confirmado.persistencia.escritura.resultado, 'fallida');
  a.falloInsert = false;
  const r2 = ejecutar({ almacen: a, id: 2, ahora: horas(24) });
  assert.equal(r2.final.seguimiento.modo, 'linea_base');
  assert.equal(filas(a).length, 1);
});

test('histórico: un REINTENTO de la misma ejecución no duplica filas (mismo id, mismo origen) y dos ejecuciones distintas no se pisan', () => {
  const a = almacenNuevo();
  const r1 = ejecutar({ almacen: a, id: 7, ahora: horas(0) });
  assert.equal(r1.confirmado.persistencia.escritura.resultado, 'guardada');
  for (const ahora of [horas(0), horas(1)]) {
    const reintento = ejecutar({ almacen: a, id: 7, ahora });
    assert.equal(reintento.final.persistencia.escritura.guardar, false, ahora);
    assert.ok(['ya_guardada', 'orden_invalido'].includes(reintento.final.persistencia.escritura.motivo));
    assert.equal(reintento.confirmado, null);
  }
  assert.equal(filas(a).length, 1);
  const otra = ejecutar({ almacen: a, id: 8, ahora: horas(24) });
  assert.equal(otra.confirmado.persistencia.escritura.resultado, 'guardada');
  assert.deepEqual(filas(a).map((f) => f.idEjecucion), ['ex-7', 'ex-8']);
});

test('histórico: el origen de la ejecución decide si se guarda (manual y programada sí; otros orígenes no)', () => {
  const a = almacenNuevo();
  assert.equal(ejecutar({ almacen: a, id: 1, mode: 'test', ahora: horas(0) }).final.persistencia.escritura.origen, 'manual');
  assert.equal(ejecutar({ almacen: a, id: 2, mode: 'production', ahora: horas(24) }).final.persistencia.escritura.origen, 'programada');
  assert.deepEqual(filas(a).map((f) => f.origen), ['manual', 'programada']);
  const otro = ejecutar({ almacen: a, id: 3, mode: 'webhook', ahora: horas(48) });
  assert.equal(otro.final.persistencia.escritura.motivo, 'origen_no_valido');
  assert.equal(filas(a).length, 2);
});

test('histórico: sin tabla, con la tabla ambigua o con error de lectura el informe sale igualmente y no se guarda nada; el historial de otro entorno se ignora', () => {
  const sin = ejecutar({ almacen: crearAlmacenSimulado([]) });
  assert.equal(sin.final.persistencia.tabla.estado, 'no_encontrada');
  assert.equal(sin.final.persistencia.escritura.resultado, 'no_procede');
  assert.equal(sin.res.salidas.get('Guardar instantánea').length, 0);
  assert.ok(sin.final.incidencias.length > 0, 'el informe sale entero');
  const ambigua = ejecutar({ almacen: crearAlmacenSimulado([TABLA, `${TABLA}_copia`]) });
  assert.equal(ambigua.final.persistencia.tabla.estado, 'ambigua');
  assert.equal(ambigua.final.persistencia.escritura.resultado, 'no_procede');
  const rota = almacenNuevo();
  rota.falloLectura = true;
  const errLectura = ejecutar({ almacen: rota });
  assert.ok(['error_lectura'].includes(errLectura.final.persistencia.tabla.estado));
  assert.equal(errLectura.final.persistencia.escritura.resultado, 'no_procede');
  const conOtroEntorno = almacenNuevo();
  conOtroEntorno.tablas[TABLA].filas.push({ id: 50, entorno: 'produccion', host: 'treidilor.com', generadoEn: horas(-24), idEjecucion: 'ex-prod', origen: 'manual', calidad: 'completa', huella: 'x', payload: JSON.stringify({ esquema: 1, entorno: 'produccion', host: 'treidilor.com', generadoEn: horas(-24), calidad: { estado: 'completa', motivos: [] }, alcance: null, incidencias: [] }) });
  const r = ejecutar({ almacen: conOtroEntorno, ahora: horas(0) });
  assert.equal(r.final.seguimiento.modo, 'linea_base', 'un histórico de producción no sirve de referencia al entorno local');
});

test('la memoria del Agente 04 y la del Auditor conviven sin mezclarse (misma instalación, tablas distintas)', () => {
  const a = almacenNuevo(TABLA, TABLA_AUDITOR);
  a.tablas[TABLA_AUDITOR].filas.push({ id: 5, entorno: 'local', host: HOST, generadoEn: horas(-24), idEjecucion: 'ex-9', origen: 'manual', calidad: 'completa', huella: 'x', payload: '{"esquema":1,"agente":"auditor-general"}' });
  const r = ejecutar({ almacen: a });
  assert.equal(r.final.persistencia.tabla.estado, 'ok');
  assert.equal(r.final.persistencia.lectura.filas, 0, 'no lee la tabla del Auditor');
  assert.equal(r.final.seguimiento.modo, 'linea_base');
  assert.equal(filas(a, TABLA_AUDITOR).length, 1);
});

/* ═════════ 6. Compatibilidad con el Auditor General ═════════ */
test('compatibilidad: los workflows del Auditor General siguen IDÉNTICOS (generador y repositorio), pasan el comprobador y no incorporan nada del Agente 04', () => {
  const comprobar = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/automation/build-workflows.mjs'), '--check'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(comprobar.status, 0, comprobar.stdout + comprobar.stderr);
  for (const f of ['auditor-general.local.json', 'auditor-general.produccion.json', 'auditor-instantaneas-crear-tabla.json', 'investigador-comercial.local.json', 'calidad-catalogo.local.json', 'calidad-instantaneas-crear-tabla.json']) assert.match(comprobar.stdout, new RegExp(`✔ ${f.replace('.', '\\.')}`));
  const lintTodo = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/automation/lint-workflows.mjs')], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(lintTodo.status, 0, lintTodo.stdout + lintTodo.stderr);
  const auditor = ['auditor-general.local.json', 'auditor-general.produccion.json', 'auditor-instantaneas-crear-tabla.json'].map((f) => `automation/workflows/${f}`);
  const git = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', ...auditor, 'automation/dev/diagnostico-auditor-produccion.json'], { cwd: RAIZ, encoding: 'utf8' });
  if (git.error) console.log('  ℹ git no disponible: se omite la comparación con el repositorio');
  else assert.equal(git.status, 0, 'los workflows del Auditor no difieren de los del repositorio');
  for (const f of ['auditor-general.local.json', 'auditor-general.produccion.json']) {
    const w = J(`automation/workflows/${f}`);
    const codigo = w.nodes.filter((x) => x.type === 'n8n-nodes-base.code').map((x) => x.parameters.jsCode).join('\n');
    assert.ok(!/calidadCatalogo|urlPolicyCalidad|lectura_catalogo|construirInformeDesdeAnalisis|AGENTE_CALIDAD/.test(codigo), f);
    assert.equal(w.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').every((n) => n.parameters.options.batching.batch.batchInterval === 700), true, `${f}: pausa de 700 ms como antes`);
    assert.ok(w.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').every((n) => n.parameters.headerParameters.parameters[0].value === 'TreidilorAI-auditor-general/0.2 (solo lectura)'));
  }
  // el simulador ampliado no cambia el comportamiento con el Auditor (mismas peticiones y mismo informe que sin reloj virtual)
  const r = simularWorkflow(J('automation/workflows/auditor-general.produccion.json'), { fetchSimulado: ({ url }) => ({ statusCode: 200, headers: { 'content-type': /health/.test(url) ? 'application/json' : 'text/html' }, body: /health/.test(url) ? { status: 'ok', sourceHash: 'a'.repeat(64), uptimeSeconds: 99999, dataDirExists: true, env: { smtp: true } } : '<html><head><title>x</title></head><body><h1>x</h1></body></html>' }), almacen: crearAlmacenSimulado([TABLA_AUDITOR]), ahora: S.FECHA_BASE, ejecucion: { mode: 'test', id: 1 } });
  assert.ok(r.peticiones.length >= 5 && r.peticiones.every((p) => typeof p.t === 'number'));
  assert.equal(r.salidas.get('Informe')[0].json.agente, 'auditor-general');
});

/* ═════════ Etapa 4 (validación en n8n real): lo que el simulador debía reflejar ═════════ */
test('Insert con una columna que no existe: la tabla NO guarda nada, el Insert no devuelve la fila y el agente lo informa como escritura fallida (no la da por guardada)', () => {
  const wf = plano(WF);
  nodo('Guardar instantánea', wf).parameters.columns.value.columna_inexistente = '={{ $json.entorno }}';
  const almacen = crearAlmacenSimulado([TABLA], { [TABLA]: SEG.COLUMNAS_INSTANTANEAS });
  const r = ejecutar({ wf, almacen });
  assert.equal(filas(almacen).length, 0, 'no se guarda ninguna fila');
  assert.equal(r.final.persistencia.escritura.resultado, 'fallida');
  assert.equal(r.final.persistencia.escritura.motivoFallo, 'sin_confirmacion');
  // sin la columna sobrante, la misma tabla con columnas conocidas sí guarda
  const ok = crearAlmacenSimulado([TABLA], { [TABLA]: SEG.COLUMNAS_INSTANTANEAS });
  const r2 = ejecutar({ almacen: ok });
  assert.equal(r2.final.persistencia.escritura.resultado, 'guardada');
  assert.equal(filas(ok).length, 1);
});

test('compose de validación del Agente 04: sólo el nodo HTTP habilitado, sitio sintético en la red aislada sin puertos, sin salida ni privilegios ni secretos', () => {
  const t = fs.readFileSync(path.join(RAIZ, 'automation/dev/prueba-data-tables/docker-compose.calidad.yml'), 'utf8').replace(/\r\n/g, '\n');
  const sinComentarios = t.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, '')).join('\n');
  assert.ok(!/^\s*ports:/m.test(sinComentarios), 'el sitio y n8n no publican puertos en esta variante');
  assert.ok(!/extra_hosts|network_mode|privileged|docker\.sock|cap_add/.test(sinComentarios));
  assert.ok(!/^networks:/m.test(sinComentarios), 'no define ni modifica redes (la `internal: true` es la del compose base)');
  assert.match(sinComentarios, /NODES_EXCLUDE: '\["n8n-nodes-base\.executeCommand","n8n-nodes-base\.ssh","n8n-nodes-base\.readWriteFile"\]'/);
  assert.ok(!/httpRequest/.test(sinComentarios), 'httpRequest ya no está excluido');
  assert.match(sinComentarios, /aliases:\n\s+- puente-treidilor/);
  assert.match(sinComentarios, /read_only: true/);
  assert.match(sinComentarios, /cap_drop: \[ALL\]/);
  assert.match(sinComentarios, /no-new-privileges:true/);
  assert.ok(!/treidilor\.com|password|secret|token/i.test(sinComentarios), 'sin secretos ni dominios reales');
  // el compose base (no modificado) sigue siendo la única fuente de la red interna y del único puerto publicado
  const base = fs.readFileSync(path.join(RAIZ, 'automation/dev/prueba-data-tables/docker-compose.yml'), 'utf8');
  assert.match(base, /internal: true/);
  assert.equal((base.match(/127\.0\.0\.1:5689:5678/g) ?? []).length, 1);
});

/* ═════════ Pausa entre páginas (nodo Wait; etapa de validación técnica previa al despliegue) ═════════ */
test('Wait: un único nodo entre «Páginas restantes» y «Pedir catálogo (resto)», 7 s por intervalo en segundos, sin webhook; el workflow sigue inactivo y sin programación', () => {
  const w = nodo('Pausa entre páginas');
  assert.equal(w.type, 'n8n-nodes-base.wait');
  assert.equal(w.typeVersion, 1.1);
  assert.deepEqual(w.parameters, { resume: 'timeInterval', amount: 7, unit: 'seconds' });
  assert.ok(!('webhookId' in w));
  assert.deepEqual(WF.connections['Páginas restantes'], { main: [[{ node: 'Pausa entre páginas', type: 'main', index: 0 }]] });
  assert.deepEqual(WF.connections['Pausa entre páginas'], { main: [[{ node: 'Pedir catálogo (resto)', type: 'main', index: 0 }]] });
  assert.ok(w.parameters.amount * 1000 >= CFG.pausaMs);
  assert.equal(WF.active, false);
  assert.ok(!WF.nodes.some((n) => /schedule|webhook|cron|interval|formTrigger/i.test(n.type)));
  assert.equal(WF.nodes.filter((n) => /wait/i.test(n.type)).length, 1);
  assert.deepEqual(lint(WF).errores, []);
});

test('Wait: el hueco entre CUALESQUIERA dos peticiones GET es de al menos 7 s (1 página con marcador, 2 páginas, 8 páginas y fallos en la página 2), sin paradas silenciosas', () => {
  for (const [escenario, peticiones] of [['calidad_pequeno', 2], ['calidad_base', 2], ['calidad_800', 8], ['calidad_429_pagina2', 2], ['calidad_500_pagina2', 2], ['calidad_grande', 8]]) {
    const r = ejecutar({ escenario, almacen: almacenNuevo() });
    const v = S.verificarRegistroCalidad(r.estado.registro, { pausaMinMs: CFG.pausaMs });
    assert.deepEqual(v.problemas, [], escenario);
    assert.equal(r.estado.registro.length, peticiones, escenario);
    assert.ok(v.resumen.minHuecoMs >= 7000, `${escenario}: hueco mínimo ${v.resumen.minHuecoMs}`);
    assert.ok(v.resumen.maxEnUnMinuto <= 10, escenario);
    assert.ok(r.res.salidas.get('Informe')?.length >= 1, `${escenario}: el flujo llega al informe (no hay parada silenciosa)`);
    const completa = ['calidad_pequeno', 'calidad_base', 'calidad_800'].includes(escenario);
    assert.equal(r.res.salidas.get('Confirmar escritura')?.length === 1, completa, `${escenario}: sólo las completas llegan a la confirmación (las demás no tienen fila que guardar)`);
    assert.equal(r.final.persistencia.escritura.resultado, completa ? 'guardada' : 'no_procede', escenario);
  }
  // 800 productos: 7 pausas de 7 s = 49 s; 8 peticiones en 49 s (≤ 10/min)
  const g = ejecutar({ escenario: 'calidad_800', almacen: almacenNuevo() });
  assert.equal(g.res.virtualMs, 49000);
  assert.deepEqual(g.estado.registro.map((q) => q.t), [0, 7000, 14000, 21000, 28000, 35000, 42000, 49000]);
});

test('Wait: no altera la integridad del feed ni el resultado; las ejecuciones incompletas siguen sin guardar instantáneas', () => {
  const a = almacenNuevo();
  const r = ejecutar({ almacen: a });
  assert.equal(r.final.fuente.completo, true);
  assert.deepEqual([r.final.fuente.productosLeidos, r.final.fuente.paginasLeidas, r.final.fuente.totalPaginas, r.final.fuente.total], [131, 2, 2, 131]);
  assert.equal(filas(a).length, 1);
  // el mismo informe con la pausa de 7 s que sin ella (se quita el Wait y se conecta directo): sólo cambia el tiempo virtual
  const sinWait = plano(WF);
  sinWait.nodes = sinWait.nodes.filter((n) => n.name !== 'Pausa entre páginas');
  sinWait.connections['Páginas restantes'] = { main: [[{ node: 'Pedir catálogo (resto)', type: 'main', index: 0 }]] };
  delete sinWait.connections['Pausa entre páginas'];
  const b = ejecutar({ wf: sinWait, almacen: almacenNuevo() });
  const sinTiempos = (x) => JSON.parse(JSON.stringify(x, (k, v) => (['generadoEn', 'idEjecucion', 'filaId'].includes(k) ? undefined : v)));
  assert.deepEqual(sinTiempos(r.final), sinTiempos(b.final));
  assert.equal(r.res.virtualMs, 7000);
  assert.equal(b.res.virtualMs, 0);
  // incompletas: nada se guarda ni sustituye la referencia
  const al = almacenNuevo();
  ejecutar({ almacen: al, id: 1, ahora: horas(0) });
  for (const [i, e] of ['calidad_401', 'calidad_429_pagina2', 'calidad_500_pagina2', 'calidad_conexion_cortada', 'calidad_total_incoherente', 'calidad_pagina_corta', 'calidad_grande'].entries()) {
    const x = ejecutar({ escenario: e, almacen: al, id: i + 2, ahora: horas(i + 1) });
    assert.equal(filas(al).length, 1, `${e}: no debe guardar`);
    assert.equal(x.final.persistencia.escritura.resultado, 'no_procede', e);
  }
});

test('el comprobador rechaza manipulaciones del Wait (sin Wait, 6 s, minutos, webhook, otro orden, fuera del Agente 04, HTTP alimentado por otro Wait)', () => {
  const prueba = (cambia, patron) => { const w = plano(WF); cambia(w); const e = lint(w).errores; assert.ok(e.some((x) => patron.test(x)), `${patron} ← ${e.join(' | ') || '(sin errores)'}`); };
  prueba((w) => { w.nodes = w.nodes.filter((n) => n.name !== 'Pausa entre páginas'); w.connections['Páginas restantes'] = { main: [[{ node: 'Pedir catálogo (resto)', type: 'main', index: 0 }]] }; delete w.connections['Pausa entre páginas']; }, /único nodo Wait/);
  prueba((w) => { nodo('Pausa entre páginas', w).parameters.amount = 6; }, /inferior a pausaMs/);
  prueba((w) => { nodo('Pausa entre páginas', w).parameters.amount = 90; }, /entre 1 y 60/);
  prueba((w) => { nodo('Pausa entre páginas', w).parameters.unit = 'minutes'; }, /intervalo en segundos/);
  prueba((w) => { nodo('Pausa entre páginas', w).parameters.resume = 'webhook'; }, /intervalo en segundos/);
  prueba((w) => { nodo('Pausa entre páginas', w).webhookId = 'abc'; }, /webhook/);
  prueba((w) => { w.connections['Páginas restantes'] = { main: [[{ node: 'Pedir catálogo (resto)', type: 'main', index: 0 }]] }; }, /único nodo Wait/);
  // un Wait en el Auditor (o en cualquier otro workflow) no se admite
  const aud = J('automation/workflows/auditor-general.local.json');
  aud.nodes.push({ id: 'w', name: 'Esperar', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [0, 400], parameters: { resume: 'timeInterval', amount: 7, unit: 'seconds' } });
  assert.ok(comprobarWorkflow(aud, { nombreArchivo: 'auditor-general.local.json' }).errores.some((e) => /sólo se admite en el Agente 04/.test(e)));
  // un nodo HTTP alimentado por un Wait que NO viene de un Code sigue rechazado
  const w2 = plano(WF);
  w2.connections['Ejecutar a mano'] = { main: [[{ node: 'Configuración', type: 'main', index: 0 }, { node: 'Pausa entre páginas', type: 'main', index: 0 }]] };
  assert.ok(lint(w2).errores.some((e) => /sólo puede recibir datos de nodos Code/.test(e)));
});
