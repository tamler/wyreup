import type { ToolModule, ToolRunContext } from '../../types.js';
import type { PixelateRegionParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { PixelateRegionParams } from './types.js';
export { defaultPixelateRegionParams } from './types.js';

export const pixelateRegion: ToolModule<PixelateRegionParams> = {
  id: 'pixelate-region',
  slug: 'pixelate-region',
  name: 'Pixelate Region',
  description:
    'Pixelate a rectangular area of an image to obscure faces, license plates, addresses, or other sensitive details.',
  llmDescription:
    'Anonymize part or all of a JPEG, PNG, or WebP image with block pixelation. Set x, y, width, and height for a rectangle; width or height 0 pixelates the entire image. Larger blocks hide more detail.',
  category: 'privacy',
  categories: ['edit'],
  keywords: [
    'pixelate',
    'privacy',
    'anonymize',
    'redact',
    'hide face',
    'license plate',
    'blur',
    'mosaic',
  ],

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
  memoryEstimate: 'medium',

  defaults: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    blockSize: 16,
  },

  paramSchema: {
    x: {
      type: 'number',
      label: 'x',
      help: 'Horizontal position of the region in pixels from the left edge.',
      step: 1,
      unit: 'px',
    },
    y: {
      type: 'number',
      label: 'y',
      help: 'Vertical position of the region in pixels from the top edge.',
      step: 1,
      unit: 'px',
    },
    width: {
      type: 'number',
      label: 'width',
      help: 'Region width in pixels. A width or height of 0 pixelates the entire image.',
      min: 0,
      step: 1,
      unit: 'px',
    },
    height: {
      type: 'number',
      label: 'height',
      help: 'Region height in pixels. A width or height of 0 pixelates the entire image.',
      min: 0,
      step: 1,
      unit: 'px',
    },
    blockSize: {
      type: 'number',
      label: 'block size',
      help: 'Size of each pixel block. Bigger blocks provide stronger anonymization.',
      min: 4,
      max: 128,
      step: 1,
      unit: 'px',
    },
  },

  async run(inputs: File[], params: PixelateRegionParams, ctx: ToolRunContext): Promise<Blob[]> {
    const x = params.x ?? 0;
    const y = params.y ?? 0;
    const width = params.width ?? 0;
    const height = params.height ?? 0;
    const blockSize = params.blockSize ?? 16;

    assertFiniteNumber(x, 'x');
    assertFiniteNumber(y, 'y');
    assertFiniteNumber(width, 'width');
    assertFiniteNumber(height, 'height');
    if (width < 0 || height < 0) {
      throw new Error('width and height must be non-negative.');
    }
    if (!Number.isInteger(blockSize) || blockSize < 4 || blockSize > 128) {
      throw new Error(`blockSize must be an integer between 4 and 128 (got ${blockSize}).`);
    }

    const outputs: Blob[] = [];
    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 80),
        message: `Pixelating ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(`Unsupported input format "${input.type}" for ${input.name}.`);
      }
      const codec = await getCodec(sourceFormat);
      const buffer = await input.arrayBuffer();
      const decodedRaw = await codec.decode(buffer);
      const decoded = orientImageData(buffer, input.type, decodedRaw);
      const data = new Uint8ClampedArray(decoded.data);

      const region =
        width === 0 || height === 0
          ? { left: 0, top: 0, right: decoded.width, bottom: decoded.height }
          : {
              left: Math.max(0, Math.floor(x)),
              top: Math.max(0, Math.floor(y)),
              right: Math.min(decoded.width, Math.ceil(x + width)),
              bottom: Math.min(decoded.height, Math.ceil(y + height)),
            };

      if (region.left >= region.right || region.top >= region.bottom) {
        throw new Error('The pixelation region does not overlap the image.');
      }

      pixelate(data, decoded.width, region, blockSize);

      if (ctx.signal.aborted) throw new Error('Aborted');
      ctx.onProgress({
        stage: 'encoding',
        percent: Math.floor(((i + 0.8) / inputs.length) * 100),
        message: `Encoding ${input.name}`,
      });

      const encoded = await codec.encode(
        { data, width: decoded.width, height: decoded.height },
        { quality: 90 },
      );
      outputs.push(new Blob([encoded], { type: mimeFor(sourceFormat) }));
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

interface PixelRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
}

function pixelate(
  data: Uint8ClampedArray,
  imageWidth: number,
  region: PixelRegion,
  blockSize: number,
): void {
  for (let blockY = region.top; blockY < region.bottom; blockY += blockSize) {
    const blockBottom = Math.min(blockY + blockSize, region.bottom);
    for (let blockX = region.left; blockX < region.right; blockX += blockSize) {
      const blockRight = Math.min(blockX + blockSize, region.right);
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let alphaSum = 0;
      let pixelCount = 0;

      for (let y = blockY; y < blockBottom; y++) {
        for (let x = blockX; x < blockRight; x++) {
          const offset = (y * imageWidth + x) * 4;
          redSum += data[offset]!;
          greenSum += data[offset + 1]!;
          blueSum += data[offset + 2]!;
          alphaSum += data[offset + 3]!;
          pixelCount++;
        }
      }

      const average = [
        Math.round(redSum / pixelCount),
        Math.round(greenSum / pixelCount),
        Math.round(blueSum / pixelCount),
        Math.round(alphaSum / pixelCount),
      ] as const;
      for (let y = blockY; y < blockBottom; y++) {
        for (let x = blockX; x < blockRight; x++) {
          const offset = (y * imageWidth + x) * 4;
          data[offset] = average[0]!;
          data[offset + 1] = average[1]!;
          data[offset + 2] = average[2]!;
          data[offset + 3] = average[3]!;
        }
      }
    }
  }
}

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
