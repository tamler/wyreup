import { describe, it, expect } from 'vitest';
import { pdfExtractPages } from '../../../src/tools/pdf-extract-pages/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(aborted = false): ToolRunContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    onProgress: () => {},
    signal: controller.signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('pdf-extract-pages — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfExtractPages.id).toBe('pdf-extract-pages');
    expect(pdfExtractPages.category).toBe('edit');
  });

  it('accepts application/pdf, min 1 max 1', () => {
    expect(pdfExtractPages.input.accept).toEqual(['application/pdf']);
    expect(pdfExtractPages.input.min).toBe(1);
    expect(pdfExtractPages.input.max).toBe(1);
  });

  it('output mime is application/pdf', () => {
    expect(pdfExtractPages.output.mime).toBe('application/pdf');
  });
});

describe('pdf-extract-pages — run()', () => {
  it('extracts a specific page', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfExtractPages.run([input], { pages: [1] }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('extracts a range of pages', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfExtractPages.run([input], { pages: ['1-2'] }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });

  it('throws for out-of-bounds page number', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      pdfExtractPages.run([input], { pages: [99] }, makeCtx()),
    ).rejects.toThrow();
  });

  it('throws for empty pages array', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfExtractPages.run([input], { pages: [] }, makeCtx()),
    ).rejects.toThrow();
  });

  it('respects abort signal', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfExtractPages.run([input], { pages: [1] }, makeCtx(true)),
    ).rejects.toThrow('Aborted');
  });
});
