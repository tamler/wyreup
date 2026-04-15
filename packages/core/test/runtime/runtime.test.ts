import { describe, it, expect } from 'vitest';
import { getRuntimeAdapter } from '../../src/runtime/types.js';

describe('runtime adapter', () => {
  it('getRuntimeAdapter returns an object with expected methods', () => {
    const adapter = getRuntimeAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.createCanvas).toBe('function');
    expect(typeof adapter.createImageFromBlob).toBe('function');
    expect(typeof adapter.isAvailable).toBe('function');
  });

  it('adapter reports availability', () => {
    const adapter = getRuntimeAdapter();
    const available = adapter.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});
