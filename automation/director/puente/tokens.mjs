/**
 * PUENTE · TOKENS POR CLIENTE (patrón `tai_<id>_<secreto>`, como la API de automatización). Sólo se guarda el hash (SHA-256) del secreto.
 * Alcance único útil hoy: `mensajes` (hablar con el Director a través del Canal 13). Caducidad ≤ 90 días. Ningún token concede aprobar operaciones: eso sólo lo hace
 * la persona en la interfaz autenticada del Director; por eso NO existe alcance de aprobación.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ErrorProtocolo } from '../protocolo.mjs';

export const ALCANCES_VALIDOS = ['mensajes'];
export const MAX_DIAS_TOKEN = 90;
const hash = (s) => createHash('sha256').update(s).digest('hex');

export class AlmacenTokens {
  constructor({ reloj = () => Date.now() } = {}) {
    this.reloj = reloj;
    this._clientes = new Map(); // id → { id, hash, alcances, caduca, revocado }
  }

  /** Crea un cliente. Devuelve el token EN CLARO una sola vez. */
  crear({ id, alcances = ['mensajes'], dias = 30 }) {
    if (!/^[a-z0-9-]{3,24}$/.test(String(id))) throw new ErrorProtocolo('solicitud_invalida', 'Identificador de cliente inválido.');
    if (this._clientes.has(id)) throw new ErrorProtocolo('solicitud_invalida', 'Ya existe un cliente con ese identificador.');
    if (!Array.isArray(alcances) || !alcances.length || alcances.some((a) => !ALCANCES_VALIDOS.includes(a))) throw new ErrorProtocolo('solicitud_invalida', 'Alcance no válido.');
    if (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS_TOKEN) throw new ErrorProtocolo('solicitud_invalida', `La caducidad debe estar entre 1 y ${MAX_DIAS_TOKEN} días.`);
    const secreto = randomBytes(24).toString('base64url');
    this._clientes.set(id, { id, hash: hash(secreto), alcances: [...alcances], caduca: this.reloj() + dias * 86400000, revocado: false });
    return { id, token: `tai_${id}_${secreto}`, caduca: new Date(this._clientes.get(id).caduca).toISOString() };
  }

  revocar(id) { const c = this._clientes.get(id); if (c) c.revocado = true; return Boolean(c); }

  /** { ok:true, cliente, alcances } o { ok:false, codigo }. Mismo código para «no existe», «secreto erróneo» (no revela cuál). */
  verificar(token, alcance) {
    const m = /^tai_([a-z0-9-]{3,24})_([A-Za-z0-9_-]{20,80})$/.exec(String(token ?? ''));
    if (!m) return { ok: false, codigo: 'no_autenticado' };
    const c = this._clientes.get(m[1]);
    const esperado = Buffer.from(c ? c.hash : hash('x'), 'utf8');
    const dado = Buffer.from(hash(m[2]), 'utf8');
    const coincide = esperado.length === dado.length && timingSafeEqual(esperado, dado);
    if (!c || !coincide) return { ok: false, codigo: 'no_autenticado' };
    if (c.revocado) return { ok: false, codigo: 'no_autenticado' };
    if (c.caduca <= this.reloj()) return { ok: false, codigo: 'token_caducado' };
    if (!c.alcances.includes(alcance)) return { ok: false, codigo: 'permiso_denegado' };
    return { ok: true, cliente: c.id, alcances: [...c.alcances] };
  }
}
