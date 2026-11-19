#!/usr/bin/env node
// COMPROBADOR DE SEGURIDAD de workflows de n8n (Treidilor AI). Rechaza cualquier workflow que pueda escribir, ejecutar comandos, contener
// secretos o salirse de los límites del piloto de SÓLO LECTURA. Sólo usa módulos de Node.
//
//   node scripts/automation/lint-workflows.mjs [fichero.json | carpeta ...]     (por defecto: automation/workflows)
//   salida 0 = correcto · 1 = hay errores · 2 = uso incorrecto
import fs from 'node:fs';
import path from 'node:path';
import { validarAislamiento } from '../../automation/lib/urlPolicy.mjs';
import { COLUMNAS_INSTANTANEAS } from '../../automation/lib/seguimiento.mjs';
import { validarConfigCalidad, validarProduccionCalidad } from '../../automation/lib/urlPolicyCalidad.mjs';

export const TIPOS_PERMITIDOS = new Set([
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.scheduleTrigger', // sólo desactivado
  'n8n-nodes-base.code',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.noOp',
  'n8n-nodes-base.wait', // sólo en el Agente 04: pausa fija por intervalo (ver más abajo)
  'n8n-nodes-base.stickyNote',
  'n8n-nodes-base.dataTable', // memoria del Auditor (2c): sólo listar tablas, leer filas e insertar filas (y crear la tabla en el workflow de preparación)
]);
// POLÍTICA EXPLÍCITA del LECTOR COMPARTIDO (puente Director ↔ n8n): estos dos tipos sólo se admiten en `lector-instantaneas.local.json` y bajo `comprobarLector` (más abajo).
const TIPOS_LECTOR = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.respondToWebhook']);
const ARCHIVO_LECTOR = 'lector-instantaneas.local.json';
const CREDENCIAL_LECTOR = 'Treidilor — Lector puente (solo lectura)';
const TABLAS_LECTOR = { '04': 'calidad_catalogo_instantaneas', '12': 'auditor_general_instantaneas' };
const CADENA_LECTOR = ['n8n-nodes-base.webhook', 'n8n-nodes-base.code', 'n8n-nodes-base.dataTable', 'n8n-nodes-base.code', 'n8n-nodes-base.respondToWebhook'];
const MAX_NODOS = 30;
const MAX_CODE_BYTES = 80_000;
const MAX_WORKFLOW_BYTES = 600_000;

/** Patrones prohibidos en el código de los nodos «Code» (el código del piloto no hace E/S: la red la hacen los nodos HTTP). */
export const PATRONES_CODIGO = [
  [/\brequire\s*\(/, 'require()'],
  [/\bimport\s*\(/, 'import()'],
  [/\bprocess\s*\./, 'process'],
  [/child_process|\bspawn\s*\(|\bexec\s*\(|execSync/, 'ejecución de comandos'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b|\bFunction\s*\(/, 'Function()'],
  [/\$env\b|\$\{?\s*env\./, 'acceso a variables de entorno'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bnew\s+URL\b|\bURLSearchParams\b|\bstructuredClone\b/, 'URL/URLSearchParams/structuredClone (no existen en el entorno Code de n8n)'],
  [/XMLHttpRequest|WebSocket|EventSource/, 'red directa'],
  [/\bglobalThis\b|__proto__|constructor\s*\.\s*constructor/, 'escape del entorno'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'temporizadores'],
  [/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/, 'bucle infinito'],
  [/\$execution\.(?!mode\b|id\b)|\$workflow\.|\$getWorkflowStaticData|helpers\.httpRequest|\$helpers/, 'API interna de n8n con efectos (sólo se permiten $execution.mode y $execution.id, de lectura)'],
];

const PATRONES_SECRETO = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/, 'cabecera Bearer con valor'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'clave tipo sk-'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/, 'clave Anthropic'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave AWS'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, 'JWT'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'token de Slack'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'token de GitHub'],
  [/TRADYLOR_API_TOKEN/, 'referencia al token general de Treidilor'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
];
const CLAVES_SENSIBLES = /^(password|passwd|secret|token|apikey|api_key|authorization|client_secret|access_token)$/i;

function recorrer(valor, visita, ruta = '') {
  if (typeof valor === 'string') visita(valor, ruta, undefined);
  else if (Array.isArray(valor)) valor.forEach((v, i) => recorrer(v, visita, `${ruta}[${i}]`));
  else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      if (typeof v === 'string') visita(v, `${ruta}.${k}`, k);
      else recorrer(v, visita, `${ruta}.${k}`);
    }
  }
}

/**
 * Política del LECTOR COMPARTIDO: sólo consulta. Por cada agente (04, 12) una cadena EXACTA Webhook → Code (valida) → Data table Get (tabla fija) → Code (arma) → Responder.
 * Sin HTTP saliente, sin disparadores manuales o programados, sin escritura, sin variante de producción, y con la credencial Header Auth por NOMBRE.
 */
function comprobarLector(wf, ctx, err) {
  if (ctx.nombreArchivo !== ARCHIVO_LECTOR) err(`Lector: el único archivo admitido es «${ARCHIVO_LECTOR}» (no hay variante de producción autorizada)`);
  const permitidos = new Set([...TIPOS_LECTOR, 'n8n-nodes-base.code', 'n8n-nodes-base.dataTable', 'n8n-nodes-base.stickyNote']);
  for (const n of wf.nodes) if (!permitidos.has(n.type)) err(`Lector: el nodo «${n.name}» (${n.type}) no está permitido en el lector (sin HTTP saliente ni disparadores manuales o programados)`);
  const porNombre = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const sucesores = (nombre) => (wf.connections?.[nombre]?.main ?? []).flatMap((g) => (g ?? []).map((c) => c.node));
  const webhooks = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  const agentesVistos = new Set();
  if (webhooks.length !== 2) err(`Lector: debe haber exactamente 2 webhooks (agentes 04 y 12); hay ${webhooks.length}`);
  for (const w of webhooks) {
    const p = w.parameters ?? {};
    const m = /^tai-lector-(04|12)$/.exec(String(p.path ?? ''));
    if (!m) { err(`Lector: el path del webhook «${w.name}» debe ser tai-lector-04 o tai-lector-12 (fijo, sin parámetros)`); continue; }
    const agente = m[1];
    if (agentesVistos.has(agente)) err(`Lector: el agente ${agente} tiene más de un webhook`);
    agentesVistos.add(agente);
    if (p.httpMethod !== 'POST') err(`Lector: el webhook «${w.name}» debe ser POST`);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(w.webhookId ?? ''))) err(`Lector: el webhook «${w.name}» debe llevar un webhookId (UUID); sin él n8n registra una ruta que depende del id del workflow`);
    if (p.authentication !== 'headerAuth') err(`Lector: el webhook «${w.name}» debe autenticarse con headerAuth`);
    if (p.responseMode !== 'responseNode') err(`Lector: el webhook «${w.name}» debe responder con un nodo «Respond to Webhook»`);
    if (Object.keys(p.options ?? {}).length) err(`Lector: el webhook «${w.name}» no admite opciones adicionales`);
    const cred = w.credentials?.httpHeaderAuth;
    if (!cred || cred.name !== CREDENCIAL_LECTOR || Object.keys(w.credentials).length !== 1) err(`Lector: el webhook «${w.name}» debe usar sólo la credencial «${CREDENCIAL_LECTOR}» (Header Auth, por nombre)`);
    // cadena exacta
    const cadena = [w];
    for (let i = 1; i < CADENA_LECTOR.length; i++) {
      const sig = sucesores(cadena[i - 1].name);
      if (sig.length !== 1 || !porNombre[sig[0]] || porNombre[sig[0]].type !== CADENA_LECTOR[i]) { err(`Lector: la cadena del agente ${agente} debe ser Webhook → Code → Data table (Get) → Code → Responder (se rompe tras «${cadena[i - 1].name}»)`); break; }
      cadena.push(porNombre[sig[0]]);
    }
    if (cadena.length !== CADENA_LECTOR.length) continue;
    if (sucesores(cadena[4].name).length) err(`Lector: «${cadena[4].name}» no puede tener nodos posteriores`);
    const [, validar, leer, armar, responder] = cadena;
    const dt = leer.parameters ?? {};
    if (dt.resource !== 'row' || dt.operation !== 'get') err(`Lector: «${leer.name}» sólo puede ser Data table → row/get (consulta)`);
    if (dt.dataTableId?.value !== TABLAS_LECTOR[agente] || dt.dataTableId?.mode !== 'name') err(`Lector: «${leer.name}» debe leer sólo la tabla «${TABLAS_LECTOR[agente]}» por nombre`);
    const cond = dt.filters?.conditions ?? [];
    if (cond.length !== 1 || cond[0].keyName !== 'entorno' || cond[0].condition !== 'eq' || cond[0].keyValue !== '={{ $json.entorno }}') err(`Lector: «${leer.name}» sólo puede filtrar por entorno con el valor ya validado por el nodo anterior`);
    if (!(Number(dt.limit) >= 1 && Number(dt.limit) <= 60)) err(`Lector: «${leer.name}» debe limitar a ≤ 60 filas`);
    if (leer.retryOnFail === true) err(`Lector: «${leer.name}» no puede reintentar automáticamente`);
    const rp = responder.parameters ?? {};
    if (rp.respondWith !== 'json' || rp.responseBody !== '={{ JSON.stringify($json) }}' || Number(rp.options?.responseCode) !== 200) err(`Lector: «${responder.name}» debe responder el JSON armado con código 200 y nada más`);
    for (const [nodo, funcion] of [[validar, 'validarSolicitudLector('], [armar, 'armarRespuestaLector(']]) {
      const js = String(nodo.parameters?.jsCode ?? '');
      const mc = js.match(/const LECTOR = (\{[\s\S]*?\n\});/);
      let cfg = null;
      try { cfg = mc ? JSON.parse(mc[1]) : null; } catch { cfg = null; }
      if (!cfg || cfg.agente !== agente || cfg.tabla !== TABLAS_LECTOR[agente] || JSON.stringify(cfg.entornos) !== '["local"]' || cfg.sintetico !== true) err(`Lector: «${nodo.name}» debe llevar la configuración LECTOR del agente ${agente} (tabla fija, entorno «local», datos de prueba)`);
      if (!js.includes(funcion)) err(`Lector: «${nodo.name}» debe usar ${funcion.slice(0, -1)} (la lógica compartida con el Director)`);
    }
  }
  for (const a of Object.keys(TABLAS_LECTOR)) if (!agentesVistos.has(a)) err(`Lector: falta el webhook del agente ${a}`);
  if (/\.produccion\./i.test(ctx.nombreArchivo ?? '') || /producci[oó]n/i.test(String(wf.name ?? ''))) err('Lector: no hay variante de producción autorizada');
}

/**
 * Comprueba un workflow ya parseado. Devuelve { errores:[...], avisos:[...] }.
 * `ctx.nombreArchivo` (p. ej. «auditor-general.produccion.json»): los de producción no pueden llevar credenciales.
 */
export function comprobarWorkflow(wf, ctx = {}) {
  const errores = [];
  const avisos = [];
  const err = (m) => errores.push(m);
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) return { errores: ['El workflow debe ser un objeto JSON'], avisos };
  if (JSON.stringify(wf).length > MAX_WORKFLOW_BYTES) err(`El workflow supera ${MAX_WORKFLOW_BYTES} bytes`);
  if (typeof wf.name !== 'string' || !wf.name.trim()) err('Falta «name»');
  if (wf.active !== false) err('«active» debe ser false: los workflows se activan a mano en n8n, nunca desde el repositorio');
  if ('pinData' in wf) err('«pinData» no está permitido (datos de ejemplo/secretos fijados)');
  if (!Array.isArray(wf.nodes) || !wf.nodes.length) {
    err('Faltan «nodes»');
    return { errores, avisos };
  }
  if (wf.nodes.length > MAX_NODOS) err(`Demasiados nodos (${wf.nodes.length} > ${MAX_NODOS})`);
  const settings = wf.settings ?? {};
  if (!(Number(settings.executionTimeout) > 0 && Number(settings.executionTimeout) <= 1800)) err('settings.executionTimeout debe estar entre 1 y 1800 segundos');

  const nombres = new Set();
  const esLector = /^lector-instantaneas\./.test(ctx.nombreArchivo ?? '');
  const esProduccion = /[.-]produccion\./i.test(ctx.nombreArchivo ?? '') || /producci[oó]n/i.test(String(wf.name ?? ''));
  let hayHttp = false;
  let hayPolitica = false;
  const tablasDt = new Set();
  let tablaConfig = null;
  let cfgCalidad = null; // configuración del Agente 04 (modo lectura_catalogo), si el workflow lo es
  // ¿Es el workflow del Agente 04? (lleva la guardia de la política `lectura_catalogo`). Es el ÚNICO que puede referenciar una credencial en producción: la del feed de sólo lectura, por NOMBRE.
  const esAgenteCalidad = wf.nodes.some((n) => n?.type === 'n8n-nodes-base.code' && /validarConfigCalidad\(CONFIG\)/.test(String(n.parameters?.jsCode ?? '')));
  for (const n of wf.nodes) {
    const etiqueta = `Nodo «${n?.name ?? '?'}»`;
    if (!n || typeof n !== 'object' || typeof n.name !== 'string' || !n.name) { err('Hay un nodo sin nombre'); continue; }
    if (nombres.has(n.name)) err(`${etiqueta}: nombre repetido`);
    nombres.add(n.name);
    if (!TIPOS_PERMITIDOS.has(n.type) && !(esLector && TIPOS_LECTOR.has(n.type))) { err(`${etiqueta}: tipo no permitido (${n.type})`); continue; }
    if (n.type === 'n8n-nodes-base.scheduleTrigger' && n.disabled !== true) err(`${etiqueta}: la programación debe ir desactivada (disabled: true)`);
    if (n.credentials && Object.keys(n.credentials).length) {
      if (esProduccion && !esAgenteCalidad) err(`${etiqueta}: los workflows de producción no pueden referenciar credenciales (v0 sólo lectura pública)`);
      for (const [tipo, c] of Object.entries(n.credentials)) {
        if (tipo !== 'httpHeaderAuth') err(`${etiqueta}: tipo de credencial no permitido (${tipo})`);
        if (!/solo lectura/i.test(String(c?.name ?? ''))) err(`${etiqueta}: la credencial debe llamarse «… (solo lectura)»`);
      }
    }
    if (n.type === 'n8n-nodes-base.code') {
      const js = String(n.parameters?.jsCode ?? '');
      if (!js.trim()) err(`${etiqueta}: código vacío`);
      if (Buffer.byteLength(js) > MAX_CODE_BYTES) err(`${etiqueta}: código demasiado grande`);
      for (const [re, que] of PATRONES_CODIGO) if (re.test(js)) err(`${etiqueta}: código con ${que}`);
      // AISLAMIENTO (segunda barrera; la primera es la red del Compose): la configuración incrustada debe ser coherente con el tipo de archivo.
      const mc = js.match(/const CONFIG = (\{[\s\S]*?\n\});/);
      if (mc) {
        let cfg = null;
        try { cfg = JSON.parse(mc[1]); } catch { err(`${etiqueta}: CONFIG incrustada ilegible`); }
        if (cfg) {
          for (const e of validarAislamiento(cfg)) err(`${etiqueta}: aislamiento — ${e}`);
          if (esProduccion && cfg.entorno !== 'produccion') err(`${etiqueta}: aislamiento — un workflow de producción debe llevar la configuración de producción`);
          if (!esProduccion && cfg.entorno !== 'local') err(`${etiqueta}: aislamiento — un workflow local debe llevar la configuración local`);
          if (!esProduccion && /treidilor\.com/i.test(JSON.stringify(cfg))) err(`${etiqueta}: aislamiento — un workflow local no puede mencionar treidilor.com`);
          if (cfg.seguimiento && typeof cfg.seguimiento.tabla === 'string') tablaConfig = cfg.seguimiento.tabla;
          if (cfg.modo === 'lectura_catalogo' || /validarConfigCalidad\(CONFIG\)|function\s+validarConfigCalidad\b/.test(js)) {
            cfgCalidad = cfg;
            for (const e of validarConfigCalidad(cfg)) err(`${etiqueta}: política lectura_catalogo — ${e}`);
            if (esProduccion) {
              for (const e of validarProduccionCalidad(cfg)) err(`${etiqueta}: política lectura_catalogo (producción) — ${e}`);
              if (!js.includes('validarProduccionCalidad(CONFIG)')) err(`${etiqueta}: falta la guardia de producción (validarProduccionCalidad) al inicio del nodo`);
            }
            if (!/validarConfigCalidad\(CONFIG\)/.test(js)) err(`${etiqueta}: falta la guardia de la política lectura_catalogo (validarConfigCalidad) al inicio del nodo`);
          }
        }
        if (!/validarAislamiento\(CONFIG\)/.test(js)) err(`${etiqueta}: falta la guardia de aislamiento al inicio del nodo`);
      }
      if ((/function\s+evaluarUrl\b/.test(js) || /function\s+evaluarUrlCalidad\b/.test(js)) && /hostsPermitidos/.test(js)) hayPolitica = true;
    }
    if (n.type === 'n8n-nodes-base.dataTable') {
      const p = n.parameters ?? {};
      const op = `${p.resource}/${p.operation}`;
      const permitidas = new Set(['table/list', 'row/get', 'row/insert']);
      if (/crear-tabla/.test(ctx.nombreArchivo ?? '')) permitidas.add('table/create');
      if (!permitidas.has(op)) err(`${etiqueta}: operación de Data table no permitida (${op}); sólo listar tablas, leer e insertar filas`);
      if (p.resource === 'row') {
        const ref = p.dataTableId;
        if (!ref || ref.__rl !== true || ref.mode !== 'name' || typeof ref.value !== 'string' || !ref.value || ref.value.startsWith('=')) err(`${etiqueta}: la tabla debe referenciarse por NOMBRE fijo (modo «name»), nunca por id, lista ni expresión`);
        else tablasDt.add(ref.value);
      }
      if (p.resource === 'table' && p.operation === 'list' && typeof p.options?.filterName === 'string') tablasDt.add(p.options.filterName);
      if (p.resource === 'table' && p.operation === 'create' && typeof p.tableName === 'string') tablasDt.add(p.tableName);
      if (op === 'row/insert') {
        if (n.retryOnFail === true) err(`${etiqueta}: el Insert no puede reintentar automáticamente (duplicaría filas)`);
        if (n.onError !== 'continueErrorOutput') err(`${etiqueta}: el Insert debe usar onError = continueErrorOutput (los errores salen por la segunda salida y el informe los recibe)`);
        const columnas = Object.keys(p.columns?.value ?? {});
        if (!columnas.length || columnas.some((c) => !COLUMNAS_INSTANTANEAS.includes(c))) err(`${etiqueta}: el Insert sólo puede escribir las columnas del historial (${COLUMNAS_INSTANTANEAS.join(', ')})`);
        if (p.options && p.options.optimizeBulk === true) avisos.push(`${etiqueta}: optimizeBulk no devuelve las filas insertadas`);
      }
    }
    if (n.type === 'n8n-nodes-base.httpRequest') {
      hayHttp = true;
      const p = n.parameters ?? {};
      const metodo = String(p.method ?? 'GET').toUpperCase();
      if (metodo !== 'GET') err(`${etiqueta}: sólo se permiten peticiones GET (hay ${metodo})`);
      if (p.url !== '={{ $json.url }}') err(`${etiqueta}: la URL debe ser exactamente «={{ $json.url }}» (la fija un nodo Code con política de URLs)`);
      if (p.sendBody || p.jsonBody || p.bodyParameters || p.body || p.specifyBody) err(`${etiqueta}: no se permite enviar cuerpo`);
      if (p.authentication && !['none', 'genericCredentialType'].includes(p.authentication)) err(`${etiqueta}: autenticación no permitida (${p.authentication})`);
      if (p.authentication === 'genericCredentialType' && p.genericAuthType !== 'httpHeaderAuth') err(`${etiqueta}: sólo se permite httpHeaderAuth`);
      const o = p.options ?? {};
      if (!(Number(o.timeout) >= 1000 && Number(o.timeout) <= 30000)) err(`${etiqueta}: timeout obligatorio entre 1000 y 30000 ms`);
      const lote = o.batching?.batch ?? {};
      if (!(Number(lote.batchSize) >= 1 && Number(lote.batchSize) <= 2 && Number(lote.batchInterval) >= 500)) err(`${etiqueta}: límite de ritmo obligatorio (≤ 2 peticiones por lote, ≥ 500 ms entre lotes)`);
      if (o.redirect?.redirect?.followRedirects !== false) err(`${etiqueta}: followRedirects debe ser false (no se siguen redirecciones a destinos no controlados)`);
      if (n.retryOnFail && !(Number(n.maxTries) >= 1 && Number(n.maxTries) <= 3)) err(`${etiqueta}: maxTries debe ser ≤ 3`);
      if (n.onError !== 'continueRegularOutput') avisos.push(`${etiqueta}: conviene onError = continueRegularOutput para no perder el informe ante un fallo puntual`);
    }
  }
  if (esLector) comprobarLector(wf, ctx, err);
  // Nodos Wait: sólo en el Agente 04, sólo por intervalo en segundos (nunca webhook, formulario ni fecha) y de duración acotada (< 65 s: se espera en memoria).
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.wait')) {
    const p = n.parameters ?? {};
    if (!cfgCalidad) err(`Nodo «${n.name}»: el nodo Wait sólo se admite en el Agente 04`);
    if (p.resume !== 'timeInterval' || p.unit !== 'seconds') err(`Nodo «${n.name}»: la espera debe ser por intervalo en segundos (resume: timeInterval, unit: seconds)`);
    if (!(Number(p.amount) >= 1 && Number(p.amount) <= 60)) err(`Nodo «${n.name}»: la espera debe durar entre 1 y 60 segundos`);
    if (cfgCalidad && !(Number(p.amount) * 1000 >= cfgCalidad.pausaMs)) err(`Nodo «${n.name}»: la espera (${p.amount} s) no puede ser inferior a pausaMs (${cfgCalidad.pausaMs} ms)`);
    if (n.webhookId) err(`Nodo «${n.name}»: el nodo Wait no puede llevar webhook`);
  }
  if (cfgCalidad) {
    // la 1.ª página y el resto van SIEMPRE separados por un Wait: Páginas restantes → Wait → Pedir catálogo (resto)
    const sig = (de) => (wf.connections?.[de]?.main?.[0] ?? []).map((c) => c.node);
    const w = sig('Páginas restantes');
    const esWait = (nm) => wf.nodes.find((x) => x.name === nm)?.type === 'n8n-nodes-base.wait';
    if (w.length !== 1 || !esWait(w[0]) || sig(w[0]).join() !== 'Pedir catálogo (resto)') err('Agente 04: entre «Páginas restantes» y «Pedir catálogo (resto)» debe haber un único nodo Wait');
  }
  if (cfgCalidad && esProduccion) {
    // Agente 04 en PRODUCCIÓN: inactivo, sin programación ni webhooks, y la credencial es la de la configuración (por nombre, con el id de relleno de la importación: nunca un id de instalación ni un valor).
    if (wf.active !== false) err('Agente 04 en producción: el workflow debe ir inactivo (active: false)');
    for (const n of wf.nodes) {
      if (/scheduleTrigger|webhook|cron|interval|formTrigger|chatTrigger/i.test(String(n.type))) err(`Nodo «${n.name}»: el Agente 04 en producción no puede llevar disparadores automáticos (${n.type})`);
      if (n.type === 'n8n-nodes-base.manualTrigger' && wf.nodes.filter((x) => /Trigger$/.test(String(x.type))).length !== 1) err('Agente 04 en producción: el único disparador debe ser el manual');
      const c = n.credentials?.httpHeaderAuth;
      if (c && c.id !== 'REEMPLAZAR_AL_IMPORTAR') err(`Nodo «${n.name}»: la credencial debe llevar el id de relleno «REEMPLAZAR_AL_IMPORTAR», nunca el id de una instalación`);
    }
    if (!cfgCalidad.credencialCatalogo) err('Agente 04 en producción: falta el nombre de la credencial del feed');
  }
  if (cfgCalidad) {
    // Agente 04: la pausa entre peticiones respeta los límites del cliente y sólo los nodos «Pedir catálogo…» llevan la credencial (por nombre) de la configuración.
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.httpRequest') continue;
      const intervalo = Number(n.parameters?.options?.batching?.batch?.batchInterval);
      if (!(intervalo >= cfgCalidad.pausaMs)) err(`Nodo «${n.name}»: la pausa entre peticiones (${intervalo} ms) debe ser ≥ pausaMs de la configuración (${cfgCalidad.pausaMs} ms: límite de ${cfgCalidad.peticionesPorMinuto}/min del cliente)`);
      if (Number(n.parameters?.options?.batching?.batch?.batchSize) !== 1) err(`Nodo «${n.name}»: el Agente 04 pide las páginas de una en una (batchSize = 1)`);
      const cred = n.credentials?.httpHeaderAuth;
      if (!/^Pedir catálogo/.test(n.name)) err(`Nodo «${n.name}»: en el Agente 04 sólo los nodos «Pedir catálogo…» pueden hacer peticiones`);
      if (!cred || cred.name !== cfgCalidad.credencialCatalogo) err(`Nodo «${n.name}»: debe usar la credencial «${cfgCalidad.credencialCatalogo}» (Header Auth, por nombre)`);
      const cabeceras = (n.parameters?.headerParameters?.parameters ?? []).map((h) => h.name).sort().join(',');
      if (cabeceras !== 'User-Agent,X-Treidilor-Agente') err(`Nodo «${n.name}»: sólo se permiten las cabeceras User-Agent y X-Treidilor-Agente (la autenticación la añade la credencial)`);
    }
  }
  if (hayHttp && !hayPolitica) err('Hay nodos HTTP pero ningún nodo Code incluye la política de URLs (evaluarUrl + hostsPermitidos)');
  if (tablaConfig && [...tablasDt].some((x) => x !== tablaConfig)) err(`Los nodos Data table deben usar sólo la tabla de la configuración («${tablaConfig}»)`);

  // Conexiones: nodos existentes, sin ciclos, y cada HTTP debe recibir de un Code (que fija la URL con la política)
  const conexiones = wf.connections ?? {};
  const aristas = [];
  for (const [de, salidas] of Object.entries(conexiones)) {
    if (!nombres.has(de)) err(`Conexión desde un nodo inexistente («${de}»)`);
    for (const rama of Object.values(salidas ?? {})) for (const grupo of rama ?? []) for (const c of grupo ?? []) {
      if (!nombres.has(c.node)) err(`Conexión hacia un nodo inexistente («${c.node}»)`);
      aristas.push([de, c.node]);
    }
  }
  const tipoDe = Object.fromEntries(wf.nodes.map((n) => [n.name, n.type]));
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.httpRequest') continue;
    const entradas = aristas.filter(([, a]) => a === n.name).map(([d]) => d);
    if (n.disabled === true && !entradas.length) continue; // deshabilitado y sin conexiones: no se ejecuta (sirve para validar versiones de nodo al importar)
    // Un nodo Wait (pausa) puede ir en medio: sólo reenvía lo que decidió un nodo Code (nunca origina datos).
    const origenCode = (d) => tipoDe[d] === 'n8n-nodes-base.code' || (tipoDe[d] === 'n8n-nodes-base.wait' && aristas.filter(([, a]) => a === d).every(([o]) => tipoDe[o] === 'n8n-nodes-base.code') && aristas.some(([, a]) => a === d));
    if (!entradas.length || entradas.some((d) => !origenCode(d))) err(`Nodo «${n.name}»: sólo puede recibir datos de nodos Code (o de un Wait que los reenvía)`);
  }
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.dataTable' || n.parameters?.operation !== 'insert') continue;
    const entradas = aristas.filter(([, a]) => a === n.name).map(([d]) => d);
    if (!entradas.length || entradas.some((d) => tipoDe[d] !== 'n8n-nodes-base.code')) err(`Nodo «${n.name}»: el Insert sólo puede recibir datos de nodos Code (que deciden qué fila se guarda)`);
  }
  // El Insert tiene DOS salidas (correcta y de error) y las dos deben llegar a un nodo Code que confirme la escritura (que no haya error no prueba que se guardó).
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.dataTable' || n.parameters?.operation !== 'insert') continue;
    const salidasN = wf.connections?.[n.name]?.main ?? [];
    const destinos = (i) => (salidasN[i] ?? []).map((c) => c.node);
    for (const i of [0, 1]) if (!destinos(i).length || destinos(i).some((d) => tipoDe[d] !== 'n8n-nodes-base.code')) err(`Nodo «${n.name}»: la salida ${i === 0 ? 'correcta' : 'de error'} del Insert debe ir a un nodo Code que confirme la escritura`);
  }
  const grado = new Map([...nombres].map((x) => [x, 0]));
  for (const [, a] of aristas) grado.set(a, (grado.get(a) ?? 0) + 1);
  const pendientes = [...grado.entries()].filter(([, g]) => g === 0).map(([x]) => x);
  let visitados = 0;
  while (pendientes.length) {
    const x = pendientes.pop();
    visitados++;
    for (const [d, a] of aristas) if (d === x) { grado.set(a, grado.get(a) - 1); if (grado.get(a) === 0) pendientes.push(a); }
  }
  if (visitados < nombres.size) err('Las conexiones contienen un ciclo');

  // Secretos
  recorrer(wf, (valor, ruta, clave) => {
    for (const [re, que] of PATRONES_SECRETO) if (re.test(valor)) { err(`Posible secreto (${que}) en ${ruta || 'raíz'}`); break; }
    if (clave && CLAVES_SENSIBLES.test(clave) && valor.length >= 8 && !valor.startsWith('=')) err(`Valor sensible en la clave «${clave}» (${ruta})`);
  });
  return { errores, avisos };
}

function listarJson(destino) {
  const st = fs.statSync(destino);
  if (st.isFile()) return [destino];
  return fs.readdirSync(destino).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(destino, f));
}

if (process.argv[1]?.endsWith('lint-workflows.mjs')) {
  const destinos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const lista = (destinos.length ? destinos : ['automation/workflows', 'automation/workflows-puente']).flatMap((d) => (fs.existsSync(d) ? listarJson(d) : []));
  if (!lista.length) {
    console.error('No hay workflows que comprobar.');
    process.exit(2);
  }
  let fallos = 0;
  for (const f of lista) {
    let wf;
    try {
      wf = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      console.error(`✖ ${f}: JSON no válido`);
      fallos++;
      continue;
    }
    const { errores, avisos } = comprobarWorkflow(wf, { nombreArchivo: path.basename(f) });
    if (errores.length) {
      fallos++;
      console.error(`✖ ${f}`);
      for (const e of errores) console.error(`   - ${e}`);
    } else console.log(`✔ ${f}`);
    for (const a of avisos) console.log(`   · aviso: ${a}`);
  }
  process.exit(fallos ? 1 : 0);
}
