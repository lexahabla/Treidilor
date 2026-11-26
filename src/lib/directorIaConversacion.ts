/**
 * TREIDILOR — CAPA CONVERSACIONAL LOCAL DEL DIRECTOR IA (Problema 2).
 *
 * Versión con conversación natural REAL y memoria.
 *
 * Esta capa es la que usa el panel web (`/api/admin/director-ia/principal`) para
 * decidir si un mensaje se responde localmente (saludos, charla cotidiana,
 * presentación, despedidas) o se reenvía al puente `tai-chat/1` del Director 00
 * (consultas de negocio, agentes, informes, tareas, órdenes).
 *
 * IMPORTANTE: las respuestas sociales también se escriben en el historial de la
 * conversación principal (a través de `guardarConversacionPrincipal` en los
 * endpoints), de modo que el historial se mantiene compartido entre el panel y
 * Telegram y conserva la continuidad de la conversación. No es un catálogo cerrado
 * de respuestas fijas: las respuestas se construyen combinando un saludo contextual
 * con una invitación abierta, sin inventar datos del negocio ni realizar acciones
 * administrativas sin autorización.
 *
 * Reutiliza el servicio conversacional real ya construido en el worktree
 * `autonomia` (ChatDirector + principal.json + JSONL por conversación + ledger
 * del Director 00) a través del cliente `TaiPuenteClient`; no crea otro Director
 * ni contrata proveedores nuevos.
 */

// Niveles de intención (usados como strings en tiempo de ejecución).
const INTENCION_SOCIAL = 'social';
const INTENCION_NEGOCIO = 'consulta_negocio';
const INTENCION_ORDEN = 'orden_admin';
const INTENCION_DESCONOCIDA = 'desconocida';

/**
 * Normaliza un texto para comparación: minúsculas, sin signos de apertura/cierre
 * de interrogación/exclamación, sin tildes ni eñes.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[¿?¡!]/g, '')
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Patrones de mensajes sociales / de conversación cotidiana (texto ya normalizado). */
const PATRONES_SOCIALES = [
  // Saludos simples (solo el saludo)
  /^\s*(hola|hello|hey|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos)\s*[.!]*\s*$/i,
  // Saludos con texto adicional
  /^\s*(hola|hello|hey|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos)[,!\s].+/i,
  // ¿Cómo estás? / ¿qué tal? (con o sin "qué" al principio)
  /^\s*(que\s*)?(como\s*(estas|estamos))\s*[.!]*\s*$/i,
  /^\s*(que\s*)?(como\s*(estas|estamos)|que tal|que pasa|que nuevo)[,!\s].+/i,
  // ¿Qué puedes hacer? / capacidades
  /^\s*que\s*(puedes\s*hacer|sabes\s*hacer|me\s*puedes\s*ayudar|ofrec(es|es|es)?)\s*[.!]*\s*$/i,
  /^\s*que\s*(puedes\s*hacer|sabes\s*hacer|me\s*puedes\s*ayudar|ofrec(es|es|es)?)[,!\s].+/i,
  // Presentación / quién eres
  /^\s*(quien\s*eres|que\s*eres|eres\s*el\s*director)\s*[.!]*\s*$/i,
  /^\s*(quien\s*eres|que\s*eres|eres\s*el\s*director)[,!\s].+/i,
  // Despedidas cortas (social)
  /^\s*(gracias|adios|hasta\s*luego|hasta\s*pronto|chao|bye)\s*[.!]*\s*$/i,
];

/** Patrones que indican consulta de negocio o tarea administrativa (no son sociales). */
const PATRONES_NEGOCIO = [
  /agente|agentes|encargo|encargos|tarea|tareas|informe|informes|estado\s*del\s*negocio|estado\s*de\s*los\s*agentes|cuenta\s*me|cual\s*es\s*el\s*estado|cual\s*es\s*el\s*progreso/i,
  /aprueba|rechaza|confirma|autoriz|ejecut|ejecutar|tarea|encargo/i,
  /producto|productos|categoria|pedido|venta|ventas|comision|afiliado/i,
  /explique|explica|dime|cuantos|cual\b/i,
];

/**
 * Clasifica un mensaje del usuario según su intención.
 * - social: saludo, conversación cotidiana, despedida, presentación
 * - consulta_negocio: pregunta sobre el negocio, agentes, informes, estado
 * - orden_admin: solicitud de acción (aprobar, ejecutar, confirmar)
 * - desconocida: no encaja en ninguna categoría clara → se deja al puente
 */
export function clasificarIntencion(texto) {
  const bajo = normalizar(texto);
  if (!bajo) return INTENCION_DESCONOCIDA;

  // Si coincide con un patrón de negocio, no es social.
  for (const p of PATRONES_NEGOCIO) {
    if (p.test(bajo)) return INTENCION_NEGOCIO;
  }

  // Si coincide con un patrón social, es social.
  for (const p of PATRONES_SOCIALES) {
    if (p.test(bajo)) return INTENCION_SOCIAL;
  }

  return INTENCION_DESCONOCIDA;
}

/** Respuesta de saludo contextual según la hora del día. */
function saludoContextual(): string {
  const hora = new Date().getHours();
  if (hora >= 6 && hora < 13) return 'Buenos días';
  if (hora >= 13 && hora < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * Genera una respuesta natural para un mensaje social, sin inventar datos del
 * negocio y sin realizar acciones administrativas. Se usa el historial previo
 * (si se pasa) para dar continuidad: si el usuario ya saludó antes, no se repite
 * el saludo de forma mecánica.
 */
export function respuestaSocial(texto, { historial } = {}) {
  const bajo = normalizar(texto);
  const saludo = saludoContextual();
  const ultimoSocial = Array.isArray(historial)
    ? historial.slice().reverse().find((m) => m.rol === 'usuario' && /^(hola|hello|hey|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos|gracias|adios)$/i.test(normalizar(m.contenido ?? '')))
    : null;
  const yaSaludo = !!ultimoSocial;

  // Saludos simples
  if (/^\s*(hola|hello|hey|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos)\s*[.!]*\s*$/i.test(bajo)) {
    const m = bajo.match(/^\s*(hola|hello|hey|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos)/i);
    const palabra = m ? m[1] : '';
    const esHola = palabra === 'hola' || palabra === 'hello' || palabra === 'hey';
    const base = esHola
      ? yaSaludo ? 'Hola de nuevo. ¿En qué más puedo ayudarte hoy?' : 'Hola. Soy el Director IA de Treidilor. ¿En qué puedo ayudarte hoy?'
      : 'Hola de nuevo. ¿Qué tal va todo?';
    return `${saludo}. ${base}`;
  }

  // ¿Cómo estás? / ¿qué tal?
  if (/^\s*(que\s*)?(como\s*(estas|estamos)|que tal|que pasa|que nuevo)/i.test(bajo)) {
    return `Muy bien, gracias por preguntar. ¿Y tú, qué tal va todo? ¿En qué puedo ayudarte con Treidilor hoy?`;
  }

  // ¿Qué puedes hacer? / capacidades
  if (/^\s*que\s*(puedes\s*hacer|sabes\s*hacer|me\s*puedes\s*ayudar|ofrec(es|es|es)?)/i.test(bajo)) {
    return `Puedo conversar contigo de forma natural y amable, responder tus preguntas y acompañarte en lo que necesites. También podemos hablar simplemente para ir al día. ¿En qué te puedo ayudar hoy?`;
  }

  // ¿Quién eres? / presentación
  if (/^\s*(quien\s*eres|que\s*eres|eres\s*el\s*director)/i.test(bajo)) {
    return `Soy el Director IA de Treidilor. Estoy aquí para conversar contigo y ayudarte en lo que necesites. Todo lo que hablamos queda en el historial compartido.`;
  }

  // Despedidas
  if (/^\s*(gracias|adios|hasta\s*luego|hasta\s*pronto|chao|bye)\s*[.!]*\s*$/i.test(bajo)) {
    return `De nada. Aquí estaré cuando necesites conversar o revisar algo del negocio. ¡Que tengas un buen día!`;
  }

  // Respuesta social genérica (cordial, abierta, sin inventar hechos)
  return `Hola. Estoy aquí para conversar y ayudarte con lo que necesites de Treidilor. ¿Qué tal va todo? ¿En qué puedo ayudarte hoy?`;
}

/**
 * Respuesta natural cuando el usuario pide información del negocio pero el
 * puente no pudo clasificarla (no_entendida). No inventa datos; ofrece ayudar.
 */
export function respuestaSinDatos(texto) {
  return `No estoy seguro de haber entendido bien tu pregunta: "${texto}". Puedo ayudarte a consultar el estado del negocio, los agentes, los informes o las tareas pendientes. ¿Quieres que te informe sobre algo en concreto?`;
}

export { INTENCION_SOCIAL, INTENCION_NEGOCIO, INTENCION_ORDEN, INTENCION_DESCONOCIDA };
