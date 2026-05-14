import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRegistry,
  couldFlowTo,
  type ToolRegistry,
} from '../src/registry.js';
import type { ToolModule } from '../src/types.js';

function makeTool(overrides: Partial<ToolModule> = {}): ToolModule {
  return {
    id: 'test',
    slug: 'test',
    name: 'Test',
    description: 'Test tool',
    category: 'optimize',
    keywords: ['test'],
    input: { accept: ['image/*'], min: 1 },
    output: { mime: 'image/png' },
    interactive: false,
    batchable: true,
    cost: 'free',
    memoryEstimate: 'low',
    defaults: {},
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async () => new Blob(),
    __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
    ...overrides,
  } as ToolModule;
}

describe('registry', () => {
  let registry: ToolRegistry;
  let compress: ToolModule;
  let convert: ToolModule;
  let mergePdf: ToolModule;

  beforeEach(() => {
    compress = makeTool({
      id: 'compress',
      name: 'Compress',
      category: 'optimize',
      keywords: ['compress', 'shrink', 'reduce'],
    });
    convert = makeTool({
      id: 'convert',
      name: 'Convert format',
      category: 'convert',
      keywords: ['convert', 'format'],
      input: { accept: ['image/png', 'image/jpeg'], min: 1 },
    });
    mergePdf = makeTool({
      id: 'merge-pdf',
      name: 'Merge PDFs',
      category: 'pdf',
      keywords: ['merge', 'pdf', 'combine'],
      input: { accept: ['application/pdf'], min: 2 },
    });

    registry = createRegistry([compress, convert, mergePdf]);
  });

  it('looks up tools by id', () => {
    expect(registry.toolsById.get('compress')).toBe(compress);
    expect(registry.toolsById.get('merge-pdf')).toBe(mergePdf);
    expect(registry.toolsById.get('missing')).toBeUndefined();
  });

  it('filters tools by category', () => {
    const pdfTools = registry.toolsByCategory('pdf');
    expect(pdfTools).toEqual([mergePdf]);
    const optimizeTools = registry.toolsByCategory('optimize');
    expect(optimizeTools).toEqual([compress]);
  });

  it('finds tools compatible with a single image file', () => {
    const pngFile = new File([], 'x.png', { type: 'image/png' });
    const compatible = registry.toolsForFiles([pngFile]);
    expect(compatible).toContain(compress);
    expect(compatible).toContain(convert);
    expect(compatible).not.toContain(mergePdf);
  });

  it('finds tools compatible with multiple PDFs (respects min count)', () => {
    const pdf1 = new File([], 'a.pdf', { type: 'application/pdf' });
    const pdf2 = new File([], 'b.pdf', { type: 'application/pdf' });
    const compatible = registry.toolsForFiles([pdf1, pdf2]);
    expect(compatible).toContain(mergePdf);
  });

  it('does not suggest tools whose min count is unmet', () => {
    const pdf1 = new File([], 'a.pdf', { type: 'application/pdf' });
    const compatible = registry.toolsForFiles([pdf1]);
    expect(compatible).not.toContain(mergePdf);
  });

  it('searchTools matches by keyword', () => {
    const results = registry.searchTools('shrink');
    expect(results).toContain(compress);
  });

  it('searchTools matches by name substring', () => {
    const results = registry.searchTools('merge');
    expect(results).toContain(mergePdf);
  });

  it('searchTools returns empty for no match', () => {
    const results = registry.searchTools('nonexistent-query-xyz');
    expect(results).toEqual([]);
  });
});

describe('couldFlowTo', () => {
  it('flows when producer is exact and consumer accepts that exact mime', () => {
    expect(couldFlowTo('image/jpeg', ['image/jpeg', 'image/png'])).toBe(true);
  });

  it('flows when consumer accepts the mime via family wildcard', () => {
    expect(couldFlowTo('image/jpeg', ['image/*'])).toBe(true);
  });

  it('flows when producer is a wildcard and consumer accepts a concrete mime in the same family', () => {
    // The bug fix case: strip-exif declares output 'image/*'; compress
    // accepts only concrete image mimes. Builder must surface compress
    // as a valid next step.
    expect(couldFlowTo('image/*', ['image/jpeg', 'image/png', 'image/webp'])).toBe(true);
  });

  it('flows when both sides are family wildcards in the same family', () => {
    expect(couldFlowTo('image/*', ['image/*'])).toBe(true);
  });

  it('flows when consumer accepts the universal wildcard', () => {
    expect(couldFlowTo('image/*', ['*/*'])).toBe(true);
    expect(couldFlowTo('application/geo+json', ['*'])).toBe(true);
  });

  it('does not flow across families even when both use wildcards', () => {
    expect(couldFlowTo('image/*', ['audio/*'])).toBe(false);
  });

  it('does not flow when producer is a concrete mime in a different family', () => {
    expect(couldFlowTo('text/plain', ['image/jpeg', 'image/*'])).toBe(false);
  });

  it('does not flow when consumer list is empty', () => {
    expect(couldFlowTo('image/jpeg', [])).toBe(false);
  });

  it('strips MIME parameters when matching (RFC 7231 — `audio/webm;codecs=opus`)', () => {
    expect(couldFlowTo('audio/webm;codecs=opus', ['audio/webm'])).toBe(true);
  });
});
