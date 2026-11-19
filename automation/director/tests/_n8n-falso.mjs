/**
 * n8n FALSO PARA PRUEBAS (sólo en memoria, sólo bucle local). No es n8n: ejecuta el JSON REAL del workflow `lector-instantaneas.local.json` nodo a nodo:
 *  · Webhook: comprueba la cabecera de la credencial (403 si no coincide) y entrega { headers, params, query, body };
 *  · Code: ejecuta el `jsCode` generado (con `$input`, `$`, `$execution` mínimos);
 *  · Data table «Get»: filtra por entorno, ordena por generadoEn DESC y limita (sobre filas sintéticas);
 *  · Respond to Webhook: devuelve el JSON.
 * Un fallo en un Code devuelve 500 (como n8n con la respuesta por nodo). NO verifica nada de lo que sólo se puede comprobar en un n8n real (ver INTEGRACION-N8N-PUENTE.md).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const cargarWorkflowLector = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'automation', 'workflows-puente', 'lector-instantaneas.local.json'), 'utf8'));

export const cargarWorkflowProduccion = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'automation', 'workflows-puente', 'produccion', 'lector-instantaneas.produccion.json'), 'utf8'));

export function ejecutarCadena(wf, rutaWebhook, entrada, tablas, { ordenar = true } = {}) {
  const nodos = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const sig = (n) => ((wf.connections[n] || {}).main || [[]])[0].map((c) => c.node)[0];
  const w = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === rutaWebhook);
  if (!w) return { estado: 404 };
  const salidas = {}; // nombre → items [{json}]
  salidas[w.name] = [{ json: entrada }];
  let actual = sig(w.name);
  let previo = w.name;
  while (actual) {
    const n = nodos[actual];
    const entradaItems = salidas[previo];
    if (n.type === 'n8n-nodes-base.code') {
      const $ = (nombre) => ({ all: () => { if (!salidas[nombre]) throw new Error(`nodo ${nombre} sin ejecutar`); return salidas[nombre]; } });
      const f = new Function('$input', '$', '$execution', n.parameters.jsCode);
      salidas[actual] = f({ all: () => entradaItems, first: () => entradaItems[0] }, $, { mode: 'test', id: 'ex-falso' });
    } else if (n.type === 'n8n-nodes-base.dataTable') {
      const p = n.parameters;
      const tabla = tablas[p.dataTableId.value] || [];
      const cond = p.filters.conditions[0];
      const valor = cond.keyValue.startsWith('={{') ? entradaItems[0].json[cond.keyValue.match(/\$json\.(\w+)/)[1]] : cond.keyValue;
      const sel = tabla.filter((f) => f[cond.keyName] === valor);
      const filas = (ordenar ? sel.sort((a, b) => (a.generadoEn < b.generadoEn ? 1 : -1)) : sel).slice(0, p.limit);
      salidas[actual] = filas.length ? filas.map((f) => ({ json: { ...f } })) : [{ json: {} }]; // alwaysOutputData
    } else if (n.type === 'n8n-nodes-base.respondToWebhook') {
      if (n.parameters.responseBody !== '={{ JSON.stringify($json) }}') throw new Error('cuerpo de respuesta no soportado por el n8n falso');
      return { estado: n.parameters.options.responseCode, cuerpo: entradaItems[0].json };
    }
    previo = actual;
    actual = sig(actual);
  }
  return { estado: 500 };
}

/** `tablas`: { nombre_tabla: [filas] }. `token`: valor de la credencial Header Auth. */
export async function arrancarN8nFalso({ tablas, token, cabecera = 'x-treidilor-lector', modificar = null, workflow = null, patron = /^\/webhook\/(tai-lector-(?:04|12))$/, ordenar = true }) {
  const wf = workflow || cargarWorkflowLector();
  const registro = [];
  const servidor = http.createServer((req, res) => {
    const trozos = [];
    req.on('data', (c) => trozos.push(c));
    req.on('end', () => {
      const texto = Buffer.concat(trozos).toString('utf8');
      registro.push({ metodo: req.method, url: req.url, cabecera: req.headers[cabecera] ? 'presente' : 'ausente', cuerpo: texto });
      const m = patron.exec(req.url);
      const fin = (estado, cuerpo) => { const t = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo ?? {}); res.writeHead(estado, { 'content-type': 'application/json' }); res.end(t); };
      if (!m || req.method !== 'POST') return fin(404, { message: 'not found' });
      if (req.headers[cabecera] !== token) return fin(403, { message: 'Authorization data is wrong!' });
      let body;
      try { body = JSON.parse(texto); } catch { body = null; }
      let r;
      try { r = ejecutarCadena(wf, m[1], { headers: req.headers, params: {}, query: {}, body }, tablas, { ordenar }); } catch { return fin(500, { message: 'Error in workflow' }); }
      if (modificar) return modificar(r, fin, body);
      return fin(r.estado, r.cuerpo);
    });
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const puerto = servidor.address().port;
  return { puerto, urlBase: `http://127.0.0.1:${puerto}/webhook`, registro, cerrar: () => new Promise((r) => { servidor.close(() => r()); servidor.closeAllConnections?.(); }) };
}
