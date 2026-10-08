import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { c as createTar } from 'tar';
import { inspectTarball } from '../check-release-artifacts.mjs';
import { assertMinimumVersion, checkInstalledVersions, minimumVersions } from '../check-dependency-versions.mjs';

let directory;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'wyreup-artifact-test-'));
  await mkdir(path.join(directory, 'package'));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function pack(manifest) {
  await writeFile(path.join(directory, 'package/package.json'), JSON.stringify(manifest));
  const file = path.join(directory, 'package.tgz');
  await createTar({ cwd: directory, file, gzip: true }, ['package']);
  return file;
}

async function installed(relative, manifest) {
  const location = path.join(directory, relative);
  await mkdir(location, { recursive: true });
  await writeFile(path.join(location, 'package.json'), JSON.stringify(manifest));
  return location;
}

async function pnpmOuter(declarations, sharpVersion = '0.35.4') {
  const outer = await installed('node_modules/.pnpm/outer@1/node_modules/@example/outer', {
    name: '@example/outer', version: '1.0.0', ...declarations,
  });
  const sharp = await installed(`node_modules/.pnpm/sharp@${sharpVersion}/node_modules/sharp`, {
    name: 'sharp', version: sharpVersion,
  });
  await mkdir(path.join(directory, 'node_modules/@example'), { recursive: true });
  await symlink(outer, path.join(directory, 'node_modules/@example/outer'));
  await symlink(sharp, path.resolve(outer, '../../sharp'));
  return { outer, sharp };
}

describe('published dependency security', () => {
  it('inspects the actual packed manifest and file contents', async () => {
    const file = await pack({ name: '@wyreup/example', version: '1.0.0', dependencies: { sharp: '^0.35.5' } });
    const result = await inspectTarball(file);
    expect(result.manifest.dependencies.sharp).toBe('^0.35.5');
    expect(result.files.get('package/package.json')).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(['@huggingface/transformers', 'onnxruntime-node', 'adm-zip'])('rejects an unconstrained %s dependency even if it is optional', async (name) => {
    const file = await pack({ name: '@wyreup/example', version: '1.0.0', optionalDependencies: { [name]: '*' } });
    await expect(inspectTarball(file)).rejects.toThrow('Unverified dependency range');
  });

  it('accepts patched official upstream packages', async () => {
    const file = await pack({ name: '@wyreup/example', version: '1.0.0', dependencies: {
      '@huggingface/transformers': '^4.3.1', 'onnxruntime-node': '^1.30.0', 'adm-zip': '^0.6.1',
    } });
    await expect(inspectTarball(file)).resolves.toMatchObject({ manifest: { name: '@wyreup/example' } });
  });

  it.each(Object.entries(minimumVersions))('rejects the affected previous %s version', (name, version) => {
    const components = version.split('.').map(Number);
    const index = components.findLastIndex(value => value > 0);
    components[index]--;
    expect(() => assertMinimumVersion(name, components.join('.'))).toThrow('Unsafe dependency version');
    expect(() => assertMinimumVersion(name, version)).not.toThrow();
  });

  it('rejects an affected nested copy despite a safe direct dependency and ordinary metadata', async () => {
    const nested = path.join(directory, 'node_modules/outer/node_modules/sharp');
    await mkdir(nested, { recursive: true });
    await mkdir(path.join(directory, 'node_modules/sharp'));
    await writeFile(path.join(directory, 'node_modules/sharp/package.json'), JSON.stringify({ name: 'sharp', version: '0.35.5' }));
    await writeFile(path.join(directory, 'node_modules/outer/package.json'), JSON.stringify({ name: 'outer', version: '1.0.0' }));
    await writeFile(path.join(directory, 'node_modules/outer/node_modules/.package-lock.json'), '{}');
    await writeFile(path.join(nested, 'package.json'), JSON.stringify({ name: 'sharp', version: '0.35.4' }));
    await expect(checkInstalledVersions(directory)).rejects.toThrow('Unsafe dependency version: sharp@0.35.4');
  });

  it('rejects linked pnpm sibling dependencies despite a safe direct copy', async () => {
    await installed('node_modules/sharp', { name: 'sharp', version: '0.35.5' });
    await pnpmOuter({ dependencies: { sharp: '^0.35.4' } });
    await expect(checkInstalledVersions(directory)).rejects.toThrow('Unsafe dependency version: sharp@0.35.4');
  });

  it('ignores unlinked obsolete store copies after an update while inspecting active links', async () => {
    await installed('node_modules/.pnpm/sharp@0.35.4/node_modules/sharp', { name: 'sharp', version: '0.35.4' });
    await pnpmOuter({ dependencies: { sharp: '^0.35.5' } }, '0.35.5');
    await expect(checkInstalledVersions(directory)).resolves.toContainEqual({ name: 'sharp', version: '0.35.5' });
  });

  it('inspects manifests even when package exports block the package.json subpath', async () => {
    await installed('node_modules/sharp', { name: 'sharp', version: '0.35.5', exports: { '.': './index.js' } });
    const require = createRequire(path.join(directory, 'package.json'));
    expect(() => require.resolve('sharp/package.json')).toThrow('not defined by "exports"');
    await expect(checkInstalledVersions(directory)).resolves.toContainEqual({ name: 'sharp', version: '0.35.5' });
  });

  it('fails a missing required consumer dependency while not requiring uninstalled dev dependencies', async () => {
    await installed('.', { name: 'consumer', version: '1.0.0', devDependencies: { 'wyreup-uninstalled-dev-fixture': '*' } });
    await expect(checkInstalledVersions(directory)).resolves.toEqual([]);
    await installed('.', { name: 'consumer', version: '1.0.0', dependencies: { 'wyreup-missing-required-fixture': '*' } });
    await expect(checkInstalledVersions(directory)).rejects.toThrow('Missing required dependency: consumer -> wyreup-missing-required-fixture');
  });

  it('permits absent optional dependencies and optional peers, but not absent required peers', async () => {
    await installed('node_modules/outer', { name: 'outer', version: '1.0.0',
      dependencies: { 'wyreup-missing-optional-fixture': '*' },
      optionalDependencies: { 'wyreup-missing-optional-fixture': '*' },
      peerDependencies: { 'wyreup-missing-peer-fixture': '*' },
      peerDependenciesMeta: { 'wyreup-missing-peer-fixture': { optional: true } },
    });
    await expect(checkInstalledVersions(directory)).resolves.toEqual([]);
    await installed('node_modules/outer', { name: 'outer', version: '1.0.0', peerDependencies: { 'wyreup-missing-peer-fixture': '*' } });
    await expect(checkInstalledVersions(directory)).rejects.toThrow('Missing required dependency: outer -> wyreup-missing-peer-fixture');
  });

  it.each(['optional dependency', 'optional peer'])('rejects an affected installed %s in a linked pnpm graph', async kind => {
    const declarations = kind === 'optional dependency'
      ? { optionalDependencies: { sharp: '*' } }
      : { peerDependencies: { sharp: '*' }, peerDependenciesMeta: { sharp: { optional: true } } };
    await pnpmOuter(declarations);
    await expect(checkInstalledVersions(directory)).rejects.toThrow('Unsafe dependency version: sharp@0.35.4');
  });

  it('deduplicates real paths through cyclic dependency links', async () => {
    const { outer, sharp } = await pnpmOuter({ dependencies: { sharp: '^0.35.5' } }, '0.35.5');
    await writeFile(path.join(sharp, 'package.json'), JSON.stringify({ name: 'sharp', version: '0.35.5', dependencies: { '@example/outer': '*' } }));
    await mkdir(path.resolve(sharp, '../@example'), { recursive: true });
    await symlink(outer, path.resolve(sharp, '../@example/outer'));
    const versions = await checkInstalledVersions(directory);
    expect(versions.filter(entry => entry.name === 'sharp')).toEqual([{ name: 'sharp', version: '0.35.5' }]);
  });

  it('rejects consumer overrides instead of accepting a misleading clean root audit', async () => {
    const file = await pack({ name: '@wyreup/example', version: '1.0.0', overrides: { sharp: '^0.35.4' } });
    await expect(inspectTarball(file)).rejects.toThrow('must not depend on overrides');
  });

  it('rejects generated files whose bytes differ from the recorded inventory', async () => {
    await mkdir(path.join(directory, 'package/vendor'));
    await writeFile(path.join(directory, 'package/vendor/payload.txt'), 'changed artifact');
    await writeFile(path.join(directory, 'package/vendor/BUILD-MANIFEST.json'), JSON.stringify({ files: { 'payload.txt': '0'.repeat(64) } }));
    const file = await pack({ name: '@wyreup/example', version: '1.0.0' });
    await expect(inspectTarball(file)).rejects.toThrow('differs from inventory');
  });

  it('rejects generated files missing from the inventory', async () => {
    await mkdir(path.join(directory, 'package/vendor'));
    await writeFile(path.join(directory, 'package/vendor/unrecorded.txt'), 'unreviewed bytes');
    await writeFile(path.join(directory, 'package/vendor/BUILD-MANIFEST.json'), JSON.stringify({ files: {} }));
    const file = await pack({ name: '@wyreup/example', version: '1.0.0' });
    await expect(inspectTarball(file)).rejects.toThrow('Unrecorded generated files');
  });
});
