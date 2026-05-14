import type { ToolModule, ToolRunContext } from '../../types.js';

export interface TextConfusableParams {
  /** Treat ASCII as the reference script — non-Latin lookalikes count as confusables. */
  baseScript?: 'latin' | 'any';
  /** Flag tokens that mix Unicode scripts (e.g. one Cyrillic letter inside an otherwise Latin word). */
  flagMixedScript?: boolean;
}

export const defaultTextConfusableParams: TextConfusableParams = {
  baseScript: 'latin',
  flagMixedScript: true,
};

export type RiskLevel = 'safe' | 'invisible' | 'confusable' | 'mixed-script';

export interface ConfusableHit {
  index: number;
  char: string;
  codepoint: number;
  hex: string;
  /** Latin character this glyph resembles (or empty if it's just invisible / control). */
  lookalike: string;
  script: string;
  reason: RiskLevel;
}

export interface MixedScriptToken {
  token: string;
  start: number;
  scripts: string[];
}

export interface TextConfusableResult {
  totalChars: number;
  confusableCount: number;
  invisibleCount: number;
  scripts: string[];
  hits: ConfusableHit[];
  mixedScriptTokens: MixedScriptToken[];
  /** Overall risk — highest of any per-character finding. */
  verdict: 'clean' | 'low' | 'medium' | 'high';
}

const TextConfusableComponentStub = (): unknown => null;

// Minimal homoglyph table — the visually-identical Latin lookalikes
// that show up in real-world impersonation. A full Unicode TR-39
// confusables table is huge; this covers the cases that matter
// (Cyrillic / Greek / fullwidth / mathematical alphanumeric).
const CONFUSABLES: Record<number, string> = {
  // Cyrillic
  0x0430: 'a', 0x0435: 'e', 0x043e: 'o', 0x0440: 'p', 0x0441: 'c',
  0x0445: 'x', 0x0443: 'y', 0x0456: 'i', 0x0458: 'j',
  0x0410: 'A', 0x0412: 'B', 0x0415: 'E', 0x041a: 'K', 0x041c: 'M',
  0x041d: 'H', 0x041e: 'O', 0x0420: 'P', 0x0421: 'C', 0x0422: 'T',
  0x0425: 'X',
  // Greek
  0x03b1: 'a', 0x03bf: 'o', 0x03c1: 'p', 0x03bd: 'v', 0x03c5: 'u',
  0x0391: 'A', 0x0392: 'B', 0x0395: 'E', 0x0396: 'Z', 0x0397: 'H',
  0x0399: 'I', 0x039a: 'K', 0x039c: 'M', 0x039d: 'N', 0x039f: 'O',
  0x03a1: 'P', 0x03a4: 'T', 0x03a5: 'Y', 0x03a7: 'X',
  // Latin extensions / lookalike digits
  0x0131: 'i', // dotless i
  0x217c: 'l', // small roman numeral fifty
  0x2c2a: 'L', // Latin capital letter L with middle tilde
  // Halfwidth/fullwidth Latin (FF00-FF5E maps to ASCII 21-7E)
};

// Programmatic add: fullwidth Latin (FF21..FF3A, FF41..FF5A) → ASCII Latin.
for (let i = 0; i < 26; i++) {
  CONFUSABLES[0xff21 + i] = String.fromCharCode(0x41 + i);
  CONFUSABLES[0xff41 + i] = String.fromCharCode(0x61 + i);
}
// Mathematical alphanumeric symbols → ASCII Latin (subset that matters
// in practice — bold, italic, sans-serif uppercase/lowercase Latin).
function addMathRange(start: number, baseAscii: number): void {
  for (let i = 0; i < 26; i++) CONFUSABLES[start + i] = String.fromCharCode(baseAscii + i);
}
addMathRange(0x1d400, 0x41); // mathematical bold A-Z
addMathRange(0x1d41a, 0x61); // mathematical bold a-z
addMathRange(0x1d434, 0x41); // mathematical italic A-Z
addMathRange(0x1d44e, 0x61); // mathematical italic a-z
addMathRange(0x1d5a0, 0x41); // mathematical sans-serif A-Z
addMathRange(0x1d5ba, 0x61); // mathematical sans-serif a-z

const INVISIBLES = new Set<number>([
  0x00ad, 0x180e, 0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x202a,
  0x202b, 0x202c, 0x202d, 0x202e, 0x202f, 0x2060, 0xfeff,
]);

function scriptOf(cp: number): string {
  if (cp < 0x80) return 'latin';
  if (cp >= 0x80 && cp <= 0x024f) return 'latin';
  if (cp >= 0x0370 && cp <= 0x03ff) return 'greek';
  if (cp >= 0x0400 && cp <= 0x04ff) return 'cyrillic';
  if (cp >= 0x0530 && cp <= 0x058f) return 'armenian';
  if (cp >= 0x0590 && cp <= 0x05ff) return 'hebrew';
  if (cp >= 0x0600 && cp <= 0x06ff) return 'arabic';
  if (cp >= 0x0900 && cp <= 0x097f) return 'devanagari';
  if (cp >= 0x0e00 && cp <= 0x0e7f) return 'thai';
  if (cp >= 0x3040 && cp <= 0x309f) return 'hiragana';
  if (cp >= 0x30a0 && cp <= 0x30ff) return 'katakana';
  if (cp >= 0x4e00 && cp <= 0x9fff) return 'cjk';
  if (cp >= 0xac00 && cp <= 0xd7af) return 'hangul';
  if (cp >= 0xff00 && cp <= 0xff60) return 'fullwidth';
  if (cp >= 0x1d400 && cp <= 0x1d7ff) return 'mathematical';
  return 'other';
}

function isWordChar(ch: string): boolean {
  return /\p{Letter}|\p{Number}/u.test(ch);
}

export function analyzeConfusable(text: string, params: TextConfusableParams): TextConfusableResult {
  const baseScript = params.baseScript ?? 'latin';
  const flagMixedScript = params.flagMixedScript ?? true;

  const hits: ConfusableHit[] = [];
  const scripts = new Set<string>();
  let totalChars = 0;
  let confusableCount = 0;
  let invisibleCount = 0;

  let index = 0;
  for (const char of text) {
    totalChars++;
    const cp = char.codePointAt(0)!;
    const script = scriptOf(cp);
    if (cp >= 0x21) scripts.add(script);

    if (INVISIBLES.has(cp)) {
      invisibleCount++;
      hits.push({
        index,
        char,
        codepoint: cp,
        hex: `U+${cp.toString(16).padStart(4, '0').toUpperCase()}`,
        lookalike: '',
        script,
        reason: 'invisible',
      });
    } else if (CONFUSABLES[cp] !== undefined && (baseScript === 'any' || script !== 'latin')) {
      confusableCount++;
      hits.push({
        index,
        char,
        codepoint: cp,
        hex: `U+${cp.toString(16).padStart(4, '0').toUpperCase()}`,
        lookalike: CONFUSABLES[cp]!,
        script,
        reason: 'confusable',
      });
    }
    index++;
  }

  // Detect mixed-script tokens — words that combine two or more scripts.
  const mixedScriptTokens: MixedScriptToken[] = [];
  if (flagMixedScript) {
    let tokenStart = -1;
    let tokenScripts = new Set<string>();
    let tokenChars = '';
    const flush = (): void => {
      if (tokenStart >= 0 && tokenScripts.size > 1) {
        mixedScriptTokens.push({
          token: tokenChars,
          start: tokenStart,
          scripts: [...tokenScripts].sort(),
        });
      }
      tokenStart = -1;
      tokenScripts = new Set();
      tokenChars = '';
    };
    let i = 0;
    for (const char of text) {
      if (isWordChar(char)) {
        if (tokenStart < 0) tokenStart = i;
        const cp = char.codePointAt(0)!;
        const s = scriptOf(cp);
        // 'mathematical' bold-Latin is still effectively Latin script for impersonation purposes;
        // group it with Latin so "bold-Hello" doesn't trip the mixed-script flag on its own.
        const normalized = s === 'mathematical' || s === 'fullwidth' ? 'latin' : s;
        tokenScripts.add(normalized);
        tokenChars += char;
      } else {
        flush();
      }
      i++;
    }
    flush();
  }

  let verdict: TextConfusableResult['verdict'] = 'clean';
  if (mixedScriptTokens.length > 0) verdict = 'high';
  else if (confusableCount > 0) verdict = 'medium';
  else if (invisibleCount > 0) verdict = 'low';

  return {
    totalChars,
    confusableCount,
    invisibleCount,
    scripts: [...scripts].sort(),
    hits,
    mixedScriptTokens,
    verdict,
  };
}

export const textConfusable: ToolModule<TextConfusableParams> = {
  id: 'text-confusable',
  slug: 'text-confusable',
  name: 'Text Confusable',
  description:
    'Detect Unicode homoglyph attacks. Flags non-Latin lookalikes (Cyrillic а, Greek ο, fullwidth Latin, mathematical alphanumeric) and tokens that mix scripts — exactly the patterns used in domain spoofing, fake usernames, and prompt-injection text.',
  category: 'inspect',
  presence: 'both',
  keywords: ['confusable', 'homoglyph', 'unicode', 'security', 'phishing', 'spoofing', 'idn', 'mixed-script'],

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

  defaults: defaultTextConfusableParams,

  paramSchema: {
    baseScript: {
      type: 'enum',
      label: 'base script',
      help: 'What counts as "the normal script." Latin = anything outside Latin is a candidate confusable.',
      options: [
        { value: 'latin', label: 'Latin (most cases)' },
        { value: 'any', label: 'any — flag every glyph with a known lookalike' },
      ],
    },
    flagMixedScript: {
      type: 'boolean',
      label: 'flag mixed-script tokens',
      help: 'Mark words that combine multiple Unicode scripts (e.g. a single Cyrillic letter hidden inside a Latin word).',
    },
  },

  Component: TextConfusableComponentStub,

  async run(inputs: File[], params: TextConfusableParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('text-confusable accepts exactly one text input.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading text' });
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Analyzing' });
    const result = analyzeConfusable(text, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
