import type { ToolModule, ToolRunContext } from '../../types.js';

export type JwtSignAlgorithm = 'HS256' | 'HS384' | 'HS512';

export interface JwtSignParams {
  /** JSON payload (claims). Required. */
  payload?: string;
  /** Extra header fields as JSON. typ/alg are always set. Optional. */
  header?: string;
  /** HMAC shared secret (UTF-8). Required. */
  secret?: string;
  algorithm?: JwtSignAlgorithm;
}

export const defaultJwtSignParams: JwtSignParams = {
  payload: '',
  header: '',
  secret: '',
  algorithm: 'HS256',
};

export interface JwtSignResult {
  token: string;
  parts: { header: string; payload: string; signature: string };
  algorithm: JwtSignAlgorithm;
}

const JwtSignComponentStub = (): unknown => null;

const ALGO_HASH: Record<JwtSignAlgorithm, 'SHA-256' | 'SHA-384' | 'SHA-512'> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 = typeof Buffer !== 'undefined'
    ? Buffer.from(bytes).toString('base64')
    : btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJsonSegment(jsonText: string, label: string): { encoded: string; json: string } {
  let normalized: string;
  if (jsonText.trim() === '') {
    normalized = '{}';
  } else {
    try {
      // Re-stringify so user formatting doesn't leak into the token signature.
      normalized = JSON.stringify(JSON.parse(jsonText));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${label} is not valid JSON: ${msg}`);
    }
  }
  const bytes = new TextEncoder().encode(normalized);
  return { encoded: base64UrlEncode(bytes), json: normalized };
}

export async function signJwt(
  payloadJson: string,
  extraHeaderJson: string,
  secret: string,
  algorithm: JwtSignAlgorithm,
): Promise<JwtSignResult> {
  if (!secret) throw new Error('jwt-sign requires a non-empty secret.');

  const payload = encodeJsonSegment(payloadJson, 'Payload');
  const baseHeader = { alg: algorithm, typ: 'JWT' };
  let mergedHeader: Record<string, unknown>;
  if (extraHeaderJson.trim() === '') {
    mergedHeader = baseHeader;
  } else {
    try {
      const parsed: unknown = JSON.parse(extraHeaderJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Header must be a JSON object.');
      }
      mergedHeader = { ...(parsed as Record<string, unknown>), ...baseHeader };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Header is not valid JSON: ${msg}`);
    }
  }
  const header = encodeJsonSegment(JSON.stringify(mergedHeader), 'Header');

  const signingInput = `${header.encoded}.${payload.encoded}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: ALGO_HASH[algorithm] },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signingInput) as BufferSource),
  );
  const signature = base64UrlEncode(sig);
  const token = `${signingInput}.${signature}`;

  return {
    token,
    parts: { header: header.encoded, payload: payload.encoded, signature },
    algorithm,
  };
}

export const jwtSign: ToolModule<JwtSignParams> = {
  id: 'jwt-sign',
  slug: 'jwt-sign',
  name: 'JWT Sign',
  description:
    'Build a JWT (HS256 / HS384 / HS512) from a payload and a shared secret. Inverse of jwt-decoder — useful for testing APIs that authenticate with HMAC-signed tokens.',
  category: 'inspect',
  presence: 'both',
  keywords: ['jwt', 'sign', 'token', 'hmac', 'hs256', 'hs384', 'hs512', 'auth', 'bearer'],

  input: {
    accept: ['*/*'],
    min: 0,
    sizeLimit: 0,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJwtSignParams,

  paramSchema: {
    payload: {
      type: 'string',
      label: 'payload (claims)',
      help: 'JSON object — e.g. {"sub":"abc","iat":1700000000,"exp":1700003600}.',
      placeholder: '{"sub":"user_123","iat":1700000000}',
      multiline: true,
    },
    header: {
      type: 'string',
      label: 'extra header fields',
      help: 'Optional. JSON object whose keys merge into the header. typ and alg are set automatically.',
      placeholder: '{"kid":"key-1"}',
      multiline: true,
    },
    secret: {
      type: 'string',
      label: 'secret',
      help: 'HMAC key. Never uploaded.',
      placeholder: 'your-shared-secret',
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      options: [
        { value: 'HS256', label: 'HS256 (default)' },
        { value: 'HS384', label: 'HS384' },
        { value: 'HS512', label: 'HS512' },
      ],
    },
  },

  Component: JwtSignComponentStub,

  async run(_inputs: File[], params: JwtSignParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (!params.payload || params.payload.trim() === '') {
      throw new Error('jwt-sign requires a JSON payload.');
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Signing' });
    const result = await signJwt(
      params.payload,
      params.header ?? '',
      params.secret ?? '',
      params.algorithm ?? 'HS256',
    );
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
