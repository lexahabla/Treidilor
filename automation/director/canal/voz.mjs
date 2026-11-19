/**
 * Agente 13 · CONTRATO DE VOZ (`tai-voz/1`) — solo la INTERFAZ reutilizable para F4. No hay ningún servicio de voz implementado ni contratado: el adaptador por defecto está
 * DESACTIVADO y cualquier intento de transcribir o sintetizar se rechaza. Cuando se seleccione proveedor (F4), bastará un adaptador que cumpla este contrato; el canal, el
 * Director, los permisos y el ledger no cambian.
 * Reglas del contrato (las impone el Director, no el adaptador): la voz solo SOLICITA y resume; nunca confirma acciones L2–L4 (eso exige la interfaz autenticada); una
 * transcripción con confianza baja se repite al propietario antes de actuar; el audio no se guarda en el ledger (solo la transcripción y su confianza).
 */
import { ErrorProtocolo } from '../protocolo.mjs';

export const CONTRATO_VOZ = Object.freeze({
  version: 'tai-voz/1',
  entrada: Object.freeze({ transcripcion: 'texto ya transcrito (≤ 2000 caracteres)', confianza: 'número 0–1 o null si el motor no la da', idioma: 'es' }),
  salida: Object.freeze({ textoParaVoz: 'texto breve y hablable (≤ 400 caracteres, sin ids ni huellas)', idioma: 'es' }),
  metodos: Object.freeze(['estado()', 'transcribir(audio) → { transcripcion, confianza, idioma }', 'sintetizar(textoParaVoz) → audio']),
  reglas: Object.freeze(['la voz solicita y resume; no confirma L2–L4', 'baja confianza → se repite lo entendido antes de actuar', 'el audio no se persiste en el ledger']),
});

/** Adaptador por defecto: DESACTIVADO. No contacta con ningún servicio ni tiene coste. */
export class VozDesactivada {
  constructor() { this.habilitada = false; this.proveedor = null; }

  estado() { return { habilitada: false, proveedor: null, contrato: CONTRATO_VOZ.version, motivo: 'La voz está planificada para F4: no hay proveedor seleccionado ni servicio contratado.' }; }

  transcribir() { throw new ErrorProtocolo('origen_no_disponible', 'La voz no está disponible: planificada para F4 (sin proveedor ni servicio contratado).'); }

  sintetizar() { throw new ErrorProtocolo('origen_no_disponible', 'La voz no está disponible: planificada para F4 (sin proveedor ni servicio contratado).'); }
}

/** Comprueba que un adaptador cumple el contrato (para probar adaptadores futuros sin servicios reales). */
export function cumpleContratoVoz(adaptador) {
  const faltan = ['estado', 'transcribir', 'sintetizar'].filter((m) => typeof (adaptador && adaptador[m]) !== 'function');
  if (typeof (adaptador && adaptador.habilitada) !== 'boolean') faltan.push('habilitada');
  return { ok: faltan.length === 0, faltan };
}
