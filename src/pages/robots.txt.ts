/**
 * TREIDILOR — /robots.txt (antes no existía: 404). Permite indexar el sitio público, excluye el panel, la API, las salidas a tienda y las
 * páginas personales, y declara el mapa del sitio.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? 'https://treidilor.com/').replace(/\/$/, '');
  const cuerpo = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /upayp1b4',
    'Disallow: /api/',
    'Disallow: /checkout/',
    'Disallow: /out/',
    'Disallow: /share/',
    'Disallow: /perfil',
    'Disallow: /mi-radar',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(cuerpo, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
