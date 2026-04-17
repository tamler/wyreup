import { describe, it, expect } from 'vitest';
import { pdfDeletePages } from '../../../src/tools/pdf-delete-pages/index.js';
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

describe('pdf-delete-pages — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfDeletePages.id).toBe('pdf-delete-pages');
    expect(pdfDeletePages.category).toBe('edit');
  });

  it('output mime is application/pdf', () => {
    expect(pdfDeletePages.output.mime).toBe('application/pdf');
  });
});

describe('pdf-delete-pages — run()', () => {
  it('deletes a specific page from a 3-page PDF', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfDeletePages.run([input], { pages: [2] }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('deletes a range of pages', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfDeletePages.run([input], { pages: ['1-2'] }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });

  it('throws if deleting all pages', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      pdfDeletePages.run([input], { pages: ['1-3'] }, makeCtx()),
    ).rejects.toThrow('Cannot delete all pages');
  });

  it('throws for empty pages array', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfDeletePages.run([input], { pages: [] }, makeCtx()),
    ).rejects.toThrow();
  });

  it('respects abort signal', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfDeletePages.run([input], { pages: [] }, makeCtx(true)),
    ).rejects.toThrow('Aborted');
  });
});
