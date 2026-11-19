// Lanzador MÍNIMO del runner de tareas para la prueba aislada (`docker-compose.runner.yml`). SUSTITUYE al `task-runner-launcher` de la imagen oficial `n8nio/runners`:
// no es el mismo programa. Hace lo esencial del protocolo (comprobado contra n8n 2.38.6):
//   1) POST <broker>/runners/auth  {token}  →  { data: { token: <grant token> } }   (el broker responde 403 si el token es erróneo)
//   2) arranca el ejecutor JavaScript del paquete `@n8n/task-runner` (`dist/start.js`) con N8N_RUNNERS_GRANT_TOKEN, SIN el token de autenticación en su entorno
//   3) si el proceso termina, repite (re-autentica) tras una pausa.
// Sólo Node estándar. No imprime ningún token. Sólo habla con el broker declarado (red aislada).
import { spawn } from 'node:child_process';

const BROKER = process.env.N8N_RUNNERS_TASK_BROKER_URI;
const TOKEN = process.env.N8N_RUNNERS_AUTH_TOKEN;
const INICIO = process.env.RUNNER_START_JS || '/usr/local/lib/node_modules/n8n/node_modules/@n8n/task-runner/dist/start.js';
if (!BROKER || !/^http:\/\/[a-z0-9.-]+:\d+$/.test(BROKER) || !TOKEN) { console.error('[lanzador] faltan N8N_RUNNERS_TASK_BROKER_URI (http://host:puerto) o N8N_RUNNERS_AUTH_TOKEN'); process.exit(2); }
const log = (m) => console.log(`[lanzador] ${new Date().toISOString()} ${m}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let parar = false;
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { parar = true; hijo?.kill(s); setTimeout(() => process.exit(0), 3000).unref(); });
let hijo = null;

async function concesion() {
  const r = await fetch(`${BROKER}/runners/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) });
  if (!r.ok) throw new Error(`autenticación rechazada por el broker (HTTP ${r.status})`);
  const j = await r.json();
  if (!j?.data?.token) throw new Error('respuesta de autenticación sin grant token');
  return j.data.token;
}

while (!parar) {
  try {
    const grant = await concesion();
    log('grant token obtenido; arrancando el ejecutor JavaScript');
    const env = { ...process.env, N8N_RUNNERS_GRANT_TOKEN: grant };
    delete env.N8N_RUNNERS_AUTH_TOKEN;
    await new Promise((resolver) => {
      hijo = spawn(process.execPath, [INICIO], { env, stdio: 'inherit' });
      hijo.on('exit', (code, sig) => { log(`el ejecutor terminó (código ${code}, señal ${sig})`); resolver(); });
      hijo.on('error', (e) => { log(`error al arrancar: ${e.message}`); resolver(); });
    });
  } catch (e) {
    log(`no se pudo conectar: ${e.message}`);
  }
  if (!parar) await dormir(3000);
}
