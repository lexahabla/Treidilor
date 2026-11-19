/**
 * PUENTE · LECTOR DE PRODUCCIÓN. Fábrica del `LectorN8n` para el n8n de PRODUCCIÓN (sólo lectura). Reglas que NO se pueden relajar desde fuera:
 *   · el destino debe ser una dirección INTERNA: bucle local, red privada (RFC 1918 / ULA / enlace local) o un nombre de servicio sin puntos (DNS interno de Swarm/Docker);
 *     un nombre de dominio público (con puntos) se rechaza aunque figure en la lista de hosts permitidos;
 *   · `hostsPermitidos` es OBLIGATORIO y explícito (nada se deduce); el esquema debe ser http(s) sin credenciales y la ruta base `/webhook` (nunca `/webhook-test`);
 *   · el token (credencial Header Auth EXCLUSIVA de producción) se pasa en memoria (se lee de un archivo fuera del repositorio o de una variable de entorno) y nunca se registra;
 *   · rutas fijas `tai-lector-prod-04` / `-12`, cabecera `x-treidilor-lector-prod`, solicitud con `emitidoEn` (ventana de 2 min), entorno «produccion», límite de frecuencia por minuto.
 * No sustituye a la comprobación de que el webhook NO sea alcanzable desde Internet por el proxy público: eso es de la infraestructura (ver LECTOR-PRODUCCION-DESPLIEGUE.md).
 */
import { ErrorProtocolo } from '../protocolo.mjs';
import { LectorN8n } from './lector-n8n.mjs';
import { CABECERA_LECTOR_PRODUCCION, ENTORNO_PRODUCCION, PREFIJO_RUTA_PRODUCCION } from '../../lib/lectorProduccion.mjs';

export const MAX_PETICIONES_POR_MINUTO_PRODUCCION = 20;

/** ¿La dirección es interna (no enrutable desde Internet)? */
export function esHostInterno(h) {
  const host = String(h ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '::1') return true;
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    if ([m4[1], m4[2], m4[3], m4[4]].some((x) => Number(x) > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (host.includes(':')) return /^(fc|fd|fe80)/.test(host);
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(host); // nombre de servicio sin puntos (DNS interno); un FQDN público tiene al menos un punto
}

/**
 * @param {{urlBase:string, token:string, hostsPermitidos:string[], limite?:number, ttlMs?:number, timeoutMs?:number, fetch?:Function, reloj?:()=>number, ids?:()=>string, maxPeticionesPorMinuto?:number}} o
 */
export function crearLectorProduccion({ urlBase, token, hostsPermitidos, maxPeticionesPorMinuto = MAX_PETICIONES_POR_MINUTO_PRODUCCION, ...resto }) {
  if (!Array.isArray(hostsPermitidos) || !hostsPermitidos.length) throw new ErrorProtocolo('solicitud_invalida', 'El lector de producción exige una lista explícita de hosts permitidos.');
  let u;
  try { u = new URL(urlBase); } catch { throw new ErrorProtocolo('solicitud_invalida', 'La dirección del lector de producción no es válida.'); }
  if (!hostsPermitidos.includes(u.hostname)) throw new ErrorProtocolo('permiso_denegado', 'El host del lector de producción no está en la lista explícita de hosts permitidos.');
  if (!esHostInterno(u.hostname)) throw new ErrorProtocolo('permiso_denegado', 'El lector de producción sólo puede usar una dirección interna (nunca un dominio público).');
  if (u.pathname.replace(/\/+$/, '') !== '/webhook') throw new ErrorProtocolo('solicitud_invalida', 'La ruta base del lector de producción debe ser /webhook (nunca /webhook-test).');
  if (u.search || u.hash) throw new ErrorProtocolo('solicitud_invalida', 'La dirección del lector no admite parámetros.');
  return new LectorN8n({ ...resto, urlBase, token, hostsPermitidos, entorno: ENTORNO_PRODUCCION, procedencia: 'real_produccion', cabecera: CABECERA_LECTOR_PRODUCCION, prefijoRuta: PREFIJO_RUTA_PRODUCCION, emitirHora: true, maxPeticionesPorMinuto });
}
