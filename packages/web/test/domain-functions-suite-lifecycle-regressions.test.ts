import { it, expect, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureQualification, createQualificationSession, type Marker, type Registration } from './fixtures/domainLifecyclePrimitives';
import { createSuiteBehaviorFixture, drainSuiteMicrotasks, readSuiteContract, suiteEpoch, type SuiteMode } from './fixtures/domainSuiteLifecyclePrimitives';

const directory = new URL('.', import.meta.url);
const canonical = realpathSync;
const controlledKeys = ['vitest', 'playwright', './productionBrowserHarness', './domainFunctionsHarness.mjs', 'node:fs/promises', 'node:os', 'node:http'];
function resetMocks() { for (const key of controlledKeys) vi.doUnmock(key); vi.resetModules(); }
function observe(operation: unknown, name: string) {
  let state: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  let reason: unknown;
  const done = Promise.resolve(operation).then(() => { state = 'fulfilled'; }, error => { state = 'rejected'; reason = error; });
  return { name, done, get state() { return state; }, get reason() { return reason; } };
}
type Observation = ReturnType<typeof observe>;
function invoke(registration: Registration): unknown {
  if (typeof registration.callback !== 'function') throw new Error('Actual registered S callback is not callable.');
  return Reflect.apply(registration.callback, undefined, []);
}

async function load(mode: SuiteMode) {
  vi.useRealTimers(); resetMocks();
  const qualification = captureQualification(directory);
  const contract = readSuiteContract(directory, qualification);
  const canonicalBare = { vitest: canonical(fileURLToPath(import.meta.resolve('vitest'))), playwright: canonical(fileURLToPath(import.meta.resolve('playwright'))) };
  if (!canonicalBare.vitest.endsWith('/vitest/dist/index.js') || !canonicalBare.playwright.endsWith('/playwright/index.mjs')) throw new Error('Unsupported physical S mock target.');
  const session = createQualificationSession(qualification, canonicalBare);
  const fixture = createSuiteBehaviorFixture(qualification, session, contract, mode);
  const entries = qualification.revision.suiteBoundaryFactories;
  expect(entries.map(entry => entry.key).sort()).toEqual(['./domainFunctionsHarness.mjs', './productionBrowserHarness', 'node:fs/promises', 'node:os', 'playwright', 'vitest']);
  const probeEntry = qualification.revision.probeBoundaryFactory;
  expect(probeEntry).toEqual(entries.find(entry => entry.key === 'vitest'));
  const localMarkers: Marker[] = [];
  let factoriesOpen = true, suiteEntry = '';
  const extraViolations: string[] = [];
  const refuseFactory = (key: string): never => { extraViolations.push(key); throw new Error(`S static factory refused: ${key}`); };
  for (const entry of entries) vi.doMock(entry.key, () => {
    if (!factoriesOpen) return refuseFactory(entry.key);
    session.factory(entry, import.meta.url);
    return fixture.factory(entry);
  });
  // The seventh boundary is local; shared six-factory session/data remain unchanged.
  vi.doMock('node:http', () => {
    if (!factoriesOpen || !suiteEntry) return refuseFactory('node:http');
    localMarkers.push({ declaredMockKey: 'node:http', marker: 'suiteHttp', declaredDoMockCaller: canonical(fileURLToPath(import.meta.url)),
      awaitedCanonicalEntry: suiteEntry, canonicalResolutionTarget: session.canonical('node:http'), session: session.token });
    return fixture.httpNamespace;
  });
  const probeCanonical = session.beginImport('domainFunctionsRegistrationProbe.ts');
  const probe = await import('./domainFunctionsRegistrationProbe');
  session.requireClean(); fixture.requireClean();
  expect(Object.keys(probe).sort()).toEqual([...qualification.revision.expectedProbeExports].sort());
  expect(probe.beforeAll).toBe(session.beforeAll); expect(probe.afterAll).toBe(session.afterAll); expect(probe.it).toBe(session.it);
  expect(session.markers).toEqual([{ declaredMockKey: probeEntry.key, marker: probeEntry.marker, declaredDoMockCaller: canonical(fileURLToPath(import.meta.url)),
    awaitedCanonicalEntry: probeCanonical, canonicalResolutionTarget: session.canonical(probeEntry.key), session: session.token }]);
  expect(session.registrations).toEqual([]); expect(session.calls).toEqual([]); expect(localMarkers).toEqual([]);
  suiteEntry = session.beginImport('domain-functions-integration.test.ts');
  await import('./domain-functions-integration.test');
  factoriesOpen = false;
  session.requireClean(); fixture.requireClean(); expect(extraViolations).toEqual([]);
  expect(suiteEntry).toBe(qualification.sources.find(source => source.path === 'domain-functions-integration.test.ts')?.physical);
  expect(session.markers).toHaveLength(6);
  for (const entry of entries) expect(session.markers.filter(marker => marker.declaredMockKey === entry.key)).toEqual([{
    declaredMockKey: entry.key, marker: entry.marker, declaredDoMockCaller: canonical(fileURLToPath(import.meta.url)),
    awaitedCanonicalEntry: entry.key === probeEntry.key ? probeCanonical : suiteEntry, canonicalResolutionTarget: session.canonical(entry.key), session: session.token,
  }]);
  expect(localMarkers).toEqual([{ declaredMockKey: 'node:http', marker: 'suiteHttp', declaredDoMockCaller: canonical(fileURLToPath(import.meta.url)),
    awaitedCanonicalEntry: suiteEntry, canonicalResolutionTarget: session.canonical('node:http'), session: session.token }]);
  const before = session.registrations.filter(item => item.kind === 'beforeAll');
  const after = session.registrations.filter(item => item.kind === 'afterAll');
  const tests = session.registrations.filter(item => item.kind === 'it');
  expect(before.map(item => item.timeout)).toEqual([qualification.revision.registrations.beforeAll.timeout]);
  expect(after.map(item => item.timeout)).toEqual([qualification.revision.registrations.afterAll.timeout]);
  expect(tests.map(({ name, timeout }) => ({ name, timeout }))).toEqual(qualification.revision.registrations.tests);
  expect(before).toHaveLength(1); expect(after).toHaveLength(1); expect(tests).toHaveLength(8);
  const fault = tests.filter(item => item.name === contract.selectedFaultName);
  expect(fault).toHaveLength(1);
  const setup = before[0], teardown = after[0], missingSecret = fault[0];
  if (!setup || !teardown || !missingSecret) throw new Error('Exact selected original S callbacks absent.');
  expect(fixture.calls).toEqual([]); expect(session.calls).toEqual([]);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(suiteEpoch);
  return { qualification, contract, session, fixture, setup, teardown, missingSecret, localMarkers, extraViolations };
}
type Control = Awaited<ReturnType<typeof load>>;
function qualified(control: Control) { control.session.requireClean(); control.fixture.requireClean(); expect(control.extraViolations).toEqual([]); }
async function reach(control: Control, predicate: () => boolean, label: string) {
  const drained = await drainSuiteMicrotasks(control.contract.turns, predicate);
  qualified(control);
  if (!drained.reached) throw new Error(`S schedule did not reach ${label} within its finite microtask budget; no product endpoint claimed.`);
  return drained;
}
function summary(observation: Observation) {
  return { name: observation.name, state: observation.state, error: observation.state === 'rejected' ? {
    name: observation.reason instanceof Error ? observation.reason.name : 'NonError', message: observation.reason instanceof Error ? observation.reason.message : String(observation.reason),
  } : null };
}
function endpoint(control: Control, name: string, operations: Observation[], scheduling: unknown) {
  qualified(control);
  return { name, scheduling, fixture: control.fixture.freeze(), operations: operations.map(summary),
    refusalIdentities: operations.map(operation => ({ name: operation.name, ui: operation.reason === control.fixture.E_UI_AFTER_CLOSE, acquisition: operation.reason === control.fixture.E_POST_TEARDOWN_ACQUISITION })) };
}
type Endpoint = ReturnType<typeof endpoint>;

async function exercise(control: Control, operations: Observation[]) {
  const snapshots: Endpoint[] = [];
  const row = control.contract.cases.find(item => item.id === control.fixture.mode);
  if (!row) throw new Error('Exact matched S case schedule absent.');
  const lateOwner = row.lateClose;
  const setup = observe(invoke(control.setup), 'setup'); operations.push(setup);
  await reach(control, () => control.fixture.requested('fixture') === 1, 'fixture acquisition'); control.fixture.releaseAcquisition('fixture');
  await reach(control, () => control.fixture.requested('browser') === 1, 'browser acquisition');
  if (control.fixture.mode !== 'S2') {
    control.fixture.releaseAcquisition('browser');
    await reach(control, () => control.fixture.requested('mainHost') === 1, 'main-host acquisition');
  }
  if (control.fixture.mode === 'S3') {
    control.fixture.releaseAcquisition('mainHost');
    await reach(control, () => setup.state !== 'pending', 'completed original setup');
    expect(setup.state).toBe('fulfilled');
    operations.push(observe(invoke(control.missingSecret), 'missing-secret'));
    await reach(control, () => control.fixture.requested('faultHost') === 1, 'missing-secret acquisition');
  }
  control.fixture.beginTeardown();
  const teardown = observe(invoke(control.teardown), 'teardown'); operations.push(teardown);
  // Resolve preceding assigned owners while the actual late acquisition stays held.
  for (const owner of row.releasePrecedingCloses) control.fixture.releaseClose(owner);
  const firstDrain = await drainSuiteMicrotasks(control.contract.turns);
  snapshots.push(endpoint(control, 'pending-acquisition-after-preceding-barrier', operations, firstDrain));
  control.fixture.phase('late-acquisition');
  control.fixture.releaseAcquisition(row.heldAcquisition);
  const lateDrain = await drainSuiteMicrotasks(control.contract.turns, () => control.fixture.closed(lateOwner) >= 1);
  snapshots.push(endpoint(control, 'actual-late-close-held-or-missing', operations, lateDrain));
  let final: Endpoint | null = null;
  if (control.fixture.closed(lateOwner) === 1) {
    control.fixture.phase('dependency-close-settled'); control.fixture.releaseClose(lateOwner);
    const finalDrain = await drainSuiteMicrotasks(control.contract.turns, () => control.fixture.closed('fixture') >= 1);
    final = endpoint(control, 'dependencies-settled-before-fixture-close', operations, finalDrain);
    snapshots.push(final);
    control.fixture.releaseClose('fixture');
    const completionDrain = await drainSuiteMicrotasks(control.contract.turns, () => operations.every(operation => operation.state !== 'pending'));
    snapshots.push(endpoint(control, 'actual-fixture-close-and-callback-settlement', operations, completionDrain));
  }
  return { operations, snapshots, final, lateOwner };
}

for (const mode of ['S1', 'S2', 'S3'] as const) {
  it(`${mode} retains the original suite dependencies through exactly one actual late close, then closes its fixture once`, async () => {
    let control: Control | undefined;
    const observedOperations: Observation[] = [];
    let bodyFailed = false;
    let bodyError: unknown;
    try {
      control = await load(mode);
      const result = await exercise(control, observedOperations);
      qualified(control);
      console.info(JSON.stringify({ classification: 'QUALIFIED_ORIGINAL_SUITE_CALLBACK_CONTROL', mode,
        sourcePins: control.qualification.sources, qualificationRowSha256: control.qualification.rowSha256,
        historicalDataSha256: control.qualification.dataSha256, currentDataSha256: control.qualification.currentDataSha256,
        behaviorContractSha256: control.contract.sha256, behaviorRowSha256: control.contract.rowSha256,
        sharedMarkers: control.session.markers.map(({ session: _session, ...marker }) => marker),
        localMarkers: control.localMarkers.map(({ session: _session, ...marker }) => marker),
        snapshots: result.snapshots, missingLateCloseRetainedUntilFinally: result.final === null,
        limitations: 'Synthetic in-memory acquisition/close promises and microtask scheduling; not Vitest timeout, native SDK/browser/process or filesystem removal proof.' }));
      const first = result.snapshots[0], late = result.snapshots[1];
      if (!first || !late) throw new Error('Independent S endpoint missing.');
      expect.soft(first.fixture.closeCounts.fixture).toBe(0);
      expect.soft(first.fixture.acquisitions[result.lateOwner]).toBe('pending');
      expect.soft(late.fixture.closeCounts[result.lateOwner]).toBe(1);
      expect.soft(late.fixture.closes[result.lateOwner]).toBe('pending');
      expect.soft(late.fixture.closeCounts.fixture).toBe(0);
      expect.soft(result.final, 'Missing actual late-close request is a failure, never accepted retention.').not.toBeNull();
      if (result.final) {
        expect.soft(result.final.fixture.closes[result.lateOwner]).toBe('fulfilled');
        expect.soft(result.final.fixture.closeCounts.fixture).toBe(1);
        expect.soft(result.final.fixture.closeCounts.fixture).toBe(late.fixture.closeCounts.fixture + 1);
        const newFixtureCloses = result.final.fixture.calls.filter(call => call.sequence > late.fixture.calls.length
          && call.actor === 'suite' && call.target === 'fixture' && call.member === 'close');
        expect.soft(newFixtureCloses).toHaveLength(1);
        expect.soft(newFixtureCloses.map(call => call.phase)).toEqual(['dependency-close-settled']);
        expect.soft(result.final.fixture.closeCounts.browser).toBe(1);
        expect.soft(result.final.fixture.closes.browser).toBe('fulfilled');
        if (mode !== 'S2') {
          expect.soft(result.final.fixture.closeCounts.mainHost).toBe(1);
          expect.soft(result.final.fixture.closes.mainHost).toBe('fulfilled');
        }
        if (mode === 'S3') expect.soft(result.final.fixture.closeCounts.faultHost).toBe(1);
      }
      expect.soft(control.fixture.calls.filter(call => call.member === 'refused-post-teardown-acquisition')).toHaveLength(0);
      expect.soft(control.fixture.calls.filter(call => call.member === 'newContext' || call.member === 'createServer' || call.member === 'newPage')).toHaveLength(0);
      expect.soft(result.operations.every(operation => operation.state !== 'pending')).toBe(true);
    } catch (error) {
      bodyFailed = true;
      bodyError = error;
    }
    const cleanupErrors: unknown[] = [];
    try {
      if (control) {
        await control.fixture.releaseAlreadyCreated();
        const drained = await drainSuiteMicrotasks(control.contract.turns, () => observedOperations.every(operation => operation.state !== 'pending'));
        qualified(control);
        if (!drained.reached) throw new Error('Created S callback remains unsettled after bounded test-finally release.');
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      try { resetMocks(); } catch (error) { cleanupErrors.push(error); }
      try { vi.useRealTimers(); } catch (error) { cleanupErrors.push(error); }
    }
    if (bodyFailed && cleanupErrors.length) throw new AggregateError([bodyError, ...cleanupErrors], 'S callback and cleanup failed.');
    if (bodyFailed) throw bodyError;
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'S callback cleanup failed.');
  }, 15000);
}
