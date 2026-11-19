#!/usr/bin/env node
// Linter ESTRICTO del LECTOR DE PRODUCCIÓN. Archivo NUEVO: no toca ni debilita `lint-workflows.mjs` (que sigue rechazando cualquier variante de producción en su carpeta).
// Admite UNA estructura exacta: dos Webhooks POST con credencial exclusiva → Code → Data table Get (tabla fija, entorno «produccion», ordenada por generadoEn) → Code → Responder.
// Rechaza cualquier nodo de escritura, ruta adicional, disparador, petición saliente, secreto, credencial del lector local o ajuste que guarde datos de ejecución.
//   node scripts/automation/lint-lector-produccion.mjs [archivo.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDENCIAL_LECTOR_PRODUCCION, ENTORNO_PRODUCCION, MAX_LECTURA_TABLA, PREFIJO_RUTA_PRODUCCION } from '../../automation/lib/lectorProduccion.mjs';
import { TABLAS_LECTOR } from '../../automation/lib/lectorPuente.mjs';
import { ARCHIVO_PRODUCCION, NOMBRE_WORKFLOW_PRODUCCION, SALIDA_PRODUCCION } from './build-lector-produccion.mjs';

const CREDENCIAL_LOCAL = 'Treidilor — Lector puente (solo lectura)';
const TIPOS = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.code', 'n8n-nodes-base.dataTable', 'n8n-nodes-base.respondToWebhook', 'n8n-nodes-base.stickyNote']);
const CADENA = ['n8n-nodes-base.webhook', 'n8n-nodes-base.code', 'n8n-nodes-base.dataTable', 'n8n-nodes-base.code', 'n8n-nodes-base.respondToWebhook'];
const SECRETOS = [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /\btai_[a-z0-9-]{3,24}_[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{20,}/];
const PELIGROSO = /\brequire\s*\(|\bfetch\s*\(|\$http\b|\bhelpers\b|\bprocess\b|\beval\s*\(|new\s+Function|\bimport\s*\(|child_process|\$env\b|\$secrets\b|\$vars\b|XMLHttpRequest|WebSocket|getWorkflowStaticData|\$getWorkflowStaticData/;
const solo = (obj, claves) => Object.keys(obj ?? {}).filter((k) => !claves.includes(k));

export function lintLectorProduccion(wf, nombreArchivo = ARCHIVO_PRODUCCION, textoCrudo = null) {
  const errores = [];
  const err = (m) => errores.push(m);
  if (nombreArchivo !== ARCHIVO_PRODUCCION) err(`el único archivo admitido es «${ARCHIVO_PRODUCCION}»`);
  if (!wf || typeof wf !== 'object' || !Array.isArray(wf.nodes)) return ['no es un workflow de n8n'];
  if (wf.name !== NOMBRE_WORKFLOW_PRODUCCION) err(`el nombre debe ser «${NOMBRE_WORKFLOW_PRODUCCION}»`);
  if (wf.active !== false) err('debe importarse INACTIVO (active:false)');
  if (solo(wf, ['name', 'nodes', 'connections', 'active', 'settings', 'tags']).length) err(`claves no admitidas en el workflow: ${solo(wf, ['name', 'nodes', 'connections', 'active', 'settings', 'tags']).join(', ')} (sin pinData, staticData ni meta)`);
  const st = wf.settings ?? {};
  if (st.saveDataErrorExecution !== 'none' || st.saveDataSuccessExecution !== 'none' || st.saveManualExecutions !== false) err('no debe guardar datos de ejecución (contienen filas de producción)');
  if (!(Number(st.executionTimeout) >= 1 && Number(st.executionTimeout) <= 60)) err('executionTimeout debe ser ≤ 60 s');
  const texto = textoCrudo ?? JSON.stringify(wf);
  for (const re of SECRETOS) if (re.test(texto)) err(`el archivo contiene algo con forma de secreto (${re.source.slice(0, 24)}…)`);
  if (texto.includes(CREDENCIAL_LOCAL)) err('no se reutiliza la credencial del lector local');

  for (const n of wf.nodes) {
    if (!TIPOS.has(n.type)) err(`nodo no permitido «${n.name}» (${n.type}): sólo Webhook, Code, Data table, Responder y nota`);
    if (n.type === 'n8n-nodes-base.dataTable' && (n.parameters?.operation !== 'get' || n.parameters?.resource !== 'row')) err(`«${n.name}»: sólo Data table row/get (lectura)`);
    if (n.disabled === true) err(`«${n.name}» no puede estar desactivado`);
  }
  const porNombre = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  if (Object.keys(porNombre).length !== wf.nodes.length) err('nombres de nodo repetidos');
  const notas = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
  if (notas.length > 1) err('sólo se admite una nota');
  if (wf.nodes.length !== 1 + 10) err(`debe haber exactamente 11 nodos (1 nota + 2 cadenas de 5); hay ${wf.nodes.length}`);
  const sucesores = (nombre) => (wf.connections?.[nombre]?.main ?? []).flatMap((g) => (g ?? []).map((c) => c.node));
  const webhooks = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  if (webhooks.length !== 2) err(`debe haber exactamente 2 webhooks (04 y 12); hay ${webhooks.length}`);
  const rutas = new Set();
  const enCadena = new Set();
  for (const w of webhooks) {
    const p = w.parameters ?? {};
    const m = new RegExp(`^${PREFIJO_RUTA_PRODUCCION}(04|12)$`).exec(String(p.path ?? ''));
    if (!m) { err(`el path de «${w.name}» debe ser ${PREFIJO_RUTA_PRODUCCION}04 o ${PREFIJO_RUTA_PRODUCCION}12 (fijo, sin parámetros)`); continue; }
    const agente = m[1];
    if (rutas.has(agente)) err(`el agente ${agente} tiene más de un webhook`);
    rutas.add(agente);
    if (solo(p, ['httpMethod', 'path', 'authentication', 'responseMode', 'options']).length) err(`«${w.name}» tiene parámetros no admitidos`);
    if (p.httpMethod !== 'POST') err(`«${w.name}» debe ser POST`);
    if (p.authentication !== 'headerAuth') err(`«${w.name}» debe autenticarse con headerAuth`);
    if (p.responseMode !== 'responseNode') err(`«${w.name}» debe responder con «Respond to Webhook»`);
    if (Object.keys(p.options ?? {}).length) err(`«${w.name}» no admite opciones`);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(w.webhookId ?? ''))) err(`«${w.name}» necesita un webhookId UUID (ruta estable)`);
    const c = w.credentials ?? {};
    if (Object.keys(c).length !== 1 || !c.httpHeaderAuth || c.httpHeaderAuth.name !== CREDENCIAL_LECTOR_PRODUCCION || c.httpHeaderAuth.id !== 'REEMPLAZAR_AL_IMPORTAR' || solo(c.httpHeaderAuth, ['id', 'name']).length) err(`«${w.name}» debe usar sólo la credencial «${CREDENCIAL_LECTOR_PRODUCCION}» por nombre (id de marcador, sin valores)`);
    const cadena = [w];
    for (let i = 1; i < CADENA.length; i++) {
      const sig = sucesores(cadena[i - 1].name);
      if (sig.length !== 1 || !porNombre[sig[0]] || porNombre[sig[0]].type !== CADENA[i]) { err(`la cadena del agente ${agente} debe ser Webhook → Code → Data table → Code → Responder (se rompe tras «${cadena[i - 1].name}»)`); break; }
      cadena.push(porNombre[sig[0]]);
    }
    if (cadena.length !== CADENA.length) continue;
    cadena.forEach((n) => enCadena.add(n.name));
    if (sucesores(cadena[4].name).length) err(`«${cadena[4].name}» no puede tener nodos posteriores`);
    const [, validar, leer, armar, responder] = cadena;
    const d = leer.parameters ?? {};
    if (solo(d, ['resource', 'operation', 'dataTableId', 'matchType', 'filters', 'returnAll', 'limit', 'orderBy', 'orderByColumn', 'orderByDirection']).length) err(`«${leer.name}» tiene parámetros no admitidos`);
    if (d.dataTableId?.mode !== 'name' || d.dataTableId?.value !== TABLAS_LECTOR[agente]) err(`«${leer.name}» debe leer sólo la tabla «${TABLAS_LECTOR[agente]}» por nombre`);
    const cond = d.filters?.conditions ?? [];
    if (cond.length !== 1 || cond[0].keyName !== 'entorno' || cond[0].condition !== 'eq' || cond[0].keyValue !== '={{ $json.entorno }}') err(`«${leer.name}» sólo puede filtrar por entorno con el valor ya validado`);
    if (d.returnAll !== false || Number(d.limit) !== MAX_LECTURA_TABLA) err(`«${leer.name}» debe leer como máximo ${MAX_LECTURA_TABLA} filas (sin «devolver todo»)`);
    if (d.orderBy !== true || d.orderByColumn !== 'generadoEn' || d.orderByDirection !== 'DESC') err(`«${leer.name}» debe ordenar por generadoEn descendente`);
    if (leer.retryOnFail === true) err(`«${leer.name}» no puede reintentar`);
    const rp = responder.parameters ?? {};
    if (rp.respondWith !== 'json' || rp.responseBody !== '={{ JSON.stringify($json) }}' || Number(rp.options?.responseCode) !== 200 || solo(rp.options, ['responseCode']).length) err(`«${responder.name}» debe responder el JSON armado con 200 y nada más`);
    for (const [nodo, funcion] of [[validar, 'validarSolicitudProduccion('], [armar, 'armarRespuestaProduccion(']]) {
      const js = String(nodo.parameters?.jsCode ?? '');
      if (js.length > 80000) err(`«${nodo.name}» supera 80 kB`);
      const mc = js.match(/const LECTOR = (\{[\s\S]*?\n\});/);
      let cfg = null;
      try { cfg = mc ? JSON.parse(mc[1]) : null; } catch { cfg = null; }
      if (!cfg || cfg.agente !== agente || cfg.tabla !== TABLAS_LECTOR[agente] || JSON.stringify(cfg.entornos) !== JSON.stringify([ENTORNO_PRODUCCION]) || cfg.sintetico !== false || solo(cfg, ['agente', 'tabla', 'entornos', 'sintetico']).length) err(`«${nodo.name}» debe llevar la configuración LECTOR del agente ${agente} (tabla fija, entorno «${ENTORNO_PRODUCCION}», sintetico:false)`);
      if (!js.includes(funcion)) err(`«${nodo.name}» debe usar ${funcion.slice(0, -1)} (lógica compartida con el Director)`);
      if (PELIGROSO.test(js)) err(`«${nodo.name}» contiene accesos no permitidos (red, entorno, ficheros o estado del workflow)`);
    }
  }
  for (const a of Object.keys(TABLAS_LECTOR)) if (!rutas.has(a)) err(`falta el webhook del agente ${a}`);
  for (const n of wf.nodes) if (n.type !== 'n8n-nodes-base.stickyNote' && !enCadena.has(n.name) && n.type !== 'n8n-nodes-base.webhook') err(`nodo huérfano «${n.name}»`);
  for (const k of Object.keys(wf.connections ?? {})) if (!enCadena.has(k)) err(`conexión desde un nodo fuera de las cadenas aprobadas («${k}»)`);
  return errores;
}

if (process.argv[1]?.endsWith('lint-lector-produccion.mjs')) {
  const destino = process.argv[2] ?? path.join(SALIDA_PRODUCCION, ARCHIVO_PRODUCCION);
  const crudo = fs.readFileSync(destino, 'utf8');
  const errores = lintLectorProduccion(JSON.parse(crudo), path.basename(destino), crudo);
  if (errores.length) { for (const e of errores) console.error(`✖ ${e}`); process.exit(1); }
  console.log(`✔ ${path.relative(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), destino)}: estructura aprobada (solo lectura)`);
}
