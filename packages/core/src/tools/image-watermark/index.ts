import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ImageWatermarkParams } from './types.js';
import { detectFormat } from '../../lib/codecs.js';
import { loadImage, createCanvas, canvasToBlob } from '../../lib/canvas.js';

export type { ImageWatermarkParams } from './types.js';
export { defaultImageWatermarkParams } from './types.js';

export const imageWatermark: ToolModule<ImageWatermarkParams> = {
  id: 'image-watermark',
  slug: 'image-watermark',
  name: 'Image Watermark',
  description: 'Overlay a text watermark onto images.',
  category: 'edit',
  keywords: ['watermark', 'text', 'overlay', 'branding', 'label'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
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
    text: '',
    position: 'bottom-right',
    color: '#FFFFFF',
    opacity: 0.5,
    fontSize: 32,
    margin: 20,
    quality: 90,
  },

  paramSchema: {
    text: {
      type: 'string',
      label: 'watermark text',
      placeholder: 'Copyright 2025',
    },
    position: {
      type: 'enum',
      label: 'position',
      options: [
        { value: 'top-left', label: 'Top left' },
        { value: 'top-right', label: 'Top right' },
        { value: 'center', label: 'Center' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'bottom-right', label: 'Bottom right' },
      ],
    },
    opacity: {
      type: 'range',
      label: 'opacity',
      min: 0,
      max: 1,
      step: 0.05,
    },
    fontSize: {
      type: 'number',
      label: 'font size',
      min: 8,
      max: 256,
      step: 1,
      unit: 'px',
    },
    quality: {
      type: 'range',
      label: 'output quality',
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
    },
  },

  async run(
    inputs: File[],
    params: ImageWatermarkParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const {
      text,
      position = 'bottom-right',
      color = '#FFFFFF',
      opacity = 0.5,
      fontSize = 32,
      margin = 20,
      quality = 90,
    } = params;

    if (!text || text.trim().length === 0) {
      throw new Error('text param must not be empty.');
    }

    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 90),
        message: `Watermarking ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(`Unsupported format "${input.type}".`);
      }

      const sourceImage = await loadImage(input);
      const { width, height } = sourceImage;

      const canvas = await createCanvas(width, height);
      const ctx2d = canvas.getContext('2d');

      // Draw source image
      ctx2d.drawImage(sourceImage, 0, 0);

      // Set text style
      ctx2d.font = `${fontSize}px sans-serif`;
      ctx2d.fillStyle = color;
      ctx2d.globalAlpha = opacity;

      // Measure text
      const textWidth = ctx2d.measureText(text).width;
      const textHeight = fontSize;

      // Compute position
      let x: number;
      let y: number;

      switch (position) {
        case 'top-left':
          x = margin;
          y = margin + textHeight;
          break;
        case 'top-right':
          x = width - textWidth - margin;
          y = margin + textHeight;
          break;
        case 'bottom-left':
          x = margin;
          y = height - margin;
          break;
        case 'center':
          x = (width - textWidth) / 2;
          y = (height + textHeight) / 2;
          break;
        case 'bottom-right':
        default:
          x = width - textWidth - margin;
          y = height - margin;
          break;
      }

      ctx2d.fillText(text, x, y);

      const mime = input.type === 'image/jpg' ? 'image/jpeg' : input.type;
      const blob = await canvasToBlob(canvas, mime, quality / 100);
      outputs.push(blob);
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: [],
    expectedOutputMime: ['image/jpeg', 'image/png'],
  },
};
