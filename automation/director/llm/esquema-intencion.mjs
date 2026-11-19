/**
 * Agente 00 · F1.5 · VALIDACIÓN ESTRICTA de la salida del modelo (esquema de la intención). PURO.
 * El modelo solo PROPONE una intención; este validador rechaza todo lo que no encaje (campos de más, tipos, rangos, agentes inexistentes) y
 * NO corrige en silencio. Los mensajes de error describen la forma del defecto, nunca repiten el contenido recibido (puede ser sensible).
 * El nivel de riesgo NO es un campo de la salida: lo calcula el código a partir del tipo (RIESGO_POR_TIPO) y el modelo no puede fijarlo.
 */
import { TEMAS, TIPOS_INTENCION } from '../intencion.mjs';

export const CAMPOS_OBLIGATORIOS = ['tipo', 'agentes', 'parametros', 'pregunta', 'ambiguedad', 'confianza'];
export const CAMPOS_OPCIONALES = ['tema', 'respuesta'];
export const PARAMETROS_ADMITIDOS = { idEjecucion: 'id', entorno: 'texto', programa: 'texto', categoria: 'texto', entrada: 'texto_largo', entradaRef: 'ref', propuestaRef: 'ref', textoRef: 'ref', textoBytes: 'entero', campana: 'texto', producto: 'texto', imagenUrl: 'url', entradaBytes: 'entero', paginas: 'entero', limite: 'entero', anterior: 'id', actual: 'id', referencia: 'texto' };
export const MAX_RESPUESTA = 1200;
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** JSON Schema equivalente (documentación y para proveedores con salida estructurada). */
export function esquemaJson(registro) {
  const ids = registro ? registro.agentes().map((a) => a.id) : [];
  return {
    type: 'object',
    additionalProperties: false,
    required: CAMPOS_OBLIGATORIOS,
    properties: {
      tipo: { enum: [...TIPOS_INTENCION] },
      agentes: { type: 'array', maxItems: 4, items: ids.length ? { enum: ids } : { type: 'string', pattern: '^\\d{2}$' } },
      parametros: { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(PARAMETROS_ADMITIDOS).map(([k, v]) => [k, v === 'entero' ? { type: 'integer' } : { type: 'string' }])) },
      tema: { enum: [null, ...TEMAS] },
      pregunta: { enum: ['presente', 'historica', 'decision'] },
      ambiguedad: { type: ['string', 'null'], maxLength: 300 },
      confianza: { type: 'number', minimum: 0, maximum: 1 },
      respuesta: { type: ['string', 'null'], maxLength: MAX_RESPUESTA },
    },
  };
}

/** Parsea y valida. Devuelve { ok, intencion?, errores:[texto] }. `texto` debe ser SOLO el objeto JSON (sin envoltorios ni prosa). */
export function validarSalidaIntencion(texto, registro) {
  const errores = [];
  let obj;
  try {
    obj = JSON.parse(String(texto ?? '').trim());
  } catch {
    return { ok: false, errores: ['la salida no es JSON válido'] };
  }
  if (!esObjeto(obj)) return { ok: false, errores: ['la salida no es un objeto'] };
  const permitidos = new Set([...CAMPOS_OBLIGATORIOS, ...CAMPOS_OPCIONALES]);
  for (const k of Object.keys(obj)) if (!permitidos.has(k)) errores.push(`campo no admitido (${k.slice(0, 24)})`);
  for (const k of CAMPOS_OBLIGATORIOS) if (!(k in obj)) errores.push(`falta el campo obligatorio ${k}`);
  if (errores.length) return { ok: false, errores };
  if (!TIPOS_INTENCION.includes(obj.tipo)) errores.push('tipo de intención desconocido');
  if (!Array.isArray(obj.agentes) || obj.agentes.length > 4 || obj.agentes.some((a) => typeof a !== 'string' || !/^\d{2}$/.test(a))) errores.push('agentes debe ser una lista de ids de dos dígitos');
  else if (registro && obj.agentes.some((a) => !registro.agente(a))) errores.push('agentes contiene un agente inexistente');
  if (!esObjeto(obj.parametros)) errores.push('parametros debe ser un objeto');
  else {
    for (const [k, v] of Object.entries(obj.parametros)) {
      const tipo = PARAMETROS_ADMITIDOS[k];
      if (!tipo) { errores.push(`parámetro no admitido (${k.slice(0, 24)})`); continue; }
      if (tipo === 'entero' && !(Number.isInteger(v) && v >= 1 && v <= 100000)) errores.push(`parámetro ${k} debe ser un entero válido`);
      if (tipo === 'id' && !(typeof v === 'string' && /^[a-z]{2}-[0-9a-z-]{1,30}$/.test(v))) errores.push(`parámetro ${k} con formato de id inválido`);
      if (tipo === 'texto' && !(typeof v === 'string' && v.length <= 40)) errores.push(`parámetro ${k} debe ser un texto corto`);
      if (tipo === 'url' && !(typeof v === 'string' && v.length <= 300 && /^https?:\/\/\S+$/i.test(v))) errores.push(`parámetro ${k} debe ser una URL http(s) de hasta 300 caracteres`);
      if (tipo === 'texto_largo' && !(typeof v === 'string' && v.length <= 20000)) errores.push(`parámetro ${k} debe ser un texto de hasta 20000 caracteres`);
      if (tipo === 'ref' && !(typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v))) errores.push(`parámetro ${k} debe ser una huella sha256`);
    }
  }
  if (obj.tema !== undefined && obj.tema !== null && !TEMAS.includes(obj.tema)) errores.push('tema desconocido');
  if (!['presente', 'historica', 'decision'].includes(obj.pregunta)) errores.push('pregunta inválida');
  if (!(obj.ambiguedad === null || (typeof obj.ambiguedad === 'string' && obj.ambiguedad.length <= 300))) errores.push('ambiguedad inválida');
  if (!(typeof obj.confianza === 'number' && obj.confianza >= 0 && obj.confianza <= 1)) errores.push('confianza fuera de rango');
  if (obj.respuesta !== undefined && obj.respuesta !== null) {
    if (typeof obj.respuesta !== 'string' || obj.respuesta.length > MAX_RESPUESTA) errores.push('respuesta inválida');
    else if (obj.tipo !== 'conversacion') errores.push('solo una conversación puede llevar respuesta libre');
  }
  if (obj.tipo === 'conversacion' && obj.agentes.length) errores.push('una conversación no asigna agentes');
  if (errores.length) return { ok: false, errores };
  return { ok: true, errores: [], intencion: { tipo: obj.tipo, agentes: obj.agentes, parametros: obj.parametros, tema: obj.tema ?? null, pregunta: obj.pregunta, ambiguedad: obj.ambiguedad, confianza: obj.confianza, respuesta: obj.respuesta ?? null } };
}
