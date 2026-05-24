// Single chokepoint for CLI error output. Passes messages through the
// bearer-token sanitizer before writing to stderr.
//
// If credentials are unreadable (no login, bad file, etc.) the call
// still proceeds — the generic "Bearer <token>" regex pattern in
// sanitize() covers the case where the key isn't known at call time.

import { sanitize } from './sanitize.js';
import { readApiKey } from '../credentials.js';

export async function printError(prefix: string, err: unknown): Promise<void> {
  const raw = err instanceof Error ? err.message : String(err);
  let key: string | undefined;
  try {
    const k = await readApiKey();
    key = k ?? undefined;
  } catch { /* credentials unreadable — proceed without key for redaction */ }
  process.stderr.write(`${prefix}: ${sanitize(raw, key)}\n`);
}
