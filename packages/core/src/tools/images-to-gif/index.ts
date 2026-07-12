import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ImagesToGifParams } from './types.js';
import { detectFormat, getCodec } from '../../lib/codecs.js';

export type { ImagesToGifParams } from './types.js';
export { defaultImagesToGifParams } from './types.js';

interface PixelImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type GifPalette = number[][];

interface GifEncoderInstance {
  writeFrame(
    indexed: Uint8Array,
    width: number,
    height: number,
    options: { palette: GifPalette; delay: number; repeat: number },
  ): void;
  finish(): void;
  bytes(): Uint8Array;
}

interface GifEncModule {
  GIFEncoder: () => GifEncoderInstance;
  quantize: (data: Uint8Array | Uint8ClampedArray, maxColors: number) => GifPalette;
  applyPalette: (data: Uint8Array | Uint8ClampedArray, palette: GifPalette) => Uint8Array;
}

const MIN_FRAME_DELAY_MS = 20;
const MAX_FRAME_DELAY_MS = 5_000;
const MAX_OUTPUT_PIXELS = 100_000_000;

export const imagesToGif: ToolModule<ImagesToGifParams> = {
  id: 'images-to-gif',
  slug: 'images-to-gif',
  name: 'Images to GIF',
  description:
    'Turn 2 to 50 JPG, PNG, or WebP images into an animated GIF in the order you add them.',
  llmDescription:
    'Create one animated GIF from 2 to 50 JPEG, PNG, or WebP still images. Input order becomes frame order. Set frameDelayMs (20-5000), loop, and an optional output width that preserves the first frame aspect ratio.',
  category: 'create',
  categories: ['create', 'media'],
  keywords: [
    'images',
    'gif',
    'animated gif',
    'animation',
    'frames',
    'photos',
    'jpeg',
    'png',
    'webp',
  ],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    min: 2,
    max: 50,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'image/gif' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',

  defaults: {
    frameDelayMs: 500,
    loop: true,
    width: 0,
  },

  paramSchema: {
    frameDelayMs: {
      type: 'number',
      label: 'frame delay',
      help: 'How long each image stays visible before advancing to the next frame.',
      min: MIN_FRAME_DELAY_MS,
      max: MAX_FRAME_DELAY_MS,
      step: 10,
      unit: 'ms',
    },
    loop: {
      type: 'boolean',
      label: 'loop animation',
      help: 'Repeat forever when enabled; play the animation once when disabled.',
    },
    width: {
      type: 'number',
      label: 'output width',
      help: "Width in pixels. Use 0 to keep the first frame's width.",
      min: 0,
      step: 1,
      unit: 'px',
    },
  },

  async run(inputs: File[], params: ImagesToGifParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length < 2 || inputs.length > 50) {
      throw new Error(
        `Images to GIF requires between 2 and 50 input images (got ${inputs.length}).`,
      );
    }

    const frameDelayMs = params.frameDelayMs ?? 500;
    const loop = params.loop ?? true;
    const width = params.width ?? 0;
    assertIntegerInRange(frameDelayMs, MIN_FRAME_DELAY_MS, MAX_FRAME_DELAY_MS, 'frameDelayMs');
    if (typeof loop !== 'boolean') throw new Error('loop must be a boolean.');
    if (!Number.isInteger(width) || width < 0) {
      throw new Error(`width must be a non-negative integer (got ${width}).`);
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    const decoded: PixelImage[] = [];
    for (let index = 0; index < inputs.length; index++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const input = inputs[index]!;
      const format = detectFormat(input.type);
      if (!format) {
        throw new Error(`Unsupported input format "${input.type}" for ${input.name}.`);
      }
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((index / inputs.length) * 45),
        message: `Decoding ${input.name} (${index + 1}/${inputs.length})`,
      });
      const codec = await getCodec(format);
      decoded.push(await codec.decode(await input.arrayBuffer()));
    }

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Normalizing frames' });
    const frames = normalizeGifFrames(decoded, width);

    ctx.onProgress({ stage: 'loading-deps', percent: 60, message: 'Loading GIF encoder' });
    // gifenc does not publish TypeScript declarations, but its runtime exports are documented.
    // @ts-expect-error -- gifenc 1.0.3 ships JavaScript without a declaration file.
    const gifenc = (await import('gifenc')) as unknown as GifEncModule;
    const encoder = gifenc.GIFEncoder();

    for (let index = 0; index < frames.length; index++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const frame = frames[index]!;
      ctx.onProgress({
        stage: 'encoding',
        percent: 60 + Math.floor((index / frames.length) * 38),
        message: `Encoding frame ${index + 1}/${frames.length}`,
      });
      const palette = gifenc.quantize(frame.data, 256);
      const indexed = gifenc.applyPalette(frame.data, palette);
      encoder.writeFrame(indexed, frame.width, frame.height, {
        palette,
        delay: frameDelayMs,
        repeat: loop ? 0 : -1,
      });
    }

    encoder.finish();
    const bytes: Uint8Array = encoder.bytes();
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png', 'photo.webp'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['image/gif'],
  },
};

/**
 * Scale and center stills in a common opaque-black frame without relying on canvas.
 * The first image defines the output aspect ratio and a width of zero keeps its width.
 */
export function normalizeGifFrames(
  frames: readonly PixelImage[],
  requestedWidth = 0,
): PixelImage[] {
  if (frames.length === 0) throw new Error('At least one frame is required for normalization.');
  if (!Number.isInteger(requestedWidth) || requestedWidth < 0) {
    throw new Error(`width must be a non-negative integer (got ${requestedWidth}).`);
  }

  for (const frame of frames) assertValidFrame(frame);
  const first = frames[0]!;
  const outputWidth = requestedWidth || first.width;
  const outputHeight = Math.max(1, Math.round((first.height * outputWidth) / first.width));
  if (outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
    throw new Error(
      `Output dimensions ${outputWidth}x${outputHeight} exceed the 100 megapixel limit.`,
    );
  }

  return frames.map((frame) => {
    const scale = Math.min(outputWidth / frame.width, outputHeight / frame.height);
    const scaledWidth = Math.max(1, Math.min(outputWidth, Math.round(frame.width * scale)));
    const scaledHeight = Math.max(1, Math.min(outputHeight, Math.round(frame.height * scale)));
    const scaled = boxAverageScale(frame, scaledWidth, scaledHeight);
    const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);

    // GIF has no useful full-alpha representation here, so establish an opaque black canvas.
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
    const startX = Math.floor((outputWidth - scaledWidth) / 2);
    const startY = Math.floor((outputHeight - scaledHeight) / 2);
    compositeOverBlack(data, outputWidth, scaled, startX, startY);
    return { data, width: outputWidth, height: outputHeight };
  });
}

function assertIntegerInRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got ${value}).`);
  }
}

function assertValidFrame(frame: PixelImage): void {
  if (!Number.isInteger(frame.width) || frame.width <= 0) {
    throw new Error(`Frame width must be a positive integer (got ${frame.width}).`);
  }
  if (!Number.isInteger(frame.height) || frame.height <= 0) {
    throw new Error(`Frame height must be a positive integer (got ${frame.height}).`);
  }
  if (frame.data.length !== frame.width * frame.height * 4) {
    throw new Error('Frame RGBA data length does not match its dimensions.');
  }
}

function boxAverageScale(source: PixelImage, width: number, height: number): PixelImage {
  if (source.width === width && source.height === height) return source;

  const data = new Uint8ClampedArray(width * height * 4);
  const xRatio = source.width / width;
  const yRatio = source.height / height;
  for (let y = 0; y < height; y++) {
    const sourceTop = y * yRatio;
    const sourceBottom = (y + 1) * yRatio;
    const sourceY0 = Math.floor(sourceTop);
    const sourceY1 = Math.min(source.height, Math.ceil(sourceBottom));
    for (let x = 0; x < width; x++) {
      const sourceLeft = x * xRatio;
      const sourceRight = (x + 1) * xRatio;
      const sourceX0 = Math.floor(sourceLeft);
      const sourceX1 = Math.min(source.width, Math.ceil(sourceRight));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let totalWeight = 0;
      for (let sourceY = sourceY0; sourceY < sourceY1; sourceY++) {
        const yWeight = Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY);
        for (let sourceX = sourceX0; sourceX < sourceX1; sourceX++) {
          const xWeight = Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX);
          const weight = xWeight * yWeight;
          const sourceOffset = (sourceY * source.width + sourceX) * 4;
          red += source.data[sourceOffset]! * weight;
          green += source.data[sourceOffset + 1]! * weight;
          blue += source.data[sourceOffset + 2]! * weight;
          alpha += source.data[sourceOffset + 3]! * weight;
          totalWeight += weight;
        }
      }
      const outputOffset = (y * width + x) * 4;
      data[outputOffset] = red / totalWeight;
      data[outputOffset + 1] = green / totalWeight;
      data[outputOffset + 2] = blue / totalWeight;
      data[outputOffset + 3] = alpha / totalWeight;
    }
  }
  return { data, width, height };
}

function compositeOverBlack(
  destination: Uint8ClampedArray,
  destinationWidth: number,
  source: PixelImage,
  startX: number,
  startY: number,
): void {
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sourceOffset = (y * source.width + x) * 4;
      const destinationOffset = ((startY + y) * destinationWidth + startX + x) * 4;
      const alpha = source.data[sourceOffset + 3]! / 255;
      destination[destinationOffset] = source.data[sourceOffset]! * alpha;
      destination[destinationOffset + 1] = source.data[sourceOffset + 1]! * alpha;
      destination[destinationOffset + 2] = source.data[sourceOffset + 2]! * alpha;
      destination[destinationOffset + 3] = 255;
    }
  }
}
