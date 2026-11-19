/**
 * PUENTE · SERVICIO HTTP MÍNIMO del Director + Canal 13. Sin dependencias (node:http). SIN EXPOSICIÓN PÚBLICA: sólo se enlaza a direcciones de bucle local (127.0.0.1 / ::1);
 * el despliegue futuro previsto es un contenedor privado en el VPS sin puerto publicado. Rutas:
 *   GET  /tai/v1/salud     estado del servicio (sin datos de negocio, sin autenticación)
 *   POST /tai/v1/mensajes  un mensaje de texto para el Canal 13 → respuesta del Director con evidencia y trazabilidad
 * Orden de comprobaciones: método/ruta → token (Bearer `tai_<id>_<secreto>`, alcance `mensajes`) → ritmo por cliente → cuerpo (tamaño, JSON) → firma HMAC (si está activa:
 * marca, nonce, caducidad, anti-repetición) → sobre estricto → idempotencia → consulta. Los mensajes se atienden de UNO EN UNO (el ledger tiene un único escritor).
 * NO existe ninguna ruta para aprobar, ejecutar ni escribir: las autorizaciones sólo se conceden en la interfaz autenticada del Director.
 */
import http from 'node:http';
import { Canal13 } from '../canal/canal13.mjs';
import { ErrorProtocolo } from '../protocolo.mjs';
import { CacheIdempotencia, sha256Hex } from './firma.mjs';
import { MAX_CUERPO_BYTES, sobreRespuesta, validarSolicitudPuente } from './sobres.mjs';

export const VERSION_PUENTE = '0.1.0';
const HOSTS_LOCALES = new Set(['127.0.0.1', '::1', 'localhost']);
const AGENTES_LECTOR = ['04', '12'];

const json = (res, estado, cuerpo, extra = {}) => {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(texto), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(texto);
};
const error = (res, estado, codigo, mensaje, extra) => json(res, estado, { error: { codigo, mensaje } }, extra);

export function crearServicioPuente({ director, tokens, verificador = null, canal = null, reloj = () => Date.now(), limiteMensajesPorMinuto = 30, idempotencia = null }) {
  if (!director) throw new ErrorProtocolo('solicitud_invalida', 'El servicio necesita un Director.');
  if (!tokens) throw new ErrorProtocolo('solicitud_invalida', 'El servicio necesita un almacén de tokens.');
  const canal13 = canal || new Canal13({ director, canal: 'texto', reloj });
  const cache = idempotencia || new CacheIdempotencia({ reloj });
  const ritmo = new Map();
  let cola = Promise.resolve();
  const enCola = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };

  const limitar = (cliente) => {
    const ahora = reloj();
    const lista = (ritmo.get(cliente) || []).filter((t) => t > ahora - 60000);
    if (lista.length >= limiteMensajesPorMinuto) { ritmo.set(cliente, lista); return Math.max(1, Math.ceil((lista[0] + 60000 - ahora) / 1000)); }
    lista.push(ahora);
    ritmo.set(cliente, lista);
    return 0;
  };

  const leerCuerpo = (req) => new Promise((resolve, reject) => {
    let n = 0;
    const trozos = [];
    let excedido = false;
    req.on('data', (c) => { n += c.length; if (n > MAX_CUERPO_BYTES) excedido = true; else trozos.push(c); });
    req.on('end', () => (excedido ? reject(Object.assign(new Error('grande'), { codigo: 'cuerpo_demasiado_grande' })) : resolve(Buffer.concat(trozos).toString('utf8'))));
    req.on('error', () => reject(Object.assign(new Error('lectura'), { codigo: 'cuerpo_ilegible' })));
  });

  async function mensajes(req, res) {
    const auth = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
    const v = tokens.verificar(auth ? auth[1] : '', 'mensajes');
    if (!v.ok) return error(res, v.codigo === 'permiso_denegado' ? 403 : 401, v.codigo, 'Acceso no autorizado.', v.codigo === 'permiso_denegado' ? {} : { 'www-authenticate': 'Bearer' });
    const espera = limitar(v.cliente);
    if (espera) return error(res, 429, 'limite_de_ritmo', 'Demasiadas solicitudes: espera antes de reintentar.', { 'retry-after': String(espera) });
    if (!/^application\/json(\s*;.*)?$/i.test(String(req.headers['content-type'] || ''))) return error(res, 415, 'solicitud_invalida', 'El cuerpo debe ser application/json.');
    let cuerpo;
    try { cuerpo = await leerCuerpo(req); } catch (e) { return error(res, e.codigo === 'cuerpo_demasiado_grande' ? 413 : 400, e.codigo || 'solicitud_invalida', 'No se pudo leer el cuerpo de la solicitud.'); }
    if (verificador) {
      const f = verificador.verificar({ marca: req.headers['x-tai-timestamp'], nonce: req.headers['x-tai-nonce'], firma: req.headers['x-tai-signature'], cuerpo, metodo: 'POST', ruta: '/tai/v1/mensajes' });
      if (!f.ok) return error(res, f.codigo === 'solicitud_caducada' ? 408 : f.codigo === 'repeticion' ? 409 : 401, f.codigo, 'La firma de la solicitud no es válida.');
    }
    let datos;
    try { datos = JSON.parse(cuerpo); } catch { return error(res, 400, 'solicitud_invalida', 'El cuerpo no es JSON válido.'); }
    const s = validarSolicitudPuente(datos);
    if (!s.ok) return error(res, 400, 'solicitud_invalida', `Solicitud no válida: ${s.errores.slice(0, 3).join('; ')}.`);
    const solicitud = s.solicitud;
    const clave = `${v.cliente}:${solicitud.claveIdempotencia}`;
    const huella = sha256Hex(JSON.stringify([solicitud.idSolicitud, solicitud.canal, solicitud.texto]));
    const previo = cache.consultar(clave, huella);
    if (previo.estado === 'conflicto') return error(res, 409, 'idempotencia_conflicto', 'La clave de idempotencia ya se usó con un contenido distinto.');
    if (previo.estado === 'en_curso') return error(res, 409, 'en_curso', 'Esa solicitud todavía se está procesando.');
    if (previo.estado === 'repetida') return json(res, 200, { ...previo.respuesta, repetida: true });
    cache.reservar(clave, huella);
    try {
      const respuesta = await enCola(async () => {
        // Descarga (y valida) las instantáneas de n8n ANTES de que el Director lea de forma síncrona.
        if (director.lector && typeof director.lector.refrescar === 'function') await director.lector.refrescar(AGENTES_LECTOR);
        const mensaje = await canal13.recibir(solicitud.texto, { canal: 'texto' });
        return sobreRespuesta({ solicitud, mensaje, director, cliente: v.cliente });
      });
      cache.completar(clave, respuesta);
      return json(res, 200, respuesta);
    } catch (e) {
      cache.liberar(clave);
      throw e;
    }
  }

  const servidor = http.createServer(async (req, res) => {
    try {
      const ruta = (req.url || '').split('?')[0];
      if (ruta === '/tai/v1/salud') {
        if (req.method !== 'GET') return error(res, 405, 'metodo_no_permitido', 'Método no permitido.', { allow: 'GET' });
        const lector = director.lector && typeof director.lector.estado === 'function' ? director.lector.estado() : [];
        return json(res, 200, { estado: 'ok', servicio: 'tai-puente', version: VERSION_PUENTE, firma: Boolean(verificador), lector: lector.map(({ agente, ok, en }) => ({ agente, ok, en })) });
      }
      if (ruta === '/tai/v1/mensajes') {
        if (req.method !== 'POST') return error(res, 405, 'metodo_no_permitido', 'Método no permitido.', { allow: 'POST' });
        return await mensajes(req, res);
      }
      return error(res, 404, 'no_encontrado', 'Ruta no encontrada.');
    } catch {
      if (!res.headersSent) return error(res, 500, 'interno', 'Error interno del servicio.');
      res.end();
    }
  });
  servidor.headersTimeout = 10000;
  servidor.requestTimeout = 20000;
  servidor.maxHeadersCount = 40;

  return {
    servidor,
    /** Enlaza SÓLO a bucle local. Devuelve { host, puerto }. */
    async escuchar({ host = '127.0.0.1', puerto = 0 } = {}) {
      if (!HOSTS_LOCALES.has(host)) throw new ErrorProtocolo('permiso_denegado', 'El servicio del Director sólo puede enlazarse a una dirección de bucle local (sin exposición pública).');
      return new Promise((resolve, reject) => { servidor.once('error', reject); servidor.listen(puerto, host, () => resolve({ host, puerto: servidor.address().port })); });
    },
    cerrar() { return new Promise((resolve) => { servidor.close(() => resolve()); servidor.closeAllConnections?.(); }); },
  };
}
