import { describe, expect, it } from 'vitest';
import { checkDirectoryProtection } from '../src/path-security.js';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('filesystem platform boundary', () => {
  it('identifies the offending octal mode without weakening directory protection', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-mode-')));
    try {
      await chmod(directory, 0o777);
      const result = await checkDirectoryProtection(directory);
      expect(result.error).toContain(directory);
      expect(result.error).toContain('mode 0777');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('fails closed on native Windows before touching the path', async () => {
    const result = await checkDirectoryProtection('C:\\shared\\output', {
      platform: 'win32',
      getuid: null,
    });

    expect(result.error).toMatch(/macOS, Linux, or WSL/i);
    expect(result.entryMustBeOwned).toBe(false);
  });
});
