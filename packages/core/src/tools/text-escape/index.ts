import type { ToolModule, ToolRunContext } from '../../types.js';

export type TextEscapeMode = 'encode-html' | 'decode-html' | 'encode-unicode' | 'decode-unicode';

export interface TextEscapeParams {
  /** Transformation mode. Default 'encode-html'. */
  mode?: TextEscapeMode;
}

export const defaultTextEscapeParams: TextEscapeParams = {
  mode: 'encode-html',
};

// HTML entity map for encode-html
const HTML_ENCODE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// HTML entity map for decode-html (reverse of the above + named entities)
const HTML_DECODE_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': '\u00A0',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
  '&hellip;': '\u2026',
  '&laquo;': '\u00AB',
  '&raquo;': '\u00BB',
  '&euro;': '\u20AC',
  '&pound;': '\u00A3',
  '&yen;': '\u00A5',
  '&cent;': '\u00A2',
};

export function encodeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ENCODE_MAP[ch] ?? ch);
}

export function decodeHtml(text: string): string {
  // Named entities
  let result = text.replace(/&[a-zA-Z]+;/g, (entity) => HTML_DECODE_MAP[entity] ?? entity);
  // Numeric decimal entities &#NNN;
  result = result.replace(/&#(\d+);/g, (_match, dec: string) =>
    String.fromCodePoint(parseInt(dec, 10)),
  );
  // Numeric hex entities &#xHHH;
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
  return result;
}

export function encodeUnicode(text: string): string {
  let result = '';
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp > 0x7e || cp < 0x20) {
      // Encode non-ASCII and control chars
      if (cp > 0xffff) {
        result += `\\u{${cp.toString(16).toUpperCase()}}`;
      } else {
        result += `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`;
      }
    } else {
      result += char;
    }
  }
  return result;
}

export function decodeUnicode(text: string): string {
  // Handle \u{XXXXXX} (ES6 code points)
  let result = text.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_match, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
  // Handle \uXXXX
  result = result.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return result;
}

const TextEscapeComponentStub = (): unknown => null;

export const textEscape: ToolModule<TextEscapeParams> = {
  id: 'text-escape',
  slug: 'text-escape',
  name: 'Text Escape / Unescape',
  description: 'Encode or decode HTML entities and Unicode escape sequences.',
  category: 'dev',
  presence: 'both',
  keywords: ['escape', 'unescape', 'html', 'entities', 'unicode', 'encode', 'decode'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTextEscapeParams,
  Component: TextEscapeComponentStub,

  async run(inputs: File[], params: TextEscapeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('text-escape accepts exactly one text file.');
    }
    const input = inputs[0]!;

    const mode = params.mode ?? 'encode-html';
    const validModes: TextEscapeMode[] = ['encode-html', 'decode-html', 'encode-unicode', 'decode-unicode'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Valid modes: ${validModes.join(', ')}`);
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading text' });

    const text = await input.text();

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: `Applying ${mode}` });

    let result: string;
    switch (mode) {
      case 'encode-html':
        result = encodeHtml(text);
        break;
      case 'decode-html':
        result = decodeHtml(text);
        break;
      case 'encode-unicode':
        result = encodeUnicode(text);
        break;
      case 'decode-unicode':
        result = decodeUnicode(text);
        break;
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
