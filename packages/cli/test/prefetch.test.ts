/**
 * Smoke tests for `wyreup prefetch`. The command pulls model weights —
 * happy-path testing would require a network and several hundred MB of
 * downloads, which isn't appropriate for CI. Instead we verify the
 * argument-handling and validation paths that don't actually trigger
 * downloads: empty input, unknown tools, invalid chains, unknown groups.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prefetchCommand } from '../src/commands/prefetch.js';

describe('prefetchCommand', () => {
  let logs: string[];
  let errs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let prevExitCode: number | string | undefined;

  beforeEach(() => {
    logs = [];
    errs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errs.push(a.map(String).join(' '));
    });
    prevExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExitCode;
  });

  it('exists and is invokable', () => {
    expect(typeof prefetchCommand).toBe('function');
  });

  it('reports no-targets and exits 1 when called with empty args and no flags', async () => {
    await prefetchCommand([], {});
    expect(errs.join('\n').toLowerCase()).toMatch(/specify|chain|group|all|usage|tool/);
    expect(process.exitCode).toBe(1);
  });

  it('rejects an invalid --chain string with exit 1', async () => {
    await prefetchCommand([], { chain: '|||' });
    // Parser returns empty steps for "|||", so we expect either a parse
    // error or "no tools found". Both should exit non-zero.
    expect(process.exitCode).toBe(1);
  });

  it('rejects an unknown tool id with exit 1', async () => {
    await prefetchCommand(['no-such-tool'], {});
    expect(errs.join('\n')).toContain('no-such-tool');
    expect(process.exitCode).toBe(1);
  });

  it('rejects an unknown --group with exit 1', async () => {
    await prefetchCommand([], { group: 'absolutely-not-a-real-group' });
    expect(process.exitCode).toBe(1);
  });
});
