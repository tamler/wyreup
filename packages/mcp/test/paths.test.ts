import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, symlink, writeFile, realpath as realpathFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPathAllowed, resolveAllowedRoots } from '../src/paths.js';

let root: string; // realpath'd ephemeral allowed root
let outside: string; // realpath'd ephemeral disallowed root

beforeAll(async () => {
  root = await realpathFs(await mkdtemp(join(tmpdir(), 'wymcp-root-')));
  outside = await realpathFs(await mkdtemp(join(tmpdir(), 'wymcp-outside-')));
  await writeFile(join(outside, 'secret.txt'), 'no');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('assertPathAllowed', () => {
  it('accepts a file inside an allowed root', async () => {
    await writeFile(join(root, 'a.txt'), 'x');
    const r = await assertPathAllowed(join(root, 'a.txt'), 'read', [root]);
    expect(r.ok).toBe(true);
  });

  it('rejects absolute paths outside any allowed root', async () => {
    const r = await assertPathAllowed(join(outside, 'secret.txt'), 'read', [root]);
    expect(r.ok).toBe(false);
  });

  it('rejects relative paths up-front', async () => {
    const r = await assertPathAllowed('a.txt', 'read', [root]);
    expect(r.ok).toBe(false);
  });

  it('rejects traversal that resolves outside the allowed root', async () => {
    const r = await assertPathAllowed(join(root, '..', 'wymcp-outside-x', 'y'), 'read', [root]);
    expect(r.ok).toBe(false);
  });

  it('rejects a symlink whose target is outside the allowed root', async () => {
    const link = join(root, 'escape');
    await symlink(outside, link);
    const r = await assertPathAllowed(join(link, 'secret.txt'), 'read', [root]);
    expect(r.ok).toBe(false);
  });

  it('write-mode resolves the parent dir (target may not exist yet)', async () => {
    const r = await assertPathAllowed(join(root, 'new-file.txt'), 'write', [root]);
    expect(r.ok).toBe(true);
  });

  it('write-mode rejects when parent dir is outside the allowed root', async () => {
    const r = await assertPathAllowed(join(outside, 'new-file.txt'), 'write', [root]);
    expect(r.ok).toBe(false);
  });

  it('prefix check does not false-positive (root vs rootfoo)', async () => {
    const sibling = `${root}foo`;
    await mkdir(sibling, { recursive: true });
    try {
      const r = await assertPathAllowed(join(sibling, 'x.txt'), 'read', [root]);
      expect(r.ok).toBe(false);
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });

  it('"*" disables the allowlist', async () => {
    const r = await assertPathAllowed(join(outside, 'secret.txt'), 'read', '*');
    expect(r.ok).toBe(true);
  });
});

describe('resolveAllowedRoots', () => {
  it('returns realpath-resolved roots and drops missing entries with a warning', async () => {
    const messages: string[] = [];
    const roots = await resolveAllowedRoots([root, '/nonexistent-xyz-9999'], {
      logger: (m) => messages.push(String(m)),
    });
    expect(roots).toContain(root);
    expect(Array.isArray(roots) ? roots.includes('/nonexistent-xyz-9999') : true).toBe(false);
    expect(messages.join('\n')).toMatch(/nonexistent-xyz-9999/);
  });

  it('passes "*" through', async () => {
    expect(await resolveAllowedRoots('*')).toBe('*');
  });

  it('does not crash on case-variant input', async () => {
    const roots = await resolveAllowedRoots([root.toUpperCase()]);
    expect(Array.isArray(roots)).toBe(true);
  });
});
