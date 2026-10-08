import assert from 'node:assert/strict';
import { readdir, readFile, realpath } from 'node:fs/promises';
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

// Inspect nested npm packages and pnpm's virtual store, following links once.
// A safe top-level dependency never conceals an affected nested copy.
export async function checkInstalledVersions(directory) {
  const visited = new Set();
  const versions = [];
  async function visit(candidate) {
    const resolved = await realpath(candidate);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const manifest = await readFile(path.join(resolved, 'package.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (manifest) {
      const pkg = JSON.parse(manifest);
      assertMinimumVersion(pkg.name, pkg.version);
      if (minimumVersions[pkg.name]) versions.push({ name: pkg.name, version: pkg.version });
      const nested = path.join(resolved, 'node_modules');
      const entries = await readdir(nested, { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        if (entry.name !== '.bin' && (entry.isDirectory() || entry.isSymbolicLink())) await visit(path.join(nested, entry.name));
      }
      return;
    }
    for (const entry of await readdir(resolved, { withFileTypes: true })) {
      if (entry.name === '.bin' || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      await visit(path.join(resolved, entry.name));
    }
  }
  await visit(path.join(directory, 'node_modules'));
  return versions;
}
