import { describe, it, expect } from 'vitest';
import { grayscale } from '../../../src/tools/grayscale/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';
import { getCodec } from '../../../src/lib/codecs.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('grayscale — metadata', () => {
  it('has id grayscale', () => {
    expect(grayscale.id).toBe('grayscale');
  });

  it('is in the edit category', () => {
    expect(grayscale.category).toBe('edit');
  });

  it('accepts image/*', () => {
    expect(grayscale.input.accept).toContain('image/*');
  });

  it('has no required params', () => {
    expect(Object.keys(grayscale.defaults)).toHaveLength(0);
  });
});

describe('grayscale — run()', () => {
  it('converts a JPEG to grayscale (R≈G≈B per pixel)', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const codec = await getCodec('jpeg');

    const outputs = await grayscale.run([input], {}, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');

    const buf = await outputs[0]!.arrayBuffer();
    const { data } = await codec.decode(buf);

    // Sample some pixels — all should have R≈G≈B (within lossy tolerance)
    let totalDiff = 0;
    const sampleCount = 50;
    const step = Math.floor(data.length / 4 / sampleCount) * 4;
    for (let p = 0; p < sampleCount * step; p += step) {
      const r = data[p] ?? 0;
      const g = data[p + 1] ?? 0;
      const b = data[p + 2] ?? 0;
      totalDiff += Math.abs(r - g) + Math.abs(g - b);
    }
    // Average diff should be small (lossy re-encoding may introduce slight deviation)
    expect(totalDiff / sampleCount).toBeLessThan(10);
  });

  it('preserves image dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await grayscale.run([input], {}, makeCtx());
    const buf = await outputs[0]!.arrayBuffer();
    const { width, height } = await codec.decode(buf);
    expect(width).toBe(origW);
    expect(height).toBe(origH);
  });

  it('throws for unsupported format', async () => {
    const fakePdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    await expect(grayscale.run([fakePdf], {}, makeCtx())).rejects.toThrow(/unsupported/i);
  });
});
