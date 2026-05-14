import type { ToolModule, ToolRunContext } from '../../types.js';

export type SignedUrlAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export interface SignedUrlParams {
  mode?: 'sign' | 'verify';
  url?: string;
  secret?: string;
  algorithm?: SignedUrlAlgorithm;
  /** Lifetime in seconds. Sign sets `e=<expiry-unix>`, verify checks it. 0 = no expiry. */
  expiresInSeconds?: number;
  /** Query-string key used for the signature. Defaults to "s". */
  signatureParam?: string;
  /** Query-string key used for the expiry timestamp. Defaults to "e". */
  expiryParam?: string;
}

export const defaultSignedUrlParams: SignedUrlParams = {
  mode: 'sign',
  url: '',
  secret: '',
  algorithm: 'SHA-256',
  expiresInSeconds: 300,
  signatureParam: 's',
  expiryParam: 'e',
};

export interface SignedUrlResult {
  mode: 'sign' | 'verify';
  url: string;
  /** Sign: produced. Verify: re-computed for comparison. */
  signature: string;
  /** Verify only: signature found on the URL. */
  providedSignature?: string;
  /** Verify only: true if signature matches and (when expiry set) not expired. */
  valid?: boolean;
  /** Verify only: when the URL expires (epoch seconds), null if no expiry param. */
  expiresAt?: number | null;
  /** Verify only: true if expiry has already passed. */
  expired?: boolean;
}

const SignedUrlComponentStub = (): unknown => null;

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

async function hmacHex(secret: string, message: string, algorithm: SignedUrlAlgorithm): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message) as BufferSource),
  );
  return toHex(sig);
}

/**
 * Build the canonical signing input. We strip the signature param (if
 * present) and re-encode with sorted keys so the same URL always hashes
 * to the same value regardless of param order. The signed input is
 * <pathname>?<sorted-params> — host + protocol are NOT in the signature
 * so CDN edges that proxy across hostnames don't invalidate.
 */
function canonicalSigningInput(url: URL, signatureParam: string): string {
  const entries: Array<[string, string]> = [];
  url.searchParams.forEach((v, k) => {
    if (k !== signatureParam) entries.push([k, v]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${url.pathname}${search ? '?' + search : ''}`;
}

function parseUrlOrThrow(input: string): URL {
  try {
    return new URL(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse URL: ${msg}`);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const signedUrl: ToolModule<SignedUrlParams> = {
  id: 'signed-url',
  slug: 'signed-url',
  name: 'Signed URL',
  description:
    'Generate or verify an HMAC-signed URL (S3-presign style). Combines url-parse + hmac — append a signature and optional expiry, verify by recomputing. Canonicalized so query-param order doesn\'t change the signature.',
  category: 'inspect',
  presence: 'both',
  keywords: ['signed', 'url', 'presigned', 'hmac', 's3', 'token', 'expiry', 'auth'],

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

  defaults: defaultSignedUrlParams,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'sign', label: 'sign — generate a signed URL' },
        { value: 'verify', label: 'verify — check an existing one' },
      ],
    },
    url: {
      type: 'string',
      label: 'URL',
      placeholder: 'https://api.example.com/files/report.pdf',
      multiline: false,
    },
    secret: {
      type: 'string',
      label: 'secret',
      help: 'Shared HMAC key. Never uploaded.',
      placeholder: 'your-shared-secret',
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      options: [
        { value: 'SHA-256', label: 'SHA-256 (default)' },
        { value: 'SHA-1', label: 'SHA-1' },
        { value: 'SHA-384', label: 'SHA-384' },
        { value: 'SHA-512', label: 'SHA-512' },
      ],
    },
    expiresInSeconds: {
      type: 'number',
      label: 'expires (s)',
      help: 'Lifetime in seconds. 0 to skip the expiry param.',
      min: 0,
      max: 31536000,
      step: 1,
      unit: 's',
      showWhen: { field: 'mode', equals: 'sign' },
    },
    signatureParam: {
      type: 'string',
      label: 'signature param',
      placeholder: 's',
    },
    expiryParam: {
      type: 'string',
      label: 'expiry param',
      placeholder: 'e',
    },
  },

  Component: SignedUrlComponentStub,

  async run(_inputs: File[], params: SignedUrlParams, ctx: ToolRunContext): Promise<Blob[]> {
    const mode = params.mode ?? 'sign';
    const secret = params.secret ?? '';
    if (!secret) throw new Error('signed-url requires a secret.');
    const rawUrl = (params.url ?? '').trim();
    if (!rawUrl) throw new Error('signed-url requires a URL.');
    const algorithm = params.algorithm ?? 'SHA-256';
    const signatureParam = params.signatureParam ?? 's';
    const expiryParam = params.expiryParam ?? 'e';

    const url = parseUrlOrThrow(rawUrl);

    if (mode === 'sign') {
      const expiresInSeconds = params.expiresInSeconds ?? 0;
      if (expiresInSeconds > 0) {
        const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
        url.searchParams.set(expiryParam, String(expiresAt));
      }
      url.searchParams.delete(signatureParam);
      ctx.onProgress({ stage: 'processing', percent: 60, message: 'Signing' });
      const signature = await hmacHex(secret, canonicalSigningInput(url, signatureParam), algorithm);
      url.searchParams.set(signatureParam, signature);
      const result: SignedUrlResult = { mode, url: url.href, signature };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
    }

    // verify
    const provided = url.searchParams.get(signatureParam) ?? '';
    if (!provided) throw new Error(`URL has no "${signatureParam}" parameter to verify.`);
    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Verifying' });
    const expected = await hmacHex(secret, canonicalSigningInput(url, signatureParam), algorithm);
    const expiryRaw = url.searchParams.get(expiryParam);
    const expiresAt = expiryRaw && /^\d+$/.test(expiryRaw) ? Number(expiryRaw) : null;
    const expired = expiresAt !== null && Math.floor(Date.now() / 1000) > expiresAt;

    const result: SignedUrlResult = {
      mode,
      url: url.href,
      signature: expected,
      providedSignature: provided,
      valid: !expired && constantTimeEqual(expected.toLowerCase(), provided.toLowerCase()),
      expiresAt,
      expired,
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
