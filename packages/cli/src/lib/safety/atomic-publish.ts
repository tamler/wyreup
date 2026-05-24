// Atomic, symlink-safe output publishing — single source of truth.
// Used by both server.ts (chain branch, in-process escape hatch) and
// worker.ts (default per-call worker path). Implementation per [spec §#4]:
// tmp+rename for allow_overwrite=true; tmp+link for the exclusive-create
// case; lstat-reject for any symlink target regardless of mode.

import { link, lstat, rename, unlink, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicPublish(
  target: string,
  bytes: Uint8Array,
  allowOverwrite: boolean,
): Promise<string | null> {
  try {
    const s = await lstat(target);
    if (s.isSymbolicLink()) return `Refusing to write to symlink: ${target}`;
    if (!allowOverwrite && (s.isFile() || s.isDirectory())) {
      return `Target exists and allow_overwrite is false: ${target}`;
    }
  } catch { /* ENOENT — fine */ }

  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp.${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    await writeFile(tmp, bytes, { flag: 'wx', mode: 0o644 });
    if (allowOverwrite) {
      await rename(tmp, target);
    } else {
      await link(tmp, target);
      await unlink(tmp);
    }
    return null;
  } catch (err) {
    await unlink(tmp).catch(() => {});
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return `Target exists and allow_overwrite is false: ${target}`;
    return `Could not publish ${target}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
