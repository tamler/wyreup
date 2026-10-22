import { afterEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { domainAgeChecker } from '../../src/utilities/domain-age.js';
import { domainStatusResult } from '../../src/lib/domain-registration.js';
import type { ToolRunContext } from '../../src/types.js';

const data = () =>
  domainStatusResult(
    'example.com',
    'unsupported-tld',
    Temporal.Instant.from('2026-10-11T00:00:00Z'),
  );
const response = () =>
  new Response(JSON.stringify(data()), { headers: { 'Content-Type': 'application/json' } });
const context = (signal = new AbortController().signal): ToolRunContext => ({
  signal,
  onProgress: vi.fn(),
  executionId: 'domain-deadline-fixture',
  cache: new Map(),
  proOrigin: 'http://127.0.0.1:1888',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function observe(ctx: ToolRunContext) {
  const state = { value: 'pending', error: '' };
  const operation = domainAgeChecker.run([], { domain: 'example.com' }, ctx).then(
    () => {
      state.value = 'fulfilled';
    },
    (error: unknown) => {
      state.value = 'rejected';
      state.error = error instanceof Error ? error.message : String(error);
    },
  );
  return { state, operation };
}
afterEach(() => {
  vi.doUnmock('../../src/lib/domain-registration.js');
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('domain client settlement independent of transport cancellation', () => {
  it('settles user abort against ignored fetch and removes the owned user listener', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const transport = deferred<Response>();
    const invoked = deferred<AbortSignal>();
    const fetcher = vi.fn((_url: unknown, options: RequestInit) => {
      if (!options.signal) throw new Error('Missing owned transport signal.');
      invoked.resolve(options.signal);
      return transport.promise;
    });
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const ctx = context(controller.signal);
    const late = response();
    const cancelLateBody = vi.spyOn(late.body!, 'cancel');
    const { state, operation } = observe(ctx);
    try {
      const signal = await invoked.promise;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(Date.now()).toBe(started);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(state.value).toBe('rejected');
      expect(state.error).toBe('Domain lookup cancelled or exceeded its deadline.');
      expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true);
      expect(add).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(
        remove.mock.calls.some((call) => call[0] === 'abort' && call[1] === add.mock.calls[0]![1]),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.resolve(late);
      await operation;
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelLateBody).toHaveBeenCalledTimes(1);
    expect(ctx.onProgress).not.toHaveBeenCalledWith({ stage: 'done', percent: 100 });
  });

  it('absorbs abandoned fetch rejection after the total deadline without exposing its message', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const transport = deferred<Response>();
    const invoked = deferred<AbortSignal>();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, options: RequestInit) => {
        if (!options.signal) throw new Error('Missing owned transport signal.');
        invoked.resolve(options.signal);
        return transport.promise;
      }),
    );
    const ctx = context();
    const { state, operation } = observe(ctx);
    try {
      const signal = await invoked.promise;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(Date.now()).toBe(started);
      await vi.advanceTimersByTimeAsync(10000);
      expect(state.value).toBe('rejected');
      expect(state.error).toBe('Domain lookup cancelled or exceeded its deadline.');
      expect(signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.reject(new Error('PRIVATE DOMAIN AND PROVIDER BODY'));
      await operation;
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(state.error).not.toContain('PRIVATE');
    expect(ctx.onProgress).not.toHaveBeenCalledWith({ stage: 'done', percent: 100 });
  });

  it('shares one deadline across fetch and a stalled body, even when reader cancellation never settles', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const transport = deferred<Response>();
    const invoked = deferred<AbortSignal>();
    const firstRead = deferred<void>();
    const secondRead = deferred<void>();
    const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
    const pendingCancel = deferred<void>();
    const reader = {
      read: vi
        .fn()
        .mockImplementationOnce(() => {
          firstRead.resolve();
          return Promise.resolve({ done: false, value: new TextEncoder().encode('{') });
        })
        .mockImplementation(() => {
          secondRead.resolve();
          return pendingRead.promise;
        }),
      cancel: vi.fn(() => pendingCancel.promise),
      releaseLock: vi.fn(),
    };
    const body = { getReader: () => reader };
    const reply = response();
    Object.defineProperty(reply, 'body', { value: body });
    const handlers = new Set<unknown>();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, options: RequestInit) => {
        const signal = options.signal;
        if (!signal) throw new Error('Missing owned transport signal.');
        const add = signal.addEventListener.bind(signal);
        const remove = signal.removeEventListener.bind(signal);
        vi.spyOn(signal, 'addEventListener').mockImplementation((type, listener, options) => {
          if (type === 'abort') handlers.add(listener);
          add(type, listener, options);
        });
        vi.spyOn(signal, 'removeEventListener').mockImplementation((type, listener, options) => {
          if (type === 'abort') handlers.delete(listener);
          remove(type, listener, options);
        });
        invoked.resolve(signal);
        return transport.promise;
      }),
    );
    const ctx = context();
    const { state, operation } = observe(ctx);
    try {
      const signal = await invoked.promise;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(Date.now()).toBe(started);
      transport.resolve(reply);
      await firstRead.promise;
      expect(Date.now()).toBe(started);
      await secondRead.promise;
      expect(Date.now()).toBe(started);
      expect(reader.read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(9000);
      expect(state.value).toBe('pending');
      await vi.advanceTimersByTimeAsync(999);
      expect(state.value).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(state.value).toBe('rejected');
      expect(state.error).toBe('Domain lookup cancelled or exceeded its deadline.');
      expect(signal.aborted).toBe(true);
      expect(reader.cancel).toHaveBeenCalled();
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
      expect(handlers.size).toBe(0);
    } finally {
      pendingRead.reject(new Error('PRIVATE LATE READ ERROR'));
      pendingCancel.reject(new Error('PRIVATE LATE CANCEL ERROR'));
      await operation;
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.onProgress).not.toHaveBeenCalledWith({ stage: 'done', percent: 100 });
    expect(state.error).not.toContain('PRIVATE');
  });

  it('does not await a hanging non-success body cancel before returning the fixed failure', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const invoked = deferred<AbortSignal>();
    const pendingCancel = deferred<void>();
    const cancel = vi.fn(() => pendingCancel.promise);
    const reply = new Response('PRIVATE UPSTREAM BODY', { status: 500 });
    Object.defineProperty(reply, 'body', { value: { cancel } });
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, options: RequestInit) => {
        if (!options.signal) throw new Error('Missing owned transport signal.');
        invoked.resolve(options.signal);
        return Promise.resolve(reply);
      }),
    );
    const { state, operation } = observe(context());
    try {
      const signal = await invoked.promise;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(Date.now()).toBe(started);
      await vi.advanceTimersByTimeAsync(0);
      expect(state.value).toBe('rejected');
      expect(state.error).toBe('Domain lookup failed. Check the domain or try again later.');
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      pendingCancel.resolve();
      await operation;
    }
  });

  it('returns validated success without awaiting a hanging reader cleanup', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const invoked = deferred<AbortSignal>();
    const pendingCancel = deferred<void>();
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(JSON.stringify(data())),
        })
        .mockResolvedValue({ done: true }),
      cancel: vi.fn(() => pendingCancel.promise),
      releaseLock: vi.fn(),
    };
    const reply = response();
    Object.defineProperty(reply, 'body', { value: { getReader: () => reader } });
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, options: RequestInit) => {
        if (!options.signal) throw new Error('Missing owned transport signal.');
        invoked.resolve(options.signal);
        return Promise.resolve(reply);
      }),
    );
    const ctx = context();
    const { state, operation } = observe(ctx);
    try {
      const signal = await invoked.promise;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(Date.now()).toBe(started);
      await vi.advanceTimersByTimeAsync(0);
      expect(state.value).toBe('fulfilled');
      expect(reader.cancel).toHaveBeenCalledTimes(1);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
      expect(ctx.onProgress).toHaveBeenCalledWith({ stage: 'done', percent: 100 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      pendingCancel.resolve();
      await operation;
    }
  });

  it.each(['user abort', 'original deadline'] as const)(
    'settles %s while the real dependency import remains controlled and pending',
    async (cancellation) => {
      vi.useFakeTimers();
      vi.resetModules();
      const started = Date.now();
      const entered = deferred<void>();
      const release = deferred<void>();
      const finished = deferred<void>();
      let factoryStarted = false;
      let factoryFinished = false;
      vi.doMock('../../src/lib/domain-registration.js', async () => {
        factoryStarted = true;
        entered.resolve();
        try {
          await release.promise;
          throw new Error('PRIVATE LATE MODULE RESOLUTION ERROR');
        } finally {
          factoryFinished = true;
          finished.resolve();
        }
      });
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const ctx = context(controller.signal);
      const state = { value: 'pending', error: '' };
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      let operation: Promise<void> | undefined;
      try {
        const { domainAgeChecker: freshDomainAgeChecker } = await import('../../src/utilities/domain-age.js');
        operation = freshDomainAgeChecker.run([], { domain: 'example.com' }, ctx).then(
          () => { state.value = 'fulfilled'; },
          (error: unknown) => {
            state.value = 'rejected';
            state.error = error instanceof Error ? error.message : String(error);
          },
        );
        await entered.promise;
        expect(Date.now()).toBe(started);
        expect(factoryFinished).toBe(false);
        expect(state.value).toBe('pending');
        expect(add).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
        expect(fetcher).not.toHaveBeenCalled();
        if (cancellation === 'user abort') controller.abort();
        else await vi.advanceTimersByTimeAsync(10000);
        await operation;
        expect(state.value).toBe('rejected');
        expect(state.error).toBe('Domain lookup cancelled or exceeded its deadline.');
        expect(factoryFinished).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove.mock.calls[0]![0]).toBe('abort');
        expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        try {
          controller.abort();
          release.resolve();
          if (factoryStarted) await finished.promise;
          await operation;
          await vi.advanceTimersByTimeAsync(0);
        } finally {
          process.off('unhandledRejection', unhandled);
          vi.doUnmock('../../src/lib/domain-registration.js');
          vi.resetModules();
        }
      }
      expect(fetcher).not.toHaveBeenCalled();
      expect(state.error).not.toContain('PRIVATE');
      expect(unhandled).not.toHaveBeenCalled();
      expect(ctx.onProgress).not.toHaveBeenCalledWith({ stage: 'done', percent: 100 });
    },
  );
});
