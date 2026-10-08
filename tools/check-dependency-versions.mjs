import assert from 'node:assert/strict';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export const minimumVersions = Object.freeze({
  '@huggingface/transformers': '4.3.1',
  'onnxruntime-node': '1.30.0',
  'adm-zip': '0.6.1',
  'global-agent': '4.1.3',
  sharp: '0.35.5',
  'proxy-addr': '2.0.8',
  '@modelcontextprotocol/sdk': '1.31.0',
});

export function assertMinimumVersion(name, version) {
  const floor = minimumVersions[name];
  if (!floor) return;
  assert(/^\d+\.\d+\.\d+$/.test(version), `Unverified dependency version: ${name}@${version}`);
  const actual = version.split('.').map(Number);
  const required = floor.split('.').map(Number);
  let comparison = 0;
  for (let index = 0; index < 3 && comparison === 0; index++) comparison = actual[index] - required[index];
  assert(comparison >= 0, `Unsafe dependency version: ${name}@${version}; requires >=${floor}`);
}

// Follow installed package links and their declared resolution graph. Physical
// pnpm store directories can outlive the lock graph after an ordinary update.
export async function checkInstalledVersions(directory) {
  const visited = new Set();
  const versions = [];
  async function modules(candidate) {
    const entries = await readdir(candidate, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.name === '.bin' || entry.name === '.pnpm' || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      const installed = path.join(candidate, entry.name);
      if (entry.name.startsWith('@')) await modules(installed);
      else await visit(installed);
    }
  }
  async function dependencies(pkg, manifest) {
    const required = new Map(Object.keys(pkg.dependencies ?? {}).map(name => [name, true]));
    for (const name of Object.keys(pkg.optionalDependencies ?? {})) required.set(name, false);
    for (const name of Object.keys(pkg.peerDependencies ?? {})) {
      const mandatory = pkg.peerDependenciesMeta?.[name]?.optional !== true;
      required.set(name, mandatory || required.get(name) === true);
    }
    const require = createRequire(manifest);
    for (const [name, mandatory] of required) {
      assert(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) && name.split('/').every(part => part !== '.' && part !== '..'), `Invalid dependency name: ${name}`);
      let installed;
      // A bare builtin name returns null, but its npm browser package still belongs to this graph.
      for (const search of require.resolve.paths(`${name}/package.json`) ?? []) {
        const candidate = path.join(search, name);
        installed = await realpath(candidate).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (installed) break;
      }
      assert(installed || !mandatory, `Missing required dependency: ${pkg.name} -> ${name}`);
      if (installed) await visit(installed);
    }
  }
  async function visit(candidate) {
    const resolved = await realpath(candidate);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const manifest = path.join(resolved, 'package.json');
    const contents = await readFile(manifest, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (contents) {
      const pkg = JSON.parse(contents);
      assertMinimumVersion(pkg.name, pkg.version);
      if (minimumVersions[pkg.name]) versions.push({ name: pkg.name, version: pkg.version });
      await modules(path.join(resolved, 'node_modules'));
      await dependencies(pkg, manifest);
      return;
    }
    assert(resolved === await realpath(directory), `Installed package has no manifest: ${resolved}`);
    await modules(path.join(resolved, 'node_modules'));
  }
  await visit(directory);
  return versions;
}
