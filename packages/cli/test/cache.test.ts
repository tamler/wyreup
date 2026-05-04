/**
 * Smoke tests for the `cache` commands. Both subcommands (list, clear)
 * touch the filesystem under the user's HuggingFace cache directory;
 * we redirect that with TRANSFORMERS_CACHE so the test stays isolated.
 *
 * Coverage bar: "the modules import cleanly, export the expected
 * handlers, and don't crash when invoked against an empty cache."
 * Deeper coverage of the rm/walk paths is left to manual smoke testing
 * — these are utility commands, not core flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheListCommand, cacheClearCommand } from '../src/commands/cache.js';

describe('cache commands', () => {
  let tmp: string;
  let savedEnv: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'wyreup-cache-test-'));
    savedEnv = process.env['TRANSFORMERS_CACHE'];
    process.env['TRANSFORMERS_CACHE'] = tmp;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (savedEnv === undefined) delete process.env['TRANSFORMERS_CACHE'];
    else process.env['TRANSFORMERS_CACHE'] = savedEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it('cacheListCommand exists and runs without throwing on empty cache', async () => {
    expect(typeof cacheListCommand).toBe('function');
    await expect(cacheListCommand({})).resolves.not.toThrow();
  });

  it('cacheListCommand --json emits valid JSON for an empty cache', async () => {
    const captured: string[] = [];
    logSpy.mockImplementation((...a: unknown[]) => {
      captured.push(a.map(String).join(' '));
    });
    await cacheListCommand({ json: true });
    const out = captured.join('\n');
    expect(() => JSON.parse(out) as unknown).not.toThrow();
    const parsed = JSON.parse(out) as { path?: string; models?: unknown[] };
    expect(typeof parsed.path).toBe('string');
    expect(Array.isArray(parsed.models)).toBe(true);
  });

  it('cacheClearCommand on an empty cache exits cleanly without prompting', async () => {
    expect(typeof cacheClearCommand).toBe('function');
    // No --force needed because empty caches short-circuit before the prompt.
    await expect(cacheClearCommand({})).resolves.not.toThrow();
  });
});
