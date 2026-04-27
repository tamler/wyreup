import type { ToolModule, ToolRunContext } from '../../types.js';
import type { Base64Params } from './types.js';

export type { Base64Params } from './types.js';
export { defaultBase64Params } from './types.js';

const STANDARD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URLSAFE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64(bytes: Uint8Array, urlSafe: boolean): string {
  const chars = urlSafe ? URLSAFE_CHARS : STANDARD_CHARS;
  let result = '';
  const len = bytes.length;

  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;

    result += chars[b0 >> 2];
    result += chars[((b0 & 0x03) << 4) | (b1 >> 4)];
    result += i + 1 < len ? chars[((b1 & 0x0f) << 2) | (b2 >> 6)] : (urlSafe ? '' : '=');
    result += i + 2 < len ? chars[b2 & 0x3f] : (urlSafe ? '' : '=');
  }

  return result;
}

function decodeBase64(text: string): Uint8Array {
  // Strip data URL prefix if present
  const dataUrlMatch = text.match(/^data:[^;]+;base64,/);
  let cleaned = dataUrlMatch ? text.slice(dataUrlMatch[0].length) : text;

  // Strip whitespace
  cleaned = cleaned.replace(/\s/g, '');

  // Normalise URL-safe to standard
  cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if missing
  const pad = cleaned.length % 4;
  if (pad === 2) cleaned += '==';
  else if (pad === 3) cleaned += '=';

  const lookup = new Uint8Array(128);
  for (let i = 0; i < STANDARD_CHARS.length; i++) {
    lookup[STANDARD_CHARS.charCodeAt(i)] = i;
  }

  const outputLen = Math.floor(cleaned.length * 3 / 4) -
    (cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0);
  const output = new Uint8Array(outputLen);
  let outIdx = 0;

  for (let i = 0; i < cleaned.length; i += 4) {
    const a = lookup[cleaned.charCodeAt(i)]!;
    const b = lookup[cleaned.charCodeAt(i + 1)]!;
    const c = lookup[cleaned.charCodeAt(i + 2)]!;
    const d = lookup[cleaned.charCodeAt(i + 3)]!;

    output[outIdx++] = (a << 2) | (b >> 4);
    if (cleaned[i + 2] !== '=') output[outIdx++] = ((b & 0x0f) << 4) | (c >> 2);
    if (cleaned[i + 3] !== '=') output[outIdx++] = ((c & 0x03) << 6) | d;
  }

  return output;
}

const Base64ComponentStub = (): unknown => null;

export const base64: ToolModule<Base64Params> = {
  id: 'base64',
  slug: 'base64',
  name: 'Base64',
  description: 'Encode any file to Base64 text or decode Base64 back to bytes.',
  category: 'convert',
  presence: 'both',
  keywords: ['base64', 'encode', 'decode', 'binary', 'text', 'data-url'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { mode: 'encode', urlSafe: false },

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'encode', label: 'encode (binary → Base64)' },
        { value: 'decode', label: 'decode (Base64 → binary)' },
      ],
    },
    urlSafe: {
      type: 'boolean',
      label: 'URL-safe',
      help: 'Use the URL-safe alphabet (- and _ instead of + and /). Required for tokens used in URLs.',
    },
  },

  Component: Base64ComponentStub,

  async run(
    inputs: File[],
    params: Base64Params,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: `${params.mode === 'encode' ? 'Encoding' : 'Decoding'} Base64` });

    const file = inputs[0]!;

    if (params.mode === 'encode') {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const encoded = encodeBase64(bytes, params.urlSafe ?? false);
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([encoded], { type: 'text/plain' })];
    } else {
      const text = await file.text();
      const decoded = decodeBase64(text);
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([decoded.buffer as ArrayBuffer], { type: file.type || 'application/octet-stream' })];
    }
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
