import { describe, it, expect } from 'vitest';
import { colorPalette } from '../../../src/tools/color-palette/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';
import type { ColorPaletteResult } from '../../../src/tools/color-palette/types.js';

function makeCtx(signal?: AbortSignal): ToolRunContext {
  return {
    onProgress: () => {},
    signal: signal ?? new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('color-palette — metadata', () => {
  it('has the expected id and slug', () => {
    expect(colorPalette.id).toBe('color-palette');
    expect(colorPalette.slug).toBe('color-palette');
  });

  it('is in the inspect category', () => {
    expect(colorPalette.category).toBe('inspect');
  });

  it('accepts image MIME types', () => {
    expect(colorPalette.input.accept).toContain('image/jpeg');
    expect(colorPalette.input.accept).toContain('image/png');
    expect(colorPalette.input.accept).toContain('image/webp');
    expect(colorPalette.input.min).toBe(1);
    expect(colorPalette.input.max).toBe(1);
  });

  it('outputs application/json', () => {
    expect(colorPalette.output.mime).toBe('application/json');
  });

  it('declares low memory estimate', () => {
    expect(colorPalette.memoryEstimate).toBe('low');
  });

  it('defaults count to 5', () => {
    expect(colorPalette.defaults.count).toBe(5);
  });
});

describe('color-palette — run()', () => {
  it('returns a JSON blob with palette fields from a JPEG', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');

    const output = await colorPalette.run([input], { count: 5 }, makeCtx()) as Blob;

    expect(output).toBeInstanceOf(Blob);
    expect(output.type).toBe('application/json');

    const text = await output.text();
    const result: ColorPaletteResult = JSON.parse(text);

    expect(result).toHaveProperty('vibrant');
    expect(result).toHaveProperty('muted');
    expect(result).toHaveProperty('darkVibrant');
    expect(result).toHaveProperty('darkMuted');
    expect(result).toHaveProperty('lightVibrant');
    expect(result).toHaveProperty('lightMuted');
    expect(Array.isArray(result.topColors)).toBe(true);
  });

  it('topColors is an array of hex color strings', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');

    const output = await colorPalette.run([input], { count: 3 }, makeCtx()) as Blob;
    const result: ColorPaletteResult = JSON.parse(await output.text());

    expect(result.topColors.length).toBeGreaterThan(0);
    expect(result.topColors.length).toBeLessThanOrEqual(3);
    for (const hex of result.topColors) {
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('returns a non-null vibrant color for a colorful photo', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');

    const output = await colorPalette.run([input], {}, makeCtx()) as Blob;
    const result: ColorPaletteResult = JSON.parse(await output.text());

    // At least one named swatch should be non-null for a real photo
    const named = [result.vibrant, result.muted, result.darkVibrant, result.darkMuted, result.lightVibrant, result.lightMuted];
    const nonNull = named.filter(Boolean);
    expect(nonNull.length).toBeGreaterThan(0);
  });

  it('works on a PNG image', async () => {
    const input = loadFixture('graphic.png', 'image/png');

    const output = await colorPalette.run([input], { count: 5 }, makeCtx()) as Blob;
    const result: ColorPaletteResult = JSON.parse(await output.text());

    expect(Array.isArray(result.topColors)).toBe(true);
  });

  it('respects a pre-aborted signal', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const controller = new AbortController();
    controller.abort();

    await expect(
      colorPalette.run([input], {}, makeCtx(controller.signal)),
    ).rejects.toThrow();
  });
});
