import { describe, it, expect } from 'vitest';
import { stripExif } from '../../../src/tools/strip-exif/index.js';
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

describe('strip-exif — metadata', () => {
  it('has id "strip-exif" and category "privacy"', () => {
    expect(stripExif.id).toBe('strip-exif');
    expect(stripExif.category).toBe('privacy');
  });

  it('accepts image MIME patterns', () => {
    expect(stripExif.input.accept).toContain('image/jpeg');
    expect(stripExif.input.accept).toContain('image/png');
    expect(stripExif.input.accept).toContain('image/webp');
  });
});

describe('strip-exif — run()', () => {
  it('re-encodes a JPEG and preserves the JPEG type', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await stripExif.run([input], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('re-encodes a PNG and preserves the PNG type', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await stripExif.run([input], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/png');
  });

  it('processes multiple files in batch', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');
    const outputs = await stripExif.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(2);
  });

  it('throws for unsupported input type', async () => {
    const fakePdf = new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' });
    await expect(stripExif.run([fakePdf], {}, makeCtx())).rejects.toThrow(/unsupported|format/i);
  });
});
