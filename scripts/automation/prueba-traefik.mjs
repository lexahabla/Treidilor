#!/usr/bin/env node
// PRUEBA LOCAL del bloqueo de los webhooks del lector con Traefik 3.6.7. NO se ejecuta sin autorización expresa.
//   node scripts/automation/prueba-traefik.mjs ensayo        sin Docker ni red: comprueba archivos, matriz y evaluador (siempre permitido)
//   node scripts/automation/prueba-traefik.mjs descargar     `docker pull traefik:v3.6.7` (ÚNICA descarga). Exige TAI_PRUEBA_TRAEFIK_AUTORIZADA=1
//   node scripts/automation/prueba-traefik.mjs ejecutar      levanta el entorno aislado `tai-prueba-tf`, pasa las fases y SIEMPRE guarda los resultados y limpia. Exige la misma variable y las imágenes ya descargadas
//   node scripts/automation/prueba-traefik.mjs limpiar       elimina contenedores, red y volúmenes del proyecto `tai-prueba-tf` (nunca prune)
// La configuración dinámica de Traefik vive en un VOLUMEN de Docker escrito desde dentro de Linux (contenedor `config-escritor`): un bind mount de Windows no entrega eventos de archivos (fsnotify) a Traefik.
// REGLA DE ORO de la prueba: el código 403 NO prueba nada (n8n también lo devuelve con su lista de IP). La regla se da por cargada SOLO si las sondas lo demuestran (`diagnosticarRegla`), y un bloqueo
// se da por bueno SOLO si la respuesta es la de Traefik Y la petición no aparece en el registro de acceso del origen, con controles positivos que prueban que el registro funciona.
// Secretos: se generan al azar y viven en D:/treidilor-pruebas/prueba-traefik (fuera del repositorio). Nunca habla con producción: sólo 127.0.0.1:18080/18081 y la red interna del compose.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clasificarRespuesta, diagnosticarRegla, evaluarControl, evaluarExterior, evaluarInterior, HOST_N8N, evaluarControlNegativo, matrizAbierto, matrizCodificada, matrizControles, matrizControlesNegativos, matrizExterior, RUTA_CANARIO } from '../../automation/dev/prueba-traefik/matriz.mjs';
import { decidirClf, evaluarSondaEjecuciones, HASH_REGLA_VALIDADA, veredictoVerificacionClf } from '../../automation/dev/prueba-traefik/matriz.mjs';
import { clasificarCapa2, evaluarClfAbierta, evaluarClfBloqueada, HOST_ECO, indexarClf, IP_BLOQUEO, matrizSuplantacionBloqueo, matrizSuplantacionCapa2, resumenEco, RUTA_PUBLICA_CONTROL, variantesSuplantacion } from '../../automation/dev/prueba-traefik/matriz.mjs';
import { ARCHIVO_CANDIDATA_TLS, controlesTls, evaluarAntiguoNoBloquea, evaluarRedirEntrypoint, evaluarRedireccion, HASH_CANDIDATA_TLS, matrizTls, veredictoTls } from '../../automation/dev/prueba-traefik/matriz.mjs';
import { CABECERA_CANARIO, CREDENCIAL_CANARIO, canarioAislamiento } from './build-canario-aislamiento.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR_PRUEBA = path.join(RAIZ, 'automation', 'dev', 'prueba-traefik');
const TRABAJO = process.env.TAI_DIR_PRUEBAS ? path.join(process.env.TAI_DIR_PRUEBAS, 'prueba-traefik') : 'D:/treidilor-pruebas/prueba-traefik';
export const IMAGEN_TRAEFIK = 'traefik:v3.6.7';
export const IMAGENES_LOCALES = ['n8nio/n8n:2.38.6', 'postgres:17', 'node:22-bookworm-slim'];
export const CONTENEDORES_EXISTENTES = ['treidilor-puente-entrada', 'treidilor-n8n-pruebas', 'treidilor-puente-salida'];
const PROYECTO = 'tai-prueba-tf';
const PUERTOS = { http: 18080, https: 18081 };
export const autorizado = (env = process.env) => env.TAI_PRUEBA_TRAEFIK_AUTORIZADA === '1';

// ───────────── Seguridad de las operaciones con efectos en Docker (16/11/2026) ─────────────
// 1) Solo `principal` concede la autorización (tras comprobar TAI_PRUEBA_TRAEFIK_AUTORIZADA). Hasta entonces `docker()` solo deja pasar subcomandos de LECTURA: cualquier otro lanza ANTES de ejecutar nada.
// 2) Toda ruta con efectos empieza por `iniciarOperacionConEfectos()`: autorización + destino Docker verificado (contexto efectivo, endpoint local, sin DOCKER_HOST/DOCKER_CONTEXT, Swarm inactivo).
// 3) Los recursos solo se crean tras comprobar que NO hay recursos previos del proyecto y tras escribir la marca `ejecucion-en-curso.json`. La limpieza es ÚNICA y solo si ESTA ejecución los creó (`ESTADO.creado`): se dispara
//    en el `finally`, con SIGINT/SIGTERM/SIGHUP/SIGBREAK y, como último recurso, en `exit`. Un apagado forzoso (SIGKILL, `taskkill /F`, corte de corriente) no puede ejecutar nada: la recuperación manual es la orden
//    `limpiar` (se niega si hay una ejecución viva o recursos `tai-tf` sin la etiqueta de esta prueba) y la marca avisa de que hubo una interrupción.
const CONTEXTO_LOCAL = 'desktop-linux';
const ENDPOINT_LOCAL = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const ETIQUETA_PRUEBA = 'label=com.treidilor.prueba=traefik-aislamiento';
const MARCA = path.join(TRABAJO, 'ejecucion-en-curso.json');
let AUTORIZACION_CONCEDIDA = false;
const exigirAutorizacion = () => { if (!AUTORIZACION_CONCEDIDA) throw new Error('Operación con efectos en Docker sin la autorización concedida por principal(): se aborta antes de ejecutar nada'); };
/** ¿Se puede lanzar este subcomando de Docker? Lectura: siempre. Todo lo demás (compose, exec, cp, restart, pull, rm…): solo con la autorización concedida. */
export function permitirDocker(a, autorizada) {
  const [c, s] = a;
  const lectura = (c === 'context' && ['show', 'inspect'].includes(s)) || (c === 'image' && s === 'inspect') || (c === 'network' && ['ls', 'inspect'].includes(s)) || (c === 'volume' && ['ls', 'inspect'].includes(s)) || ['info', 'inspect', 'ps', 'logs', 'version'].includes(c);
  return Boolean(lectura || autorizada);
}
const docker = (...a) => {
  if (!permitirDocker(a, AUTORIZACION_CONCEDIDA)) throw new Error(`docker ${a.slice(0, 2).join(' ')}: operación con efectos sin autorización concedida; no se ejecuta`);
  return execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 });
};
const dockerConEntrada = (entrada, ...a) => {
  if (!permitirDocker(a, AUTORIZACION_CONCEDIDA)) throw new Error(`docker ${a.slice(0, 2).join(' ')}: operación con efectos sin autorización concedida; no se ejecuta`);
  return execFileSync('docker', a, { encoding: 'utf8', input: entrada, stdio: ['pipe', 'pipe', 'pipe'] });
};
/**
 * Verifica el DESTINO de Docker antes de cualquier operación con efectos. Orden: (1) variables que pueden redirigir (sin contactar con ningún daemon), (2) contexto efectivo y (3) su endpoint (ambos son lecturas locales, sin
 * daemon), (4) solo entonces el daemon: Docker Desktop y Swarm inactivo. Cualquier discrepancia o error de lectura ABORTA. `ejecutar` e `env` son inyectables para las pruebas.
 */
export function verificarDestinoDocker({ env = process.env, ejecutar = docker } = {}) {
  const redirigen = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].filter((k) => env[k] !== undefined);
  if (redirigen.length) throw new Error(`Variables que pueden redirigir Docker definidas (${redirigen.join(', ')}): se aborta sin ejecutar nada`);
  const leer = (...a) => { try { return String(ejecutar(...a)).trim(); } catch { throw new Error(`No se pudo verificar el destino de Docker («docker ${a.slice(0, 2).join(' ')}» falló): se aborta`); } };
  const contexto = leer('context', 'show');
  if (contexto !== CONTEXTO_LOCAL) throw new Error(`El contexto efectivo de Docker es «${contexto}» y debe ser «${CONTEXTO_LOCAL}»: se aborta`);
  const endpoint = leer('context', 'inspect', contexto, '--format', '{{.Endpoints.docker.Host}}');
  if (endpoint !== ENDPOINT_LOCAL) throw new Error(`El endpoint del contexto «${contexto}» es «${endpoint}» y debe ser «${ENDPOINT_LOCAL}» (Docker Desktop local): se aborta`);
  const [servidor, swarm, so] = leer('info', '--format', '{{.Name}}|{{.Swarm.LocalNodeState}}|{{.OperatingSystem}}').split('|');
  if (swarm !== 'inactive') throw new Error(`Docker Swarm no está inactivo (estado «${swarm}»): se aborta`);
  if (so !== 'Docker Desktop' || servidor !== 'docker-desktop') throw new Error(`El daemon no es Docker Desktop local (servidor «${servidor}», sistema «${so}»): se aborta`);
  return { contexto, endpoint, servidor, swarm, so };
}
/** PRIMERA llamada de TODA ruta con efectos: autorización concedida + destino Docker verificado. */
function iniciarOperacionConEfectos() { exigirAutorizacion(); return verificarDestinoDocker(); }

// Estado de lo que ESTA ejecución ha creado. `creado` solo pasa a true tras comprobar que no había recursos previos y escribir la marca.
const ESTADO = { creado: false, limpiando: false, limpiada: false, finalizando: false, interrumpido: null, marca: false, senales: false };
/** Limpieza ÚNICA: solo si esta ejecución creó recursos, nunca dos veces ni de forma reentrante. `accion` se inyecta para poder probarla sin Docker. */
export function crearLimpiezaUnica(estado, accion) {
  return () => {
    if (!estado.creado || estado.limpiando || estado.limpiada) return false;
    estado.limpiando = true;
    try { accion(); } finally { estado.limpiando = false; estado.limpiada = true; }
    return true;
  };
}
const limpiezaUnica = crearLimpiezaUnica(ESTADO, () => {
  const ok = limpiarProyecto();
  if (ok && ESTADO.marca) { try { fs.rmSync(MARCA, { force: true }); ESTADO.marca = false; } catch { /* la marca se limpia con «limpiar» */ } }
});
/** Marca atómica (`wx`) de «hay una ejecución en curso». Si existe, otra ejecución está viva o una anterior se interrumpió: se aborta SIN crear nada. */
function marcarEjecucion(modo) {
  fs.mkdirSync(TRABAJO, { recursive: true });
  try { fs.writeFileSync(MARCA, JSON.stringify({ pid: process.pid, modo, inicio: new Date().toISOString() }), { flag: 'wx' }); }
  catch (e) { throw new Error(e.code === 'EEXIST' ? `Existe ${MARCA}: hay otra ejecución en curso o una anterior se interrumpió. Comprueba que no hay ninguna en curso y ejecuta «limpiar» (recuperación manual)` : `No se puede escribir ${MARCA} (${e.code ?? e.message}): se aborta sin crear nada`); }
  ESTADO.marca = true;
}
function instalarSenales() {
  if (ESTADO.senales) return;
  ESTADO.senales = true;
  const manejar = (senal, codigo) => () => {
    if (ESTADO.interrumpido) return;                 // una segunda señal mientras se limpia NO relanza la limpieza
    ESTADO.interrumpido = senal;
    if (ESTADO.finalizando) { console.error(`\n${senal}: la ejecución ya está guardando resultados y limpiando; espera a que termine.`); return; }
    console.error(`\n${senal}: se limpian SOLO los recursos creados por esta ejecución; no vuelvas a interrumpir.`);
    try { limpiezaUnica(); } catch (e) { console.error(`Limpieza: ${String(e.message).slice(0, 160)}`); }
    process.exit(codigo);
  };
  process.on('SIGINT', manejar('SIGINT', 130));
  process.on('SIGTERM', manejar('SIGTERM', 143));
  process.on('SIGHUP', manejar('SIGHUP', 129));
  process.on('SIGBREAK', manejar('SIGBREAK', 149));
  process.on('exit', () => { try { limpiezaUnica(); } catch { /* último recurso: nada más que hacer */ } });
}
/** pid de otra ejecución VIVA según la marca (o null). */
function pidEnCursoSegunMarca() {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(MARCA, 'utf8')).pid);
    if (!Number.isInteger(pid) || pid === process.pid) return null;
    try { process.kill(pid, 0); return pid; } catch (e) { return e.code === 'EPERM' ? pid : null; }
  } catch { return null; }
}
export const ajenosAlProyecto = (todos, propios) => todos.filter((n) => !propios.includes(n));
const nombresDocker = (a) => docker(...a).trim().split('\n').map((s) => s.trim()).filter(Boolean);
/** Recursos con nombre `tai-tf`/`tai_tf` que NO llevan la etiqueta de esta prueba (no son nuestros: no se tocan). */
function recursosAjenos() {
  const todosCont = nombresDocker(['ps', '-a', '--filter', 'name=tai-tf', '--format', '{{.Names}}']);
  const propiosCont = nombresDocker(['ps', '-a', '--filter', 'name=tai-tf', '--filter', ETIQUETA_PRUEBA, '--format', '{{.Names}}']);
  const todasRedes = nombresDocker(['network', 'ls', '--format', '{{.Name}}']).filter((n) => /^tai-tf/.test(n));
  const propiasRedes = nombresDocker(['network', 'ls', '--filter', ETIQUETA_PRUEBA, '--format', '{{.Name}}']);
  const todosVol = nombresDocker(['volume', 'ls', '--format', '{{.Name}}']).filter((n) => /^tai_tf/.test(n));
  const propiosVol = nombresDocker(['volume', 'ls', '--filter', ETIQUETA_PRUEBA, '--format', '{{.Name}}']);
  return [...ajenosAlProyecto(todosCont, propiosCont), ...ajenosAlProyecto(todasRedes, propiasRedes), ...ajenosAlProyecto(todosVol, propiosVol)];
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const mostrar = (k, v) => console.log(`${String(k).padEnd(56)} ${v}`);

/** Petición HTTP CRUDA (la línea de petición va tal cual: ni `fetch` ni `http` normalizan `//`, `/./` o `%2F`). Devuelve { estado, cabeceras, cuerpo } o { error }. */
export function peticionCruda({ puerto, metodo, ruta, host, cabeceras = {}, cuerpo = '', timeoutMs = 8000, anfitrion = '127.0.0.1' }) {
  return new Promise((resolve) => {
    const s = net.connect(puerto, anfitrion);
    const trozos = [];
    const fin = (r) => { s.destroy(); resolve(r); };
    const t = setTimeout(() => fin(trozos.length ? analizar(Buffer.concat(trozos)) : { error: 'tiempo agotado' }), timeoutMs);
    s.on('connect', () => {
      const cab = { Host: host, Connection: 'close', ...cabeceras, ...(cuerpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) } : (['POST', 'PUT'].includes(metodo) ? { 'Content-Length': 0 } : {})) };
      s.write(`${metodo} ${ruta} HTTP/1.1\r\n${Object.entries(cab).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`)).join('\r\n')}\r\n\r\n${cuerpo}`);
    });
    s.on('data', (d) => trozos.push(d));
    s.on('end', () => { clearTimeout(t); fin(trozos.length ? analizar(Buffer.concat(trozos)) : { error: 'conexión cerrada sin respuesta' }); });
    s.on('error', (e) => { clearTimeout(t); fin({ error: e.code || e.message }); });
  });
}
/**
 * Igual que `peticionCruda` pero sobre TLS REAL (fase `tls`, 17/11/2026): la línea de petición va tal cual, con SNI configurable (`sni: null` = sin SNI). El certificado es el autogenerado por Traefik y NO se valida:
 * solo se usa contra 127.0.0.1 (el puerto local del contenedor de la prueba). Devuelve { estado, cabeceras, cuerpo } o { error }.
 */
export function peticionTls({ puerto, metodo, ruta, host, sni = HOST_N8N, cabeceras = {}, cuerpo = '', timeoutMs = 8000, anfitrion = '127.0.0.1' }) {
  return new Promise((resolve) => {
    const opciones = { host: anfitrion, port: puerto, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] };
    if (sni) opciones.servername = sni;
    const s = tls.connect(opciones);
    const trozos = [];
    const fin = (r) => { s.destroy(); resolve(r); };
    const t = setTimeout(() => fin(trozos.length ? analizar(Buffer.concat(trozos)) : { error: 'tiempo agotado' }), timeoutMs);
    s.on('secureConnect', () => {
      const cab = { Host: host, Connection: 'close', ...cabeceras, ...(cuerpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) } : (['POST', 'PUT'].includes(metodo) ? { 'Content-Length': 0 } : {})) };
      s.write(`${metodo} ${ruta} HTTP/1.1\r\n${Object.entries(cab).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`)).join('\r\n')}\r\n\r\n${cuerpo}`);
    });
    s.on('data', (d) => trozos.push(d));
    s.on('end', () => { clearTimeout(t); fin(trozos.length ? analizar(Buffer.concat(trozos)) : { error: 'conexión cerrada sin respuesta' }); });
    s.on('error', (e) => { clearTimeout(t); fin({ error: e.code || e.message }); });
  });
}
/** Petición HTTP/2 (lo que negocian navegadores y la mayoría de llamadores). `:path` va tal cual. Mismo contrato que `peticionTls`. */
export function peticionH2({ puerto, metodo, ruta, host, sni = HOST_N8N, cabeceras = {}, cuerpo = '', timeoutMs = 8000, anfitrion = '127.0.0.1' }) {
  return new Promise((resolve) => {
    let cliente = null; let terminado = false; let t = null;
    const fin = (r) => { if (terminado) return; terminado = true; if (t) clearTimeout(t); try { cliente?.destroy(); } catch { /* ya cerrado */ } resolve(r); };
    t = setTimeout(() => fin({ error: 'tiempo agotado' }), timeoutMs);
    try {
      cliente = http2.connect(`https://${anfitrion}:${puerto}`, { rejectUnauthorized: false, ...(sni ? { servername: sni } : {}) });
      cliente.on('error', (e) => fin({ error: e.code || e.message }));
      const cab = { ':method': metodo, ':path': ruta, ':authority': host };
      for (const [k, v] of Object.entries(cabeceras)) cab[k.toLowerCase()] = v;
      if (cuerpo) cab['content-type'] = 'application/json';
      const req = cliente.request(cab);
      let estado = 0; let cabs = {}; const trozos = [];
      req.on('response', (h) => { estado = Number(h[':status']); cabs = Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith(':'))); });
      req.on('data', (d) => trozos.push(d));
      req.on('end', () => fin({ estado, cabeceras: cabs, cuerpo: Buffer.concat(trozos).toString('utf8'), protocolo: 'h2' }));
      req.on('error', (e) => fin({ error: e.code || e.message }));
      req.end(cuerpo || undefined);
    } catch (e) { fin({ error: e.code || e.message }); }
  });
}
let MODO_TLS = false;   // solo la fase `tls` lo activa: el puerto del entrypoint «https» habla TLS y `enviar` usa el cliente TLS (o HTTP/2) en vez del TCP en claro
/** Envío único para los lotes: en modo TLS, el puerto https usa TLS real; todo lo demás, la petición cruda de siempre. */
const enviar = (o) => (MODO_TLS && o.puerto === PUERTOS.https ? (o.h2 ? peticionH2(o) : peticionTls(o)) : peticionCruda(o));
export function analizar(buf) {
  const texto = buf.toString('utf8');
  const i = texto.indexOf('\r\n\r\n');
  const cab = (i >= 0 ? texto.slice(0, i) : texto).split('\r\n');
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(cab[0] ?? '');
  const cabeceras = {};
  for (const l of cab.slice(1)) { const k = l.indexOf(':'); if (k > 0) cabeceras[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim(); }
  let cuerpo = i >= 0 ? texto.slice(i + 4) : '';
  if (/chunked/i.test(cabeceras['transfer-encoding'] ?? '')) cuerpo = decodificarChunked(cuerpo);
  return { estado: m ? Number(m[1]) : 0, cabeceras, cuerpo };
}
/** Decodifica `Transfer-Encoding: chunked` (Traefik/n8n lo usan): sin esto el cuerpo llevaría los tamaños de los trozos y las marcas se leerían mal. */
export function decodificarChunked(t) {
  let out = ''; let pos = 0;
  while (pos < t.length) {
    const fin = t.indexOf('\r\n', pos);
    if (fin < 0) break;
    const n = parseInt(t.slice(pos, fin).split(';')[0], 16);
    if (!Number.isFinite(n) || n === 0) break;
    out += t.slice(fin + 2, fin + 2 + n);
    pos = fin + 2 + n + 2;
  }
  return out;
}
/** Líneas JSON del registro de acceso de Traefik → mapa idPrueba → línea. */
export function indexarRegistro(texto) {
  const mapa = new Map();
  for (const l of String(texto).split('\n')) {
    if (!l.startsWith('{')) continue;
    try { const j = JSON.parse(l); const id = j['request_X-Prueba-Id'] ?? j['request_X-Prueba-Id'.toLowerCase()]; if (id) mapa.set(id, j); } catch { /* línea de otro tipo */ }
  }
  return mapa;
}
/** Línea temporal de las configuraciones que Traefik RECIBIÓ (registro DEBUG): permite ver cuándo apareció y desapareció el router de bloqueo y cuándo se regeneró main.yaml. */
export function lineaTemporalConfig(texto) {
  const sinColor = String(texto).replace(/\x1b\[[0-9;]*m/g, '');
  return sinColor.split('\n').filter((l) => /Configuration received config=/.test(l) && /"routers"/.test(l)).map((l) => ({ t: l.slice(0, 20), bloqueo: /"tai-bloquear-lector-prod":\{/.test(l), regenerado: /"regenerado-http":\{/.test(l) }));
}
const registroActual = () => { try { return indexarRegistro(docker('logs', 'tai-tf-traefik')); } catch { return new Map(); } };
const nuevoId = () => crypto.randomBytes(6).toString('hex');

/**
 * Pasa un lote de celdas y las evalúa contra el registro de acceso con CONTROLES POSITIVOS: cada 12 celdas (y al final) se intercala un centinela (GET /healthz, que SIEMPRE llega a n8n y por
 * tanto SIEMPRE deja línea con su X-Prueba-Id). Se espera a que TODOS los centinelas estén en el registro: sólo entonces la AUSENCIA de línea de una celda es significativa. Si falta alguno, el lote
 * se invalida (la prueba se detiene: no se interpreta nada).
 */
async function correrLote(celdas, cred, evaluar) {
  const crudas = []; const centinelas = [];
  const centinela = async () => { for (const metodo of ['GET', 'HEAD']) { const id = nuevoId(); const r = await enviar({ puerto: MODO_TLS ? PUERTOS.https : 18080, metodo, ruta: '/healthz', host: HOST_N8N, cabeceras: { 'X-Prueba-Id': id } }); centinelas.push({ id, metodo, estado: r.estado }); } };  // GET y HEAD: ambos DEBEN dejar línea (controles positivos de que el registro funciona para los dos métodos)
  await centinela();
  for (const [i, celda] of celdas.entries()) {
    const idPrueba = nuevoId();
    const cabeceras = { 'X-Prueba-Id': idPrueba, ...(celda.credencial ? { [CABECERA_CANARIO]: cred } : {}), ...(celda.cabeceras ?? {}) };
    const r = await enviar({ puerto: PUERTOS[celda.entrada], metodo: celda.metodo, ruta: celda.ruta, host: celda.host, cabeceras, cuerpo: celda.metodo === 'POST' ? '{}' : '', h2: Boolean(celda.h2), sni: celda.sni === undefined ? HOST_N8N : celda.sni });
    crudas.push({ celda, idPrueba, r });
    if ((i + 1) % 12 === 0) await centinela();
  }
  await centinela();
  let mapa = new Map();
  const visto = await hasta(() => { mapa = registroActual(); return centinelas.every((c) => mapa.has(c.id)); }, 15000);
  const faltan = centinelas.filter((c) => !mapa.has(c.id)).length;
  if (visto === null || faltan) throw new Error(`Lote inválido: ${faltan}/${centinelas.length} centinelas (controles positivos del registro) no aparecen en el registro de acceso; no se puede interpretar la ausencia de líneas`);
  const celdasEv = crudas.map(({ celda, idPrueba, r }) => {
    const log = mapa.get(idPrueba) ?? null;
    const gem = celda.metodo === 'HEAD' ? crudas.find((x) => x.celda.metodo === 'GET' && x.celda.ruta === celda.ruta && x.celda.entrada === celda.entrada && x.celda.host === celda.host && x.celda.credencial === celda.credencial) : null;
    const ev = evaluar(celda, { ...r, log, gemelo: gem ? gem.r : null });
    return { id: celda.id, tipo: celda.tipo, metodo: celda.metodo, ruta: celda.ruta, entrada: celda.entrada, host: celda.host, credencial: Boolean(celda.credencial), estado: r.estado ?? null, error: r.error ?? null, clasificacion: clasificarRespuesta(r), cuerpo: String(r.cuerpo ?? '').slice(0, 120), router: log?.RouterName ?? null, servicio: log?.ServiceName ?? null, originStatus: log?.OriginStatus ?? null, conRegistro: Boolean(log), ok: ev.ok, motivos: ev.motivos, sinRegistro: !log };
  });
  return { celdas: celdasEv, centinelas: { total: centinelas.length, enRegistro: centinelas.length - faltan, estados: [...new Set(centinelas.map((c) => c.estado))] } };
}
/** Segundos hasta que `cond()` se cumple (o null si se agota). */
async function hasta(cond, maxMs = 40000) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { try { if (await cond()) return Math.round((Date.now() - t0) / 100) / 10; } catch { /* aún no */ } await dormir(400); } return null; }

/** Tres sondas → diagnóstico inequívoco (nunca por el código 403). */
async function sondearRegla(cred) {
  const p = (ruta, metodo = 'POST', credencial = true) => peticionCruda({ puerto: 18080, metodo, ruta, host: HOST_N8N, cabeceras: credencial ? { [CABECERA_CANARIO]: cred } : {}, cuerpo: metodo === 'POST' ? '{}' : '' });
  return diagnosticarRegla({ exacta: await p(`/webhook/${RUTA_CANARIO}`), abierto: await p(`/webhook/${RUTA_CANARIO}-abierto`), control: await p('/healthz', 'GET', false) });
}
/** Espera a que la regla esté en el estado pedido y ESTABLE (3 sondeos consecutivos). Devuelve los segundos y el último diagnóstico. */
async function esperarRegla(cred, deseado, maxMs = 40000) {
  const t0 = Date.now(); let seguidos = 0; let ult = null;
  while (Date.now() - t0 < maxMs) { ult = await sondearRegla(cred); seguidos = ult.estado === deseado ? seguidos + 1 : 0; if (seguidos >= 3) return { s: Math.round((Date.now() - t0) / 100) / 10, diag: ult }; await dormir(500); }
  return { s: null, diag: ult };
}

/**
 * PRUEBA HEAD AISLADA (antes de la matriz): un par GET+HEAD a la ruta exacta del canario. Sin regla, el evaluador debe declarar el HEAD como NO bloqueado (llega a n8n); con la regla cargada, como bloqueado.
 * Si no distingue ambos casos, la ejecución se detiene antes de la matriz.
 */
async function pruebaHeadAislada(cred, esperadoBloqueado) {
  const pares = [{ id: 'aislada|GET', tipo: 'aislada', metodo: 'GET', ruta: `/webhook/${RUTA_CANARIO}`, entrada: 'http', host: HOST_N8N, credencial: true }, { id: 'aislada|HEAD', tipo: 'aislada', metodo: 'HEAD', ruta: `/webhook/${RUTA_CANARIO}`, entrada: 'http', host: HOST_N8N, credencial: true }];
  const lote = await correrLote(pares, cred, evaluarExterior);
  const head = lote.celdas.find((c) => c.metodo === 'HEAD');
  const resultado = { esperadoBloqueado, evaluadoComoBloqueado: head.ok, estado: head.estado, conRegistro: head.conRegistro, router: head.router, originStatus: head.originStatus, motivos: head.motivos, gemelo: lote.celdas.find((c) => c.metodo === 'GET').clasificacion };
  if (head.ok !== esperadoBloqueado) throw new Error(`Prueba HEAD aislada: el evaluador declaró ${head.ok ? 'BLOQUEADO' : 'NO bloqueado'} y se esperaba ${esperadoBloqueado ? 'bloqueado' : 'no bloqueado'} (${head.motivos.join('; ') || 'sin motivos'})`);
  return resultado;
}

function interior(cred) {
  const js = `const h={'content-type':'application/json'};if(process.env.CRED)h['${CABECERA_CANARIO}']=process.env.CRED;fetch('http://n8n-interno:5678/webhook/${RUTA_CANARIO}',{method:'POST',headers:h,body:'{}'}).then(async r=>console.log(JSON.stringify({estado:r.status,cuerpo:await r.text()}))).catch(e=>console.log(JSON.stringify({estado:0,cuerpo:String(e)})))`;
  const lanzar = (c) => JSON.parse(docker('exec', ...(c ? ['-e', `CRED=${c}`] : []), 'tai-tf-cliente', 'node', '-e', js).trim().split('\n').pop());
  return [evaluarInterior(lanzar(cred), true), evaluarInterior(lanzar(''), false)];
}
const contarEjecuciones = () => Number(docker('exec', 'tai-tf-db', 'psql', '-U', 'n8n_prueba', '-d', 'n8n_prueba', '-tAc', 'select count(*) from execution_entity').trim());

// — configuración dinámica de Traefik: SIEMPRE escrita desde dentro de Linux (volumen `tai_tf_config`) —
const escribirCfg = (nombre, texto) => dockerConEntrada(texto, 'exec', '-i', 'tai-tf-cfg', 'sh', '-c', `cat > /cfg/${nombre}.tmp && mv /cfg/${nombre}.tmp /cfg/${nombre}`);
const quitarCfg = (nombre) => docker('exec', 'tai-tf-cfg', 'rm', '-f', `/cfg/${nombre}`);
const instantaneaCfg = () => { try { const nombres = docker('exec', 'tai-tf-cfg', 'ls', '/cfg').trim().split('\n').filter(Boolean); return Object.fromEntries(nombres.map((n) => { const t = docker('exec', 'tai-tf-cfg', 'cat', `/cfg/${n}`); return [n, { sha256: crypto.createHash('sha256').update(t).digest('hex'), texto: t }]; })); } catch (e) { return { error: String(e.message).slice(0, 120) }; } };
const leerBase = (f) => fs.readFileSync(path.join(DIR_PRUEBA, f), 'utf8');

function preparar() {
  fs.mkdirSync(TRABAJO, { recursive: true });
  const envF = path.join(TRABAJO, 'env');
  if (!fs.existsSync(envF)) fs.writeFileSync(envF, `PRUEBA_TF_PG_PASSWORD=${crypto.randomBytes(18).toString('hex')}\nPRUEBA_TF_ENCRYPTION_KEY=${crypto.randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
  return envF;
}
const compose = (envF, ...a) => docker('compose', '-p', PROYECTO, '--env-file', envF, '-f', path.join(DIR_PRUEBA, 'docker-compose.yml'), ...a);

/** `down -v` SOLO del proyecto `tai-prueba-tf` (compose -p) y borrado de las credenciales temporales. Devuelve true si la limpieza de Docker tuvo éxito. NO se llama directamente: solo desde `limpiezaUnica` y `limpiarComando`. */
function limpiarProyecto() {
  exigirAutorizacion();
  let ok = false;
  try { const envF = preparar(); compose(envF, 'down', '-v', '--remove-orphans'); mostrar('limpieza', 'contenedores, red y volúmenes de tai-prueba-tf eliminados'); ok = true; } catch (e) { mostrar('limpieza', `ERROR: ${String(e.message).slice(0, 160)}`); process.exitCode = 1; }
  for (const f of ['credencial.json', 'canario.json']) { try { fs.rmSync(path.join(TRABAJO, f), { force: true }); } catch { /* sin credenciales temporales */ } }
  return ok;
}
/** Orden manual `limpiar` (recuperación tras una interrupción forzosa). Se niega si hay una ejecución viva o recursos `tai-tf` que no llevan la etiqueta de esta prueba. */
async function limpiarComando() {
  iniciarOperacionConEfectos();
  const viva = pidEnCursoSegunMarca();
  if (viva) throw new Error(`Hay una ejecución en curso (pid ${viva}) según ${MARCA}: no se limpia mientras tanto`);
  const ajenos = recursosAjenos();
  if (ajenos.length) throw new Error(`Hay recursos «tai-tf» SIN la etiqueta de esta prueba (${ajenos.join(', ')}): no se elimina nada`);
  const ok = limpiarProyecto();
  if (ok) { try { fs.rmSync(MARCA, { force: true }); } catch { /* sin marca */ } }
  return ok ? 0 : 1;
}
function descargarImagen() {
  iniciarOperacionConEfectos();
  docker('pull', IMAGEN_TRAEFIK);
  mostrar('imagen', docker('image', 'inspect', IMAGEN_TRAEFIK, '--format', '{{.Id}} {{.Size}} bytes').trim());
  return 0;
}
async function esperar(cond, ms, que) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await cond()) return; } catch { /* aún no */ } await dormir(1500); } throw new Error(`Tiempo agotado esperando: ${que}`); }
const resumen = (celdas) => ({ celdas: celdas.length, ok: celdas.filter((c) => c.ok).length, fallos: celdas.filter((c) => !c.ok).length });
const porClase = (celdas) => celdas.reduce((m, c) => { m[c.clasificacion] = (m[c.clasificacion] || 0) + 1; return m; }, {});

/** Estado de Docker: contexto, DOCKER_HOST y los tres contenedores existentes (id, arranque, estado) + recursos del proyecto. */
function estadoDocker() {
  const contexto = docker('context', 'show').trim();
  const existentes = Object.fromEntries(CONTENEDORES_EXISTENTES.map((n) => { try { return [n, docker('inspect', '-f', '{{.Id}} {{.State.StartedAt}} {{.State.Status}}', n).trim()]; } catch { return [n, 'AUSENTE']; } }));
  const proyecto = { contenedores: docker('ps', '-a', '--filter', 'name=tai-tf', '--format', '{{.Names}}').trim().split('\n').filter(Boolean), redes: docker('network', 'ls', '--format', '{{.Name}}').trim().split('\n').filter((n) => /^tai-tf/.test(n)), volumenes: docker('volume', 'ls', '--format', '{{.Name}}').trim().split('\n').filter((n) => /^tai_tf/.test(n)) };
  return { contexto, dockerHost: process.env.DOCKER_HOST ?? null, servidor: docker('info', '--format', '{{.Name}} swarm={{.Swarm.LocalNodeState}}').trim(), existentes, proyecto };
}

// ───────────── E0b (modo `e0b`): forwardedHeaders.insecure=true. Nada de esto se ejecuta en la orden `ejecutar` normal. ─────────────
const ECO_YAML = 'http:\n  routers:\n    eco-http:\n      rule: "Host(`eco.prueba.local`)"\n      entryPoints: [http, https]\n      service: eco\n  services:\n    eco:\n      loadBalancer:\n        servers:\n          - url: "http://eco:8080/"\n';
const ipDe = (c) => docker('inspect', '-f', '{{(index .NetworkSettings.Networks "tai-tf-aislada").IPAddress}}', c).trim();
const enmascararIp = (l) => String(l).replace(/^\S+/, '<ip>');
/** Qué RECIBE el origen (eco) de cada cabecera suplantada: demuestra si insecure=true está activo y qué hace Traefik (¿añade la IP real al final o la sustituye?). */
async function ecoPrueba(ip) {
  const filas = [];
  for (const [nombre, cab] of [['sin-cabeceras', {}], ...variantesSuplantacion(ip)]) {
    for (const entrada of ['http', 'https']) {
      const r = await peticionCruda({ puerto: PUERTOS[entrada], metodo: 'GET', ruta: '/', host: HOST_ECO, cabeceras: cab });
      filas.push({ variante: nombre, entrada, estado: r.estado ?? null, enviado: cab, recibido: resumenEco(r.cuerpo) });
    }
  }
  const f = filas.find((x) => x.variante === 'xff-ip-bloqueo' && x.entrada === 'http');
  const basal = filas.find((x) => x.variante === 'sin-cabeceras' && x.entrada === 'http');
  const xff = f?.recibido?.xff ?? null;
  return { filas, remoteDelEco: basal?.recibido?.remote ?? null, ipRealVistaPorTraefik: String(basal?.recibido?.xff ?? '').split(',').pop().trim() || null, conservaLaCabeceraDelCliente: Boolean(xff && xff.includes(IP_BLOQUEO)), anadeLaIpRealAlFinal: Boolean(xff && xff.split(',').length >= 2 && !xff.split(',').pop().includes(IP_BLOQUEO)), xffRecibidoConXffFalso: xff };
}
/** Llamada INTERNA directa a n8n (sin Traefik) con una X-Forwarded-For elegida: demuestra que un servicio de la red interna puede elegir la IP que n8n ve (trust proxy = 1). */
function interiorXff(cred, xff) {
  const js = `const h={'content-type':'application/json','${CABECERA_CANARIO}':process.env.CRED};if(process.env.XFF)h['x-forwarded-for']=process.env.XFF;fetch('http://n8n-interno:5678/webhook/${RUTA_CANARIO}',{method:'POST',headers:h,body:'{}'}).then(async r=>console.log(JSON.stringify({estado:r.status,cuerpo:await r.text()}))).catch(e=>console.log(JSON.stringify({estado:0,cuerpo:String(e)})))`;
  const o = JSON.parse(docker('exec', '-e', `CRED=${cred}`, '-e', `XFF=${xff}`, 'tai-tf-cliente', 'node', '-e', js).trim().split('\n').pop());
  return { xff: xff || null, estado: o.estado, clase: clasificarCapa2(o) };
}
/** Sondas de la fase CLF. `grupo`: publica (ejecuta su workflow: 1 ejecución) · sin-ejecucion · bloqueada (0 ejecuciones). Las abiertas llevan `esperaEstado`. */
export function sondasClf(ip) {
  const P = RUTA_CANARIO;
  const abiertas = [
    { id: 'clf|centinela-GET|healthz', grupo: 'sin-ejecucion', metodo: 'GET', ruta: '/healthz', entrada: 'http', esperaEstado: [200] },
    { id: 'clf|centinela-HEAD|healthz', grupo: 'sin-ejecucion', metodo: 'HEAD', ruta: '/healthz', entrada: 'http', esperaEstado: [200] },
    { id: 'clf|publica|webhook-publico', grupo: 'publica', metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, entrada: 'http', esperaEstado: [200] },
    { id: 'clf|publica|webhook-publico-https', grupo: 'publica', metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, entrada: 'https', esperaEstado: [200] },
    { id: 'clf|publica|interfaz', grupo: 'sin-ejecucion', metodo: 'GET', ruta: '/', entrada: 'http', esperaEstado: [200, 302] },
    { id: 'clf|ajena|lector-local-04', grupo: 'sin-ejecucion', metodo: 'POST', ruta: '/webhook/tai-lector-04', entrada: 'http', esperaEstado: [404] },
  ];
  const bloqueadas = [
    { id: 'clf|bloq|exacta-http-cred', metodo: 'POST', ruta: `/webhook/${P}`, entrada: 'http', credencial: true },
    { id: 'clf|bloq|exacta-https-sin-cred', metodo: 'POST', ruta: `/webhook/${P}`, entrada: 'https', credencial: false },
    { id: 'clf|bloq|abierto-http', metodo: 'POST', ruta: `/webhook/${P}-abierto`, entrada: 'http', credencial: true },
    { id: 'clf|bloq|abierto-https', metodo: 'POST', ruta: `/webhook/${P}-abierto`, entrada: 'https', credencial: true },
    { id: 'clf|bloq|codificada-barra', metodo: 'POST', ruta: `/webhook%2F${P}`, entrada: 'http', credencial: true },
    { id: 'clf|bloq|barras-dobles', metodo: 'POST', ruta: `//webhook//${P}`, entrada: 'http', credencial: true },
    { id: 'clf|bloq|exacta-GET', metodo: 'GET', ruta: `/webhook/${P}`, entrada: 'http', credencial: true },
    { id: 'clf|bloq|suplantacion-xff-bloqueo', metodo: 'POST', ruta: `/webhook/${P}`, entrada: 'http', credencial: true, cabeceras: { 'X-Forwarded-For': IP_BLOQUEO } },
    { id: 'clf|bloq|suplantacion-xff-interna', metodo: 'POST', ruta: `/webhook/${P}-abierto`, entrada: 'http', credencial: true, cabeceras: { 'X-Forwarded-For': ip } },
  ].map((c) => ({ grupo: 'bloqueada', ...c }));
  return { abiertas, bloqueadas };
}
/** Fase CLF: Traefik se recrea con el registro en formato `common` (como el VPS). El id viaja en la consulta (`?tai=`): el CLF no lleva cabeceras. */
async function faseClf(envF, cred, ip) {
  process.env.PRUEBA_TF_TRAEFIK_CFG = './traefik.e0b-clf.yaml';
  compose(envF, 'up', '-d', '--pull', 'never', '--no-deps', '--force-recreate', 'traefik');
  await esperar(() => peticionCruda({ puerto: 18080, metodo: 'GET', ruta: '/healthz', host: HOST_N8N }).then((r) => r.estado === 200), 60000, 'Traefik con registro CLF');
  const diag = await esperarRegla(cred, 'cargada', 20000);
  const { abiertas, bloqueadas } = sondasClf(ip);
  const ejeInicial = contarEjecuciones();
  let eje0 = ejeInicial;   // las rutas públicas legítimas (abiertas) EJECUTAN su workflow y es normal que dejen ejecuciones: el «0» se exige solo alrededor de las sondas BLOQUEADAS
  const enviadas = [];
  for (const celda of [...abiertas, ...bloqueadas]) {
    if (celda === bloqueadas[0]) { await dormir(1200); eje0 = contarEjecuciones(); }
    const idPrueba = nuevoId();
    const cab = { ...(celda.credencial ? { [CABECERA_CANARIO]: cred } : {}), ...(celda.cabeceras ?? {}) };
    const r = await peticionCruda({ puerto: PUERTOS[celda.entrada], metodo: celda.metodo, ruta: `${celda.ruta}${celda.ruta.includes('?') ? '&' : '?'}tai=${idPrueba}`, host: HOST_N8N, cabeceras: cab, cuerpo: celda.metodo === 'POST' ? '{}' : '' });
    enviadas.push({ celda: { ...celda, host: HOST_N8N }, idPrueba, r });
  }
  await dormir(1500); const eje1 = contarEjecuciones();
  let mapa = new Map();
  const visto = await hasta(() => { mapa = indexarClf(docker('logs', 'tai-tf-traefik')); return enviadas.filter((e) => e.celda.esperaEstado).every((e) => mapa.has(e.idPrueba)); }, 15000);
  const lineasCrudas = docker('logs', 'tai-tf-traefik').split('\n').filter((l) => /[?&]tai=/.test(l));
  const celdas = enviadas.map(({ celda, idPrueba, r }) => { const p = mapa.get(idPrueba) ?? null; const ev = celda.esperaEstado ? evaluarClfAbierta(celda, r, p) : evaluarClfBloqueada(celda, r, p); return { ...ev, estado: r.estado ?? null, clasificacion: clasificarRespuesta(r), tipo: celda.esperaEstado ? 'abierta' : 'bloqueada' }; });
  const resultado = { traefikCfg: 'traefik.e0b-clf.yaml (accessLog.format=common)', reglaCargada: diag.s !== null, correlacionPorConsulta: visto !== null, ejecucionesN8nGeneradas: eje1 - eje0, ejecucionesDeLasRutasPublicasLegitimas: eje0 - ejeInicial, celdas, bloqueadasConLinea: celdas.filter((c) => c.tipo === 'bloqueada' && c.linea === 'presente').length, bloqueadasSinLinea: celdas.filter((c) => c.tipo === 'bloqueada' && c.linea === 'ausente').length, muestras: lineasCrudas.slice(0, 40).map(enmascararIp) };
  resultado.ok = decidirClf(resultado);
  // volver al registro JSON (los evaluadores del resto de fases lo necesitan)
  process.env.PRUEBA_TF_TRAEFIK_CFG = './traefik.e0b.yaml';
  compose(envF, 'up', '-d', '--pull', 'never', '--no-deps', '--force-recreate', 'traefik');
  await esperar(() => peticionCruda({ puerto: 18080, metodo: 'GET', ruta: '/healthz', host: HOST_N8N }).then((x) => x.estado === 200), 60000, 'Traefik de nuevo con registro JSON');
  const diag2 = await esperarRegla(cred, 'cargada', 20000);
  resultado.regla_tras_volver_a_json = diag2.s !== null;
  if (diag2.s === null) resultado.ok = false;
  return resultado;
}

// ───────────── Verificación complementaria del evaluador CLF (modo `verificar-clf`; 16/11/2026) ─────────────
// Objetivo: demostrar, con el evaluador YA corregido, que (1) las peticiones bloqueadas no generan ejecuciones del canario, (2) las 2 ejecuciones observadas en E0b son las del webhook público legítimo, (3) el evaluador distingue
// ambos grupos, (4) los centinelas aparecen en el CLF, (5) la regla no cambia y (6) los tres contenedores locales preexistentes no se tocan. NO modifica el `informe.json` original: escribe su propio informe.
const INFORME_E0B_ORIGINAL = process.env.TAI_INFORME_E0B_ORIGINAL ?? 'D:/treidilor-pruebas/prueba-traefik/resultados-1794840770557/informe.json';
const HASH_INFORME_E0B_ORIGINAL = '453b771ac30fc0e1554d49a580bc1808c21da431394c80c2052201c6df49c048';
const sha256Archivo = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const psql = (sql) => docker('exec', 'tai-tf-db', 'psql', '-U', 'n8n_prueba', '-d', 'n8n_prueba', '-tA', '-F', '|', '-c', sql).trim();
const maxEjecucion = () => Number(psql('select coalesce(max(id),0) from execution_entity'));
/** Ejecuciones NUEVAS (id > `id`) con el nodo «Recibir (...)» que las disparó; `null` si n8n no permite consultarlo (entonces se decide por el contador de cada sonda). */
function ejecucionesDesde(id) {
  try {
    const filas = psql(`select e.id, coalesce(position('Recibir (publico)' in d.data) > 0, false), coalesce(position('Recibir (abierto)' in d.data) > 0, false), coalesce(position('Recibir (canario)' in d.data) > 0, false) from execution_entity e left join execution_data d on d."executionId" = e.id where e.id > ${Number(id)} order by e.id`);
    return filas ? filas.split('\n').map((l) => { const [i, p, a, c] = l.split('|'); return { id: Number(i), nodo: p === 't' ? 'publico' : a === 't' ? 'abierto' : c === 't' ? 'canario' : 'desconocido' }; }) : [];
  } catch { return null; }
}
/** n8n guarda la ejecución al terminar el flujo (puede ser después de responder): se espera a que el contador deje de cambiar. */
async function estabilizarEjecuciones() {
  await dormir(1200);
  let previo = contarEjecuciones(); let iguales = 0;
  for (let i = 0; i < 12 && iguales < 2; i++) { await dormir(400); const n = contarEjecuciones(); iguales = n === previo ? iguales + 1 : 0; previo = n; }
  return previo;
}
/** UNA sonda con su ventana de ejecuciones propia (antes/después) para poder atribuir cada ejecución a la sonda que la causó. */
async function sondaConEjecuciones(celda, cred) {
  await estabilizarEjecuciones();
  const antesId = maxEjecucion(); const antesN = contarEjecuciones();
  const idPrueba = nuevoId();
  const cab = { ...(celda.credencial ? { [CABECERA_CANARIO]: cred } : {}), ...(celda.cabeceras ?? {}) };
  const r = await peticionCruda({ puerto: PUERTOS[celda.entrada], metodo: celda.metodo, ruta: `${celda.ruta}${celda.ruta.includes('?') ? '&' : '?'}tai=${idPrueba}`, host: HOST_N8N, cabeceras: cab, cuerpo: celda.metodo === 'POST' ? '{}' : '' });
  const despN = await estabilizarEjecuciones();
  const nuevas = ejecucionesDesde(antesId);
  return { celda: { ...celda, host: HOST_N8N }, idPrueba, r, delta: despN - antesN, nodos: nuevas ? nuevas.map((x) => x.nodo) : null };
}

async function verificarClf() {
  const destino = iniciarOperacionConEfectos();   // autorización + destino Docker verificados ANTES de cualquier otra operación
  for (const i of [...IMAGENES_LOCALES, IMAGEN_TRAEFIK]) { try { docker('image', 'inspect', i); } catch { throw new Error(`Falta la imagen local ${i} (esta orden NUNCA descarga)`); } }
  const antes = estadoDocker();
  if (Object.values(antes.existentes).some((v) => v === 'AUSENTE')) throw new Error('Falta alguno de los tres contenedores locales existentes: se aborta');
  if (antes.proyecto.contenedores.length || antes.proyecto.redes.length || antes.proyecto.volumenes.length) throw new Error('Quedan recursos de tai-prueba-tf de una ejecución anterior: ejecuta «limpiar» primero');
  const reglaArchivo = path.join(DIR_PRUEBA, 'config-candidata', 'custom.yaml');
  const hashReglaAntes = sha256Archivo(reglaArchivo);
  if (hashReglaAntes !== HASH_REGLA_VALIDADA) throw new Error('La regla candidata NO coincide con la validada (2f9c5b1b…): se aborta sin arrancar nada');
  if (!fs.existsSync(INFORME_E0B_ORIGINAL)) throw new Error(`No existe el informe.json original de E0b (${INFORME_E0B_ORIGINAL}): se aborta`);
  const hashInformeAntes = sha256Archivo(INFORME_E0B_ORIGINAL);
  if (hashInformeAntes !== HASH_INFORME_E0B_ORIGINAL) throw new Error('El informe.json original de E0b NO tiene el SHA-256 esperado (453b771a…): se aborta');
  process.env.PRUEBA_TF_TRAEFIK_CFG = './traefik.e0b-clf.yaml';   // insecure=true + registro CLF desde el principio
  const envF = preparar();
  const informe = { inicio: new Date().toISOString(), modo: 'Verificación complementaria del evaluador CLF (E0b)', traefik: IMAGEN_TRAEFIK, dockerAntes: antes, fases: {}, notas: [] };
  const cred = crypto.randomBytes(24).toString('hex');
  const sondas = []; let reproduccion = null; let hashEnVolumen = null; let lineasClf = [];
  informe.destinoDocker = destino;
  instalarSenales();
  marcarEjecucion('verificar-clf');   // si falla (marca existente o disco), se aborta SIN crear nada y sin limpiar nada ajeno
  ESTADO.creado = true;               // a partir de aquí lo que exista de `tai-prueba-tf` lo ha creado ESTA ejecución
  try {
    compose(envF, 'up', '-d', '--pull', 'never', 'db', 'n8n', 'cliente-interno', 'config-escritor');
    await esperar(() => docker('inspect', '-f', '{{.State.Health.Status}}', 'tai-tf-n8n').trim() === 'healthy', 240000, 'n8n sano');
    escribirCfg('main.yaml', leerBase('config-base/main.yaml'));
    const subred = docker('network', 'inspect', 'tai-tf-aislada', '--format', '{{range .IPAM.Config}}{{.Subnet}}{{end}}').trim();
    await prepararN8n(cred, subred);
    compose(envF, 'up', '-d', '--pull', 'never', 'traefik');
    await esperar(() => peticionCruda({ puerto: 18080, metodo: 'GET', ruta: '/healthz', host: HOST_N8N }).then((r) => r.estado === 200), 60000, 'n8n por Traefik');
    const ip = ipDe('tai-tf-n8n');
    const { abiertas, bloqueadas } = sondasClf(ip);
    const centinelas = (tag) => abiertas.filter((c) => /centinela/.test(c.id)).map((c) => ({ ...c, id: `${tag}|${c.id}` }));
    const publicas = abiertas.filter((c) => c.grupo === 'publica').map((c) => ({ ...c, id: `v3|${c.id}` }));
    const otrasAbiertas = abiertas.filter((c) => c.grupo === 'sin-ejecucion' && !/centinela/.test(c.id)).map((c) => ({ ...c, id: `v3|${c.id}` }));

    // ── Fase 0 · SIN regla · CONTROL POSITIVO del contador: una petición que SÍ debe ejecutar el canario y otra que SÍ debe ejecutar el webhook público ──
    const prev = await esperarRegla(cred, 'ausente', 15000);
    if (prev.s === null) throw new Error(`Antes de la fase 0 la regla debía estar AUSENTE (diagnóstico «${prev.diag?.estado}»)`);
    await estabilizarEjecuciones();
    sondas.push(await sondaConEjecuciones({ id: 'v0|control-contador|canario-abierto', grupo: 'control-canario', metodo: 'POST', ruta: `/webhook/${RUTA_CANARIO}-abierto`, entrada: 'http', credencial: true, esperaEstado: [200] }, cred));
    sondas.push(await sondaConEjecuciones({ id: 'v0|control-contador|webhook-publico', grupo: 'publica', metodo: 'POST', ruta: `/webhook/${RUTA_PUBLICA_CONTROL}`, entrada: 'http', credencial: false, esperaEstado: [200] }, cred));
    mostrar('V0 · control positivo del contador (canario / público)', `${sondas[0].delta} / ${sondas[1].delta} ejecuciones (esperado 1 / 1) · nodos ${JSON.stringify(sondas[0].nodos)} / ${JSON.stringify(sondas[1].nodos)}`);

    // ── Fase 1 · se carga la regla VALIDADA (escrita desde el archivo cuyo hash se comprobó) ──
    escribirCfg('custom.yaml', leerBase('config-candidata/custom.yaml'));
    const w1 = await esperarRegla(cred, 'cargada');
    if (w1.s === null) throw new Error(`Traefik no cargó custom.yaml (diagnóstico: ${w1.diag?.estado})`);
    hashEnVolumen = instantaneaCfg()['custom.yaml']?.sha256 ?? null;
    mostrar('V1 · regla cargada (s) / hash en el volumen = validado', `${w1.s} / ${hashEnVolumen === HASH_REGLA_VALIDADA}`);

    // ── Fase 2 · centinelas, TODAS las bloqueadas (cada una con su ventana de ejecuciones) y centinelas de cierre ──
    for (const c of centinelas('v2a')) sondas.push(await sondaConEjecuciones(c, cred));
    for (const c of bloqueadas) sondas.push(await sondaConEjecuciones({ ...c, id: `v2|${c.id}` }, cred));
    for (const c of centinelas('v2b')) sondas.push(await sondaConEjecuciones(c, cred));
    mostrar('V2 · bloqueadas: ejecuciones nuevas (esperado 0)', String(sondas.filter((s) => s.celda.grupo === 'bloqueada').reduce((a, s) => a + s.delta, 0)));

    // ── Fase 3 · rutas legítimas: el webhook público EJECUTA (1 por sonda); healthz, interfaz y ruta ajena no ──
    for (const c of [...publicas, ...otrasAbiertas]) sondas.push(await sondaConEjecuciones(c, cred));
    mostrar('V3 · webhook público: ejecuciones nuevas (esperado 2)', String(sondas.filter((s) => s.celda.id.startsWith('v3|') && s.celda.grupo === 'publica').reduce((a, s) => a + s.delta, 0)));

    // CLF de las fases 0-3: se captura ANTES de que la fase 4 recree Traefik
    let mapa = new Map();
    const visto = await hasta(() => { mapa = indexarClf(docker('logs', 'tai-tf-traefik')); return sondas.filter((s) => s.celda.esperaEstado).every((s) => mapa.has(s.idPrueba)); }, 15000);
    lineasClf = docker('logs', 'tai-tf-traefik').split('\n').filter((l) => /[?&]tai=/.test(l)).map(enmascararIp);
    informe.fases.clfFases0a3 = { correlacionPorConsulta: visto !== null, lineas: lineasClf.length };
    informe.sondas = sondas.map(({ celda, idPrueba, r, delta, nodos }) => {
      const p = mapa.get(idPrueba) ?? null;
      const evClf = celda.esperaEstado ? evaluarClfAbierta(celda, r, p) : evaluarClfBloqueada(celda, r, p);
      const evEj = evaluarSondaEjecuciones({ grupo: celda.grupo, delta, nodos });
      return { id: celda.id, grupo: celda.grupo, metodo: celda.metodo, ruta: celda.ruta, entrada: celda.entrada, estado: r.estado ?? null, clasificacion: clasificarRespuesta(r), delta, nodos, atribucion: evEj.atribucion, linea: evClf.linea, router: evClf.router, servidor: evClf.servidor, estadoClf: evClf.estadoClf, ok: evClf.ok && evEj.ok, motivos: [...evClf.motivos, ...evEj.motivos] };
    });

    // ── Fase 4 · la SECUENCIA ORIGINAL de E0b con el evaluador corregido (`faseClf`: abiertas + bloqueadas en un solo pase) ──
    reproduccion = await faseClf(envF, cred, ip);
    mostrar('V4 · faseClf (evaluador corregido): ok / ejecuciones tras bloqueadas / de rutas públicas', `${reproduccion.ok} / ${reproduccion.ejecucionesN8nGeneradas} / ${reproduccion.ejecucionesDeLasRutasPublicasLegitimas}`);
    informe.fases.reproduccionFaseClf = reproduccion;
  } catch (e) { informe.error = String(e.message).slice(0, 500); mostrar('ERROR', informe.error); process.exitCode = 1; }
  finally {
    ESTADO.finalizando = true;
    const dir = path.join(TRABAJO, `resultados-clf-${Date.now()}`);
    let dirOk = false;
    try { fs.mkdirSync(dir, { recursive: true }); dirOk = true; } catch (e) { informe.notas.push(`no se pudo crear el directorio de resultados (${e.code ?? e.message})`); mostrar('ERROR al crear el directorio de resultados', String(e.code ?? e.message)); process.exitCode = 1; }
    if (dirOk) for (const [c, f] of [['tai-tf-traefik', 'traefik.log'], ['tai-tf-n8n', 'n8n.log']]) { try { fs.writeFileSync(path.join(dir, f), docker('logs', c)); } catch { /* puede no existir */ } }
    limpiezaUnica();   // SIEMPRE se intenta, aunque no se hayan podido guardar los resultados
    let despues = null;
    try { despues = estadoDocker(); } catch (e) { informe.notas.push(`no se pudo leer el estado de Docker al final: ${String(e.message).slice(0, 100)}`); }
    const hashSeguro = (f) => { try { return sha256Archivo(f); } catch { return null; } };
    const hashReglaDespues = hashSeguro(reglaArchivo);
    const hashInformeDespues = hashSeguro(INFORME_E0B_ORIGINAL);
    const existentesIntactos = despues ? CONTENEDORES_EXISTENTES.every((n) => despues.existentes[n] === antes.existentes[n]) : false;
    const proyectoLimpio = despues ? !despues.proyecto.contenedores.length && !despues.proyecto.redes.length && !despues.proyecto.volumenes.length : false;
    const veredicto = veredictoVerificacionClf({ sondas: informe.sondas ?? [], reproduccion: reproduccion ?? {}, regla: { hashAntes: hashReglaAntes, hashDespues: hashReglaDespues, hashEnVolumen }, informeOriginal: { esperado: HASH_INFORME_E0B_ORIGINAL, antes: hashInformeAntes, despues: hashInformeDespues }, existentesIntactos, proyectoLimpio, contexto: despues?.contexto ?? null });
    informe.fin = new Date().toISOString();
    informe.complementario = { reglaSha256: { antes: hashReglaAntes, despues: hashReglaDespues, enVolumen: hashEnVolumen, validado: HASH_REGLA_VALIDADA }, informeOriginalE0b: { ruta: INFORME_E0B_ORIGINAL, sha256Antes: hashInformeAntes, sha256Despues: hashInformeDespues, esperado: HASH_INFORME_E0B_ORIGINAL }, existentesAntes: antes.existentes, existentesDespues: despues?.existentes ?? null, existentesIntactos, proyectoLimpio, lineasClfFases0a3: lineasClf.slice(0, 60) };
    informe.veredicto = veredicto.ok ? 'VERIFICACIÓN CLF SUPERADA (no declara por sí sola E0b validada)' : 'VERIFICACIÓN CLF NO SUPERADA';
    informe.fallos = veredicto.fallos;
    if (dirOk) { try { fs.writeFileSync(path.join(dir, 'informe-clf.json'), JSON.stringify(informe, null, 1)); mostrar('resultados (informe complementario) en', dir); } catch (e) { mostrar('ERROR al guardar el informe', String(e.code ?? e.message)); process.exitCode = 1; } }
    mostrar('RESULTADO', informe.veredicto);
    for (const f of veredicto.fallos) mostrar('  ✖', f.slice(0, 230));
    mostrar('regla sin modificar / informe original intacto / existentes intactos / proyecto limpio', `${hashReglaDespues === HASH_REGLA_VALIDADA} / ${hashInformeDespues === HASH_INFORME_E0B_ORIGINAL} / ${existentesIntactos} / ${proyectoLimpio}`);
    if (!veredicto.ok) process.exitCode = 1;
  }
}

// ───────────── Fase TLS (modo `tls`; 17/11/2026) ─────────────
// Objetivo: demostrar con TLS REAL (Traefik 3.6.7, certificado autogenerado) la diferencia entre la regla ORIGINAL (router sin `tls`, que no atiende conexiones TLS: lo que pasó en el VPS) y el candidato
// `tai-bloqueo-lector-tls.yaml` (router http + router https con `tls: {}`). Matriz REDUCIDA (no repite E0b). Escribe su propio informe; nunca toca custom.yaml ni los resultados anteriores.
//   T0 base sin regla · T1 regla ANTIGUA (https NO se bloquea, http sí: reproduce E2) · T2 candidato (bloqueo por TLS, SNI/Host/h2, controles, negativos, http con redirección)
//   T3 reversión (se retira el candidato y todo vuelve a la línea base) · T4 variante con la redirección en el ENTRYPOINT (consecuencia documentada).
const claseAbierto = async (cred, entrada) => clasificarRespuesta(await enviar({ puerto: PUERTOS[entrada], metodo: 'POST', ruta: `/webhook/${RUTA_CANARIO}-abierto`, host: HOST_N8N, cabeceras: { [CABECERA_CANARIO]: cred }, cuerpo: '{}', sni: HOST_N8N }));
/** Espera (≥3 sondeos seguidos) a que el canario abierto de esa entrada responda con la clase pedida. Devuelve los segundos o null. */
async function esperarClaseAbierto(cred, entrada, clase, maxMs = 40000) {
  const t0 = Date.now(); let seguidos = 0;
  while (Date.now() - t0 < maxMs) { seguidos = (await claseAbierto(cred, entrada)) === clase ? seguidos + 1 : 0; if (seguidos >= 3) return Math.round((Date.now() - t0) / 100) / 10; await dormir(500); }
  return null;
}
async function verificarTls() {
  const destino = iniciarOperacionConEfectos();   // autorización + destino Docker verificados ANTES de cualquier otra operación
  for (const i of [...IMAGENES_LOCALES, IMAGEN_TRAEFIK]) { try { docker('image', 'inspect', i); } catch { throw new Error(`Falta la imagen local ${i} (esta orden NUNCA descarga)`); } }
  const antes = estadoDocker();
  if (Object.values(antes.existentes).some((v) => v === 'AUSENTE')) throw new Error('Falta alguno de los tres contenedores locales existentes: se aborta');
  if (antes.proyecto.contenedores.length || antes.proyecto.redes.length || antes.proyecto.volumenes.length) throw new Error('Quedan recursos de tai-prueba-tf de una ejecución anterior: ejecuta «limpiar» primero');
  const reglaOriginal = path.join(DIR_PRUEBA, 'config-candidata', 'custom.yaml');
  const archivoCandidata = path.join(DIR_PRUEBA, 'config-candidata', ARCHIVO_CANDIDATA_TLS);
  const hashOriginalAntes = sha256Archivo(reglaOriginal);
  if (hashOriginalAntes !== HASH_REGLA_VALIDADA) throw new Error('La regla ORIGINAL no coincide con la validada (2f9c5b1b…): se aborta sin arrancar nada');
  const hashCandidata = sha256Archivo(archivoCandidata);
  if (hashCandidata !== HASH_CANDIDATA_TLS) throw new Error('El candidato TLS no coincide con el hash fijado: se aborta sin arrancar nada');
  process.env.PRUEBA_TF_TRAEFIK_CFG = './traefik.tls.yaml';
  const envF = preparar();
  const informe = { inicio: new Date().toISOString(), modo: 'Fase TLS: regla original frente al candidato con router https + tls', traefik: IMAGEN_TRAEFIK, dockerAntes: antes, fases: {}, notas: [], destinoDocker: destino };
  const cred = crypto.randomBytes(24).toString('hex');
  const R = { base: [], antiguoHttps: [], antiguoHttp: [], nuevoBloqueo: [], nuevoSniH2: [], nuevoControles: [], nuevoNegativos: [], nuevoHttpControles: [], reversion: {}, redirEntrypoint: null };
  let candidataEnVolumen = null; let cfgInicial = null;
  const celdas = matrizTls();
  const decisivas = celdas.filter((c) => c.decisiva); const httpDecisiva = celdas.filter((c) => c.decisivaHttp);
  const ambas = celdas.filter((c) => c.fase === 'ambas'); const soloNuevo = celdas.filter((c) => c.fase === 'nuevo');
  const controles = controlesTls();
  instalarSenales();
  marcarEjecucion('tls');
  ESTADO.creado = true;
  MODO_TLS = true;
  try {
    compose(envF, 'up', '-d', '--pull', 'never', 'db', 'n8n', 'cliente-interno', 'config-escritor');
    await esperar(() => docker('inspect', '-f', '{{.State.Health.Status}}', 'tai-tf-n8n').trim() === 'healthy', 240000, 'n8n sano');
    escribirCfg('main.yaml', leerBase('config-base-tls/main.yaml'));
    const subred = docker('network', 'inspect', 'tai-tf-aislada', '--format', '{{range .IPAM.Config}}{{.Subnet}}{{end}}').trim();
    await prepararN8n(cred, subred);
    compose(envF, 'up', '-d', '--pull', 'never', 'traefik');
    await esperar(() => enviar({ puerto: PUERTOS.https, metodo: 'GET', ruta: '/healthz', host: HOST_N8N }).then((r) => r.estado === 200), 60000, 'n8n por Traefik con TLS real');
    cfgInicial = instantaneaCfg();

    // ── T0 · base SIN regla: por https se alcanza el canario abierto ──
    R.base = (await correrLote(decisivas, cred, evaluarAntiguoNoBloquea)).celdas;
    mostrar('T0 · base sin regla: https alcanza n8n', `${R.base.filter((c) => c.ok).length}/${R.base.length}`);

    // ── T1 · regla ORIGINAL (sin tls): reproduce E2 → por https NO bloquea, por http sí ──
    escribirCfg('custom.yaml', leerBase('config-candidata/custom.yaml'));
    const w1 = await esperarClaseAbierto(cred, 'http', 'traefik:403');
    if (w1 === null) throw new Error('La regla original no llegó a bloquear ni siquiera por http: no se puede interpretar la fase T1');
    R.antiguoHttps = (await correrLote(decisivas, cred, evaluarAntiguoNoBloquea)).celdas;
    R.antiguoHttp = (await correrLote(httpDecisiva, cred, evaluarExterior)).celdas;
    mostrar('T1 · regla ANTIGUA: https llega a n8n (reproduce E2) / http bloqueada', `${R.antiguoHttps.filter((c) => c.ok).length}/${R.antiguoHttps.length} / ${R.antiguoHttp.filter((c) => c.ok).length}/${R.antiguoHttp.length}`);
    quitarCfg('custom.yaml');
    if (await esperarClaseAbierto(cred, 'http', 'otra:308') === null) throw new Error('Tras retirar la regla original el http no vuelve a redirigirse (la base redirige http a https)');

    // ── T2 · candidato ──
    escribirCfg(ARCHIVO_CANDIDATA_TLS, leerBase(`config-candidata/${ARCHIVO_CANDIDATA_TLS}`));
    const w2 = await esperarClaseAbierto(cred, 'https', 'traefik:403');
    candidataEnVolumen = instantaneaCfg()[ARCHIVO_CANDIDATA_TLS]?.sha256 ?? null;
    if (w2 === null) throw new Error('El candidato no bloqueó el canario abierto por https tras 40 s: no se interpreta el resto');
    R.nuevoBloqueo = (await correrLote(ambas, cred, evaluarExterior)).celdas;
    R.nuevoSniH2 = (await correrLote(soloNuevo, cred, evaluarExterior)).celdas;
    R.nuevoControles = (await correrLote(controles.https, cred, evaluarControl)).celdas;
    R.nuevoNegativos = (await correrLote(controles.negativos, cred, evaluarControlNegativo)).celdas;
    R.nuevoHttpControles = (await correrLote(controles.http, cred, evaluarRedireccion)).celdas;
    mostrar('T2 · candidato cargado (s) / hash en el volumen = fijado', `${w2} / ${candidataEnVolumen === HASH_CANDIDATA_TLS}`);
    mostrar('T2 · bloqueo / SNI-Host-h2 / controles / negativos / http-redirección', [R.nuevoBloqueo, R.nuevoSniH2, R.nuevoControles, R.nuevoNegativos, R.nuevoHttpControles].map((l) => `${l.filter((c) => c.ok).length}/${l.length}`).join(' · '));
    informe.fases.t2 = { bloqueoPorTls: R.nuevoBloqueo, sniHostH2: R.nuevoSniH2 };

    // ── T3 · reversión ──
    quitarCfg(ARCHIVO_CANDIDATA_TLS);
    R.reversion.restaurado = (await esperarClaseAbierto(cred, 'https', 'canario-alcanzado')) !== null;
    const cfgFinal = instantaneaCfg();
    R.reversion.cfgIgualAlInicio = JSON.stringify(Object.keys(cfgFinal)) === JSON.stringify(['main.yaml']) && cfgFinal['main.yaml']?.sha256 === cfgInicial['main.yaml']?.sha256;
    mostrar('T3 · reversión: https vuelve a n8n / configuración idéntica a la inicial', `${R.reversion.restaurado} / ${R.reversion.cfgIgualAlInicio}`);

    // ── T4 · redirección en el ENTRYPOINT (solo Traefik se recrea; mismo volumen de configuración) ──
    process.env.PRUEBA_TF_TRAEFIK_CFG = './traefik.tls-redir.yaml';
    compose(envF, 'up', '-d', '--pull', 'never', '--no-deps', '--force-recreate', 'traefik');
    await esperar(() => enviar({ puerto: PUERTOS.https, metodo: 'GET', ruta: '/healthz', host: HOST_N8N }).then((r) => r.estado === 200), 60000, 'Traefik con la redirección del entrypoint');
    escribirCfg(ARCHIVO_CANDIDATA_TLS, leerBase(`config-candidata/${ARCHIVO_CANDIDATA_TLS}`));
    if (await esperarClaseAbierto(cred, 'https', 'traefik:403') === null) throw new Error('T4: el candidato no bloqueó por https con la redirección del entrypoint');
    const rutaT4 = `/webhook/${RUTA_CANARIO}-abierto`;
    const http = await peticionCruda({ puerto: PUERTOS.http, metodo: 'POST', ruta: rutaT4, host: HOST_N8N, cabeceras: { [CABECERA_CANARIO]: cred }, cuerpo: '{}' });
    const https = await enviar({ puerto: PUERTOS.https, metodo: 'POST', ruta: rutaT4, host: HOST_N8N, cabeceras: { [CABECERA_CANARIO]: cred }, cuerpo: '{}', sni: HOST_N8N });
    R.redirEntrypoint = { ...evaluarRedirEntrypoint({ http, https }), http: { estado: http.estado ?? null, location: String(http.cabeceras?.location ?? '').slice(0, 120) }, httpsTrasRedireccion: clasificarRespuesta(https) };
    mostrar('T4 · redirección en el entrypoint: http → 3xx a https y https bloqueado', `${R.redirEntrypoint.ok} (${R.redirEntrypoint.http.estado})`);
    quitarCfg(ARCHIVO_CANDIDATA_TLS);
    informe.fases.resumen = { base: R.base.length, antiguoHttps: R.antiguoHttps.length };
  } catch (e) { informe.error = String(e.message).slice(0, 500); mostrar('ERROR', informe.error); process.exitCode = 1; }
  finally {
    ESTADO.finalizando = true;
    MODO_TLS = false;
    const dir = path.join(TRABAJO, `resultados-tls-${Date.now()}`);
    let dirOk = false;
    try { fs.mkdirSync(dir, { recursive: true }); dirOk = true; } catch (e) { informe.notas.push(`no se pudo crear el directorio de resultados (${e.code ?? e.message})`); mostrar('ERROR al crear el directorio de resultados', String(e.code ?? e.message)); process.exitCode = 1; }
    if (dirOk) for (const [c, f] of [['tai-tf-traefik', 'traefik.log'], ['tai-tf-n8n', 'n8n.log']]) { try { fs.writeFileSync(path.join(dir, f), docker('logs', c)); } catch { /* puede no existir */ } }
    limpiezaUnica();   // SIEMPRE se intenta, aunque no se hayan podido guardar los resultados
    let despues = null;
    try { despues = estadoDocker(); } catch (e) { informe.notas.push(`no se pudo leer el estado de Docker al final: ${String(e.message).slice(0, 100)}`); }
    const hashSeguro = (f) => { try { return sha256Archivo(f); } catch { return null; } };
    const existentesIntactos = despues ? CONTENEDORES_EXISTENTES.every((n) => despues.existentes[n] === antes.existentes[n]) : false;
    const proyectoLimpio = despues ? !despues.proyecto.contenedores.length && !despues.proyecto.redes.length && !despues.proyecto.volumenes.length : false;
    const veredicto = veredictoTls({ ...R, hashes: { original: hashOriginalAntes, originalDespues: hashSeguro(reglaOriginal), candidata: hashSeguro(archivoCandidata), candidataEnVolumen }, existentesIntactos, proyectoLimpio, contexto: despues?.contexto ?? null });
    informe.fin = new Date().toISOString();
    informe.resultados = R;
    informe.complementario = { reglaOriginalSha256: hashOriginalAntes, candidataSha256: hashCandidata, existentesAntes: antes.existentes, existentesDespues: despues?.existentes ?? null, existentesIntactos, proyectoLimpio };
    informe.veredicto = veredicto.ok ? 'FASE TLS SUPERADA (valida el candidato en local; no sustituye a las pruebas del VPS ni a E3)' : 'FASE TLS NO SUPERADA';
    informe.fallos = veredicto.fallos;
    if (dirOk) { try { fs.writeFileSync(path.join(dir, 'informe-tls.json'), JSON.stringify(informe, null, 1)); mostrar('resultados (informe TLS) en', dir); } catch (e) { mostrar('ERROR al guardar el informe', String(e.code ?? e.message)); process.exitCode = 1; } }
    mostrar('RESULTADO', informe.veredicto);
    for (const f of veredicto.fallos) mostrar('  ✖', f.slice(0, 230));
    mostrar('regla original intacta / existentes intactos / proyecto limpio', `${hashSeguro(reglaOriginal) === HASH_REGLA_VALIDADA} / ${existentesIntactos} / ${proyectoLimpio}`);
    if (!veredicto.ok) process.exitCode = 1;
  }
}

async function ejecutar(opciones = {}) {
  const destino = iniciarOperacionConEfectos();   // autorización + destino Docker verificados ANTES de cualquier otra operación
  const e0b = Boolean(opciones.e0b);
  if (e0b) process.env.PRUEBA_TF_TRAEFIK_CFG = './traefik.e0b.yaml';
  for (const i of [...IMAGENES_LOCALES, IMAGEN_TRAEFIK]) { try { docker('image', 'inspect', i); } catch { throw new Error(`Falta la imagen local ${i} (esta orden NUNCA descarga: usa «descargar» con autorización)`); } }
  const antes = estadoDocker();
  if (Object.values(antes.existentes).some((v) => v === 'AUSENTE')) throw new Error('Falta alguno de los tres contenedores locales existentes: se aborta');
  if (antes.proyecto.contenedores.length || antes.proyecto.redes.length || antes.proyecto.volumenes.length) throw new Error('Quedan recursos de tai-prueba-tf de una ejecución anterior: ejecuta «limpiar» primero');
  const envF = preparar();
  const informe = { inicio: new Date().toISOString(), traefik: IMAGEN_TRAEFIK, modo: e0b ? 'E0b (forwardedHeaders.insecure=true)' : 'normal', dockerAntes: antes, fases: {}, vigilancia: {}, configuracionActiva: {}, notas: [], ...(e0b ? { e0b: {} } : {}) };
  let ipN8n = null;
  const cred = crypto.randomBytes(24).toString('hex');
  const ext = matrizExterior(); const ctl = matrizControles(); const abierto = matrizAbierto(); const cod = matrizCodificada();
  const candidata = leerBase('config-candidata/custom.yaml');
  const principal_ = leerBase('config-base/main.yaml');
  let fuga = false; let ejeW0 = null; let ejeW1 = null; // ejeW*: ejecuciones de n8n alrededor del lote bloqueado tras regenerar main.yaml (se declaran aquí para que el informe agregado las vea)
  informe.destinoDocker = destino;
  instalarSenales();
  marcarEjecucion(e0b ? 'e0b' : 'ejecutar');   // si falla (marca existente o disco), se aborta SIN crear nada y sin limpiar nada ajeno
  ESTADO.creado = true;                        // a partir de aquí lo que exista de `tai-prueba-tf` lo ha creado ESTA ejecución
  try {
    compose(envF, 'up', '-d', '--pull', 'never', 'db', 'n8n', 'cliente-interno', 'config-escritor', ...(e0b ? ['eco'] : []));
    await esperar(() => docker('inspect', '-f', '{{.State.Health.Status}}', 'tai-tf-n8n').trim() === 'healthy', 240000, 'n8n sano');
    escribirCfg('main.yaml', principal_);
    if (e0b) escribirCfg('eco.yaml', ECO_YAML);
    const subred = docker('network', 'inspect', 'tai-tf-aislada', '--format', '{{range .IPAM.Config}}{{.Subnet}}{{end}}').trim();
    mostrar('subred de la red interna (lista de IP del canario)', subred);
    await prepararN8n(cred, subred);
    compose(envF, 'up', '-d', '--pull', 'never', 'traefik');
    await esperar(() => peticionCruda({ puerto: 18080, metodo: 'GET', ruta: '/healthz', host: HOST_N8N }).then((r) => r.estado === 200), 60000, 'n8n por Traefik');
    if (e0b) {
      ipN8n = ipDe('tai-tf-n8n');
      const logIni = docker('logs', 'tai-tf-traefik').replace(/\x1b\[[0-9;]*m/g, '');
      informe.e0b.imagenTraefik = docker('image', 'inspect', IMAGEN_TRAEFIK, '--format', '{{.Id}}').trim();
      informe.e0b.configEstatica = { archivo: 'traefik.e0b.yaml', insecureEnElRegistroDeArranque: (logIni.match(/"insecure":true/g) ?? []).length, ipInternaUsadaEnLasVariantes: ipN8n };
      await esperar(() => peticionCruda({ puerto: 18080, metodo: 'GET', ruta: '/', host: HOST_ECO }).then((r) => r.estado === 200), 60000, 'eco por Traefik');
      informe.e0b.eco = await ecoPrueba(ipN8n);
      mostrar('E0b · ¿Traefik reenvía la X-Forwarded-For falsa del cliente? (insecure=true efectivo)', `${informe.e0b.eco.conservaLaCabeceraDelCliente} · recibido por el origen: «${informe.e0b.eco.xffRecibidoConXffFalso}»`);
      mostrar('E0b · ¿añade la IP real del par al final?', String(informe.e0b.eco.anadeLaIpRealAlFinal));
      if (!informe.e0b.eco.conservaLaCabeceraDelCliente) throw new Error('E0b: el control del eco indica que insecure=true NO está activo (Traefik no reenvía la cabecera del cliente): la prueba no sería la prevista');
    }

    // ── Fase A: SIN regla. 68 celdas de la matriz + 2 celdas ADICIONALES del canario abierto (se cuentan aparte) ──
    const previoA = await esperarRegla(cred, 'ausente', 15000);
    informe.fases.A_previa = previoA.diag; if (previoA.s === null) throw new Error(`Antes de la fase A la regla debía estar AUSENTE y el diagnóstico es «${previoA.diag?.estado}»`);
    informe.fases.HEAD_aislada_sin_regla = await pruebaHeadAislada(cred, false);
    mostrar('HEAD aislada · sin regla: el evaluador lo declara NO bloqueado', `${informe.fases.HEAD_aislada_sin_regla.evaluadoComoBloqueado === false} (estado ${informe.fases.HEAD_aislada_sin_regla.estado}, router ${informe.fases.HEAD_aislada_sin_regla.router}, origen ${informe.fases.HEAD_aislada_sin_regla.originStatus})`);
    const neg = matrizControlesNegativos();
    const Aneg = await correrLote(neg, cred, evaluarControlNegativo);
    const eje0 = contarEjecuciones();
    const A = await correrLote(ext, cred, evaluarExterior);
    const Acod = await correrLote(cod, cred, evaluarExterior);
    const Aab = await correrLote(abierto, cred, evaluarExterior);
    await dormir(1500); const eje1 = contarEjecuciones();
    const excepciones = A.celdas.filter((c) => c.ok);
    informe.fases.A_sin_regla = { controlesNegativos: { ...resumen(Aneg.celdas), celdas: Aneg.celdas, centinelas: Aneg.centinelas }, matriz68: { ...resumen(A.celdas), alcanzanN8n: A.celdas.length - excepciones.length, excepciones, clases: porClase(A.celdas), celdas: A.celdas, centinelas: A.centinelas }, adicionalesCodificadas: { ...resumen(Acod.celdas), alcanzanN8n: Acod.celdas.filter((c) => !c.ok).length, clases: porClase(Acod.celdas), celdas: Acod.celdas, centinelas: Acod.centinelas }, adicionalesCanarioAbierto: { ...resumen(Aab.celdas), celdas: Aab.celdas, alcanzanElCanario: Aab.celdas.filter((c) => c.clasificacion === 'canario-alcanzado').length, ejecucionesN8nGeneradas: eje1 - eje0, centinelas: Aab.centinelas } };
    mostrar('A · controles negativos (rutas ajenas): llegan a n8n', `${resumen(Aneg.celdas).ok}/${Aneg.celdas.length}`);
    mostrar('A · matriz de 68: llegan a n8n / total', `${A.celdas.length - excepciones.length}/${A.celdas.length}`);
    for (const c of excepciones) mostrar(`A ·   excepción ${c.id}`, `${c.estado} ${c.clasificacion}`);
    mostrar('A · adicionales CODIFICADAS (64): llegan a n8n / total', `${Acod.celdas.filter((c) => !c.ok).length}/${Acod.celdas.length}`);
    mostrar('A · adicionales (canario abierto): reciben el JSON / total', `${informe.fases.A_sin_regla.adicionalesCanarioAbierto.alcanzanElCanario}/${Aab.celdas.length} (ejecuciones nuevas en n8n: ${eje1 - eje0})`);

    if (e0b) {
      // Capa 2 (SIN regla): la lista de IP de n8n (la subred interna) frente a una petición EXTERNA con la credencial correcta y cabeceras suplantadas. BYPASS = la lista no protege.
      const C2 = await correrLote(matrizSuplantacionCapa2(ipN8n), cred, (celda, r) => { const c = clasificarCapa2(r); return { ok: c !== 'BYPASS', motivos: c === 'BYPASS' ? ['la lista de IP de n8n dejó pasar una petición externa con cabeceras suplantadas'] : [] }; });
      const c2 = C2.celdas.map((c) => ({ id: c.id, estado: c.estado, resultado: c.ok ? (c.clasificacion === 'n8n:lista-de-IP-deniega' ? 'deniega' : `otro:${c.clasificacion}`) : 'BYPASS' }));
      const interna = [interiorXff(cred, ''), interiorXff(cred, '10.99.99.99'), interiorXff(cred, ipN8n)];
      informe.e0b.capa2 = { celdas: c2, bypass: c2.filter((c) => c.resultado === 'BYPASS').length, total: c2.length, centinelas: C2.centinelas, llamadasInternasConXff: interna };
      mostrar('E0b · capa 2 (lista de IP de n8n) sin regla: BYPASS / total', `${informe.e0b.capa2.bypass}/${c2.length}`);
      mostrar('E0b · llamada interna con XFF fuera de la lista (¿la elige el llamante?)', `${interna[1].estado} ${interna[1].clase}`);
    }

    // ── W1: creación de custom.yaml con Traefik en marcha (con la prueba previa de que estaba ausente) ──
    escribirCfg('custom.yaml', candidata);
    const w1 = await esperarRegla(cred, 'cargada');
    informe.vigilancia.creacion = { segundos: w1.s, diagnostico: w1.diag }; informe.configuracionActiva.tras_creacion = instantaneaCfg();
    mostrar('W1 · creación: regla CARGADA y estable (s)', String(w1.s));
    if (w1.s === null) throw new Error(`Traefik no cargó custom.yaml escrito desde Linux (diagnóstico: ${w1.diag?.estado})`);

    informe.fases.HEAD_aislada_con_regla = await pruebaHeadAislada(cred, true);
    mostrar('HEAD aislada · con regla: el evaluador lo declara bloqueado', `${informe.fases.HEAD_aislada_con_regla.evaluadoComoBloqueado === true} (estado ${informe.fases.HEAD_aislada_con_regla.estado}, gemelo ${informe.fases.HEAD_aislada_con_regla.gemelo}, registro ${informe.fases.HEAD_aislada_con_regla.conRegistro})`);

    // ── Fase B: matriz completa, SOLO tras confirmar que la regla está activa ──
    const eje2 = contarEjecuciones();
    const B = await correrLote(ext, cred, evaluarExterior);
    const Bcod = await correrLote(cod, cred, evaluarExterior);
    const Bab = await correrLote(abierto, cred, evaluarExterior);
    await dormir(1500); const eje3 = contarEjecuciones();
    const Bc = await correrLote(ctl, cred, evaluarControl);
    const Bneg = await correrLote(neg, cred, evaluarControlNegativo);
    const Bi = interior(cred);
    informe.fases.B_con_regla = { matriz68: { ...resumen(B.celdas), clases: porClase(B.celdas), celdas: B.celdas, centinelas: B.centinelas }, adicionalesCodificadas: { ...resumen(Bcod.celdas), clases: porClase(Bcod.celdas), celdas: Bcod.celdas, centinelas: Bcod.centinelas }, adicionalesCanarioAbierto: { ...resumen(Bab.celdas), celdas: Bab.celdas, ejecucionesN8nGeneradas: eje3 - eje2, centinelas: Bab.centinelas }, controles: { ...resumen(Bc.celdas), celdas: Bc.celdas, centinelas: Bc.centinelas }, controlesNegativos: { ...resumen(Bneg.celdas), celdas: Bneg.celdas, centinelas: Bneg.centinelas }, interior: Bi };
    mostrar('B · matriz de 68', `${resumen(B.celdas).ok} bloqueadas / ${resumen(B.celdas).fallos} fallos`);
    mostrar('B · adicionales CODIFICADAS (64)', `${resumen(Bcod.celdas).ok} bloqueadas / ${resumen(Bcod.celdas).fallos} fallos`);
    mostrar('B · adicionales (canario abierto)', `${resumen(Bab.celdas).ok} bloqueadas / ${resumen(Bab.celdas).fallos} fallos (ejecuciones nuevas en n8n: ${eje3 - eje2}; debe ser 0)`);
    mostrar('B · controles de rutas legítimas', `${resumen(Bc.celdas).ok} ok / ${resumen(Bc.celdas).fallos} fallos`);
    mostrar('B · controles negativos (rutas ajenas NO bloqueadas)', `${resumen(Bneg.celdas).ok} ok / ${resumen(Bneg.celdas).fallos} fallos`);
    mostrar('B · interior', `${Bi.filter((x) => x.ok).length} ok / ${Bi.filter((x) => !x.ok).length} fallos`);
    const bOk = resumen(B.celdas).fallos === 0 && resumen(Bcod.celdas).fallos === 0 && resumen(Bab.celdas).fallos === 0 && eje3 - eje2 === 0 && resumen(Bc.celdas).fallos === 0 && resumen(Bneg.celdas).fallos === 0 && Bi.every((x) => x.ok);
    if (!bOk) { fuga = true; informe.notas.push('DETENIDO: alguna celda de la fase B no quedó bloqueada con la regla confirmada como activa. No se ejecutan más fases.'); }
    let supOk = true;
    if (e0b && !fuga) {
      // Capa 1 con insecure=true: TODAS las variantes de suplantación deben seguir bloqueadas por Traefik (el middleware lee la dirección remota, no las cabeceras) y con 0 ejecuciones en n8n.
      const ej4 = contarEjecuciones();
      const SB = await correrLote(matrizSuplantacionBloqueo(ipN8n), cred, evaluarExterior);
      await dormir(1500); const ej5 = contarEjecuciones();
      const ecoCon = await ecoPrueba(ipN8n);
      supOk = resumen(SB.celdas).fallos === 0 && ej5 - ej4 === 0;
      informe.e0b.suplantacionConRegla = { ...resumen(SB.celdas), clases: porClase(SB.celdas), ejecucionesN8nGeneradas: ej5 - ej4, celdas: SB.celdas, centinelas: SB.centinelas, ecoConReglaActiva: ecoCon.conservaLaCabeceraDelCliente };
      mostrar('E0b · suplantación CON regla: bloqueadas / total', `${resumen(SB.celdas).ok}/${SB.celdas.length} (ejecuciones nuevas en n8n: ${ej5 - ej4}; debe ser 0)`);
      if (!supOk) { fuga = true; informe.notas.push('DETENIDO (E0b): una variante de suplantación de cabeceras NO quedó bloqueada con la regla activa. Se documenta sin corregir la regla.'); }
    }

    if (!fuga) {
      if (e0b) {
        informe.e0b.clf = await faseClf(envF, cred, ipN8n);
        mostrar('E0b · CLF: sondas ok / total · bloqueadas con línea / sin línea', `${informe.e0b.clf.celdas.filter((c) => c.ok).length}/${informe.e0b.clf.celdas.length} · ${informe.e0b.clf.bloqueadasConLinea} / ${informe.e0b.clf.bloqueadasSinLinea}`);
      }
      // ── W2: modificación (una regla que NO cubre el canario lo libera; restaurar vuelve a bloquear) ──
      escribirCfg('custom.yaml', candidata.replace('tai-lector-prod-`', 'tai-lector-prod-inexistente-`'));
      const w2a = await esperarRegla(cred, 'ausente');
      escribirCfg('custom.yaml', candidata);
      const w2b = await esperarRegla(cred, 'cargada');
      informe.vigilancia.modificacion = { libera_s: w2a.s, restaura_s: w2b.s, diagLibera: w2a.diag, diagRestaura: w2b.diag };
      mostrar('W2 · modificación: libera / restaura (s)', `${w2a.s} / ${w2b.s}`);

      // ── W3: EasyPanel «regenera» main.yaml: el bloqueo permanece y el cambio de main.yaml SÍ se aplica ──
      const regenerado = principal_.replace('  services:', '    regenerado-http:\n      rule: "Host(`regen.prueba.local`) && PathPrefix(`/`)"\n      entryPoints: [http]\n      service: n8n\n  services:');
      escribirCfg('main.yaml', regenerado);
      const aplicado = await hasta(async () => (await peticionCruda({ puerto: 18080, metodo: 'GET', ruta: '/healthz', host: 'regen.prueba.local' })).estado === 200, 30000);
      const w3 = await esperarRegla(cred, 'cargada', 10000);
      const tras = await correrLote(ext, cred, evaluarExterior);
      const trasCod = await correrLote(cod, cred, evaluarExterior);
      ejeW0 = contarEjecuciones();
      const trasAb = await correrLote(abierto, cred, evaluarExterior);
      await dormir(1500); ejeW1 = contarEjecuciones();
      const trasNeg = await correrLote(neg, cred, evaluarControlNegativo);
      informe.vigilancia.regeneracion = { mainAplicado_s: aplicado, bloqueoIntacto: w3.s !== null, matriz68TrasRegenerar: { ...resumen(tras.celdas), celdas: tras.celdas }, codificadasTrasRegenerar: { ...resumen(trasCod.celdas), celdas: trasCod.celdas }, canarioAbiertoTrasRegenerar: { ...resumen(trasAb.celdas), ejecucionesN8nGeneradas: ejeW1 - ejeW0, celdas: trasAb.celdas }, controlesNegativosTrasRegenerar: { ...resumen(trasNeg.celdas), celdas: trasNeg.celdas } };
      informe.configuracionActiva.tras_regeneracion = instantaneaCfg();
      mostrar('W3 · main.yaml recargado (s) / matriz de 68 tras regenerar', `${aplicado} / ${resumen(tras.celdas).ok}/68 + ${resumen(trasCod.celdas).ok}/64 codificadas bloqueadas`);

      // ── W5: carga inicial (reinicio de Traefik con custom.yaml ya presente) ──
      docker('restart', 'tai-tf-traefik');
      await esperar(() => peticionCruda({ puerto: 18080, metodo: 'GET', ruta: '/healthz', host: HOST_N8N }).then((r) => r.estado === 200), 60000, 'Traefik tras reiniciar');
      const w5 = await esperarRegla(cred, 'cargada', 15000);
      informe.vigilancia.cargaInicial = { segundos: w5.s, diagnostico: w5.diag };
      mostrar('W5 · carga inicial tras reiniciar: regla CARGADA (s)', String(w5.s));

      // ── Fase D / W4: eliminación → reversión completa ──
      quitarCfg('custom.yaml');
      const w4 = await esperarRegla(cred, 'ausente');
      informe.configuracionActiva.tras_eliminacion = instantaneaCfg();
      const D = await correrLote(ext, cred, evaluarExterior);
      const Dcod = await correrLote(cod, cred, evaluarExterior);
      const Dab = await correrLote(abierto, cred, evaluarExterior);
      const Dc = await correrLote(ctl, cred, evaluarControl);
      const Dneg = await correrLote(neg, cred, evaluarControlNegativo);
      const igualNeg = Dneg.celdas.every((c, i) => c.clasificacion === Aneg.celdas[i].clasificacion && c.estado === Aneg.celdas[i].estado && c.ok);
      const Di = interior(cred);
      const igual = D.celdas.length === A.celdas.length && D.celdas.every((c, i) => c.clasificacion === A.celdas[i].clasificacion && c.estado === A.celdas[i].estado);
      const igualAb = Dab.celdas.every((c, i) => c.clasificacion === Aab.celdas[i].clasificacion) && Dcod.celdas.every((c, i) => c.clasificacion === Acod.celdas[i].clasificacion && c.estado === Acod.celdas[i].estado);
      informe.vigilancia.eliminacion = { segundos: w4.s, diagnostico: w4.diag };
      informe.fases.D_reversion = { eliminacion_s: w4.s, matriz68: { ...resumen(D.celdas), clases: porClase(D.celdas), identicaAFaseA_porClasificacionYEstado: igual, celdas: D.celdas }, adicionales: { identicasAFaseA: igualAb, canarioAbierto: Dab.celdas, codificadas: Dcod.celdas }, controles: resumen(Dc.celdas), controlesNegativos: { ...resumen(Dneg.celdas), identicosAFaseA: igualNeg, celdas: Dneg.celdas }, interior: Di.map((x) => x.ok) };
      mostrar('D · eliminación detectada (s) / vuelve EXACTAMENTE a la fase A', `${w4.s} / ${igual && igualAb}`);

      const vigOk = [w1.s, w2a.s, w2b.s, aplicado, w5.s, w4.s].every((v) => v !== null) && resumen(tras.celdas).fallos === 0 && resumen(trasCod.celdas).fallos === 0 && resumen(trasAb.celdas).fallos === 0 && ejeW1 - ejeW0 === 0 && resumen(trasNeg.celdas).fallos === 0 && w3.s !== null;
      informe.ok = bOk && vigOk && igual && igualAb && igualNeg && resumen(Aneg.celdas).fallos === 0 && resumen(Dc.celdas).fallos === 0 && Di.every((x) => x.ok) && informe.fases.A_sin_regla.adicionalesCanarioAbierto.alcanzanElCanario === 2 && eje1 - eje0 === 2;
      if (e0b) informe.ok = informe.ok && supOk && Boolean(informe.e0b.clf?.ok);
    } else informe.ok = false;
    informe.ejecucionesN8nDesdeElExteriorConReglaActiva = { B: eje3 - eje2, trasRegenerar: ejeW1 !== null && ejeW0 !== null ? ejeW1 - ejeW0 : null };
    informe.veredicto = informe.ok ? (e0b ? 'E0b SUPERADA: con forwardedHeaders.insecure=true la regla sigue bloqueando todo (capa 1)' : 'REGLA VALIDADA LOCALMENTE') : (fuga ? 'REGLA NO VALIDADA: una celda atravesó el bloqueo' : 'REGLA NO VALIDADA: alguna comprobación no se cumplió');
    mostrar('RESULTADO', informe.veredicto);
    for (const f of [...B.celdas, ...Bcod.celdas, ...Bab.celdas, ...Bc.celdas].filter((c) => !c.ok).slice(0, 40)) mostrar('  ✖ ' + f.id, `${f.estado} ${f.clasificacion} ${(f.motivos || []).join('; ')}`.slice(0, 230));
    if (!informe.ok) process.exitCode = 1;
  } catch (e) { informe.error = String(e.message).slice(0, 500); informe.ok = false; informe.veredicto = 'REGLA NO VALIDADA: la ejecución se interrumpió'; mostrar('ERROR', informe.error); process.exitCode = 1; }
  finally {
    ESTADO.finalizando = true;
    // GUARDAR resultados y registros ANTES de limpiar
    const dir = path.join(TRABAJO, `resultados-${Date.now()}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      informe.fin = new Date().toISOString();
      for (const [c, f] of [['tai-tf-traefik', 'traefik.log'], ['tai-tf-n8n', 'n8n.log']]) { try { const t = docker('logs', c); fs.writeFileSync(path.join(dir, f), t); if (c === 'tai-tf-traefik') informe.configuracionesRecibidasPorTraefik = lineaTemporalConfig(t); } catch { /* el contenedor puede no existir */ } }
      fs.writeFileSync(path.join(dir, 'informe.json'), JSON.stringify(informe, null, 1));
      mostrar('resultados guardados en', dir);
    } catch (e) { mostrar('ERROR al guardar resultados', e.message); process.exitCode = 1; }
    limpiezaUnica();
    try {
      const despues = estadoDocker();
      const iguales = CONTENEDORES_EXISTENTES.every((n) => despues.existentes[n] === antes.existentes[n]);
      const limpio = !despues.proyecto.contenedores.length && !despues.proyecto.redes.length && !despues.proyecto.volumenes.length;
      fs.writeFileSync(path.join(dir, 'docker-despues.json'), JSON.stringify({ antes, despues, existentesIntactos: iguales, proyectoLimpio: limpio }, null, 1));
      mostrar('Docker después: contexto / existentes intactos / proyecto limpio', `${despues.contexto} / ${iguales} / ${limpio}`);
      if (!iguales || !limpio || despues.contexto !== 'desktop-linux') process.exitCode = 1;
    } catch (e) { mostrar('ERROR al comprobar Docker', e.message); process.exitCode = 1; }
  }
}

// Alta de la prueba: credencial desechable e importación (CLI de n8n) del canario con lista de IP, de su copia ABIERTA (sin lista de IP, con ejecuciones guardadas para contarlas) y de una ruta pública de control.
async function prepararN8n(cred, subred) {
  const ej = (...a) => docker('exec', 'tai-tf-n8n', ...a);
  const credencial = { id: crypto.randomBytes(8).toString('hex'), name: CREDENCIAL_CANARIO, type: 'httpHeaderAuth', data: { name: CABECERA_CANARIO, value: cred } };
  const cdir = '/tmp/tai-tf'; ej('mkdir', '-p', cdir);
  // El archivo temporal (con la credencial desechable) se borra SIEMPRE, también si `docker cp` falla; modo 0600. Una interrupción forzosa entre la escritura y el borrado se corrige con `limpiar`.
  const subir = (nombre, objeto) => {
    const f = path.join(TRABAJO, nombre);
    try { fs.writeFileSync(f, JSON.stringify(objeto), { mode: 0o600 }); docker('cp', f, `tai-tf-n8n:${cdir}/${nombre}`); }
    finally { try { fs.rmSync(f, { force: true }); } catch { /* se borra con «limpiar» */ } }
  };
  subir('credencial.json', [credencial]);
  ej('n8n', 'import:credentials', `--input=${cdir}/credencial.json`);
  const wf = canarioAislamiento({ ipWhitelist: subred, controlPublico: true });
  const rec = wf.nodes.find((n) => n.name === 'Recibir (canario)'); const res = wf.nodes.find((n) => n.name === 'Responder (canario)');
  const recA = JSON.parse(JSON.stringify(rec)); const resA = JSON.parse(JSON.stringify(res));
  recA.name = 'Recibir (abierto)'; recA.parameters.path = `${RUTA_CANARIO}-abierto`; recA.parameters.options = {}; recA.position = [0, 440];
  resA.name = 'Responder (abierto)'; resA.position = [300, 440];
  wf.nodes.push(recA, resA); wf.connections['Recibir (abierto)'] = { main: [[{ node: 'Responder (abierto)', type: 'main', index: 0 }]] };
  wf.settings = { ...wf.settings, saveDataSuccessExecution: 'all' }; // SOLO en la prueba: permite contar en n8n las ejecuciones reales (control positivo del lado del origen)
  for (const n of wf.nodes) { if (n.type === 'n8n-nodes-base.webhook') n.webhookId = crypto.randomUUID(); if (n.credentials?.httpHeaderAuth) n.credentials.httpHeaderAuth.id = credencial.id; }
  wf.id = 'tai-tf-canario'; subir('canario.json', [wf]);
  ej('n8n', 'import:workflow', `--input=${cdir}/canario.json`);
  ej('n8n', 'publish:workflow', '--id=tai-tf-canario');
  docker('restart', 'tai-tf-n8n');
  await esperar(() => docker('inspect', '-f', '{{.State.Health.Status}}', 'tai-tf-n8n').trim() === 'healthy', 240000, 'n8n sano tras publicar');
}

export async function principal(argv = process.argv.slice(2), env = process.env) {
  const orden = argv[0];
  if (orden === 'ensayo') {
    const necesarios = ['docker-compose.yml', 'traefik.yaml', 'config-base/main.yaml', 'config-candidata/custom.yaml', 'LEEME.md'];
    for (const f of necesarios) mostrar(f, fs.existsSync(path.join(DIR_PRUEBA, f)) ? 'presente' : 'FALTA');
    mostrar('celdas exteriores / codificadas / canario abierto / controles', `${matrizExterior().length} / ${matrizCodificada().length} / ${matrizAbierto().length} / ${matrizControles().length}`);
    for (const f of ['traefik.tls.yaml', 'traefik.tls-redir.yaml', 'config-base-tls/main.yaml', `config-candidata/${ARCHIVO_CANDIDATA_TLS}`]) mostrar(`TLS · ${f}`, fs.existsSync(path.join(DIR_PRUEBA, f)) ? 'presente' : 'FALTA');
    mostrar('TLS · celdas del candidato / controles https / negativos / http', `${matrizTls().length} / ${controlesTls().https.length} / ${controlesTls().negativos.length} / ${controlesTls().http.length}`);
    mostrar('imagen a descargar (única)', IMAGEN_TRAEFIK);
    mostrar('autorización', autorizado(env) ? 'CONCEDIDA (TAI_PRUEBA_TRAEFIK_AUTORIZADA=1)' : 'no concedida: «descargar», «ejecutar» y «limpiar» no actuarán');
    return 0;
  }
  if (!['descargar', 'ejecutar', 'limpiar', 'e0b', 'verificar-clf', 'tls'].includes(orden)) { console.error('Uso: prueba-traefik.mjs ensayo | descargar | ejecutar | e0b | verificar-clf | tls | limpiar'); return 2; }
  if (!autorizado(env)) { console.error('Sin autorización expresa (TAI_PRUEBA_TRAEFIK_AUTORIZADA=1): no se hace nada.'); return 3; }
  AUTORIZACION_CONCEDIDA = true;   // único punto que la concede; cada ruta comprueba además el destino Docker (iniciarOperacionConEfectos)
  if (orden === 'e0b') { await ejecutar({ e0b: true }); return process.exitCode || 0; }
  if (orden === 'verificar-clf') { await verificarClf(); return process.exitCode || 0; }
  if (orden === 'tls') { await verificarTls(); return process.exitCode || 0; }
  if (orden === 'descargar') return descargarImagen();
  if (orden === 'limpiar') { const c = await limpiarComando(); return c || process.exitCode || 0; }
  await ejecutar(); return process.exitCode || 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) principal().then((c) => process.exit(c)).catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
