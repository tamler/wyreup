import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateApiKey,
  validateAndSaveKey,
  interactiveLogin,
} from '../src/lib/interactive-login.js';
import { readApiKey } from '../src/lib/credentials.js';

const ORIG_HOME = process.env['HOME'];
const ORIG_USERPROFILE = process.env['USERPROFILE'];
const ORIG_FETCH = globalThis.fetch;
const ORIG_API_KEY = process.env['WYREUP_API_KEY'];
const ORIG_ORIGIN = process.env['WYREUP_ORIGIN'];

let scratchDir: string;

function makeRes(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function spyFetch(impl: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(impl(url, init));
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { calls, fn };
}

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'wyreup-ilogin-test-'));
  process.env['HOME'] = scratchDir;
  process.env['USERPROFILE'] = scratchDir;
  delete process.env['WYREUP_API_KEY'];
  delete process.env['WYREUP_ORIGIN'];
});

afterEach(async () => {
  if (ORIG_HOME === undefined) delete process.env['HOME'];
  else process.env['HOME'] = ORIG_HOME;
  if (ORIG_USERPROFILE === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = ORIG_USERPROFILE;
  if (ORIG_API_KEY === undefined) delete process.env['WYREUP_API_KEY'];
  else process.env['WYREUP_API_KEY'] = ORIG_API_KEY;
  if (ORIG_ORIGIN === undefined) delete process.env['WYREUP_ORIGIN'];
  else process.env['WYREUP_ORIGIN'] = ORIG_ORIGIN;
  globalThis.fetch = ORIG_FETCH;
  await rm(scratchDir, { recursive: true, force: true });
});

describe('validateApiKey', () => {
  it('rejects keys without the wk_live_ / wk_test_ prefix without hitting the network', async () => {
    const { calls } = spyFetch(() => makeRes(200));
    expect(await validateApiKey('hunter2')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns the balance payload on 200', async () => {
    spyFetch(() =>
      makeRes(200, { email: 'a@b.co', balance: 42, subscriptionStatus: null }),
    );
    const r = await validateApiKey('wk_live_ok');
    expect(r?.email).toBe('a@b.co');
    expect(r?.balance).toBe(42);
  });

  it('returns null on 401 (revoked / wrong key)', async () => {
    spyFetch(() => makeRes(401, { error: 'bad key' }));
    expect(await validateApiKey('wk_live_rejected')).toBeNull();
  });

  it('returns null on transport failure', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await validateApiKey('wk_live_unreachable')).toBeNull();
  });
});

describe('validateAndSaveKey', () => {
  it('persists the key to ~/.wyreup/config.json on success', async () => {
    spyFetch(() => makeRes(200, { email: 'a@b.co', balance: 10 }));
    const r = await validateAndSaveKey('wk_live_persist');
    expect(r).toBe('wk_live_persist');
    const text = await readFile(join(scratchDir, '.wyreup', 'config.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ apiKey: 'wk_live_persist' });
    expect(await readApiKey()).toBe('wk_live_persist');
  });

  it('does NOT persist on validation failure', async () => {
    spyFetch(() => makeRes(401));
    expect(await validateAndSaveKey('wk_live_bad')).toBeNull();
    expect(await readApiKey()).toBeNull();
  });
});

describe('interactiveLogin', () => {
  it('returns null without prompting when stdin is not a TTY', async () => {
    // Vitest runs with stdin as not-a-TTY by default — perfect for this
    // case. We additionally assert no fetch was made (because there
    // was nothing to validate).
    const { calls } = spyFetch(() => makeRes(200));
    const r = await interactiveLogin({ intro: 'test' });
    expect(r).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
