import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '../src/types.js';
import type { UtilityParams, UtilityResult } from '../src/utilities/common.js';
import type * as FinanceEngine from '../src/utilities/finance-calculations.js';

type Engine = typeof FinanceEngine;
const financeIds = [
  'tip-calculator', 'discount-calculator', 'sales-tax-calculator', 'loan-calculator',
  'mortgage-calculator', 'paypal-fee-calculator', 'stripe-fee-calculator', 'square-fee-calculator',
  'amazon-fba-profit-calculator', 'etsy-fee-profit-calculator', 'ebay-fee-profit-calculator',
  'fuel-trip-cost-calculator', 'airbnb-host-payout-calculator', 'shopify-profit-margin-calculator',
  'ev-charging-cost-calculator', 'youtube-rpm-calculator', 'patreon-earnings-calculator',
  'fiverr-fee-calculator', 'upwork-fee-calculator', 'kdp-royalty-calculator',
  'tiktok-shop-fee-calculator', 'poshmark-fee-calculator', 'depop-fee-calculator',
  'mercari-profit-calculator', 'stockx-seller-fee-calculator',
  'shopify-break-even-roas-calculator', 'twitch-subscription-revenue-calculator',
  'twitch-bits-to-usd-converter', 'gumroad-fee-calculator', 'kickstarter-fee-calculator',
  'printify-profit-calculator', 'redbubble-profit-calculator', 'teespring-profit-calculator',
  'amazon-handmade-fee-calculator', 'grailed-fee-calculator', 'reverb-fee-calculator',
  'discogs-fee-calculator', 'whatnot-seller-fee-calculator', 'ko-fi-fee-calculator',
  'fourthwall-profit-calculator', 'recipe-cost-calculator',
];

// Frozen before implementation: UNIT field wiring, not a monetary result oracle.
const sentinelResult: UtilityResult = {
  unitSentinel: 'controlled-finance-result',
  orderedValues: ['alpha', 'beta'],
  limitations: ['Controlled UNIT limitation.'],
};
const sentinelExpected = {
  unitSentinel: 'controlled-finance-result',
  orderedValues: ['alpha', 'beta'],
  limitations: [
    'Controlled UNIT limitation.',
    'Single currency; no exchange-rate, jurisdictional tax, account data or refund lookup.',
  ],
  currency: 'USD',
  currencyDecimals: 2,
  inputs: {
    currency: 'USD', currencyDecimals: 2, bill: 100, tipPercent: 20,
    people: 1, billIncludesTax: true, taxAmount: 0,
  },
  sources: [],
  assumptions: {
    ratesSource: 'user-supplied',
    exampleCurrency: 'USD is an editable example, not a locale or provider inference.',
    rounding: 'Half away from zero to declared minor units; estimate, not provider settlement.',
    ratios: 'Margin is profit/revenue and ROI is profit/seller cost, expressed as ratios.',
  },
};

function context(signal = new AbortController().signal, onProgress: ToolRunContext['onProgress'] = () => {}): ToolRunContext {
  return { signal, onProgress, cache: new Map(), executionId: 'finance-lazy-import-unit' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

function outputBlobs(value: Blob | Blob[]): Blob[] {
  const outputs = Array.isArray(value) ? value : [value];
  for (const output of outputs) expect(output).toBeInstanceOf(Blob);
  return outputs;
}

function expectAbort(outcome: Awaited<ReturnType<typeof observe>>) {
  expect(outcome.status).toBe('rejected');
  if (outcome.status !== 'rejected') throw new Error('Expected original finance abort refusal.');
  expect(outcome.reason).toBeInstanceOf(Error);
  expect(outcome.reason).toMatchObject({
    name: 'UtilityInputError', field: '$run', code: 'abort', message: '$run: Calculation cancelled.',
  });
}

describe('finance private engine acquisition — controlled UNIT witnesses', () => {
  const releases: Array<() => void> = [];
  const drains: Array<Promise<unknown>> = [];

  afterEach(async () => {
    try {
      for (const release of releases.splice(0)) release();
      await Promise.all(drains.splice(0));
    } finally {
      vi.doUnmock('../src/utilities/finance-calculations.js');
      vi.resetModules();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('keeps all41 public metadata, registered membership and fresh synchronous citations before engine entry', async () => {
    vi.resetModules();
    let entries = 0;
    const calculateFinance = vi.fn((_id: string, _p: UtilityParams, _ctx: ToolRunContext) => structuredClone(sentinelResult));
    vi.doMock('../src/utilities/finance-calculations.js', () => { entries++; return { calculateFinance }; });
    const source = await import('../src/index.js');
    const registry = source.createDefaultRegistry();
    expect(source.financeTools.map((tool) => tool.id)).toEqual(financeIds);
    for (const tool of source.financeTools) {
      const registered = registry.toolsById.get(tool.id);
      expect(registered).toBeDefined();
      if (!registered) throw new Error('Public registered finance tool is absent.');
      for (const key of Object.keys(tool))
        if (key !== 'run') expect(Reflect.get(registered, key)).toEqual(Reflect.get(tool, key));
      expect(typeof registered.run).toBe('function');
      expect(tool.category).toBe('finance');
      expect(tool.input).toEqual({ accept: [], min: 0, max: 0 });
      expect(tool.output).toEqual({ mime: 'application/json', multiple: false });
      const first = source.financeSourcesForTool(tool.id), second = source.financeSourcesForTool(tool.id);
      expect(Array.isArray(first)).toBe(true);
      expect(Array.isArray(second)).toBe(true);
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      first.forEach((row, i) => { expect(row).not.toBe(second[i]); });
    }
    const firstUnknown = source.financeSourcesForTool('unknown-finance-compatibility-id');
    const secondUnknown = source.financeSourcesForTool('unknown-finance-compatibility-id');
    expect(firstUnknown).toEqual([]);
    expect(secondUnknown).toEqual([]);
    expect(firstUnknown).not.toBe(secondUnknown);
    expect(entries).toBe(0);
    expect(calculateFinance).not.toHaveBeenCalled();
  });

  it('preserves original wrapper enrichment, exact frozen field order, MIME and progress', async () => {
    vi.resetModules();
    const calculateFinance = vi.fn((_id: string, _p: UtilityParams, _ctx: ToolRunContext) => structuredClone(sentinelResult));
    vi.doMock('../src/utilities/finance-calculations.js', () => ({ calculateFinance }));
    const source = await import('../src/index.js');
    const tool = source.createDefaultRegistry().toolsById.get('tip-calculator');
    if (!tool) throw new Error('Registered tip calculator is absent.');
    const progress: unknown[] = [];
    const ctx = context(undefined, (event) => { progress.push(structuredClone(event)); });
    const outputs = outputBlobs(await tool.run([], { tipPercent: 20 }, ctx));
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.type).toBe('application/json');
    expect(await outputs[0]!.text()).toBe(JSON.stringify(sentinelExpected));
    expect(calculateFinance).toHaveBeenCalledExactlyOnceWith('tip-calculator', sentinelExpected.inputs, ctx);
    expect(progress).toEqual([{ stage: 'done', percent: 100 }]);
  });

  it('retains registered-file, schema, currency, currencyDecimals and pre-abort refusals before factory entry', async () => {
    vi.resetModules();
    let entries = 0;
    const calculateFinance = vi.fn((_id: string, _p: UtilityParams, _ctx: ToolRunContext) => structuredClone(sentinelResult));
    vi.doMock('../src/utilities/finance-calculations.js', () => { entries++; return { calculateFinance }; });
    const source = await import('../src/index.js');
    const tool = source.createDefaultRegistry().toolsById.get('tip-calculator');
    if (!tool) throw new Error('Registered tip calculator is absent.');
    const file = new File(['UNIT'], 'unit.txt', { type: 'text/plain' });
    await expect(tool.run([file], { tipPercent: 20 }, context())).rejects.toMatchObject({
      name: 'Error', message: 'Expected at most 0 files, but got 1.',
    });
    await expect(tool.run([], { tipPercent: '20' }, context())).rejects.toMatchObject({
      name: 'UtilityInputError', field: 'tipPercent', code: 'type', message: 'tipPercent: Expected a number.',
    });
    await expect(tool.run([], { tipPercent: 20, currency: 'usd' }, context())).rejects.toMatchObject({
      name: 'UtilityInputError', field: 'currency', code: 'bounds',
      message: 'currency: Enter one uppercase three-letter currency code.',
    });
    await expect(tool.run([], { tipPercent: 20, currencyDecimals: 4 }, context())).rejects.toMatchObject({
      name: 'UtilityInputError', field: 'currencyDecimals', code: 'bounds', message: 'currencyDecimals: Maximum is 3.',
    });
    const controller = new AbortController();
    controller.abort();
    expectAbort(await observe(tool.run([], { tipPercent: 20 }, context(controller.signal))));
    expect(entries).toBe(0);
    expect(calculateFinance).not.toHaveBeenCalled();
  });

  it.each(['fulfill', 'reject'] as const)('actual pending engine factory aborts before release and drains late %s', async (settlement) => {
    vi.resetModules();
    const entered = deferred<void>(), release = deferred<void>();
    releases.push(() => { release.resolve(); });
    let entries = 0;
    let loading: ReturnType<typeof observe<Engine>> | undefined;
    const calculateFinance = vi.fn((_id: string, _p: UtilityParams, _ctx: ToolRunContext) => structuredClone(sentinelResult));
    vi.doMock('../src/utilities/finance-calculations.js', () => {
      entries++;
      entered.resolve();
      const pending = (async (): Promise<Engine> => {
        await release.promise;
        if (settlement === 'reject') throw new Error('Owned finance engine late rejection.');
        return { calculateFinance };
      })();
      loading = observe(pending);
      drains.push(loading);
      return pending;
    });
    const source = await import('../src/index.js');
    const tool = source.createDefaultRegistry().toolsById.get('tip-calculator');
    if (!tool) throw new Error('Registered tip calculator is absent.');
    expect(entries).toBe(0);
    const controller = new AbortController(), progress: unknown[] = [];
    const blobs = vi.spyOn(globalThis, 'Blob');
    const running = observe(tool.run([], { tipPercent: 20 }, context(controller.signal,
      (event) => { progress.push(structuredClone(event)); })));
    drains.push(running);
    try {
      await entered.promise;
      expect(entries).toBe(1);
      if (!loading) throw new Error('Entered finance factory did not expose its owned Promise.');
      expect(calculateFinance).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
      controller.abort();
      expectAbort(await running);
      expect(progress).toEqual([]);
      expect(calculateFinance).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
      release.resolve();
      expect((await loading).status).toBe(settlement === 'fulfill' ? 'fulfilled' : 'rejected');
      expect(entries).toBe(1);
      expect(calculateFinance).not.toHaveBeenCalled();
      expect(progress).toEqual([]);
      expect(blobs).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await Promise.all(drains);
    }
  });

  it('awaits a controlled calculation Promise before the original enrichment/Blob boundary', async () => {
    vi.resetModules();
    const entered = deferred<void>(), result = deferred<UtilityResult>();
    releases.push(() => { result.resolve(structuredClone(sentinelResult)); });
    const calculated = observe(result.promise);
    drains.push(calculated);
    const calculateFinance = vi.fn((_id: string, _p: UtilityParams, _ctx: ToolRunContext) => {
      entered.resolve();
      return result.promise;
    });
    vi.doMock('../src/utilities/finance-calculations.js', () => ({ calculateFinance }));
    const source = await import('../src/index.js');
    const tool = source.createDefaultRegistry().toolsById.get('tip-calculator');
    if (!tool) throw new Error('Registered tip calculator is absent.');
    const progress: unknown[] = [];
    const NativeBlob = globalThis.Blob;
    let blobCount = 0;
    class ObservedBlob extends NativeBlob {
      constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) {
        super(parts, options);
        blobCount++;
      }
    }
    vi.stubGlobal('Blob', ObservedBlob);
    const running = observe(tool.run([], { tipPercent: 20 }, context(undefined,
      (event) => { progress.push(structuredClone(event)); })));
    drains.push(running);
    let settled = false;
    void running.then(() => { settled = true; });
    try {
      await entered.promise;
      expect(settled).toBe(false);
      expect(progress).toEqual([]);
      expect(blobCount).toBe(0);
      result.resolve(structuredClone(sentinelResult));
      const outcome = await running;
      expect(outcome.status).toBe('fulfilled');
      if (outcome.status !== 'fulfilled') throw outcome.reason;
      const outputs = outputBlobs(outcome.value);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.type).toBe('application/json');
      expect(await outputs[0]!.text()).toBe(JSON.stringify(sentinelExpected));
      expect(progress).toEqual([{ stage: 'done', percent: 100 }]);
      expect(blobCount).toBe(1);
    } finally {
      result.resolve(structuredClone(sentinelResult));
      await Promise.all(drains);
    }
  });

  it.each(['fulfill', 'reject'] as const)('retains cancellation while calculation is pending and drains late %s', async (settlement) => {
    vi.resetModules();
    const entered = deferred<void>(), result = deferred<UtilityResult>();
    releases.push(() => { result.resolve(structuredClone(sentinelResult)); });
    const calculated = observe(result.promise);
    drains.push(calculated);
    const calculateFinance = vi.fn((_id: string, _p: UtilityParams, _ctx: ToolRunContext) => {
      entered.resolve();
      return result.promise;
    });
    vi.doMock('../src/utilities/finance-calculations.js', () => ({ calculateFinance }));
    const source = await import('../src/index.js');
    const tool = source.createDefaultRegistry().toolsById.get('tip-calculator');
    if (!tool) throw new Error('Registered tip calculator is absent.');
    const controller = new AbortController(), progress: unknown[] = [];
    const blobs = vi.spyOn(globalThis, 'Blob');
    const running = observe(tool.run([], { tipPercent: 20 }, context(controller.signal,
      (event) => { progress.push(structuredClone(event)); })));
    drains.push(running);
    try {
      await entered.promise;
      controller.abort();
      expectAbort(await running);
      expect(progress).toEqual([]);
      expect(blobs).not.toHaveBeenCalled();
      if (settlement === 'fulfill') result.resolve(structuredClone(sentinelResult));
      else result.reject(new Error('Owned finance calculation late rejection.'));
      expect((await calculated).status).toBe(settlement === 'fulfill' ? 'fulfilled' : 'rejected');
      expect(progress).toEqual([]);
      expect(blobs).not.toHaveBeenCalled();
    } finally {
      result.resolve(structuredClone(sentinelResult));
      await Promise.all(drains);
    }
  });

  it('retains actual monetary minor-unit refusal after engine acquisition', async () => {
    vi.resetModules();
    let entries = 0;
    vi.doMock('../src/utilities/finance-calculations.js', async (importOriginal) => {
      entries++;
      return await importOriginal<Engine>();
    });
    const source = await import('../src/index.js');
    const tool = source.createDefaultRegistry().toolsById.get('tip-calculator');
    if (!tool) throw new Error('Registered tip calculator is absent.');
    expect(entries).toBe(0);
    await expect(tool.run([], { tipPercent: 20, bill: 1.001 }, context())).rejects.toMatchObject({
      name: 'UtilityInputError', field: 'bill', code: 'bounds',
      message: 'bill: Enter an amount representable in the declared currency minor units.',
    });
    expect(entries).toBe(1);
  });

  it('refuses unknown and inherited private calculation keys', async () => {
    vi.resetModules();
    const { calculateFinance } = await import('../src/utilities/finance-calculations.js');
    for (const id of ['unknown-finance-unit-key', 'toString', '__proto__'])
      expect(() => calculateFinance(id, {}, context())).toThrow('$tool: Unknown finance calculator.');
  });
});
