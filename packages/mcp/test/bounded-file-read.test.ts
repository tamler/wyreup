import { describe, expect, it } from 'vitest';
import { execFile, type ExecFileException } from 'node:child_process';
import { chmod, mkdtemp, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { readCanonicalFileBounded } from '../src/bounded-file-read.js';

describe('bounded canonical file reads', () => {
  it('refuses an owned FIFO without waiting for a writer', async () => {
    if (process.platform === 'win32') return;
    const root = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-fifo-read-')));
    try {
      const bundle = await build({
        entryPoints: [fileURLToPath(new URL('../src/bounded-file-read.ts', import.meta.url))],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
      });
      const reader = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`;
      const program = `
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readCanonicalFileBounded } from ${JSON.stringify(reader)};
execFileSync('mkfifo', [process.argv[1]], { timeout: 1000, killSignal: 'SIGTERM' });
console.log('FIFO_READY');
await assert.rejects(readCanonicalFileBounded(process.argv[1], 16), /Expected a regular file/);
console.log('FIFO_REGULAR_FILE_REFUSED');
`;
      const pending = promisify(execFile)(
        process.execPath,
        ['--input-type=module', '-e', program, join(root, 'input.fifo')],
        { timeout: 4000, killSignal: 'SIGTERM', maxBuffer: 64 * 1024 },
      );
      pending.child.stdin?.end();
      const result = await pending.catch((error: unknown) => {
        const detail = error as ExecFileException & { stdout?: string; stderr?: string };
        console.error('FIFO child failure', {
          stdout: detail.stdout,
          stderr: detail.stderr,
          killed: detail.killed,
          signal: detail.signal,
          code: detail.code,
        });
        throw error;
      });
      expect(result.stdout).toBe('FIFO_READY\nFIFO_REGULAR_FILE_REFUSED\n');
      expect(result.stderr).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);

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
