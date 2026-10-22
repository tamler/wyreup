// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- The source fixture uses an existing ambient declaration with no runtime module.
/// <reference path="../../core/src/lib/tr46.d.ts" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Source-backed runner tests share the existing utility vendor declarations.
/// <reference path="../../core/src/vendor.d.ts" />
/**
 * Regression ratchet for privacy claims.
 *
 * 1. Every tool is scanned for blanket claims; network tools of any cost
 *    must not carry local-only prose —
 *    except honest hybrid/contrast sentences on an explicit allowlist.
 * 2. Named site-copy sources must not reintroduce blanket privacy claims.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDefaultRegistry } from '@wyreup/core';
import { SEO_CONTENT } from '../src/lib/seo-content';
import { domainAgeChecker } from '../../core/src/utilities/domain-age';
import type { ToolModule } from '@wyreup/core';

const LOCAL_ONLY_RE =
  /runs entirely (on your device|in your browser)|never leaves? your (device|machine|browser|computer)|nothing (is )?uploaded|never (transmitted|uploaded|sent anywhere|sent to a server)|no uploads?, no server|runs? client-side|stays? on (your|this) device|processed locally|locally in (the|your) browser|on-device only|all processing happens on (this|your) device|does not upload your/i;

/** Honest hosted-tool sentences that match LOCAL_ONLY_RE but are truthful. */
const ALLOWLIST: { toolId: string; needle: string }[] = [
  // Contrast: free Whisper is local; this Pro tool sends audio to a hosted model.
  {
    toolId: 'transcribe-pro',
    needle: 'The free version runs Whisper locally in your browser.',
  },
  // Contrast: points users who need on-device to the free tool.
  {
    toolId: 'transcribe-pro',
    needle:
      'If you need everything to stay on your device, use the free in-browser Transcribe instead.',
  },
  // Contrast: free OCR is local; this hosted version uses a vision model.
  {
    toolId: 'ocr-hq',
    needle: 'The free OCR runs entirely in your browser',
  },
  // Contrast: free transcriber stays local; this Pro tool sends audio.
  {
    toolId: 'transcribe-and-translate',
    needle: "The free in-browser transcriber stays on your device but doesn't translate.",
  },
  // Hybrid: extraction local; only extracted text goes to the hosted model.
  {
    toolId: 'pdf-summarize',
    needle: 'The original PDF file never leaves your device.',
  },
  // Hybrid: PDF text extraction is local; text + question are then sent.
  {
    toolId: 'pdf-q-and-a',
    needle:
      "extracts the PDF's text locally in your browser, then sends that text plus your question to a hosted LLM",
  },
  // Hybrid: PDF bytes stay local; only extracted text is Q&A'd.
  {
    toolId: 'pdf-q-and-a',
    needle: 'The PDF file itself stays on your device.',
  },
  // Hybrid: parsing local; extracted text is what the hosted model receives.
  {
    toolId: 'chat-long-pdf-pro',
    needle: 'The PDF parsing itself happens locally in your browser before that step.',
  },
];

type FieldHit = { field: string; text: string };

function flattenSeo(
  seo:
    | {
        intro?: string;
        useCases?: string[];
        faq?: { q: string; a: string }[];
        alsoTry?: { id: string; why: string }[];
      }
    | undefined
    | null,
  prefix: string,
): FieldHit[] {
  if (!seo) return [];
  const parts: FieldHit[] = [];
  if (seo.intro) parts.push({ field: `${prefix}.intro`, text: seo.intro });
  if (seo.useCases) {
    seo.useCases.forEach((u, i) => parts.push({ field: `${prefix}.useCases[${i}]`, text: u }));
  }
  if (seo.faq) {
    seo.faq.forEach((f, i) => {
      parts.push({ field: `${prefix}.faq[${i}].q`, text: f.q });
      parts.push({ field: `${prefix}.faq[${i}].a`, text: f.a });
    });
  }
  if (seo.alsoTry) {
    seo.alsoTry.forEach((a, i) =>
      parts.push({ field: `${prefix}.alsoTry[${i}].why`, text: a.why }),
    );
  }
  return parts;
}

/**
 * Remove allowlisted sentences from the text instead of skipping the whole
 * field — a new dishonest claim sharing a field with an allowlisted sentence
 * must still fail.
 */
function stripAllowlisted(toolId: string, text: string): string {
  let out = text;
  for (const entry of ALLOWLIST) {
    if (entry.toolId === toolId) out = out.split(entry.needle).join(' ');
  }
  return out;
}

const UNIVERSAL_RE =
  /(?:all|every|free)\s+tools?\s+(?:run|runs|execute|executes)\s+(?:entirely\s+)?(?:locally|on-device|on your device|on your machine|in your browser)|free tools (?:keep files on your machine|never upload|never reach our backend|are not affected)|every operation runs on-device|fully offline|works fully offline once installed|no network calls during tool execution|nothing is sent to wyreup.s servers|no network egress|no server path is constructed|we retain nothing/i;

function normalized(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type ClaimTool = Pick<
  ToolModule,
  'id' | 'cost' | 'description' | 'llmDescription' | 'seoContent' | 'paramSchema'
>;
function toolFailures(
  tool: ClaimTool,
  seo: Parameters<typeof flattenSeo>[0] = SEO_CONTENT[tool.id],
): string[] {
  const fields: FieldHit[] = [
    { field: 'description', text: tool.description ?? '' },
    { field: 'llmDescription', text: tool.llmDescription ?? '' },
    ...flattenSeo(tool.seoContent, 'tool.seoContent'),
    ...flattenSeo(seo, 'SEO_CONTENT'),
    ...Object.entries(tool.paramSchema ?? {}).map(([key, value]) => ({
      field: `beforeRun.${key}.help`,
      text:
        value && typeof value === 'object' && 'help' in value && typeof value.help === 'string'
          ? value.help
          : '',
    })),
  ];
  const network = tool.cost === 'credit' || tool.id === 'domain-age-checker';
  return fields.flatMap(({ field, text }) => {
    const scanned = normalized(stripAllowlisted(tool.id, text));
    const match = scanned.match(UNIVERSAL_RE) ?? (network ? scanned.match(LOCAL_ONLY_RE) : null);
    return match ? [`${tool.id} / ${field}: ${JSON.stringify(match[0])}`] : [];
  });
}

describe('All-tool network and privacy claim ratchet', () => {
  it('scans every registry tool at every cost and the forthcoming free network tool', () => {
    const registry = createDefaultRegistry();
    const tools = [...registry.toolsById.values()];
    expect(tools.some((tool) => tool.cost === 'free')).toBe(true);
    expect(tools.some((tool) => tool.cost === 'credit')).toBe(true);
    const failures = [...tools, domainAgeChecker].flatMap((tool) => toolFailures(tool));
    expect(failures, failures.join('\n')).toEqual([]);
  });
  it.each(['description', 'llmDescription', 'seoContent', 'SEO_CONTENT', 'beforeRun'])(
    'rejects synthetic FREE network local-only %s',
    (field) => {
      const tool: ClaimTool = {
        ...domainAgeChecker,
        description: '',
        llmDescription: '',
        seoContent: undefined,
        paramSchema: {},
      };
      const claim = 'All processing happens on your device.';
      if (field === 'description' || field === 'llmDescription') tool[field] = claim;
      if (field === 'seoContent') tool.seoContent = { intro: claim };
      if (field === 'beforeRun') tool.paramSchema = { domain: { type: 'string', help: claim } };
      expect(
        toolFailures(tool, field === 'SEO_CONTENT' ? { intro: claim } : undefined),
      ).toHaveLength(1);
    },
  );
  it('allows an actual local tool claim while rejecting blanket claims at any cost', () => {
    expect(
      toolFailures({
        id: 'synthetic-local',
        cost: 'free',
        description: 'All processing happens on your device.',
      }),
    ).toEqual([]);
    expect(
      toolFailures({
        id: 'synthetic-local',
        cost: 'free',
        description: 'Every tool runs on your device.',
      }),
    ).toHaveLength(1);
  });
  it('scans the remainder after a narrowly allowed hybrid sentence', () => {
    const tool = {
      id: 'pdf-summarize',
      cost: 'credit' as const,
      description:
        'The original PDF file never leaves your device. All processing happens on your device.',
    };
    expect(toolFailures(tool)).toHaveLength(1);
    expect(
      toolFailures({
        ...tool,
        description:
          'The original PDF file never leaves your device. Extracted text is sent to a hosted model.',
      }),
    ).toEqual([]);
  });
  it.each(['description', 'llmDescription', 'beforeRun', 'SEO_CONTENT'])(
    'requires explicit domain transport disclosure in %s',
    (field) => {
      const text =
        field === 'description'
          ? domainAgeChecker.description
          : field === 'llmDescription'
            ? domainAgeChecker.llmDescription
            : field === 'beforeRun'
              ? domainAgeChecker.paramSchema?.domain?.help
              : SEO_CONTENT['domain-age-checker']?.intro;
      expect(text).toMatch(/domain.*(?:sent|sends).*Wyreup|sends.*domain.*Wyreup/i);
      expect(text).toMatch(/IANA.*bootstrap/);
      expect(text).toMatch(/registration registry/i);
      expect(text).toMatch(/no API key/i);
    },
  );
});

const SITE_COPY_FILES = [
  'src/pages/index.astro',
  'src/pages/about.astro',
  'src/pages/triggers.astro',
  'src/components/HeroDrop.svelte',
  'src/components/HeroSearch.svelte',
  'src/components/HowItWorks.svelte',
  'src/components/PwaOnboardBanner.svelte',
  'src/components/runners/DropZone.svelte',
  'src/layouts/BaseLayout.astro',
  'src/pages/legal/privacy.astro',
  'src/pages/legal/terms.astro',
  'src/pages/cli.astro',
  'src/pages/mcp.astro',
  '../core/package.json',
  '../cli/package.json',
  '../mcp/package.json',
  '../core/README.md',
  '../cli/README.md',
  '../mcp/README.md',
  '../cli/src/index.ts',
  '../cli/src/commands/run.ts',
  '../cli/src/commands/chain.ts',
  '../mcp/src/index.ts',
  '../mcp/src/server.ts',
] as const;

const BLANKET_NEEDLES = [
  'nothing uploads',
  '0 uploads',
  'never leave your machine',
  'never leaves your machine',
  'never leave your computer',
  'never leaves your computer',
  'runs every tool on your device',
  'every tool runs on your device',
  'every tool runs on-device',
  'nothing is sent to a server',
  'no uploads. no signup',
  'never upload, never cache',
  'files never upload',
  'no upload, no signup',
  'like every other wyreup tool',
  'no cookies',
] as const;

describe('Site copy carries no blanket claims', () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

  it('named marketing sources contain none of the banned needles', () => {
    const failures: string[] = [];

    for (const rel of SITE_COPY_FILES) {
      const content = readFileSync(join(packageRoot, rel), 'utf8');
      const lower = normalized(content).toLowerCase();
      if (UNIVERSAL_RE.test(lower)) failures.push(`${rel}: universal tool execution claim`);
      for (const needle of BLANKET_NEEDLES) {
        if (lower.includes(needle)) {
          failures.push(`${rel}: contains ${JSON.stringify(needle)}`);
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
  it.each([
    'Every tool runs on-device.',
    'Free tools run entirely on your device.',
    'All tools run locally.',
    'No network calls during tool execution.',
    "Nothing is sent to Wyreup's servers.",
    'Free tools execute on your machine.',
    'Free tools keep files on your machine.',
    'No network egress.',
    'No server path is constructed.',
    'We retain nothing.',
  ])('rejects synthetic manifest/README/help/site/legal blanket %s', (claim) => {
    expect(UNIVERSAL_RE.test(normalized(`<p>${claim}</p>`))).toBe(true);
  });
  it('package manifests do not label the mixed library offline or local', () => {
    for (const name of ['core', 'cli', 'mcp']) {
      const manifest = JSON.parse(
        readFileSync(join(packageRoot, `../${name}/package.json`), 'utf8'),
      ) as { keywords: string[] };
      expect(manifest.keywords).not.toContain('offline');
      expect(manifest.keywords).not.toContain('local');
    }
  });
  it('privacy policy discloses rotating counters, reservation tokens and retention limits', () => {
    const copy = normalized(
      readFileSync(join(packageRoot, 'src/pages/legal/privacy.astro'), 'utf8'),
    ).toLowerCase();
    for (const phrase of [
      'rotating',
      'hmac',
      'shared networks',
      'random',
      'reservation',
      'platform logs',
      'backups',
      'operator',
      'no raw ip',
      'iana',
    ])
      expect(copy).toContain(phrase);
  });
});
