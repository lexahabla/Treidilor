// Consola del Director en MODO LECTOR REAL contra un n8n FALSO local (el JSON real del workflow de producción ejecutado nodo a nodo). Sin red externa, sin VPS, sin n8n real, sin Docker.
// Reutiliza el n8n falso y los datos de f20; aquí solo se prueba lo propio de la consola: doble candado, configuración estricta, consultas L0, ledger, rechazo de L2/L4 y errores del origen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RAIZ as RAIZ_REPO, calcularArchivos, construirTar, leerArchivos, verificarTar, sha256Hex } from '../../../scripts/automation/empaquetar-director.mjs';
import { CABECERA_LECTOR_PRODUCCION } from '../../lib/lectorProduccion.mjs';
import { filaDeInstantanea } from '../../lib/seguimiento.mjs';
import { fila } from '../fixtures/construir.mjs';
import { arrancarN8nFalso, cargarWorkflowProduccion } from './_n8n-falso.mjs';

const CLI = path.join(RAIZ_REPO, 'scripts', 'automation', 'director.mjs');
const TOKEN = 'token-produccion-de-prueba-0123456789';
const iso = (ms) => new Date(ms).toISOString();

function filaProd(agente, idEjecucion, generadoEn, incidencias = []) {
  const { id, ...f } = { id: 1, ...fila({ id: 1, agente, idEjecucion, entorno: 'produccion', generadoEn, incidencias }) };
  f.huella = filaDeInstantanea(JSON.parse(f.payload), { idEjecucion: f.idEjecucion, origen: f.origen }).huella;
  return f;
}
const tablas = (antiguedadH = 2) => {
  const t = Date.now();
  return {
    calidad_catalogo_instantaneas: [filaProd('04', 'ex-16', iso(t - (antiguedadH + 72) * 3600000), [['ficha:sin_categoria:p-1', 'media']]), filaProd('04', 'ex-18', iso(t - antiguedadH * 3600000), [['ficha:sin_categoria:p-1', 'media'], ['ficha:comercio_malformado:p-3', 'media']])],
    auditor_general_instantaneas: [filaProd('12', 'ex-13', iso(t - (antiguedadH + 48) * 3600000)), filaProd('12', 'ex-17', iso(t - antiguedadH * 3600000))],
  };
};

async function entorno({ datos = tablas(), token = TOKEN, falso = {} } = {}) {
  const n8n = await arrancarN8nFalso({ tablas: datos, token, cabecera: CABECERA_LECTOR_PRODUCCION, workflow: cargarWorkflowProduccion(), patron: /^\/webhook\/(tai-lector-prod-(?:04|12))$/, ...falso });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f26-'));
  const ledger = path.join(dir, 'ledger'); fs.mkdirSync(ledger); fs.mkdirSync(path.join(dir, 'inst'));
  const archivoToken = path.join(dir, 'lector.token'); fs.writeFileSync(archivoToken, `${TOKEN}\n`);
  const env = { ...process.env, TAI_DIRECTOR_LECTOR_REAL: 'si', TAI_LECTOR_PROD_TOKEN_FILE: archivoToken };
  delete env.TAI_LECTOR_PROD_TOKEN; delete env.TAI_LECTOR_PROD_URL; delete env.TAI_LECTOR_PROD_HOSTS;
  const correr = (args, extraEnv = {}) => new Promise((resolve) => execFile(process.execPath, [CLI, ...args, '--ledger', ledger, '--instantaneas', path.join(dir, 'inst')], { env: { ...env, ...extraEnv }, timeout: 60000 }, (err, stdout, stderr) => resolve({ codigo: err ? (typeof err.code === 'number' ? err.code : 99) : 0, stdout, stderr })));
  const real = ['--lector', 'real', '--n8n-produccion', n8n.urlBase, '--hosts', '127.0.0.1'];
  const textoLedger = () => { const o = []; const rec = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) rec(p); else o.push(fs.readFileSync(p, 'utf8')); } }; rec(ledger); return o.join('\n'); };
  return { n8n, dir, correr, real, textoLedger, cerrar: async () => { await n8n.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('por defecto el modo es SINTÉTICO y no hay ninguna conexión; «real» exige el segundo candado (variable de entorno) y valores válidos', async () => {
  const E = await entorno();
  try {
    const sin = await E.correr(['agentes']); assert.equal(sin.codigo, 0);
    const a = await E.correr(['informe', '04', '--lector', 'real', '--n8n-produccion', E.n8n.urlBase, '--hosts', '127.0.0.1'], { TAI_DIRECTOR_LECTOR_REAL: '' });
    assert.equal(a.codigo, 1); assert.match(a.stderr, /desactivado/);
    const b = await E.correr(['informe', '04', '--lector', 'raro']); assert.equal(b.codigo, 1); assert.match(b.stderr, /sintetico|real/);
    assert.equal(E.n8n.registro.length, 0, 'ninguna petición al lector sin los dos candados');
  } finally { await E.cerrar(); }
});

test('configuración estricta: falta URL, hosts o credencial; dominio público; /webhook-test; archivo de credencial ilegible → no arranca y no hay ninguna petición', async () => {
  const E = await entorno();
  try {
    const casos = [
      [['informe', '04', '--lector', 'real', '--hosts', '127.0.0.1'], {}, /URL interna/],
      [['informe', '04', '--lector', 'real', '--n8n-produccion', E.n8n.urlBase], {}, /lista explícita/],
      [[...['informe', '04'], ...E.real], { TAI_LECTOR_PROD_TOKEN_FILE: path.join(E.dir, 'no-existe') }, /archivo de la credencial/],
      [[...['informe', '04'], ...E.real], { TAI_LECTOR_PROD_TOKEN_FILE: '', TAI_LECTOR_PROD_TOKEN: '' }, /credencial EXCLUSIVA/],
      [['informe', '04', '--lector', 'real', '--n8n-produccion', 'https://n8n.midominio.com/webhook', '--hosts', 'n8n.midominio.com'], {}, /interna/],
      [['informe', '04', '--lector', 'real', '--n8n-produccion', E.n8n.urlBase.replace('/webhook', '/webhook-test'), '--hosts', '127.0.0.1'], {}, /\/webhook/],
    ];
    for (const [args, env, esperado] of casos) { const r = await E.correr(args, env); assert.equal(r.codigo, 1, args.join(' ')); assert.match(r.stderr, esperado, args.join(' ')); }
    assert.equal(E.n8n.registro.length, 0);
  } finally { await E.cerrar(); }
});

test('modo real: último informe de 04 y 12 y comparación, con fecha, frescura y origen; solo POST a las dos rutas del lector; el ledger registra cada consulta sin la credencial', async () => {
  const E = await entorno();
  try {
    const r4 = await E.correr(['informe', '04', ...E.real]); const r12 = await E.correr(['informe', '12', ...E.real]); const c4 = await E.correr(['informe', '04', '--comparar', ...E.real]);
    for (const r of [r4, r12, c4]) assert.equal(r.codigo, 0, r.stdout + r.stderr);
    assert.match(r4.stdout, /ex-18/); assert.doesNotMatch(r4.stdout, /ex-16/);
    assert.match(r4.stdout, /generado \d{4}-\d{2}-\d{2}T/); assert.match(r4.stdout, /hace 2 h|hace \d+ h/); assert.match(r4.stdout, /vigente/);
    assert.match(r4.stdout, /LECTURA DE PRODUCCIÓN/); assert.match(r4.stdout, /NO está verificado/);
    assert.doesNotMatch(r4.stdout, /DATOS DE PRUEBA/);
    assert.match(r12.stdout, /ex-17/); assert.match(c4.stdout, /ex-16 .*→ ex-18|ex-16.*ex-18/s); assert.match(c4.stdout, /Nuevas 1/);
    assert.match(r4.stderr, /MODO LECTOR REAL/);
    // red: solo POST a las rutas fijas del lector de producción
    assert.ok(E.n8n.registro.length >= 12);
    assert.ok(E.n8n.registro.every((x) => x.metodo === 'POST' && /^\/webhook\/tai-lector-prod-(04|12)$/.test(x.url) && x.cabecera === 'presente'));
    assert.ok(E.n8n.registro.every((x) => !x.cuerpo.includes(TOKEN)));
    // ledger
    const v = await E.correr(['ledger', 'verificar']); assert.equal(v.codigo, 0); assert.match(v.stdout, /íntegro/);
    const l = E.textoLedger();
    assert.ok((l.match(/lector_real_produccion/g) ?? []).length >= 3, 'un evento por refresco');
    assert.ok(l.includes('04.leer-ultimo-informe') && l.includes('12.leer-ultimo-informe') && l.includes('04.comparar-informes'));
    assert.ok(l.includes(`127.0.0.1:${E.n8n.puerto}/webhook`) && !l.includes(TOKEN));
    assert.match(l, /idSolicitudA/);
  } finally { await E.cerrar(); }
});

test('credencial incorrecta o servidor caído: se declara «origen no disponible», no se inventa nada y el ledger deja constancia del fallo', async () => {
  const E = await entorno({ token: 'otra-credencial-distinta-9876543210' });
  try {
    const r = await E.correr(['informe', '04', ...E.real]);
    assert.doesNotMatch(r.stdout, /ex-18/); assert.match(r.stdout + r.stderr, /origen|disponible|403|NO CONSTA|no consta|fall/i);
    assert.match(E.textoLedger(), /"ok":\s*false/);
    assert.ok(!E.textoLedger().includes(TOKEN));
  } finally { await E.cerrar(); }
  const F = await entorno(); const url = F.n8n.urlBase; await F.n8n.cerrar();   // servidor caído: se cierra antes de consultar
  try {
    const r = await F.correr(['informe', '12', '--lector', 'real', '--n8n-produccion', url, '--hosts', '127.0.0.1']);
    assert.doesNotMatch(r.stdout, /ex-17/); assert.match(r.stdout + r.stderr, /contactar|origen|disponible|NO CONSTA|no consta/i);
    assert.match(F.textoLedger(), /No se pudo contactar/);
  } finally { fs.rmSync(F.dir, { recursive: true, force: true }); }
});

test('frescura: un informe de hace 10 días se presenta como antiguo (a actualizar), con su fecha', async () => {
  const E = await entorno({ datos: tablas(240) });
  try {
    const r = await E.correr(['informe', '12', ...E.real]); assert.equal(r.codigo, 0);
    assert.match(r.stdout, /hace 10 d/); assert.match(r.stdout, /solo_historico/); assert.match(r.stdout, /NO CONSTA un dato actual/);
  } finally { await E.cerrar(); }
});

test('L0 estricto: las capacidades L2/L4 no se ejecutan en modo real (solo aprobación simulada, sin ninguna petición de escritura) y «corrige el catálogo» se rechaza', async () => {
  const E = await entorno();
  try {
    const a = await E.correr(['tarea', 'crear', '04.auditar-catalogo', ...E.real]); assert.equal(a.codigo, 0); assert.match(a.stdout, /espera de aprobación SIMULADA/);
    const b = await E.correr(['preguntar', 'corrige las fichas sin categoría del catálogo', ...E.real]); assert.match(b.stdout, /L4/);
    const idAp = /a_[0-9A-Z]{26}/.exec(a.stdout)?.[0]; assert.ok(idAp);
    const c = await E.correr(['aprobar', idAp, '--simulada', ...E.real]); assert.match(c.stdout + c.stderr, /NO se envió nada|No aprobada|simulad/i);
    assert.ok(E.n8n.registro.every((x) => x.metodo === 'POST' && /^\/webhook\/tai-lector-prod-(04|12)$/.test(x.url)), 'solo lecturas de los dos informes: jamás otra ruta ni otro método');
    assert.ok(!/delegacion_enviada/.test(E.textoLedger()), 'nada se delega a ningún agente');
  } finally { await E.cerrar(); }
});

test('sin escrituras: el código del modo real no contiene operaciones de escritura ni de red distintas del lector, y el catálogo de la web queda intacto', () => {
  const t = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'puente', 'lector-real.mjs'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  assert.ok(!/writeFile|appendFile|unlink|rmSync|rename|mkdirSync|createWriteStream|child_process|\bfetch\(|http\.request|https\.request|net\./.test(t));
  // el cierre empaquetado no contiene nada de la web ni del catálogo (el Director no puede escribirlos porque ni siquiera los incluye)
  assert.ok(!calcularArchivos(RAIZ_REPO).some((f) => /^(src|public)\//.test(f) || /products\.json|categories\.json/.test(f)));
});

test('empaquetado: el cierre del Director incluye el modo real, el TAR se reconstruye idéntico y se verifica (sin pruebas, sin src, sin secretos)', () => {
  const archivos = calcularArchivos(RAIZ_REPO);
  for (const f of ['automation/director/puente/lector-real.mjs', 'automation/director/puente/lector-produccion.mjs', 'automation/lib/lectorProduccion.mjs', 'automation/lib/lectorPuente.mjs', 'scripts/automation/director.mjs']) assert.ok(archivos.includes(f), `falta ${f}`);
  assert.ok(!archivos.some((f) => /(^|\/)tests\//.test(f) || /^src\//.test(f) || /(^|\/)\.env|credentials\.json|\.pem$|\.key$|\.token$/i.test(f)));
  const lectura = leerArchivos(RAIZ_REPO, archivos); const tar = construirTar(lectura, '1.0.0-f2'); const tar2 = construirTar([...lectura].reverse(), '1.0.0-f2');
  assert.equal(sha256Hex(tar), sha256Hex(tar2)); const v = verificarTar(tar, sha256Hex(tar)); assert.equal(v.ok, true, v.errores.join(';'));
});

test('compose del modo real: sin puertos, sin privilegios ni red del host, red externa obligatoria, credencial como secreto de archivo (nunca variable ni valor) y candado propio', () => {
  const c = fs.readFileSync(path.join(RAIZ_REPO, 'automation', 'dev', 'director-imagen', 'docker-compose.real.yml'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/^\s*ports:|privileged|network_mode:\s*host|pid:\s*host|cap_add|docker\.sock/m.test(c));
  assert.match(c, /external: true/); assert.match(c, /TAI_LECTOR_RED:\?/); assert.match(c, /TAI_DIRECTOR_LECTOR_REAL: "si"/);
  assert.match(c, /TAI_LECTOR_PROD_TOKEN_FILE: \/run\/secrets\/lector_prod_token/); assert.ok(!/TAI_LECTOR_PROD_TOKEN:/.test(c));
  assert.match(c, /profiles: \["real"\]/);
});
