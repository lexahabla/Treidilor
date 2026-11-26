/**
 * ==============================================================================
 * TREIDILOR - API ADMIN: EJECUCIÓN CONTROLADA DE REPARACIONES DEL CATÁLOGO
 * ==============================================================================
 * POST /api/admin/catalog/repair
 *
 * Ejecuta una reparación autorizada del catálogo, reutilizando el sistema de
 * propuestas existente (automationProposals.ts + automationApply.ts), el motor
 * de reparación (catalogRepair.ts) y el contador persistente (repairCounter.ts).
 * La escritura del catálogo pasa por updateCatalog() (lectura → validación →
 * escritura coordinada). No acepta parches arbitrarios enviados por el cliente:
 * el parche se recalcula siempre desde el estado actual del producto y la
 * procedencia se revalida antes de escribir.
 *
 * La aplicación de una propuesta es REAL: primero se escribe al catálogo
 * dentro de updateCatalog(), y luego se registra como aplicación real
 * (mode: 'real', wroteData: true) en el almacén de propuestas. Si la escritura
 * al catálogo falla, no se registra nada. Si el registro de la aplicación
 * falla después de escribir al catálogo, se bloquea y la propuesta queda
 * marcada para recuperación manual.
 *
 * Policía: desactivada por defecto (CATALOG_REPAIR_ENABLED=true).
 *
 * Acciones (body):
 *   { "action": "list" }                              -> lista propuestas
 *   { "action": "create", "productId": "...", "kind": "..." } -> crea una propuesta pendiente
 *   { "action": "decide", "id": "...", "decision": "aprobada"|"rechazada", "note": "..." } -> decide (humano)
 *   { "action": "preview", "id": "..." }              -> previsualiza la aplicación (solo lectura)
 *   { "action": "apply", "id": "...", "previewToken": "...", "confirm": true } -> aplica y registra como real
 *   { "action": "reconciliar", "id": "...", "previewToken": "..." } -> recupera una aplicación cuya escritura al catálogo
 *                                           se completó pero el registro en el almacén falló.
 *
 * Autenticación: sesión de admin O Bearer TRADYLOR_API_TOKEN.
 */

import type { APIRoute } from 'astro';
import { getSessionUser, requireAdminAuth } from '../../../../lib/adminAuth';
import { isValidApiToken, unauthorizedApiResponse } from '../../../../lib/apiAuth';
import { readProductsFromFile, updateCatalog, type Product } from '../../../../lib/productStore';
import { planRepairs, type RepairPlan, recoverVendorName, type RepairItem } from '../../../../lib/catalogRepair';
import { reserveAndRecord, canPerformRepair } from '../../../../lib/repairCounter';
import { sameOrigin } from '../../../../lib/alertsHttp';
import type { RepairKind } from '../../../../lib/catalogRepair';
import {
  createProposal,
  decideProposal,
  getProposalAdmin,
  listProposalsAdmin,
  readProposalRaw,
  saveApplication,
  type Proposal,
  type ProposalType,
} from '../../../../lib/automationProposals';
import { previewProposal, applyProposal, type Actor } from '../../../../lib/automationApply';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function authorized(request: Request): boolean {
  return !(requireAdminAuth(request) && !isValidApiToken(request));
}

function isRepairEnabled(): boolean {
  return process.env.CATALOG_REPAIR_ENABLED === 'true';
}

/**
 * Comprobar que un parche solo toca campos autorizados para reparación.
 * Actualmente solo se permite `merchant`. Cualquier otro campo se rechaza.
 */
function patchIsAuthorized(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'merchant';
}

/** Persona con sesión en el panel (cookie). El token de API NO es una persona. */
function humanActor(request: Request): Actor | null {
  const user = getSessionUser(request);
  return user ? { id: user.id, name: user.name || user.id, master: Boolean(user.master) } : null;
}

/**
 * Actor de la petición. Con sesión de cookie es la persona; con el token de API es un EJECUTOR
 * automático sin permiso master: puede listar, proponer, previsualizar y aplicar lo que una persona
 * ya aprobó, pero NUNCA decidir (aprobar o rechazar) en su lugar.
 */
function sessionActor(request: Request): Actor | null {
  const humano = humanActor(request);
  if (humano) return humano;
  if (isValidApiToken(request)) return { id: 'api', name: 'automatizacion', master: false };
  return null;
}

/** Tipo de reparación guardado en la propuesta (las anteriores a este campo solo podían ser de comercio). */
function repairKindOf(proposal: Proposal): RepairKind {
  const k = (proposal.payload as { tipoReparacion?: unknown }).tipoReparacion;
  return (typeof k === 'string' && k ? k : 'malformed-merchant') as RepairKind;
}

/** Extrae el cambio de campo de una propuesta almacenada.
 * Lee proposal.payload (productId, campo, antes, despues) y devuelve el
 * cambio normalizado para comparar con el estado actual del catálogo. */
function prevChangesFromProposal(proposal: Proposal): { campo: string; antes: unknown; despues: unknown } | null {
  const p = proposal.payload as { campo?: string; antes?: unknown; despues?: unknown };
  if (!p || !p.campo || p.antes === undefined || p.despues === undefined) return null;
  return { campo: p.campo, antes: p.antes, despues: p.despues };
}

export const POST: APIRoute = async ({ request }) => {
  // Autenticación.
  if (!authorized(request)) return unauthorizedApiResponse();
  // Con sesión de cookie, solo desde el propio sitio (CSRF). El token de API no lleva cookie.
  if (getSessionUser(request) && !sameOrigin(request)) {
    return json({ success: false, message: 'Origen de la petición no permitido.' }, 403);
  }

  // Policía desactivada por defecto.
  if (!isRepairEnabled()) {
    return json(
      { success: false, message: 'Reparaciones automáticas desactivadas. Define CATALOG_REPAIR_ENABLED=true para habilitarlas.' },
      403,
    );
  }

  let body: { action?: string; id?: string; productId?: string; kind?: string; decision?: string; note?: string; previewToken?: string; confirm?: boolean };
  try {
    body = (await request.json()) as { action?: string; id?: string; productId?: string; kind?: string; decision?: string; note?: string; previewToken?: string; confirm?: boolean };
  } catch {
    return json({ success: false, message: 'Cuerpo de la petición JSON inválido.' }, 400);
  }

  const { action, id, productId, kind, decision, note, previewToken, confirm } = body;

  // --------------------------------------------------------------------------
  // ACTION: list
  // --------------------------------------------------------------------------
  if (action === 'list' || !action) {
    const r = listProposalsAdmin({ state: undefined, agent: '04', limit: 100 });
    if (!r.ok) return json({ success: false, message: r.message }, r.status);
    return json({ success: true, proposals: r.proposals, counts: r.counts, enabled: true });
  }

  // --------------------------------------------------------------------------
  // ACTION: create
  // --------------------------------------------------------------------------
  if (action === 'create') {
    if (!productId || !kind) {
      return json({ success: false, message: 'Se requieren "productId" y "kind".' }, 400);
    }

    // Comprobar que el contador permite reparaciones ANTES de tocar el catálogo.
    if (!canPerformRepair()) {
      return json({ success: false, message: 'Contador no disponible: reparaciones bloqueadas.' }, 409);
    }

    const products = readProductsFromFile();
    const product = products.find((p) => p.id === productId);
    if (!product) {
      return json({ success: false, message: `Producto "${productId}" no encontrado.` }, 404);
    }

    // Recalcular el plan desde el estado actual (no confiamos en parches antiguos).
    const plan: RepairPlan = planRepairs([product]);
    const item = plan.items.find((i) => i.id === productId && i.kind === kind);
    if (!item) {
      return json(
        { success: false, message: `No hay defecto de tipo "${kind}" detectable en el producto "${productId}".` },
        409,
      );
    }

    // Solo permitir crear propuestas para campos autorizados.
    if (!patchIsAuthorized(item.patch)) {
      return json(
        { success: false, message: `El tipo "${kind}" no es reparable automáticamente (parche no autorizado).` },
        403,
      );
    }

    // Calcular el valor de reparación (vendedor original para malformed-merchant).
    let despues: unknown;
    if (kind === 'malformed-merchant') {
      despues = recoverVendorName(product);
      if (!despues) {
        return json(
          { success: false, message: 'No se pudo recuperar el nombre del vendedor original: no se puede reparar.' },
          409,
        );
      }
    } else {
      despues = item.patch.merchant;
    }

    const antes = product.merchant ?? null;

    // Identifica a quien propone SIN guardar credenciales (antes se guardaba el valor de la cookie de sesión).
    const humano = humanActor(request);
    const clientId = humano ? `usuario:${humano.id}`.slice(0, 80) : 'api';
    const idempotencyKey = `repair-${productId}-${kind}`;

    const raw = {
      agent: '04',
      type: 'correccion_catalogo' as ProposalType,
      title: `Reparar comercio de ${product.title}`,
      payload: { productId, campo: 'merchant', antes, despues, tipoReparacion: kind },
      evidence: [{ kind: 'texto', value: `Defecto detectado: comercio «${antes}». Vendedor original: ${despues}.` }],
      risk: 'bajo' as const,
      ttlDays: 14,
    };

    const created = createProposal(clientId, raw, { idempotencyKey }, new Date());
    if (!created.ok) {
      return json({ success: false, message: created.message, code: created.code }, created.status);
    }

    return json(
      { success: true, proposal: created.proposal, message: 'Propuesta creada. Usa acción "decide" (aprobada/rechazada) y luego "apply" para aplicarla.' },
      201,
    );
  }

  // --------------------------------------------------------------------------
  // ACTION: decide
  // --------------------------------------------------------------------------
  if (action === 'decide') {
    if (!id || !(decision === 'aprobada' || decision === 'rechazada')) {
      return json({ success: false, message: 'Se requieren "id" y "decision" (aprobada o rechazada).' }, 400);
    }

    // Aprobar o rechazar es una decisión HUMANA: el token de API no puede sustituirla.
    const actor = humanActor(request);
    if (!actor) return json({ success: false, code: 'decision_humana_requerida', message: 'Solo una persona con sesión en el panel puede aprobar o rechazar una reparación.' }, 403);

    const r = decideProposal(id, decision, actor, note, new Date());
    if (!r.ok) return json({ success: false, message: r.message, code: r.code }, r.status);

    return json({
      success: true,
      decided: r.decided,
      applied: false,
      notice: 'Decisión registrada. No se ha aplicado ningún cambio al catálogo.',
      proposal: r.proposal,
    }, 200);
  }

  // --------------------------------------------------------------------------
  // ACTION: preview
  // --------------------------------------------------------------------------
  if (action === 'preview') {
    if (!id) {
      return json({ success: false, message: 'Se requiere "id".' }, 400);
    }

    const actor = sessionActor(request);
    if (!actor) return json({ success: false, message: 'Sesión no válida.' }, 401);

    const p = previewProposal(id, actor);
    if (!p.ok) return json({ success: false, message: p.message, code: p.code }, p.status);

    return json({
      success: true,
      simulation: true,
      writes: false,
      executor: p.executor,
      changes: p.changes,
      inverse: p.inverse,
      warnings: p.warnings,
      previewToken: p.previewToken,
      appliableUntil: p.appliableUntil,
      alreadyApplied: p.alreadyApplied,
    }, 200);
  }

  // --------------------------------------------------------------------------
  // ACTION: apply
  // --------------------------------------------------------------------------
  if (action === 'apply') {
    if (!id) {
      return json({ success: false, message: 'Se requiere "id".' }, 400);
    }
    if (confirm !== true || typeof previewToken !== 'string') {
      return json({ success: false, message: 'Se requieren "previewToken" y "confirm: true".' }, 400);
    }

    const actor = sessionActor(request);
    if (!actor) return json({ success: false, message: 'Sesión no válida.' }, 401);

    // 1. Leer la propuesta raw para obtener el payload y verificar estado.
    const raw = readProposalRaw(id);
    if (!raw.ok) return json({ success: false, message: raw.message, code: raw.code }, raw.status);
    const proposal = raw.proposal;

    if (proposal.state !== 'aprobada') {
      return json({ success: false, message: 'La propuesta debe estar aprobada antes de aplicarla.' }, 409);
    }

    // 2. Idempotencia: si ya fue aplicada (real o simulada), no tocar nada ni
    //    consumir presupuesto nuevamente.
    if (proposal.application?.mode === 'en_curso') {
      return json({
        success: false,
        code: 'aplicacion_interrumpida',
        message: 'Hay una aplicación interrumpida de esta propuesta: usa la acción «reconciliar».',
      }, 409);
    }
    if (proposal.application) {
      return json({
        success: true,
        message: 'La propuesta ya fue aplicada previamente.',
        proposalId: id,
        status: 'aplicada',
        simulated: proposal.application.mode === 'simulada',
        wroteData: proposal.application.mode === 'real',
        idempotent: true,
        proposal: proposal,
      }, 200);
    }

    // 3. Previsualizar para validar que la propuesta está aprobada, dentro de
    //    ventana, tiene ejecutor autorizado y los datos no cambiaron.
    const prev = previewProposal(id, actor);
    if (!prev.ok) return json({ success: false, message: prev.message, code: prev.code }, prev.status);
    if (prev.previewToken !== previewToken) {
      return json({ success: false, message: 'El token de previsualización no coincide o está obsoleto. Vuelve a previsualizar.' }, 409);
    }

    const change = prev.changes[0];
    if (!change || change.campo !== 'merchant') {
      return json({ success: false, message: 'La propuesta no contiene un cambio de comerciante autorizado.' }, 409);
    }

    // 4. Reservar presupuesto en el contador ANTES de tocar el catálogo.
    //    Bloquea si el contador falta, está corrupto o no puede reservarse.
    const reserve = reserveAndRecord(repairKindOf(proposal));
    if (!reserve.ok) {
      return json({ success: false, message: reserve.reason ?? 'no_se_pudo_reservar_presupuesto' }, 409);
    }

    // 5. Registrar la intención de aplicar (modo 'en_curso') ANTES de escribir
    //    al catálogo. Si falla, no se toca el catálogo.
    const applicationIntento = {
      mode: 'en_curso' as const,
      executor: prev.executor.id,
      previewToken,
      targetKey: prev.changes[0]?.campo ? `correccion:${proposal.payload.productId}:${prev.changes[0].campo}` : `correccion:${proposal.payload.productId}:merchant`,
      at: new Date().toISOString(),
      by: { id: actor.id.slice(0, 80), name: actor.name.slice(0, 80) },
      changes: prev.changes,
      inverse: prev.inverse,
    };
    const savedIntento = saveApplication(id, applicationIntento, new Date(), { force: true });
    if (!savedIntento.ok) {
      return json({ success: false, message: savedIntento.message, code: savedIntento.code }, savedIntento.status);
    }

    // 6. Escribir el cambio REAL en el catálogo dentro de updateCatalog
    //    (lectura → revalidación → escritura coordinada).
    const { result, written } = updateCatalog<{ applied: boolean; product?: Product; error?: string }>((current) => {
      const product = current.find((p) => p.id === proposal.payload.productId);
      if (!product) return { changed: false, result: { applied: false, error: 'producto_no_encontrado' } };
      // Revalidar que el valor actual siga siendo el "antes" de la propuesta.
      if ((product.merchant ?? null) !== (change.antes ?? null)) {
        return { changed: false, result: { applied: false, error: 'datos_cambiaron: el comerciante actual ya no es el esperado.' } };
      }
      // No aplicar si el valor ya es el deseado.
      if (product.merchant === change.despues) {
        return { changed: false, result: { applied: false, error: 'sin_cambio: el comerciante ya tiene el valor propuesto.' } };
      }
      const next: Product = { ...product, merchant: change.despues as string };
      const index = current.findIndex((p) => p.id === proposal.payload.productId);
      current[index] = next;
      return { changed: true, result: { applied: true, product: next } };
    });

    if (!written) {
      // El catálogo no se modificó. La aplicación queda como 'en_curso' para
      // posible recuperación posterior.
      return json({ success: false, message: 'error_de_escritura_del_catalogo' }, 500);
    }
    if (!result.applied) {
      return json({ success: false, message: result.error, proposalId: id, status: 'bloqueada' }, 409);
    }

    // 7. Registrar la aplicación como REAL ahora que el catálogo está escrito.
    //    Usa force: true para sobrescribir el registro 'en_curso' previo.
    const applicationReal = {
      mode: 'real' as const,
      executor: prev.executor.id,
      previewToken,
      targetKey: prev.changes[0]?.campo ? `correccion:${proposal.payload.productId}:${prev.changes[0].campo}` : `correccion:${proposal.payload.productId}:merchant`,
      at: new Date().toISOString(),
      by: { id: actor.id.slice(0, 80), name: actor.name.slice(0, 80) },
      changes: prev.changes,
      inverse: prev.inverse,
    };
    const savedReal = saveApplication(id, applicationReal, new Date(), { force: true });
    if (!savedReal.ok) {
      // El catálogo YA se modificó pero el registro de aplicación falló.
      // No se puede hacer una segunda aplicación ciega: la propuesta queda
      // como 'en_curso' con el catálogo ya modificado. Se devuelve error para
      // que el operador sepa que hay que reconciliar manualmente.
      return json({
        success: false,
        message: 'Cambio aplicado al catálogo pero no se pudo registrar la aplicación.',
        proposalId: id,
        status: 'aplicada_sin_registro',
        simulated: false,
        wroteData: true,
        product: result.product,
        warning: 'registro_de_aplicacion_fallido',
      }, 500);
    }

    // 8. Leer el producto actualizado para devolverlo en la respuesta.
    const products = readProductsFromFile();
    const product = products.find((p) => p.id === proposal.payload.productId);
    if (!product) {
      return json({ success: false, message: 'producto_no_encontrado' }, 404);
    }

    return json({
      success: true,
      message: 'Reparación aplicada con éxito.',
      proposalId: id,
      status: 'aplicada',
      simulated: false,
      wroteData: true,
      product,
      proposal: savedReal.proposal,
    }, 200);
  }

  // --------------------------------------------------------------------------
  // ACTION: reconciliar
  // --------------------------------------------------------------------------
  // Recupera una reparación cuyo catálogo ya se modificó pero cuya aplicación
  // no quedó registrada (fallo de escritura en el almacén de propuestas).
  // Comprueba el estado actual del catálogo para decidir si completar el
  // registro como real o bloquear la operación.
  if (action === 'reconciliar') {
    if (!id) {
      return json({ success: false, message: 'Se requiere "id".' }, 400);
    }

    const actor = sessionActor(request);
    if (!actor) return json({ success: false, message: 'Sesión no válida.' }, 401);

    const raw = readProposalRaw(id);
    if (!raw.ok) return json({ success: false, message: raw.message, code: raw.code }, raw.status);
    const proposal = raw.proposal;

    if (proposal.state !== 'aprobada') {
      return json({ success: false, message: 'La propuesta debe estar aprobada antes de reconciliar.' }, 409);
    }
    // La propuesta puede estar en dos estados recuperables:
    // 1. application.mode === 'en_curso': se estaba aplicando y se interrumpió.
    // 2. application === null: el registro se perdió tras escribir el catálogo.
    if (proposal.application && proposal.application.mode !== 'en_curso' && proposal.application.mode !== 'real') {
      return json({
        success: false,
        message: 'La propuesta tiene una aplicación no recuperable (' + proposal.application.mode + ').',
      }, 409);
    }

    // 1. Leer el catálogo actual para ver si la modificación ya se aplicó.
    const products = readProductsFromFile();
    const product = products.find((p) => p.id === proposal.payload.productId);
    if (!product) {
      return json({ success: false, message: 'producto_no_encontrado' }, 404);
    }

    const change = prevChangesFromProposal(proposal);
    if (!change) {
      return json({
        success: false,
        message: 'La propuesta no tiene un cambio de comerciante registrado.',
      }, 409);
    }

    // 2. Comparar el estado actual del catálogo con el "antes" de la propuesta.
    const currentMerchant = product.merchant ?? null;
    const expectedBefore = change.antes ?? null;
    const expectedAfter = change.despues ?? null;

    // Determinar el previewToken a usar: de la aplicación existente o del cuerpo
    // de la petición (cuando la aplicación se perdió y application === null).
    const existingApp = proposal.application;
    const previewTokenFromBody = (body as any)?.previewToken;
    const previewTokenToUse = existingApp?.previewToken || previewTokenFromBody || null;
    if (!previewTokenToUse) {
      return json({
        success: false,
        message: 'No hay previewToken disponible; la aplicación se perdió y no hay token de referencia.',
      }, 409);
    }

    if (currentMerchant === expectedAfter) {
      // El catálogo YA tiene el valor deseado. Completar el registro como real
      // sin volver a escribir el catálogo.
      const applicationReal = {
        mode: 'real' as const,
        executor: actor.id,
        previewToken: previewTokenToUse,
        targetKey: `correccion:${proposal.payload.productId}:${change.campo}`,
        at: new Date().toISOString(),
        by: { id: actor.id.slice(0, 80), name: actor.name.slice(0, 80) },
        changes: [change],
        inverse: [{ campo: change.campo, antes: change.despues, despues: change.antes }],
      };
      const saved = saveApplication(id, applicationReal, new Date(), { force: true });
      if (!saved.ok) {
        return json({ success: false, message: saved.message, code: saved.code }, saved.status);
      }
      return json({
        success: true,
        message: 'Reparación ya aplicada en el catálogo; registro completado.',
        proposalId: id,
        status: 'aplicada',
        simulated: false,
        wroteData: false,
        product,
        proposal: saved.proposal,
      }, 200);
    }

    // 3. El catálogo aún tiene el valor "antes": la modificación no se aplicó.
    //    No se puede hacer una aplicación ciega; se bloquea para intervención.
    if (currentMerchant === expectedBefore) {
      return json({
        success: false,
        message: 'El catálogo aún tiene el valor original; la reparación no se aplicó.',
        proposalId: id,
        status: 'en_curso',
        simulated: false,
        wroteData: false,
        product,
      }, 409);
    }

    // 4. El valor actual no coincide ni con "antes" ni con "despues":
    //    otro proceso modificó el producto. Bloquear para intervención manual.
    return json({
      success: false,
      message: 'El producto fue modificado por otro proceso; imposible reconciliar de forma segura.',
      proposalId: id,
      status: 'bloqueada',
      simulated: false,
      wroteData: false,
      product,
    }, 409);
  }

  return json({ success: false, message: `Acción "${action}" no reconocida.` }, 400);
};

export const GET: APIRoute = async ({ request }) => {
  if (!authorized(request)) return unauthorizedApiResponse();
  if (!isRepairEnabled()) {
    return json({ success: false, message: 'Reparaciones automáticas desactivadas.' }, 403);
  }
  const r = listProposalsAdmin({ state: undefined, agent: '04', limit: 100 });
  if (!r.ok) return json({ success: false, message: r.message }, r.status);
  return json({ success: true, proposals: r.proposals, counts: r.counts, enabled: true });
};