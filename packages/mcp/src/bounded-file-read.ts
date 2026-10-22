import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkDirectoryProtection } from './path-security.js';

const READ_CHUNK_BYTES = 64 * 1024;

/** Read one canonical regular file without following a swapped final symlink. */
export async function readCanonicalFileBounded(
  path: string,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const protection = await checkDirectoryProtection(dirname(path));
  if (protection.error) throw new Error(`Refusing unsafe input directory: ${protection.error}`);

  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const [canonicalAfterOpen, fileStat, pathStat] = await Promise.all([
      realpath(path),
      handle.stat(),
      lstat(path),
    ]);
    if (canonicalAfterOpen !== path) {
      throw new Error(`Canonical path changed while opening: ${path}`);
    }
    if (!fileStat.isFile()) throw new Error(`Expected a regular file: ${path}`);
    if (
      protection.entryMustBeOwned &&
      typeof process.getuid === 'function' &&
      fileStat.uid !== process.getuid()
    ) {
      throw new Error(`Refusing an input owned by another OS identity: ${path}`);
    }
    if (pathStat.isSymbolicLink() || pathStat.dev !== fileStat.dev || pathStat.ino !== fileStat.ino) {
      throw new Error(`Input changed after validation: ${path}`);
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (;;) {
      const remainingWithSentinel = maxBytes - totalBytes + 1;
      const chunk = new Uint8Array(Math.min(READ_CHUNK_BYTES, remainingWithSentinel));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new RangeError(`Input exceeds the remaining ${maxBytes}-byte limit`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    await handle.close().catch(() => {});
  }
}
