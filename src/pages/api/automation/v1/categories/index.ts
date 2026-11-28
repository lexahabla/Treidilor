/**
 * TREIDILOR — API DE AUTOMATIZACIÓN v1: CATEGORÍAS (Director IA).
 *   GET  /api/automation/v1/categories   alcance `catalog:read`  → todas las categorías (también las vacías) con su recuento real.
 *   POST /api/automation/v1/categories   alcance `catalog:write` + `AUTOMATION_WRITE_ENABLED=true` → crea una categoría o subcategoría
 *        { nombre, padre?: idCategoriaRaiz, clave } — la misma función que el panel; idempotente por `clave`; si ya existe, no la duplica.
 * Ver `src/lib/automationCatalogWrite.ts`.
 */
import type { APIRoute } from 'astro';
import { authenticate, authFailureResponse, automationEnabled, automationJson, clientIpOf, disabledResponse } from '../../../../../lib/automationApi';
import { audited, gate, readJsonBody } from '../../../../../lib/automationRoute';
import { categoriasConRecuento, crearCategoriaAutomatizada } from '../../../../../lib/automationCatalogWrite';

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  if (!automationEnabled()) return disabledResponse();
  const auth = authenticate(request, 'catalog:read'); if (!auth.ok) return authFailureResponse(auth);
  const url = new URL(request.url); const base = { clientId: auth.client.id, scope: 'catalog:read', method: 'GET', path: url.pathname, query: '', ip: clientIpOf(request) };
  try { const categorias = categoriasConRecuento(); audited(base, 200, { items: categorias.length }); return automationJson(200, { success: true, schema: 'automation-categories/1', generatedAt: new Date().toISOString(), categorias }); }
  catch { audited(base, 500, { reason: 'error_interno' }); return automationJson(500, { success: false, code: 'error_interno', message: 'No se pudieron leer las categorías.' }); }
};

export const POST: APIRoute = async ({ request }) => {
  const g = gate(request, 'catalog:write', 'write'); if (!g.ok) return g.response;
  const body = await readJsonBody(request, 4 * 1024); if (!body.ok) { audited(g.base, 400, { reason: 'cuerpo' }); return body.response; }
  const v = body.value as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !['nombre', 'padre', 'clave'].includes(k))) { audited(g.base, 400, { reason: 'campos' }); return automationJson(400, { success: false, code: 'campos_no_permitidos', message: 'Solo nombre, padre y clave.' }); }
  const r = crearCategoriaAutomatizada(v, g.client.id);
  if (!r.ok) { audited(g.base, r.status, { reason: r.code }); return automationJson(r.status, { success: false, code: r.code, message: r.message }); }
  audited(g.base, r.status, { detail: `${r.existente ? 'existente' : 'creada'}:${r.categoria.id}${r.repetida ? ':repetida' : ''}` });
  return automationJson(r.status, { success: true, categoria: r.categoria, existente: r.existente, repetida: r.repetida });
};
