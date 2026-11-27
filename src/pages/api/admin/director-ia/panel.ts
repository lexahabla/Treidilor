/**
 * TREIDILOR — API ADMIN: PANEL DEL DIRECTOR (consultas de agentes).
 *
 * GET /api/admin/director-ia/panel
 *
 * Consulta el panel de estado del Director a través del puente `tai-chat/1`.
 * Devuelve información SOLO LECTURA: agentes, estados, informes, tareas,
 * resultados, limitaciones y procedencia de los datos. No activa nuevas
 * ejecuciones automáticas.
 *
 * Seguridad: solo el USUARIO MASTER (propietario) accede. Requiere
 * autenticación administrativa (`requireAdminAuth`).
 */

import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../lib/taiPuente';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

function esPropietario(userId: string): boolean {
  const user = findUserById(userId);
  return Boolean(user?.master);
}

export const GET: APIRoute = async ({ request }) => {
  const authError = requireAdminAuth(request);
  if (authError) return authError;
  const user = getSessionUser(request);
  if (!user) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);
  if (!esPropietario(user.id)) {
    return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede consultar el panel del Director.' }, 403);
  }

  let cliente: TaiPuenteClient;
  try {
    const config = resolverConfigPuente();
    cliente = new TaiPuenteClient(config);
  } catch {
    return json({
      success: false,
      code: 'puente_no_configurado',
      message: 'El servicio conversacional del Director no está configurado en el servidor.',
    }, 503);
  }

  let panel: any;
  try {
    panel = await cliente.obtenerPanel();
  } catch (e) {
    const errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
    return json(
      { success: false, code: errorPuente.codigo, message: errorPuente.message },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  return json({
    success: true,
    origen: 'tai-chat/1',
    procedencia: 'Director 00 (servicio conversacional persistente, compartido con Telegram)',
    soloLectura: true,
    esquema: panel.esquema ?? null,
    generadoEn: panel.en ?? null,
    agentes: Array.isArray(panel.agentes) ? panel.agentes : [],
    prioridades: Array.isArray(panel.prioridades) ? panel.prioridades : [],
    directrices: Array.isArray(panel.directrices) ? panel.directrices : [],
    encargos: Array.isArray(panel.encargos) ? panel.encargos : [],
    confirmacionesPendientes: Array.isArray(panel.confirmacionesPendientes) ? panel.confirmacionesPendientes : [],
    confirmacionesRecientes: Array.isArray(panel.confirmacionesRecientes) ? panel.confirmacionesRecientes : [],
    hoy: panel.hoy ?? null,
    investigacionesProgramadas: panel.investigacionesProgramadas ?? null,
    informesDeAgentes: panel.informesDeAgentes ?? null,
    limitaciones: [
      'Solo lectura: no se pueden crear, modificar ni ejecutar encargos desde este endpoint.',
      'No se activan nuevas ejecuciones automáticas.',
      'Los datos provienen del servicio conversacional del Director (Canal 13 + Director 00).',
      'El alcance del token es «chat»: no permite confirmaciones.',
    ],
  });
};

export const ALL: APIRoute = () =>
  json({ success: false, code: 'metodo_no_permitido', message: 'Sólo GET.' }, 405, { Allow: 'GET' });
