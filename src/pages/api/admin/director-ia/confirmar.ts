/**
 * TREIDILOR — API ADMIN: APROBAR O RECHAZAR UNA OPERACIÓN DEL DIRECTOR 00 (confirmación proporcionada al riesgo).
 *
 * POST /api/admin/director-ia/confirmar   { idConfirmacion, decision: 'confirmar'|'rechazar', huella?, password? }
 *
 * Siempre: solo el USUARIO MASTER con sesión válida, desde el propio sitio (CSRF: mismo origen + X-Director-IA: 1), con límite de decisiones.
 * El servidor llama al puente con el token de alcance `confirmar` (TAI_PUENTE_TOKEN_CONFIRMAR), que nunca llega al navegador.
 *
 * Desde Director 1.3.6 la contraseña NO se pide en cada confirmación:
 *  · con `huella` (la operación exacta que el propietario vio en el panel), se envía `metodo: 'sesion'` + `verificadoEn` (la sesión se acaba de
 *    verificar aquí). El DIRECTOR decide el riesgo con su registro: un encargo ordinario (consulta o propuesta) queda aprobado; uno sensible devuelve
 *    `reautenticacion_requerida` y el panel pide la contraseña solo entonces. Si la operación cambió, la huella no coincide y no se aprueba nada.
 *  · con `password`, se reautentica AHORA (límite de intentos) y esa reautenticación vale `REAUTENTICACION_MS` para ESTA sesión (no para otras).
 *  · rechazar nunca exige contraseña.
 * Sin huella (Director anterior a 1.3.6) se usa la forma antigua: aprobar exige reautenticación reciente.
 * El Director valida además caducidad, un solo uso, firma del encargo y restricciones, y registra en su ledger quién decidió y con qué método.
 */
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { requireAdminAuth, getSessionUser, authenticateUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { sameOrigin } from '../../../../lib/alertsHttp';
import { createRateLimiter } from '../../../../lib/rateLimit';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError, type AdministradorDecision } from '../../../../lib/taiPuente';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
/** 5 reautenticaciones fallidas por cuenta cada 15 min. */
const intentos = createRateLimiter(5, 15 * 60 * 1000);
/** 30 decisiones por cuenta cada 15 min (aprobar sin contraseña no debe permitir ráfagas automáticas). */
const decisiones = createRateLimiter(30, 15 * 60 * 1000);
/** Validez de una reautenticación con contraseña para la MISMA sesión (el Director acepta ≤ 5 min). */
export const REAUTENTICACION_MS = 5 * 60 * 1000;
const reautenticaciones = new Map<string, number>();
const HUELLA = /^sha256:[0-9a-f]{64}$/;

/** Clave de la sesión concreta (hash de la cookie de sesión; nunca se guarda la cookie). */
function claveSesion(request: Request, userId: string): string {
  const crudo = (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith('tradylor_admin_session=')) ?? '';
  return createHash('sha256').update(`${userId}\n${crudo}`).digest('hex');
}
function reautenticacionVigente(clave: string, ahora: number): number | null {
  for (const [k, t] of reautenticaciones) if (ahora - t > REAUTENTICACION_MS) reautenticaciones.delete(k);
  const t = reautenticaciones.get(clave); return t !== undefined && ahora - t <= REAUTENTICACION_MS ? t : null;
}

export const POST: APIRoute = async ({ request }) => {
  const authError = requireAdminAuth(request); if (authError) return authError;
  const sesion = getSessionUser(request); if (!sesion) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);
  const usuario = findUserById(sesion.id);
  if (!usuario?.master) return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede confirmar operaciones del Director.' }, 403);
  if (!sameOrigin(request) || request.headers.get('X-Director-IA') !== '1') return json({ success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' }, 403);
  let body: { idConfirmacion?: unknown; decision?: unknown; password?: unknown; huella?: unknown };
  try { body = await request.json(); } catch { return json({ success: false, code: 'json_no_valido', message: 'Cuerpo JSON no válido.' }, 400); }
  const id = typeof body.idConfirmacion === 'string' ? body.idConfirmacion.trim() : '';
  const decision = body.decision === 'confirmar' || body.decision === 'rechazar' ? body.decision : null;
  if (!id || !decision) return json({ success: false, code: 'solicitud_invalida', message: 'Indica la confirmación y la decisión (confirmar o rechazar).' }, 400);
  const huella = body.huella === undefined || body.huella === null || body.huella === '' ? null : String(body.huella);
  if (huella !== null && !HUELLA.test(huella)) return json({ success: false, code: 'solicitud_invalida', message: 'La huella de la operación no es válida.' }, 400);
  if (!decisiones.hit(sesion.id)) return json({ success: false, code: 'demasiadas_decisiones', message: 'Demasiadas decisiones seguidas: espera unos minutos.' }, 429);

  const ahora = Date.now(); const clave = claveSesion(request, usuario.id);
  // Reautenticación (solo si el propietario la aporta): se comprueba AHORA, con límite de intentos, y vale unos minutos para esta sesión.
  if (typeof body.password === 'string' && body.password) {
    if (!intentos.hit(sesion.id)) return json({ success: false, code: 'demasiados_intentos', message: 'Demasiados intentos: espera unos minutos.' }, 429);
    const verificado = authenticateUser(usuario.username, body.password);
    if (!verificado || verificado.id !== usuario.id) return json({ success: false, code: 'reautenticacion_fallida', message: 'La contraseña no es correcta.' }, 403);
    intentos.reset(sesion.id); reautenticaciones.set(clave, ahora);
  }
  const reautEn = reautenticacionVigente(clave, ahora);
  // Sin huella (Director anterior) aprobar exige reautenticación reciente, como antes.
  if (decision === 'confirmar' && huella === null && reautEn === null) return json({ success: false, code: 'reautenticacion_requerida', message: 'Escribe tu contraseña para confirmar.' }, 400);

  const administrador: AdministradorDecision = huella !== null
    ? { id: usuario.id, usuario: usuario.username, metodo: 'sesion', verificadoEn: new Date(ahora).toISOString(), ...(reautEn !== null ? { reautenticadoEn: new Date(reautEn).toISOString() } : {}) }
    : { id: usuario.id, usuario: usuario.username, ...(reautEn !== null ? { reautenticadoEn: new Date(reautEn).toISOString() } : {}) };
  let cliente: TaiPuenteClient; try { cliente = new TaiPuenteClient(resolverConfigPuente()); } catch { return json({ success: false, code: 'puente_no_configurado', message: 'El servicio del Director no está configurado en el servidor.' }, 503); }
  try {
    const resultado = await cliente.decidirConfirmacion(id, decision, administrador, huella ?? undefined);
    return json({ success: true, decision, idConfirmacion: id, resultado });
  } catch (e) {
    const err = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, 'Error al contactar con el Director.');
    if (err.codigo === 'reautenticacion_requerida') return json({ success: false, code: 'reautenticacion_requerida', message: 'Esta operación es sensible: escribe tu contraseña para confirmarla.' }, 400);
    return json({ success: false, code: err.codigo, message: err.message }, err.status === 500 ? 503 : err.status);
  }
};

export const ALL: APIRoute = () => json({ success: false, code: 'metodo_no_permitido', message: 'Sólo POST.' }, 405);
