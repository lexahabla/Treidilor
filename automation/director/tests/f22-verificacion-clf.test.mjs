// Verificación complementaria del evaluador CLF (E0b): SOLO la parte que no necesita Docker. La ejecución real (`verificar-clf`) exige autorización expresa y no se hace aquí.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analizarClf, decidirClf, evaluarClfAbierta, evaluarClfBloqueada, evaluarSondaEjecuciones, HASH_REGLA_VALIDADA, indexarClf, veredictoVerificacionClf } from '../../dev/prueba-traefik/matriz.mjs';
import { ajenosAlProyecto, crearLimpiezaUnica, permitirDocker, principal, sondasClf, verificarDestinoDocker } from '../../../scripts/automation/prueba-traefik.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const L_N8N = (id, estado = 200, router = 'n8n-http@file') => `<ip> - - [16/Nov/2026:14:52:28 +0000] "POST /webhook/x?tai=${id} HTTP/1.1" ${estado} 16 "-" "-" 7 "${router}" "http://n8n-interno:5678/" 15ms`;
const rBloq = { estado: 403, cuerpo: 'Forbidden', cabeceras: {} };
const r200 = { estado: 200, cuerpo: '{"publico":true}', cabeceras: {} };

test('la regla validada y su hash no han cambiado (el bloque 5 de la verificación depende de ello)', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ, 'automation', 'dev', 'prueba-traefik', 'config-candidata', 'custom.yaml'))).digest('hex'), HASH_REGLA_VALIDADA);
  assert.equal(HASH_REGLA_VALIDADA, '2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39');
});

test('ejecuciones por grupo: bloqueada y sin-ejecucion exigen 0; publica y control-canario exigen exactamente 1', () => {
  assert.equal(evaluarSondaEjecuciones({ grupo: 'bloqueada', delta: 0, nodos: [] }).ok, true);
  assert.equal(evaluarSondaEjecuciones({ grupo: 'bloqueada', delta: 1, nodos: ['abierto'] }).ok, false, 'una bloqueada que ejecuta el canario es una FUGA');
  assert.equal(evaluarSondaEjecuciones({ grupo: 'sin-ejecucion', delta: 0, nodos: [] }).ok, true);
  assert.equal(evaluarSondaEjecuciones({ grupo: 'sin-ejecucion', delta: 1, nodos: null }).ok, false);
  assert.equal(evaluarSondaEjecuciones({ grupo: 'publica', delta: 1, nodos: ['publico'] }).ok, true, 'el webhook público legítimo SÍ ejecuta: no es un falso positivo');
  assert.equal(evaluarSondaEjecuciones({ grupo: 'publica', delta: 0, nodos: [] }).ok, false, 'si el público no ejecutó, el contador no funciona o la ruta fue bloqueada');
  assert.equal(evaluarSondaEjecuciones({ grupo: 'publica', delta: 2, nodos: null }).ok, false);
  assert.equal(evaluarSondaEjecuciones({ grupo: 'control-canario', delta: 1, nodos: ['abierto'] }).ok, true);
});

test('atribución por nodo: una ejecución del grupo equivocado se detecta; sin datos se decide solo por el contador', () => {
  assert.equal(evaluarSondaEjecuciones({ grupo: 'publica', delta: 1, nodos: ['abierto'] }).ok, false, 'la ejecución del público es del canario: no es el webhook legítimo');
  assert.equal(evaluarSondaEjecuciones({ grupo: 'control-canario', delta: 1, nodos: ['publico'] }).ok, false);
  assert.equal(evaluarSondaEjecuciones({ grupo: 'bloqueada', delta: 0, nodos: ['canario'] }).ok, false, 'n8n registra una ejecución que el contador no vio');
  const sinDatos = evaluarSondaEjecuciones({ grupo: 'publica', delta: 1, nodos: ['desconocido'] });
  assert.equal(sinDatos.ok, true); assert.equal(sinDatos.atribucion, 'por-sonda');
  assert.equal(evaluarSondaEjecuciones({ grupo: 'publica', delta: 1, nodos: null }).atribucion, 'por-sonda', 'consulta a n8n no disponible');
  assert.equal(evaluarSondaEjecuciones({ grupo: 'publica', delta: 1, nodos: ['publico'] }).atribucion, 'por-nodo');
});

test('el criterio ORIGINAL (0 ejecuciones en toda la fase) daba un falso negativo y el corregido no', () => {
  const abiertas = [{ grupo: 'publica', delta: 1 }, { grupo: 'publica', delta: 1 }, { grupo: 'sin-ejecucion', delta: 0 }];
  const bloqueadas = Array.from({ length: 8 }, () => ({ grupo: 'bloqueada', delta: 0 }));
  const total = [...abiertas, ...bloqueadas].reduce((a, s) => a + s.delta, 0);
  assert.equal(total, 2, 'las 2 ejecuciones observadas en E0b');
  assert.equal(total === 0, false, 'criterio original: fallaba');
  assert.equal(bloqueadas.reduce((a, s) => a + s.delta, 0), 0, 'criterio corregido: 0 alrededor de las bloqueadas');
  const celdas = [{ ok: true }];
  assert.equal(decidirClf({ reglaCargada: true, correlacionPorConsulta: true, celdas, ejecucionesN8nGeneradas: 0 }), true);
  assert.equal(decidirClf({ reglaCargada: true, correlacionPorConsulta: true, celdas, ejecucionesN8nGeneradas: 1 }), false, 'una ejecución alrededor de las bloqueadas SÍ invalida');
  assert.equal(decidirClf({ reglaCargada: true, correlacionPorConsulta: false, celdas, ejecucionesN8nGeneradas: 0 }), false);
  assert.equal(decidirClf({ reglaCargada: false, correlacionPorConsulta: true, celdas, ejecucionesN8nGeneradas: 0 }), false);
  assert.equal(decidirClf({ reglaCargada: true, correlacionPorConsulta: true, celdas: [{ ok: true }, { ok: false }], ejecucionesN8nGeneradas: 0 }), false);
});

test('CLF: análisis, correlación por consulta y evaluación de sondas abiertas y bloqueadas', () => {
  const p = analizarClf(L_N8N('ab12cd', 200));
  assert.equal(p.router, 'n8n-http@file'); assert.equal(p.servidor, 'http://n8n-interno:5678/'); assert.equal(p.estado, 200);
  assert.deepEqual([...indexarClf(`${L_N8N('ab12cd')}\nbasura\n${L_N8N('ef34', 404)}`).keys()], ['ab12cd', 'ef34']);
  const celdaA = { id: 'a', metodo: 'POST', esperaEstado: [200] };
  assert.equal(evaluarClfAbierta(celdaA, r200, analizarClf(L_N8N('1'))).ok, true);
  assert.equal(evaluarClfAbierta(celdaA, r200, null).ok, false, 'sin línea CLF una ruta que debe llegar a n8n no es válida');
  assert.equal(evaluarClfAbierta(celdaA, r200, analizarClf(L_N8N('1', 200, 'web-http@file'))).ok, false, 'router distinto del de n8n');
  const celdaB = { id: 'b', metodo: 'POST', tipo: 'bloqueada', host: 'n8n.prueba.local' };
  assert.equal(evaluarClfBloqueada(celdaB, rBloq, null).ok, true, 'bloqueada sin línea: válida (Traefik no deja línea)');
  assert.equal(evaluarClfBloqueada(celdaB, rBloq, null).linea, 'ausente');
  assert.equal(evaluarClfBloqueada(celdaB, rBloq, analizarClf(L_N8N('2', 403))).ok, false, 'bloqueada pero con línea del router de n8n = FUGA');
  assert.equal(evaluarClfBloqueada(celdaB, { estado: 200, cuerpo: '{"canario":true}', cabeceras: {} }, null).ok, false, 'respuesta del canario');
});

test('las sondas de la fase CLF: grupos correctos y suficientes para el veredicto', () => {
  const { abiertas, bloqueadas } = sondasClf('172.23.0.6');
  assert.ok(bloqueadas.length >= 8 && bloqueadas.every((c) => c.grupo === 'bloqueada' && !c.esperaEstado));
  assert.deepEqual(abiertas.filter((c) => c.grupo === 'publica').map((c) => c.id), ['clf|publica|webhook-publico', 'clf|publica|webhook-publico-https']);
  assert.ok(abiertas.filter((c) => /centinela/.test(c.id)).length === 2 && abiertas.every((c) => c.esperaEstado));
  assert.ok(bloqueadas.some((c) => /abierto/.test(c.ruta)), 'hay sondas contra el canario ABIERTO (las que ejecutarían el workflow si hubiera fuga)');
});

function datosOk() {
  const s = (id, grupo, delta = 0, linea = 'ausente') => ({ id, grupo, delta, ok: true, linea });
  return {
    sondas: [s('v0|control-contador|canario-abierto', 'control-canario', 1, 'presente'), s('v0|control-contador|webhook-publico', 'publica', 1, 'presente'),
      ...['v2a|clf|centinela-GET|healthz', 'v2a|clf|centinela-HEAD|healthz', 'v2b|clf|centinela-GET|healthz', 'v2b|clf|centinela-HEAD|healthz'].map((i) => s(i, 'sin-ejecucion', 0, 'presente')),
      ...Array.from({ length: 9 }, (_, i) => s(`v2|clf|bloq|${i}`, 'bloqueada')),
      s('v3|clf|publica|webhook-publico', 'publica', 1, 'presente'), s('v3|clf|publica|webhook-publico-https', 'publica', 1, 'presente'), s('v3|clf|publica|interfaz', 'sin-ejecucion', 0, 'presente')],
    reproduccion: { ok: true, ejecucionesN8nGeneradas: 0, ejecucionesDeLasRutasPublicasLegitimas: 2 },
    regla: { hashAntes: HASH_REGLA_VALIDADA, hashDespues: HASH_REGLA_VALIDADA, hashEnVolumen: HASH_REGLA_VALIDADA },
    informeOriginal: { esperado: 'a'.repeat(64), antes: 'a'.repeat(64), despues: 'a'.repeat(64) },
    existentesIntactos: true, proyectoLimpio: true, contexto: 'desktop-linux',
  };
}
test('veredicto de la verificación: superado con evidencias completas y NO superado ante cualquier desviación', () => {
  assert.deepEqual(veredictoVerificacionClf(datosOk()), { ok: true, fallos: [] });
  const sin = (f) => { const d = datosOk(); f(d); return veredictoVerificacionClf(d); };
  assert.equal(sin((d) => { d.sondas.find((x) => x.id === 'v2|clf|bloq|3').delta = 1; }).ok, false, 'una bloqueada ejecutó el canario');
  assert.equal(sin((d) => { d.sondas.find((x) => x.id === 'v0|control-contador|canario-abierto').delta = 0; }).ok, false, 'el contador no detecta ni el canario sin regla');
  assert.equal(sin((d) => { d.sondas.find((x) => x.id === 'v3|clf|publica|webhook-publico').delta = 0; }).ok, false, 'el público no ejecutó');
  assert.equal(sin((d) => { d.sondas.find((x) => /v2b.*HEAD/.test(x.id)).linea = 'ausente'; }).ok, false, 'un centinela sin línea CLF');
  assert.equal(sin((d) => { d.sondas[5].ok = false; }).ok, false);
  assert.equal(sin((d) => { d.reproduccion.ejecucionesDeLasRutasPublicasLegitimas = 1; }).ok, false);
  assert.equal(sin((d) => { d.reproduccion.ok = false; }).ok, false);
  assert.equal(sin((d) => { d.regla.hashEnVolumen = 'b'.repeat(64); }).ok, false, 'regla distinta en el volumen');
  assert.equal(sin((d) => { d.regla.hashDespues = 'b'.repeat(64); }).ok, false);
  assert.equal(sin((d) => { d.informeOriginal.despues = 'b'.repeat(64); }).ok, false, 'el informe original cambió');
  assert.equal(sin((d) => { d.existentesIntactos = false; }).ok, false, 'los contenedores preexistentes cambiaron');
  assert.equal(sin((d) => { d.proyectoLimpio = false; }).ok, false);
  assert.equal(sin((d) => { d.contexto = 'default'; }).ok, false);
});

test('ninguna orden que actúe sobre Docker se ejecuta sin autorización expresa (la guarda va ANTES de cualquier orden)', async () => {
  const antes = process.exitCode;
  for (const orden of ['verificar-clf', 'e0b', 'ejecutar', 'limpiar', 'descargar']) assert.equal(await principal([orden], {}), 3, orden);
  assert.equal(await principal(['verificar-clf'], { TAI_PRUEBA_TRAEFIK_AUTORIZADA: '0' }), 3);
  process.exitCode = antes;
  const fuente = fs.readFileSync(path.join(RAIZ, 'scripts', 'automation', 'prueba-traefik.mjs'), 'utf8');
  const iAut = fuente.indexOf('if (!autorizado(env))');
  for (const o of ["orden === 'e0b'", "orden === 'verificar-clf'", "orden === 'descargar'", "orden === 'limpiar'"]) assert.ok(fuente.indexOf(o, fuente.indexOf('export async function principal')) > iAut, `${o} debe ir después de la comprobación de autorización`);
});

// ───────────── Seguridad del lanzador (16/11/2026): destino Docker, autorización, limpieza única, señales y credenciales temporales. SIN Docker. ─────────────
const FUENTE = fs.readFileSync(path.join(RAIZ, 'scripts', 'automation', 'prueba-traefik.mjs'), 'utf8');
const cuerpoDe = (nombre) => { const i = FUENTE.search(new RegExp(`(async )?function ${nombre}\\(`)); assert.ok(i >= 0, `no existe ${nombre}`); const fin = FUENTE.indexOf('\n}\n', i); return FUENTE.slice(i, fin + 3); };
const SALIDAS_OK = { 'context show': 'desktop-linux\n', 'context inspect': 'npipe:////./pipe/dockerDesktopLinuxEngine\n', info: 'docker-desktop|inactive|Docker Desktop\n' };
const runner = (llamadas, cambios = {}) => (...a) => { llamadas.push(a.join(' ')); const k = a[0] === 'info' ? 'info' : `${a[0]} ${a[1]}`; const v = { ...SALIDAS_OK, ...cambios }[k]; if (v instanceof Error) throw v; return v; };

test('destino Docker: solo pasa con Docker Desktop local (contexto, endpoint, sin variables que redirijan y Swarm inactivo)', () => {
  const ll = [];
  assert.deepEqual(verificarDestinoDocker({ env: {}, ejecutar: runner(ll) }), { contexto: 'desktop-linux', endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine', servidor: 'docker-desktop', swarm: 'inactive', so: 'Docker Desktop' });
  assert.deepEqual(ll.map((x) => x.split(' ').slice(0, 2).join(' ')), ['context show', 'context inspect', 'info --format'], 'orden: contexto, endpoint y, solo entonces, el daemon');
  for (const k of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
    const l = []; assert.throws(() => verificarDestinoDocker({ env: { [k]: 'x' }, ejecutar: runner(l) }), /redirigir/, k); assert.equal(l.length, 0, `${k}: no debe contactar con Docker`);
  }
  assert.throws(() => verificarDestinoDocker({ env: { DOCKER_HOST: '' }, ejecutar: runner([]) }), /redirigir/, 'definida aunque vacía');
  const l3 = []; assert.throws(() => verificarDestinoDocker({ env: {}, ejecutar: runner(l3, { 'context show': 'vps\n' }) }), /contexto efectivo/);
  assert.ok(!l3.some((x) => x.startsWith('info')), 'con el contexto equivocado no se consulta el daemon');
  const l4 = []; assert.throws(() => verificarDestinoDocker({ env: {}, ejecutar: runner(l4, { 'context inspect': 'tcp://203.0.113.9:2376\n' }) }), /endpoint/);
  assert.ok(!l4.some((x) => x.startsWith('info')), 'con el endpoint equivocado no se consulta el daemon');
  assert.throws(() => verificarDestinoDocker({ env: {}, ejecutar: runner([], { info: 'docker-desktop|active|Docker Desktop\n' }) }), /Swarm/);
  assert.throws(() => verificarDestinoDocker({ env: {}, ejecutar: runner([], { info: 'vps|inactive|Ubuntu 24.04\n' }) }), /no es Docker Desktop/);
  assert.throws(() => verificarDestinoDocker({ env: {}, ejecutar: runner([], { info: new Error('daemon parado') }) }), /No se pudo verificar/);
  assert.throws(() => verificarDestinoDocker({ env: {}, ejecutar: runner([], { 'context show': new Error('sin docker') }) }), /No se pudo verificar/);
});

test('docker(): sin autorización solo pasan los subcomandos de lectura; con ella pasa lo demás', () => {
  const lectura = [['context', 'show'], ['context', 'inspect', 'x'], ['image', 'inspect', 'x'], ['network', 'ls'], ['network', 'inspect', 'x'], ['volume', 'ls'], ['volume', 'inspect', 'x'], ['info'], ['inspect', 'x'], ['ps', '-a'], ['logs', 'x'], ['version']];
  for (const a of lectura) assert.equal(permitirDocker(a, false), true, a.join(' '));
  const efectos = [['compose', 'up'], ['compose', 'down', '-v'], ['exec', 'x', 'sh'], ['cp', 'a', 'b'], ['restart', 'x'], ['pull', 'x'], ['rm', 'x'], ['stop', 'x'], ['start', 'x'], ['kill', 'x'], ['run', 'x'], ['network', 'rm', 'x'], ['network', 'create', 'x'], ['volume', 'rm', 'x'], ['volume', 'prune'], ['system', 'prune'], ['image', 'rm', 'x'], ['image', 'prune'], ['context', 'rm', 'x'], ['container', 'rm', 'x']];
  for (const a of efectos) { assert.equal(permitirDocker(a, false), false, `${a.join(' ')} sin autorización`); assert.equal(permitirDocker(a, true), true, `${a.join(' ')} con autorización`); }
  assert.match(FUENTE, /const docker = \(\.\.\.a\) => \{\s*\n\s*if \(!permitirDocker\(a, AUTORIZACION_CONCEDIDA\)\)/, 'docker() consulta la autorización antes de ejecutar');
  assert.match(FUENTE, /const dockerConEntrada = \(entrada, \.\.\.a\) => \{\s*\n\s*if \(!permitirDocker\(a, AUTORIZACION_CONCEDIDA\)\)/);
  assert.equal((FUENTE.match(/execFileSync\('docker'/g) ?? []).length, 2, 'solo los dos envoltorios llaman a docker');
  assert.ok(!/['"]prune['"]/.test(FUENTE), 'el lanzador nunca usa prune');
});

test('la autorización la concede un único punto (principal) y solo después de comprobar la variable', () => {
  assert.equal((FUENTE.match(/AUTORIZACION_CONCEDIDA = true/g) ?? []).length, 1);
  const p = FUENTE.indexOf('export async function principal');
  assert.ok(p >= 0 && FUENTE.indexOf('AUTORIZACION_CONCEDIDA = true') > FUENTE.indexOf('if (!autorizado(env))', p));
  for (const o of ["orden === 'e0b'", "orden === 'verificar-clf'", "orden === 'descargar'", "orden === 'limpiar'"]) assert.ok(FUENTE.indexOf(o, p) > FUENTE.indexOf('AUTORIZACION_CONCEDIDA = true'), o);
});

test('toda ruta con efectos comprueba autorización y destino ANTES de cualquier otra operación', () => {
  for (const f of ['ejecutar', 'verificarClf', 'limpiarComando', 'descargarImagen']) {
    const c = cuerpoDe(f);
    const i = c.indexOf('iniciarOperacionConEfectos()');
    assert.ok(i >= 0, `${f} no llama a iniciarOperacionConEfectos()`);
    const primera = c.search(/docker\(|compose\(|estadoDocker\(|preparar\(|marcarEjecucion\(|fs\./);
    assert.ok(primera === -1 || i < primera, `${f}: la verificación debe ir antes de cualquier otra operación`);
  }
  assert.match(FUENTE, /function iniciarOperacionConEfectos\(\) \{ exigirAutorizacion\(\); return verificarDestinoDocker\(\); \}/);
  assert.ok(!/antes\.contexto !== 'desktop-linux'/.test(FUENTE), 'la comprobación antigua (solo contexto y DOCKER_HOST) ya no sustituye a la completa');
});

test('no se crea nada sin comprobar recursos previos y escribir la marca; la limpieza solo la hace quien creó', () => {
  for (const f of ['ejecutar', 'verificarClf']) {
    const c = cuerpoDe(f);
    const iPre = c.indexOf('Quedan recursos de tai-prueba-tf'); const iMarca = c.indexOf('marcarEjecucion('); const iCreado = c.indexOf('ESTADO.creado = true'); const iUp = c.indexOf("compose(envF, 'up'");
    assert.ok(iPre >= 0 && iPre < iMarca && iMarca < iCreado && iCreado < iUp, `${f}: orden recursos previos → marca → creado → compose up`);
    assert.ok(c.indexOf('instalarSenales()') < iUp, `${f}: las señales se instalan antes de crear nada`);
    assert.ok(c.includes('limpiezaUnica()'), `${f} limpia con limpiezaUnica`);
  }
  assert.match(FUENTE, /flag: 'wx'/, 'la marca se escribe de forma atómica y falla si existe');
  const lineasLimpiar = FUENTE.split('\n').filter((l) => /limpiarProyecto\(\)/.test(l));
  assert.ok(lineasLimpiar.every((l) => /function limpiarProyecto\(\)|const ok = limpiarProyecto\(\);/.test(l)), 'limpiarProyecto solo se llama desde limpiezaUnica y limpiarComando');
  assert.ok(!/\blimpiar\(\)/.test(FUENTE), 'no queda ninguna llamada directa a la antigua limpiar()');
});

test('limpieza ÚNICA: solo si esta ejecución creó recursos, nunca dos veces ni de forma reentrante, aunque falle', () => {
  const e = { creado: false, limpiando: false, limpiada: false }; let n = 0;
  const l = crearLimpiezaUnica(e, () => { n++; });
  assert.equal(l(), false); assert.equal(n, 0, 'si no creó nada, no limpia (recursos ajenos intactos)');
  e.creado = true;
  assert.equal(l(), true); assert.equal(l(), false); assert.equal(n, 1);
  const e2 = { creado: true, limpiando: false, limpiada: false }; let m = 0; let reentrada = null;
  const l2 = crearLimpiezaUnica(e2, () => { m++; reentrada = l2(); });
  l2(); assert.equal(m, 1); assert.equal(reentrada, false, 'una señal durante la limpieza no la relanza');
  const e3 = { creado: true, limpiando: false, limpiada: false }; let k = 0;
  const l3 = crearLimpiezaUnica(e3, () => { k++; throw new Error('x'); });
  assert.throws(() => l3()); assert.equal(l3(), false); assert.equal(k, 1); assert.equal(e3.limpiada, true); assert.equal(e3.limpiando, false);
});

test('señales y recuperación: SIGINT/SIGTERM limpian una sola vez; hay última red en exit y vía manual segura', () => {
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) assert.ok(FUENTE.includes(`process.on('${s}'`), s);
  assert.ok(FUENTE.includes("process.on('exit'"));
  assert.match(FUENTE, /if \(ESTADO\.interrumpido\) return;/, 'una segunda señal no relanza la limpieza');
  assert.match(FUENTE, /if \(ESTADO\.finalizando\)/, 'una señal durante el cierre normal no lo corta');
  assert.deepEqual(ajenosAlProyecto(['tai-tf-db', 'tai-tf-x'], ['tai-tf-db']), ['tai-tf-x'], 'lo que no lleva la etiqueta de la prueba no es nuestro');
  const c = cuerpoDe('limpiarComando');
  assert.ok(c.indexOf('pidEnCursoSegunMarca()') < c.indexOf('limpiarProyecto()') && c.indexOf('recursosAjenos()') < c.indexOf('limpiarProyecto()'), 'limpiar se niega ante una ejecución viva o recursos ajenos ANTES de eliminar nada');
  assert.ok(FUENTE.includes('label=com.treidilor.prueba=traefik-aislamiento'));
  assert.ok((fs.readFileSync(path.join(RAIZ, 'automation', 'dev', 'prueba-traefik', 'docker-compose.yml'), 'utf8').match(/labels: \*etiqueta/g) ?? []).length >= 8, 'contenedores, redes y volúmenes del proyecto llevan la etiqueta');
});

test('el directorio de resultados nunca impide la limpieza y la credencial temporal no queda en disco', () => {
  const v = cuerpoDe('verificarClf');
  assert.match(v, /try \{ fs\.mkdirSync\(dir, \{ recursive: true \}\); dirOk = true; \}/, 'mkdirSync dentro de try');
  assert.ok(v.indexOf('fs.mkdirSync(dir') < v.indexOf('limpiezaUnica()'));
  assert.ok(!/\n    fs\.mkdirSync\(dir/.test(v), 'ningún mkdirSync suelto en el finally');
  const p = cuerpoDe('prepararN8n');
  assert.match(p, /mode: 0o600/); assert.match(p, /finally \{ try \{ fs\.rmSync\(f, \{ force: true \}\)/, 'el archivo se borra SIEMPRE, también si docker cp falla');
  assert.match(cuerpoDe('limpiarProyecto'), /credencial\.json', 'canario\.json'/, 'la limpieza manual también borra restos');
});

test('los tres contenedores preexistentes y el informe original no se tocan: ningún stop/start/rm/kill y el informe solo se lee', () => {
  assert.ok(!/docker\('(stop|start|rm|kill|run|create|pause|unpause|update)'/.test(FUENTE));
  assert.deepEqual([...FUENTE.matchAll(/docker\('restart', '([^']+)'/g)].map((m) => m[1]).sort(), ['tai-tf-n8n', 'tai-tf-traefik']);
  const v = cuerpoDe('verificarClf');
  assert.ok(!/writeFileSync\(INFORME_E0B_ORIGINAL|rmSync\(INFORME_E0B_ORIGINAL|renameSync\(INFORME_E0B_ORIGINAL/.test(v));
  assert.match(v, /existentesIntactos/); assert.match(v, /hashInformeDespues/);
});
