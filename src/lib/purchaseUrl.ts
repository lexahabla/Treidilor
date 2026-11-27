import type { Product } from '../data/products';
import { amazonCartToProductUrl, appendAmazonTag } from '../utils/amazon';

const FALLBACK_ASSOCIATE_TAG = 'tradylor-21';
const AMAZON_HOST_RE = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i;
const AMAZON_ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

function associateTag(): string {
  const fromEnv = process.env.AMAZON_ASSOCIATE_TAG ?? import.meta.env?.AMAZON_ASSOCIATE_TAG;
  return typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : FALLBACK_ASSOCIATE_TAG;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function extractAmazonAsin(url: URL): string | null {
  const fromQuery = url.searchParams.get('asin');
  if (fromQuery && /^[A-Z0-9]{10}$/i.test(fromQuery)) return fromQuery.toUpperCase();
  const match = AMAZON_ASIN_RE.exec(url.pathname);
  return match ? match[1].toUpperCase() : null;
}

/** Ficha del producto de Amazon con el tag de afiliado (https://<dominio>/dp/<ASIN>?tag=…). */
function amazonProductUrl(affiliateUrl: string): string | null {
  const url = parseHttpUrl(affiliateUrl);
  if (!url || !AMAZON_HOST_RE.test(url.hostname)) return null;

  const asin = extractAmazonAsin(url);
  if (!asin) return null;

  const tag = url.searchParams.get('tag')?.trim() || url.searchParams.get('AssociateTag')?.trim() || associateTag();
  const product = new URL(`https://${url.hostname}/dp/${asin}`);
  product.searchParams.set('tag', tag);
  return product.toString();
}

/**
 * Parámetros de eBay Partner Network (enlace de campaña) por dominio: rotación (mkrid) y sitio (siteid). Sin dominio conocido se usa solo la
 * campaña. Fuente: formato de enlace de EPN (mkcid=1 · mkrid · siteid · campid · toolid=10001 · mkevt=1).
 */
const EBAY_SITIOS: Record<string, { mkrid: string; siteid: string }> = {
  'ebay.es': { mkrid: '1185-53479-19255-0', siteid: '186' },
  'ebay.com': { mkrid: '711-53200-19255-0', siteid: '0' },
  'ebay.co.uk': { mkrid: '710-53481-19255-0', siteid: '3' },
  'ebay.de': { mkrid: '707-53477-19255-0', siteid: '77' },
  'ebay.fr': { mkrid: '709-53476-19255-0', siteid: '71' },
  'ebay.it': { mkrid: '724-53478-19255-0', siteid: '101' },
};
function ebayCampaign(): string {
  const v = process.env.EBAY_CAMPAIGN_ID ?? import.meta.env?.EBAY_CAMPAIGN_ID;
  return typeof v === 'string' && /^\d{6,12}$/.test(v.trim()) ? v.trim() : '';
}
/** Enlace de eBay con la campaña de afiliado (si hay campaña configurada y el enlace no la trae ya). Otros enlaces, sin cambios. */
export function withEbayCampaign(value: string): string {
  const url = parseHttpUrl(value); const campid = ebayCampaign();
  if (!url || !campid || !/(^|\.)ebay\.[a-z.]{2,6}$/i.test(url.hostname) || url.searchParams.has('campid')) return value;
  const sitio = EBAY_SITIOS[url.hostname.replace(/^www\./, '')];
  url.searchParams.set('mkcid', '1'); if (sitio) { url.searchParams.set('mkrid', sitio.mkrid); url.searchParams.set('siteid', sitio.siteid); }
  url.searchParams.set('campid', campid); url.searchParams.set('toolid', '10001'); url.searchParams.set('mkevt', '1');
  return url.toString();
}

/** ¿El enlace lleva seguimiento de afiliado reconocible? (Amazon tag, AliExpress s.click o aff_*, eBay campid, Awin). */
export function hasAffiliateTracking(value: string): boolean {
  const url = parseHttpUrl(value); if (!url) return false;
  const h = url.hostname.toLowerCase(); const q = url.searchParams;
  if (AMAZON_HOST_RE.test(h)) return q.has('tag') || q.has('AssociateTag');
  if (/(^|\.)s\.click\.aliexpress\.com$/.test(h)) return true;
  if (/aliexpress\./.test(h)) return ['aff_fcid', 'aff_trace_key', 'aff_platform', 'aff_short_key', 'sk'].some((k) => q.has(k));
  if (/(^|\.)ebay\./.test(h)) return q.has('campid');
  if (/(^|\.)awin1?\.com$/.test(h)) return true;
  return false;
}

export function buildPurchaseUrl(product: Pick<Product, 'affiliateUrl' | 'buyNowUrl'>): string {
  const affiliateUrl = (product.affiliateUrl ?? '').trim();
  const afiliado = affiliateUrl && parseHttpUrl(affiliateUrl) ? withEbayCampaign(amazonProductUrl(affiliateUrl) ?? affiliateUrl) : affiliateUrl;

  const override = product.buyNowUrl?.trim();
  if (override && parseHttpUrl(override)) {
    // Compra directa configurada en el admin: si es de Amazon y no trae el tag de afiliado, se añade (best effort). Un enlace de
    // CESTA de Amazon (fichas antiguas) se convierte en el de la ficha del producto. A eBay se le añade la campaña configurada.
    const directa = withEbayCampaign(appendAmazonTag(amazonCartToProductUrl(override)));
    // 27/11/2026: las 87 fichas de AliExpress tenían como compra directa la ficha normal del artículo (sin afiliado) y su enlace de afiliado
    // (s.click) quedaba sin usar: esas compras no podían generar comisión. Si la compra directa NO lleva seguimiento de afiliado y el
    // enlace de afiliado SÍ, se sale por el de afiliado (mismo producto).
    if (!hasAffiliateTracking(directa) && afiliado && hasAffiliateTracking(afiliado)) return afiliado;
    return directa;
  }

  if (!affiliateUrl) return '';
  return afiliado;
}
