import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicPublish } from '../src/lib/safety/atomic-publish.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wycli-ow-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CLI atomic publish', () => {
  it('refuses to overwrite an existing file when allowOverwrite=false', async () => {
    const target = join(dir, 'exists.txt');
    await writeFile(target, 'preexisting');
    const err = await atomicPublish(target, new Uint8Array([0xff]), false);
    expect(err).toMatch(/allow_overwrite/);
    expect(await readFile(target, 'utf8')).toBe('preexisting');
  });

  it('overwrites with allowOverwrite=true', async () => {
    const target = join(dir, 'exists.txt');
    await writeFile(target, 'preexisting');
    const err = await atomicPublish(target, new Uint8Array([0xff, 0xfe, 0xfd]), true);
    expect(err).toBeNull();
    expect((await stat(target)).size).toBe(3);
  });

  it('rejects writing to a symlink in both modes', async () => {
    const sensitive = join(dir, 'sensitive.txt');
    await writeFile(sensitive, 'protected');
    const link = join(dir, 'output.bin');
    await symlink(sensitive, link);
    for (const overwrite of [false, true]) {
      const err = await atomicPublish(link, new Uint8Array([0x00]), overwrite);
      expect(err, `overwrite=${overwrite}`).toMatch(/symlink/i);
      expect(await readFile(sensitive, 'utf8')).toBe('protected');
    }
  });

  it('writes published files with mode 0o600 (owner-only) in both no-overwrite and overwrite paths', async () => {
    const linkPath = join(dir, 'fresh.bin');
    const err1 = await atomicPublish(linkPath, new Uint8Array([0x01]), false);
    expect(err1).toBeNull();
    expect((await stat(linkPath)).mode & 0o777).toBe(0o600);

    const overTarget = join(dir, 'existing.bin');
    await writeFile(overTarget, 'old');
    const err2 = await atomicPublish(overTarget, new Uint8Array([0x02]), true);
    expect(err2).toBeNull();
    expect((await stat(overTarget)).mode & 0o777).toBe(0o600);
  });
});
