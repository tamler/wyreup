import { describe, it, expect } from 'vitest';
import { imageInfo } from '../../../src/tools/image-info/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { ImageInfoResult } from '../../../src/tools/image-info/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('image-info — metadata', () => {
  it('has id image-info', () => {
    expect(imageInfo.id).toBe('image-info');
  });

  it('is in the inspect category', () => {
    expect(imageInfo.category).toBe('inspect');
  });

  it('accepts exactly 1 image', () => {
    expect(imageInfo.input.min).toBe(1);
    expect(imageInfo.input.max).toBe(1);
  });

  it('outputs application/json', () => {
    expect(imageInfo.output.mime).toBe('application/json');
  });
});

describe('image-info — run()', () => {
  it('extracts dimensions and format from photo.jpg', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await imageInfo.run([input], {}, makeCtx()) as Blob[];
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('application/json');

    const json = JSON.parse(await outputs[0]!.text()) as ImageInfoResult;
    expect(json.format).toBe('jpeg');
    expect(json.mimeType).toBe('image/jpeg');
    expect(json.width).toBeGreaterThan(0);
    expect(json.height).toBeGreaterThan(0);
    expect(json.bytes).toBeGreaterThan(0);
    expect(json.megapixels).toBeGreaterThan(0);
    expect(json.aspectRatio).toMatch(/^\d+:\d+$/);
  });

  it('extracts dimensions from graphic.png', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await imageInfo.run([input], {}, makeCtx()) as Blob[];
    const json = JSON.parse(await outputs[0]!.text()) as ImageInfoResult;
    expect(json.format).toBe('png');
    expect(json.width).toBeGreaterThan(0);
    expect(json.height).toBeGreaterThan(0);
  });

  it('computes aspectRatio correctly using GCD', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await imageInfo.run([input], {}, makeCtx()) as Blob[];
    const json = JSON.parse(await outputs[0]!.text()) as ImageInfoResult;
    const [wStr, hStr] = json.aspectRatio.split(':');
    const w = parseInt(wStr!, 10);
    const h = parseInt(hStr!, 10);
    // The GCD of the ratio parts should be 1
    const g = gcd(w, h);
    expect(g).toBe(1);
  });

  it('throws for unsupported format', async () => {
    const fakePdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    await expect(imageInfo.run([fakePdf], {}, makeCtx())).rejects.toThrow(/unsupported/i);
  });
});

function gcd(a: number, b: number): number {
  while (b !== 0) { const t = b; b = a % b; a = t; }
  return a;
}
