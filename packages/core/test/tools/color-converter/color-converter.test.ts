import { describe, it, expect } from 'vitest';
import { colorConverter } from '../../../src/tools/color-converter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { ColorConverterResult } from '../../../src/tools/color-converter/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function convert(colorStr: string): Promise<ColorConverterResult> {
  const input = new File([colorStr], 'color.txt', { type: 'text/plain' });
  const [out] = await colorConverter.run([input], {}, makeCtx()) as Blob[];
  return JSON.parse(await out!.text()) as ColorConverterResult;
}

describe('color-converter — metadata', () => {
  it('has id color-converter', () => {
    expect(colorConverter.id).toBe('color-converter');
  });

  it('is in the inspect category', () => {
    expect(colorConverter.category).toBe('inspect');
  });

  it('accepts text/plain', () => {
    expect(colorConverter.input.accept).toContain('text/plain');
  });
});

describe('color-converter — run()', () => {
  it('parses hex color #ff0000', async () => {
    const result = await convert('#ff0000');
    expect(result.valid).toBe(true);
    expect(result.hex).toBe('#ff0000');
    expect(result.rgb.r).toBe(255);
    expect(result.rgb.g).toBe(0);
    expect(result.rgb.b).toBe(0);
  });

  it('parses rgb string', async () => {
    const result = await convert('rgb(0, 128, 255)');
    expect(result.valid).toBe(true);
    expect(result.rgb.r).toBe(0);
    expect(result.rgb.g).toBe(128);
    expect(result.rgb.b).toBe(255);
    expect(result.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('parses hsl string', async () => {
    const result = await convert('hsl(120, 100%, 50%)');
    expect(result.valid).toBe(true);
    expect(result.hsl.h).toBeCloseTo(120, 0);
    expect(result.hsl.s).toBeCloseTo(100, 0);
    expect(result.hsl.l).toBeCloseTo(50, 0);
  });

  it('parses oklch string', async () => {
    const result = await convert('oklch(0.7 0.15 180)');
    expect(result.valid).toBe(true);
    expect(result.oklch.l).toBeCloseTo(0.7, 2);
    expect(result.oklch.c).toBeCloseTo(0.15, 2);
    expect(result.oklch.h).toBeCloseTo(180, 0);
  });

  it('returns valid:false for garbage input without throwing', async () => {
    const result = await convert('not-a-color-xyz-999');
    expect(result.valid).toBe(false);
  });

  it('returns oklch and oklab fields for valid colors', async () => {
    const result = await convert('#0000ff');
    expect(result.valid).toBe(true);
    expect(typeof result.oklch.l).toBe('number');
    expect(typeof result.oklab.l).toBe('number');
    expect(result.oklchString).toContain('oklch(');
  });
});
