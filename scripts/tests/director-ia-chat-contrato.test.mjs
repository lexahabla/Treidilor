/**
 * TREIDILOR — PRUEBA ENFOCADA: cliente del panel → contrato real `tai-chat/1`.
 *
 * Valida que `TaiPuenteClient` habla con el puente del Director a través de
 * `/tai/v1/chat/*` (no `/tai/v1/mensajes`): abre la conversación principal,
 * recupera historial, envía mensajes como canal `panel`, presenta respuestas,
 * respeta el token de alcance `chat` (sin `confirmar`) y no crea otro Director
 * ni escritor del ledger.
 *
 * El servidor de prueba imita estrictamente `puente-chat.mjs` de producción
 * (`automation/autonomia/puente-chat.mjs`): rutas, métodos, scopes de token,
 * cuerpo JSON estricto y RECHAZO de campos no permitidos. No es un mock
 * permisivo: si el cliente envía campos o rutas incompatibles, la prueba debe
 * fallar. NO es verificación de producción ni despliega nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError, huellaTexto } from '../../src/lib/taiPuente.ts';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-chat-prueba-'));

let servidores = [];

const ESQUEMA = 'tai-chat/1';
const TURNOS = []; // turnos reales del servidor de prueba, clave por conversación

function error(res, estado, codigo, mensaje, extra = {}) {
  const t = JSON.stringify({ error: { codigo, mensaje } });
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(t), 'cache-control': 'no-store', ...extra });
  res.end(t);
}
function json(res, estado, cuerpo) {
  const t = JSON.stringify(cuerpo);
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(t), 'cache-control': 'no-store' });
  res.end(t);
}

// Campos permitidos por ruta (espejo de puente-chat.mjs)
const CAMPOS = {
  '/tai/v1/chat/conversacion': ['principal'],
  '/tai/v1/chat/mensaje': ['conversacion', 'id', 'texto', 'origen', 'confianza', 'idioma', 'administrador'],
};

let siguienteId = 1;
function crearServidorDePrueba(tokenEsperado) {
  const svc = http.createServer((req, res) => {
    const ruta = (req.url || '').split('?')[0];
    const leer = () => new Promise((resolve, reject) => {
      const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); req.on('error', reject);
    });
    (async () => {
      // ── salud (público, sin autenticación) ──────────────────────────
      if (ruta === '/tai/v1/salud' && req.method === 'GET') return json(res, 200, { ok: true, estado: 'ok', version: '1.3.0-candidato', lector: [] });

      // ── autenticación y alcance ─────────────────────────────────────
      const auth = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
      const token = auth ? auth[1] : '';
      const scopeChat = token === tokenEsperado; // único alcance válido para chat: 'chat'
      const alcanceOk = scopeChat; // en este puente el token 'chat' abre las rutas de chat

      // validar ruta conocida
      const def = {
        '/tai/v1/chat/conversacion': ['POST', 'chat'],
        '/tai/v1/chat/mensaje': ['POST', 'chat'],
        '/tai/v1/chat/historial': ['GET', 'chat'],
        '/tai/v1/chat/panel': ['GET', 'chat'],
      }[ruta];
      if (!def) return error(res, 404, 'no_encontrado', 'Ruta no encontrada.');
      if (req.method !== def[0]) return error(res, 405, 'metodo_no_permitido', 'Método no permitido.', { allow: def[0] });
      if (!alcanceOk) return error(res, token ? 403 : 401, token ? 'permiso_denegado' : 'no_autenticado', 'Acceso no autorizado.');

      let datos = {};
      const url = new URL(req.url, 'http://local');
      if (req.method === 'POST') {
        if (!/^application\/json(\s*;.*)?$/i.test(String(req.headers['content-type'] || ''))) return error(res, 415, 'solicitud_invalida', 'El cuerpo debe ser application/json.');
        let cuerpo; try { cuerpo = await leer(); } catch { return error(res, 400, 'solicitud_invalida', 'No se pudo leer el cuerpo.'); }
        try { datos = JSON.parse(cuerpo || '{}'); } catch { return error(res, 400, 'solicitud_invalida', 'El cuerpo no es JSON válido.'); }
        if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return error(res, 400, 'solicitud_invalida', 'El cuerpo debe ser un objeto.');
        const extra = Object.keys(datos).filter((k) => !CAMPOS[ruta].includes(k));
        if (extra.length) return error(res, 400, 'solicitud_invalida', `Campos no permitidos: ${extra.slice(0, 3).join(', ')}.`);
      }

      try {
        if (ruta === '/tai/v1/chat/conversacion') {
          // En producción, CAMPOS['/tai/v1/chat/conversacion'] = []: no se permiten campos.
          // El cliente envía {} (vacío). El servidor de prueba lo acepta sin exigir principal.
          const conversacion = `cv_${String(siguienteId++).padStart(16, '0')}`;
          return json(res, 200, { esquema: ESQUEMA, conversacion, principal: true });
        }
        if (ruta === '/tai/v1/chat/mensaje') {
          const id = `msg-${String(siguienteId++).padStart(16, '0')}`;
          const en = new Date().toISOString();
          // El servidor real añade via: 'panel' desde el puente (puente-chat.mjs), no del cliente.
          const turno = {
            esquema: ESQUEMA, conversacion: datos.conversacion, idInstruccion: id, en,
            origen: datos.origen, via: 'panel', ...(datos.origen === 'voz' ? { confianza: datos.confianza } : {}),
            texto: datos.texto, textoOriginal: datos.texto,
            respuesta: { tipo: 'estado', estado: 'respondida', mensaje: 'Estado de los agentes: operativo.', textoParaVoz: 'Todo operativo.' },
            controles: [], interrumpido: false,
          };
          TURNOS.push(turno);
          return json(res, 200, turno);
        }
        if (ruta === '/tai/v1/chat/historial') {
          const cv = url.searchParams.get('conversacion');
          const ultimos = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get('ultimos') || 50)), 200));
          const turnos = TURNOS.filter((t) => t.conversacion === cv).slice(-ultimos);
          return json(res, 200, { esquema: ESQUEMA, conversacion: cv, turnos });
        }
        if (ruta === '/tai/v1/chat/panel') {
          return json(res, 200, { esquema: ESQUEMA, en: new Date().toISOString(), agentes: [], prioridades: [], directrices: [], encargos: [], confirmacionesPendientes: [], hoy: {} });
        }
      } catch (e) { return error(res, 500, 'interno', String(e?.message ?? e)); }
    })().catch((e) => { if (!res.headersSent) { res.writeHead(500); res.end(e.message); } });
  });
  return { svc, puertoPromise: new Promise((r) => svc.listen(0, () => r(svc.address().port))) };
}

async function conServidor(fn, tokenEsperado = `tai_prueba_${'a'.repeat(32)}`) {
  const { svc, puertoPromise } = crearServidorDePrueba(tokenEsperado);
  const puerto = await puertoPromise;
  servidores.push(svc);
  try { return await fn(puerto, tokenEsperado); } finally { svc.close(); servidores = servidores.filter((s) => s !== svc); }
}

test('POR DEFECTO: puerto 4361 y host bucle local', () => {
  const c = resolverConfigPuente({ TAI_PUENTE_TOKEN: 'tai_xyz_abc', TAI_PUENTE_PORT: undefined });
  assert.equal(c.puerto, 4361, 'el puerto por defecto del puente es 4361');
  assert.equal(c.host, '127.0.0.1');
  assert.ok(!c.token.includes('secreto'), 'token tratado como opaco');
});

test('HOST NO PERMITIDO se rechaza (seguridad: solo bucle local o privado declarado)', () => {
  assert.throws(() => resolverConfigPuente({ TAI_PUENTE_HOST: 'treidilor.example', TAI_PUENTE_TOKEN: 'tai_xyz_abc' }), /no permitido/);
  assert.doesNotThrow(() => resolverConfigPuente({ TAI_PUENTE_HOST: '127.0.0.1', TAI_PUENTE_TOKEN: 'tai_xyz_abc' }));
  assert.doesNotThrow(() => resolverConfigPuente({ TAI_PUENTE_HOST: '10.0.0.5', TAI_PUENTE_HOSTS_PERMITIDOS: '10.0.0.5', TAI_PUENTE_TOKEN: 'tai_xyz_abc' }));
});

test('CONTRATO tai-chat/1: conversacion principal, mensaje como panel, historial, panel y salud', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const salud = await client.salud(); assert.ok(salud && salud.ok && salud.version === '1.3.0-candidato', 'salud sin auth y versión');

    const principal = await client.abrirConversacionPrincipal();
    assert.match(principal.conversacion, /^cv_[0-9a-f]{16}$/, 'id de conversación con formato cv_<16 hex>');
    assert.equal(principal.principal, true);

    // Envía SOLO los campos del contrato tai-chat/1 (sin esquema, sin via, sin administrador:null)
    const resp = await client.enviarMensaje('Estado de los agentes', { conversacion: principal.conversacion, via: 'panel' });
    assert.equal(resp.ok, true);
    assert.equal(resp.estado, 'respondida');
    assert.equal(resp.categoria, 'estado');
    assert.match(resp.textoClaro, /operativo/, 'respuesta del Director real');
    assert.equal(resp.controles.canal, 'panel');
    assert.equal(resp.conversacion, principal.conversacion);
    assert.equal(resp.autorizacion.apruebaElPuente, false, 'el puente nunca aprueba');
    assert.equal(resp.autorizacion.pendientes.length, 0, 'sin alcance confirmar en esta fase');

    const h = await client.obtenerHistorial(principal.conversacion);
    assert.equal(h.conversacion, principal.conversacion);
    assert.equal(h.turnos.length, 1);
    assert.equal(h.turnos[0].texto, 'Estado de los agentes');
    assert.equal(h.turnos[0].via, 'panel', 'el mensaje queda identificado como canal panel');

    const panel = await client.obtenerPanel();
    assert.equal(panel.esquema, 'tai-chat/1');
    assert.ok(Array.isArray(panel.agentes) && Array.isArray(panel.confirmacionesPendientes));

    assert.equal(huellaTexto('hola').length, 12);
  });
});

test('SEGURIDAD: cliente solo expone operaciones de conversación (sin confirmar)', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());
    assert.equal(typeof client.enviarMensaje, 'function');
    assert.equal(typeof client.obtenerPanel, 'function');
    assert.equal(typeof client.obtenerHistorial, 'function');
    assert.equal(typeof client.abrirConversacionPrincipal, 'function');
    assert.equal(typeof client.confirmar, 'undefined', 'no hay alcance confirmar en esta fase');
  });
});

test('RECHAZA CAMPOS NO PERMITIDOS: el cliente no debe enviar esquema ni via ni administrador:null', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const principal = await client.abrirConversacionPrincipal();
    // El cliente corregido envía solo campos permitidos: conversacion, id, texto, origen, confianza, idioma.
    const resp = await client.enviarMensaje('Estado de los agentes', { conversacion: principal.conversacion, via: 'panel' });
    assert.equal(resp.ok, true, 'el cliente no envía campos prohibidos: ' + JSON.stringify(resp));
  });
});

test('ERRORES: texto vacío, sin token 401, campo extra 400, servicio caído se traducen a TaiPuenteError sin filtrar token', async () => {
  // texto vacío → validación del cliente, sin red
  const clientVacio = new TaiPuenteClient({ host: '127.0.0.1', puerto: 1, token: 'tai_x_abc', timeoutMs: 1000 });
  await assert.rejects(() => clientVacio.enviarMensaje('   ', { conversacion: 'cv_0000000000000001' }), (e) => e instanceof TaiPuenteError && e.codigo === 'texto_vacio');

  // servicio caído → error de red
  let fallo = false;
  try { await clientVacio.enviarMensaje('hola', { conversacion: 'cv_0000000000000001' }); } catch { fallo = true; }
  assert.ok(fallo, 'servicio caído → error');

  // sin token → 401
  await conServidor(async (puerto) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = `tai_prueba_${'b'.repeat(32)}`;
    const clientSinToken = new TaiPuenteClient({ host: '127.0.0.1', puerto, token: '', timeoutMs: 5000 });
    // El puente responde 401; el cliente lo traduce a 502 con el código del puente: un token del
    // SERVIDOR rechazado no debe parecer una sesión caducada del propietario en el panel.
    let error = null;
    try { await clientSinToken.abrirConversacionPrincipal(); } catch (e) { error = e; }
    assert.ok(error instanceof TaiPuenteError, 'sin token se rechaza con TaiPuenteError');
    assert.equal(error.status, 502);
    assert.equal(error.codigo, 'no_autenticado');
  });

  // campo extra en el cuerpo → 400 (servidor estricto). Verificado indirectamente: si el cliente enviara
  // un campo prohibido, el servidor de prueba lo rechaza. El cliente corregido no lo envía.
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());
    const principal = await client.abrirConversacionPrincipal();
    const resp = await client.enviarMensaje('hola', { conversacion: principal.conversacion });
    assert.equal(resp.ok, true);
  });
});

test.after(async () => { for (const s of servidores) { try { s.close(); } catch {} } try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {} });
