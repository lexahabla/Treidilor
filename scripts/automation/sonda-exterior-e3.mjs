#!/usr/bin/env node
// E3 · SONDA EXTERIOR (se ejecuta desde el PC del propietario, por Internet real; NO desde el VPS). Una sola ejecución agrupada. Reutiliza las variantes de ruta ya validadas (`matriz.mjs`).
// Solo POST/GET/HEAD/OPTIONS/PUT/DELETE a rutas del lector SIN datos y sin credenciales reales. Sin `--cred-file` no envía ninguna credencial; con él envía la credencial DESECHABLE del canario (nunca se imprime ni se guarda).
//
//   node scripts/automation/sonda-exterior-e3.mjs --host <dominio-n8n> --salida <carpeta fuera del repo> [--cred-file <archivo con el valor desechable del canario>] [--cabecera x-treidilor-canario]
//   Veredicto: E3_EXTERIOR_OK (código 0) | E3_EXTERIOR_FUGA (2: una ruta bloqueada llegó a n8n) | E3_EXTERIOR_ANULADA (3: los centinelas fallaron) | E3_EXTERIOR_INCOMPLETA (4: faltan celdas por error de red)
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARCAS_N8N, RUTA_CANARIO, VARIANTES_CODIFICADAS, VARIANTES_RUTA } from '../../automation/dev/prueba-traefik/matriz.mjs';

const ESTADOS_TRAEFIK = [400, 403, 404, 405, 414, 421];
/** Una respuesta de Traefik (no de n8n): cuerpo vacío/«Forbidden»/«404 page not found»/«Bad Request» y sin marcas de n8n ni cabeceras de Express. */
export function esRespuestaTraefik(r) {
  const c = String(r.cuerpo ?? '').trim();
  if (MARCAS_N8N.some((re) => re.test(c))) return false;
  if (/express/i.test(String(r.cabeceras?.['x-powered-by'] ?? ''))) return false;
  return /^(Forbidden|404 page not found|Bad Request|400 Bad Request|)$/i.test(c);
}
/** Celda de bloqueo: tiene que ser Traefik con 403 (https) o 403/308→https (http). Un 404 «not registered» de n8n = FUGA (ruta no bloqueada). */
export function evaluarBloqueo(celda, r) {
  const motivos = [];
  if (r.error && !r.estado) return { id: celda.id, ok: false, sinRespuesta: true, motivos: [`sin respuesta (${r.error})`] };
  const cuerpoN8n = MARCAS_N8N.some((re) => re.test(String(r.cuerpo ?? ''))) || /express/i.test(String(r.cabeceras?.['x-powered-by'] ?? ''));
  if (cuerpoN8n) return { id: celda.id, ok: false, fuga: true, estado: r.estado, motivos: ['la respuesta es de n8n (la ruta NO está bloqueada)'] };
  if (celda.entrada === 'http' && [301, 308].includes(r.estado)) {
    if (!/^https:\/\//i.test(String(r.cabeceras?.location ?? ''))) motivos.push('redirección http sin Location https');
    return { id: celda.id, ok: motivos.length === 0, estado: r.estado, via: 'redireccion', motivos };
  }
  if (celda.metodo === 'HEAD') { if (r.estado !== 403) motivos.push(`HEAD: estado ${r.estado} (se esperaba 403)`); return { id: celda.id, ok: motivos.length === 0, estado: r.estado, motivos }; }
  // Criterio de la matriz validada (ESTADOS_BLOQUEO): 403 Forbidden de Traefik, o 400/404/405/414/421 de Traefik (p. ej. rutas sin barra inicial). Lo decisivo es que NO responda n8n.
  if (!ESTADOS_TRAEFIK.includes(r.estado)) motivos.push(`estado ${r.estado} (se esperaba 403 de Traefik)`);
  if (!esRespuestaTraefik(r)) motivos.push('el cuerpo no es el de Traefik');
  return { id: celda.id, ok: motivos.length === 0, estado: r.estado, no403: r.estado !== 403, motivos };
}
/** Centinela positivo: debe llegar a n8n (si no, la tanda se anula: no se puede distinguir «bloqueado» de «servicio caído»). */
export function evaluarCentinela(celda, r) {
  const motivos = [];
  if (!celda.espera.includes(r.estado)) motivos.push(`estado ${r.estado} (se esperaba ${celda.espera.join('/')})`);
  if (celda.cuerpo && !celda.cuerpo.test(String(r.cuerpo ?? ''))) motivos.push('el cuerpo no es el esperado de n8n');
  return { id: celda.id, ok: motivos.length === 0, estado: r.estado, motivos };
}
/** Control negativo: no debe bloquearlo NUESTRA regla (403 con cuerpo «Forbidden» de Traefik). Cualquier otra respuesta vale. */
export function evaluarNegativo(celda, r) {
  const motivos = [];
  if (r.error && !r.estado) motivos.push(`sin respuesta (${r.error})`);
  else if (r.estado === 403 && /^Forbidden$/i.test(String(r.cuerpo ?? '').trim())) motivos.push('la regla bloquea una ruta legítima (403 Forbidden de Traefik)');
  return { id: celda.id, ok: motivos.length === 0, estado: r.estado, motivos };
}

export function construirCeldas(prefijo) {
  const n = { v: 0 };
  const q = (ruta) => { n.v += 1; return `${ruta}${ruta.includes('?') ? '&' : '?'}tai=${prefijo}-${String(n.v).padStart(3, '0')}`; };
  const bloqueo = []; const centinelas = []; const negativos = [];
  for (const [nombre, ruta] of [...VARIANTES_RUTA, ...VARIANTES_CODIFICADAS]) for (const entrada of ['https', 'http']) bloqueo.push({ id: `${nombre}|${entrada}|POST`, metodo: 'POST', entrada, ruta: q(ruta) });
  for (const metodo of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) bloqueo.push({ id: `exacta|https|${metodo}`, metodo, entrada: 'https', ruta: q(`/webhook/${RUTA_CANARIO}`) });
  centinelas.push({ id: 'centinela|healthz', metodo: 'GET', entrada: 'https', ruta: q('/healthz'), espera: [200] });
  centinelas.push({ id: 'centinela|publico-ficticio', metodo: 'POST', entrada: 'https', ruta: q('/webhook/tai-publico-zz'), espera: [404], cuerpo: /not registered/i });
  for (const [id, ruta, metodo] of [['lector-local-04', '/webhook/lector-local-04', 'POST'], ['lector-produccion', '/webhook/tai-lector-produccion', 'POST'], ['webhook-test-ajeno', '/webhook-test/otro-ajeno', 'POST'], ['asset-icono', '/assets/webhook-icon.svg', 'GET'], ['interfaz', '/', 'GET'], ['prod-sin-guion', '/webhook/tai-lector-prod', 'POST']]) negativos.push({ id: `negativo|${id}`, metodo, entrada: 'https', ruta: q(ruta) });
  return { bloqueo, centinelas, negativos, total: n.v };
}

export function peticion({ host, celda, credencial, cabecera, base, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    const u = base ? new URL(base) : null;
    const modo = u ? (u.protocol === 'https:' ? https : http) : (celda.entrada === 'https' ? https : http);
    const cab = { host, 'user-agent': 'treidilor-sonda-e3/1', accept: '*/*' };
    if (celda.metodo === 'POST' || celda.metodo === 'PUT') { cab['content-type'] = 'application/json'; }
    if (credencial) cab[cabecera] = credencial;
    const cuerpo = (celda.metodo === 'POST' || celda.metodo === 'PUT') ? '{"sonda":"e3"}' : null;
    if (cuerpo) cab['content-length'] = Buffer.byteLength(cuerpo);
    const o = { host: u ? u.hostname : host, port: u ? u.port || undefined : (celda.entrada === 'https' ? 443 : 80), path: celda.ruta, method: celda.metodo, headers: cab, timeout: timeoutMs, ...(modo === https && !u ? { servername: host } : {}) };
    const req = modo.request(o, (res) => {
      const trozos = []; let tam = 0;
      res.on('data', (c) => { tam += c.length; if (tam <= 4096) trozos.push(c); });
      res.on('end', () => resolve({ estado: res.statusCode, cuerpo: Buffer.concat(trozos).toString('utf8').slice(0, 240), cabeceras: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ error: e.code || e.message }));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

async function lote(celdas, f, concurrencia = 3, pausaMs = 150) {
  const sal = new Array(celdas.length); let i = 0;
  await Promise.all(Array.from({ length: concurrencia }, async () => { while (i < celdas.length) { const k = i++; sal[k] = await f(celdas[k]); await new Promise((r) => setTimeout(r, pausaMs)); } }));
  return sal;
}

export async function ejecutar({ host, salida, credFile = null, cabecera = 'x-treidilor-canario', base = null, ahora = () => new Date() }) {
  const credencial = credFile ? fs.readFileSync(credFile, 'utf8').trim() : null;
  const prefijo = `e3${ahora().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const { bloqueo, centinelas, negativos, total } = construirCeldas(prefijo);
  const enviar = (celda) => peticion({ host, celda, credencial, cabecera, base });
  const rs = {};
  rs.centinelasAntes = await lote(centinelas, async (c) => ({ c, r: await enviar(c) }), 1);
  rs.bloqueo = await lote(bloqueo, async (c) => ({ c, r: await enviar(c) }));
  rs.negativos = await lote(negativos, async (c) => ({ c, r: await enviar(c) }), 1);
  rs.centinelasDespues = await lote(centinelas, async (c) => ({ c, r: await enviar(c) }), 1);
  const cent = [...rs.centinelasAntes, ...rs.centinelasDespues].map(({ c, r }) => evaluarCentinela(c, r));
  const blo = rs.bloqueo.map(({ c, r }) => evaluarBloqueo(c, r));
  const neg = rs.negativos.map(({ c, r }) => evaluarNegativo(c, r));
  const fugas = blo.filter((x) => x.fuga); const sinResp = blo.filter((x) => x.sinRespuesta); const falla = blo.filter((x) => !x.ok && !x.fuga && !x.sinRespuesta);
  let veredicto; let codigo;
  if (fugas.length) { veredicto = 'E3_EXTERIOR_FUGA'; codigo = 2; }
  else if (cent.some((x) => !x.ok)) { veredicto = 'E3_EXTERIOR_ANULADA'; codigo = 3; }
  else if (sinResp.length) { veredicto = 'E3_EXTERIOR_INCOMPLETA'; codigo = 4; }
  else if (falla.length || neg.some((x) => !x.ok)) { veredicto = 'E3_EXTERIOR_FALLA'; codigo = 1; }
  else { veredicto = 'E3_EXTERIOR_OK'; codigo = 0; }
  const informe = { esquema: 'tai-e3-exterior/1', generadoEn: ahora().toISOString(), host, prefijoIdConsulta: prefijo, conCredencialDesechable: Boolean(credencial), peticiones: total + 2 * centinelas.length, veredicto,
    resumen: { bloqueo: { total: blo.length, ok: blo.filter((x) => x.ok).length, fugas: fugas.length, sinRespuesta: sinResp.length, redirigidasHttp: blo.filter((x) => x.via === 'redireccion').length, respuestaTraefikNo403: blo.filter((x) => x.no403 && x.ok).length }, centinelas: { total: cent.length, ok: cent.filter((x) => x.ok).length }, negativos: { total: neg.length, ok: neg.filter((x) => x.ok).length } },
    fallos: [...fugas, ...sinResp, ...falla, ...cent.filter((x) => !x.ok), ...neg.filter((x) => !x.ok)], celdas: { bloqueo: blo, centinelas: cent, negativos: neg } };
  if (salida) { fs.mkdirSync(salida, { recursive: true }); fs.writeFileSync(path.join(salida, `e3-exterior-${prefijo}.json`), JSON.stringify(informe, null, 2)); }
  return { informe, codigo };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const host = val('--host'); const salida = val('--salida');
  if (!host || !salida || !/^[a-z0-9.-]+$/i.test(host)) { console.error('Uso: --host <dominio-n8n> --salida <carpeta fuera del repositorio> [--cred-file <archivo>] [--cabecera <nombre>]'); process.exit(64); }
  if (path.resolve(salida).toLowerCase().startsWith(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..').toLowerCase())) { console.error('La carpeta de salida debe estar FUERA del repositorio.'); process.exit(64); }
  const { informe, codigo } = await ejecutar({ host, salida, credFile: val('--cred-file'), cabecera: val('--cabecera') || 'x-treidilor-canario' });
  const r = informe.resumen;
  console.log(`bloqueo ${r.bloqueo.ok}/${r.bloqueo.total} (fugas ${r.bloqueo.fugas}, sin respuesta ${r.bloqueo.sinRespuesta}, http redirigidas ${r.bloqueo.redirigidasHttp}) · centinelas ${r.centinelas.ok}/${r.centinelas.total} · negativos ${r.negativos.ok}/${r.negativos.total}`);
  for (const f of informe.fallos.slice(0, 12)) console.log(`  ✗ ${f.id}: ${f.motivos.join('; ')}`);
  console.log(`prefijo de consulta (para el registro de Traefik): ${informe.prefijoIdConsulta}`);
  console.log(informe.veredicto);
  process.exit(codigo);
}
