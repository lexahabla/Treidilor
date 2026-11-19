#!/usr/bin/env node
// INSTANTÁNEAS REALES SANEADAS → n8n de PRUEBAS (nunca producción). Dos órdenes:
//
//   preparar --csv <export de la Data table> --agente 04|12 [--salida D:/treidilor-pruebas/reales] [--permitir-no-produccion]
//       Lee el CSV exportado desde la interfaz de n8n, se queda SOLO con la última fila de producción (por `generadoEn`), valida que el Director la entiende,
//       retira secretos y datos personales, y escribe `<salida>/<agente>.json` (sintetico:false, saneado:true). No imprime el contenido.
//   recuperar
//       Detecta y repara un n8n de pruebas con las tablas sustituidas (interrupción, error): sólo actúa si identifica sin ambigüedad cada tabla; nunca borra una sintética.
//   probar [--reales D:/treidilor-pruebas/reales]
//       Respalda las filas sintéticas, las aparta (renombra las tablas), crea las tablas con las filas reales saneadas en el n8n de PRUEBAS, publica el lector, ejecuta
//       el circuito Canal 13 → Director → n8n → Director → Canal 13, y SIEMPRE restaura (borra las tablas reales, devuelve las sintéticas, despublica el lector).
//
// Sólo habla con http://127.0.0.1:5678 (n8n de pruebas aislado). Los secretos se leen de archivos fuera del repositorio y no se imprimen.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LectorInstantaneas, FORMATO_EXPORTACION } from '../../automation/director/lectores.mjs';
import { COLUMNAS_INSTANTANEAS, filaDeInstantanea } from '../../automation/lib/seguimiento.mjs';

const RAIZ_PRUEBAS = process.env.TAI_DIR_PRUEBAS || 'D:/treidilor-pruebas';
const TABLAS = { '04': 'calidad_catalogo_instantaneas', '12': 'auditor_general_instantaneas' };
const PROYECTO = 'xf2zGMcHWZiePKLR';
const WORKFLOW_LECTOR = 'jzRaQXpRQJvgRHOl';
const N8N = 'http://127.0.0.1:5678';
const CONTENEDOR = 'treidilor-n8n-pruebas';
const mostrar = (k, v) => console.log(`${String(k).padEnd(44)} ${v}`);

// ── CSV (RFC 4180: comillas, comas y saltos de línea dentro de campos) ──────────────────────────────────────────────────────────────
export function parsearCsv(texto) {
  const filas = []; let fila = []; let campo = ''; let q = false;
  const t = texto.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c; }
    else if (c === '"') q = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo.replace(/\r$/, '')); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo.replace(/\r$/, '')); filas.push(fila); }
  const [cab, ...resto] = filas.filter((f) => f.some((x) => x !== ''));
  return resto.map((f) => Object.fromEntries(cab.map((h, i) => [h.trim(), f[i] ?? ''])));
}

// ── saneado ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PATRONES = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g, 'cabecera Bearer'], [/\bsk-[A-Za-z0-9_-]{20,}/g, 'clave sk-'], [/\bAKIA[0-9A-Z]{16}\b/g, 'clave AWS'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, 'JWT'], [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'token Slack'], [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'token GitHub'],
  [/\btai_[a-z0-9-]{3,24}_[A-Za-z0-9_-]{20,}/g, 'token tai_'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, 'clave privada'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'correo electrónico'], [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'dirección IP'],
];
export function sanear(texto) {
  let t = String(texto); const cuenta = {};
  for (const [re, que] of PATRONES) t = t.replace(re, () => { cuenta[que] = (cuenta[que] || 0) + 1; return '[REDACTADO]'; });
  return { texto: t, cuenta };
}

export function prepararFila({ csv, agente, permitirNoProduccion = false, ahora = new Date() }) {
  if (!TABLAS[agente]) throw new Error('agente debe ser 04 o 12');
  const filas = parsearCsv(csv);
  if (!filas.length) throw new Error('El CSV no tiene filas.');
  const faltan = COLUMNAS_INSTANTANEAS.filter((c) => !(c in filas[0]));
  if (faltan.length) throw new Error(`Faltan columnas en el CSV: ${faltan.join(', ')}`);
  const prod = filas.filter((f) => f.entorno === 'produccion');
  const candidatas = prod.length ? prod : permitirNoProduccion ? filas : [];
  if (!candidatas.length) throw new Error('El CSV no contiene filas de entorno «produccion» (usa --permitir-no-produccion sólo para ensayos).');
  const ultima = candidatas.reduce((a, b) => (Date.parse(b.generadoEn) > Date.parse(a.generadoEn) ? b : a));
  const cuenta = {};
  const limpia = {};
  for (const c of COLUMNAS_INSTANTANEAS) { const r = sanear(ultima[c]); limpia[c] = r.texto; for (const [k, v] of Object.entries(r.cuenta)) cuenta[k] = (cuenta[k] || 0) + v; }
  // `host` y `entorno` identifican la procedencia y no son sensibles: se conservan tal cual.
  limpia.host = ultima.host; limpia.entorno = ultima.entorno;
  const datos = { formato: FORMATO_EXPORTACION, agente, tabla: TABLAS[agente], exportadoEn: ahora.toISOString(), sintetico: false, saneado: true, procedenciaOriginal: { entorno: ultima.entorno, huellaFila: ultima.huella, sha256PayloadCsv: crypto.createHash('sha256').update(ultima.payload).digest('hex'), sha256PayloadSaneado: crypto.createHash('sha256').update(limpia.payload).digest('hex'), redacciones: cuenta }, filas: [limpia] };
  // El Director debe entender la fila; si el saneado rompió el payload, se rechaza.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-real-'));
  try {
    fs.writeFileSync(path.join(tmp, `${agente}.json`), JSON.stringify(datos));
    const c = new LectorInstantaneas({ dir: tmp }).cargar(agente);
    if (c.filas.length !== 1) throw new Error(`El Director no acepta la fila (${c.descartadas.map((d) => d.motivo).join(', ') || 'motivo desconocido'}).`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { datos, resumen: { filasEnArchivo: filas.length, filasDeProduccion: prod.length, elegida: limpia.idEjecucion, generadoEn: limpia.generadoEn, calidad: limpia.calidad, origen: limpia.origen, redacciones: cuenta } };
}

// ── n8n de pruebas (MCP + CLI de Docker) ────────────────────────────────────────────────────────────────────────────────────────────
async function mcp() {
  const clave = fs.readFileSync(path.join(RAIZ_PRUEBAS, 'n8n-mcp-clave.txt'), 'utf8').match(/eyJ[A-Za-z0-9_.-]+|[A-Za-z0-9_-]{30,}/)?.[0];
  let sid = null; let n = 0;
  const rpc = async (method, params, notif = false) => {
    const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${clave}` }; if (sid) h['mcp-session-id'] = sid;
    const r = await fetch(`${N8N}/mcp-server/http`, { method: 'POST', headers: h, body: JSON.stringify(notif ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++n, method, params }) });
    if (r.headers.get('mcp-session-id')) sid = r.headers.get('mcp-session-id');
    const t = await r.text(); if (notif) return null;
    const j = JSON.parse(t.includes('\ndata:') || t.startsWith('event:') ? t.split('\n').find((l) => l.startsWith('data:')).slice(5) : t);
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 200)}`); return j.result;
  };
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tai-pruebas', version: '0.1' } }); await rpc('notifications/initialized', {}, true);
  return async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.content.map((c) => c.text).join(''); try { return JSON.parse(t); } catch { return t; } };
}
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function esperarSano() { for (let i = 0; i < 24; i++) { try { if (docker('inspect', '-f', '{{.State.Health.Status}}', CONTENEDOR).trim() === 'healthy') return; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 8000)); } throw new Error('n8n no volvió a estar sano'); }
async function restart() { docker('restart', CONTENEDOR); await esperarSano(); }
async function borrarTablaRest(idTabla) {
  const [correo, pass] = fs.readFileSync(path.join(RAIZ_PRUEBAS, 'n8n-propietario.txt'), 'utf8').split(/\r?\n/).map((l) => l.split(/[:=]/).slice(1).join(':').trim());
  const l = await fetch(`${N8N}/rest/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailOrLdapLoginId: correo, password: pass }) });
  const cookie = (l.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  if (!l.ok || !cookie) throw new Error(`login del propietario de PRUEBAS fallido (${l.status})`);
  const r = await fetch(`${N8N}/rest/projects/${PROYECTO}/data-tables/${idTabla}`, { method: 'DELETE', headers: { cookie } });
  if (!r.ok) throw new Error(`no se pudo borrar la tabla temporal (${r.status})`);
}

const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const HOST_SINTETICO = 'sintetico.example';

/**
 * El lector de pruebas SOLO atiende el entorno «local» (política del linter). Las filas reales vienen del entorno «produccion»: en la copia de pruebas se rotula
 * `entorno: 'local'` en la fila y en el payload (el Director exige que coincidan). Es una COPIA TRANSFORMADA y se declara como tal:
 *   · la `huella` de la fila es un hash NO criptográfico del conjunto de claves de incidencias (`filaDeInstantanea`), no del payload completo: la transformación no la
 *     altera, pero aquí se RECALCULA sobre la copia y se compara con la original (si no coincidiera, la copia se rechaza);
 *   · se calculan sha-256 del payload original y del de la copia (distintos a propósito) y se devuelven como metadatos de procedencia (`copia`), que el Director muestra.
 * `host`, `idEjecucion`, `generadoEn`, `huella` y el resto de la evidencia se conservan.
 */
export function aEntornoPruebas(fila) {
  const original = JSON.parse(fila.payload);
  const copiaPayload = { ...original, entorno: 'local' };
  const recalculada = filaDeInstantanea(copiaPayload, { idEjecucion: fila.idEjecucion, origen: fila.origen }).huella;
  const recalculadaOriginal = filaDeInstantanea(original, { idEjecucion: fila.idEjecucion, origen: fila.origen }).huella;
  if (recalculada !== fila.huella) throw new Error(`La huella de la fila ${fila.idEjecucion} no coincide al recalcularla sobre la copia (${fila.huella} ≠ ${recalculada}).`);
  const payload = JSON.stringify(copiaPayload);
  return {
    fila: { ...Object.fromEntries(COLUMNAS_INSTANTANEAS.map((c) => [c, fila[c]])), entorno: 'local', payload },
    copia: { entornoOriginal: fila.entorno, entornoCopia: 'local', sha256PayloadOriginal: sha256(fila.payload), sha256PayloadCopia: sha256(payload), huellaFila: fila.huella, huellaFilaCoincide: true, huellaOriginalCoincide: recalculadaOriginal === fila.huella, transformacion: 'entorno rotulado en la fila y en el payload; resto sin cambios' },
  };
}

// ── Estado de las tablas de pruebas: clasificación, plan de recuperación y ejecución verificada (la API se inyecta) ──────────────────────────────
const nombreRespaldo = (ag) => `${TABLAS[ag]}_sintetico_respaldo`;
const esSintetica = (t) => t.filas.length > 0 && t.filas.every((f) => f.host === HOST_SINTETICO);

/**
 * Examina las tablas (`{id,name,filas:[{host}]}`) y devuelve `{ok, normal, problemas, plan}`. NUNCA propone borrar una tabla sintética ni algo que no pueda identificar:
 * ante cualquier ambigüedad devuelve `problemas` y plan vacío para ese agente. `temporales` (ids creados por esta ejecución) tienen prioridad sobre el contenido.
 */
export function planRecuperacion(tablas, { temporales = [] } = {}) {
  const problemas = []; const plan = [];
  for (const ag of ['04', '12']) {
    const N = TABLAS[ag]; const R = nombreRespaldo(ag);
    const can = tablas.filter((t) => t.name === N); const resp = tablas.filter((t) => t.name === R);
    const esTemp = (t) => temporales.includes(t.id) || !esSintetica(t);
    if (!resp.length) {
      if (can.length === 1 && esSintetica(can[0]) && !temporales.includes(can[0].id)) continue; // estado normal
      problemas.push(`${ag}: no hay tabla sintética identificable (${can.length} tabla(s) «${N}», ${resp.length} respaldo(s)); restaurar a mano desde respaldo-sinteticas-*.json`);
      continue;
    }
    if (resp.length > 1 || !esSintetica(resp[0])) { problemas.push(`${ag}: respaldo ambiguo (${resp.length} tabla(s) «${R}»)`); continue; }
    if (can.some((t) => !esTemp(t) || t.id === resp[0].id)) { problemas.push(`${ag}: hay una tabla «${N}» que parece sintética junto al respaldo; no se borra nada sin revisión`); continue; }
    for (const t of can) plan.push({ accion: 'borrar', id: t.id, nombre: N, agente: ag });
    plan.push({ accion: 'renombrar', id: resp[0].id, a: N, agente: ag });
  }
  return { ok: !problemas.length, normal: !problemas.length && !plan.length, problemas, plan };
}

/**
 * Recupera el estado esperado con la MISMA lógica tras una ejecución, un error, una interrupción o a mano (`recuperar`). `api`: `{listar(), renombrar(id,n), borrar(id)}`.
 * Cada borrado se hace tras identificar el id y volver a comprobar su nombre; al final se vuelve a listar y se comprueba el estado y, si se dan, las filas sintéticas esperadas.
 */
export async function recuperarTablas(api, { temporales = [], filasSinteticas = null, mostrar: m = () => {} } = {}) {
  const antes = await api.listar();
  const { ok, problemas, plan } = planRecuperacion(antes, { temporales });
  if (!ok) return { ok: false, problemas, hecho: [], tablas: antes.map((t) => t.name).sort() };
  const hecho = [];
  for (const paso of plan) {
    if (paso.accion === 'borrar') {
      const t = (await api.listar()).find((x) => x.id === paso.id);
      if (!t || t.name !== paso.nombre) return { ok: false, problemas: [`la tabla ${paso.id} ya no es la esperada; recuperación detenida`], hecho };
      await api.borrar(paso.id);
    } else await api.renombrar(paso.id, paso.a);
    hecho.push(`${paso.accion} ${paso.id}`); m('  recuperación', `${paso.accion} ${paso.agente} ${paso.id}`);
  }
  const despues = await api.listar();
  const fin = planRecuperacion(despues);
  const errores = [...fin.problemas, ...(fin.plan.length ? ['quedan pasos de recuperación pendientes'] : [])];
  if (filasSinteticas) for (const ag of ['04', '12']) { const t = despues.find((x) => x.name === TABLAS[ag]); if (!t || t.filas.length !== filasSinteticas[ag]) errores.push(`${ag}: filas sintéticas ${t ? t.filas.length : 'sin tabla'} ≠ ${filasSinteticas[ag]} respaldadas`); }
  return { ok: !errores.length, problemas: errores, hecho, tablas: despues.map((t) => t.name).sort() };
}

let _limpieza = null;
/**
 * Prueba con tablas reales saneadas. Antes de tocar nada exige el estado normal; apartar → cargar → circuito; la recuperación va SIEMPRE en `finally` (y también ante
 * SIGINT/SIGTERM). `api`: `{listar, renombrar, borrar, crear(name)→id, anadir(id,filas), leerFilas(id), publicar(), despublicar(), activos()}`; `circuito(copias)`.
 */
export async function ejecutarPrueba({ api, datos, circuito, rutaRespaldo, mostrar: m = mostrar }) {
  const inicial = await api.listar();
  const pre = planRecuperacion(inicial);
  if (!pre.normal) throw new Error(`El n8n de pruebas NO está en el estado normal (${pre.problemas.concat(pre.plan.map((p) => `${p.accion} ${p.id}`)).join('; ')}). Ejecuta «recuperar» antes de probar.`);
  const sint = {}; for (const ag of ['04', '12']) sint[ag] = inicial.find((t) => t.name === TABLAS[ag]);
  const respaldo = {}; for (const ag of ['04', '12']) respaldo[ag] = await api.leerFilas(sint[ag].id);
  fs.writeFileSync(rutaRespaldo, JSON.stringify(respaldo));
  const filasSinteticas = { '04': respaldo['04'].length, '12': respaldo['12'].length };
  m('respaldo de filas sintéticas', `${filasSinteticas['04']}+${filasSinteticas['12']} filas → ${path.basename(rutaRespaldo)}`);
  const temporales = []; let publicado = false; let recuperacion = null; let fallo = null;
  const limpiar = async () => {
    if (recuperacion) return recuperacion;
    try { if (publicado || (await api.activos()) > 0) { await api.despublicar(); publicado = false; } } catch (e) { m('ERROR al despublicar', e.message); fallo = fallo || e; }
    try { recuperacion = await recuperarTablas(api, { temporales, filasSinteticas, mostrar: m }); } catch (e) { recuperacion = { ok: false, problemas: [e.message], hecho: [] }; }
    return recuperacion;
  };
  _limpieza = limpiar;
  try {
    for (const ag of ['04', '12']) await api.renombrar(sint[ag].id, nombreRespaldo(ag));
    const copias = {};
    for (const ag of ['04', '12']) {
      const id = await api.crear(TABLAS[ag]); temporales.push(id);
      const conv = datos[ag].filas.map(aEntornoPruebas); copias[ag] = conv[0].copia;
      await api.anadir(id, conv.map((c) => c.fila));
    }
    m('tablas reales saneadas cargadas', `${datos['04'].filas.length}+${datos['12'].filas.length} filas`);
    await api.publicar(); publicado = true;
    await circuito(copias);
  } catch (e) { fallo = e; m('ERROR en la prueba', e.message); }
  finally { await limpiar(); _limpieza = null; }
  const r = recuperacion;
  m('restauración: tablas sintéticas originales', r.ok ? 'OK (mismos ids y nombres, mismas filas)' : `FALLÓ: ${r.problemas.join('; ')}`);
  m('tablas que quedan en el n8n de pruebas', (r.tablas || []).join(', '));
  m('workflows activos al terminar', String(await api.activos()));
  if (!r.ok || fallo) { const err = new Error(!r.ok ? `Restauración incompleta: ${r.problemas.join('; ')}. Usa «recuperar».` : fallo.message); err.restaurado = r.ok; throw err; }
  return { restaurado: r.ok };
}

async function apiN8n() {
  const t = await mcp();
  const buscar = async () => (await t('search_data_tables', { query: 'instantaneas', projectId: PROYECTO })).data;
  return {
    async listar() { const out = []; for (const x of await buscar()) out.push({ id: x.id, name: x.name, filas: ((await t('get_data_table_rows', { dataTableId: x.id, projectId: PROYECTO, limit: 100 })).rows ?? []).map((f) => ({ host: f.host, idEjecucion: f.idEjecucion })) }); return out; },
    async leerFilas(id) { return (await t('get_data_table_rows', { dataTableId: id, projectId: PROYECTO, limit: 100 })).rows ?? []; },
    renombrar: (id, name) => t('rename_data_table', { dataTableId: id, projectId: PROYECTO, name }),
    borrar: (id) => borrarTablaRest(id),
    async crear(name) {
      const antes = new Set((await buscar()).map((x) => x.id));
      const c = await t('create_data_table', { projectId: PROYECTO, name, columns: COLUMNAS_INSTANTANEAS.map((n) => ({ name: n, type: 'string' })) });
      const nueva = (await buscar()).filter((x) => x.name === name && !antes.has(x.id));
      const id = nueva.length === 1 ? nueva[0].id : c?.id;
      if (!id || nueva.length > 1) throw new Error(`No se pudo identificar con certeza la tabla temporal «${name}»`);
      return id;
    },
    anadir: (id, rows) => t('add_data_table_rows', { dataTableId: id, projectId: PROYECTO, rows }),
    async publicar() { docker('exec', CONTENEDOR, 'n8n', 'publish:workflow', `--id=${WORKFLOW_LECTOR}`); await restart(); },
    async despublicar() { docker('exec', CONTENEDOR, 'n8n', 'unpublish:workflow', `--id=${WORKFLOW_LECTOR}`); await restart(); },
    async activos() { return docker('exec', CONTENEDOR, 'n8n', 'list:workflow', '--active=true').split('\n').filter((l) => l.includes('|')).length; },
  };
}

async function probar({ reales }) {
  const token = fs.readFileSync(path.join(RAIZ_PRUEBAS, 'lector-token.txt'), 'utf8').trim();
  const datos = {};
  for (const ag of ['04', '12']) {
    const f = path.join(reales, `${ag}.json`);
    if (!fs.existsSync(f)) throw new Error(`Falta ${f}`);
    datos[ag] = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (datos[ag].saneado !== true || datos[ag].sintetico !== false) throw new Error(`${f} no es una exportación saneada`);
  }
  const api = await apiN8n();
  const rutaRespaldo = path.join(RAIZ_PRUEBAS, `respaldo-sinteticas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await ejecutarPrueba({ api, datos, rutaRespaldo, circuito: (copias) => circuito(token, copias) });
}

async function recuperar() {
  const api = await apiN8n();
  const r = await recuperarTablas(api, { mostrar });
  mostrar('recuperación', r.ok ? (r.hecho.length ? `hecha: ${r.hecho.join(', ')}` : 'no era necesaria (estado normal)') : `NO SE PUDO: ${r.problemas.join('; ')}`);
  if (r.tablas) mostrar('tablas', r.tablas.join(', '));
  if (!r.ok) process.exitCode = 1;
}

async function circuito(token, copias) {
  const { construirDirector } = await import('./director.mjs');
  const { LectorN8n } = await import('../../automation/director/puente/lector-n8n.mjs');
  const { AlmacenTokens } = await import('../../automation/director/puente/tokens.mjs');
  const { crearServicioPuente } = await import('../../automation/director/puente/servidor.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-real-'));
  fs.mkdirSync(path.join(tmp, 'ledger')); fs.mkdirSync(path.join(tmp, 'inst'));
  const { director, ledger } = construirDirector({ ledger: path.join(tmp, 'ledger'), instantaneas: path.join(tmp, 'inst') });
  const lector = new LectorN8n({ urlBase: `${N8N}/webhook`, token, procedencia: 'real_saneado', copias });
  director.lector = lector;
  const tokens = new AlmacenTokens(); const { token: tc } = tokens.crear({ id: 'consola-local', dias: 1 });
  const svc = crearServicioPuente({ director, tokens }); const { host, puerto } = await svc.escuchar();
  const enviar = async (texto, k) => (await fetch(`http://${host}:${puerto}/tai/v1/mensajes`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tc}` }, body: JSON.stringify({ esquema: 'tai-puente/1', idSolicitud: `sol-${k}-00001`, claveIdempotencia: `idem-${k}-0001`, canal: 'texto', texto }) })).json();
  try {
    for (const [texto, ag, k] of [['¿Cómo está el sitio?', '12', 'a'], ['¿Cómo está el catálogo?', '04', 'b'], ['¿Cuántas incidencias tenía el catálogo?', '04', 'c']]) {
      const j = await enviar(texto, k);
      const m = j.mensaje; const tr = j.trazabilidad?.tareas?.find((x) => x.capacidad === `${ag}.leer-ultimo-informe`);
      console.log(`\n«${texto}»`);
      mostrar('  estado / categoría', `${m.estado} / ${m.categoria}`);
      mostrar('  naturaleza de los datos', (m.naturalezaDatos || []).map((n) => n.etiqueta).join(', '));
      mostrar('  respuesta (primeras líneas)', JSON.stringify(m.detalle.split('\n').slice(0, 2)).slice(0, 300));
      mostrar('  avisos', JSON.stringify((m.avisos || []).map((a) => a.slice(0, 90))));
      mostrar('  evidencia', tr?.evidencias?.[0] ? `${tr.evidencias[0].referencia} · origen=${tr.evidencias[0].origen} · capturada ${tr.evidencias[0].capturadaEn}` : 'ninguna');
      mostrar('  consistencia de lecturas', tr?.verificaciones?.map((v) => v.resultado).join(',') || 'ninguna');
    }
    mostrar('\nledger íntegro', String(ledger.verificarCadena().ok));
  } finally { await svc.cerrar(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [orden, ...resto] = process.argv.slice(2);
  // una salida cerrada (p. ej. `| head`) no debe cortar el script antes de restaurar
  process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { try { if (_limpieza) await _limpieza(); } finally { process.exit(130); } });
  const o = {}; for (let i = 0; i < resto.length; i++) { if (resto[i].startsWith('--')) { const k = resto[i].slice(2); o[k] = ['csv', 'agente', 'salida', 'reales'].includes(k) ? resto[++i] : true; } }
  try {
    if (orden === 'preparar') {
      const salida = o.salida || path.join(RAIZ_PRUEBAS, 'reales');
      const r = prepararFila({ csv: fs.readFileSync(o.csv, 'utf8'), agente: o.agente, permitirNoProduccion: Boolean(o['permitir-no-produccion']) });
      fs.mkdirSync(salida, { recursive: true }); fs.writeFileSync(path.join(salida, `${o.agente}.json`), JSON.stringify(r.datos));
      mostrar('agente', o.agente); for (const [k, v] of Object.entries(r.resumen)) mostrar(k, typeof v === 'object' ? JSON.stringify(v) : v);
      mostrar('escrito', path.join(salida, `${o.agente}.json`));
    } else if (orden === 'probar') await probar({ reales: o.reales || path.join(RAIZ_PRUEBAS, 'reales') });
    else if (orden === 'recuperar') await recuperar();
    else { console.error('Uso: instantanea-real.mjs preparar --csv <archivo> --agente 04|12 | probar [--reales <dir>] | recuperar'); process.exit(2); }
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
}
