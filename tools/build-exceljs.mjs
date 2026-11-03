import { createHash } from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm, rename, copyFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { x as extract } from 'tar';
import { load as loadYaml } from 'js-yaml';
import { satisfies } from 'semver';

const arguments_ = process.argv.slice(2);
const fixture = arguments_.length === 3 && arguments_[0] === '--verify' && arguments_[1] === '--fixture-root';
if (arguments_.length && !fixture && !(arguments_.length === 1 && arguments_[0] === '--verify')) {
  throw new Error('Expected no arguments, --verify, or read-only --verify --fixture-root <directory>');
}
const root = fixture ? resolve(arguments_[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/exceljs');
const vendor = join(packageDir, 'vendor');
const require = createRequire(join(packageDir, 'package.json'));
const upstream = JSON.parse(await readFile(join(packageDir, 'UPSTREAM.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const recipeFiles = ['tools/build-exceljs.mjs', 'packages/exceljs/UPSTREAM.json', 'packages/exceljs/NOTICE',
  'packages/exceljs/src/browser-globals.mjs', 'packages/exceljs/src/browser-crypto.cjs', 'packages/exceljs/src/browser-fs.cjs',
  'packages/exceljs/licenses/saxes-5.0.1.txt', 'packages/exceljs/src/browser-entry.mjs',
  'packages/exceljs/src/node-archive.cjs', 'patches/glob@14.0.2.patch'];
const recipeHash = createHash('sha256');
for (const file of recipeFiles) recipeHash.update(file).update(await readFile(join(root, file)));
const ownManifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
recipeHash.update(JSON.stringify({ dependencies: ownManifest.dependencies, devDependencies: ownManifest.devDependencies,
  main: ownManifest.main, browser: ownManifest.browser, types: ownManifest.types, exports: ownManifest.exports }));
const recipe = recipeHash.digest('hex');

async function inventory(directory) {
  const files = {};
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (!entry.isFile()) throw new Error(`Unexpected artifact entry: ${file}`);
      else if (relative(directory, file) !== 'BUILD-MANIFEST.json') {
        files[relative(directory, file).replaceAll('\\', '/')] = digest(await readFile(file));
      }
    }
  }
  await visit(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

function validateNodePackages(packages, lock) {
  for (const dependency of packages) {
    if (!Object.hasOwn(lock.packages ?? {}, `${dependency.name}@${dependency.version}`)) {
      throw new Error(`Bundled Node dependency absent from workspace lock: ${dependency.name}@${dependency.version}`);
    }
    if (dependency.engines?.node && !satisfies('22.13.0', dependency.engines.node)) {
      throw new Error(`Bundled Node dependency excludes Node 22.13.0: ${dependency.name}@${dependency.version}`);
    }
  }
  for (const [name, version] of [['archiver', '7.0.1'], ['glob', '14.0.2'], ['minimatch', '11.0.1'], ['lru-cache', '11.5.3']]) {
    const identities = packages.filter(dependency => dependency.name === name);
    if (identities.length !== 1 || identities[0].version !== version) {
      throw new Error(`Expected one bundled ${name}@${version} identity`);
    }
  }
}

function refuseMinifiedNodeInputs(paths) {
  for (const path of paths) {
    if (/\.min\.[cm]?js$/i.test(path)) {
      throw new Error(`Minified Node input lacks embedded-package provenance: ${path}`);
    }
  }
}

async function verifyNodeGraph(directory) {
  const graph = JSON.parse(await readFile(join(directory, 'NODE-DEPENDENCIES.json'), 'utf8'));
  refuseMinifiedNodeInputs(graph.inputs.map(input => input.path));
  const lock = loadYaml(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'));
  validateNodePackages(graph.packages, lock);
  for (const input of graph.inputs) {
    const file = resolve(root, input.path);
    if (!file.startsWith(root + '/') || digest(await readFile(file)) !== input.sha256) {
      throw new Error(`Node dependency input changed: ${input.path}`);
    }
  }
  for (const dependency of graph.packages) {
    const manifest = resolve(root, dependency.manifest);
    if (!manifest.startsWith(root + '/')) throw new Error('Node manifest escapes workspace');
    const bytes = await readFile(manifest);
    const installed = JSON.parse(bytes);
    if (digest(bytes) !== dependency.manifestSha256 || installed.name !== dependency.name ||
        installed.version !== dependency.version || JSON.stringify(installed.engines) !== JSON.stringify(dependency.engines)) {
      throw new Error(`Node dependency manifest changed: ${dependency.name}`);
    }
    for (const license of dependency.licenses) {
      const file = resolve(root, license.path);
      if (!file.startsWith(root + '/') || digest(await readFile(file)) !== license.sha256) {
        throw new Error(`Node dependency license changed: ${dependency.name}`);
      }
    }
    if (!dependency.licenses.length) throw new Error(`Node dependency license missing: ${dependency.name}`);
  }
  const meta = JSON.parse(await readFile(join(directory, 'NODE-METAFILE.json'), 'utf8'));
  refuseMinifiedNodeInputs(Object.keys(meta.inputs));
  for (const output of Object.values(meta.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external || !isBuiltin(imported.path)) {
        throw new Error(`Unexpected Node artifact external: ${imported.path}`);
      }
    }
  }
  for (const [file, sha256] of Object.entries(graph.outputs)) {
    if (digest(await readFile(join(directory, file))) !== sha256) throw new Error(`Node output changed: ${file}`);
  }
}

async function verify() {
  const manifest = JSON.parse(await readFile(join(vendor, 'BUILD-MANIFEST.json'), 'utf8'));
  if (manifest.recipe !== recipe || JSON.stringify(manifest.upstream) !== JSON.stringify(upstream)) {
    throw new Error('Excel build recipe changed; rebuild before packing');
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(await inventory(vendor))) {
    throw new Error('Excel artifact content differs from its build inventory');
  }
  const graph = JSON.parse(await readFile(join(vendor, 'BROWSER-DEPENDENCIES.json'), 'utf8'));
  for (const input of graph.inputs) {
    const file = resolve(root, input.path);
    if (!file.startsWith(root + '/') || digest(await readFile(file)) !== input.sha256) {
      throw new Error(`Browser dependency input changed: ${input.path}`);
    }
  }
  for (const dependency of graph.packages) {
    const installed = JSON.parse(await readFile(join(root, dependency.manifest), 'utf8'));
    if (installed.name !== dependency.name || installed.version !== dependency.version) {
      throw new Error(`Browser dependency changed: ${dependency.name}`);
    }
  }
  await verifyNodeGraph(vendor);
  const writer = await readFile(join(vendor, 'lib/stream/xlsx/workbook-writer.js'), 'utf8');
  if (!writer.includes("const Archiver = require('../../../dist/node-archive.cjs');") || /require\(['"]archiver['"]\)/.test(writer)) {
    throw new Error('Streaming workbook writer must use the shipped Node archive');
  }
}

if (process.argv.includes('--verify')) {
  await verify();
  process.stdout.write('Verified ExcelJS artifact\n');
  process.exit(0);
}

const temp = await mkdtemp(join(packageDir, '.excel-build-'));
try {
  const cacheDir = join(root, '.cache/runtime-sources');
  await mkdir(cacheDir, { recursive: true });
  const cached = join(cacheDir, `${digest(upstream.integrity)}.tgz`);
  let archiveBytes = await readFile(cached).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!archiveBytes) {
    const response = await fetch(upstream.url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error(`Excel upstream download failed: ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) throw new Error('Excel archive exceeds size budget');
      chunks.push(chunk);
    }
    archiveBytes = Buffer.concat(chunks);
  }
  if (`sha512-${createHash('sha512').update(archiveBytes).digest('base64')}` !== upstream.integrity) {
    throw new Error('Excel upstream integrity mismatch');
  }
  await writeFile(cached, archiveBytes);
  const archive = join(temp, 'upstream.tgz');
  await copyFile(cached, archive);
  const staged = join(temp, 'vendor');
  await mkdir(staged);
  let entryCount = 0;
  let expandedSize = 0;
  await extract({ file: archive, cwd: staged, strip: 1, strict: true, filter(file, entry) {
    if (!file.startsWith('package/') || file.includes('\\') || file.split('/').includes('..')) {
      throw new Error('Unexpected Excel archive path');
    }
    if (!['File', 'Directory'].includes(entry.type)) throw new Error('Excel archive contains a non-regular entry');
    entryCount += 1;
    expandedSize += entry.size;
    if (entryCount > 4096 || entry.size > 8 * 1024 * 1024 || expandedSize > 64 * 1024 * 1024) {
      throw new Error('Excel archive exceeds expanded size budget');
    }
    const local = file.slice('package/'.length);
    return entry.type === 'Directory' || local.startsWith('lib/') || ['excel.js', 'index.d.ts', 'LICENSE'].includes(local);
  } });
  const uuidFile = join(staged, 'lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js');
  const before = await readFile(uuidFile, 'utf8');
  const needle = "const {v4: uuidv4} = require('uuid');";
  if (before.split(needle).length !== 2) throw new Error('Excel UUID import preimage changed');
  await writeFile(uuidFile, before.replace(needle, [
    'const uuidv4 = () => {',
    "  if (typeof globalThis.crypto?.randomUUID !== 'function') {",
    "    throw new Error('ExcelJS requires crypto.randomUUID: use Node 22.13+ or an HTTPS browser context');",
    '  }',
    '  return globalThis.crypto.randomUUID();',
    '};',
  ].join('\n')));
  execFileSync(process.execPath, ['--check', uuidFile]);

  const streamFile = join(staged, 'lib/utils/stream-buf.js');
  const streamBefore = await readFile(streamFile, 'utf8');
  const streamNeedle = '      this.end();\n    }\n  },\n  unpipe(destination)';
  if (streamBefore.split(streamNeedle).length !== 2) throw new Error('Excel stream adapter preimage changed');
  await writeFile(streamFile, streamBefore.replace(streamNeedle,
    '      this.end();\n    }\n    return destination;\n  },\n  unpipe(destination)'));
  execFileSync(process.execPath, ['--check', streamFile]);

  const readerFile = join(staged, 'lib/stream/xlsx/workbook-reader.js');
  const readerBefore = await readFile(readerFile, 'utf8');
  const readerNeedle = 'for await (const entry of iterateStream(zip))';
  if (readerBefore.split(readerNeedle).length !== 2) throw new Error('Excel archive iterator preimage changed');
  await writeFile(readerFile, readerBefore.replace(readerNeedle, 'for await (const entry of zip)'));
  execFileSync(process.execPath, ['--check', readerFile]);

  const writerFile = join(staged, 'lib/stream/xlsx/workbook-writer.js');
  const writerBefore = await readFile(writerFile, 'utf8');
  const writerNeedle = "const Archiver = require('archiver');";
  if (writerBefore.split(writerNeedle).length !== 2) throw new Error('Excel Archiver import preimage changed');
  await writeFile(writerFile, writerBefore.replace(writerNeedle,
    "const Archiver = require('../../../dist/node-archive.cjs');"));
  execFileSync(process.execPath, ['--check', writerFile]);

  const sourceFiles = await inventory(staged);
  for (const file of Object.keys(sourceFiles).filter(file => file.endsWith('.js'))) {
    const source = await readFile(join(staged, file), 'utf8');
    if (/require\(['"]uuid['"]\)/.test(source)) throw new Error(`Unexpected remaining UUID import: ${file}`);
    if (/require\(['"]archiver['"]\)/.test(source)) throw new Error(`Unexpected remaining Archiver import: ${file}`);
  }
  await mkdir(join(staged, 'dist'), { recursive: true });
  const nodeOutfile = join(staged, 'dist/node-archive.cjs');
  const nodeResult = await build({
    absWorkingDir: root, entryPoints: [join(packageDir, 'src/node-archive.cjs')], outfile: nodeOutfile,
    bundle: true, format: 'cjs', platform: 'node', target: 'node22.13', metafile: true,
    legalComments: 'inline', logLevel: 'silent',
    plugins: [{ name: 'raw-node-lru-cache', setup(builder) {
      builder.onResolve({ filter: /^lru-cache$/ }, args => {
        if (args.kind !== 'require-call') {
          throw new Error(`Expected a CommonJS Node lru-cache importer: ${args.importer}`);
        }
        return { path: createRequire(args.importer).resolve('lru-cache/raw') };
      });
    } }],
  });
  if (nodeResult.warnings.length) throw new Error(`Node archive build warnings: ${JSON.stringify(nodeResult.warnings)}`);
  refuseMinifiedNodeInputs(Object.keys(nodeResult.metafile.inputs));
  for (const output of Object.values(nodeResult.metafile.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external || !isBuiltin(imported.path)) throw new Error(`Unexpected Node artifact external: ${imported.path}`);
    }
  }
  execFileSync(process.execPath, ['--check', nodeOutfile]);
  const nodePackages = new Map();
  const nodeInputs = [];
  for (const input of Object.keys(nodeResult.metafile.inputs)) {
    const file = resolve(root, input);
    if (!file.startsWith(root + '/')) throw new Error(`Unexpected Node input path: ${input}`);
    nodeInputs.push({ path: relative(root, file).replaceAll('\\', '/'), sha256: digest(await readFile(file)) });
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(file);
    while (directory !== root) {
      const manifestPath = join(directory, 'package.json');
      const bytes = await readFile(manifestPath).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const manifest = bytes && JSON.parse(bytes);
      if (manifest?.name && manifest.version) {
        nodePackages.set(`${manifest.name}@${manifest.version}`, { name: manifest.name, version: manifest.version,
          manifest: relative(root, manifestPath).replaceAll('\\', '/'), manifestSha256: digest(bytes),
          license: manifest.license, ...(manifest.engines ? { engines: manifest.engines } : {}), directory });
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`No package provenance for ${input}`);
      directory = parent;
    }
  }
  const nodeNotices = [await readFile(join(packageDir, 'NOTICE'), 'utf8')];
  const nodeDependencies = [];
  for (const dependency of [...nodePackages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const licenseFiles = (await readdir(dependency.directory)).filter(file => /^(licen[sc]e|copying|notice)([._-]|$)/i.test(file));
    const licenses = [];
    nodeNotices.push(`\n--- ${dependency.name}@${dependency.version} (${JSON.stringify(dependency.license)}) ---\n`);
    if (!licenseFiles.length) {
      const file = join(dependency.directory, 'README.md');
      const bytes = await readFile(file);
      const text = bytes.toString().match(/(?:^|\n)#+ License\s*\n([\s\S]+)/i)?.[1];
      if (!text || !text.includes('Permission is hereby granted')) throw new Error(`Missing complete Node license: ${dependency.name}`);
      licenses.push({ path: relative(root, file).replaceAll('\\', '/'), sha256: digest(bytes) });
      nodeNotices.push(text);
    }
    for (const name of licenseFiles) {
      const file = join(dependency.directory, name);
      const bytes = await readFile(file);
      licenses.push({ path: relative(root, file).replaceAll('\\', '/'), sha256: digest(bytes) });
      nodeNotices.push(bytes.toString());
    }
    const { directory: _directory, ...record } = dependency;
    nodeDependencies.push({ ...record, licenses });
  }
  validateNodePackages(nodeDependencies, loadYaml(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')));
  nodeInputs.sort((a, b) => a.path.localeCompare(b.path));
  const nodeMeta = JSON.parse(JSON.stringify(nodeResult.metafile).replaceAll('\\\\', '/')
    .replaceAll(relative(root, staged).replaceAll('\\', '/'), 'vendor').replaceAll(`${root.replaceAll('\\', '/')}/`, ''));
  await writeFile(join(staged, 'NODE-METAFILE.json'), JSON.stringify(nodeMeta, null, 2) + '\n');
  await writeFile(join(staged, 'NODE-DEPENDENCIES.json'), JSON.stringify({ target: 'node22.13', packages: nodeDependencies,
    inputs: nodeInputs, outputs: { 'dist/node-archive.cjs': digest(await readFile(nodeOutfile)) } }, null, 2) + '\n');
  await writeFile(join(staged, 'NODE-THIRD-PARTY-NOTICES.txt'), nodeNotices.join('\n'));

  const outfile = join(staged, 'dist/exceljs.browser.mjs');
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(packageDir, 'src/browser-entry.mjs')], outfile,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true, minify: true,
    legalComments: 'inline',
    inject: [join(packageDir, 'src/browser-globals.mjs')],
    define: { global: 'globalThis' },
    alias: {
      'wyreup-excel-browser-source': join(staged, 'lib/exceljs.browser.js'),
      buffer: require.resolve('buffer/'), process: require.resolve('process/browser'),
      events: require.resolve('events/'), util: require.resolve('util/'),
      stream: require.resolve('stream-browserify'), fs: join(packageDir, 'src/browser-fs.cjs'),
      crypto: join(packageDir, 'src/browser-crypto.cjs'),
    },
  });
  if (result.warnings.length) throw new Error(`Browser build warnings: ${JSON.stringify(result.warnings)}`);
  execFileSync(process.execPath, ['--check', outfile]);

  const packages = new Map();
  const inputs = [];
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    const inputFile = resolve(root, input);
    if (!inputFile.startsWith(root + '/')) throw new Error(`Unexpected browser dependency path: ${input}`);
    inputs.push({ path: relative(root, inputFile).replaceAll('\\', '/'), sha256: digest(await readFile(inputFile)) });
    let directory = dirname(resolve(root, input));
    while (directory !== root) {
      const path = join(directory, 'package.json');
      const manifest = await readFile(path, 'utf8').then(JSON.parse).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (manifest?.name && manifest.version) {
        if (['uuid', 'elliptic', 'crypto-browserify', 'browserify'].includes(manifest.name)) {
          throw new Error(`Prohibited browser dependency: ${manifest.name}`);
        }
        packages.set(`${manifest.name}@${manifest.version}`, { manifest: relative(root, path),
          name: manifest.name, version: manifest.version, license: manifest.license, directory });
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`No package provenance for ${input}`);
      directory = parent;
    }
  }
  const notices = [await readFile(join(packageDir, 'NOTICE'), 'utf8'), await readFile(join(staged, 'LICENSE'), 'utf8')];
  const dependencies = [];
  for (const dependency of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const licenseFiles = (await readdir(dependency.directory)).filter(file => /^(licen[sc]e|copying|notice)([._-]|$)/i.test(file));
    notices.push(`\n--- ${dependency.name}@${dependency.version} (${JSON.stringify(dependency.license)}) ---\n`);
    if (licenseFiles.length === 0 && dependency.name === 'saxes' && dependency.version === '5.0.1') {
      notices.push(await readFile(join(packageDir, 'licenses/saxes-5.0.1.txt'), 'utf8'));
    } else if (licenseFiles.length === 0) {
      // Some upstream packages publish their full MIT grant in README only.
      const readme = await readFile(join(dependency.directory, 'README.md'), 'utf8');
      const license = readme.match(/(?:^|\n)#+ License\s*\n([\s\S]+)/i)?.[1];
      if (!license || !license.includes('Permission is hereby granted')) {
        throw new Error(`Missing complete license text for ${dependency.name}`);
      }
      notices.push(license);
    }
    for (const file of licenseFiles) notices.push(await readFile(join(dependency.directory, file), 'utf8'));
    const { directory: _directory, ...record } = dependency;
    dependencies.push(record);
  }
  const normalizedMeta = JSON.parse(JSON.stringify(result.metafile)
    .replaceAll('\\\\', '/')
    .replaceAll(relative(root, staged).replaceAll('\\', '/'), 'vendor')
    .replaceAll(`${root.replaceAll('\\', '/')}/`, ''));
  await writeFile(join(staged, 'BROWSER-METAFILE.json'), JSON.stringify(normalizedMeta, null, 2) + '\n');
  inputs.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(staged, 'BROWSER-DEPENDENCIES.json'), JSON.stringify({ packages: dependencies, inputs }, null, 2) + '\n');
  await writeFile(join(staged, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
  await writeFile(join(staged, 'BUILD-MANIFEST.json'), JSON.stringify({ upstream, recipe, sourceFiles, files: await inventory(staged) }, null, 2) + '\n');
  await rm(vendor, { recursive: true, force: true });
  await rename(staged, vendor);
  await verify();
  process.stdout.write(`Built ExcelJS with ${dependencies.length} recorded browser dependencies\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
