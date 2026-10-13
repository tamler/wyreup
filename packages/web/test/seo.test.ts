import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { GET } from '../src/pages/sitemap.xml';
import { JOBS } from '../src/data/jobs';
import { canonicalPageUrl, isIndexablePath, TOOL_PAGE_METADATA } from '../src/lib/seo';
import { correctedToolSeoContent } from '../src/lib/search-guides';
import { SEO_CONTENT } from '../src/lib/seo-content';

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

const REDACTION_FAQS = {
  'pdf-redact': [
    {
      q: 'Is the redacted text truly gone?',
      a: 'No. The rectangles cover content visually, but underlying text can remain extractable. The PDF output is not secure redaction.',
    },
    {
      q: 'Does my document get uploaded?',
      a: 'No. Redaction is applied locally in your browser; the file stays on your device.',
    },
    {
      q: 'How do I make the redaction permanent?',
      a: 'This tool does not offer permanent content removal. Compress PDF re-encodes embedded images to reduce file size; it does not remove the text or image content beneath these rectangles.',
    },
    {
      q: 'Can I redact multiple areas on different pages?',
      a: 'Yes. You can place solid rectangles over content across pages in a single pass.',
    },
    {
      q: 'Is the original file altered?',
      a: 'No. The tool outputs a new redacted copy and leaves your source untouched.',
    },
  ],
  'text-redact': [
    {
      q: 'What PII patterns does it detect out of the box?',
      a: 'Emails, phone numbers, SSNs, credit cards (Luhn-validated), IP addresses, URLs, UUIDs, and AWS access keys.',
    },
    {
      q: 'Can I add my own patterns?',
      a: "Yes. You can supply custom regular expressions to catch organization-specific identifiers the built-in patterns don't cover.",
    },
    {
      q: 'Is my text uploaded?',
      a: 'No. Redaction runs entirely client-side in your browser, so the text and the PII in it never leave your device.',
    },
    {
      q: 'How is this different from Redact PDF?',
      a: 'Text Redact replaces matching patterns in the output plain text. Redact PDF only adds visual cover rectangles: underlying PDF content may remain recoverable, including after compression. It is not a secure document-redaction equivalent.',
    },
    {
      q: 'Will pattern-based redaction catch everything?',
      a: 'It catches well-structured PII like emails and card numbers reliably, but free-form mentions (a name in a sentence) need a language-aware tool; for that, see Redact PII.',
    },
  ],
};

describe('redaction FAQ backfill boundary', () => {
  for (const id of ['pdf-redact', 'text-redact'] as const) {
    for (const reworded of [false, true]) {
      it(`keeps ${id} curated FAQs with ${reworded ? 'changed' : 'original'} backfill questions`, () => {
        const original = SEO_CONTENT[id];
        const input = {
          ...original,
          faq: reworded
            ? [
                ...original.faq!.map((entry) => ({ ...entry, q: `Reworded: ${entry.q}` })),
                {
                  q: 'Can compression securely remove every hidden part?',
                  a: 'Compress PDF permanently removes the text and image content beneath the covers.',
                },
              ]
            : original.faq!.map((entry) => ({ ...entry })),
        };
        const before = JSON.stringify(input);
        const corrected = correctedToolSeoContent(id, input)!;
        expect(corrected.faq).toEqual(REDACTION_FAQS[id]);
        expect(corrected.intro?.length ?? 0).toBeGreaterThan(0);
        expect(corrected.useCases?.length ?? 0).toBeGreaterThanOrEqual(3);
        expect(corrected.alsoTry?.map((entry) => entry.id)).toEqual(
          original.alsoTry?.map((entry) => entry.id),
        );
        expect(JSON.stringify(input)).toBe(before);
      });
    }
  }

  it('preserves existing answer-map behavior for other corrected tools', () => {
    const input = {
      ...SEO_CONTENT.compress,
      faq: [
        { q: 'Which image formats can I compress?', a: 'UNTRUSTED FORMAT ANSWER' },
        { q: 'Unrelated future question', a: 'PRESERVED UNRELATED ANSWER' },
      ],
    };
    const before = JSON.stringify(input);
    const corrected = correctedToolSeoContent('compress', input)!;
    expect(corrected.faq?.[0]?.a).not.toBe('UNTRUSTED FORMAT ANSWER');
    expect(corrected.faq?.[1]).toEqual(input.faq[1]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('preserves an uncorrected tool by reference', () => {
    const input = SEO_CONTENT.hash;
    expect(input).toBeDefined();
    expect(correctedToolSeoContent('hash', input)).toBe(input);
  });
});
