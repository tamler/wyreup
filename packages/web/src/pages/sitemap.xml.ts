import type { APIRoute } from 'astro';
import { createDefaultRegistry } from '@wyreup/core';
import { JOBS } from '../data/jobs';
import { canonicalPageUrl } from '../lib/seo';

const STATIC_PAGES = [
  '/',
  '/tools',
  '/about',
  '/mcp',
  '/cli',
  '/skill',
  '/triggers',
  '/pro',
  '/legal/privacy',
  '/legal/terms',
  '/legal/refund',
];

export const GET: APIRoute = () => {
  const registry = createDefaultRegistry();
  const toolSlugs = Array.from(registry.toolsById.keys());
  const categories = [
    ...new Set(
      Array.from(registry.toolsById.values()).flatMap((tool) => [
        tool.category,
        ...(tool.categories ?? []),
      ]),
    ),
  ].sort();

  const urls = [
    ...STATIC_PAGES.map((path) => ({
      loc: canonicalPageUrl(path),
      changefreq: 'weekly',
      priority: path === '/' ? '1.0' : '0.8',
    })),
    ...JOBS.map((job) => ({
      loc: canonicalPageUrl(`/${job.slug}`),
      changefreq: 'weekly',
      priority: '0.8',
    })),
    ...toolSlugs.map((id) => ({
      loc: canonicalPageUrl(`/tools/${id}`),
      changefreq: 'monthly',
      priority: '0.7',
    })),
    ...categories.map((category) => ({
      loc: canonicalPageUrl(`/category/${category}`),
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
