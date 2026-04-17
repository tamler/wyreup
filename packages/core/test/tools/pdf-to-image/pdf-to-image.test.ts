import { describe, it, expect } from 'vitest';
import { pdfToImage } from '../../../src/tools/pdf-to-image/index.js';
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

describe('pdf-to-image — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfToImage.id).toBe('pdf-to-image');
    expect(pdfToImage.category).toBe('convert');
  });

  it('output is multiple images', () => {
    expect((pdfToImage.output as any).multiple).toBe(true);
  });
});

describe('pdf-to-image — run()', () => {
  it('renders a PDF to PNG by default', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfToImage.run([input], {}, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    expect(blobs.length).toBeGreaterThan(0);
    expect(blobs[0]!.type).toBe('image/png');
  });

  it('renders a multi-page PDF to multiple images', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfToImage.run([input], { format: 'png' }, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    expect(blobs.length).toBe(3);
  });

  it('respects page range param', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfToImage.run([input], { pages: [1, 2] }, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    expect(blobs.length).toBe(2);
  });

  it('respects dpi (higher dpi = larger image)', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const low = await pdfToImage.run([input], { dpi: 72, format: 'png' }, makeCtx());
    const high = await pdfToImage.run([input], { dpi: 300, format: 'png' }, makeCtx());
    const lowBlobs = Array.isArray(low) ? low : [low];
    const highBlobs = Array.isArray(high) ? high : [high];
    // Higher DPI should produce a larger file
    expect(highBlobs[0]!.size).toBeGreaterThan(lowBlobs[0]!.size);
  });

  it('respects format param', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfToImage.run([input], { format: 'jpeg' }, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    expect(blobs[0]!.type).toBe('image/jpeg');
  });

  it('respects abort between pages', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      pdfToImage.run([input], { format: 'png' }, makeCtx(true)),
    ).rejects.toThrow('Aborted');
  });
});
