import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertNpmMajor, resolveNpmCli } from '../consumer-package-managers.mjs';

const exec = promisify(execFile);
let directory;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'wyreup-npm-selection-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function script(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  await exec(process.execPath, ['--check', file]);
}

async function windowsFixture(rootOutput) {
  const node = path.join(directory, 'node runtime with spaces', 'node.exe');
  const globalRoot = path.join(directory, 'selected npm with spaces', 'node_modules');
  const bundled = path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js');
  const selected = path.join(globalRoot, 'npm/bin/npm-cli.js');
  await mkdir(path.dirname(node), { recursive: true });
  await symlink(process.execPath, node);
  await script(bundled, `console.log(process.argv[2] === 'root' && process.argv[3] === '-g' ? ${JSON.stringify(rootOutput ?? globalRoot)} : '11.19.0');\n`);
  await script(selected, "console.log('12.0.2');\n");
  return { node, bundled, selected, globalRoot };
}

describe('consumer npm executable selection', () => {
  it('runs globally selected npm12 instead of bundled npm11, including paths containing spaces', async () => {
    const { node, bundled, selected } = await windowsFixture();
    expect((await exec(node, [bundled, '--version'])).stdout.trim()).toBe('11.19.0');
    const cli = await resolveNpmCli({ platform: 'win32', node });
    expect(cli).toBe(await realpath(selected));
    const version = (await exec(node, [cli, '--version'])).stdout.trim();
    expect(version).toBe('12.0.2');
    expect(() => assertNpmMajor(version, '12', true)).not.toThrow();
  });

  it('refuses a missing global selected npm rather than falling back to bundled npm11', async () => {
    const { node, selected } = await windowsFixture();
    await rm(selected);
    await expect(resolveNpmCli({ platform: 'win32', node })).rejects.toThrow();
  });

  it.each(['relative/path', '', '/first\n/second'])('rejects malformed global locator output %j', async output => {
    const { node } = await windowsFixture(output);
    await expect(resolveNpmCli({ platform: 'win32', node })).rejects.toThrow('Invalid npm global root');
  });

  it('preserves POSIX PATH npm selection independently of a custom global prefix', async () => {
    if (process.platform === 'win32') return;
    const cli = await resolveNpmCli();
    const active = await realpath((await exec('which', ['npm'])).stdout.trim());
    expect(cli).toBe(active);
    expect((await exec(process.execPath, [cli, '--version'])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('consumer npm matrix preflight', () => {
  it.each([['11.19.0', '11'], ['12.0.2', '12']])('accepts actual npm %s for expected major %s', (version, expected) => {
    expect(() => assertNpmMajor(version, expected, true)).not.toThrow();
  });
  it('rejects the actual bundled npm11 for the required npm12 lane', () => {
    expect(() => assertNpmMajor('11.19.0', '12', true)).toThrow('does not match expected major 12');
  });
  it('requires an expected major in CI', () => {
    expect(() => assertNpmMajor('12.0.2', undefined, true)).toThrow('required in CI');
  });
  it.each(['', '12.x', '0', '-12'])('rejects invalid configured expected major %j', expected => {
    expect(() => assertNpmMajor('12.0.2', expected, true)).toThrow('Invalid expected npm major');
  });
  it('rejects malformed actual version instead of inferring a major', () => {
    expect(() => assertNpmMajor('12.something', '12', true)).toThrow('Invalid npm version');
  });
  it('permits local actual-version reporting but honors any configured local major', () => {
    expect(() => assertNpmMajor('12.0.2', undefined, false)).not.toThrow();
    expect(() => assertNpmMajor('11.19.0', '12', false)).toThrow('does not match expected major 12');
  });
});
