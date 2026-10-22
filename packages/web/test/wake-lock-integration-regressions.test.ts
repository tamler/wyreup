import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WakeLockHelper from '../src/lib/wakeLock';

interface Sentinel {
  release(): Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class VisibilityDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

describe('actual shared wake-lock ownership across pending/visibility requests', () => {
  let helper: typeof WakeLockHelper | undefined;

  beforeEach(() => {
    vi.resetModules();
    helper = undefined;
  });

  afterEach(() => {
    // Release leftover baseline state before discarding this fresh module/document.
    helper?.releaseWakeLock();
    helper?.releaseWakeLock();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('releases an unused sentinel that resolves after its last caller released', async () => {
    const pending = deferred<Sentinel>();
    const sentinel = { release: vi.fn(async () => {}) };
    const request = vi.fn(() => pending.promise);
    vi.stubGlobal('navigator', { wakeLock: { request } });
    vi.stubGlobal('document', new VisibilityDocument());
    helper = await import('../src/lib/wakeLock');

    const acquisition = helper.acquireWakeLock();
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    helper.releaseWakeLock();
    expect(sentinel.release).not.toHaveBeenCalled();
    pending.resolve(sentinel);
    await acquisition;

    expect(sentinel.release).toHaveBeenCalledTimes(1);
    helper.releaseWakeLock();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('coalesces two callers and retains the late sentinel until the remaining caller releases', async () => {
    const pending = deferred<Sentinel>();
    const sentinel = { release: vi.fn(async () => {}) };
    const request = vi.fn(() => pending.promise);
    vi.stubGlobal('navigator', { wakeLock: { request } });
    vi.stubGlobal('document', new VisibilityDocument());
    helper = await import('../src/lib/wakeLock');

    const first = helper.acquireWakeLock();
    const second = helper.acquireWakeLock();
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    helper.releaseWakeLock();
    pending.resolve(sentinel);
    await Promise.all([first, second]);
    expect(sentinel.release).not.toHaveBeenCalled();

    helper.releaseWakeLock();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    helper.releaseWakeLock();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries on visibility without creating another caller reference after best-effort rejection', async () => {
    const pending = deferred<Sentinel>();
    const sentinel = { release: vi.fn(async () => {}) };
    const request = vi
      .fn<() => Promise<Sentinel>>()
      .mockRejectedValueOnce(new Error('Controlled initial policy rejection'))
      .mockImplementationOnce(() => pending.promise);
    const document = new VisibilityDocument();
    vi.stubGlobal('navigator', { wakeLock: { request } });
    vi.stubGlobal('document', document);
    helper = await import('../src/lib/wakeLock');

    await expect(helper.acquireWakeLock()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1);
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(2, 'screen');
    pending.resolve(sentinel);
    await pending.promise;
    await Promise.resolve();
    expect(sentinel.release).not.toHaveBeenCalled();

    helper.releaseWakeLock();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
    helper.releaseWakeLock();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });
});
