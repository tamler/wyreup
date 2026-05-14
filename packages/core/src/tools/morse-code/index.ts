import type { ToolModule, ToolRunContext } from '../../types.js';

export interface MorseCodeParams {
  mode?: 'encode' | 'decode';
  /** Separator between Morse letters when encoding. Default ' ' (space). */
  letterSep?: ' ' | '/' | ' / ';
  /** Separator between words when encoding. Default ' / '. */
  wordSep?: '/' | ' / ' | ' | ';
}

export const defaultMorseCodeParams: MorseCodeParams = {
  mode: 'encode',
  letterSep: ' ',
  wordSep: ' / ',
};

const MorseCodeComponentStub = (): unknown => null;

// ITU Morse code table. Punctuation per ITU-R M.1677-1.
const ENCODE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
};

const DECODE: Record<string, string> = Object.fromEntries(
  Object.entries(ENCODE).map(([k, v]) => [v, k]),
);

export function encodeMorse(text: string, letterSep: string, wordSep: string): string {
  const out: string[] = [];
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  for (const word of words) {
    const letters: string[] = [];
    for (const ch of word) {
      const code = ENCODE[ch];
      if (code) letters.push(code);
    }
    if (letters.length > 0) out.push(letters.join(letterSep));
  }
  return out.join(wordSep);
}

export function decodeMorse(morse: string): string {
  // Tolerant decoder: treat any '/' (with or without surrounding spaces) as
  // a word boundary, then split each word into letter codes by whitespace.
  const words = morse.trim().split(/\s*[/|]\s*/);
  const out: string[] = [];
  for (const word of words) {
    const letters = word.trim().split(/\s+/).filter(Boolean);
    let buf = '';
    for (const code of letters) {
      const ch = DECODE[code];
      if (ch) buf += ch;
    }
    if (buf) out.push(buf);
  }
  return out.join(' ');
}

export const morseCode: ToolModule<MorseCodeParams> = {
  id: 'morse-code',
  slug: 'morse-code',
  name: 'Morse Code',
  description: 'Encode text to Morse code (ITU table) or decode Morse back to text. Unrecognized characters are skipped silently.',
  category: 'convert',
  presence: 'both',
  keywords: ['morse', 'code', 'cipher', 'encode', 'decode', 'itu', 'telegraph'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultMorseCodeParams,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'encode', label: 'encode (text → Morse)' },
        { value: 'decode', label: 'decode (Morse → text)' },
      ],
    },
    letterSep: {
      type: 'enum',
      label: 'letter separator',
      help: 'How to separate Morse letters in the output (encode only).',
      options: [
        { value: ' ', label: 'space' },
        { value: '/', label: 'slash' },
        { value: ' / ', label: 'spaced slash' },
      ],
      showWhen: { field: 'mode', equals: 'encode' },
    },
    wordSep: {
      type: 'enum',
      label: 'word separator',
      help: 'How to separate Morse words in the output (encode only).',
      options: [
        { value: '/', label: 'slash' },
        { value: ' / ', label: 'spaced slash (recommended)' },
        { value: ' | ', label: 'pipe' },
      ],
      showWhen: { field: 'mode', equals: 'encode' },
    },
  },

  Component: MorseCodeComponentStub,

  async run(inputs: File[], params: MorseCodeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('morse-code accepts exactly one text input.');
    const mode = params.mode ?? 'encode';
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 60, message: mode === 'encode' ? 'Encoding' : 'Decoding' });

    const out =
      mode === 'encode'
        ? encodeMorse(text, params.letterSep ?? ' ', params.wordSep ?? ' / ')
        : decodeMorse(text);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([out], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
