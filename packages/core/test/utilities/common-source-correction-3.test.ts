import { describe, expect, it } from 'vitest';
import {
  createUtility,
  UtilityInputError,
  type JsonValue,
  type UtilityDefinition,
  type UtilityResult,
} from '../../src/utilities/common.js';
import type { ToolRunContext } from '../../src/types.js';

function context(controller = new AbortController()): ToolRunContext {
  return {
    signal: controller.signal,
    cache: new Map(),
    executionId: 'foundation-source-correction-3',
    onProgress: () => {},
  };
}

function calculator(calculate: UtilityDefinition['calculate']) {
  return createUtility({
    id: 'root-result-regression',
    name: 'Root result regression',
    description: 'Test the real factory result validation boundary.',
    category: 'inspect',
    keywords: ['test'],
    defaults: {},
    paramSchema: {},
    calculate,
  });
}

async function output(calculate: UtilityDefinition['calculate']): Promise<unknown> {
  const result = await calculator(calculate).run([], {}, context());
  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob) throw new Error('Missing complete JSON artifact.');
  return JSON.parse(await blob.text()) as unknown;
}

async function refusal(calculate: UtilityDefinition['calculate'], code: 'prototype' | 'type') {
  let error: unknown;
  let result: unknown;
  try {
    result = await calculator(calculate).run([], {}, context());
  } catch (cause) {
    error = cause;
  }
  expect.soft(result).toBeUndefined();
  expect.soft(error).toBeInstanceOf(UtilityInputError);
  expect.soft(error).toMatchObject({ field: '$result.then', code });
}

describe('foundation correction 3 — validate a synchronous root before thenable assimilation', () => {
  it('rejects a root then accessor without reading it or calling its returned function', async () => {
    let reads = 0;
    let calls = 0;
    const data: UtilityResult = {};
    Object.defineProperty(data, 'then', {
      enumerable: true,
      get() {
        reads++;
        return (resolve: (value: UtilityResult) => void) => {
          calls++;
          resolve({ substituted: true });
        };
      },
    });
    await refusal(() => data, 'prototype');
    expect.soft(reads).toBe(0);
    expect(calls).toBe(0);
  });

  it('rejects a root then callable without invoking or replacing the result', async () => {
    let calls = 0;
    const data: UtilityResult = {};
    Object.defineProperty(data, 'then', {
      enumerable: true,
      value: (resolve: (value: UtilityResult) => void) => {
        calls++;
        resolve({ substituted: true });
      },
    });
    await refusal(() => data, 'type');
    expect(calls).toBe(0);
  });

  it('still rejects another non-JSON callable without executing it', async () => {
    let calls = 0;
    const data: UtilityResult = {};
    Object.defineProperty(data, 'execute', {
      enumerable: true,
      value: () => {
        calls++;
      },
    });
    await expect(output(() => data)).rejects.toMatchObject({
      field: '$result.execute',
      code: 'type',
    });
    expect(calls).toBe(0);
  });

  it.each([
    ['null', null],
    ['boolean', false],
    ['number', 0],
    ['string', 'literal then data'],
    ['array', ['literal']],
    ['object', { nested: 'literal' }],
  ] satisfies Array<[string, JsonValue]>)(
    'preserves ordinary JSON then data: %s',
    async (_label, then) => {
      expect(await output(() => ({ then }))).toEqual({ then });
    },
  );

  it('preserves a null-prototype JSON root with then data', async () => {
    const data = Object.create(null) as UtilityResult;
    data['then'] = 'literal';
    data['ok'] = true;
    expect(await output(() => data)).toEqual({ then: 'literal', ok: true });
  });
});

describe('foundation correction 3 — genuine native Promise contracts', () => {
  it('validates an already-fulfilled record before a subsequently added then getter can run', async () => {
    const data: UtilityResult = { ok: true };
    const promised = Promise.resolve(data);
    let reads = 0;
    let calls = 0;
    Object.defineProperty(data, 'then', {
      enumerable: true,
      get() {
        reads++;
        return (resolve: (value: UtilityResult) => void) => {
          calls++;
          resolve({ substituted: true });
        };
      },
    });
    await refusal(() => promised, 'prototype');
    expect.soft(reads).toBe(0);
    expect(calls).toBe(0);
  });

  it('rejects a Promise subclass without invoking its species hook', async () => {
    let speciesReads = 0;
    class CustomPromise extends Promise<UtilityResult> {
      static override get [Symbol.species]() {
        speciesReads++;
        return Promise;
      }
    }
    const promised = new CustomPromise((resolve) => resolve({ ok: true }));
    let error: unknown;
    try {
      await output(() => promised);
    } catch (cause) {
      error = cause;
    }
    expect.soft(error).toMatchObject({ field: '$result', code: 'prototype' });
    expect(speciesReads).toBe(0);
  });

  it('rejects an own Promise then getter without reading it', async () => {
    const promised = Promise.resolve({ ok: true });
    let reads = 0;
    void Object.defineProperty(promised, 'then', {
      get() {
        reads++;
        return Promise.prototype.then.bind(promised);
      },
    });
    await refusal(() => promised, 'prototype');
    expect(reads).toBe(0);
  });

  it('rejects an own Promise then callable without calling it', async () => {
    const promised = Promise.resolve({ ok: true });
    let calls = 0;
    void Object.defineProperty(promised, 'then', {
      value: (resolve: (value: UtilityResult) => void) => {
        calls++;
        resolve({ substituted: true });
      },
    });
    await refusal(() => promised, 'prototype');
    expect(calls).toBe(0);
  });

  it('rejects an own Promise constructor getter without reading it', async () => {
    const promised = Promise.resolve({ ok: true });
    let reads = 0;
    void Object.defineProperty(promised, 'constructor', {
      get() {
        reads++;
        return Promise;
      },
    });
    let error: unknown;
    try {
      await output(() => promised);
    } catch (cause) {
      error = cause;
    }
    expect.soft(error).toMatchObject({ field: '$result.constructor', code: 'prototype' });
    expect(reads).toBe(0);
  });

  it('rejects a fake Promise prototype through the intrinsic brand check without executing hooks', async () => {
    const fake = Object.create(Promise.prototype) as Promise<UtilityResult>;
    await expect(output(() => fake)).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a synchronously aborted calculation without leaving an unhandled rejection', async () => {
    const controller = new AbortController();
    const unhandled: unknown[] = [];
    const observe = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', observe);
    try {
      const running = calculator(() => {
        controller.abort();
        return { ok: true };
      }).run([], {}, context(controller));
      await expect(running).rejects.toMatchObject({ field: '$run', code: 'abort' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', observe);
    }
  });

  it('keeps both a returned native Promise and an async calculation', async () => {
    expect(await output(() => Promise.resolve({ ok: true, then: 'data' }))).toEqual({
      ok: true,
      then: 'data',
    });
    expect(
      await output(async () => {
        await Promise.resolve();
        return { ok: true };
      }),
    ).toEqual({ ok: true });
  });

  it('aborts a genuinely started never-settling Promise', async () => {
    let reportStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const controller = new AbortController();
    let calls = 0;
    const tool = calculator(() => {
      calls++;
      reportStarted?.();
      return new Promise<UtilityResult>(() => {});
    });
    const running = tool.run([], {}, context(controller));
    await started;
    controller.abort();
    await expect(running).rejects.toMatchObject({ field: '$run', code: 'abort' });
    expect(calls).toBe(1);
  });
});
