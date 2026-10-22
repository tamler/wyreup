import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from './email';
import type { Env } from './env';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const env = { ZEPTOMAIL_TOKEN: 'test', ZEPTOMAIL_SENDER: 'sender@example.com' } as Env;
const mail = { to: 'owner@example.com', subject: 'Key', text: 'secret-key' };

describe('mail failure handling', () => {
  it.each([200, 503])('releases the unread provider body after status %s', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));

    expect(await sendEmail(env, mail)).toEqual(status === 200 ? { ok: true } : { ok: false, status });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each([200, 503])('preserves status %s when provider body disposal rejects', async (status) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cancel = vi.fn().mockRejectedValue(new Error('provider response secret-key'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status })));

    expect(await sendEmail(env, mail)).toEqual(status === 200 ? { ok: true } : { ok: false, status });
    expect(cancel).toHaveBeenCalledOnce();
    expect(log.mock.calls).toEqual(status === 200 ? [] : [['ZeptoMail error', 503]]);
  });

  it('never logs provider response content which might echo credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-key', { status: 503 })));
    expect(await sendEmail(env, mail)).toEqual({ ok: false, status: 503 });
    expect(log).toHaveBeenCalledExactlyOnceWith('ZeptoMail error', 503);
  });

  it('bounds delivery using an abort timeout and treats abort as retryable failure', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }));
    expect(await sendEmail(env, mail)).toEqual({ ok: false });
    expect(timeout).toHaveBeenCalledWith(15_000);
  });
});
