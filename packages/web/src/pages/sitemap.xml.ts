import type { APIRoute } from 'astro';
import { createDefaultRegistry } from '@wyreup/core';

const SITE = 'https://wyreup.com';

const STATIC_PAGES = ['', '/tools', '/about'];

export const GET: APIRoute = () => {
  const registry = createDefaultRegistry();
  const toolSlugs = Array.from(registry.toolsById.keys());

  const urls = [
    ...STATIC_PAGES.map((path) => ({
      loc: `${SITE}${path}`,
      changefreq: 'weekly',
      priority: path === '' ? '1.0' : '0.8',
    })),
    ...toolSlugs.map((id) => ({
      loc: `${SITE}/tools/${id}`,
      changefreq: 'monthly',
      priority: '0.7',
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
