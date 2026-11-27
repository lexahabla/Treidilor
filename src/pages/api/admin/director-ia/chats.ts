/**
 * TREIDILOR — API ADMIN: CHATS Y PROYECTOS DEL DIRECTOR IA (metadatos de la barra lateral).
 *
 * GET  /api/admin/director-ia/chats   chats (con la principal de Telegram fijada) y proyectos
 * POST /api/admin/director-ia/chats   { accion, … }:
 *   crear { titulo?, proyectoId? }       → el Director crea una conversación NUEVA e independiente (su propio contexto)
 *   vincular { id }                      → registra una conversación existente del Director (comprobada en el Director)
 *   renombrar { id, titulo } · mover { id, proyectoId|null } · archivar · desarchivar · eliminar (papelera, 30 días) · restaurar
 *   crearProyecto { nombre, instrucciones? } · editarProyecto { id, nombre?, instrucciones? } · eliminarProyecto { id }
 *
 * Solo el propietario (master), desde el propio sitio (CSRF: mismo origen + X-Director-IA: 1). Los mensajes NO pasan por aquí:
 * siguen en el Director (fuente de verdad). El token del puente nunca sale del servidor.
 */
import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { sameOrigin } from '../../../../lib/alertsHttp';
import { createRateLimiter } from '../../../../lib/rateLimit';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../lib/taiPuente';
import { purgarAdjuntosHuerfanos } from '../../../../lib/directorIaAdjuntos';
import { ErrorChats, ID_CONVERSACION_RE, asegurarPrincipal, crearProyecto, eliminarProyecto, listarChats, modificarChat, modificarProyecto, registrarChat } from '../../../../lib/directorIaChats';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const ritmo = createRateLimiter(60, 60_000);
const MAX_CUERPO = 16_000;

function propietario(request: Request): { userId: string } | Response {
  const e = requireAdminAuth(request); if (e) return e;
  const s = getSessionUser(request); if (!s) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);
  if (!findUserById(s.id)?.master) return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario gestiona los chats del Director.' }, 403);
  return { userId: s.id };
}
const cliente = (): TaiPuenteClient | null => { try { return new TaiPuenteClient(resolverConfigPuente()); } catch { return null; } };
const fallo = (e: unknown) => {
  if (e instanceof ErrorChats) return json({ success: false, code: e.codigo, message: e.message }, e.status);
  if (e instanceof TaiPuenteError) return json({ success: false, code: e.codigo, message: e.message }, e.status === 500 ? 503 : e.status);
  return json({ success: false, code: 'interno', message: 'No se pudo completar la operación.' }, 500);
};
const vista = (userId: string) => { const l = listarChats(userId); return { chats: l.chats.map(({ userId: _u, ...c }) => c), proyectos: l.proyectos.map(({ userId: _u, ...p }) => p) }; };

export const GET: APIRoute = async ({ request }) => {
  const p = propietario(request); if (p instanceof Response) return p;
  // la conversación principal (Telegram) se registra/actualiza en cada carga; si el Director no responde, se lista lo que ya hay
  const c = cliente(); let aviso: string | null = null;
  if (c) { try { asegurarPrincipal(p.userId, await c.conversacionPrincipalDelDirector()); } catch (e) { if (e instanceof ErrorChats) return fallo(e); aviso = 'No se pudo consultar la conversación principal del Director.'; } }
  try { const v = vista(p.userId); try { purgarAdjuntosHuerfanos(p.userId, new Set(v.chats.map((c) => c.id))); } catch { /* limpieza diferida */ } return json({ success: true, ...v, aviso }); } catch (e) { return fallo(e); }
};

export const POST: APIRoute = async ({ request }) => {
  const p = propietario(request); if (p instanceof Response) return p;
  if (!sameOrigin(request) || request.headers.get('X-Director-IA') !== '1') return json({ success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' }, 403);
  if (!ritmo.hit(p.userId)) return json({ success: false, code: 'demasiadas_peticiones', message: 'Demasiadas operaciones seguidas: espera un momento.' }, 429);
  let b: any; try { const t = await request.text(); if (t.length > MAX_CUERPO) return json({ success: false, code: 'cuerpo_demasiado_grande', message: 'Petición demasiado grande.' }, 413); b = JSON.parse(t || '{}'); } catch { return json({ success: false, code: 'json_no_valido', message: 'Cuerpo JSON no válido.' }, 400); }
  const id = typeof b?.id === 'string' ? b.id : '';
  try {
    switch (b?.accion) {
      case 'crear': {
        const c = cliente(); if (!c) return json({ success: false, code: 'puente_no_configurado', message: 'El servicio del Director no está configurado.' }, 503);
        const chat = registrarChat(p.userId, await c.crearConversacionNueva(), { titulo: typeof b.titulo === 'string' ? b.titulo : 'Chat nuevo', proyectoId: typeof b.proyectoId === 'string' ? b.proyectoId : null });
        return json({ success: true, chat: { ...chat, userId: undefined }, ...vista(p.userId) }, 201);
      }
      case 'vincular': {
        if (!ID_CONVERSACION_RE.test(id)) return json({ success: false, code: 'conversacion_invalida', message: 'Identificador de conversación no válido.' }, 400);
        const c = cliente(); if (!c) return json({ success: false, code: 'puente_no_configurado', message: 'El servicio del Director no está configurado.' }, 503);
        await c.obtenerHistorial(id, { ultimos: 1 }); // el Director debe conocerla
        registrarChat(p.userId, id, { titulo: 'Conversación vinculada' }); return json({ success: true, ...vista(p.userId) });
      }
      case 'renombrar': modificarChat(p.userId, { accion: 'renombrar', id, titulo: String(b.titulo ?? '') }); break;
      case 'mover': modificarChat(p.userId, { accion: 'mover', id, proyectoId: typeof b.proyectoId === 'string' && b.proyectoId ? b.proyectoId : null }); break;
      case 'archivar': case 'desarchivar': case 'eliminar': case 'restaurar': modificarChat(p.userId, { accion: b.accion, id }); break;
      case 'confidencial': modificarChat(p.userId, { accion: 'confidencial', id, valor: b.valor }); break;
      case 'crearProyecto': { const pr = crearProyecto(p.userId, String(b.nombre ?? ''), typeof b.instrucciones === 'string' ? b.instrucciones : ''); return json({ success: true, proyecto: { ...pr, userId: undefined }, ...vista(p.userId) }, 201); }
      case 'editarProyecto': modificarProyecto(p.userId, id, { nombre: b.nombre, instrucciones: b.instrucciones }); break;
      case 'eliminarProyecto': eliminarProyecto(p.userId, id); break;
      default: return json({ success: false, code: 'accion_desconocida', message: 'Acción no reconocida.' }, 400);
    }
    return json({ success: true, ...vista(p.userId) });
  } catch (e) { return fallo(e); }
};

export const ALL: APIRoute = () => json({ success: false, code: 'metodo_no_permitido', message: 'Sólo GET y POST.' }, 405);
