/**
 * TREIDILOR — API ADMIN: CONVERSACIÓN PRINCIPAL DEL DIRECTOR IA.
 *
 * GET  /api/admin/director-ia/principal   historial real de la conversación
 *                                        principal del Director 00.
 * POST /api/admin/director-ia/principal   envía un mensaje (texto o voz) al
 *                                        Director, identificado como canal panel.
 *      { audio (base64), mime, segundos } → turno HABLADO: el Director transcribe,
 *                                        responde y devuelve su voz (la misma que en
 *                                        Telegram) o `vozLocal` si hay datos reales.
 *
 * EL PANEL ES SOLO UNA VENTANA DEL DIRECTOR 00 (VPS): no genera respuestas
 * propias, no clasifica intenciones ni llama a ningún modelo de lenguaje.
 * Lo que el propietario ve es exactamente lo que el Director respondió y dejó
 * registrado en su historial (fuente de verdad, compartida con Telegram cuando
 * el Director lo admite).
 *
 * Seguridad: solo el USUARIO MASTER (propietario) accede. Las peticiones de
 * escritura están protegidas contra solicitudes cruzadas (CSRF: Origin del
 * propio sitio + cabecera X-Director-IA: 1). El token del puente nunca sale
 * del servidor.
 */

import type { APIRoute } from 'astro';
import { requireAdminAuth, getSessionUser } from '../../../../lib/adminAuth';
import { findUserById } from '../../../../lib/userStore';
import { sameOrigin } from '../../../../lib/alertsHttp';
import { listarConversaciones, guardarConversacionPrincipal } from '../../../../lib/directorIaStore';
import { TaiPuenteClient, resolverConfigPuente, TaiPuenteError } from '../../../../lib/taiPuente';
import { chatPermitido, tocarChat, asegurarPrincipal, listarChats } from '../../../../lib/directorIaChats';
import { obtenerAdjunto, paraDirector, marcarEnviados, LIMITES_ADJUNTOS } from '../../../../lib/directorIaAdjuntos';

const MAX_TEXTO = 2000;
/** Una frase hablada: hasta 60 s de audio comprimido del navegador (en base64). */
const MAX_AUDIO_BASE64 = 1_800_000;
const MAX_SEGUNDOS_VOZ = 60;
const MIMES_VOZ = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']);
const CABECERA_ESCRITURA = 'X-Director-IA';
/** Identificador de conversación aceptado desde el navegador (mismo formato que el Director). */
const ID_CONVERSACION_RE = /^[A-Za-z0-9._:-]{4,120}$/;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

let _clientePuente: TaiPuenteClient | null = null;
function clientePuente(): TaiPuenteClient | null {
  if (_clientePuente) return _clientePuente;
  try {
    _clientePuente = new TaiPuenteClient(resolverConfigPuente());
    return _clientePuente;
  } catch {
    return null;
  }
}

function esPropietario(userId: string): boolean {
  return Boolean(findUserById(userId)?.master);
}

function csrfValido(request: Request): boolean {
  return sameOrigin(request) && request.headers.get(CABECERA_ESCRITURA) === '1';
}

function errorDePuente(e: unknown): Response {
  const err = e instanceof TaiPuenteError ? e : new TaiPuenteError('interno', 502, 'Error interno al contactar con el Director.');
  return json({ success: false, code: err.codigo, message: err.message }, err.status === 500 ? 503 : err.status);
}

const sinPuente = () =>
  json({ success: false, code: 'puente_no_configurado', message: 'El servicio conversacional del Director no está configurado en el servidor.' }, 503);

/** Comprueba sesión de propietario; devuelve el usuario o la respuesta de error. */
function propietario(request: Request, mensajeNoAutorizado: string): { user: { id: string } } | { error: Response } {
  const authError = requireAdminAuth(request);
  if (authError) return { error: authError };
  const user = getSessionUser(request);
  if (!user) return { error: json({ success: false, code: 'no_autenticado', message: 'Sesión no válida.' }, 401) };
  if (!esPropietario(user.id)) return { error: json({ success: false, code: 'no_autorizado', message: mensajeNoAutorizado }, 403) };
  return { user };
}

/**
 * Resuelve la conversación del Director sin crear conversaciones paralelas:
 *  1. la indicada explícitamente (p. ej. la de Telegram), si tiene formato válido;
 *  2. la última guardada para este propietario;
 *  3. si no hay ninguna, la conversación principal que devuelva el Director.
 * Devuelve también si el id vino guardado (para poder sustituirlo si el Director ya no lo conoce).
 */
async function resolverConversacion(cliente: TaiPuenteClient, userId: string, request: Request) {
  const explicita = new URL(request.url).searchParams.get('conversacionId') ?? '';
  if (explicita && !ID_CONVERSACION_RE.test(explicita)) {
    throw new TaiPuenteError('conversacion_invalida', 400, 'Identificador de conversación no válido.');
  }
  if (explicita) {
    // Chats: solo conversaciones registradas por el propietario (o la principal real del Director). Nunca un id arbitrario.
    let chat = chatPermitido(userId, explicita);
    if (!chat) {
      const principalReal = await cliente.conversacionPrincipalDelDirector();
      if (principalReal !== explicita) throw new TaiPuenteError('conversacion_no_autorizada', 403, 'Esa conversación no es uno de tus chats.');
      chat = asegurarPrincipal(userId, principalReal);
    }
    return { principal: { conversacion: explicita, principal: chat.principal }, deCache: false };
  }
  const guardada = listarConversaciones(userId)[0]?.id;
  const id = explicita || guardada;
  const principal = await cliente.abrirConversacionPrincipal(id || undefined);
  if (!id) {
    try { guardarConversacionPrincipal(userId, principal.conversacion, 'Director IA'); } catch { /* solo caché */ }
  }
  return { principal, deCache: !explicita && Boolean(guardada) };
}

/** Si el Director ya no conoce la conversación guardada (p. ej. tras reinstalarlo), abre la principal y la recuerda. */
async function sustituirConversacionCaducada(cliente: TaiPuenteClient, userId: string) {
  cliente.olvidarConversacionPrincipal();
  const principal = await cliente.abrirConversacionPrincipal();
  try { guardarConversacionPrincipal(userId, principal.conversacion, 'Director IA'); } catch { /* solo caché */ }
  return principal;
}

const esConversacionDesconocida = (e: unknown) => e instanceof TaiPuenteError && (e.codigo === 'conversacion_desconocida' || e.status === 404);

export const GET: APIRoute = async ({ request }) => {
  const p = propietario(request, 'Solo el propietario puede leer la conversación principal del Director.');
  if ('error' in p) return p.error;
  const cliente = clientePuente();
  if (!cliente) return sinPuente();

  let principal: { conversacion: string; principal: boolean };
  let historial: { conversacion: string; turnos: Array<any> };
  try {
    const r = await resolverConversacion(cliente, p.user.id, request);
    principal = r.principal;
    try {
      historial = await cliente.obtenerHistorial(principal.conversacion, { ultimos: 200 });
    } catch (e) {
      if (!(r.deCache && esConversacionDesconocida(e))) throw e;
      principal = await sustituirConversacionCaducada(cliente, p.user.id);
      historial = await cliente.obtenerHistorial(principal.conversacion, { ultimos: 200 });
    }
  } catch (e) {
    return errorDePuente(e);
  }

  // Turnos del Director (lo dicho + lo respondido y registrado) al formato de burbujas.
  const mensajes = historial.turnos.flatMap((turno: any) => {
    const en = turno.en || null;
    const partes: Array<any> = [];
    if (typeof turno.texto === 'string' && turno.texto.trim()) {
      partes.push({ rol: 'usuario', contenido: turno.texto, en, via: turno.via ?? null, origen: turno.origen ?? null, ...(Array.isArray(turno.adjuntos) ? { adjuntos: turno.adjuntos.map((a: any) => ({ id: String(a.id ?? ''), nombre: String(a.nombre ?? ''), tipo: String(a.tipo ?? '') })) } : {}) });
    }
    // El historial REAL del Director (tai-chat/1) entrega `respuesta` como TEXTO, con `tipo` y `estado` en el propio turno; otros
    // clientes la entregan como objeto { mensaje, tipo, estado, fuentes }. Se aceptan las dos formas: antes, con el Director real,
    // al recargar el historial se perdían todas las respuestas y solo quedaban los mensajes del propietario.
    const resp = typeof turno.respuesta === 'string' ? { mensaje: turno.respuesta, estado: turno.estado, tipo: turno.tipo } : (turno.respuesta || {});
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
        registrada: true,
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
      conversacionDirector: principal.conversacion,
      principal: principal.principal,
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const p = propietario(request, 'Solo el propietario puede enviar mensajes al Director.');
  if ('error' in p) return p.error;
  if (!csrfValido(request)) {
    return json({ success: false, code: 'origen_no_permitido', message: 'No se pudo verificar el origen de la petición.' }, 403);
  }

  // Validar la entrada ANTES de tocar el Director.
  let body: { texto?: unknown; origen?: unknown; confianza?: unknown; audio?: unknown; mime?: unknown; segundos?: unknown; adjuntos?: unknown; salidaVoz?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ success: false, code: 'json_no_valido', message: 'Cuerpo JSON no válido.' }, 400);
  }
  if (body.audio !== undefined) return turnoHablado(request, p.user.id, body);
  const idsAdjuntos = Array.isArray(body.adjuntos) ? body.adjuntos.filter((x): x is string => typeof x === 'string') : [];
  if (Array.isArray(body.adjuntos) && (idsAdjuntos.length !== body.adjuntos.length || idsAdjuntos.length > LIMITES_ADJUNTOS.porMensaje)) return json({ success: false, code: 'adjuntos_no_validos', message: `Hasta ${LIMITES_ADJUNTOS.porMensaje} adjuntos por mensaje.` }, 400);
  let texto = typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto && idsAdjuntos.length) texto = 'Te adjunto estos documentos.';
  if (!texto) return json({ success: false, code: 'texto_vacio', message: 'El mensaje no puede ir vacío.' }, 400);
  if (texto.length > MAX_TEXTO) {
    return json({ success: false, code: 'texto_demasiado_largo', message: `El mensaje supera los ${MAX_TEXTO} caracteres.` }, 400);
  }
  const origen: 'texto' | 'voz' = body.origen === 'voz' ? 'voz' : 'texto';
  const confianza = typeof body.confianza === 'number' && Number.isFinite(body.confianza)
    ? Math.max(0, Math.min(1, body.confianza)) : 0;

  const cliente = clientePuente();
  if (!cliente) return sinPuente();

  let principal: { conversacion: string; principal: boolean };
  let respuesta: Awaited<ReturnType<TaiPuenteClient['enviarMensaje']>>;
  let avisoVersion = false;
  try {
    const r = await resolverConversacion(cliente, p.user.id, request);
    principal = r.principal;
    // adjuntos del chat (solo del propietario y de ESTA conversación) e instrucciones del proyecto del chat
    const adjuntos = []; for (const id of idsAdjuntos) { const a = obtenerAdjunto(p.user.id, id, principal.conversacion); if (!a) return json({ success: false, code: 'adjunto_no_autorizado', message: 'Un adjunto no existe o no pertenece a este chat.' }, 403); adjuntos.push(a); }
    const chatMeta = listarChats(p.user.id); const ch = chatMeta.chats.find((c) => c.id === principal.conversacion); const pr = ch?.proyectoId ? chatMeta.proyectos.find((x) => x.id === ch.proyectoId) : null;
    const confidencial = ch?.confidencial === true;
    const extra = { adjuntos: adjuntos.map(paraDirector), proyecto: pr ? { nombre: pr.nombre, instrucciones: pr.instrucciones } : null, ...(confidencial ? { privado: true } : {}) };
    const enviar = async (conv: string) => {
      try { return await cliente.enviarMensaje(texto, { conversacion: conv, origen, confianza, ...extra, salidaVoz: body.salidaVoz }); }
      catch (e) {
        // Director anterior a 1.3.4: no admite adjuntos ni proyecto → se envía el texto y se avisa (no se pierde el mensaje)
        // Un chat CONFIDENCIAL nunca se reenvía sin su protección: si el Director instalado no la admite, el mensaje no se envía.
        if (e instanceof TaiPuenteError && e.status === 400 && /Campos no permitidos/.test(e.message) && confidencial) throw new TaiPuenteError('confidencial_no_disponible', 409, 'Este chat es confidencial y el Director instalado aún no lo admite (llega con la versión 1.3.4): no he enviado el mensaje.');
        if (e instanceof TaiPuenteError && e.status === 400 && /Campos no permitidos/.test(e.message) && (extra.adjuntos.length || extra.proyecto)) { avisoVersion = true; return cliente.enviarMensaje(texto, { conversacion: conv, origen, confianza }); }
        throw e;
      }
    };
    try {
      respuesta = await enviar(principal.conversacion);
    } catch (e) {
      if (!(r.deCache && esConversacionDesconocida(e))) throw e;
      principal = await sustituirConversacionCaducada(cliente, p.user.id);
      respuesta = await enviar(principal.conversacion);
    }
    if (!avisoVersion && adjuntos.length) marcarEnviados(adjuntos.map((a) => a.id));
  } catch (e) {
    return errorDePuente(e);
  }

  tocarChat(p.user.id, principal.conversacion, texto);
  // Se devuelve la respuesta del Director TAL CUAL (lo mostrado = lo registrado).
  return json({
    success: true,
    conversacion: { id: principal.conversacion, titulo: 'Director IA', conversacionDirector: principal.conversacion, principal: principal.principal },
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
      avisos: avisoVersion ? [...(respuesta.avisos ?? []), 'El Director instalado todavía no lee adjuntos ni instrucciones de proyecto (llega con la versión 1.3.4): he enviado solo tu texto.'] : respuesta.avisos,
      controles: respuesta.controles,
      registrada: respuesta.registrada,
      resumenHablado: respuesta.resumenHablado,
      generadoEn: respuesta.generadoEn,
    },
    trazabilidad: respuesta.trazabilidad,
    autorizacion: respuesta.autorizacion,
  });
};

/** Respuesta del Director al formato del panel (lo mostrado = lo registrado). */
function respuestaPanel(respuesta: Awaited<ReturnType<TaiPuenteClient['enviarMensaje']>>) {
  return {
    estado: respuesta.estado, categoria: respuesta.categoria, textoClaro: respuesta.textoClaro, detalle: respuesta.detalle, tipoIntencion: respuesta.tipoIntencion,
    naturalezaDatos: respuesta.naturalezaDatos, fuentes: respuesta.fuentes, tareas: respuesta.tareas, solicitudesAutorizacion: respuesta.solicitudesAutorizacion,
    alternativas: respuesta.alternativas, consecuencias: respuesta.consecuencias, limitaciones: respuesta.limitaciones, avisos: respuesta.avisos, controles: respuesta.controles,
    registrada: respuesta.registrada, resumenHablado: respuesta.resumenHablado, generadoEn: respuesta.generadoEn,
  };
}

/** Turno hablado: el audio va al Director por el servidor (el token nunca llega al navegador); vuelve su voz o el texto para la voz local. */
async function turnoHablado(request: Request, userId: string, body: { audio?: unknown; mime?: unknown; segundos?: unknown; salidaVoz?: unknown }): Promise<Response> {
  const audio = typeof body.audio === 'string' ? body.audio : '';
  const mime = String(body.mime ?? '').split(';')[0].trim().toLowerCase();
  const segundos = Number(body.segundos);
  if (!audio || audio.length > MAX_AUDIO_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return json({ success: false, code: 'audio_no_valido', message: 'Audio no válido o demasiado largo.' }, 400);
  if (!MIMES_VOZ.has(mime)) return json({ success: false, code: 'audio_no_valido', message: 'Formato de audio no admitido.' }, 400);
  if (!Number.isFinite(segundos) || segundos <= 0 || segundos > MAX_SEGUNDOS_VOZ) return json({ success: false, code: 'audio_no_valido', message: `Cada intervención puede durar hasta ${MAX_SEGUNDOS_VOZ} s.` }, 400);
  const cliente = clientePuente();
  if (!cliente) return sinPuente();
  const chatPedido = new URL(request.url).searchParams.get('conversacionId') ?? '';
  if (chatPedido && chatPermitido(userId, chatPedido)?.confidencial) return json({ success: false, code: 'voz_no_permitida', message: 'Este chat es confidencial: la voz está desactivada porque enviaría tu audio a un servicio externo. Escribe el mensaje.' }, 403);
  let principal: { conversacion: string; principal: boolean };
  let r: Awaited<ReturnType<TaiPuenteClient['hablar']>>;
  try {
    const res = await resolverConversacion(cliente, userId, request);
    principal = res.principal;
    try {
      r = await cliente.hablar(audio, { conversacion: principal.conversacion, mime, segundos, salidaVoz: body.salidaVoz });
    } catch (e) {
      if (!(res.deCache && esConversacionDesconocida(e))) throw e;
      principal = await sustituirConversacionCaducada(cliente, userId);
      r = await cliente.hablar(audio, { conversacion: principal.conversacion, mime, segundos, salidaVoz: body.salidaVoz });
    }
  } catch (e) {
    return errorDePuente(e);
  }
  tocarChat(userId, principal.conversacion, r.transcripcion || '');
  return json({
    success: true,
    conversacion: { id: principal.conversacion, titulo: 'Director IA', conversacionDirector: principal.conversacion, principal: principal.principal },
    voz: { estado: r.estado, mensaje: r.mensaje, transcripcion: r.transcripcion, audio: r.audio, vozLocal: r.vozLocal, requiereRepeticion: r.requiereRepeticion, motivoSinVoz: r.motivoSinVoz ?? null, vozDirector: r.vozDirector ?? null },
    respuesta: r.respuesta ? respuestaPanel(r.respuesta) : null,
  });
}

export const ALL: APIRoute = () =>
  json({ success: false, code: 'metodo_no_permitido', message: 'Sólo GET y POST.' }, 405, { Allow: 'GET, POST' });
