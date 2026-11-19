/**
 * PUENTE · MODO LECTOR REAL de la consola del Director. DESACTIVADO por defecto: el modo normal sigue siendo el SINTÉTICO (fixtures / instantáneas exportadas).
 * Solo se activa con DOS candados explícitos: `--lector real` y `TAI_DIRECTOR_LECTOR_REAL=si` en el entorno. Con cualquiera de los dos ausente NO se abre ninguna conexión.
 * Configuración (todo obligatorio; nada se deduce):
 *   · URL base INTERNA del webhook de producción (`--n8n-produccion` o `TAI_LECTOR_PROD_URL`), p. ej. `http://<servicio-n8n>:5678/webhook` (host sin puntos, red privada o bucle local; nunca un dominio público)
 *   · hosts permitidos (`--hosts` o `TAI_LECTOR_PROD_HOSTS`), lista explícita
 *   · credencial EXCLUSIVA del lector: `TAI_LECTOR_PROD_TOKEN_FILE` (archivo; preferible) o `TAI_LECTOR_PROD_TOKEN`. Nunca por argumento; nunca se registra
 * La validación estricta de destino, ruta (`/webhook`), cabecera, ventana de la solicitud, límite de frecuencia, tamaño y rechazo de datos sintéticos la hace `crearLectorProduccion` (sin cambios).
 * Cada refresco se REGISTRA en el ledger (`lectura_estado`): destino sin credenciales, agentes, resultado y los dos idSolicitud de cada lectura. Solo lectura: no hay ninguna escritura hacia n8n ni hacia el catálogo.
 */
import fs from 'node:fs';
import { ErrorProtocolo } from '../protocolo.mjs';
import { crearLectorProduccion } from './lector-produccion.mjs';

export const AGENTES_LECTOR_REAL = Object.freeze(['04', '12']);
export const VARIABLE_ACTIVACION = 'TAI_DIRECTOR_LECTOR_REAL';

export function modoLector(o = {}, env = process.env) {
  const m = o.lector === undefined ? 'sintetico' : String(o.lector);
  if (!['sintetico', 'real'].includes(m)) throw new ErrorProtocolo('solicitud_invalida', '--lector admite «sintetico» (por defecto) o «real».');
  if (m === 'real' && env[VARIABLE_ACTIVACION] !== 'si') throw new ErrorProtocolo('permiso_denegado', `El modo lector real está desactivado: exige además ${VARIABLE_ACTIVACION}=si en el entorno.`);
  return m;
}

function leerToken(env, leerArchivo) {
  const archivo = env.TAI_LECTOR_PROD_TOKEN_FILE;
  let t = null;
  if (archivo) { try { t = leerArchivo(archivo, 'utf8').trim(); } catch { throw new ErrorProtocolo('solicitud_invalida', 'No se pudo leer el archivo de la credencial del lector (TAI_LECTOR_PROD_TOKEN_FILE).'); } }
  else if (env.TAI_LECTOR_PROD_TOKEN) t = String(env.TAI_LECTOR_PROD_TOKEN).trim();
  if (!t) throw new ErrorProtocolo('solicitud_invalida', 'Falta la credencial EXCLUSIVA del lector (TAI_LECTOR_PROD_TOKEN_FILE o TAI_LECTOR_PROD_TOKEN).');
  return t;
}

/** Crea el lector de producción a partir de la configuración o lanza ErrorProtocolo. Devuelve { lector, destino } (destino = origen sin credenciales ni ruta con datos). */
export function crearLectorReal(o, env = process.env, { leerArchivo = fs.readFileSync, ...resto } = {}) {
  if (modoLector(o, env) !== 'real') throw new ErrorProtocolo('permiso_denegado', 'El modo lector real no está seleccionado.');
  const urlBase = o['n8n-produccion'] || env.TAI_LECTOR_PROD_URL || '';
  if (!urlBase) throw new ErrorProtocolo('solicitud_invalida', 'Falta la URL interna del lector (--n8n-produccion o TAI_LECTOR_PROD_URL).');
  const hosts = String(o.hosts || env.TAI_LECTOR_PROD_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  const lector = crearLectorProduccion({ urlBase, token: leerToken(env, leerArchivo), hostsPermitidos: hosts, ...resto });
  const u = new URL(urlBase);
  return { lector, destino: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}` };
}

/**
 * Refresca las lecturas (dos consultas independientes por agente) y deja constancia en el ledger. Nunca lanza por un fallo del origen: el fallo queda declarado
 * en cada lectura síncrona («origen_no_disponible») y en el evento. Si el ledger no está disponible, lanza (no se opera sin registro).
 */
export async function refrescarLectorReal(director, lector, destino, { forzar = false, agentes = AGENTES_LECTOR_REAL } = {}) {
  const antes = lector.peticiones;
  await lector.refrescar([...agentes], { forzar });
  const resultados = lector.estado().filter((e) => agentes.includes(e.agente)).map((e) => ({ agente: e.agente, ok: e.ok, error: e.error, en: e.en, idSolicitudA: e.idSolicitudA, idSolicitudB: e.idSolicitudB }));
  director._emitir('lectura_estado', 'director', {}, { modo: 'lector_real_produccion', destino, solo_lectura: true, peticiones: lector.peticiones - antes, resultados });
  return resultados;
}
