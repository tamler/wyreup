import type { ToolModule, ToolRunContext } from '../../types.js';

export type JwtDecoderParams = Record<string, never>;

export interface JwtDecoderResult {
  valid: boolean;
  error?: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signaturePresent: boolean;
}

export const defaultJwtDecoderParams: JwtDecoderParams = {};

function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  return atob(base64);
}

function decodeJwt(token: string): JwtDecoderResult {
  const parts = token.trim().split('.');
  if (parts.length < 2) {
    return {
      valid: false,
      error: 'Invalid JWT: expected at least 2 dot-separated parts',
      header: {},
      payload: {},
      signaturePresent: false,
    };
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;

  try {
    header = JSON.parse(base64urlDecode(parts[0]!)) as Record<string, unknown>;
  } catch (e) {
    return {
      valid: false,
      error: `Failed to decode header: ${(e as Error).message}`,
      header: {},
      payload: {},
      signaturePresent: parts.length === 3 && parts[2] !== '',
    };
  }

  try {
    payload = JSON.parse(base64urlDecode(parts[1]!)) as Record<string, unknown>;
  } catch (e) {
    return {
      valid: false,
      error: `Failed to decode payload: ${(e as Error).message}`,
      header,
      payload: {},
      signaturePresent: parts.length === 3 && parts[2] !== '',
    };
  }

  return {
    valid: true,
    header,
    payload,
    signaturePresent: parts.length === 3 && parts[2] !== '',
  };
}

export const jwtDecoder: ToolModule<JwtDecoderParams> = {
  id: 'jwt-decoder',
  slug: 'jwt-decoder',
  name: 'JWT Decoder',
  description:
    'Decode JWT header and payload. Does NOT verify the signature — for inspection only.',
  category: 'dev',
  keywords: ['jwt', 'token', 'decode', 'auth', 'bearer', 'payload', 'header', 'base64url'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJwtDecoderParams,

  async run(
    inputs: File[],
    _params: JwtDecoderParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Decoding JWT' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const result = decodeJwt(text.trim());

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
