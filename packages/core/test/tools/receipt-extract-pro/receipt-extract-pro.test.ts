import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import { receiptExtractPro } from '../../../src/tools/receipt-extract-pro/index.js';
import { createCanvas, canvasToBlob } from '../../../src/lib/canvas.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'receipt-extract-pro-test',
    apiKey: 'wk_test_key',
    proOrigin: 'https://wyreup.test',
  };
}

const result = {
  engine: 'clairic',
  model: 'm',
  hasConfidence: true,
  truncated: false,
  fields: [],
  data: {},
};

function mockFetch() {
  const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentInput(fetchMock: ReturnType<typeof mockFetch>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]![1];
  return (JSON.parse(init.body as string) as { input: Record<string, unknown> }).input;
}

afterEach(() => vi.unstubAllGlobals());

describe('receipt-extract-pro', () => {
  it('is registered as a two-credit text and photo tool', () => {
    const tool = createDefaultRegistry().toolsById.get('receipt-extract-pro');
    expect(tool?.cost).toBe('credit');
    expect(tool?.creditCost).toBe(2);
    expect(tool?.input.accept).toEqual(['text/plain', 'image/png', 'image/jpeg', 'image/webp']);
    expect(tool?.input.max).toBe(4);
    expect(tool?.description).not.toMatch(/[–—]/);
  });

  it('sends trimmed text only', async () => {
    const fetchMock = mockFetch();
    const blob = (await receiptExtractPro.run(
      [new File(['  Total 9.72  '], 'r.txt', { type: 'text/plain' })],
      {},
      makeCtx(),
    )) as Blob;
    expect(sentInput(fetchMock)).toEqual({ text: 'Total 9.72' });
    expect(JSON.parse(await blob.text())).toEqual(result);
  });

  it('rejects text over the cap and mixed inputs before any upload', async () => {
    const fetchMock = mockFetch();
    await expect(
      receiptExtractPro.run(
        [new File(['x'.repeat(6001)], 'r.txt', { type: 'text/plain' })],
        {},
        makeCtx(),
      ),
    ).rejects.toThrow('over 6,000 characters');
    await expect(
      receiptExtractPro.run(
        [
          new File(['x'], 'r.txt', { type: 'text/plain' }),
          new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }),
        ],
        {},
        makeCtx(),
      ),
    ).rejects.toThrow('not both');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downscales photos to the shared pixel budget and sends JPEG data URLs', async () => {
    const fetchMock = mockFetch();
    const canvas = await createCanvas(2000, 1500);
    const png = await canvasToBlob(canvas, 'image/png');
    const files = [0, 1, 2].map((i) => new File([png], `p${i}.png`, { type: 'image/png' }));
    await receiptExtractPro.run(files, {}, makeCtx());
    const images = sentInput(fetchMock).images as string[];
    expect(images).toHaveLength(3);
    const perImage = Math.floor(1_800_000 / 3);
    for (const url of images) {
      expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
      const bytes = Uint8Array.from(atob(url.slice(23)), (c) => c.charCodeAt(0));
      // Find the SOF0 marker the encoder writes and check the pixel count.
      let i = 2;
      while (
        i < bytes.length &&
        !(bytes[i] === 0xff && bytes[i + 1]! >= 0xc0 && bytes[i + 1]! <= 0xc2)
      )
        i++;
      const h = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const w = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      expect(w * h).toBeLessThanOrEqual(perImage);
      expect(w / h).toBeCloseTo(2000 / 1500, 1);
    }
  });
});
