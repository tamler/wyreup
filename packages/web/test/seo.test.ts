import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { GET } from '../src/pages/sitemap.xml';
import { JOBS } from '../src/data/jobs';
import { canonicalPageUrl, isIndexablePath, TOOL_PAGE_METADATA } from '../src/lib/seo';

async function sitemapUrls(): Promise<string[]> {
  const response = await GET({} as Parameters<typeof GET>[0]);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

describe('search discovery', () => {
  it('uses a stable page identity across query and trailing-slash variants', () => {
    for (const path of ['', '/', '/?q=photo#results']) {
      expect(canonicalPageUrl(path)).toBe('https://wyreup.com/');
    }
    for (const path of ['/tools/compress', '/tools/compress/', '/tools/compress/?q=photo#about']) {
      expect(canonicalPageUrl(path)).toBe('https://wyreup.com/tools/compress/');
    }
    expect(canonicalPageUrl('https://preview.example/tools/compress?q=photo')).toBe(
      'https://wyreup.com/tools/compress/',
    );
  });

  it('excludes application workspaces without excluding public documents or similarly named tools', () => {
    for (const path of [
      '/account',
      '/admin/',
      '/settings?tab=models',
      '/share/',
      '/share-receive',
      '/toolbelt/',
      '/chain/build?steps=test',
      '/chain/run/',
      '/404',
      '/404.html',
    ]) {
      expect(isIndexablePath(path), path).toBe(false);
    }
    for (const path of [
      '/',
      '/tools/share',
      '/category/privacy/',
      '/triggers/',
      '/cli',
      '/mcp/',
      '/skill/',
      '/legal/privacy/',
      '/remove-photo-location-data/',
    ]) {
      expect(isIndexablePath(path), path).toBe(true);
    }
  });

  it('keeps curated local-tool metadata bound to real free tools', () => {
    const registry = createDefaultRegistry();
    for (const id of Object.keys(TOOL_PAGE_METADATA)) {
      const tool = registry.toolsById.get(id);
      expect(tool, id).toBeDefined();
      expect(tool?.cost, `${id} metadata must be reviewed when execution changes`).toBe('free');
    }
  });

  it('publishes only canonical production URLs without duplicates', async () => {
    const urls = await sitemapUrls();
    expect(new Set(urls).size).toBe(urls.length);
    for (const value of urls) {
      const url = new URL(value);
      expect(url.origin).toBe('https://wyreup.com');
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
      expect(url.pathname.endsWith('/'), value).toBe(true);
    }
  });

  it('covers all tools, tasks, categories and public documentation', async () => {
    const urls = new Set(await sitemapUrls());
    const registry = createDefaultRegistry();
    const tools = [...registry.toolsById.values()];
    const categories = new Set(
      tools.flatMap((tool) => [tool.category, ...(tool.categories ?? [])]),
    );
    const paths = [
      '/',
      '/tools/',
      '/about/',
      '/mcp/',
      '/cli/',
      '/skill/',
      '/triggers/',
      '/pro/',
      '/legal/privacy/',
      '/legal/terms/',
      '/legal/refund/',
      ...tools.map((tool) => `/tools/${tool.id}/`),
      ...JOBS.map((job) => `/${job.slug}/`),
      ...[...categories].map((category) => `/category/${category}/`),
    ];
    for (const path of paths) expect(urls.has(`https://wyreup.com${path}`), path).toBe(true);
    for (const path of [
      '/account/',
      '/admin/',
      '/settings/',
      '/share/',
      '/share-receive/',
      '/toolbelt/',
      '/chain/build/',
      '/chain/run/',
      '/404/',
    ]) {
      expect(urls.has(`https://wyreup.com${path}`), path).toBe(false);
    }
  });
});
