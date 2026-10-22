import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createWyreupMcpServer } from '../src/server.js';
import { atomicPublish } from '../src/atomic-publish.js';

const FIXTURES = new URL('../../core/test/fixtures', import.meta.url).pathname;

async function callTool(srv: unknown, name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const handlers = (srv as any)._requestHandlers as Map<
    string,
    (req: unknown, extra: unknown) => unknown
  >;
  return handlers.get('tools/call')!(
    { method: 'tools/call', params: { name, arguments: args } },
    {},
  ) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('atomic overwrite [spec §#4]', () => {
  const ORIG_KEY = process.env['WYREUP_API_KEY'];
  const ORIG_ALLOW = process.env['WYREUP_ALLOW_PATHS'];

  beforeAll(() => {
    process.env['WYREUP_API_KEY'] = 'wk_test_ow';
    process.env['WYREUP_ALLOW_PATHS'] = `${FIXTURES}${delimiter}${tmpdir()}`;
  });
  afterAll(() => {
    if (ORIG_KEY === undefined) delete process.env['WYREUP_API_KEY'];
    else process.env['WYREUP_API_KEY'] = ORIG_KEY;
    if (ORIG_ALLOW === undefined) delete process.env['WYREUP_ALLOW_PATHS'];
    else process.env['WYREUP_ALLOW_PATHS'] = ORIG_ALLOW;
  });

  it('fails when target exists and allow_overwrite is false', async () => {
    const srv = await createWyreupMcpServer();
    const tmp = await mkdtemp(join(tmpdir(), 'wymcp-ow-'));
    const out = join(tmp, 'exists.jpg');
    await writeFile(out, 'preexisting');
    const r = await callTool(srv, 'compress', {
      input_paths: [join(FIXTURES, 'photo.jpg')],
      output_path: out,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/allow_overwrite/);
    expect(await readFile(out, 'utf8')).toBe('preexisting');
  });

  it('succeeds with allow_overwrite: true', async () => {
    const srv = await createWyreupMcpServer();
    const tmp = await mkdtemp(join(tmpdir(), 'wymcp-ow-'));
    const out = join(tmp, 'exists.jpg');
    await writeFile(out, 'preexisting');
    const r = await callTool(srv, 'compress', {
      input_paths: [join(FIXTURES, 'photo.jpg')],
      output_path: out,
      allow_overwrite: true,
    });
    expect(r.isError).toBeFalsy();
    expect((await stat(out)).size).toBeGreaterThan(100);
  });

  it('rejects writing to a symlink in both modes', async () => {
    const srv = await createWyreupMcpServer();
    const tmp = await mkdtemp(join(tmpdir(), 'wymcp-ow-'));
    const sensitive = join(tmp, 'sensitive.txt');
    await writeFile(sensitive, 'protected');
    const linkPath = join(tmp, 'output.jpg');
    await symlink(sensitive, linkPath);
    for (const overwrite of [false, true]) {
      const r = await callTool(srv, 'compress', {
        input_paths: [join(FIXTURES, 'photo.jpg')],
        output_path: linkPath,
        allow_overwrite: overwrite,
      });
      expect(r.isError, `allow_overwrite=${overwrite}`).toBe(true);
      expect(r.content[0]?.text).toMatch(/symlink/i);
      expect(await readFile(sensitive, 'utf8')).toBe('protected');
    }
  });
});

describe('atomicPublish concurrent writes', () => {
  it('publishes safely when the target is directly in the sticky shared temp directory', async () => {
    if (process.platform === 'win32') return;
    const root = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-sticky-parent-')));
    const shared = join(root, 'shared');
    await mkdir(shared, { mode: 0o1777 });
    await chmod(shared, 0o1777);
    const target = join(shared, 'result.bin');
    try {
      expect(await atomicPublish(target, new Uint8Array([1, 2, 3]), false)).toBeNull();
      expect(await readFile(target)).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      await unlink(target).catch(() => {});
    }
  });

  it('refuses a non-sticky output directory writable by another OS identity', async () => {
    if (process.platform === 'win32') return;
    const root = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-unsafe-output-')));
    const target = join(root, 'result.bin');
    await chmod(root, 0o777);
    try {
      expect(await atomicPublish(target, new Uint8Array([1]), false)).toMatch(
        /unsafe output directory/i,
      );
      await expect(readFile(target)).rejects.toThrow();
    } finally {
      await chmod(root, 0o700);
    }
  });

  it('does not create missing directories below an unsafe existing ancestor', async () => {
    if (process.platform === 'win32') return;
    const root = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-unsafe-ancestor-')));
    const missingParent = join(root, 'missing', 'nested');
    await chmod(root, 0o777);
    try {
      expect(
        await atomicPublish(join(missingParent, 'result.bin'), new Uint8Array([1]), false),
      ).toMatch(/unsafe output directory/i);
      await expect(stat(join(root, 'missing'))).rejects.toThrow();
    } finally {
      await chmod(root, 0o700);
    }
  });

  it('two concurrent atomicPublish calls to the same target — exactly one wins, one fails', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-race-')));
    const target = join(tmp, 'race.bin');
    const [a, b] = await Promise.all([
      atomicPublish(target, new Uint8Array([1]), false),
      atomicPublish(target, new Uint8Array([2]), false),
    ]);
    const wins = [a, b].filter((r) => r === null).length;
    const losses = [a, b].filter((r) => r !== null).length;
    expect(wins).toBe(1);
    expect(losses).toBe(1);
  });

  it('rejects a parent directory swapped to a symlink after validation', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-parent-swap-')));
    const trustedParent = join(root, 'trusted');
    const movedParent = join(root, 'moved');
    const outsideParent = join(root, 'outside');
    await mkdir(trustedParent);
    await mkdir(outsideParent);
    const target = join(trustedParent, 'result.bin');

    const error = await atomicPublish(target, new Uint8Array([1]), false, {
      afterParentValidation: async () => {
        await rename(trustedParent, movedParent);
        await symlink(outsideParent, trustedParent);
      },
    });

    expect(error).toMatch(/changed or symbolic parent/i);
    await expect(readFile(join(outsideParent, 'result.bin'))).rejects.toThrow();
    await expect(readFile(join(movedParent, 'result.bin'))).rejects.toThrow();
  });
});

describe('atomicPublish file mode', () => {
  it('writes the published file with mode 0o600 (owner-only)', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-mode-')));
    const target = join(tmp, 'mode.bin');
    const err = await atomicPublish(target, new Uint8Array([0xde, 0xad, 0xbe, 0xef]), false);
    expect(err).toBeNull();
    const s = await stat(target);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('preserves 0o600 across overwrite (tmp+rename path)', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-mode-ow-')));
    const target = join(tmp, 'mode.bin');
    await writeFile(target, 'existing');
    const err = await atomicPublish(target, new Uint8Array([0x00]), true);
    expect(err).toBeNull();
    const s = await stat(target);
    expect(s.mode & 0o777).toBe(0o600);
  });
});
