import type { ToolModule, ToolRunContext } from '../../types.js';
import type { CompressParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { CompressParams } from './types.js';
export { defaultCompressParams } from './types.js';

/**
 * Placeholder UI component. Consuming surfaces (web, cli, mcp) provide
 * their own UIs for this tool. Full "one component, four surfaces" pattern
 * arrives in later waves with the editor.
 */
const CompressComponentStub = (): unknown => null;

export const compress: ToolModule<CompressParams> = {
  id: 'compress',
  slug: 'compress',
  name: 'Compress',
  description: 'Reduce image file size by re-encoding at a lower quality.',
  category: 'optimize',
  presence: 'both',
  keywords: ['compress', 'shrink', 'reduce', 'optimize', 'smaller', 'quality'],

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

  defaults: { quality: 80 },

  paramSchema: {
    quality: {
      type: 'range',
      label: 'quality',
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
      help: 'Lower quality = smaller file size.',
    },
  },

  Component: CompressComponentStub,

  async run(
    inputs: File[],
    params: CompressParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { quality, targetFormat } = params;
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) {
        throw new Error('Aborted');
      }

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Processing ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(
          `Unsupported input format "${input.type}". compress accepts image/jpeg, image/png, and image/webp.`,
        );
      }

      const outputFormat: ImageFormat = targetFormat ?? sourceFormat;

      const buffer = await input.arrayBuffer();
      const sourceCodec = await getCodec(sourceFormat);
      const decodedRaw = await sourceCodec.decode(buffer);
      const decoded = orientImageData(buffer, input.type, decodedRaw);

      if (ctx.signal.aborted) {
        throw new Error('Aborted');
      }

      ctx.onProgress({
        stage: 'encoding',
        percent: Math.floor(((i + 0.5) / inputs.length) * 100),
        message: `Encoding ${input.name}`,
      });

      const targetCodec = await getCodec(outputFormat);
      const encoded = await targetCodec.encode(decoded, { quality });

      outputs.push(new Blob([encoded], { type: mimeFor(outputFormat) }));
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
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
  }
}
