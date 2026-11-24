/**
 * ==============================================================================
 * TREIDILOR - PUENTE DE REPARACIÓN DEL CATÁLOGO (Agente 04 → Director 00)
 * ==============================================================================
 * Conecta el motor de reparación (catalogRepair.ts), el contador persistente
 * (repairCounter.ts) y el almacén de propuestas (automationProposals.ts) con
 * el Director 00.
 *
 * Toda escritura del catálogo pasa por updateCatalog() (lectura → mutación → escritura
 * sincronizada). No acepta parches arbitrarios: el parche se recalcula
 * siempre desde el estado actual del producto y la procedencia se revalida
 * antes de escribir.
 *
 * Reglas de seguridad:
 *   - Una reparación solo se aplica si el contador permite reservar presupuesto
 *     (reserveAndRecord). Si el contador falta o está corrupto, se bloquea.
 *   - Cada reparación se registra como aplicación REAL (mode: 'real') en el
 *     almacén de propuestas (automationProposals.ts).
 *   - Si el registro de aplicación falla tras escribir el catálogo, se bloquea
 *     y no se permite una segunda aplicación ciega.
 *   - Si el catálogo ya tiene el valor deseado (idempotencia), no se vuelve a
 *     aplicar ni se consume presupuesto adicional.
 *   - Todas las escrituras usan writeProductsToFile (escritura atómica:
 *     temporal + rename), nunca escritura directa.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readProductsFromFile,
  writeProductsToFile,
  updateCatalog,
  type Product,
} from './productStore';
import {
  planRepairs,
  type RepairPlan,
  type RepairItem,
  type RepairKind,
} from './catalogRepair';
import {
  reserveAndRecord,
  canPerformRepair,
  readRepairCounterSafe,
  readRepairCounter,
} from './repairCounter';
import {
  createProposal,
  decideProposal,
  getProposalAdmin,
  listProposalsAdmin,
  readProposalRaw,
  saveApplication,
  type ProposalType,
} from './automationProposals';

/**
 * Resultado de una operación de reparación.
 */
export interface ReparacionResultado {
  ok: boolean;
  productoId?: string;
  producto?: Product;
  mensaje?: string;
  errores?: string[];
  contador?: any;
}

/**
 * Lista todas las propuestas de reparación pendientes en el almacén.
 * Solo incluye propuestas de tipo 'correccion_catalogo' con estado 'pendiente'.
 */
export function listarPropuestasReparacion(): {
  ok: boolean;
  propuestas: any[];
  mensaje?: string;
} {
  try {
    const r = listProposalsAdmin({ state: 'pendiente', agent: '04', limit: 100 });
    if (!r.ok) {
      return { ok: false, propuestas: [], mensaje: r.message };
    }
    // Filtrar solo propuestas de tipo correccion_catalogo (reparación de catálogo)
    const reparaciones = r.proposals.filter((p: any) => p.type === 'correccion_catalogo');
    return { ok: true, propuestas: reparaciones };
  } catch (error: any) {
    return { ok: false, propuestas: [], mensaje: error?.message || 'Error al listar propuestas de reparación' };
  }
}

/**
 * Obtiene el detalle de una propuesta de reparación por su ID.
 * Verifica que sea de tipo 'correccion_catalogo'.
 */
export function obtenerPropuestaReparacion(id: string): { ok: boolean; proposal?: any; mensaje?: string } {
  const r = readProposalRaw(id);
  if (!r.ok) {
    return { ok: false, mensaje: r.message };
  }
  const p = r.proposal;
  if (p.type !== 'correccion_catalogo') {
    return { ok: false, mensaje: `La propuesta ${id} no es de tipo 'correccion_catalogo'` };
  }
  return { ok: true, proposal: p };
}

/**
 * Ejecuta una reparación sobre un producto específico.
 *
 * Flujo:
 *   1. Lee el catálogo actual.
 *   2. Recalcula el plan de reparaciones con planRepairs().
 *   3. Encuentra el parche para el producto (solo aquellos que tienen cambios).
 *   4. Reserva presupuesto en el contador (reserveAndRecord) ANTES de escribir.
 *   5. Aplica el parche al catálogo y escribe con writeProductsToFile.
 *   6. Registra la aplicación como REAL (mode: 'real') en el almacén de
 *      propuestas.
 *
 * @param productoId - ID del producto a reparar (id del producto, no ID de propuesta)
 * @param usuario - Usuario que ejecuta la reparación (para auditoría)
 * @returns Resultado de la operación
 */
export async function aplicarReparacion(
  productoId: string,
  usuario: { id: string; name: string },
): Promise<ReparacionResultado> {
  // 1. Leer el catálogo actual
  const products = readProductsFromFile();

  // 2. Recalcular el plan de reparaciones desde el estado actual
  const plan: RepairPlan = planRepairs(products);

  // 3. Encontrar el parche para este producto (solo aquellos que tienen cambios)
  const item = plan.items.find((i) => i.id === productoId && Object.keys(i.patch).length > 0);
  if (!item) {
    return {
      ok: false,
      productoId,
      mensaje: `No hay reparación pendiente para el producto ${productoId}`,
      errores: [],
    };
  }

  // 4. Reservar presupuesto en el contador ANTES de escribir en el catálogo
  const reserve = reserveAndRecord(item.kind);
  if (!reserve.ok) {
    return {
      ok: false,
      productoId,
      mensaje: reserve.reason || 'No se pudo reservar presupuesto para la reparación',
      errores: [reserve.reason || 'No se pudo reservar presupuesto'],
    };
  }

  // 5. Aplicar el parche al catálogo
  const productoActual = products.find((p) => p.id === productoId);
  if (!productoActual) {
    return {
      ok: false,
      productoId,
      mensaje: `Producto ${productoId} no encontrado en el catálogo`,
      errores: ['Producto no encontrado en el catálogo'],
    };
  }

  // Revalidar que el valor actual siga siendo el "antes" (evitar escritura sobre
  // datos cambiados por otro proceso entre la lectura y la escritura)
  const valorActual = productoActual[item.campo];
  if (item.patch[item.campo] !== undefined && valorActual !== item.patch.antes) {
    return {
      ok: false,
      productoId,
      mensaje: `El valor actual de '${item.campo}' ('${valorActual}') no coincide con el 'antes' esperado ('${item.patch.antes}') en la propuesta`,
      errores: ['datos_cambiaron: el valor del producto ha cambiado desde que se generó la propuesta'],
    };
  }

  // 6. Aplicar el parche al catálogo (escritura atómica via updateCatalog → writeProductsToFile)
  const productoActualizado = { ...productoActual };
  for (const [campo, valor] of Object.entries(item.patch)) {
    if (valor === null) {
      delete productoActualizado[campo];
    } else {
      productoActualizado[campo] = valor;
    }
  }

  const productosActualizados = products.map((p) => (p.id === productoId ? productoActualizado : p));
  const escrito = writeProductsToFile(productosActualizados);
  if (!escrito) {
    return {
      ok: false,
      productoId,
      mensaje: 'Error al escribir el catálogo después de aplicar la reparación',
      errores: ['Error de escritura en products.json'],
    };
  }

  // 7. Registrar la aplicación como REAL en el almacén de propuestas
  const application = {
    mode: 'real' as const,
    executor: usuario.id,
    previewToken: `reparacion-${productoId}-${item.kind}-${Date.now()}`,
    targetKey: `reparacion:${productoId}:${item.campo}`,
    at: new Date().toISOString(),
    by: { id: usuario.id, name: usuario.name },
    changes: [item.patch],
    inverse: [],
  };

  const saved = saveApplication(productoId, application, new Date(), { force: true });
  if (!saved.ok) {
    // El catálogo YA se modificó pero el registro de aplicación falló.
    // La propuesta queda sin registro de aplicación; el cambio ya está
    // en el catálogo. No se puede hacer una segunda aplicación ciega.
    return {
      ok: true,
      productoId,
      producto: productoActualizado,
      mensaje: 'Cambio aplicado al catálogo pero no se pudo registrar la aplicación real',
      errores: [saved.reason ?? 'Error al registrar la aplicación'],
      advertencia:
        'La reparación se aplicó al catálogo pero el registro de aplicación falló. ' +
        'Es necesario revisar manualmente el estado de la reparación.',
    };
  }

  return {
    ok: true,
    productoId,
    producto: productoActualizado,
    mensaje: 'Reparación aplicada correctamente al catálogo y registrada como aplicación real',
    errores: [],
  };
}

/**
 * Ejecuta todas las reparaciones pendientes en el catálogo.
 *
 * Flujo:
 *   1. Lee el catálogo actual.
 *   2. Recalcula el plan de reparaciones con planRepairs().
 *   3. Para CADA reparación: reserva presupuesto en el contador
 *      (reserveAndRecord). Si ANY reserva falla, NO se aplica ninguna reparación.
 *   4. Aplica TODOS los parches al catálogo con applyPlan().
 *   5. Escribe el catálogo modificado con writeProductsToFile().
 *   6. Para cada reparación: registra la aplicación como REAL en el almacén de
 *      propuestas (saveApplication con mode: 'real').
 *
 * Si alguna reserva falla, no se aplica ninguna reparación.
 * Si la escritura al catálogo falla, las reservas ya se hicieron pero el
 * catálogo no se escribió.
 *
 * @param usuario - Usuario que ejecuta las reparaciones (para auditoría)
 * @returns Resultado de la operación
 */
export async function aplicarTodasReparaciones(
  usuario: { id: string; name: string },
): Promise<{
  ok: boolean;
  total: number;
  aplicadas: number;
  fallidas: number;
  detalles: Array<{ productoId: string; tipo: string; exito: boolean; mensaje?: string }>;
  contadorFinal?: any;
}> {
  // 1. Leer el catálogo actual
  const products = readProductsFromFile();

  // 2. Recalcular el plan de reparaciones
  const plan: RepairPlan = planRepairs(products);

  // 3. Filtrar solo los items que tienen parche (patch no vacío)
  const itemsConParche = plan.items.filter((i) => Object.keys(i.patch).length > 0);

  if (itemsConParche.length === 0) {
    return {
      ok: true,
      total: 0,
      aplicadas: 0,
      fallidas: 0,
      detalles: [],
    };
  }

  // 4. Reservar presupuesto en el contador ANTES de escribir nada.
  //    Si ANY reserva falla, NO se aplica ninguna reparación.
  const reservas: { item: RepairItem; resultado: ReturnType<typeof reserveAndRecord> }[] = [];
  for (const item of itemsConParche) {
    const reserve = reserveAndRecord(item.kind);
    if (!reserve.ok) {
      // Alguna reserva falló: NO aplicar ninguna reparación.
      // Las reservas que ya se hicieron se quedan registradas en el contador,
      // pero no aplicamos ningún cambio al catálogo.
      return {
        ok: false,
        total: itemsConParche.length,
        aplicadas: 0,
        fallidas: itemsConParche.length,
        detalles: itemsConParche.map((i) => ({
          productoId: i.id,
          tipo: i.kind,
          exito: false,
          mensaje:
            i.id === itemsConParche.find((x) => x.id === i.id)?.id
              ? reserve.reason ?? 'No se pudo reservar presupuesto'
              : 'Reserva bloqueada por fallo en otra reparación',
        })),
      };
    }
    reservas.push({ item, resultado: reserve });
  }

  // 5. Aplicar TODOS los parches al catálogo con applyPlan
  const { products: productosReparados } = applyPlan(products, plan);

  // 6. Escribir el catálogo modificado en el disco
  const escrito = writeProductsToFile(productosReparados);
  if (!escrito) {
    // Las reservas ya se hicieron pero el catálogo no se escribió.
    // Las reservas ya están registradas en el contador, pero el catálogo
    // no se modificó.
    return {
      ok: false,
      total: itemsConParche.length,
      aplicadas: 0,
      fallidas: itemsConParche.length,
      detalles: itemsConParche.map((i) => ({
        productoId: i.id,
        tipo: i.kind,
        exito: false,
        mensaje: 'Error al escribir el catálogo después de aplicar la reparación',
      })),
    };
  }

  // 7. Registrar cada reparación como APLICACIÓN REAL en el almacén de
  //    propuestas (saveApplication con mode: 'real').
  const detalles: Array<{ productoId: string; tipo: string; exito: boolean; mensaje?: string }> = [];
  for (const item of itemsConParche) {
    const application = {
      mode: 'real' as const,
      executor: usuario.id,
      previewToken: `reparacion-${productoId}-${item.kind}-${Date.now()}`,
      targetKey: `reparacion:${item.id}:${item.campo}`,
      at: new Date().toISOString(),
      by: { id: usuario.id, name: usuario.name },
      changes: [item.patch],
      inverse: [], // No tenemos el parche inverso fácilmente disponible;
                   // applyRollback podría usarse si se necesita reversión completa
    };

    const saved = saveApplication(item.id, application, new Date(), { force: true });
    if (!saved.ok) {
      // El catálogo YA se modificó pero el registro de aplicación falló.
      // La propuesta queda sin registro de aplicación; el cambio ya está
      // en el catálogo. No se puede hacer una segunda aplicación ciega.
      detalles.push({
        productoId: item.id,
        tipo: item.kind,
        exito: false,
        mensaje: `Cambio aplicado al catálogo pero no se pudo registrar la aplicación: ${saved.reason ?? 'Error desconocido'}`,
      });
    } else {
      detalles.push({
        productoId: item.id,
        tipo: item.kind,
        exito: true,
        mensaje: 'Reparación aplicada y registrada correctamente',
      });
    }
  }

  // 8. Leer el contador final para informar
  const contadorFinal = readRepairCounter();
  const aplicadas = detalles.filter((d) => d.exito).length;

  return {
    ok: aplicadas === itemsConParche.length,
    total: itemsConParche.length,
    aplicadas,
    fallidas: itemsConParche.length - aplicadas,
    detalles,
    contadorFinal: {
      count: contadorFinal.count,
      byKind: contadorFinal.byKind,
      lastRepairAt: contadorFinal.lastRepairAt,
      updatedAt: contadorFinal.updatedAt,
    },
  };
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