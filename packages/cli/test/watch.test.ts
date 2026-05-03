/**
 * Tests for the `watch` command — focused on --max-files semantics.
 * The full chokidar-driven loop is hard to unit-test; we mock chokidar
 * to a controllable EventEmitter and assert the cap behavior.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── chokidar mock ─────────────────────────────────────────────────────────────

class FakeWatcher extends EventEmitter {
  closed = false;
  close: () => Promise<void> = () => {
    this.closed = true;
    return Promise.resolve();
  };
}

let currentWatcher: FakeWatcher = new FakeWatcher();

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => currentWatcher) },
}));

// ── runChain mock ─────────────────────────────────────────────────────────────

const mockRunChain = vi.fn(() => Promise.resolve([new Blob(['ok'], { type: 'text/plain' })]));

const mockTool = {
  id: 'strip-exif',
  input: { accept: ['image/jpeg'] },
  defaults: {},
};

vi.mock('@wyreup/core', () => ({
  createDefaultRegistry: () => ({
    toolsById: new Map([[mockTool.id, mockTool]]),
  }),
  runChain: (...args: unknown[]) => mockRunChain(...(args as [])) as unknown,
  parseChainString: (raw: string) =>
    raw.split('|').map((id) => ({ toolId: id.trim(), params: {} })),
  serializeChain: () => '',
}));

// ── process.exit mock — record but don't kill the test runner ─────────────────

let exitCode: number | null = null;
// Capture the real exit bound to `process` so we can restore it after the
// suite. `process.exit.bind(process)` keeps the eslint unbound-method rule
// happy and gives us a callable that delegates to the real implementation.
const originalExit = process.exit.bind(process);

beforeEach(() => {
  exitCode = null;
  currentWatcher = new FakeWatcher();
  mockRunChain.mockClear();
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    // No throw: continue execution but trap exit. The shutdown path's
    // remaining work is harmless after exit was "called".
    return undefined as never;
  }) as typeof process.exit;
});

afterAll(() => {
  process.exit = originalExit;
});

// Import after mocks are wired.
import { executeWatch } from '../src/commands/watch.js';

async function setupTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wyreup-watch-test-'));
  await mkdir(join(dir, '_wyreup-out'), { recursive: true });
  return dir;
}

async function fireFiles(dir: string, count: number): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = join(dir, `f${i}.jpg`);
    await writeFile(p, 'fake jpeg bytes');
    paths.push(p);
  }
  return paths;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('watch --max-files', () => {
  it('stops after N successful runs and reports the cap message', async () => {
    const tmp = await setupTmpDir();
    const paths = await fireFiles(tmp, 5);

    const stderr: string[] = [];
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });

    // Kick off; don't await — executeWatch is a daemon. Listen for state.
    const wp = executeWatch(tmp, {
      steps: 'strip-exif',
      maxFiles: 3,
      concurrency: 1,
    });

    // Wait for chokidar.watch() to be called inside executeWatch.
    await waitFor(() => currentWatcher.listenerCount('add') > 0);
    for (const p of paths) currentWatcher.emit('add', p);

    await waitFor(() => exitCode === 0, 2000);
    await wp.catch(() => {});

    expect(exitCode).toBe(0);
    expect(mockRunChain).toHaveBeenCalledTimes(3);
    expect(stderr.join('')).toContain('reached --max-files=3');
    expect(currentWatcher.closed).toBe(true);

    writeSpy.mockRestore();
    await rm(tmp, { recursive: true, force: true });
  });

  it('runs unbounded when --max-files is not set', async () => {
    const tmp = await setupTmpDir();
    const paths = await fireFiles(tmp, 4);

    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    void executeWatch(tmp, { steps: 'strip-exif', concurrency: 1 }).catch(() => {});

    await waitFor(() => currentWatcher.listenerCount('add') > 0);
    for (const p of paths) currentWatcher.emit('add', p);
    await waitFor(() => mockRunChain.mock.calls.length === 4, 2000);

    expect(exitCode).toBeNull();
    expect(currentWatcher.closed).toBe(false);

    writeSpy.mockRestore();
    await rm(tmp, { recursive: true, force: true });
  });

  it('treats a non-positive --max-files as no limit', async () => {
    const tmp = await setupTmpDir();
    const paths = await fireFiles(tmp, 3);

    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    void executeWatch(tmp, {
      steps: 'strip-exif',
      maxFiles: 0,
      concurrency: 1,
    }).catch(() => {});

    await waitFor(() => currentWatcher.listenerCount('add') > 0);
    for (const p of paths) currentWatcher.emit('add', p);
    await waitFor(() => mockRunChain.mock.calls.length === 3, 2000);

    expect(exitCode).toBeNull();

    writeSpy.mockRestore();
    await rm(tmp, { recursive: true, force: true });
  });
});
