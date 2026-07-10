// Crypto + session helpers for Pages Functions.
// All built on the standard `crypto.subtle` API available in the Workers
// runtime — no external dependency. See docs/pro-auth-spec.md §18.

const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return bytesToHex(new Uint8Array(buf));
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return bytesToHex(new Uint8Array(sig));
}

// Length-only early-bail. Body runs in time proportional to length regardless
// of where the first differing byte sits.
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SessionPayload {
  uid: string;
  kid: string;
  exp: number;
}

export async function signSessionCookie(payload: SessionPayload, secret: string): Promise<string> {
  const body = `${payload.uid}.${payload.kid}.${payload.exp}`;
  const mac = await hmacSha256Hex(secret, body);
  return `${body}.${mac}`;
}

export async function verifySessionCookie(
  cookie: string,
  secret: string,
): Promise<SessionPayload | null> {
  const parts = cookie.split('.');
  if (parts.length !== 4) return null;
  const [uid, kid, expStr, mac] = parts;
  const body = `${uid}.${kid}.${expStr}`;
  const expected = await hmacSha256Hex(secret, body);
  if (!timingSafeEqualHex(mac, expected)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return { uid, kid, exp };
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (const byte of b) out += byte.toString(16).padStart(2, '0');
  return out;
}

// Generate a fresh API key: 32 random bytes, hex-encoded, prefixed.
export function generateApiKey(prefix: 'wk_live_' | 'wk_test_' = 'wk_live_'): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + bytesToHex(bytes);
}

// Compact unique IDs (URL-safe, ~22 chars). Avoids pulling in nanoid as a
// dep — we don't need its full feature set.
export function nanoid(size = 21): string {
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < size; i++) out += alphabet[bytes[i] & 63];
  return out;
}
