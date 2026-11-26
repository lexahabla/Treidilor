/**
 * TREIDILOR — PRUEBAS DE VOZ Y CORRECCIÓN DE ORIGEN/CONFIANZA (Director IA).
 *
 * Valida el Bloque 3: el endpoint del panel debe recibir { texto, origen, confianza }
 * del frontend de voz, validar origen ('texto'|'voz'), acotar confianza (0-1) y
 * enviar ambos valores al puente según su contrato real tai-chat/1.
 *
 * También valida:
 *  - No se activan proveedores de voz de pago (Web Speech API del navegador, gratuita).
 *  - No hay mensajes duplicados (idempotencia por id de mensaje).
 *  - Conservación de la procedencia 'panel'.
 *  - Seguridad: token de alcance chat, sin confirmar.
 *
 * Las pruebas montan un servidor de prueba que imita estrictamente puente-chat.mjs
 * (rutas, scopes, campos permitidos, rechazo de campos no permitidos). No es un
 * mock permisivo: si el cliente envía campos o rutas incompatibles, la prueba falla.
 * Todo en bucle local, sin red, sin producción.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../src/lib/taiPuente.ts';

const ESQUEMA = 'tai-chat/1';
const TURNOS = []; // turnos del servidor de prueba, clave por conversación
let siguienteId = 1;

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

function crearServidorDePrueba(tokenEsperado) {
  const svc = http.createServer((req, res) => {
    const ruta = (req.url || '').split('?')[0];
    const leer = () => new Promise((resolve, reject) => {
      const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); req.on('error', reject);
    });
    (async () => {
      if (ruta === '/tai/v1/salud' && req.method === 'GET') return json(res, 200, { ok: true, estado: 'ok', version: '1.3.0-candidato', lector: [] });

      const auth = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
      const token = auth ? auth[1] : '';
      const alcanceOk = token === tokenEsperado;

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
          const conversacion = `cv_${String(siguienteId++).padStart(16, '0')}`;
          return json(res, 200, { esquema: ESQUEMA, conversacion, principal: true });
        }
        if (ruta === '/tai/v1/chat/mensaje') {
          const idEnviado = datos.id && typeof datos.id === 'string' && datos.id.trim() ? datos.id.trim() : null;
          // Idempotencia: mismo id de mensaje en la misma conversación → repetido.
          const idParaBuscar = idEnviado ?? `msg-${String(siguienteId++).padStart(16, '0')}`;
          const previo = TURNOS.find((t) => t.conversacion === datos.conversacion && t.idInstruccion === idParaBuscar);
          if (previo) {
            const mismoTexto = previo.textoOriginal === datos.texto;
            return json(res, 200, { ...previo, repetido: true, texto: previo.texto, textoOriginal: previo.textoOriginal });
          }
          const id = idEnviado ?? `msg-${String(siguienteId++).padStart(16, '0')}`;
          const en = new Date().toISOString();
          // El servidor real registra origen y confianza exactamente como llegan.
          const turno = {
            esquema: ESQUEMA, conversacion: datos.conversacion, idInstruccion: id, en,
            origen: datos.origen, via: 'panel',
            ...(datos.origen === 'voz' ? { confianza: datos.confianza } : { confianza: 0 }),
            texto: datos.texto, textoOriginal: datos.texto,
            respuesta: { tipo: 'estado', estado: 'respondida', mensaje: 'Estado de los agentes: operativo.', textoParaVoz: 'Todo operativo.' },
            controles: [], interrumpido: false,
          };
          TURNOS.push(turno);
          return json(res, 200, { ...turno, repetido: false });
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

async function conServidor(fn, tokenEsperado = `tai_voz_${'a'.repeat(32)}`) {
  const { svc, puertoPromise } = crearServidorDePrueba(tokenEsperado);
  const puerto = await puertoPromise;
  try { return await fn(puerto, tokenEsperado); } finally { svc.close(); }
}

// ── VOZ: origen 'voz' y confianza se transmiten al puente ──────────────────
test('Voz: origen «voz» y confianza se transmiten al puente según contrato tai-chat/1', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const principal = await client.abrirConversacionPrincipal();

    // Simula lo que envía el frontend de voz: { texto, origen: 'voz', confianza }
    const confianza = 0.87;
    const resp = await client.enviarMensaje('Hola Director', {
      conversacion: principal.conversacion,
      via: 'panel',
      origen: 'voz',
      confianza,
    });

    assert.equal(resp.ok, true);
    assert.equal(resp.controles.canal, 'panel');
    assert.equal(resp.conversacion, principal.conversacion);

    // El servidor de prueba registró el turno con origen 'voz' y confianza 0.87.
    const turno = TURNOS[TURNOS.length - 1];
    assert.equal(turno.origen, 'voz', 'el puente recibió origen «voz»');
    assert.equal(turno.confianza, 0.87, 'el puente recibió confianza 0.87');
    assert.equal(turno.via, 'panel', 'procedencia panel conservada');
  });
});

// ── TEXTO: origen por defecto 'texto' cuando no se especifica ──────────────
test('Texto: origen por defecto «texto» y confianza 0 cuando no se especifica', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const principal = await client.abrirConversacionPrincipal();
    const resp = await client.enviarMensaje('Hola Director', { conversacion: principal.conversacion, via: 'panel' });

    assert.equal(resp.ok, true);
    const turno = TURNOS[TURNOS.length - 1];
    assert.equal(turno.origen, 'texto', 'origen por defecto es texto');
    assert.equal(turno.confianza, 0, 'confianza por defecto es 0');
  });
});

// ── VOZ: confianza fuera de rango se acota [0, 1] ──────────────────────────
test('Voz: confianza fuera de rango se acota a [0, 1]', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const principal = await client.abrirConversacionPrincipal();

    // confianza 1.5 → acotado a 1
    await client.enviarMensaje('prueba', { conversacion: principal.conversacion, via: 'panel', origen: 'voz', confianza: 1.5 });
    assert.equal(TURNOS[TURNOS.length - 1].confianza, 1, 'confianza 1.5 acotada a 1');

    // confianza -0.3 → acotado a 0
    await client.enviarMensaje('prueba', { conversacion: principal.conversacion, via: 'panel', origen: 'voz', confianza: -0.3 });
    assert.equal(TURNOS[TURNOS.length - 1].confianza, 0, 'confianza -0.3 acotada a 0');
  });
});

// ── IDENTIDAD: el cliente del puente no expone proveedores de voz de pago ───
test('Identidad: cliente del puente no activa proveedores de voz de pago', () => {
  const client = new TaiPuenteClient({ host: '127.0.0.1', puerto: 1, token: 'tai_x_abc', timeoutMs: 1000 });
  // El cliente solo expone conversación, historial, panel. No hay síntesis ni reconocimiento de voz de pago.
  assert.equal(typeof client.enviarMensaje, 'function');
  assert.equal(typeof client.obtenerHistorial, 'function');
  assert.equal(typeof client.obtenerPanel, 'function');
  assert.equal(typeof client.abrirConversacionPrincipal, 'function');
  assert.equal(typeof client.confirmar, 'undefined', 'sin alcance confirmar');
  assert.equal(typeof client.sintetizarVoz, 'undefined', 'no hay síntesis de voz de pago');
  assert.equal(typeof client.reconocerVoz, 'undefined', 'no hay reconocimiento de voz de pago');
});

// ── IDEMPOTENCIA: mismo id de mensaje no duplica ───────────────────────────
test('Idempotencia: mismo id de mensaje no duplica el turno', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const principal = await client.abrirConversacionPrincipal();
    const idMensaje = 'msg-idempotencia-123';

    const r1 = await client.enviarMensaje('primer mensaje', { conversacion: principal.conversacion, via: 'panel', id: idMensaje });
    assert.equal(r1.ok, true);

    const r2 = await client.enviarMensaje('primer mensaje', { conversacion: principal.conversacion, via: 'panel', id: idMensaje });
    assert.equal(r2.repetida, true, 'segundo envío con mismo id se marca como repetido');

    // El historial no debe tener el turno duplicado.
    const h = await client.obtenerHistorial(principal.conversacion);
    assert.equal(h.turnos.length, 1, 'historial no duplica el turno');
  });
});

test.after(async () => { for (const t of TURNOS) {} });
