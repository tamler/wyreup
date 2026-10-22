import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const readOriginal = readFileSync;
const canonicalOriginal = realpathSync;
const hashOriginal = createHash;

export interface Violation { target: string; member: string }
export interface FactoryIdentity { key: string; marker: string }
export interface SourcePin { path: string; bytes: number; sha256: string }
export interface ExpectedRevision {
  revisionId: string;
  helperSha256: string;
  suiteSha256: string;
  sourcePins: SourcePin[];
  nodeMinimumMajor: number;
  childArgvForbidden: string;
  helperBoundaryFactories: FactoryIdentity[];
  suiteBoundaryFactories: FactoryIdentity[];
  probeBoundaryFactory: FactoryIdentity;
  expectedProbeExports: string[];
  registrations: {
    beforeAll: { count: number; timeout: number };
    afterAll: { count: number; timeout: number };
    tests: { name: string; timeout: number }[];
  };
  controlledExportAllowLists: Record<string, string[]>;
  helperPromisesMembers: string[];
  helperRequireResultMembers: string[];
  controlledObjectMembers: Record<string, string[]>;
  diagnosticRecords: { failedLaunch: string; terminal: string | null };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Qualification data must be an object.');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Qualification data requires a nonempty string.');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Qualification data requires a positive integer.');
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Qualification data requires a member array.');
  const result = value.map(text);
  if (result.length === 0 || new Set(result).size !== result.length) throw new Error('Qualification members must be nonempty and unique.');
  return result;
}
function factories(value: unknown): FactoryIdentity[] {
  if (!Array.isArray(value)) throw new Error('Qualification factories are absent.');
  const result = value.map(entry => { const item = object(entry); return { key: text(item.key), marker: text(item.marker) }; });
  if (new Set(result.map(item => item.key)).size !== result.length || new Set(result.map(item => item.marker)).size !== result.length) throw new Error('Qualification factories are ambiguous.');
  return result;
}
function memberMap(value: unknown): Record<string, string[]> {
  return Object.fromEntries(Object.entries(object(value)).map(([key, members]) => [key, strings(members)]));
}
const digest = (bytes: Uint8Array | string) => hashOriginal('sha256').update(bytes).digest('hex');
const sourceNames = ['domainFunctionsHarness.mjs', 'domain-functions-integration.test.ts', 'domainFunctionsHarness.d.mts', 'productionBrowserHarness.ts'];

function qualificationSourcePins(value: unknown): SourcePin[] {
  if (!Array.isArray(value)) throw new Error('Qualification source pins are absent.');
  const pins = value.map(item => {
    const pin = object(item);
    const result = { path: text(pin.path), bytes: integer(pin.bytes), sha256: text(pin.sha256) };
    if (!/^[a-f0-9]{64}$/.test(result.sha256)) throw new Error('Qualification source SHA256 is malformed.');
    return result;
  });
  if (pins.length !== sourceNames.length || new Set(pins.map(pin => pin.path)).size !== sourceNames.length
    || pins.some(pin => !sourceNames.includes(pin.path))) throw new Error('Qualification requires exactly the four canonical original source pins.');
  return pins;
}

function sourceTuple(pins: SourcePin[]): string {
  return JSON.stringify(sourceNames.map(path => {
    const pin = pins.find(item => item.path === path);
    if (!pin) throw new Error('Missing canonical qualification source pin.');
    return [pin.path, pin.bytes, pin.sha256];
  }));
}

// Internal fixture interface: exact source selection, never a public tool API.
export function selectQualificationRevision(sources: readonly SourcePin[], historical: unknown, current: unknown): Record<string, unknown> {
  const wanted = sourceTuple(qualificationSourcePins(sources));
  const seen = new Set<string>();
  const matches: Record<string, unknown>[] = [];
  for (const value of [historical, current]) {
    const document = object(value);
    if (document.schemaVersion !== 1 || !Array.isArray(document.revisions) || document.revisions.length === 0) throw new Error('Unknown qualification schema.');
    for (const entry of document.revisions) {
      const row = object(entry);
      const pins = qualificationSourcePins(row.sourcePins);
      const helper = pins.find(pin => pin.path === sourceNames[0]);
      const suite = pins.find(pin => pin.path === sourceNames[1]);
      if (!helper || !suite || text(row.helperSha256) !== helper.sha256 || text(row.suiteSha256) !== suite.sha256) throw new Error('Qualification row hashes disagree with source pins.');
      const tuple = sourceTuple(pins);
      if (seen.has(tuple)) throw new Error('Duplicate complete qualification source tuple; qualification refused.');
      seen.add(tuple);
      if (tuple === wanted) matches.push(row);
    }
  }
  if (matches.length !== 1) throw new Error('Unknown or ambiguous complete source revision; qualification refused.');
  const row = matches[0];
  if (!row) throw new Error('Missing qualification revision.');
  return row;
}

export function captureQualification(testDirectory: URL) {
  const sources = sourceNames.map(path => {
    const physical = canonicalOriginal(fileURLToPath(new URL(path, testDirectory)));
    const bytes = readOriginal(physical);
    return { path, physical, bytes: bytes.byteLength, sha256: digest(bytes) };
  });
  const documentBytes = readOriginal(new URL('fixtures/domainLifecycleExpectations.json', testDirectory));
  const currentDocumentBytes = readOriginal(new URL('fixtures/domainLifecycleCurrentExpectations.json', testDirectory));
  const raw = selectQualificationRevision(sources,
    JSON.parse(documentBytes.toString('utf8')) as unknown,
    JSON.parse(currentDocumentBytes.toString('utf8')) as unknown);
  const sourcePins = qualificationSourcePins(raw.sourcePins);
  const registrations = object(raw.registrations);
  const hook = (value: unknown) => { const item = object(value); return { count: integer(item.count), timeout: integer(item.timeout) }; };
  if (!Array.isArray(registrations.tests)) throw new Error('Qualification test registrations are absent.');
  const diagnostics = object(raw.diagnosticRecords);
  if (diagnostics.terminal !== null && typeof diagnostics.terminal !== 'string') throw new Error('Diagnostic terminal protocol must be explicit, including absent/null.');
  if (typeof diagnostics.terminal === 'string' && diagnostics.terminal.length === 0) throw new Error('Diagnostic terminal path cannot be empty.');
  const probe = object(raw.probeBoundaryFactory);
  const revision: ExpectedRevision = {
    revisionId: text(raw.revisionId), helperSha256: text(raw.helperSha256), suiteSha256: text(raw.suiteSha256), sourcePins,
    nodeMinimumMajor: integer(raw.nodeMinimumMajor), childArgvForbidden: text(raw.childArgvForbidden),
    helperBoundaryFactories: factories(raw.helperBoundaryFactories), suiteBoundaryFactories: factories(raw.suiteBoundaryFactories),
    probeBoundaryFactory: { key: text(probe.key), marker: text(probe.marker) }, expectedProbeExports: strings(raw.expectedProbeExports),
    registrations: { beforeAll: hook(registrations.beforeAll), afterAll: hook(registrations.afterAll), tests: registrations.tests.map(value => { const item = object(value); return { name: text(item.name), timeout: integer(item.timeout) }; }) },
    controlledExportAllowLists: memberMap(raw.controlledExportAllowLists), helperPromisesMembers: strings(raw.helperPromisesMembers),
    helperRequireResultMembers: strings(raw.helperRequireResultMembers), controlledObjectMembers: memberMap(raw.controlledObjectMembers),
    diagnosticRecords: { failedLaunch: text(diagnostics.failedLaunch), terminal: diagnostics.terminal },
  };
  if (Number(process.versions.node.split('.')[0]) < revision.nodeMinimumMajor || process.argv[2] === revision.childArgvForbidden) throw new Error('Unsafe qualification Node/child-entry precondition.');
  for (const entry of [...revision.helperBoundaryFactories, ...revision.suiteBoundaryFactories]) if (!revision.controlledExportAllowLists[entry.marker]) throw new Error(`Missing export allowlist: ${entry.marker}`);
  for (const name of ['chromium', 'fixture', 'browser', 'host']) if (!revision.controlledObjectMembers[name]) throw new Error(`Missing nested allowlist: ${name}`);
  return { revision, sources, dataSha256: digest(documentBytes), currentDataSha256: digest(currentDocumentBytes), rowSha256: digest(JSON.stringify(raw)), testDirectory };
}

export type Qualification = ReturnType<typeof captureQualification>;
// These descriptors do not observe Vitest's internal importer or mock-registry IDs.
// Factory invocation and probe reference identity are the interception evidence.
// Resolution targets describe public Node ESM resolution or canonical physical files.
export interface Marker { declaredMockKey: string; marker: string; declaredDoMockCaller: string; awaitedCanonicalEntry: string; canonicalResolutionTarget: string; session: symbol }
export interface Registration { kind: 'beforeAll' | 'afterAll' | 'it'; name?: string; callback: unknown; timeout: unknown }

export function createQualificationSession(qualification: Qualification, canonicalBare: Record<string, string>) {
  const violations: Violation[] = [];
  const calls: { target: string; member: string }[] = [];
  const markers: Marker[] = [];
  const registrations: Registration[] = [];
  const token = Symbol('qualification session');
  let awaitedCanonicalEntry = '';
  const fail = (target: string, member: PropertyKey): never => {
    violations.push({ target, member: String(member) });
    throw new Error(`Qualification boundary violation: ${target}/${String(member)}`);
  };
  function callable<T extends (...args: never[]) => unknown>(target: string, callback: T): T {
    return new Proxy(callback, {
      get(original, key) {
        if (key === 'name' || key === 'length') return Reflect.get(original, key);
        if (key === 'then' || key === 'prototype' || key === '__esModule' || key === Symbol.iterator) return undefined;
        if (key === Symbol.toStringTag) return 'Function';
        return fail(target, key);
      },
      getOwnPropertyDescriptor(original, key) {
        if (key === 'name' || key === 'length') return Reflect.getOwnPropertyDescriptor(original, key);
        if (key === 'then' || key === 'prototype' || key === '__esModule' || key === Symbol.iterator || key === Symbol.toStringTag) return undefined;
        return fail(target, key);
      },
      getPrototypeOf: () => null,
      set: (_target, key) => fail(target, key),
      defineProperty: (_target, key) => fail(target, key),
      deleteProperty: (_target, key) => fail(target, key),
    });
  }
  const blocked = (target: string, member: string) => callable(`${target}.${member}`, (..._args: unknown[]): never => {
    calls.push({ target, member });
    throw new Error(`Qualification forbids invoking ${target}/${member}`);
  });
  function namespace(target: string, members: string[], values: Record<string, unknown>): Record<string, unknown> {
    if (Object.keys(values).sort().join('\0') !== [...members].sort().join('\0')) throw new Error(`Incomplete controlled namespace: ${target}`);
    const data = Object.assign(Object.create(null) as Record<string, unknown>, values);
    const metadata = (key: PropertyKey) => key === 'then' || key === '__esModule' || key === Symbol.toStringTag || key === Symbol.iterator;
    return new Proxy(data, {
      get(_target, key) {
        if (typeof key === 'string' && members.includes(key)) return data[key];
        if (metadata(key)) return key === Symbol.toStringTag ? 'Module' : undefined;
        return fail(target, key);
      },
      ownKeys: () => [...members],
      getOwnPropertyDescriptor(_target, key) {
        if (typeof key === 'string' && members.includes(key)) return { value: data[key], enumerable: true, configurable: true };
        if (metadata(key)) return undefined;
        return fail(target, key);
      },
      set: (_target, key) => fail(target, key),
      defineProperty: (_target, key) => fail(target, key),
      deleteProperty: (_target, key) => fail(target, key),
      getPrototypeOf: () => null,
    });
  }
  const E_ENTRY = new Error('E_ENTRY');
  const helperPromises = namespace('helperFs.promises', qualification.revision.helperPromisesMembers,
    Object.fromEntries(qualification.revision.helperPromisesMembers.map(member => [member, member === 'realpath' ? callable('helperFs.promises.realpath', (_path: unknown): Promise<never> => { calls.push({ target: 'helperFs.promises', member }); return Promise.reject(E_ENTRY); }) : blocked('helperFs.promises', member)])));
  const requireResult = namespace('helperModule.createRequire.result', qualification.revision.helperRequireResultMembers,
    Object.fromEntries(qualification.revision.helperRequireResultMembers.map(member => [member, blocked('helperModule.createRequire.result', member)])));
  const chromium = namespace('suiteBrowser.chromium', qualification.revision.controlledObjectMembers.chromium ?? [], { launch: blocked('suiteBrowser.chromium', 'launch') });
  const beforeAll = callable('suiteVitest.beforeAll', (callback: unknown, timeout: unknown) => { registrations.push({ kind: 'beforeAll', callback, timeout }); });
  const afterAll = callable('suiteVitest.afterAll', (callback: unknown, timeout: unknown) => { registrations.push({ kind: 'afterAll', callback, timeout }); });
  const it = callable('suiteVitest.it', (name: string, callback: unknown, timeout: unknown) => { registrations.push({ kind: 'it', name, callback, timeout }); });
  const values: Record<string, Record<string, unknown>> = {
    helperFs: { promises: helperPromises, createWriteStream: blocked('helperFs', 'createWriteStream') },
    helperChildren: { spawn: blocked('helperChildren', 'spawn'), fork: blocked('helperChildren', 'fork') },
    helperModule: { createRequire: callable('helperModule.createRequire', (..._args: unknown[]) => { calls.push({ target: 'helperModule', member: 'createRequire' }); return requireResult; }) },
    suiteVitest: { beforeAll, afterAll, it, expect: blocked('suiteVitest', 'expect') },
    suiteBrowser: { chromium }, suiteFixture: { buildProductionCatalogFixture: blocked('suiteFixture', 'buildProductionCatalogFixture') },
    suiteHost: { startDomainFunctionsHost: blocked('suiteHost', 'startDomainFunctionsHost') },
    suiteFs: { mkdtemp: blocked('suiteFs', 'mkdtemp'), readFile: blocked('suiteFs', 'readFile'), writeFile: blocked('suiteFs', 'writeFile') },
    suiteOs: { tmpdir: blocked('suiteOs', 'tmpdir') },
  };
  function canonical(key: string): string {
    if (key.startsWith('node:')) return import.meta.resolve(key);
    if (key === './productionBrowserHarness') return canonicalOriginal(fileURLToPath(new URL('productionBrowserHarness.ts', qualification.testDirectory)));
    if (key === './domainFunctionsHarness.mjs') return canonicalOriginal(fileURLToPath(new URL('domainFunctionsHarness.mjs', qualification.testDirectory)));
    const target = canonicalBare[key];
    if (!target) throw new Error(`Unknown canonical mock target: ${key}`);
    return target;
  }
  function factory(entry: FactoryIdentity, declaredCallerUrl: string): Record<string, unknown> {
    if (!awaitedCanonicalEntry) throw new Error('Factory fired outside an explicitly named original import.');
    const exports = values[entry.marker];
    const members = qualification.revision.controlledExportAllowLists[entry.marker];
    if (!exports || !members) throw new Error(`Unimplemented qualification factory: ${entry.key}/${entry.marker}`);
    markers.push({ declaredMockKey: entry.key, marker: entry.marker, declaredDoMockCaller: canonicalOriginal(fileURLToPath(declaredCallerUrl)), awaitedCanonicalEntry, canonicalResolutionTarget: canonical(entry.key), session: token });
    return namespace(entry.marker, members, exports);
  }
  function beginImport(name: 'domainFunctionsHarness.mjs' | 'domain-functions-integration.test.ts' | 'domainFunctionsRegistrationProbe.ts') {
    awaitedCanonicalEntry = canonicalOriginal(fileURLToPath(new URL(name, qualification.testDirectory)));
    return awaitedCanonicalEntry;
  }
  function requireClean() {
    if (violations.length) throw new AggregateError(violations.map(item => new Error(`${item.target}/${item.member}`)), 'Qualification access ledger is nonempty; no product outcome is valid.');
  }
  return { E_ENTRY, violations, calls, markers, registrations, token, beforeAll, afterAll, it, factory, beginImport, canonical, requireClean };
}

import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import path from 'node:path';

export type HelperMode = 'H1' | 'H2' | 'H3' | 'H4' | 'H4-write' | 'H5' | 'H5-write' | 'H6' | 'H7' | 'P1' | 'P2' | 'P3';
export interface HelperCall { sequence: number; at: number; operation: string; args: unknown[]; outcome?: 'fulfilled' | 'rejected'; result?: unknown }
export interface HelperWrite { sequence: number; file: string; text: string; payload: unknown; succeeded: boolean; error?: Error }
const nativeImmediate = setImmediate;
export const helperClockStart = Date.UTC(2026, 0, 1);
export const flushHelperNativeTurn = () => new Promise<void>(resolve => nativeImmediate(resolve));
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized.'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export function helperErrorLeaves(value: unknown): unknown[] {
  if (!(value instanceof AggregateError)) return [value];
  const errors: unknown[] = value.errors;
  return errors.flatMap(helperErrorLeaves);
}
export function readHelperDiagnosticOracle(directory: URL): { value: Record<string, unknown>; sha256: string } {
  const bytes = readOriginal(new URL('fixtures/domainHelperDiagnosticProjection.json', directory));
  const value = object(JSON.parse(bytes.toString('utf8')) as unknown);
  if (value.schemaVersion !== 1 || value.recordProperty !== 'lifecycle') throw new Error('Unknown helper diagnostic oracle.');
  for (const key of ['projectionKeys', 'childKeys', 'writerKeys']) strings(value[key]);
  object(value.common);
  const variants = object(value.variants);
  for (const key of ['H4', 'H5']) { const variant = object(variants[key]); object(variant.child); object(variant.writer); }
  return { value, sha256: digest(bytes) };
}

// Dependency fixtures exercise original helper ownership only: no SDK/OS child runs.
export function createHelperBehaviorFixture(qualification: Qualification, mode: HelperMode) {
  const project = '/unit-domain-lifecycle/project';
  const dist = '/unit-domain-lifecycle/dist';
  const evidence = '/unit-domain-lifecycle/evidence';
  const owned = path.join(evidence, 'domain-functions-controlled');
  const sourceFiles = [
    'functions/api/domain-age.ts', 'functions/_lib/rdap.ts', 'functions/_lib/public-rate-limit.ts',
    'functions/_lib/crypto.ts', 'functions/_lib/env.ts', 'functions/_lib/types.ts',
    'packages/core/src/lib/domain-registration.ts', 'packages/core/src/lib/tr46.d.ts',
    'packages/core/src/utilities/common.ts', 'packages/core/src/types.ts',
    'migrations/0008_public_domain_limits.sql', 'package.json', 'packages/core/package.json', 'pnpm-lock.yaml',
  ];
  const calls: HelperCall[] = [];
  const writes: HelperWrite[] = [];
  const violations: Violation[] = [];
  const directories = new Set<string>();
  const files = new Map<string, Buffer>();
  const links = new Map<string, string>();
  let sequence = 0;
  let failureSequence: number | null = null;
  let endpointSequence: number | null = null;
  let startInjected = false;
  let guardInjected = false;
  let writeInjected = false;
  let spawnCount = 0;
  let host: Child | undefined;
  const compilerReady = deferred<void>();
  const writerEnd = deferred<void>();
  const hostReady = deferred<void>();
  const E_START = new Error('E_START');
  const E_WRITE = new Error('E_WRITE');
  const E_GUARD = new Error('E_GUARD');
  const E_STREAM = new Error('E_STREAM');
  const E_DWRITE = new Error('E_DWRITE');
  const failedLaunch = path.join(owned, qualification.revision.diagnosticRecords.failedLaunch);
  const terminal = qualification.revision.diagnosticRecords.terminal;
  const call = (operation: string, args: unknown[]) => {
    if (calls.length >= 4096) { violations.push({ target: 'finite-call-ledger', member: operation }); throw new Error('Finite fixture call capacity exceeded; no product interpretation is permitted.'); }
    const entry: HelperCall = { sequence: ++sequence, at: Date.now(), operation, args };
    calls.push(entry); return entry;
  };
  const violation = (target: string, member: PropertyKey): never => {
    violations.push({ target, member: String(member) });
    throw new Error(`Unqualified helper boundary: ${target}/${String(member)}`);
  };
  function controlled(target: string, members: string[], values: Record<string, unknown>): Record<string, unknown> {
    if (Object.keys(values).sort().join('\0') !== [...members].sort().join('\0')) throw new Error(`Unimplemented finite boundary: ${target}`);
    const protect = (member: string, value: unknown): unknown => typeof value === 'function' ? new Proxy(value, {
      get(original, key) {
        if (key === 'name' || key === 'length' || key === 'prototype') { const metadata: unknown = Reflect.get(original, key); return metadata; }
        if (key === 'then' || key === '__esModule' || key === 'toJSON' || key === Symbol.iterator) return undefined;
        if (key === Symbol.toStringTag) return 'Function';
        return violation(`${target}.${member}`, key);
      },
    }) : value;
    const data = Object.assign(Object.create(null) as Record<string, unknown>, Object.fromEntries(Object.entries(values).map(([member, value]) => [member, protect(member, value)])));
    return new Proxy(data, {
      get(_object, member) {
        if (typeof member === 'string' && members.includes(member)) return data[member];
        if (member === Symbol.toStringTag) return 'Module';
        if (member === 'then' || member === '__esModule' || member === 'toJSON' || member === Symbol.iterator) return undefined;
        return violation(target, member);
      },
      ownKeys: () => [...members],
      getOwnPropertyDescriptor(_object, member) {
        if (typeof member === 'string' && members.includes(member)) return { value: data[member], enumerable: true, configurable: true };
        if (member === Symbol.toStringTag || member === 'then' || member === '__esModule' || member === 'toJSON' || member === Symbol.iterator) return undefined;
        return violation(target, member);
      },
      set: (_object, member) => violation(target, member),
      defineProperty: (_object, member) => violation(target, member),
      deleteProperty: (_object, member) => violation(target, member),
      getPrototypeOf: () => null,
    });
  }
  function checkedPath(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('/unit-domain-lifecycle/') || path.resolve(value) !== value) return violation('filesystem', String(value));
    return value;
  }
  function mkdirValue(file: string, recursive: boolean) {
    if (directories.has(file)) { if (!recursive) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); return; }
    const parent = path.dirname(file);
    if (!directories.has(parent)) {
      if (!recursive) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mkdirValue(parent, true);
    }
    directories.add(file);
  }
  directories.add('/'); directories.add('/unit-domain-lifecycle');
  const put = (file: string, bytes: Buffer) => { mkdirValue(path.dirname(file), true); files.set(file, bytes); };
  for (const relative of sourceFiles) put(path.join(project, relative), Buffer.from(`Inert unit dependency fixture: ${relative}\n`));
  const coreBytes = Buffer.from('Inert coordinated core fixture; never imported.\n');
  put(path.join(project, 'packages/core/dist/browser/index.js'), coreBytes);
  put(path.join(dist, 'index.html'), Buffer.from('Inert static asset; never served.\n'));
  const wranglerPackage = path.join(project, 'node_modules/wrangler/package.json');
  const miniflarePackage = path.join(project, 'node_modules/miniflare/package.json');
  put(wranglerPackage, Buffer.from(JSON.stringify({ version: '4.148.0' })));
  put(miniflarePackage, Buffer.from(JSON.stringify({ version: '5.20261006.0-alpha' })));
  for (const relative of ['node_modules/wrangler/bin/wrangler.js', 'node_modules/wrangler/wrangler-dist/cli.js', 'node_modules/miniflare/dist/src/index.js']) put(path.join(project, relative), Buffer.from('Inert SDK metadata fixture; never executed.\n'));
  mkdirValue(path.join(project, 'packages/core/node_modules'), true);
  const corePins = [{ path: 'packages/core/dist/browser/index.js', bytes: coreBytes.length, sha256: digest(coreBytes) }];
  function readable(file: string): Buffer {
    const bytes = files.get(file);
    if (!bytes) throw Object.assign(new Error(`ENOENT ${file}`), { code: 'ENOENT' });
    return bytes;
  }
  function guardRead(operation: string, file: string) {
    if (failureSequence !== null && (file === path.join(project, 'packages/core/dist') || file.startsWith(project + '/') || file === dist || file.startsWith(dist + '/'))) {
      call('post-failure-original-read', [operation, file]);
      if (mode === 'H2' || mode === 'H6') {
        if (!guardInjected) { guardInjected = true; throw E_GUARD; }
      }
    }
  }
  function fsOperation(name: string, action: (...args: unknown[]) => unknown) {
    return (...args: unknown[]) => {
      const entry = call(`fs.${name}`, args);
      try { const value = action(...args); entry.outcome = 'fulfilled'; entry.result = value; return Promise.resolve(value); }
      catch (error) {
        entry.outcome = 'rejected';
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve the exact thrown native reason and injected object identity, including unknown non-Error values.
        return Promise.reject(error);
      }
    };
  }
  const fsValues: Record<string, unknown> = {
    realpath: fsOperation('realpath', value => {
      const file = checkedPath(value);
      const actual = links.get(file) ?? file;
      if (!directories.has(actual) && !files.has(actual)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return actual;
    }),
    mkdir: fsOperation('mkdir', (value, options) => { const file = checkedPath(value); const config = options === undefined ? {} : object(options); mkdirValue(file, config.recursive === true); }),
    mkdtemp: fsOperation('mkdtemp', value => {
      const prefix = checkedPath(value);
      if (prefix !== path.join(evidence, 'domain-functions-')) return violation('mkdtemp', prefix);
      mkdirValue(owned, false); return owned;
    }),
    readFile: fsOperation('readFile', (value, encoding) => {
      const file = checkedPath(value); guardRead('readFile', file);
      const bytes = readable(file);
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Preserve the existing unsupported-value diagnostic; this branch refuses the qualification boundary without treating the value as an admitted encoding.
      if (encoding !== undefined && encoding !== 'utf8') return violation('readFile.encoding', String(encoding));
      return encoding === 'utf8' ? bytes.toString('utf8') : Buffer.from(bytes);
    }),
    readdir: fsOperation('readdir', (value, options) => {
      const directory = checkedPath(value); guardRead('readdir', directory);
      if (!directories.has(directory)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const children = new Set<string>();
      for (const file of [...directories, ...files.keys(), ...links.keys()]) if (path.dirname(file) === directory && file !== directory) children.add(path.basename(file));
      const names = [...children].sort();
      const config = options === undefined ? {} : object(options);
      if (config.withFileTypes !== true) return names;
      return names.map(name => { const file = path.join(directory, name); return controlled('Dirent', ['name', 'isSymbolicLink', 'isDirectory', 'isFile'], { name, isSymbolicLink: () => links.has(file), isDirectory: () => directories.has(file), isFile: () => files.has(file) }); });
    }),
    copyFile: fsOperation('copyFile', (from, to) => {
      const source = checkedPath(from), destination = checkedPath(to);
      if (['H1', 'H2', 'P2'].includes(mode) && source === path.join(project, 'functions/api/domain-age.ts') && destination === path.join(owned, 'functions/api/domain-age.ts') && !startInjected) {
        startInjected = true; failureSequence = sequence; throw E_START;
      }
      if (!directories.has(path.dirname(destination))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      files.set(destination, Buffer.from(readable(source)));
    }),
    symlink: fsOperation('symlink', (from, to) => { const source = checkedPath(from), destination = checkedPath(to); if (links.has(destination) || files.has(destination) || directories.has(destination)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); if (!directories.has(path.dirname(destination))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); links.set(destination, source); }),
    writeFile: fsOperation('writeFile', (value, content) => {
      const file = checkedPath(value);
      if (typeof content !== 'string') return violation('writeFile.content', typeof content);
      if (!directories.has(path.dirname(file))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      let payload: unknown;
      try { payload = JSON.parse(content) as unknown; } catch { payload = content; }
      const attempt: HelperWrite = { sequence, file, text: content, payload, succeeded: true };
      writes.push(attempt);
      if (!writeInjected && ((mode === 'H1' && file === failedLaunch) || (['H4-write', 'H5-write'].includes(mode) && file === failedLaunch) || (mode === 'H7' && failureSequence !== null && file === path.join(owned, 'manifest.json')))) {
        writeInjected = true; const error = mode === 'H1' || mode === 'H7' ? E_WRITE : E_DWRITE;
        attempt.succeeded = false; attempt.error = error; throw error;
      }
      files.set(file, Buffer.from(content));
    }),
  };
  const fsNamespace = controlled('helperFs.promises', qualification.revision.helperPromisesMembers, fsValues);
  interface Writer { file: string; native: Writable; exposed: Writable; endRequested: boolean; finished: boolean; errors: unknown[]; endAt?: number; pipes: number; unpipes: number; heldWrite?: (error?: Error | null) => void; heldFinal?: (error?: Error | null) => void }
  const writers: Writer[] = [];
  function createWriter(value: unknown, options: unknown): Writable {
    const file = checkedPath(value); call('createWriteStream', [file, options]);
    if (object(options).flags !== 'wx' || files.has(file)) throw Object.assign(new Error('EEXIST or wrong stream mode'), { code: 'EEXIST' });
    if (!directories.has(path.dirname(file))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    files.set(file, Buffer.alloc(0));
    const firstCompiler = file === path.join(owned, 'functions-build.log');
    const native = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        files.set(file, Buffer.concat([readable(file), Buffer.from(chunk)]));
        call('native-writer-write', [file, Buffer.from(chunk).toString('utf8')]);
        if (firstCompiler && (mode === 'H3' || mode.startsWith('H4'))) state.heldWrite = callback;
        else callback();
      },
      final(callback) {
        call('native-writer-final', [file]);
        if (firstCompiler && (mode === 'H3' || mode.startsWith('H4'))) state.heldFinal = callback;
        else callback();
      },
    });
    const exposed = new Proxy(native, {
      get(target, member) {
        if (member === 'end') return (callback?: (...args: unknown[]) => void) => {
          call('native-writer-end', [file]); state.endRequested = true; state.endAt = Date.now();
          if (firstCompiler) writerEnd.resolve();
          return callback ? target.end((...nativeArgs: unknown[]) => { call('native-writer-end-callback', [file, nativeArgs[0]]); callback(...nativeArgs); }) : target.end();
        };
        const item: unknown = Reflect.get(target, member, target);
        const result: unknown = typeof item === 'function' ? item.bind(target) : item;
        return result;
      },
    });
    const state: Writer = { file, native, exposed, endRequested: false, finished: false, errors: [], pipes: 0, unpipes: 0 };
    native.on('finish', () => { state.finished = true; call('native-writer-finish', [file]); });
    native.on('error', error => { state.errors.push(error); call('native-writer-error', [file, error]); });
    native.on('pipe', () => { state.pipes++; call('native-writer-pipe', [file]); });
    native.on('unpipe', () => { state.unpipes++; call('native-writer-unpipe', [file]); });
    writers.push(state); return exposed;
  }
  class Child extends EventEmitter {
    pid: number;
    exitCode: number | null = null;
    signalCode: string | null = null;
    connected: boolean;
    stdout = new PassThrough();
    stderr = new PassThrough();
    kills: string[] = [];
    closes = 0;
    sends: unknown[] = [];
    constructor(pid: number, connected: boolean) { super(); this.pid = pid; this.connected = connected; }
    deliverClose(code: number) {
      if (this.closes) throw new Error('Synthetic child closed twice.');
      this.exitCode = code; this.signalCode = null; this.connected = false; this.closes++;
      call('child-close', [this.pid, code, null]); this.emit('close', code, null);
    }
    kill(signal: string) {
      this.kills.push(signal); call('child-kill', [this.pid, signal]);
      if (signal !== 'SIGTERM') return violation('synthetic-child.kill', signal);
      if (!mode.startsWith('H5')) queueMicrotask(() => { if (!this.closes) this.deliverClose(0); });
      return true;
    }
    send(message: unknown, callback?: (error: Error | null) => void) {
      this.sends.push(message); call('child-send', [this.pid, message]);
      const data = object(message);
      if (data.command === 'close') {
        if ((mode === 'H6' || mode === 'H7') && failureSequence === null) failureSequence = sequence;
        queueMicrotask(() => { if (!this.closes) this.deliverClose(mode === 'H6' || mode === 'H7' ? 1 : 0); });
      }
      callback?.(null);
    }
  }
  function exposeChild(child: Child): Record<string, unknown> {
    return new Proxy(Object.create(null) as Record<string, unknown>, {
      get(_target, member) {
        if (member === 'pid' || member === 'exitCode' || member === 'signalCode' || member === 'connected' || member === 'stdout' || member === 'stderr') return child[member];
        if (member === 'on' || member === 'once' || member === 'off' || member === 'removeListener') return child[member].bind(child);
        if (member === 'kill') return child.kill.bind(child);
        if (member === 'send') return child.send.bind(child);
        if (member === 'then' || member === '__esModule' || member === Symbol.iterator) return undefined;
        if (member === Symbol.toStringTag) return 'SyntheticChild';
        return violation('synthetic-child', member);
      },
      getPrototypeOf: () => null,
    });
  }
  const children: Child[] = [];
  function spawn(command: unknown, args: unknown, options: unknown) {
    call('spawn', [command, args, options]);
    if (command !== process.execPath || !Array.isArray(args) || object(options).cwd !== owned) return violation('spawn.arguments', 'command/args/cwd');
    const child = new Child(7001 + spawnCount++, false); children.push(child);
    queueMicrotask(() => {
      try {
      if (child.pid === 7001) {
        child.stdout.write(Buffer.from('bounded compiler stdout\n'));
        if (!['H3', 'H4', 'H4-write', 'H5', 'H5-write'].includes(mode)) {
          const index = args.indexOf('--outdir');
          const directory: unknown = args[index + 1];
          if (index < 0 || directory !== path.join(owned, 'worker') || !directories.has(directory)) return violation('compiler-output', 'actual-created-worker-directory');
          const worker = path.join(directory, 'index.js'); files.set(worker, Buffer.from('Inert compiled worker fixture; never executed.\n')); call('synthetic-compiler-output', [worker]);
          child.deliverClose(0);
        }
        compilerReady.resolve();
      } else child.deliverClose(0);
      } catch (error) { child.emit('error', error); compilerReady.resolve(); }
    });
    return exposeChild(child);
  }
  function fork(file: unknown, args: unknown, options: unknown) {
    call('fork', [file, args, options]);
    if (typeof file !== 'string' || !file.endsWith('/domainFunctionsHarness.mjs') || !Array.isArray(args) || args[0] !== '--host-child' || args[1] !== path.join(owned, 'host-config.json') || object(options).cwd !== owned) return violation('fork.arguments', 'original-helper/args/cwd');
    host = new Child(7101, true); children.push(host);
    const child = host;
    queueMicrotask(() => {
      child.emit('message', { kind: 'ready', url: 'http://127.0.0.1:12345/', platform: { syntheticUnitDependency: true }, migration: { syntheticUnitDependency: true } });
      hostReady.resolve();
    });
    return exposeChild(child);
  }
  const resolveSdk = (name: unknown) => {
    call('require.resolve', [name]);
    if (name === 'miniflare/package.json') return miniflarePackage;
    if (name === 'miniflare') return path.join(project, 'node_modules/miniflare/dist/src/index.js');
    return violation('require.resolve', String(name));
  };
  const requireSdk = new Proxy((..._args: unknown[]): never => violation('requireSdk', 'call'), {
    get(_target, member) {
      if (member === 'resolve') return resolveSdk;
      if (member === 'name' || member === 'length' || member === 'then' || member === '__esModule' || member === Symbol.iterator || member === Symbol.toStringTag) return undefined;
      return violation('requireSdk', member);
    },
  });
  const exports: Record<string, Record<string, unknown>> = {
    helperFs: { promises: fsNamespace, createWriteStream: createWriter },
    helperChildren: { spawn, fork },
    helperModule: { createRequire: (file: unknown) => { call('createRequire', [file]); if (file !== wranglerPackage) return violation('createRequire', String(file)); return requireSdk; } },
  };
  function factory(entry: FactoryIdentity) {
    const value = exports[entry.marker]; const members = qualification.revision.controlledExportAllowLists[entry.marker];
    if (!value || !members) throw new Error('Unknown behavioral factory.');
    return controlled(entry.marker, members, value);
  }
  const firstWriter = () => writers.find(writer => writer.file === path.join(owned, 'functions-build.log'));
  function requireClean() { if (violations.length) throw new AggregateError(violations.map(item => new Error(`${item.target}/${item.member}`)), 'Finite fixture access violation; no product failure interpretation is permitted.'); }
  function markDeadlineFailure() { if (failureSequence !== null) throw new Error('Failure already marked.'); failureSequence = sequence; }
  function freezeEndpoint() {
    endpointSequence = sequence;
    const writer = firstWriter(), child = children[0];
    return Object.freeze({ sequence: endpointSequence, calls: calls.slice(), writes: writes.map(write => ({ ...write })), owned, failureSequence,
      child: child ? { pid: child.pid, closed: child.closes > 0, exitCode: child.exitCode, signalCode: child.signalCode, kills: child.kills.slice() } : null,
      writer: writer ? { endRequested: writer.endRequested, finished: writer.finished, endAt: writer.endAt, pipes: writer.pipes, unpipes: writer.unpipes, errors: writer.errors.slice() } : null });
  }
  function releaseWrite() { const writer = firstWriter(); if (!writer?.heldWrite) throw new Error('No held native write callback.'); const callback = writer.heldWrite; writer.heldWrite = undefined; callback(); }
  function releaseFinal(error?: Error) { const writer = firstWriter(); if (!writer?.heldFinal) throw new Error('No held native final callback.'); const callback = writer.heldFinal; writer.heldFinal = undefined; callback(error); }
  async function releaseAlreadyCreated() {
    const writer = firstWriter();
    if (writer?.heldWrite) releaseWrite();
    await flushHelperNativeTurn();
    if (writer?.heldFinal) releaseFinal();
    if (mode.startsWith('H5') && children[0] && !children[0].closes) {
      children[0].stdout.write(Buffer.from('bounded late stdout\n'));
      await flushHelperNativeTurn();
      children[0].deliverClose(0);
    }
    await flushHelperNativeTurn();
    for (const state of writers) { if (!state.endRequested) state.native.end(); }
    for (const child of children) { child.stdout.destroy(); child.stderr.destroy(); }
    await flushHelperNativeTurn();
  }
  function postEndpointWork() {
    if (endpointSequence === null) throw new Error('Endpoint was not frozen.');
    const frozenSequence = endpointSequence;
    return calls.filter(entry => entry.sequence > frozenSequence && ['fs.readFile', 'fs.readdir', 'fs.copyFile', 'fs.writeFile', 'fs.mkdir', 'fs.mkdtemp', 'fs.symlink'].includes(entry.operation));
  }
  return { mode, project, dist, evidence, owned, corePins, calls, writes, violations, E_START, E_WRITE, E_GUARD, E_STREAM, E_DWRITE,
    factory, requireClean, compilerReady: compilerReady.promise, writerEnd: writerEnd.promise, hostReady: hostReady.promise,
    markDeadlineFailure, freezeEndpoint, releaseWrite, releaseFinal, releaseAlreadyCreated, postEndpointWork,
    children, firstWriter, failedLaunch, terminal };
}
