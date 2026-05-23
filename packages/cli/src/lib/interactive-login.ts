// Shared interactive-login flow used by:
//   - `wyreup login` when invoked with no positional key
//   - the auto-prompt path in commands/run.ts when a user runs a Pro
//     tool without having logged in yet
//
// The whole point of this helper is to eliminate the "find the docs,
// run a second command, retry" loop. If the user runs a Pro tool and
// has no key, we prompt them right there. One step, no separate
// concept to learn.
//
// Non-interactive contexts (CI, scripts, piped stdin) return null so
// the caller can fall through to the WYREUP_API_KEY recovery hint —
// scripts shouldn't be prompted.

import { createInterface } from 'node:readline';
import { writeApiKey, resolveProOrigin, configPath } from './credentials.js';

export interface BalanceResponse {
  email?: string;
  balance?: number;
  subscriptionStatus?: string | null;
}

/**
 * Send the candidate key to /api/account/balance with a Bearer header.
 * Returns the parsed body on success, null on rejection / unreachable.
 * Side effect: writes friendly diagnostics to stderr for the user.
 */
export async function validateApiKey(key: string): Promise<BalanceResponse | null> {
  if (!key.startsWith('wk_live_') && !key.startsWith('wk_test_')) {
    process.stderr.write(
      "That doesn't look like a Wyreup key (expected wk_live_... or wk_test_...).\n",
    );
    return null;
  }

  const origin = resolveProOrigin();
  let res: Response;
  try {
    res = await fetch(`${origin}/api/account/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Could not reach ${origin}: ${msg}\n`);
    return null;
  }

  if (res.status === 401) {
    process.stderr.write('Key not accepted. Check that it isn’t revoked at https://wyreup.com/account.\n');
    return null;
  }
  if (!res.ok) {
    process.stderr.write(`Unexpected response (${res.status}) from ${origin}.\n`);
    return null;
  }

  return (await res.json().catch(() => ({}))) as BalanceResponse;
}

/**
 * Validate + persist a key. Returns the validated key on success,
 * null on rejection. On success writes a one-line confirmation to
 * stderr with email / balance / subscription so the user knows the
 * round-trip worked.
 */
export async function validateAndSaveKey(key: string): Promise<string | null> {
  const body = await validateApiKey(key);
  if (!body) return null;
  await writeApiKey(key);
  process.stderr.write(
    `Logged in as ${body.email ?? '(unknown email)'}. ` +
      `Balance: ${body.balance ?? 0} credits` +
      (body.subscriptionStatus ? ` · subscription: ${body.subscriptionStatus}` : '') +
      `. Key saved to ${configPath()} (mode 0600).\n`,
  );
  return key;
}

/**
 * Prompt the user on stdin for a key, then run it through
 * validateAndSaveKey. Returns the key on success, null on:
 *   - non-TTY stdin (CI, piped input, redirected stdin) — caller
 *     should fall back to the WYREUP_API_KEY recovery hint
 *   - empty input (user pressed Enter to skip)
 *   - validation failure (server rejected the key)
 *
 * `intro` is printed to stderr before the prompt — typically a
 * one-liner explaining why we're asking and where to get a key.
 */
export async function interactiveLogin(opts: {
  intro?: string;
} = {}): Promise<string | null> {
  if (!process.stdin.isTTY) return null;

  if (opts.intro) {
    process.stderr.write(opts.intro);
    if (!opts.intro.endsWith('\n')) process.stderr.write('\n');
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  const raw = await new Promise<string>((resolve) => {
    rl.question(
      'Paste your Wyreup API key (or press Enter to skip): ',
      (answer) => {
        rl.close();
        resolve(answer);
      },
    );
  });

  const key = raw.trim();
  if (!key) return null;

  return validateAndSaveKey(key);
}
