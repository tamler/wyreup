import type { ToolModule, ToolRunContext } from '../../types.js';
import { createCanvas, loadImage } from '../../lib/canvas.js';

export interface ImageToAsciiParams {
  /** Output character width. Default 80. */
  width?: number;
  /** When true, invert the ramp (use for white-on-black terminals). Default false. */
  invert?: boolean;
  /** Character set: 'standard' (~70 chars), 'simple' (10 chars), 'blocks' (unicode). */
  ramp?: 'standard' | 'simple' | 'blocks';
}

export const defaultImageToAsciiParams: ImageToAsciiParams = {
  width: 80,
  invert: false,
  ramp: 'standard',
};

const RAMPS = {
  // Light → dark, classic Paul Bourke ramp.
  standard: ` .'\`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$`,
  simple: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
};

// Chars are ~2x taller than wide; halve y to keep aspect.
const CHAR_ASPECT = 0.5;

interface ImageLike { width: number; height: number }
interface CanvasContext {
  drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void;
  getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
}

export async function imageToAscii(
  blob: Blob,
  params: ImageToAsciiParams = {},
): Promise<string> {
  const width = Math.max(10, Math.min(400, params.width ?? 80));
  const invert = params.invert ?? false;
  const rampName = params.ramp ?? 'standard';
  let ramp = RAMPS[rampName] ?? RAMPS.standard;
  if (invert) ramp = ramp.split('').reverse().join('');

  const img = await loadImage(blob) as ImageLike;
  const height = Math.max(1, Math.round(width * (img.height / img.width) * CHAR_ASPECT));

  const canvas = await createCanvas(width, height);
  const ctx = canvas.getContext('2d') as unknown as CanvasContext;
  ctx.drawImage(img as unknown, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const rampLen = ramp.length;
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      // Rec. 709 luminance, then alpha-blend onto white.
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) * (a / 255) + 255 * (1 - a / 255);
      const idx = Math.min(rampLen - 1, Math.floor((lum / 255) * rampLen));
      row += ramp[idx];
    }
    lines.push(row);
  }
  return lines.join('\n');
}

export const imageToAsciiArt: ToolModule<ImageToAsciiParams> = {
  id: 'image-to-ascii',
  slug: 'image-to-ascii',
  name: 'Image to ASCII',
  description:
    'Convert an image into ASCII (or Unicode block) art. Adjustable width and three character ramps (standard 70-char, simple 10-char, unicode blocks). Output is plain text — paste anywhere monospace renders.',
  llmDescription:
    'Take an image and return ASCII / Unicode-block art as plain text. Configurable width (10-400 columns), invertible ramp, three ramp styles. Useful for terminal display, README banners, or art exports.',
  category: 'convert',
  keywords: ['ascii', 'art', 'image', 'text', 'convert', 'unicode', 'terminal', 'banner'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'],
    min: 1,
    max: 1,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultImageToAsciiParams,

  paramSchema: {
    width: {
      type: 'number',
      label: 'output width (characters)',
      min: 10,
      max: 400,
      help: 'Number of characters per line. 80 is a typical terminal width.',
    },
    invert: {
      type: 'boolean',
      label: 'invert (white-on-black)',
      help: 'Flip the ramp so dark pixels become dense characters — use this for dark-mode terminals.',
    },
    ramp: {
      type: 'enum',
      label: 'character set',
      options: [
        { value: 'standard', label: 'Standard (70 chars)' },
        { value: 'simple', label: 'Simple (10 chars)' },
        { value: 'blocks', label: 'Unicode blocks (5 chars)' },
      ],
    },
  },

  async run(inputs: File[], params: ImageToAsciiParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('image-to-ascii accepts exactly one image.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Decoding image' });
    const text = await imageToAscii(inputs[0]!, params);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([text], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
