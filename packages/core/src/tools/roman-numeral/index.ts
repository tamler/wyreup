import type { ToolModule, ToolRunContext } from '../../types.js';

export interface RomanNumeralParams {
  mode?: 'encode' | 'decode';
  /** Comma-separated arabic numbers (encode) or roman numerals (decode). */
  input?: string;
}

export const defaultRomanNumeralParams: RomanNumeralParams = {
  mode: 'encode',
  input: '',
};

export interface RomanNumeralEntry {
  arabic: number;
  roman: string;
}

export interface RomanNumeralResult {
  mode: 'encode' | 'decode';
  results: RomanNumeralEntry[];
  errors: string[];
}

const RomanNumeralComponentStub = (): unknown => null;

// Subtractive notation table per the modern conventional form (no
// medieval shorthand). 3999 is the largest representable value without
// vinculum overlines.
const TABLE: ReadonlyArray<[number, string]> = [
  [1000, 'M'], [900, 'CM'],
  [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'],
  [5, 'V'], [4, 'IV'],
  [1, 'I'],
];

const CHAR_VALUES: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};

export function encodeRoman(n: number): string {
  if (!Number.isInteger(n)) throw new Error(`Roman numerals only encode whole numbers (got ${n}).`);
  if (n < 1 || n > 3999) throw new Error(`Out of range — encode 1..3999 (got ${n}).`);
  let out = '';
  let remaining = n;
  for (const [value, letters] of TABLE) {
    while (remaining >= value) {
      out += letters;
      remaining -= value;
    }
  }
  return out;
}

export function decodeRoman(s: string): number {
  const text = s.trim().toUpperCase();
  if (text === '') throw new Error('Empty roman numeral.');
  if (!/^[IVXLCDM]+$/.test(text)) throw new Error(`Roman numeral "${s}" contains invalid characters.`);
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const cur = CHAR_VALUES[text[i]!]!;
    const next = i + 1 < text.length ? CHAR_VALUES[text[i + 1]!]! : 0;
    if (cur < next) total -= cur;
    else total += cur;
  }
  // Round-trip check — catches malformed numerals like "IIII" or "VV".
  if (encodeRoman(total) !== text) {
    throw new Error(`"${s}" is not a canonical roman numeral (canonical form: ${encodeRoman(total)}).`);
  }
  return total;
}

export const romanNumeral: ToolModule<RomanNumeralParams> = {
  id: 'roman-numeral',
  slug: 'roman-numeral',
  name: 'Roman Numeral',
  description:
    'Convert between arabic numbers (1–3999) and roman numerals. Decoding rejects non-canonical forms (e.g. IIII) so it doubles as a roman-numeral validator.',
  category: 'convert',
  presence: 'both',
  keywords: ['roman', 'numeral', 'arabic', 'convert', 'encode', 'decode'],

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

  defaults: defaultRomanNumeralParams,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'encode', label: 'encode (number → roman)' },
        { value: 'decode', label: 'decode (roman → number)' },
      ],
    },
    input: {
      type: 'string',
      label: 'values',
      help: 'Comma- or whitespace-separated. Examples: 1776, 2026  or  MCMLXXVII, XXV.',
      placeholder: '1776, 2026',
      multiline: true,
    },
  },

  Component: RomanNumeralComponentStub,

  async run(_inputs: File[], params: RomanNumeralParams, ctx: ToolRunContext): Promise<Blob[]> {
    const mode = params.mode ?? 'encode';
    const raw = (params.input ?? '').trim();
    if (!raw) throw new Error('roman-numeral requires at least one value to convert.');

    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const results: RomanNumeralEntry[] = [];
    const errors: string[] = [];

    ctx.onProgress({ stage: 'processing', percent: 50, message: mode === 'encode' ? 'Encoding' : 'Decoding' });

    for (const tok of tokens) {
      try {
        if (mode === 'encode') {
          const n = Number(tok);
          if (Number.isNaN(n)) throw new Error(`"${tok}" is not a number.`);
          results.push({ arabic: n, roman: encodeRoman(n) });
        } else {
          const arabic = decodeRoman(tok);
          results.push({ arabic, roman: tok.toUpperCase() });
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const result: RomanNumeralResult = { mode, results, errors };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
