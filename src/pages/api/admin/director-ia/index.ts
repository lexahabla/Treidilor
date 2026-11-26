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
import { sameOrigin } from '../../../../lib/alertsHttp';
import {
  listarConversaciones, contarConversaciones, obtenerConversacionMeta, guardarConversacionPrincipal,
} from '../../../../lib/directorIaStore';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../lib/taiPuente';

const MAX_TEXTO = 2000;
const CABECERA_ESCRITURA = 'X-Director-IA';
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
  if (!cliente) {
    return json(
      { success: false, code: 'puente_no_configurado', message: 'El servicio conversacional del Director no está configurado en el servidor.', conversaciones: [], total: 0 },
      503,
    );
  }
  let principal: { conversacion: string; principal: boolean } | null = null;
  let errorPuente: TaiPuenteError | null = null;

  // ID de conversación explícita (p. ej. la de Telegram) para compartirla sin crear nueva.
  const url = new URL(request.url);
  const conversacionIdExplícita = url.searchParams.get('conversacionId') ?? undefined;

  // Usar la conversación principal ya guardada en el caché si existe,
  // para no crear conversaciones paralelas en el puente.
  const lista = listarConversaciones(user.id);
  const guardada = conversacionIdExplícita
    ? { id: conversacionIdExplícita }
    : (lista.length > 0 ? { id: lista[0].id } : null);

  if (guardada) {
    // Reutilizar la conversación existente (compartida con Telegram).
    try { principal = await cliente.abrirConversacionPrincipal(guardada.id); } catch (e) { errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e)); }
  } else {
    try {
      principal = await cliente.abrirConversacionPrincipal();
      // Persiste el ID de la conversación principal para reutilizarla.
      try { guardarConversacionPrincipal(user.id, principal.conversacion, 'Director IA'); } catch {}
    } catch (e) { errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e)); }
  }

  const conversaciones = principal
    ? [{ id: principal.conversacion, titulo: 'Director IA', creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString() }]
    : [];

  // Persiste metadatos auxiliares en el caché (no duplica mensajes).
  if (principal && !guardada) {
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

  // Protección contra solicitudes cruzadas (CSRF).
  if (!sameOrigin(request) || request.headers.get(CABECERA_ESCRITURA) !== '1') {
    return json(
      { success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' },
      403,
    );
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

  let body: { texto?: string; origen?: string; confianza?: number };
  try {
    body = (await request.json()) as { texto?: string; origen?: string; confianza?: number };
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

  // Validar origen: solo 'texto' o 'voz'.
  const origen = typeof body.origen === 'string' && (body.origen === 'texto' || body.origen === 'voz')
    ? body.origen : 'texto';
  // Validar y acotar confianza: número entre 0 y 1.
  const confianza = typeof body.confianza === 'number' && Number.isFinite(body.confianza)
    ? Math.max(0, Math.min(1, body.confianza)) : 0;

  const yaTiene = contarConversaciones(user.id);
  if (yaTiene >= 50) {
    return json({ success: false, code: 'limite_conversaciones', message: 'Has alcanzado el máximo de 50 conversaciones.' }, 409);
  }

  let principal: { conversacion: string; principal: boolean };
  try {
    principal = await cliente.abrirConversacionPrincipal();
    // Persiste el ID de la conversación principal para reutilizarla
    // (historial único compartido con Telegram).
    try { guardarConversacionPrincipal(user.id, principal.conversacion, texto); } catch {}
  } catch (e) {
    const errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
    return json(
      { success: false, code: errorPuente.codigo, message: errorPuente.message },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  // Envía el primer mensaje al Director, identificado como canal panel.
  let respuesta: any;
  let errorPuente: TaiPuenteError | null = null;
  try {
    respuesta = await cliente.enviarMensaje(texto, {
      conversacion: principal.conversacion,
      via: 'panel',
      origen,
      confianza,
    });
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
