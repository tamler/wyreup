import { describe, it, expect } from 'vitest';
import { convert } from '../../../src/tools/convert/index.js';
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

describe('convert — metadata', () => {
  it('has id "convert" and category "convert"', () => {
    expect(convert.id).toBe('convert');
    expect(convert.category).toBe('convert');
  });

  it('accepts image MIME patterns', () => {
    expect(convert.input.accept).toContain('image/jpeg');
    expect(convert.input.accept).toContain('image/png');
    expect(convert.input.accept).toContain('image/webp');
  });

  it('has defaults with targetFormat webp', () => {
    expect(convert.defaults.targetFormat).toBe('webp');
  });
});

describe('convert — run()', () => {
  it('converts JPEG to PNG', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await convert.run([input], { targetFormat: 'png' }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/png');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('converts PNG to JPEG', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await convert.run([input], { targetFormat: 'jpeg', quality: 85 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/jpeg');
  });

  it('converts PNG to WebP', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await convert.run([input], { targetFormat: 'webp' }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/webp');
  });

  it('processes multiple files in batch', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');
    const outputs = await convert.run([a, b], { targetFormat: 'webp' }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(2);
    expect(blobs[0]!.type).toBe('image/webp');
    expect(blobs[1]!.type).toBe('image/webp');
  });

  it('throws for unsupported input type', async () => {
    const fakePdf = new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' });
    await expect(
      convert.run([fakePdf], { targetFormat: 'jpeg' }, makeCtx()),
    ).rejects.toThrow(/unsupported|format/i);
  });

  it('respects abort signal', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const controller = new AbortController();
    controller.abort();
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: controller.signal,
      cache: new Map(),
      executionId: 'abort',
    };
    await expect(convert.run([input], { targetFormat: 'png' }, ctx)).rejects.toThrow();
  });
});
