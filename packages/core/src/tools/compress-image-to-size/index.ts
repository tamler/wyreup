import type { ToolModule, ToolRunContext } from '../../types.js';
import type { CompressImageToSizeParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { CompressImageToSizeParams } from './types.js';
export { defaultCompressImageToSizeParams } from './types.js';

interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const MIN_QUALITY = 20;
const MAX_QUALITY = 95;
const MAX_DOWNSCALE_ROUNDS = 8;

/** Box-average downscale by a factor < 1 — env-agnostic, no canvas. */
function downscale(img: RawImage, factor: number): RawImage {
  const width = Math.max(1, Math.round(img.width * factor));
  const height = Math.max(1, Math.round(img.height * factor));
  const out = new Uint8ClampedArray(width * height * 4);
  const xRatio = img.width / width;
  const yRatio = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * yRatio)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * xRatio)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const idx = (sy * img.width + sx) * 4;
          r += img.data[idx]!;
          g += img.data[idx + 1]!;
          b += img.data[idx + 2]!;
          a += img.data[idx + 3]!;
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { data: out, width, height };
}

export const compressImageToSize: ToolModule<CompressImageToSizeParams> = {
  id: 'compress-image-to-size',
  slug: 'compress-image-to-size',
  name: 'Compress to Target Size',
  description:
    'Compress a JPG, PNG, or WebP down to a target file size in KB — for passport photos, visa forms, and upload limits. A PNG over the target is converted to JPEG to reach it.',
  llmDescription:
    'Compress an image to fit a target file size in kilobytes (e.g. "under 100 KB for a government form"). Binary-searches quality, then optionally downscales dimensions. Params: targetKb (default 200), allowDownscale (default true). Inputs already under the target pass through unchanged.',
  category: 'optimize',
  keywords: ['compress', 'kb', 'target', 'size', 'passport', 'visa', 'upload', 'limit', 'shrink'],

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

  defaults: { targetKb: 200, allowDownscale: true },

  paramSchema: {
    targetKb: {
      type: 'number',
      label: 'target size (KB)',
      min: 10,
      max: 10240,
      step: 10,
      help: 'The output file will be at or under this many kilobytes when reachable.',
    },
    allowDownscale: {
      type: 'boolean',
      label: 'allow downscaling',
      help: 'Shrink the image dimensions when quality reduction alone cannot reach the target.',
    },
  },

  async run(
    inputs: File[],
    params: CompressImageToSizeParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const targetKb = params.targetKb ?? 200;
    const allowDownscale = params.allowDownscale ?? true;
    const targetBytes = targetKb * 1024;
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
          `Unsupported input format "${input.type}". compress-image-to-size accepts image/jpeg, image/png, and image/webp.`,
        );
      }

      // Already small enough: never touch the bytes.
      if (input.size <= targetBytes) {
        outputs.push(new Blob([await input.arrayBuffer()], { type: mimeFor(sourceFormat) }));
        continue;
      }

      // Lossless PNG can rarely hit a small byte target; search in JPEG instead.
      const searchFormat: ImageFormat = sourceFormat === 'png' ? 'jpeg' : sourceFormat;

      const buffer = await input.arrayBuffer();
      const sourceCodec = await getCodec(sourceFormat);
      const decodedRaw = await sourceCodec.decode(buffer);
      let image: RawImage = orientImageData(buffer, input.type, decodedRaw);
      const codec = await getCodec(searchFormat);

      let best: ArrayBuffer | null = null;
      for (let round = 0; round <= MAX_DOWNSCALE_ROUNDS; round++) {
        if (ctx.signal.aborted) throw new Error('Aborted');
        // Binary-search the highest quality that fits the target.
        let lo = MIN_QUALITY;
        let hi = MAX_QUALITY;
        let fit: ArrayBuffer | null = null;
        let smallest: ArrayBuffer | null = null;
        while (lo <= hi) {
          const q = Math.floor((lo + hi) / 2);
          const encoded = await codec.encode(image, { quality: q });
          if (!smallest || encoded.byteLength < smallest.byteLength) smallest = encoded;
          if (encoded.byteLength <= targetBytes) {
            fit = encoded;
            lo = q + 1;
          } else {
            hi = q - 1;
          }
        }
        if (fit) {
          best = fit;
          break;
        }
        best = smallest;
        if (!allowDownscale) break;
        ctx.onProgress({
          stage: 'processing',
          percent: Math.floor(((i + 0.5) / inputs.length) * 100),
          message: `Quality floor still over ${targetKb} KB — downscaling ${input.name}`,
        });
        image = downscale(image, 0.85);
      }

      if (!best) throw new Error(`Could not encode ${input.name}.`);
      if (best.byteLength > targetBytes) {
        ctx.onProgress({
          stage: 'processing',
          percent: Math.floor(((i + 0.9) / inputs.length) * 100),
          message: `${input.name}: target ${targetKb} KB not reachable — returning smallest achieved (${Math.ceil(best.byteLength / 1024)} KB)`,
        });
      }
      outputs.push(new Blob([best], { type: mimeFor(searchFormat) }));
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
