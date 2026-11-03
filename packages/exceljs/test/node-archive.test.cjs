const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, writeFile, mkdir, mkdtemp, rm, symlink, cp, copyFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const archiveFactory = require('../vendor/dist/node-archive.cjs');
const packageRoot = resolve(__dirname, '..');
const root = resolve(packageRoot, '../..');

async function archived(configure) {
  const archive = archiveFactory('zip', { zlib: { level: 1 } });
  const chunks = [];
  archive.on('data', chunk => chunks.push(chunk));
  const ended = once(archive, 'end');
  configure(archive);
  await Promise.all([archive.finalize(), ended]);
  return JSZip.loadAsync(Buffer.concat(chunks));
}

test('shipped CommonJS factory drains queued buffers and streams before finalization', async () => {
  assert.equal(typeof archiveFactory, 'function');
  const zip = await archived(archive => {
    assert.equal(archive.append('first', { name: 'first.txt' }), archive);
    archive.append(Readable.from(['second', ' queued']), { name: 'second.txt' });
  });
  assert.deepEqual(Object.keys(zip.files).sort(), ['first.txt', 'second.txt']);
  assert.equal(await zip.file('first.txt').async('string'), 'first');
  assert.equal(await zip.file('second.txt').async('string'), 'second queued');
});

test('archive.glob preserves brace, nested, dot, negated and ignore filename sets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-archive-glob-'));
  try {
    const files = ['a.txt', 'b.log', '.hidden.txt', 'nested/b.txt', 'nested/deeper/c.txt', 'skip/drop.txt'];
    for (const file of files) {
      await mkdir(dirname(join(directory, file)), { recursive: true });
      await writeFile(join(directory, file), file);
    }
    const selected = async (pattern, options = {}) => {
      const zip = await archived(archive => archive.glob(pattern, { cwd: directory, nodir: true, follow: false, ...options }));
      return Object.values(zip.files).filter(file => !file.dir).map(file => file.name).sort();
    };
    assert.deepEqual(await selected('**/*.{txt,log}', { ignore: ['skip/**', '**/*.log'] }),
      ['a.txt', 'nested/b.txt', 'nested/deeper/c.txt']);
    assert.deepEqual(await selected('**/*.txt', { dot: true, ignore: 'skip/**' }),
      ['.hidden.txt', 'a.txt', 'nested/b.txt', 'nested/deeper/c.txt']);
    assert.deepEqual(await selected('!**/*.log', { dot: true, ignore: 'skip/**' }),
      ['.hidden.txt', 'a.txt', 'nested/b.txt', 'nested/deeper/c.txt']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('archive.glob follows an owned directory symlink only when requested', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-archive-follow-'));
  try {
    await mkdir(join(directory, 'real'));
    await writeFile(join(directory, 'real/a.txt'), 'owned');
    await symlink(join(directory, 'real'), join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const files = async follow => {
      const zip = await archived(archive => archive.glob('**/*.txt', { cwd: directory, nodir: true, follow }));
      return Object.values(zip.files).filter(file => !file.dir).map(file => file.name).sort();
    };
    assert.deepEqual(await files(false), ['real/a.txt']);
    assert.deepEqual(await files(true), ['linked/a.txt', 'real/a.txt']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('archive errors and finalization refusal remain observable through the factory', { timeout: 5000 }, async t => {
  const invalid = archiveFactory('zip');
  t.after(() => invalid.destroy());
  const invalidErrors = [];
  invalid.on('error', error => invalidErrors.push(error));
  invalid.append(42, { name: 'invalid.txt' });
  assert.equal(invalidErrors[0].code, 'INPUTSTEAMBUFFERREQUIRED');

  const archive = archiveFactory('zip');
  t.after(() => archive.destroy());
  const errors = [];
  archive.on('error', error => errors.push(error));
  const ended = once(archive, 'end');
  archive.resume();
  archive.append('healthy queued entry', { name: 'valid.txt' });
  await Promise.all([archive.finalize(), ended]);
  await assert.rejects(archive.finalize(), error => error.code === 'FINALIZING');
  assert.equal(errors.at(-1).code, 'FINALIZING');
});

test('Node provenance names fixed packages and ships their full license texts', async () => {
  const graph = JSON.parse(await readFile(join(packageRoot, 'vendor/NODE-DEPENDENCIES.json'), 'utf8'));
  assert.equal(graph.target, 'node22.13');
  assert.deepEqual(graph.inputs.filter(item => /\.min\.[cm]?js$/.test(item.path)), []);
  for (const name of ['minipass', 'path-scurry', 'lru-cache']) {
    assert.equal(graph.packages.filter(item => item.name === name).length, 1);
  }
  for (const [name, version] of [['archiver', '7.0.1'], ['glob', '14.0.2'], ['minimatch', '11.0.1']]) {
    assert.deepEqual(graph.packages.filter(item => item.name === name).map(item => item.version), [version]);
  }
  for (const item of graph.packages) {
    assert.match(item.manifestSha256, /^[a-f0-9]{64}$/);
    assert.ok(item.licenses.length);
    assert.ok(item.licenses.every(license => /^[a-f0-9]{64}$/.test(license.sha256)));
  }
  const notices = await readFile(join(packageRoot, 'vendor/NODE-THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.match(notices, /archiver@7\.0\.1/);
  assert.match(notices, /glob@14\.0\.2/);
  assert.match(notices, /minimatch@11\.0\.1/);
  assert.match(notices, /Permission is hereby granted/);
  const manifest = require('../package.json');
  assert.equal(manifest.dependencies.archiver, undefined);
  assert.equal(manifest.dependencies.glob, undefined);
  assert.equal(manifest.devDependencies.archiver, '7.0.1');
});

test('read-only verifier refuses output, input, manifest, license and lock drift in owned copies', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'wyreup-archive-verify-'));
  try {
    const browser = JSON.parse(await readFile(join(packageRoot, 'vendor/BROWSER-DEPENDENCIES.json'), 'utf8'));
    const node = JSON.parse(await readFile(join(packageRoot, 'vendor/NODE-DEPENDENCIES.json'), 'utf8'));
    const paths = new Set([
      'tools/build-exceljs.mjs', 'pnpm-lock.yaml', 'packages/exceljs/package.json',
      'packages/exceljs/UPSTREAM.json', 'packages/exceljs/NOTICE',
      'packages/exceljs/src/browser-globals.mjs', 'packages/exceljs/src/browser-crypto.cjs',
      'packages/exceljs/src/browser-fs.cjs', 'packages/exceljs/src/browser-entry.mjs',
      'packages/exceljs/licenses/saxes-5.0.1.txt', 'packages/exceljs/src/node-archive.cjs',
      'patches/glob@14.0.2.patch',
      ...browser.inputs.map(item => item.path), ...browser.packages.map(item => item.manifest),
      ...node.inputs.map(item => item.path), ...node.packages.map(item => item.manifest),
      ...node.packages.flatMap(item => item.licenses.map(license => license.path)),
    ]);
    for (const file of paths) {
      await mkdir(dirname(join(fixture, file)), { recursive: true });
      await copyFile(join(root, file), join(fixture, file));
    }
    await cp(join(packageRoot, 'vendor'), join(fixture, 'packages/exceljs/vendor'), { recursive: true });
    const verify = () => execFileSync(process.execPath,
      [join(root, 'tools/build-exceljs.mjs'), '--verify', '--fixture-root', fixture], { encoding: 'utf8', timeout: 30000 });
    assert.match(verify(), /Verified ExcelJS artifact/);
    const cases = [
      ['packages/exceljs/vendor/dist/node-archive.cjs', bytes => Buffer.concat([bytes, Buffer.from('\n// owned output drift\n')])],
      [node.inputs.find(item => item.path.includes('node_modules/')).path, bytes => Buffer.concat([bytes, Buffer.from('\n// owned input drift\n')])],
      [node.packages[0].manifest, bytes => Buffer.from(bytes.toString().replace('"name"', '"changedName"'))],
      [node.packages[0].licenses[0].path, bytes => Buffer.concat([bytes, Buffer.from('\nowned license drift\n')])],
      ['pnpm-lock.yaml', () => Buffer.from('lockfileVersion: "9.0"\npackages: {}\n')],
    ];
    for (const [file, change] of cases) {
      const path = join(fixture, file);
      const before = await readFile(path);
      await writeFile(path, change(before));
      assert.throws(verify, /changed|differs|absent/);
      await writeFile(path, before);
    }
    const graphPath = join(fixture, 'packages/exceljs/vendor/NODE-DEPENDENCIES.json');
    const inventoryPath = join(fixture, 'packages/exceljs/vendor/BUILD-MANIFEST.json');
    const graphBytes = await readFile(graphPath);
    const inventoryBytes = await readFile(inventoryPath);
    for (const extension of ['js', 'cjs', 'mjs']) {
      const graph = JSON.parse(graphBytes);
      graph.inputs[0].path = `node_modules/owned-fixture/index.min.${extension}`;
      const bytes = Buffer.from(JSON.stringify(graph, null, 2) + '\n');
      await writeFile(graphPath, bytes);
      const inventory = JSON.parse(inventoryBytes);
      inventory.files['NODE-DEPENDENCIES.json'] = createHash('sha256').update(bytes).digest('hex');
      await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
      assert.throws(verify, /Minified Node input lacks embedded-package provenance/);
      await writeFile(graphPath, graphBytes);
      await writeFile(inventoryPath, inventoryBytes);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
