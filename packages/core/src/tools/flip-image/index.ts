import type { ToolModule, ToolRunContext } from '../../types.js';
import type { FlipImageParams } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { FlipImageParams } from './types.js';
export { defaultFlipImageParams } from './types.js';

const FlipImageComponentStub = (): unknown => null;

export const flipImage: ToolModule<FlipImageParams> = {
  id: 'flip-image',
  slug: 'flip-image',
  name: 'Flip Image',
  description: 'Flip images horizontally or vertically.',
  category: 'edit',
  presence: 'both',
  keywords: ['flip', 'mirror', 'reflect', 'horizontal', 'vertical'],

  input: {
    accept: ['image/*'],
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

  defaults: { direction: 'horizontal' },

  paramSchema: {
    direction: {
      type: 'enum',
      label: 'direction',
      options: [
        { value: 'horizontal', label: 'horizontal (mirror left/right)' },
        { value: 'vertical', label: 'vertical (mirror top/bottom)' },
      ],
    },
  },

  Component: FlipImageComponentStub,

  async run(
    inputs: File[],
    params: FlipImageParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { direction } = params;
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Flipping ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(`Unsupported format "${input.type}".`);
      }

      const buffer = await input.arrayBuffer();
      const codec = await getCodec(sourceFormat);
      const decodedRaw = await codec.decode(buffer);
      const { data, width, height } = orientImageData(buffer, input.type, decodedRaw);

      const flipped =
        direction === 'horizontal'
          ? flipHorizontal(data, width, height)
          : flipVertical(data, width, height);

      const encoded = await codec.encode(
        { data: flipped, width, height },
        { quality: 90 },
      );

      const mime = input.type === 'image/jpg' ? 'image/jpeg' : input.type;
      outputs.push(new Blob([encoded], { type: mime }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['image/jpeg', 'image/png'],
  },
};

function flipHorizontal(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const destIdx = (y * width + (width - 1 - x)) * 4;
      out[destIdx] = data[srcIdx]!;
      out[destIdx + 1] = data[srcIdx + 1]!;
      out[destIdx + 2] = data[srcIdx + 2]!;
      out[destIdx + 3] = data[srcIdx + 3]!;
    }
  }
  return out;
}

function flipVertical(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const destIdx = ((height - 1 - y) * width + x) * 4;
      out[destIdx] = data[srcIdx]!;
      out[destIdx + 1] = data[srcIdx + 1]!;
      out[destIdx + 2] = data[srcIdx + 2]!;
      out[destIdx + 3] = data[srcIdx + 3]!;
    }
  }
  return out;
}
