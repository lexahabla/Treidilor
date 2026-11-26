/**
 * GET /api/automation/v2/catalog?limit&page[&category][&network] — `automation-catalog/2`: lo mismo que el v1 + `history` por ficha (historial, observaciones, señal).
 * Alcance `catalog:read` (el mismo del v1), interruptor `AUTOMATION_READ_V2_ENABLED`. Solo GET. El v1 sigue intacto.
 */
import type { APIRoute } from 'astro';
import { getCatalogProducts } from '../../../../lib/catalog';
import { automationJson } from '../../../../lib/automationApi';
import { buildCatalogPageV2, CATALOG_V2_SCHEMA } from '../../../../lib/automationCatalogV2';
import { parseCatalogQuery } from '../../../../lib/automationCatalog';
import { audited, gate, methodNotAllowed } from '../../../../lib/automationRoute';

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  const g = gate(request, 'catalog:read', 'readV2');
  if (!g.ok) return g.response;
  const parsed = parseCatalogQuery(new URL(request.url).searchParams);
  if (!parsed.ok) { audited(g.base, 400, { reason: 'parametros' }); return automationJson(400, { success: false, code: 'parametros_no_validos', message: parsed.message }); }
  try {
    const page = buildCatalogPageV2(getCatalogProducts() as Array<Record<string, any>>, parsed.query);
    audited(g.base, 200, { items: page.products.length });
    return automationJson(200, { success: true, schema: CATALOG_V2_SCHEMA, compatibleWith: 'automation-catalog/1', generatedAt: new Date().toISOString(), ...page });
  } catch {
    audited(g.base, 500, { reason: 'error_interno' });
    return automationJson(500, { success: false, code: 'error_interno', message: 'No se pudo leer el catálogo.' });
  }
};

export const ALL: APIRoute = ({ request }) => methodNotAllowed('readV2', 'GET');
