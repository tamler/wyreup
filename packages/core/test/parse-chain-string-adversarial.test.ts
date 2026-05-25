// Adversarial lock-down for parseChainString. The function dispatches
// agent-supplied tool IDs and params; these tests pin the threat model
// so a future refactor that adds eval / regex / nested-object coercion
// breaks loudly.

import { describe, it, expect } from 'vitest';
import { parseChainString } from '../src/chain/parse-chain-string.js';

describe('parseChainString — adversarial inputs', () => {
  it('returns an empty chain for empty / whitespace input', () => {
    expect(parseChainString('')).toEqual([]);
    expect(parseChainString('   ')).toEqual([]);
  });

  it('emits steps with empty toolId for "||"-only input (caller rejects unknown IDs)', () => {
    const chain = parseChainString('|');
    expect(chain.every((s) => s.toolId === '')).toBe(true);
  });

  it('does NOT coerce string values into objects or arrays', () => {
    const chain = parseChainString('t[foo={"a":1},bar=[1,2,3]]');
    // The value-side parser splits on `,` so {"a":1} becomes two fragments;
    // the important property is that NO step.params field is an object/array.
    for (const step of chain) {
      for (const v of Object.values(step.params)) {
        expect(typeof v).not.toBe('object');
      }
    }
  });

  it('prototype keys do not pollute Object.prototype', () => {
    const before = ({} as Record<string, unknown>).polluted;
    parseChainString('t[__proto__=polluted]');
    parseChainString('t[constructor=polluted]');
    parseChainString('t[prototype=polluted]');
    const after = ({} as Record<string, unknown>).polluted;
    expect(after).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('handles unclosed brackets without throwing', () => {
    expect(() => parseChainString('a[b=1')).not.toThrow();
    expect(() => parseChainString('a[')).not.toThrow();
    expect(() => parseChainString('a]')).not.toThrow();
  });

  it('handles params with no value', () => {
    const chain = parseChainString('t[k=]');
    expect(chain[0]?.params.k).toBe('');
  });

  it('handles params with no key', () => {
    // "=v" has empty key; parseParams skips empty-key entries
    const chain = parseChainString('t[=v]');
    expect(Object.keys(chain[0]?.params ?? {})).toHaveLength(0);
  });

  it('coerces only to primitives — no function or symbol values', () => {
    const chain = parseChainString('t[a=true,b=false,c=42,d=hello,e=NaN]');
    const p = chain[0]?.params ?? {};
    expect(p.a).toBe(true);
    expect(p.b).toBe(false);
    expect(p.c).toBe(42);
    expect(p.d).toBe('hello');
    expect(p.e).toBe('NaN'); // NaN is not Number-coercible in our coerce()
    for (const v of Object.values(p)) {
      expect(typeof v).not.toBe('function');
      expect(typeof v).not.toBe('symbol');
    }
  });

  it('is bounded-time on long input (no ReDoS)', () => {
    // 10k pipe-delimited steps; should parse in <100ms on any modern runtime.
    const huge = Array(10_000).fill('t').join('|');
    const start = Date.now();
    const chain = parseChainString(huge);
    const elapsed = Date.now() - start;
    expect(chain).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(1000); // generous; real runtime is single-digit ms
  });

  it('does not evaluate JavaScript in values', () => {
    // No matter what shape the value has, it stays a string after coerce().
    const chain = parseChainString('t[k=(() => process.exit(1))()]');
    expect(typeof chain[0]?.params.k).toBe('string');
  });
});
