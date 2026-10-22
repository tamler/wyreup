import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, realpath, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCanonicalFileBounded } from '../src/bounded-file-read.js';

describe('bounded canonical file reads', () => {
  it('reads an owned file directly from the sticky shared temp directory', async () => {
    if (process.platform === 'win32') return;
    const input = join(tmpdir(), `wymcp-sticky-read-${process.pid}-${Date.now()}.bin`);
    try {
      await writeFile(input, new Uint8Array([4, 5, 6]), { mode: 0o600 });
      expect(await readCanonicalFileBounded(await realpath(input), 16)).toEqual(
        new Uint8Array([4, 5, 6]),
      );
    } finally {
      await unlink(input).catch(() => {});
    }
  });

  it('refuses a non-sticky input directory writable by another OS identity', async () => {
    if (process.platform === 'win32') return;
    const root = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-unsafe-read-')));
    const input = join(root, 'input.bin');
    await writeFile(input, new Uint8Array([1]));
    await chmod(root, 0o777);
    try {
      await expect(readCanonicalFileBounded(input, 16)).rejects.toThrow(/unsafe input directory/i);
    } finally {
      await chmod(root, 0o700);
    }
  });

  it('stops after the configured byte ceiling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wymcp-bounded-read-'));
    const input = join(root, 'input.bin');
    await writeFile(input, new Uint8Array(128));

    await expect(readCanonicalFileBounded(await realpath(input), 16)).rejects.toThrow(/limit/i);
  });

  it('refuses a final-component symlink swapped in after validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wymcp-swapped-read-'));
    const validatedPath = join(root, 'validated.txt');
    const movedPath = join(root, 'moved.txt');
    const outsidePath = join(root, 'outside.txt');
    await writeFile(validatedPath, 'allowed');
    await writeFile(outsidePath, 'should not be read');
    await rename(validatedPath, movedPath);
    await symlink(outsidePath, validatedPath);

    await expect(readCanonicalFileBounded(validatedPath, 1024)).rejects.toThrow();
  });
});
