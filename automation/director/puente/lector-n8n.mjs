/**
 * PUENTE · LECTOR N8N. Misma interfaz que `LectorInstantaneas` (disponibles/cargar/ultima/listar/obtener/comparar) pero alimentada por el workflow lector de n8n
 * (`lector-instantaneas.local.json`, sólo consulta) en lugar de por archivos. El Director es SÍNCRONO al consultar y HTTP es asíncrono, así que se separa en dos pasos:
 *   1) `await lector.refrescar(['04','12'])` — hace DOS peticiones independientes por agente (idSolicitud distintos), valida cada respuesta con `validarRespuestaLector`
 *      y guarda dos instantáneas en memoria;
 *   2) las lecturas síncronas del Director sirven de la primera; la «segunda lectura independiente» de la verificación (`independiente()`) sirve de la segunda.
 * Reutiliza `LectorInstantaneas._normalizar` (mismas validaciones y el mismo adaptador a `informe-agente/1`): lo que n8n devuelva se trata como dato no fiable.
 * Seguridad: sólo hosts de bucle local (o los de una lista explícita), sin redirecciones, tiempo y tamaño acotados, el token sólo viaja en una cabecera y nunca se registra.
 */
import { LectorInstantaneas, FORMATO_EXPORTACION } from '../lectores.mjs';
import { ErrorProtocolo } from '../protocolo.mjs';
import { ESQUEMA_SOLICITUD_LECTOR, MAX_FILAS_LECTOR, TABLAS_LECTOR, validarRespuestaLector } from '../../lib/lectorPuente.mjs';

export const CABECERA_TOKEN = 'x-treidilor-lector';
export const MAX_BYTES_RESPUESTA = 2 * 1024 * 1024;
const HOSTS_POR_DEFECTO = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/** Vista de sólo lectura sobre datos YA descargados de n8n: comparte todas las validaciones de `LectorInstantaneas`. */
class VistaN8n extends LectorInstantaneas {
  constructor(obtener) {
    super({ dir: 'n8n' });
    this._obtener = obtener;
  }

  disponibles() { return Object.keys(TABLAS_LECTOR).sort().filter((a) => this._obtener(a, true)); }

  cargar(agenteId) {
    const agente = String(agenteId);
    if (!TABLAS_LECTOR[agente]) throw new ErrorProtocolo(/^\d{2}$/.test(agente) ? 'capacidad_desconocida' : 'solicitud_invalida', `El agente ${agente} no tiene instantáneas que leer.`);
    const datos = this._obtener(agente, false);
    return this._normalizar(agente, datos, `n8n:${TABLAS_LECTOR[agente]}`);
  }
}

export class LectorN8n extends VistaN8n {
  /**
   * @param {{urlBase:string, token:string, entorno?:string, limite?:number, ttlMs?:number, timeoutMs?:number, fetch?:Function, reloj?:()=>number, ids?:()=>string, hostsPermitidos?:string[]}} o
   * `urlBase`: p. ej. `http://127.0.0.1:5678/webhook` (producción de n8n) o `/webhook-test`; el path de cada agente es `tai-lector-<agente>`.
   */
  constructor({ urlBase, token, entorno = 'local', limite = 20, ttlMs = 30000, timeoutMs = 10000, procedencia = 'sintetico', copias = {}, cabecera = CABECERA_TOKEN, prefijoRuta = 'tai-lector-', emitirHora = false, maxPeticionesPorMinuto = 0, fetch: f = globalThis.fetch, reloj = () => Date.now(), ids = null, hostsPermitidos = HOSTS_POR_DEFECTO }) {
    super((a, soloExiste) => this._servir(a, soloExiste, 'a'));
    let u;
    try { u = new URL(urlBase); } catch { throw new ErrorProtocolo('solicitud_invalida', 'La dirección del lector de n8n no es válida.'); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new ErrorProtocolo('solicitud_invalida', 'La dirección del lector debe ser http(s) sin credenciales.');
    if (!hostsPermitidos.includes(u.hostname)) throw new ErrorProtocolo('permiso_denegado', 'El lector de n8n sólo puede apuntar a una dirección local o a una lista explícita de hosts internos.');
    if (typeof token !== 'string' || token.length < 16) throw new ErrorProtocolo('solicitud_invalida', 'Falta el token del lector (credencial de cabecera de n8n).');
    if (typeof f !== 'function') throw new ErrorProtocolo('solicitud_invalida', 'No hay función fetch disponible.');
    if (!Number.isInteger(limite) || limite < 1 || limite > MAX_FILAS_LECTOR) throw new ErrorProtocolo('solicitud_invalida', 'Límite de filas fuera de rango.');
    this._base = u.origin + u.pathname.replace(/\/+$/, '');
    this._token = token;
    if (!['sintetico', 'real_saneado', 'real_produccion'].includes(procedencia)) throw new ErrorProtocolo('solicitud_invalida', 'Procedencia no válida (sintetico, real_saneado o real_produccion).');
    if (!/^[a-z0-9-]{3,48}$/.test(cabecera) || !/^[a-z0-9-]{3,32}$/.test(prefijoRuta)) throw new ErrorProtocolo('solicitud_invalida', 'Cabecera o prefijo de ruta no válidos.');
    if (!Number.isInteger(maxPeticionesPorMinuto) || maxPeticionesPorMinuto < 0 || maxPeticionesPorMinuto > 600) throw new ErrorProtocolo('solicitud_invalida', 'Límite de frecuencia fuera de rango.');
    this.cabecera = cabecera; this.prefijoRuta = prefijoRuta; this.emitirHora = emitirHora === true; this.maxPeticionesPorMinuto = maxPeticionesPorMinuto; this._marcas = [];
    // «real_saneado»: lo declara quien carga las filas en el n8n local (el workflow local rotula siempre sus respuestas como sintéticas); el informe lo marca como dato real HISTÓRICO.
    this.procedencia = procedencia;
    this.copias = copias; // agente → metadatos de la copia transformada (sólo pruebas); los declara quien carga las filas, n8n no los aporta
    this.entorno = entorno;
    this.limite = limite;
    this.ttlMs = ttlMs;
    this.timeoutMs = timeoutMs;
    this._fetch = f;
    this.reloj = reloj;
    this._ids = ids || (() => `l${Math.floor(this.reloj()).toString(36)}${Math.random().toString(36).slice(2, 10)}`);
    this._snap = new Map(); // agente → { a, b, en } | { error, en }
    this._vistaB = new VistaN8n((a, soloExiste) => this._servir(a, soloExiste, 'b'));
    this.peticiones = 0; // contador (para pruebas y para el consumo)
    this.ultimoIdSolicitud = null;
  }

  /** Segunda lectura independiente (la verificación del Director): otra vista sobre la SEGUNDA descarga. */
  independiente() { return this._vistaB; }

  _servir(agente, soloExiste, cual) {
    const s = this._snap.get(agente);
    if (soloExiste) return Boolean(s && !s.error);
    if (!s) throw new ErrorProtocolo('origen_no_disponible', `Aún no se ha consultado el lector de n8n para el agente ${agente}.`);
    if (s.error) throw new ErrorProtocolo('origen_no_disponible', s.error);
    return s[cual];
  }

  async _pedir(agente) {
    const idSolicitud = this._ids();
    this.ultimoIdSolicitud = idSolicitud;
    if (this.maxPeticionesPorMinuto > 0) {
      const ahora = this.reloj(); this._marcas = this._marcas.filter((t) => ahora - t < 60000);
      if (this._marcas.length >= this.maxPeticionesPorMinuto) throw new ErrorProtocolo('origen_no_disponible', 'Se alcanzó el límite de consultas por minuto al lector de n8n; se espera antes de volver a consultar.');
      this._marcas.push(ahora);
    }
    const cuerpo = JSON.stringify({ esquema: ESQUEMA_SOLICITUD_LECTOR, idSolicitud, agente, entorno: this.entorno, limite: this.limite, ...(this.emitirHora ? { emitidoEn: new Date(this.reloj()).toISOString() } : {}) });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res;
    try {
      this.peticiones += 1;
      res = await this._fetch(`${this._base}/${this.prefijoRuta}${agente}`, { method: 'POST', redirect: 'error', signal: ctl.signal, headers: { 'content-type': 'application/json', accept: 'application/json', [this.cabecera]: this._token }, body: cuerpo });
    } catch (e) {
      throw new ErrorProtocolo('origen_no_disponible', e && e.name === 'AbortError' ? 'El lector de n8n no respondió a tiempo.' : 'No se pudo contactar con el lector de n8n.');
    } finally { clearTimeout(t); }
    if (!res.ok) throw new ErrorProtocolo('origen_no_disponible', `El lector de n8n respondió con estado ${res.status}.`);
    const texto = await res.text();
    if (texto.length > MAX_BYTES_RESPUESTA) throw new ErrorProtocolo('origen_no_disponible', 'La respuesta del lector de n8n supera el tamaño permitido.');
    let json;
    try { json = JSON.parse(texto); } catch { throw new ErrorProtocolo('origen_no_disponible', 'El lector de n8n no devolvió JSON.'); }
    const v = validarRespuestaLector(json, { idSolicitud, agente, entorno: this.entorno, limite: this.limite });
    if (!v.ok) throw new ErrorProtocolo('origen_no_disponible', `Respuesta del lector rechazada: ${v.errores.slice(0, 3).join('; ')}.`);
    const r = v.respuesta;
    if (this.procedencia === 'real_produccion' && r.sintetico !== false) throw new ErrorProtocolo('origen_no_disponible', 'El lector de producción devolvió datos marcados como sintéticos: se rechaza.');
    return { formato: FORMATO_EXPORTACION, agente, tabla: r.tabla, exportadoEn: r.exportadoEn, sintetico: this.procedencia === 'sintetico' ? r.sintetico : false, saneado: this.procedencia === 'real_saneado', ...(this.procedencia === 'real_produccion' ? { produccion: true } : {}), ...(this.copias[agente] ? { copia: this.copias[agente] } : {}), filas: r.filas.map(({ id, ...resto }) => (id === undefined ? resto : { id, ...resto })), idSolicitud };
  }

  /** Descarga (dos veces, de forma independiente) las instantáneas de los agentes indicados. No lanza: el fallo queda para la lectura síncrona, que lo declara. */
  async refrescar(agentes = ['04', '12'], { forzar = false } = {}) {
    for (const agente of agentes) {
      if (!TABLAS_LECTOR[agente]) continue;
      const previo = this._snap.get(agente);
      if (!forzar && previo && !previo.error && this.reloj() - previo.en < this.ttlMs) continue;
      try {
        const a = await this._pedir(agente);
        const b = await this._pedir(agente);
        this._snap.set(agente, { a, b, en: this.reloj() });
      } catch (e) {
        this._snap.set(agente, { error: e instanceof ErrorProtocolo ? e.error.mensaje : 'Fallo no clasificado al consultar n8n.', en: this.reloj() });
      }
    }
  }

  /** Trazabilidad de la descarga (sin el token): qué se pidió y cuándo. */
  estado() { return [...this._snap.entries()].map(([agente, s]) => ({ agente, ok: !s.error, error: s.error ?? null, en: new Date(s.en).toISOString(), idSolicitudA: s.a ? s.a.idSolicitud : null, idSolicitudB: s.b ? s.b.idSolicitud : null })); }
}
