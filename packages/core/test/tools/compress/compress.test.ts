import { describe, it, expect } from 'vitest';
import { compress } from '../../../src/tools/compress/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(signal?: AbortSignal): ToolRunContext {
  return {
    onProgress: () => {},
    signal: signal ?? new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('compress — metadata', () => {
  it('has the expected id and slug', () => {
    expect(compress.id).toBe('compress');
    expect(compress.slug).toBe('compress');
  });

  it('is in the optimize category', () => {
    expect(compress.category).toBe('optimize');
  });

  it('accepts image MIME patterns', () => {
    expect(compress.input.accept).toContain('image/jpeg');
    expect(compress.input.accept).toContain('image/png');
    expect(compress.input.accept).toContain('image/webp');
  });

  it('requires at least 1 file and has no upper bound', () => {
    expect(compress.input.min).toBe(1);
    expect(compress.input.max).toBeUndefined();
  });

  it('is batchable and free', () => {
    expect(compress.batchable).toBe(true);
    expect(compress.cost).toBe('free');
  });

  it('declares low memory estimate', () => {
    expect(compress.memoryEstimate).toBe('low');
  });

  it('is not interactive and not streaming in v1', () => {
    expect(compress.interactive).toBe(false);
    expect(compress.streaming ?? false).toBe(false);
  });

  it('has defaults including quality 80', () => {
    expect(compress.defaults.quality).toBe(80);
  });

  it('declares test fixtures', () => {
    expect(compress.__testFixtures.valid).toContain('photo.jpg');
    expect(compress.__testFixtures.valid).toContain('graphic.png');
    expect(compress.__testFixtures.valid).toContain('photo.webp');
    expect(compress.__testFixtures.weird).toContain('corrupted.jpg');
  });
});

describe('compress — run()', () => {
  it('compresses a JPEG to a smaller JPEG at quality 50', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const originalSize = input.size;

    const outputs = await compress.run([input], { quality: 50 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[0]!.size).toBeGreaterThan(0);
    expect(blobs[0]!.size).toBeLessThan(originalSize);
  });

  it('compresses a PNG and returns a PNG by default', async () => {
    const input = loadFixture('graphic.png', 'image/png');

    const outputs = await compress.run([input], { quality: 80 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/png');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('compresses a WebP to a smaller WebP at quality 50', async () => {
    const input = loadFixture('photo.webp', 'image/webp');
    const originalSize = input.size;

    const outputs = await compress.run([input], { quality: 50 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/webp');
    expect(blobs[0]!.size).toBeLessThan(originalSize);
  });

  it('re-encodes a JPEG as WebP when targetFormat is webp', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');

    const outputs = await compress.run(
      [input],
      { quality: 80, targetFormat: 'webp' },
      makeCtx(),
    );
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs[0]!.type).toBe('image/webp');
  });

  it('processes multiple files in batch and preserves their formats', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');

    const outputs = await compress.run([a, b], { quality: 80 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(2);
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[1]!.type).toBe('image/png');
  });

  it('throws a readable error for an unsupported input type', async () => {
    const fakePdf = new File(['%PDF-1.4 fake'], 'x.pdf', { type: 'application/pdf' });

    await expect(
      compress.run([fakePdf], { quality: 80 }, makeCtx()),
    ).rejects.toThrow(/unsupported|format|pdf/i);
  });

  it('throws for corrupted input', async () => {
    const input = loadFixture('corrupted.jpg', 'image/jpeg');

    await expect(
      compress.run([input], { quality: 80 }, makeCtx()),
    ).rejects.toThrow();
  });

  it('respects a pre-aborted signal', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const controller = new AbortController();
    controller.abort();

    await expect(
      compress.run([input], { quality: 80 }, makeCtx(controller.signal)),
    ).rejects.toThrow();
  });

  it('reports progress events during a batch', async () => {
    const events: Array<{ stage: string }> = [];
    const ctx: ToolRunContext = {
      onProgress: (p) => events.push({ stage: p.stage }),
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'progress-test',
    };

    const input = loadFixture('photo.jpg', 'image/jpeg');
    await compress.run([input, input], { quality: 80 }, ctx);

    expect(events.some((e) => e.stage === 'processing')).toBe(true);
    expect(events.some((e) => e.stage === 'done')).toBe(true);
  });
});
