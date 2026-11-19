// Prueba local del bloqueo con Traefik 3.6.7: SOLO la parte que no necesita Docker (evaluador, matriz, canario, archivos del entorno, petición cruda y negativa sin autorización).
// La ejecución real NO se realiza aquí (requiere autorización y descargar traefik:v3.6.7).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matrizExterior, matrizControles, evaluarExterior, evaluarControl, evaluarInterior, veredicto, VARIANTES_RUTA, RUTA_CANARIO } from '../../dev/prueba-traefik/matriz.mjs';
import { canarioAislamiento, construirCanario, lintCanario, ARCHIVO_CANARIO, CREDENCIAL_CANARIO } from '../../../scripts/automation/build-canario-aislamiento.mjs';
import { peticionCruda, analizar, indexarRegistro, principal, autorizado, IMAGEN_TRAEFIK, IMAGENES_LOCALES } from '../../../scripts/automation/prueba-traefik.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(RAIZ, 'automation', 'dev', 'prueba-traefik');
const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

test('la matriz cubre las variantes peligrosas, ambas entradas, con y sin credencial, métodos y hosts, y hay controles de rutas legítimas', () => {
  const m = matrizExterior();
  const ids = new Set(m.map((c) => c.id));
  assert.equal(ids.size, m.length, 'ids únicos');
  for (const [n] of VARIANTES_RUTA) for (const e of ['http', 'https']) for (const c of ['sin-cred', 'con-cred']) assert.ok(ids.has(`${n}|${e}|${c}|POST`), `${n} ${e} ${c}`);
  for (const n of ['mayusculas-prefijo', 'barras-dobles', 'punto-segmento', 'codificada-letra', 'codificada-barra', 'test', 'waiting']) assert.ok(VARIANTES_RUTA.some(([x]) => x === n), n);
  assert.ok(m.some((c) => c.metodo === 'HEAD') && m.some((c) => c.metodo === 'OPTIONS') && m.some((c) => c.host === 'otro.ejemplo'));
  assert.ok(m.every((c) => c.ruta.startsWith('/') && c.ruta.toLowerCase().includes(RUTA_CANARIO.slice(0, 8)) || c.ruta.includes('%74ai') || c.ruta.includes('%2F') || c.ruta.includes('TAI-LECTOR')));
  const ctl = matrizControles();
  assert.ok(ctl.some((c) => c.ruta === '/healthz') && ctl.some((c) => c.ruta.includes('tai-publico-prueba')));
  assert.ok(ctl.every((c) => !c.ruta.includes('tai-lector-prod-')), 'los controles no usan el prefijo bloqueado');
});

test('evaluador exterior: la fuga de n8n o del canario se detecta; la respuesta del proxy sin reenvío es correcta', () => {
  const c = { id: 'x' };
  assert.equal(evaluarExterior(c, { estado: 403, cuerpo: 'Forbidden', cabeceras: {}, log: { RouterName: 'tai-bloquear-lector-prod@file', ServiceName: 'noop@internal', OriginStatus: 0 } }).ok, true);
  assert.equal(evaluarExterior(c, { estado: 404, cuerpo: '404 page not found', cabeceras: {} }).ok, true, 'sin registro: sigue valiendo la respuesta');
  assert.equal(evaluarExterior(c, { estado: 400, cuerpo: 'Bad Request', cabeceras: {} }).ok, true);
  assert.equal(evaluarExterior(c, { error: 'ECONNRESET' }).ok, true);
  for (const cuerpo of ['{"canario":true}', '{"code":404,"message":"The requested webhook \\"POST x\\" is not registered."}', '{"message":"Authorization data is wrong!"}', 'IP is not allowed to access the webhook!', 'Cannot POST /webhook/x']) {
    const r = evaluarExterior(c, { estado: 404, cuerpo, cabeceras: {} }); assert.equal(r.ok, false, cuerpo);
  }
  assert.equal(evaluarExterior(c, { estado: 200, cuerpo: '{}', cabeceras: {} }).ok, false, 'un 200 nunca es un bloqueo');
  assert.equal(evaluarExterior(c, { estado: 403, cuerpo: 'Forbidden', cabeceras: {}, log: { ServiceName: 'n8n@file', OriginStatus: 403 } }).ok, false, 'el registro dice que se reenvió al origen');
  assert.equal(evaluarExterior(c, { estado: 403, cuerpo: 'x', cabeceras: { 'x-powered-by': 'Express' } }).ok, false);
});

test('controles, interior y veredicto global', () => {
  const [h, , w] = matrizControles();
  assert.equal(evaluarControl(h, { estado: 200, cuerpo: '{"status":"ok"}' }).ok, true);
  assert.equal(evaluarControl(h, { estado: 403, cuerpo: 'Forbidden' }).ok, false, 'un bloqueo demasiado amplio rompería la ruta legítima');
  assert.equal(evaluarControl(w, { estado: 200, cuerpo: '{"publico":true}' }).ok, true);
  assert.equal(evaluarControl(w, { estado: 200, cuerpo: '{}' }).ok, false);
  assert.equal(evaluarInterior({ estado: 200, cuerpo: '{"canario":true}' }, true).ok, true);
  assert.equal(evaluarInterior({ estado: 403, cuerpo: '' }, true).ok, false);
  assert.equal(evaluarInterior({ estado: 403, cuerpo: '' }, false).ok, true);
  assert.equal(evaluarInterior({ estado: 200, cuerpo: '{"canario":true}' }, false).ok, false, 'sin credencial no puede responder el canario');
  const ok = { ok: true }; const mal = { id: 'z', ok: false, motivos: ['m'] };
  assert.equal(veredicto({ exterior: [ok], controles: [ok], interior: [ok] }).ok, true);
  const v = veredicto({ exterior: [ok, mal], controles: [ok], interior: [ok] });
  assert.equal(v.ok, false); assert.deepEqual(v.fallos.map((f) => f.id), ['z']);
  assert.match(veredicto({ exterior: [{ ok: true, sinRegistro: true }], controles: [], interior: [] }).avisos.join(), /sin registro/);
});

test('canario: sin datos, una sola ruta, credencial desechable propia; el linter rechaza todo lo demás', () => {
  const rep = fs.readFileSync(path.join(RAIZ, 'automation', 'workflows-puente', 'produccion', ARCHIVO_CANARIO), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(rep, construirCanario(), 'ejecuta node scripts/automation/build-canario-aislamiento.mjs --write');
  const wf = JSON.parse(rep);
  assert.deepEqual(lintCanario(wf), []);
  assert.equal(wf.nodes.filter((n) => n.type.endsWith('webhook'))[0].credentials.httpHeaderAuth.name, CREDENCIAL_CANARIO);
  assert.ok(!rep.includes('Treidilor — Lector puente'), 'no usa la credencial del lector');
  // la variante de prueba (con lista de IP y control público) existe pero NO es la del repositorio
  const prueba = canarioAislamiento({ ipWhitelist: '10.0.0.0/24', controlPublico: true });
  assert.equal(prueba.nodes.filter((n) => n.type.endsWith('webhook')).length, 2);
  assert.ok(lintCanario(JSON.parse(construirCanario({ ipWhitelist: '10.0.0.0/24' }))).some((e) => /opciones/.test(e)), 'el repositorio no puede llevar la lista de IP');
  assert.ok(lintCanario(JSON.parse(construirCanario({ controlPublico: true }))).some((e) => /exactamente un webhook/.test(e)));
  const mut = (f) => { const w = JSON.parse(rep); f(w); return lintCanario(w); };
  assert.ok(mut((w) => { w.nodes.push({ name: 'T', type: 'n8n-nodes-base.dataTable', parameters: {} }); }).some((e) => /no permitido/.test(e)));
  assert.ok(mut((w) => { w.nodes.push({ name: 'C', type: 'n8n-nodes-base.code', parameters: {} }); }).length > 0);
  assert.ok(mut((w) => { w.active = true; }).length > 0);
  assert.ok(mut((w) => { w.nodes.find((n) => n.type.endsWith('webhook')).credentials.httpHeaderAuth.name = 'Treidilor — Lector puente PRODUCCIÓN (solo lectura)'; }).length > 0);
  assert.ok(mut((w) => { w.nodes.find((n) => n.type.endsWith('respondToWebhook')).parameters.responseBody = '{"datos":1}'; }).length > 0);
  assert.ok(mut((w) => { w.settings.saveDataSuccessExecution = 'none'; }).length > 0, 'con «none» el contador de ejecuciones no sería verificable');
  assert.ok(mut((w) => { w.settings.saveDataErrorExecution = 'none'; }).length > 0);
});

test('archivos del entorno: imagen fijada, solo loopback, red interna, sin socket de Docker ni privilegios, regla candidata = documentada', () => {
  const c = leer('docker-compose.yml');
  assert.match(c, /image: traefik:v3\.6\.7\n/); assert.ok(!/traefik:(latest|v3\s|v3\n)/.test(c));
  assert.match(c, /image: n8nio\/n8n:2\.38\.6/); assert.match(c, /N8N_PROXY_HOPS: "1"/);
  assert.deepEqual([...c.matchAll(/- "([^"]*:\d+:\d+)"/g)].map((m) => m[1]), ['127.0.0.1:18080:80', '127.0.0.1:18081:443'], 'solo dos puertos y ambos en loopback');
  assert.match(c, /aislada:\n    name: tai-tf-aislada\n    internal: true/);
  assert.ok(!/docker\.sock|privileged|network_mode|pid: host|cap_add/.test(c));
  assert.match(c, /name: tai-prueba-tf/);
  const s = leer('traefik.yaml');
  assert.match(s, /directory: \/data\/config/); assert.match(s, /watch: true/); assert.match(s, /http:\s+address: ":80"/); assert.match(s, /X-Prueba-Id: keep/);
  const regla = leer('config-candidata/custom.yaml');
  const doc = fs.readFileSync(path.join(RAIZ, 'automation', 'docs', 'AISLAMIENTO-WEBHOOKS-LECTOR.md'), 'utf8');
  for (const linea of ['rule: "PathRegexp(`(?i)^(?:/|%2f|%5c)+webhook.*tai-lector-prod-`)"', 'priority: 10000000', 'service: noop@internal', 'sourceRange: ["192.0.2.1/32"]']) { assert.ok(regla.includes(linea), `custom.yaml: ${linea}`); assert.ok(doc.includes(linea), `documento: ${linea}`); }
  assert.ok(!fs.existsSync(path.join(DIR, 'config')), 'la carpeta vigilada vive fuera del repositorio (el lanzador copia los archivos)');
});

test('petición cruda: la línea de petición llega SIN normalizar y se analiza la respuesta; el registro de acceso se indexa por idPrueba', async () => {
  const recibidas = [];
  const srv = http.createServer((req, res) => { recibidas.push(req.url); res.writeHead(403, { 'x-ejemplo': 'a' }); res.end('Forbidden'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const puerto = srv.address().port;
    for (const ruta of ['//webhook//x', '/webhook/./x', '/webhook%2Fx', '/WEBHOOK/X?y=1']) {
      const r = await peticionCruda({ puerto, metodo: 'POST', ruta, host: 'n8n.prueba.local', cuerpo: '{}' });
      assert.equal(r.estado, 403); assert.equal(r.cuerpo, 'Forbidden'); assert.equal(r.cabeceras['x-ejemplo'], 'a');
    }
    assert.deepEqual(recibidas, ['//webhook//x', '/webhook/./x', '/webhook%2Fx', '/WEBHOOK/X?y=1']);
  } finally { srv.close(); }
  assert.ok((await peticionCruda({ puerto: 1, metodo: 'GET', ruta: '/', host: 'x' })).error);
  assert.equal(analizar(Buffer.from('HTTP/1.1 404 Not Found\r\nServer: x\r\n\r\n404 page not found')).estado, 404);
  const mapa = indexarRegistro('{"level":"info"}\nruido\n{"request_X-Prueba-Id":"abc123","RouterName":"r@file","OriginStatus":0}\n');
  assert.equal(mapa.get('abc123').RouterName, 'r@file');
});

test('sin autorización expresa no se descarga ni se ejecuta nada; «ensayo» no toca Docker', async () => {
  assert.equal(autorizado({}), false); assert.equal(autorizado({ TAI_PRUEBA_TRAEFIK_AUTORIZADA: '1' }), true); assert.equal(autorizado({ TAI_PRUEBA_TRAEFIK_AUTORIZADA: 'si' }), false);
  for (const orden of ['descargar', 'ejecutar', 'limpiar']) assert.equal(await principal([orden], {}), 3, orden);
  assert.equal(await principal(['otra'], {}), 2);
  assert.equal(IMAGEN_TRAEFIK, 'traefik:v3.6.7');
  assert.ok(IMAGENES_LOCALES.every((i) => !/traefik/.test(i)), 'la única imagen nueva es traefik');
});

test('configuración dinámica en un VOLUMEN escrito desde Linux (no un bind mount de Windows); el evaluador exige registro o cuerpo de Traefik; clasificación de respuestas', async () => {
  const c = leer('docker-compose.yml');
  assert.match(c, /tai_tf_config:\/data\/config:ro/); assert.match(c, /tai_tf_config:\/cfg\n/);
  assert.ok(!/\.\/config|PRUEBA_TF_CONFIG|config-base|config-candidata/.test(c), 'ningún bind mount de la configuración');
  assert.match(c, /container_name: tai-tf-cfg/);
  const { evaluarExterior, clasificarRespuesta, matrizAbierto } = await import('../../dev/prueba-traefik/matriz.mjs');
  assert.equal(evaluarExterior({ id: 'x' }, { estado: 404, cuerpo: '{"x":1}', cabeceras: {} }).ok, false, 'sin registro y cuerpo ajeno a Traefik: no se acepta');
  assert.equal(evaluarExterior({ id: 'x' }, { estado: 403, cuerpo: 'Forbidden', cabeceras: {} }).ok, true);
  const casos = [[{ estado: 200, cuerpo: '{"canario":true}' }, 'canario-alcanzado'], [{ estado: 403, cuerpo: 'IP is not allowed to access the webhook!' }, 'n8n:lista-de-IP-deniega'], [{ estado: 403, cuerpo: '{"message":"Authorization data is wrong!"}' }, 'n8n:credencial-rechazada'], [{ estado: 404, cuerpo: 'The requested webhook "POST x" is not registered.' }, 'n8n:webhook-no-registrado'], [{ estado: 403, cuerpo: 'Forbidden' }, 'traefik:403'], [{ estado: 404, cuerpo: '404 page not found' }, 'traefik:404-sin-router'], [{ estado: 400, cuerpo: 'Bad Request' }, 'traefik:400'], [{ error: 'ECONNRESET' }, 'sin-respuesta']];
  for (const [r, esperado] of casos) assert.equal(clasificarRespuesta(r), esperado);
  assert.equal(matrizAbierto().length, 2);
});

test('el 403 NO prueba nada: se distingue el bloqueo de Traefik del rechazo de n8n; el diagnóstico de la regla es inequívoco', async () => {
  const { diagnosticarRegla, clasificarRespuesta, evaluarExterior } = await import('../../dev/prueba-traefik/matriz.mjs');
  const traefik403 = { estado: 403, cuerpo: 'Forbidden' };
  const n8n403 = { estado: 403, cuerpo: 'IP is not allowed to access the webhook!' };
  const n8nAuth = { estado: 403, cuerpo: '{"message":"Authorization data is wrong!"}' };
  const canario = { estado: 200, cuerpo: '{"canario":true}' };
  const ok200 = { estado: 200, cuerpo: '{"status":"ok"}' };
  assert.equal(clasificarRespuesta(traefik403), 'traefik:403'); assert.equal(clasificarRespuesta(n8n403), 'n8n:lista-de-IP-deniega'); assert.equal(clasificarRespuesta(n8nAuth), 'n8n:credencial-rechazada');
  assert.equal(diagnosticarRegla({ exacta: traefik403, abierto: traefik403, control: ok200 }).estado, 'cargada');
  assert.equal(diagnosticarRegla({ exacta: n8n403, abierto: canario, control: ok200 }).estado, 'ausente', 'sin regla n8n también responde 403: NO es «cargada»');
  assert.equal(diagnosticarRegla({ exacta: n8n403, abierto: n8n403, control: ok200 }).estado, 'indeterminado');
  assert.equal(diagnosticarRegla({ exacta: traefik403, abierto: canario, control: ok200 }).estado, 'indeterminado', 'bloqueo parcial no basta');
  assert.equal(diagnosticarRegla({ exacta: traefik403, abierto: traefik403, control: { estado: 502, cuerpo: '' } }).estado, 'no-sano');
  // un 403 de n8n NUNCA vale como bloqueo, aunque no haya línea en el registro
  assert.equal(evaluarExterior({ id: 'x', metodo: 'POST' }, { ...n8n403, cabeceras: {}, log: null }).ok, false);
  assert.equal(evaluarExterior({ id: 'x', metodo: 'POST' }, { ...traefik403, cabeceras: {}, log: null }).ok, true);
  assert.equal(evaluarExterior({ id: 'x', metodo: 'POST' }, { ...traefik403, cabeceras: {}, log: { RouterName: 'n8n-http@file', ServiceName: 'n8n@file', OriginStatus: 403 } }).ok, false, 'si el registro dice que llegó al origen, no está bloqueado aunque el cuerpo parezca de Traefik');
  const gemTraefik = { estado: 403, cuerpo: 'Forbidden', cabeceras: {} };
  const H = { id: 'h', metodo: 'HEAD' };
  assert.equal(evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: {}, log: null, gemelo: gemTraefik }).ok, true, 'HEAD sin content-type ni content-length: se atribuye por el gemelo GET de Traefik y la ausencia de línea');
  assert.equal(evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: { 'content-length': '9' }, log: null, gemelo: gemTraefik }).ok, true, 'si trae content-length y coincide con el gemelo, es evidencia complementaria');
  assert.equal(evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: { 'content-length': '40' }, log: null, gemelo: gemTraefik }).ok, false, 'content-length que no coincide con el gemelo');
  assert.equal(evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: {}, log: null }).ok, false, 'sin gemelo no hay atribución: un 403 vacío y sin línea NO basta');
  assert.equal(evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: {}, log: null, gemelo: { estado: 403, cuerpo: 'IP is not allowed to access the webhook!', cabeceras: {} } }).ok, false, 'el gemelo es de n8n: el HEAD no es un bloqueo de Traefik');
  assert.equal(evaluarExterior(H, { estado: 404, cuerpo: '', cabeceras: {}, log: null, gemelo: gemTraefik }).ok, false, 'estado distinto del gemelo');
  assert.equal(evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: {}, log: { RouterName: 'n8n-http@file', ServiceName: 'n8n@file', OriginStatus: 403 }, gemelo: gemTraefik }).ok, false, 'HEAD con línea de enrutamiento a n8n: fuga');
  assert.equal(evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: { 'x-powered-by': 'Express' }, log: null, gemelo: gemTraefik }).ok, false, 'cabecera de n8n');
  assert.equal(evaluarExterior({ id: 'p', metodo: 'POST' }, { estado: 403, cuerpo: '', cabeceras: {}, log: null }).ok, false, 'un 403 vacío en POST no es atribuible a Traefik');
});

test('variantes codificadas adicionales (además de las 68) y línea temporal de configuraciones; los centinelas incluyen HEAD', async () => {
  const { matrizCodificada, VARIANTES_CODIFICADAS, matrizExterior } = await import('../../dev/prueba-traefik/matriz.mjs');
  const { lineaTemporalConfig } = await import('../../../scripts/automation/prueba-traefik.mjs');
  assert.equal(matrizExterior().length, 68, 'las 68 originales no cambian');
  const c = matrizCodificada();
  assert.equal(c.length, VARIANTES_CODIFICADAS.length * 4);
  const rutas = VARIANTES_CODIFICADAS.map(([, r]) => r).join(' ');
  for (const t of ['%2F', '%2f', '%252F', '%5C', '%5c', '%2F%2F', '%74ai', '%77ebhook', '%2D']) assert.ok(rutas.includes(t), t);
  assert.ok(VARIANTES_CODIFICADAS.some(([, r]) => r.startsWith('%2F')) && VARIANTES_CODIFICADAS.some(([, r]) => r.startsWith('/webhook-test%2F')) && VARIANTES_CODIFICADAS.some(([, r]) => r.startsWith('/webhook-waiting%2f')));
  assert.ok(c.every((x) => x.tipo === 'codificada' && x.metodo === 'POST'));
  const ESC = String.fromCharCode(27);
  const log = ['2026-11-15T23:01:45Z DBG x > Configuration received config={"http":{"routers":{"n8n-http":{}}}}', `${ESC}[90m2026-11-15T23:01:50Z${ESC}[0m DBG x > Configuration received config={"http":{"routers":{"tai-bloquear-lector-prod":{"a":1},"regenerado-http":{}}}}`, 'ruido'].join('\n');
  assert.deepEqual(lineaTemporalConfig(log), [{ t: '2026-11-15T23:01:45Z', bloqueo: false, regenerado: false }, { t: '2026-11-15T23:01:50Z', bloqueo: true, regenerado: true }]);
  const lanzador = fs.readFileSync(path.join(RAIZ, 'scripts', 'automation', 'prueba-traefik.mjs'), 'utf8');
  assert.match(lanzador, /for \(const metodo of \['GET', 'HEAD'\]\)/, 'cada lote lleva centinelas GET y HEAD');
});

test('HEAD aislado: el evaluador distingue un bloqueo de Traefik de una respuesta del origen (sin regla / con regla)', async () => {
  const { evaluarExterior } = await import('../../dev/prueba-traefik/matriz.mjs');
  const H = { id: 'aislada|HEAD', metodo: 'HEAD' };
  // sin regla: n8n responde (lista de IP) y el enrutamiento deja línea con router n8n y OriginStatus > 0
  const sinRegla = evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: { 'content-length': '40' }, log: { RouterName: 'n8n-http@file', ServiceName: 'n8n@file', OriginStatus: 403 }, gemelo: { estado: 403, cuerpo: 'IP is not allowed to access the webhook!', cabeceras: {} } });
  assert.equal(sinRegla.ok, false); assert.ok(sinRegla.motivos.length >= 2);
  // con regla: Traefik responde por sí mismo, sin línea de enrutamiento y con gemelo Forbidden
  const conRegla = evaluarExterior(H, { estado: 403, cuerpo: '', cabeceras: {}, log: null, gemelo: { estado: 403, cuerpo: 'Forbidden', cabeceras: {} } });
  assert.equal(conRegla.ok, true, conRegla.motivos.join('; '));
  const lanzador = fs.readFileSync(path.join(RAIZ, 'scripts', 'automation', 'prueba-traefik.mjs'), 'utf8');
  assert.match(lanzador, /pruebaHeadAislada\(cred, false\)/); assert.match(lanzador, /pruebaHeadAislada\(cred, true\)/);
});

test('controles negativos: la expresión no debe bloquear rutas públicas ajenas; el evaluador exige que lleguen a n8n por su router', async () => {
  const { matrizControlesNegativos, evaluarControlNegativo, RUTAS_CONTROL_NEGATIVO } = await import('../../dev/prueba-traefik/matriz.mjs');
  const regla = new RegExp('^(?:/|%2f|%5c)+webhook.*tai-lector-prod-', 'i'); // la expresión de custom.yaml (referencia JS)
  assert.match(fs.readFileSync(path.join(DIR, 'config-candidata', 'custom.yaml'), 'utf8'), /PathRegexp\(`\(\?i\)\^\(\?:\/\|%2f\|%5c\)\+webhook\.\*tai-lector-prod-`\)/);
  const n = matrizControlesNegativos();
  assert.equal(n.length, RUTAS_CONTROL_NEGATIVO.length * 2);
  for (const [nombre, ruta] of RUTAS_CONTROL_NEGATIVO) assert.equal(regla.test(ruta), false, `${nombre} (${ruta}) no debe casar con la regla`);
  for (const ruta of ['/webhook/tai-lector-04', '/webhook/tai-lector-produccion', '/assets/webhook-icon.svg']) assert.ok(n.some((c) => c.ruta === ruta), ruta);
  const c = n[0];
  assert.equal(evaluarControlNegativo(c, { estado: 200, cuerpo: '{"publico":true}', log: { RouterName: 'n8n-http@file', ServiceName: 'n8n@file', OriginStatus: 200 } }).ok, true);
  assert.equal(evaluarControlNegativo(c, { estado: 404, cuerpo: 'x', log: { RouterName: 'n8n-http@file', ServiceName: 'n8n@file', OriginStatus: 404 } }).ok, true, 'un 404 de n8n sí demuestra que NO se bloqueó');
  assert.equal(evaluarControlNegativo(c, { estado: 403, cuerpo: 'Forbidden', log: null }).ok, false, 'bloqueada por la regla');
  assert.equal(evaluarControlNegativo(c, { estado: 200, cuerpo: 'x', log: null }).ok, false, 'sin registro no se afirma');
  assert.equal(evaluarControlNegativo(c, { estado: 404, cuerpo: '404 page not found', log: { OriginStatus: 0 } }).ok, false, 'respuesta de Traefik sin router');
});

test('el procedimiento del VPS reproduce EXACTAMENTE la regla validada (bytes y SHA-256) y no se ha modificado', async () => {
  const { createHash } = await import('node:crypto');
  const HASH = '2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39';
  const regla = fs.readFileSync(path.join(DIR, 'config-candidata', 'custom.yaml'));
  assert.equal(createHash('sha256').update(regla).digest('hex'), HASH, 'la regla validada no puede cambiar sin una nueva validación');
  assert.equal(regla.length, 517); assert.ok(!regla.includes(13), 'solo saltos LF');
  const doc = fs.readFileSync(path.join(RAIZ, 'automation', 'docs', 'AISLAMIENTO-VPS-PROCEDIMIENTO.md'), 'utf8');
  const bloque = /<!-- INICIO-BLOQUE-CUSTOM -->[\s\S]*?cat > \$D\/custom\.yaml\.nuevo <<'TAI_EOF'\n([\s\S]*?\n)TAI_EOF\n[\s\S]*?<!-- FIN-BLOQUE-CUSTOM -->/.exec(doc);
  assert.ok(bloque, 'bloque de creación presente');
  assert.equal(createHash('sha256').update(bloque[1]).digest('hex'), HASH, 'el bloque a pegar en la consola es la regla validada, byte a byte');
  assert.ok(doc.includes(HASH));
  const lanzador = fs.readFileSync(path.join(RAIZ, 'scripts', 'automation', 'prueba-traefik.mjs'), 'utf8');
  assert.match(lanzador, /let fuga = false; let ejeW0 = null; let ejeW1 = null;/, 'el campo agregado de ejecuciones tras regenerar ya no depende de un ámbito de bloque');
});
