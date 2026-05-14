import type { ToolModule, ToolRunContext } from '../../types.js';

export interface Base32Params {
  mode?: 'encode' | 'decode';
  /** Use the extended hex alphabet (RFC 4648 §7) instead of the standard one. */
  hexExtended?: boolean;
  /** Omit the trailing '=' padding on encode (decoding tolerates both). */
  omitPadding?: boolean;
}

export const defaultBase32Params: Base32Params = {
  mode: 'encode',
  hexExtended: false,
  omitPadding: false,
};

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HEX_EXTENDED = '0123456789ABCDEFGHIJKLMNOPQRSTUV';

function buildLookup(alphabet: string): Uint8Array {
  const lookup = new Uint8Array(128).fill(0xff);
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }
  return lookup;
}

export function encodeBase32(bytes: Uint8Array, hexExtended: boolean, omitPadding: boolean): string {
  const alphabet = hexExtended ? HEX_EXTENDED : STANDARD;
  let out = '';
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 0x1f];
  }
  if (!omitPadding) {
    while (out.length % 8 !== 0) out += '=';
  }
  return out;
}

export function decodeBase32(text: string, hexExtended: boolean): Uint8Array {
  const alphabet = hexExtended ? HEX_EXTENDED : STANDARD;
  const lookup = buildLookup(alphabet);
  // Normalize: strip whitespace, padding, case.
  const cleaned = text.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    const v = code < 128 ? lookup[code]! : 0xff;
    if (v === 0xff) {
      throw new Error(`Invalid base32 character at position ${i}: "${cleaned[i]}"`);
    }
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export const base32: ToolModule<Base32Params> = {
  id: 'base32',
  slug: 'base32',
  name: 'Base32',
  description: 'Encode any file to Base32 text (RFC 4648) or decode Base32 back to bytes. Pairs with the base64 tool.',
  category: 'convert',
  keywords: ['base32', 'encode', 'decode', 'rfc4648', 'binary', 'text'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultBase32Params,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'encode', label: 'encode (binary → Base32)' },
        { value: 'decode', label: 'decode (Base32 → binary)' },
      ],
    },
    hexExtended: {
      type: 'boolean',
      label: 'hex-extended alphabet',
      help: 'Use the RFC 4648 §7 alphabet (0–9, A–V). The default is the standard alphabet (A–Z, 2–7).',
    },
    omitPadding: {
      type: 'boolean',
      label: 'omit padding',
      help: 'Skip trailing "=" padding on encode. Decoding accepts either form.',
      showWhen: { field: 'mode', equals: 'encode' },
    },
  },

  async run(inputs: File[], params: Base32Params, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('base32 accepts exactly one file.');
    const mode = params.mode ?? 'encode';
    const hexExtended = params.hexExtended ?? false;
    const omitPadding = params.omitPadding ?? false;
    const file = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 30, message: mode === 'encode' ? 'Encoding' : 'Decoding' });

    if (mode === 'encode') {
      const buffer = await file.arrayBuffer();
      if (ctx.signal.aborted) throw new Error('Aborted');
      const encoded = encodeBase32(new Uint8Array(buffer), hexExtended, omitPadding);
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([encoded], { type: 'text/plain' })];
    }

    const text = await file.text();
    if (ctx.signal.aborted) throw new Error('Aborted');
    const decoded = decodeBase32(text, hexExtended);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([decoded.buffer as ArrayBuffer], { type: 'application/octet-stream' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
