import { describe, it, expect } from 'vitest';
import { imageToAscii, imageToAsciiArt } from '../../../src/tools/image-to-ascii/index.js';
import { loadFixture } from '../../lib/load-fixture.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('image-to-ascii — metadata', () => {
  it('has id image-to-ascii', () => {
    expect(imageToAsciiArt.id).toBe('image-to-ascii');
  });
  it('is in the convert category', () => {
    expect(imageToAsciiArt.category).toBe('convert');
  });
  it('outputs text/plain', () => {
    expect(imageToAsciiArt.output.mime).toBe('text/plain');
  });
  it('declares free cost', () => {
    expect(imageToAsciiArt.cost).toBe('free');
  });
});

describe('imageToAscii — output shape', () => {
  it('produces ASCII output for a real image', async () => {
    const file = loadFixture('photo.jpg', 'image/jpeg');
    const out = await imageToAscii(file, { width: 40 });
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThan(0);
    // Every line should be exactly the configured width.
    expect(lines[0]!.length).toBe(40);
  });

  it('respects custom width', async () => {
    const file = loadFixture('graphic.png', 'image/png');
    const out = await imageToAscii(file, { width: 60 });
    expect(out.split('\n')[0]!.length).toBe(60);
  });

  it('uses blocks ramp when requested', async () => {
    const file = loadFixture('graphic.png', 'image/png');
    const out = await imageToAscii(file, { width: 20, ramp: 'blocks' });
    // Should only contain unicode block chars (or spaces).
    const allowed = new Set([' ', '░', '▒', '▓', '█', '\n']);
    for (const ch of out) {
      expect(allowed.has(ch)).toBe(true);
    }
  });

  it('uses simple ramp when requested', async () => {
    const file = loadFixture('graphic.png', 'image/png');
    const out = await imageToAscii(file, { width: 20, ramp: 'simple' });
    const allowed = new Set([...' .:-=+*#%@\n']);
    for (const ch of out) {
      expect(allowed.has(ch)).toBe(true);
    }
  });
});

describe('imageToAsciiArt — run()', () => {
  it('returns a text/plain Blob', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = (await imageToAsciiArt.run([input], { width: 40 }, makeCtx())) as Blob[];
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('text/plain');
    const text = await outputs[0]!.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('rejects multiple inputs', async () => {
    const a = loadFixture('graphic.png', 'image/png');
    const b = loadFixture('photo.jpg', 'image/jpeg');
    await expect(imageToAsciiArt.run([a, b], {}, makeCtx())).rejects.toThrow();
  });
});
