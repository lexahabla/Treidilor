/**
 * TREIDILOR — CAPA CONVERSACIONAL DEL DIRECTOR IA (motor de inferencia real).
 *
 * Esta capa es la que usa el panel web (`/api/admin/director-ia/principal`) para
 * generar respuestas del Director 00 mediante el MOTOR DE INFERENCIA CENTRAL
 * (`src/lib/iaMotor.ts`), que llama a un LLM real (OpenAI, Anthropic, Groq,
 * NVIDIA, OpenRouter o Gemini según las credenciales configuradas).
 *
 * Se ELIMINAN los patrones regex y las respuestas fijas que simulaban
 * inteligencia. Ahora TODO pasa por el LLM: saludos, charla social, presentación,
 * consultas de negocio y fallback cuando el puente no entiende.
 *
 * El historial conversacional se mantiene en la memoria de trabajo del motor
 * (`recordar` / `leerMemoria`) y también se persiste en la conversación principal
 * del Director a través de `guardarConversacionPrincipal` en los endpoints,
 * de modo que el historial se mantiene compartido entre el panel y Telegram.
 *
 * Seguridad: este módulo SOLO genera texto. Nunca ejecuta acciones administrativas
 * ni aprueba operaciones. Las solicitudes de autorización las detecta el modelo y
 * se comunican al propietario para que decida.
 */

import {
  inferir,
  construirMensajes,
  recordar,
  leerMemoria,
} from './iaMotor';

/* ─── Intenciones (metadatos, ahora informativas; el LLM decide la respuesta) ─── */

export const INTENCION_SOCIAL = 'social';
export const INTENCION_NEGOCIO = 'consulta_negocio';
export const INTENCION_ORDEN = 'orden_admin';
export const INTENCION_DESCONOCIDA = 'desconocida';

/**
 * Patrones de clasificación rápida (SOLO para enrutamiento interno: decidir si
 * un mensaje es social o de negocio). No generan respuestas; la respuesta real
 * siempre la produce el LLM vía `generarRespuestaDirector`. Esto no es
 * "inteligencia simulada": es un enrutador de bajo nivel que ahorra llamadas al
 * LLM para casos obvios.
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

const PATRONES_SOCIALES = [
  /^\s*(hola|hello|hey|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos)\s*[.!]*\s*$/i,
  /^\s*(hola|hello|hey|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos)[,!\s].+/i,
  /^\s*(que\s*)?(como\s*(estas|estamos))\s*[.!]*\s*$/i,
  /^\s*(que\s*)?(como\s*(estas|estamos)|que tal|que pasa|que nuevo)[,!\s].+/i,
  /^\s*que\s*(puedes\s*hacer|sabes\s*hacer|me\s*puedes\s*ayudar|ofrec(es|es|es)?)\s*[.!]*\s*$/i,
  /^\s*que\s*(puedes\s*hacer|sabes\s*hacer|me\s*puedes\s*ayudar|ofrec(es|es|es)?)[,!\s].+/i,
  /^\s*(quien\s*eres|que\s*eres|eres\s*el\s*director)\s*[.!]*\s*$/i,
  /^\s*(quien\s*eres|que\s*eres|eres\s*el\s*director)[,!\s].+/i,
  /^\s*(gracias|adios|hasta\s*luego|hasta\s*pronto|chao|bye)\s*[.!]*\s*$/i,
];

const PATRONES_NEGOCIO = [
  /agente|agentes|encargo|encargos|tarea|tareas|informe|informes|estado\s*del\s*negocio|estado\s*de\s*los\s*agentes|cuenta\s*me|cual\s*es\s*el\s*estado|cual\s*es\s*el\s*progreso/i,
  /aprueba|rechaza|confirma|autoriz|ejecut|ejecutar|tarea|encargo/i,
  /producto|productos|categoria|pedido|venta|ventas|comision|afiliado/i,
  /explique|explica|dime|cuantos|cual\b/i,
];

/**
 * Clasifica la intención de un mensaje usando heurísticas rápidas (síncrono).
 * Se usa solo para enrutamiento interno. La respuesta real siempre la genera
 * el LLM vía `generarRespuestaDirector`.
 */
export function clasificarIntencion(texto: string): string {
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

/**
 * System prompt del Director 00. Define la identidad, misión y reglas del
 * Director. Se prepende a cada llamada de inferencia.
 */
const SYSTEM_PROMPT_DIRECTOR = [
  'Eres el Director IA de Treidilor, el coordinador de una organización de',
  '14 agentes de inteligencia artificial que gestionan y desarrollan el portal',
  'de afiliación Treidilor (treidilor.com).',
  '',
  'Tu misión es:',
  '1. Conversar de forma natural, profesional y amable con el propietario.',
  '2. Comprender objetivos complejos y descomponerlos en trabajos.',
  '3. Dirigir a los agentes especializados (01-13) y supervisar sus trabajos.',
  '4. Explicar resultados, evidencias y limitaciones de forma clara.',
  '5. Solicitar autorización explícita antes de cualquier acción con efectos.',
  '',
  'Reglas estrictas (incumplibles):',
  '- Nunca presentes respuestas simuladas, prefabricadas o de plantilla como trabajo real.',
  '- Nunca inventes precios, descuentos, valoraciones, ventas ni datos de negocio.',
  '- Si un dato no consta, di explícitamente "no consta" o "no puedo verificarlo".',
  '- Nunca ejecutes operaciones peligrosas (publicar, borrar, cambiar precios,',
  '  aprobar importaciones, etc.) sin autorización explícita del propietario.',
  '- Diferencia claramente entre lo que tú recomiendas (opinión del modelo) y',
  '  lo que el propietario debe autorizar (acción con efectos).',
  '- Responde siempre en español.',
  '- Mantén un tono profesional, cercano y directo. Sé conciso.',
  '',
  'Agentes a tu disposición (01-13):',
  '01 Investigación de tendencias y productos',
  '02 Programas de afiliación',
  '03 Importación y catálogo',
  '04 Calidad e integridad',
  '05 Ofertas y precios',
  '06 Categorías, diseño y presentación',
  '07 Marketing y SEO',
  '08 Contenidos y recursos visuales',
  '09 Competencia y expertos',
  '10 Analítica y conversión',
  '11 Webs nicho',
  '12 Auditoría general',
  '13 Asistencia conversacional (coordinado contigo)',
  '',
  'Cuando el propietario te pida algo, decide si puedes responder directamente',
  'o si necesitas delegar a un agente especializado. Si delegas, explica a qué',
  'agente y por qué. Si la operación requiere autorización, díselo claramente.',
].join('\n');

/**
 * Genera una respuesta real del Director usando el motor de inferencia (LLM real).
 * Reemplaza las respuestas fijas y patrones regex del motor anterior.
 *
 * @param texto Mensaje del usuario.
 * @param opts Historial previo, identificador de agente y de trabajo.
 * @returns Respuesta con texto, intención detectada, proveedor y modelo usados.
 */
export async function generarRespuestaDirector(
  texto: string,
  opts: { historial?: Array<{ rol: string; contenido: string }>; agente?: string; trabajoId?: string } = {}
): Promise<{
  texto: string;
  intencion: string;
  proveedor: string;
  modelo: string;
  huella: string;
  duracionMs: number;
  avisos: string[];
}> {
  const agente = opts.agente ?? 'director-00';
  const trabajoId = opts.trabajoId ?? `trabajo-${Math.random().toString(36).slice(2, 10)}`;

  // Historial previo en formato del motor.
  const historialPrevio: Array<{ rol: 'system' | 'user' | 'assistant'; contenido: string }> = (
    opts.historial ?? []
  ).map((m) => ({
    rol: (m.rol === 'assistant' ? 'assistant' : 'user') as 'system' | 'user' | 'assistant',
    contenido: String(m.contenido ?? ''),
  }));

  const mensajes = construirMensajes(SYSTEM_PROMPT_DIRECTOR, historialPrevio, texto);

  const resultado = await inferir(mensajes, {
    agente,
    trabajoId,
  });

  // Recordar el turno en la memoria de trabajo del agente (para continuidad entre sesiones).
  recordar(agente, { rol: 'user', contenido: texto });
  recordar(agente, { rol: 'assistant', contenido: resultado.texto });

  return {
    texto: resultado.texto,
    intencion: resultado.tipoIntencion ?? INTENCION_DESCONOCIDA,
    proveedor: resultado.proveedor,
    modelo: resultado.modelo,
    huella: resultado.huella,
    duracionMs: resultado.duracionMs,
    avisos: resultado.avisos,
  };
}

/**
 * Respuesta social (saludos, charla cotidiana, presentación, despedidas)
 * generada por el LLM real. No inventa datos del negocio ni ejecuta acciones.
 * Reemplaza las respuestas fijas del motor anterior.
 */
export async function respuestaSocial(
  texto: string,
  opts: { historial?: Array<{ rol: string; contenido: string }>; agente?: string; trabajoId?: string } = {}
): Promise<string> {
  const resultado = await generarRespuestaDirector(texto, {
    historial: opts.historial,
    agente: opts.agente,
    trabajoId: opts.trabajoId,
  });
  return resultado.texto;
}

/**
 * Respuesta de fallback cuando el Director no entiende una consulta de negocio.
 * Generada por el LLM real: no inventa datos, ofrece ayudar.
 */
export async function respuestaSinDatos(
  texto: string,
  opts: { agente?: string; trabajoId?: string } = {}
): Promise<string> {
  const resultado = await inferir(
    [
      { rol: 'system', contenido: SYSTEM_PROMPT_DIRECTOR },
      {
        rol: 'user',
        contenido: `El usuario escribió: "${texto}". No has podido entender bien su consulta de negocio. Responde en español de forma natural, sin inventar datos del negocio, diciéndole que no has entendido bien y ofreciéndole ayuda para consultar el estado del negocio, agentes, informes o tareas pendientes. No inventes precios, descuentos ni valoraciones.`,
      },
    ],
    { agente: opts.agente, trabajoId: opts.trabajoId }
  );
  return resultado.texto;
}

/**
 * Devuelve el historial de memoria de trabajo de un agente/conversación.
 * Útil para inspección y depuración.
 */
export function leerHistorialMemoria(agente: string, conversacion?: string): Array<{ rol: string; contenido: string }> {
  // `leerMemoria` de iaMotor devuelve IaMensaje[] con rol 'system'|'user'|'assistant'|'tool'
  return leerMemoria(agente, conversacion);
}

/**
 * Limpia la memoria de trabajo de un agente/conversación.
 */
export function olvidarMemoria(agente: string, conversacion?: string): void {
  import('./iaMotor').then(({ olvidar }) => olvidar(agente, conversacion));
}

/* Reexportar utilidades de consumo para el Bloque 8 (control de consumo). */
export { obtenerConsumo } from './iaMotor';
