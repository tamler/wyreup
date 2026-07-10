import { describe, it, expect } from 'vitest';
import { decodeArmor, encodeArmor } from '../../../src/tools/pgp-armor/index.js';

describe('pgp-armor — decodeArmor()', () => {
  it('skips a pathological unterminated block in under one second', () => {
    const invalid = `-----BEGIN PGP MESSAGE-----\n${'-----END PGP MESSAG'.repeat(5_000)}`;
    const valid = encodeArmor(new Uint8Array([1, 2, 3]), 'SIGNATURE', 'test', '');
    const input = `${invalid}\n${valid}`;
    const start = performance.now();
    const result = decodeArmor(input);

    expect(result.blockType).toBe('SIGNATURE');
    expect(result.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
