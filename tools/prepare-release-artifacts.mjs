import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts');
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim()) {
  throw new Error('Release artifacts require a clean committed source checkout');
}
const packages = new Map();
for (const entry of await readdir(path.join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = entry.name;
  if (!(await readdir(path.join(root, 'packages', directory))).includes('package.json')) continue;
  const manifest = JSON.parse(await readFile(path.join(root, 'packages', directory, 'package.json'), 'utf8'));
  if (!manifest.private) packages.set(manifest.name, manifest);
}
const plan = [];
const remaining = new Map(packages);
while (remaining.size) {
  const ready = [...remaining.values()].filter((pkg) =>
    !Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })
      .some((dependency) => remaining.has(dependency)),
  );
  if (!ready.length) throw new Error('Public package dependency graph contains a cycle');
  plan.push(ready.map((pkg) => ({ kind: 'publish', name: pkg.name, version: pkg.version, access: 'public', tag: 'latest' })));
  for (const pkg of ready) remaining.delete(pkg.name);
}
await mkdir(output, { recursive: true });
const input = path.join(output, 'source-plan.json');
await writeFile(input, JSON.stringify({ version: 1, plan }, null, 2));
const args = ['changeset', 'pack', '--from-publish-plan', input, '--out-dir', output];
if (process.env.npm_execpath?.includes('pnpm')) {
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: root, stdio: 'inherit' });
} else {
  execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' });
}
await writeFile(path.join(output, 'source-commit'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }));
