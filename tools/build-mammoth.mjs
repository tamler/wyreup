import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm, rename, copyFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { x as extract } from 'tar';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/mammoth');
const vendor = join(packageDir, 'vendor');
const require = createRequire(join(packageDir, 'package.json'));
const upstream = JSON.parse(await readFile(join(packageDir, 'UPSTREAM.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const recipeFiles = ['tools/build-mammoth.mjs', 'packages/mammoth/UPSTREAM.json', 'packages/mammoth/NOTICE',
  'packages/mammoth/src/browser-globals.mjs', 'packages/mammoth/src/browser-entry.mjs'];
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

async function verify() {
  const manifest = JSON.parse(await readFile(join(vendor, 'BUILD-MANIFEST.json'), 'utf8'));
  if (manifest.recipe !== recipe || JSON.stringify(manifest.upstream) !== JSON.stringify(upstream)) {
    throw new Error('Mammoth build recipe changed; rebuild before packing');
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(await inventory(vendor))) {
    throw new Error('Mammoth artifact content differs from its build inventory');
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
}

if (process.argv.includes('--verify')) {
  await verify();
  process.stdout.write('Verified Mammoth artifact\n');
  process.exit(0);
}

const temp = await mkdtemp(join(packageDir, '.mammoth-build-'));
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
    if (!response.ok || !response.body) throw new Error(`Mammoth upstream download failed: ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new Error('Mammoth archive exceeds size budget');
      chunks.push(chunk);
    }
    archiveBytes = Buffer.concat(chunks);
  }
  if (`sha512-${createHash('sha512').update(archiveBytes).digest('base64')}` !== upstream.integrity) {
    throw new Error('Mammoth upstream integrity mismatch');
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
      throw new Error('Unexpected Mammoth archive path');
    }
    if (!['File', 'Directory'].includes(entry.type)) throw new Error('Mammoth archive contains a non-regular entry');
    entryCount += 1;
    expandedSize += entry.size;
    if (entryCount > 4096 || entry.size > 8 * 1024 * 1024 || expandedSize > 32 * 1024 * 1024) {
      throw new Error('Mammoth archive exceeds expanded size budget');
    }
    const local = file.slice('package/'.length);
    return entry.type === 'Directory' || local.startsWith('lib/') || local.startsWith('browser/') || local === 'LICENSE';
  } });
  const parserFile = join(staged, 'lib/xml/xmldom.js');
  const parserBefore = await readFile(parserFile, 'utf8');
  const parseNeedle = 'domParser.parseFromString(string)';
  const handlerNeedle = 'errorHandler: function(level, message)';
  if (parserBefore.split(parseNeedle).length !== 2 || parserBefore.split(handlerNeedle).length !== 2) {
    throw new Error('Mammoth XML adapter preimage changed');
  }
  await writeFile(parserFile, parserBefore.replace(parseNeedle, "domParser.parseFromString(string, 'text/xml')")
    .replace(handlerNeedle, 'onError: function(level, message)'));
  execFileSync(process.execPath, ['--check', parserFile]);
  const sourceFiles = await inventory(staged);
  for (const file of Object.keys(sourceFiles).filter(file => file.endsWith('.js'))) {
    const source = await readFile(join(staged, file), 'utf8');
    if (/require\(['"](?:argparse|sprintf-js)['"]\)/.test(source)) throw new Error(`Unexpected CLI import: ${file}`);
  }
  await mkdir(join(staged, 'dist'), { recursive: true });
  const outfile = join(staged, 'dist/mammoth.browser.mjs');
  const browserFiles = new Map([
    [join(staged, 'lib/unzip.js'), join(staged, 'browser/unzip.js')],
    [join(staged, 'lib/docx/files.js'), join(staged, 'browser/docx/files.js')],
  ]);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(packageDir, 'src/browser-entry.mjs')], outfile,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true, minify: true,
    legalComments: 'inline',
    inject: [join(packageDir, 'src/browser-globals.mjs')],
    define: { global: 'globalThis' },
    alias: { 'wyreup-mammoth-browser-source': join(staged, 'lib/index.js'), buffer: require.resolve('buffer/') },
    plugins: [{ name: 'upstream-browser-replacements', setup(builder) {
      builder.onResolve({ filter: /^\./ }, args => {
        const file = resolve(args.resolveDir, args.path.endsWith('.js') ? args.path : args.path + '.js');
        const replacement = browserFiles.get(file);
        return replacement ? { path: replacement } : null;
      });
    } }],
  });
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
        if (['argparse', 'sprintf-js'].includes(manifest.name)) {
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
    if (licenseFiles.length === 0) {
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
  process.stdout.write(`Built Mammoth with ${dependencies.length} recorded browser dependencies\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
