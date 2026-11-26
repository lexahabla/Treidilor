/**
 * TREIDILOR — REGISTRO DE AGENTES (01-13).
 *
 * Instancia y expone todos los agentes especializados. El Director 00 y el
 * orquestador usan este registro para delegar tareas y obtener capacidades.
 */

import { AgenteBase, type ConfigAgente } from './agente-base';
import { Agente01Investigador, CFG_01 } from './agente-01-investigador';
import { Agente02Afiliacion, CFG_02 } from './agente-02-afiliacion';
import { Agente03Importador, CFG_03 } from './agente-03-importador';
import { Agente04Calidad, CFG_04 } from './agente-04-calidad';
import { Agente05Precios, CFG_05 } from './agente-05-precios';
import { Agente06Categorias, CFG_06 } from './agente-06-categorias';
import { Agente07Marketing, CFG_07 } from './agente-07-marketing';
import { Agente08Contenido, CFG_08 } from './agente-08-contenido';
import { Agente09Competencia, CFG_09 } from './agente-09-competencia';
import { Agente10Analitica, CFG_10 } from './agente-10-analitica';
import { Agente11WebsNicho, CFG_11 } from './agente-11-webs-nicho';
import { Agente12Auditor, CFG_12 } from './agente-12-auditor';
import { Agente13Asistente, CFG_13 } from './agente-13-asistente';

export interface CapacidadAgente {
  id: string;
  nombre: string;
  mision: string;
  especialidad: string;
  riesgo: 'bajo' | 'medio' | 'alto';
  permiteEfectos: boolean;
  herramientas: Array<{ nombre: string; descripcion: string; soloLectura: boolean }>;
  permisos: string[];
}

type AgenteConstructor = new (conversacion?: string) => AgenteBase;

const CFGS: Record<string, ConfigAgente> = {
  '01': CFG_01 as ConfigAgente,
  '02': CFG_02 as ConfigAgente,
  '03': CFG_03 as ConfigAgente,
  '04': CFG_04 as ConfigAgente,
  '05': CFG_05 as ConfigAgente,
  '06': CFG_06 as ConfigAgente,
  '07': CFG_07 as ConfigAgente,
  '08': CFG_08 as ConfigAgente,
  '09': CFG_09 as ConfigAgente,
  '10': CFG_10 as ConfigAgente,
  '11': CFG_11 as ConfigAgente,
  '12': CFG_12 as ConfigAgente,
  '13': CFG_13 as ConfigAgente,
} as Record<string, ConfigAgente>;

const CLASES: Record<string, AgenteConstructor> = {
  '01': Agente01Investigador,
  '02': Agente02Afiliacion,
  '03': Agente03Importador,
  '04': Agente04Calidad,
  '05': Agente05Precios,
  '06': Agente06Categorias,
  '07': Agente07Marketing,
  '08': Agente08Contenido,
  '09': Agente09Competencia,
  '10': Agente10Analitica,
  '11': Agente11WebsNicho,
  '12': Agente12Auditor,
  '13': Agente13Asistente,
};

/** Instancias únicas de agentes (singleton por conversación). */
const instancias = new Map<string, AgenteBase>();

function obtenerInstancia(id: string, conversacion?: string): AgenteBase {
  const Clase = CLASES[id];
  const cfg = CFGS[id];
  if (!Clase || !cfg) throw new Error(`Agente no encontrado: ${id}`);
  const clave = `${id}::${conversacion ?? 'default'}`;
  let inst = instancias.get(clave);
  if (!inst) {
    inst = new Clase(conversacion);
    instancias.set(clave, inst);
  }
  return inst;
}

/** Devuelve todos los agentes disponibles con sus capacidades. */
export function listarAgentes(conversacion?: string): CapacidadAgente[] {
  return Object.keys(CLASES).map((id) => {
    const cfg = CFGS[id];
    return {
      id: cfg.id,
      nombre: cfg.nombre,
      mision: cfg.mision,
      especialidad: cfg.especialidad,
      riesgo: cfg.riesgo,
      permiteEfectos: cfg.permiteEfectos,
      herramientas: cfg.herramientas.map((h) => ({
        nombre: h.nombre,
        descripcion: h.descripcion,
        soloLectura: h.soloLectura,
      })),
      permisos: cfg.permisos,
    };
  });
}

/** Busca un agente por ID. */
export function obtenerAgente(id: string, conversacion?: string): AgenteBase | null {
  if (!(id in CLASES)) return null;
  return obtenerInstancia(id, conversacion);
}

/** Ejecuta una tarea en un agente específico. */
export async function ejecutarAgente(
  id: string,
  entrada: Record<string, unknown>,
  conversacion?: string,
  trabajoId?: string,
  requiereAutorizacion = false
): Promise<ReturnType<AgenteBase['run']>> {
  const agente = obtenerAgente(id, conversacion);
  if (!agente) {
    throw new Error(`Agente no encontrado: ${id}`);
  }
  return agente.run({
    conversacion,
    trabajoId,
    entrada,
    requiereAutorizacion,
  });
}

/** Verifica si un agente existe. */
export function existeAgente(id: string): boolean {
  return id in CLASES;
}

/** Total de agentes registrados. */
export function totalAgentes(): number {
  return Object.keys(CLASES).length;
}
