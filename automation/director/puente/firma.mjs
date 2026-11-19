/**
 * PUENTE · FIRMA Y VERIFICACIÓN DE SOLICITUDES (lado Director). HMAC-SHA256 con `node:crypto`.
 * Firma = HMAC(secreto, `${version}\n${marca}\n${nonce}\n${sha256(cuerpo)}\n${metodo}\n${ruta}`), hex.
 * Protección: ventana de caducidad (por defecto 5 min, con tolerancia de reloj), nonce de un solo uso (caché acotada) y comparación en tiempo constante.
 * ALCANCE HONESTO: esta verificación vive en el Director. n8n NO verifica HMAC (el nodo Code no puede leer secretos: `$env` está prohibido por el linter y el nodo Webhook
 * sólo ofrece autenticación por cabecera con credencial). Hacia n8n la autenticación es la credencial Header Auth; la firma protege las llamadas ENTRANTES al Director.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ErrorProtocolo } from '../protocolo.mjs';

export const VERSION_FIRMA = 'v1';
export const VENTANA_MS = 5 * 60 * 1000;
export const TOLERANCIA_RELOJ_MS = 30 * 1000;
export const MAX_NONCES = 5000;

export const sha256Hex = (t) => createHash('sha256').update(t).digest('hex');

export function mensajeAFirmar({ marca, nonce, cuerpo, metodo, ruta }) {
  return `${VERSION_FIRMA}\n${marca}\n${nonce}\n${sha256Hex(cuerpo)}\n${String(metodo).toUpperCase()}\n${ruta}`;
}

/** Calcula la firma (para clientes de prueba y para firmar peticiones salientes futuras). */
export function firmar({ secreto, marca, nonce, cuerpo, metodo = 'POST', ruta }) {
  if (typeof secreto !== 'string' || secreto.length < 16) throw new ErrorProtocolo('solicitud_invalida', 'El secreto de firma es demasiado corto.');
  return createHmac('sha256', secreto).update(mensajeAFirmar({ marca, nonce, cuerpo, metodo, ruta })).digest('hex');
}

const iguales = (a, b) => {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Verificador con memoria de nonces (anti-repetición). */
export class VerificadorFirma {
  constructor({ secreto, reloj = () => Date.now(), ventanaMs = VENTANA_MS, maxNonces = MAX_NONCES }) {
    if (typeof secreto !== 'string' || secreto.length < 16) throw new ErrorProtocolo('solicitud_invalida', 'El secreto de firma es demasiado corto.');
    this.secreto = secreto;
    this.reloj = reloj;
    this.ventanaMs = ventanaMs;
    this.maxNonces = maxNonces;
    this._nonces = new Map(); // nonce → expira (ms)
  }

  _purgar(ahora) {
    for (const [n, exp] of this._nonces) if (exp <= ahora) this._nonces.delete(n);
    while (this._nonces.size > this.maxNonces) this._nonces.delete(this._nonces.keys().next().value);
  }

  /** Devuelve { ok:true } o { ok:false, codigo, motivo }. Registra el nonce SÓLO si la firma es correcta. */
  verificar({ marca, nonce, firma, cuerpo, metodo = 'POST', ruta }) {
    const ahora = this.reloj();
    if (typeof marca !== 'string' || !/^\d{10,13}$/.test(marca)) return { ok: false, codigo: 'firma_invalida', motivo: 'marca de tiempo ausente o ilegible' };
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return { ok: false, codigo: 'firma_invalida', motivo: 'nonce ausente o ilegible' };
    if (typeof firma !== 'string' || !/^[0-9a-f]{64}$/.test(firma)) return { ok: false, codigo: 'firma_invalida', motivo: 'firma ausente o ilegible' };
    const ms = marca.length <= 10 ? Number(marca) * 1000 : Number(marca);
    if (ms < ahora - this.ventanaMs) return { ok: false, codigo: 'solicitud_caducada', motivo: 'la marca de tiempo está fuera de la ventana permitida' };
    if (ms > ahora + TOLERANCIA_RELOJ_MS) return { ok: false, codigo: 'firma_invalida', motivo: 'marca de tiempo en el futuro' };
    const esperada = firmar({ secreto: this.secreto, marca, nonce, cuerpo, metodo, ruta });
    if (!iguales(esperada, firma)) return { ok: false, codigo: 'firma_invalida', motivo: 'la firma no coincide' };
    this._purgar(ahora);
    if (this._nonces.has(nonce)) return { ok: false, codigo: 'repeticion', motivo: 'nonce ya usado' };
    this._nonces.set(nonce, ms + this.ventanaMs + TOLERANCIA_RELOJ_MS);
    this._purgar(ahora);
    return { ok: true };
  }
}

/** Idempotencia: una misma `claveIdempotencia` con el mismo cuerpo devuelve la MISMA respuesta; con otro cuerpo se rechaza. Memoria acotada con caducidad. */
export class CacheIdempotencia {
  constructor({ reloj = () => Date.now(), ttlMs = 10 * 60 * 1000, max = 500 } = {}) {
    this.reloj = reloj;
    this.ttlMs = ttlMs;
    this.max = max;
    this._m = new Map();
  }

  _purgar() {
    const ahora = this.reloj();
    for (const [k, v] of this._m) if (v.expira <= ahora) this._m.delete(k);
    while (this._m.size > this.max) this._m.delete(this._m.keys().next().value);
  }

  /** { estado:'nueva' } | { estado:'repetida', respuesta } | { estado:'conflicto' } | { estado:'en_curso' } */
  consultar(clave, huellaCuerpo) {
    this._purgar();
    const v = this._m.get(clave);
    if (!v) return { estado: 'nueva' };
    if (v.huella !== huellaCuerpo) return { estado: 'conflicto' };
    if (!v.respuesta) return { estado: 'en_curso' };
    return { estado: 'repetida', respuesta: v.respuesta };
  }

  reservar(clave, huellaCuerpo) { this._m.set(clave, { huella: huellaCuerpo, respuesta: null, expira: this.reloj() + this.ttlMs }); }
  completar(clave, respuesta) { const v = this._m.get(clave); if (v) v.respuesta = respuesta; }
  liberar(clave) { this._m.delete(clave); }
}
