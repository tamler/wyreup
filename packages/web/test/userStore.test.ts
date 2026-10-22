import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { activate, user } from '../src/stores/user.js';

describe('user activation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a retryable error when the account endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );

    await expect(activate('wk_test_valid-shape')).resolves.toEqual({
      ok: false,
      error: 'Could not reach Wyreup. Check your connection and try again.',
    });
  });

  it('rejects a malformed success response without mutating the signed-in user', async () => {
    user.set(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{bad json', { status: 200 }))),
    );

    await expect(activate('wk_test_valid-shape')).resolves.toEqual({
      ok: false,
      error: 'Wyreup returned an invalid response. Please try again.',
    });
    expect(get(user)).toBeNull();
  });

  it('rejects a success response with the wrong account shape', async () => {
    user.set(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ email: 123, balance: 'many' }))),
    );

    await expect(activate('wk_test_valid-shape')).resolves.toEqual({
      ok: false,
      error: 'Wyreup returned an invalid response. Please try again.',
    });
    expect(get(user)).toBeNull();
  });
});
