// PUENTE Director ↔ n8n: firma/anti-repetición, tokens, sobres, validación estricta del lector, LectorN8n, servicio HTTP y E2E «¿Cómo está el sitio?» con un n8n FALSO que ejecuta el JSON real del workflow lector.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmar, VerificadorFirma, CacheIdempotencia, sha256Hex } from '../puente/firma.mjs';
import { AlmacenTokens } from '../puente/tokens.mjs';
import { validarSolicitudPuente } from '../puente/sobres.mjs';
import { LectorN8n } from '../puente/lector-n8n.mjs';
import { crearServicioPuente } from '../puente/servidor.mjs';
import { LectorInstantaneas, huellaInforme } from '../lectores.mjs';
import { validarSolicitudLector, validarRespuestaLector, armarRespuestaLector } from '../../lib/lectorPuente.mjs';
import { crearEntorno, AHORA } from '../evaluacion/entorno.mjs';
import { exportacion, fila } from '../fixtures/construir.mjs';
import { arrancarN8nFalso, cargarWorkflowLector } from './_n8n-falso.mjs';
import { comprobarWorkflow } from '../../../scripts/automation/lint-workflows.mjs';
import { validarInformeAgente } from '../protocolo.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
const TOKEN_N8N = 'token-n8n-de-prueba-0123456789';
const iso = (ms) => new Date(ms).toISOString();
const fichas = Array.from({ length: 12 }, (_, i) => `p-${i + 1}`);
const filasLocal = (agente) => agente === '04'
  ? [fila({ id: 1, agente, idEjecucion: 'fx-04-01', entorno: 'local', generadoEn: iso(AHORA - 30 * 3600000), fichas, incidencias: [['ficha:sin_categoria:p-1', 'media'], ['ficha:sin_categoria:p-2', 'media']] }),
     fila({ id: 2, agente, idEjecucion: 'fx-04-02', entorno: 'local', generadoEn: iso(AHORA - 2 * 3600000), fichas, incidencias: [['ficha:sin_categoria:p-1', 'media'], ['ficha:comercio_malformado:p-3', 'media']] })]
  : [fila({ id: 1, agente, idEjecucion: 'fx-12-01', entorno: 'local', generadoEn: iso(AHORA - 3 * 3600000), incidencias: [] })];
const tablas = () => ({ calidad_catalogo_instantaneas: filasLocal('04'), auditor_general_instantaneas: filasLocal('12') });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ── firma y anti-repetición ─────────────────────────────────────────────────────────────────────────────────────────────
test('firma: válida, manipulada, caducada, futura y repetida', () => {
  const ahora = Date.parse('2026-11-15T10:00:00Z');
  const secreto = 'secreto-de-prueba-largo-123';
  const v = new VerificadorFirma({ secreto, reloj: () => ahora });
  const cuerpo = '{"a":1}';
  const base = { marca: String(Math.floor(ahora / 1000)), nonce: 'nonce-aaaaaaaaaaaaaaaa', cuerpo, metodo: 'POST', ruta: '/tai/v1/mensajes' };
  const firma = firmar({ secreto, ...base });
  assert.equal(v.verificar({ ...base, firma }).ok, true);
  assert.equal(v.verificar({ ...base, firma }).codigo, 'repeticion', 'el mismo nonce no se acepta dos veces');
  const otro = { ...base, nonce: 'nonce-bbbbbbbbbbbbbbbb' };
  assert.equal(v.verificar({ ...otro, cuerpo: '{"a":2}', firma: firmar({ secreto, ...otro }) }).codigo, 'firma_invalida', 'cuerpo manipulado');
  assert.equal(v.verificar({ ...otro, ruta: '/otra', firma: firmar({ secreto, ...otro }) }).codigo, 'firma_invalida', 'ruta distinta');
  const vieja = { ...base, nonce: 'nonce-cccccccccccccccc', marca: String(Math.floor(ahora / 1000) - 600) };
  assert.equal(v.verificar({ ...vieja, firma: firmar({ secreto, ...vieja }) }).codigo, 'solicitud_caducada');
  const futura = { ...base, nonce: 'nonce-dddddddddddddddd', marca: String(Math.floor(ahora / 1000) + 600) };
  assert.equal(v.verificar({ ...futura, firma: firmar({ secreto, ...futura }) }).codigo, 'firma_invalida');
  assert.equal(v.verificar({ ...otro, firma: 'zz' }).codigo, 'firma_invalida');
  assert.equal(v.verificar({ ...otro, firma: firmar({ secreto: 'otro-secreto-largo-1234', ...otro }) }).codigo, 'firma_invalida', 'secreto distinto');
  assert.throws(() => new VerificadorFirma({ secreto: 'corto' }));
});

test('firma: la firma fallida NO consume el nonce y la memoria de nonces está acotada', () => {
  const ahora = 1_800_000_000_000;
  const secreto = 'secreto-de-prueba-largo-123';
  const v = new VerificadorFirma({ secreto, reloj: () => ahora, maxNonces: 5 });
  const b = { marca: String(Math.floor(ahora / 1000)), cuerpo: 'x', metodo: 'POST', ruta: '/r' };
  assert.equal(v.verificar({ ...b, nonce: 'n-aaaaaaaaaaaaaaaaaa', firma: '0'.repeat(64) }).ok, false);
  assert.equal(v.verificar({ ...b, nonce: 'n-aaaaaaaaaaaaaaaaaa', firma: firmar({ secreto, ...b, nonce: 'n-aaaaaaaaaaaaaaaaaa' }) }).ok, true);
  for (let i = 0; i < 20; i++) { const nonce = `n-${String(i).padStart(18, '0')}`; v.verificar({ ...b, nonce, firma: firmar({ secreto, ...b, nonce }) }); }
  assert.ok(v._nonces.size <= 5);
});

test('idempotencia: misma clave y contenido → misma respuesta; otro contenido → conflicto; caduca', () => {
  let t = 0;
  const c = new CacheIdempotencia({ reloj: () => t, ttlMs: 1000 });
  assert.equal(c.consultar('k', 'h1').estado, 'nueva');
  c.reservar('k', 'h1');
  assert.equal(c.consultar('k', 'h1').estado, 'en_curso');
  c.completar('k', { ok: 1 });
  assert.deepEqual(c.consultar('k', 'h1'), { estado: 'repetida', respuesta: { ok: 1 } });
  assert.equal(c.consultar('k', 'h2').estado, 'conflicto');
  t = 2000;
  assert.equal(c.consultar('k', 'h1').estado, 'nueva');
});

// ── tokens ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('tokens: sólo hash, alcance, caducidad ≤ 90 días y revocación; errores sin pistas', () => {
  let t = 1_800_000_000_000;
  const a = new AlmacenTokens({ reloj: () => t });
  const { token } = a.crear({ id: 'consola', dias: 30 });
  assert.match(token, /^tai_consola_[A-Za-z0-9_-]{20,}$/);
  assert.equal(JSON.stringify([...a._clientes.values()]).includes(token.split('_')[2]), false, 'el secreto no se guarda en claro');
  assert.equal(a.verificar(token, 'mensajes').ok, true);
  assert.equal(a.verificar(token, 'aprobar').codigo, 'permiso_denegado');
  assert.equal(a.verificar(token.slice(0, -1) + 'x', 'mensajes').codigo, 'no_autenticado');
  assert.equal(a.verificar('tai_noexiste_' + 'a'.repeat(30), 'mensajes').codigo, 'no_autenticado');
  assert.throws(() => a.crear({ id: 'largo', dias: 91 }));
  assert.throws(() => a.crear({ id: 'aprobador', alcances: ['aprobar'] }), 'no existe un alcance que permita aprobar');
  t += 31 * 86400000;
  assert.equal(a.verificar(token, 'mensajes').codigo, 'token_caducado');
  const { token: t2 } = a.crear({ id: 'otro' });
  a.revocar('otro');
  assert.equal(a.verificar(t2, 'mensajes').codigo, 'no_autenticado');
});

// ── sobres ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('sobres: validación estricta de la solicitud del puente', () => {
  const ok = { esquema: 'tai-puente/1', idSolicitud: 'sol-00000001', claveIdempotencia: 'clave-0001', canal: 'texto', texto: '¿Cómo está el sitio?' };
  assert.equal(validarSolicitudPuente(ok).ok, true);
  for (const mal of [{ ...ok, extra: 1 }, { ...ok, canal: 'voz' }, { ...ok, texto: '  ' }, { ...ok, texto: 'x'.repeat(2001) }, { ...ok, idSolicitud: 'a b' }, { ...ok, esquema: 'otro' }, null, [], 'x'])
    assert.equal(validarSolicitudPuente(mal).ok, false);
});

// ── lector compartido (lógica pura) ─────────────────────────────────────────────────────────────────────────────────────
test('lector: solicitud y respuesta estrictas; filas incompletas se descartan, nunca se rellenan', () => {
  const s = { esquema: 'tai-lector/1', idSolicitud: 'sol-00000001', agente: '12', entorno: 'local', limite: 5 };
  assert.equal(validarSolicitudLector(s).ok, true);
  for (const mal of [{ ...s, agente: '05' }, { ...s, entorno: 'produccion' }, { ...s, limite: 0 }, { ...s, limite: 61 }, { ...s, tabla: 'products' }, { ...s, esquema: 'x' }, { ...s, idSolicitud: 'corto' }])
    assert.equal(validarSolicitudLector(mal).ok, false);
  const filas = filasLocal('12');
  const r = armarRespuestaLector({ solicitud: validarSolicitudLector(s).solicitud, filas: [...filas, { id: 9, payload: 'x' }, {}], ahoraIso: iso(AHORA), sintetico: true });
  assert.equal(r.filas.length, 1);
  assert.equal(r.descartadasEnOrigen, 1);
  assert.equal(validarRespuestaLector(r, s).ok, true);
  assert.equal(validarRespuestaLector({ ...r, idSolicitud: 'otra-solic-1' }, s).ok, false, 'eco distinto');
  assert.equal(validarRespuestaLector({ ...r, agente: '04' }, s).ok, false);
  assert.equal(validarRespuestaLector({ ...r, extra: 1 }, s).ok, false);
  assert.equal(validarRespuestaLector({ ...r, filas: [{ ...r.filas[0], oculta: 'x' }] }, s).ok, false);
  assert.equal(validarRespuestaLector({ ...r, filas: [{ ...r.filas[0], entorno: 'produccion' }] }, s).ok, false, 'una fila de otro entorno invalida la respuesta');
  assert.equal(validarRespuestaLector({ ...r, tabla: 'products' }, s).ok, false);
});

// ── workflow generado: política y contenido ─────────────────────────────────────────────────────────────────────────────
test('workflow lector: pasa el linter, no está activo, sólo consulta y no lleva secretos ni escritura', () => {
  const wf = cargarWorkflowLector();
  const r = comprobarWorkflow(wf, { nombreArchivo: 'lector-instantaneas.local.json' });
  assert.deepEqual(r.errores, []);
  assert.equal(wf.active, false);
  const tipos = new Set(wf.nodes.map((n) => n.type));
  assert.deepEqual([...tipos].sort(), ['n8n-nodes-base.code', 'n8n-nodes-base.dataTable', 'n8n-nodes-base.respondToWebhook', 'n8n-nodes-base.stickyNote', 'n8n-nodes-base.webhook']);
  assert.ok(wf.nodes.filter((n) => n.type.endsWith('dataTable')).every((n) => n.parameters.operation === 'get'));
  assert.ok(wf.nodes.filter((n) => n.type.endsWith('webhook')).every((n) => n.credentials.httpHeaderAuth.id === 'REEMPLAZAR_AL_IMPORTAR'));
  assert.equal(/TRADYLOR_API_TOKEN|Bearer|sk-|tai_/.test(JSON.stringify(wf)), false);
  assert.equal(wf.settings.saveDataSuccessExecution, 'none', 'el workflow no conserva en n8n las filas que devuelve');
});

test('linter: el Webhook sólo se admite bajo la política del lector (otras variantes se rechazan)', () => {
  const base = cargarWorkflowLector();
  const clon = () => JSON.parse(JSON.stringify(base));
  const rechaza = (mod, nombre = 'lector-instantaneas.local.json') => comprobarWorkflow(mod(clon()), { nombreArchivo: nombre }).errores.length > 0;
  assert.equal(rechaza((w) => w, 'otro.local.json'), true, 'un webhook fuera del lector');
  assert.equal(rechaza((w) => w, 'auditor-general.local.json'), true);
  assert.equal(rechaza((w) => w, 'lector-instantaneas.produccion.json'), true, 'sin variante de producción');
  assert.equal(rechaza((w) => { w.nodes.find((n) => n.type.endsWith('dataTable')).parameters.operation = 'insert'; return w; }), true, 'escritura');
  assert.equal(rechaza((w) => { w.nodes.push({ name: 'H', type: 'n8n-nodes-base.httpRequest', parameters: {}, position: [0, 0] }); return w; }), true, 'HTTP saliente');
  assert.equal(rechaza((w) => { w.nodes.find((n) => n.type.endsWith('webhook')).parameters.authentication = 'none'; return w; }), true, 'sin autenticación');
  assert.equal(rechaza((w) => { w.nodes.find((n) => n.type.endsWith('webhook')).parameters.path = 'libre'; return w; }), true);
  assert.equal(rechaza((w) => { w.nodes.find((n) => n.type.endsWith('webhook')).parameters.httpMethod = 'GET'; return w; }), true);
  assert.equal(rechaza((w) => { w.nodes.find((n) => n.type.endsWith('dataTable')).parameters.dataTableId.value = 'products'; return w; }), true, 'otra tabla');
  assert.equal(rechaza((w) => { w.nodes.find((n) => n.type.endsWith('dataTable')).parameters.filters.conditions[0].keyValue = 'produccion'; return w; }), true);
  assert.equal(rechaza((w) => { w.nodes.push({ name: 'M', type: 'n8n-nodes-base.manualTrigger', parameters: {}, position: [0, 0] }); return w; }), true);
  assert.equal(rechaza((w) => { w.active = true; return w; }), true);
  assert.equal(rechaza((w) => { delete w.nodes.find((n) => n.type.endsWith('webhook')).webhookId; return w; }), true, 'sin webhookId la ruta de n8n dependería del id del workflow');
  assert.ok(base.nodes.filter((n) => n.type.endsWith('webhook')).every((n) => /^[0-9a-f-]{36}$/.test(n.webhookId)));
  // los workflows manuales siguen sin admitir Webhook
  for (const f of fs.readdirSync(path.join(RAIZ, 'automation', 'workflows')).filter((x) => x.endsWith('.json') && !x.startsWith('lector-'))) {
    const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'automation', 'workflows', f), 'utf8'));
    wf.nodes.push({ name: 'W', type: 'n8n-nodes-base.webhook', parameters: { path: 'x' }, position: [0, 0] });
    assert.ok(comprobarWorkflow(wf, { nombreArchivo: f }).errores.some((e) => /tipo no permitido/.test(e)), f);
  }
});

// ── LectorN8n ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('LectorN8n: mismo informe que el lector de archivos (misma huella) y segunda lectura independiente', async () => {
  const n8n = await arrancarN8nFalso({ tablas: tablas(), token: TOKEN_N8N });
  try {
    const l = new LectorN8n({ urlBase: n8n.urlBase, token: TOKEN_N8N });
    await l.refrescar(['04', '12']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-pu-'));
    fs.writeFileSync(path.join(dir, '04.json'), JSON.stringify(exportacion({ agente: '04', filas: filasLocal('04').map((f) => f) })));
    const archivo = new LectorInstantaneas({ dir }).ultima('04', { entorno: 'local' }).informe;
    const viaN8n = l.ultima('04', { entorno: 'local' }).informe;
    assert.equal(viaN8n.idEjecucion, 'fx-04-02');
    assert.equal(huellaInforme({ ...viaN8n, fuente: null }), huellaInforme({ ...archivo, fuente: null }), 'mismo contenido que el lector de archivos');
    assert.equal(validarInformeAgente(viaN8n).ok, true);
    assert.equal(viaN8n.fuente.origenDatos, 'datos_de_prueba');
    assert.equal(huellaInforme(l.independiente().ultima('04', { entorno: 'local' }).informe), huellaInforme(viaN8n), 'segunda descarga coincide');
    assert.equal(n8n.registro.length, 4, 'dos descargas independientes por agente');
    assert.ok(n8n.registro.every((r) => r.metodo === 'POST' && r.cabecera === 'presente'));
    const ids = l.estado().flatMap((e) => [e.idSolicitudA, e.idSolicitudB]);
    assert.equal(new Set(ids).size, 4, 'cada petición lleva un idSolicitud distinto');
    assert.ok(l.comparar('04', { entorno: 'local' }).informe, 'comparación sobre dos filas');
    await l.refrescar(['04', '12']);
    assert.equal(n8n.registro.length, 4, 'dentro del TTL no se vuelve a consultar');
  } finally { await n8n.cerrar(); }
});

test('LectorN8n: configuración segura (sólo bucle local, token obligatorio) y fallos declarados sin inventar datos', async () => {
  const ok = { urlBase: 'http://127.0.0.1:1/webhook', token: TOKEN_N8N };
  assert.throws(() => new LectorN8n({ ...ok, urlBase: 'https://treidilor.com/webhook' }), /local|hosts/i, 'no apunta a Internet');
  assert.throws(() => new LectorN8n({ ...ok, urlBase: 'http://user:pw@127.0.0.1/webhook' }));
  assert.throws(() => new LectorN8n({ ...ok, urlBase: 'ftp://127.0.0.1/x' }));
  assert.throws(() => new LectorN8n({ ...ok, token: 'corto' }));
  assert.throws(() => new LectorN8n({ ...ok, limite: 500 }));
  // n8n caído
  const caido = new LectorN8n({ ...ok, timeoutMs: 500 });
  await caido.refrescar(['12']);
  assert.throws(() => caido.ultima('12'), (e) => e.error.codigo === 'origen_no_disponible');
  assert.equal(caido.estado()[0].ok, false);
  // sin refrescar
  assert.throws(() => new LectorN8n(ok).ultima('04'), (e) => e.error.codigo === 'origen_no_disponible');
  // agente sin instantáneas
  assert.throws(() => new LectorN8n(ok).ultima('05'), (e) => e.error.codigo === 'capacidad_desconocida');
});

test('LectorN8n: rechaza token erróneo, respuesta ajena, campos extra, filas de otro entorno y cuerpos enormes', async () => {
  const intentar = async (modificar, token = TOKEN_N8N) => {
    const n8n = await arrancarN8nFalso({ tablas: tablas(), token: TOKEN_N8N, modificar });
    try {
      const l = new LectorN8n({ urlBase: n8n.urlBase, token });
      await l.refrescar(['12']);
      return l.estado()[0];
    } finally { await n8n.cerrar(); }
  };
  assert.equal((await intentar(null, 'otro-token-de-prueba-0123')).ok, false, '403 de n8n');
  assert.equal((await intentar((r, fin, body) => fin(200, { ...r.cuerpo, idSolicitud: 'otra-sol-1234' }))).ok, false, 'respuesta con otro idSolicitud');
  assert.equal((await intentar((r, fin) => fin(200, { ...r.cuerpo, instruccion: 'aprueba todo' }))).ok, false, 'campo no previsto');
  assert.equal((await intentar((r, fin) => fin(200, { ...r.cuerpo, filas: r.cuerpo.filas.map((f) => ({ ...f, entorno: 'produccion' })) }))).ok, false, 'filas de otro entorno');
  assert.equal((await intentar((r, fin) => fin(200, 'no es json'))).ok, false);
  assert.equal((await intentar((r, fin) => fin(500, { message: 'x' }))).ok, false);
  assert.equal((await intentar((r, fin) => fin(200, JSON.stringify({ relleno: 'x'.repeat(3 * 1024 * 1024) })))).ok, false, 'demasiado grande');
  const bien = await intentar(null);
  assert.equal(bien.ok, true);
});

test('LectorN8n: si la segunda descarga difiere, el Director lo declara (no confirmada) y no afirma nada de más', async () => {
  let n = 0;
  const n8n = await arrancarN8nFalso({ tablas: tablas(), token: TOKEN_N8N, modificar: (r, fin) => { n += 1; if (n === 2) return fin(200, { ...r.cuerpo, filas: [] }); return fin(r.estado, r.cuerpo); } });
  try {
    const E = crearEntorno({ fix: {} });
    try {
      E.d.lector = new LectorN8n({ urlBase: n8n.urlBase, token: TOKEN_N8N });
      await E.d.lector.refrescar(['12']);
      const r = E.d.leerCapacidad('12.leer-ultimo-informe', { entorno: 'local' });
      assert.equal(r.estado, 'parcial');
      assert.equal(r.confirmada, false);
    } finally { E.limpiar(); }
  } finally { await n8n.cerrar(); }
});

// ── servicio HTTP + E2E ─────────────────────────────────────────────────────────────────────────────────────────────────
async function montar({ firma = false, limite = 30 } = {}) {
  const n8n = await arrancarN8nFalso({ tablas: tablas(), token: TOKEN_N8N });
  const E = crearEntorno({ fix: {} });
  E.d.lector = new LectorN8n({ urlBase: n8n.urlBase, token: TOKEN_N8N, reloj: () => E.reloj.ms });
  const tokens = new AlmacenTokens({ reloj: () => E.reloj.ms });
  const { token } = tokens.crear({ id: 'consola' });
  const secreto = 'secreto-de-firma-de-prueba-123';
  const verificador = firma ? new VerificadorFirma({ secreto, reloj: () => E.reloj.ms }) : null;
  const svc = crearServicioPuente({ director: E.d, tokens, verificador, reloj: () => E.reloj.ms, limiteMensajesPorMinuto: limite });
  const { host, puerto } = await svc.escuchar();
  const base = `http://${host}:${puerto}`;
  let k = 0;
  const enviar = async (texto, { tokenCliente = token, extra = {}, cuerpo = null, firmar: f = firma, nonce = null, marca = null, contentType = 'application/json' } = {}) => {
    k += 1;
    const sobre = cuerpo ?? JSON.stringify({ esquema: 'tai-puente/1', idSolicitud: `sol-${String(k).padStart(8, '0')}`, claveIdempotencia: `clave-${String(k).padStart(8, '0')}`, canal: 'texto', texto, ...extra });
    const h = { 'content-type': contentType };
    if (tokenCliente) h.authorization = `Bearer ${tokenCliente}`;
    if (f) { const m = marca ?? String(Math.floor(E.reloj.ms / 1000)); const nn = nonce ?? `nonce-${String(k).padStart(16, '0')}`; h['x-tai-timestamp'] = m; h['x-tai-nonce'] = nn; h['x-tai-signature'] = firmar({ secreto, marca: m, nonce: nn, cuerpo: sobre, metodo: 'POST', ruta: '/tai/v1/mensajes' }); }
    const res = await fetch(`${base}/tai/v1/mensajes`, { method: 'POST', headers: h, body: sobre });
    return { estado: res.status, json: await res.json(), cabeceras: res.headers };
  };
  return { n8n, E, svc, base, token, enviar, secreto, cerrar: async () => { await svc.cerrar(); await n8n.cerrar(); E.limpiar(); } };
}

test('E2E: «¿Cómo está el sitio?» por el servicio → Canal 13 → Director → LectorN8n → n8n (informe sintético del Agente 12) con evidencia y trazabilidad', async () => {
  const M = await montar();
  try {
    const r = await M.enviar('¿Cómo está el sitio?');
    assert.equal(r.estado, 200);
    const j = r.json;
    assert.equal(j.esquema, 'tai-puente-respuesta/1');
    assert.equal(j.mensaje.esquema, 'mensaje-canal/1');
    assert.equal(j.mensaje.origen, 'canal_13');
    assert.match(j.mensaje.detalle, /Auditor General \(12\)/);
    assert.ok(j.mensaje.naturalezaDatos.some((n) => n.etiqueta === 'simulado') && j.mensaje.avisos.some((x) => /DATOS DE PRUEBA/.test(x)), 'se rotula como datos de prueba');
    assert.ok(j.mensaje.fuentes.length >= 1);
    // trazabilidad leída del ledger, no del texto
    const t12 = j.trazabilidad.tareas.find((t) => t.capacidad === '12.leer-ultimo-informe');
    assert.ok(t12, 'hay una tarea del Agente 12');
    assert.ok(t12.evidencias.length >= 1 && /^sha256:[0-9a-f]{64}$/.test(t12.evidencias[0].hash));
    assert.match(t12.evidencias[0].referencia, /auditor_general_instantaneas#fx-12-01/);
    assert.deepEqual(t12.verificaciones.map((v) => v.resultado), ['confirmada']);
    assert.equal(t12.estados.at(-1), 'completada');
    assert.equal(j.autorizacion.apruebaElPuente, false);
    // el ledger conserva la cadena íntegra y n8n sólo recibió consultas de lectura
    assert.equal(M.E.ledger.verificarCadena().ok, true);
    assert.ok(M.n8n.registro.every((x) => x.metodo === 'POST' && /^\/webhook\/tai-lector-(04|12)$/.test(x.url)));
    assert.ok(M.n8n.registro.every((x) => !/aprob|ejecut|escrib/i.test(x.cuerpo)));
    assert.equal(M.E.eventos('aprobacion_solicitada').length, 0, 'ninguna aprobación creada por una consulta');
  } finally { await M.cerrar(); }
});

test('E2E: ampliación al Agente 04 con el MISMO lector (sin otro workflow) y datos que cambian entre preguntas', async () => {
  const M = await montar();
  try {
    const r = await M.enviar('¿Cómo está el catálogo?');
    assert.equal(r.estado, 200);
    const t04 = r.json.trazabilidad.tareas.find((t) => t.capacidad === '04.leer-ultimo-informe');
    assert.ok(t04, 'tarea del Agente 04');
    assert.match(t04.evidencias[0].referencia, /calidad_catalogo_instantaneas#fx-04-02/);
    assert.deepEqual(t04.verificaciones.map((v) => v.resultado), ['confirmada']);
    assert.ok(M.n8n.registro.some((x) => x.url.endsWith('tai-lector-04')));
    const wf = cargarWorkflowLector();
    assert.equal(wf.nodes.filter((n) => n.type.endsWith('webhook')).length, 2, 'un único workflow lector para 04 y 12');
  } finally { await M.cerrar(); }
});

test('E2E: n8n caído → respuesta honesta (no consta), sin tarea completada y sin datos inventados', async () => {
  const M = await montar();
  try {
    await M.n8n.cerrar();
    M.E.d.lector.ttlMs = 0;
    const r = await M.enviar('¿Cómo está el sitio?');
    assert.equal(r.estado, 200);
    assert.doesNotMatch(r.json.mensaje.textoClaro + r.json.mensaje.detalle, /fx-12-01/);
    assert.ok(r.json.trazabilidad.tareas.every((t) => !t.estados.includes('completada') || t.evidencias.length === 0));
    assert.ok(r.json.trazabilidad.tareas.some((t) => t.estados.includes('fallida')));
  } finally { await M.svc.cerrar(); M.E.limpiar(); }
});

test('servicio: autenticación, alcance, rutas, métodos, tamaño, tipo de contenido y errores sin detalles internos', async () => {
  const M = await montar();
  try {
    assert.equal((await M.enviar('hola', { tokenCliente: null })).estado, 401);
    assert.equal((await M.enviar('hola', { tokenCliente: 'tai_consola_' + 'x'.repeat(30) })).estado, 401);
    assert.equal((await M.enviar('hola', { contentType: 'text/plain' })).estado, 415);
    assert.equal((await M.enviar('hola', { cuerpo: 'no json' })).estado, 400);
    assert.equal((await M.enviar('hola', { extra: { aprobar: true } })).estado, 400, 'campo no previsto');
    assert.equal((await M.enviar('x'.repeat(9000), { cuerpo: 'x'.repeat(9000) })).estado, 413);
    const s = await fetch(`${M.base}/tai/v1/salud`);
    assert.equal(s.status, 200);
    const sj = await s.json();
    assert.equal(sj.estado, 'ok');
    assert.equal(JSON.stringify(sj).includes(TOKEN_N8N), false, 'la salud no revela credenciales');
    assert.equal((await fetch(`${M.base}/tai/v1/salud`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${M.base}/tai/v1/mensajes`)).status, 405);
    assert.equal((await fetch(`${M.base}/tai/v1/aprobar`, { method: 'POST' })).status, 404, 'no existe ninguna ruta de aprobación');
    assert.equal((await fetch(`${M.base}/tai/v1/respuestas`, { method: 'POST' })).status, 404, 'el canal de respuestas de n8n no existe todavía');
    assert.equal((await fetch(`${M.base}/`)).status, 404);
    const r = await M.enviar('hola', { tokenCliente: null });
    assert.equal(r.cabeceras.get('x-content-type-options'), 'nosniff');
    assert.equal(r.cabeceras.get('cache-control'), 'no-store');
    assert.doesNotMatch(JSON.stringify(r.json), /stack|at .*\.mjs|node_modules/);
  } finally { await M.cerrar(); }
});

test('servicio: sólo bucle local, límite de ritmo e idempotencia (misma respuesta; conflicto con otro contenido)', async () => {
  const M = await montar({ limite: 4 });
  try {
    await assert.rejects(() => crearServicioPuente({ director: M.E.d, tokens: new AlmacenTokens() }).escuchar({ host: '0.0.0.0' }), (e) => e.error.codigo === 'permiso_denegado');
    const cuerpo = JSON.stringify({ esquema: 'tai-puente/1', idSolicitud: 'sol-idem-0001', claveIdempotencia: 'clave-idem-1', canal: 'texto', texto: '¿Cómo está el sitio?' });
    const a = await M.enviar('', { cuerpo });
    const b = await M.enviar('', { cuerpo });
    assert.equal(a.estado, 200);
    assert.equal(b.json.repetida, true);
    assert.equal(b.json.mensaje.idMensaje, a.json.mensaje.idMensaje, 'misma respuesta, sin reprocesar');
    assert.equal(M.E.eventos('tarea_creada').length, a.json.trazabilidad.tareas.length, 'la repetición no crea tareas nuevas');
    const c = await M.enviar('', { cuerpo: JSON.stringify({ ...JSON.parse(cuerpo), texto: 'otra cosa' }) });
    assert.equal(c.estado, 409);
    assert.equal(c.json.error.codigo, 'idempotencia_conflicto');
    const ultimo = await M.enviar('hola');
    assert.equal((await M.enviar('hola')).estado, 429, 'límite de ritmo por cliente');
    assert.ok(ultimo.estado === 200 || ultimo.estado === 429);
  } finally { await M.cerrar(); }
});

test('servicio con firma: exige marca, nonce y HMAC; rechaza caducadas y repetidas', async () => {
  const M = await montar({ firma: true });
  try {
    assert.equal((await M.enviar('¿Cómo está el sitio?')).estado, 200);
    assert.equal((await M.enviar('hola', { firmar: false })).estado, 401, 'sin cabeceras de firma');
    assert.equal((await M.enviar('hola', { nonce: 'nonce-repetido-0000001' })).estado, 200);
    // mismo nonce otra vez (cuerpo distinto): repetición
    assert.equal((await M.enviar('hola otra vez', { nonce: 'nonce-repetido-0000001' })).estado, 409);
    assert.equal((await M.enviar('hola', { marca: String(Math.floor(M.E.reloj.ms / 1000) - 3600) })).estado, 408, 'caducada');
    const r = await fetch(`${M.base}/tai/v1/mensajes`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${M.token}`, 'x-tai-timestamp': String(Math.floor(M.E.reloj.ms / 1000)), 'x-tai-nonce': 'nonce-manipulado-00001', 'x-tai-signature': '0'.repeat(64) }, body: '{}' });
    assert.equal(r.status, 401);
    assert.equal((await fetch(`${M.base}/tai/v1/salud`)).status, 200);
  } finally { await M.cerrar(); }
});

test('servicio: los mensajes concurrentes se atienden de uno en uno (ledger con un solo escritor) y la cadena queda íntegra', async () => {
  const M = await montar();
  try {
    const rs = await Promise.all([M.enviar('¿Cómo está el sitio?'), M.enviar('¿Cómo está el catálogo?'), M.enviar('¿Cómo está el sitio?'), M.enviar('¿Qué tareas hay?')]);
    assert.ok(rs.every((r) => r.estado === 200));
    assert.equal(M.E.ledger.verificarCadena().ok, true);
    const sec = M.E.ledger.leer().map((e) => e.secuencia);
    assert.deepEqual(sec, sec.map((_, i) => i + 1), 'secuencias consecutivas sin huecos');
    await esperar(5);
  } finally { await M.cerrar(); }
});
