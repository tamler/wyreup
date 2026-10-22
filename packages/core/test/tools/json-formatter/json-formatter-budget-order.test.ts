import { describe, expect, it, vi } from 'vitest';
import { formatJsonText } from '../../../src/tools/json-formatter/index.js';

function observeArrayAllocations(text: string): { sizes: number[]; error: unknown } {
  const OriginalArray = Array;
  const sizes: number[] = [];
  class ObservedArray extends OriginalArray<unknown> {
    constructor(length: number) {
      sizes.push(length);
      super(length);
    }
  }
  let error: unknown;
  vi.stubGlobal('Array', ObservedArray);
  try { formatJsonText(text, { indent: 0 }); }
  catch (caught) { error = caught; }
  finally { vi.unstubAllGlobals(); }
  return { sizes, error };
}

describe('JSON node budget before output allocation', () => {
  it('rejects an actual oversized parsed array before allocating its output', () => {
    const text = JSON.stringify(Array(100001).fill(0));
    const { sizes, error } = observeArrayAllocations(text);
    expect(error).toMatchObject({ name: 'UtilityInputError', code: 'budget' });
    expect(sizes).toEqual([]);
  });

  it('rejects oversized object members before allocating a cloned output record', () => {
    const input: Record<string, number> = {};
    for (let index = 0; index < 100000; index++) input[`k${index}`] = index;
    const text = JSON.stringify(input);
    const create = vi.spyOn(Object, 'create');
    let error: unknown;
    let outputAllocations = 0;
    let validationAllocations = 0;
    try {
      formatJsonText('null', { indent: 0, sortKeys: true });
      validationAllocations = create.mock.calls.filter(args => args[0] === null).length;
      create.mockClear();
      try { formatJsonText(text, { indent: 0, sortKeys: true }); }
      catch (caught) { error = caught; }
      outputAllocations = create.mock.calls.filter(args => args[0] === null).length;
    } finally { create.mockRestore(); }
    expect(error).toMatchObject({ name: 'UtilityInputError', code: 'budget' });
    expect(outputAllocations).toBe(validationAllocations);
  });

  it('accepts exactly 100000 values including the root array', () => {
    const text = JSON.stringify(Array(99999).fill(0));
    expect(formatJsonText(text, { indent: 0 })).toBe(text);
  });

  it('counts queued siblings before allocating a nested array', () => {
    const text = JSON.stringify([[0], ...Array<number>(99998).fill(0)]);
    const { sizes, error } = observeArrayAllocations(text);
    expect(error).toMatchObject({ name: 'UtilityInputError', code: 'budget' });
    expect(sizes).toEqual([99999]);
  });

  it('accepts a nested container when the full pending count is exactly the budget', () => {
    const text = JSON.stringify([[0], ...Array<number>(99997).fill(0)]);
    expect(formatJsonText(text, { indent: 0 })).toBe(text);
  });

  it('counts queued object siblings and preserves their data at the exact boundary', () => {
    const exact = JSON.stringify({ nested: [0], rest: Array(99996).fill(0) });
    expect(formatJsonText(exact, { indent: 0 })).toBe(exact);
    const over = JSON.stringify({ nested: [0], rest: Array(99997).fill(0) });
    expect(() => formatJsonText(over, { indent: 0 })).toThrow('100,000');
  });
});
