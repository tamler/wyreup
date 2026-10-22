import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface DirectoryProtection {
  error: string | null;
  /** A sticky shared directory protects owned entries, not arbitrary entries. */
  entryMustBeOwned: boolean;
}

interface PathSecurityRuntime {
  platform: NodeJS.Platform;
  getuid: (() => number) | null;
}

/**
 * Ensure another OS identity cannot replace a directory (or one of its
 * ancestors) while a validated path is in use. A process running as the same
 * uid is inside the trust boundary: it can already inspect this process and
 * its files, so pathname checks cannot provide isolation from it.
 */
export async function checkDirectoryProtection(
  directory: string,
  runtime: PathSecurityRuntime = {
    platform: process.platform,
    getuid: typeof process.getuid === 'function' ? process.getuid : null,
  },
): Promise<DirectoryProtection> {
  if (runtime.platform === 'win32' || runtime.getuid === null) {
    // Node does not expose enough Windows ACL information or handle-relative
    // filesystem operations to prove this pathname safe against another local
    // identity. Fail closed instead of presenting O_NOFOLLOW as a guarantee it
    // cannot provide on Windows. WSL uses the verified POSIX path below.
    return {
      error: `Secure filesystem path operations require macOS, Linux, or WSL: ${directory}`,
      entryMustBeOwned: false,
    };
  }

  const uid = runtime.getuid();
  let current = directory;
  let child = await lstat(current);
  if (!child.isDirectory() || child.isSymbolicLink()) {
    return { error: `Directory is not a real directory: ${directory}`, entryMustBeOwned: false };
  }
  let entryMustBeOwned = false;
  if ((child.mode & 0o022) !== 0) {
    if ((child.mode & 0o1000) === 0) {
      return {
        error: `Directory is writable by another OS identity: ${directory} (mode ${(child.mode & 0o7777).toString(8).padStart(4, '0')}; requires no group/world write permission unless sticky)`,
        entryMustBeOwned: false,
      };
    }
    // Shared temp directories such as /tmp are safe for exclusive creation
    // and atomic publication. Existing entries are safe to read only when
    // owned by this uid, which the bounded reader checks after opening.
    entryMustBeOwned = true;
  }

  while (true) {
    const parent = dirname(current);
    if (parent === current) return { error: null, entryMustBeOwned };

    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      return {
        error: `Directory ancestor is not a real directory: ${parent}`,
        entryMustBeOwned,
      };
    }
    if ((parentStat.mode & 0o022) !== 0) {
      const sticky = (parentStat.mode & 0o1000) !== 0;
      if (!sticky || child.uid !== uid) {
        return {
          error: `Directory ancestor can be replaced by another OS identity: ${current}; parent ${parent} has mode ${(parentStat.mode & 0o7777).toString(8).padStart(4, '0')} (shared sticky parents also require the child to be owned by this uid)`,
          entryMustBeOwned,
        };
      }
    }

    current = parent;
    child = parentStat;
  }
}
