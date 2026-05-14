import type { ToolModule, ToolRunContext } from '../../types.js';
import { createCanvas, canvasToBlob, loadImage } from '../../lib/canvas.js';

export type ColorBlindType =
  | 'protanopia'
  | 'protanomaly'
  | 'deuteranopia'
  | 'deuteranomaly'
  | 'tritanopia'
  | 'tritanomaly'
  | 'achromatopsia'
  | 'achromatomaly';

export interface ColorBlindSimulatorParams {
  type?: ColorBlindType;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
}

export const defaultColorBlindSimulatorParams: ColorBlindSimulatorParams = {
  type: 'deuteranopia',
  format: 'png',
  quality: 90,
};

const ColorBlindSimulatorComponentStub = (): unknown => null;

// RGB → RGB transformation matrices for the eight common color-vision
// deficiencies. Values from Brettel/Viénot/Mollon and Machado et al. — the
// canonical references used by Sim Daltonism and Chrome DevTools.
// Each entry is row-major [r->r, r->g, r->b, g->r, g->g, g->b, b->r, b->g, b->b].
const MATRICES: Record<ColorBlindType, [number, number, number, number, number, number, number, number, number]> = {
  protanopia:      [0.567, 0.433, 0,     0.558, 0.442, 0,     0,     0.242, 0.758],
  protanomaly:     [0.817, 0.183, 0,     0.333, 0.667, 0,     0,     0.125, 0.875],
  deuteranopia:    [0.625, 0.375, 0,     0.7,   0.3,   0,     0,     0.3,   0.7],
  deuteranomaly:   [0.8,   0.2,   0,     0.258, 0.742, 0,     0,     0.142, 0.858],
  tritanopia:      [0.95,  0.05,  0,     0,     0.433, 0.567, 0,     0.475, 0.525],
  tritanomaly:     [0.967, 0.033, 0,     0,     0.733, 0.267, 0,     0.183, 0.817],
  achromatopsia:   [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
  achromatomaly:   [0.618, 0.320, 0.062, 0.163, 0.775, 0.062, 0.163, 0.320, 0.516],
};

const FORMAT_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const colorBlindSimulator: ToolModule<ColorBlindSimulatorParams> = {
  id: 'color-blind-simulator',
  slug: 'color-blind-simulator',
  name: 'Color Blind Simulator',
  description:
    'Apply a color-vision-deficiency transform to an image — protanopia, deuteranopia, tritanopia, and the full set including milder anomalous variants and achromatopsia. Useful for sanity-checking charts, UI screenshots, and brand palettes.',
  category: 'edit',
  presence: 'both',
  keywords: ['accessibility', 'a11y', 'color', 'blind', 'colorblind', 'cvd', 'protanopia', 'deuteranopia', 'tritanopia', 'simulate'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'image/png' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultColorBlindSimulatorParams,

  paramSchema: {
    type: {
      type: 'enum',
      label: 'deficiency',
      options: [
        { value: 'protanopia', label: 'protanopia — no red cones (~1% of men)' },
        { value: 'protanomaly', label: 'protanomaly — reduced red sensitivity' },
        { value: 'deuteranopia', label: 'deuteranopia — no green cones (~1% of men)' },
        { value: 'deuteranomaly', label: 'deuteranomaly — reduced green sensitivity (most common)' },
        { value: 'tritanopia', label: 'tritanopia — no blue cones (rare)' },
        { value: 'tritanomaly', label: 'tritanomaly — reduced blue sensitivity' },
        { value: 'achromatopsia', label: 'achromatopsia — no color vision' },
        { value: 'achromatomaly', label: 'achromatomaly — reduced color vision' },
      ],
    },
    format: {
      type: 'enum',
      label: 'output format',
      options: [
        { value: 'png', label: 'PNG (lossless)' },
        { value: 'jpeg', label: 'JPEG (smaller, lossy)' },
        { value: 'webp', label: 'WebP (modern, balanced)' },
      ],
    },
    quality: {
      type: 'range',
      label: 'quality',
      help: 'JPEG / WebP only.',
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
      showWhen: { field: 'format', in: ['jpeg', 'webp'] },
    },
  },

  Component: ColorBlindSimulatorComponentStub,

  async run(inputs: File[], params: ColorBlindSimulatorParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('color-blind-simulator accepts exactly one image.');
    const type = params.type ?? 'deuteranopia';
    const matrix = MATRICES[type];
    if (!matrix) throw new Error(`Unknown deficiency type "${type}".`);
    const format = params.format ?? 'png';
    const quality = params.quality ?? 90;
    if (!FORMAT_MIME[format]) throw new Error(`Unknown format "${format}".`);

    ctx.onProgress({ stage: 'processing', percent: 15, message: 'Loading image' });
    const img = await loadImage(inputs[0]!) as { width: number; height: number };
    const canvas = await createCanvas(img.width, img.height);
    const drawCtx = canvas.getContext('2d') as unknown as {
      drawImage: (img: unknown, x: number, y: number) => void;
      getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
      putImageData: (data: { data: Uint8ClampedArray }, x: number, y: number) => void;
    };
    drawCtx.drawImage(img as unknown, 0, 0);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 55, message: 'Applying matrix' });
    const imageData = drawCtx.getImageData(0, 0, img.width, img.height);
    const data = imageData.data;
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = matrix;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      // Clamp the matrix product back into the 0..255 byte range.
      const nr = r * m00 + g * m01 + b * m02;
      const ng = r * m10 + g * m11 + b * m12;
      const nb = r * m20 + g * m21 + b * m22;
      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
      // alpha untouched
    }
    drawCtx.putImageData(imageData, 0, 0);

    ctx.onProgress({ stage: 'processing', percent: 90, message: 'Encoding' });
    const mime = FORMAT_MIME[format];
    const qualityArg = format === 'png' ? undefined : quality / 100;
    const blob = await canvasToBlob(canvas, mime, qualityArg);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [blob];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};
