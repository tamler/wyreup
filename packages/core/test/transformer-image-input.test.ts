import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { imageSimilarity } from '../src/tools/image-similarity/index.js';
import { imageCaption } from '../src/tools/image-caption/index.js';
import { imageCaptionDetailed } from '../src/tools/image-caption-detailed/index.js';
import { ocrPro } from '../src/tools/ocr-pro/index.js';
import { upscale2x } from '../src/tools/upscale-2x/index.js';
import { bgRemove } from '../src/tools/bg-remove/index.js';
import { getPipeline } from '../src/lib/transformers.js';

vi.mock('../src/lib/transformers.js', () => ({ getPipeline: vi.fn() }));

describe('Transformers image input compatibility', () => {
  it.each([imageSimilarity, imageCaption, imageCaptionDetailed, ocrPro, upscale2x, bgRemove])(
    '$id passes decoded image pixels instead of Node-incompatible URL strings',
    async (tool) => {
      const bytes = await readFile(new URL('./fixtures/graphic.png', import.meta.url));
      const input = new File([bytes], 'graphic.png', { type: 'image/png' });
      const sentinel = new Error('decoded image reached pipeline');
      vi.mocked(getPipeline).mockResolvedValue((image: unknown) => {
        expect(typeof image).toBe('object');
        const pixels = image as { width: unknown; height: unknown; data: unknown };
        expect(pixels.width).toBe(400);
        expect(pixels.height).toBe(400);
        expect(pixels.data).toBeInstanceOf(Uint8ClampedArray);
        throw sentinel;
      });
      await expect(
        tool.run(
          tool.id === 'image-similarity' ? [input, input] : [input],
          {},
          {
            signal: new AbortController().signal,
            onProgress() {},
            cache: new Map(),
            executionId: 'image-input-test',
          },
        ),
      ).rejects.toThrow(sentinel);
    },
  );

  it('extracts image features and reports their cosine similarity', async () => {
    const bytes = await readFile(new URL('./fixtures/graphic.png', import.meta.url));
    const first = new File([bytes], 'first.png', { type: 'image/png' });
    const second = new File([bytes], 'second.png', { type: 'image/png' });
    const pipeline = vi.fn((image: unknown) => {
      expect(image).toMatchObject({ width: 400, height: 400 });
      return Promise.resolve({ data: new Float32Array([0.25, 0.75, 0.5]) });
    });
    vi.mocked(getPipeline).mockResolvedValue(pipeline);
    const result = await imageSimilarity.run([first, second], {}, {
      signal: new AbortController().signal, onProgress() {}, cache: new Map(), executionId: 'image-feature-test',
    });
    expect(getPipeline).toHaveBeenLastCalledWith(
      expect.anything(), 'image-feature-extraction', 'Xenova/clip-vit-base-patch16', { dtype: 'q8' },
    );
    expect(pipeline).toHaveBeenCalledTimes(2);
    const outputs = result as Blob[];
    expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
      pairwise: [{ a: 0, b: 1, cosine: 1 }], clusters: [[0, 1]],
    });
  });
});
