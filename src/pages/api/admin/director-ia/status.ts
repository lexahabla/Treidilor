/**
 * TREIDILOR — API ADMIN: ESTADO DE LA CONEXIÓN CON EL DIRECTOR.
 *
 * GET /api/admin/director-ia/status
 *
 * Consulta `GET <puente>/tai/v1/salud` para saber si el servicio
 * conversacional persistente (Canal 13 + Director 00) está disponible.
 * Sin datos de negocio. Requiere autenticación de administrador.
 */

import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { resolverConfigPuente, TaiPuenteClient } from '../../../../lib/taiPuente';

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

  // Solo el propietario (master) consulta el estado de conexión del Director.
  if (!esPropietario(user.id)) {
    return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede consultar el estado del Director.' }, 403);
  }

  let cliente: TaiPuenteClient;
  try {
    const config = resolverConfigPuente();
    cliente = new TaiPuenteClient(config);
  } catch {
    return json({
      success: true,
      conectado: false,
      motivo: 'no_configurado',
      detalle: 'Faltan variables de entorno del puente (TAI_PUENTE_HOST, TAI_PUENTE_PORT, TAI_PUENTE_TOKEN).',
    });
  }

  const salud = await cliente.salud();
  if (!salud) {
    const info = cliente.obtenerInfoConfig();
    return json({
      success: true,
      conectado: false,
      motivo: 'no_responde',
      detalle: `No se pudo contactar con el puente en ${info.host}:${info.puerto}.`,
      configuracion: info,
    });
  }

  const info = cliente.obtenerInfoConfig();
  return json({
    success: true,
    conectado: true,
    servicio: 'tai-puente',
    version: salud.version ?? null,
    lector: salud.lector ?? [],
    configuracion: info,
  });
};

export const ALL: APIRoute = () =>
  json({ success: false, code: 'metodo_no_permitido', message: 'Sólo GET.' }, 405, { Allow: 'GET' });
