/**
 * Política de URLs del Agente 04 (Calidad del catálogo), modo `lectura_catalogo`. PURA: sin red. Se incrusta en los nodos «Code» de n8n (sin imports reales).
 *
 * Es una política HERMANA de `urlPolicy.mjs` (no la modifica): el modo `publico` del Auditor General no cambia y sus workflows tampoco.
 * Este modo sólo permite UNA cosa: leer el feed `automation-catalog/1` con una credencial propia de sólo lectura.
 *  · Sólo HTTPS (http únicamente en el entorno local y sobre un host local).
 *  · UN host exacto (el de la configuración), sin credenciales en la URL ni puertos distintos de los declarados.
 *  · Sólo la ruta `/api/automation/v1/catalog`, sólo el método GET, sin cuerpo ni redirecciones.
 *  · Sólo los parámetros `limit` y `page`, enteros acotados y en ese orden (forma canónica). Nada de `category`, `network` ni otros: un catálogo parcial por accidente.
 *  · Cabeceras: sólo las declaradas; la autenticación la añade n8n con la credencial (por nombre), nunca va en la petición que planifica el código.
 */
import { HOSTS_LOCALES, RUTA_CATALOGO_AUTOMATIZACION, normalizarUrl } from './urlPolicy.mjs';

export const MODO_LECTURA_CATALOGO = 'lectura_catalogo';
/** Tope absoluto de páginas por ejecución (con 100 productos por página y 10 peticiones/minuto del cliente). */
export const MAX_PAGINAS_CALIDAD = 8;
export const MAX_POR_PAGINA_CALIDAD = 100;
/** Cabeceras que el nodo HTTP puede llevar. `authorization` NO: la pone la credencial de n8n. */
export const CABECERAS_PERMITIDAS_CALIDAD = ['accept', 'user-agent', 'x-treidilor-agente'];
const TABLA_DEL_AUDITOR = 'auditor_general_instantaneas';
/**
 * Límites de PRODUCCIÓN (cliente `n8n-calidad` de la API de automatización: 10 peticiones/minuto y 500/día, por token). El workflow no puede superarlos aunque se edite su configuración:
 * pausa mínima de 7 s entre peticiones, 8 páginas como máximo, host exacto y credencial (por nombre) obligatoria.
 */
export const LIMITES_PRODUCCION_CALIDAD = { host: 'treidilor.com', peticionesPorMinuto: 10, pausaMsMinima: 7000, maxPaginas: MAX_PAGINAS_CALIDAD };

const esEntero = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/**
 * Valida la configuración del agente de calidad y su AISLAMIENTO (lista de errores; vacía = correcta). Se ejecuta al principio del workflow:
 * si falla, no se hace ninguna petición.
 */
export function validarConfigCalidad(cfg) {
  const errores = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['configuración ausente'];
  if (cfg.modo !== MODO_LECTURA_CATALOGO) errores.push(`modo debe ser ${MODO_LECTURA_CATALOGO}`);
  if (cfg.entorno !== 'local' && cfg.entorno !== 'produccion') errores.push(`entorno desconocido (${cfg.entorno})`);
  const base = typeof cfg.baseUrl === 'string' ? normalizarUrl(cfg.baseUrl, undefined) : null;
  if (!base) return [...errores, 'baseUrl no válida'];
  if (!Array.isArray(cfg.hostsPermitidos) || cfg.hostsPermitidos.length !== 1) errores.push('hostsPermitidos debe tener exactamente un host');
  else if (String(cfg.hostsPermitidos[0]).toLowerCase() !== base.host) errores.push('el host permitido debe ser exactamente el de baseUrl');
  const local = HOSTS_LOCALES.includes(base.hostname);
  if (cfg.entorno === 'produccion') {
    if (base.protocol !== 'https:') errores.push('producción exige https');
    if (local) errores.push(`producción con host local (${base.hostname})`);
  } else if (cfg.entorno === 'local') {
    if (!local || /treidilor\.com/.test(base.hostname)) errores.push(`entorno local con baseUrl no local (${base.hostname})`);
  }
  if (base.pathname !== '/' || base.search) errores.push('baseUrl no debe llevar ruta ni parámetros');
  if (base.username || base.password) errores.push('baseUrl no debe llevar credenciales');
  if (!esEntero(cfg.maxPaginasCatalogo, 1, MAX_PAGINAS_CALIDAD)) errores.push(`maxPaginasCatalogo debe ser un entero entre 1 y ${MAX_PAGINAS_CALIDAD}`);
  if (!esEntero(cfg.limitePorPagina, 1, MAX_POR_PAGINA_CALIDAD)) errores.push(`limitePorPagina debe ser un entero entre 1 y ${MAX_POR_PAGINA_CALIDAD}`);
  // Respeto del límite del cliente: la pausa entre peticiones debe caber en las peticiones por minuto declaradas.
  if (!esEntero(cfg.peticionesPorMinuto, 1, 120)) errores.push('peticionesPorMinuto debe ser un entero entre 1 y 120');
  else if (!esEntero(cfg.pausaMs, Math.ceil(60000 / cfg.peticionesPorMinuto), 600000)) errores.push('pausaMs debe respetar peticionesPorMinuto (60000 / peticiones, como mínimo)');
  if (typeof cfg.credencialCatalogo !== 'string') errores.push('credencialCatalogo debe ser el NOMBRE de la credencial (texto)');
  if (!cfg.umbrales || typeof cfg.umbrales !== 'object' || Array.isArray(cfg.umbrales)) errores.push('umbrales es obligatorio');
  const s = cfg.seguimiento;
  if (!s || typeof s !== 'object') errores.push('seguimiento es obligatorio');
  else {
    if (typeof s.tabla !== 'string' || !/^[a-z][a-z0-9_]{5,62}$/.test(s.tabla)) errores.push('seguimiento.tabla debe ser un nombre de tabla en minúsculas (6-63 caracteres, a-z, 0-9 y _)');
    else if (s.tabla === TABLA_DEL_AUDITOR || s.tabla.includes(TABLA_DEL_AUDITOR) || TABLA_DEL_AUDITOR.includes(s.tabla)) errores.push('la memoria del agente de calidad no puede compartir tabla con la del Auditor');
    if (!esEntero(s.maxHistorial, 1, 200)) errores.push('seguimiento.maxHistorial debe ser un entero entre 1 y 200');
    if (!Array.isArray(s.origenesValidos) || !s.origenesValidos.length || s.origenesValidos.some((o) => o !== 'manual' && o !== 'programada')) errores.push('seguimiento.origenesValidos debe ser una lista con manual y/o programada');
  }
  return errores;
}

/**
 * Reglas ADICIONALES de PRODUCCIÓN (se suman a `validarConfigCalidad`; sólo las incrusta el workflow de producción, de modo que el workflow local sigue sin mencionar el dominio real).
 * Devuelve la lista de errores (vacía = correcta). En el entorno local no aplica y devuelve una lista vacía.
 */
export function validarProduccionCalidad(cfg) {
  const errores = [];
  if (!cfg || typeof cfg !== 'object' || cfg.entorno === 'local') return errores;
  const L = LIMITES_PRODUCCION_CALIDAD;
  if (cfg.entorno !== 'produccion') return ['producción: entorno desconocido'];
  const base = typeof cfg.baseUrl === 'string' ? normalizarUrl(cfg.baseUrl, undefined) : null;
  if (!base || base.host !== L.host || String(cfg.hostsPermitidos?.[0] ?? '').toLowerCase() !== L.host) errores.push(`producción: el único host permitido es ${L.host}`);
  if (typeof cfg.credencialCatalogo !== 'string' || !cfg.credencialCatalogo.trim()) errores.push('producción: la credencial (por nombre) es obligatoria; el feed exige token');
  if (!(cfg.peticionesPorMinuto <= L.peticionesPorMinuto)) errores.push(`producción: peticionesPorMinuto no puede superar ${L.peticionesPorMinuto} (límite del cliente)`);
  if (!(cfg.pausaMs >= L.pausaMsMinima)) errores.push(`producción: la pausa entre peticiones no puede ser inferior a ${L.pausaMsMinima} ms`);
  if (!(cfg.maxPaginasCatalogo <= L.maxPaginas)) errores.push(`producción: como máximo ${L.maxPaginas} páginas por ejecución`);
  return errores;
}

/**
 * ¿Puede el agente pedir esta URL? Devuelve { ok, motivo, url } con la URL en forma canónica (`https://host/api/automation/v1/catalog?limit=L&page=P`).
 * Rechaza cualquier otro destino, esquema, host, puerto, ruta, parámetro o forma de escribirlos (fragmentos, codificaciones, mayúsculas en la ruta, barras extra…).
 */
export function evaluarUrlCalidad(valor, cfg) {
  if (validarConfigCalidad(cfg).length) return { ok: false, motivo: 'config_no_valida' };
  if (typeof valor !== 'string' || !valor || /[\s\\\u0000-\u001f]/.test(valor)) return { ok: false, motivo: 'url_no_valida' };
  if (valor.includes('#')) return { ok: false, motivo: 'fragmento_no_permitido' };
  if (!/^https?:\/\//i.test(valor)) return { ok: false, motivo: 'url_no_absoluta' };
  const u = normalizarUrl(valor, undefined);
  if (!u) return { ok: false, motivo: 'url_no_valida' };
  if (u.username || u.password || /^https?:\/\/[^/?#]*@/i.test(valor)) return { ok: false, motivo: 'credenciales_en_url' };
  if (u.host !== String(cfg.hostsPermitidos[0]).toLowerCase()) return { ok: false, motivo: 'host_no_permitido' };
  const local = HOSTS_LOCALES.includes(u.hostname);
  if (u.protocol === 'http:' && !(cfg.entorno === 'local' && local)) return { ok: false, motivo: 'http_fuera_de_local' };
  if (u.pathname !== RUTA_CATALOGO_AUTOMATIZACION) return { ok: false, motivo: 'ruta_no_permitida' };
  const q = String(u.search).match(/^\?limit=(\d{1,3})&page=(\d{1,2})$/);
  if (!q) return { ok: false, motivo: 'parametros_no_permitidos' };
  const limit = Number(q[1]);
  const page = Number(q[2]);
  if (!esEntero(limit, 1, cfg.limitePorPagina) || String(limit) !== q[1]) return { ok: false, motivo: 'limit_fuera_de_rango' };
  if (!esEntero(page, 1, cfg.maxPaginasCatalogo) || String(page) !== q[2]) return { ok: false, motivo: 'page_fuera_de_rango' };
  return { ok: true, url: `${u.protocol}//${u.host}${RUTA_CATALOGO_AUTOMATIZACION}?limit=${limit}&page=${page}` };
}

/**
 * Valida una PETICIÓN completa tal como la va a hacer el nodo HTTP: { metodo, url, cabeceras?, cuerpo?, seguirRedirecciones? }.
 * Sólo GET, sin cuerpo, sin redirecciones, con cabeceras permitidas y una URL que `evaluarUrlCalidad` acepte.
 */
export function evaluarPeticionCalidad(p, cfg) {
  if (!p || typeof p !== 'object') return { ok: false, motivo: 'peticion_no_valida' };
  if (String(p.metodo ?? '').toUpperCase() !== 'GET' || p.metodo !== 'GET') return { ok: false, motivo: 'metodo_no_permitido' };
  if (p.cuerpo !== undefined && p.cuerpo !== null && p.cuerpo !== '') return { ok: false, motivo: 'cuerpo_no_permitido' };
  if (p.seguirRedirecciones !== false) return { ok: false, motivo: 'redirecciones_no_permitidas' };
  for (const k of Object.keys(p.cabeceras ?? {})) {
    if (!CABECERAS_PERMITIDAS_CALIDAD.includes(String(k).toLowerCase())) return { ok: false, motivo: `cabecera_no_permitida:${String(k).toLowerCase()}` };
  }
  return evaluarUrlCalidad(p.url, cfg);
}
