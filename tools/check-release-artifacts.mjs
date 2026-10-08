import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { t as listTar } from 'tar';
import { assertMinimumVersion, minimumVersions } from './check-dependency-versions.mjs';

const root = path.resolve(import.meta.dirname, '..');
export const digest = (bytes, algorithm = 'sha512') => `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`;

export async function inspectTarball(file) {
  let manifest;
  let inventory;
  const files = new Map();
  await listTar({ file, onReadEntry(entry) {
    assert(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'), 'Unsafe tar entry');
    assert(['File', 'Directory', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(entry.type), `Unexpected tar entry type: ${entry.type}`);
    assert(!entry.path.includes('/node_modules/'), 'Published package must use normal dependencies, not bundled node_modules');
    if (entry.type !== 'File') { entry.resume(); return; }
    const hash = createHash('sha256');
    const chunks = [];
    const capture = entry.path === 'package/package.json' || entry.path === 'package/vendor/BUILD-MANIFEST.json';
    assert(!capture || entry.size < 1024 * 1024, 'Unexpected metadata size');
    entry.on('data', (chunk) => { hash.update(chunk); if (capture) chunks.push(chunk); });
    entry.on('end', () => {
      files.set(entry.path, hash.digest('hex'));
      if (entry.path === 'package/package.json') manifest = JSON.parse(Buffer.concat(chunks).toString());
      if (entry.path === 'package/vendor/BUILD-MANIFEST.json') inventory = JSON.parse(Buffer.concat(chunks).toString());
    });
  } });
  assert(manifest, 'Tarball lacks package.json');
  const entrypoints = (value) => typeof value === 'string' ? [value]
    : value && typeof value === 'object' ? Object.values(value).flatMap(entrypoints) : [];
  for (const target of [manifest.main, manifest.module, manifest.types, typeof manifest.browser === 'string' ? manifest.browser : null, ...entrypoints(manifest.exports)].filter(Boolean)) {
    assert(!target.includes('*'), 'Wildcard exports need explicit artifact verification');
    assert(files.has(`package/${target.replace(/^\.\//, '')}`), `Missing published entrypoint: ${target}`);
  }
  assert(!manifest.overrides && !manifest.pnpm?.overrides && !manifest.resolutions, 'Consumer artifacts must not depend on overrides');
  for (const [dependency, range] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
    if (!minimumVersions[dependency]) continue;
    assert(/^[~^]?\d+\.\d+\.\d+$/.test(range), `Unverified dependency range: ${dependency}@${range}`);
    assertMinimumVersion(dependency, range.replace(/^[~^]/, ''));
  }
  if (inventory) {
    const actual = new Map([...files].filter(([name]) => name.startsWith('package/vendor/') && name !== 'package/vendor/BUILD-MANIFEST.json'));
    for (const [relative, hash] of Object.entries(inventory.files)) {
      const name = `package/vendor/${relative}`;
      assert.equal(actual.get(name), hash, `Generated artifact differs from inventory: ${relative}`);
      actual.delete(name);
    }
    assert.equal(actual.size, 0, 'Unrecorded generated files remain in artifact');
  }
  return { manifest, files };
}

export async function loadArtifacts(directory = 'artifacts') {
  const location = path.resolve(root, directory);
  const plan = JSON.parse(await readFile(path.join(location, 'publish-plan.json'), 'utf8'));
  assert.equal(plan.version, 1);
  const commit = (await readFile(path.join(location, 'source-commit'), 'utf8')).trim();
  assert.equal(commit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), 'Artifacts are from a different source commit');
  const expected = new Map();
  for (const entry of await readdir(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = entry.name;
    if (!(await readdir(path.join(root, 'packages', directory))).includes('package.json')) continue;
    const pkg = JSON.parse(await readFile(path.join(root, 'packages', directory, 'package.json'), 'utf8'));
    if (!pkg.private) expected.set(pkg.name, { ...pkg, directory });
  }
  const artifacts = [];
  for (const release of plan.plan.flat()) {
    assert.equal(release.kind, 'publish');
    assert(expected.has(release.name), `Unexpected or duplicate package: ${release.name}`);
    const source = expected.get(release.name);
    assert.equal(release.version, source.version);
    const relative = release.tarball?.path;
    assert(typeof relative === 'string' && /^packages\/[a-z0-9._-]+\.tgz$/.test(relative), 'Invalid artifact path');
    const file = path.join(location, relative);
    const bytes = await readFile(file);
    assert.equal(digest(bytes, 'sha256'), release.tarball.integrity, `${release.name}: artifact hash changed`);
    const inspected = await inspectTarball(file);
    assert.equal(inspected.manifest.name, release.name);
    assert.equal(inspected.manifest.version, release.version);
    for (const [name, range] of Object.entries({ ...inspected.manifest.dependencies, ...inspected.manifest.peerDependencies })) {
      assert(!range.startsWith('workspace:'), `${name}: workspace range leaked into package`);
    }
    if (['@wyreup/mammoth', '@wyreup/exceljs'].includes(source.name)) {
      const upstream = await readFile(path.join(root, 'packages', source.directory, 'UPSTREAM.json'));
      assert.equal(inspected.files.get('package/UPSTREAM.json'), createHash('sha256').update(upstream).digest('hex'), 'Fork provenance differs from source');
      assert(inspected.files.has('package/vendor/BUILD-MANIFEST.json'), 'Generated artifact inventory is missing');
    }
    artifacts.push({ ...release, ...inspected, file, integrity: digest(bytes) });
    expected.delete(release.name);
  }
  assert.equal(expected.size, 0, `Missing public artifacts: ${[...expected.keys()].join(', ')}`);
  return { location, plan, artifacts };
}

async function registryIntegrity(artifact) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(artifact.name)}/${encodeURIComponent(artifact.version)}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  assert(response.ok, `Registry check failed: ${response.status}`);
  const metadata = await response.json();
  return metadata.dist?.integrity;
}

async function main() {
  const { location, plan, artifacts } = await loadArtifacts(process.argv[2]);
  const prepare = process.argv.includes('--prepare-publish');
  const registry = process.argv.includes('--registry');
  if (prepare || registry) {
    const published = new Set();
    for (const artifact of artifacts) {
      const integrity = await registryIntegrity(artifact);
      if (integrity === null) {
        assert(!registry, `${artifact.name}@${artifact.version} was not published`);
      } else {
        assert.equal(integrity, artifact.integrity, `${artifact.name}@${artifact.version}: registry bytes differ; refuse overwrite, deprecate and release a repaired version`);
        published.add(artifact.name);
      }
    }
    if (prepare) {
      const ready = path.join(location, 'ready');
      await mkdir(path.join(ready, 'packages'), { recursive: true });
      for (const artifact of artifacts) await copyFile(artifact.file, path.join(ready, 'packages', path.basename(artifact.file)));
      const prepared = plan.plan.map((group) => group.map((entry) => published.has(entry.name)
        ? { kind: 'tag-only', name: entry.name, version: entry.version }
        : entry));
      await writeFile(path.join(ready, 'publish-plan.json'), JSON.stringify({ version: 1, plan: prepared }, null, 2));
    }
  }
  console.log(`Verified ${artifacts.length} release artifacts${registry ? ' against npm registry integrity' : ''}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
