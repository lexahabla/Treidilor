#!/usr/bin/env node
// WORKFLOW CANARIO del aislamiento (SIN DATOS): sirve para comprobar que el proxy NO deja pasar la ruta del lector antes de publicar el lector real. Archivo NUEVO e independiente.
//   node scripts/automation/build-canario-aislamiento.mjs --write | --check      (escribe/comprueba automation/workflows-puente/produccion/canario-aislamiento.produccion.json)
// Estructura: Webhook POST `tai-lector-prod-canario` (credencial DESECHABLE propia, nunca la del lector) → Respond `{"canario":true}`. Sin tablas, sin Code, sin HTTP, sin datos.
// La variante de PRUEBA LOCAL (`canarioAislamiento({ ipWhitelist, controlPublico })`) añade la lista de IP y una ruta pública de control; se genera en memoria y NO se guarda en el repositorio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { idNodo, normalizarWorkflow, serializar } from './normalize-workflow.mjs';
import { RUTA_CANARIO, RUTA_PUBLICA_CONTROL } from '../../automation/dev/prueba-traefik/matriz.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ARCHIVO_CANARIO = 'canario-aislamiento.produccion.json';
export const NOMBRE_CANARIO = 'Treidilor AI · Canario de aislamiento (sin datos)';
export const CREDENCIAL_CANARIO = 'Treidilor — Canario aislamiento (desechable)';
export const CABECERA_CANARIO = 'x-treidilor-canario';
const DESTINO = path.join(RAIZ, 'automation', 'workflows-puente', 'produccion', ARCHIVO_CANARIO);

export function canarioAislamiento({ ipWhitelist = null, controlPublico = false } = {}) {
  const nodos = [{ parameters: { content: `TREIDILOR AI · CANARIO DE AISLAMIENTO. SIN DATOS.\nResponde {"canario":true} en /webhook/${RUTA_CANARIO} con una credencial DESECHABLE («${CREDENCIAL_CANARIO}», Header Auth ${CABECERA_CANARIO}; el valor se crea a mano y se borra al terminar). No lee tablas, no escribe, no hace peticiones salientes. GUARDA sus ejecuciones a propósito para contarlas: 0 desde fuera y 1 por cada prueba interior autorizada.\nSirve SOLO para comprobar que el proxy público no entrega esta ruta (mismo prefijo que el lector real). Se importa INACTIVO, se publica de forma temporal y se elimina junto con su credencial. Generado por scripts/automation/build-canario-aislamiento.mjs.`, height: 200, width: 460 }, name: 'Aviso', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -300] }];
  const conexiones = {};
  const rutas = [{ nombre: 'canario', path: RUTA_CANARIO, cuerpo: '{"canario":true}', auth: true }];
  if (controlPublico) rutas.push({ nombre: 'publico', path: RUTA_PUBLICA_CONTROL, cuerpo: '{"publico":true}', auth: false }); // SOLO prueba local: ruta legítima de control
  let y = 0;
  for (const r of rutas) {
    const rec = `Recibir (${r.nombre})`; const res = `Responder (${r.nombre})`;
    const opciones = r.auth && ipWhitelist ? { ipWhitelist } : {};
    nodos.push(
      { parameters: { httpMethod: 'POST', path: r.path, ...(r.auth ? { authentication: 'headerAuth' } : { authentication: 'none' }), responseMode: 'responseNode', options: opciones }, name: rec, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, y], ...(r.auth ? { credentials: { httpHeaderAuth: { id: 'REEMPLAZAR_AL_IMPORTAR', name: CREDENCIAL_CANARIO } } } : {}) },
      { parameters: { respondWith: 'json', responseBody: r.cuerpo, options: { responseCode: 200 } }, name: res, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [300, y] },
    );
    conexiones[rec] = { main: [[{ node: res, type: 'main', index: 0 }]] };
    y += 220;
  }
  return { name: NOMBRE_CANARIO, nodes: nodos, connections: conexiones, active: false, settings: { executionOrder: 'v1', timezone: 'Europe/Madrid', executionTimeout: 30, saveManualExecutions: false, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', saveExecutionProgress: false }, tags: [] };
}
const conWebhookId = (wf) => ({ ...wf, nodes: wf.nodes.map((n) => (n.type === 'n8n-nodes-base.webhook' ? { ...n, webhookId: idNodo(`${wf.name} webhook`, n.name) } : n)) });
export const construirCanario = (o) => serializar(conWebhookId(normalizarWorkflow(canarioAislamiento(o))));

/** Linter del canario DE PRODUCCIÓN (el archivo del repositorio): una sola ruta, sin datos, sin Code ni tablas ni HTTP, credencial desechable propia, inactivo. */
export function lintCanario(wf) {
  const e = [];
  if (wf.name !== NOMBRE_CANARIO) e.push('nombre distinto del aprobado');
  if (wf.active !== false) e.push('debe importarse inactivo');
  const tipos = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.respondToWebhook', 'n8n-nodes-base.stickyNote']);
  for (const n of wf.nodes) if (!tipos.has(n.type)) e.push(`nodo no permitido «${n.name}» (${n.type}): el canario no lee ni escribe nada`);
  const w = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  if (w.length !== 1) e.push(`debe haber exactamente un webhook (hay ${w.length})`);
  for (const n of w) {
    const p = n.parameters ?? {};
    if (p.path !== RUTA_CANARIO) e.push(`el path debe ser ${RUTA_CANARIO}`);
    if (p.httpMethod !== 'POST' || p.authentication !== 'headerAuth' || p.responseMode !== 'responseNode') e.push('el webhook debe ser POST con headerAuth y respuesta por nodo');
    if (Object.keys(p.options ?? {}).length) e.push('el archivo del repositorio no lleva opciones (la lista de IP se añade a mano al importar)');
    const c = n.credentials ?? {};
    if (Object.keys(c).length !== 1 || c.httpHeaderAuth?.name !== CREDENCIAL_CANARIO || c.httpHeaderAuth?.id !== 'REEMPLAZAR_AL_IMPORTAR') e.push(`debe usar solo la credencial «${CREDENCIAL_CANARIO}» (por nombre, id de marcador)`);
  }
  const r = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  if (r.length !== 1 || r[0].parameters?.responseBody !== '{"canario":true}' || Number(r[0].parameters?.options?.responseCode) !== 200) e.push('debe responder exactamente {"canario":true} con 200');
  const s = wf.settings ?? {};
  // A PROPÓSITO el canario GUARDA sus ejecuciones: con «none» un «0 ejecuciones» no probaría nada (tampoco se vería una fuga). No contiene datos; la credencial desechable queda en esos registros y se borra con el workflow.
  if (s.saveDataErrorExecution !== 'all' || s.saveDataSuccessExecution !== 'all') e.push('debe guardar sus ejecuciones (saveData*Execution = all): sin ello el contador de ejecuciones no es verificable');
  if (/Bearer\s+[A-Za-z0-9._~+/=-]{16,}|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{10,}\./.test(JSON.stringify(wf))) e.push('contiene algo con forma de secreto');
  return e;
}

if (process.argv[1]?.endsWith('build-canario-aislamiento.mjs')) {
  const modo = process.argv[2];
  const texto = construirCanario();
  if (modo === '--write') { fs.mkdirSync(path.dirname(DESTINO), { recursive: true }); fs.writeFileSync(DESTINO, texto); console.log(`escrito ${path.relative(RAIZ, DESTINO)} (${texto.length} bytes)`); }
  else if (modo === '--check') {
    const actual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n') : null;
    if (actual !== texto) { console.error(`✖ ${ARCHIVO_CANARIO}: desincronizado (ejecuta --write)`); process.exit(1); }
    const errores = lintCanario(JSON.parse(actual));
    if (errores.length) { for (const x of errores) console.error(`✖ ${x}`); process.exit(1); }
    console.log(`✔ ${ARCHIVO_CANARIO}`);
  } else { console.error('Uso: build-canario-aislamiento.mjs --write | --check'); process.exit(2); }
}
