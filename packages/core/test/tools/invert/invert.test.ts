import { describe, it, expect } from 'vitest';
import { invert } from '../../../src/tools/invert/index.js';
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

describe('invert — metadata', () => {
  it('has id invert', () => {
    expect(invert.id).toBe('invert');
  });

  it('is in the edit category', () => {
    expect(invert.category).toBe('edit');
  });

  it('accepts image/*', () => {
    expect(invert.input.accept).toContain('image/*');
  });

  it('has no required params', () => {
    expect(Object.keys(invert.defaults)).toHaveLength(0);
  });
});

describe('invert — run()', () => {
  it('inverts a JPEG and returns a JPEG', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await invert.run([input], {}, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
    expect(outputs[0]!.size).toBeGreaterThan(0);
  });

  it('inverts a PNG and preserves dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await invert.run([input], {}, makeCtx());
    expect(outputs[0]!.type).toBe('image/png');

    const buf = await outputs[0]!.arrayBuffer();
    const { width, height } = await codec.decode(buf);
    expect(width).toBe(origW);
    expect(height).toBe(origH);
  });

  it('double-inverting a PNG produces approximately the original pixels', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const origBuf = await input.arrayBuffer();
    const orig = await codec.decode(origBuf);

    // invert once
    const once = await invert.run([input], {}, makeCtx());
    const onceFile = new File([once[0]!], 'once.png', { type: 'image/png' });

    // invert again
    const twice = await invert.run([onceFile], {}, makeCtx());
    const twiceBuf = await twice[0]!.arrayBuffer();
    const restored = await codec.decode(twiceBuf);

    // PNG is lossless — double invert should be exact
    expect(restored.width).toBe(orig.width);
    expect(restored.height).toBe(orig.height);
    let totalDiff = 0;
    for (let p = 0; p < orig.data.length; p += 4) {
      totalDiff +=
        Math.abs((orig.data[p] ?? 0) - (restored.data[p] ?? 0)) +
        Math.abs((orig.data[p + 1] ?? 0) - (restored.data[p + 1] ?? 0)) +
        Math.abs((orig.data[p + 2] ?? 0) - (restored.data[p + 2] ?? 0));
    }
    expect(totalDiff).toBe(0);
  });

  it('throws for unsupported format', async () => {
    const fakePdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    await expect(invert.run([fakePdf], {}, makeCtx())).rejects.toThrow(/unsupported/i);
  });
});
