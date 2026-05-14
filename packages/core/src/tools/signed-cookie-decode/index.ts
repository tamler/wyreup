import type { ToolModule, ToolRunContext } from '../../types.js';

export type CookieAlgorithm = 'SHA-256' | 'SHA-1' | 'SHA-384' | 'SHA-512';
export type CookieStyle = 'express' | 'rails' | 'flask' | 'auto';

export interface SignedCookieDecodeParams {
  /** Cookie value (the URL-decoded string from the browser). */
  cookie?: string;
  /** Shared signing secret. */
  secret?: string;
  /** Framework convention to parse. "auto" sniffs by separator. */
  style?: CookieStyle;
  algorithm?: CookieAlgorithm;
}

export const defaultSignedCookieDecodeParams: SignedCookieDecodeParams = {
  cookie: '',
  secret: '',
  style: 'auto',
  algorithm: 'SHA-256',
};

export interface SignedCookieDecodeResult {
  style: CookieStyle;
  algorithm: CookieAlgorithm;
  /** What the cookie carried as its payload — usually JSON or a session id. */
  value: string;
  /** Signature found on the cookie. */
  providedSignature: string;
  /** Signature we recomputed from `value` + secret. */
  expectedSignature: string;
  valid: boolean;
}

function toBase64Url(bytes: Uint8Array): string {
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(bytes).toString('base64');
  } else {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacBytes(secret: string, message: string, algorithm: CookieAlgorithm): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message) as BufferSource);
  return new Uint8Array(sig);
}

interface SplitResult {
  value: string;
  signature: string;
  style: CookieStyle;
}

function splitCookie(cookie: string, style: CookieStyle): SplitResult {
  // Express (cookie-signature): "<value>.<base64url-signature>"
  // Rails (signed cookie):       "<base64url-value>--<hex-signature>"  (older) or
  //                              "<base64url-payload>--<base64url-sig>"
  // Flask (itsdangerous):        "<base64url-payload>.<timestamp>.<base64url-sig>"
  if (style === 'auto') {
    if (cookie.includes('--')) return splitCookie(cookie, 'rails');
    const parts = cookie.split('.');
    if (parts.length === 3) return splitCookie(cookie, 'flask');
    return splitCookie(cookie, 'express');
  }
  if (style === 'express') {
    const dot = cookie.lastIndexOf('.');
    if (dot < 0) throw new Error('Express cookie has no "." separator.');
    return { value: cookie.slice(0, dot), signature: cookie.slice(dot + 1), style: 'express' };
  }
  if (style === 'rails') {
    const sep = cookie.lastIndexOf('--');
    if (sep < 0) throw new Error('Rails cookie has no "--" separator.');
    return { value: cookie.slice(0, sep), signature: cookie.slice(sep + 2), style: 'rails' };
  }
  // Flask: payload.timestamp.signature — the signed input is "payload.timestamp".
  const parts = cookie.split('.');
  if (parts.length !== 3) throw new Error('Flask itsdangerous cookies have three "." parts.');
  return { value: `${parts[0]}.${parts[1]}`, signature: parts[2]!, style: 'flask' };
}

async function expectedSignatureFor(style: CookieStyle, value: string, secret: string, algorithm: CookieAlgorithm): Promise<string> {
  const sig = await hmacBytes(secret, value, algorithm);
  if (style === 'rails') return toHex(sig);
  // Express + Flask both use base64url. Express truncates `=` padding;
  // toBase64Url already strips it.
  return toBase64Url(sig);
}

export const signedCookieDecode: ToolModule<SignedCookieDecodeParams> = {
  id: 'signed-cookie-decode',
  slug: 'signed-cookie-decode',
  name: 'Signed Cookie Decode',
  description:
    'Verify and parse a signed cookie from Express (cookie-signature), Flask (itsdangerous), or Rails. Splits on the framework-specific separator, recomputes the HMAC under your secret, and reports valid + payload. Constant-time compare so timing can\'t lift the signature.',
  category: 'inspect',
  keywords: ['cookie', 'session', 'signed', 'verify', 'express', 'flask', 'rails', 'itsdangerous', 'hmac'],

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

  defaults: defaultSignedCookieDecodeParams,

  paramSchema: {
    cookie: {
      type: 'string',
      label: 'cookie value',
      help: 'Paste the URL-decoded cookie value. Express, Rails, and Flask have different separators — auto detects.',
      placeholder: 's%3A1234.signaturehere',
      multiline: true,
    },
    secret: {
      type: 'string',
      label: 'secret',
      help: 'The framework\'s signing key. Never uploaded.',
      placeholder: 'cookie-signing-secret',
    },
    style: {
      type: 'enum',
      label: 'style',
      options: [
        { value: 'auto', label: 'auto-detect' },
        { value: 'express', label: 'Express (cookie-signature)' },
        { value: 'rails', label: 'Rails (signed cookies)' },
        { value: 'flask', label: 'Flask (itsdangerous)' },
      ],
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      options: [
        { value: 'SHA-256', label: 'SHA-256 (default — Express 5, Flask, Rails 7+)' },
        { value: 'SHA-1', label: 'SHA-1 (legacy Express, older Rails)' },
        { value: 'SHA-384', label: 'SHA-384' },
        { value: 'SHA-512', label: 'SHA-512' },
      ],
    },
  },

  async run(_inputs: File[], params: SignedCookieDecodeParams, ctx: ToolRunContext): Promise<Blob[]> {
    const cookie = (params.cookie ?? '').trim();
    if (!cookie) throw new Error('signed-cookie-decode requires a cookie value.');
    const secret = params.secret ?? '';
    if (!secret) throw new Error('signed-cookie-decode requires a secret.');
    const algorithm = params.algorithm ?? 'SHA-256';

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Splitting cookie' });
    let split;
    try {
      split = splitCookie(cookie, params.style ?? 'auto');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    }

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Verifying signature' });
    const expected = await expectedSignatureFor(split.style, split.value, secret, algorithm);
    const a = split.style === 'rails' ? expected.toLowerCase() : expected;
    const b = split.style === 'rails' ? split.signature.toLowerCase() : split.signature;

    const result: SignedCookieDecodeResult = {
      style: split.style,
      algorithm,
      value: split.value,
      providedSignature: split.signature,
      expectedSignature: expected,
      valid: constantTimeEqual(a, b),
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
