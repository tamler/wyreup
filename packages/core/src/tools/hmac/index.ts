import type { ToolModule, ToolRunContext } from '../../types.js';

export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type HmacEncoding = 'hex' | 'base64';

export interface HmacParams {
  algorithm?: HmacAlgorithm;
  /** Secret key (UTF-8). Required. */
  key?: string;
  encoding?: HmacEncoding;
}

export const defaultHmacParams: HmacParams = {
  algorithm: 'SHA-256',
  key: '',
  encoding: 'hex',
};

export interface HmacResult {
  name: string;
  bytes: number;
  algorithm: HmacAlgorithm;
  encoding: HmacEncoding;
  digest: string;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export async function computeHmac(
  message: ArrayBuffer,
  key: string,
  algorithm: HmacAlgorithm,
  encoding: HmacEncoding,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, message);
  const bytes = new Uint8Array(sig);
  return encoding === 'base64' ? toBase64(bytes) : toHex(bytes);
}

export const hmac: ToolModule<HmacParams> = {
  id: 'hmac',
  slug: 'hmac',
  name: 'HMAC',
  description:
    'Compute an HMAC signature of a file with your own secret key. Pairs with the hash tool — use HMAC when you also need authentication, not just integrity.',
  category: 'inspect',
  keywords: ['hmac', 'signature', 'mac', 'sha256', 'sha512', 'sha1', 'authentication', 'integrity', 'sign'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultHmacParams,

  paramSchema: {
    key: {
      type: 'string',
      label: 'secret key',
      help: 'UTF-8 string used as the HMAC key. Never uploaded — stays on this device.',
      placeholder: 'shared-secret',
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      options: [
        { value: 'SHA-256', label: 'HMAC-SHA-256 (recommended)' },
        { value: 'SHA-1', label: 'HMAC-SHA-1' },
        { value: 'SHA-384', label: 'HMAC-SHA-384' },
        { value: 'SHA-512', label: 'HMAC-SHA-512' },
      ],
    },
    encoding: {
      type: 'enum',
      label: 'output encoding',
      options: [
        { value: 'hex', label: 'hex (lowercase)' },
        { value: 'base64', label: 'base64' },
      ],
    },
  },

  async run(inputs: File[], params: HmacParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('hmac accepts exactly one file.');
    const key = params.key ?? '';
    if (!key) throw new Error('hmac requires a non-empty secret key.');
    const algorithm = params.algorithm ?? 'SHA-256';
    const encoding = params.encoding ?? 'hex';
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 30, message: `HMAC-${algorithm}` });
    const buffer = await input.arrayBuffer();
    if (ctx.signal.aborted) throw new Error('Aborted');

    const digest = await computeHmac(buffer, key, algorithm, encoding);

    const result: HmacResult = {
      name: input.name,
      bytes: buffer.byteLength,
      algorithm,
      encoding,
      digest,
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
