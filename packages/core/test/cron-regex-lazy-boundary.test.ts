import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { ToolModule, ToolProgress, ToolRunContext } from '../src/types.js';

type Family = 'cron' | 'regex' | 'explain';
type Exports = Record<string, unknown>;
type FileOperand = { constructor: string; name: string; type: string; lastModified: number; utf8: string };
type RunCase = { id: string; tool: string; inputs: FileOperand[]; params: Record<string, unknown> };
type FixedData = { publicCron: string[]; publicRegex: string[][]; publicExplain: string[]; bothPublicNoMatch: string; bothPublicReject: string[]; publicExplainReject: string[]; runCases: RunCase[]; fileAwaitCancellation: RunCase[] };
const E = '/private/tmp/wyreup-catalog-evidence';
const R = '/private/tmp/wyreup-release-integration-20261018';
const DATA = E + '/bundle-cron-regex-second-correction-plan-202/compatibility-data.json';
const DATA_SHA = '9863fd461f763dadd643bf713d7c29ef20ad6afb989cfe726a867fe1434bac3e';
const BEFORE = E + '/bundle-cron-regex-compatibility-before-203';
const AFTER = E + '/bundle-cron-regex-compatibility-after-203';
const MAX = 1048576;
const COHORT = 8388608;
const collectorMode = process.env.WYREUP_BUNDLE_COLLECTOR;
if (collectorMode !== undefined && collectorMode !== 'BEFORE' && collectorMode !== 'AFTER') throw Error('Invalid bundle collector admission');
const families: Family[] = ['cron', 'regex', 'explain'];
const exported = { cron: 'cronFromText', regex: 'regexFromText', explain: 'regexExplain' } as const;
const ids = { cron: 'cron-from-text', regex: 'regex-from-text', explain: 'regex-explain' } as const;
const functionName = { cron: 'generateCronFromText', regex: 'generateRegexFromText', explain: 'explainRegex' } as const;
const PUBLIC_VECTORS: Pick<FixedData, 'publicCron' | 'publicRegex' | 'publicExplain' | 'bothPublicNoMatch' | 'bothPublicReject' | 'publicExplainReject'> = {
  publicCron: ['every minute','every 15 minutes','every hour','every 6 hours','every day at midnight','every day at noon','every day at 9am','every Monday at 9am','weekdays at 8:30am','weekends at 10pm','first of the month at midnight','last day of the month at midnight'],
  publicRegex: [['match email addresses'],['find URLs'],['extract phone numbers'],['find ISO dates'],['extract uuids'],['match hex colors'],['find credit card numbers'],['extract ipv4 addresses'],['match semantic versions'],['match percentages'],['match email addresses case insensitive','g']],
  publicExplain: ['/abc/','/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/','/\\d{4}-\\d{2}-\\d{2}/','/abc/i','/abc/g','abc'],
  bothPublicNoMatch: 'the moon orbits the earth', bothPublicReject: ['', '   '], publicExplainReject: ['', '   ', '[unclosed']
};
const FILE_AWAIT_CASES: (RunCase & { ownedSeam: string })[] = [
  { id: 'cron-file-await-abort', tool: 'cronFromText', inputs: [{ constructor: 'actual File', name: 'schedule.txt', type: 'text/plain', lastModified: 0, utf8: '\n every weekday at 9am \n' }], params: { mode: 'text', description: '' }, ownedSeam: 'actual File.slice returns real Blob; defer that Blob.arrayBuffer promise' },
  { id: 'regex-file-await-abort', tool: 'regexFromText', inputs: [{ constructor: 'actual File', name: 'request.txt', type: 'text/plain', lastModified: 0, utf8: '\n match email addresses \n' }], params: { description: '', flags: '' }, ownedSeam: 'defer actual File.text promise' },
  { id: 'explain-file-await-abort', tool: 'regexExplain', inputs: [{ constructor: 'actual File', name: 'pattern.txt', type: 'text/plain', lastModified: 0, utf8: '\n /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/ \n' }], params: { pattern: '' }, ownedSeam: 'defer actual File.text promise' }
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function cleanMocks() {
  vi.doUnmock('../src/tools/cron-from-text/index.js');
  vi.doUnmock('../src/tools/regex-from-text/index.js');
  vi.doUnmock('../src/tools/regex-explain/index.js');
  vi.resetModules();
}
beforeEach(cleanMocks);
afterEach(cleanMocks);
function index(family: Family): Promise<Exports> {
  if (family === 'cron') return import('../src/tools/cron-from-text/index.js');
  if (family === 'regex') return import('../src/tools/regex-from-text/index.js');
  return import('../src/tools/regex-explain/index.js');
}
function actualIndex(family: Family) {
  if (family === 'cron') return vi.importActual<Exports>('../src/tools/cron-from-text/index.js');
  if (family === 'regex') return vi.importActual<Exports>('../src/tools/regex-from-text/index.js');
  return vi.importActual<Exports>('../src/tools/regex-explain/index.js');
}
function mockIndex(family: Family, factory: () => Exports | Promise<Exports>) {
  if (family === 'cron') vi.doMock('../src/tools/cron-from-text/index.js', factory);
  else if (family === 'regex') vi.doMock('../src/tools/regex-from-text/index.js', factory);
  else vi.doMock('../src/tools/regex-explain/index.js', factory);
}
function fresh(id: string, processingAbort = false) {
  const controller = new AbortController();
  const progress: ToolProgress[] = [];
  const context: ToolRunContext = { onProgress: p => {
    progress.push({ ...p });
    if (processingAbort && p.stage === 'processing' && p.percent === 50) controller.abort();
  }, signal: controller.signal, cache: new Map<string, unknown>(), executionId: id };
  return { controller, progress, context };
}
function tool(module: Exports, family: Family) { return module[exported[family]] as ToolModule<unknown>; }
function familyFor(name: string): Family {
  if (name === 'cronFromText') return 'cron';
  if (name === 'regexFromText') return 'regex';
  expect(name).toBe('regexExplain'); return 'explain';
}
function file(operand: FileOperand) {
  expect(operand.constructor).toBe('actual File');
  return new File([operand.utf8], operand.name, { type: operand.type, lastModified: operand.lastModified });
}
function deferredFile(operand: FileOperand, family: Family) {
  const value = file(operand);
  const entered = deferred<void>();
  const release = deferred<void>();
  let owned: Promise<string | ArrayBuffer> | undefined;
  let entries = 0;
  if (family === 'cron') {
    const slice = value.slice.bind(value);
    Object.defineProperty(value, 'slice', { value: (start?: number, end?: number, contentType?: string) => {
      const blob = slice(start, end, contentType);
      const read = blob.arrayBuffer.bind(blob);
      Object.defineProperty(blob, 'arrayBuffer', { value: () => {
        entries++; owned = release.promise.then(() => read()); entered.resolve(); return owned;
      } });
      return blob;
    } });
  } else {
    const read = value.text.bind(value);
    Object.defineProperty(value, 'text', { value: () => {
      entries++; owned = release.promise.then(() => read()); entered.resolve(); return owned;
    } });
  }
  return { file: value, entered: entered.promise, release: () => release.resolve(),
    drain: async () => { expect(owned).toBeDefined(); await owned; }, entries: () => entries };
}
async function outcome(run: Promise<Blob | Blob[]>) {
  try { return { kind: 'return' as const, value: await run }; }
  catch (error) { return { kind: 'reject' as const, error }; }
}
function aborted(result: Awaited<ReturnType<typeof outcome>>) {
  expect(result.kind).toBe('reject');
  if (result.kind === 'reject') { expect(result.error).toBeInstanceOf(Error); expect((result.error as Error).message).toBe('Aborted'); }
}
function nine(s: fs.BigIntStats) {
  return [s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String);
}
type Owner = { path: string; operation: string; closeAttempted: boolean; closed: boolean; pending: boolean; eof?: boolean; positiveBytes: number; secondaryCloseErrorType?: string };
type Meter = { used: number; owners: Owner[] };
function charge(meter: Meter, n: number) { expect(Number.isSafeInteger(n) && n >= 0 && meter.used + n <= COHORT).toBe(true); meter.used += n; }
function readClosed(path: string, meter: Meter) {
  const initial = fs.lstatSync(path, { bigint: true });
  expect(initial.isFile() && initial.nlink === 1n && initial.size >= 0n && initial.size <= BigInt(MAX)).toBe(true);
  expect(meter.used + Number(initial.size) + 1 <= COHORT).toBe(true);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const owner: Owner = { path, operation: 'read', closeAttempted: false, closed: false, pending: true, positiveBytes: 0, eof: false };
  meter.owners.push(owner);
  let first: unknown; const chunks: Buffer[] = [];
  try {
    expect(nine(fs.fstatSync(fd, { bigint: true }))).toEqual(nine(initial));
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, Number(initial.size) - owner.positiveBytes + 1));
      const n = fs.readSync(fd, buffer, 0, buffer.length, null); owner.positiveBytes += n; charge(meter, n);
      if (!n) { owner.eof = true; break; }
      expect(owner.positiveBytes <= Number(initial.size)).toBe(true); chunks.push(buffer.subarray(0, n));
    }
    expect(nine(fs.fstatSync(fd, { bigint: true }))).toEqual(nine(initial));
  } catch (error) { first = error; }
  finally {
    owner.closeAttempted = true;
    try { fs.closeSync(fd); owner.closed = true; owner.pending = false; }
    catch (error) { if (first !== undefined) owner.secondaryCloseErrorType = (error as Error).constructor.name; else first = error; }
  }
  if (first !== undefined) throw first as Error;
  expect(nine(fs.lstatSync(path, { bigint: true }))).toEqual(nine(initial));
  const body = Buffer.concat(chunks);
  expect(body.length).toBe(Number(initial.size));
  return { body, pin: { path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), physicalNine: nine(initial) } };
}
function fixed() {
  const result = readClosed(DATA, { used: 0, owners: [] }); expect(result.pin.sha256).toBe(DATA_SHA);
  return JSON.parse(result.body.toString('utf8')) as FixedData;
}
function metadata(value: ToolModule<unknown>) {
  return { keys: Object.keys(value), metadataJSON: JSON.stringify(Object.keys(value).filter(k => k !== 'run').map(k => [k, Reflect.get(value, k) as unknown])) };
}
async function genuine() {
  const modules = { cron: await index('cron'), regex: await index('regex'), explain: await index('explain') };
  const root = await import('../src/index.js');
  const registry = await import('../src/default-registry.js');
  const created = registry.createDefaultRegistry();
  for (const family of families) {
    const value = tool(modules[family], family);
    expect((root as unknown as Exports)[exported[family]]).toBe(value);
    expect((root as unknown as Exports)[functionName[family]]).toBe(modules[family][functionName[family]]);
    expect(registry.defaultTools.find(t => t.id === ids[family])).toBe(value);
    const registered = created.toolsById.get(ids[family]); expect(registered).toBeDefined();
    for (const key of Object.keys(value).filter(k => k !== 'run')) expect(Reflect.get(registered as object, key)).toEqual(Reflect.get(value, key));
    expect(typeof registered?.run).toBe('function');
  }
  return modules;
}

describe('bundle lazy mock qualifier', () => {
  for (const family of families) {
    for (const concurrentAbort of [false, true]) it(`${family} existing literal index getter exact identity abort=${concurrentAbort}`, async () => {
      const actual = await actualIndex(family); const sentinel = Error('QUALIFIER_SENTINEL'); const controller = new AbortController(); let entered = 0;
      mockIndex(family, () => {
        entered++; const exports = { ...actual };
        Object.defineProperty(exports, 'then', { get() { if (concurrentAbort) controller.abort(); throw sentinel; } });
        return exports;
      });
      const pending = index(family); const result = await pending.then(() => undefined, (error: unknown) => error);
      expect(result).toBe(sentinel); expect(entered).toBe(1); expect(controller.signal.aborted).toBe(concurrentAbort);
    });
    it(`${family} existing literal index genuine deferred factory enters releases and drains`, async () => {
      const actual = await actualIndex(family); const entered = deferred<void>(); const release = deferred<void>(); let own: Promise<Exports> | undefined;
      mockIndex(family, () => { own = release.promise.then(() => actual); entered.resolve(); return own; });
      const pending = index(family); await entered.promise; expect(own).toBeDefined(); release.resolve();
      const result = await pending; await own; expect(result[functionName[family]]).toBe(actual[functionName[family]]);
    });
  }
});

describe('bundle existing cancellation', () => {
  for (const family of families) {
    it(`${family} pre-aborted existing public run refuses before progress or output`, async () => {
      const module = await index(family); const x = fresh(`pre-aborted-${family}`); x.controller.abort();
      const params = family === 'cron' ? { mode: 'text', description: 'every weekday at 9am' } : family === 'regex' ? { description: 'match email addresses', flags: 'gi' } : { pattern: '/abc/i' };
      const result = await outcome(tool(module, family).run([], params, x.context)); aborted(result); expect(x.progress).toEqual([]);
    });
    it(`${family} actual File await abort refuses before progress or output`, async () => {
      const entry = FILE_AWAIT_CASES.find(c => familyFor(c.tool) === family); expect(entry).toBeDefined();
      const chosen = entry as RunCase; const module = await index(family); const fixture = deferredFile(chosen.inputs[0] as FileOperand, family); const x = fresh(chosen.id);
      const pending = outcome(tool(module, family).run([fixture.file], { ...chosen.params }, x.context));
      await fixture.entered; x.controller.abort(); fixture.release(); const result = await pending; await fixture.drain();
      expect(fixture.entries()).toBe(1); aborted(result); expect(x.progress).toEqual([]);
    });
    it(`${family} processing callback abort refuses done and output`, async () => {
      const module = await index(family); const x = fresh(`processing-abort-${family}`, true);
      const params = family === 'cron' ? { mode: 'text', description: 'every weekday at 9am' } : family === 'regex' ? { description: 'match email addresses', flags: 'gi' } : { pattern: '/abc/i' };
      const result = await outcome(tool(module, family).run([], params, x.context)); aborted(result);
      expect(x.progress.map(p => p.stage)).toEqual(['processing']);
    });
  }
});

function publicValues(modules: Record<Family, Exports>, data: typeof PUBLIC_VECTORS) {
  const call = (family: Family, args: string[]) => {
    try { return { kind: 'return', value: (modules[family][functionName[family]] as (...a: string[]) => unknown)(...args) }; }
    catch (error) { const e = error as Error; expect(e.message.length <= 4096).toBe(true); return { kind: 'reject', errorType: e.constructor.name, message: e.message }; }
  };
  return {
    cron: data.publicCron.map(v => ({ args: [v], result: call('cron', [v]) })),
    regex: data.publicRegex.map(args => ({ args, result: call('regex', args) })),
    explain: data.publicExplain.map(v => ({ args: [v], result: call('explain', [v]) })),
    noMatch: ['cron','regex'].map(f => ({ family: f, result: call(f as Family, [data.bothPublicNoMatch]) })),
    rejects: families.map(f => ({ family: f, results: (f === 'explain' ? data.publicExplainReject : data.bothPublicReject).map(v => call(f, [v])) }))
  };
}
function writeClosed(root: string, name: string, body: Buffer, meter: Meter) {
  expect(/^[a-z0-9.-]+$/.test(name) && body.length <= MAX && meter.used + 2 * body.length + 1 <= COHORT).toBe(true);
  const path = root + '/' + name; const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  const owner: Owner = { path, operation: 'write', closeAttempted: false, closed: false, pending: true, positiveBytes: 0 };
  meter.owners.push(owner); let first: unknown; let finalNine: string[] | undefined;
  try {
    while (owner.positiveBytes < body.length) { const n = fs.writeSync(fd, body, owner.positiveBytes, body.length - owner.positiveBytes); owner.positiveBytes += n; charge(meter, n); expect(n > 0).toBe(true); }
    fs.fsyncSync(fd); finalNine = nine(fs.fstatSync(fd, { bigint: true }));
  } catch (error) { first = error; }
  finally {
    owner.closeAttempted = true;
    try { fs.closeSync(fd); owner.closed = true; owner.pending = false; }
    catch (error) { if (first !== undefined) owner.secondaryCloseErrorType = (error as Error).constructor.name; else first = error; }
  }
  if (first !== undefined) throw first as Error;
  expect(nine(fs.lstatSync(path, { bigint: true }))).toEqual(finalNine);
  const closed = readClosed(path, meter); expect(closed.body.equals(body)).toBe(true); expect(closed.pin.physicalNine).toEqual(finalNine);
  return closed.pin;
}
function snapshot(mode: 'BEFORE' | 'AFTER', meter: Meter) {
  const paths = ['packages/core/src/tools/cron-from-text/index.ts','packages/core/src/tools/regex-from-text/index.ts','packages/core/src/tools/regex-explain/index.ts','packages/core/src/default-registry.ts','packages/core/src/index.ts','packages/core/src/tools/regex-from-text/patterns.ts','packages/core/src/lib/regex-safety.ts','packages/core/src/types.ts','packages/core/test/cron-regex-lazy-boundary.test.ts','packages/core/test/cron-regex-lazy-await.test.ts','packages/web/test/fixtures/CronUtilityHarness.svelte','packages/web/test/fixtures/CronPreloadOwnedHarness.svelte','packages/core/package.json','vitest.config.ts'];
  if (mode === 'AFTER') paths.push(...['cron-from-text/tool.ts','cron-from-text/generate.ts','regex-from-text/tool.ts','regex-from-text/generate.ts','regex-explain/tool.ts','regex-explain/explain.ts'].map(p => 'packages/core/src/tools/' + p));
  return paths.map(p => readClosed(R + '/' + p, meter).pin);
}
async function collect(mode: 'BEFORE' | 'AFTER') {
  const root = mode === 'BEFORE' ? BEFORE : AFTER; const meter: Meter = { used: 0, owners: [] };
  expect(fs.realpathSync(E)).toBe(E); const parent = fs.lstatSync(E); expect(parent.isDirectory() && parent.uid === 501).toBe(true);
  fs.mkdirSync(root, { mode: 0o700 }); expect(fs.realpathSync(root)).toBe(root); expect(fs.lstatSync(root).mode & 0o777).toBe(0o700);
  const sourcesBefore = snapshot(mode, meter); const data = fixed(); const modules = await genuine();
  const vectors = publicValues(modules, PUBLIC_VECTORS);
  const metadataRows = families.map(f => ({ family: f, ...metadata(tool(modules[f], f)) }));
  const runs = [];
  for (let i = 0; i < data.runCases.length; i++) {
    const c = data.runCases[i] as RunCase; const x = fresh(c.id); const family = familyFor(c.tool);
    const returned = await tool(modules[family], family).run(c.inputs.map(file), { ...c.params }, x.context);
    const blobs = Array.isArray(returned) ? returned : [returned]; expect(blobs.length).toBe(1);
    const blob = blobs[0] as Blob; expect(blob instanceof Blob && blob.size <= MAX).toBe(true);
    const bytes = Buffer.from(await blob.arrayBuffer()); expect(bytes.length).toBe(blob.size);
    const rawPin = writeClosed(root, `run-${i}.blob`, bytes, meter); const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    runs.push({ id: c.id, executionId: x.context.executionId, mime: blob.type, bytes: bytes.length, base64: bytes.toString('base64'), orderedJSON: text, parsedJSON: JSON.parse(text) as unknown, progress: x.progress, rawPin });
  }
  const cancellation = [];
  for (const c of data.fileAwaitCancellation) {
    const family = familyFor(c.tool); const fixture = deferredFile(c.inputs[0] as FileOperand, family); const x = fresh(c.id);
    const pending = outcome(tool(modules[family], family).run([fixture.file], { ...c.params }, x.context));
    await fixture.entered; x.controller.abort(); fixture.release(); const result = await pending; await fixture.drain();
    cancellation.push({ id: c.id, kind: result.kind, errorType: result.kind === 'reject' ? (result.error as Error).constructor.name : null, message: result.kind === 'reject' ? String((result.error as Error).message) : null, progress: x.progress, resultCount: result.kind === 'return' ? (Array.isArray(result.value) ? result.value.length : 1) : 0, ownedReadSettled: true, readEntries: fixture.entries() });
  }
  if (mode === 'AFTER') {
    const prior = JSON.parse(readClosed(BEFORE + '/report.json', meter).body.toString('utf8')) as { vectors: unknown; metadataRows: unknown; runs: { rawPin: unknown }[] };
    expect(JSON.stringify(vectors)).toBe(JSON.stringify(prior.vectors)); expect(metadataRows).toEqual(prior.metadataRows);
    const comparable = (rows: { rawPin: unknown }[]) => rows.map(({ rawPin: _rawPin, ...rest }) => rest);
    expect(comparable(runs)).toEqual(comparable(prior.runs));
    for (let i = 0; i < runs.length; i++) expect(readClosed(BEFORE + `/run-${i}.blob`, meter).body.toString('base64')).toBe(runs[i]?.base64);
    for (const row of cancellation) { expect(row.kind).toBe('reject'); expect(row.message).toBe('Aborted'); expect(row.progress).toEqual([]); expect(row.resultCount).toBe(0); }
  }
  const sourcesAfter = snapshot(mode, meter); expect(sourcesAfter).toEqual(sourcesBefore);
  expect(meter.owners.every(o => o.closed && !o.pending && o.closeAttempted && (o.operation === 'write' || o.eof))).toBe(true);
  const report = Buffer.from(JSON.stringify({ classification: 'COMPATIBILITY_NOT_ORACLE', mode, vectors, metadataRows, runs, cancellation, sourcesBefore, sourcesAfter, positiveCaptureAndSourceIOBeforeReport: meter.used, ownersBeforeReport: meter.owners }));
  writeClosed(root, 'report.json', report, meter);
  expect(fs.readdirSync(root).sort()).toEqual(['report.json', ...runs.map((_,i) => `run-${i}.blob`)].sort());
}
it.skipIf(collectorMode !== 'BEFORE')('bundle compatibility BEFORE fixed9 public vectors metadata and raw outputs', async () => { await collect('BEFORE'); });
it.skipIf(collectorMode !== 'AFTER')('bundle compatibility AFTER fixed9 exact original comparison', async () => { await collect('AFTER'); });
it('bundle genuine original root barrel defaultTools identity', async () => { await genuine(); });
