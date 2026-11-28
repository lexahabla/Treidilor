/**
 * TREIDILOR — API DE AUTOMATIZACIÓN v1: ASIGNAR CATEGORÍAS (Director IA, alcance `catalog:write` + `AUTOMATION_WRITE_ENABLED=true`).
 * POST { asignaciones: [{ productId, categoryId, subcategoryId?, antes?: { category_id } }], clave } → { aplicadas, omitidas }
 * Atómico y optimista (una ficha que cambió desde que el Director la vio se omite), idempotente por `clave`, con registro de antes/después.
 */
import type { APIRoute } from 'astro';
import { automationJson } from '../../../../../lib/automationApi';
import { audited, gate, readJsonBody } from '../../../../../lib/automationRoute';
import { asignarCategoriasAutomatizado } from '../../../../../lib/automationCatalogWrite';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const g = gate(request, 'catalog:write', 'write'); if (!g.ok) return g.response;
  const body = await readJsonBody(request, 64 * 1024); if (!body.ok) { audited(g.base, 400, { reason: 'cuerpo' }); return body.response; }
  const v = body.value as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !['asignaciones', 'clave'].includes(k))) { audited(g.base, 400, { reason: 'campos' }); return automationJson(400, { success: false, code: 'campos_no_permitidos', message: 'Solo asignaciones y clave.' }); }
  const r = asignarCategoriasAutomatizado(v, g.client.id);
  if (!r.ok) { audited(g.base, r.status, { reason: r.code }); return automationJson(r.status, { success: false, code: r.code, message: r.message }); }
  audited(g.base, 200, { items: r.aplicadas.length, detail: `omitidas=${r.omitidas.length}${r.repetida ? ':repetida' : ''}` });
  return automationJson(200, { success: true, aplicadas: r.aplicadas, omitidas: r.omitidas, repetida: r.repetida });
};
