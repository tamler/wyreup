import { it, expect, vi } from 'vitest';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureQualification, createQualificationSession } from './fixtures/domainLifecyclePrimitives';

const realExists = existsSync;
const realCanonical = realpathSync;
const directory = new URL('.', import.meta.url);
const controlledKeys = ['node:fs', 'node:child_process', 'node:module', 'vitest', 'playwright', './productionBrowserHarness', './domainFunctionsHarness.mjs', 'node:fs/promises', 'node:os'];

function resetMocks() {
  for (const key of controlledKeys) vi.doUnmock(key);
  vi.resetModules();
}

it('Q1 qualifies the whole original helper import and safe first-realpath sentinel only', async () => {
  vi.useRealTimers();
  resetMocks();
  const qualification = captureQualification(directory);
  const session = createQualificationSession(qualification, {});
  const entries = qualification.revision.helperBoundaryFactories;
  expect(entries.map(entry => entry.key).sort()).toEqual(['node:child_process', 'node:fs', 'node:module']);
  const missing = '/__wyreup_lifecycle_qualification_missing__/project';
  expect(realExists(missing)).toBe(false);
  try {
    for (const entry of entries) vi.doMock(entry.key, () => session.factory(entry, import.meta.url));
    const awaitedEntry = session.beginImport('domainFunctionsHarness.mjs');
    const original = await import('./domainFunctionsHarness.mjs');
    session.requireClean();
    expect(awaitedEntry).toBe(realCanonical(fileURLToPath(new URL('domainFunctionsHarness.mjs', directory))));
    expect(typeof original.startDomainFunctionsHost).toBe('function');
    expect(session.markers).toHaveLength(3);
    for (const entry of entries) {
      const markers = session.markers.filter(marker => marker.declaredMockKey === entry.key);
      expect(markers).toHaveLength(1);
      expect(markers[0]).toEqual({ declaredMockKey: entry.key, marker: entry.marker, declaredDoMockCaller: realCanonical(fileURLToPath(import.meta.url)), awaitedCanonicalEntry: awaitedEntry, canonicalResolutionTarget: session.canonical(entry.key), session: session.token });
    }
    let rejection: unknown;
    try {
      await original.startDomainFunctionsHost({
        projectDir: missing,
        distDir: '/__wyreup_lifecycle_qualification_missing__/dist',
        evidenceDir: '/__wyreup_lifecycle_qualification_missing__/evidence',
        expectedCoreDistPins: [{ path: 'packages/core/dist/browser/index.js', bytes: 1, sha256: '0'.repeat(64) }],
        deadlineAt: Date.now() + 600000,
      });
    } catch (error) { rejection = error; }
    session.requireClean();
    expect(rejection).toBe(session.E_ENTRY);
    expect(session.calls).toEqual([{ target: 'helperFs.promises', member: 'realpath' }]);
    expect(session.violations).toEqual([]);
    console.info(JSON.stringify({ qualification: 'Q1', revision: qualification.revision.revisionId, rowSha256: qualification.rowSha256, expectationSha256: qualification.dataSha256, markers: session.markers.map(({ session: _session, ...marker }) => marker) }));
  } finally {
    resetMocks();
    vi.useRealTimers();
  }
}, 15000);

import { createHelperBehaviorFixture, flushHelperNativeTurn, helperClockStart, helperErrorLeaves, readHelperDiagnosticOracle, type HelperMode } from './fixtures/domainLifecyclePrimitives';
import type * as DomainHarness from './domainFunctionsHarness.mjs';

function observe<T>(operation: Promise<T>) {
  let state: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  let value: T | undefined;
  let error: unknown;
  const done = operation.then(result => { state = 'fulfilled'; value = result; }, reason => { state = 'rejected'; error = reason; });
  return { done, get state() { return state; }, get value() { return value; }, get error() { return error; } };
}

async function loadHelperControl(mode: HelperMode) {
  vi.useRealTimers(); resetMocks();
  const qualification = captureQualification(directory);
  const oracle = readHelperDiagnosticOracle(directory);
  const session = createQualificationSession(qualification, {});
  const fixture = createHelperBehaviorFixture(qualification, mode);
  let staticFactoriesOpen = true;
  for (const entry of qualification.revision.helperBoundaryFactories) vi.doMock(entry.key, () => {
    if (!staticFactoriesOpen) {
      session.violations.push({ target: 'unexpected-postqualification-factory', member: entry.key });
      throw new Error('A factory fired after the declared static import qualification sequence.');
    }
    session.factory(entry, import.meta.url);
    return fixture.factory(entry);
  });
  const declaredEntry = session.beginImport('domainFunctionsHarness.mjs');
  let original: typeof DomainHarness;
  try { original = await import('./domainFunctionsHarness.mjs'); }
  catch (error) { resetMocks(); vi.useRealTimers(); throw error; }
  staticFactoriesOpen = false;
  session.requireClean(); fixture.requireClean();
  expect(typeof original.startDomainFunctionsHost).toBe('function');
  expect(session.markers).toHaveLength(3);
  for (const entry of qualification.revision.helperBoundaryFactories) {
    expect(session.markers.filter(marker => marker.declaredMockKey === entry.key)).toEqual([{
      declaredMockKey: entry.key, marker: entry.marker,
      declaredDoMockCaller: realCanonical(fileURLToPath(import.meta.url)),
      awaitedCanonicalEntry: declaredEntry, canonicalResolutionTarget: session.canonical(entry.key), session: session.token,
    }]);
  }
  expect(fixture.calls).toEqual([]);
  // Static import qualification is finished on real timers before this clock is installed.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(helperClockStart);
  const caller = new AbortController();
  const operation = observe(original.startDomainFunctionsHost({
    projectDir: fixture.project, distDir: fixture.dist, evidenceDir: fixture.evidence,
    expectedCoreDistPins: fixture.corePins, callerAbortSignal: caller.signal,
    deadlineAt: helperClockStart + 600000,
  }));
  return { qualification, oracle, fixture, session, caller, operation };
}
type HelperControl = Awaited<ReturnType<typeof loadHelperControl>>;
type Endpoint = ReturnType<HelperControl['fixture']['freezeEndpoint']>;

function qualified(control: HelperControl) { control.session.requireClean(); control.fixture.requireClean(); }
function freeze(control: HelperControl, outcome: { readonly state: 'pending' | 'fulfilled' | 'rejected'; readonly error: unknown } = control.operation) {
  qualified(control);
  const endpoint = control.fixture.freezeEndpoint();
  console.info(JSON.stringify({
    kind: 'controlled-unit-endpoint', mode: control.fixture.mode, revision: control.qualification.revision.revisionId,
    sourcePins: control.qualification.sources, expectationSha256: control.qualification.dataSha256,
    revisionRowSha256: control.qualification.rowSha256, diagnosticOracleSha256: control.oracle.sha256,
    publicState: outcome.state,
    publicErrors: (outcome.state === 'rejected' ? helperErrorLeaves(outcome.error) : []).map(error => ({
      nativeError: error instanceof Error, message: error instanceof Error ? error.message : String(error),
      injectedIdentity: error === control.fixture.E_START ? 'E_START' : error === control.fixture.E_WRITE ? 'E_WRITE' : error === control.fixture.E_GUARD ? 'E_GUARD' : error === control.fixture.E_STREAM ? 'E_STREAM' : error === control.fixture.E_DWRITE ? 'E_DWRITE' : null,
    })), endpoint,
    qualification: 'factory interception only; no SDK, native child, HTTP, browser or catalogue acceptance',
  }));
  return endpoint;
}
function errorConstructorAndMessage(error: unknown, message: string) {
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error('Expected native helper Error.');
  expect(error.constructor).toBe(Error); expect(error.message).toBe(message);
}
async function finishControl(control: HelperControl, rejectedAtEndpoint: boolean) {
  try {
    await control.fixture.releaseAlreadyCreated();
    await control.operation.done;
    qualified(control);
    if (rejectedAtEndpoint) expect(control.fixture.postEndpointWork()).toEqual([]);
  } finally { resetMocks(); vi.useRealTimers(); }
}
async function reachCompiler(control: HelperControl) {
  await Promise.race([control.fixture.compilerReady, control.operation.done.then(() => {
    qualified(control);
    throw new Error('Public helper settled before its controlled compiler boundary.', { cause: control.operation.error });
  })]);
  qualified(control);
  const first = control.fixture.calls.find(call => call.operation === 'spawn');
  expect(first?.args[0]).toBe(process.execPath);
  expect(control.fixture.children[0]?.pid).toBe(7001);
  const ownedCall = control.fixture.calls.find(call => call.operation === 'fs.mkdtemp');
  expect(ownedCall?.args).toEqual([control.fixture.evidence + '/domain-functions-']);
  expect(ownedCall?.result).toBe(control.fixture.owned);
}
function postFailureReads(endpoint: Endpoint) {
  return endpoint.calls.filter(call => call.operation === 'post-failure-original-read');
}
function exactDiagnosticProjection(control: HelperControl, endpoint: Endpoint, variant: 'H4' | 'H5', failed: boolean) {
  // This check follows endpoint observation, never substitutes for running the helper.
  expect(control.qualification.revision.diagnosticRecords.terminal, 'BEFORE null is honestly an absent prospective terminal protocol.').not.toBeNull();
  const terminal = control.qualification.revision.diagnosticRecords.terminal;
  if (terminal === null) throw new Error('Prospective terminal protocol absent in selected root-owned revision.');
  const terminalPath = control.fixture.owned + '/' + terminal;
  const attempts = endpoint.writes.filter(write => write.sequence > (endpoint.failureSequence ?? Number.POSITIVE_INFINITY));
  expect(attempts.map(write => write.file)).toEqual([control.fixture.failedLaunch, terminalPath]);
  expect(attempts.map(write => write.succeeded)).toEqual([!failed, true]);
  if (failed) expect(attempts[0]?.error).toBe(control.fixture.E_DWRITE);
  const root = control.oracle.value;
  const common = root.common;
  const variants = root.variants;
  if (!common || typeof common !== 'object' || Array.isArray(common) || !variants || typeof variants !== 'object' || Array.isArray(variants) || !(variant in variants)) throw new Error('Invalid root diagnostic oracle.');
  const expectedVariant: unknown = variant === 'H4' && 'H4' in variants ? variants.H4 : variant === 'H5' && 'H5' in variants ? variants.H5 : undefined;
  if (!expectedVariant || typeof expectedVariant !== 'object' || Array.isArray(expectedVariant)) throw new Error('Invalid variant oracle.');
  const expected = { ...common, ownedRoot: control.fixture.owned, ...expectedVariant };
  for (const attempt of attempts) {
    expect(JSON.parse(attempt.text) as unknown).toEqual(attempt.payload);
    if (!attempt.payload || typeof attempt.payload !== 'object' || Array.isArray(attempt.payload) || !('lifecycle' in attempt.payload)) throw new Error('Actual native diagnostic lacks lifecycle projection.');
    expect(attempt.payload.lifecycle).toEqual(expected);
    // The entire native payload remains in endpoint.writes, including outer fields.
  }
  expect(postFailureReads(endpoint)).toEqual([]);
  expect(endpoint.calls.filter(call => call.operation === 'fs.copyFile' && call.sequence > (endpoint.failureSequence ?? Number.POSITIVE_INFINITY))).toEqual([]);
  expect(endpoint.calls.filter(call => call.operation === 'fork')).toEqual([]);
}

it.each(['H1', 'H2', 'P2'] as const)('%s preserves exact preparation-startup references at the captured first source-copy boundary', async mode => {
  const control = await loadHelperControl(mode);
  let rejected = false;
  try {
    await control.operation.done;
    const endpoint = freeze(control); rejected = control.operation.state === 'rejected';
    expect(control.operation.state).toBe('rejected');
    const copies = endpoint.calls.filter(call => call.operation === 'fs.copyFile');
    expect(copies).toHaveLength(1);
    expect(copies[0]?.args).toEqual([control.fixture.project + '/functions/api/domain-age.ts', control.fixture.owned + '/functions/api/domain-age.ts']);
    expect(copies[0]?.outcome).toBe('rejected');
    const firstCopy = copies[0]?.sequence ?? -1;
    expect(endpoint.calls.some(call => call.operation === 'fs.readdir' && call.args[0] === control.fixture.project + '/packages/core/dist' && call.sequence < firstCopy)).toBe(true);
    expect(endpoint.calls.some(call => call.operation === 'fs.readdir' && call.args[0] === control.fixture.dist && call.sequence < firstCopy)).toBe(true);
    expect(endpoint.calls.filter(call => call.operation === 'fs.readFile' && typeof call.args[0] === 'string' && call.args[0].startsWith(control.fixture.project + '/') && !call.args[0].includes('/dist/') && call.sequence < firstCopy)).toHaveLength(14);
    const expected = mode === 'H1' ? [control.fixture.E_START, control.fixture.E_WRITE] : mode === 'H2' ? [control.fixture.E_START, control.fixture.E_GUARD] : [control.fixture.E_START];
    expect(helperErrorLeaves(control.operation.error)).toEqual(expected);
    for (const error of expected) expect(helperErrorLeaves(control.operation.error).filter(leaf => leaf === error)).toHaveLength(1);
    if (mode === 'P2') expect(control.operation.error).toBe(control.fixture.E_START);
    expect(endpoint.calls.filter(call => call.operation === 'spawn' || call.operation === 'fork')).toEqual([]);
  } finally { await finishControl(control, rejected); }
}, 15000);

it('H3 retains the operation deadline and the same native final callback/error-event E_STREAM once', async () => {
  const control = await loadHelperControl('H3'); let rejected = false;
  try {
    await reachCompiler(control); control.fixture.markDeadlineFailure();
    await vi.advanceTimersByTimeAsync(180000);
    await control.fixture.writerEnd;
    control.fixture.releaseWrite(); await flushHelperNativeTurn();
    await vi.advanceTimersByTimeAsync(1);
    control.fixture.releaseFinal(control.fixture.E_STREAM);
    await control.operation.done;
    await flushHelperNativeTurn();
    const endpoint = freeze(control); rejected = control.operation.state === 'rejected';
    expect(control.operation.state).toBe('rejected');
    const leaves = helperErrorLeaves(control.operation.error);
    expect(leaves).toHaveLength(2);
    errorConstructorAndMessage(leaves[0], 'Owned functions-build exceeded its declared deadline.');
    expect(leaves[1]).toBe(control.fixture.E_STREAM);
    expect(leaves.filter(error => error === control.fixture.E_STREAM)).toHaveLength(1);
    expect(endpoint.child).toMatchObject({ closed: true, exitCode: 0, signalCode: null, kills: ['SIGTERM'] });
    expect(endpoint.writer?.endAt).toBe(helperClockStart + 180000);
    expect(endpoint.writer?.errors).toEqual([control.fixture.E_STREAM]);
    expect(endpoint.writer?.errors[0]).toBe(control.fixture.E_STREAM);
    const endCallbacks = endpoint.calls.filter(call => call.operation === 'native-writer-end-callback');
    expect(endCallbacks).toHaveLength(1);
    expect(endCallbacks[0]?.args).toEqual([control.fixture.owned + '/functions-build.log', control.fixture.E_STREAM]);
    expect(endCallbacks[0]?.args[1]).toBe(control.fixture.E_STREAM);
  } finally { await finishControl(control, rejected); }
}, 15000);

it.each(['H4', 'H4-write'] as const)('%s reports the fixed native finalization deadline and both actual incomplete write attempts', async mode => {
  const control = await loadHelperControl(mode); let rejected = false;
  try {
    await reachCompiler(control); control.fixture.markDeadlineFailure();
    await vi.advanceTimersByTimeAsync(180000); await control.fixture.writerEnd;
    control.fixture.releaseWrite(); await flushHelperNativeTurn();
    await vi.advanceTimersByTimeAsync(4999); qualified(control);
    expect(control.operation.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1); await flushHelperNativeTurn();
    const endpoint = freeze(control); rejected = control.operation.state === 'rejected';
    expect(control.operation.state).toBe('rejected');
    const leaves = helperErrorLeaves(control.operation.error);
    expect(leaves).toHaveLength(mode === 'H4-write' ? 3 : 2);
    errorConstructorAndMessage(leaves[0], 'Owned functions-build exceeded its declared deadline.');
    errorConstructorAndMessage(leaves[1], 'Owned functions-build log finalization exceeded 5000ms; retain its stream and evidence.');
    if (mode === 'H4-write') expect(leaves[2]).toBe(control.fixture.E_DWRITE);
    expect(endpoint.child).toMatchObject({ pid: 7001, closed: true, exitCode: 0, signalCode: null, kills: ['SIGTERM'] });
    expect(endpoint.writer).toMatchObject({ endRequested: true, finished: false, endAt: helperClockStart + 180000 });
    exactDiagnosticProjection(control, endpoint, 'H4', mode === 'H4-write');
  } finally { await finishControl(control, rejected); }
}, 15000);

it.each(['H5', 'H5-write'] as const)('%s preserves the operation/termination errors and never certifies live-child logs', async mode => {
  const control = await loadHelperControl(mode); let rejected = false;
  try {
    await reachCompiler(control); control.fixture.markDeadlineFailure();
    await vi.advanceTimersByTimeAsync(185000); await flushHelperNativeTurn();
    const endpoint = freeze(control); rejected = control.operation.state === 'rejected';
    expect(control.operation.state).toBe('rejected');
    const leaves = helperErrorLeaves(control.operation.error);
    expect(leaves).toHaveLength(mode === 'H5-write' ? 3 : 2);
    errorConstructorAndMessage(leaves[0], 'Owned functions-build exceeded its declared deadline.');
    errorConstructorAndMessage(leaves[1], 'Owned child 7001 did not exit after SIGTERM; retain its PID and evidence. No SIGKILL was sent.');
    if (mode === 'H5-write') expect(leaves[2]).toBe(control.fixture.E_DWRITE);
    expect(endpoint.child).toMatchObject({ pid: 7001, closed: false, exitCode: null, signalCode: null, kills: ['SIGTERM'] });
    expect(endpoint.writer).toMatchObject({ endRequested: true, finished: true, endAt: helperClockStart + 185000, pipes: 2, unpipes: 2, errors: [] });
    const unpipes = endpoint.calls.filter(call => call.operation === 'native-writer-unpipe');
    const end = endpoint.calls.find(call => call.operation === 'native-writer-end');
    expect(unpipes).toHaveLength(2); expect(unpipes.every(call => call.sequence < (end?.sequence ?? -1))).toBe(true);
    exactDiagnosticProjection(control, endpoint, 'H5', mode === 'H5-write');
  } finally {
    await finishControl(control, rejected);
    expect(control.fixture.children[0]?.kills).toEqual(['SIGTERM']);
    expect(control.fixture.firstWriter()?.errors).toEqual([]);
  }
}, 15000);

it.each(['H6', 'H7'] as const)('%s retains observed nonzero host close before guard/persistence errors', async mode => {
  const control = await loadHelperControl(mode); let rejected = false;
  try {
    await control.operation.done; qualified(control);
    expect(control.operation.state).toBe('fulfilled');
    const host = control.operation.value;
    if (!host) throw new Error('Controlled host handle absent.');
    const closing = observe(host.close()); await closing.done;
    const endpoint = freeze(control, closing); rejected = closing.state === 'rejected';
    expect(closing.state).toBe('rejected');
    const leaves = helperErrorLeaves(closing.error);
    expect(leaves).toHaveLength(2);
    errorConstructorAndMessage(leaves[0], 'Owned Functions host cleanup exited unsuccessfully: {"code":1,"signal":null}');
    expect(leaves[1]).toBe(mode === 'H6' ? control.fixture.E_GUARD : control.fixture.E_WRITE);
    expect(control.fixture.children.at(-1)?.closes).toBe(1);
    expect(control.fixture.children.at(-1)?.exitCode).toBe(1);
    expect(control.fixture.children.at(-1)?.kills).toEqual([]);
    expect(endpoint.calls.filter(call => call.operation === 'fork')).toHaveLength(1);
    const terminalWrites = endpoint.writes.filter(write => write.file === host.manifest && write.sequence > (endpoint.failureSequence ?? Number.POSITIVE_INFINITY));
    expect(terminalWrites).toHaveLength(1);
    expect(terminalWrites[0]?.succeeded).toBe(mode === 'H6');
    if (mode === 'H7') expect(terminalWrites[0]?.error).toBe(control.fixture.E_WRITE);
    expect(endpoint.calls.filter(call => call.operation === 'fs.copyFile' && call.sequence > (endpoint.failureSequence ?? Number.POSITIVE_INFINITY))).toEqual([]);
  } finally { await finishControl(control, rejected); }
}, 15000);

it('P1 coalesces actual close/abort work and settles already-created IPC without wrapper Promise identity assumptions', async () => {
  const control = await loadHelperControl('P1');
  try {
    await control.operation.done; qualified(control); expect(control.operation.state).toBe('fulfilled');
    const host = control.operation.value; if (!host) throw new Error('Controlled host absent.');
    const ipc = observe(host.inspect());
    const first = observe(host.close()); control.caller.abort(); const second = observe(host.close());
    await Promise.all([first.done, second.done, ipc.done]);
    const endpoint = freeze(control);
    expect(first.state).toBe('fulfilled'); expect(second.state).toBe('fulfilled');
    expect(ipc.state).toBe('rejected'); errorConstructorAndMessage(ipc.error, 'Owned Functions host was closed.');
    const closes = endpoint.calls.filter(call => call.operation === 'child-send' && call.args[1] && typeof call.args[1] === 'object' && 'command' in call.args[1] && call.args[1].command === 'close');
    expect(closes).toHaveLength(1); expect(control.fixture.children.at(-1)?.closes).toBe(1);
    expect(control.fixture.children.at(-1)?.kills).toEqual([]);
  } finally { await finishControl(control, false); }
}, 15000);

it('P3 observes controlled normal readiness and close with real completed log streams and no invented errors', async () => {
  const control = await loadHelperControl('P3');
  try {
    await control.operation.done; qualified(control); expect(control.operation.state).toBe('fulfilled');
    const host = control.operation.value; if (!host) throw new Error('Controlled host absent.');
    expect(host.url).toBe('http://127.0.0.1:12345');
    expect(host.manifest).toBe(control.fixture.owned + '/manifest.json');
    const closing = observe(host.close()); await closing.done;
    const endpoint = freeze(control);
    expect(closing.state).toBe('fulfilled'); expect(closing.error).toBeUndefined();
    expect(endpoint.calls.filter(call => call.operation === 'spawn')).toHaveLength(2);
    expect(endpoint.calls.filter(call => call.operation === 'fork')).toHaveLength(1);
    expect(control.fixture.children.every(child => child.closes === 1 && child.exitCode === 0 && child.signalCode === null && child.kills.length === 0)).toBe(true);
    expect(endpoint.writer).toMatchObject({ endRequested: true, finished: true, errors: [] });
  } finally { await finishControl(control, false); }
}, 15000);
