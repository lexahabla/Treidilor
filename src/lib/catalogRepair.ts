/**
 * ==============================================================================
 * TREIDILOR — REPARACIÓN DE DATOS ANTIGUOS (simulación + reversión, funciones puras)
 * ==============================================================================
 * Detecta registros afectados por los defectos corregidos en el código y
 * propone parches. NADA se escribe aquí: `planRepairs` sólo describe;
 * `applyPlan` devuelve una COPIA reparada y `buildRollback` el parche inverso.
 *
 * Defectos detectados:
 *  - brand-is-merchant   : la «marca» es el nombre de la tienda.
 *  - fabricated-rating   : valoración/opiniones inventadas por valores por
 *                          defecto antiguos (eBay 4,5★/15; alta manual 4,8★/100).
 *  - duplicate-offer     : varias filas con el mismo id externo (sólo se INFORMA:
 *                          fusionar duplicados requiere decisión humana).
 *  - brand-spec-mismatch : la marca de la cabecera difiere de la «Marca» de las
 *                          especificaciones (sólo se INFORMA).
 *  - malformed-merchant  : (C3) el comercio es EXACTAMENTE «[object Object]» (un objeto
 *                          guardado como texto por el importador antiguo de Amazon). Se
 *                          repara SOLO con procedencia Amazon demostrada y sin señales
 *                          contrarias, recuperando el nombre original del vendedor del
 *                          JSON crudo guardado (`extra.scraperApiSource.seller`); si no
 *                          hay nombre, o el campo está bloqueado, sólo se INFORMA.
 * ==============================================================================
 */

import { brandIsMerchant, normalizeBrand, normalizeSourceId } from './offerIdentity';
import { networkFromUrl } from './productNetwork';

type AnyRecord = Record<string, any>;

export type RepairKind = 'brand-is-merchant' | 'fabricated-rating' | 'duplicate-offer' | 'brand-spec-mismatch' | 'malformed-merchant';

export interface RepairItem {
  id: string;
  kind: RepairKind;
  /** Campos a cambiar (valor nuevo; `null` = eliminar). Vacío si sólo se informa. */
  patch: Record<string, unknown>;
  detail: string;
}

export interface RepairPlan {
  items: RepairItem[];
  summary: Record<RepairKind, number>;
}

const SPEC_BRAND_KEYS = ['marca', 'brand', 'fabricante', 'manufacturer'];

function specBrand(product: AnyRecord): string {
  const specs = (product.specs ?? {}) as AnyRecord;
  for (const [name, value] of Object.entries(specs)) {
    if (SPEC_BRAND_KEYS.includes(name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim())) {
      return String(value ?? '');
    }
  }
  return '';
}

/* ── C3: comercio «[object Object]» ────────────────────────────────────────────── */

/** Valor EXACTO del defecto (no se tocan variantes de mayúsculas ni con espacios). */
export const MALFORMED_MERCHANT_VALUE = '[object Object]';
const MALFORMED_TEXT = /\[object\s+object\]/i;

/**
 * Procedencia Amazon de una ficha: evidencia POSITIVA (red explícita, URL de Amazon o la marca `extra.importSource` del importador antiguo)
 * y NINGUNA señal contraria (red explícita distinta, URL de otra red, `crossMerchant.networks` con otra red). El ASIN solo no cuenta.
 */
export function amazonProvenance(product: AnyRecord): { ok: boolean; reason: string } {
  const extra = (product.extra && typeof product.extra === 'object' ? product.extra : {}) as AnyRecord;
  const network = String(product.network ?? '').trim().toLowerCase();
  const urlNetworks = [product.affiliateUrl, product.buyNowUrl].map((u) => networkFromUrl(u)).filter(Boolean);
  const cross = Array.isArray(extra.crossMerchant?.networks) ? extra.crossMerchant.networks.map((n: unknown) => String(n ?? '').trim().toLowerCase()).filter(Boolean) : [];
  const source = typeof extra.importSource === 'string' ? extra.importSource : '';

  const contrary: string[] = [];
  if (network && network !== 'amazon') contrary.push(`network=${network}`);
  for (const n of urlNetworks) if (n !== 'amazon') contrary.push(`URL de ${n}`);
  for (const n of cross) if (n !== 'amazon') contrary.push(`crossMerchant=${n}`);
  if (contrary.length) return { ok: false, reason: `señales contrarias (${[...new Set(contrary)].join(', ')})` };

  const positive: string[] = [];
  if (network === 'amazon') positive.push('network=amazon');
  if (urlNetworks.includes('amazon')) positive.push('URL de Amazon');
  if (/^scraperapi-amazon/.test(source)) positive.push(`importSource=${source}`);
  if (!positive.length) return { ok: false, reason: 'sin evidencia positiva de procedencia Amazon' };
  return { ok: true, reason: positive.join(', ') };
}

/** Nombre ORIGINAL del vendedor guardado en el JSON crudo del importador antiguo (`seller` como cadena o como objeto con `name`). null si no hay uno utilizable. */
export function recoverVendorName(product: AnyRecord): string | null {
  const raw = product.extra?.scraperApiSource;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const seller = (raw as AnyRecord).seller;
  const candidate =
    typeof seller === 'string' ? seller
    : seller && typeof seller === 'object' && !Array.isArray(seller) && typeof (seller as AnyRecord).name === 'string' ? (seller as AnyRecord).name
    : '';
  const name = String(candidate).replace(/\s+/g, ' ').trim();
  if (!name || name.length > 120 || MALFORMED_TEXT.test(name) || /[<>]/.test(name)) return null;
  return name;
}

export function planRepairs(products: AnyRecord[]): RepairPlan {
  const items: RepairItem[] = [];

  for (const product of products) {
    const id = String(product.id);
    const locked = new Set<string>(Array.isArray(product.extra?.lockedFields) ? product.extra.lockedFields : []);

    if (product.merchant === MALFORMED_MERCHANT_VALUE) {
      const label = `comercio «${MALFORMED_MERCHANT_VALUE}»`;
      if (locked.has('merchant') || product.extra?.fieldSources?.merchant === 'manual') {
        items.push({ id, kind: 'malformed-merchant', patch: {}, detail: `${label} bloqueado o editado a mano: solo informe` });
      } else {
        const provenance = amazonProvenance(product);
        const vendor = provenance.ok ? recoverVendorName(product) : null;
        if (!provenance.ok) items.push({ id, kind: 'malformed-merchant', patch: {}, detail: `${label} sin procedencia Amazon demostrable (${provenance.reason}): solo informe` });
        else if (!vendor) items.push({ id, kind: 'malformed-merchant', patch: {}, detail: `${label}: procedencia Amazon demostrada (${provenance.reason}) pero el JSON crudo no conserva el nombre del vendedor; no se inventa: solo informe` });
        else items.push({ id, kind: 'malformed-merchant', patch: { merchant: vendor }, detail: `${label} → «${vendor}» (nombre original del vendedor en el JSON crudo; procedencia Amazon: ${provenance.reason})` });
      }
    }

    if (product.brand && brandIsMerchant(product.brand, product.merchant) && !locked.has('brand')) {
      items.push({ id, kind: 'brand-is-merchant', patch: { brand: null }, detail: `marca «${product.brand}» = tienda «${product.merchant}»` });
    }

    const network = String(product.network ?? '').toLowerCase();
    const rating = Number(product.rating);
    const reviews = Number(product.reviewsCount);
    const ebayDefault = network === 'ebay' && rating === 4.5 && reviews === 15;
    const manualDefault = rating === 4.8 && reviews === 100 && !product.extra?.scraperApiSource && network !== 'amazon';
    if ((ebayDefault || manualDefault) && !locked.has('rating')) {
      items.push({
        id,
        kind: 'fabricated-rating',
        patch: { rating: null, reviewsCount: null },
        detail: `${rating}★ / ${reviews} opiniones coinciden con un valor por defecto antiguo`,
      });
    }

    const header = normalizeBrand(product.brand);
    const fromSpecs = normalizeBrand(specBrand(product));
    if (header.key && fromSpecs.key && header.key !== fromSpecs.key) {
      items.push({
        id,
        kind: 'brand-spec-mismatch',
        patch: {},
        detail: `cabecera «${product.brand}» ≠ especificaciones «${specBrand(product)}»`,
      });
    }
  }

  // Duplicados por id externo normalizado (misma red).
  const groups = new Map<string, string[]>();
  for (const product of products) {
    const sid = normalizeSourceId(product.sourceId || product.asin);
    if (!sid) continue;
    const key = `${String(product.network ?? '').toLowerCase()}:${sid}`;
    groups.set(key, [...(groups.get(key) ?? []), String(product.id)]);
  }
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    for (const id of ids) items.push({ id, kind: 'duplicate-offer', patch: {}, detail: `mismo anuncio ${key} en ${ids.join(', ')}` });
  }

  const summary: Record<RepairKind, number> = { 'brand-is-merchant': 0, 'fabricated-rating': 0, 'duplicate-offer': 0, 'brand-spec-mismatch': 0, 'malformed-merchant': 0 };
  for (const item of items) summary[item.kind]++;
  return { items, summary };
}

export interface RollbackEntry {
  id: string;
  /** Valor ANTERIOR de cada campo tocado (`__absent__` = no existía). */
  before: Record<string, unknown>;
}

export const ABSENT = '__absent__';

/** Devuelve una COPIA con los parches aplicados y el parche inverso. */
export function applyPlan(products: AnyRecord[], plan: RepairPlan): { products: AnyRecord[]; rollback: RollbackEntry[] } {
  const rollback = new Map<string, RollbackEntry>();
  const out = products.map((product) => {
    const patches = plan.items.filter((item) => item.id === String(product.id) && Object.keys(item.patch).length);
    if (!patches.length) return product;
    const next: AnyRecord = { ...product };
    const entry: RollbackEntry = { id: String(product.id), before: {} };
    for (const { patch } of patches) {
      for (const [field, value] of Object.entries(patch)) {
        if (!(field in entry.before)) entry.before[field] = field in product ? product[field] : ABSENT;
        if (value === null) delete next[field];
        else next[field] = value;
      }
    }
    rollback.set(entry.id, entry);
    return next;
  });
  return { products: out, rollback: [...rollback.values()] };
}

export function applyRollback(products: AnyRecord[], rollback: RollbackEntry[]): AnyRecord[] {
  const byId = new Map(rollback.map((entry) => [entry.id, entry]));
  return products.map((product) => {
    const entry = byId.get(String(product.id));
    if (!entry) return product;
    const next: AnyRecord = { ...product };
    for (const [field, before] of Object.entries(entry.before)) {
      if (before === ABSENT) delete next[field];
      else next[field] = before;
    }
    return next;
  });
}
