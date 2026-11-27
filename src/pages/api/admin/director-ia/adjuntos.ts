/**
 * TREIDILOR — API ADMIN: ADJUNTOS DE LOS CHATS DEL DIRECTOR IA.
 *
 * POST   /api/admin/director-ia/adjuntos?conversacionId=cv_…   cuerpo = bytes del archivo; cabecera X-Nombre-Archivo (codificada con encodeURIComponent)
 * GET    /api/admin/director-ia/adjuntos?conversacionId=cv_…   lista de adjuntos del chat (metadatos)
 * GET    /api/admin/director-ia/adjuntos?id=ad_…               descarga protegida (imágenes en línea con su tipo exacto; el resto como descarga)
 * DELETE /api/admin/director-ia/adjuntos?id=ad_…               elimina el adjunto y sus archivos
 *
 * Solo el propietario (master), en SUS chats; escritura con CSRF (mismo origen + X-Director-IA: 1) y límite de ritmo. Nunca se devuelven rutas internas.
 * Adjuntar NO importa nada al catálogo: estos archivos solo existen para la conversación.
 */
import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { sameOrigin } from '../../../../lib/alertsHttp';
import { createRateLimiter } from '../../../../lib/rateLimit';
import { chatPermitido } from '../../../../lib/directorIaChats';
import { ErrorAdjunto, LIMITES_ADJUNTOS, bytesAdjunto, eliminarAdjunto, guardarAdjunto, listarAdjuntos, obtenerAdjunto } from '../../../../lib/directorIaAdjuntos';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const subidas = createRateLimiter(60, 10 * 60_000);
const publico = ({ userId: _u, sha256: _s, ...a }: any) => a;

function propietario(request: Request): { userId: string } | Response {
  const e = requireAdminAuth(request); if (e) return e;
  const s = getSessionUser(request); if (!s) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);
  if (!findUserById(s.id)?.master) return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario gestiona los adjuntos del Director.' }, 403);
  return { userId: s.id };
}
const csrf = (request: Request) => sameOrigin(request) && request.headers.get('X-Director-IA') === '1';
const chatDe = (request: Request, userId: string) => { const id = new URL(request.url).searchParams.get('conversacionId') ?? ''; return chatPermitido(userId, id) ? id : null; };

/** Lee el cuerpo con un tope REAL (no se fía de Content-Length). */
async function leerAcotado(request: Request, max: number): Promise<Buffer> {
  const declarado = Number(request.headers.get('content-length') ?? '0'); if (declarado > max) throw new ErrorAdjunto('archivo_grande', 413, `Cada archivo puede ocupar hasta ${max / 1024 / 1024} MB.`);
  if (!request.body) return Buffer.alloc(0);
  const lector = request.body.getReader(); const trozos: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await lector.read(); if (done) break; n += value.length; if (n > max) { try { await lector.cancel(); } catch { /* nada */ } throw new ErrorAdjunto('archivo_grande', 413, `Cada archivo puede ocupar hasta ${max / 1024 / 1024} MB.`); } trozos.push(value); }
  return Buffer.concat(trozos);
}

export const POST: APIRoute = async ({ request }) => {
  const p = propietario(request); if (p instanceof Response) return p;
  if (!csrf(request)) return json({ success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' }, 403);
  const chat = chatDe(request, p.userId); if (!chat) return json({ success: false, code: 'conversacion_no_autorizada', message: 'Ese chat no existe o no es tuyo.' }, 403);
  if (!subidas.hit(p.userId)) return json({ success: false, code: 'demasiadas_subidas', message: 'Demasiados archivos seguidos: espera unos minutos.' }, 429);
  let nombre = 'archivo'; try { nombre = decodeURIComponent(request.headers.get('X-Nombre-Archivo') ?? 'archivo'); } catch { /* nombre por defecto */ }
  try {
    const b = await leerAcotado(request, LIMITES_ADJUNTOS.bytesArchivo);
    const a = await guardarAdjunto(p.userId, chat, nombre, b);
    return json({ success: true, adjunto: publico(a) }, 201);
  } catch (e) {
    if (e instanceof ErrorAdjunto) return json({ success: false, code: e.codigo, message: e.message }, e.status);
    return json({ success: false, code: 'interno', message: 'No se pudo guardar el archivo.' }, 500);
  }
};

export const GET: APIRoute = async ({ request }) => {
  const p = propietario(request); if (p instanceof Response) return p;
  const sp = new URL(request.url).searchParams; const id = sp.get('id');
  if (id) {
    const a = obtenerAdjunto(p.userId, id); if (!a) return json({ success: false, code: 'adjunto_desconocido', message: 'No existe ese adjunto.' }, 404);
    const imagen = ['png', 'jpg', 'webp'].includes(a.tipo);
    return new Response(bytesAdjunto(a), { status: 200, headers: { 'Content-Type': a.mime, 'Content-Length': String(a.bytes), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox", 'Content-Disposition': `${imagen ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nombre)}` } });
  }
  const chat = chatDe(request, p.userId); if (!chat) return json({ success: false, code: 'conversacion_no_autorizada', message: 'Ese chat no existe o no es tuyo.' }, 403);
  return json({ success: true, adjuntos: listarAdjuntos(p.userId, chat).map(publico) });
};

export const DELETE: APIRoute = async ({ request }) => {
  const p = propietario(request); if (p instanceof Response) return p;
  if (!csrf(request)) return json({ success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' }, 403);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  return eliminarAdjunto(p.userId, id) ? json({ success: true }) : json({ success: false, code: 'adjunto_desconocido', message: 'No existe ese adjunto.' }, 404);
};

export const ALL: APIRoute = () => json({ success: false, code: 'metodo_no_permitido', message: 'Sólo GET, POST y DELETE.' }, 405);
