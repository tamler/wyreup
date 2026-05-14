import type { ToolModule, ToolRunContext } from '../../types.js';
import type { SepiaParams } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { SepiaParams } from './types.js';
export { defaultSepiaParams } from './types.js';

export const sepia: ToolModule<SepiaParams> = {
  id: 'sepia',
  slug: 'sepia',
  name: 'Sepia',
  description: 'Apply a warm sepia tone to images.',
  category: 'edit',
  keywords: ['sepia', 'vintage', 'warm', 'tone', 'filter'],

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

  async run(
    inputs: File[],
    _params: SepiaParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Applying sepia to ${input.name} (${i + 1}/${inputs.length})`,
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
        const r = data[p]!;
        const g = data[p + 1]!;
        const b = data[p + 2]!;
        out[p] = Math.min(255, Math.round(0.393 * r + 0.769 * g + 0.189 * b));
        out[p + 1] = Math.min(255, Math.round(0.349 * r + 0.686 * g + 0.168 * b));
        out[p + 2] = Math.min(255, Math.round(0.272 * r + 0.534 * g + 0.131 * b));
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
