import { describe, expect, it } from 'vitest';
import {
  jsonPath,
  queryJsonPath,
  type JsonPathResult,
} from '../../../src/tools/json-path/index.js';
import type { ToolRunContext } from '../../../src/types.js';

describe('JSONPath independently found traversal regressions', () => {
  it('never selects an inherited object property', () => {
    expect(queryJsonPath({}, '$.constructor')).toEqual([]);
    expect(queryJsonPath({}, '$.toString')).toEqual([]);
    expect(queryJsonPath({}, '$.__proto__')).toEqual([]);
  });

  it('rejects recursive input deeper than 128 edges before traversal', () => {
    let value: unknown = 1;
    for (let depth = 0; depth < 129; depth++) value = { child: value };
    expect(() => queryJsonPath(value, '$..child')).toThrow(/depth.*128/i);
  });

  it('rejects excessive recursive intermediate work rather than returning an unbounded array', () => {
    const value = Array.from({ length: 10001 }, (_, index) => index);
    expect(() => queryJsonPath(value, '$..*')).toThrow(/intermediate.*10000/i);
  });
});

function context(signal = new AbortController().signal): ToolRunContext {
  return { signal, executionId: 'json-path-fixture', cache: new Map(), onProgress() {} };
}
async function run(
  value: unknown,
  expression = '$',
  limit = 0,
  ctx = context(),
): Promise<JsonPathResult> {
  const output = await jsonPath.run(
    [new File([JSON.stringify(value)], 'fixture.json', { type: 'application/json' })],
    { expression, limit },
    ctx,
  );
  if (!Array.isArray(output)) throw new Error('Expected JSONPath Blob array.');
  const blob = output[0]!;
  expect(blob.type).toBe('application/json');
  return JSON.parse(await blob.text()) as JsonPathResult;
}

describe('locked JSONPath grammar, order and canonical paths', () => {
  const value = { items: [{ id: 1 }, { id: 2 }], extra: { id: 3 } };
  it('selects own names, ordered array wildcards and negative integer indices', () => {
    expect(queryJsonPath(value, '$.items[*].id')).toEqual([
      { path: '$.items[0].id', value: 1 },
      { path: '$.items[1].id', value: 2 },
    ]);
    expect(queryJsonPath(value, '$.items[-1].id')).toEqual([{ path: '$.items[1].id', value: 2 }]);
    expect(queryJsonPath(value, '$.items[99].id')).toEqual([]);
    expect(queryJsonPath(value, '$..id')).toEqual([
      { path: '$.items[0].id', value: 1 },
      { path: '$.items[1].id', value: 2 },
      { path: '$.extra.id', value: 3 },
    ]);
    expect(queryJsonPath([1], '$.length')).toEqual([]);
  });
  it('keeps recursive wildcard results in stable depth-first preorder', () => {
    const tree = { first: { x: 1 }, second: 2 };
    expect(queryJsonPath(tree, '$..*')).toEqual([
      { path: '$.first', value: { x: 1 } },
      { path: '$.first.x', value: 1 },
      { path: '$.second', value: 2 },
    ]);
    expect(queryJsonPath(tree, '$.*')).toEqual([
      { path: '$.first', value: { x: 1 } },
      { path: '$.second', value: 2 },
    ]);
  });
  it('decodes double JSON escapes and the two allowed single-quote escapes', () => {
    const property = 'a"]b';
    expect(queryJsonPath({ [property]: 3 }, '$[' + JSON.stringify(property) + ']')).toEqual([
      { path: '$[' + JSON.stringify(property) + ']', value: 3 },
    ]);
    expect(queryJsonPath({ "a'b\\c": 4 }, "$['a\\'b\\\\c']")).toEqual([
      { path: '$["a\'b\\\\c"]', value: 4 },
    ]);
    expect(queryJsonPath({ 'a.b': 5, nested: { 'a.b': 6 } }, '$..["a.b"]')).toEqual([
      { path: '$["a.b"]', value: 5 },
      { path: '$.nested["a.b"]', value: 6 },
    ]);
    expect(queryJsonPath({ '\n': 7 }, '$["\\n"]')).toEqual([{ path: '$["\\n"]', value: 7 }]);
  });
  it('renders unusual names unambiguously and allows actual own special-name data', () => {
    const tree: unknown = JSON.parse(
      '{"__proto__":7,"constructor":8,"toString":9,"0":10,"é":11,"":12,"a-b":13}',
    );
    expect(queryJsonPath(tree, '$["__proto__"]')).toEqual([{ path: '$.__proto__', value: 7 }]);
    expect(queryJsonPath(tree, '$["constructor"]')).toEqual([{ path: '$.constructor', value: 8 }]);
    expect(queryJsonPath(tree, '$["toString"]')).toEqual([{ path: '$.toString', value: 9 }]);
    expect(queryJsonPath(tree, '$["0"]')).toEqual([{ path: '$["0"]', value: 10 }]);
    expect(queryJsonPath(tree, '$["é"]')).toEqual([{ path: '$["é"]', value: 11 }]);
    expect(queryJsonPath(tree, '$[""]')).toEqual([{ path: '$[""]', value: 12 }]);
    expect(queryJsonPath(tree, '$.a-b')).toEqual([{ path: '$.a-b', value: 13 }]);
  });
  it.each([
    '',
    'items',
    '.items',
    '$.',
    '$..',
    '$....id',
    '$.1',
    '$.missing[?(@.x)]',
    '$.missing[0:2]',
    '$.missing[0,1]',
    '$.missing[(@.x)]',
    '$.missing[]',
    '$.missing[0]junk',
    '$..[0]',
    '$..[*]',
    '$["bad\\q"]',
    "$['bad\\n']",
    '$["missing"] trailing',
    '$[9007199254740992]',
    '$["unfinished]',
    '$.missing.*.',
  ])('rejects the whole unsupported query even after an empty selector: %s', (expr) => {
    expect(() => queryJsonPath({}, expr)).toThrow();
  });
  it('returns root scalars and applies only validated integer limits', () => {
    expect(queryJsonPath(null, '$')).toEqual([{ path: '$', value: null }]);
    expect(queryJsonPath(4, ' $ ')).toEqual([{ path: '$', value: 4 }]);
    expect(queryJsonPath(value, '$..id', 1)).toEqual([{ path: '$.items[0].id', value: 1 }]);
    for (const limit of [-1, 0.5, 10001, Infinity, NaN, '1', null, true])
      expect(() => queryJsonPath(value, '$', limit as number)).toThrow(/integer/i);
    expect(() => queryJsonPath(value, '$' + ' '.repeat(4096))).toThrow(/4096/i);
    expect(() => queryJsonPath(value, 1 as unknown as string)).toThrow(/string/i);
  });
});

describe('iterative JSON input and traversal bounds', () => {
  it('permits depth128 and exactly100000 primitive/tree nodes', () => {
    let value: unknown = 1;
    for (let depth = 0; depth < 128; depth++) value = { child: value };
    expect(queryJsonPath(value, '$')[0]!.value).toBe(value);
    const array = Array.from({ length: 99999 }, () => 1);
    expect(queryJsonPath(array, '$')[0]!.value).toBe(array);
    expect(() => queryJsonPath([...array, 1], '$')).toThrow(/100000 nodes/);
  });
  it('rejects cycles, nonplain objects, nonfinite/non-JSON values and sparse arrays', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const [value, message] of [
      [cyclic, /cycle/],
      [new Date(), /plain/],
      [{ n: Infinity }, /finite/],
      [{ n: NaN }, /finite/],
      [{ x: undefined }, /JSON values/],
      [{ x: 1n }, /JSON values/],
      [{ x() {} }, /JSON values/],
      [new Array(1), /dense/],
    ] as const)
      expect(() => queryJsonPath(value, '$')).toThrow(message);
    const data = { id: 1 };
    expect(queryJsonPath({ a: data, b: data }, '$..id')).toEqual([
      { path: '$.a.id', value: 1 },
      { path: '$.b.id', value: 1 },
    ]);
  });
  it('rejects accessor, symbol and array-extra properties without invoking getters', () => {
    let called = 0;
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        called++;
        return 1;
      },
    });
    expect(() => queryJsonPath(accessor, '$.missing')).toThrow(/accessors/);
    expect(called).toBe(0);
    expect(() => queryJsonPath({ [Symbol('x')]: 1 }, '$')).toThrow(/symbol/);
    const array = Object.assign([1], { extra: 2 });
    expect(() => queryJsonPath(array, '$')).toThrow(/integer elements/);
  });
  it('rejects 10001 matches even when an output limit requests only one', () => {
    expect(
      queryJsonPath(
        Array.from({ length: 10000 }, (_, i) => i),
        '$[*]',
      ),
    ).toHaveLength(10000);
    expect(() =>
      queryJsonPath(
        Array.from({ length: 10001 }, (_, i) => i),
        '$[*]',
        1,
      ),
    ).toThrow(/intermediate.*10000/i);
  });
  it('bounds repeated recursive work even when the final selector has no matches', () => {
    let value: unknown = Array.from({ length: 10000 }, () => 0);
    for (let depth = 0; depth < 100; depth++) value = { a: value };
    expect(() => queryJsonPath(value, '$..a..missing')).toThrow(/1000000 visits/);
  }, 10000);
  it('bounds canonical path expansion rather than allocating all repeated long paths', () => {
    const key = 'x'.repeat(8192);
    expect(() => queryJsonPath({ [key]: Array.from({ length: 3000 }, () => 0) }, '$.*[*]')).toThrow(
      /canonical paths.*20 MiB/,
    );
  });
  it('checks the optional helper cancellation context before input inspection', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => queryJsonPath({}, '$', 0, context(controller.signal))).toThrow(/cancelled/);
  });
});

describe('JSONPath File runner contracts', () => {
  it('reports a counted total and truthful truncation without dropping the complete returned artifact', async () => {
    const result = await run({ items: [{ id: 1 }, { id: 2 }] }, '$.items[*].id', 1);
    expect(result).toEqual({
      expression: '$.items[*].id',
      matchCount: 1,
      totalMatchCount: 2,
      truncated: true,
      matches: [{ path: '$.items[0].id', value: 1 }],
    });
    expect(await run({ id: 1 }, '$..id')).toMatchObject({
      matchCount: 1,
      totalMatchCount: 1,
      truncated: false,
    });
    expect(await run({}, '$.missing', 1)).toMatchObject({
      matchCount: 0,
      totalMatchCount: 0,
      truncated: false,
      matches: [],
    });
    expect((await run({ value: 'é\u{1f600}\n"\\' })).matches[0]!.value).toEqual({
      value: 'é\u{1f600}\n"\\',
    });
  });
  it('enforces exactly one File, declared/advisory MIME, strict parameters and fatal UTF8', async () => {
    const ctx = context();
    const file = new File(['{}'], 'fixture.json');
    await expect(jsonPath.run([], { expression: '$' }, ctx)).rejects.toThrow(/exactly one/);
    await expect(jsonPath.run([file, file], { expression: '$' }, ctx)).rejects.toThrow(
      /exactly one/,
    );
    await expect(
      jsonPath.run(
        [new File(['{}'], 'fixture.png', { type: 'image/png' })],
        { expression: '$' },
        ctx,
      ),
    ).rejects.toThrow(/plain-text/);
    await expect(
      jsonPath.run(
        [new File([Uint8Array.of(255)], 'fixture.json', { type: 'application/json' })],
        { expression: '$' },
        ctx,
      ),
    ).rejects.toThrow(/UTF-8 JSON/);
    await expect(
      jsonPath.run([new File(['{broken'], 'fixture.json')], { expression: '$' }, ctx),
    ).rejects.toThrow(/UTF-8 JSON/);
    await expect(
      jsonPath.run([new File(['1e400'], 'fixture.json')], { expression: '$' }, ctx),
    ).rejects.toThrow(/finite/);
    await expect(
      jsonPath.run([file], { expression: '$', unknown: 1 } as never, ctx),
    ).rejects.toThrow(/Unknown/);
    await expect(
      jsonPath.run([file], { expression: '$', limit: '1' } as never, ctx),
    ).rejects.toThrow(/integer/);
    await expect(jsonPath.run([file], { expression: null } as never, ctx)).rejects.toThrow(
      /string/,
    );
    const output = await jsonPath.run([file], {}, ctx);
    if (!Array.isArray(output)) throw new Error('Expected JSONPath Blob array.');
    expect(output[0]!.type).toBe('application/json');
  });
  it('rejects oversized declared bytes before reading and accessor params before invoking them', async () => {
    let reads = 0;
    class OversizedFile extends File {
      override get size() {
        return 100 * 1024 * 1024 + 1;
      }
      override arrayBuffer() {
        reads++;
        return Promise.resolve(new ArrayBuffer(0));
      }
    }
    await expect(
      jsonPath.run([new OversizedFile([], 'fixture.json')], { expression: '$' }, context()),
    ).rejects.toThrow(/100 MiB/);
    expect(reads).toBe(0);
    let called = 0;
    const params = Object.defineProperty({}, 'expression', {
      enumerable: true,
      get() {
        called++;
        return '$';
      },
    });
    await expect(
      jsonPath.run([new File(['{}'], 'fixture.json')], params, context()),
    ).rejects.toThrow(/accessor/);
    expect(called).toBe(0);
  });
  it('rejects cancellation before and after asynchronous file reads without emitting done', async () => {
    const controller = new AbortController();
    let reads = 0;
    class AbortFile extends File {
      override async arrayBuffer() {
        reads++;
        controller.abort();
        return await super.arrayBuffer();
      }
    }
    const stages: string[] = [];
    const ctx = {
      ...context(controller.signal),
      onProgress(progress: { stage: string }) {
        stages.push(progress.stage);
      },
    };
    await expect(
      jsonPath.run([new AbortFile(['{}'], 'fixture.json')], { expression: '$' }, ctx),
    ).rejects.toThrow(/cancelled/);
    expect(reads).toBe(1);
    expect(stages).not.toContain('done');
    await expect(
      jsonPath.run([new AbortFile(['{}'], 'fixture.json')], { expression: '$' }, ctx),
    ).rejects.toThrow(/cancelled/);
    expect(reads).toBe(1);
  });
  it('preflights amplified recursive output bytes before building an oversized JSON artifact', async () => {
    let value: unknown = 'x'.repeat(1024 * 1024);
    for (let depth = 0; depth < 24; depth++) value = { a: value };
    const stages: string[] = [];
    await expect(
      run(value, '$..*', 0, {
        ...context(),
        onProgress(progress) {
          stages.push(progress.stage);
        },
      }),
    ).rejects.toThrow(/20 MiB/);
    expect(stages).not.toContain('done');
  }, 10000);
});
