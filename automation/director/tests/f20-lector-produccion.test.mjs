// LECTOR DE PRODUCCIÓN (sólo preparado, NO desplegado): lógica compartida, constructor, linter estricto, cliente interno del Director y E2E con un n8n FALSO que ejecuta el JSON real de la variante.
// Todo con datos SINTÉTICOS de entorno «produccion» (rotulados así sólo en la tabla de prueba): nunca se accede a n8n de producción.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { armarRespuestaProduccion, validarSolicitudProduccion, MAX_LECTURA_TABLA, VENTANA_SOLICITUD_MS, CREDENCIAL_LECTOR_PRODUCCION, CABECERA_LECTOR_PRODUCCION } from '../../lib/lectorProduccion.mjs';
import { validarRespuestaLector } from '../../lib/lectorPuente.mjs';
import { filaDeInstantanea } from '../../lib/seguimiento.mjs';
import { construirLectorProduccion, ARCHIVO_PRODUCCION } from '../../../scripts/automation/build-lector-produccion.mjs';
import { lintLectorProduccion } from '../../../scripts/automation/lint-lector-produccion.mjs';
import { comprobarWorkflow } from '../../../scripts/automation/lint-workflows.mjs';
import { crearLectorProduccion, esHostInterno } from '../puente/lector-produccion.mjs';
import { crearEntorno, AHORA } from '../evaluacion/entorno.mjs';
import { fila } from '../fixtures/construir.mjs';
import { Canal13 } from '../canal/canal13.mjs';
import { arrancarN8nFalso, cargarWorkflowProduccion } from './_n8n-falso.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
const TOKEN = 'token-produccion-de-prueba-0123456789';
const iso = (ms) => new Date(ms).toISOString();
const ahoraIso = () => new Date().toISOString();
const solicitud = (agente = '12', extra = {}) => ({ esquema: 'tai-lector/1', idSolicitud: 'sol-prod-00000001', agente, entorno: 'produccion', limite: 5, emitidoEn: ahoraIso(), ...extra });

// la huella de una fila real es `filaDeInstantanea(...).huella` (el fixture genérico usa otro cálculo)
function filaProd(agente, idEjecucion, generadoEn, incidencias = [], entorno = 'produccion') {
  const { id, ...f } = { id: 1, ...fila({ id: 1, agente, idEjecucion, entorno, generadoEn, incidencias }) };
  f.huella = filaDeInstantanea(JSON.parse(f.payload), { idEjecucion: f.idEjecucion, origen: f.origen }).huella;
  return f;
}

// ── lógica compartida ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('solicitud de producción: sólo «produccion», con emitidoEn dentro de la ventana, sin campos extra', () => {
  assert.equal(validarSolicitudProduccion(solicitud()).ok, true);
  assert.match(validarSolicitudProduccion(solicitud('12', { entorno: 'local' })).errores.join(), /entorno no admitido/);
  const { emitidoEn, ...sin } = solicitud();
  assert.match(validarSolicitudProduccion(sin).errores.join(), /emitidoEn/);
  assert.match(validarSolicitudProduccion(solicitud('12', { emitidoEn: iso(Date.now() - VENTANA_SOLICITUD_MS - 5000) })).errores.join(), /ventana de validez/);
  assert.match(validarSolicitudProduccion(solicitud('12', { emitidoEn: iso(Date.now() + VENTANA_SOLICITUD_MS + 5000) })).errores.join(), /ventana de validez/);
  assert.match(validarSolicitudProduccion(solicitud('12', { emitidoEn: 'ayer' })).errores.join(), /emitidoEn/);
  assert.match(validarSolicitudProduccion(solicitud('12', { tabla: 'otra' })).errores.join(), /campo no admitido: tabla/);
  assert.match(validarSolicitudProduccion(solicitud('99')).errores.join(), /agente no admitido/);
  assert.equal(validarSolicitudProduccion(solicitud('04'), { agentes: ['12'] }).ok, false);
  assert.equal(validarSolicitudProduccion(null).ok, false);
});

test('selección por fecha: la MÁS RECIENTE por generadoEn parseado, aunque las filas vengan desordenadas o la comparación de cadenas engañe', () => {
  const t = Date.now();
  const a = filaProd('12', 'ex-01', iso(t - 20 * 86400000));
  const b = filaProd('12', 'ex-03', iso(t - 3600000));
  const c = filaProd('12', 'ex-02', iso(t - 2 * 86400000));
  // trampa de orden alfabético: «…:00Z» > «…:00.500Z» como cadena, pero es ANTERIOR como instante
  const d1 = filaProd('12', 'ex-04', '2026-11-10T09:00:00Z'); const d2 = filaProd('12', 'ex-05', '2026-11-10T09:00:00.500Z');
  const r = armarRespuestaProduccion({ solicitud: solicitud('12', { limite: 3 }), filas: [c, d1, a, d2, b], ahoraIso: ahoraIso() });
  assert.deepEqual(r.filas.map((f) => f.idEjecucion), ['ex-03', 'ex-02', 'ex-05']);
  assert.equal(r.sintetico, false);
  assert.equal(validarRespuestaLector(r, { idSolicitud: 'sol-prod-00000001', agente: '12', entorno: 'produccion', limite: 3 }).ok, true);
  const t2 = armarRespuestaProduccion({ solicitud: solicitud('12', { limite: 5 }), filas: [d1, d2], ahoraIso: ahoraIso() });
  assert.deepEqual(t2.filas.map((f) => f.idEjecucion), ['ex-05', 'ex-04']);
});

test('filas no fiables se descartan y se cuentan: otro entorno, fecha ilegible o futura, sin idEjecucion; sin datos → lista vacía', () => {
  const t = Date.now();
  const buena = filaProd('04', 'ex-19', iso(t - 3600000));
  const local = filaProd('04', 'fx-04-01', iso(t - 1000), [], 'local');
  const mala = { ...filaProd('04', 'ex-20', iso(t - 2000)), generadoEn: 'ayer por la tarde' };
  const futura = filaProd('04', 'ex-21', iso(t + 3 * 86400000));
  const sinId = { ...filaProd('04', 'ex-22', iso(t - 3000)), idEjecucion: '' };
  const r = armarRespuestaProduccion({ solicitud: solicitud('04'), filas: [local, mala, futura, sinId, buena, {}], ahoraIso: ahoraIso() });
  assert.deepEqual(r.filas.map((f) => f.idEjecucion), ['ex-19']);
  assert.equal(r.descartadasEnOrigen, 4);
  const vacia = armarRespuestaProduccion({ solicitud: solicitud('04'), filas: [{}], ahoraIso: ahoraIso() });
  assert.deepEqual(vacia.filas, []); assert.equal(vacia.descartadasEnOrigen, 0);
});

test('una lectura que podría estar TRUNCADA (tantas filas como el límite) se rechaza en lugar de responder con algo posiblemente antiguo', () => {
  const t = Date.now();
  const filas = Array.from({ length: MAX_LECTURA_TABLA }, (_, i) => filaProd('12', `ex-${i}`, iso(t - i * 60000)));
  assert.throws(() => armarRespuestaProduccion({ solicitud: solicitud('12'), filas, ahoraIso: ahoraIso() }), /LECTURA INCOMPLETA/);
  assert.equal(armarRespuestaProduccion({ solicitud: solicitud('12'), filas: filas.slice(1), ahoraIso: ahoraIso() }).filas.length, 5);
});

// ── constructor y linter estricto ─────────────────────────────────────────────────────────────────────────────────────────────
const wfProd = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'automation', 'workflows-puente', 'produccion', ARCHIVO_PRODUCCION), 'utf8'));
const lint = (wf) => lintLectorProduccion(wf, ARCHIVO_PRODUCCION, JSON.stringify(wf));

test('el archivo generado está sincronizado con las bibliotecas y cumple el linter estricto', () => {
  const actual = fs.readFileSync(path.join(RAIZ, 'automation', 'workflows-puente', 'produccion', ARCHIVO_PRODUCCION), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(actual, construirLectorProduccion(), 'ejecuta node scripts/automation/build-lector-produccion.mjs --write');
  assert.deepEqual(lint(wfProd()), []);
  const wf = wfProd();
  assert.equal(wf.active, false);
  assert.deepEqual(wf.nodes.filter((n) => n.type.endsWith('webhook')).map((n) => n.parameters.path).sort(), ['tai-lector-prod-04', 'tai-lector-prod-12']);
  assert.ok(wf.nodes.filter((n) => n.type.endsWith('webhook')).every((n) => n.credentials.httpHeaderAuth.name === CREDENCIAL_LECTOR_PRODUCCION && n.credentials.httpHeaderAuth.id === 'REEMPLAZAR_AL_IMPORTAR'));
  assert.deepEqual(wf.nodes.filter((n) => n.type.endsWith('dataTable')).map((n) => n.parameters.dataTableId.value).sort(), ['auditor_general_instantaneas', 'calidad_catalogo_instantaneas']);
  assert.ok(wf.nodes.filter((n) => n.type.endsWith('dataTable')).every((n) => n.parameters.operation === 'get'));
});

test('el linter general NO se debilita: sigue rechazando una variante de producción y ni siquiera recorre la subcarpeta', () => {
  const r = comprobarWorkflow(wfProd(), { nombreArchivo: ARCHIVO_PRODUCCION });
  assert.ok(r.errores.length > 0, 'el linter general la rechaza');
  assert.ok(!fs.readdirSync(path.join(RAIZ, 'automation', 'workflows-puente')).some((f) => /produccion\.json$/.test(f)), 'no hay variante de producción en la carpeta que recorre el linter general');
});

test('el linter estricto rechaza escritura, rutas extra, salidas HTTP, secretos, credenciales del lector local y ajustes inseguros', () => {
  const casos = [
    ['nodo de escritura', (w) => { w.nodes.find((n) => n.type.endsWith('dataTable')).parameters.operation = 'insert'; }, /row\/get|lectura/],
    ['petición saliente', (w) => { w.nodes.push({ parameters: { url: 'https://x.example' }, name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0] }); }, /no permitido/],
    ['webhook adicional', (w) => { const o = w.nodes.find((n) => n.type.endsWith('webhook')); w.nodes.push({ ...JSON.parse(JSON.stringify(o)), name: 'Extra', parameters: { ...o.parameters, path: 'tai-lector-prod-99' } }); }, /exactamente 2|path|11 nodos/],
    ['ruta del lector local', (w) => { w.nodes.find((n) => n.type.endsWith('webhook')).parameters.path = 'tai-lector-04'; }, /path/],
    ['credencial del lector local', (w) => { w.nodes.find((n) => n.type.endsWith('webhook')).credentials.httpHeaderAuth.name = 'Treidilor — Lector puente (solo lectura)'; }, /credencial/],
    ['id de credencial real', (w) => { w.nodes.find((n) => n.type.endsWith('webhook')).credentials.httpHeaderAuth.id = 'AbC123xyz'; }, /credencial/],
    ['entorno local en la configuración', (w) => { const n = w.nodes.find((x) => x.name === 'Validar solicitud (12)'); n.parameters.jsCode = n.parameters.jsCode.replace('"produccion"', '"local"'); }, /configuración LECTOR/],
    ['datos sintéticos declarados', (w) => { const n = w.nodes.find((x) => x.name === 'Armar respuesta (04)'); n.parameters.jsCode = n.parameters.jsCode.replace('"sintetico": false', '"sintetico": true'); }, /configuración LECTOR/],
    ['guarda datos de ejecución', (w) => { w.settings.saveDataSuccessExecution = 'all'; }, /datos de ejecución/],
    ['workflow activo', (w) => { w.active = true; }, /INACTIVO/],
    ['límite de lectura distinto', (w) => { w.nodes.find((n) => n.type.endsWith('dataTable')).parameters.limit = 5000; }, /como máximo/],
    ['sin ordenar por fecha', (w) => { w.nodes.find((n) => n.type.endsWith('dataTable')).parameters.orderBy = false; }, /generadoEn/],
    ['filtro distinto del entorno', (w) => { w.nodes.find((n) => n.type.endsWith('dataTable')).parameters.filters.conditions[0].keyName = 'host'; }, /filtrar/],
    ['secreto embebido', (w) => { w.nodes.find((n) => n.type.endsWith('stickyNote')).parameters.content += ` Bearer ${'abcdefghijklmnopqrstuvwxyz012345'}`; }, /secreto/],
    ['acceso a red desde un Code', (w) => { const n = w.nodes.find((x) => x.name === 'Armar respuesta (12)'); n.parameters.jsCode += "\nawait fetch('https://x.example');"; }, /no permitidos/],
    ['conexión extra', (w) => { w.connections['Recibir (04)'].main[0].push({ node: 'Responder (12)', type: 'main', index: 0 }); }, /cadena/],
    ['pinData', (w) => { w.pinData = {}; }, /no admitidas/],
  ];
  for (const [nombre, mutar, esperado] of casos) {
    const wf = wfProd(); mutar(wf);
    const e = lint(wf);
    assert.ok(e.length > 0, `se debía rechazar: ${nombre}`);
    assert.match(e.join(' | '), esperado, nombre);
  }
  assert.ok(lintLectorProduccion(wfProd(), 'otro.produccion.json').length > 0, 'otro nombre de archivo');
});

// ── cliente interno del Director ──────────────────────────────────────────────────────────────────────────────────────────────
test('el cliente de producción sólo acepta destinos INTERNOS y explícitos, nunca dominios públicos ni /webhook-test', () => {
  for (const h of ['127.0.0.1', 'localhost', '10.0.1.5', '172.16.4.2', '172.31.0.9', '192.168.1.7', 'n8n', 'proyecto_n8n', '[::1]', 'fd00::1']) assert.equal(esHostInterno(h), true, h);
  for (const h of ['n8n.midominio.com', 'treidilor.com', '8.8.8.8', '172.32.0.1', '300.1.1.1', '', '2001:db8::1']) assert.equal(esHostInterno(h), false, h);
  const base = { token: TOKEN, hostsPermitidos: ['n8n'] };
  assert.ok(crearLectorProduccion({ ...base, urlBase: 'http://n8n:5678/webhook' }));
  assert.throws(() => crearLectorProduccion({ ...base, urlBase: 'https://n8n.midominio.com/webhook', hostsPermitidos: ['n8n.midominio.com'] }), /interna/);
  assert.throws(() => crearLectorProduccion({ ...base, urlBase: 'http://otro:5678/webhook' }), /lista explícita/);
  assert.throws(() => crearLectorProduccion({ token: TOKEN, urlBase: 'http://n8n:5678/webhook' }), /lista explícita/);
  assert.throws(() => crearLectorProduccion({ ...base, urlBase: 'http://n8n:5678/webhook-test' }), /\/webhook/);
  assert.throws(() => crearLectorProduccion({ ...base, urlBase: 'http://usuario:clave@n8n:5678/webhook' }), /credenciales/);
  assert.throws(() => crearLectorProduccion({ ...base, urlBase: 'http://n8n:5678/webhook?x=1' }), /parámetros/);
  assert.throws(() => crearLectorProduccion({ hostsPermitidos: ['n8n'], urlBase: 'http://n8n:5678/webhook', token: 'corto' }), /token/i);
});

// ── E2E con el n8n FALSO que ejecuta el JSON REAL de la variante ──────────────────────────────────────────────────────────────
async function conLector(tablas, opciones, fn) {
  const n8n = await arrancarN8nFalso({ tablas, token: TOKEN, cabecera: CABECERA_LECTOR_PRODUCCION, workflow: cargarWorkflowProduccion(), patron: /^\/webhook\/(tai-lector-prod-(?:04|12))$/, ...(opciones.falso || {}) });
  try { return await fn(n8n, crearLectorProduccion({ urlBase: n8n.urlBase, token: opciones.token ?? TOKEN, hostsPermitidos: ['127.0.0.1'], ttlMs: 0, ...(opciones.lector || {}) })); } finally { await n8n.cerrar(); }
}
const tablasProd = () => {
  const t = AHORA;
  return {
    calidad_catalogo_instantaneas: [filaProd('04', 'ex-16', iso(t - 3 * 86400000), [['ficha:sin_categoria:p-1', 'media']]), filaProd('04', 'ex-19', iso(t - 2 * 3600000), [['ficha:sin_categoria:p-1', 'media'], ['ficha:comercio_malformado:p-3', 'media']]), filaProd('04', 'ex-18', iso(t - 86400000), [['ficha:sin_categoria:p-1', 'media']]), filaProd('04', 'fx-04-01', iso(t - 1000), [], 'local')],
    auditor_general_instantaneas: [filaProd('12', 'ex-13', iso(t - 2 * 86400000)), filaProd('12', 'ex-17', iso(t - 3600000))],
  };
};

test('E2E: ambas rutas, la más reciente aunque el origen no ordene, procedencia «lectura de producción» y consistencia confirmada', async () => {
  await conLector(tablasProd(), { falso: { ordenar: false } }, async (n8n, lector) => {
    const E = crearEntorno({ fix: {} });
    try {
      E.d.lector = lector;
      await lector.refrescar(['04', '12']);
      const canal = new Canal13({ director: E.d });
      const m12 = await canal.recibir('¿Cómo está el sitio?');
      const m04 = await canal.recibir('¿Cómo está el catálogo?');
      assert.match(m12.detalle, /ex-17/); assert.doesNotMatch(m12.detalle, /ex-13/);
      assert.match(m04.detalle, /ex-19/); assert.doesNotMatch(m04.detalle, /fx-04-01|ex-18/, 'ni la fila de otro entorno ni una anterior');
      for (const m of [m12, m04]) {
        const et = m.naturalezaDatos.map((n) => n.etiqueta);
        assert.ok(et.includes('real_produccion'), et.join());
        assert.ok(!et.includes('simulado') && !et.includes('real_saneado'), et.join());
        assert.ok(m.avisos.some((a) => /LECTURA DE PRODUCCIÓN/.test(a) && /NO está verificado/.test(a)));
        assert.ok(!m.avisos.some((a) => /DATOS DE PRUEBA|DATOS REALES SANEADOS|COPIA DE PRUEBAS/.test(a)), 'no se presenta como prueba, saneada ni copia');
      }
      const trazas = n8n.registro.filter((r) => r.metodo === 'POST');
      assert.equal(trazas.length, 4, 'dos lecturas independientes por agente');
      assert.ok(trazas.every((r) => r.cabecera === 'presente' && /"entorno":"produccion"/.test(r.cuerpo) && /"emitidoEn":/.test(r.cuerpo)));
      assert.ok(trazas.every((r) => !r.cuerpo.includes(TOKEN)), 'el token sólo viaja en la cabecera');
      assert.ok(new Set(trazas.map((r) => JSON.parse(r.cuerpo).idSolicitud)).size === 4, 'idSolicitud distinto en cada petición');
      assert.deepEqual(lector.estado().map((e) => e.ok), [true, true]);
      const inf = lector.ultima('12'); assert.equal(inf.informe.idEjecucion, 'ex-17');
    } finally { E.limpiar(); }
  });
});

test('ausencia de datos: la tabla sin filas de producción se declara, no se inventa', async () => {
  await conLector({ calidad_catalogo_instantaneas: [filaProd('04', 'fx-04-01', iso(Date.now() - 1000), [], 'local')], auditor_general_instantaneas: [] }, {}, async (n8n, lector) => {
    const E = crearEntorno({ fix: {} });
    try {
      E.d.lector = lector; await lector.refrescar(['04', '12']);
      const m = await new Canal13({ director: E.d }).recibir('¿Cómo está el sitio?');
      assert.match(`${m.textoClaro} ${m.detalle}`, /No consta|no hay|sin datos/i);
      assert.equal(m.naturalezaDatos.map((n) => n.etiqueta).includes('real_produccion'), false);
    } finally { E.limpiar(); }
  });
});

test('credencial incorrecta, servicio caído, respuesta ajena, datos sintéticos y repetición: el Director NO usa nada de eso', async () => {
  // credencial equivocada → 403 → origen no disponible
  await conLector(tablasProd(), { token: 'token-equivocado-0123456789' }, async (n8n, lector) => {
    await lector.refrescar(['12']);
    assert.equal(lector.estado()[0].ok, false); assert.match(lector.estado()[0].error, /estado 403/);
    assert.throws(() => lector.ultima('12'), /estado 403/);
  });
  // ruta/credencial del lector LOCAL no sirve en producción (y viceversa): la ruta no existe
  const n8n = await arrancarN8nFalso({ tablas: tablasProd(), token: TOKEN, cabecera: CABECERA_LECTOR_PRODUCCION, workflow: cargarWorkflowProduccion(), patron: /^\/webhook\/(tai-lector-prod-(?:04|12))$/ });
  const { LectorN8n } = await import('../puente/lector-n8n.mjs');
  const local = new LectorN8n({ urlBase: n8n.urlBase, token: TOKEN, entorno: 'produccion' });
  await local.refrescar(['12']); assert.equal(local.estado()[0].ok, false);
  await n8n.cerrar();
  // servicio caído
  const caido = await arrancarN8nFalso({ tablas: tablasProd(), token: TOKEN, cabecera: CABECERA_LECTOR_PRODUCCION, workflow: cargarWorkflowProduccion(), patron: /^\/webhook\/(tai-lector-prod-(?:04|12))$/ });
  const l2 = crearLectorProduccion({ urlBase: caido.urlBase, token: TOKEN, hostsPermitidos: ['127.0.0.1'], timeoutMs: 800 });
  await caido.cerrar(); await l2.refrescar(['04']);
  assert.equal(l2.estado()[0].ok, false); assert.match(l2.estado()[0].error, /contactar|a tiempo/);
  // el servicio devuelve datos marcados como sintéticos o de otro agente → se rechaza entera
  await conLector(tablasProd(), { falso: { modificar: (r, fin, body) => fin(200, { ...r.cuerpo, sintetico: true }) } }, async (_n, lector) => { await lector.refrescar(['12']); assert.equal(lector.estado()[0].ok, false); assert.match(lector.estado()[0].error, /sintéticos|rechazada/); });
  await conLector(tablasProd(), { falso: { modificar: (r, fin, body) => fin(200, { ...r.cuerpo, idSolicitud: 'otra-solicitud-0001' }) } }, async (_n, lector) => { await lector.refrescar(['12']); assert.match(lector.estado()[0].error, /idSolicitud/); });
  await conLector(tablasProd(), { falso: { modificar: (r, fin) => fin(200, { ...r.cuerpo, filas: r.cuerpo.filas.map((f) => ({ ...f, entorno: 'local' })) }) } }, async (_n, lector) => { await lector.refrescar(['12']); assert.match(lector.estado()[0].error, /entorno/); });
  await conLector(tablasProd(), { falso: { modificar: (r, fin) => fin(200, 'esto no es json') } }, async (_n, lector) => { await lector.refrescar(['12']); assert.match(lector.estado()[0].error, /JSON/); });
});

test('repetición: una solicitud capturada y reenviada pasada la ventana la rechaza el workflow (500, sin datos)', async () => {
  const n8n = await arrancarN8nFalso({ tablas: tablasProd(), token: TOKEN, cabecera: CABECERA_LECTOR_PRODUCCION, workflow: cargarWorkflowProduccion(), patron: /^\/webhook\/(tai-lector-prod-(?:04|12))$/ });
  try {
    const enviar = (emitidoEn) => fetch(`${n8n.urlBase}/tai-lector-prod-12`, { method: 'POST', headers: { 'content-type': 'application/json', [CABECERA_LECTOR_PRODUCCION]: TOKEN }, body: JSON.stringify(solicitud('12', { emitidoEn })) });
    const ok = await enviar(ahoraIso()); assert.equal(ok.status, 200);
    const j = await ok.json(); assert.equal(j.entorno, 'produccion'); assert.equal(j.sintetico, false); assert.equal(j.filas[0].idEjecucion, 'ex-17');
    const vieja = await enviar(iso(Date.now() - 10 * 60000)); assert.equal(vieja.status, 500); assert.doesNotMatch(await vieja.text(), /ex-17|payload/);
    const sinSello = await fetch(`${n8n.urlBase}/tai-lector-prod-12`, { method: 'POST', headers: { 'content-type': 'application/json', [CABECERA_LECTOR_PRODUCCION]: TOKEN }, body: JSON.stringify({ esquema: 'tai-lector/1', idSolicitud: 'sol-prod-00000009', agente: '12', entorno: 'produccion' }) });
    assert.equal(sinSello.status, 500);
    const local = await fetch(`${n8n.urlBase}/tai-lector-prod-12`, { method: 'POST', headers: { 'content-type': 'application/json', [CABECERA_LECTOR_PRODUCCION]: TOKEN }, body: JSON.stringify(solicitud('12', { entorno: 'local' })) });
    assert.equal(local.status, 500, 'pedir el entorno local al lector de producción falla');
    const otro = await fetch(`${n8n.urlBase}/tai-lector-prod-12`, { method: 'POST', headers: { 'content-type': 'application/json', [CABECERA_LECTOR_PRODUCCION]: TOKEN }, body: JSON.stringify(solicitud('04')) });
    assert.equal(otro.status, 500, 'la ruta del agente 12 no sirve el agente 04');
  } finally { await n8n.cerrar(); }
});

test('límites: frecuencia por minuto en el cliente y tamaño máximo de respuesta', async () => {
  await conLector(tablasProd(), { lector: { maxPeticionesPorMinuto: 3, ttlMs: 0 } }, async (n8n, lector) => {
    await lector.refrescar(['12'], { forzar: true });   // 2 peticiones
    await lector.refrescar(['12'], { forzar: true });   // la 3.ª pasa, la 4.ª no
    assert.equal(lector.estado()[0].ok, false); assert.match(lector.estado()[0].error, /límite de consultas por minuto/);
    assert.equal(n8n.registro.filter((r) => r.metodo === 'POST').length, 3, 'no se hizo la 4.ª petición');
  });
  await conLector(tablasProd(), { falso: { modificar: (r, fin) => fin(200, JSON.stringify({ x: 'a'.repeat(2 * 1024 * 1024 + 10) })) } }, async (_n, lector) => { await lector.refrescar(['12']); assert.match(lector.estado()[0].error, /tamaño/); });
});

test('el lector local sigue intacto e inactivo y los siete workflows originales no se tocan', () => {
  const local = JSON.parse(fs.readFileSync(path.join(RAIZ, 'automation', 'workflows-puente', 'lector-instantaneas.local.json'), 'utf8'));
  assert.equal(local.active, false);
  assert.deepEqual(local.nodes.filter((n) => n.type.endsWith('webhook')).map((n) => n.parameters.path).sort(), ['tai-lector-04', 'tai-lector-12']);
  assert.equal(comprobarWorkflow(local, { nombreArchivo: 'lector-instantaneas.local.json' }).errores.length, 0);
  assert.equal(fs.readdirSync(path.join(RAIZ, 'automation', 'workflows')).filter((f) => f.endsWith('.json')).length, 7);
});
