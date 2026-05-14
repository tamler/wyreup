import type { ToolModule, ToolRunContext } from '../../types.js';

export type PgpArmorBlockType =
  | 'MESSAGE'
  | 'PUBLIC KEY BLOCK'
  | 'PRIVATE KEY BLOCK'
  | 'SIGNATURE'
  | 'SIGNED MESSAGE';

export interface PgpArmorParams {
  mode?: 'encode' | 'decode';
  blockType?: PgpArmorBlockType;
  /** Optional Version: / Comment: header lines for encode mode. */
  version?: string;
  comment?: string;
}

export const defaultPgpArmorParams: PgpArmorParams = {
  mode: 'encode',
  blockType: 'MESSAGE',
  version: '',
  comment: '',
};

const PgpArmorComponentStub = (): unknown => null;

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const cleaned = text.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(cleaned, 'base64'));
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// CRC-24 per RFC 4880 §6.1. The polynomial 0x864CFB and seed 0xB704CE
// give the canonical OpenPGP armor checksum.
function crc24(bytes: Uint8Array): number {
  let crc = 0xb704ce;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]! << 16;
    for (let j = 0; j < 8; j++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

function crc24Base64(bytes: Uint8Array): string {
  const c = crc24(bytes);
  const buf = new Uint8Array([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]);
  return toBase64(buf);
}

function wrapBase64(text: string, width = 64): string {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\n');
}

export function encodeArmor(
  payload: Uint8Array,
  blockType: PgpArmorBlockType,
  version: string,
  comment: string,
): string {
  const begin = `-----BEGIN PGP ${blockType}-----`;
  const end = `-----END PGP ${blockType}-----`;
  const headers: string[] = [];
  if (version) headers.push(`Version: ${version}`);
  if (comment) headers.push(`Comment: ${comment}`);
  const body = wrapBase64(toBase64(payload));
  const checksum = `=${crc24Base64(payload)}`;
  return [begin, ...headers, '', body, checksum, end, ''].join('\n');
}

export interface ArmorDecode {
  blockType: PgpArmorBlockType;
  headers: Record<string, string>;
  payload: Uint8Array;
  checksumValid: boolean;
}

export function decodeArmor(text: string): ArmorDecode {
  const m = /-----BEGIN PGP ([A-Z ]+?)-----([\s\S]*?)-----END PGP \1-----/.exec(text);
  if (!m) throw new Error('No PGP armor block found.');
  const blockType = m[1]!.trim() as PgpArmorBlockType;
  const body = m[2]!;
  const lines = body.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let i = 0;
  // Skip leading blank lines.
  while (i < lines.length && lines[i]!.trim() === '') i++;
  // Header section ends at the first blank line.
  while (i < lines.length && lines[i]!.trim() !== '') {
    const line = lines[i]!;
    const sep = line.indexOf(':');
    if (sep > 0) {
      headers[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
    i++;
  }
  i++;
  // Collect base64 lines until the checksum (=...) or end of body.
  const dataLines: string[] = [];
  let checksumLine = '';
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('=')) {
      checksumLine = line.slice(1).trim();
      break;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    dataLines.push(line.trim());
    i++;
  }
  const payload = fromBase64(dataLines.join(''));
  const expected = checksumLine ? crc24Base64(payload) : '';
  const checksumValid = !checksumLine || checksumLine === expected;
  return { blockType, headers, payload, checksumValid };
}

export const pgpArmor: ToolModule<PgpArmorParams> = {
  id: 'pgp-armor',
  slug: 'pgp-armor',
  name: 'PGP Armor',
  description:
    'Wrap binary into OpenPGP ASCII armor with a CRC-24 checksum (or unwrap an existing armored block back to bytes + headers). Doesn\'t encrypt or sign — that\'s pgp-encrypt / pgp-sign. This tool only handles the armoring envelope.',
  category: 'convert',
  presence: 'both',
  keywords: ['pgp', 'armor', 'ascii-armor', 'encode', 'decode', 'crc24', 'rfc4880'],

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

  defaults: defaultPgpArmorParams,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'encode', label: 'encode (binary → armor)' },
        { value: 'decode', label: 'decode (armor → binary)' },
      ],
    },
    blockType: {
      type: 'enum',
      label: 'block type',
      help: 'Used only for encoding. Decoding reads the block type from the BEGIN line.',
      options: [
        { value: 'MESSAGE', label: 'MESSAGE' },
        { value: 'PUBLIC KEY BLOCK', label: 'PUBLIC KEY BLOCK' },
        { value: 'PRIVATE KEY BLOCK', label: 'PRIVATE KEY BLOCK' },
        { value: 'SIGNATURE', label: 'SIGNATURE' },
        { value: 'SIGNED MESSAGE', label: 'SIGNED MESSAGE' },
      ],
      showWhen: { field: 'mode', equals: 'encode' },
    },
    version: {
      type: 'string',
      label: 'Version header',
      help: 'Optional. Goes in the armor header section.',
      placeholder: 'Wyreup 1.0',
      showWhen: { field: 'mode', equals: 'encode' },
    },
    comment: {
      type: 'string',
      label: 'Comment header',
      help: 'Optional.',
      placeholder: 'https://wyreup.com',
      showWhen: { field: 'mode', equals: 'encode' },
    },
  },

  Component: PgpArmorComponentStub,

  async run(inputs: File[], params: PgpArmorParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('pgp-armor accepts exactly one file.');
    const mode = params.mode ?? 'encode';
    const file = inputs[0]!;

    if (mode === 'encode') {
      ctx.onProgress({ stage: 'processing', percent: 50, message: 'Encoding' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const armored = encodeArmor(bytes, params.blockType ?? 'MESSAGE', params.version ?? '', params.comment ?? '');
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([armored], { type: 'text/plain' })];
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Decoding' });
    const text = await file.text();
    const result = decodeArmor(text);
    if (!result.checksumValid) {
      throw new Error('Armor CRC-24 checksum mismatch — the payload may be corrupted.');
    }
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result.payload.buffer as ArrayBuffer], { type: 'application/octet-stream' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
