import type { ToolModule, ToolRunContext } from '../../types.js';
import type { CropParams } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { CropParams } from './types.js';
export { defaultCropParams } from './types.js';

export const crop: ToolModule<CropParams> = {
  id: 'crop',
  slug: 'crop',
  name: 'Crop',
  description: 'Crop a rectangular region from an image.',
  category: 'edit',
  keywords: ['crop', 'trim', 'cut', 'region', 'clip'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/*',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  },

  async run(
    inputs: File[],
    params: CropParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const { x, y, width, height } = params;

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Decoding image' });

    const sourceFormat = detectFormat(input.type);
    if (!sourceFormat) {
      throw new Error(`Unsupported format "${input.type}".`);
    }

    if (width <= 0 || height <= 0) {
      throw new Error(`Crop dimensions must be positive (got width=${width}, height=${height}).`);
    }

    if (x < 0 || y < 0) {
      throw new Error(`Crop offset must be non-negative (got x=${x}, y=${y}).`);
    }

    const buffer = await input.arrayBuffer();
    const codec = await getCodec(sourceFormat);
    const decodedRaw = await codec.decode(buffer);
    const { data, width: srcW, height: srcH } = orientImageData(buffer, input.type, decodedRaw);

    if (x + width > srcW || y + height > srcH) {
      throw new Error(
        `Crop box (x=${x}, y=${y}, width=${width}, height=${height}) exceeds source dimensions (${srcW}x${srcH}).`,
      );
    }

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Cropping' });

    const out = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      const srcRow = y + row;
      for (let col = 0; col < width; col++) {
        const srcCol = x + col;
        const srcIdx = (srcRow * srcW + srcCol) * 4;
        const dstIdx = (row * width + col) * 4;
        out[dstIdx] = data[srcIdx]!;
        out[dstIdx + 1] = data[srcIdx + 1]!;
        out[dstIdx + 2] = data[srcIdx + 2]!;
        out[dstIdx + 3] = data[srcIdx + 3]!;
      }
    }

    ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Encoding output' });

    const encoded = await codec.encode({ data: out, width, height }, { quality: 90 });
    const mime = input.type === 'image/jpg' ? 'image/jpeg' : input.type;

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([encoded], { type: mime });
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: [],
    expectedOutputMime: ['image/jpeg', 'image/png'],
  },
};
