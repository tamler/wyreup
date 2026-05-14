import type { ToolModule, ToolRunContext } from '../../types.js';

export interface Base58Params {
  mode?: 'encode' | 'decode';
}

export const defaultBase58Params: Base58Params = {
  mode: 'encode',
};

// Bitcoin alphabet (RFC-draft Base58Check, but without the version+checksum
// envelope). The "no ambiguous characters" property — 0/O/I/l are out —
// is what made it popular for human-readable addresses.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const LOOKUP = (() => {
  const out = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) out[ALPHABET.charCodeAt(i)] = i;
  return out;
})();

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  // Count leading zero bytes — they encode as the alphabet's zero ('1' in base58).
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Convert the byte array to a big-integer base-58 representation by
  // repeated division. Worked out on a working copy of the bytes.
  const buf = Array.from(bytes);
  const out: number[] = [];
  let start = zeros;
  while (start < buf.length) {
    // Divide the remaining big-integer by 58, recording the remainder.
    let carry = 0;
    for (let i = start; i < buf.length; i++) {
      const value = (carry << 8) | buf[i]!;
      buf[i] = Math.floor(value / 58);
      carry = value % 58;
    }
    out.push(carry);
    while (start < buf.length && buf[start] === 0) start++;
  }

  let result = '';
  for (let i = 0; i < zeros; i++) result += ALPHABET[0];
  for (let i = out.length - 1; i >= 0; i--) result += ALPHABET[out[i]!];
  return result;
}

export function decodeBase58(text: string): Uint8Array {
  const trimmed = text.replace(/\s+/g, '');
  if (trimmed.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < trimmed.length && trimmed[zeros] === ALPHABET[0]) zeros++;

  // Multiply by 58 and add each character's index.
  const acc: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    const value = code < 128 ? LOOKUP[code]! : -1;
    if (value < 0) throw new Error(`Invalid base58 character "${trimmed[i]}" at position ${i}.`);
    let carry = value;
    for (let j = 0; j < acc.length; j++) {
      const v = acc[j]! * 58 + carry;
      acc[j] = v & 0xff;
      carry = v >>> 8;
    }
    while (carry > 0) {
      acc.push(carry & 0xff);
      carry >>>= 8;
    }
  }

  const out = new Uint8Array(zeros + acc.length);
  // acc is little-endian; reverse into the tail of the output.
  for (let i = 0; i < acc.length; i++) out[zeros + i] = acc[acc.length - 1 - i]!;
  return out;
}

export const base58: ToolModule<Base58Params> = {
  id: 'base58',
  slug: 'base58',
  name: 'Base58',
  description:
    'Encode any file to Bitcoin-style Base58 text, or decode Base58 back to bytes. Same alphabet used by Bitcoin / Solana / Stellar addresses — no 0, O, I, or l so the encoded text is unambiguous when read aloud. Closes the base32 / base64 / base58 trio.',
  category: 'convert',
  keywords: ['base58', 'encode', 'decode', 'bitcoin', 'solana', 'stellar', 'crypto'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultBase58Params,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'encode', label: 'encode (binary → Base58)' },
        { value: 'decode', label: 'decode (Base58 → binary)' },
      ],
    },
  },

  async run(inputs: File[], params: Base58Params, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('base58 accepts exactly one file.');
    const mode = params.mode ?? 'encode';
    const file = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 40, message: mode === 'encode' ? 'Encoding' : 'Decoding' });

    if (mode === 'encode') {
      const buffer = await file.arrayBuffer();
      if (ctx.signal.aborted) throw new Error('Aborted');
      const encoded = encodeBase58(new Uint8Array(buffer));
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([encoded], { type: 'text/plain' })];
    }

    const text = await file.text();
    if (ctx.signal.aborted) throw new Error('Aborted');
    const decoded = decodeBase58(text);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([decoded.buffer as ArrayBuffer], { type: 'application/octet-stream' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
