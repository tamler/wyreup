import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPro } from '../../src/lib/pro-runner.js';
import type { ToolRunContext } from '../../src/types.js';

function makeCtx(overrides: Partial<ToolRunContext> = {}): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map<string, unknown>(),
    executionId: 'test-exec',
    ...overrides,
  };
}

function makeRes(status: number, body: unknown = { result: { ok: true } }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Helper to capture the fetch arguments without mocking the global.
// `impl` is sync (returns a Response); we wrap with Promise.resolve so the
// runner's `await fetch(...)` resolves the same way a real fetch would.
function spyFetch(impl: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn((url: string, init?: RequestInit) =>
    (calls.push({ url, init }), Promise.resolve(impl(url, init))),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return { calls, fn };
}

const ORIG_FETCH = globalThis.fetch;
const ORIG_WINDOW = (globalThis as { window?: unknown }).window;

afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
  if (ORIG_WINDOW === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = ORIG_WINDOW;
  }
});

describe('runPro — auth path selection', () => {
  beforeEach(() => {
    // Default: non-browser environment so `typeof window !== 'undefined'`
    // tests can be controlled per-test.
    delete (globalThis as { window?: unknown }).window;
  });

  it('uses Bearer header when ctx.apiKey is provided', async () => {
    const { calls } = spyFetch(() => makeRes(200, { result: { ok: true } }));
    await runPro('text-sentiment-pro', { text: 'hi' }, makeCtx({ apiKey: 'wk_live_abc' }));
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer wk_live_abc');
    expect(calls[0]!.init!.credentials).toBeUndefined();
  });

  it('uses same-origin cookie in the browser when no apiKey', async () => {
    // Minimal window shim — the runner only touches dispatchEvent on
    // success to refresh the header balance badge.
    (globalThis as { window?: unknown }).window = { dispatchEvent: () => true };
    const { calls } = spyFetch(() => makeRes(200, { result: { ok: true } }));
    await runPro('text-sentiment-pro', { text: 'hi' }, makeCtx());
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(calls[0]!.init!.credentials).toBe('same-origin');
  });

  it('throws a recovery hint when outside the browser and no apiKey', async () => {
    spyFetch(() => makeRes(200));
    await expect(
      runPro('text-sentiment-pro', { text: 'hi' }, makeCtx()),
    ).rejects.toThrow(/wyreup login|WYREUP_API_KEY/);
  });

  it('honors ctx.proOrigin for the request URL', async () => {
    const { calls } = spyFetch(() => makeRes(200, { result: { ok: true } }));
    await runPro(
      'text-sentiment-pro',
      { text: 'hi' },
      makeCtx({ apiKey: 'wk_live_abc', proOrigin: 'https://wyreup.com' }),
    );
    expect(calls[0]!.url).toBe('https://wyreup.com/api/tools/pro/run');
  });
});

describe('runPro — error surfacing', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('throws a key-rejected message on 401 with apiKey', async () => {
    spyFetch(() => makeRes(401, { error: 'invalid key' }));
    await expect(
      runPro('text-sentiment-pro', { text: 'hi' }, makeCtx({ apiKey: 'bad' })),
    ).rejects.toThrow(/key was rejected|wyreup login|WYREUP_API_KEY/i);
  });

  it('throws the server error on 402 (insufficient credits)', async () => {
    spyFetch(() => makeRes(402, { error: 'Not enough credits' }));
    await expect(
      runPro('text-sentiment-pro', { text: 'hi' }, makeCtx({ apiKey: 'wk_live' })),
    ).rejects.toThrow(/credits/i);
  });

  it('throws on 429 rate limit', async () => {
    spyFetch(() => makeRes(429, { error: 'Too many runs' }));
    await expect(
      runPro('text-sentiment-pro', { text: 'hi' }, makeCtx({ apiKey: 'wk_live' })),
    ).rejects.toThrow(/many|wait/i);
  });
});

describe('runPro — result unwrapping', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('returns the unwrapped body.result', async () => {
    spyFetch(() => makeRes(200, { result: { answer: '42' } }));
    const out = await runPro<{ answer: string }>(
      'pdf-q-and-a',
      { text: 'doc', question: 'q' },
      makeCtx({ apiKey: 'wk_live' }),
    );
    expect(out.answer).toBe('42');
  });

  it('throws when the server returns no result field', async () => {
    spyFetch(() => makeRes(200, {}));
    await expect(
      runPro('pdf-q-and-a', { text: 'd', question: 'q' }, makeCtx({ apiKey: 'wk_live' })),
    ).rejects.toThrow(/no result/i);
  });
});
