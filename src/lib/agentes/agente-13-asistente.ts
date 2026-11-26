/**
 * TREIDILOR — AGENTE 13: ASISTENTE CONVERSACIONAL DEL DIRECTOR.
 *
 * Misión: asistir al propietario en la conversación con el Director 00,
 * coordinando con los demás agentes y traduciendo objetivos en tareas
 * ejecutables.
 *
 * Especialidad: conversación natural, coordinación de agentes, traducción
 * de objetivos a planes de trabajo.
 *
 * Herramientas reales: resumen_catalogo (solo lectura) para contexto.
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaResumenCatalogo } from './herramientas-catalogo';

const SYSTEM_PROMPT_13 = [
  'Eres el Agente 13 de Treidilor: Asistente conversacional del Director.',
  'Tu misión es asistir al propietario en la conversación con el Director 00,',
  'coordinando con los demás agentes (01-12) y traduciendo objetivos en',
  'tareas ejecutables.',
  '',
  'Reglas:',
  '- Tú NO eres el Director: eres su asistente. El Director 00 es la autoridad operativa.',
  '- Traduce los objetivos del propietario en tareas para los agentes especializados.',
  '- Nunca ejecutes acciones con efectos sin autorización del propietario.',
  '- Solo lees datos del catálogo (solo lectura) para dar contexto.',
  '- Responde siempre en español, de forma natural, profesional y amable.',
  '- Si el propietario pide algo que requiere un agente específico, indica cuál y por qué.',
].join('\n');

export const CFG_13 = {
  id: '13',
  nombre: 'Asistente conversacional del Director',
  mision: 'Asistir al propietario en la conversación con el Director 00 y coordinar agentes.',
  especialidad: 'Conversación natural, coordinación de agentes, traducción de objetivos a planes.',
  systemPrompt: SYSTEM_PROMPT_13,
  herramientas: [
    herramientaResumenCatalogo,
  ],
  permisos: ['catalog:read', 'coordinacion:proponer'],
  riesgo: 'medio' as const,
  permiteEfectos: false,
};

export class Agente13Asistente extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_13, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });

    const contextoDatos = JSON.stringify({
      resumenCatalogo: resumen.ok ? resumen.datos : null,
      mensajePropietario: entrada.mensaje ?? '',
      objetivo: entrada.objetivo ?? entrada.tarea ?? '',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de asistencia conversacional: "${String(entrada.objetivo ?? entrada.tarea ?? 'Asistir al propietario en conversación con el Director')}."\n\nMensaje del propietario: ${entrada.mensaje ?? '(sin mensaje específico)'}\n\nDatos reales del catálogo para contexto (solo lectura):\n${contextoDatos}\n\nResponde en español de forma natural: (1) comprende lo que el propietario pide, (2) si requiere un agente especializado, indica cuál (01-12) y por qué, (3) propone un plan de trabajo sencillo, (4) indica qué requiere autorización y qué no, (5) ofrece continuar la conversación. No eres el Director 00: eres su asistente. No ejecutes acciones sin autorización. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-13-${Date.now()}`,
      estado: resumen.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo para contexto.']),
        'Este asistente no ejecuta acciones con efectos; solo propone y coordina. El Director 00 es la autoridad operativa.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
