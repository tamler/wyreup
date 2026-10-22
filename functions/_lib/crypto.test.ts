import { describe, expect, it } from 'vitest';
import { parseCookies, signSessionCookie, verifySessionCookie } from './crypto';

describe('session cookies', () => {
  it('rejects tampered, expired and oversized cookies', async () => {
    const payload = { uid: 'user', kid: 'key', exp: Date.now() + 60_000 };
    const valid = await signSessionCookie(payload, 'secret');
    expect(await verifySessionCookie(valid, 'secret')).toEqual(payload);
    expect(await verifySessionCookie(valid.replace('user.', 'other.'), 'secret')).toBeNull();
    expect(await verifySessionCookie(await signSessionCookie({ ...payload, exp: 1 }, 'secret'), 'secret')).toBeNull();
    expect(await verifySessionCookie('x'.repeat(513), 'secret')).toBeNull();
  });
  it('ignores malformed percent encoding without losing well-formed cookies', () => {
    expect(parseCookies('bad=%E0%A4%A; good=hello%20world')).toEqual({ good: 'hello world' });
  });
});
