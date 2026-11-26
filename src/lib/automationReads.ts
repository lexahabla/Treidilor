/**
 * Lectura ACOTADA de automatización para el Agente 10 (analítica). Solo proyecta datos que la web ya calcula (`getMesesAnalitica`):
 * no duplican servicios ni recorren eventos. Sin direcciones IP ni referentes en claro, sin datos de usuarios. Si la fuente no está disponible se dice (`available:false` + motivo);
 * nunca se fabrican resultados.
 */
import { getMesesAnalitica } from './analyticsMonths';

type Any = Record<string, any>;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const txt = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const numericOnly = (o: Any): Record<string, number> => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => [txt(k, 40), num(v)]));

export const ANALYTICS_LIMITS = Object.freeze({ maxMonths: 12, defaultMonths: 3, topProducts: 10, evolutionDays: 31 });

export function readAnalytics(months: number = ANALYTICS_LIMITS.defaultMonths): { available: boolean; reason?: string; months: Any[] } {
  try {
    const n = Math.min(Math.max(Math.trunc(months) || ANALYTICS_LIMITS.defaultMonths, 1), ANALYTICS_LIMITS.maxMonths);
    const all = getMesesAnalitica().meses ?? [];
    if (!all.length) return { available: false, reason: 'sin_datos_de_analitica', months: [] };
    const recent = [...all].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, n).reverse();
    return {
      available: true,
      months: recent.map((m) => ({
        month: txt(m.month, 7), label: txt(m.label, 40), metrics: numericOnly(m.metrics as Any),
        sources: (m.fuentes ?? []).slice(0, 8).map((f: Any) => ({ id: txt(f.id, 20), ...numericOnly(f) })),
        evolution: (m.evolucion ?? []).slice(-ANALYTICS_LIMITS.evolutionDays).map((p: Any) => ({ date: txt(p.fecha ?? p.date ?? p.dia, 10), ...numericOnly(p) })),
        topProducts: (m.topProductos ?? []).slice(0, ANALYTICS_LIMITS.topProducts).map((p: Any) => ({ productId: txt(p.productId, 80), title: txt(p.titulo, 120), views: num(p.visitas), outbound: num(p.salidas), purchases: num(p.compras), rate: num(p.tasa) })),
      })),
    };
  } catch {
    return { available: false, reason: 'analitica_no_disponible', months: [] };
  }
}
