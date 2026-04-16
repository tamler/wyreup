import { describe, it, expect } from 'vitest';
import { imageToPdf } from '../../../src/tools/image-to-pdf/index.js';
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

describe('image-to-pdf — metadata', () => {
  it('has id "image-to-pdf" and category "export"', () => {
    expect(imageToPdf.id).toBe('image-to-pdf');
    expect(imageToPdf.category).toBe('export');
  });

  it('accepts jpeg and png (not webp — pdf-lib limitation)', () => {
    expect(imageToPdf.input.accept).toContain('image/jpeg');
    expect(imageToPdf.input.accept).toContain('image/png');
    expect(imageToPdf.input.accept).not.toContain('image/webp');
  });

  it('output mime is application/pdf (single file)', () => {
    expect(imageToPdf.output.mime).toBe('application/pdf');
  });
});

describe('image-to-pdf — run()', () => {
  it('produces a valid PDF from a single JPEG', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await imageToPdf.run([input], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('application/pdf');

    // Verify PDF magic bytes.
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  });

  it('combines multiple images into a multi-page PDF', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');
    const outputs = await imageToPdf.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.size).toBeGreaterThan(a.size);
  });

  it('throws for unsupported input type', async () => {
    const fakeHeic = new File([''], 'x.heic', { type: 'image/heic' });
    await expect(imageToPdf.run([fakeHeic], {}, makeCtx())).rejects.toThrow(/unsupported|format/i);
  });
});
