/**
 * TREIDILOR — API DE AUTOMATIZACIÓN v1: SUGERENCIAS PARA FICHAS SIN CATEGORÍA (Director IA, alcance `catalog:read`, solo lectura).
 * GET /api/automation/v1/categories/suggestions → { total, sugerencias: [{ productId, titulo, propuesta, alternativas, certeza: segura|dudosa|sin_propuesta }] }
 */
import type { APIRoute } from 'astro';
import { authenticate, authFailureResponse, automationEnabled, automationJson, clientIpOf, disabledResponse } from '../../../../../lib/automationApi';
import { audited } from '../../../../../lib/automationRoute';
import { sugerenciasSinCategoria } from '../../../../../lib/automationCatalogWrite';

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  if (!automationEnabled()) return disabledResponse();
  const auth = authenticate(request, 'catalog:read'); if (!auth.ok) return authFailureResponse(auth);
  const url = new URL(request.url); const base = { clientId: auth.client.id, scope: 'catalog:read', method: 'GET', path: url.pathname, query: '', ip: clientIpOf(request) };
  try { const r = sugerenciasSinCategoria(); audited(base, 200, { items: r.total }); return automationJson(200, { success: true, schema: 'automation-category-suggestions/1', generatedAt: new Date().toISOString(), ...r }); }
  catch { audited(base, 500, { reason: 'error_interno' }); return automationJson(500, { success: false, code: 'error_interno', message: 'No se pudieron calcular las sugerencias.' }); }
};
