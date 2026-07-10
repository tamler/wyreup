import { describe, it, expect } from 'vitest';
import { decodeBase32 } from '../../../src/tools/base32/index.js';

describe('base32 — decodeBase32()', () => {
  it('strips a pathological padding suffix in under one second', () => {
    const input = '='.repeat(100_000);
    const start = performance.now();
    const result = decodeBase32(input, false);

    expect(result).toHaveLength(0);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
