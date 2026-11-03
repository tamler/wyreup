import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
const webRequire = createRequire(new URL('../../packages/web/package.json', import.meta.url));
const excelRequire = createRequire(new URL('../../packages/exceljs/package.json', import.meta.url));
const workboxRequire = createRequire(webRequire.resolve('workbox-build'));
const archiveRequire = createRequire(excelRequire.resolve('archiver'));
const utilityRequire = createRequire(archiveRequire.resolve('archiver-utils'));
const readdirRequire = createRequire(archiveRequire.resolve('readdir-glob'));
const eslintRequire = createRequire(rootRequire.resolve('eslint'));
const configRequire = createRequire(eslintRequire.resolve('@eslint/config-array'));
const typescriptRequire = createRequire(rootRequire.resolve('typescript-eslint'));
const parserRequire = createRequire(typescriptRequire.resolve('@typescript-eslint/parser'));
const estreeRequire = createRequire(parserRequire.resolve('@typescript-eslint/typescript-estree'));
const rollupRequire = createRequire(workboxRequire.resolve('@trickfilm400/rollup-plugin-off-main-thread'));
const ejsRequire = createRequire(rollupRequire.resolve('ejs'));
const jakeRequire = createRequire(ejsRequire.resolve('jake'));
const filelistRequire = createRequire(jakeRequire.resolve('filelist'));
const globRequire = createRequire(utilityRequire.resolve('glob'));
const paths = ['a.js', 'b.ts', 'notes.txt', '.hidden.js', 'nested/a.js', 'nested/deeper/c.js', 'nested/skip.js', 'ignore/no.js'];
const selected = ['.hidden.js', 'a.js', 'b.ts', 'nested/a.js', 'nested/deeper/c.js'];
let directory;

async function version(resolver, name) {
  let current = dirname(resolver.resolve(name));
  while (true) {
    const manifest = await readFile(join(current, 'package.json'), 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (manifest?.name === name) return manifest.version;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Missing resolved package identity: ${name}`);
    current = parent;
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wyreup-parent-compatibility-'));
  for (const path of paths) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), 'export const value = 1;\n');
  }
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

for (const [name, resolver] of [
  ['readdir-glob', readdirRequire], ['filelist', filelistRequire],
  ['@eslint/config-array', configRequire], ['typescript-estree', estreeRequire],
  ['eslint', eslintRequire], ['glob', globRequire],
]) {
  it(`${name} resolves the fixed matcher and retains named, class, dot and negation APIs`, async () => {
    expect(await version(resolver, 'minimatch')).toBe('11.0.1');
    const matcher = resolver('minimatch');
    expect(matcher.match(paths, '**/*.{js,ts}', { dot: true }).sort()).toEqual([
      '.hidden.js', 'a.js', 'b.ts', 'ignore/no.js', 'nested/a.js', 'nested/deeper/c.js', 'nested/skip.js',
    ]);
    expect(matcher.match(paths, '!**/skip.js', { dot: true }).sort()).toEqual([
      '.hidden.js', 'a.js', 'b.ts', 'ignore/no.js', 'nested/a.js', 'nested/deeper/c.js', 'notes.txt',
    ]);
    const compiled = new matcher.Minimatch('nested/**/*.js');
    expect(paths.filter(path => compiled.match(path))).toEqual(['nested/a.js', 'nested/deeper/c.js', 'nested/skip.js']);
    expect(matcher.minimatch('nested/deeper/c.js', '**/*.{js,ts}')).toBe(true);
    expect(matcher.minimatch('notes.txt', '**/*.{js,ts}')).toBe(false);
  });
}

for (const [name, resolver, method] of [['archiver-utils', utilityRequire, 'sync'], ['workbox-build', workboxRequire, 'globSync']]) {
  it(`${name} retains the consumed glob API with explicit dot and ignore selections`, async () => {
    expect(await version(resolver, 'glob')).toBe('14.0.2');
    const glob = resolver('glob');
    expect(glob[method]('**/*.{js,ts}', { cwd: directory, dot: true, nodir: true, follow: false, ignore: ['ignore/**', '**/skip.js'] }).sort()).toEqual(selected);
  });
}

it('both consumed glob entrypoints honor follow on an owned directory symlink', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'wyreup-parent-follow-'));
  try {
    await mkdir(join(fixture, 'real'));
    await writeFile(join(fixture, 'real/a.js'), 'export default 1;');
    await symlink(join(fixture, 'real'), join(fixture, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const [resolver, method] of [[utilityRequire, 'sync'], [workboxRequire, 'globSync']]) {
      const glob = resolver('glob');
      expect(glob[method]('**/*.js', { cwd: fixture, nodir: true, follow: false }).sort()).toEqual(['real/a.js']);
      expect(glob[method]('**/*.js', { cwd: fixture, nodir: true, follow: true }).sort()).toEqual(['linked/a.js', 'real/a.js']);
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

it('Workbox public manifest selection retains the independently expected files', async () => {
  const { getManifest } = webRequire('workbox-build');
  const result = await getManifest({ globDirectory: directory, globPatterns: ['**/*.{js,ts}', '**/.*.js'], globIgnores: ['ignore/**', '**/skip.js'], globFollow: false });
  expect(result.warnings).toEqual([]);
  expect(result.manifestEntries.map(entry => entry.url).sort()).toEqual(selected);
});

it('FileList public include/exclude resolves fixed matcher behavior without changing process cwd', () => {
  const { FileList } = jakeRequire('filelist');
  const list = new FileList(join(directory, '**/*.{js,ts}'), { dot: true });
  list.exclude(join(directory, 'ignore/**'), join(directory, '**/skip.js'));
  expect(list.toArray().map(path => relative(directory, path).split(sep).join('/')).sort()).toEqual(selected);
});

it('ESLint public traversal and TypeScript parser retain the configured filename set', async () => {
  const { ESLint } = rootRequire('eslint');
  const { parser } = rootRequire('typescript-eslint');
  const eslint = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: [
    { ignores: ['ignore/**', '**/skip.js'] },
    { files: ['**/*.{js,ts}'], languageOptions: { parser } },
  ] });
  const results = await eslint.lintFiles(['**/*.{js,ts}']);
  expect(results.map(item => relative(directory, item.filePath).split(sep).join('/')).sort()).toEqual(selected);
  expect(results.every(item => item.errorCount === 0 && item.warningCount === 0)).toBe(true);
});
