/**
 * TREIDILOR — FILTROS DE LA MEDICIÓN COMERCIAL (puros, sin E/S).
 *
 * Corrigen los defectos encontrados el 27/11/2026 con los datos reales de noviembre (5.426 «sesiones», 5.411 de una sola página y sin referente;
 * 2.097 clics de salida repartidos entre los 131 productos, 610 a menos de 2 s del anterior; «conversión» del 128 %):
 *   · la visita a una ficha se registraba DOS veces (servidor `middleware` sin sesión + navegador) y cada vista sin sesión contaba como una sesión;
 *   · las páginas del panel (/upayp1b4) se contaban como tráfico del sitio;
 *   · los clics de salida no llevaban sesión: la «conversión» dividía clics entre sesiones, no sesiones que hacen clic;
 *   · rastreadores, vistas previas y comprobadores de enlaces contaban como clics de compradores.
 * No borran ni modifican datos guardados: deciden qué cuenta en las métricas.
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Eventos concretos que NO deben contar en los indicadores (se conservan en el registro como auditoría).
 * 27/11/2026 19:53:21 (Madrid): clic de comprobación hecho por Claude al verificar la redirección de afiliado.
 */
export const EVENTOS_EXCLUIDOS: ReadonlyArray<{ type: string; productId: string; createdAt: string; motivo: string }> = [
  { type: 'outbound_click', productId: 'amazon-b0gr1fc3tr', createdAt: '2026-11-27T18:53:21.736Z', motivo: 'clic de prueba técnica (verificación de la redirección)' },
];
export const esEventoExcluido = (e: { type?: string; productId?: string; createdAt?: string }): boolean =>
  EVENTOS_EXCLUIDOS.some((x) => x.type === e.type && x.productId === e.productId && x.createdAt === e.createdAt);

/**
 * SESIÓN ANÓNIMA SIN ALMACENAMIENTO EN EL NAVEGADOR (27/11/2026). Antes la web guardaba un identificador de visitante persistente
 * (`tradylor_vid`, localStorage) y otro de sesión (`tradylor_sid`, sessionStorage). Ahora la sesión se deriva en el servidor de
 * huella(sal del día + IP + navegador): la IP no se guarda, la sal es aleatoria, vive solo en memoria y cambia cada día (UTC), así que el
 * identificador no permite seguir a nadie de un día a otro ni reconstruir la IP. No hay identificador de visitante.
 */
let salDia = { dia: '', sal: Buffer.alloc(0) };
export function sesionAnonima(ip: string | undefined, userAgent: string | null | undefined, ahora = Date.now()): string | undefined {
  if (!ip) return undefined;
  const dia = new Date(ahora).toISOString().slice(0, 10);
  if (salDia.dia !== dia) salDia = { dia, sal: randomBytes(32) };
  return 'sa_' + createHash('sha256').update(salDia.sal).update('\n').update(ip).update('\n').update(String(userAgent ?? '')).digest('hex').slice(0, 32);
}

/** Rutas del panel de administración: nunca son tráfico del sitio. */
export const RUTA_ADMIN = /^\/upayp1b4(\/|$|\?)/;
export const esRutaAdmin = (path: unknown): boolean => RUTA_ADMIN.test(String(path ?? ''));

interface EventoMinimo { type?: string; source?: string; path?: string; sessionId?: string }

/** Vista que cuenta como tráfico: la del navegador (con sesión), fuera del panel. La del servidor (`middleware`) duplica la misma visita. */
export function esVistaContable(e: EventoMinimo): boolean {
  return e.type === 'page_view' && e.source !== 'middleware' && !esRutaAdmin(e.path);
}

/** ¿Este evento debe entrar en las métricas de tráfico? Excluye el panel y las vistas duplicadas del servidor. */
export function cuentaParaTrafico(e: EventoMinimo & { productId?: string; createdAt?: string }): boolean {
  if (esRutaAdmin(e.path)) return false;
  if (esEventoExcluido(e)) return false;
  if (e.type === 'page_view') return esVistaContable(e);
  return true;
}

/**
 * Agentes automáticos (rastreadores, vistas previas de enlaces, comprobadores, librerías HTTP, navegadores sin interfaz). Un agente de usuario vacío
 * también se considera automático: los navegadores reales siempre lo envían.
 */
// Sin «bot» suelto (coincidiría con modelos de móvil como «CUBOT») ni «telegram»/«whatsapp» sueltos (navegadores integrados reales):
// solo sus robots de vista previa.
const AGENTE_AUTOMATICO = /(bot\/|bot;|\bbot\b|crawler|crawl\/|spider|slurp|facebookexternalhit|embedly|whatsapp\/|telegrambot|discordbot|skypeuripreview|slackbot|linkedinbot|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|java\/|apache-httpclient|libwww|axios\/|node-fetch|undici|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|linkchecker|w3c_validator|n8n|^node(\/|$))/i; // «node»: agente por defecto de fetch en Node
export function esAgenteAutomatico(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? '').trim();
  return !ua || AGENTE_AUTOMATICO.test(ua);
}

/** Identificador de sesión o visitante aceptable (los que genera el sitio: UUID o base36). */
export const idAnalitica = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : undefined;
};

/**
 * Repeticiones del MISMO clic (doble pulsación, apertura duplicada) en una ventana corta: solo cuenta el primero.
 * En memoria del proceso; acotado para no crecer sin límite.
 */
export function crearDeduplicador(ventanaMs = 10_000, max = 5_000) {
  const vistos = new Map<string, number>();
  return (clave: string, ahora = Date.now()): boolean => {
    const t = vistos.get(clave);
    if (t !== undefined && ahora - t < ventanaMs) return true;
    vistos.set(clave, ahora);
    if (vistos.size > max) { for (const [k, v] of vistos) { if (ahora - v >= ventanaMs || vistos.size > max) vistos.delete(k); if (vistos.size <= max / 2) break; } }
    return false;
  };
}
