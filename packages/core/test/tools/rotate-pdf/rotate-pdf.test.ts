import { describe, it, expect } from 'vitest';
import { rotatePdf } from '../../../src/tools/rotate-pdf/index.js';
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

async function loadPdfPages(blob: Blob): Promise<Array<{ rotationAngle: number }>> {
  // Dynamically import pdf-lib to inspect output
  const { PDFDocument } = await import('pdf-lib');
  const buf = await blob.arrayBuffer();
  const doc = await PDFDocument.load(buf);
  return doc.getPages().map((p) => ({ rotationAngle: p.getRotation().angle }));
}

describe('rotate-pdf — metadata', () => {
  it('has id "rotate-pdf" and category "pdf"', () => {
    expect(rotatePdf.id).toBe('rotate-pdf');
    expect(rotatePdf.category).toBe('pdf');
  });

  it('accepts application/pdf only, min 1, max 1', () => {
    expect(rotatePdf.input.accept).toEqual(['application/pdf']);
    expect(rotatePdf.input.min).toBe(1);
    expect(rotatePdf.input.max).toBe(1);
  });

  it('output mime is application/pdf', () => {
    expect(rotatePdf.output.mime).toBe('application/pdf');
  });
});

describe('rotate-pdf — run()', () => {
  it('rotates all pages of a PDF by 90 degrees', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await rotatePdf.run([input], { degrees: 90, pages: 'all' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');

    const pages = await loadPdfPages(blob);
    expect(pages.length).toBe(3);
    for (const page of pages) {
      expect(page.rotationAngle).toBe(90);
    }
  });

  it('rotates only odd pages (1, 3) when pages: "odd"', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await rotatePdf.run([input], { degrees: 90, pages: 'odd' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const pages = await loadPdfPages(blob);
    // 3-page PDF: pages 1 and 3 (indices 0, 2) should be rotated; page 2 (index 1) should not
    expect(pages[0]!.rotationAngle).toBe(90);
    expect(pages[1]!.rotationAngle).toBe(0);
    expect(pages[2]!.rotationAngle).toBe(90);
  });

  it('rotates only even pages (2) when pages: "even"', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await rotatePdf.run([input], { degrees: 180, pages: 'even' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const pages = await loadPdfPages(blob);
    expect(pages[0]!.rotationAngle).toBe(0);
    expect(pages[1]!.rotationAngle).toBe(180);
    expect(pages[2]!.rotationAngle).toBe(0);
  });

  it('rotates specific pages when pages: "1,3"', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await rotatePdf.run([input], { degrees: 270, pages: '1,3' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const pages = await loadPdfPages(blob);
    expect(pages[0]!.rotationAngle).toBe(270);
    expect(pages[1]!.rotationAngle).toBe(0);
    expect(pages[2]!.rotationAngle).toBe(270);
  });

  it('throws for invalid degrees (not 90/180/270)', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      rotatePdf.run([input], { degrees: 45 as any, pages: 'all' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('throws for invalid pages spec', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      rotatePdf.run([input], { degrees: 90, pages: 'not-a-page' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('output is a valid PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await rotatePdf.run([input], { degrees: 180, pages: 'all' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF magic
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  });
});
