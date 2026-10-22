import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ColorConverterParams, ColorConverterResult } from './types.js';

export type { ColorConverterParams, ColorConverterResult } from './types.js';
export { defaultColorConverterParams } from './types.js';

function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export const colorConverter: ToolModule<ColorConverterParams> = {
  id: 'color-converter',
  slug: 'color-converter',
  name: 'Color Converter',
  description: 'Convert a color string to hex, RGB, HSL, Oklch, and Oklab formats.',
  category: 'inspect',
  keywords: ['color', 'colour', 'hex', 'rgb', 'hsl', 'oklch', 'oklab', 'convert'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  async run(inputs: File[], _params: ColorConverterParams, ctx: ToolRunContext): Promise<Blob[]> {
    const abort = () => {
      if (ctx.signal.aborted) throw new Error('Aborted');
    };
    abort();
    if (inputs.length !== 1 || !inputs[0])
      throw new Error('Exactly one color text file is required');
    if (inputs[0].size > 1024) throw new Error('Color input exceeds 1024 bytes');
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading color library' });

    const { parse, formatHex, formatRgb, formatHsl, converter } = await import('culori');
    abort();

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Converting color' });

    const bytes = await inputs[0].slice(0, 1025).arrayBuffer();
    abort();
    if (bytes.byteLength > 1024) throw new Error('Color input exceeds 1024 bytes');
    const input = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();

    const parsed = parse(input);

    if (!parsed) {
      const result: ColorConverterResult = {
        input,
        hex: '',
        rgb: { r: 0, g: 0, b: 0 },
        rgbString: '',
        hsl: { h: 0, s: 0, l: 0 },
        hslString: '',
        oklch: { l: 0, c: 0, h: 0 },
        oklchString: '',
        oklab: { l: 0, a: 0, b: 0 },
        valid: false,
        alpha: null,
        gamut: null,
        opaquePickerHex: '',
      };
      abort();
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
    }

    const toHsl = converter('hsl');
    const toOklch = converter('oklch');
    const toOklab = converter('oklab');
    const toRgb = converter('rgb');

    const rgbColor = toRgb(parsed);
    const hslColor = toHsl(parsed);
    const oklchColor = toOklch(parsed);
    const oklabColor = toOklab(parsed);

    function num(color: Record<string, unknown> | undefined, key: string): number {
      if (!color) return 0;
      const v = color[key];
      return typeof v === 'number' ? v : 0;
    }

    const r = Math.round(num(rgbColor, 'r') * 255);
    const g = Math.round(num(rgbColor, 'g') * 255);
    const b = Math.round(num(rgbColor, 'b') * 255);
    const alpha = typeof parsed.alpha === 'number' ? parsed.alpha : 1;
    const gamut = ['r', 'g', 'b'].every((key) => {
      const channel = num(rgbColor, key);
      return channel >= -1e-7 && channel <= 1 + 1e-7;
    })
      ? 'srgb'
      : 'outside-srgb';
    const opaquePickerHex =
      '#' +
      [r, g, b]
        .map((value) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0'))
        .join('');

    const hslH = round(num(hslColor, 'h'), 2);
    const hslS = round(num(hslColor, 's') * 100, 2);
    const hslL = round(num(hslColor, 'l') * 100, 2);

    const oklchL = round(num(oklchColor, 'l'));
    const oklchC = round(num(oklchColor, 'c'));
    const oklchH = round(num(oklchColor, 'h'));

    const result: ColorConverterResult = {
      input,
      hex: formatHex(parsed) ?? '',
      rgb: { r, g, b, a: alpha },
      rgbString: formatRgb(parsed) ?? `rgb(${r}, ${g}, ${b})`,
      hsl: { h: hslH, s: hslS, l: hslL, a: alpha },
      hslString: formatHsl(hslColor) ?? `hsl(${hslH}, ${hslS}%, ${hslL}%)`,
      oklch: {
        l: oklchL,
        c: oklchC,
        h: oklchH,
      },
      oklchString: `oklch(${oklchL} ${oklchC} ${oklchH}${alpha === 1 ? '' : ` / ${alpha}`})`,
      oklab: {
        l: round(num(oklabColor, 'l')),
        a: round(num(oklabColor, 'a')),
        b: round(num(oklabColor, 'b')),
      },
      valid: true,
      alpha,
      gamut,
      opaquePickerHex,
    };

    abort();
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
