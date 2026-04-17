import { describe, it, expect } from 'vitest';
import { pdfRedact } from '../../../src/tools/pdf-redact/index.js';
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

describe('pdf-redact — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfRedact.id).toBe('pdf-redact');
    expect(pdfRedact.category).toBe('edit');
  });

  it('output mime is application/pdf', () => {
    expect(pdfRedact.output.mime).toBe('application/pdf');
  });

  it('description mentions underlying text limitation', () => {
    expect(pdfRedact.description).toContain('Underlying text');
  });
});

describe('pdf-redact — run()', () => {
  it('draws a black rectangle on a PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfRedact.run(
      [input],
      { rectangles: [{ page: 1, x: 50, y: 50, width: 100, height: 50 }] },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('handles multi-page redactions', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfRedact.run(
      [input],
      {
        rectangles: [
          { page: 1, x: 10, y: 10, width: 50, height: 30 },
          { page: 3, x: 20, y: 20, width: 80, height: 40 },
        ],
      },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });

  it('respects custom color', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfRedact.run(
      [input],
      {
        rectangles: [{ page: 1, x: 0, y: 0, width: 100, height: 100 }],
        color: [1, 1, 1],
      },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });

  it('throws when rectangles is empty', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfRedact.run([input], { rectangles: [] }, makeCtx()),
    ).rejects.toThrow('rectangles must not be empty');
  });

  it('throws for out-of-bounds page reference', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfRedact.run(
        [input],
        { rectangles: [{ page: 99, x: 0, y: 0, width: 10, height: 10 }] },
        makeCtx(),
      ),
    ).rejects.toThrow();
  });
});
