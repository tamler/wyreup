import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCsv, type CsvTable } from '../../src/utilities/csv-data.js';
import { runCsvFileJob, type CsvFileJob, type OwnedFileWorker } from '../../src/utilities/file-job.js';
import { handleFileJob } from '../../src/utilities/file-worker.js';

const job = (): CsvFileJob => ({ type: 'csv-parse', bytes: new TextEncoder().encode('a,b\n1,2'), params: { delimiter: 'comma', hasHeader: true } });
const table = (): CsvTable => parseCsv(job().bytes, job().params);
function mockWorker() {
  let received: ((value: unknown) => void) | undefined;
  let failed: ((error: Error) => void) | undefined;
  let sent: Record<string, unknown> | undefined;
  const terminate = vi.fn();
  const unlisten = vi.fn();
  const worker: OwnedFileWorker = {
    send(message) { sent = message as Record<string, unknown>; },
    listen(onMessage, onError) { received = onMessage; failed = onError; return unlisten; },
    terminate,
  };
  return { worker, terminate, unlisten, receive(value: unknown) { received?.(value); }, fail(error: Error) { failed?.(error); }, get sent() { return sent; } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });

describe('owned file-job lifecycle and protocol', () => {
  it('handles an actual CSV message and rejects unsupported requests without partial success', () => {
    const request = { jobId: 'fixture-1', ...job() };
    expect(handleFileJob(request)).toEqual({ jobId: 'fixture-1', ok: true, value: table() });
    for (const request of [null, {}, { jobId: 'fixture', ...job(), extra: true }, { jobId: 'fixture', ...job(), params: { delimiter: 'comma', hasHeader: 'yes' } }, { jobId: 'fixture', ...job(), bytes: new Uint8Array([0xc3]) }]) {
      expect(handleFileJob(request)).toMatchObject({ ok: false });
      expect(handleFileJob(request)).not.toHaveProperty('value');
    }
  });

  it('validates a complete result, removes listeners and terminates its owned worker', async () => {
    const own = mockWorker();
    const promise = runCsvFileJob(job(), new AbortController().signal, () => Promise.resolve(own.worker));
    await flush();
    own.receive({ jobId: own.sent!.jobId, ok: true, value: table() });
    expect(await promise).toEqual(table());
    expect(own.terminate).toHaveBeenCalledTimes(1);
    expect(own.unlisten).toHaveBeenCalledTimes(1);
    own.receive({ jobId: own.sent!.jobId, ok: false, error: 'late failure' });
    expect(own.terminate).toHaveBeenCalledTimes(1);
  });

  it('never creates a worker for already cancelled or over-budget input', async () => {
    const factory = vi.fn(() => Promise.resolve(mockWorker().worker));
    const controller = new AbortController(); controller.abort();
    await expect(runCsvFileJob(job(), controller.signal, factory)).rejects.toThrow(/cancelled/);
    await expect(runCsvFileJob({ ...job(), bytes: new Uint8Array(10 * 1024 * 1024 + 1) }, new AbortController().signal, factory)).rejects.toThrow(/10 MiB/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('aborts only its own concurrent job and ignores stale and mismatched messages', async () => {
    const first = mockWorker(), second = mockWorker();
    const cancelled = new AbortController();
    const firstPromise = runCsvFileJob(job(), cancelled.signal, () => Promise.resolve(first.worker));
    const firstFailure = expect(firstPromise).rejects.toThrow(/cancelled/);
    const secondPromise = runCsvFileJob(job(), new AbortController().signal, () => Promise.resolve(second.worker));
    await flush();
    expect(first.sent!.jobId).not.toBe(second.sent!.jobId);
    second.receive({ jobId: first.sent!.jobId, ok: true, value: table() });
    expect(second.terminate).not.toHaveBeenCalled();
    cancelled.abort(); await firstFailure;
    first.receive({ jobId: first.sent!.jobId, ok: true, value: table() });
    second.receive({ jobId: second.sent!.jobId, ok: true, value: table() });
    expect(await secondPromise).toEqual(table());
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(second.terminate).toHaveBeenCalledTimes(1);
  });

  it('owns the deadline while factory creation is pending and terminates late-created workers', async () => {
    vi.useFakeTimers();
    const own = mockWorker();
    let create!: (value: OwnedFileWorker) => void;
    const promise = runCsvFileJob(job(), new AbortController().signal, () => new Promise(resolve => { create = resolve; }));
    const failure = expect(promise).rejects.toThrow(/30-second/);
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    await failure;
    create(own.worker); await flush();
    expect(own.terminate).toHaveBeenCalledTimes(1);
    expect(own.sent).toBeUndefined();
  });

  it('rejects malformed tables, worker failures and creation failures', async () => {
    for (const value of [null, { ...table(), rows: [{ id: 'r1', sourceRow: 2, originalWidth: 2, cells: [true, '2'] }] }]) {
      const own = mockWorker();
      const promise = runCsvFileJob(job(), new AbortController().signal, () => Promise.resolve(own.worker));
      const failure = expect(promise).rejects.toThrow();
      await flush(); own.receive({ jobId: own.sent!.jobId, ok: true, value }); await failure;
      expect(own.terminate).toHaveBeenCalledTimes(1);
    }
    const own = mockWorker();
    const promise = runCsvFileJob(job(), new AbortController().signal, () => Promise.resolve(own.worker));
    const failure = expect(promise).rejects.toThrow('worker failed');
    await flush(); own.fail(new Error('worker failed')); await failure;
    expect(own.unlisten).toHaveBeenCalledTimes(1);
    await expect(runCsvFileJob(job(), new AbortController().signal, () => Promise.reject(new Error('factory failed')))).rejects.toThrow('factory failed');
  });
});
