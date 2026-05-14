import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ImageInfoParams, ImageInfoResult } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';
import { decodeJpegOrientation } from '../../lib/exif.js';

export type { ImageInfoParams, ImageInfoResult } from './types.js';
export { defaultImageInfoParams } from './types.js';

export const imageInfo: ToolModule<ImageInfoParams> = {
  id: 'image-info',
  slug: 'image-info',
  name: 'Image Info',
  description: 'Extract dimensions, format, and metadata from an image.',
  category: 'inspect',
  keywords: ['info', 'dimensions', 'metadata', 'width', 'height', 'inspect'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  async run(
    inputs: File[],
    _params: ImageInfoParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Decoding image' });

    const sourceFormat = detectFormat(input.type);
    if (!sourceFormat) {
      throw new Error(`Unsupported format "${input.type}".`);
    }

    const buffer = await input.arrayBuffer();
    const codec = await getCodec(sourceFormat);
    const decoded = await codec.decode(buffer);
    // Swap width/height when EXIF orientation indicates a 90° rotation so
    // image-info reports dimensions as the image would actually display.
    const orientation = input.type.includes('jpeg') || input.type.includes('jpg')
      ? decodeJpegOrientation(buffer)
      : 1;
    const swapDims = orientation >= 5;
    const width = swapDims ? decoded.height : decoded.width;
    const height = swapDims ? decoded.width : decoded.height;

    const bytes = buffer.byteLength;
    const ratio = aspectRatio(width, height);
    const megapixels = Math.round((width * height) / 1_000_000 * 100) / 100;

    const result: ImageInfoResult = {
      format: sourceFormat,
      mimeType: input.type,
      width,
      height,
      aspectRatio: ratio,
      bytes,
      megapixels,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['application/json'],
  },
};

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function aspectRatio(width: number, height: number): string {
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}
