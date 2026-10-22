import { describe, expect, it } from 'vitest';
import { numberBaseConverter } from '../src/tools/number-base-converter/index.js';
import { base64 } from '../src/tools/base64/index.js';
import { hash } from '../src/tools/hash/index.js';
import { couldFlowTo } from '../src/registry.js';

describe('number-base curation for both actual output formats', () => {
  it('owns an explicit universally compatible suggestion array without changing its wildcard metadata', () => {
    expect(numberBaseConverter.output.mime).toBe('*/*');
    expect(numberBaseConverter.chainSuggestions).toEqual(['base64', 'hash']);
    for (const target of [base64, hash]) {
      expect(target.cost).toBe('free');
      expect(target.input.min).toBe(1);
      expect(couldFlowTo(numberBaseConverter.output.mime, target.input.accept)).toBe(true);
      expect(couldFlowTo('application/json', target.input.accept)).toBe(true);
      expect(couldFlowTo('text/plain', target.input.accept)).toBe(true);
    }
  });
});
