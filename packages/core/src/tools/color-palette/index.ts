import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ColorPaletteParams, ColorPaletteResult } from './types.js';
import { loadImage, createCanvas } from '../../lib/canvas.js';

export type { ColorPaletteParams, ColorPaletteResult } from './types.js';
export { defaultColorPaletteParams } from './types.js';

// ──── Pure-JS median-cut color quantizer ────────────────────────────────────
//
// Works in both Node (@napi-rs/canvas) and browser (OffscreenCanvas / Canvas)
// with no Buffer dependency. Returns up to `maxColors` dominant hex colors.

interface Rgb { r: number; g: number; b: number }

function toHex(c: Rgb): string {
  return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function componentRange(pixels: Rgb[]): 'r' | 'g' | 'b' {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const p of pixels) {
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
    if (p.g < minG) minG = p.g;
    if (p.g > maxG) maxG = p.g;
    if (p.b < minB) minB = p.b;
    if (p.b > maxB) maxB = p.b;
  }
  const rRange = maxR - minR;
  const gRange = maxG - minG;
  const bRange = maxB - minB;
  if (rRange >= gRange && rRange >= bRange) return 'r';
  if (gRange >= bRange) return 'g';
  return 'b';
}

function averageColor(pixels: Rgb[]): Rgb {
  let r = 0, g = 0, b = 0;
  for (const p of pixels) { r += p.r; g += p.g; b += p.b; }
  const n = pixels.length;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

function medianCut(pixels: Rgb[], depth: number): Rgb[] {
  if (depth === 0 || pixels.length === 0) {
    return pixels.length > 0 ? [averageColor(pixels)] : [];
  }
  const channel = componentRange(pixels);
  pixels.sort((a, b) => a[channel] - b[channel]);
  const mid = Math.floor(pixels.length / 2);
  return [
    ...medianCut(pixels.slice(0, mid), depth - 1),
    ...medianCut(pixels.slice(mid), depth - 1),
  ];
}

/**
 * Extract up to `maxColors` dominant colors from raw RGBA ImageData pixels.
 * Skips fully-transparent pixels. Samples down to at most 10,000 pixels for speed.
 */
function extractPalette(data: Uint8ClampedArray, maxColors: number): string[] {
  // Collect opaque pixels
  const pixels: Rgb[] = [];
  const stride = Math.max(1, Math.floor(data.length / (4 * 10_000)));
  for (let i = 0; i < data.length; i += 4 * stride) {
    const a = data[i + 3]!;
    if (a < 128) continue; // skip transparent
    pixels.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
  }
  if (pixels.length === 0) return [];

  // depth = ceil(log2(maxColors)), capped at 8 (256 buckets max)
  const depth = Math.min(8, Math.ceil(Math.log2(Math.max(2, maxColors))));
  const palette = medianCut(pixels, depth);

  // Sort by bucket size (proxy: just return the colors as-is, capped)
  return palette.slice(0, maxColors).map(toHex);
}

// ──── Named-swatch helpers (vibrant / muted / dark / light) ─────────────────
//
// Approximate the named swatches node-vibrant would return. We classify each
// palette color by its HSL lightness and saturation into one of the six buckets.

function rgbToHsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

interface SwatchMap {
  vibrant: string | null;
  muted: string | null;
  darkVibrant: string | null;
  darkMuted: string | null;
  lightVibrant: string | null;
  lightMuted: string | null;
}

function classifySwatches(hexColors: string[]): SwatchMap {
  const swatches: SwatchMap = {
    vibrant: null, muted: null,
    darkVibrant: null, darkMuted: null,
    lightVibrant: null, lightMuted: null,
  };

  // Parse each hex color and pick a representative for each bucket.
  // Priority: first match per bucket wins.
  for (const hex of hexColors) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const { s, l } = rgbToHsl({ r, g, b });

    const isVibrant = s > 0.35;
    const isDark = l < 0.35;
    const isLight = l > 0.65;

    if (isDark && isVibrant && !swatches.darkVibrant) swatches.darkVibrant = hex;
    else if (isDark && !isVibrant && !swatches.darkMuted) swatches.darkMuted = hex;
    else if (isLight && isVibrant && !swatches.lightVibrant) swatches.lightVibrant = hex;
    else if (isLight && !isVibrant && !swatches.lightMuted) swatches.lightMuted = hex;
    else if (!isDark && !isLight && isVibrant && !swatches.vibrant) swatches.vibrant = hex;
    else if (!isDark && !isLight && !isVibrant && !swatches.muted) swatches.muted = hex;
  }

  return swatches;
}

// ──── Tool module ────────────────────────────────────────────────────────────

const ColorPaletteComponentStub = (): unknown => null;

export const colorPalette: ToolModule<ColorPaletteParams> = {
  id: 'color-palette',
  slug: 'color-palette',
  name: 'Color Palette',
  description: 'Extract dominant colors from an image as hex codes.',
  category: 'inspect',
  presence: 'both',
  keywords: ['color', 'palette', 'dominant', 'extract', 'vibrant', 'inspect'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { count: 5 },

  Component: ColorPaletteComponentStub,

  async run(
    inputs: File[],
    params: ColorPaletteParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const count = params.count ?? 5;
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading image' });

    // Load the image via canvas (works in Node via @napi-rs/canvas and browser natively)
    const img = await loadImage(input);
    const canvas = await createCanvas(img.width, img.height);
    const context = canvas.getContext('2d') as unknown as {
      drawImage(src: unknown, x: number, y: number): void;
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    };
    context.drawImage(img as unknown, 0, 0);

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Analyzing colors' });

    const imageData = context.getImageData(0, 0, img.width, img.height);

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Building palette' });

    // Extract more colors than requested so the classifier has material to work with
    const sampleCount = Math.max(count, 16);
    const topColors = extractPalette(imageData.data, sampleCount);
    const swatches = classifySwatches(topColors);

    const result: ColorPaletteResult = {
      vibrant: swatches.vibrant,
      muted: swatches.muted,
      darkVibrant: swatches.darkVibrant,
      darkMuted: swatches.darkMuted,
      lightVibrant: swatches.lightVibrant,
      lightMuted: swatches.lightMuted,
      topColors: topColors.slice(0, count),
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([JSON.stringify(result)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['application/json'],
  },
};
