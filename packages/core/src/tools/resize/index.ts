import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ResizeParams } from './types.js';
import { detectFormat } from '../../lib/codecs.js';
import { loadImage, createCanvas, canvasToBlob } from '../../lib/canvas.js';

export type { ResizeParams } from './types.js';
export { defaultResizeParams } from './types.js';

const ResizeComponentStub = (): unknown => null;

export const resize: ToolModule<ResizeParams> = {
  id: 'resize',
  slug: 'resize',
  name: 'Resize',
  description: 'Resize images with exact dimensions, fit-within-box, or percent scaling.',
  category: 'edit',
  presence: 'both',
  keywords: ['resize', 'scale', 'dimensions', 'shrink', 'enlarge', 'fit'],

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
    mode: 'fit',
    width: 1920,
    height: 1080,
    quality: 90,
  },

  Component: ResizeComponentStub,

  async run(
    inputs: File[],
    params: ResizeParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { mode, quality = 90 } = params;

    if (mode === 'percent') {
      if (params.percent == null) {
        throw new Error('percent param is required when mode is "percent".');
      }
      if (params.percent < 1 || params.percent > 1000) {
        throw new Error(`percent must be between 1 and 1000 (got ${params.percent}).`);
      }
    } else {
      if (params.width == null || params.height == null) {
        throw new Error(`width and height are required when mode is "${mode}".`);
      }
    }

    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 90),
        message: `Resizing ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(`Unsupported format "${input.type}".`);
      }

      const sourceImage = await loadImage(input);
      const srcW = sourceImage.width;
      const srcH = sourceImage.height;

      let targetW: number;
      let targetH: number;

      if (mode === 'exact') {
        targetW = params.width!;
        targetH = params.height!;
      } else if (mode === 'percent') {
        targetW = Math.round(srcW * params.percent! / 100);
        targetH = Math.round(srcH * params.percent! / 100);
      } else {
        // fit: scale to fit within width x height preserving aspect ratio
        const scaleW = params.width! / srcW;
        const scaleH = params.height! / srcH;
        const scale = Math.min(scaleW, scaleH);
        targetW = Math.round(srcW * scale);
        targetH = Math.round(srcH * scale);
      }

      if (targetW <= 0 || targetH <= 0) {
        throw new Error(`Computed target dimensions are invalid (${targetW}x${targetH}).`);
      }

      const canvas = await createCanvas(targetW, targetH);
      const ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(sourceImage, 0, 0, targetW, targetH);

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
