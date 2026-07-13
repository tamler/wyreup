/**
 * Regression ratchet for privacy claims.
 *
 * 1. Hosted (cost: 'credit') tools must not carry local-only prose —
 *    except honest hybrid/contrast sentences on an explicit allowlist.
 * 2. Named site-copy sources must not reintroduce blanket privacy claims.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDefaultRegistry } from '@wyreup/core';
import { SEO_CONTENT } from '../src/lib/seo-content';

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
    needle: 'If you need everything to stay on your device, use the free in-browser Transcribe instead.',
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
    needle: "extracts the PDF's text locally in your browser, then sends that text plus your question to a hosted LLM",
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
  // Contrast: this Pro tool uploads to GPU; free tools never leave the device.
  {
    toolId: 'upscale-2x-pro',
    needle: 'unlike the free in-browser tools that never leave your device',
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
    seo.useCases.forEach((u, i) =>
      parts.push({ field: `${prefix}.useCases[${i}]`, text: u }),
    );
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

describe('Hosted tools never carry local-only prose (ratchet)', () => {
  it('no credit tool claims local-only execution unless allowlisted', () => {
    const registry = createDefaultRegistry();
    const hosted = Array.from(registry.toolsById.values()).filter(
      (t) => t.cost === 'credit',
    );
    expect(hosted.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const tool of hosted) {
      const fields: FieldHit[] = [
        { field: 'description', text: tool.description ?? '' },
        { field: 'llmDescription', text: tool.llmDescription ?? '' },
        ...flattenSeo(tool.seoContent, 'tool.seoContent'),
        ...flattenSeo(SEO_CONTENT[tool.id], 'SEO_CONTENT'),
      ];

      for (const { field, text } of fields) {
        if (!text) continue;
        const scanned = stripAllowlisted(tool.id, text);
        const match = scanned.match(LOCAL_ONLY_RE);
        if (!match) continue;
        failures.push(
          `${tool.id} / ${field}: matched ${JSON.stringify(match[0])} in ${JSON.stringify(scanned.slice(0, 280))}`,
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});

const SITE_COPY_FILES = [
  'src/pages/index.astro',
  'src/pages/about.astro',
  'src/pages/triggers.astro',
  'src/components/HeroDrop.svelte',
  'src/components/HowItWorks.svelte',
  'src/components/PwaOnboardBanner.svelte',
  'src/components/runners/DropZone.svelte',
  'src/layouts/BaseLayout.astro',
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
      const lower = content.toLowerCase();
      for (const needle of BLANKET_NEEDLES) {
        if (lower.includes(needle)) {
          failures.push(`${rel}: contains ${JSON.stringify(needle)}`);
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
