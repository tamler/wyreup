import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolModule, ToolProgress, ToolRunContext } from '../src/types.js';

// AFTER-only: Root does not load this file for the existing-module qualifier or BEFORE.
type Family = 'cron' | 'regex' | 'explain';
type Exports = Record<string, unknown>;
type FileOperand = { constructor: string; name: string; type: string; lastModified: number; utf8: string };
type FileCase = { id: string; tool: string; inputs: FileOperand[]; params: Record<string, unknown>; ownedSeam: string };
const families: Family[] = ['cron', 'regex', 'explain'];
const toolName = { cron: 'cronFromText', regex: 'regexFromText', explain: 'regexExplain' } as const;
const fnName = { cron: 'generateCronFromText', regex: 'generateRegexFromText', explain: 'explainRegex' } as const;
const ids = { cron: 'cron-from-text', regex: 'regex-from-text', explain: 'regex-explain' } as const;
const engines = { cron: '../src/tools/cron-from-text/generate.js', regex: '../src/tools/regex-from-text/generate.js', explain: '../src/tools/regex-explain/explain.js' } as const;
const lights = { cron: '../src/tools/cron-from-text/tool.js', regex: '../src/tools/regex-from-text/tool.js', explain: '../src/tools/regex-explain/tool.js' } as const;
const FILE_AWAIT_CASES: FileCase[] = [
  { id: 'cron-file-await-abort', tool: 'cronFromText', inputs: [{ constructor: 'actual File', name: 'schedule.txt', type: 'text/plain', lastModified: 0, utf8: '\n every weekday at 9am \n' }], params: { mode: 'text', description: '' }, ownedSeam: 'actual File.slice returns real Blob; defer that Blob.arrayBuffer promise' },
  { id: 'regex-file-await-abort', tool: 'regexFromText', inputs: [{ constructor: 'actual File', name: 'request.txt', type: 'text/plain', lastModified: 0, utf8: '\n match email addresses \n' }], params: { description: '', flags: '' }, ownedSeam: 'defer actual File.text promise' },
  { id: 'explain-file-await-abort', tool: 'regexExplain', inputs: [{ constructor: 'actual File', name: 'pattern.txt', type: 'text/plain', lastModified: 0, utf8: '\n /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/ \n' }], params: { pattern: '' }, ownedSeam: 'defer actual File.text promise' }
];
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve };
}
function clean() {
  vi.doUnmock('../src/tools/cron-from-text/generate.js');
  vi.doUnmock('../src/tools/regex-from-text/generate.js');
  vi.doUnmock('../src/tools/regex-explain/explain.js');
  vi.doUnmock('../src/tools/cron-from-text/tool.js');
  vi.doUnmock('../src/tools/regex-from-text/tool.js');
  vi.doUnmock('../src/tools/regex-explain/tool.js');
  vi.resetModules();
}
beforeEach(clean);
afterEach(clean);
function mockEngine(f: Family, factory: () => Exports | Promise<Exports>) {
  if (f === 'cron') vi.doMock('../src/tools/cron-from-text/generate.js', factory);
  else if (f === 'regex') vi.doMock('../src/tools/regex-from-text/generate.js', factory);
  else vi.doMock('../src/tools/regex-explain/explain.js', factory);
}
function light(f: Family): Promise<Exports> { const path = lights[f]; return import(path) as Promise<Exports>; }
function engine(f: Family): Promise<Exports> { const path = engines[f]; return import(path) as Promise<Exports>; }
function actualEngine(f: Family) { return vi.importActual<Exports>(engines[f]); }
function index(f: Family): Promise<Exports> {
  if (f === 'cron') return import('../src/tools/cron-from-text/index.js');
  if (f === 'regex') return import('../src/tools/regex-from-text/index.js');
  return import('../src/tools/regex-explain/index.js');
}
function fresh(id: string, processingAbort = false) {
  const controller = new AbortController(); const progress: ToolProgress[] = [];
  const context: ToolRunContext = { onProgress: p => { progress.push({ ...p }); if (processingAbort && p.stage === 'processing' && p.percent === 50) controller.abort(); }, signal: controller.signal, cache: new Map<string, unknown>(), executionId: id };
  return { controller, progress, context };
}
const params = (f: Family): Record<string, unknown> => f === 'cron' ? { mode: 'text', description: 'every weekday at 9am' } : f === 'regex' ? { description: 'match email addresses', flags: 'gi' } : { pattern: '/abc/i' };
async function outcome(promise: Promise<Blob | Blob[]>) {
  try { return { kind: 'return' as const, value: await promise }; }
  catch (error) { return { kind: 'reject' as const, error }; }
}
function expectAbort(result: Awaited<ReturnType<typeof outcome>>) {
  expect(result.kind).toBe('reject');
  if (result.kind === 'reject') { expect(result.error).toBeInstanceOf(Error); expect((result.error as Error).message).toBe('Aborted'); }
}
async function instrument(f: Family) {
  const genuine = await actualEngine(f); const module = await light(f); const publicTool = module[toolName[f]] as ToolModule<unknown>;
  let calls = 0;
  const real = genuine[fnName[f]]; expect(typeof real).toBe('function');
  const wrapped: Exports = { ...genuine, [fnName[f]]: (...args: unknown[]) => { calls++; return (real as (...a: unknown[]) => unknown)(...args); } };
  return { genuine, publicTool, wrapped, calls: () => calls };
}
function fileBarrier(v: FileOperand, f: Family) {
  const value = new File([v.utf8], v.name, { type: v.type, lastModified: v.lastModified });
  const entered = deferred<void>(); const release = deferred<void>(); let owned: Promise<unknown> | undefined; let entries = 0;
  if (f === 'cron') {
    const slice = value.slice.bind(value);
    Object.defineProperty(value, 'slice', { value: (start?: number, end?: number, contentType?: string) => {
      const blob = slice(start, end, contentType); const read = blob.arrayBuffer.bind(blob);
      Object.defineProperty(blob, 'arrayBuffer', { value: () => { entries++; owned = release.promise.then(() => read()); entered.resolve(); return owned; } }); return blob;
    } });
  } else {
    const read = value.text.bind(value);
    Object.defineProperty(value, 'text', { value: () => { entries++; owned = release.promise.then(() => read()); entered.resolve(); return owned; } });
  }
  return { value, entered: entered.promise, release: () => release.resolve(), entries: () => entries, drain: async () => { expect(owned).toBeDefined(); await owned; } };
}

describe('bundle AFTER genuine light engine identity', () => {
  for (const f of families) it(`${f} public root old barrel light singleton and sync function`, async () => {
    const actualLight = await light(f); const barrel = await index(f); const actualEngineModule = await engine(f);
    const root = await import('../src/index.js'); const registry = await import('../src/default-registry.js');
    expect(actualLight[toolName[f]]).toBe(barrel[toolName[f]]);
    expect((root as unknown as Exports)[toolName[f]]).toBe(barrel[toolName[f]]);
    expect(registry.defaultTools.find(t => t.id === ids[f])).toBe(barrel[toolName[f]]);
    expect(barrel[fnName[f]]).toBe(actualEngineModule[fnName[f]]);
    expect((root as unknown as Exports)[fnName[f]]).toBe(actualEngineModule[fnName[f]]);
  });
});

describe('bundle AFTER actual dynamic edge lifecycle', () => {
  for (const f of families) {
    it(`${f} factory entered then fulfilled after abort never invokes algorithm`, async () => {
      const x = await instrument(f); const entered = deferred<void>(); const release = deferred<void>(); const context = fresh(`pending-import-${f}`); let factoryEntries = 0; let own: Promise<Exports> | undefined;
      mockEngine(f, () => { factoryEntries++; own = release.promise.then(() => x.wrapped); entered.resolve(); return own; });
      const pending = outcome(x.publicTool.run([], params(f), context.context)); await entered.promise;
      expect(factoryEntries).toBe(1); context.controller.abort(); expect(x.calls()).toBe(0); release.resolve();
      const result = await pending; await own; expectAbort(result); expect(x.calls()).toBe(0); expect(factoryEntries).toBe(1); expect(context.progress.map(p => p.stage)).toEqual(['processing']);
    });
    for (const concurrentAbort of [false, true]) it(`${f} qualified getter rejects exact sentinel abort=${concurrentAbort}`, async () => {
      const x = await instrument(f); const context = fresh(`import-reject-${f}-${concurrentAbort}`); const sentinel = Error('ACTUAL_IMPORT_SENTINEL'); let entries = 0;
      mockEngine(f, () => {
        entries++; const value = { ...x.wrapped };
        Object.defineProperty(value, 'then', { get() { if (concurrentAbort) context.controller.abort(); throw sentinel; } }); return value;
      });
      const result = await outcome(x.publicTool.run([], params(f), context.context)); expect(result.kind).toBe('reject');
      if (result.kind === 'reject') expect(result.error).toBe(sentinel);
      expect(entries).toBe(1); expect(context.controller.signal.aborted).toBe(concurrentAbort); expect(x.calls()).toBe(0); expect(context.progress.map(p => p.stage)).toEqual(['processing']);
    });
    it(`${f} actual algorithm rejection preserves exact reference`, async () => {
      const x = await instrument(f); const context = fresh(`algorithm-reject-${f}`); const sentinel = Error('ACTUAL_ALGORITHM_SENTINEL'); let calls = 0;
      mockEngine(f, () => ({ ...x.genuine, [fnName[f]]: () => { calls++; throw sentinel; } }));
      const result = await outcome(x.publicTool.run([], params(f), context.context)); expect(result.kind).toBe('reject');
      if (result.kind === 'reject') expect(result.error).toBe(sentinel);
      expect(calls).toBe(1); expect(context.progress.map(p => p.stage)).toEqual(['processing']);
    });
    it(`${f} pre-abort refuses before import algorithm progress and output`, async () => {
      const x = await instrument(f); const context = fresh(`pre-abort-instrumented-${f}`); let entries = 0; mockEngine(f, () => { entries++; return x.wrapped; }); context.controller.abort();
      const result = await outcome(x.publicTool.run([], params(f), context.context)); expectAbort(result); expect(entries).toBe(0); expect(x.calls()).toBe(0); expect(context.progress).toEqual([]);
    });
    it(`${f} processing abort refuses before import algorithm done and output`, async () => {
      const x = await instrument(f); const context = fresh(`processing-abort-instrumented-${f}`, true); let entries = 0; mockEngine(f, () => { entries++; return x.wrapped; });
      const result = await outcome(x.publicTool.run([], params(f), context.context)); expectAbort(result); expect(entries).toBe(0); expect(x.calls()).toBe(0); expect(context.progress.map(p => p.stage)).toEqual(['processing']);
    });
    it(`${f} actual File abort after entered read refuses algorithm import progress and output`, async () => {
      const x = await instrument(f); const chosen = FILE_AWAIT_CASES.find(c => c.tool === toolName[f]); expect(chosen).toBeDefined();
      const c = chosen as FileCase; const barrier = fileBarrier(c.inputs[0] as FileOperand, f); const context = fresh(c.id); let entries = 0;
      mockEngine(f, () => { entries++; return x.wrapped; });
      const pending = outcome(x.publicTool.run([barrier.value], { ...c.params }, context.context)); await barrier.entered; context.controller.abort(); barrier.release();
      const result = await pending; await barrier.drain(); expectAbort(result); expect(barrier.entries()).toBe(1); expect(entries).toBe(0); expect(x.calls()).toBe(0); expect(context.progress).toEqual([]);
    });
  }
});
