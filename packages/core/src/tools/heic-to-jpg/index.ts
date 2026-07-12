import type { ToolModule, ToolRunContext } from '../../types.js';
import type { HeicToJpgParams } from './types.js';
import { getCodec, type ImageFormat } from '../../lib/codecs.js';

export type { HeicToJpgParams } from './types.js';
export { defaultHeicToJpgParams } from './types.js';

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    callback: (result: unknown) => void,
  ): void;
  free?: () => void;
}

interface LibHeifModule {
  HeifDecoder: new () => { decode(buffer: ArrayBuffer | Uint8Array): HeifImage[] };
}

async function loadLibheif(): Promise<LibHeifModule> {
  // The wasm-bundle build inlines the .wasm payload, so it loads the same
  // way in the browser and in node without a separate binary fetch.
  const mod = (await import('libheif-js/wasm-bundle.js')) as
    | LibHeifModule
    | { default: LibHeifModule };
  return (mod as { default?: LibHeifModule }).default ?? (mod as LibHeifModule);
}

async function decodeHeic(buffer: ArrayBuffer): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const libheif = await loadLibheif();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buffer));
  if (!images || images.length === 0) {
    throw new Error('Not a decodable HEIC/HEIF image.');
  }
  const image = images[0]!;
  const width = image.get_width();
  const height = image.get_height();
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
  await new Promise<void>((resolve, reject) => {
    image.display(target, (result) => {
      if (result) resolve();
      else reject(new Error('HEIC decode failed while rendering pixels.'));
    });
  });
  for (const img of images) img.free?.();
  return target;
}

export const heicToJpg: ToolModule<HeicToJpgParams> = {
  id: 'heic-to-jpg',
  slug: 'heic-to-jpg',
  name: 'HEIC to JPG',
  description:
    'Convert iPhone HEIC/HEIF photos to JPG, PNG, or WebP so every other image tool (and every website) can use them.',
  llmDescription:
    'Convert HEIC/HEIF (iPhone photo format) to JPEG, PNG, or WebP. Use when an image tool or upload form rejects .heic files. Params: format (jpeg|png|webp, default jpeg), quality (1-100, default 90).',
  category: 'convert',
  keywords: ['heic', 'heif', 'iphone', 'convert', 'jpg', 'jpeg', 'png', 'webp', 'apple', 'photo'],

  input: {
    accept: ['image/heic', 'image/heif'],
    min: 1,
    sizeLimit: 200 * 1024 * 1024,
  },
  output: {
    mime: 'image/*',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: { format: 'jpeg', quality: 90 },

  paramSchema: {
    format: {
      type: 'enum',
      label: 'output format',
      options: [
        { value: 'jpeg', label: 'JPEG (photos, smallest)' },
        { value: 'png', label: 'PNG (lossless)' },
        { value: 'webp', label: 'WebP (modern, small)' },
      ],
    },
    quality: {
      type: 'range',
      label: 'quality',
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
      help: 'Applies to JPEG and WebP output. Higher = better quality, bigger file.',
    },
  },

  async run(inputs: File[], params: HeicToJpgParams, ctx: ToolRunContext): Promise<Blob[]> {
    const format: ImageFormat = params.format ?? 'jpeg';
    const quality = params.quality ?? 90;
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Decoding ${input.name} (${i + 1}/${inputs.length})`,
      });

      const decoded = await decodeHeic(await input.arrayBuffer());

      ctx.onProgress({
        stage: 'encoding',
        percent: Math.floor(((i + 0.5) / inputs.length) * 100),
        message: `Encoding ${input.name} as ${format}`,
      });

      const codec = await getCodec(format);
      const encoded = await codec.encode(decoded, { quality });
      outputs.push(new Blob([encoded], { type: mimeFor(format) }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['photo.heic'],
    weird: [],
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
