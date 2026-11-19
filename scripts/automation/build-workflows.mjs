#!/usr/bin/env node
// CONSTRUCTOR de workflows de n8n a partir del código probado de `automation/lib` («workflows como código»).
// El código de los agentes vive en módulos puros con pruebas; este script lo INCRUSTA en los nodos «Code» y escribe el JSON normalizado.
// Así el JSON que se importa a n8n es exactamente el código que han probado las pruebas automáticas.
//
//   node scripts/automation/build-workflows.mjs --write     escribe automation/workflows/*.json
//   node scripts/automation/build-workflows.mjs --check     falla si los JSON no coinciden con lo que se construiría (sincronía)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { idNodo, normalizarWorkflow, serializar } from './normalize-workflow.mjs';
import { COLUMNAS_INSTANTANEAS } from '../../automation/lib/seguimiento.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(RAIZ, 'automation', 'lib');
const CONFIG = path.join(RAIZ, 'automation', 'config');
const SALIDA = path.join(RAIZ, 'automation', 'workflows');

/** Módulos que se incrustan, en orden de dependencia. */
const ORDEN = { auditor: ['common', 'urlPolicy', 'seguimiento', 'auditor'], investigador: ['common', 'urlPolicy', 'seguimiento', 'auditor', 'researcher'], diagnostico: ['common', 'urlPolicy', 'seguimiento', 'auditor', 'diagnostico'], calidad: ['common', 'urlPolicy', 'seguimiento', 'auditor', 'urlPolicyCalidad', 'calidadCatalogo'], lector: ['seguimiento', 'lectorPuente'] };

/** Lee un módulo de `automation/lib` y le quita `import`, `export` y los comentarios de línea completa (documentación del módulo; no cambian el comportamiento). */
function leerModulo(nombre, lib = LIB) {
  const texto = fs.readFileSync(path.join(lib, `${nombre}.mjs`), 'utf8').replace(/\r\n/g, '\n');
  return texto
    .replace(/^import\s+[^;]*?from\s+'\.\/[A-Za-z]+\.mjs';\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n?/gm, '')
    .replace(/^[ \t]*\/\/.*\n?/gm, '');
}

/**
 * Sin sangrías, espacios finales ni líneas en blanco (los módulos no tienen plantillas ni cadenas multilínea: hay una prueba que lo comprueba). Cada nodo Code lleva su propia copia
 * de lo que necesita y debe quedar bajo el límite de 80 kB del linter; el código ejecutado es el mismo.
 */
const compactar = (texto) => texto.replace(/^[ \t]+/gm, '').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim();

export function fuenteModulo(nombre, lib = LIB) {
  return compactar(leerModulo(nombre, lib));
}

/**
 * PODA: de las bibliotecas sólo se incrusta en cada nodo Code lo que ese nodo alcanza. Se parte el paquete en declaraciones de primer nivel (líneas en columna 0 que empiezan por
 * function, const, let o class) y se conservan las que se mencionan, directa o indirectamente, desde el código propio del nodo («raíces»). Es CONSERVADORA: cualquier aparición de un
 * nombre (también dentro de una cadena o como propiedad) cuenta como referencia, de modo que sólo se descarta lo que seguro no se usa.
 */
export function podar(paquete, raices) {
  const re = /^(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|(?:const|let|class)\s+([A-Za-z_$][\w$]*))/;
  const bloques = [];
  let actual = { nombre: null, lineas: [] };
  for (const linea of paquete.split('\n')) {
    const m = linea.match(re);
    if (m) { bloques.push(actual); actual = { nombre: m[1] ?? m[2], lineas: [linea] }; } else actual.lineas.push(linea);
  }
  bloques.push(actual);
  const nombres = new Set(bloques.filter((b) => b.nombre).map((b) => b.nombre));
  const mencionados = (texto) => (texto.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((x) => nombres.has(x));
  const vivos = new Set();
  const pila = [...mencionados(raices)];
  while (pila.length) {
    const n = pila.pop();
    if (vivos.has(n)) continue;
    vivos.add(n);
    for (const b of bloques) if (b.nombre === n) pila.push(...mencionados(b.lineas.join('\n')).filter((x) => !vivos.has(x)));
  }
  return bloques.filter((b) => !b.nombre || vivos.has(b.nombre)).map((b) => b.lineas.join('\n')).join('\n');
}

/** Paquete de módulos de un agente. Con `raices` (el código propio del nodo) se poda lo que el nodo no alcanza; sin ellas se incrusta todo. */
export function empaquetar(agente, raices = null, lib = LIB) {
  const crudo = ORDEN[agente].map((m) => leerModulo(m, lib)).join('\n\n');
  return compactar(raices === null ? crudo : podar(crudo, raices));
}

const leerConfig = (entorno) => JSON.parse(fs.readFileSync(path.join(CONFIG, `${entorno}.json`), 'utf8'));

const AYUDA = "const nodo = (n) => { try { return $(n).all().map((i) => i.json); } catch (e) { return []; } };\nconst items = (lista) => lista.map((t) => ({ json: t }));";

function codigo(agente, cfg, adaptador) {
  const guardia = "{ const errAislamiento = validarAislamiento(CONFIG); if (errAislamiento.length) throw new Error('AISLAMIENTO: ' + errAislamiento.join('; ')); }";
  return `${empaquetar(agente, `${guardia}\n${AYUDA}\n${adaptador}`)}\n\n// ── adaptador del nodo ──\nconst CONFIG = ${JSON.stringify(cfg, null, 2)};\n${guardia}\n${AYUDA}\n${adaptador}\n`;
}

const nodoCode = (nombre, js, pos) => ({ parameters: { jsCode: js }, name: nombre, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos });
const nodoManual = (pos) => ({ parameters: {}, name: 'Ejecutar a mano', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: pos });
/** Pausa FIJA entre la primera página y el resto (nodo Wait, intervalo en segundos): garantiza ≥ pausaMs entre TODAS las peticiones GET. Menos de 65 s: n8n la espera en memoria. */
const nodoEspera = (nombre, pos, ms) => ({ parameters: { resume: 'timeInterval', amount: Math.ceil(ms / 1000), unit: 'seconds' }, name: nombre, type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: pos });
const nota = (texto, pos) => ({ parameters: { content: texto, height: 220, width: 420 }, name: 'Aviso', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: pos });
function nodoHttp(nombre, agente, pos, credencial, ajustes = {}) {
  const n = {
    parameters: {
      method: 'GET',
      url: '={{ $json.url }}',
      authentication: credencial ? 'genericCredentialType' : 'none',
      ...(credencial ? { genericAuthType: 'httpHeaderAuth' } : {}),
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: `TreidilorAI-${agente}/${ajustes.version ?? '0.2'} (solo lectura)` }, { name: 'X-Treidilor-Agente', value: agente }] },
      options: {
        timeout: 15000,
        redirect: { redirect: { followRedirects: false } },
        batching: { batch: { batchSize: 1, batchInterval: ajustes.pausaMs ?? 700 } },
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } },
      },
    },
    name: nombre,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: pos,
    onError: 'continueRegularOutput',
    retryOnFail: false,
  };
  if (credencial) n.credentials = { httpHeaderAuth: { id: 'REEMPLAZAR_AL_IMPORTAR', name: credencial } };
  return n;
}

/**
 * Nodos «Data table» de n8n (memoria del Auditor, entrega 2c). La tabla se referencia SIEMPRE por NOMBRE (nunca por id: los ids son de cada instalación) y sólo se usan tres operaciones:
 * listar tablas (comprobar que la tabla existe y es única), leer filas (Get) e insertar filas (Insert). Nada de update, upsert, borrado ni vaciado.
 */
const TIPO_DT = 'n8n-nodes-base.dataTable';
const VERSION_DT = 1.1;
const refTabla = (nombre) => ({ __rl: true, mode: 'name', value: nombre });
const esquemaDt = COLUMNAS_INSTANTANEAS.map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }));
function nodoDt(nombre, pos, cfg, operacion) {
  const tabla = cfg.seguimiento.tabla;
  const base = { name: nombre, type: TIPO_DT, typeVersion: VERSION_DT, position: pos };
  if (operacion === 'listar') return { parameters: { resource: 'table', operation: 'list', returnAll: true, options: { filterName: tabla } }, ...base, onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: false };
  if (operacion === 'leer') {
    return {
      parameters: {
        resource: 'row', operation: 'get', dataTableId: refTabla(tabla), matchType: 'allConditions',
        filters: { conditions: [{ keyName: 'entorno', condition: 'eq', keyValue: cfg.entorno }] },
        returnAll: false, limit: cfg.seguimiento.maxHistorial, orderBy: true, orderByColumn: 'generadoEn', orderByDirection: 'DESC',
      },
      ...base, onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: false,
    };
  }
  // insertar: SIN reintentos automáticos (un reintento podría duplicar la fila). Con `continueErrorOutput` los errores de n8n (p. ej. tabla inexistente) salen por la segunda salida;
  // pero la Data table devuelve SIN error el elemento de entrada cuando falla una validación (columna desconocida), así que la escritura sólo se da por buena con la fila devuelta
  // (nodo «Confirmar escritura», que recibe las dos salidas). Un fallo no detiene el informe.
  return {
    parameters: {
      resource: 'row', operation: 'insert', dataTableId: refTabla(tabla),
      columns: { mappingMode: 'defineBelow', value: Object.fromEntries(COLUMNAS_INSTANTANEAS.map((c) => [c, `={{ $json.${c} }}`])), matchingColumns: [], schema: esquemaDt },
      options: {},
    },
    ...base, onError: 'continueErrorOutput', retryOnFail: false,
  };
}

function cadena(nombres) {
  const c = {};
  nombres.slice(0, -1).forEach((n, i) => { c[n] = { main: [[{ node: nombres[i + 1], type: 'main', index: 0 }]] }; });
  return c;
}

const AJUSTES = { executionOrder: 'v1', timezone: 'Europe/Madrid', executionTimeout: 900, saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' };

const AVISO_BASE = 'TREIDILOR AI · SÓLO LECTURA.\nEste workflow NO escribe en Treidilor: sólo hace peticiones GET a URLs que fija el código con la política de URLs (nunca salida de afiliado, API de escritura, panel ni fichas en producción).\nSe genera desde automation/lib con scripts/automation/build-workflows.mjs: no se edita a mano.\nSe activa/programa SÓLO a mano y con autorización.';

function auditor(entorno) {
  const cfg = leerConfig(entorno);
  const completo = cfg.modo === 'completo';
  const pasos = [
    ['Objetivos', 'return items(crearObjetivosRutas(CONFIG));'],
    ['Pedir rutas', null],
    ['Enlaces a revisar', "return items(crearObjetivosEnlaces(nodo('Objetivos'), nodo('Pedir rutas'), CONFIG));"],
    ['Pedir enlaces', null],
  ];
  if (completo) {
    pasos.push(['Páginas de catálogo', 'return items(crearObjetivosCatalogo(CONFIG));']);
    pasos.push(['Pedir catálogo', null, cfg.credencialCatalogo]);
    pasos.push(['Páginas restantes', "return items(crearObjetivosCatalogoResto(nodo('Páginas de catálogo'), nodo('Pedir catálogo'), CONFIG));"]);
    pasos.push(['Pedir catálogo (resto)', null, cfg.credencialCatalogo]);
    pasos.push(['Fichas de muestra', "const cat = leerCatalogo([...nodo('Páginas de catálogo'), ...nodo('Páginas restantes')], [...nodo('Pedir catálogo'), ...nodo('Pedir catálogo (resto)')]);\nreturn items(crearObjetivosFichas(cat.productos, CONFIG));"]);
    pasos.push(['Pedir fichas', null]);
  }
  const lecturas = completo
    ? "objetivosCatalogo: nodo('Páginas de catálogo'), respuestasCatalogo: nodo('Pedir catálogo'), objetivosCatalogoResto: nodo('Páginas restantes'), respuestasCatalogoResto: nodo('Pedir catálogo (resto)'), objetivosFichas: nodo('Fichas de muestra'), respuestasFichas: nodo('Pedir fichas'),"
    : '';
  // Memoria (2c): comprobar la tabla → un solo elemento → leer el historial → Informe → quedarse sólo con la fila a guardar → insertarla.
  // «Uno tabla»: List se ejecuta UNA VEZ POR CADA elemento de entrada (la entrada son las respuestas de todos los enlaces): sin este Code devolvería la tabla repetida N veces.
  pasos.push(['Uno tabla', 'return [{ json: {} }];', undefined, 'pequeno']);
  pasos.push(['Comprobar tabla', null, undefined, 'dt-listar']);
  pasos.push(['Uno historial', 'return [{ json: {} }];', undefined, 'pequeno']);
  pasos.push(['Leer historial', null, undefined, 'dt-leer']);
  pasos.push(['Informe', `const resultado = construirInformeYFila({
  cfg: CONFIG,
  objetivosRutas: nodo('Objetivos'), respuestasRutas: nodo('Pedir rutas'),
  objetivosEnlaces: nodo('Enlaces a revisar'), respuestasEnlaces: nodo('Pedir enlaces'),
  ${lecturas}
  ahoraIso: new Date().toISOString(),
  persistencia: { tablas: nodo('Comprobar tabla'), historial: nodo('Leer historial'), idEjecucion: 'ex-' + String($execution.id), origen: origenDeModo($execution.mode) },
});
return [{ json: resultado.informe }].concat(resultado.fila ? [{ json: Object.assign({ tipo: 'fila' }, resultado.fila) }] : []);`]);
  pasos.push(['Solo la fila', "return $input.all().filter((i) => i.json.tipo === 'fila');", undefined, 'pequeno']);
  pasos.push(['Guardar instantánea', null, undefined, 'dt-insertar']);
  // Confirmar escritura: recibe las DOS salidas del Insert (correcta y de error) y completa el informe con el resultado real de la escritura.
  pasos.push(['Confirmar escritura', "const informe = nodo('Informe')[0];\nreturn [{ json: confirmarEscritura(informe, $input.all().map((i) => i.json)) }];"]);
  const nombre = `Treidilor AI · Auditor General v0 (${entorno})`;
  const nodos = [nodoManual([0, 0]), nota(`${AVISO_BASE}\nEntorno: ${entorno} · modo: ${cfg.modo}.${completo ? '\nCredencial necesaria (sólo lectura): «' + cfg.credencialCatalogo + '» (Header Auth).' : '\nSin credenciales.'}\nMEMORIA: lee e inserta instantáneas en la Data Table «${cfg.seguimiento.tabla}» de n8n (créala antes con el workflow «Auditor · crear tabla de instantáneas»). No escribe en Treidilor.`, [0, -300])];
  pasos.forEach(([n, js, cred, tipo], i) => {
    const pos = [260 * (i + 1), 0];
    if (tipo === 'dt-listar') nodos.push(nodoDt(n, pos, cfg, 'listar'));
    else if (tipo === 'dt-leer') nodos.push(nodoDt(n, pos, cfg, 'leer'));
    else if (tipo === 'dt-insertar') nodos.push(nodoDt(n, pos, cfg, 'insertar'));
    else if (tipo === 'pequeno') nodos.push(nodoCode(n, js, pos));
    else nodos.push(js === null ? nodoHttp(n, 'auditor-general', pos, cred ?? null) : nodoCode(n, codigo('auditor', cfg, js), pos));
  });
  const conexiones = cadena(['Ejecutar a mano', ...pasos.map((p) => p[0])]);
  conexiones['Guardar instantánea'] = { main: [[{ node: 'Confirmar escritura', type: 'main', index: 0 }], [{ node: 'Confirmar escritura', type: 'main', index: 0 }]] };
  return { name: nombre, nodes: nodos, connections: conexiones, active: false, settings: AJUSTES, tags: [] };
}

/** Workflow de PREPARACIÓN (se ejecuta una vez a mano en cada n8n): crea la tabla de instantáneas, con las columnas del historial, si no existe. */
function crearTablaInstantaneas() {
  const cfg = leerConfig('produccion');
  const nodos = [
    nodoManual([0, 0]),
    nota('TREIDILOR AI · PREPARACIÓN de la memoria del Auditor.\nCrea (si no existe) la Data Table «' + cfg.seguimiento.tabla + '» con las columnas del historial de instantáneas.\nSe ejecuta UNA vez a mano en cada instalación de n8n. No hace peticiones, no usa credenciales y no borra nada.', [0, -300]),
    { parameters: { resource: 'table', operation: 'create', tableName: cfg.seguimiento.tabla, columns: { column: COLUMNAS_INSTANTANEAS.map((name) => ({ name, type: 'string' })) }, options: { createIfNotExists: true } }, name: 'Crear tabla de instantáneas', type: TIPO_DT, typeVersion: VERSION_DT, position: [260, 0], retryOnFail: false },
  ];
  return { name: 'Treidilor AI · Auditor · crear tabla de instantáneas', nodes: nodos, connections: cadena(['Ejecutar a mano', 'Crear tabla de instantáneas']), active: false, settings: AJUSTES, tags: [] };
}

/**
 * Agente 04 — Calidad del catálogo (v0 «detectar»). Código de los nodos «Code»: la biblioteca podada por nodo + el adaptador. La guardia comprueba el aislamiento Y la política
 * `lectura_catalogo` (host único, GET, limit/page, límites del cliente) antes de hacer ninguna petición. Separación en tres nodos pesados para respetar los 80 kB por nodo:
 * «Analizar» (feed + reglas), «Informe» (seguimiento + informe) y «Confirmar escritura».
 */
function codigoCalidad(cfg, adaptador) {
  // En producción la guardia añade `validarProduccionCalidad` (host exacto, límites del cliente, credencial obligatoria); el workflow local NO la lleva (ni menciona el dominio real).
  const extra = cfg.entorno === 'produccion' ? '.concat(validarProduccionCalidad(CONFIG))' : '';
  const guardia = `{ const errCfg = validarAislamiento(CONFIG).concat(validarConfigCalidad(CONFIG))${extra}; if (errCfg.length) throw new Error('CONFIGURACIÓN: ' + errCfg.join('; ')); }`;
  return `${empaquetar('calidad', `${guardia}\n${AYUDA}\n${adaptador}`)}\n\n// ── adaptador del nodo ──\nconst CONFIG = ${JSON.stringify(cfg, null, 2)};\n${guardia}\n${AYUDA}\n${adaptador}\n`;
}

function calidad(entorno) {
  const cfg = leerConfig(`calidad.${entorno}`);
  const ajustes = { version: '0.1', pausaMs: cfg.pausaMs };
  const pasos = [
    ['Configuración', 'return items(crearObjetivosCalidad(CONFIG));'],
    ['Pedir catálogo', null, cfg.credencialCatalogo],
    ['Páginas restantes', "return items(crearObjetivosCalidadResto(nodo('Configuración'), nodo('Pedir catálogo'), CONFIG));"],
    // Wait: la 1.ª y la 2.ª petición están en nodos distintos (el batching del HTTP sólo espaciaba las de un mismo nodo). Con una sola página la pausa también precede al marcador (sin parada silenciosa).
    ['Pausa entre páginas', null, undefined, 'espera'],
    ['Pedir catálogo (resto)', null, cfg.credencialCatalogo],
    // Una sola «hora» para todo el análisis: se fija aquí y la reutiliza el nodo Informe.
    ['Analizar', "const feed = leerFeedCalidad([...nodo('Configuración'), ...nodo('Páginas restantes')], [...nodo('Pedir catálogo'), ...nodo('Pedir catálogo (resto)')], CONFIG);\nconst ahoraIso = new Date().toISOString();\nreturn [{ json: { feed, analisis: analizarCalidad(feed, CONFIG, ahoraIso), ahoraIso } }];"],
    ['Uno tabla', 'return [{ json: {} }];', undefined, 'pequeno'],
    ['Comprobar tabla', null, undefined, 'dt-listar'],
    ['Uno historial', 'return [{ json: {} }];', undefined, 'pequeno'],
    ['Leer historial', null, undefined, 'dt-leer'],
    ['Informe', `const entrada = nodo('Analizar')[0];
const resultado = construirInformeDesdeAnalisis({
  cfg: CONFIG, feed: entrada.feed, analisis: entrada.analisis, ahoraIso: entrada.ahoraIso,
  persistencia: { tablas: nodo('Comprobar tabla'), historial: nodo('Leer historial'), idEjecucion: 'ex-' + String($execution.id), origen: origenDeModo($execution.mode) },
});
return [{ json: resultado.informe }].concat(resultado.fila ? [{ json: Object.assign({ tipo: 'fila' }, resultado.fila) }] : []);`],
    ['Solo la fila', "return $input.all().filter((i) => i.json.tipo === 'fila');", undefined, 'pequeno'],
    ['Guardar instantánea', null, undefined, 'dt-insertar'],
    ['Confirmar escritura', "const informe = nodo('Informe')[0];\nreturn [{ json: confirmarEscrituraCalidad(informe, $input.all().map((i) => i.json)) }];"],
  ];
  const aviso = `TREIDILOR AI · AGENTE 04 · CALIDAD DEL CATÁLOGO (detectar). SÓLO LECTURA.\nSólo lee el feed automation-catalog/1 con peticiones GET (sólo limit y page, sin redirecciones) a un único host. NO escribe en Treidilor, no usa IA ni APIs de pago y no modifica ninguna ficha.\nSe genera desde automation/lib con scripts/automation/build-workflows.mjs: no se edita a mano. Se activa/programa SÓLO a mano y con autorización.\nEntorno: ${entorno} · modo: ${cfg.modo}. Credencial necesaria (sólo lectura): «${cfg.credencialCatalogo}» (Header Auth), creada a mano en n8n: el token NUNCA va en este archivo.\nMEMORIA: lee e inserta instantáneas en la Data Table «${cfg.seguimiento.tabla}» (créala antes con el workflow «Calidad · crear tabla de instantáneas»). Sólo se guardan ejecuciones COMPLETAS.\nPAUSA: un nodo Wait de ${Math.ceil(cfg.pausaMs / 1000)} s separa la 1.ª página del resto; el batching del HTTP separa las demás.${entorno === 'produccion' ? `
PRODUCCIÓN · INACTIVO: sin Schedule ni webhooks; se lanza SÓLO a mano y con autorización. Límites del cliente de la API: ${cfg.peticionesPorMinuto} peticiones/minuto, 500/día, ${cfg.maxPaginasCatalogo} páginas como máximo y ${cfg.pausaMs / 1000} s de pausa entre CUALESQUIERA dos peticiones (Wait entre la página 1 y el resto; batching entre las demás). Deja al menos 2 minutos entre dos ejecuciones manuales.` : ''}`;
  const nodos = [nodoManual([0, 0]), nota(aviso, [0, -300])];
  pasos.forEach(([n, js, cred, tipo], i) => {
    const pos = [260 * (i + 1), 0];
    if (tipo === 'dt-listar') nodos.push(nodoDt(n, pos, cfg, 'listar'));
    else if (tipo === 'dt-leer') nodos.push(nodoDt(n, pos, cfg, 'leer'));
    else if (tipo === 'dt-insertar') nodos.push(nodoDt(n, pos, cfg, 'insertar'));
    else if (tipo === 'pequeno') nodos.push(nodoCode(n, js, pos));
    else if (tipo === 'espera') nodos.push(nodoEspera(n, pos, cfg.pausaMs));
    else nodos.push(js === null ? nodoHttp(n, 'calidad-catalogo', pos, cred ?? null, ajustes) : nodoCode(n, codigoCalidad(cfg, js), pos));
  });
  const conexiones = cadena(['Ejecutar a mano', ...pasos.map((p) => p[0])]);
  conexiones['Guardar instantánea'] = { main: [[{ node: 'Confirmar escritura', type: 'main', index: 0 }], [{ node: 'Confirmar escritura', type: 'main', index: 0 }]] };
  return { name: `Treidilor AI · Calidad del catálogo v0 (${entorno})`, nodes: nodos, connections: conexiones, active: false, settings: AJUSTES, tags: [] };
}

/** Workflow de PREPARACIÓN de la memoria del Agente 04 (se ejecuta una vez a mano en cada n8n): crea SU tabla de instantáneas, con las columnas del historial, si no existe. */
function crearTablaCalidad() {
  const cfg = leerConfig('calidad.local');
  const nodos = [
    nodoManual([0, 0]),
    nota(`TREIDILOR AI · PREPARACIÓN de la memoria del Agente 04 (Calidad del catálogo).\nCrea (si no existe) la Data Table «${cfg.seguimiento.tabla}», EXCLUSIVA de este agente, con las columnas del historial de instantáneas.\nSe ejecuta UNA vez a mano en cada instalación de n8n. No hace peticiones, no usa credenciales y no borra nada.`, [0, -300]),
    { parameters: { resource: 'table', operation: 'create', tableName: cfg.seguimiento.tabla, columns: { column: COLUMNAS_INSTANTANEAS.map((name) => ({ name, type: 'string' })) }, options: { createIfNotExists: true } }, name: 'Crear tabla de instantáneas', type: TIPO_DT, typeVersion: VERSION_DT, position: [260, 0] },
  ];
  return { name: 'Treidilor AI · Calidad · crear tabla de instantáneas', nodes: nodos, connections: cadena(['Ejecutar a mano', 'Crear tabla de instantáneas']), active: false, settings: AJUSTES, tags: [] };
}

function investigador(entorno) {
  const cfg = leerConfig(entorno);
  if (cfg.modo !== 'completo') throw new Error('El investigador necesita el feed del catálogo (modo completo)');
  const nombre = `Treidilor AI · Investigador comercial v0 (${entorno})`;
  const nodos = [
    nodoManual([0, 0]),
    nota(`${AVISO_BASE}\nEntorno: ${entorno}. Credencial necesaria (sólo lectura): «${cfg.credencialCatalogo}» (Header Auth).\nLos descuentos que muestra son los DECLARADOS por la fuente y NO están verificados.`, [0, -300]),
    nodoCode('Páginas de catálogo', codigo('investigador', cfg, 'return items(crearObjetivosCatalogo(CONFIG));'), [260, 0]),
    nodoHttp('Pedir catálogo', 'investigador-comercial', [520, 0], cfg.credencialCatalogo),
    nodoCode('Páginas restantes', codigo('investigador', cfg, "return items(crearObjetivosCatalogoResto(nodo('Páginas de catálogo'), nodo('Pedir catálogo'), CONFIG));"), [780, 0]),
    nodoHttp('Pedir catálogo (resto)', 'investigador-comercial', [1040, 0], cfg.credencialCatalogo),
    nodoCode('Informe', codigo('investigador', cfg, "const informe = construirInformeInvestigador({ cfg: CONFIG, objetivosCatalogo: nodo('Páginas de catálogo'), respuestasCatalogo: nodo('Pedir catálogo'), objetivosCatalogoResto: nodo('Páginas restantes'), respuestasCatalogoResto: nodo('Pedir catálogo (resto)'), ahoraIso: new Date().toISOString() });\nreturn [{ json: informe }];"), [1300, 0]),
  ];
  return { name: nombre, nodes: nodos, connections: cadena(['Ejecutar a mano', 'Páginas de catálogo', 'Pedir catálogo', 'Páginas restantes', 'Pedir catálogo (resto)', 'Informe']), active: false, settings: AJUSTES, tags: [] };
}

/**
 * Diagnóstico previo a importar el Auditor en una instancia de n8n (autocontenido: SIN red ni credenciales). Un nodo Code ejecuta el código real del
 * Auditor con respuestas sintéticas. Incluye un nodo HTTP DESHABILITADO y sin conexiones: no se ejecuta, pero al importar permite ver si esa versión de
 * n8n reconoce los tipos/versiones de nodo que usa el Auditor (un nodo desconocido se muestra con «?»).
 */
function diagnosticoAuditorProduccion() {
  const cfg = leerConfig('produccion');
  const nodos = [
    nodoManual([0, 0]),
    nota('TREIDILOR AI · DIAGNÓSTICO DEL ENTORNO (sin red, sin credenciales).\nEjecuta el código del Auditor con datos sintéticos. NO hace ninguna petición.\nResultado en el nodo «Diagnóstico»: campo «resultado» = OK, y «fallos» vacío.\nEl nodo «Prueba de versión (deshabilitado)» no se ejecuta: sólo comprueba que esta versión de n8n reconoce el nodo HTTP 4.2 (si aparece con «?», NO es compatible).', [0, -300]),
    nodoCode('Diagnóstico', codigo('diagnostico', cfg, 'return [{ json: ejecutarDiagnostico(CONFIG, new Date().toISOString()) }];'), [260, 0]),
    { ...nodoHttp('Prueba de versión (deshabilitado)', 'auditor-general', [260, 260], null), disabled: true },
  ];
  return { name: 'Treidilor AI · Diagnóstico del entorno (Auditor, sin red)', nodes: nodos, connections: cadena(['Ejecutar a mano', 'Diagnóstico']), active: false, settings: AJUSTES, tags: [] };
}

/**
 * LECTOR COMPARTIDO de instantáneas (puente Director ↔ n8n). SÓLO CONSULTA: cada agente (04, 12) tiene su propio Webhook POST protegido con credencial Header Auth (por nombre) que
 * valida la solicitud con la función COMPARTIDA con el Director (`lectorPuente.mjs`), lee con un nodo Data table `row/get` de UNA tabla fija y responde con las filas. No escribe,
 * no hace peticiones salientes, no decide ni aprueba nada. Sólo variante LOCAL (datos de prueba): no hay variante de producción autorizada.
 */
const CREDENCIAL_LECTOR = 'Treidilor — Lector puente (solo lectura)';
const TABLAS_LECTOR_WF = { '04': 'calidad_catalogo_instantaneas', '12': 'auditor_general_instantaneas' };
function codigoLector(config, adaptador) {
  return `${empaquetar('lector', adaptador)}\n\n// ── adaptador del nodo ──\nconst LECTOR = ${JSON.stringify(config, null, 2)};\n${AYUDA}\n${adaptador}\n`;
}
function lectorInstantaneas(entorno) {
  if (entorno !== 'local') throw new Error('El lector compartido sólo existe en la variante local (datos de prueba)');
  const nodos = [nota('TREIDILOR AI · LECTOR COMPARTIDO DE INSTANTÁNEAS (puente Director ↔ n8n). SÓLO CONSULTA.\nDos Webhooks POST (tai-lector-04 y tai-lector-12), cada uno con credencial «' + CREDENCIAL_LECTOR + '» (Header Auth, creada a mano en n8n: el valor NUNCA va en este archivo).\nLee UNA tabla fija por agente con Data table «Get». No escribe, no hace peticiones salientes y NO aprueba ni decide nada: las autorizaciones permanecen en el Director.\nNo se publica en Internet: n8n sólo escucha en la red interna y el Director lo consulta desde la misma máquina. Variante LOCAL (datos de prueba).\nSe genera con scripts/automation/build-workflows.mjs: no se edita a mano. Se activa SÓLO a mano y con autorización.', [0, -420])];
  const conexiones = {};
  let fila = 0;
  for (const agente of ['04', '12']) {
    const config = { agente, tabla: TABLAS_LECTOR_WF[agente], entornos: [entorno], sintetico: true };
    const y = 260 * fila;
    const r = `Recibir (${agente})`; const v = `Validar solicitud (${agente})`; const l = `Leer instantáneas (${agente})`; const a = `Armar respuesta (${agente})`; const o = `Responder (${agente})`;
    nodos.push(
      { parameters: { httpMethod: 'POST', path: `tai-lector-${agente}`, authentication: 'headerAuth', responseMode: 'responseNode', options: {} }, name: r, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, y], credentials: { httpHeaderAuth: { id: 'REEMPLAZAR_AL_IMPORTAR', name: CREDENCIAL_LECTOR } } },
      nodoCode(v, codigoLector(config, "const entrada = $input.first().json;\nconst r = validarSolicitudLector(entrada.body, { agentes: [LECTOR.agente], entornos: LECTOR.entornos });\nif (!r.ok) throw new Error('SOLICITUD NO VÁLIDA: ' + r.errores.join('; '));\nreturn [{ json: r.solicitud }];"), [260, y]),
      { parameters: { resource: 'row', operation: 'get', dataTableId: refTabla(config.tabla), matchType: 'allConditions', filters: { conditions: [{ keyName: 'entorno', condition: 'eq', keyValue: '={{ $json.entorno }}' }] }, returnAll: false, limit: 60, orderBy: true, orderByColumn: 'generadoEn', orderByDirection: 'DESC' }, name: l, type: TIPO_DT, typeVersion: VERSION_DT, position: [520, y], onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: false },
      nodoCode(a, codigoLector(config, `const solicitud = nodo('${v}')[0];\nconst crudas = $input.all().map((i) => i.json);\nif (crudas.some((f) => f && f.error)) throw new Error('LECTURA FALLIDA: la tabla no se pudo leer');\nreturn [{ json: armarRespuestaLector({ solicitud, filas: crudas, ahoraIso: new Date().toISOString(), sintetico: LECTOR.sintetico }) }];`), [780, y]),
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseCode: 200 } }, name: o, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1040, y] },
    );
    Object.assign(conexiones, cadena([r, v, l, a, o]));
    fila += 1;
  }
  return { name: `Treidilor AI · Lector compartido de instantáneas (${entorno})`, nodes: nodos, connections: conexiones, active: false, settings: { ...AJUSTES, executionTimeout: 60, saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' }, tags: [] };
}

export const DIAGNOSTICOS = { 'diagnostico-auditor-produccion.json': () => diagnosticoAuditorProduccion() };
export const construirDiagnosticos = () => Object.fromEntries(Object.entries(DIAGNOSTICOS).map(([f, fn]) => [f, serializar(normalizarWorkflow(fn()))]));

export const FABRICA = {
  'auditor-general.local.json': () => auditor('local'),
  'auditor-general.produccion.json': () => auditor('produccion'),
  'investigador-comercial.local.json': () => investigador('local'),
  'auditor-instantaneas-crear-tabla.json': () => crearTablaInstantaneas(),
  'calidad-catalogo.local.json': () => calidad('local'),
  'calidad-catalogo.produccion.json': () => calidad('produccion'),
  'calidad-instantaneas-crear-tabla.json': () => crearTablaCalidad(),
};

/** Workflows del PUENTE Director ↔ n8n: carpeta PROPIA (`automation/workflows-puente`) para no alterar el conjunto controlado de los siete workflows de `automation/workflows`. */
export const SALIDA_PUENTE = path.join(RAIZ, 'automation', 'workflows-puente');
export const FABRICA_PUENTE = {
  'lector-instantaneas.local.json': () => lectorInstantaneas('local'),
};
/**
 * El normalizador quita `webhookId` de todos los nodos; sin él n8n registra la ruta como «<idWorkflow>/<nodo>/<path>» (distinta en cada instalación) y el Director no podría
 * llamar a `tai-lector-XX`. Se restaura SÓLO en los nodos Webhook del lector, con un UUID determinista (así la ruta de producción es exactamente el `path` fijado).
 */
const conWebhookId = (wf) => ({ ...wf, nodes: wf.nodes.map((n) => (n.type === 'n8n-nodes-base.webhook' ? { ...n, webhookId: idNodo(`${wf.name} webhook`, n.name) } : n)) });
export const construirPuente = () => Object.fromEntries(Object.entries(FABRICA_PUENTE).map(([f, fn]) => [f, serializar(conWebhookId(normalizarWorkflow(fn())))]));

export function construirTodo() {
  return Object.fromEntries(Object.entries(FABRICA).map(([f, fn]) => [f, serializar(normalizarWorkflow(fn()))]));
}

if (process.argv[1]?.endsWith('build-workflows.mjs')) {
  const modo = process.argv[2];
  const todo = construirTodo();
  let fallos = 0;
  fs.mkdirSync(SALIDA, { recursive: true });
  for (const [f, texto] of Object.entries(todo)) {
    const destino = path.join(SALIDA, f);
    if (modo === '--write') {
      fs.writeFileSync(destino, texto);
      console.log(`escrito ${path.relative(RAIZ, destino)} (${texto.length} bytes)`);
    } else if (modo === '--check') {
      const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8').replace(/\r\n/g, '\n') : null; // Git puede convertir saltos de línea al extraer
      if (actual !== texto) { console.error(`✖ ${f}: desincronizado con automation/lib (ejecuta --write)`); fallos++; } else console.log(`✔ ${f}`);
    } else {
      console.error('Uso: build-workflows.mjs --write | --check');
      process.exit(2);
    }
  }
  if (modo === '--write') fs.mkdirSync(SALIDA_PUENTE, { recursive: true });
  for (const [f, texto] of Object.entries(construirPuente())) {
    const destino = path.join(SALIDA_PUENTE, f);
    if (modo === '--write') {
      fs.writeFileSync(destino, texto);
      console.log(`escrito ${path.relative(RAIZ, destino)} (${texto.length} bytes)`);
    } else {
      const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8').replace(/\r\n/g, '\n') : null;
      if (actual !== texto) { console.error(`✖ ${f}: desincronizado con automation/lib (ejecuta --write)`); fallos++; } else console.log(`✔ ${f}`);
    }
  }
  const SALIDA_DEV = path.join(RAIZ, 'automation', 'dev');
  for (const [f, texto] of Object.entries(construirDiagnosticos())) {
    const destino = path.join(SALIDA_DEV, f);
    if (modo === '--write') {
      fs.writeFileSync(destino, texto);
      console.log(`escrito ${path.relative(RAIZ, destino)} (${texto.length} bytes)`);
    } else {
      const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8').replace(/\r\n/g, '\n') : null;
      if (actual !== texto) { console.error(`✖ ${f}: desincronizado con automation/lib (ejecuta --write)`); fallos++; } else console.log(`✔ ${f}`);
    }
  }
  process.exit(fallos ? 1 : 0);
}
