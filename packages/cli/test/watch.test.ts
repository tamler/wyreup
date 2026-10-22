/**
 * Tests for the `watch` command — focused on --max-files semantics.
 * The full chokidar-driven loop is hard to unit-test; we mock chokidar
 * to a controllable EventEmitter and assert the cap behavior.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile, stat, readdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import chokidar from 'chokidar';
import type { Stats } from 'node:fs';
import type * as NativeFs from 'node:fs/promises';
import type * as Core from '@wyreup/core';
import type { ToolRunContext } from '@wyreup/core';
import type * as Registry from '../../core/src/registry.js';

const policy = vi.hoisted(() => {
  const state: {
    operand: string | null;
    directory: Stats | null;
    validations: string[];
    mkdirs: string[];
    reads: string[];
  } = { operand: null, directory: null, validations: [], mkdirs: [], reads: [] };
  return state;
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const native = await importOriginal<typeof NativeFs>();
  return {
    ...native,
    stat(...args: Parameters<typeof native.stat>) {
      if (policy.operand === null) return native.stat(...args);
      if (args[0] !== policy.operand || policy.directory === null) {
        throw new Error('Unexpected UNIT policy validation operand');
      }
      policy.validations.push(policy.operand);
      return Promise.resolve(policy.directory);
    },
    mkdir(...args: Parameters<typeof native.mkdir>) {
      if (policy.operand === null) return native.mkdir(...args);
      if (typeof args[0] !== 'string') throw new Error('Unexpected UNIT policy mkdir operand');
      policy.mkdirs.push(args[0]);
      return Promise.resolve(undefined);
    },
    readFile(...args: Parameters<typeof native.readFile>) {
      if (policy.operand === null) return native.readFile(...args);
      if (typeof args[0] !== 'string') throw new Error('Unexpected UNIT policy read operand');
      policy.reads.push(args[0]);
      return Promise.reject(new Error('UNIT policy cases must not read input files'));
    },
  };
});

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

const contexts: ToolRunContext[] = [];
const mockRunChain = vi.fn((...args: Parameters<typeof Core.runChain>) => {
  contexts.push(args[2]);
  return Promise.resolve([new Blob(['ok'], { type: 'text/plain' })]);
});

const mockTool = {
  surfaces: undefined as ('web' | 'cli' | 'mcp')[] | undefined,
  id: 'strip-exif',
  input: { accept: ['image/jpeg'] },
  defaults: {},
};

vi.mock('@wyreup/core', async () => ({
  toolRunsOnSurface: (await vi.importActual<typeof Registry>('../../core/src/registry.js')).toolRunsOnSurface,
  createDefaultRegistry: () => ({
    toolsById: new Map([[mockTool.id, mockTool]]),
  }),
  runChain: (...args: Parameters<typeof Core.runChain>) => mockRunChain(...args),
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
  contexts.length = 0;
  policy.operand = null;
  policy.directory = null;
  policy.validations = [];
  policy.mkdirs = [];
  policy.reads = [];
  mockTool.surfaces = undefined;
  vi.mocked(chokidar.watch).mockClear();
  process.exit = (code?: number) => {
    exitCode = code ?? 0;
    // No throw: continue execution but trap exit. The shutdown path's
    // remaining work is harmless after exit was "called".
    return undefined as never;
  };
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
  it.each([
    ['default', undefined, 'https://wyreup.com'],
    ['configured', ' https://watch-origin.example/// ', 'https://watch-origin.example'],
  ])('passes the real %s resolver origin in the actual runChain context', async (_label, configured, expected) => {
    const originalOrigin = process.env['WYREUP_ORIGIN'];
    const tmp = await setupTmpDir();
    const [path] = await fireFiles(tmp, 1);
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    let handle: Awaited<ReturnType<typeof executeWatch>> | undefined;
    try {
      if (configured === undefined) delete process.env['WYREUP_ORIGIN'];
      else process.env['WYREUP_ORIGIN'] = configured;
      handle = await executeWatch(tmp, { steps: 'strip-exif', concurrency: 1 });
      currentWatcher.emit('add', path);
      await waitFor(() => mockRunChain.mock.calls.length === 1, 2000);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.proOrigin).toBe(expected);
    } finally {
      await handle?.stop();
      if (originalOrigin === undefined) delete process.env['WYREUP_ORIGIN'];
      else process.env['WYREUP_ORIGIN'] = originalOrigin;
      writeSpy.mockRestore();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('refuses a web-only step before constructing a watcher', async () => {
    const tmp = await setupTmpDir();
    mockTool.surfaces = ['web'];
    const messages: string[] = [];
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      messages.push(String(chunk));
      return true;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      exitCode = Number(code);
      throw new Error(`process.exit(${code})`);
    });
    let handle: Awaited<ReturnType<typeof executeWatch>> | undefined;
    let error: unknown;
    try {
      try { handle = await executeWatch(tmp, { steps: 'strip-exif' }); }
      catch (cause) { error = cause; }
      expect(error).toBeInstanceOf(Error);
      expect(exitCode).toBe(1);
      expect(messages.join('')).toMatch(/strip-exif.*CLI|CLI.*strip-exif/i);
      expect(chokidar.watch).not.toHaveBeenCalled();
      expect(mockRunChain).not.toHaveBeenCalled();
    } finally {
      await handle?.stop();
      exitSpy.mockRestore();
      writeSpy.mockRestore();
      await rm(tmp, { recursive: true });
    }
  });

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

    const handlePromise = executeWatch(tmp, { steps: 'strip-exif', concurrency: 1 });

    await waitFor(() => currentWatcher.listenerCount('add') > 0);
    for (const p of paths) currentWatcher.emit('add', p);
    await waitFor(() => mockRunChain.mock.calls.length === 4, 2000);

    expect(exitCode).toBeNull();
    expect(currentWatcher.closed).toBe(false);

    const handle = await handlePromise;
    await handle.stop();
    writeSpy.mockRestore();
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes outputs atomically with mode 0600', async () => {
    const tmp = await setupTmpDir();
    const paths = await fireFiles(tmp, 1);

    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const handlePromise = executeWatch(tmp, {
      steps: 'strip-exif',
      maxFiles: 1,
      concurrency: 1,
    });

    await waitFor(() => currentWatcher.listenerCount('add') > 0);
    for (const p of paths) currentWatcher.emit('add', p);

    await waitFor(() => exitCode === 0, 2000);

    const outDir = join(tmp, '_wyreup-out');
    const entries = await readdir(outDir);
    expect(entries.length).toBe(1);
    const st = await stat(join(outDir, entries[0]!));
    // atomicPublish writes the tmp file with mode 0600; assert the owner-only
    // permission survives the rename.
    expect(st.mode & 0o777).toBe(0o600);

    const handle = await handlePromise;
    await handle.stop();
    writeSpy.mockRestore();
    await rm(tmp, { recursive: true, force: true });
  });

  it('treats a non-positive --max-files as no limit', async () => {
    const tmp = await setupTmpDir();
    const paths = await fireFiles(tmp, 3);

    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const handlePromise = executeWatch(tmp, {
      steps: 'strip-exif',
      maxFiles: 0,
      concurrency: 1,
    });

    await waitFor(() => currentWatcher.listenerCount('add') > 0);
    for (const p of paths) currentWatcher.emit('add', p);
    await waitFor(() => mockRunChain.mock.calls.length === 3, 2000);

    expect(exitCode).toBeNull();

    const handle = await handlePromise;
    await handle.stop();
    writeSpy.mockRestore();
    await rm(tmp, { recursive: true, force: true });
  });
});

const policyCases: Array<{ name: string; path: string; blocked: boolean; allowSystem?: boolean }> = [
  { name: 'native filesystem root', path: parse(resolve(tmpdir())).root, blocked: true },
  { name: 'exact HOME', path: homedir(), blocked: true },
  ...['/etc', '/usr', '/var', '/bin', '/sbin', '/System', '/Library', '/private', '/Applications',
    'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)'].map(path => ({ name: `exact system ${path}`, path, blocked: true })),
  ...['/etc/ssh', '/usr/local', '/var/lib', '/System/Library', '/private/etc', '/private/tmp-other']
    .map(path => ({ name: `system descendant ${path}`, path, blocked: true })),
  ...['/etcd', '/usr-local', '/private/tmp', '/private/tmp/source6-unit-child']
    .map(path => ({ name: `allowed POSIX boundary ${path}`, path, blocked: false })),
  { name: 'ordinary HOME child', path: join(homedir(), 'source6-unit-child'), blocked: false },
  { name: 'actual tmpdir', path: tmpdir(), blocked: false },
  { name: 'actual tmpdir child', path: join(tmpdir(), 'source6-unit-child'), blocked: false },
  { name: 'explicit override', path: '/etc/ssh', blocked: false, allowSystem: true },
];

describe('watch logical path policy (fixed UNIT operands, POSIX host)', () => {
  it.each(policyCases)('$name', async ({ path, blocked, allowSystem }) => {
    const tmp = await setupTmpDir();
    const actualDirectory = await stat(tmp);
    const operand = resolve(path);
    const messages: string[] = [];
    const exitError = new Error('Controlled policy process.exit');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      exitCode = Number(code);
      throw exitError;
    });
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      messages.push(String(chunk));
      return true;
    });
    let handle: Awaited<ReturnType<typeof executeWatch>> | undefined;
    let error: unknown;
    try {
      policy.operand = operand;
      policy.directory = actualDirectory;
      try { handle = await executeWatch(operand, { steps: 'strip-exif', allowSystem }); }
      catch (cause) { error = cause; }
      expect(policy.validations).toEqual([operand]);
      if (blocked) {
        expect.soft(error).toBe(exitError);
        expect.soft(exitCode).toBe(1);
        expect.soft(messages.join('')).toMatch(/Refusing to watch.*system or home directory/);
        expect.soft(policy.mkdirs).toEqual([]);
        expect.soft(chokidar.watch).not.toHaveBeenCalled();
      } else {
        expect(error).toBeUndefined();
        expect(exitCode).toBeNull();
        expect(handle).toBeDefined();
        expect(policy.mkdirs).toEqual([resolve(operand, '_wyreup-out')]);
        expect(chokidar.watch).toHaveBeenCalledOnce();
        expect(vi.mocked(chokidar.watch).mock.calls[0]?.[0]).toBe(operand);
      }
      expect(policy.reads).toEqual([]);
      expect(mockRunChain).not.toHaveBeenCalled();
    } finally {
      await handle?.stop();
      policy.operand = null;
      policy.directory = null;
      exitSpy.mockRestore();
      writeSpy.mockRestore();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
