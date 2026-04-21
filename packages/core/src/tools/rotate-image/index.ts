import type { ToolModule, ToolRunContext } from '../../types.js';
import type { RotateImageParams } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';

export type { RotateImageParams } from './types.js';
export { defaultRotateImageParams } from './types.js';

const RotateImageComponentStub = (): unknown => null;

export const rotateImage: ToolModule<RotateImageParams> = {
  id: 'rotate-image',
  slug: 'rotate-image',
  name: 'Rotate Image',
  description: 'Rotate images by 90, 180, or 270 degrees.',
  category: 'edit',
  presence: 'both',
  keywords: ['rotate', 'turn', 'orientation', 'angle'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/*',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { degrees: 90 },

  Component: RotateImageComponentStub,

  async run(
    inputs: File[],
    params: RotateImageParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { degrees } = params;

    if (degrees !== 90 && degrees !== 180 && degrees !== 270) {
      throw new Error(`Invalid degrees "${String(degrees)}". Must be 90, 180, or 270.`);
    }

    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Rotating ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(`Unsupported format "${input.type}".`);
      }

      const buffer = await input.arrayBuffer();
      const codec = await getCodec(sourceFormat);
      const { data, width, height } = await codec.decode(buffer);

      const rotated = rotatePx(data, width, height, degrees);

      const newWidth = degrees === 180 ? width : height;
      const newHeight = degrees === 180 ? height : width;

      const encoded = await codec.encode(
        { data: rotated, width: newWidth, height: newHeight },
        { quality: 90 },
      );

      const mime = input.type === 'image/jpg' ? 'image/jpeg' : input.type;
      outputs.push(new Blob([encoded], { type: mime }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png', 'photo.webp'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

function rotatePx(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  degrees: 90 | 180 | 270,
): Uint8ClampedArray {
  const newWidth = degrees === 180 ? width : height;
  const newHeight = degrees === 180 ? height : width;
  const out = new Uint8ClampedArray(newWidth * newHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      let destX: number;
      let destY: number;

      if (degrees === 90) {
        destX = height - 1 - y;
        destY = x;
      } else if (degrees === 180) {
        destX = width - 1 - x;
        destY = height - 1 - y;
      } else {
        // 270
        destX = y;
        destY = width - 1 - x;
      }

      const destIdx = (destY * newWidth + destX) * 4;
      out[destIdx] = data[srcIdx]!;
      out[destIdx + 1] = data[srcIdx + 1]!;
      out[destIdx + 2] = data[srcIdx + 2]!;
      out[destIdx + 3] = data[srcIdx + 3]!;
    }
  }

  return out;
}
