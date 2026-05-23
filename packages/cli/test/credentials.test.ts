import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readApiKey,
  writeApiKey,
  deleteApiKey,
  resolveProOrigin,
  configFileMode,
} from '../src/lib/credentials.js';

// The module derives ~/.wyreup/config.json from os.homedir(). Override
// HOME / USERPROFILE per-test so we never touch the real config.

const ORIG_HOME = process.env['HOME'];
const ORIG_USERPROFILE = process.env['USERPROFILE'];
const ORIG_API_KEY = process.env['WYREUP_API_KEY'];
const ORIG_ORIGIN = process.env['WYREUP_ORIGIN'];

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'wyreup-cred-test-'));
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
  await rm(scratchDir, { recursive: true, force: true });
});

describe('readApiKey', () => {
  it('returns null when no key is set', async () => {
    expect(await readApiKey()).toBeNull();
  });

  it('prefers WYREUP_API_KEY env var over the config file', async () => {
    // Write a config file with one value, set env var with another.
    await mkdir(join(scratchDir, '.wyreup'), { recursive: true });
    await writeFile(
      join(scratchDir, '.wyreup', 'config.json'),
      JSON.stringify({ apiKey: 'wk_live_from_file' }),
    );
    process.env['WYREUP_API_KEY'] = 'wk_live_from_env';
    expect(await readApiKey()).toBe('wk_live_from_env');
  });

  it('reads from the config file when env var is unset', async () => {
    await writeApiKey('wk_test_abc123');
    expect(await readApiKey()).toBe('wk_test_abc123');
  });

  it('trims whitespace from both env and file keys', async () => {
    process.env['WYREUP_API_KEY'] = '   wk_live_padded   ';
    expect(await readApiKey()).toBe('wk_live_padded');
  });

  it('returns null when the env var is empty / whitespace only', async () => {
    process.env['WYREUP_API_KEY'] = '   ';
    expect(await readApiKey()).toBeNull();
  });
});

describe('writeApiKey', () => {
  it('persists the key to ~/.wyreup/config.json', async () => {
    await writeApiKey('wk_live_persisted');
    const text = await readFile(join(scratchDir, '.wyreup', 'config.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ apiKey: 'wk_live_persisted' });
  });

  it('creates the parent directory if missing', async () => {
    await writeApiKey('wk_live_dir');
    const s = await stat(join(scratchDir, '.wyreup'));
    expect(s.isDirectory()).toBe(true);
  });

  it('writes the config file with mode 0600', async () => {
    await writeApiKey('wk_live_mode');
    const mode = await configFileMode();
    // Linux/macOS only — Windows ignores POSIX modes in stat().
    if (process.platform !== 'win32') {
      expect(mode).toBe(0o600);
    }
  });
});

describe('deleteApiKey', () => {
  it('zeroes the saved key without unlinking the file', async () => {
    await writeApiKey('wk_live_to_delete');
    await deleteApiKey();
    const text = await readFile(join(scratchDir, '.wyreup', 'config.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({});
    expect(await readApiKey()).toBeNull();
  });

  it('is a no-op when no config file exists', async () => {
    // Should not throw.
    await deleteApiKey();
    expect(await readApiKey()).toBeNull();
  });
});

describe('resolveProOrigin', () => {
  it('defaults to https://wyreup.com', () => {
    expect(resolveProOrigin()).toBe('https://wyreup.com');
  });

  it('honors WYREUP_ORIGIN env var', () => {
    process.env['WYREUP_ORIGIN'] = 'http://localhost:8788';
    expect(resolveProOrigin()).toBe('http://localhost:8788');
  });

  it('strips a trailing slash so URL construction is clean', () => {
    process.env['WYREUP_ORIGIN'] = 'https://staging.wyreup.com//';
    expect(resolveProOrigin()).toBe('https://staging.wyreup.com');
  });
});
