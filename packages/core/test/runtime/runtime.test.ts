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

  it('creates a usable canvas in Node', async () => {
    const canvas = (await getRuntimeAdapter().createCanvas(3, 2)) as {
      width: number;
      height: number;
      getContext(type: '2d'): unknown;
    };

    expect(canvas.width).toBe(3);
    expect(canvas.height).toBe(2);
    expect(canvas.getContext('2d')).toBeTruthy();
  });
});
