import { describe, expect, it, vi } from 'vitest';
import { countWordText } from '../../src/tools/word-counter/index.js';
import { formatJsonText } from '../../src/tools/json-formatter/index.js';
import { queryJsonPath } from '../../src/tools/json-path/index.js';

const outputLimit = 50 * 1024 * 1024;
const outerDepth = 127;
const boundaryValues = 50923;

// Original fixture arithmetic: 128 arrays, scalar indent 1024, one-byte zero tokens.
// Every extra value adds 1027 output bytes; fixed braces/indent/newlines add 130558.
function nestedZeros(first: string | number = 0, values = boundaryValues): string {
  const items: Array<string | number> = Array<number>(values).fill(0);
  items[0] = first;
  return '['.repeat(outerDepth) + JSON.stringify(items) + ']'.repeat(outerDepth);
}

describe('LIVE2 bounded sentence counting with exact legacy semantics', () => {
  it.each([
    ['', 0],
    [' ', 0],
    ['\n\n', 0],
    ['one', 0],
    ['one??', 1],
    ['??', 1],
    [' . ! ? ', 3],
    ['one. trailing', 1],
    ['one.\nnext!', 2],
    ['one。two。', 0],
    ['one...??!!two?', 2],
  ] as const)('preserves %j => %i sentences', (text, sentences) => {
    expect(countWordText(text).sentences).toBe(sentences);
  });

  it('counts actual 64 KiB punctuation-free text within the bounded native host probe', () => {
    const text = 'a'.repeat(64 * 1024);
    const begin = performance.now();
    const result = countWordText(text);
    const elapsed = performance.now() - begin;
    expect(result).toMatchObject({ sentences: 0, characters: 65536 });
    // This current-host regression is not a universal physical-device performance promise.
    expect(elapsed).toBeLessThan(1000);
  });

  it('still refuses pre-aborted counting', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => countWordText('one??', {}, 'text/plain', controller.signal)).toThrow(/cancel/);
  });
});

describe('LIVE2 exact standalone JSON formatted output byte ceiling', () => {
  it('accepts the exact 50 MiB UTF8 output boundary derived from original fixture arithmetic', () => {
    expect(1027 * boundaryValues + 130558 + 321).toBe(outputLimit);
    const output = formatJsonText(nestedZeros('x'.repeat(320)), { indent: 8 });
    expect(new TextEncoder().encode(output).byteLength).toBe(outputLimit);
  });

  it('refuses one UTF8 byte over the output ceiling before pretty stringify allocation', () => {
    const input = nestedZeros('x'.repeat(321));
    expect(new TextEncoder().encode(input).byteLength).toBeLessThan(101 * 1024);
    const stringify = vi.spyOn(JSON, 'stringify');
    let error: unknown;
    let prettyCalls = 0;
    try {
      try {
        formatJsonText(input, { indent: 8 });
      } catch (reason) {
        error = reason;
      }
      prettyCalls = stringify.mock.calls.filter((args) => args[2] === 8).length;
    } finally {
      stringify.mockRestore();
    }
    expect.soft(error).toMatchObject({ name: 'UtilityInputError', code: 'budget' });
    expect(prettyCalls).toBe(0);
  });

  it('counts multibyte string bytes rather than character count at the boundary', () => {
    // 161 UTF8 two-byte characters replace a one-byte zero with 324 serialized bytes: +323.
    const input = nestedZeros('é'.repeat(161));
    expect(1027 * boundaryValues + 130558 + 323).toBe(outputLimit + 2);
    expect(() => formatJsonText(input, { indent: 8 })).toThrow(/50 MiB|budget|output/);
  });

  it('validation-only still accepts a valid bounded tree whose unused pretty output would exceed the cap', () => {
    expect(formatJsonText(nestedZeros(0, 50924), { indent: 8, validationOnly: true })).toBe(
      '{"valid":true}',
    );
  });

  it('retains ordinary nested sorting, literal prototype keys and array order', () => {
    expect(
      formatJsonText('{"b":[2,1],"__proto__":{"z":1,"a":2},"a":0}', {
        indent: 0,
        sortKeys: true,
      }),
    ).toBe('{"__proto__":{"a":2,"z":1},"a":0,"b":[2,1]}');
    expect(Object.hasOwn(Object.prototype, 'z')).toBe(false);
  });

  it.each([0, 8])('preserves exact escaping, pairs and lone surrogates at indent %i', (indent) => {
    const input = String.raw`["\"\\\b\f\n\r\t\u0000é😀\ud800X\udc00"]`;
    const scalar = String.raw`"\"\\\b\f\n\r\t\u0000é😀\ud800X\udc00"`;
    const expected = indent === 0 ? `[${scalar}]` : `[\n        ${scalar}\n]`;
    const output = formatJsonText(input, { indent });
    expect(output).toBe(expected);
    // é costs two UTF8 bytes; the valid emoji pair costs four, while lone surrogates escape.
    expect(new TextEncoder().encode(output).byteLength).toBe(expected.length + 3);
  });

  it.each([
    ['[-0,1e3,1e-7,1e21]', '[0,1000,1e-7,1e+21]'],
    ['[{},[],null,true,false]', '[{},[],null,true,false]'],
  ])('preserves scalar and empty-container minification for %s', (input, expected) => {
    expect(formatJsonText(input, { indent: 0 })).toBe(expected);
  });

  it('adds no empty-container pretty whitespace and sorts nested keys at indent8', () => {
    expect(formatJsonText('{"z":[],"a":{}}', { indent: 8, sortKeys: true })).toBe(
      '{\n        "a": {},\n        "z": []\n}',
    );
  });

  it('preserves the existing 25 MiB minified string capability', () => {
    const input = '"' + 'x'.repeat(25 * 1024 * 1024) + '"';
    const output = formatJsonText(input, { indent: 0 });
    expect(output.length).toBe(25 * 1024 * 1024 + 2);
    expect(output === input).toBe(true);
  });
});

describe('LIVE2 cumulative JSONPath path work limit', () => {
  it('refuses bounded input whose empty-match recursive canonicalization exceeds 256 Mi weighted characters', () => {
    const key = 'x'.repeat(512 * 1024 - 1) + ' ';
    let tree: Record<string, unknown> = { [key]: 1 };
    for (let index = 0; index < 64; index++) tree = { child: tree };
    expect(65 * 8 * key.length).toBe(272629760);
    expect(65 * 8 * key.length).toBeGreaterThan(256 * 1024 * 1024);
    expect(() => queryJsonPath(tree, '$..*..missing')).toThrow(/work|budget/);
  });

  it('retains a realistic 99999-node tree and a single recursive id match', () => {
    const items = Array.from({ length: 24999 }, (_, index) => ({
      position: index,
      payload: { active: true },
    }));
    const input = { items, id: 7 };
    expect(1 + 1 + items.length * 4 + 1).toBe(99999);
    expect(queryJsonPath(input, '$..id')).toEqual([{ path: '$.id', value: 7 }]);
  });

  it('retains ordinary recursive order, quoted canonical paths and nonmatching results', () => {
    const input = { items: [{ 'odd key': 1 }, { 'odd key': 2 }] };
    expect(queryJsonPath(input, '$..["odd key"]')).toEqual([
      { path: '$.items[0]["odd key"]', value: 1 },
      { path: '$.items[1]["odd key"]', value: 2 },
    ]);
    expect(queryJsonPath(input, '$..*..missing')).toEqual([]);
  });

  it('retains pre-aborted query refusal', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => queryJsonPath({ item: 1 }, '$..*', 0, { signal: controller.signal })).toThrow(
      /cancel/,
    );
  });
});
