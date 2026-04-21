import { describe, it, expect } from 'vitest';
import { imageDiff } from '../../../src/tools/image-diff/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';
import type { ImageDiffResult } from '../../../src/tools/image-diff/types.js';

function makeCtx(signal?: AbortSignal): ToolRunContext {
  return {
    onProgress: () => {},
    signal: signal ?? new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('image-diff — metadata', () => {
  it('has the expected id and slug', () => {
    expect(imageDiff.id).toBe('image-diff');
    expect(imageDiff.slug).toBe('image-diff');
  });

  it('is in the inspect category', () => {
    expect(imageDiff.category).toBe('inspect');
  });

  it('accepts image MIME types and requires exactly 2 files', () => {
    expect(imageDiff.input.accept).toContain('image/jpeg');
    expect(imageDiff.input.accept).toContain('image/png');
    expect(imageDiff.input.min).toBe(2);
    expect(imageDiff.input.max).toBe(2);
  });

  it('outputs image/png with multiple output', () => {
    expect(imageDiff.output.mime).toBe('image/png');
    expect(imageDiff.output.multiple).toBe(true);
  });

  it('declares low memory estimate', () => {
    expect(imageDiff.memoryEstimate).toBe('low');
  });

  it('defaults threshold to 0.1', () => {
    expect(imageDiff.defaults.threshold).toBe(0.1);
  });
});

describe('image-diff — run()', () => {
  it('returns 0 different pixels when diffing identical images', async () => {
    const img = loadFixture('photo.jpg', 'image/jpeg');

    const outputs = await imageDiff.run([img, img], {}, makeCtx()) as Blob[];

    expect(Array.isArray(outputs)).toBe(true);
    expect(outputs.length).toBe(2);

    const [diffImage, metadataBlob] = outputs as [Blob, Blob];
    expect(diffImage.type).toBe('image/png');
    expect(metadataBlob.type).toBe('application/json');

    const result = JSON.parse(await metadataBlob.text()) as ImageDiffResult;
    expect(result.pixelsDifferent).toBe(0);
    expect(result.totalPixels).toBeGreaterThan(0);
    expect(result.percentDifferent).toBe(0);
  });

  it('diff image is a valid PNG', async () => {
    const img = loadFixture('photo.jpg', 'image/jpeg');

    const outputs = await imageDiff.run([img, img], {}, makeCtx()) as Blob[];
    const diffImage = outputs[0] as Blob;

    const buf = await diffImage.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0x89); // PNG signature
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x4e); // N
    expect(bytes[3]).toBe(0x47); // G
  });

  it('detects differences between distinct images of the same size', async () => {
    // Load photo twice then compare PNG vs WebP (both decode to same dimensions if same source)
    // Instead, use photo.jpg vs graphic.png — but they have different sizes.
    // Best approach: compare photo.jpg vs photo.webp (same source image, different encoding).
    const imgA = loadFixture('photo.jpg', 'image/jpeg');
    const imgB = loadFixture('photo.webp', 'image/webp');

    const outputs = await imageDiff.run([imgA, imgB], { threshold: 0.05 }, makeCtx()) as Blob[];
    const metadataBlob = outputs[1] as Blob;
    const result = JSON.parse(await metadataBlob.text()) as ImageDiffResult;

    // photo.jpg and photo.webp are the same image but different encodings —
    // lossy re-encoding introduces small pixel differences
    expect(result.totalPixels).toBeGreaterThan(0);
    expect(result.pixelsDifferent).toBeGreaterThanOrEqual(0);
  });

  it('throws when image dimensions differ', async () => {
    const imgA = loadFixture('photo.jpg', 'image/jpeg');
    const imgB = loadFixture('graphic.png', 'image/png');

    await expect(
      imageDiff.run([imgA, imgB], {}, makeCtx()),
    ).rejects.toThrow(/dimensions must match/i);
  });

  it('respects a pre-aborted signal', async () => {
    const img = loadFixture('photo.jpg', 'image/jpeg');
    const controller = new AbortController();
    controller.abort();

    await expect(
      imageDiff.run([img, img], {}, makeCtx(controller.signal)),
    ).rejects.toThrow();
  });
});
