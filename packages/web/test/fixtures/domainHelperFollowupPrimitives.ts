import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHelperBehaviorFixture, flushHelperNativeTurn, type FactoryIdentity, type Qualification, type Violation } from './domainLifecyclePrimitives';

export type FollowupMode = 'post-build-guard' | 'host-startup-timeout' | 'spawn-null-stdio' | 'fork-null-stdio' | 'late-initial-write' | 'compiler-abort' | 'host-abort' | 'persisted-leaves';
interface Entry { sequence: number; at: number; operation: string; args: unknown[]; outcome?: 'fulfilled' | 'rejected'; result?: unknown; error?: unknown }
interface WriteAttempt { sequence: number; file: string; text: string; payload: unknown; state: 'pending' | 'fulfilled' | 'rejected'; error?: unknown }
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred is not initialized.'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a controlled record.');
  return value as Record<string, unknown>;
}
function callable(value: unknown): (...args: unknown[]) => unknown {
  if (typeof value !== 'function') throw new Error('Expected a controlled callable.');
  return value as (...args: unknown[]) => unknown;
}

// This wraps only known base boundaries; the original fixture and its15 tests are unchanged.
export function createHelperFollowupFixture(qualification: Qualification, mode: FollowupMode) {
  const base = createHelperBehaviorFixture(qualification, mode === 'persisted-leaves' ? 'H3' : mode === 'compiler-abort' ? 'H5' : 'P3');
  const calls: Entry[] = [];
  const writes: WriteAttempt[] = [];
  const violations: Violation[] = [];
  const boundary = deferred<void>();
  let sequence = 0;
  let injectedGuard = false;
  let capturedInitial: { file: string; content: string; resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;
  const E_POST_GUARD = new Error('E_POST_GUARD');
  const E_NATIVE = Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' });
  const entry = (operation: string, args: unknown[]) => {
    if (calls.length >= 512) throw new Error('Followup ledger capacity exceeded; no product interpretation permitted.');
    const item: Entry = { sequence: ++sequence, at: Date.now(), operation, args }; calls.push(item); return item;
  };
  const violation = (target: string, member: PropertyKey): never => {
    violations.push({ target, member: String(member) });
    throw new Error(`Unqualified followup boundary: ${target}/${String(member)}`);
  };
  function protect(target: string, fn: (...args: unknown[]) => unknown) {
    return new Proxy(fn, { get(value, key) {
      if (key === 'name' || key === 'length' || key === 'prototype') return Reflect.get(value, key) as unknown;
      if (key === 'then' || key === '__esModule' || key === 'toJSON' || key === Symbol.iterator) return undefined;
      if (key === Symbol.toStringTag) return 'Function';
      return violation(target, key);
    } });
  }
  function overlay(target: Record<string, unknown>, name: string, overrides: Record<string, (...args: unknown[]) => unknown>) {
    const wrapped = Object.fromEntries(Object.entries(overrides).map(([key, fn]) => [key, protect(`${name}.${key}`, fn)]));
    for (const key of Object.keys(wrapped)) if (!Object.prototype.hasOwnProperty.call(target, key)) return violation(name, key);
    return new Proxy(target, {
      get(value, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(wrapped, key) ? wrapped[key] : Reflect.get(value, key) as unknown; },
      getOwnPropertyDescriptor(value, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (descriptor && typeof key === 'string' && Object.prototype.hasOwnProperty.call(wrapped, key)) return { ...descriptor, value: wrapped[key] };
        return descriptor;
      },
    });
  }
  const fsEntry = qualification.revision.helperBoundaryFactories.find(item => item.marker === 'helperFs');
  const childEntry = qualification.revision.helperBoundaryFactories.find(item => item.marker === 'helperChildren');
  if (!fsEntry || !childEntry) throw new Error('Required original finite factories absent.');
  const originalFs = base.factory(fsEntry);
  const originalPromises = object(originalFs.promises);
  const nativeRead = callable(originalPromises.readFile);
  const nativeWrite = callable(originalPromises.writeFile);
  const nativeReaddir = callable(originalPromises.readdir);
  const invokeWrite = (file: string, content: string) => nativeWrite(file, content);
  const promises = overlay(originalPromises, 'helperFs.promises', {
    readdir: (...args) => {
      if (mode === 'post-build-guard' && !injectedGuard && args[0] === base.project + '/packages/core/dist' && base.children[1]?.closes === 1) {
        injectedGuard = true; base.markDeadlineFailure(); const call = entry('post-build-guard-injection', args); call.outcome = 'rejected'; call.error = E_POST_GUARD;
        return Promise.reject(E_POST_GUARD);
      }
      return nativeReaddir(...args);
    },
    writeFile: (...args) => {
      const file = args[0], content = args[1];
      if (typeof file !== 'string' || !file.startsWith(base.owned + '/') || typeof content !== 'string') return violation('writeFile', 'owned-path/string-content');
      const payload: unknown = JSON.parse(content) as unknown;
      const call = entry('producer-write-attempt', [file, content]);
      const write: WriteAttempt = { sequence: call.sequence, file, text: content, payload, state: 'pending' }; writes.push(write);
      const data = object(payload);
      const early = mode === 'late-initial-write' && capturedInitial === null && (file === base.owned + '/manifest.json' || file === base.owned + '/startup-manifest.json') && 'coreBefore' in data && 'sourceBefore' in data && 'assetsBefore' in data && !('sdk' in data) && !('closedAt' in data);
      const operation = early ? new Promise<unknown>((resolve, reject) => { capturedInitial = { file, content, resolve, reject }; boundary.resolve(); }) : Promise.resolve(invokeWrite(file, content));
      return operation.then(result => { write.state = 'fulfilled'; call.outcome = 'fulfilled'; call.result = result; }, reason => {
        write.state = 'rejected'; call.outcome = 'rejected'; write.error = reason; call.error = reason;
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Retain the actual unknown native reason; do not fabricate a replacement Error.
        return Promise.reject(reason);
      });
    },
  });
  const exposedFs = new Proxy(originalFs, {
    get(target, key) { return key === 'promises' ? promises : Reflect.get(target, key) as unknown; },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return key === 'promises' && descriptor ? { ...descriptor, value: promises } : descriptor;
    },
  });

  interface State {
    pid: number | undefined; connected: boolean; exitCode: number | null; signalCode: string | null;
    stdout: PassThrough | null; stderr: PassThrough | null; closed: boolean; kills: string[]; sends: unknown[];
  }
  const custom: { state: State; events: EventEmitter; deliverClose: (code: number) => void }[] = [];
  function child(host: boolean, neverSpawned: boolean) {
    const events = new EventEmitter();
    const state: State = { pid: neverSpawned ? undefined : 7101, connected: host && !neverSpawned, exitCode: null, signalCode: null, stdout: neverSpawned ? null : new PassThrough(), stderr: neverSpawned ? null : new PassThrough(), closed: false, kills: [], sends: [] };
    const deliverClose = (code: number) => {
      if (state.closed) throw new Error('Custom synthetic child closed twice.');
      state.closed = true; state.exitCode = code; state.signalCode = null; state.connected = false;
      entry('native-child-close', [state.pid, code, null]); events.emit('close', code, null);
    };
    events.on('error', error => { entry('native-child-error', [state.pid, error]); });
    const values: Record<string, unknown> = {
      on: protect('synthetic-child.on', (...args) => { if (typeof args[0] !== 'string' || typeof args[1] !== 'function') return violation('child.on', 'event/listener'); return events.on(args[0], args[1] as (...args: unknown[]) => void); }),
      once: protect('synthetic-child.once', (...args) => { if (typeof args[0] !== 'string' || typeof args[1] !== 'function') return violation('child.once', 'event/listener'); return events.once(args[0], args[1] as (...args: unknown[]) => void); }),
      off: protect('synthetic-child.off', (...args) => { if (typeof args[0] !== 'string' || typeof args[1] !== 'function') return violation('child.off', 'event/listener'); return events.off(args[0], args[1] as (...args: unknown[]) => void); }),
      removeListener: protect('synthetic-child.removeListener', (...args) => { if (typeof args[0] !== 'string' || typeof args[1] !== 'function') return violation('child.removeListener', 'event/listener'); return events.removeListener(args[0], args[1] as (...args: unknown[]) => void); }),
      kill: protect('synthetic-child.kill', (...args) => {
        if (args[0] !== 'SIGTERM') return violation('child.kill', String(args[0]));
        state.kills.push('SIGTERM'); entry('native-child-signal-request', [state.pid, 'SIGTERM']);
        if (!neverSpawned && mode !== 'host-abort') queueMicrotask(() => { if (!state.closed) deliverClose(0); });
        return !neverSpawned;
      }),
      send: protect('synthetic-child.send', (...args) => {
        const message = object(args[0]); if (message.command !== 'close') return violation('child.send', 'close-only');
        state.sends.push(args[0]); entry('native-child-close-ipc', [state.pid, args[0]]);
        if (!neverSpawned && mode !== 'host-abort') queueMicrotask(() => { if (!state.closed) deliverClose(0); });
        if (args[1] !== undefined) { if (typeof args[1] !== 'function') return violation('child.send', 'callback'); (args[1] as () => void)(); }
        return true;
      }),
    };
    const fields = ['pid', 'connected', 'exitCode', 'signalCode', 'stdout', 'stderr'] as const;
    const result = new Proxy(Object.create(null) as Record<string, unknown>, {
      get(_target, key) {
        if (typeof key === 'string' && fields.includes(key as typeof fields[number])) return state[key as typeof fields[number]];
        if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(values, key)) return values[key];
        if (key === 'then' || key === '__esModule' || key === Symbol.iterator) return undefined;
        if (key === Symbol.toStringTag) return 'SyntheticChild';
        return violation('synthetic-child', key);
      },
      getPrototypeOf: () => null,
    });
    custom.push({ state, events, deliverClose }); boundary.resolve();
    if (neverSpawned) queueMicrotask(() => {
      state.exitCode = -24; entry('injected-native-error-identity', [E_NATIVE]); events.emit('error', E_NATIVE);
      queueMicrotask(() => { if (!state.closed) deliverClose(-24); });
    });
    return result;
  }
  const originalChildren = base.factory(childEntry);
  const spawn = callable(originalChildren.spawn), fork = callable(originalChildren.fork);
  const exposedChildren = overlay(originalChildren, 'helperChildren', {
    spawn: (...args) => {
      if (mode !== 'spawn-null-stdio') return spawn(...args);
      if (args[0] !== process.execPath || !Array.isArray(args[1]) || object(args[2]).cwd !== base.owned) return violation('spawn', 'original-command/args/cwd');
      entry('actual-producer-spawn-boundary', args); return child(false, true);
    },
    fork: (...args) => {
      if (!['fork-null-stdio', 'host-startup-timeout', 'host-abort'].includes(mode)) return fork(...args);
      if (typeof args[0] !== 'string' || !args[0].endsWith('/domainFunctionsHarness.mjs') || !Array.isArray(args[1]) || args[1][0] !== '--host-child' || args[1][1] !== base.owned + '/host-config.json' || object(args[2]).cwd !== base.owned) return violation('fork', 'original-helper/args/cwd');
      entry('actual-producer-fork-boundary', args); return child(true, mode === 'fork-null-stdio');
    },
  });
  function factory(item: FactoryIdentity) {
    if (item.marker === 'helperFs') return exposedFs;
    if (item.marker === 'helperChildren') return exposedChildren;
    return base.factory(item);
  }
  function requireClean() {
    base.requireClean();
    if (violations.length) throw new AggregateError(violations.map(item => new Error(`${item.target}/${item.member}`)), 'Followup qualification refused; no product outcome interpretation permitted.');
  }
  function freeze() {
    requireClean();
    return { mode, overrideCalls: calls.slice(), writeAttempts: writes.map(item => ({ ...item })), customChildren: custom.map(({ state }) => ({ pid: state.pid ?? null, connected: state.connected, closed: state.closed, exitCode: state.exitCode, signalCode: state.signalCode, kills: state.kills.slice(), sends: state.sends.slice() })), base: base.freezeEndpoint() };
  }
  async function releaseInitialWrite() {
    const pending = capturedInitial; if (!pending) throw new Error('No captured early native write.');
    entry('test-release-already-pending-initial-write', [pending.file]);
    try { pending.resolve(await invokeWrite(pending.file, pending.content)); }
    catch (error) { if (!(error instanceof Error)) throw new Error('Unexpected non-Error in fixture release.'); pending.reject(error); }
    await flushHelperNativeTurn();
  }
  async function observeOwnedFile(file: string) {
    if (file !== base.owned + '/manifest.json' && file !== base.owned + '/startup-manifest.json') return violation('test-observe-file', file);
    entry('independent-test-storage-observation', [file]);
    const data = await nativeRead(file, 'utf8'); if (typeof data !== 'string') throw new Error('Expected native synthetic stored text.'); return data;
  }
  async function releaseAlreadyCreated() {
    if (capturedInitial && writes.some(item => item.state === 'pending')) await releaseInitialWrite();
    for (const item of custom) { if (!item.state.closed) item.deliverClose(0); item.state.stdout?.destroy(); item.state.stderr?.destroy(); }
    await base.releaseAlreadyCreated();
    await flushHelperNativeTurn();
  }
  return { mode, base, calls, writes, violations, E_POST_GUARD, E_NATIVE, boundary: boundary.promise, factory, requireClean, freeze, releaseInitialWrite, observeOwnedFile, releaseAlreadyCreated };
}
