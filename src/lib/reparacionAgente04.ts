/**
 * ==============================================================================
 * TREIDILOR - PUENTE DE LECTURA AGENTE 04 → DIRECTOR 00 (sólo lectura)
 * ==============================================================================
 * Conecta los datos existentes del Agente 04 (calidad del catálogo) con el
 * Director 00, EXCLUSIVAMENTE en modo lectura. No modifica products.json ni
 * ningún otro almacén de datos comercial.
 *
 * Datos que expone (todos de lectura):
 *   - Propuestas de reparación pendientes y aplicadas (automationProposals.ts)
 *   - Contador de reparaciones aplicadas (repairCounter.ts)
 *   - Estado consolidado del Agente 04 para consulta del Director
 *
 * No incluye funciones de escritura sobre el catálogo. Cualquier reparación
 * sobre products.json requiere una aprobación L4 y ejecución humana en el panel
 * (ver MATRIZ-PERMISOS.md y AGENTE-00-DIRECTOR-DISENO.md §8).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  listProposalsAdmin,
  readProposalRaw,
  type ProposalType,
} from './automationProposals';
import {
  readRepairCounterSafe,
  canPerformRepair,
  readRepairCounter,
} from './repairCounter';

const AGENTE_04 = '04';
const TIPO_REPARACION: ProposalType = 'correccion_catalogo';

/**
 * Estado consolidado del Agente 04 para que el Director 00 lo consulte.
 * Todo es de lectura: no toca ni modifica ningún dato comercial.
 */
export interface EstadoAgente04 {
  agente: string;
  modulo: 'calidad-catalogo';
  origen: 'almacen_local';
  contador: {
    disponible: boolean;
    totalAplicadas?: number;
    porTipo?: Record<string, number>;
    ultimoReparacion?: string;
    actualizadoEn?: string;
    mensaje?: string;
  };
  propuestas: {
    pendientes: Array<{
      id: string;
      titulo: string;
      estado: string;
      riesgo: string;
      creadoEn: string;
      expiraEn: string;
      tipo: string;
      productoId: string;
      campo: string;
      valorAntes?: unknown;
      valorDespues?: unknown;
    }>;
    totalPendientes: number;
    mensaje?: string;
  };
  lecturasDisponibles: {
    propuestasPendientes: boolean;
    contadorReparaciones: boolean;
    informeCalidadN8n: boolean; // solo true si hay acceso a la tabla de n8n
  };
}

/**
 * Resultado de una operación de lectura.
 */
export interface LecturaResultado {
  ok: boolean;
  datos?: EstadoAgente04;
  mensaje?: string;
  errores?: string[];
}

/**
 * Lista las propuestas de reparación del Agente 04 con estado 'pendiente'.
 * Sólo lectura: no modifica nada.
 */
export function listarPropuestasReparacion(): {
  ok: boolean;
  propuestas: any[];
  mensaje?: string;
} {
  try {
    const r = listProposalsAdmin({ state: 'pendiente', agent: AGENTE_04, limit: 100 });
    if (!r.ok) {
      return { ok: false, propuestas: [], mensaje: r.message };
    }
    const reparaciones = r.proposals.filter((p: any) => p.type === TIPO_REPARACION);
    return { ok: true, propuestas: reparaciones };
  } catch (error: any) {
    return {
      ok: false,
      propuestas: [],
      mensaje: error?.message || 'Error al listar propuestas de reparación',
    };
  }
}

/**
 * Obtiene el detalle de una propuesta de reparación por su ID.
 * Verifica que sea de tipo 'correccion_catalogo'.
 */
export function obtenerPropuestaReparacion(id: string): {
  ok: boolean;
  proposal?: any;
  mensaje?: string;
} {
  const r = readProposalRaw(id);
  if (!r.ok) {
    return { ok: false, mensaje: r.message };
  }
  const p = r.proposal;
  if (p.type !== TIPO_REPARACION) {
    return { ok: false, mensaje: `La propuesta ${id} no es de tipo 'correccion_catalogo'` };
  }
  return { ok: true, proposal: p };
}

/**
 * Obtiene el estado actual del contador de reparaciones.
 * Lanza si el contador no está disponible (ausente o corrupto).
 */
export function readReparacionCounter(): { ok: boolean; contador?: any; mensaje?: string } {
  try {
    const counter = readRepairCounter();
    return {
      ok: true,
      contador: {
        count: counter.count,
        byKind: counter.byKind,
        lastRepairAt: counter.lastRepairAt,
        updatedAt: counter.updatedAt,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      mensaje: error.message || 'Error al leer el contador de reparaciones',
    };
  }
}

/**
 * Verifica si se puede realizar al menos una reparación más
 * (contador válido). No modifica el estado.
 */
export function puedeRealizarReparacion(): boolean {
  return canPerformRepair();
}

/**
 * Devuelve el estado consolidado del Agente 04 para consulta del Director 00.
 * Todo es de lectura. No toca products.json ni modifica ningún dato comercial.
 *
 * Los informes de calidad del Agente 04 (informe-calidad/1) residen en la tabla
 * `calidad_catalogo_instantaneas` de n8n (entorno produccion). Desde este módulo
 * no se puede acceder a esa tabla (requiere D5: vía de lectura pendiente). El
 * campo `lecturasDisponibles.informeCalidadN8n` queda en false hasta que exista
 * esa vía.
 */
export function estadoAgente04(): LecturaResultado {
  try {
    // ── Contador de reparaciones ──
    let contadorDisponible = false;
    let contador: EstadoAgente04['contador'] = {
      disponible: false,
      mensaje: 'Contador no disponible',
    };
    try {
      const c = readRepairCounter();
      contadorDisponible = true;
      contador = {
        disponible: true,
        totalAplicadas: c.count,
        porTipo: c.byKind,
        ultimoReparacion: c.lastRepairAt,
        actualizadoEn: c.updatedAt,
      };
    } catch (e) {
      // El contador puede estar ausente o corrupto: no es error fatal, se reporta.
      contador = {
        disponible: false,
        mensaje: (e as Error).message || 'Contador no disponible',
      };
    }

    // ── Propuestas de reparación pendientes ──
    let propuestasPendientes: EstadoAgente04['propuestas']['pendientes'] = [];
    let propuestasMensaje: string | undefined;
    try {
      const r = listProposalsAdmin({ state: 'pendiente', agent: AGENTE_04, limit: 100 });
      if (!r.ok) {
        propuestasMensaje = r.message;
      } else {
        const reparaciones = r.proposals.filter((p: any) => p.type === TIPO_REPARACION);
        propuestasPendientes = reparaciones.map((p: any) => {
          const payload = p.payload || {};
          return {
            id: p.id,
            titulo: p.title || '(sin título)',
            estado: p.state,
            riesgo: p.risk,
            creadoEn: p.createdAt,
            expiraEn: p.expiresAt,
            tipo: p.type,
            productoId: payload.productoId || payload.id || '(no especificado)',
            campo: payload.campo || '(no especificado)',
            valorAntes: (payload.antes ?? payload.changes?.[0]?.antes),
            valorDespues: (payload.despues ?? payload.changes?.[0]?.despues),
          };
        });
      }
    } catch (e) {
      propuestasMensaje = (e as Error).message || 'Error al leer propuestas';
    }

    const estado: EstadoAgente04 = {
      agente: AGENTE_04,
      modulo: 'calidad-catalogo',
      origen: 'almacen_local',
      contador,
      propuestas: {
        pendientes: propuestasPendientes,
        totalPendientes: propuestasPendientes.length,
        mensaje: propuestasMensaje,
      },
      lecturasDisponibles: {
        propuestasPendientes: true,
        contadorReparaciones: contadorDisponible,
        informeCalidadN8n: false, // requiere acceso a la tabla de n8n (D5 pendiente)
      },
    };

    return { ok: true, datos: estado };
  } catch (error: any) {
    return {
      ok: false,
      mensaje: error?.message || 'Error al obtener el estado del Agente 04',
      errores: [error?.message || 'Error desconocido'],
    };
  }
}

/**
 * Comprueba si el módulo de lectura está operativo (contador válido y almacén
 * de propuestas legible). No modifica nada.
 */
export function puenteOperativo(): { ok: boolean; contador: boolean; propuestas: boolean; mensaje?: string } {
  const contadorOk = canPerformRepair();
  let propuestasOk = false;
  let mensaje: string | undefined;
  try {
    const r = listProposalsAdmin({ state: 'pendiente', agent: AGENTE_04, limit: 1 });
    propuestasOk = r.ok;
    if (!r.ok) mensaje = r.message;
  } catch (e: any) {
    mensaje = e?.message || 'Error al comprobar el almacén de propuestas';
  }
  return {
    ok: contadorOk && propuestasOk,
    contador: contadorOk,
    propuestas: propuestasOk,
    mensaje,
  };
}
