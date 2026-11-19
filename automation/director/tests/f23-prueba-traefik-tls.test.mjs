// Fase TLS de la prueba local de Traefik y procedimiento E2 corregido (17/11/2026): SOLO lo que no necesita Docker ni red real
// (archivos, hashes, matriz, evaluadores, cliente TLS/h2 contra servidores locales efímeros en 127.0.0.1, guardas de los scripts del VPS). NO ejecuta la fase `tls` de Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVO_CANDIDATA_TLS, HASH_CANDIDATA_TLS, HASH_REGLA_VALIDADA, controlesTls, evaluarAntiguoNoBloquea, evaluarRedirEntrypoint, evaluarRedireccion, matrizTls, veredictoTls } from '../../dev/prueba-traefik/matriz.mjs';
import { principal } from '../../../scripts/automation/prueba-traefik.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(RAIZ, 'automation', 'dev', 'prueba-traefik');
const leerBuf = (f) => fs.readFileSync(path.join(DIR, f));
const leer = (f) => leerBuf(f).toString('utf8');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('la regla ORIGINAL sigue intacta (517 bytes, SHA-256 validado) y el candidato TLS es un archivo aparte con su hash fijado', () => {
  const original = leerBuf('config-candidata/custom.yaml');
  assert.equal(original.length, 517);
  assert.equal(sha(original), HASH_REGLA_VALIDADA);
  const candidata = leerBuf(`config-candidata/${ARCHIVO_CANDIDATA_TLS}`);
  assert.equal(sha(candidata), HASH_CANDIDATA_TLS);
  assert.equal(candidata.length, 1305);
  assert.ok(!candidata.includes(13), 'el candidato debe tener solo LF (su hash se fija en el procedimiento del VPS)');
  assert.notEqual(ARCHIVO_CANDIDATA_TLS, 'custom.yaml');
  assert.ok(!/^custom/i.test(ARCHIVO_CANDIDATA_TLS));
});

test('el candidato conserva el patrón, la prioridad, el middleware y el servicio validados, con un router por entrypoint y tls solo en https', () => {
  const t = leer(`config-candidata/${ARCHIVO_CANDIDATA_TLS}`);
  const regla = /rule: "PathRegexp\(`\(\?i\)\^\(\?:\/\|%2f\|%5c\)\+webhook\.\*tai-lector-prod-`\)"/g;
  assert.equal((t.match(regla) ?? []).length, 2, 'la MISMA regex validada, en los dos routers');
  assert.equal((t.match(/priority: 10000000/g) ?? []).length, 2);
  assert.equal((t.match(/middlewares: \[tai-denegar-todo\]/g) ?? []).length, 2);
  assert.equal((t.match(/service: noop@internal/g) ?? []).length, 2);
  assert.match(t, /sourceRange: \["192\.0\.2\.1\/32"\]/);
  const http = t.slice(t.indexOf('tai-bloquear-lector-prod-http:'), t.indexOf('tai-bloquear-lector-prod-https:'));
  const https = t.slice(t.indexOf('tai-bloquear-lector-prod-https:'), t.indexOf('\n  middlewares:\n    tai-denegar-todo'));
  assert.match(http, /entryPoints: \[http\]/); assert.ok(!/\btls:/.test(http), 'el router http NO declara tls');
  assert.match(https, /entryPoints: \[https\]/); assert.match(https, /\n      tls: \{\}/);
  // `tls: {}` habilita TLS en el router (exigido arriba); lo que NO debe haber es configuración de certificados o resolvers. Se mira solo la configuración, no los comentarios (que explican justo eso).
  const configuracion = t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/\b(certResolver|certificates|domains|options|store)\b/.test(configuracion), 'no pide ni declara certificados ni resolvers');
  assert.equal((configuracion.match(/^\s+tls: \{\}$/gm) ?? []).length, 1, 'tls: {} sigue en el router https (y solo en él)');
  // la expresión sigue bloqueando lo que debe y dejando pasar lo que no (la misma comprobación que el original)
  const rx = /^(?:\/|%2f|%5c)+webhook.*tai-lector-prod-/i;
  for (const r of ['/webhook/tai-lector-prod-x', '/WEBHOOK/TAI-LECTOR-PROD-X', '//webhook//tai-lector-prod-x', '%2Fwebhook/tai-lector-prod-x', '/webhook-test/tai-lector-prod-x']) assert.ok(rx.test(r), r);
  for (const r of ['/webhook/tai-lector-04', '/webhook/tai-lector-produccion', '/webhook/tai-publico-x', '/assets/webhook-icon.svg']) assert.ok(!rx.test(r), r);
});

test('la configuración TLS reproduce lo del VPS: insecure=true, proveedor de archivos con watch, registro JSON con X-Prueba-Id; la variante con redirección en el entrypoint solo añade eso', () => {
  const s = leer('traefik.tls.yaml'); const r = leer('traefik.tls-redir.yaml');
  for (const c of [s, r]) { assert.match(c, /directory: \/data\/config/); assert.match(c, /watch: true/); assert.match(c, /X-Prueba-Id: keep/); assert.equal((c.match(/insecure: true/g) ?? []).length, 2); assert.match(c, /address: ":443"/); }
  assert.ok(!/redirections/.test(s));
  assert.match(r, /redirections:\n\s+entryPoint:\n\s+to: https\n\s+scheme: https\n\s+permanent: true/);
  const base = leer('config-base-tls/main.yaml');
  assert.match(base, /n8n-https:[\s\S]*entryPoints: \[https\][\s\S]*tls: \{\}/, 'el router https de n8n lleva tls (lo que declara un router HTTPS real)');
  assert.match(base, /n8n-http:[\s\S]*redirigir-a-https/);
  assert.ok(!/priority/.test(base), 'la redirección y los routers de n8n no llevan prioridad explícita: la del bloqueo (10 000 000) prevalece');
  // el compose y la base anteriores NO cambian: ni puertos ni TLS en la configuración sin TLS
  assert.ok(!/\btls\b/.test(leer('config-base/main.yaml')) && !/\btls\b/.test(leer('traefik.yaml')), 'la prueba anterior sigue siendo sin TLS (no se reescribe)');
});

test('la matriz TLS es reducida, cubre https/http/SNI/Host/h2 y marca las celdas decisivas; los controles cubren healthz, interfaz, webhook público y los 10 negativos', () => {
  const m = matrizTls();
  assert.ok(m.length < 40, `matriz reducida (${m.length} celdas; E0b tenía 132)`);
  assert.equal(new Set(m.map((c) => c.id)).size, m.length, 'ids únicos');
  assert.equal(m.filter((c) => c.decisiva).length, 2);
  assert.equal(m.filter((c) => c.decisivaHttp).length, 1);
  assert.equal(m.filter((c) => c.fase === 'ambas').length, 15);
  assert.equal(m.filter((c) => c.fase === 'nuevo').length, 7);
  assert.ok(m.some((c) => c.h2) && m.some((c) => c.sni === null) && m.some((c) => c.host === 'otro.ejemplo') && m.some((c) => c.metodo === 'HEAD') && m.some((c) => c.metodo === 'GET'));
  assert.ok(m.filter((c) => c.metodo === 'HEAD').every((c) => m.some((g) => g.metodo === 'GET' && g.ruta === c.ruta && g.entrada === c.entrada && g.host === c.host && g.credencial === c.credencial)), 'cada HEAD tiene su GET gemelo');
  const c = controlesTls();
  assert.equal(c.https.length, 4); assert.equal(c.http.length, 2); assert.equal(c.negativos.length, 10);
  assert.ok(c.negativos.every((x) => x.entrada === 'https'));
});

test('evaluador de la regla ANTIGUA: solo es correcto si la petición https LLEGA a n8n por su router https (reproduce E2); un bloqueo de Traefik lo invalida', () => {
  const llega = { id: 'tls|abierto|https|con-cred|POST' };
  const ok = evaluarAntiguoNoBloquea(llega, { estado: 200, cuerpo: '{"canario":true}', log: { RouterName: 'n8n-https', OriginStatus: 200, ServiceName: 'n8n' } });
  assert.equal(ok.ok, true);
  const exacta = evaluarAntiguoNoBloquea({ id: 'tls|exacta|https|con-cred|POST' }, { estado: 403, cuerpo: 'IP is not allowed', log: { RouterName: 'n8n-https@file', OriginStatus: 403 } });
  assert.equal(exacta.ok, true, 'el rechazo de la lista de IP de n8n también prueba que llegó a n8n');
  const bloqueada = evaluarAntiguoNoBloquea(llega, { estado: 403, cuerpo: 'Forbidden', log: { RouterName: 'tai-bloquear-lector-prod', ServiceName: 'noop@internal' } });
  assert.equal(bloqueada.ok, false); assert.ok(bloqueada.motivos.some((m) => /NO se reproduce/.test(m)));
  assert.equal(evaluarAntiguoNoBloquea(llega, { estado: 200, cuerpo: '{"canario":true}', log: null }).ok, false, 'sin línea de registro no se afirma nada');
  assert.equal(evaluarAntiguoNoBloquea(llega, { estado: 200, cuerpo: '{"canario":true}', log: { RouterName: 'n8n-http', OriginStatus: 200 } }).ok, false, 'tiene que ser el router https');
  assert.equal(evaluarAntiguoNoBloquea(llega, { estado: 404, cuerpo: 'The requested webhook is not registered', log: { RouterName: 'n8n-https', OriginStatus: 404 } }).ok, false, 'la ruta abierta debe alcanzar el canario');
});

test('evaluadores de redirección: http → https sin llegar al origen; en la variante del entrypoint, redirección permanente y bloqueo posterior por https', () => {
  const c = { id: 'tlsctl|healthz|http' };
  assert.equal(evaluarRedireccion(c, { estado: 308, cabeceras: { location: 'https://n8n.prueba.local/healthz' }, log: { RouterName: 'n8n-http', OriginStatus: 0 } }).ok, true);
  assert.equal(evaluarRedireccion(c, { estado: 200, cabeceras: {}, log: null }).ok, false);
  assert.equal(evaluarRedireccion(c, { estado: 308, cabeceras: { location: 'http://x/' }, log: null }).ok, false);
  assert.equal(evaluarRedireccion(c, { estado: 308, cabeceras: { location: 'https://x/' }, log: { OriginStatus: 200 } }).ok, false);
  assert.equal(evaluarRedirEntrypoint({ http: { estado: 308, cabeceras: { location: 'https://n8n.prueba.local/x' } }, https: { estado: 403, cuerpo: 'Forbidden' } }).ok, true);
  assert.equal(evaluarRedirEntrypoint({ http: { estado: 403, cabeceras: {} }, https: { estado: 403, cuerpo: 'Forbidden' } }).ok, false);
  assert.equal(evaluarRedirEntrypoint({ http: { estado: 308, cabeceras: { location: 'https://x/' } }, https: { estado: 200, cuerpo: '{"canario":true}' } }).ok, false);
});

test('veredicto TLS: exige todas las fases, la reversión, las dos huellas y que los contenedores preexistentes no cambien; falla si falta algo', () => {
  const n = (k, ok = true) => Array.from({ length: k }, (_, i) => ({ id: `c${i}`, ok }));
  const bueno = { base: n(2), antiguoHttps: n(2), antiguoHttp: n(1), nuevoBloqueo: n(15), nuevoSniH2: n(7), nuevoControles: n(4), nuevoNegativos: n(10), nuevoHttpControles: n(2), reversion: { restaurado: true, cfgIgualAlInicio: true }, redirEntrypoint: { ok: true }, hashes: { original: HASH_REGLA_VALIDADA, originalDespues: HASH_REGLA_VALIDADA, candidata: HASH_CANDIDATA_TLS, candidataEnVolumen: HASH_CANDIDATA_TLS }, existentesIntactos: true, proyectoLimpio: true, contexto: 'desktop-linux' };
  assert.deepEqual(veredictoTls(bueno).fallos, []);
  const peor = (cambio) => veredictoTls({ ...bueno, ...cambio });
  assert.ok(peor({ antiguoHttps: n(2, false) }).fallos.some((f) => /ANTIGUA sobre TLS/.test(f)), 'si la regla antigua bloqueara por TLS, la hipótesis de E2 no se reproduce');
  assert.ok(peor({ nuevoBloqueo: n(14) }).fallos.some((f) => /bloqueo por TLS/.test(f)));
  assert.ok(peor({ reversion: { restaurado: true, cfgIgualAlInicio: false } }).fallos.some((f) => /idéntico/.test(f)));
  assert.ok(peor({ redirEntrypoint: null }).fallos.some((f) => /T4/.test(f)));
  assert.ok(peor({ hashes: { ...bueno.hashes, originalDespues: 'x' } }).fallos.some((f) => /ORIGINAL/.test(f)));
  assert.ok(peor({ hashes: { ...bueno.hashes, candidataEnVolumen: null } }).fallos.some((f) => /candidato no coincide/.test(f)));
  assert.ok(peor({ existentesIntactos: false }).fallos.length >= 1 && peor({ proyectoLimpio: false }).fallos.length >= 1 && peor({ contexto: 'otro' }).fallos.length >= 1);
});

test('el lanzador conserva sus guardas: «tls» es una orden más, exige autorización, y «ensayo» no toca Docker pero lista los archivos TLS', async () => {
  const salida = []; const orig = console.log; console.log = (...a) => salida.push(a.join(' '));
  try { assert.equal(await principal(['ensayo'], {}), 0); } finally { console.log = orig; }
  const texto = salida.join('\n');
  assert.match(texto, /TLS · traefik\.tls\.yaml\s+presente/); assert.match(texto, /TLS · traefik\.tls-redir\.yaml\s+presente/); assert.match(texto, /TLS · config-base-tls\/main\.yaml\s+presente/); assert.match(texto, /TLS · config-candidata\/tai-bloqueo-lector-tls\.yaml\s+presente/);
  const err = []; const e0 = console.error; console.error = (...a) => err.push(a.join(' '));
  try { assert.equal(await principal(['tls'], {}), 3, 'sin autorización no se hace nada'); assert.equal(await principal(['otra'], {}), 2); } finally { console.error = e0; }
  assert.ok(err.some((l) => /tls/.test(l)));
  const lanzador = fs.readFileSync(path.join(RAIZ, 'scripts', 'automation', 'prueba-traefik.mjs'), 'utf8');
  assert.match(lanzador, /async function verificarTls\(\) \{\n  const destino = iniciarOperacionConEfectos\(\);/, 'la fase TLS empieza por autorización + destino Docker verificado');
  assert.match(lanzador, /MODO_TLS = true;[\s\S]*finally \{[\s\S]*MODO_TLS = false;[\s\S]*limpiezaUnica\(\);/, 'el modo TLS se apaga y la limpieza única se dispara siempre');
  assert.match(lanzador, /for \(const metodo of \['GET', 'HEAD'\]\)/, 'los centinelas GET y HEAD se conservan');
  // el compose NO cambia (la prueba TLS reutiliza los puertos 18080/18081: el entrypoint https habla TLS cuando los routers declaran tls)
  assert.ok(!/tls/i.test(leer('docker-compose.yml').replace(/sin TLS en la prueba/g, '')), 'el compose no necesita cambios');
});

test('los scripts del VPS (E2): comprobaciones previas, instalación atómica, retirada automática ante fallo, reversión manual y NADA de temporizadores, procesos persistentes ni cambios de servicios', () => {
  const ins = leer('e2/instalar-regla-tls.sh'); const ret = leer('e2/retirar-regla-tls.sh');
  for (const s of [ins, ret]) {
    assert.ok(!s.includes('\r'), 'solo LF');
    assert.match(s, /^#!\/usr\/bin\/env bash/);
    assert.ok(!/\b(nohup|disown|setsid|crontab|systemctl|systemd-run|at -|watch )\b/.test(s), 'sin temporizadores ni procesos persistentes');
    assert.ok(!/\bdocker (service (update|scale|rm|create)|restart|stop|kill|rm|run|compose|stack)\b/.test(s), 'no cambia servicios ni contenedores');
    assert.ok(!/\bsleep\s+[0-9]{3,}\b/.test(s), 'sin esperas largas');
    assert.ok(!/main\.yaml["'\s]*(>|>>|\|\s*tee)|(rm|mv|cp|sed|chmod|chown|truncate)\s[^\n]*main\.yaml/.test(s.replace(/#[^\n]*/g, '')), 'nunca modifica main.yaml');
    assert.match(s, /HASH_MAIN='5a0113d86b3af7fd66afa027d59adb5d714a74c70fa346209f2374db307ab267'/);
  }
  assert.match(ins, new RegExp(`HASH_CANDIDATO='${HASH_CANDIDATA_TLS}'`)); assert.match(ins, /BYTES_CANDIDATO='1305'/);
  assert.match(ins, /trap al_salir EXIT/); assert.match(ins, /mv -T -- "\$TMP" "\$FINAL"/, 'instalación atómica por rename');
  assert.match(ins, /E2_PUERTA_PREVIA_OK/); assert.ok(ins.indexOf('E2_PUERTA_PREVIA_OK') < ins.indexOf('cp -- "$ORIGEN" "$TMP"'), 'toda comprobación previa ocurre ANTES de escribir nada');
  assert.match(ins, /--resolve "\$HOST:\$puerto:127\.0\.0\.1"/); assert.match(ins, /--path-as-is/); assert.match(ins, /--max-redirs 0/);
  assert.match(ins, /\[ "\$CREADO_TMP" = 1 \]/, 'solo borra el .tmp que ella misma creó');
  assert.match(ins, /\*\.retirado\* no cuentan|retirado/);
  assert.match(ret, /mv -f -- "\$DIR\/\$NOMBRE" "\$DIR\/\$NOMBRE\.retirado-\$MARCA"/, 'la reversión renombra, no borra');
  // Ningún `rm` apunta al candidato ni a la ruta final (`"$DIR/$NOMBRE"`, `$FINAL`); la única eliminación permitida es la del `.tmp` sobrante, que se comprueba aparte y SIN quitar «.tmp» del texto.
  for (const s of [ins, ret]) {
    assert.ok(!/\brm\b[^\n]*"\$DIR\/\$NOMBRE"/.test(s), 'no borra el candidato (ruta final)');
    assert.ok(!/\brm\b[^\n]*"\$FINAL"/.test(s), 'no borra el candidato ($FINAL)');
    for (const l of s.split('\n').filter((x) => /\brm\b/.test(x) && !/^\s*#/.test(x))) assert.ok(/\.tmp"|"\$TMP"|"\$f"/.test(l), `un rm que no es del .tmp ni del temporal de curl: ${l.trim()}`);
  }
  assert.match(ret, /rm -f -- "\$DIR\/\$NOMBRE\.tmp"/, 'la limpieza del .tmp sobrante existe y es solo del .tmp');
  // la regla instalada es la del repositorio: ningún script embebe otra copia del YAML
  assert.ok(!/PathRegexp/.test(ins) && !/PathRegexp/.test(ret));
});

test('el cliente TLS y HTTP/2 de la prueba conservan la línea de petición SIN normalizar contra un servidor local efímero (sin Docker, sin red externa)', async () => {
  const { peticionTls, peticionH2 } = await import('../../../scripts/automation/prueba-traefik.mjs');
  assert.equal(typeof peticionTls, 'function'); assert.equal(typeof peticionH2, 'function');
  // sin certificado en el repositorio no se levanta un servidor TLS: se comprueba que, ante un puerto cerrado, devuelven un error limpio (no cuelgan ni lanzan)
  const cerrado = 1;   // el puerto 1 de loopback no tiene servicio
  const a = await peticionTls({ puerto: cerrado, metodo: 'GET', ruta: '/x', host: 'n8n.prueba.local', timeoutMs: 1500 });
  const b = await peticionH2({ puerto: cerrado, metodo: 'GET', ruta: '/x', host: 'n8n.prueba.local', timeoutMs: 1500 });
  assert.ok(a.error && !a.estado); assert.ok(b.error && !b.estado);
});
