/**
 * TREIDILOR — API ADMIN: CONFIRMAR O RECHAZAR UNA OPERACIÓN SENSIBLE DEL DIRECTOR 00 (opción A).
 *
 * POST /api/admin/director-ia/confirmar   { idConfirmacion, decision: 'confirmar'|'rechazar', password }
 *
 * Solo el USUARIO MASTER, desde el propio sitio (CSRF: mismo origen + X-Director-IA: 1), REAUTENTICÁNDOSE con su contraseña en ese momento
 * (con límite de intentos). El servidor llama al puente con el token de alcance `confirmar` (TAI_PUENTE_TOKEN_CONFIRMAR), que nunca llega al
 * navegador. El Director valida caducidad, un solo uso y reautenticación reciente, aplica el cambio y registra en su ledger quién confirmó.
 */
import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser, authenticateUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { sameOrigin } from '../../../../lib/alertsHttp';
import { createRateLimiter } from '../../../../lib/rateLimit';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../lib/taiPuente';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
/** 5 reautenticaciones fallidas por cuenta cada 15 min. */
const intentos = createRateLimiter(5, 15 * 60 * 1000);

export const POST: APIRoute = async ({ request }) => {
  const authError = requireAdminAuth(request); if (authError) return authError;
  const sesion = getSessionUser(request); if (!sesion) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);
  const usuario = findUserById(sesion.id);
  if (!usuario?.master) return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede confirmar operaciones del Director.' }, 403);
  if (!sameOrigin(request) || request.headers.get('X-Director-IA') !== '1') return json({ success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' }, 403);
  let body: { idConfirmacion?: unknown; decision?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return json({ success: false, code: 'json_no_valido', message: 'Cuerpo JSON no válido.' }, 400); }
  const id = typeof body.idConfirmacion === 'string' ? body.idConfirmacion.trim() : '';
  const decision = body.decision === 'confirmar' || body.decision === 'rechazar' ? body.decision : null;
  if (!id || !decision) return json({ success: false, code: 'solicitud_invalida', message: 'Indica la confirmación y la decisión (confirmar o rechazar).' }, 400);
  if (typeof body.password !== 'string' || !body.password) return json({ success: false, code: 'reautenticacion_requerida', message: 'Escribe tu contraseña para confirmar.' }, 400);
  // Reautenticación reforzada: la contraseña se comprueba AHORA (no basta la sesión abierta), con límite de intentos.
  if (!intentos.hit(sesion.id)) return json({ success: false, code: 'demasiados_intentos', message: 'Demasiados intentos: espera unos minutos.' }, 429);
  const verificado = authenticateUser(usuario.username, body.password);
  if (!verificado || verificado.id !== usuario.id) return json({ success: false, code: 'reautenticacion_fallida', message: 'La contraseña no es correcta.' }, 403);
  intentos.reset(sesion.id);
  let cliente: TaiPuenteClient; try { cliente = new TaiPuenteClient(resolverConfigPuente()); } catch { return json({ success: false, code: 'puente_no_configurado', message: 'El servicio del Director no está configurado en el servidor.' }, 503); }
  try {
    const resultado = await cliente.decidirConfirmacion(id, decision, { id: usuario.id, usuario: usuario.username, reautenticadoEn: new Date().toISOString() });
    return json({ success: true, decision, idConfirmacion: id, resultado });
  } catch (e) {
    const err = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, 'Error al contactar con el Director.');
    return json({ success: false, code: err.codigo, message: err.message }, err.status === 500 ? 503 : err.status);
  }
};

export const ALL: APIRoute = () => json({ success: false, code: 'metodo_no_permitido', message: 'Sólo POST.' }, 405);
