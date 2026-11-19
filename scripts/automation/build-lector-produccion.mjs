#!/usr/bin/env node
// Constructor del LECTOR DE PRODUCCIÓN (SÓLO LECTURA). Archivo NUEVO e independiente: no modifica `build-workflows.mjs` ni `lint-workflows.mjs` (protegidos).
// Genera `automation/workflows-puente/produccion/lector-instantaneas.produccion.json` (subcarpeta a propósito: el linter general no la recorre; la valida `lint-lector-produccion.mjs`).
//   node scripts/automation/build-lector-produccion.mjs --write | --check
// Reutiliza la poda de bibliotecas y la normalización del constructor general. NO importa ni publica nada en n8n; el valor de la credencial NUNCA va en el archivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { podar } from './build-workflows.mjs';
import { idNodo, normalizarWorkflow, serializar } from './normalize-workflow.mjs';
import { CABECERA_LECTOR_PRODUCCION, CREDENCIAL_LECTOR_PRODUCCION, ENTORNO_PRODUCCION, MAX_LECTURA_TABLA, PREFIJO_RUTA_PRODUCCION } from '../../automation/lib/lectorProduccion.mjs';
import { TABLAS_LECTOR } from '../../automation/lib/lectorPuente.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SALIDA_PRODUCCION = path.join(RAIZ, 'automation', 'workflows-puente', 'produccion');
export const ARCHIVO_PRODUCCION = 'lector-instantaneas.produccion.json';
export const NOMBRE_WORKFLOW_PRODUCCION = 'Treidilor AI · Lector de PRODUCCIÓN de instantáneas (solo lectura)';
const MODULOS = ['seguimiento', 'lectorPuente', 'lectorProduccion'];
const AYUDA = "const nodo = (n) => { try { return $(n).all().map((i) => i.json); } catch (e) { return []; } };";
// Igual que `leerModulo` del constructor general (no exportada): sin import/export ni comentarios de línea completa. La poda se hace ANTES de compactar (necesita la sangría).
const LIB = path.join(RAIZ, 'automation', 'lib');
const leerModulo = (nombre) => fs.readFileSync(path.join(LIB, `${nombre}.mjs`), 'utf8').replace(/\r\n/g, '\n')
  .replace(/^import\s+[^;]*?from\s+'\.\/[A-Za-z]+\.mjs';\s*$/gm, '')
  .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '')
  .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n?/gm, '')
  .replace(/^[ \t]*\/\/.*\n?/gm, '');
const compactar = (t) => t.replace(/^[ \t]+/gm, '').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim();

const codigoNodo = (config, adaptador) => {
  const crudo = MODULOS.map((m) => leerModulo(m)).join('\n\n');
  return `${compactar(podar(crudo, adaptador))}\n\n// ── adaptador del nodo ──\nconst LECTOR = ${JSON.stringify(config, null, 2)};\n${AYUDA}\n${adaptador}\n`;
};
const nodoCode = (nombre, js, pos) => ({ parameters: { jsCode: js }, name: nombre, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos });
const cadena = (nombres) => { const c = {}; nombres.slice(0, -1).forEach((n, i) => { c[n] = { main: [[{ node: nombres[i + 1], type: 'main', index: 0 }]] }; }); return c; };

export function lectorProduccion() {
  const nota = { parameters: { content: `TREIDILOR AI · LECTOR DE PRODUCCIÓN DE INSTANTÁNEAS (puente Director ↔ n8n). SÓLO CONSULTA.\nDos Webhooks POST (${PREFIJO_RUTA_PRODUCCION}04 y ${PREFIJO_RUTA_PRODUCCION}12), cada uno con la credencial EXCLUSIVA «${CREDENCIAL_LECTOR_PRODUCCION}» (Header Auth con cabecera ${CABECERA_LECTOR_PRODUCCION}, creada a mano en n8n: el valor NUNCA va en este archivo ni se reutiliza la del lector de pruebas).\nLee UNA tabla fija por agente (Data table «Get», entorno «${ENTORNO_PRODUCCION}») y responde sólo la instantánea más reciente por generadoEn. No escribe, no hace peticiones salientes, no guarda datos de ejecución y NO aprueba ni decide nada.\nNO debe ser alcanzable desde Internet: ver automation/docs/LECTOR-PRODUCCION-DESPLIEGUE.md antes de publicarlo. Se genera con scripts/automation/build-lector-produccion.mjs: no se edita a mano. Se importa y se activa SÓLO a mano y con autorización.`, height: 260, width: 460 }, name: 'Aviso', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -460] };
  const nodos = [nota];
  const conexiones = {};
  let fila = 0;
  for (const agente of ['04', '12']) {
    const config = { agente, tabla: TABLAS_LECTOR[agente], entornos: [ENTORNO_PRODUCCION], sintetico: false };
    const y = 260 * fila;
    const r = `Recibir (${agente})`; const v = `Validar solicitud (${agente})`; const l = `Leer instantáneas (${agente})`; const a = `Armar respuesta (${agente})`; const o = `Responder (${agente})`;
    nodos.push(
      { parameters: { httpMethod: 'POST', path: `${PREFIJO_RUTA_PRODUCCION}${agente}`, authentication: 'headerAuth', responseMode: 'responseNode', options: {} }, name: r, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, y], credentials: { httpHeaderAuth: { id: 'REEMPLAZAR_AL_IMPORTAR', name: CREDENCIAL_LECTOR_PRODUCCION } } },
      nodoCode(v, codigoNodo(config, "const entrada = $input.first().json;\nconst r = validarSolicitudProduccion(entrada.body, { agentes: [LECTOR.agente], ahoraMs: Date.now() });\nif (!r.ok) throw new Error('SOLICITUD NO VÁLIDA: ' + r.errores.join('; '));\nreturn [{ json: r.solicitud }];"), [260, y]),
      { parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'name', value: config.tabla }, matchType: 'allConditions', filters: { conditions: [{ keyName: 'entorno', condition: 'eq', keyValue: '={{ $json.entorno }}' }] }, returnAll: false, limit: MAX_LECTURA_TABLA, orderBy: true, orderByColumn: 'generadoEn', orderByDirection: 'DESC' }, name: l, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [520, y], onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: false },
      nodoCode(a, codigoNodo(config, `const solicitud = nodo('${v}')[0];\nconst crudas = $input.all().map((i) => i.json);\nif (crudas.some((f) => f && f.error)) throw new Error('LECTURA FALLIDA: la tabla no se pudo leer');\nreturn [{ json: armarRespuestaProduccion({ solicitud, filas: crudas, ahoraIso: new Date().toISOString() }) }];`), [780, y]),
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseCode: 200 } }, name: o, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1040, y] },
    );
    Object.assign(conexiones, cadena([r, v, l, a, o]));
    fila += 1;
  }
  return { name: NOMBRE_WORKFLOW_PRODUCCION, nodes: nodos, connections: conexiones, active: false, settings: { executionOrder: 'v1', timezone: 'Europe/Madrid', executionTimeout: 60, saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveExecutionProgress: false }, tags: [] };
}

const conWebhookId = (wf) => ({ ...wf, nodes: wf.nodes.map((n) => (n.type === 'n8n-nodes-base.webhook' ? { ...n, webhookId: idNodo(`${wf.name} webhook`, n.name) } : n)) });
export const construirLectorProduccion = () => serializar(conWebhookId(normalizarWorkflow(lectorProduccion())));

if (process.argv[1]?.endsWith('build-lector-produccion.mjs')) {
  const modo = process.argv[2];
  const texto = construirLectorProduccion();
  const destino = path.join(SALIDA_PRODUCCION, ARCHIVO_PRODUCCION);
  if (modo === '--write') { fs.mkdirSync(SALIDA_PRODUCCION, { recursive: true }); fs.writeFileSync(destino, texto); console.log(`escrito ${path.relative(RAIZ, destino)} (${texto.length} bytes)`); }
  else if (modo === '--check') {
    const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8').replace(/\r\n/g, '\n') : null;
    if (actual !== texto) { console.error(`✖ ${ARCHIVO_PRODUCCION}: desincronizado con automation/lib (ejecuta --write)`); process.exit(1); }
    console.log(`✔ ${ARCHIVO_PRODUCCION}`);
  } else { console.error('Uso: build-lector-produccion.mjs --write | --check'); process.exit(2); }
}
