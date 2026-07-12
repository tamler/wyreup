import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ImageCollageParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';
import { orientImageData } from '../../lib/exif.js';

export type { ImageCollageLayout, ImageCollageParams } from './types.js';
export { defaultImageCollageParams } from './types.js';

interface PixelImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const imageCollage: ToolModule<ImageCollageParams> = {
  id: 'image-collage',
  slug: 'image-collage',
  name: 'Image Collage',
  description:
    'Combine 2 to 20 images into one horizontal strip, vertical strip, or evenly sized grid.',
  llmDescription:
    'Combine 2 to 20 JPEG, PNG, or WebP images into one collage. Choose a horizontal strip, vertical strip, or N-column grid, plus spacing, background color, output format, and quality.',
  category: 'edit',
  keywords: ['image', 'collage', 'grid', 'combine', 'join', 'strip', 'photos', 'layout'],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    min: 2,
    max: 20,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/*',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',

  defaults: {
    layout: 'grid',
    columns: 2,
    spacing: 8,
    background: '#ffffff',
    format: 'jpeg',
    quality: 90,
  },

  paramSchema: {
    layout: {
      type: 'enum',
      label: 'layout',
      help: 'Arrange images in one row, one column, or a grid.',
      options: [
        { value: 'horizontal', label: 'Horizontal strip' },
        { value: 'vertical', label: 'Vertical strip' },
        { value: 'grid', label: 'Grid' },
      ],
    },
    columns: {
      type: 'number',
      label: 'columns',
      help: 'Number of columns used by grid layout.',
      min: 1,
      max: 6,
      step: 1,
    },
    spacing: {
      type: 'number',
      label: 'spacing',
      help: 'Blank space between collage cells in pixels.',
      min: 0,
      max: 64,
      step: 1,
      unit: 'px',
    },
    background: {
      type: 'string',
      label: 'background',
      help: 'Background and gap color as a hex value such as #ffffff.',
      placeholder: '#ffffff',
    },
    format: {
      type: 'enum',
      label: 'format',
      help: 'File format for the combined image.',
      options: [
        { value: 'jpeg', label: 'JPEG' },
        { value: 'png', label: 'PNG' },
        { value: 'webp', label: 'WebP' },
      ],
    },
    quality: {
      type: 'range',
      label: 'quality',
      help: 'Output quality for JPEG and WebP; PNG is lossless.',
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
    },
  },

  async run(inputs: File[], params: ImageCollageParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length < 2 || inputs.length > 20) {
      throw new Error(
        `Image collage requires between 2 and 20 input images (got ${inputs.length}).`,
      );
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    const layout = params.layout ?? 'grid';
    const columns = params.columns ?? 2;
    const spacing = params.spacing ?? 8;
    const background = params.background ?? '#ffffff';
    const format = params.format ?? 'jpeg';
    const quality = params.quality ?? 90;

    if (layout !== 'horizontal' && layout !== 'vertical' && layout !== 'grid') {
      throw new Error(`Unsupported collage layout "${String(layout)}".`);
    }
    assertIntegerInRange(columns, 1, 6, 'columns');
    assertIntegerInRange(spacing, 0, 64, 'spacing');
    assertIntegerInRange(quality, 1, 100, 'quality');
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
      throw new Error(`Unsupported output format "${String(format)}".`);
    }
    const backgroundRgb = parseHexColor(background);

    const decoded: PixelImage[] = [];
    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 50),
        message: `Decoding ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(`Unsupported input format "${input.type}" for ${input.name}.`);
      }
      const codec = await getCodec(sourceFormat);
      const buffer = await input.arrayBuffer();
      const decodedRaw = await codec.decode(buffer);
      decoded.push(orientImageData(buffer, input.type, decodedRaw));
    }

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'processing', percent: 55, message: 'Composing collage' });

    const cellWidth = Math.max(...decoded.map((image) => image.width));
    const scaledImages = decoded.map((image) =>
      scaleBilinear(
        image,
        cellWidth,
        Math.max(1, Math.round((image.height * cellWidth) / image.width)),
      ),
    );
    const cellHeight = Math.max(...scaledImages.map((image) => image.height));
    const columnCount =
      layout === 'horizontal'
        ? inputs.length
        : layout === 'vertical'
          ? 1
          : Math.min(columns, inputs.length);
    const rowCount = layout === 'vertical' ? inputs.length : Math.ceil(inputs.length / columnCount);
    const outputWidth = columnCount * cellWidth + (columnCount - 1) * spacing;
    const outputHeight = rowCount * cellHeight + (rowCount - 1) * spacing;
    const outputData = new Uint8ClampedArray(outputWidth * outputHeight * 4);

    fillBackground(outputData, backgroundRgb);
    for (let i = 0; i < scaledImages.length; i++) {
      const image = scaledImages[i]!;
      const column = i % columnCount;
      const row = Math.floor(i / columnCount);
      const targetX = column * (cellWidth + spacing);
      const targetY = row * (cellHeight + spacing) + Math.floor((cellHeight - image.height) / 2);
      compositeImage(outputData, outputWidth, image, targetX, targetY);
    }

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'encoding', percent: 85, message: `Encoding ${format.toUpperCase()}` });

    const outputCodec = await getCodec(format);
    const encoded = await outputCodec.encode(
      { data: outputData, width: outputWidth, height: outputHeight },
      { quality },
    );

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([encoded], { type: mimeFor(format) });
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png', 'photo.webp'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

function assertIntegerInRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got ${value}).`);
  }
}

function parseHexColor(input: string): Rgb {
  const value = input.trim();
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(value);
  const longMatch = /^#([0-9a-fA-F]{6})$/.exec(value);
  const hex = shortMatch
    ? shortMatch[1]!
        .split('')
        .map((character) => character + character)
        .join('')
    : longMatch?.[1];

  if (!hex) {
    throw new Error(`Invalid background color "${input}". Expected #rgb or #rrggbb.`);
  }

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function fillBackground(data: Uint8ClampedArray, color: Rgb): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
    data[offset + 3] = 255;
  }
}

function scaleBilinear(source: PixelImage, width: number, height: number): PixelImage {
  if (source.width === width && source.height === height) return source;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.max(
      0,
      Math.min(source.height - 1, ((y + 0.5) * source.height) / height - 0.5),
    );
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const yWeight = sourceY - y0;

    for (let x = 0; x < width; x++) {
      const sourceX = Math.max(
        0,
        Math.min(source.width - 1, ((x + 0.5) * source.width) / width - 0.5),
      );
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const targetOffset = (y * width + x) * 4;

      for (let channel = 0; channel < 4; channel++) {
        const topLeft = source.data[(y0 * source.width + x0) * 4 + channel]!;
        const topRight = source.data[(y0 * source.width + x1) * 4 + channel]!;
        const bottomLeft = source.data[(y1 * source.width + x0) * 4 + channel]!;
        const bottomRight = source.data[(y1 * source.width + x1) * 4 + channel]!;
        const top = topLeft + (topRight - topLeft) * xWeight;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
        data[targetOffset + channel] = Math.round(top + (bottom - top) * yWeight);
      }
    }
  }
  return { data, width, height };
}

function compositeImage(
  target: Uint8ClampedArray,
  targetWidth: number,
  source: PixelImage,
  targetX: number,
  targetY: number,
): void {
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sourceOffset = (y * source.width + x) * 4;
      const targetOffset = ((targetY + y) * targetWidth + targetX + x) * 4;
      const alpha = source.data[sourceOffset + 3]! / 255;

      for (let channel = 0; channel < 3; channel++) {
        target[targetOffset + channel] = Math.round(
          source.data[sourceOffset + channel]! * alpha +
            target[targetOffset + channel]! * (1 - alpha),
        );
      }
      target[targetOffset + 3] = 255;
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
