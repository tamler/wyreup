import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { createQualificationSession, FactoryIdentity, Qualification, Violation } from './domainLifecyclePrimitives';

export type SuiteMode = 'S1' | 'S2' | 'S3';
export type SuiteOwner = 'fixture' | 'browser' | 'mainHost' | 'faultHost';
interface SuiteCase { id: SuiteMode; heldAcquisition: SuiteOwner; releasePrecedingCloses: SuiteOwner[]; lateClose: SuiteOwner }
export const suiteEpoch = Date.UTC(2026, 9, 15);
export interface SuiteCall { sequence: number; at: number; phase: string; target: string; member: string; args: unknown[]; actor: 'suite' | 'test-finally' }
interface Deferred<T> { promise: Promise<T>; state: 'pending' | 'fulfilled'; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let settle: ((value: T) => void) | undefined;
  const result: Deferred<T> = { promise: new Promise<T>(resolve => { settle = resolve; }), state: 'pending', resolve(value) {
    if (!settle || result.state !== 'pending') throw new Error('Controlled deferred resolved twice.');
    result.state = 'fulfilled'; settle(value);
  } };
  return result;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('S contract requires an object.');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string { if (typeof value !== 'string' || !value) throw new Error('S contract requires text.'); return value; }
function members(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('S contract member list absent.');
  const result = value.map(text);
  if (result.length === 0 || new Set(result).size !== result.length) throw new Error('S contract members ambiguous.');
  return result;
}
function memberMap(value: unknown): Record<string, string[]> { return Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, members(item)])); }
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function pinTuple(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) throw new Error('S source tuple absent.');
  const pins = value.map(item => {
    const pin = object(item);
    if (typeof pin.bytes !== 'number' || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1) throw new Error('S source bytes malformed.');
    const sha256 = text(pin.sha256); if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('S source digest malformed.');
    return { path: text(pin.path), bytes: pin.bytes, sha256 };
  });
  if (new Set(pins.map(pin => pin.path)).size !== 4) throw new Error('S source names duplicated.');
  return JSON.stringify(pins.sort((a, b) => a.path.localeCompare(b.path)));
}

export function readSuiteContract(directory: URL, qualification: Qualification) {
  const bytes = readFileSync(new URL('fixtures/domainSuiteLifecycleExpectations.json', directory));
  const document = object(JSON.parse(bytes.toString('utf8')) as unknown);
  if (document.schemaVersion !== 1 || document.classification !== 'S_ONLY_SOURCE_KEYED_CALLBACK_BEHAVIOR' || !Array.isArray(document.revisions)) throw new Error('Unknown S contract schema.');
  const wanted = pinTuple(qualification.sources);
  const rows = document.revisions.map(object);
  const tuples = rows.map(row => pinTuple(row.sourcePins));
  if (new Set(tuples).size !== tuples.length) throw new Error('S complete-source contract ambiguous.');
  const matches = rows.filter((_row, index) => tuples[index] === wanted);
  if (matches.length !== 1 || !matches[0]) throw new Error('No exact S source contract; behavior refused.');
  const raw = matches[0];
  if (raw.qualificationRevisionId !== qualification.revision.revisionId || raw.historicalDataSha256 !== qualification.dataSha256 || raw.currentDataSha256 !== qualification.currentDataSha256) throw new Error('S qualification/data authority differs.');
  const primitive = object(raw.qualificationPrimitive);
  if (primitive.path !== 'fixtures/domainLifecyclePrimitives.ts') throw new Error('Unknown S qualification primitive path.');
  const primitiveBytes = readFileSync(new URL(primitive.path, directory));
  if (primitiveBytes.length !== primitive.bytes || hash(primitiveBytes) !== primitive.sha256) throw new Error('S qualification primitive drift.');
  if (raw.epochMs !== suiteEpoch || raw.microtaskTurns !== 128) throw new Error('Unknown S scheduling contract.');
  const extra = object(raw.extraFactory);
  if (extra.key !== 'node:http' || extra.marker !== 'suiteHttp' || JSON.stringify(members(extra.members)) !== '["createServer"]') throw new Error('Unknown extra S factory.');
  if (JSON.stringify(raw.factories) !== JSON.stringify(qualification.revision.suiteBoundaryFactories)
    || JSON.stringify(raw.registrations) !== JSON.stringify(qualification.revision.registrations)) throw new Error('S original registration/factory contract differs.');
  const exports = memberMap(raw.exports), objects = memberMap(raw.objects);
  if (JSON.stringify(exports) !== JSON.stringify(qualification.revision.controlledExportAllowLists)
    || JSON.stringify(objects) !== JSON.stringify(qualification.revision.controlledObjectMembers)) throw new Error('S finite member contract differs.');
  const paths = object(raw.paths);
  const tmp = text(paths.tmp), evidence = text(paths.evidence), dist = text(paths.dist), manifest = text(paths.manifest);
  if (!evidence.startsWith(path.join(tmp, 'wyreup-domain-browser-')) || !path.isAbsolute(dist) || !path.isAbsolute(manifest)) throw new Error('S owned fixture paths malformed.');
  if (JSON.stringify(raw.coreDist) !== '[{"path":"browser/index.js","bytes":1,"sha256":"'+ '0'.repeat(64) +'"}]') throw new Error('S synthetic manifest vector differs.');
  const expected = { pendingFixtureClose: 0, lateCloseInvocations: 1, settledFixtureClose: 1, postTeardownHostAcquisitions: 0, postTeardownUiAcquisitions: 0, networkAndServerCalls: 0 };
  if (JSON.stringify(raw.safeOracle) !== JSON.stringify(expected)) throw new Error('S independent safe oracle differs.');
  if (raw.selectedFaultName !== 'fails closed with missing-secret on the actual binding boundary') throw new Error('S callback selector differs.');
  const cases: SuiteCase[] = [
    { id: 'S1', heldAcquisition: 'mainHost', releasePrecedingCloses: ['browser'], lateClose: 'mainHost' },
    { id: 'S2', heldAcquisition: 'browser', releasePrecedingCloses: [], lateClose: 'browser' },
    { id: 'S3', heldAcquisition: 'faultHost', releasePrecedingCloses: ['mainHost', 'browser'], lateClose: 'faultHost' },
  ];
  if (JSON.stringify(raw.cases) !== JSON.stringify(cases)) throw new Error('S exact case schedule differs.');
  return { revisionId: text(raw.revisionId), bytes: bytes.length, sha256: hash(bytes), rowSha256: hash(JSON.stringify(raw)), raw, exports, objects,
    tmp, evidence, dist, manifest, coreDist: [{ path: 'browser/index.js', bytes: 1, sha256: '0'.repeat(64) }], turns: 128,
    selectedFaultName: text(raw.selectedFaultName), cases, expected };
}
export type SuiteContract = ReturnType<typeof readSuiteContract>;

export async function drainSuiteMicrotasks(turns: number, predicate?: () => boolean) {
  let used = 0;
  for (; used < turns; used++) { await Promise.resolve(); if (predicate?.()) return { reached: true, turns: used + 1 }; }
  return { reached: predicate ? predicate() : false, turns: used };
}

export function createSuiteBehaviorFixture(qualification: Qualification, session: ReturnType<typeof createQualificationSession>, contract: SuiteContract, mode: SuiteMode) {
  const calls: SuiteCall[] = [], violations: Violation[] = [];
  let phase = 'setup', closing = false;
  const E_UI_AFTER_CLOSE = new Error('E_UI_AFTER_CLOSE');
  const E_POST_TEARDOWN_ACQUISITION = new Error('E_POST_TEARDOWN_ACQUISITION');
  const acquisition = { fixture: deferred<Record<string, unknown>>(), browser: deferred<Record<string, unknown>>(), mainHost: deferred<Record<string, unknown>>(), faultHost: deferred<Record<string, unknown>>() };
  const closes = { fixture: deferred<void>(), browser: deferred<void>(), mainHost: deferred<void>(), faultHost: deferred<void>() };
  const requested = { fixture: 0, browser: 0, mainHost: 0, faultHost: 0 };
  const closeCounts = { fixture: 0, browser: 0, mainHost: 0, faultHost: 0 };
  const values = new Map<SuiteOwner, Record<string, unknown>>();
  function entry(target: string, member: string, args: unknown[], actor: 'suite' | 'test-finally' = 'suite') {
    calls.push({ sequence: calls.length + 1, at: Date.now(), phase, target, member, args, actor });
  }
  function refuse(target: string, member: PropertyKey): never {
    violations.push({ target, member: String(member) });
    throw new Error(`Unqualified S member: ${target}/${String(member)}`);
  }
  const metadata = (key: PropertyKey) => key === 'then' || key === '__esModule' || key === Symbol.toStringTag || key === Symbol.iterator;
  function callable(target: string, fn: (...args: unknown[]) => unknown) {
    return new Proxy(fn, {
      get(value, key) { if (key === 'name' || key === 'length') return Reflect.get(value, key) as unknown; if (metadata(key) || key === 'prototype') return key === Symbol.toStringTag ? 'Function' : undefined; return refuse(target, key); },
      getOwnPropertyDescriptor(value, key) { if (key === 'name' || key === 'length') return Reflect.getOwnPropertyDescriptor(value, key); if (metadata(key) || key === 'prototype') return undefined; return refuse(target, key); },
      getPrototypeOf: () => null, set: (_value, key) => refuse(target, key), defineProperty: (_value, key) => refuse(target, key), deleteProperty: (_value, key) => refuse(target, key),
    });
  }
  function namespace(target: string, allowed: string[], data: Record<string, unknown>) {
    if (JSON.stringify(Object.keys(data).sort()) !== JSON.stringify([...allowed].sort())) throw new Error(`Incomplete S namespace: ${target}`);
    const own = Object.assign(Object.create(null) as Record<string, unknown>, data);
    return new Proxy(own, {
      get(_value, key) { if (typeof key === 'string' && allowed.includes(key)) return own[key]; if (metadata(key)) return key === Symbol.toStringTag ? 'Module' : undefined; return refuse(target, key); },
      ownKeys: () => [...allowed], getOwnPropertyDescriptor(_value, key) { if (typeof key === 'string' && allowed.includes(key)) return { value: own[key], enumerable: true, configurable: true }; if (metadata(key)) return undefined; return refuse(target, key); },
      getPrototypeOf: () => null, set: (_value, key) => refuse(target, key), defineProperty: (_value, key) => refuse(target, key), deleteProperty: (_value, key) => refuse(target, key),
    });
  }
  function blocked(target: string, member: string) { return callable(`${target}.${member}`, (...args) => { entry(target, member, args); return refuse(target, member); }); }
  function exactArgs(target: string, member: string, args: unknown[], expected: unknown[]) {
    if (JSON.stringify(args) !== JSON.stringify(expected)) return refuse(target, `${member}:arguments`);
  }
  function close(owner: SuiteOwner, args: unknown[], actor: 'suite' | 'test-finally' = 'suite') {
    exactArgs(owner, 'close', args, []);
    if (acquisition[owner].state !== 'fulfilled') return refuse(owner, 'close-before-acquisition');
    entry(owner, 'close', args, actor);
    if (actor === 'suite') closeCounts[owner]++;
    return closes[owner].promise;
  }
  const fixture = namespace('fixture', contract.objects.fixture ?? [], { distDir: contract.dist, manifest: contract.manifest, close: callable('fixture.close', (...args) => close('fixture', args)) });
  const browser = namespace('browser', contract.objects.browser ?? [], {
    close: callable('browser.close', (...args) => close('browser', args)),
    newContext: callable('browser.newContext', (...args) => {
      exactArgs('browser', 'newContext', args, [{ acceptDownloads: true }]);
      if (!closing || mode !== 'S3') return refuse('browser', 'newContext-outside-S3-teardown');
      entry('browser', 'newContext', args);
      return Promise.reject(E_UI_AFTER_CLOSE);
    }),
  });
  function host(owner: 'mainHost' | 'faultHost') {
    return namespace(owner, contract.objects.host ?? [], { close: callable(`${owner}.close`, (...args) => close(owner, args)), url: 'http://127.0.0.1:12345',
      inspect: blocked(owner, 'inspect'), resetAdmission: blocked(owner, 'resetAdmission'), setProviderScenario: blocked(owner, 'setProviderScenario') });
  }
  values.set('fixture', fixture); values.set('browser', browser); values.set('mainHost', host('mainHost')); values.set('faultHost', host('faultHost'));
  function acquire(owner: SuiteOwner, target: string, member: string, args: unknown[]) {
    if (closing) return refuse(target, 'acquisition-after-teardown');
    entry(target, member, args); requested[owner]++;
    if (requested[owner] !== 1) return refuse(target, 'repeated-acquisition');
    return acquisition[owner].promise;
  }
  const webDir = fileURLToPath(new URL('..', qualification.testDirectory));
  const projectDir = path.resolve(webDir, '../..');
  const chromium = namespace('chromium', contract.objects.chromium ?? [], { launch: callable('chromium.launch', (...args) => { exactArgs('chromium', 'launch', args, [{ headless: true }]); return acquire('browser', 'chromium', 'launch', args); }) });
  const factories: Record<string, Record<string, unknown>> = {
    suiteVitest: { beforeAll: session.beforeAll, afterAll: session.afterAll, it: session.it, expect: blocked('suiteVitest', 'expect') },
    suiteBrowser: { chromium },
    suiteFixture: { buildProductionCatalogFixture: callable('suiteFixture.buildProductionCatalogFixture', (...args) => { exactArgs('suiteFixture', 'buildProductionCatalogFixture', args, [{ webDir, evidenceDir: contract.evidence }]); return acquire('fixture', 'suiteFixture', 'buildProductionCatalogFixture', args); }) },
    suiteHost: { startDomainFunctionsHost: callable('suiteHost.startDomainFunctionsHost', (...args) => {
      if (args.length !== 1) return refuse('suiteHost', 'arguments');
      const options = object(args[0]);
      const fault = options.fault === 'missing-secret';
      const expected = { projectDir, distDir: contract.dist, evidenceDir: contract.evidence, expectedCoreDistPins: contract.coreDist.map(pin => ({ ...pin, path: `packages/core/dist/${pin.path}` })), ...fault ? { fault: 'missing-secret' } : {}, deadlineAt: suiteEpoch + (fault ? 180000 : 600000) };
      exactArgs('suiteHost', 'startDomainFunctionsHost', args, [expected]);
      if (fault && (mode !== 'S3' || closing)) return refuse('suiteHost', 'fault-path');
      if (!fault && closing) {
        if (mode !== 'S2') return refuse('suiteHost', 'post-teardown-path');
        entry('suiteHost', 'refused-post-teardown-acquisition', args);
        return Promise.reject(E_POST_TEARDOWN_ACQUISITION);
      }
      return acquire(fault ? 'faultHost' : 'mainHost', 'suiteHost', 'startDomainFunctionsHost', args);
    }) },
    suiteFs: {
      mkdtemp: callable('suiteFs.mkdtemp', (...args) => { exactArgs('suiteFs', 'mkdtemp', args, [path.join(contract.tmp, 'wyreup-domain-browser-')]); entry('suiteFs', 'mkdtemp', args); return Promise.resolve(contract.evidence); }),
      readFile: callable('suiteFs.readFile', (...args) => { exactArgs('suiteFs', 'readFile', args, [contract.manifest, 'utf8']); entry('suiteFs', 'readFile', args); return Promise.resolve(JSON.stringify({ coreDist: contract.coreDist })); }),
      writeFile: blocked('suiteFs', 'writeFile'),
    },
    suiteOs: { tmpdir: callable('suiteOs.tmpdir', (...args) => { exactArgs('suiteOs', 'tmpdir', args, []); entry('suiteOs', 'tmpdir', args); return contract.tmp; }) },
  };
  function factory(item: FactoryIdentity) {
    const valid = qualification.revision.suiteBoundaryFactories.find(entry => entry.key === item.key && entry.marker === item.marker);
    const data = factories[item.marker], allowed = contract.exports[item.marker];
    if (!valid || !data || !allowed) throw new Error('Unknown S factory; no default forwarding.');
    return namespace(item.marker, allowed, data);
  }
  const httpNamespace = namespace('suiteHttp', ['createServer'], { createServer: blocked('suiteHttp', 'createServer') });
  function requireClean() {
    session.requireClean();
    if (violations.length) throw new AggregateError(violations.map(item => new Error(`${item.target}/${item.member}`)), 'S qualification refused; no product endpoint is valid.');
  }
  function releaseAcquisition(owner: SuiteOwner) {
    if (requested[owner] !== 1) throw new Error(`No actual ${owner} acquisition to release.`);
    const value = values.get(owner); if (!value) throw new Error('Controlled value missing.');
    acquisition[owner].resolve(value);
  }
  function releaseClose(owner: SuiteOwner) { if (closes[owner].state === 'pending') closes[owner].resolve(undefined); }
  function freeze() {
    requireClean();
    return { mode, phase, calls: calls.map(call => ({ ...call, args: [...call.args] })), requested: { ...requested }, closeCounts: { ...closeCounts },
      acquisitions: Object.fromEntries(Object.entries(acquisition).map(([key, value]) => [key, value.state])),
      closes: Object.fromEntries(Object.entries(closes).map(([key, value]) => [key, value.state])) };
  }
  async function releaseAlreadyCreated() {
    phase = 'test-finally'; closing = true;
    for (const owner of ['fixture', 'browser', 'mainHost', 'faultHost'] as const) if (requested[owner] === 1 && acquisition[owner].state === 'pending') releaseAcquisition(owner);
    await drainSuiteMicrotasks(contract.turns);
    for (const owner of ['fixture', 'browser', 'mainHost', 'faultHost'] as const) {
      if (acquisition[owner].state === 'fulfilled' && closeCounts[owner] === 0) void close(owner, [], 'test-finally');
      releaseClose(owner);
    }
    await drainSuiteMicrotasks(contract.turns);
    requireClean();
  }
  return { mode, calls, violations, contract, E_UI_AFTER_CLOSE, E_POST_TEARDOWN_ACQUISITION, factory, httpNamespace, requireClean, freeze, releaseAcquisition, releaseClose, releaseAlreadyCreated,
    requested: (owner: SuiteOwner) => requested[owner], closed: (owner: SuiteOwner) => closeCounts[owner],
    beginTeardown() { phase = 'teardown'; closing = true; }, phase(name: string) { phase = name; } };
}
