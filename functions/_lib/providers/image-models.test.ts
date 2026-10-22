import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBgRemove } from './image-models';
import type { Env } from '../env';
import { INFERENCE_TIMEOUTS } from '../timeout';

const env = { IMAGE_MODEL_TOKEN: 'test-secret' } as Env;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('image provider URL boundary', () => {
  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])(
    'rejects unsafe provider MIME %s',
    async (contentType) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ status: 'succeeded', output: 'https://replicate.delivery/out.png' }),
        )
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1]), { headers: { 'Content-Type': contentType } }),
        );
      vi.stubGlobal('fetch', fetcher);
      await expect(runBgRemove({ image: 'data:image/png;base64,eA==' }, env)).rejects.toThrow(
        'content type',
      );
    },
  );
  it('aborts a stalled create request and rejects within the image deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    let failure: unknown;
    void runBgRemove({ image: 'data:image/png;base64,eA==' }, env).catch((error) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUTS.image + 1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(failure).toBeInstanceOf(Error);
  });
  it('refuses an output exceeding the byte cap before reading its body', async () => {
    const cancel = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: 'succeeded', output: 'https://replicate.delivery/out.png' }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
            cancel,
          }),
          {
            headers: {
              'Content-Length': String(16 * 1024 * 1024 + 1),
              'Content-Type': 'image/png',
            },
          },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(runBgRemove({ image: 'data:image/png;base64,eA==' }, env)).rejects.toThrow(
      'size limit',
    );
    expect(cancel).toHaveBeenCalled();
  });
  it.each(['poll', 'download'] as const)(
    'aborts a stalled %s request within the same overall deadline',
    async (phase) => {
      vi.useFakeTimers();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            phase === 'poll'
              ? { id: 'abc123', status: 'processing' }
              : { status: 'succeeded', output: 'https://replicate.delivery/out.png' },
          ),
        )
        .mockImplementation(() => new Promise(() => {}));
      vi.stubGlobal('fetch', fetcher);
      let failure: unknown;
      void runBgRemove({ image: 'data:image/png;base64,eA==' }, env).catch((error) => {
        failure = error;
      });
      await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUTS.image + 1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
      expect(failure).toBeInstanceOf(Error);
    },
  );
  it('cancels a stalled download stream after headers arrive', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: 'succeeded', output: 'https://replicate.delivery/out.png' }),
      )
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/png' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    let failure: unknown;
    void runBgRemove({ image: 'data:image/png;base64,eA==' }, env).catch((error) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUTS.image + 1);
    expect(cancel).toHaveBeenCalled();
    expect(failure).toBeInstanceOf(Error);
  });
  it('bounds chunked output even when Content-Length is small', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const cancel = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: 'succeeded', output: 'https://replicate.delivery/out.png' }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk);
            },
            cancel,
          }),
          { headers: { 'Content-Length': '1', 'Content-Type': 'image/png' } },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(runBgRemove({ image: 'data:image/png;base64,eA==' }, env)).rejects.toThrow(
      'size limit',
    );
    expect(cancel).toHaveBeenCalled();
  });
  it('preserves base64 alignment across arbitrary streamed chunk boundaries', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: 'succeeded', output: 'https://replicate.delivery/out.png' }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              for (const bytes of [[1], [2, 3], [4, 5, 6, 7]])
                controller.enqueue(new Uint8Array(bytes));
              controller.close();
            },
          }),
          { headers: { 'Content-Type': 'image/png' } },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(runBgRemove({ image: 'data:image/png;base64,eA==' }, env)).resolves.toMatchObject({
      base64: 'AQIDBAUGBw==',
    });
  });
  it.each([
    'https://127.0.0.1/x',
    'https://replicate.delivery.attacker.com/x',
    'https://user@replicate.delivery/x',
    'https://replicate.delivery:444/x',
    'http://replicate.delivery/x',
  ])('rejects upstream output %s before fetching it', async (output) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'succeeded', output }));
    vi.stubGlobal('fetch', fetcher);
    await expect(runBgRemove({ image: 'data:image/png;base64,eA==' }, env)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses the documented delivery host and prevents redirects and credential forwarding', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          status: 'succeeded',
          output: 'https://output.replicate.delivery/image.png',
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(runBgRemove({ image: 'data:image/png;base64,eA==' }, env)).resolves.toMatchObject({
      base64: 'AQID',
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error' });
    expect((fetcher.mock.calls[1][1] as RequestInit).headers).toBeUndefined();
  });
  it('constructs polling URL from prediction id instead of trusting upstream urls.get', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 'abc123',
          status: 'processing',
          urls: { get: 'https://attacker.com/steal' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'abc123',
          status: 'succeeded',
          output: 'https://replicate.delivery/out.png',
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    const pending = runBgRemove({ image: 'data:image/png;base64,eA==' }, env);
    await vi.runAllTimersAsync();
    await pending;
    expect(String(fetcher.mock.calls[1][0])).toBe(
      'https://api.replicate.com/v1/predictions/abc123',
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error' });
  });
});
