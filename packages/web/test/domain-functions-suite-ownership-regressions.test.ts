import { it, expect, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureQualification, createQualificationSession } from './fixtures/domainLifecyclePrimitives';

const realCanonical = realpathSync;
const directory = new URL('.', import.meta.url);
const controlledKeys = ['node:fs', 'node:child_process', 'node:module', 'vitest', 'playwright', './productionBrowserHarness', './domainFunctionsHarness.mjs', 'node:fs/promises', 'node:os'];

function resetMocks() {
  for (const key of controlledKeys) vi.doUnmock(key);
  vi.resetModules();
}

function prepareSession() {
  const qualification = captureQualification(directory);
  const canonicalBare = {
    vitest: realCanonical(fileURLToPath(import.meta.resolve('vitest'))),
    playwright: realCanonical(fileURLToPath(import.meta.resolve('playwright'))),
  };
  if (!canonicalBare.vitest.endsWith('/vitest/dist/index.js') || !canonicalBare.playwright.endsWith('/playwright/index.mjs')) throw new Error('Unexpected physical ESM mock target; no registration fallback is authorized.');
  const session = createQualificationSession(qualification, canonicalBare);
  const entries = qualification.revision.suiteBoundaryFactories;
  expect(entries.map(entry => entry.key).sort()).toEqual(['./domainFunctionsHarness.mjs', './productionBrowserHarness', 'node:fs/promises', 'node:os', 'playwright', 'vitest']);
  const probe = qualification.revision.probeBoundaryFactory;
  expect(probe.key).toBe('vitest');
  expect(entries.find(entry => entry.key === probe.key)).toEqual(probe);
  for (const entry of entries) vi.doMock(entry.key, () => session.factory(entry, import.meta.url));
  return { qualification, session, entries, probe };
}

async function qualifyProbe(prepared: ReturnType<typeof prepareSession>) {
  const { qualification, session, probe } = prepared;
  const awaitedEntry = session.beginImport('domainFunctionsRegistrationProbe.ts');
  const originalProbe = await import('./domainFunctionsRegistrationProbe');
  session.requireClean();
  expect(awaitedEntry).toBe(realCanonical(fileURLToPath(new URL('domainFunctionsRegistrationProbe.ts', directory))));
  expect(Object.keys(originalProbe).sort()).toEqual([...qualification.revision.expectedProbeExports].sort());
  expect(originalProbe.beforeAll).toBe(session.beforeAll);
  expect(originalProbe.afterAll).toBe(session.afterAll);
  expect(originalProbe.it).toBe(session.it);
  expect(session.markers).toEqual([{ declaredMockKey: probe.key, marker: probe.marker, declaredDoMockCaller: realCanonical(fileURLToPath(import.meta.url)), awaitedCanonicalEntry: awaitedEntry, canonicalResolutionTarget: session.canonical(probe.key), session: session.token }]);
  expect(session.registrations).toEqual([]);
  expect(session.calls).toEqual([]);
  expect(session.violations).toEqual([]);
}

it('Q2 qualifies the original-directory registration pre-probe without importing the original suite', async () => {
  vi.useRealTimers();
  resetMocks();
  try {
    const prepared = prepareSession();
    await qualifyProbe(prepared);
    console.info(JSON.stringify({ qualification: 'Q2', revision: prepared.qualification.revision.revisionId, rowSha256: prepared.qualification.rowSha256, expectationSha256: prepared.qualification.dataSha256, registrations: prepared.session.registrations.length }));
  } finally {
    resetMocks();
    vi.useRealTimers();
  }
}, 15000);

it('Q3 imports the whole original suite only after the same-session probe and captures exact source-keyed registrations', async () => {
  vi.useRealTimers();
  resetMocks();
  try {
    const prepared = prepareSession();
    await qualifyProbe(prepared);
    const { qualification, session, entries, probe } = prepared;
    const awaitedEntry = session.beginImport('domain-functions-integration.test.ts');
    await import('./domain-functions-integration.test');
    session.requireClean();
    expect(awaitedEntry).toBe(qualification.sources.find(source => source.path === 'domain-functions-integration.test.ts')?.physical);
    expect(session.markers).toHaveLength(entries.length);
    for (const entry of entries) {
      const markers = session.markers.filter(marker => marker.declaredMockKey === entry.key);
      expect(markers).toHaveLength(1);
      const expectedAwaitedEntry = entry.key === probe.key
        ? realCanonical(fileURLToPath(new URL('domainFunctionsRegistrationProbe.ts', directory)))
        : awaitedEntry;
      expect(markers[0]).toEqual({ declaredMockKey: entry.key, marker: entry.marker, declaredDoMockCaller: realCanonical(fileURLToPath(import.meta.url)), awaitedCanonicalEntry: expectedAwaitedEntry, canonicalResolutionTarget: session.canonical(entry.key), session: session.token });
    }
    const before = session.registrations.filter(registration => registration.kind === 'beforeAll');
    const after = session.registrations.filter(registration => registration.kind === 'afterAll');
    const tests = session.registrations.filter(registration => registration.kind === 'it');
    expect(before).toHaveLength(qualification.revision.registrations.beforeAll.count);
    expect(after).toHaveLength(qualification.revision.registrations.afterAll.count);
    expect(before.map(registration => registration.timeout)).toEqual([qualification.revision.registrations.beforeAll.timeout]);
    expect(after.map(registration => registration.timeout)).toEqual([qualification.revision.registrations.afterAll.timeout]);
    expect(tests.map(registration => ({ name: registration.name, timeout: registration.timeout }))).toEqual(qualification.revision.registrations.tests);
    expect(session.registrations.every(registration => typeof registration.callback === 'function')).toBe(true);
    expect(session.calls).toEqual([]);
    expect(session.violations).toEqual([]);
    console.info(JSON.stringify({ qualification: 'Q3', revision: qualification.revision.revisionId, rowSha256: qualification.rowSha256, expectationSha256: qualification.dataSha256, registrations: session.registrations.map(({ callback: _callback, ...registration }) => registration), markers: session.markers.map(({ session: _session, ...marker }) => marker) }));
  } finally {
    resetMocks();
    vi.useRealTimers();
  }
}, 15000);
