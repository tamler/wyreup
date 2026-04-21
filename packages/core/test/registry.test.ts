import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRegistry,
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
    presence: 'both',
    keywords: ['test'],
    input: { accept: ['image/*'], min: 1 },
    output: { mime: 'image/png' },
    interactive: false,
    batchable: true,
    cost: 'free',
    memoryEstimate: 'low',
    defaults: {},
    Component: () => null,
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
