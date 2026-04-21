import { describe, it, expect } from 'vitest';
import { jsonFormatter } from '../../../src/tools/json-formatter/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('json-formatter — metadata', () => {
  it('has id json-formatter', () => {
    expect(jsonFormatter.id).toBe('json-formatter');
  });

  it('is in the inspect category', () => {
    expect(jsonFormatter.category).toBe('inspect');
  });

  it('accepts text/plain and application/json', () => {
    expect(jsonFormatter.input.accept).toContain('text/plain');
    expect(jsonFormatter.input.accept).toContain('application/json');
  });

  it('defaults to indent 2', () => {
    expect(jsonFormatter.defaults.indent).toBe(2);
  });
});

describe('json-formatter — run()', () => {
  it('formats minified JSON with default indent', async () => {
    const input = new File(['{"a":1,"b":{"c":2}}'], 'test.json', { type: 'application/json' });
    const [out] = await jsonFormatter.run([input], { indent: 2 }, makeCtx()) as Blob[];
    expect(out!.type).toBe('application/json');
    const text = await out!.text();
    const parsed = JSON.parse(text) as unknown;
    expect(parsed).toEqual({ a: 1, b: { c: 2 } });
    expect(text).toContain('\n');
    expect(text).toContain('  ');
  });

  it('preserves data types (numbers, booleans, null, arrays)', async () => {
    const data = { n: 42, f: 3.14, b: true, nil: null, arr: [1, 2, 3] };
    const input = new File([JSON.stringify(data)], 'test.json', { type: 'application/json' });
    const [out] = await jsonFormatter.run([input], { indent: 2 }, makeCtx()) as Blob[];
    const result = JSON.parse(await out!.text()) as { n: number; f: number; b: boolean; nil: null; arr: number[] };
    expect(result.n).toBe(42);
    expect(result.f).toBeCloseTo(3.14);
    expect(result.b).toBe(true);
    expect(result.nil).toBeNull();
    expect(result.arr).toEqual([1, 2, 3]);
  });

  it('throws on invalid JSON with a readable error', async () => {
    const input = new File(['{not valid json}'], 'bad.json', { type: 'application/json' });
    await expect(jsonFormatter.run([input], { indent: 2 }, makeCtx())).rejects.toThrow('Invalid JSON');
  });

  it('handles nested objects', async () => {
    const nested = { a: { b: { c: { d: 'deep' } } } };
    const input = new File([JSON.stringify(nested)], 'nested.json', { type: 'application/json' });
    const [out] = await jsonFormatter.run([input], { indent: 4 }, makeCtx()) as Blob[];
    const text = await out!.text();
    expect(text).toContain('    ');
    expect(JSON.parse(text) as unknown).toEqual(nested);
  });
});
