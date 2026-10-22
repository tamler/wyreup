import { it, expect, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureQualification, createQualificationSession, flushHelperNativeTurn, helperClockStart, helperErrorLeaves } from './fixtures/domainLifecyclePrimitives';
import { createHelperFollowupFixture, type FollowupMode } from './fixtures/domainHelperFollowupPrimitives';
import type * as DomainHarness from './domainFunctionsHarness.mjs';

const canonical = realpathSync;
const directory = new URL('.', import.meta.url);
const controlledKeys = ['node:fs', 'node:child_process', 'node:module'];
function resetMocks() { for (const key of controlledKeys) vi.doUnmock(key); vi.resetModules(); }
function observe<T>(promise: Promise<T>) {
  let state: 'pending' | 'fulfilled' | 'rejected' = 'pending', value: T | undefined, error: unknown;
  const done = promise.then(result => { state = 'fulfilled'; value = result; }, reason => { state = 'rejected'; error = reason; });
  return { done, get state() { return state; }, get value() { return value; }, get error() { return error; } };
}
async function load(mode: FollowupMode) {
  vi.useRealTimers(); resetMocks();
  const qualification = captureQualification(directory);
  const session = createQualificationSession(qualification, {});
  const fixture = createHelperFollowupFixture(qualification, mode);
  let factoriesOpen = true;
  for (const item of qualification.revision.helperBoundaryFactories) vi.doMock(item.key, () => {
    if (!factoriesOpen) { session.violations.push({ target: 'postqualification-factory', member: item.key }); throw new Error('Unexpected postqualification factory.'); }
    session.factory(item, import.meta.url); return fixture.factory(item);
  });
  const entry = session.beginImport('domainFunctionsHarness.mjs');
  const original: typeof DomainHarness = await import('./domainFunctionsHarness.mjs');
  factoriesOpen = false; session.requireClean(); fixture.requireClean();
  expect(typeof original.startDomainFunctionsHost).toBe('function');
  expect(session.markers).toHaveLength(3);
  for (const item of qualification.revision.helperBoundaryFactories) expect(session.markers.filter(marker => marker.declaredMockKey === item.key)).toEqual([{
    declaredMockKey: item.key, marker: item.marker, declaredDoMockCaller: canonical(fileURLToPath(import.meta.url)),
    awaitedCanonicalEntry: entry, canonicalResolutionTarget: session.canonical(item.key), session: session.token,
  }]);
  expect(fixture.base.calls).toEqual([]); expect(fixture.calls).toEqual([]);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(helperClockStart);
  const caller = new AbortController();
  const operation = observe(original.startDomainFunctionsHost({ projectDir: fixture.base.project, distDir: fixture.base.dist, evidenceDir: fixture.base.evidence, expectedCoreDistPins: fixture.base.corePins, callerAbortSignal: caller.signal, deadlineAt: helperClockStart + 600000 }));
  return { qualification, session, fixture, caller, operation };
}
type Control = Awaited<ReturnType<typeof load>>;
function qualified(control: Control) { control.session.requireClean(); control.fixture.requireClean(); }
function freeze(control: Control, extra: Record<string, unknown> = {}) {
  qualified(control); const endpoint = control.fixture.freeze();
  console.info(JSON.stringify({ kind: 'controlled-helper-followup-endpoint', mode: control.fixture.mode, revision: control.qualification.revision.revisionId,
    sourcePins: control.qualification.sources, rowSha256: control.qualification.rowSha256, expectationSha256: control.qualification.dataSha256,
    publicState: control.operation.state, publicErrors: control.operation.state === 'rejected' ? helperErrorLeaves(control.operation.error).map(error => ({ name: error instanceof Error ? error.name : 'NonError', message: error instanceof Error ? error.message : String(error), nativeSpawnIdentity: error === control.fixture.E_NATIVE, guardIdentity: error === control.fixture.E_POST_GUARD, streamIdentity: error === control.fixture.base.E_STREAM })) : [],
    endpoint, extra, qualification: 'Synthetic owned children and in-memory FS/native streams only; no SDK, actual process, HTTP, browser or production acceptance.' }));
  return endpoint;
}
async function finish(control: Control) {
  try { await control.fixture.releaseAlreadyCreated(); await control.operation.done; qualified(control); }
  finally { resetMocks(); vi.useRealTimers(); }
}
function diagnostics(control: Control) {
  return control.fixture.writes.filter(write => write.file === control.fixture.base.failedLaunch || write.file === control.fixture.base.owned + '/manifest.json');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Actual diagnostic object absent.'); return value as Record<string, unknown>;
}
function lastDiagnostics(control: Control) {
  const writes = diagnostics(control);
  const launch = writes.find(write => write.file === control.fixture.base.failedLaunch);
  const terminal = writes.filter(write => write.file === control.fixture.base.owned + '/manifest.json').at(-1);
  if (!launch || !terminal) throw new Error('Actual failed-launch and terminal attempts were not both observed.');
  expect(launch.state).toBe('fulfilled'); expect(terminal.state).toBe('fulfilled');
  return { launch: record(launch.payload), terminal: record(terminal.payload) };
}

it('F1 attributes a post-success syntax guard failure to the actual guard phase', async () => {
  const control = await load('post-build-guard');
  try {
    await control.operation.done; const endpoint = freeze(control);
    expect(control.operation.state).toBe('rejected'); expect(helperErrorLeaves(control.operation.error)[0]).toBe(control.fixture.E_POST_GUARD);
    expect(control.fixture.base.children.map(child => ({ closes: child.closes, code: child.exitCode }))).toEqual([{ closes: 1, code: 0 }, { closes: 1, code: 0 }]);
    expect(endpoint.overrideCalls.filter(call => call.operation === 'post-build-guard-injection')).toHaveLength(1);
    const { launch, terminal } = lastDiagnostics(control);
    for (const payload of [launch, terminal]) {
      const lifecycle = record(payload.lifecycle); expect(lifecycle.phase).toBe('post-build-guard');
      expect(record(lifecycle.child).pid).toBeNull();
    }
  } finally { await finish(control); }
}, 15000);

it('F1 retains launch-time host liveness and records fresh observed post-cleanup terminal liveness', async () => {
  const control = await load('host-startup-timeout');
  try {
    await control.fixture.boundary; qualified(control);
    await vi.advanceTimersByTimeAsync(30000); await flushHelperNativeTurn(); await control.operation.done;
    const endpoint = freeze(control); expect(control.operation.state).toBe('rejected');
    expect(endpoint.customChildren).toEqual([{ pid: 7101, connected: false, closed: true, exitCode: 0, signalCode: null, kills: [], sends: [{ id: 0, command: 'close' }] }]);
    expect(endpoint.overrideCalls.filter(call => call.operation === 'native-child-close')).toHaveLength(1);
    expect(endpoint.base.calls.some(call => call.operation === 'native-writer-finish' && call.args[0] === control.fixture.base.owned + '/functions-host.log')).toBe(true);
    const { launch, terminal } = lastDiagnostics(control);
    const before = record(launch.lifecycle), after = record(terminal.lifecycle);
    expect(before.phase).toBe('functions-host'); expect(after.phase).toBe('functions-host');
    expect(record(before.child)).toEqual({ pid: 7101, closed: false, exitCode: null, signalCode: null });
    expect(record(before.writer)).toEqual({ endRequested: false, finished: false });
    expect(record(after.child)).toEqual({ pid: 7101, closed: true, exitCode: 0, signalCode: null });
    expect(record(after.writer)).toEqual({ endRequested: true, finished: true });
    expect(typeof launch.lifecycleCapturedAt).toBe('string'); expect(typeof terminal.lifecycleCapturedAt).toBe('string');
  } finally { await finish(control); }
}, 15000);

it.each(['spawn-null-stdio', 'fork-null-stdio'] as const)('F2 %s preserves the native error as primary and signals no never-spawned PID', async mode => {
  const control = await load(mode);
  try {
    await control.fixture.boundary; await control.operation.done;
    const endpoint = freeze(control); expect(control.operation.state).toBe('rejected');
    const leaves = helperErrorLeaves(control.operation.error);
    expect(leaves[0]).toBe(control.fixture.E_NATIVE); expect(leaves.filter(error => error === control.fixture.E_NATIVE)).toHaveLength(1);
    expect(leaves.some(error => error instanceof TypeError)).toBe(false);
    expect(endpoint.customChildren).toHaveLength(1); expect(endpoint.customChildren[0]).toMatchObject({ pid: null, closed: true, exitCode: -24, kills: [] });
    expect(endpoint.overrideCalls.filter(call => call.operation === 'native-child-signal-request')).toEqual([]);
    expect(endpoint.overrideCalls.filter(call => call.operation === 'injected-native-error-identity')[0]?.args[0]).toBe(control.fixture.E_NATIVE);
  } finally { await finish(control); }
}, 15000);

it('F3 a late initial native write cannot replace the actual terminal diagnostic bytes', async () => {
  const control = await load('late-initial-write');
  try {
    await control.fixture.boundary; qualified(control);
    await vi.advanceTimersByTimeAsync(5000); await flushHelperNativeTurn(); await control.operation.done;
    expect(control.operation.state).toBe('rejected');
    const terminalPath = control.fixture.base.owned + '/manifest.json';
    const before = await control.fixture.observeOwnedFile(terminalPath);
    expect(record(JSON.parse(before) as unknown).cleanup).toBe('Incomplete owned acceptance; retained child, stream and source evidence is not certified.');
    await control.fixture.releaseInitialWrite();
    const after = await control.fixture.observeOwnedFile(terminalPath);
    const endpoint = freeze(control, { storageObservation: { terminalPath, before, after } });
    expect(after).toBe(before);
    expect(endpoint.writeAttempts[0]?.file).toBe(control.fixture.base.owned + '/startup-manifest.json');
    expect(endpoint.writeAttempts[0]?.state).toBe('fulfilled');
  } finally { await finish(control); }
}, 15000);

it('F4 compiler abort starts the existing5000ms termination observation without waiting for build deadline', async () => {
  const control = await load('compiler-abort');
  try {
    await control.fixture.base.compilerReady; qualified(control);
    await vi.advanceTimersByTimeAsync(100); const abortedAt = Date.now(); control.caller.abort();
    await vi.advanceTimersByTimeAsync(4999); await flushHelperNativeTurn(); expect(control.operation.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1); await flushHelperNativeTurn();
    const endpoint = freeze(control, { abortedAt, observedAt: Date.now(), fixedTerminationBudget: 5000 });
    expect(control.operation.state).toBe('rejected');
    expect(endpoint.base.child).toMatchObject({ pid: 7001, closed: false, kills: ['SIGTERM'] });
    expect(endpoint.base.writer?.endAt).toBe(abortedAt + 5000);
    expect(helperErrorLeaves(control.operation.error).some(error => error instanceof Error && error.message === 'Owned child 7001 did not exit after SIGTERM; retain its PID and evidence. No SIGKILL was sent.')).toBe(true);
    expect(helperErrorLeaves(control.operation.error).some(error => error instanceof Error && error.message === 'Owned functions-build exceeded its declared deadline.')).toBe(false);
  } finally { await finish(control); }
}, 15000);

it('F4 starting-host abort promptly enters unchanged graceful5000 plus termination5000 cleanup', async () => {
  const control = await load('host-abort');
  try {
    await control.fixture.boundary; qualified(control);
    await vi.advanceTimersByTimeAsync(100); const abortedAt = Date.now(); control.caller.abort();
    await flushHelperNativeTurn();
    const closeCall = control.fixture.calls.find(call => call.operation === 'native-child-close-ipc');
    const promptSignalCount = control.fixture.calls.filter(call => call.operation === 'native-child-signal-request').length;
    await vi.advanceTimersByTimeAsync(9999); await flushHelperNativeTurn(); expect(control.operation.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1); await flushHelperNativeTurn();
    const endpoint = freeze(control, { abortedAt, observedAt: Date.now(), gracefulBudget: 5000, terminationBudget: 5000, promptCloseCall: closeCall ?? null, promptSignalCount });
    expect(closeCall?.at).toBe(abortedAt);
    expect(promptSignalCount).toBe(1);
    expect(control.operation.state).toBe('rejected');
    expect(endpoint.customChildren[0]).toMatchObject({ pid: 7101, closed: false, kills: ['SIGTERM'] });
    expect(helperErrorLeaves(control.operation.error).some(error => error instanceof Error && error.message === 'Owned child 7101 did not exit after SIGTERM; retain its PID and evidence. No SIGKILL was sent.')).toBe(true);
  } finally { await finish(control); }
}, 15000);

it('F5 preserves canonical known public aggregate leaves in both actual diagnostic payloads', async () => {
  const control = await load('persisted-leaves');
  try {
    await control.fixture.base.compilerReady; qualified(control);
    await vi.advanceTimersByTimeAsync(180000); await control.fixture.base.writerEnd;
    control.fixture.base.releaseWrite(); await flushHelperNativeTurn(); control.fixture.base.releaseFinal(control.fixture.base.E_STREAM); await flushHelperNativeTurn();
    await control.operation.done; freeze(control); expect(control.operation.state).toBe('rejected');
    const leaves = helperErrorLeaves(control.operation.error);
    expect(leaves).toHaveLength(2); expect(leaves[1]).toBe(control.fixture.base.E_STREAM);
    const expected = leaves.map(error => { if (!(error instanceof Error)) throw new Error('Expected native known Error leaf.'); return { name: error.name, message: error.message }; });
    expect(expected[0]?.message).toBe('Owned functions-build exceeded its declared deadline.');
    const { launch, terminal } = lastDiagnostics(control);
    expect(typeof launch.error).toBe('string'); expect(launch.errors).toEqual(expected); expect(terminal.errors).toEqual(expected);
    for (const payload of [launch, terminal]) for (const leaf of payload.errors as Record<string, unknown>[]) expect(Object.keys(leaf).sort()).toEqual(['message', 'name']);
  } finally { await finish(control); }
}, 15000);
