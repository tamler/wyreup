// Redact the bearer token from arbitrary strings. Two patterns covered per
// [spec §#7]: the literal key string, and "Bearer <token>" (case-insensitive).
// URL-encoded / base64 variants are out of scope by design.

export function sanitize(msg: string, key: string | undefined): string {
  if (!msg) return msg;
  let out = msg;
  if (key) out = out.split(key).join('[REDACTED]');
  out = out.replace(/(bearer\s+)[A-Za-z0-9._\-+/=]+/gi, '$1[REDACTED]');
  return out;
}
