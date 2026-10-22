// Atomic, symlink-safe output publishing — single source of truth.
// Used by both server.ts (chain branch, in-process escape hatch) and
// worker.ts (default per-call worker path). Implementation per [spec §#4]:
// tmp+rename for allow_overwrite=true; tmp+link for the exclusive-create
// case; lstat-reject for any symlink target regardless of mode.

import { constants } from 'node:fs';
import { link, lstat, rename, unlink, mkdir, realpath, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkDirectoryProtection } from './path-security.js';

interface AtomicPublishHooks {
  /** Test-only synchronization point for exercising a post-validation swap. */
  afterParentValidation?: () => Promise<void>;
}

async function parentMatches(
  targetParent: string,
  expected: { dev: number; ino: number },
): Promise<boolean> {
  try {
    const current = await lstat(targetParent);
    if (!current.isDirectory() || current.isSymbolicLink()) return false;
    if (current.dev !== expected.dev || current.ino !== expected.ino) return false;
    return (await realpath(targetParent)) === targetParent;
  } catch {
    return false;
  }
}

/** Create a missing parent chain only below an already protected directory. */
async function ensureProtectedParent(targetParent: string): Promise<string | null> {
  const missing: string[] = [];
  let existing = targetParent;

  for (;;) {
    try {
      const current = await lstat(existing);
      if (!current.isDirectory() || current.isSymbolicLink()) {
        return `Directory is not a real directory: ${existing}`;
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      missing.unshift(existing);
      const parent = dirname(existing);
      if (parent === existing) return `No existing output ancestor for ${targetParent}`;
      existing = parent;
    }
  }

  for (const directory of [existing, ...missing]) {
    if (directory !== existing) {
      const parent = dirname(directory);
      const parentHandle = await open(
        parent,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const parentStat = await parentHandle.stat();
      const expectedParent = { dev: parentStat.dev, ino: parentStat.ino };
      try {
        if (!(await parentMatches(parent, expectedParent))) {
          return `Directory changed while creating ${directory}`;
        }
        try {
          await mkdir(directory, { mode: 0o700 });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
        if (!(await parentMatches(parent, expectedParent))) {
          return `Directory changed while creating ${directory}`;
        }
      } finally {
        await parentHandle.close();
      }
    }

    let canonical: string;
    try {
      canonical = await realpath(directory);
    } catch (err) {
      return `Could not validate output directory ${directory}: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
    if (canonical !== directory) return `Directory is symbolic or changed: ${directory}`;
    const protection = await checkDirectoryProtection(directory);
    if (protection.error) return protection.error;
  }

  return null;
}

export async function atomicPublish(
  target: string,
  bytes: Uint8Array,
  allowOverwrite: boolean,
  hooks: AtomicPublishHooks = {},
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return 'Output publication cancelled.';
  const targetParent = dirname(target);
  const parentError = await ensureProtectedParent(targetParent);
  if (parentError) return `Refusing unsafe output directory: ${parentError}`;
  const canonicalParent = await realpath(targetParent);
  if (canonicalParent !== targetParent) {
    return `Refusing to publish through a changed or symbolic parent: ${targetParent}`;
  }
  // Keep the validated directory open and compare its device/inode with the
  // pathname before every pathname-based operation. The permission-chain
  // check above prevents a different OS identity from winning the remaining
  // check/use gap; this handle guard also catches accidental and same-identity
  // swaps at each boundary.
  const parentHandle = await open(
    targetParent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const parentChangedError = `Refusing to publish through a changed or symbolic parent: ${targetParent}`;
  let committed = false;
  let outcome: string | null = null;
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);

  try {
    const parentStat = await parentHandle.stat();
    const expectedParent = { dev: parentStat.dev, ino: parentStat.ino };
    outcome = await (async (): Promise<string | null> => {
      await hooks.afterParentValidation?.();
      if (signal?.aborted) return 'Output publication cancelled.';
      if (!(await parentMatches(targetParent, expectedParent))) return parentChangedError;

      try {
        const s = await lstat(target);
        if (s.isSymbolicLink()) return `Refusing to write to symlink: ${target}`;
        if (!allowOverwrite && (s.isFile() || s.isDirectory())) {
          return `Target exists and allow_overwrite is false: ${target}`;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      const tmp = `${target}.tmp.${process.pid}-${randomUUID().slice(0, 8)}`;
      let creator: Awaited<ReturnType<typeof open>> | undefined;
      let identity: { dev: number; ino: number; uid: number } | undefined;
      let closeUnconfirmed = false;
      async function cleanupOwnedTemp(): Promise<boolean> {
        if (!identity || !(await parentMatches(targetParent, expectedParent))) return false;
        try {
          const current = await lstat(tmp);
          if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev ||
              current.ino !== identity.ino || current.uid !== identity.uid) return false;
          // These positive checks retain the POSIX same-uid check/use gap;
          // they never authorize deletion through a known changed parent.
          await unlink(tmp);
          return true;
        } catch {
          return false;
        }
      }
      async function refuse(reason: string): Promise<string> {
        if (creator && !(await cleanupOwnedTemp())) {
          reason += ' Temporary file retained because safe cleanup could not be confirmed.';
        }
        if (closeUnconfirmed) reason += ' Temporary file handle closure could not be confirmed.';
        return reason;
      }

      if (!(await parentMatches(targetParent, expectedParent))) return parentChangedError;
      if (signal?.aborted) return 'Output publication cancelled.';
      let failed = false;
      let firstError: unknown;
      try {
        creator = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        const created = await creator.stat();
        const uid = process.getuid?.();
        if (uid === undefined || !created.isFile() || created.uid !== uid) {
          throw new Error('Temporary output is not a verified regular file owned by this process.');
        }
        identity = { dev: created.dev, ino: created.ino, uid };
        if ((created.mode & 0o7777) !== 0o600) throw new Error('Temporary output permissions are not 0600.');
        if (!(await parentMatches(targetParent, expectedParent))) throw new Error(parentChangedError);
        if (signal?.aborted) throw new Error('Output publication cancelled.');
        let offset = 0;
        while (offset < bytes.byteLength) {
          const remaining = bytes.byteLength - offset;
          const { bytesWritten } = await creator.write(bytes, offset, remaining, null);
          if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) {
            throw new Error('Temporary output write made invalid progress.');
          }
          offset += bytesWritten;
          if (signal?.aborted) throw new Error('Output publication cancelled.');
        }
        const written = await creator.stat();
        if (!written.isFile() || written.uid !== uid || written.dev !== identity.dev ||
            written.ino !== identity.ino || (written.mode & 0o7777) !== 0o600) {
          throw new Error('Temporary output no longer has its verified owned inode and 0600 permissions.');
        }
        if (signal?.aborted) throw new Error('Output publication cancelled.');
      } catch (error) {
        failed = true;
        firstError = error;
      } finally {
        if (creator) {
          try {
            await creator.close();
          } catch (error) {
            closeUnconfirmed = true;
            if (!failed) {
              failed = true;
              firstError = error;
            }
          }
        }
      }
      if (failed) {
        return refuse(`Could not ${creator ? 'publish' : 'create temporary output for'} ${target}: ${message(firstError)}`);
      }
      try {
        if (!(await parentMatches(targetParent, expectedParent))) return refuse(parentChangedError);
        if (signal?.aborted) return refuse('Output publication cancelled.');
        const current = await lstat(tmp);
        if (!identity || !current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev ||
            current.ino !== identity.ino || current.uid !== identity.uid || (current.mode & 0o7777) !== 0o600) {
          return refuse('Temporary output pathname no longer identifies its verified owned 0600 inode.');
        }
        if (!(await parentMatches(targetParent, expectedParent))) return refuse(parentChangedError);
        if (signal?.aborted) return refuse('Output publication cancelled.');
        if (allowOverwrite) await rename(tmp, target);
        else await link(tmp, target);
        committed = true;
        if (!(await parentMatches(targetParent, expectedParent)) || signal?.aborted) {
          return `Output publication possibly committed; its parent changed or cancellation arrived after commit: ${target}`;
        }
        if (!allowOverwrite && !(await cleanupOwnedTemp())) {
          return `Output publication possibly committed; safe temporary-file cleanup could not be confirmed: ${target}`;
        }
        if (!(await parentMatches(targetParent, expectedParent))) {
          return `Output publication possibly committed; its parent changed after commit: ${target}`;
        }
        return null;
      } catch (error) {
        if (committed) return `Output publication possibly committed: ${target}: ${message(error)}`;
        if (!allowOverwrite && (error as NodeJS.ErrnoException).code === 'EEXIST') {
          return refuse(`Target exists and allow_overwrite is false: ${target}`);
        }
        return refuse(`Could not publish ${target}: ${message(error)}`);
      }
    })();
  } catch (error) {
    outcome = committed
      ? `Output publication possibly committed: ${target}: ${message(error)}`
      : `Could not publish ${target}: ${message(error)}`;
  } finally {
    try {
      await parentHandle.close();
    } catch (error) {
      outcome = outcome === null
        ? `${committed ? 'Output publication possibly committed' : 'Could not publish'} ${target}: ${message(error)}; output directory handle closure could not be confirmed.`
        : `${outcome} Output directory handle closure could not be confirmed.`;
    }
  }
  return outcome;
}
