import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../../../src/tools/text-template/index.js';

describe('text-template — renderTemplate()', () => {
  it('leaves a pathological empty placeholder unchanged in under one second', () => {
    const input = `{{${' '.repeat(100_000)}}}`;
    const start = performance.now();
    const result = renderTemplate(input, {});

    expect(result.rendered).toBe(input);
    expect(result.resolved).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
