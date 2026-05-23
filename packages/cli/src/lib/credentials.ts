// Local credential storage for the Wyreup CLI.
//
// Two resolution sources, in priority order:
//   1. `WYREUP_API_KEY` env var. Useful for CI, ephemeral shells, or
//      "I'd rather not put it on disk" workflows.
//   2. `~/.wyreup/config.json` written by `wyreup login`.
//
// The config file is created mode 0600 (user-only read/write). It is
// the only place a key lives on disk; `wyreup logout` zeroes it out
// rather than unlinking so any user-added unrelated keys remain.
//
// Future enhancement: OS keychain integration (macOS Keychain, Windows
// Credential Manager, libsecret). Deferred — the file is fine for v1.

import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Paths are derived per call rather than cached at import time so tests
// (and any caller that mutates HOME/USERPROFILE) see a consistent view.
function configDir(): string {
  return join(homedir(), '.wyreup');
}
function configFile(): string {
  return join(configDir(), 'config.json');
}

const DEFAULT_ORIGIN = 'https://wyreup.com';

interface Config {
  apiKey?: string;
}

/**
 * Resolve the API key for Pro tool calls. Env var wins, then the
 * config file. Returns null when neither is set — the CLI should
 * then prompt the user to run `wyreup login`.
 */
export async function readApiKey(): Promise<string | null> {
  const fromEnv = process.env['WYREUP_API_KEY'];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  try {
    const text = await readFile(configFile(), 'utf8');
    const parsed = JSON.parse(text) as Config;
    return parsed.apiKey?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the Pro endpoint origin. CLI defaults to https://wyreup.com;
 * tests / staging override with WYREUP_ORIGIN.
 */
export function resolveProOrigin(): string {
  const fromEnv = process.env['WYREUP_ORIGIN'];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, '');
  return DEFAULT_ORIGIN;
}

/**
 * Persist `key` to `~/.wyreup/config.json` with mode 0600. Called only
 * by the `wyreup login` command after the server has confirmed the key
 * is valid.
 */
export async function writeApiKey(key: string): Promise<void> {
  const path = configFile();
  await mkdir(configDir(), { recursive: true });
  await writeFile(path, JSON.stringify({ apiKey: key }, null, 2), 'utf8');
  await chmod(path, 0o600);
}

/**
 * Clear the saved key without removing the file. Other future config
 * (model CDN override, default origin, etc.) stays intact.
 */
export async function deleteApiKey(): Promise<void> {
  const path = configFile();
  try {
    await readFile(path, 'utf8'); // existence check
    await writeFile(path, JSON.stringify({}, null, 2), 'utf8');
    await chmod(path, 0o600);
  } catch {
    // No file = nothing to log out from. Soft no-op.
  }
}

/**
 * Where the config file lives — getter (not a constant) so commands
 * see the current HOME even if it was mutated mid-process (tests).
 */
export function configPath(): string {
  return configFile();
}

/**
 * Best-effort check that the config file has mode 0600. Returns the
 * actual mode (e.g. `0o644`) or null if the file is absent. Used by
 * the `login` command to warn if a previous shell-created file is
 * world-readable.
 */
export async function configFileMode(): Promise<number | null> {
  try {
    const s = await stat(configFile());
    return s.mode & 0o777;
  } catch {
    return null;
  }
}
