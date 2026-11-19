#!/usr/bin/env node
// PRUEBA REAL (no simulada) del lector compartido contra el n8n de PRUEBAS aislado (127.0.0.1:5678) y del circuito Canal 13 → Director → n8n → Director → Canal 13.
// Sólo datos sintéticos, sólo consultas POST a los webhooks tai-lector-04/12. No imprime ningún secreto.
//
//   TAI_LECTOR_TOKEN_FILE=<archivo con el valor de la credencial Header Auth de PRUEBAS> node scripts/automation/probar-lector-real.mjs <fase>
//   fases: crudas | circuito
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { construirDirector } from './director.mjs';
import { LectorN8n } from '../../automation/director/puente/lector-n8n.mjs';
import { AlmacenTokens } from '../../automation/director/puente/tokens.mjs';
import { crearServicioPuente } from '../../automation/director/puente/servidor.mjs';
import { validarRespuestaLector } from '../../automation/lib/lectorPuente.mjs';

const BASE = process.env.TAI_N8N_BASE || 'http://127.0.0.1:5678/webhook';
const token = fs.readFileSync(process.env.TAI_LECTOR_TOKEN_FILE, 'utf8').trim();
const fase = process.argv[2] || 'crudas';
const mostrar = (k, v) => console.log(`${k.padEnd(46)} ${v}`);

async function post(agente, cuerpo, cabeceras = { 'x-treidilor-lector': token }) {
  try {
    const r = await fetch(`${BASE}/tai-lector-${agente}`, { method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch { /* no JSON */ }
    return { estado: r.status, json: j, longitud: t.length };
  } catch (e) { return { estado: 'sin_conexion', causa: e.cause?.code || e.code || e.message }; }
}
const sol = (agente, extra = {}) => ({ esquema: 'tai-lector/1', idSolicitud: `real-${Math.random().toString(36).slice(2, 12)}`, agente, entorno: 'local', limite: 20, ...extra });

if (fase === 'crudas') {
  for (const ag of ['12', '04']) {
    const s = sol(ag);
    const r = await post(ag, s);
    const v = r.json ? validarRespuestaLector(r.json, s) : { ok: false, errores: ['sin JSON'] };
    mostrar(`[${ag}] POST válido`, `HTTP ${r.estado} · filas=${r.json?.filas?.length ?? '—'} · validación estricta del Director: ${v.ok ? 'OK' : 'RECHAZA ' + v.errores.slice(0, 2).join('; ')} · sintético=${r.json?.sintetico} · campos=${r.json ? Object.keys(r.json).join(',') : '—'}`);
    if (r.json?.filas?.[0]) mostrar(`[${ag}] primera fila (columnas)`, Object.keys(r.json.filas[0]).join(','));
  }
  mostrar('[12] credencial incorrecta', JSON.stringify(await post('12', sol('12'), { 'x-treidilor-lector': 'valor-incorrecto-de-prueba-000000' })).slice(0, 140));
  mostrar('[12] sin cabecera de credencial', JSON.stringify(await post('12', sol('12'), {})).slice(0, 140));
  mostrar('[12] agente inválido en el cuerpo (05)', JSON.stringify(await post('12', sol('05'))).slice(0, 140));
  mostrar('[12] entorno no admitido (produccion)', JSON.stringify(await post('12', sol('12', { entorno: 'produccion' }))).slice(0, 140));
  mostrar('[12] campo extra en el cuerpo', JSON.stringify(await post('12', sol('12', { tabla: 'otra' }))).slice(0, 140));
  mostrar('[12] cuerpo que no es objeto', JSON.stringify(await post('12', [1, 2])).slice(0, 140));
  mostrar('[99] ruta inexistente', JSON.stringify(await post('99', sol('12'))).slice(0, 140));
  const g = await fetch(`${BASE}/tai-lector-12`).catch(() => null);
  mostrar('[12] método GET', g ? `HTTP ${g.status}` : 'sin conexión');
} else if (fase === 'circuito') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-real-'));
  fs.mkdirSync(path.join(tmp, 'ledger')); fs.mkdirSync(path.join(tmp, 'inst'));
  const { director, ledger } = construirDirector({ ledger: path.join(tmp, 'ledger'), instantaneas: path.join(tmp, 'inst') });
  const lector = new LectorN8n({ urlBase: BASE, token });
  director.lector = lector;
  const tokens = new AlmacenTokens();
  const { token: tokenCliente } = tokens.crear({ id: 'consola-local', dias: 1 });
  const svc = crearServicioPuente({ director, tokens });
  const { host, puerto } = await svc.escuchar();
  const enviar = async (texto, idem) => {
    const r = await fetch(`http://${host}:${puerto}/tai/v1/mensajes`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenCliente}` }, body: JSON.stringify({ esquema: 'tai-puente/1', idSolicitud: `sol-${idem}-0001`, claveIdempotencia: `idem-${idem}-0001`, canal: 'texto', texto }) });
    return { estado: r.status, j: await r.json() };
  };
  try {
    for (const [texto, ag, idem] of [['¿Cómo está el sitio?', '12', 'a'], ['¿Cómo está el catálogo?', '04', 'b']]) {
      const antes = lector.peticiones;
      const r = await enviar(texto, idem);
      const t = r.j.trazabilidad?.tareas?.find((x) => x.capacidad === `${ag}.leer-ultimo-informe`);
      mostrar(`«${texto}»`, `HTTP ${r.estado} · estado=${r.j.mensaje?.estado} · peticiones reales a n8n=${lector.peticiones - antes}`);
      mostrar('  detalle (primeras líneas)', JSON.stringify((r.j.mensaje?.detalle || '').split('\n').slice(0, 2)).slice(0, 260));
      mostrar('  naturaleza de los datos', (r.j.mensaje?.naturalezaDatos || []).map((n) => n.etiqueta).join(','));
      mostrar('  avisos de prueba', String((r.j.mensaje?.avisos || []).some((a) => /DATOS DE PRUEBA/.test(a))));
      mostrar('  tarea / estados', t ? `${t.idTarea} ${t.estados.join('→')}` : 'sin tarea');
      mostrar('  evidencia', t?.evidencias?.[0] ? `${t.evidencias[0].referencia} ${String(t.evidencias[0].hash).slice(0, 19)}… origen=${t.evidencias[0].origen}` : 'ninguna');
      mostrar('  verificación (consistencia de 2 lecturas)', t?.verificaciones?.map((v) => `${v.metodo}:${v.resultado}`).join(',') || 'ninguna');
      if (idem === 'a') {
        const rep = await enviar(texto, idem);
        mostrar('  idempotencia (misma clave)', `HTTP ${rep.estado} · repetida=${rep.j.repetida} · mismo mensaje=${rep.j.mensaje?.idMensaje === r.j.mensaje?.idMensaje}`);
      }
    }
    mostrar('ledger: cadena íntegra', JSON.stringify(ledger.verificarCadena().ok));
    mostrar('estado del lector', JSON.stringify(lector.estado().map((e) => ({ agente: e.agente, ok: e.ok, dosIdsDistintos: e.idSolicitudA !== e.idSolicitudB }))));
  } finally { await svc.cerrar(); fs.rmSync(tmp, { recursive: true, force: true }); }
}
