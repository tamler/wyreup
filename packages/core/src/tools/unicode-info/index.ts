import type { ToolModule, ToolRunContext } from '../../types.js';

export interface UnicodeInfoParams {
  /** Cap per-character row output to keep huge inputs readable. */
  maxChars?: number;
}

export const defaultUnicodeInfoParams: UnicodeInfoParams = {
  maxChars: 5000,
};

export interface UnicodeCharInfo {
  index: number;
  char: string;
  codepoint: number;
  hex: string;
  utf8: string;
  jsEscape: string;
  category: string;
  block: string;
}

export interface UnicodeInfoReport {
  length: number;
  codepoints: number;
  bytes: number;
  hasBom: boolean;
  hasInvisibles: boolean;
  hasRtl: boolean;
  hasControls: boolean;
  scripts: string[];
  chars: UnicodeCharInfo[];
  truncated: boolean;
}

const UnicodeInfoComponentStub = (): unknown => null;

// A small, manually-maintained block table — enough to identify the
// common offenders (CJK, Hebrew/Arabic for RTL, combining marks,
// zero-width, BOM, control). Full UCD would bloat the bundle and isn't
// worth it for a quick-inspect tool.
const BLOCKS: ReadonlyArray<{ from: number; to: number; name: string }> = [
  { from: 0x0000, to: 0x007f, name: 'Basic Latin' },
  { from: 0x0080, to: 0x00ff, name: 'Latin-1 Supplement' },
  { from: 0x0100, to: 0x017f, name: 'Latin Extended-A' },
  { from: 0x0180, to: 0x024f, name: 'Latin Extended-B' },
  { from: 0x0300, to: 0x036f, name: 'Combining Diacritical Marks' },
  { from: 0x0370, to: 0x03ff, name: 'Greek and Coptic' },
  { from: 0x0400, to: 0x04ff, name: 'Cyrillic' },
  { from: 0x0590, to: 0x05ff, name: 'Hebrew' },
  { from: 0x0600, to: 0x06ff, name: 'Arabic' },
  { from: 0x0900, to: 0x097f, name: 'Devanagari' },
  { from: 0x2000, to: 0x206f, name: 'General Punctuation' },
  { from: 0x2070, to: 0x209f, name: 'Superscripts and Subscripts' },
  { from: 0x20a0, to: 0x20cf, name: 'Currency Symbols' },
  { from: 0x2190, to: 0x21ff, name: 'Arrows' },
  { from: 0x2200, to: 0x22ff, name: 'Mathematical Operators' },
  { from: 0x2500, to: 0x257f, name: 'Box Drawing' },
  { from: 0x2600, to: 0x26ff, name: 'Miscellaneous Symbols' },
  { from: 0x2700, to: 0x27bf, name: 'Dingbats' },
  { from: 0x3000, to: 0x303f, name: 'CJK Symbols and Punctuation' },
  { from: 0x3040, to: 0x309f, name: 'Hiragana' },
  { from: 0x30a0, to: 0x30ff, name: 'Katakana' },
  { from: 0x4e00, to: 0x9fff, name: 'CJK Unified Ideographs' },
  { from: 0xac00, to: 0xd7af, name: 'Hangul Syllables' },
  { from: 0xfb50, to: 0xfdff, name: 'Arabic Presentation Forms-A' },
  { from: 0xfe00, to: 0xfe0f, name: 'Variation Selectors' },
  { from: 0xfe70, to: 0xfeff, name: 'Arabic Presentation Forms-B' },
  { from: 0xff00, to: 0xffef, name: 'Halfwidth and Fullwidth Forms' },
  { from: 0x1f300, to: 0x1f5ff, name: 'Miscellaneous Symbols and Pictographs' },
  { from: 0x1f600, to: 0x1f64f, name: 'Emoticons' },
  { from: 0x1f680, to: 0x1f6ff, name: 'Transport and Map Symbols' },
  { from: 0x1f900, to: 0x1f9ff, name: 'Supplemental Symbols and Pictographs' },
];

function blockFor(cp: number): string {
  for (const b of BLOCKS) {
    if (cp >= b.from && cp <= b.to) return b.name;
  }
  return 'Other';
}

const INVISIBLE_CODEPOINTS = new Set([
  0x00ad, // soft hyphen
  0x200b, // zero-width space
  0x200c, // ZWNJ
  0x200d, // ZWJ
  0x2028, // line separator
  0x2029, // paragraph separator
  0x202f, // narrow no-break space
  0xfeff, // BOM / ZWNBSP
  0x180e, // mongolian vowel separator
]);

const RTL_RANGES: ReadonlyArray<[number, number]> = [
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0700, 0x074f], // Syriac
  [0x0780, 0x07bf], // Thaana
  [0xfb1d, 0xfb4f], // Hebrew presentation forms
  [0xfb50, 0xfdff], // Arabic presentation forms-A
  [0xfe70, 0xfeff], // Arabic presentation forms-B
];

function isRtl(cp: number): boolean {
  return RTL_RANGES.some(([from, to]) => cp >= from && cp <= to);
}

function categoryFor(cp: number, char: string): string {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 'Control';
  if (INVISIBLE_CODEPOINTS.has(cp)) return 'Invisible';
  if (cp >= 0x0300 && cp <= 0x036f) return 'Combining Mark';
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 'Variation Selector';
  if (/\s/.test(char)) return 'Whitespace';
  if (/\p{Letter}/u.test(char)) return 'Letter';
  if (/\p{Number}/u.test(char)) return 'Number';
  if (/\p{Punctuation}/u.test(char)) return 'Punctuation';
  if (/\p{Symbol}/u.test(char)) return 'Symbol';
  return 'Other';
}

function jsEscape(cp: number): string {
  if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, '0').toUpperCase()}`;
  return `\\u{${cp.toString(16).toUpperCase()}}`;
}

function utf8Bytes(cp: number): string {
  const bytes: number[] = [];
  if (cp < 0x80) bytes.push(cp);
  else if (cp < 0x800) {
    bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
  } else if (cp < 0x10000) {
    bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  } else {
    bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function analyzeUnicode(text: string, maxChars: number): UnicodeInfoReport {
  const chars: UnicodeCharInfo[] = [];
  const scripts = new Set<string>();
  let codepoints = 0;
  let hasBom = false;
  let hasInvisibles = false;
  let hasRtl = false;
  let hasControls = false;
  let bytes = 0;
  let truncated = false;

  let index = 0;
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    codepoints++;
    bytes += utf8ByteLength(cp);
    if (cp === 0xfeff && index === 0) hasBom = true;
    if (INVISIBLE_CODEPOINTS.has(cp)) hasInvisibles = true;
    if (isRtl(cp)) hasRtl = true;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) hasControls = true;
    const block = blockFor(cp);
    if (block !== 'Other' && block !== 'Basic Latin') scripts.add(block);

    if (chars.length < maxChars) {
      chars.push({
        index,
        char,
        codepoint: cp,
        hex: `U+${cp.toString(16).padStart(4, '0').toUpperCase()}`,
        utf8: utf8Bytes(cp),
        jsEscape: jsEscape(cp),
        category: categoryFor(cp, char),
        block,
      });
    } else {
      truncated = true;
    }
    index++;
  }

  return {
    length: text.length,
    codepoints,
    bytes,
    hasBom,
    hasInvisibles,
    hasRtl,
    hasControls,
    scripts: [...scripts].sort(),
    chars,
    truncated,
  };
}

function utf8ByteLength(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

export const unicodeInfo: ToolModule<UnicodeInfoParams> = {
  id: 'unicode-info',
  slug: 'unicode-info',
  name: 'Unicode Info',
  description:
    'Inspect every character in text — codepoint, UTF-8 bytes, JS escape, Unicode block, category — and flag invisibles, BOMs, RTL marks, and control characters.',
  category: 'inspect',
  presence: 'both',
  keywords: [
    'unicode',
    'codepoint',
    'character',
    'inspect',
    'utf-8',
    'utf8',
    'escape',
    'invisible',
    'zero-width',
    'bom',
    'rtl',
    'hex',
    'encoding',
  ],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 5 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultUnicodeInfoParams,

  paramSchema: {
    maxChars: {
      type: 'number',
      label: 'max rows',
      help: 'Cap per-character rows in the output (the summary still counts every character).',
      min: 100,
      max: 100000,
      step: 100,
    },
  },

  Component: UnicodeInfoComponentStub,

  async run(inputs: File[], params: UnicodeInfoParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('unicode-info accepts exactly one text input.');
    }
    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading text' });
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Analyzing characters' });
    const report = analyzeUnicode(text, params.maxChars ?? defaultUnicodeInfoParams.maxChars!);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
