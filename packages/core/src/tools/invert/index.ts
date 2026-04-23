import type { ToolModule, ToolRunContext } from '../../types.js';
import type { InvertParams } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { InvertParams } from './types.js';
export { defaultInvertParams } from './types.js';

const InvertComponentStub = (): unknown => null;

export const invert: ToolModule<InvertParams> = {
  id: 'invert',
  slug: 'invert',
  name: 'Invert',
  description: 'Invert the colors of images.',
  category: 'edit',
  presence: 'both',
  keywords: ['invert', 'negate', 'negative', 'colors'],

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

  defaults: {},

  Component: InvertComponentStub,

  async run(
    inputs: File[],
    _params: InvertParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Inverting ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(`Unsupported format "${input.type}".`);
      }

      const buffer = await input.arrayBuffer();
      const codec = await getCodec(sourceFormat);
      const decodedRaw = await codec.decode(buffer);
      const { data, width, height } = orientImageData(buffer, input.type, decodedRaw);

      const out = new Uint8ClampedArray(data.length);
      for (let p = 0; p < data.length; p += 4) {
        out[p] = 255 - data[p]!;
        out[p + 1] = 255 - data[p + 1]!;
        out[p + 2] = 255 - data[p + 2]!;
        out[p + 3] = data[p + 3]!;
      }

      const encoded = await codec.encode({ data: out, width, height }, { quality: 90 });
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
