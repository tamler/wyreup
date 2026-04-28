import type { ToolModule, ToolRunContext } from '../../types.js';

export type HarmonyScheme =
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'tetradic'
  | 'split-complementary'
  | 'monochromatic';

export interface ColorHarmonyParams {
  /** Base color as a hex string (`#rgb` or `#rrggbb`). */
  color: string;
}

export const defaultColorHarmonyParams: ColorHarmonyParams = {
  color: '#ffb000',
};

export interface ColorHarmonyResult {
  base: string;
  schemes: Record<HarmonyScheme, string[]>;
}

const ColorHarmonyComponentStub = (): unknown => null;

// ── Color math ──────────────────────────────────────────────────────────────

interface Rgb { r: number; g: number; b: number }
interface Hsl { h: number; s: number; l: number }

function parseHex(input: string): Rgb {
  const s = input.trim().replace(/^#/, '');
  let hex: string;
  if (s.length === 3) {
    hex = s.split('').map((c) => c + c).join('');
  } else if (s.length === 6) {
    hex = s;
  } else {
    throw new Error(`Invalid hex color "${input}". Expected #rgb or #rrggbb.`);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid hex color "${input}". Expected #rgb or #rrggbb.`);
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
    case gn: h = ((bn - rn) / d + 2) / 6; break;
    default: h = ((rn - gn) / d + 4) / 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

/** Rotate hue by `degrees` (0-360), wrap into [0,1). */
function rotate(hsl: Hsl, degrees: number): Hsl {
  const h = (hsl.h + degrees / 360) % 1;
  return { h: h < 0 ? h + 1 : h, s: hsl.s, l: hsl.l };
}

function withLightness(hsl: Hsl, l: number): Hsl {
  return { h: hsl.h, s: hsl.s, l: Math.max(0, Math.min(1, l)) };
}

function harmoniesFor(base: Rgb): ColorHarmonyResult['schemes'] {
  const hsl = rgbToHsl(base);
  const hex = (h: Hsl) => rgbToHex(hslToRgb(h));
  return {
    complementary: [hex(hsl), hex(rotate(hsl, 180))],
    analogous: [hex(rotate(hsl, -30)), hex(hsl), hex(rotate(hsl, 30))],
    triadic: [hex(hsl), hex(rotate(hsl, 120)), hex(rotate(hsl, 240))],
    tetradic: [hex(hsl), hex(rotate(hsl, 60)), hex(rotate(hsl, 180)), hex(rotate(hsl, 240))],
    'split-complementary': [hex(hsl), hex(rotate(hsl, 150)), hex(rotate(hsl, 210))],
    monochromatic: [
      hex(withLightness(hsl, Math.max(0, hsl.l - 0.3))),
      hex(withLightness(hsl, Math.max(0, hsl.l - 0.15))),
      hex(hsl),
      hex(withLightness(hsl, Math.min(1, hsl.l + 0.15))),
      hex(withLightness(hsl, Math.min(1, hsl.l + 0.3))),
    ],
  };
}

export const colorHarmony: ToolModule<ColorHarmonyParams> = {
  id: 'color-harmony',
  slug: 'color-harmony',
  name: 'Color Harmony',
  description:
    'Generate complementary, analogous, triadic, tetradic, split-complementary, and monochromatic color schemes from a base hex color.',
  category: 'create',
  categories: ['inspect'],
  presence: 'standalone',
  keywords: [
    'color', 'harmony', 'scheme', 'complementary', 'triadic', 'analogous',
    'tetradic', 'monochromatic', 'theory', 'palette', 'design',
  ],

  input: {
    accept: [],
    min: 0,
    max: 0,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultColorHarmonyParams,

  paramSchema: {
    color: {
      type: 'string',
      label: 'base color',
      placeholder: '#ffb000',
      help: 'Hex color in #rgb or #rrggbb form. Schemes are computed by rotating the hue on the HSL color wheel.',
    },
  },

  Component: ColorHarmonyComponentStub,

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(_inputs: File[], params: ColorHarmonyParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const baseRgb = parseHex(params.color ?? defaultColorHarmonyParams.color);
    const baseHex = rgbToHex(baseRgb);

    const result: ColorHarmonyResult = {
      base: baseHex,
      schemes: harmoniesFor(baseRgb),
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
