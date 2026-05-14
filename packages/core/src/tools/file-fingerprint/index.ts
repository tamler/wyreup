import type { ToolModule, ToolRunContext } from '../../types.js';
import { detectMime } from '../mime-detect/index.js';

export type FingerprintHashAlgo = 'SHA-1' | 'SHA-256' | 'SHA-512';
export type FingerprintHmacAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export interface FileFingerprintParams {
  algorithms?: FingerprintHashAlgo[];
  /** Optional HMAC secret. Empty → skip HMAC. */
  hmacSecret?: string;
  hmacAlgorithm?: FingerprintHmacAlgo;
  /** How many bytes of the file head to include as a hex preview. */
  headBytes?: number;
}

export const defaultFileFingerprintParams: FileFingerprintParams = {
  algorithms: ['SHA-256'],
  hmacSecret: '',
  hmacAlgorithm: 'SHA-256',
  headBytes: 32,
};

export interface FileFingerprintResult {
  name: string;
  size: number;
  declaredMime: string;
  detectedMime: string;
  detectionSignature: string;
  extension: string;
  mimeMismatch: boolean;
  /** Hex head preview — first N bytes of the file. */
  headHex: string;
  /** Hashes (hex) keyed by algorithm. */
  hashes: Partial<Record<FingerprintHashAlgo, string>>;
  /** HMAC digest (hex) if a secret was provided. */
  hmac: { algorithm: FingerprintHmacAlgo; digest: string } | null;
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

async function digest(buffer: ArrayBuffer, algorithm: FingerprintHashAlgo): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.digest(algorithm, buffer));
  return toHex(sig);
}

async function hmacHex(buffer: ArrayBuffer, secret: string, algorithm: FingerprintHmacAlgo): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer));
  return toHex(sig);
}

export const fileFingerprint: ToolModule<FileFingerprintParams> = {
  id: 'file-fingerprint',
  slug: 'file-fingerprint',
  name: 'File Fingerprint',
  description:
    'Build an identity bundle for a file: size, declared-vs-detected MIME, hashes (SHA-1 / SHA-256 / SHA-512), optional HMAC, and a hex head preview. "Is this file exactly what I think it is?" in one drop.',
  category: 'inspect',
  keywords: ['fingerprint', 'identity', 'hash', 'sha256', 'hmac', 'mime', 'verify', 'integrity'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 1024 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultFileFingerprintParams,

  paramSchema: {
    algorithms: {
      type: 'multi-enum',
      label: 'hash algorithms',
      options: [
        { value: 'SHA-1', label: 'SHA-1' },
        { value: 'SHA-256', label: 'SHA-256 (recommended)' },
        { value: 'SHA-512', label: 'SHA-512' },
      ],
    },
    hmacSecret: {
      type: 'string',
      label: 'HMAC secret (optional)',
      help: 'When set, the file is also signed under this key. Leave blank to skip.',
      placeholder: 'shared-secret',
    },
    hmacAlgorithm: {
      type: 'enum',
      label: 'HMAC algorithm',
      options: [
        { value: 'SHA-256', label: 'HMAC-SHA-256 (recommended)' },
        { value: 'SHA-1', label: 'HMAC-SHA-1' },
        { value: 'SHA-384', label: 'HMAC-SHA-384' },
        { value: 'SHA-512', label: 'HMAC-SHA-512' },
      ],
    },
    headBytes: {
      type: 'number',
      label: 'head preview bytes',
      help: 'Number of bytes from the start of the file to render as a hex preview.',
      min: 0,
      max: 256,
      step: 4,
    },
  },

  async run(inputs: File[], params: FileFingerprintParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('file-fingerprint accepts exactly one file.');
    const file = inputs[0]!;
    const algorithms: FingerprintHashAlgo[] =
      params.algorithms && params.algorithms.length > 0 ? params.algorithms : ['SHA-256'];
    const headBytes = Math.max(0, Math.min(256, params.headBytes ?? 32));

    ctx.onProgress({ stage: 'processing', percent: 15, message: 'Reading file' });
    const buffer = await file.arrayBuffer();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Detecting MIME' });
    // Reuse mime-detect's signature table (the reason it's an exported pure
    // function — no duplicated tables here).
    const head = new Uint8Array(buffer.slice(0, Math.max(headBytes, 512)));
    const detection = detectMime(head);

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Hashing' });
    const hashes: Partial<Record<FingerprintHashAlgo, string>> = {};
    for (const algo of algorithms) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      hashes[algo] = await digest(buffer, algo);
    }

    let hmac: FileFingerprintResult['hmac'] = null;
    const secret = params.hmacSecret ?? '';
    if (secret) {
      ctx.onProgress({ stage: 'processing', percent: 85, message: 'Signing (HMAC)' });
      const algorithm = params.hmacAlgorithm ?? 'SHA-256';
      hmac = { algorithm, digest: await hmacHex(buffer, secret, algorithm) };
    }

    const declared = file.type || '';
    const result: FileFingerprintResult = {
      name: file.name,
      size: file.size,
      declaredMime: declared,
      detectedMime: detection.mime,
      detectionSignature: detection.signature,
      extension: detection.ext,
      mimeMismatch: declared !== '' && declared !== detection.mime,
      headHex: toHex(new Uint8Array(buffer.slice(0, headBytes))),
      hashes,
      hmac,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
