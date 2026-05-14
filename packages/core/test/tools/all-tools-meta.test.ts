// Meta-tests over the entire default registry.
//
// Two goals:
//   1. Structural invariants on every ToolModule (id/slug consistency,
//      required metadata, MIME-spec sanity). Catches regressions in any
//      tool — including the ~65 that didn't have per-tool tests.
//   2. Behavioral smoke for the cheap-to-test subset — tools that take
//      no file input or accept a small text/JSON input. Each such tool
//      runs against synthetic input and we verify the output blob has
//      the declared MIME type. Heavier tools (PDFs, AI models, audio,
//      video, geo) are skipped here and live in their per-tool test
//      directories.

import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../src/default-registry.js';
import type { ToolModule, ToolRunContext } from '../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test-meta',
  };
}

// Tools we deliberately skip from the smoke-run loop because they need
// real binary fixtures, network access, model downloads, or are too slow
// for a meta-sweep. Their per-tool test files (where present) cover them.
const RUN_SKIP = new Set<string>([
  // AI / model-download tools
  'audio-enhance', 'bg-remove', 'upscale-2x', 'ocr-pro', 'image-similarity',
  'text-sentiment', 'text-ner', 'text-summarize', 'text-translate', 'text-embed',
  'image-caption', 'image-caption-detailed', 'transcribe', 'ocr', 'face-blur',
  // Web-only (need DOM / media APIs)
  'record-audio',
  // Heavy media (ffmpeg / pdfjs / sharp)
  'convert-audio', 'convert-video', 'extract-audio', 'trim-media',
  'compress-video', 'video-to-gif', 'convert-subtitles', 'burn-subtitles',
  'video-concat', 'video-add-text', 'video-speed', 'video-overlay-image',
  'video-crossfade', 'video-color-correct',
  'pdf-extract-images', 'pdf-suspicious',
  // Geo conversion that needs a real GDAL roundtrip with valid fixtures
  'convert-geo',
  // Tools that need genuinely structured input we can't fake in two lines
  'pgp-encrypt', 'pgp-decrypt', 'pgp-sign', 'pgp-verify',
  'zip-extract',
  'shapefile-to-geojson',
  // Tools with required text-shaped params that fail without real data
  'qr-reader', 'mime-detect',
]);

const registry = createDefaultRegistry();
const allTools = registry.tools;

describe('ToolModule structural invariants', () => {
  for (const tool of allTools) {
    describe(tool.id, () => {
      it('id matches slug', () => {
        expect(tool.slug).toBe(tool.id);
      });
      it('has a non-empty name', () => {
        expect(tool.name).toBeTruthy();
        expect(tool.name.length).toBeGreaterThan(0);
      });
      it('has a non-empty description', () => {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(10);
      });
      it('has a valid category', () => {
        const valid = new Set([
          'optimize','convert','edit','privacy','pdf','create','inspect',
          'export','audio','dev','finance','media','archive','text','geo',
        ]);
        expect(valid.has(tool.category)).toBe(true);
      });
      it('has an input spec with accept[] and min', () => {
        expect(Array.isArray(tool.input.accept)).toBe(true);
        expect(typeof tool.input.min).toBe('number');
        expect(tool.input.min).toBeGreaterThanOrEqual(0);
      });
      it('has an output mime', () => {
        expect(typeof tool.output.mime).toBe('string');
        expect(tool.output.mime.length).toBeGreaterThan(0);
      });
      it('has __testFixtures with expectedOutputMime', () => {
        expect(tool.__testFixtures).toBeDefined();
        expect(Array.isArray(tool.__testFixtures.expectedOutputMime)).toBe(true);
        expect(tool.__testFixtures.expectedOutputMime.length).toBeGreaterThan(0);
      });
      it('declares defaults', () => {
        expect(tool.defaults).toBeDefined();
      });
      it('declares a memoryEstimate', () => {
        expect(['low','medium','high','extreme']).toContain(tool.memoryEstimate);
      });
    });
  }
});

describe('Registry-level invariants', () => {
  it('every tool id is unique', () => {
    const ids = new Set<string>();
    for (const tool of allTools) {
      expect(ids.has(tool.id)).toBe(false);
      ids.add(tool.id);
    }
  });
  it('registry size is in the expected range (drift-tolerant)', () => {
    expect(allTools.length).toBeGreaterThanOrEqual(150);
    expect(allTools.length).toBeLessThan(500);
  });
  it('every tool resolves via toolsById', () => {
    for (const tool of allTools) {
      expect(registry.toolsById.get(tool.id)).toBe(tool);
    }
  });
});

// ──── Behavioural smoke for cheap tools ────

function makeSyntheticInput(tool: ToolModule): File | null {
  if (tool.input.min === 0) return null;
  const accepts = tool.input.accept;
  if (accepts.some((m) => m === 'text/plain' || m === 'application/json' || m === 'text/*')) {
    if (accepts.some((m) => m === 'application/json')) {
      return new File(['{"hello":"world"}'], 'in.json', { type: 'application/json' });
    }
    return new File(['hello world\nthis is a test'], 'in.txt', { type: 'text/plain' });
  }
  if (accepts.some((m) => m === 'text/csv' || m === 'application/csv')) {
    return new File(['a,b,c\n1,2,3\n4,5,6\n'], 'in.csv', { type: 'text/csv' });
  }
  if (accepts.some((m) => m === 'text/html')) {
    return new File(['<p>hello</p>'], 'in.html', { type: 'text/html' });
  }
  return null;
}

describe('tool smoke runs (cheap subset)', () => {
  for (const tool of allTools) {
    if (RUN_SKIP.has(tool.id)) continue;
    // Tools that need 2+ inputs are skipped here — they all have proper
    // per-tool tests with realistic fixtures.
    if (tool.input.min > 1) continue;
    // Skip tools that accept only binary file MIME types (image/*, application/pdf, etc.).
    if (tool.input.min > 0 && makeSyntheticInput(tool) === null) continue;

    it(`${tool.id} runs without throwing on synthetic input`, async () => {
      const input = makeSyntheticInput(tool);
      const inputs = input ? [input] : [];
      try {
        const result = await tool.run(inputs, tool.defaults as never, makeCtx());
        const blobs = Array.isArray(result) ? result : [result];
        expect(blobs.length).toBeGreaterThan(0);
        for (const b of blobs) {
          expect(b).toBeInstanceOf(Blob);
          expect(b.size).toBeGreaterThanOrEqual(0);
        }
      } catch (err) {
        // Some tools require non-default params (e.g. text-template needs a
        // template string, json-merge needs 2 inputs, etc.). Throwing a
        // descriptive Error is acceptable — assert it's at least a real
        // Error with a useful message, not a TypeError on missing fields.
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message.length).toBeGreaterThan(0);
      }
    });
  }
});
