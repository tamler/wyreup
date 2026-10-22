import { afterEach, describe, expect, it, vi } from 'vitest';
import { wordCounter } from '../../core/src/tools/word-counter/index.js';
import { jsonFormatter } from '../../core/src/tools/json-formatter/index.js';
import {
  createLiveTextSession,
  allowsEmptyText,
  checkTextUnicode,
  LIVE_TEXT_BYTES,
  type LiveTextSnapshot,
  type LiveTextModule,
} from '../src/components/runners/liveTextState.js';

afterEach(() => vi.useRealTimers());
describe('live local text session', () => {
  function setup(module: LiveTextModule) {
    vi.useFakeTimers();
    const snapshots: LiveTextSnapshot[] = [];
    const session = createLiveTextSession({
      id: module.id,
      load: () => Promise.resolve(module),
      publish: (value) => snapshots.push(value),
    });
    return { session, snapshots, latest: () => snapshots.at(-1)! };
  }
  it('runs the actual empty word counter only after 300ms, preserving whitespace edits', async () => {
    const { session, latest } = setup(wordCounter);
    session.update('', {}, true);
    await vi.advanceTimersByTimeAsync(299);
    expect(latest().status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse(latest().text)).toMatchObject({ words: 0, characters: 0, utf8Bytes: 0 });
    session.update(' ', {}, true);
    expect(latest().blob).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(JSON.parse(latest().text)).toMatchObject({ characters: 1, utf8Bytes: 1 });
    session.dispose();
  });
  it('clears empty JSON, blocks invalid form fields, and recomputes changed parameters', async () => {
    const { session, latest } = setup(jsonFormatter);
    session.update('{"b":2,"a":1}', { indent: 0 }, true);
    await vi.advanceTimersByTimeAsync(300);
    expect(latest().text).toBe('{"b":2,"a":1}');
    session.update('{"b":2,"a":1}', { indent: 0, sortKeys: true }, true);
    await vi.advanceTimersByTimeAsync(300);
    expect(latest().text).toBe('{"a":1,"b":2}');
    session.update(' ', {}, true);
    expect(latest().status).toBe('idle');
    expect(latest().blob).toBeNull();
    session.update('{}', { indent: 20 }, false);
    await vi.advanceTimersByTimeAsync(300);
    expect(latest().status).toBe('idle');
    session.dispose();
  });
  it('bounds UTF8 input and rejects unpaired surrogates before File construction', () => {
    const { session, latest } = setup(wordCounter);
    session.update('é'.repeat(LIVE_TEXT_BYTES / 2 + 1), {}, true);
    expect(latest().error).toContain('1 MiB');
    session.update('\ud800', {}, true);
    expect(latest().status).toBe('error');
    expect(latest().error).toContain('surrogate');
    session.dispose();
  });
  it('rejects output bytes before reading oversized output text', async () => {
    const module = {
      ...wordCounter,
      defaults: { ...wordCounter.defaults },
      run: vi.fn(() => Promise.resolve([new Blob(['x'.repeat(LIVE_TEXT_BYTES + 1)])])),
    };
    const { session, latest } = setup(module);
    session.update('ok', {}, true);
    await vi.advanceTimersByTimeAsync(300);
    expect(latest().status).toBe('error');
    expect(latest().error).toContain('output exceeds');
    session.dispose();
  });
  it('does not run a tool whose module finishes loading after cancellation', async () => {
    vi.useFakeTimers();
    const run = vi.spyOn(wordCounter, 'run');
    let loaded: (value: LiveTextModule) => void = () => {};
    const snapshots: LiveTextSnapshot[] = [];
    const session = createLiveTextSession({
      id: 'word-counter',
      load: () =>
        new Promise((resolve) => {
          loaded = resolve;
        }),
      publish: (value) => snapshots.push(value),
    });
    try {
      session.update('a', {}, true);
      await vi.advanceTimersByTimeAsync(300);
      session.cancel();
      loaded(wordCounter);
      await Promise.resolve();
      expect(run).not.toHaveBeenCalled();
      expect(snapshots.at(-1)?.status).toBe('idle');
    } finally {
      session.dispose();
      run.mockRestore();
    }
  });
  it('ignores an output text read that finishes after input invalidation', async () => {
    let finish: (value: string) => void = () => {};
    const blob = new Blob(['old'], { type: 'application/json' });
    blob.text = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const { session, latest } = setup({
      id: 'word-counter',
      cost: 'free',
      run: () => Promise.resolve([blob]),
    });
    session.update('a', {}, true);
    await vi.advanceTimersByTimeAsync(300);
    session.update('b', {}, false);
    finish('{"stale":true}');
    await Promise.resolve();
    expect(latest().status).toBe('idle');
    expect(latest().blob).toBeNull();
    session.dispose();
  });
  it('blocks an oversized prepared output as well as the original artifact', async () => {
    vi.useFakeTimers();
    const snapshots: LiveTextSnapshot[] = [];
    const session = createLiveTextSession({
      id: 'word-counter',
      load: () => Promise.resolve(wordCounter),
      publish: (value) => snapshots.push(value),
      prepare: () => ({
        text: 'é'.repeat(LIVE_TEXT_BYTES),
        blob: new Blob(['é'.repeat(LIVE_TEXT_BYTES)]),
      }),
    });
    session.update('', {}, true);
    await vi.advanceTimersByTimeAsync(300);
    expect(snapshots.at(-1)).toMatchObject({ status: 'error', blob: null });
    expect(snapshots.at(-1)?.error).toContain('output exceeds');
    session.dispose();
  });
  it('ignores stale progress/error/success after changes, cancellation and disposal', async () => {
    const pending: {
      resolve: (value: Blob[]) => void;
      reject: (value: Error) => void;
      signal: AbortSignal;
      progress: (message: string) => void;
    }[] = [];
    const module = {
      ...wordCounter,
      defaults: { ...wordCounter.defaults },
      run: (
        _files: File[],
        _params: Record<string, unknown>,
        ctx: Parameters<LiveTextModule['run']>[2],
      ) =>
        new Promise<Blob[]>((resolve, reject) => {
          pending.push({
            resolve,
            reject,
            signal: ctx.signal,
            progress: (message) => ctx.onProgress({ stage: 'processing', message }),
          });
        }),
    };
    const { session, latest, snapshots } = setup(module);
    session.update('old', {}, true);
    await vi.advanceTimersByTimeAsync(300);
    session.update('new', {}, true);
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].progress('stale');
    pending[0].reject(new Error('stale error'));
    await Promise.resolve();
    expect(latest().error).toBe('');
    expect(latest().progress.message).not.toBe('stale');
    await vi.advanceTimersByTimeAsync(300);
    session.cancel();
    pending[1].resolve([new Blob(['stale success'])]);
    await Promise.resolve();
    expect(latest().status).toBe('idle');
    session.update('destroy', {}, true);
    await vi.advanceTimersByTimeAsync(300);
    session.dispose();
    const count = snapshots.length;
    pending[2].reject(new Error('late destroy'));
    await Promise.resolve();
    expect(snapshots).toHaveLength(count);
  });
  it('rejects nonallowlisted and paid tools without invoking their work', async () => {
    expect(() =>
      createLiveTextSession({
        id: 'javascript-minifier',
        load: () => Promise.resolve({ ...wordCounter, defaults: { ...wordCounter.defaults } }),
        publish: () => {},
      }),
    ).toThrow('automatic local');
    const run = vi.fn();
    const { session, latest } = setup({ ...wordCounter, cost: 'credit', run });
    session.update('a', {}, true);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).not.toHaveBeenCalled();
    expect(latest().status).toBe('error');
    session.dispose();
  });
  it('has the exact manual empty-input allowlist and original UTF8 byte input checks', () => {
    expect(allowsEmptyText('remove-duplicate-lines-online', {})).toBe(true);
    expect(allowsEmptyText('javascript-minifier', {})).toBe(true);
    expect(allowsEmptyText('number-base-converter', { conversionKind: 'utf8-bytes' })).toBe(true);
    expect(allowsEmptyText('number-base-converter', { conversionKind: 'numeric' })).toBe(false);
    expect(allowsEmptyText('markdown-table-generator', {})).toBe(false);
    expect(() =>
      checkTextUnicode('number-base-converter', { conversionKind: 'utf8-bytes' }, '\udfff'),
    ).toThrow('surrogate');
  });
});
