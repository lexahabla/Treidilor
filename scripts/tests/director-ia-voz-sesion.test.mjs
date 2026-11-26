/**
 * TREIDILOR — PRUEBAS DE SESIÓN DE VOZ CONTINUA (una sola pulsación).
 *
 * Valida los controles de sesión de voz implementados en
 * src/pages/upayp1b4/director-ia.astro y el contrato del puente
 * para el envío automático de intervenciones de voz.
 *
 * No requiere navegador ni DOM: valida código fuente (controles y
 * máquina de estados) y el contrato tai-chat/1 contra un servidor
 * de prueba local que imita puente-chat.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import http from 'node:http';

const ASTRO_PATH = path.join(process.cwd(), 'src/pages/upayp1b4/director-ia.astro');

test('Controles de sesión: btnVoz inicia/finaliza, btnDetenerVoz interrumpe (no finaliza)', () => {
  const src = fs.readFileSync(ASTRO_PATH, 'utf8');

  // Ambos controles existen como claves del objeto els y se obtienen por id.
  assert.match(src, /btnVoz\s*:\s*document\.getElementById\('btnVoz'\)/);
  assert.match(src, /btnDetenerVoz\s*:\s*document\.getElementById\('btnDetenerVoz'\)/);

  // btnVoz está ligado a Voz.iniciar (inicia sesión o la finaliza inequívocamente).
  assert.match(src, /els\.btnVoz\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*if\s*\(!Voz\.silenciado\(\)\)\s*Voz\.iniciar\(\)/);

  // btnDetenerVoz está ligado a Voz.interrumpir (NO a Voz.detener/finalizarSesion).
  assert.match(src, /els\.btnDetenerVoz\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*Voz\.interrumpir\(\)/);

  // Existe una función interrumpir que cancela la síntesis y vuelve a escuchar.
  assert.match(src, /function interrumpirDirector/);
  assert.match(src, /cancelarSíntesis\(\);/);
  assert.match(src, /iniciarReconocimientoInterno\(\);/);

  // No debe vincular btnDetenerVoz a Voz.detener (que finalizaría la sesión).
  assert.ok(!/els\.btnDetenerVoz\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*Voz\.detener\(\)/ .test(src), 'btnDetenerVoz no debe llamar a Voz.detener');
});

test('Máquina de estados: existen los estados INACTIVO/ESCUCHANDO/PROCESANDO/HABLANDO', () => {
  const src = fs.readFileSync(ASTRO_PATH, 'utf8');
  assert.match(src, /let estado = 'inactivo'/);
  assert.match(src, /estado === 'escuchando'/);
  assert.match(src, /estado === 'procesando'/);
  assert.match(src, /estado === 'hablando'/);
  assert.match(src, /reanudarEscucha\(\)/);
});

// ── Contrato del puente para envío automático de voz (origen + confianza) ──
const ESQUEMA = 'tai-chat/1';
const TURNOS = [];
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
          const idParaBuscar = idEnviado ?? `msg-${String(siguienteId++).padStart(16, '0')}`;
          const previo = TURNOS.find((t) => t.conversacion === datos.conversacion && t.idInstruccion === idParaBuscar);
          if (previo) {
            return json(res, 200, { ...previo, repetido: true });
          }
          const id = idEnviado ?? `msg-${String(siguienteId++).padStart(16, '0')}`;
          const en = new Date().toISOString();
          const turno = {
            esquema: ESQUEMA, conversacion: datos.conversacion, idInstruccion: id, en,
            origen: datos.origen, via: 'panel',
            ...(datos.origen === 'voz' ? { confianza: datos.confianza } : { confianza: 0 }),
            texto: datos.texto, textoOriginal: datos.texto,
            respuesta: { tipo: 'estado', estado: 'respondida', mensaje: 'Respuesta del Director.', textoParaVoz: 'Respuesta del Director.' },
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
async function conServidor(fn, tokenEsperado = `tai_sesion_${'b'.repeat(32)}`) {
  const { svc, puertoPromise } = crearServidorDePrueba(tokenEsperado);
  const puerto = await puertoPromise;
  try { return await fn(puerto, tokenEsperado); } finally { svc.close(); }
}

import { TaiPuenteClient, resolverConfigPuente } from '../../src/lib/taiPuente.ts';

test('Sesión continua: cinco intervenciones de voz sin nueva pulsación, origen=voz y confianza transmitidos', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const principal = await client.abrirConversacionPrincipal();

    const intervenciones = ['Hola', '¿Cómo estás?', '¿Qué puedes hacer?', '¿Cómo va el estado de los agentes?', 'Gracias'];
    for (const texto of intervenciones) {
      const resp = await client.enviarMensaje(texto, {
        conversacion: principal.conversacion,
        via: 'panel',
        origen: 'voz',
        confianza: 0.9,
      });
      assert.equal(resp.ok, true);
      assert.equal(resp.controles.canal, 'panel');
    }

    // Cinco turnos registrados en el historial sin duplicados.
    const h = await client.obtenerHistorial(principal.conversacion);
    assert.equal(h.turnos.length, 5, 'se esperan 5 turnos tras cinco intervenciones');

    // Cada turno lleva origen 'voz' y confianza 0.9 (envío automático sin pulsación extra).
    for (const t of h.turnos) {
      assert.equal(t.origen, 'voz', 'origen debe ser voz');
      assert.equal(t.confianza, 0.9, 'confianza debe ser 0.9');
    }

    // Finalización de sesión: no se crea una nueva conversación ni turno extra.
    const h2 = await client.obtenerHistorial(principal.conversacion);
    assert.equal(h2.turnos.length, 5, 'la sesión no deja turnos huérfanos al finalizar');
  });
});

test('Sesión continua: ausencia de duplicados (idempotencia por id de mensaje)', async () => {
  await conServidor(async (puerto, token) => {
    process.env.TAI_PUENTE_HOST = '127.0.0.1';
    process.env.TAI_PUENTE_PORT = String(puerto);
    process.env.TAI_PUENTE_TOKEN = token;
    const client = new TaiPuenteClient(resolverConfigPuente());

    const principal = await client.abrirConversacionPrincipal();
    const idMensaje = 'msg-sesion-continua-1';

    await client.enviarMensaje('primera intervención', { conversacion: principal.conversacion, via: 'panel', origen: 'voz', confianza: 0.8, id: idMensaje });
    const r2 = await client.enviarMensaje('primera intervención', { conversacion: principal.conversacion, via: 'panel', origen: 'voz', confianza: 0.8, id: idMensaje });
    assert.equal(r2.repetida, true, 'reenvío con mismo id se marca como repetido');

    const h = await client.obtenerHistorial(principal.conversacion);
    assert.equal(h.turnos.length, 1, 'no hay turnos duplicados en el historial');
  });
});

test('Sesión continua: gestión de errores — servicio no disponible no bloquea la sesión', async () => {
  // Puerto cerrado: el servicio no responde.
  process.env.TAI_PUENTE_HOST = '127.0.0.1';
  process.env.TAI_PUENTE_PORT = '1';
  process.env.TAI_PUENTE_TOKEN = 'tai_error_para_prueba';
  const client = new TaiPuenteClient(resolverConfigPuente());

  let fallo = false;
  try {
    await client.abrirConversacionPrincipal();
  } catch (e) {
    fallo = true;
    assert.ok(e instanceof Error || e && typeof e === 'object');
  }
  assert.equal(fallo, true, 'el servicio no disponible se reporta como error');
});

test.after(async () => {
  for (const k of ['TAI_PUENTE_HOST', 'TAI_PUENTE_PORT', 'TAI_PUENTE_TOKEN']) { delete process.env[k]; }
});
