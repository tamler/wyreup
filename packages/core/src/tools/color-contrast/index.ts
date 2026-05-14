import type { ToolModule, ToolRunContext } from '../../types.js';

export interface ColorContrastParams {
  /** Foreground color in any CSS-parseable form (#hex, rgb(), hsl(), oklch(), named). */
  foreground?: string;
  /** Background color in any CSS-parseable form. */
  background?: string;
  /** Whether the text is "large" per WCAG (>= 18pt regular, >= 14pt bold). */
  largeText?: boolean;
}

export const defaultColorContrastParams: ColorContrastParams = {
  foreground: '#111111',
  background: '#ffffff',
  largeText: false,
};

export interface ColorContrastResult {
  foreground: { input: string; hex: string };
  background: { input: string; hex: string };
  ratio: number;
  normalText: { aa: boolean; aaa: boolean };
  largeText: { aa: boolean; aaa: boolean };
  /** Echoes the caller's largeText param so the "passes/fails for your use" shortcut is unambiguous. */
  evaluatedAs: 'normal' | 'large';
  verdict: 'AAA' | 'AA' | 'AA-large' | 'fail';
}

const ColorContrastComponentStub = (): unknown => null;

// WCAG 2.1 contrast thresholds.
const THRESHOLDS = {
  normal: { aa: 4.5, aaa: 7 },
  large: { aa: 3, aaa: 4.5 },
} as const;

export const colorContrast: ToolModule<ColorContrastParams> = {
  id: 'color-contrast',
  slug: 'color-contrast',
  name: 'Color Contrast',
  description:
    'WCAG 2.1 contrast ratio between two colors. Pass/fail for AA and AAA at normal and large text sizes.',
  category: 'inspect',
  presence: 'both',
  keywords: [
    'color',
    'contrast',
    'wcag',
    'accessibility',
    'a11y',
    'aa',
    'aaa',
    'ratio',
    'legibility',
    'text',
  ],

  input: {
    accept: ['*/*'],
    min: 0,
    sizeLimit: 0,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultColorContrastParams,

  paramSchema: {
    foreground: {
      type: 'string',
      label: 'foreground',
      help: 'Text color. Any CSS-valid string: #111, rgb(), hsl(), oklch(), named colors.',
      placeholder: '#111111',
    },
    background: {
      type: 'string',
      label: 'background',
      help: 'Background color behind the text.',
      placeholder: '#ffffff',
    },
    largeText: {
      type: 'boolean',
      label: 'large text',
      help: 'Tick this when the text is at least 18pt regular or 14pt bold — WCAG allows a looser ratio.',
    },
  },

  Component: ColorContrastComponentStub,

  async run(_inputs: File[], params: ColorContrastParams, ctx: ToolRunContext): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading color library' });
    const { parse, formatHex, wcagContrast } = await import('culori');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const fgInput = (params.foreground ?? '').trim();
    const bgInput = (params.background ?? '').trim();
    if (!fgInput) throw new Error('color-contrast requires a foreground color.');
    if (!bgInput) throw new Error('color-contrast requires a background color.');

    const fg = parse(fgInput);
    if (!fg) throw new Error(`Foreground color "${fgInput}" could not be parsed.`);
    const bg = parse(bgInput);
    if (!bg) throw new Error(`Background color "${bgInput}" could not be parsed.`);

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Computing contrast' });
    const ratio = wcagContrast(fg, bg);
    const rounded = Math.round(ratio * 100) / 100;

    const normalText = {
      aa: ratio >= THRESHOLDS.normal.aa,
      aaa: ratio >= THRESHOLDS.normal.aaa,
    };
    const largeText = {
      aa: ratio >= THRESHOLDS.large.aa,
      aaa: ratio >= THRESHOLDS.large.aaa,
    };

    const evaluatedAs = params.largeText ? 'large' : 'normal';
    const pick = evaluatedAs === 'large' ? largeText : normalText;
    let verdict: ColorContrastResult['verdict'];
    if (pick.aaa) verdict = 'AAA';
    else if (pick.aa) verdict = 'AA';
    else if (largeText.aa) verdict = 'AA-large';
    else verdict = 'fail';

    const result: ColorContrastResult = {
      foreground: { input: fgInput, hex: formatHex(fg) ?? fgInput },
      background: { input: bgInput, hex: formatHex(bg) ?? bgInput },
      ratio: rounded,
      normalText,
      largeText,
      evaluatedAs,
      verdict,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
