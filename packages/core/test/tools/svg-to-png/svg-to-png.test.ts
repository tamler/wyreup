import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { svgToPng } from '../../../src/tools/svg-to-png/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

function loadFixture(name: string, mime: string): File {
  const buf = readFileSync(new URL(`../../fixtures/${name}`, import.meta.url));
  return new File([buf], name, { type: mime });
}

// PNG magic bytes: 0x89 0x50 0x4E 0x47
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47];

async function checkPngHeader(blob: Blob): Promise<boolean> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return PNG_HEADER.every((b, i) => buf[i] === b);
}

describe('svg-to-png — metadata', () => {
  it('has id svg-to-png', () => {
    expect(svgToPng.id).toBe('svg-to-png');
  });

  it('is in the convert category', () => {
    expect(svgToPng.category).toBe('convert');
  });

  it('accepts image/svg+xml', () => {
    expect(svgToPng.input.accept).toContain('image/svg+xml');
  });

  it('memoryEstimate is medium', () => {
    expect(svgToPng.memoryEstimate).toBe('medium');
  });
});

describe('svg-to-png — run()', () => {
  it('converts circle.svg to PNG with valid PNG header', async () => {
    const svgFile = loadFixture('circle.svg', 'image/svg+xml');
    const [out] = await svgToPng.run([svgFile], { scale: 1 }, makeCtx());
    expect(out).toBeDefined();
    expect(out!.type).toBe('image/png');
    expect(await checkPngHeader(out!)).toBe(true);
  });

  it('output has reasonable size (>100 bytes)', async () => {
    const svgFile = loadFixture('circle.svg', 'image/svg+xml');
    const [out] = await svgToPng.run([svgFile], {}, makeCtx());
    expect(out!.size).toBeGreaterThan(100);
  });

  it('scale=2 produces a larger output than scale=1', async () => {
    const svgFile1 = loadFixture('circle.svg', 'image/svg+xml');
    const svgFile2 = loadFixture('circle.svg', 'image/svg+xml');
    const [out1] = await svgToPng.run([svgFile1], { scale: 1 }, makeCtx());
    const [out2] = await svgToPng.run([svgFile2], { scale: 2 }, makeCtx());
    // Scaled image should be larger in bytes
    expect(out2!.size).toBeGreaterThan(out1!.size);
  });

  it('processes multiple SVGs in batch', async () => {
    const svgFile1 = loadFixture('circle.svg', 'image/svg+xml');
    const svgFile2 = loadFixture('circle.svg', 'image/svg+xml');
    const outputs = await svgToPng.run([svgFile1, svgFile2], {}, makeCtx());
    expect(outputs.length).toBe(2);
    for (const out of outputs) {
      expect(await checkPngHeader(out)).toBe(true);
    }
  });

  it('respects abort signal', async () => {
    const ac = new AbortController();
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: ac.signal,
      cache: new Map(),
      executionId: 'test',
    };
    ac.abort();
    const svgFile = loadFixture('circle.svg', 'image/svg+xml');
    // First file processes before abort check in loop — use 2 files
    const svgFile2 = loadFixture('circle.svg', 'image/svg+xml');
    await expect(svgToPng.run([svgFile, svgFile2], {}, ctx)).rejects.toThrow();
  });
});
