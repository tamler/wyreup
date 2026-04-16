import { describe, it, expect } from 'vitest';
import { sepia } from '../../../src/tools/sepia/index.js';
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

describe('sepia — metadata', () => {
  it('has id sepia', () => {
    expect(sepia.id).toBe('sepia');
  });

  it('is in the edit category', () => {
    expect(sepia.category).toBe('edit');
  });

  it('accepts image/*', () => {
    expect(sepia.input.accept).toContain('image/*');
  });

  it('has no required params', () => {
    expect(Object.keys(sepia.defaults)).toHaveLength(0);
  });
});

describe('sepia — run()', () => {
  it('applies sepia to a JPEG and returns a JPEG', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await sepia.run([input], {}, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
    expect(outputs[0]!.size).toBeGreaterThan(0);
  });

  it('sepia output has warm tones (avg R > avg B)', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const codec = await getCodec('jpeg');

    const outputs = await sepia.run([input], {}, makeCtx());
    const buf = await outputs[0]!.arrayBuffer();
    const { data } = await codec.decode(buf);

    let totalR = 0;
    let totalB = 0;
    const pixelCount = data.length / 4;
    for (let p = 0; p < data.length; p += 4) {
      totalR += data[p] ?? 0;
      totalB += data[p + 2] ?? 0;
    }
    expect(totalR / pixelCount).toBeGreaterThan(totalB / pixelCount);
  });

  it('preserves image dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await sepia.run([input], {}, makeCtx());
    const buf = await outputs[0]!.arrayBuffer();
    const { width, height } = await codec.decode(buf);
    expect(width).toBe(origW);
    expect(height).toBe(origH);
  });

  it('throws for unsupported format', async () => {
    const fakePdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    await expect(sepia.run([fakePdf], {}, makeCtx())).rejects.toThrow(/unsupported/i);
  });
});
