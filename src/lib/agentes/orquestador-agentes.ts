/**
 * TREIDILOR — ORQUESTADOR DE AGENTES.
 *
 * Permite al Director 00 delegar objetivos entre varios agentes, ejecutar
 * tareas en paralelo cuando son independientes, recuperar resultados y
 * integrar conclusiones. Gestiona estados de ejecución, colas, idempotencia y
 * límites de concurrencia.
 *
 * Toda la inferencia pasa por iaMotor; este orquestador solo coordina.
 */

import {
  ejecutarAgente,
  listarAgentes,
  obtenerAgente,
  existeAgente,
  totalAgentes,
  type CapacidadAgente,
} from './registro-agentes';
import { inferir } from '../iaMotor';

/** Estado de una tarea delegada. */
export type EstadoTarea = 'pendiente' | 'en_progreso' | 'completada' | 'fallida' | 'rechazada' | 'espera_autorizacion';

/** Una tarea delegada a un agente. */
export interface TareaDelegada {
  id: string;
  agenteId: string;
  objetivo: string;
  entrada: Record<string, unknown>;
  estado: EstadoTarea;
  resultado?: any;
  error?: string;
  creadaEn: string;
  iniciadaEn?: string;
  completadaEn?: string;
  duracionMs?: number;
  requiereAutorizacion: boolean;
  autorizada: boolean;
  dependencias: string[]; // IDs de tareas que deben completarse antes
}

/** Resultado de una colaboración entre múltiples agentes. */
export interface ResultadoColaboracion {
  objetivo: string;
  trabajoId: string;
  tareas: TareaDelegada[];
  conclusionesIntegradas: string;
  agentesParticipantes: string[];
  estado: 'completada' | 'parcial' | 'fallida';
  proveedoresUsados: Array<{ agente: string; proveedor: string; modelo: string }>;
  duracionTotalMs: number;
}

/** Cola de trabajos del orquestador (en memoria + persistencia ligera). */
const colaTrabajos = new Map<string, TareaDelegada>();
const CONCURRENCIA_MAX = 4;
let ejecucionesActivas = 0;

/** Genera un ID estable para una tarea. */
function idTarea(): string {
  return `tarea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Espera si se alcanzó el límite de concurrencia. */
async function esperarConcurrencia(): Promise<void> {
  while (ejecucionesActivas >= CONCURRENCIA_MAX) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  ejecucionesActivas += 1;
}

/**
 * Delega una tarea a un agente específico. Valida que el agente exista y
 * registra la tarea en la cola.
 */
export async function delegarTarea(params: {
  agenteId: string;
  objetivo: string;
  entrada: Record<string, unknown>;
  conversacion?: string;
  trabajoId?: string;
  requiereAutorizacion?: boolean;
  dependencias?: string[];
}): Promise<TareaDelegada> {
  const { agenteId, objetivo, entrada, conversacion, trabajoId, requiereAutorizacion = false, dependencias = [] } = params;

  if (!existeAgente(agenteId)) {
    throw new Error(`Agente no encontrado: ${agenteId}`);
  }
  if (!objetivo || typeof objetivo !== 'string' || !objetivo.trim()) {
    throw new Error('El objetivo de la tarea no puede estar vacío.');
  }

  const tarea: TareaDelegada = {
    id: idTarea(),
    agenteId,
    objetivo: objetivo.trim(),
    entrada,
    estado: 'pendiente',
    creadaEn: new Date().toISOString(),
    requiereAutorizacion,
    autorizada: false,
    dependencias,
  };

  colaTrabajos.set(tarea.id, tarea);
  return tarea;
}

/** Autoriza una tarea pendiente (el propietario da luz verde). */
export function autorizarTarea(tareaId: string): boolean {
  const tarea = colaTrabajos.get(tareaId);
  if (!tarea) return false;
  if (tarea.estado !== 'pendiente') return false;
  tarea.autorizada = true;
  return true;
}

/** Obtiene una tarea por su ID. */
export function obtenerTarea(tareaId: string): TareaDelegada | undefined {
  return colaTrabajos.get(tareaId);
}

/** Lista todas las tareas delegadas. */
export function listarTareas(): TareaDelegada[] {
  return Array.from(colaTrabajos.values()).sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
}

/**
 * Ejecuta una tarea delegada. Si requiere autorización y no está autorizada,
 * la deja en espera. Ejecuta la herramienta real del agente y registra el
 * resultado.
 */
export async function ejecutarTareaDelegada(tareaId: string): Promise<TareaDelegada> {
  const tarea = colaTrabajos.get(tareaId);
  if (!tarea) throw new Error(`Tarea no encontrada: ${tareaId}`);

  // Verificar dependencias.
  for (const depId of tarea.dependencias) {
    const dep = colaTrabajos.get(depId);
    if (!dep || dep.estado !== 'completada') {
      tarea.estado = 'pendiente';
      return tarea;
    }
  }

  // Si requiere autorización y no está autorizada, esperar.
  if (tarea.requiereAutorizacion && !tarea.autorizada) {
    tarea.estado = 'espera_autorizacion';
    return tarea;
  }

  tarea.estado = 'en_progreso';
  tarea.iniciadaEn = new Date().toISOString();

  await esperarConcurrencia();
  try {
    const resultado = await ejecutarAgente(tarea.agenteId, {
      ...tarea.entrada,
      objetivo: tarea.objetivo,
    }, undefined, tarea.id, tarea.requiereAutorizacion);

    tarea.estado = resultado.estado === 'error' ? 'fallida' : 'completada';
    tarea.resultado = resultado;
    tarea.error = resultado.estado === 'error' ? resultado.respuesta : undefined;
    tarea.completadaEn = new Date().toISOString();
    tarea.duracionMs = resultado.duracionMs;
  } catch (error: any) {
    tarea.estado = 'fallida';
    tarea.error = error instanceof Error ? error.message : String(error);
    tarea.completadaEn = new Date().toISOString();
  } finally {
    ejecucionesActivas -= 1;
  }

  return tarea;
}

/**
 * Ejecuta todas las tareas pendientes cuyas dependencias estén cumplidas,
 * respetando la concurrencia máxima y la autorización.
 */
export async function ejecutarCola(): Promise<TareaDelegada[]> {
  const resultados: TareaDelegada[] = [];
  const pendientes = listarTareas().filter((t) => t.estado === 'pendiente' || t.estado === 'espera_autorizacion');

  for (const tarea of pendientes) {
    if (tarea.estado === 'espera_autorizacion') continue;
    const r = await ejecutarTareaDelegada(tarea.id);
    resultados.push(r);
  }
  return resultados;
}

/**
 * Colabora: divide un objetivo entre varios agentes, ejecuta sus tareas y
 * integra las conclusiones con el LLM real.
 *
 * @param objetivo Objetivo general del propietario.
 * @param asignaciones Array de { agenteId, entrada, requiereAutorizacion, dependencias }.
 * @param conversacion ID de conversación para memoria compartida.
 * @param trabajoId ID de trabajo para trazabilidad.
 */
export async function colaborar(params: {
  objetivo: string;
  asignaciones: Array<{
    agenteId: string;
    entrada: Record<string, unknown>;
    requiereAutorizacion?: boolean;
    dependencias?: string[];
  }>;
  conversacion?: string;
  trabajoId?: string;
}): Promise<ResultadoColaboracion> {
  const { objetivo, asignaciones, conversacion, trabajoId } = params;
  const inicio = Date.now();

  if (!objetivo || !objetivo.trim()) {
    throw new Error('El objetivo de colaboración no puede estar vacío.');
  }
  if (!asignaciones || asignaciones.length === 0) {
    throw new Error('Se requiere al menos una asignación de agente.');
  }

  // Validar que todos los agentes existan.
  for (const a of asignaciones) {
    if (!existeAgente(a.agenteId)) {
      throw new Error(`Agente no encontrado en la colaboración: ${a.agenteId}`);
    }
  }

  // Delegar todas las tareas.
  const tareas: TareaDelegada[] = [];
  for (const asig of asignaciones) {
    const tarea = await delegarTarea({
      agenteId: asig.agenteId,
      objetivo,
      entrada: asig.entrada,
      conversacion,
      trabajoId,
      requiereAutorizacion: asig.requiereAutorizacion,
      dependencias: asig.dependencias,
    });
    tareas.push(tarea);
  }

  // Ejecutar tareas que no requieran autorización (las que sí quedan en espera).
  await ejecutarCola();

  // Recopilar resultados.
  const agentesParticipantes: string[] = [];
  const proveedoresUsados: Array<{ agente: string; proveedor: string; modelo: string }> = [];
  const resultadosAgentes: Array<{ agente: string; nombre: string; estado: string; respuesta: string; limitaciones: string[] }> = [];

  let todasCompletadas = true;
  let algunaFallida = false;

  for (const tarea of tareas) {
    const agente = obtenerAgente(tarea.agenteId, conversacion);
    if (agente) {
      agentesParticipantes.push(tarea.agenteId);
    }

    if (tarea.resultado) {
      proveedoresUsados.push({
        agente: tarea.agenteId,
        proveedor: tarea.resultado.proveedor ?? 'desconocido',
        modelo: tarea.resultado.modelo ?? 'desconocido',
      });
      resultadosAgentes.push({
        agente: tarea.agenteId,
        nombre: agente?.nombre ?? tarea.agenteId,
        estado: tarea.resultado.estado,
        respuesta: tarea.resultado.respuesta,
        limitaciones: tarea.resultado.limitaciones,
      });
    }

    if (tarea.estado === 'espera_autorizacion') {
      todasCompletadas = false;
    } else if (tarea.estado === 'fallida' || tarea.estado === 'rechazada') {
      algunaFallida = true;
      todasCompletadas = false;
    } else if (tarea.estado !== 'completada') {
      todasCompletadas = false;
    }
  }

  // Integrar conclusiones con el LLM real.
  const datosIntegracion = JSON.stringify({
    objetivo,
    resultados: resultadosAgentes.map((r) => ({
      agente: r.agente,
      nombre: r.nombre,
      estado: r.estado,
      respuesta: r.respuesta,
      limitaciones: r.limitaciones,
    })),
  }, null, 2);

  let conclusionesIntegradas = '';
  try {
    const integracion = await inferir(
      [
        { rol: 'system', contenido: 'Eres el Director IA de Treidilor. Has recibido los resultados de varios agentes especializados que han trabajado en un objetivo común. Integra sus conclusiones en una respuesta coherente en español, explicando qué hizo cada agente, qué se logró, qué limitaciones hubo y qué se recomienda como próximo paso. No inventes datos. Si algo no consta, dilo explícitamente.' },
        { rol: 'user', contenido: `Objetivo del propietario: ${objetivo}\n\nResultados de los agentes:\n${datosIntegracion}\n\nIntegra las conclusiones.` },
      ],
      { agente: 'director-00', trabajoId: trabajoId ?? `colab-${Date.now()}`, usarHerramientas: false }
    );
    conclusionesIntegradas = integracion.texto;
  } catch (error: any) {
    conclusionesIntegradas = `No se pudieron integrar las conclusiones automáticamente: ${error instanceof Error ? error.message : String(error)}. Los resultados individuales están disponibles en cada tarea.`;
  }

  const estado: 'completada' | 'parcial' | 'fallida' = algunaFallida
    ? 'fallida'
    : !todasCompletadas
      ? 'parcial'
      : 'completada';

  return {
    objetivo,
    trabajoId: trabajoId ?? `colab-${Date.now()}`,
    tareas,
    conclusionesIntegradas,
    agentesParticipantes,
    estado,
    proveedoresUsados,
    duracionTotalMs: Date.now() - inicio,
  };
}

/** Estado del orquestador para el panel del Director. */
export function estadoOrquestador(): {
  totalAgentes: number;
  tareasTotales: number;
  tareasPorEstado: Record<EstadoTarea, number>;
  ejecucionesActivas: number;
} {
  const tareas = listarTareas();
  const porEstado: Record<EstadoTarea, number> = {
    pendiente: 0,
    en_progreso: 0,
    completada: 0,
    fallida: 0,
    rechazada: 0,
    espera_autorizacion: 0,
  };
  for (const t of tareas) porEstado[t.estado] += 1;

  return {
    totalAgentes: totalAgentes(),
    tareasTotales: tareas.length,
    tareasPorEstado: porEstado,
    ejecucionesActivas,
  };
}

/** Lista capacidades de todos los agentes (para el panel del Director). */
export function capacidadesAgentes(conversacion?: string): CapacidadAgente[] {
  return listarAgentes(conversacion);
}
