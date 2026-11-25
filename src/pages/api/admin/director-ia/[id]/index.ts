/**
 * TREIDILOR — API ADMIN: HISTORIAL Y MENSAJES DE UNA CONVERSACIÓN DEL DIRECTOR IA.
 *
 * GET  /api/admin/director-ia/:id   historial de una conversación (sin duplicar)
 * POST /api/admin/director-ia/:id   envía un mensaje a una conversación existente
 *
 * La conversación principal del Director es la FUENTE DE VERDAD del historial
 * (compartida con Telegram). El panel no duplica mensajes: solo consulta el
 * historial real a través del puente y guarda metadatos auxiliares en
 * directorIaStore.
 *
 * Seguridad: solo el USUARIO MASTER (propietario) accede. Requiere
 * autenticación administrativa (`requireAdminAuth`).
 */

import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser } from '../../../../../lib/adminAuth';
import { findUserById } from '../../../../../lib/userStore';
import { sameOrigin } from '../../../../../lib/alertsHttp';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../../lib/taiPuente';
import {
  obtenerConversacionMeta, guardarConversacionPrincipal,
} from '../../../../../lib/directorIaStore';

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

export const GET: APIRoute = async ({ params, request }) => {
  const authError = requireAdminAuth(request);
  if (authError) return authError;
  const user = getSessionUser(request);
  if (!user) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);

  if (!esPropietario(user.id)) {
    return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede leer el historial del Director.' }, 403);
  }

  const idConversacion = String(params.id ?? '');
  if (!idConversacion) {
    return json({ success: false, code: 'id_faltante', message: 'Se requiere el identificador de la conversación.' }, 400);
  }

  // Verifica que la conversación exista y pertenezca al usuario (caché auxiliar).
  const meta = obtenerConversacionMeta(idConversacion, user.id);
  if (!meta) {
    return json({ success: false, code: 'no_encontrada', message: 'Conversación no encontrada.' }, 404);
  }

  const cliente = clientePuente();
  if (!cliente) {
    return json(
      {
        success: false,
        code: 'puente_no_configurado',
        message: 'El servicio conversacional del Director no está configurado en el servidor.',
      },
      503,
    );
  }

  let historial: { conversacion: string; turnos: Array<any> };
  try {
    historial = await cliente.obtenerHistorial(meta.id, { ultimos: 200 });
  } catch (e) {
    const errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
    return json(
      { success: false, code: errorPuente.codigo, message: errorPuente.message },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  // Mapea los turnos del Director (usuario + respuesta) al formato de burbujas del panel.
  const mensajes = historial.turnos.flatMap((turno: any) => {
    const en = turno.en || new Date().toISOString();
    const partes: Array<{
      rol: 'usuario' | 'director';
      contenido: string;
      en: string;
      estado?: string;
      tipoIntencion?: string | null;
      naturalezaDatos?: Array<{ etiqueta: string; detalle: string }>;
      fuentes?: Array<{ texto: string; procedencia: string | null }>;
      tareas?: Array<{ idTarea: string; estado: string; nivel?: string }>;
      solicitudesAutorizacion?: Array<any>;
      limitaciones?: string[];
      avisos?: string[];
      controles?: any;
      registrada?: boolean;
      generadoEn?: string;
    }> = [];

    if (typeof turno.texto === 'string' && turno.texto.trim()) {
      partes.push({ rol: 'usuario', contenido: turno.texto, en });
    }

    const resp = turno.respuesta || {};
    if (typeof resp.mensaje === 'string' && resp.mensaje.trim()) {
      partes.push({
        rol: 'director',
        contenido: resp.mensaje,
        en,
        estado: resp.estado ?? undefined,
        tipoIntencion: resp.tipo ?? null,
        naturalezaDatos: Array.isArray(turno.naturalezaDatos) ? turno.naturalezaDatos : undefined,
        fuentes: Array.isArray(resp.fuentes) ? resp.fuentes : [],
        tareas: Array.isArray(turno.tareas) ? turno.tareas : [],
        solicitudesAutorizacion: Array.isArray(turno.solicitudesAutorizacion) ? turno.solicitudesAutorizacion : [],
        limitaciones: Array.isArray(turno.limitaciones) ? turno.limitaciones : [],
        avisos: Array.isArray(turno.avisos) ? turno.avisos : [],
        controles: turno.controles ?? undefined,
        registrada: turno.registrada ?? undefined,
        generadoEn: turno.en ?? undefined,
      });
    }

    return partes;
  });

  return json({
    success: true,
    conversacion: {
      id: idConversacion,
      titulo: meta.titulo || 'Director IA',
      mensajes,
      creadoEn: meta.creadoEn,
      actualizadoEn: meta.actualizadoEn,
    },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const authError = requireAdminAuth(request);
  if (authError) return authError;
  const user = getSessionUser(request);
  if (!user) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);

  if (!esPropietario(user.id)) {
    return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede enviar mensajes al Director.' }, 403);
  }

  // Protección contra solicitudes cruzadas (CSRF).
  if (!sameOrigin(request) || request.headers.get(CABECERA_ESCRITURA) !== '1') {
    return json(
      { success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' },
      403,
    );
  }

  const idConversacion = String(params.id ?? '');
  if (!idConversacion) {
    return json({ success: false, code: 'id_faltante', message: 'Se requiere el identificador de la conversación.' }, 400);
  }

  const meta = obtenerConversacionMeta(idConversacion, user.id);
  if (!meta) {
    return json({ success: false, code: 'no_encontrada', message: 'Conversación no encontrada.' }, 404);
  }

  const cliente = clientePuente();
  if (!cliente) {
    return json(
      {
        success: false,
        code: 'puente_no_configurado',
        message: 'El servicio conversacional del Director no está configurado en el servidor.',
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

  let respuesta: any;
  let errorPuente: TaiPuenteError | null = null;
  try {
    respuesta = await cliente.enviarMensaje(texto, { conversacion: meta.id, via: 'panel' });
  } catch (e) {
    errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
  }

  // Metadatos auxiliares en caché (no duplica mensajes).
  guardarConversacionPrincipal(user.id, meta.id, texto);

  if (errorPuente) {
    return json(
      {
        success: false,
        code: errorPuente.codigo,
        message: errorPuente.message,
        conversacion: { id: idConversacion, titulo: meta.titulo, creadoEn: meta.creadoEn, actualizadoEn: meta.actualizadoEn },
      },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  return json({
    success: true,
    conversacion: {
      id: idConversacion,
      titulo: meta.titulo || 'Director IA',
      creadoEn: meta.creadoEn,
      actualizadoEn: meta.actualizadoEn,
    },
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
