import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { parseProductionRedirects, redirectLocation } from '../scripts/production-headers.mjs';
import { hostedInputPhrase, PRO_UPSELLS, upsellFor, upsellsFor } from '../src/data/pro-upsells';
import { TOOL_PAGE_METADATA } from '../src/lib/seo';
import { SEARCH_GUIDES } from '../src/lib/search-guides';
import { projectToolDiscoveryMetadata } from '../src/lib/tool-discovery-metadata';

const registry = createDefaultRegistry();
const PRO_PAGES = [
  'ocr-hq',
  'transcribe-pro',
  'text-translate-pro',
  'pdf-q-and-a',
  'pdf-scan-q-and-a-pro',
] as const;
const FREE_SIBLING: Record<(typeof PRO_PAGES)[number], string> = {
  'ocr-hq': 'ocr',
  'transcribe-pro': 'transcribe',
  'text-translate-pro': 'text-translate',
  'pdf-q-and-a': 'pdf-to-text',
  'pdf-scan-q-and-a-pro': 'pdf-to-text',
};

describe('/pricing route', () => {
  const redirects = parseProductionRedirects(
    readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8'),
  );

  it('sends /pricing and /pricing/ to the Pro pricing section permanently', () => {
    for (const from of ['/pricing', '/pricing/']) {
      expect(redirects.find((rule) => rule.from === from)).toEqual({
        from,
        to: '/pro/#pricing',
        status: 301,
      });
    }
  });

  it('keeps a request query ahead of the destination fragment', () => {
    expect(redirectLocation('/pro/#pricing', '?utm=1')).toBe('/pro/?utm=1#pricing');
    expect(redirectLocation('/pro/', '?utm=1')).toBe('/pro/?utm=1');
    expect(redirectLocation('/pro/#pricing', '')).toBe('/pro/#pricing');
  });

  it('accepts a fragment only in the destination', () => {
    expect(parseProductionRedirects('/a /b/#c-1 301')).toEqual([
      { from: '/a', to: '/b/#c-1', status: 301 },
    ]);
    expect(() => parseProductionRedirects('/a#x /b/ 301')).toThrow();
    expect(() => parseProductionRedirects('/a /b/#c d 301')).toThrow();
    expect(() => parseProductionRedirects('/a /b/#<x> 301')).toThrow();
  });

  it('targets a section that exists on the Pro page', () => {
    const pro = readFileSync(new URL('../src/pages/pro.astro', import.meta.url), 'utf8');
    expect(pro).toMatch(/<section[^>]*id="pricing"/);
  });
});

describe('Pro upgrade prompts', () => {
  it('pairs only free tools with credit-metered tools that exist', () => {
    for (const pair of PRO_UPSELLS) {
      expect(registry.toolsById.get(pair.freeToolId)?.cost, pair.freeToolId).toBe('free');
      const pro = registry.toolsById.get(pair.proToolId);
      expect(pro?.cost, pair.proToolId).toBe('credit');
      expect(pro?.creditCost, pair.proToolId).toBeGreaterThan(0);
    }
  });

  it('covers OCR, transcription, translation and PDF Q&A', () => {
    expect(upsellsFor('ocr').map((u) => u.proToolId)).toContain('ocr-hq');
    expect(upsellsFor('transcribe').map((u) => u.proToolId)).toContain('transcribe-pro');
    expect(upsellsFor('text-translate').map((u) => u.proToolId)).toContain('text-translate-pro');
    expect(upsellsFor('pdf-to-text').map((u) => u.proToolId)).toContain('pdf-q-and-a');
  });

  it('keeps the existing single post-run seam unchanged', () => {
    expect(upsellFor('pdf-to-text')?.proToolId).toBe('pdf-summarize');
    expect(upsellsFor('hash')).toEqual([]);
  });

  it('prints benefit copy that follows the copy rules and matches the hosted tool', () => {
    for (const pair of PRO_UPSELLS) {
      expect(pair.benefit, pair.proToolId).not.toMatch(/—|seamless|unlock|elevate|delve|leverage|Frontier/i);
    }
    // Hosted transcription caps at 25 MB; the free tool takes larger files.
    expect(upsellsFor('transcribe')[0]?.benefit).not.toMatch(/long/i);
    // "100+ languages" describes the free M2M100 tool, not the hosted model.
    expect(upsellsFor('text-translate')[0]?.benefit).not.toMatch(/100\+/);
    // Upscaling runs on a third-party GPU provider, not Wyreup's servers.
    expect(upsellsFor('upscale-2x')[0]?.benefit).not.toMatch(/our servers/i);
  });

  it('says what a hosted tool actually sends', () => {
    // Q&A tools send the question with the extracted text (runPro { text, question }).
    const withQuestion = 'the text extracted from your file in this browser, and your question,';
    expect(hostedInputPhrase('pdf-q-and-a')).toBe(withQuestion);
    expect(hostedInputPhrase('chat-long-pdf-pro')).toBe(withQuestion);
    expect(hostedInputPhrase('pdf-summarize')).toBe('the text extracted from your file in this browser');
    expect(hostedInputPhrase('translate-document-pro')).toBe('the text extracted from your file in this browser');
    expect(hostedInputPhrase('ocr-hq')).toBe('your input');
    // Scanned-PDF Q&A sends rendered page images and the question (runPro { pages, question }).
    expect(hostedInputPhrase('pdf-scan-q-and-a-pro')).toBe(
      'one image per PDF page you picked, rendered in this browser, along with your question,',
    );
    const prompt = readFileSync(new URL('../src/components/ProUpgradePrompt.astro', import.meta.url), 'utf8');
    expect(prompt).not.toMatch(/their input is sent/);
    const page = readFileSync(new URL('../src/pages/tools/[slug].astro', import.meta.url), 'utf8');
    expect(page).toMatch(/\{hostedInputPhrase\(serializedTool\.id\)\} is sent over TLS/);
    expect(page).not.toMatch(/it, your input is sent/);
  });

  it('keeps the PDF Q&A guide explicit that the file itself is not uploaded', () => {
    const formats = SEARCH_GUIDES['pdf-q-and-a']?.formats ?? '';
    expect(formats).toMatch(/extracted text .*and your question are sent to Wyreup/);
    expect(formats).toMatch(/the PDF file is not\b/);
    const scan = SEARCH_GUIDES['pdf-scan-q-and-a-pro']?.formats ?? '';
    expect(scan).toMatch(/page images and your question are sent to Wyreup; the PDF file is not\b/);
  });

  it('offers scanned-PDF Q&A from the free text extractor', () => {
    expect(upsellsFor('pdf-to-text').map((u) => u.proToolId)).toContain('pdf-scan-q-and-a-pro');
  });
});

describe('Pro tool page search metadata', () => {
  it('gives each high-intent Pro page a scoped title distinct from its free sibling', () => {
    for (const id of PRO_PAGES) {
      const page = TOOL_PAGE_METADATA[id];
      expect(page, id).toBeDefined();
      const pro = projectToolDiscoveryMetadata(registry.toolsById.get(id)!);
      const free = projectToolDiscoveryMetadata(registry.toolsById.get(FREE_SIBLING[id])!);
      expect(pro.title).not.toBe(free.title);
      expect(pro.heading).not.toBe(free.heading);
      // The registry name must still lead the H1: job pages and the browser
      // suite locate the tool page by it (job-no-tracking.test.ts).
      expect(pro.heading.startsWith(registry.toolsById.get(id)!.name), id).toBe(true);
      expect(pro.title).toMatch(/\| Wyreup$/);
      expect(`${pro.title} ${pro.heading} ${pro.description}`).not.toMatch(/—/);
      expect(pro.description.length).toBeLessThanOrEqual(170);
      expect(pro.description).toMatch(/credit/i);
    }
  });

  it('adds a task guide linking pricing and the free alternative', () => {
    for (const id of PRO_PAGES) {
      const guide = SEARCH_GUIDES[id];
      expect(guide, id).toBeDefined();
      if (!guide) continue;
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.limitations.length).toBeGreaterThanOrEqual(2);
      const hrefs = guide.links.map((link) => link.href);
      expect(hrefs).toContain('/pro/#pricing');
      expect(hrefs).toContain(`/tools/${FREE_SIBLING[id]}/`);
      expect(guide.formats).toMatch(/sent to Wyreup|sends? .* to Wyreup/i);
    }
  });
});
