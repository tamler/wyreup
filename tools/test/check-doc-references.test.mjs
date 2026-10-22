import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../check-doc-references.mjs', import.meta.url));
const actualCore = fileURLToPath(new URL('../../packages/core', import.meta.url));
const buildFirst =
  'doc references: cannot load valid built registry metadata. Build @wyreup/core first: pnpm --filter @wyreup/core... build';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function copiedChecker(markdown, mode = 'real', extraFiles = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-doc-references-')));
  try {
    await mkdir(join(root, 'tools'));
    const original = await readFile(script);
    const copied = join(root, 'tools/check-doc-references.mjs');
    await writeFile(copied, original, { flag: 'wx' });
    // This checks the exact newly created JavaScript copy before executing it.
    execFileSync(process.execPath, ['--check', copied], { timeout: 10000 });
    expect(digest(await readFile(copied))).toBe(digest(original));
    if (mode === 'real') {
      await mkdir(join(root, 'packages'));
      await symlink(actualCore, join(root, 'packages/core'), 'dir');
    } else if (mode === 'unloadable') {
      // A directory at the entry path cannot be imported as the shipped module.
      // No registry/module fixture or replacement scanning algorithm is supplied.
      await mkdir(join(root, 'packages/core/dist/node/index.js'), { recursive: true });
    }
    await writeFile(join(root, 'README.md'), markdown, { flag: 'wx' });
    for (const [name, content] of Object.entries(extraFiles)) {
      const destination = join(root, name);
      await mkdir(join(destination, '..'), { recursive: true });
      await writeFile(destination, content, { flag: 'wx' });
    }
    const result = spawnSync(process.execPath, [copied], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      killSignal: 'SIGTERM',
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('shipped doc-reference checker with actual built registry metadata', () => {
  it('accepts actual registered factory references without tool-directory placeholders', async () => {
    const result = await copiedChecker(
      'wyreup loan-calculator\nwyreup bank-statement-to-csv\nwyreup robots-txt-generator\n',
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^doc references: ok \(\d+ markdown files scanned\)\n$/);
  });

  it.each([
    ['CLI', 'wyreup not-a-registered-doc-tool\n', 'unknown-tool-id'],
    ['page', '[Bad](/tools/not-a-registered-doc-tool)\n', 'unknown-tools-link'],
    ['chain', '/chain?steps=compress%7Cnot-a-registered-doc-tool\n', 'unknown-chain-step'],
  ])(
    'refuses an unknown %s reference through the actual scanner',
    async (_label, markdown, kind) => {
      const result = await copiedChecker(markdown);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('doc references: 1 issue(s)');
      expect(result.stderr).toContain(`${kind}: 1`);
      expect(result.stderr).toContain('not-a-registered-doc-tool');
    },
  );

  it.each(['@wyreup/skill', '@wyreup/cli-skill', '@wyreup/mcp-skill'])(
    'refuses active installation of retired %s',
    async (name) => {
      const result = await copiedChecker(`npm install ${name}\n`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('retired-package: 1');
      expect(result.stderr).toContain(name);
    },
  );

  it('retains surrounding-line deprecation context for the original retired package rules', async () => {
    const result = await copiedChecker(
      'These packages were retired.\n@wyreup/skill @wyreup/cli-skill @wyreup/mcp-skill\nUse their replacement.\n',
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('retains CLI subcommands, original non-tool exceptions and API-path exceptions', async () => {
    const result = await copiedChecker(
      'wyreup run\nwyreup chain\nwyreup login\nwyreup logout\nwyreup balance\n' +
        'wyreup gen-pwa-icons\nwyreup adds\nwyreup ships\nwyreup project\nwyreup account\n' +
        'wyreup db\nwyreup serve\nwyreup auth\n/api/tools/not-a-registered-doc-tool\n',
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('retains original changelog, dated audit and historical planning exclusions', async () => {
    const invalid = 'wyreup not-a-registered-doc-tool\nnpm install @wyreup/skill\n';
    const result = await copiedChecker('Ordinary documentation.\n', 'real', {
      'docs/CHANGELOG.md': invalid,
      'docs/audit-2026-10-12.md': invalid,
      'docs/superpowers/historical.md': invalid,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each(['missing', 'unloadable'])(
    'refuses %s built metadata with deterministic build-first guidance',
    async (mode) => {
      const result = await copiedChecker('Ordinary documentation.\n', mode);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(`${buildFirst}\n`);
    },
  );
});
