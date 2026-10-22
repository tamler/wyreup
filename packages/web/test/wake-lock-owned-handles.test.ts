import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as WakeLockHelper from '../src/lib/wakeLock';

class VisibilityDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

class Sentinel extends EventTarget {
  release = vi.fn(() => {
    this.dispatchEvent(new Event('release'));
    return Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const held: ReturnType<typeof WakeLockHelper.holdWakeLock>[] = [];

async function load(request: () => Promise<Sentinel>) {
  vi.resetModules();
  const document = new VisibilityDocument();
  vi.stubGlobal('navigator', { wakeLock: { request } });
  vi.stubGlobal('document', document);
  const helper = await import('../src/lib/wakeLock');
  const hold = () => {
    const owner = helper.holdWakeLock();
    held.push(owner);
    return owner;
  };
  return { helper, document, hold };
}

afterEach(() => {
  for (const owner of held) owner.release();
  held.length = 0;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('wake-lock handles preserve each job ownership', () => {
  it('coalesces a new owner with a cancelled pending request without reviving the old owner', async () => {
    const pending = deferred<Sentinel>();
    const sentinel = new Sentinel();
    const request = vi.fn(() => pending.promise);
    const { hold } = await load(request);
    const cancelled = hold();
    cancelled.release();
    const current = hold();
    pending.resolve(sentinel);
    await Promise.all([cancelled.ready, current.ready]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sentinel.release).not.toHaveBeenCalled();
    cancelled.release();
    expect(sentinel.release).not.toHaveBeenCalled();
    current.release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('cancel/unmount followed by the old finally cannot release another still-active job', async () => {
    const sentinel = new Sentinel();
    const { hold } = await load(vi.fn(() => Promise.resolve(sentinel)));
    const first = hold();
    const second = hold();
    await Promise.all([first.ready, second.ready]);
    first.release();
    first.release();
    expect(sentinel.release).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('a stale native sentinel release event cannot clear a newer sentinel', async () => {
    const firstSentinel = new Sentinel();
    const secondSentinel = new Sentinel();
    const request = vi
      .fn<() => Promise<Sentinel>>()
      .mockResolvedValueOnce(firstSentinel)
      .mockResolvedValueOnce(secondSentinel);
    const { hold } = await load(request);
    const first = hold();
    await first.ready;
    first.release();
    const second = hold();
    await second.ready;
    firstSentinel.dispatchEvent(new Event('release'));
    const third = hold();
    await third.ready;
    expect(request).toHaveBeenCalledTimes(2);
    second.release();
    expect(secondSentinel.release).not.toHaveBeenCalled();
    third.release();
    expect(secondSentinel.release).toHaveBeenCalledTimes(1);
  });

  it('native release and repeated visible events reacquire without adding owner shares', async () => {
    const firstSentinel = new Sentinel();
    const pending = deferred<Sentinel>();
    const secondSentinel = new Sentinel();
    const request = vi
      .fn<() => Promise<Sentinel>>()
      .mockResolvedValueOnce(firstSentinel)
      .mockImplementationOnce(() => pending.promise);
    const { document, hold } = await load(request);
    const owner = hold();
    await owner.ready;
    document.visibilityState = 'hidden';
    firstSentinel.dispatchEvent(new Event('release'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1);
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
    pending.resolve(secondSentinel);
    await pending.promise;
    await Promise.resolve();
    owner.release();
    expect(secondSentinel.release).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('legacy releases consume only legacy acquisitions, preserving owned handles', async () => {
    const sentinel = new Sentinel();
    const { helper, hold } = await load(vi.fn(() => Promise.resolve(sentinel)));
    await helper.acquireWakeLock();
    const owner = hold();
    await owner.ready;
    helper.releaseWakeLock();
    helper.releaseWakeLock();
    expect(sentinel.release).not.toHaveBeenCalled();
    owner.release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('policy denial is best effort and never starts an automatic retry loop', async () => {
    const request = vi.fn<() => Promise<Sentinel>>().mockRejectedValue(new Error('Denied'));
    const { hold } = await load(request);
    const owner = hold();
    await expect(owner.ready).resolves.toBeUndefined();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(() => owner.release()).not.toThrow();
  });

  it('unsupported API and synchronous request failure remain no-throw releases', async () => {
    const request = vi.fn<() => Promise<Sentinel>>(() => {
      throw new Error('Unavailable');
    });
    const { helper, hold } = await load(request);
    const failed = hold();
    await expect(failed.ready).resolves.toBeUndefined();
    failed.release();
    vi.stubGlobal('navigator', {});
    const unsupported = helper.holdWakeLock();
    held.push(unsupported);
    await expect(unsupported.ready).resolves.toBeUndefined();
    expect(() => unsupported.release()).not.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
