import { describe, it, expect } from 'vitest';
import { pdfCrop } from '../../../src/tools/pdf-crop/index.js';
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

describe('pdf-crop — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfCrop.id).toBe('pdf-crop');
    expect(pdfCrop.category).toBe('edit');
  });

  it('output mime is application/pdf', () => {
    expect(pdfCrop.output.mime).toBe('application/pdf');
  });
});

describe('pdf-crop — run()', () => {
  it('crops all pages with a uniform box', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfCrop.run(
      [input],
      { box: { x: 10, y: 10, width: 400, height: 500 } },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('crops specific pages with per-page boxes', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfCrop.run(
      [input],
      {
        box: [
          { page: 1, x: 0, y: 0, width: 400, height: 600 },
          { page: 2, x: 10, y: 10, width: 380, height: 560 },
        ],
      },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });

  it('throws for invalid dimensions (width = 0)', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfCrop.run([input], { box: { x: 0, y: 0, width: 0, height: 100 } }, makeCtx()),
    ).rejects.toThrow('width');
  });

  it('throws for out-of-bounds page reference in per-page mode', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfCrop.run(
        [input],
        { box: [{ page: 99, x: 0, y: 0, width: 100, height: 100 }] },
        makeCtx(),
      ),
    ).rejects.toThrow();
  });
});
