import type { ToolModule, ToolRunContext } from '../../types.js';
import type { StripExifParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { StripExifParams } from './types.js';
export { defaultStripExifParams } from './types.js';

/**
 * Strip EXIF metadata by re-encoding the image at near-lossless quality (95).
 * Because jSquash decodes to raw pixel data (no metadata), the re-encode
 * necessarily has no EXIF, GPS, or camera metadata. Visually indistinguishable
 * from the input at quality 95.
 */
export const stripExif: ToolModule<StripExifParams> = {
  id: 'strip-exif',
  slug: 'strip-exif',
  name: 'Strip EXIF Metadata',
  description: 'Remove EXIF metadata (including GPS, camera model, timestamps) by re-encoding at near-lossless quality.',
  category: 'privacy',
  keywords: ['strip', 'exif', 'metadata', 'privacy', 'gps', 'location', 'remove'],

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

  defaults: {},

  async run(
    inputs: File[],
    _params: StripExifParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const outputs: Blob[] = [];
    const STRIP_QUALITY = 95;

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Stripping ${input.name} (${i + 1}/${inputs.length})`,
      });

      const format = detectFormat(input.type);
      if (!format) {
        throw new Error(
          `Unsupported input format "${input.type}". strip-exif accepts image/jpeg, image/png, and image/webp.`,
        );
      }

      const buffer = await input.arrayBuffer();
      const codec = await getCodec(format);
      const decodedRaw = await codec.decode(buffer);
      // Bake the EXIF orientation into pixels before stripping — otherwise
      // phone portrait photos end up sideways after metadata strip.
      const decoded = orientImageData(buffer, input.type, decodedRaw);
      const encoded = await codec.encode(decoded, { quality: STRIP_QUALITY });

      outputs.push(new Blob([encoded], { type: mimeFor(format) }));
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
