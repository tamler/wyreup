import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { constants } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type * as NativeFs from 'node:fs/promises';

type Phase = 'ordinary' | 'swap-write' | 'swap-write-error' | 'creator-exists' |
  'cancel-write' | 'cancel-parent-check' | 'swap-link' | 'swap-rename' |
  'mode-before' | 'mode-after' | 'close-error' | 'write-close-error' |
  'mode-close-error' | 'cancel-close-error' | 'swap-acquire';
const selected = vi.hoisted(() => {
  const phaseState: { phase: Phase } = { phase: 'ordinary' };
  return {
  native: null as typeof NativeFs | null,
  ...phaseState,
  root: '', parent: '', moved: '', target: '', temp: '',
  payload: Buffer.from('complete owned publication payload'),
  abort: new AbortController(),
  reached: 0, swaps: 0, written: 0, fullWrites: 0,
  baselineWriteCompletions: 0, openAttempts: 0, acquired: 0,
  closeAttempts: 0, nativeCloseResolutions: 0, closedWitness: false,
  linkCalls: 0, linkCommits: 0, renameCalls: 0, renameCommits: 0,
  actualCreatorEexist: 0,
  requestedModes: [] as Array<number | undefined>,
  creatorOpenFlags: [] as Array<string | number>,
  creatorStats: [] as Array<{ mode: number; uid: number; afterFullWrite: boolean }>,
  handles: [] as Array<Awaited<ReturnType<typeof NativeFs.open>>>,
  chmodProof: null as null | { before: { dev: number; ino: number; mode: number }; after: { dev: number; ino: number; mode: number } },
  foreignTemp: null as null | { body: string; ino: number; mode: number },
  foreignTarget: null as null | { body: string; ino: number; mode: number },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const native = await importOriginal<typeof NativeFs>();
  selected.native = native;
  const isTemp = (value: unknown): value is string => typeof value === 'string' &&
    selected.target !== '' && value.startsWith(selected.target + '.tmp.');
  async function snapshot(path: string) {
    const info = await native.lstat(path);
    return { body: await native.readFile(path, 'utf8'), ino: info.ino, mode: info.mode };
  }
  async function swapParent() {
    await native.rename(selected.parent, selected.moved);
    await native.mkdir(selected.parent, { mode: 0o700 });
    await native.writeFile(selected.target, 'foreign target sentinel', { flag: 'wx', mode: 0o600 });
    await native.writeFile(selected.temp, 'foreign temp sentinel', { flag: 'wx', mode: 0o600 });
    selected.foreignTarget = await snapshot(selected.target);
    selected.foreignTemp = await snapshot(selected.temp);
    selected.swaps++;
  }
  const writeError = () => Object.assign(new Error('CONTROLLED_ATOMIC_WRITE_EIO'), { code: 'EIO' });
  const closeError = () => Object.assign(new Error('CONTROLLED_ATOMIC_CLOSE_EIO'), { code: 'EIO' });
  async function afterFullWrite() {
    selected.fullWrites++;
    if (selected.fullWrites !== 1) throw new Error('Controlled payload was completed twice');
    const actual = await native.readFile(selected.temp);
    if (!actual.equals(selected.payload)) throw new Error('Native full-write payload differs');
    if (selected.phase === 'swap-write' || selected.phase === 'swap-write-error') {
      selected.reached++;
      await swapParent();
      if (selected.phase === 'swap-write-error') throw writeError();
    } else if (selected.phase === 'mode-after') {
      const before = await native.lstat(selected.temp);
      await native.chmod(selected.temp, 0o644);
      const after = await native.lstat(selected.temp);
      selected.chmodProof = { before: { dev: before.dev, ino: before.ino, mode: before.mode }, after: { dev: after.dev, ino: after.ino, mode: after.mode } };
      selected.reached++;
    } else if (selected.phase === 'cancel-write' || selected.phase === 'cancel-close-error') {
      selected.abort.abort(new Error('CONTROLLED_ATOMIC_CANCEL'));
      selected.reached++;
    } else if (selected.phase === 'write-close-error') {
      selected.reached++;
      throw writeError();
    }
  }
  return {
    ...native,
    async writeFile(...args: Parameters<typeof native.writeFile>) {
      if (!isTemp(args[0])) return native.writeFile(...args);
      selected.temp = args[0];
      selected.requestedModes.push((args[2] as { mode?: number } | undefined)?.mode);
      if (selected.phase === 'creator-exists') {
        await native.writeFile(selected.temp, 'unowned exclusive creator sentinel', { flag: 'wx', mode: 0o600 });
        selected.foreignTemp = await snapshot(selected.temp);
      }
      try {
        await native.writeFile(...args);
      } catch (error) {
        if (selected.phase === 'creator-exists' && (error as NodeJS.ErrnoException).code === 'EEXIST') {
          selected.actualCreatorEexist++;
          selected.reached++;
        }
        throw error;
      }
      selected.baselineWriteCompletions++;
      selected.written = selected.payload.length;
      await afterFullWrite();
    },
    async open(...args: Parameters<typeof native.open>) {
      if (!isTemp(args[0])) return native.open(...args);
      const flags = args[1];
      if (flags === undefined) throw new Error('Controlled temp creator requires explicit open flags');
      selected.temp = args[0];
      selected.openAttempts++;
      selected.requestedModes.push(args[2] as number | undefined);
      selected.creatorOpenFlags.push(flags);
      if (selected.phase === 'creator-exists') {
        await native.writeFile(selected.temp, 'unowned exclusive creator sentinel', { flag: 'wx', mode: 0o600 });
        selected.foreignTemp = await snapshot(selected.temp);
      }
      let handle: Awaited<ReturnType<typeof native.open>>;
      try { handle = await native.open(...args); }
      catch (error) {
        if (selected.phase === 'creator-exists' && (error as NodeJS.ErrnoException).code === 'EEXIST') {
          selected.actualCreatorEexist++;
          selected.reached++;
        }
        throw error;
      }
      selected.acquired++;
      selected.handles.push(handle);
      if (selected.phase === 'swap-acquire') { selected.reached++; await swapParent(); }
      if (selected.phase === 'mode-before' || selected.phase === 'mode-close-error') {
        const before = await handle.stat();
        await handle.chmod(0o644);
        const after = await handle.stat();
        selected.chmodProof = { before: { dev: before.dev, ino: before.ino, mode: before.mode }, after: { dev: after.dev, ino: after.ino, mode: after.mode } };
        selected.reached++;
      }
      const write = handle.write.bind(handle);
      const stat = handle.stat.bind(handle);
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'write') return async (...writeArgs: unknown[]) => {
            const result: unknown = await Reflect.apply(write, target, writeArgs);
            if (typeof result !== 'object' || result === null ||
                !('bytesWritten' in result) || typeof result.bytesWritten !== 'number') {
              throw new Error('Native write did not return its byte count');
            }
            selected.written += result.bytesWritten;
            if (selected.written === selected.payload.length) await afterFullWrite();
            return result;
          };
          if (key === 'stat') return async (...statArgs: unknown[]) => {
            const info: unknown = await Reflect.apply(stat, target, statArgs);
            if (typeof info !== 'object' || info === null ||
                !('mode' in info) || (typeof info.mode !== 'number' && typeof info.mode !== 'bigint') ||
                !('uid' in info) || (typeof info.uid !== 'number' && typeof info.uid !== 'bigint')) {
              throw new Error('Native stat did not return mode and uid');
            }
            selected.creatorStats.push({ mode: Number(info.mode), uid: Number(info.uid), afterFullWrite: selected.fullWrites === 1 });
            return info;
          };
          if (key === 'close') return async () => {
            selected.closeAttempts++;
            await target.close();
            selected.nativeCloseResolutions++;
            selected.closedWitness = target.fd === -1;
            if (['close-error', 'write-close-error', 'mode-close-error', 'cancel-close-error'].includes(selected.phase)) {
              if (selected.phase === 'close-error') selected.reached++;
              throw closeError();
            }
          };
          const value: unknown = Reflect.get(target, key, target);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]): unknown => {
            const result: unknown = Reflect.apply(value, target, args);
            return result;
          };
        },
      });
    },
    async realpath(...args: Parameters<typeof native.realpath>) {
      const canonical = await native.realpath(...args);
      if (args[0] === selected.parent && selected.phase === 'cancel-parent-check' && selected.fullWrites === 1 && selected.reached === 0) {
        selected.reached++;
        await swapParent();
        selected.abort.abort(new Error('CONTROLLED_ATOMIC_CANCEL'));
      }
      return canonical;
    },
    async link(...args: Parameters<typeof native.link>) {
      if (args[0] !== selected.temp || args[1] !== selected.target) return native.link(...args);
      selected.linkCalls++;
      await native.link(...args);
      selected.linkCommits++;
      if (selected.phase === 'swap-link') { selected.reached++; await swapParent(); }
    },
    async rename(...args: Parameters<typeof native.rename>) {
      if (args[0] !== selected.temp || args[1] !== selected.target) return native.rename(...args);
      selected.renameCalls++;
      await native.rename(...args);
      selected.renameCommits++;
      if (selected.phase === 'swap-rename') { selected.reached++; await swapParent(); }
    },
  };
});

import { atomicPublish } from '../src/atomic-publish.js';

async function observed(path: string) {
  const native = selected.native!;
  try {
    const info = await native.lstat(path);
    return { body: await native.readFile(path, 'utf8'), ino: info.ino, mode: info.mode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function publish(phase: Phase, overwrite = false) {
  selected.phase = phase;
  return atomicPublish(selected.target, selected.payload, overwrite, {}, selected.abort.signal);
}
function expectOnceClosedIfHandleWasAcquired() {
  if (selected.acquired) {
    expect(selected.closeAttempts).toBe(1);
    expect(selected.nativeCloseResolutions).toBe(1);
    expect(selected.closedWitness).toBe(true);
  }
}
async function expectForeignSentinels() {
  expect(await observed(selected.temp)).toEqual(selected.foreignTemp);
  expect(await observed(selected.target)).toEqual(selected.foreignTarget);
}
beforeEach(async () => {
  const native = selected.native!;
  selected.root = await native.realpath(await native.mkdtemp(join(tmpdir(), 'wyreup-atomic-phases-')));
  selected.parent = join(selected.root, 'trusted');
  selected.moved = join(selected.root, 'moved-original');
  await native.mkdir(selected.parent, { mode: 0o700 });
  selected.target = join(selected.parent, 'result.bin');
  selected.temp = '';
  selected.phase = 'ordinary';
  selected.abort = new AbortController();
  for (const key of ['reached', 'swaps', 'written', 'fullWrites', 'baselineWriteCompletions', 'openAttempts', 'acquired', 'closeAttempts', 'nativeCloseResolutions', 'linkCalls', 'linkCommits', 'renameCalls', 'renameCommits', 'actualCreatorEexist'] as const) selected[key] = 0;
  selected.closedWitness = false;
  selected.requestedModes = []; selected.creatorOpenFlags = []; selected.creatorStats = []; selected.handles = [];
  selected.foreignTarget = null; selected.foreignTemp = null;
  selected.chmodProof = null;
});
afterEach(async () => {
  // Test-owned emergency disposal is not credited as production once-close.
  for (const handle of selected.handles) if (handle.fd !== -1) await handle.close();
  await selected.native!.rm(selected.root, { recursive: true, force: true });
  selected.target = '';
});

describe.sequential('actual native publication phase preservation', () => {
  it.each(['swap-write', 'swap-write-error'] as const)('preserves foreign temp/target after %s', async (phase) => {
    const error = await publish(phase);
    expect(selected.reached).toBe(1); expect(selected.swaps).toBe(1); expect(selected.fullWrites).toBe(1);
    expect(selected.linkCommits + selected.renameCommits).toBe(0);
    await expectForeignSentinels();
    expect((await observed(join(selected.moved, basename(selected.temp))))?.body).toBe(selected.payload.toString());
    expect(await observed(join(selected.moved, 'result.bin'))).toBeNull();
    expect(error).toMatch(phase === 'swap-write-error' ? /CONTROLLED_ATOMIC_WRITE_EIO/ : /changed|unsafe|parent/i);
    expectOnceClosedIfHandleWasAcquired();
  });
  it('attributes actual temp creator EEXIST without deleting its unowned sentinel', async () => {
    const error = await publish('creator-exists');
    expect(selected.reached).toBe(1); expect(selected.actualCreatorEexist).toBe(1);
    expect(selected.acquired).toBe(0); expect(selected.closeAttempts).toBe(0);
    expect(selected.linkCalls + selected.renameCalls).toBe(0);
    expect(await observed(selected.temp)).toEqual(selected.foreignTemp);
    expect(await observed(selected.target)).toBeNull();
    expect(error).not.toMatch(/Target exists and allow_overwrite/i);
    expect(error).toMatch(/EEXIST|creat|temporary|temp/i);
  });
  it('acquired-handle guard preserves foreign names after a real exclusive-open parent swap', async () => {
    const error = await publish('swap-acquire');
    expect(selected.reached).toBe(1); expect(selected.acquired).toBe(1); expect(selected.swaps).toBe(1);
    await expectForeignSentinels();
    expect(error).toMatch(/changed|unsafe|parent/i);
    expect(selected.linkCalls + selected.renameCalls).toBe(0);
    expect((await observed(join(selected.moved, basename(selected.temp))))?.body).toBe(selected.payload.subarray(0, selected.written).toString());
    expectOnceClosedIfHandleWasAcquired();
  });
  it('cleans its actual own temp on cancellation with unchanged parent', async () => {
    const error = await publish('cancel-write');
    expect(selected.reached).toBe(1); expect(selected.fullWrites).toBe(1);
    expect(error).toMatch(/cancel/i);
    expect(await observed(selected.temp)).toBeNull(); expect(await observed(selected.target)).toBeNull();
    expect(selected.linkCalls + selected.renameCalls).toBe(0);
    expectOnceClosedIfHandleWasAcquired();
  });
  it('preserves foreign temp in the cancellation cleanup check/use transition', async () => {
    const error = await publish('cancel-parent-check');
    expect(selected.reached).toBe(1); expect(selected.swaps).toBe(1); expect(selected.fullWrites).toBe(1);
    expect(error).toMatch(/cancel/i);
    await expectForeignSentinels();
    expect((await observed(join(selected.moved, basename(selected.temp))))?.body).toBe(selected.payload.toString());
    expect(selected.linkCommits + selected.renameCommits).toBe(0);
    expectOnceClosedIfHandleWasAcquired();
  });
  it.each(['swap-link', 'swap-rename'] as const)('reports possibly committed after actual %s and preserves both namespaces', async (phase) => {
    const error = await publish(phase, phase === 'swap-rename');
    expect(selected.reached).toBe(1); expect(selected.swaps).toBe(1);
    expect(selected.linkCommits).toBe(phase === 'swap-link' ? 1 : 0);
    expect(selected.renameCommits).toBe(phase === 'swap-rename' ? 1 : 0);
    await expectForeignSentinels();
    const target = await observed(join(selected.moved, 'result.bin'));
    const temp = await observed(join(selected.moved, basename(selected.temp)));
    expect(target?.body).toBe(selected.payload.toString());
    if (phase === 'swap-link') { expect(temp?.body).toBe(selected.payload.toString()); expect(temp?.ino).toBe(target?.ino); }
    else expect(temp).toBeNull();
    expect(error).toMatch(/possibly committed|may.*publish|indeterminate/i);
    expectOnceClosedIfHandleWasAcquired();
  });
  it.each([false, true])('ordinary native publication overwrite=%s keeps exact payload0600/current uid', async (overwrite) => {
    if (overwrite) await selected.native!.writeFile(selected.target, 'old target', { mode: 0o600 });
    expect(await publish('ordinary', overwrite)).toBeNull();
    expect(selected.fullWrites).toBe(1); expect(selected.requestedModes).toEqual([0o600]);
    if (selected.acquired) {
      const expected = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
      expect(selected.creatorOpenFlags).toEqual([expected]);
    }
    const info = await selected.native!.lstat(selected.target);
    expect(info.mode & 0o7777).toBe(0o600); expect(info.uid).toBe(process.getuid!());
    expect((await observed(selected.target))?.body).toBe(selected.payload.toString());
    expect(await observed(selected.temp)).toBeNull();
    expectOnceClosedIfHandleWasAcquired();
  });
  it.each(['mode-before', 'mode-after'] as const)('creator guard refuses actual same-inode %s chmod without publication', async (phase) => {
    const error = await publish(phase);
    expect(selected.reached).toBe(1); expect(selected.acquired).toBe(1);
    expect(selected.fullWrites).toBe(phase === 'mode-after' ? 1 : 0);
    expect(selected.creatorStats.some((s) => (s.mode & 0o7777) === 0o644 && s.afterFullWrite === (phase === 'mode-after'))).toBe(true);
    expect(selected.chmodProof).not.toBeNull();
    expect(selected.chmodProof!.before.dev).toBe(selected.chmodProof!.after.dev);
    expect(selected.chmodProof!.before.ino).toBe(selected.chmodProof!.after.ino);
    expect(selected.chmodProof!.before.mode & 0o7777).toBe(0o600);
    expect(selected.chmodProof!.after.mode & 0o7777).toBe(0o644);
    expect(error).not.toBeNull(); expect(await observed(selected.target)).toBeNull();
    expect(selected.linkCalls + selected.renameCalls).toBe(0); expectOnceClosedIfHandleWasAcquired();
  });
  it.each(['close-error', 'write-close-error', 'mode-close-error', 'cancel-close-error'] as const)('native-close witness with rejected %s is never retried or published', async (phase) => {
    const error = await publish(phase);
    expect(selected.reached).toBe(1); expect(selected.acquired).toBe(1);
    expect(selected.closeAttempts).toBe(1); expect(selected.nativeCloseResolutions).toBe(1); expect(selected.closedWitness).toBe(true);
    expect(selected.linkCalls + selected.renameCalls).toBe(0); expect(await observed(selected.target)).toBeNull();
    if (phase === 'close-error') expect(error).toMatch(/CONTROLLED_ATOMIC_CLOSE_EIO/);
    else {
      expect(error).not.toMatch(/CONTROLLED_ATOMIC_CLOSE_EIO/);
      expect(error).toMatch(phase === 'write-close-error' ? /CONTROLLED_ATOMIC_WRITE_EIO/ : phase === 'cancel-close-error' ? /cancel/i : /mode|permission|0600|unsafe|owned/i);
    }
  });
});
