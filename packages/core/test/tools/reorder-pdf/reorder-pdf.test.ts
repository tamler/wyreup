import { describe, it, expect } from 'vitest';
import { reorderPdf } from '../../../src/tools/reorder-pdf/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function getPageCount(blob: Blob): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const buf = await blob.arrayBuffer();
  const doc = await PDFDocument.load(buf);
  return doc.getPageCount();
}

describe('reorder-pdf — metadata', () => {
  it('has id "reorder-pdf" and category "pdf"', () => {
    expect(reorderPdf.id).toBe('reorder-pdf');
    expect(reorderPdf.category).toBe('pdf');
  });

  it('accepts application/pdf only, min 1, max 1', () => {
    expect(reorderPdf.input.accept).toEqual(['application/pdf']);
    expect(reorderPdf.input.min).toBe(1);
    expect(reorderPdf.input.max).toBe(1);
  });

  it('output mime is application/pdf', () => {
    expect(reorderPdf.output.mime).toBe('application/pdf');
  });
});

describe('reorder-pdf — run()', () => {
  it('reverses a 3-page PDF with order "3,2,1" and produces 3 pages', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await reorderPdf.run([input], { order: '3,2,1' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const count = await getPageCount(blob);
    expect(count).toBe(3);
  });

  it('drops pages not listed: "1,3" from a 3-page doc produces 2 pages', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await reorderPdf.run([input], { order: '1,3' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const count = await getPageCount(blob);
    expect(count).toBe(2);
  });

  it('duplicates pages when order has repeats: "1,1,1" produces 3 pages', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await reorderPdf.run([input], { order: '1,1,1' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const count = await getPageCount(blob);
    expect(count).toBe(3);
  });

  it('throws when order references a page out of range', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      reorderPdf.run([input], { order: '1,99' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('throws for empty order', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      reorderPdf.run([input], { order: '' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('output is a valid PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await reorderPdf.run([input], { order: '1' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  });
});
