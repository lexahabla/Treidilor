/**
 * TREIDILOR — EL PANEL ES SOLO UNA VENTANA DEL DIRECTOR 00.
 *
 * Sustituye a `director-ia-conversacion-natural.test.mjs`, que validaba respuestas sociales generadas
 * por la propia web (expresiones regulares y frases fijas): esa capa se retiró porque mostraba al
 * propietario respuestas que NO quedaban en el historial del Director.
 *
 * Se ejercitan los endpoints reales (`/api/admin/director-ia/principal`) contra un puente de prueba que
 * imita `puente-chat.mjs` de forma estricta (rechaza campos desconocidos). Se comprueba que:
 *  · lo que ve el propietario es EXACTAMENTE lo que el Director respondió y registró (también cuando el
 *    Director no entiende: no hay respuesta de relleno de la web);
 *  · el cliente pide la conversación PRINCIPAL (`principal: true`, Director >= 1.3.1) y, con un Director
 *    1.3.0 que rechaza ese campo, abre la conversación con el cuerpo vacío;
 *  · una conversación guardada que el Director ya no conoce se sustituye, sin error para el propietario;
 *  · un token del puente rechazado no se presenta como sesión caducada del panel (502, no 401);
 *  · ningún endpoint ni la página del Director IA importan un motor de lenguaje de la web.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { setupIsolatedData, adminCookie } from './_helpers.mjs';

const RAIZ_WEB = path.join(import.meta.dirname, '..', '..');
const TOKEN = 'tai_prueba_' + 'x'.repeat(24);

/* ── Puente de prueba estricto ── */
const estado = { version: '1.3.1', conversaciones: new Map(), principal: null, siguiente: 1, tokenValido: true, respuestaDirector: null };
function responder(res, codigo, cuerpo) {
  const t = JSON.stringify(cuerpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(t) });
  res.end(t);
}
const error = (res, codigo, cod, mensaje) => responder(res, codigo, { error: { codigo: cod, mensaje } });
const CAMPOS = () => ({
  '/tai/v1/chat/conversacion': estado.version === '1.3.0' ? [] : ['principal'],
  '/tai/v1/chat/mensaje': ['conversacion', 'id', 'texto', 'origen', 'confianza', 'idioma', 'administrador'],
});
function nuevaConversacion() {
  const id = `conv-${estado.siguiente++}`;
  estado.conversaciones.set(id, []);
  return id;
}
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (req.headers.authorization !== `Bearer ${TOKEN}` || !estado.tokenValido) return error(res, 401, 'no_autenticado', 'Token no válido.');
  let datos = {};
  if (req.method === 'POST') {
    const trozos = []; for await (const t of req) trozos.push(t);
    datos = JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}');
    const extra = Object.keys(datos).filter((k) => !(CAMPOS()[url.pathname] || []).includes(k));
    if (extra.length) return error(res, 400, 'solicitud_invalida', `Campos no permitidos: ${extra.join(', ')}`);
  }
  if (url.pathname === '/tai/v1/chat/conversacion') {
    if (datos.principal === true) {
      estado.principal ??= nuevaConversacion();
      return responder(res, 200, { esquema: 'tai-chat/1', conversacion: estado.principal, principal: true });
    }
    return responder(res, 200, { esquema: 'tai-chat/1', conversacion: nuevaConversacion() });
  }
  if (url.pathname === '/tai/v1/chat/mensaje') {
    const turnos = estado.conversaciones.get(datos.conversacion);
    if (!turnos) return error(res, 404, 'conversacion_desconocida', 'Conversación desconocida.');
    const respuesta = estado.respuestaDirector ?? { tipo: 'consulta', estado: 'respondida', mensaje: `Respuesta del Director a «${datos.texto}».` };
    const turno = { idInstruccion: `ins-${turnos.length + 1}`, en: new Date().toISOString(), origen: datos.origen, via: 'panel', texto: datos.texto, respuesta };
    turnos.push(turno);
    return responder(res, 200, { esquema: 'tai-chat/1', conversacion: datos.conversacion, ...turno, textoOriginal: datos.texto });
  }
  if (url.pathname === '/tai/v1/chat/historial') {
    const turnos = estado.conversaciones.get(url.searchParams.get('conversacion'));
    if (!turnos) return error(res, 404, 'conversacion_desconocida', 'Conversación desconocida.');
    return responder(res, 200, { esquema: 'tai-chat/1', conversacion: url.searchParams.get('conversacion'), turnos });
  }
  return error(res, 404, 'no_encontrado', 'Ruta no encontrada.');
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));

const DATA_DIR = setupIsolatedData('tai-ventana-');
process.env.TAI_PUENTE_HOST = '127.0.0.1';
process.env.TAI_PUENTE_PORT = String(servidor.address().port);
process.env.TAI_PUENTE_TOKEN = TOKEN;
process.env.TAI_PUENTE_TIMEOUT = '5000';

const cookie = await adminCookie();
const principal = await import('../../src/pages/api/admin/director-ia/principal.ts');
const { TaiPuenteClient } = await import('../../src/lib/taiPuente.ts');
const { guardarConversacionPrincipal } = await import('../../src/lib/directorIaStore.ts');

const peticion = (metodo, cuerpo, consulta = '') => new Request(`http://localhost/api/admin/director-ia/principal${consulta}`, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Director-IA': '1' },
  body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
});
const llamar = async (metodo, cuerpo, consulta) => {
  const r = await principal[metodo]({ request: peticion(metodo, cuerpo, consulta) });
  return { status: r.status, j: await r.json() };
};

test.after(() => { servidor.close(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('lo mostrado es lo registrado: la respuesta del Director llega tal cual, también si no entiende', async () => {
  estado.respuestaDirector = { tipo: 'desconocida', estado: 'sin_entender', mensaje: 'No he entendido la petición. ¿Puedes concretarla?' };
  const { status, j } = await llamar('POST', { texto: 'hola, ¿qué tal?' });
  assert.equal(status, 200);
  assert.equal(j.respuesta.textoClaro, 'No he entendido la petición. ¿Puedes concretarla?', 'el panel no sustituye la respuesta del Director');
  assert.notEqual(j.respuesta.categoria, 'social', 'no existe una categoría «social» generada por la web');

  const h = await llamar('GET');
  const delDirector = h.j.conversacion.mensajes.filter((m) => m.rol === 'director');
  assert.equal(delDirector.at(-1).contenido, j.respuesta.textoClaro, 'el historial contiene exactamente lo que se mostró');
  estado.respuestaDirector = null;
});

test('se usa la conversación PRINCIPAL del Director (>= 1.3.1) y se conserva entre peticiones', async () => {
  const a = await llamar('POST', { texto: 'primer mensaje' });
  const b = await llamar('POST', { texto: 'segundo mensaje' });
  assert.equal(a.j.conversacion.id, b.j.conversacion.id);
  const h = await llamar('GET');
  assert.ok(h.j.conversacion.mensajes.some((m) => m.contenido === 'Respuesta del Director a «segundo mensaje».'));
});

test('con un Director 1.3.0 (rechaza `principal`) el cliente abre la conversación con el cuerpo vacío', async () => {
  estado.version = '1.3.0';
  const cliente = new TaiPuenteClient({ host: '127.0.0.1', puerto: servidor.address().port, token: TOKEN, timeoutMs: 5000 });
  const r = await cliente.abrirConversacionPrincipal();
  assert.match(r.conversacion, /^conv-\d+$/);
  assert.equal(r.principal, false, 'la 1.3.0 no tiene conversación principal compartida: se informa sin fingirlo');
  estado.version = '1.3.1';
});

test('una conversación guardada que el Director ya no conoce se sustituye sin error', async () => {
  const usuario = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')).find((u) => u.master) ?? null;
  assert.ok(usuario, 'usuario master de prueba');
  guardarConversacionPrincipal(usuario.id, 'conv-que-ya-no-existe', 'Director IA');
  const { status, j } = await llamar('POST', { texto: 'sigo aquí' });
  assert.equal(status, 200);
  assert.notEqual(j.conversacion.id, 'conv-que-ya-no-existe');
});

test('identificador de conversación con formato no válido → 400 sin contactar con el Director', async () => {
  const { status, j } = await llamar('POST', { texto: 'x' }, '?conversacionId=' + encodeURIComponent('../../etc'));
  assert.equal(status, 400);
  assert.equal(j.code, 'conversacion_invalida');
});

test('un token del puente rechazado devuelve 502 (no 401, que el panel tomaría como sesión caducada)', async () => {
  estado.tokenValido = false;
  const { status } = await llamar('POST', { texto: 'hola' });
  estado.tokenValido = true;
  assert.equal(status, 502);
});

test('sin cabecera CSRF el POST se rechaza antes de llegar al Director', async () => {
  const r = await principal.POST({ request: new Request('http://localhost/api/admin/director-ia/principal', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ texto: 'hola' }),
  }) });
  assert.equal(r.status, 403);
});

test('ni los endpoints del Director IA ni su página importan un motor de lenguaje de la web', () => {
  const archivos = [
    'src/pages/upayp1b4/director-ia.astro',
    ...fs.readdirSync(path.join(RAIZ_WEB, 'src/pages/api/admin/director-ia'), { recursive: true })
      .filter((f) => String(f).endsWith('.ts')).map((f) => path.join('src/pages/api/admin/director-ia', String(f))),
  ];
  for (const f of archivos) {
    const fuente = fs.readFileSync(path.join(RAIZ_WEB, f), 'utf8');
    assert.ok(!/iaMotor|directorIaConversacion|lib\/agentes|chatComplete|from ['"][^'"]*\/ai['"]/.test(fuente), `${f} no debe generar respuestas con un modelo propio`);
  }
});
