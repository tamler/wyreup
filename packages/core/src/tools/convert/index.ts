import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ConvertParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';

export type { ConvertParams } from './types.js';
export { defaultConvertParams } from './types.js';

const ConvertComponentStub = (): unknown => null;

export const convert: ToolModule<ConvertParams> = {
  id: 'convert',
  slug: 'convert',
  name: 'Convert format',
  description: 'Convert images between JPEG, PNG, and WebP formats.',
  category: 'convert',
  presence: 'both',
  keywords: ['convert', 'format', 'change', 'transform', 'png', 'jpg', 'jpeg', 'webp'],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
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

  defaults: { targetFormat: 'webp', quality: 90 },

  Component: ConvertComponentStub,

  async run(
    inputs: File[],
    params: ConvertParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { targetFormat, quality = 90 } = params;
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Processing ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(
          `Unsupported input format "${input.type}". convert accepts image/jpeg, image/png, and image/webp.`,
        );
      }

      const buffer = await input.arrayBuffer();
      const sourceCodec = await getCodec(sourceFormat);
      const decoded = await sourceCodec.decode(buffer);

      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'encoding',
        percent: Math.floor(((i + 0.5) / inputs.length) * 100),
        message: `Encoding as ${targetFormat}`,
      });

      const targetCodec = await getCodec(targetFormat);
      const encoded = await targetCodec.encode(decoded, { quality });
      outputs.push(new Blob([encoded], { type: mimeFor(targetFormat) }));
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

function mimeFor(format: ImageFormat): string {
  switch (format) {
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
  }
}
