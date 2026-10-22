import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observePwaUpdate, shouldShowPwaUpdate, waitingUpdateMessage, type PwaUpdateStatus } from '../src/lib/pwaUpdate';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

class WorkerValue extends EventTarget {
  state: ServiceWorkerState = 'installed';
  postMessage = vi.fn();
}

class RegistrationValue extends EventTarget {
  scope = 'https://wyreup.example/';
  active: WorkerValue | null = new WorkerValue();
  waiting: WorkerValue | null = null;
  installing: WorkerValue | null = null;
  update = vi.fn<() => Promise<RegistrationValue>>(() => Promise.resolve(this));
  unregister = vi.fn();
}

const observers: Array<ReturnType<typeof observePwaUpdate>> = [];

function fixture() {
  const registration = new RegistrationValue();
  const ready = deferred<RegistrationValue>();
  const getRegistration = vi.fn<() => Promise<RegistrationValue | undefined>>(() => Promise.resolve(registration));
  const register = vi.fn();
  const reload = vi.fn();
  const serviceWorker = { getRegistration, ready: ready.promise, register };
  vi.stubGlobal('navigator', { onLine: true, serviceWorker });
  vi.stubGlobal('window', {
    location: { href: 'https://wyreup.example/tools/base64/', reload },
    setTimeout,
    clearTimeout,
  });
  const statuses: PwaUpdateStatus[] = [];
  const observer = observePwaUpdate((status) => statuses.push(status));
  observers.push(observer);
  return { registration, ready, getRegistration, register, reload, observer, statuses };
}

async function flush() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const observer of observers.splice(0)) observer.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('root registration observation (controlled APIs, not browser acceptance)', () => {
  it('observes an already-waiting update without registering, activating or reloading', async () => {
    const value = fixture();
    const waiting = new WorkerValue();
    value.registration.waiting = waiting;
    await flush();
    expect(value.statuses.at(-1)).toEqual({ kind: 'waiting', message: waitingUpdateMessage, checking: false, worker: waiting });
    expect(value.getRegistration).toHaveBeenCalledWith('https://wyreup.example/');
    expect(value.register).not.toHaveBeenCalled();
    expect(value.registration.unregister).not.toHaveBeenCalled();
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(value.reload).not.toHaveBeenCalled();
  });

  it('does not announce a first install as a waiting update', async () => {
    const value = fixture();
    value.registration.active = null;
    value.registration.waiting = new WorkerValue();
    await flush();
    expect(value.statuses.some((status) => status.kind === 'waiting')).toBe(false);
  });

  it.each(['activating', 'activated', 'redundant'] as const)('observes an already-waiting worker becoming %s', async (state) => {
    const value = fixture();
    const worker = new WorkerValue();
    value.registration.waiting = worker;
    await flush();
    expect(value.statuses.at(-1)?.kind).toBe('waiting');
    worker.state = state;
    worker.dispatchEvent(new Event('statechange'));
    expect(value.statuses.at(-1)?.kind).toBe('observing');
  });

  it('reports activation of an initially installing worker as observation', async () => {
    const value = fixture();
    const worker = new WorkerValue();
    worker.state = 'installing';
    value.registration.installing = worker;
    await flush();
    expect(value.statuses.at(-1)?.kind).toBe('installing');
    worker.state = 'activating';
    worker.dispatchEvent(new Event('statechange'));
    expect(value.statuses.at(-1)?.kind).toBe('observing');
  });

  it('detaches waiting worker listeners on replacement and disposal', async () => {
    const value = fixture();
    const first = new WorkerValue();
    value.registration.waiting = first;
    await flush();
    const removeFirst = vi.spyOn(first, 'removeEventListener');
    const second = new WorkerValue();
    value.registration.waiting = second;
    value.registration.dispatchEvent(new Event('updatefound'));
    expect(removeFirst).toHaveBeenCalledWith('statechange', expect.any(Function));
    const count = value.statuses.length;
    first.dispatchEvent(new Event('statechange'));
    expect(value.statuses).toHaveLength(count);
    const removeSecond = vi.spyOn(second, 'removeEventListener');
    value.observer.dispose();
    expect(removeSecond).toHaveBeenCalledWith('statechange', expect.any(Function));
    second.dispatchEvent(new Event('statechange'));
    expect(value.statuses).toHaveLength(count);
  });

  it('attaches the installing worker present on mount and follows its real state event', async () => {
    const value = fixture();
    const worker = new WorkerValue();
    worker.state = 'installing';
    value.registration.installing = worker;
    await flush();
    expect(value.statuses.at(-1)?.kind).toBe('installing');
    value.registration.waiting = worker;
    worker.state = 'installed';
    worker.dispatchEvent(new Event('statechange'));
    expect(value.statuses.at(-1)).toMatchObject({ kind: 'waiting', worker });
  });

  it('handles updatefound and detaches a replaced installing worker', async () => {
    const value = fixture();
    await flush();
    const first = new WorkerValue();
    first.state = 'installing';
    value.registration.installing = first;
    value.registration.dispatchEvent(new Event('updatefound'));
    const second = new WorkerValue();
    second.state = 'installing';
    value.registration.installing = second;
    value.registration.dispatchEvent(new Event('updatefound'));
    const count = value.statuses.length;
    first.dispatchEvent(new Event('statechange'));
    expect(value.statuses).toHaveLength(count);
    value.registration.waiting = second;
    second.state = 'installed';
    second.dispatchEvent(new Event('statechange'));
    expect(value.statuses.at(-1)).toMatchObject({ kind: 'waiting', worker: second });
  });

  it('reports a distinct worker reference for a subsequent waiting update', async () => {
    const value = fixture();
    const first = new WorkerValue();
    value.registration.waiting = first;
    await flush();
    expect(value.statuses.at(-1)).toMatchObject({ kind: 'waiting', worker: first });
    const second = new WorkerValue();
    value.registration.waiting = second;
    value.registration.dispatchEvent(new Event('updatefound'));
    expect(value.statuses.at(-1)).toMatchObject({ kind: 'waiting', worker: second });
    // The mounted shell's Later behavior is a separate native UI gate.
  });

  it('accepts a late ready registration without waiting indefinitely in initialization', async () => {
    const value = fixture();
    value.getRegistration.mockImplementationOnce(() => Promise.resolve(undefined));
    await flush();
    expect(value.statuses.at(-1)?.kind).toBe('unregistered');
    value.registration.waiting = new WorkerValue();
    value.ready.resolve(value.registration);
    await flush();
    expect(value.statuses.at(-1)?.kind).toBe('waiting');
  });

  it('refuses a registration from a different scope', async () => {
    const value = fixture();
    value.registration.scope = 'https://wyreup.example/other/';
    value.registration.waiting = new WorkerValue();
    await flush();
    value.ready.resolve(value.registration);
    await flush();
    expect(value.statuses.some((status) => status.kind === 'waiting')).toBe(false);
    expect(value.statuses.at(-1)?.kind).toBe('unregistered');
  });

  it('keeps passive late-registration observation after an explicit unregistered check', async () => {
    const value = fixture();
    value.getRegistration.mockImplementation(() => Promise.resolve(undefined));
    await flush();
    await value.observer.check();
    expect(value.statuses.at(-1)?.kind).toBe('unregistered');
    value.registration.waiting = new WorkerValue();
    value.ready.resolve(value.registration);
    await flush();
    expect(value.statuses.at(-1)?.kind).toBe('waiting');
    expect(value.registration.update).not.toHaveBeenCalled();
  });

  it('does not attach or emit from ready or getRegistration after disposal', async () => {
    const value = fixture();
    const lookup = deferred<RegistrationValue>();
    value.getRegistration.mockImplementationOnce(() => lookup.promise);
    await flush();
    const add = vi.spyOn(value.registration, 'addEventListener');
    value.observer.dispose();
    const count = value.statuses.length;
    value.ready.resolve(value.registration);
    lookup.resolve(value.registration);
    await flush();
    expect(value.statuses).toHaveLength(count);
    expect(add).not.toHaveBeenCalled();
  });

  it('reports unsupported browser APIs without calling native registration methods', () => {
    vi.stubGlobal('window', { location: { href: 'https://wyreup.example/' } });
    vi.stubGlobal('navigator', {});
    const statuses: PwaUpdateStatus[] = [];
    const observer = observePwaUpdate((status) => statuses.push(status));
    observers.push(observer);
    expect(statuses.at(-1)?.kind).toBe('unsupported');
  });

  it('handles initial lookup rejection without exposing its native error', async () => {
    const value = fixture();
    value.getRegistration.mockRejectedValueOnce(new Error('private initialization URL'));
    await flush();
    expect(value.statuses.at(-1)).toEqual({ kind: 'error', message: 'Could not observe the service-worker registration. You can retry the check.', checking: false });
    expect(JSON.stringify(value.statuses)).not.toContain('private');
  });

  it('absorbs late readiness rejection after disposal without a status or retained listener', async () => {
    const value = fixture();
    await flush();
    value.observer.dispose();
    const count = value.statuses.length;
    value.ready.reject(new Error('late readiness failure'));
    await flush();
    expect(value.statuses).toHaveLength(count);
  });
});

describe('explicit update-check ownership', () => {
  it('shows a later waiting worker after dismissing the previous update', async () => {
    const value = fixture();
    const first = new WorkerValue();
    value.registration.waiting = first;
    await flush();
    const firstStatus = value.statuses.at(-1) ?? null;
    expect(shouldShowPwaUpdate(firstStatus, null)).toBe(true);
    const dismissed = first as unknown as ServiceWorker;
    expect(shouldShowPwaUpdate(firstStatus, dismissed)).toBe(false);
    const second = new WorkerValue();
    value.registration.waiting = second;
    value.registration.dispatchEvent(new Event('updatefound'));
    expect(shouldShowPwaUpdate(value.statuses.at(-1) ?? null, dismissed)).toBe(true);
    expect(shouldShowPwaUpdate(firstStatus, dismissed)).toBe(false);
    expect(shouldShowPwaUpdate(null, dismissed)).toBe(false);
    expect(shouldShowPwaUpdate({ kind: 'observing', checking: false, message: 'Watching.' }, dismissed)).toBe(false);
  });

  it('serializes two Checks and keeps the action busy until the native update settles', async () => {
    const value = fixture();
    await flush();
    const update = deferred<RegistrationValue>();
    value.registration.update.mockImplementationOnce(() => update.promise);
    const first = value.observer.check();
    const second = value.observer.check();
    expect(first).toBe(second);
    await flush();
    expect(value.registration.update).toHaveBeenCalledTimes(1);
    expect(value.statuses.at(-1)?.checking).toBe(true);
    update.resolve(value.registration);
    await first;
    expect(value.statuses.at(-1)).toEqual({ kind: 'observing', message: 'No waiting update detected', checking: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses offline before starting a lookup and allows a later explicit retry', async () => {
    const value = fixture();
    await flush();
    const before = value.getRegistration.mock.calls.length;
    vi.stubGlobal('navigator', { onLine: false, serviceWorker: { getRegistration: value.getRegistration, ready: value.ready.promise } });
    await value.observer.check();
    expect(value.statuses.at(-1)?.kind).toBe('offline');
    expect(value.getRegistration).toHaveBeenCalledTimes(before);
    vi.stubGlobal('navigator', { onLine: true });
    await value.observer.check();
    expect(value.registration.update).toHaveBeenCalledTimes(1);
    expect(value.statuses.at(-1)?.message).toBe('No waiting update detected');
  });

  it('redacts a native update rejection into a fixed retry message', async () => {
    const value = fixture();
    await flush();
    value.registration.update.mockRejectedValueOnce(new Error('private URL token=secret'));
    await value.observer.check();
    expect(value.statuses.at(-1)).toEqual({ kind: 'error', message: 'The update check failed. You can retry.', checking: false });
    expect(JSON.stringify(value.statuses)).not.toContain('secret');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out getRegistration at 10000ms and ignores its abandoned late fulfillment', async () => {
    const value = fixture();
    await flush();
    const lookup = deferred<RegistrationValue>();
    value.getRegistration.mockImplementationOnce(() => lookup.promise);
    const check = value.observer.check();
    await flush();
    await vi.advanceTimersByTimeAsync(9999);
    expect(value.statuses.at(-1)?.checking).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await check;
    const count = value.statuses.length;
    expect(value.statuses.at(-1)?.message).toBe('The update check timed out. You can retry.');
    lookup.resolve(value.registration);
    await flush();
    expect(value.statuses).toHaveLength(count);
    expect(value.registration.update).not.toHaveBeenCalled();
  });

  it('times out a pending update and absorbs an abandoned late rejection', async () => {
    const value = fixture();
    await flush();
    const update = deferred<RegistrationValue>();
    value.registration.update.mockImplementationOnce(() => update.promise);
    const check = value.observer.check();
    await flush();
    await vi.advanceTimersByTimeAsync(10000);
    await check;
    const count = value.statuses.length;
    update.reject(new Error('late private failure'));
    await flush();
    expect(value.statuses).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles a pending caller on disposal, detaches listeners and ignores late update success', async () => {
    const value = fixture();
    await flush();
    const worker = new WorkerValue();
    worker.state = 'installing';
    value.registration.installing = worker;
    value.registration.dispatchEvent(new Event('updatefound'));
    const removeRegistration = vi.spyOn(value.registration, 'removeEventListener');
    const removeWorker = vi.spyOn(worker, 'removeEventListener');
    const update = deferred<RegistrationValue>();
    value.registration.update.mockImplementationOnce(() => update.promise);
    const check = value.observer.check();
    await flush();
    value.observer.dispose();
    await check;
    const count = value.statuses.length;
    update.resolve(value.registration);
    worker.dispatchEvent(new Event('statechange'));
    value.registration.dispatchEvent(new Event('updatefound'));
    await flush();
    expect(value.statuses).toHaveLength(count);
    expect(removeRegistration).toHaveBeenCalledWith('updatefound', expect.any(Function));
    expect(removeWorker).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detaches a replaced registration and never trusts an old readiness continuation', async () => {
    const value = fixture();
    await flush();
    const next = new RegistrationValue();
    next.waiting = new WorkerValue();
    value.getRegistration.mockImplementationOnce(() => Promise.resolve(next));
    await value.observer.check();
    expect(value.statuses.at(-1)).toMatchObject({ kind: 'waiting', worker: next.waiting });
    const count = value.statuses.length;
    value.registration.dispatchEvent(new Event('updatefound'));
    value.ready.resolve(value.registration);
    await flush();
    expect(value.statuses).toHaveLength(count);
  });
});
