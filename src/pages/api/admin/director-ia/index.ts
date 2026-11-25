/**
 * TREIDILOR — API ADMIN: CONVERSACIONES DEL DIRECTOR IA.
 *
 * GET  /api/admin/director-ia        lista la conversación principal del usuario (sin mensajes)
 * POST /api/admin/director-ia        abre la conversación principal y envía el primer mensaje
 *
 * La conversación principal del Director es la FUENTE DE VERDAD del historial
 * (compartida con Telegram). El panel no duplica mensajes ni crea una
 * conversación paralela: solo guarda metadatos auxiliares en directorIaStore.
 *
 * Seguridad: solo el USUARIO MASTER (propietario) accede a la conversación
 * principal. Así ningún administrativo sin autorización lee el historial privado
 * de Telegram. Requiere autenticación administrativa (`requireAdminAuth`).
 */

import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import {
  listarConversaciones, crearConversacion, contarConversaciones, obtenerConversacionMeta, guardarConversacionPrincipal,
} from '../../../../lib/directorIaStore';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../lib/taiPuente';

const MAX_TEXTO = 2000;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

let _clientePuente: TaiPuenteClient | null = null;
function clientePuente(): TaiPuenteClient | null {
  if (_clientePuente) return _clientePuente;
  try {
    const config = resolverConfigPuente();
    _clientePuente = new TaiPuenteClient(config);
    return _clientePuente;
  } catch {
    return null;
  }
}

function esPropietario(userId: string): boolean {
  const user = findUserById(userId);
  return Boolean(user?.master);
}

export const GET: APIRoute = async ({ request }) => {
  const authError = requireAdminAuth(request);
  if (authError) return authError;
  const user = getSessionUser(request);
  if (!user) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);

  // Solo el propietario (master) accede a la conversación principal del Director
  // (historial compartido con Telegram). Los demás administrativos no la ven.
  if (!esPropietario(user.id)) {
    return json({ success: true, conversaciones: [], total: 0, motivo: 'sin_autorizacion_conversacion_principal' });
  }

  const cliente = clientePuente();
  let principal: { conversacion: string; principal: boolean } | null = null;
  let errorPuente: TaiPuenteError | null = null;
  if (cliente) {
    try { principal = await cliente.abrirConversacionPrincipal(); } catch (e) { errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e)); }
  }

  const conversaciones = principal
    ? [{ id: principal.conversacion, titulo: 'Director IA', creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString() }]
    : [];

  // Persiste metadatos auxiliares en el caché (no duplica mensajes).
  if (principal) {
    try { guardarConversacionPrincipal(user.id, principal.conversacion, 'Director IA'); } catch {}
  }

  if (errorPuente && !principal) {
    return json(
      {
        success: false,
        code: errorPuente.codigo,
        message: errorPuente.message,
        conversaciones: [],
        total: 0,
        detalle: errorPuente.detalle,
      },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  return json({ success: true, conversaciones, total: conversaciones.length });
};

export const POST: APIRoute = async ({ request }) => {
  const authError = requireAdminAuth(request);
  if (authError) return authError;
  const user = getSessionUser(request);
  if (!user) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);

  if (!esPropietario(user.id)) {
    return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede abrir la conversación principal del Director.' }, 403);
  }

  const cliente = clientePuente();
  if (!cliente) {
    return json(
      {
        success: false,
        code: 'puente_no_configurado',
        message: 'El servicio conversacional del Director no está configurado en el servidor (TAI_PUENTE_HOST / TAI_PUENTE_PORT / TAI_PUENTE_TOKEN).',
      },
      503,
    );
  }

  let body: { texto?: string };
  try {
    body = (await request.json()) as { texto?: string };
  } catch {
    return json({ success: false, code: 'json_no_valido', message: 'Cuerpo JSON no válido.' }, 400);
  }

  const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto) {
    return json({ success: false, code: 'texto_vacio', message: 'El mensaje no puede ir vacío.' }, 400);
  }
  if (texto.length > MAX_TEXTO) {
    return json({ success: false, code: 'texto_demasiado_largo', message: `El mensaje supera los ${MAX_TEXTO} caracteres.` }, 400);
  }

  const yaTiene = contarConversaciones(user.id);
  if (yaTiene >= 50) {
    return json({ success: false, code: 'limite_conversaciones', message: 'Has alcanzado el máximo de 50 conversaciones.' }, 409);
  }

  let principal: { conversacion: string; principal: boolean };
  try {
    principal = await cliente.abrirConversacionPrincipal();
  } catch (e) {
    const errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
    return json(
      { success: false, code: errorPuente.codigo, message: errorPuente.message, detalle: errorPuente.detalle },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  // Envía el primer mensaje al Director, identificado como canal panel.
  let respuesta: any;
  let errorPuente: TaiPuenteError | null = null;
  try {
    respuesta = await cliente.enviarMensaje(texto, { conversacion: principal.conversacion, via: 'panel' });
  } catch (e) {
    errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
  }

  // Metadatos auxiliares en caché (no duplica mensajes: el historial vive en el Director).
  const conversacionMeta = guardarConversacionPrincipal(user.id, principal.conversacion, texto);

  if (errorPuente) {
    return json(
      {
        success: false,
        code: errorPuente.codigo,
        message: errorPuente.message,
        conversacion: { id: conversacionMeta.id, titulo: conversacionMeta.titulo, creadoEn: conversacionMeta.creadoEn },
        detalle: errorPuente.detalle,
      },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  return json({
    success: true,
    conversacion: { id: conversacionMeta.id, titulo: conversacionMeta.titulo, creadoEn: conversacionMeta.creadoEn, actualizadoEn: conversacionMeta.actualizadoEn, conversacionDirector: principal.conversacion },
    mensaje: { id: respuesta.idSolicitud, texto, en: respuesta.generadoEn },
    respuesta: {
      estado: respuesta.estado,
      categoria: respuesta.categoria,
      textoClaro: respuesta.textoClaro,
      detalle: respuesta.detalle,
      tipoIntencion: respuesta.tipoIntencion,
      naturalezaDatos: respuesta.naturalezaDatos,
      fuentes: respuesta.fuentes,
      tareas: respuesta.tareas,
      solicitudesAutorizacion: respuesta.solicitudesAutorizacion,
      alternativas: respuesta.alternativas,
      consecuencias: respuesta.consecuencias,
      limitaciones: respuesta.limitaciones,
      avisos: respuesta.avisos,
      controles: respuesta.controles,
      registrada: respuesta.registrada,
      resumenHablado: respuesta.resumenHablado,
      generadoEn: respuesta.generadoEn,
    },
    trazabilidad: respuesta.trazabilidad,
    autorizacion: respuesta.autorizacion,
  });
};

export const ALL: APIRoute = () =>
  json({ success: false, code: 'metodo_no_permitido', message: 'Sólo GET y POST.' }, 405, { Allow: 'GET, POST' });
