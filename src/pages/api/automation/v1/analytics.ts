/** GET /api/automation/v1/analytics?months=1-12 — analítica agregada por mes para el Agente 10 (alcance `analytics:read`, interruptor `AUTOMATION_READ_V2_ENABLED`). Sin IP ni referentes. Solo GET. */
import type { APIRoute } from 'astro';
import { automationJson } from '../../../../lib/automationApi';
import { ANALYTICS_LIMITS, readAnalytics } from '../../../../lib/automationReads';
import { audited, gate, methodNotAllowed } from '../../../../lib/automationRoute';

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  const g = gate(request, 'analytics:read', 'readV2');
  if (!g.ok) return g.response;
  const sp = new URL(request.url).searchParams; const keys = [...sp.keys()];
  const raw = sp.get('months');
  const months = raw === null ? ANALYTICS_LIMITS.defaultMonths : /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (keys.some((k) => k !== 'months') || sp.getAll('months').length > 1 || !Number.isInteger(months) || months < 1 || months > ANALYTICS_LIMITS.maxMonths) {
    audited(g.base, 400, { reason: 'parametros' });
    return automationJson(400, { success: false, code: 'parametros_no_validos', message: `Solo «months» (1-${ANALYTICS_LIMITS.maxMonths}).` });
  }
  const r = readAnalytics(months);
  audited(g.base, 200, { items: r.months.length });
  return automationJson(200, { success: true, schema: 'automation-analytics/1', generatedAt: new Date().toISOString(), ...r });
};

export const ALL: APIRoute = ({ request }) => methodNotAllowed('readV2', 'GET');
