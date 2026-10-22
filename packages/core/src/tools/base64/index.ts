import type { ToolModule, ToolRunContext } from '../../types.js';
import type { Base64Params } from './types.js';
import { defaultBase64Params } from './types.js';

export type { Base64Params } from './types.js';
export { defaultBase64Params } from './types.js';

const STANDARD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URLSAFE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function imageMime(bytes: Uint8Array): string {
  const startsWith = (signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (startsWith([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (startsWith([255, 216, 255])) return 'image/jpeg';
  if (startsWith([71, 73, 70, 56, 55, 97]) || startsWith([71, 73, 70, 56, 57, 97]))
    return 'image/gif';
  if (
    bytes.length >= 12 &&
    startsWith([82, 73, 70, 70]) &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80
  )
    return 'image/webp';
  throw new Error('Image output supports PNG, JPEG, GIF or WebP signatures only');
}

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
    result += i + 1 < len ? chars[((b1 & 0x0f) << 2) | (b2 >> 6)] : urlSafe ? '' : '=';
    result += i + 2 < len ? chars[b2 & 0x3f] : urlSafe ? '' : '=';
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

  const outputLen =
    Math.floor((cleaned.length * 3) / 4) -
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

export const base64: ToolModule<Base64Params> = {
  id: 'base64',
  slug: 'base64',
  name: 'Base64',
  description:
    'Encode any file to raw Base64 or decode Base64 back to bytes. Image data URL and CSS URL outputs sniff PNG, JPEG, GIF or WebP signatures within 5 MiB; signature recognition does not validate image structure.',
  category: 'convert',
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

  chainSuggestions: ['hash', 'hmac', 'text-escape', 'file-fingerprint'],
  defaults: defaultBase64Params,

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
    encodeOutput: {
      type: 'enum',
      label: 'Encode output',
      options: [
        { value: 'raw', label: 'Raw Base64' },
        { value: 'data-url', label: 'Image data URL' },
        { value: 'css-url', label: 'CSS image URL' },
      ],
      help: 'Image wrappers require the standard alphabet and use MIME from the byte signature. Full output is downloadable; large output may exceed inline preview and copy limits.',
      showWhen: { field: 'mode', equals: 'encode' },
    },
  },

  async run(inputs: File[], params: Base64Params, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');
    const encodeOutput = params.encodeOutput ?? 'raw';
    if (!['raw', 'data-url', 'css-url'].includes(encodeOutput))
      throw new Error('Invalid encode output');
    if (encodeOutput !== 'raw' && params.mode !== 'encode')
      throw new Error('Image output is available only in encode mode');
    if (encodeOutput !== 'raw') {
      if (inputs.length !== 1 || !inputs[0]) throw new Error('Exactly one image file is required');
      if (inputs[0].size > 5 * 1024 * 1024) throw new Error('Image output exceeds 5 MiB');
      if (params.urlSafe) throw new Error('URL-safe Base64 is not supported for image output');
    }
    ctx.onProgress({
      stage: 'processing',
      percent: 0,
      message: `${params.mode === 'encode' ? 'Encoding' : 'Decoding'} Base64`,
    });

    const file = inputs[0]!;

    if (params.mode === 'encode') {
      const buffer = await file.arrayBuffer();
      if (ctx.signal.aborted) throw new Error('Aborted');
      const bytes = new Uint8Array(buffer);
      const encoded = encodeBase64(bytes, params.urlSafe ?? false);
      let output = encoded;
      if (encodeOutput !== 'raw') {
        const mime = imageMime(bytes);
        if (file.type && file.type !== 'application/octet-stream' && file.type !== mime)
          throw new Error('Supplied MIME does not match image signature');
        const dataUrl = `data:${mime};base64,${encoded}`;
        output = encodeOutput === 'css-url' ? `url("${dataUrl}")` : dataUrl;
      }
      if (ctx.signal.aborted) throw new Error('Aborted');
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([output], { type: 'text/plain' })];
    } else {
      const text = await file.text();
      if (ctx.signal.aborted) throw new Error('Aborted');
      const decoded = decodeBase64(text);
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [
        new Blob([decoded.buffer as ArrayBuffer], {
          type: file.type || 'application/octet-stream',
        }),
      ];
    }
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
