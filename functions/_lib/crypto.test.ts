import { expect, it } from 'vitest';
import { hmacSha256Hex } from './crypto';

it('matches the RFC 4231 HMAC-SHA-256 test vector', async () => {
  expect(await hmacSha256Hex('\x0b'.repeat(20), 'Hi There')).toBe(
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  );
});
