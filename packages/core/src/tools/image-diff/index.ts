import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ImageDiffParams, ImageDiffResult } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';

export type { ImageDiffParams, ImageDiffResult } from './types.js';
export { defaultImageDiffParams } from './types.js';

const ImageDiffComponentStub = (): unknown => null;

export const imageDiff: ToolModule<ImageDiffParams> = {
  id: 'image-diff',
  slug: 'image-diff',
  name: 'Image Diff',
  description: 'Pixel-level diff between two images of the same dimensions.',
  category: 'inspect',
  presence: 'both',
  keywords: ['diff', 'compare', 'pixel', 'difference', 'inspect'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 2,
    max: 2,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/png',
    multiple: true,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    threshold: 0.1,
    diffColor: [255, 0, 0],
  },

  Component: ImageDiffComponentStub,

  async run(
    inputs: File[],
    params: ImageDiffParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const threshold = params.threshold ?? 0.1;
    const diffColor = params.diffColor ?? [255, 0, 0];

    const [fileA, fileB] = inputs as [File, File];

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Decoding first image' });

    const formatA = detectFormat(fileA.type);
    if (!formatA) {
      throw new Error(`Unsupported format for first image: "${fileA.type}"`);
    }
    const formatB = detectFormat(fileB.type);
    if (!formatB) {
      throw new Error(`Unsupported format for second image: "${fileB.type}"`);
    }

    const [codecA, codecB] = await Promise.all([getCodec(formatA), getCodec(formatB)]);

    const [bufA, bufB] = await Promise.all([fileA.arrayBuffer(), fileB.arrayBuffer()]);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Decoding images' });

    const [imgA, imgB] = await Promise.all([codecA.decode(bufA), codecB.decode(bufB)]);

    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      throw new Error(
        `Image dimensions must match. First image is ${imgA.width}x${imgA.height}, second is ${imgB.width}x${imgB.height}.`,
      );
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Computing pixel diff' });

    const { default: pixelmatch } = await import('pixelmatch');

    const { width, height } = imgA;
    const totalPixels = width * height;
    const diffData = new Uint8ClampedArray(totalPixels * 4);

    const pixelsDifferent = pixelmatch(
      imgA.data,
      imgB.data,
      diffData,
      width,
      height,
      {
        threshold,
        diffColor,
      },
    );

    ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Encoding diff image' });

    const pngCodec = await getCodec('png');
    const diffImageBuffer = await pngCodec.encode(
      { data: diffData, width, height },
      {},
    );

    const percentDifferent = totalPixels > 0 ? (pixelsDifferent / totalPixels) * 100 : 0;

    const result: ImageDiffResult = {
      pixelsDifferent,
      totalPixels,
      percentDifferent,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

    return [
      new Blob([diffImageBuffer], { type: 'image/png' }),
      new Blob([JSON.stringify(result)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};
