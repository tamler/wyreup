import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '../../src/types.js';
import {
  createUtility,
  UtilityInputError,
  type UtilityDefinition,
  type UtilityResult,
} from '../../src/utilities/common.js';

function context(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

function definition(overrides: Partial<UtilityDefinition> = {}): UtilityDefinition {
  return {
    id: 'test-calculator',
    name: 'Test calculator',
    description: 'Bounded test arithmetic.',
    category: 'finance',
    keywords: ['test'],
    defaults: { amount: 10, enabled: false },
    paramSchema: {
      amount: { type: 'number', min: 0, max: 100 },
      enabled: { type: 'boolean' },
    },
    calculate: (params) => ({
      amount: params['amount'] as number,
      enabled: params['enabled'] as boolean,
    }),
    ...overrides,
  };
}

async function result(def: UtilityDefinition, params: Record<string, unknown> = {}) {
  const output = await createUtility(def).run([], params, context());
  const blob = Array.isArray(output) ? output[0]! : output;
  expect(blob.type).toBe('application/json');
  return JSON.parse(await blob.text()) as Record<string, unknown>;
}

describe('calculator validation boundary', () => {
  it('keeps the returned JSON artifact within the validated byte budget', async () => {
    const items = Array.from({ length: 12000 }, () => 'x'.repeat(80));
    const output = await createUtility(definition({ calculate: () => ({ items }) })).run([], {}, context());
    const blob = Array.isArray(output) ? output[0]! : output;
    expect(blob.size).toBeLessThanOrEqual(1048576);
    expect(JSON.parse(await blob.text())).toEqual({ items });
  });

  it('declares real zero-file metadata and preserves missing, zero and false', async () => {
    const tool = createUtility(definition());
    expect(tool.slug).toBe(tool.id);
    expect(tool.input).toEqual({ accept: [], min: 0, max: 0 });
    expect(tool.batchable).toBe(false);
    expect(await result(definition())).toEqual({ amount: 10, enabled: false });
    expect(await result(definition(), { amount: 0, enabled: false })).toEqual({
      amount: 0,
      enabled: false,
    });
    await expect(tool.run([new File(['x'], 'x.txt')], {}, context())).rejects.toMatchObject({
      field: '$inputs',
      code: 'schema',
    });
  });

  it.each([null, '', '12', true, NaN, Infinity, -1, 101])(
    'rejects an invalid numeric value %s',
    async (amount) => {
      await expect(result(definition(), { amount })).rejects.toBeInstanceOf(UtilityInputError);
    },
  );

  it('rejects unknown keys and non-record input without executing accessors', async () => {
    await expect(result(definition(), { extra: 1 })).rejects.toMatchObject({ code: 'unknown' });
    const read = vi.fn(() => 10);
    const input = Object.defineProperty({}, 'amount', { enumerable: true, get: read });
    await expect(result(definition(), input)).rejects.toMatchObject({ code: 'prototype' });
    expect(read).not.toHaveBeenCalled();
    await expect(
      result(definition(), [] as unknown as Record<string, unknown>),
    ).rejects.toMatchObject({ code: 'type' });
  });

  it('required nulls block active fields while inactive fields are omitted', async () => {
    const def = definition({
      defaults: { mode: 'simple', rate: null },
      paramSchema: {
        mode: {
          type: 'enum',
          options: [
            { value: 'simple', label: 'Simple' },
            { value: 'fee', label: 'Fee' },
          ],
        },
        rate: { type: 'number', min: 0, max: 100, showWhen: { field: 'mode', equals: 'fee' } },
      },
      calculate: (params) => ({
        mode: params['mode'] as string,
        hasRate: Object.hasOwn(params, 'rate'),
      }),
    });
    expect(await result(def)).toEqual({ mode: 'simple', hasRate: false });
    await expect(result(def, { mode: 'fee' })).rejects.toMatchObject({
      field: 'rate',
      code: 'required',
    });
    expect(await result(def, { mode: 'fee', rate: 0 })).toEqual({ mode: 'fee', hasRate: true });
  });

  it('keeps numeric and textual enum values distinct and checks dependent choices', async () => {
    const def = definition({
      defaults: { parent: 'a', choice: 1 },
      paramSchema: {
        parent: {
          type: 'enum',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
        choice: {
          type: 'enum',
          options: [{ value: 1, label: 'One' }],
          optionsFrom: { field: 'parent', map: { b: [{ value: '1', label: 'Text one' }] } },
        },
      },
      calculate: (p) => ({ choice: p['choice'] as string | number }),
    });
    expect(await result(def)).toEqual({ choice: 1 });
    await expect(result(def, { choice: '1' })).rejects.toMatchObject({ code: 'enum' });
    expect(await result(def, { parent: 'b', choice: '1' })).toEqual({ choice: '1' });
  });

  it('rejects unknown and cyclic schema dependencies at construction', () => {
    expect(() =>
      createUtility(
        definition({
          paramSchema: {
            amount: { type: 'number', showWhen: { field: 'missing', equals: true } },
            enabled: { type: 'boolean' },
          },
        }),
      ),
    ).toThrow(UtilityInputError);
    expect(() =>
      createUtility(
        definition({
          paramSchema: {
            amount: { type: 'number', showWhen: { field: 'enabled', equals: true } },
            enabled: { type: 'boolean', showWhen: { field: 'amount', equals: 10 } },
          },
        }),
      ),
    ).toThrow(UtilityInputError);
    expect(() =>
      createUtility(definition({ paramSchema: { amount: { type: 'number' } } })),
    ).toThrow(UtilityInputError);
  });

  it('defines integer steps and rejects malformed steps', async () => {
    const stepped = definition({
      defaults: { n: 2 },
      paramSchema: { n: { type: 'number', min: 0, max: 10, step: 2 } },
      calculate: (p) => ({ n: p['n'] as number }),
    });
    expect(await result(stepped, { n: 4 })).toEqual({ n: 4 });
    await expect(result(stepped, { n: 3 })).rejects.toMatchObject({ code: 'integer' });
    await expect(result(stepped, { n: 1.5 })).rejects.toMatchObject({ code: 'integer' });
    expect(() =>
      createUtility({ ...stepped, paramSchema: { n: { type: 'number', step: 0 } } }),
    ).toThrow(UtilityInputError);
    expect(
      await result({ ...stepped, paramSchema: { n: { type: 'number', step: 0.1 } } }, { n: 1.25 }),
    ).toEqual({ n: 1.25 });
  });

  it('deep-copies nested defaults and serializes hostile values literally', async () => {
    const rows = [{ note: '<img onerror=alert(1)> & </script>', amount: 1 }];
    const def = definition({
      defaults: { rows },
      paramSchema: { rows: { type: 'json' } },
      calculate: (p) => {
        const copied = p['rows'] as Array<{ note: string; amount: number }>;
        copied[0]!.amount = 42;
        return { rows: copied };
      },
    });
    const actual = await result(def);
    expect(actual['rows']).toEqual([{ note: rows[0]!.note, amount: 42 }]);
    expect(rows[0]!.amount).toBe(1);
  });

  it('accepts dense JSON and null-prototype records; rejects cycles, depth and budgets', async () => {
    const def = definition({
      defaults: { data: {} },
      paramSchema: { data: { type: 'json' } },
      calculate: (p) => ({ data: p['data'] as UtilityResult }),
    });
    expect(
      await result(def, { data: Object.assign(Object.create(null), { zero: 0, empty: null }) }),
    ).toEqual({ data: { zero: 0, empty: null } });
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    await expect(result(def, { data: cycle })).rejects.toMatchObject({ code: 'cycle' });
    let deep: unknown = 0;
    for (let i = 0; i < 22; i++) deep = { child: deep };
    await expect(result(def, { data: deep })).rejects.toMatchObject({ code: 'depth' });
    await expect(
      result(def, { data: Array.from({ length: 20001 }, () => 0) }),
    ).rejects.toMatchObject({ code: 'budget' });
    await expect(result(def, { data: 'x'.repeat(1048577) })).rejects.toMatchObject({
      code: 'budget',
    });
  });

  it.each([
    [
      'custom',
      () => {
        const data = [1];
        Object.setPrototypeOf(data, {});
        return data;
      },
    ],
    [
      'null',
      () => {
        const data = [1];
        Object.setPrototypeOf(data, null);
        return data;
      },
    ],
    [
      'subclass',
      () => {
        class CustomArray extends Array<number> {}
        const data = new CustomArray();
        data.push(1);
        return data;
      },
    ],
  ] as const)('rejects nonstandard array prototypes: %s', async (_label, array) => {
    const def = definition({
      defaults: { data: [] },
      paramSchema: { data: { type: 'json' } },
      calculate: () => ({ data: array() }),
    });
    await expect(result(def)).rejects.toBeInstanceOf(UtilityInputError);
    await expect(result(def)).rejects.toMatchObject({ code: 'prototype', field: '$result.data' });
    await expect(
      result({ ...def, calculate: () => ({ ok: true }) }, { data: array() }),
    ).rejects.toBeInstanceOf(UtilityInputError);
    await expect(
      result({ ...def, calculate: () => ({ ok: true }) }, { data: array() }),
    ).rejects.toMatchObject({ code: 'prototype', field: '$.data' });
    expect(
      await result({ ...def, calculate: (p) => ({ data: p['data'] as number[] }) }, { data: [1] }),
    ).toEqual({ data: [1] });
  });

  it.each([
    [undefined, 'type'],
    [1n, 'type'],
    [Symbol('x'), 'type'],
    [() => 1, 'type'],
    [new Date(), 'prototype'],
    [new Map(), 'prototype'],
    [new Set(), 'prototype'],
    [Object.assign(Array<unknown>(2), { 1: 1 }), 'prototype'],
    [Infinity, 'bounds'],
  ])('rejects non-JSON input and output with closed error code', async (value, code) => {
    const def = definition({
      defaults: { data: {} },
      paramSchema: { data: { type: 'json' } },
      calculate: () => ({ data: value }) as unknown as UtilityResult,
    });
    const field: unknown = expect.stringContaining('$result');
    await expect(result(def)).rejects.toMatchObject({ code, field });
    await expect(
      result({ ...def, calculate: () => ({ ok: true }) }, { data: value }),
    ).rejects.toMatchObject({ code });
  });

  it.each([null, 1, 'text', [1, 2]])('requires an object result root', async (value) => {
    await expect(
      result(definition({ calculate: () => value as unknown as UtilityResult })),
    ).rejects.toMatchObject({ field: '$result', code: 'type' });
  });

  it('aborts immediately even if calculation never settles', async () => {
    const controller = new AbortController();
    const tool = createUtility(definition({ calculate: () => new Promise(() => {}) }));
    const run = tool.run([], {}, { ...context(), signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toMatchObject({ field: '$run', code: 'abort' });
  });

  it('preserves genuine calculation errors and rejects already aborted runs', async () => {
    const error = new Error('specific arithmetic error');
    await expect(
      result(
        definition({
          calculate: () => {
            throw error;
          },
        }),
      ),
    ).rejects.toBe(error);
    const controller = new AbortController();
    controller.abort();
    await expect(
      createUtility(definition()).run([], {}, { ...context(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'abort' });
  });
});
