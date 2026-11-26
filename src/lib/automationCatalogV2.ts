/**
 * ==============================================================================
 * TREIDILOR — CATÁLOGO DE AUTOMATIZACIÓN v2 (`automation-catalog/2`), contrato ADITIVO sobre el v1
 * ==============================================================================
 * Cada ficha lleva EXACTAMENTE los campos de `automation-catalog/1` (mismos valores: se reutiliza `buildCatalogPage`, sin copiarlo) más el bloque `history`:
 * historial de precios, observaciones verificadas por contexto y señal de bajada vigente. Nada de esto se inventa: lo que no consta se entrega vacío con `available:false`.
 * El v1 NO se modifica (su lista de campos es un contrato cerrado que consume el Agente 04). Sin enlaces de afiliado, sin comisiones y sin identificadores de la fuente.
 * ==============================================================================
 */
import { buildCatalogPage } from './automationCatalog';

type Any = Record<string, any>;
export const CATALOG_V2_SCHEMA = 'automation-catalog/2';
export const LIMITS_V2 = Object.freeze({ historyPoints: 30, observations: 10 });

const iso = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const price = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
const text = (v: unknown, max: number): string | null => { const t = typeof v === 'string' ? v.trim() : ''; return t ? t.slice(0, max) : null; };

export interface HistoryPoint { date: string; price: number }
export interface ObservationV2 { capturedAt: string; verifiedAt: string | null; price: number; originalPrice: number | null; inStock: boolean | null; shippingCost: number | null; deliveryMinDays: number | null; deliveryMaxDays: number | null; currency: string | null; destination: string | null; contextKey: string; sourceType: string | null }
export interface SignalV2 { previousPrice: number; price: number; currency: string; detectedAt: string; expiresAt: string }
export interface HistoryBlock { available: boolean; priceHistory: HistoryPoint[]; observations: ObservationV2[]; priceSignal: SignalV2 | null }

export function historyOf(p: Any, now: Date = new Date()): HistoryBlock {
  const raw = Array.isArray(p?.priceHistory) ? p.priceHistory : [];
  const priceHistory = raw.map((x: Any) => ({ date: iso(x?.date), price: price(x?.price) })).filter((x: Any) => x.date && x.price !== null).sort((a: Any, b: Any) => (a.date < b.date ? -1 : 1)).slice(-LIMITS_V2.historyPoints) as HistoryPoint[];
  const obsRaw = Array.isArray(p?.extra?.observations) ? p.extra.observations : [];
  const observations = obsRaw.map((o: Any) => ({ capturedAt: iso(o?.capturedAt), verifiedAt: iso(o?.verifiedAt), price: price(o?.price), originalPrice: price(o?.originalPrice), inStock: typeof o?.inStock === 'boolean' ? o.inStock : null, shippingCost: typeof o?.shippingCost === 'number' && o.shippingCost >= 0 ? o.shippingCost : null, deliveryMinDays: Number.isInteger(o?.deliveryMinDays) ? o.deliveryMinDays : null, deliveryMaxDays: Number.isInteger(o?.deliveryMaxDays) ? o.deliveryMaxDays : null, currency: text(o?.context?.currency, 8), destination: text(o?.context?.destination, 8), contextKey: text(o?.contextKey, 160) ?? '', sourceType: text(o?.source?.type, 40) }))
    .filter((o: Any) => o.capturedAt && o.price !== null && o.contextKey).sort((a: Any, b: Any) => (a.capturedAt < b.capturedAt ? -1 : 1)).slice(-LIMITS_V2.observations) as ObservationV2[];
  const s = p?.extra?.priceSignal;
  const signal = s && iso(s.detectedAt) && iso(s.expiresAt) && Date.parse(s.expiresAt) > now.getTime() && price(s.price) !== null && price(s.previousPrice) !== null ? ({ previousPrice: price(s.previousPrice)!, price: price(s.price)!, currency: text(s.currency, 8) ?? 'EUR', detectedAt: s.detectedAt, expiresAt: s.expiresAt } as SignalV2) : null;
  return { available: priceHistory.length > 0 || observations.length > 0 || signal !== null, priceHistory, observations, priceSignal: signal };
}

export function buildCatalogPageV2(products: Any[], q: Parameters<typeof buildCatalogPage>[1], now: Date = new Date()) {
  const page = buildCatalogPage(products, q);
  const byId = new Map(products.filter((p) => p && typeof p.id === 'string').map((p) => [p.id, p]));
  return { ...page, products: page.products.map((item: Any) => ({ ...item, history: historyOf(byId.get(item.id) ?? {}, now) })) };
}
