// Wyreup PRO user stores.
//
// $user reflects the signed-in state, hydrated on page load from the
// wyreup_session cookie via GET /api/account/balance.
//
// $apiKey is transient — it holds the raw key just long enough to call
// /api/account/verify, then we clear it. Never persisted.

import { writable, get } from 'svelte/store';

export interface AuthedUser {
  email: string;
  balance: number;
}

export const apiKey = writable<string>('');
export const user = writable<AuthedUser | null>(null);
export const authReady = writable<boolean>(false);

// Hydrate $user from the session cookie. Called once on page load by
// AccountMenu (which is mounted in the layout, so this runs everywhere).
export async function hydrateUser(): Promise<void> {
  try {
    const res = await fetch('/api/account/balance', { credentials: 'same-origin' });
    if (res.ok) {
      const data = (await res.json()) as AuthedUser;
      user.set(data);
    } else {
      user.set(null);
    }
  } catch {
    user.set(null);
  } finally {
    authReady.set(true);
  }
}

// POST /api/account/verify with the typed key. On success the server sets
// the wyreup_session cookie and we mirror { email, balance } into $user.
export async function activate(rawKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!rawKey.startsWith('wk_live_') && !rawKey.startsWith('wk_test_')) {
    return { ok: false, error: 'That doesn\'t look like a Wyreup key.' };
  }
  const res = await fetch('/api/account/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${rawKey}` },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    return { ok: false, error: (detail as { error?: string }).error || `Key not accepted (${res.status})` };
  }
  const data = (await res.json()) as AuthedUser;
  user.set(data);
  apiKey.set(''); // transient — don't keep raw key in memory
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await fetch('/api/account/signout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  user.set(null);
}

// Re-read balance from the server. Called by the buy-sheet polling loop
// and after a PRO run completes.
export async function refreshBalance(): Promise<void> {
  const current = get(user);
  if (!current) return;
  try {
    const res = await fetch('/api/account/balance', { credentials: 'same-origin' });
    if (res.ok) {
      const data = (await res.json()) as AuthedUser;
      user.set(data);
    }
  } catch {
    /* ignore */
  }
}
