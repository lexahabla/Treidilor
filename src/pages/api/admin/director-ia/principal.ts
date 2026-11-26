/**
 * TREIDILOR — API ADMIN: CONVERSACIÓN PRINCIPAL DEL DIRECTOR IA.
 *
 * GET  /api/admin/director-ia/principal   devuelve la conversación principal
 *                                        del Director (historial real,
 *                                        compartido con Telegram).
 * POST /api/admin/director-ia/principal   envía un mensaje a la conversación
 *                                        principal (identificado como canal
 *                                        panel).
 *
 * La conversación principal es la FUENTE DE VERDAD del historial; el panel
 * no duplica mensajes ni crea conversaciones paralelas.
 *
 * Seguridad: solo el USUARIO MASTER (propietario) accede. Las peticiones de
 * escritura están protegidas contra solicitudes cruzadas (CSRF: Origin del
 * propio sitio + cabecera X-Director-IA: 1).
 */

import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { requireAdminAuth, getSessionUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { sameOrigin } from '../../../../lib/alertsHttp';
import {
  listarConversaciones, guardarConversacionPrincipal,
} from '../../../../lib/directorIaStore';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../lib/taiPuente';
import { clasificarIntencion, respuestaSocial, respuestaSinDatos } from '../../../../lib/directorIaConversacion';

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

function csrfValido(request: Request): boolean {
  if (!sameOrigin(request)) return false;
  return request.headers.get(CABECERA_ESCRITURA) === '1';
}

export const GET: APIRoute = async ({ request }) => {
  const authError = requireAdminAuth(request);
  if (authError) return authError;
  const user = getSessionUser(request);
  if (!user) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);
  if (!esPropietario(user.id)) {
    return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede leer la conversación principal del Director.' }, 403);
  }

  // ID de conversación explícita (p. ej. la de Telegram) para compartirla sin crear nueva.
  const url = new URL(request.url);
  const conversacionIdExplícita = url.searchParams.get('conversacionId') ?? undefined;

  // Usar la conversación principal ya guardada en el caché si existe,
  // para no crear conversaciones paralelas en el puente.
  const lista = listarConversaciones(user.id);
  const guardada = conversacionIdExplícita
    ? { id: conversacionIdExplícita }
    : (lista.length > 0 ? { id: lista[0].id } : null);

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

  let principal: { conversacion: string; principal: boolean };
  if (guardada) {
    // Reutilizar la conversación existente (compartida con Telegram) en lugar
    // de crear una nueva. Así el panel y Telegram comparten el mismo historial.
    try {
      principal = await cliente.abrirConversacionPrincipal(guardada.id);
    } catch {
      // Si la conversación guardada ya no existe en el puente, crear una nueva.
      principal = await cliente.abrirConversacionPrincipal();
      try { guardarConversacionPrincipal(user.id, principal.conversacion, 'Director IA'); } catch {}
    }
  } else {
    try {
      principal = await cliente.abrirConversacionPrincipal();
      // Persiste el ID de la conversación principal para reutilizarla en
      // futuras peticiones (historial único compartido con Telegram).
      try { guardarConversacionPrincipal(user.id, principal.conversacion, 'Director IA'); } catch {}
    } catch (e) {
      const errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
      return json(
        { success: false, code: errorPuente.codigo, message: errorPuente.message },
        errorPuente.status === 500 ? 503 : errorPuente.status,
      );
    }
  }

  let historial: { conversacion: string; turnos: Array<any> };
  try {
    historial = await cliente.obtenerHistorial(principal.conversacion, { ultimos: 200 });
  } catch (e) {
    const errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
    return json(
      { success: false, code: errorPuente.codigo, message: errorPuente.message },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  // Mapea los turnos del Director (usuario + respuesta) al formato de burbujas.
  const mensajes = historial.turnos.flatMap((turno: any) => {
    const en = turno.en || new Date().toISOString();
    const partes: Array<any> = [];
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
      id: principal.conversacion,
      titulo: 'Director IA',
      mensajes,
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
      conversacionDirector: principal.conversacion,
      principal: true,
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const authError = requireAdminAuth(request);
  if (authError) return authError;
  const user = getSessionUser(request);
  if (!user) return json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401);
  if (!esPropietario(user.id)) {
    return json({ success: false, code: 'no_autorizado', message: 'Solo el propietario puede enviar mensajes al Director.' }, 403);
  }

  // Protección contra solicitudes cruzadas (CSRF).
  if (!csrfValido(request)) {
    return json(
      { success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' },
      403,
    );
  }

  // ID de conversación explícita (p. ej. la de Telegram) para compartirla sin crear nueva.
  const url = new URL(request.url);
  const conversacionIdExplícita = url.searchParams.get('conversacionId') ?? undefined;

  // Usar la conversación principal ya guardada en el caché si existe,
  // para no crear conversaciones paralelas en el puente.
  const lista = listarConversaciones(user.id);
  const guardada = conversacionIdExplícita
    ? { id: conversacionIdExplícita }
    : (lista.length > 0 ? { id: lista[0].id } : null);

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

  let principal: { conversacion: string; principal: boolean };
  if (guardada) {
    try {
      principal = await cliente.abrirConversacionPrincipal(guardada.id);
    } catch {
      principal = await cliente.abrirConversacionPrincipal();
      try { guardarConversacionPrincipal(user.id, principal.conversacion, 'Director IA'); } catch {}
    }
  } else {
    try {
      principal = await cliente.abrirConversacionPrincipal();
      try { guardarConversacionPrincipal(user.id, principal.conversacion, 'Director IA'); } catch {}
    } catch (e) {
      const errorPuente = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, String(e));
      return json(
        { success: false, code: errorPuente.codigo, message: errorPuente.message },
        errorPuente.status === 500 ? 503 : errorPuente.status,
      );
    }
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

  // ── Clasificación conversacional local (Problema 2) ──
  // Los mensajes sociales reciben respuesta natural sin cargar al puente
  // (evita que saludos y preguntas cotidianas se clasifiquen como no_entendida).
  // Se recupera el historial real de la conversación (compartido con Telegram)
  // para que la charla tenga continuidad y memoria entre turnos y canales.
  const intencion = clasificarIntencion(texto);

  if (intencion === 'social') {
    const historialReal = await cliente.obtenerHistorial(principal.conversacion, { ultimos: 50 }).catch(() => ({ turnos: [] }));
    const historialTurnos = Array.isArray(historialReal.turnos) ? historialReal.turnos : [];
    const textoRespuesta = respuestaSocial(texto, { historial: historialTurnos });
    const generadoEn = new Date().toISOString();
    // Guarda metadatos del intercambio social (no duplica mensajes en el puente;
    // el historial de la sesión se muestra en el panel y es fuente de verdad).
    try { guardarConversacionPrincipal(user.id, principal.conversacion, texto); } catch {}
    return json({
      success: true,
      conversacion: { id: principal.conversacion, titulo: 'Director IA', conversacionDirector: principal.conversacion, principal: true },
      mensaje: { id: `msg-${randomBytes(8).toString('hex')}`, texto, en: generadoEn },
      respuesta: {
        estado: 'respondida',
        categoria: 'social',
        textoClaro: textoRespuesta,
        detalle: textoRespuesta,
        tipoIntencion: 'social',
        naturalezaDatos: [],
        fuentes: [],
        tareas: [],
        solicitudesAutorizacion: [],
        alternativas: [],
        consecuencias: [],
        limitaciones: [],
        avisos: [],
        controles: {
          registrada: true,
          paradaActiva: null,
          secretoDetectado: false,
          tipoDeControl: null,
          instruccionesSospechosas: 0,
          confirmaPorEsteCanal: false,
          canal: 'panel',
        },
        registrada: true,
        resumenHablado: textoRespuesta,
        generadoEn,
      },
      trazabilidad: { tareas: [] },
      autorizacion: { apruebaElPuente: false, pendientes: [] },
    });
  }

  // ── Consulta del negocio o orden administrativa: ruta normal al puente ──
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

  if (errorPuente) {
    return json(
      {
        success: false,
        code: errorPuente.codigo,
        message: errorPuente.message,
        conversacion: { id: principal.conversacion, conversacionDirector: principal.conversacion, principal: true },
      },
      errorPuente.status === 500 ? 503 : errorPuente.status,
    );
  }

  // Si el puente no entendió una consulta no social, ofrecer una respuesta
  // natural de fallback en lugar de «no_entendida».
  if (respuesta.estado === 'sin_entender' && intencion !== 'social') {
    const textoFallback = respuestaSinDatos(texto);
    return json({
      success: true,
      conversacion: { id: principal.conversacion, titulo: 'Director IA', conversacionDirector: principal.conversacion, principal: true },
      mensaje: { id: respuesta.idSolicitud, texto, en: respuesta.generadoEn },
      respuesta: {
        ...respuesta,
        estado: 'respondida',
        categoria: 'consulta',
        textoClaro: textoFallback,
        detalle: textoFallback,
        tipoIntencion: 'consulta',
      },
      trazabilidad: respuesta.trazabilidad,
      autorizacion: respuesta.autorizacion,
    });
  }

  return json({
    success: true,
    conversacion: { id: principal.conversacion, titulo: 'Director IA', conversacionDirector: principal.conversacion, principal: true },
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
