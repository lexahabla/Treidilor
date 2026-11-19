// verificar-canario.sh contra un `docker` FALSO (un script de shell que emula docker ps / exec psql / exec node / service logs con un estado en un archivo). Sin Docker real, sin red, sin VPS.
// Comprueba el flujo de las dos fases, la detección de fuga, la prueba positiva interior, el rechazo sin credencial y que el script es solo de lectura.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(AQUI, '..', '..', 'dev', 'prueba-traefik', 'e2', 'verificar-canario.sh');
const BASH = fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe') ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const TOKEN = 'canario-desechable-de-prueba-0123456789abcdef';

const FALSO = `
const fs=require('fs');const E=process.env.TAI_FALSO_ESTADO;const s=JSON.parse(fs.readFileSync(E,'utf8'));const a=process.argv.slice(2);const g=()=>fs.writeFileSync(E,JSON.stringify(s));
s.llamadas.push(a.slice(0,3).join(' '));
if(a[0]==='ps'){console.log('n8nabc docker.n8n.io/n8nio/n8n:2.38.6');console.log('runab n8nio/runners:2.38.6');console.log('pg1xyz postgres:17');if(s.dosN8n)console.log('n8ndos n8nio/n8n:2.38.6');g();process.exit(0);}
if(a[0]==='exec'&&a[1]==='pg1xyz'){const q=a[a.length-1];s.sql.push(q);g();
  if(/^select\\s+id\\s+from\\s+workflow_entity/.test(q)){if(s.importado)console.log('wfCANARIO1');process.exit(0);}
  if(/select count\\(\\*\\) from execution_entity where "workflowId" = 'wfCANARIO1'/.test(q)){console.log(String(s.cuenta));process.exit(0);}
  process.exit(1);}
if(a[0]==='exec'&&a[1]==='-i'){let t='';process.stdin.on('data',c=>t+=c).on('end',()=>{t=t.trim();const url=a[a.length-1].match(/tai=([A-Za-z0-9]+)/)[1];s.peticiones.push({id:url,conCred:Boolean(t)});
  if(!s.publicado){console.log('404|{"message":"not registered"}');}
  else if(t===s.token){ if(!s.noGuarda) s.cuenta+=1; console.log('200|{"canario":true}'); }
  else console.log('403|{"message":"Authorization data is wrong!"}');
  g();});return;}
if(a[0]==='service'&&a[1]==='logs'){for(const l of s.traefik)console.log(l);g();process.exit(0);}
g();process.exit(0);
`;

function montar(estado = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-f27-'));
  
  fs.writeFileSync(path.join(dir, 'falso.cjs'), FALSO);
  const nodo = process.execPath.replace(/\\/g, '/');
  // BASH_ENV: funciones que sustituyen a docker e id (un PATH con shims no es fiable entre Windows y Git Bash)
  const entorno = path.join(dir, 'entorno.sh');
  fs.writeFileSync(entorno, `docker() { "${nodo}" "${path.join(dir, 'falso.cjs').replace(/\\/g, '/')}" "$@"; }\nid() { echo 0; }\n`);
  const est = path.join(dir, 'estado.json');
  const guardar = (o) => fs.writeFileSync(est, JSON.stringify(o));
  const leer = () => JSON.parse(fs.readFileSync(est, 'utf8'));
  guardar({ importado: true, publicado: true, cuenta: 7, token: TOKEN, traefik: [], llamadas: [], sql: [], peticiones: [], ...estado });
  const secretos = path.join(dir, 'sec'); fs.mkdirSync(secretos); fs.writeFileSync(path.join(secretos, 'canario.token'), TOKEN, { mode: 0o600 });
  const correr = (args, extra = {}) => new Promise((resolve) => execFile(BASH, [SCRIPT.replace(/\\/g, '/'), ...args], { env: { ...process.env, BASH_ENV: entorno.replace(/\\/g, '/'), TAI_FALSO_ESTADO: est, TAI_E3_DIR_SECRETOS: secretos.replace(/\\/g, '/'), TAI_E3_DIR_ESTADO: path.join(dir, 'est').replace(/\\/g, '/'), ...extra }, timeout: 90000 }, (err, stdout, stderr) => resolve({ codigo: err ? (typeof err.code === 'number' ? err.code : 99) : 0, stdout, stderr })));
  return { dir, leer, guardar, correr, limpiar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('flujo correcto: positiva interior (+1 ejecución), sin credencial 403 (+0), y tras la sonda exterior el contador no cambia → E3_CANARIO_OK', async () => {
  const E = montar();
  try {
    const a = await E.correr(['antes']); assert.equal(a.codigo, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /E3_EJECUCIONES_ANTES=7/); assert.match(a.stdout, /E3_INTERIOR_CON_CREDENCIAL=200\|\{"canario":true\}/); assert.match(a.stdout, /E3_EJECUCIONES_TRAS_POSITIVA=8/); assert.match(a.stdout, /E3_INTERIOR_SIN_CREDENCIAL=403/); assert.match(a.stdout, /E3_FASE1_OK/);
    const st = E.leer(); assert.equal(st.peticiones.length, 2); assert.ok(st.peticiones[0].conCred && !st.peticiones[1].conCred);
    // sonda exterior (simulada): las líneas de Traefik llevan el prefijo; la prueba interior NO figura
    st.traefik = ['<ip> - - [x] "POST /webhook/tai-lector-prod-canario?tai=e3202611161830-001 HTTP/2.0" 403 9 "-" "-" 1 "tai-bloquear-lector-prod-https@file" "-" 1ms']; E.guardar(st);
    const d = await E.correr(['despues', 'e3202611161830']); assert.equal(d.codigo, 0, d.stdout + d.stderr);
    assert.match(d.stdout, /E3_CANARIO_OK/); assert.match(d.stdout, /LINEAS_SONDA_EXTERIOR=1/); assert.match(d.stdout, /PRUEBA_INTERIOR=0/);
    assert.ok(!(a.stdout + a.stderr + d.stdout).includes(TOKEN), 'la credencial no se imprime nunca');
    assert.ok(E.leer().sql.every((q) => /^select /i.test(q)), 'solo consultas SELECT');
  } finally { E.limpiar(); }
});

test('FUGA: si tras la sonda exterior el contador sube, el veredicto es E3_CANARIO_FUGA (código 2) y avisa de desactivarlo', async () => {
  const E = montar();
  try {
    assert.equal((await E.correr(['antes'])).codigo, 0);
    const st = E.leer(); st.cuenta += 1; E.guardar(st);
    const d = await E.correr(['despues', 'e3202611161830']); assert.equal(d.codigo, 2); assert.match(d.stdout, /E3_CANARIO_FUGA/); assert.match(d.stdout, /DESACTÍVALO/);
  } finally { E.limpiar(); }
});

test('canario no publicado (404 interior): FALLA y explica que el «0 ejecuciones» no valdría; sin guardar ejecuciones: FALLA; no encontrado en la base: NO_COMPROBABLE', async () => {
  let E = montar({ publicado: false });
  try { const a = await E.correr(['antes']); assert.equal(a.codigo, 1); assert.match(a.stdout, /NO está publicado/); } finally { E.limpiar(); }
  E = montar({ noGuarda: true });
  try { const a = await E.correr(['antes']); assert.equal(a.codigo, 1); assert.match(a.stdout, /guarda sus ejecuciones/); } finally { E.limpiar(); }
  E = montar({ importado: false });
  try { const a = await E.correr(['antes']); assert.equal(a.codigo, 3); assert.match(a.stdout, /NO_COMPROBABLE/); } finally { E.limpiar(); }
});

test('credencial incorrecta en el VPS: la prueba positiva no responde 200 → FALLA; dos contenedores de n8n o fase 2 sin fase 1 → FALLA', async () => {
  let E = montar({ token: 'otra-credencial-distinta-0123456789abcdef-zz' });
  try { const a = await E.correr(['antes']); assert.equal(a.codigo, 1); assert.match(a.stdout, /no respondió 200/); } finally { E.limpiar(); }
  E = montar({ dosN8n: true });
  try { const a = await E.correr(['antes']); assert.equal(a.codigo, 1); assert.match(a.stdout, /exactamente un contenedor/); } finally { E.limpiar(); }
  E = montar();
  try { const d = await E.correr(['despues', 'e3202611161830']); assert.equal(d.codigo, 1); assert.match(d.stdout, /fase 1|antes/); const m = await E.correr(['despues', 'malo']); assert.equal(m.codigo, 1); } finally { E.limpiar(); }
});

test('si la prueba interior aparece en el registro de Traefik, FALLA (no iba por la red interna)', async () => {
  const E = montar();
  try {
    assert.equal((await E.correr(['antes'])).codigo, 0);
    const id = E.leer().peticiones[0].id; const st = E.leer(); st.traefik = [`x "POST /webhook/tai-lector-prod-canario?tai=${id} HTTP/1.1" 200`]; E.guardar(st);
    const d = await E.correr(['despues', 'e3202611161830']); assert.equal(d.codigo, 1); assert.match(d.stdout, /no iba por la red interna/);
  } finally { E.limpiar(); }
});

test('verificar-canario.sh es de SOLO LECTURA respecto a n8n y Traefik: sin escrituras, reinicios ni cambios de servicios; credencial por stdin; solo SELECT; LF', () => {
  const t = fs.readFileSync(SCRIPT, 'utf8'); const activo = t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/docker (service (update|create|rm|scale)|restart|stop|kill|rm|cp|run|compose)|systemctl|\bmv\b|\bcp\b|\bchown\b/.test(activo));
  assert.ok(!/insert |update |delete |drop |alter |truncate /i.test(activo), 'ningún SQL de escritura');
  assert.match(activo, /docker exec -i "\$N8N" node/); assert.ok(!/\$\(cat "\$ARCHIVO_TOKEN"\)|--header|-H /.test(activo), 'la credencial no va en la línea de órdenes');
  assert.equal((activo.match(/\brm\b/g) ?? []).length, 1, 'único rm: su temporal'); assert.ok(!/\r/.test(t));
});
