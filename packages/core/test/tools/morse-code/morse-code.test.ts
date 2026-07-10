import { describe, it, expect } from 'vitest';
import { decodeMorse } from '../../../src/tools/morse-code/index.js';

describe('morse-code — decodeMorse()', () => {
  it('handles pathological separator whitespace in under one second', () => {
    const input = `.${' '.repeat(100_000)}.`;
    const start = performance.now();
    const result = decodeMorse(input);

    expect(result).toBe('EE');
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
