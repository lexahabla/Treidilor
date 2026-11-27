/**
 * TREIDILOR — /sitemap.xml (antes no existía: 404). Páginas públicas indexables y una entrada por ficha del catálogo público, con su URL
 * canónica (/producto/<clave>) y la fecha de última actualización conocida. Se genera en cada petición desde el catálogo (no se fija en código).
 */
import type { APIRoute } from 'astro';
import { getCatalogProducts, productKey } from '../lib/catalog';

export const prerender = false;

const PAGINAS = ['/', '/catalogo', '/categorias', '/metodologia', '/herramientas/comparador', '/alertas-precio'];
const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const fecha = (v: unknown): string | null => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? 'https://treidilor.com/').replace(/\/$/, '');
  const urls: string[] = PAGINAS.map((p) => `  <url><loc>${escapar(base + p)}</loc></url>`);
  const vistos = new Set<string>();
  for (const p of getCatalogProducts()) {
    const clave = productKey(p); if (!clave || vistos.has(clave)) continue; vistos.add(clave);
    const any = p as unknown as Record<string, unknown>;
    const mod = fecha(any.updatedAt ?? any.lastPriceSync ?? any.createdAt);
    urls.push(`  <url><loc>${escapar(`${base}/producto/${encodeURIComponent(clave)}`)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
