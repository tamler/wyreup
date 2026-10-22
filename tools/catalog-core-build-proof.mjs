import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, readlink, rm, rmdir, symlink, writeFile, link } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDED = new Set(['node_modules', 'dist', '.turbo', '.tsup', '.cache', '.vite', '.vite-temp', '.astro']);
const CONFIG_SHA = 'e49a67e2fdc256cd7e02efa6b750bffcdbf4b59779d6e53f4bd9364499a8691b';
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const order = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const missing = (error) => ['ENOENT', 'ENOTDIR'].includes(error?.code);
const builtin = new Set(builtinModules.flatMap((name) => [name, 'node:' + name]));
const executedLifecycles = new WeakMap();
const GENERATED_REQUIRE_HELPER = "var __require = /* @__PURE__ */ ((x) => typeof require !== \"undefined\" ? require : typeof Proxy !== \"undefined\" ? new Proxy(x, {\n  get: (a, b) => (typeof require !== \"undefined\" ? require : a)[b]\n}) : x)(function(x) {\n  if (typeof require !== \"undefined\") return require.apply(this, arguments);\n  throw Error('Dynamic require of \"' + x + '\" is not supported');\n});\n\nexport { __require };";
const GENERATED_WRAPPER_BINDINGS = new Map([
  ['packages/core/src/lib/excel.ts', ['addAOAToSheet', 'addObjectsToSheet', 'addWorksheet', 'getSheet', 'newWorkbook', 'readWorkbook', 'sheetNames', 'sheetToAOA', 'sheetToCsv', 'sheetToObjects', 'writeWorkbookBuffer']],
  ['packages/core/src/lib/pdf-ranges.ts', ['parseRangeSpec']],
]);
const GENERATED_RELATION_LIMITS = {
  codeSourceRelationValidated: false,
  mappingCoverageValidated: false,
  runtimeConsumptionValidated: false,
};

function check(deadlineAt) {
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) throw new Error('Stage A operation deadline exceeded.');
}
async function phase(deadlineAt, operation) {
  check(deadlineAt);
  const value = await operation();
  check(deadlineAt);
  return value;
}
function logical(file) {
  assert(typeof file === 'string' && file.length > 0 && !path.isAbsolute(file) && !/[\\\0]/.test(file));
  assert(file.split('/').every((part) => part && part !== '.' && part !== '..'));
  return file;
}
async function pin(file, label = file, deadlineAt) {
  if (deadlineAt !== undefined) check(deadlineAt);
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink(), 'Nonregular pinned file: ' + file);
  const actual = await realpath(file);
  assert.equal(actual, path.resolve(file), 'Noncanonical pinned path: ' + file);
  const digest = createHash('sha256');
  let bytes = 0;
  const stream = createReadStream(actual);
  const closed = new Promise((resolve) => stream.once('close', resolve));
  try {
    for await (const chunk of stream) {
      if (deadlineAt !== undefined) check(deadlineAt);
      bytes += chunk.length; digest.update(chunk);
    }
  } finally { if (!stream.destroyed) stream.destroy(); await closed; }
  if (deadlineAt !== undefined) check(deadlineAt);
  assert.equal(bytes, info.size, 'Pinned file changed while reading: ' + file);
  return { path: label, bytes, sha256: digest.digest('hex') };
}
async function inventory(directory, prefix = '', excluded = new Set(), deadlineAt) {
  const result = [];
  async function walk(base, relative) {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (deadlineAt !== undefined) check(deadlineAt);
      if (entry.isDirectory() && excluded.has(entry.name)) continue;
      const name = relative + entry.name;
      logical(name);
      if (entry.isDirectory()) await walk(path.join(base, entry.name), name + '/');
      else if (entry.isFile()) result.push(await pin(path.join(base, entry.name), prefix + name, deadlineAt));
      else throw new Error('Input contains a symlink/special file: ' + name);
      assert(result.length <= 10000, 'Inventory exceeds 10000 records.');
    }
  }
  await walk(directory, '');
  return result.sort(order);
}
async function sourceInventory(root, deadlineAt) {
  const records = await inventory(path.join(root, 'packages/core'), 'packages/core/', EXCLUDED, deadlineAt);
  const required = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json'];
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const patch of Object.values(metadata.pnpm?.patchedDependencies ?? {})) {
    logical(patch); required.push(patch);
  }
  for (const file of required) records.push(await pin(path.join(root, file), file, deadlineAt));
  for (const name of ['exceljs', 'mammoth']) {
    const prefix = `packages/${name}/`;
    records.push(await pin(path.join(root, prefix, 'package.json'), prefix + 'package.json', deadlineAt));
    records.push(...await inventory(path.join(root, prefix, 'vendor'), prefix + 'vendor/', new Set(), deadlineAt));
    for (const file of ['UPSTREAM.json', 'NOTICE', 'README.md']) records.push(await pin(path.join(root, prefix, file), prefix + file, deadlineAt));
  }
  const config = JSON.parse(await readFile(path.join(root, 'packages/core/tsconfig.json'), 'utf8'));
  assert.equal(config.extends, '../../tsconfig.base.json', 'Unsupported local tsconfig extends.');
  records.sort(order);
  assert(records.length <= 10000);
  assert(records.every((item, index) => !index || item.path > records[index - 1].path), 'Duplicate source input.');
  return records;
}
async function protection(root, deadlineAt) {
  const records = [];
  for (const relative of ['packages/core/dist', '.turbo', '.cache', '.vite', '.vite-temp', 'node_modules/.vite', 'node_modules/.cache', 'packages/core/.turbo', 'packages/core/.tsup', 'packages/core/.cache', 'packages/core/.vite', 'packages/core/node_modules/.vite', 'packages/core/node_modules/.cache']) {
    const directory = path.join(root, relative);
    try {
      assert((await lstat(directory)).isDirectory(), 'Guarded directory is not regular: ' + directory);
      records.push({ path: relative, present: true, files: await inventory(directory, '', new Set(), deadlineAt) });
    } catch (error) {
      if (!missing(error)) throw error;
      records.push({ path: relative, present: false });
    }
  }
  return records;
}
async function exclusive(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
function errorRecord(error) {
  return { constructor: error?.constructor?.name ?? 'Error', message: String(error?.message ?? error) };
}

/** Private owner-only Node lifecycle. Controlled child tests are never compiler proof. */
export async function runOwnedNode({ args, cwd, logPath, diagnosticPath, environment, deadlineAt }) {
  assert(Array.isArray(args) && args.length > 0 && args.every((arg) => typeof arg === 'string' && arg && Buffer.byteLength(arg) <= 8192));
  assert(path.isAbsolute(cwd) && path.isAbsolute(logPath) && path.isAbsolute(diagnosticPath));
  assert.equal(await realpath(cwd), cwd);
  assert.equal(path.dirname(logPath), path.dirname(diagnosticPath));
  assert(Number.isFinite(deadlineAt) && deadlineAt > Date.now() && deadlineAt - Date.now() <= 180000);
  const allowed = ['NODE_ENV', 'CI', 'TZ', 'LANG', 'LC_ALL', 'PATH', 'COREPACK_ENABLE_STRICT'];
  assert(environment && Object.keys(environment).every((key) => allowed.includes(key) && typeof environment[key] === 'string' && Buffer.byteLength(environment[key]) <= 8192));
  const nodePath = await realpath(process.execPath);
  const node = { ...await pin(nodePath, nodePath, deadlineAt), version: process.version };
  check(deadlineAt);
  const handle = await open(logPath, 'wx');
  const writer = handle.createWriteStream({ autoClose: false });
  const state = { exitObserved: false, closeObserved: false, stdoutEOF: false, stderrEOF: false, stdoutClosed: false, stderrClosed: false, writerFinish: false, handleClosed: false, exitCode: null, signal: null, sigtermCount: 0, liveDirectPidAtDisposal: null, directHandleUnref: false, truncated: false, events: [] };
  const failures = [];
  const waiters = new Set();
  let finalizationAt = Infinity;
  let child;
  let writerClosed = false;
  let handleCloseStarted = false;
  let handleCloseRejected = false;
  let handleCloseError;
  let disposalPrimary;
  let disposalUntil = Infinity;
  let disposalRecord;
  const event = (kind) => { state.events.push({ kind, at: Date.now() }); for (const notify of waiters) notify(); retainDisposal(); };
  const failed = (error) => { failures.push(error); event('error'); };
  writer.on('error', failed);
  writer.once('finish', () => { state.writerFinish = true; event('writer-finish'); });
  writer.once('close', () => { writerClosed = true; event('writer-close'); });
  function terminateOnce() {
    if (child?.pid && child.exitCode === null && child.signalCode === null && !state.sigtermCount) {
      state.sigtermCount = 1;
      child.kill('SIGTERM');
      finalizationAt = Math.min(finalizationAt, Date.now() + 5000);
      event('direct-sigterm');
    }
  }
  async function wait(predicate, until, failOnErrors = true, capFinalization = true) {
    if (failOnErrors && failures.length) throw failures[0];
    if (predicate()) return;
    await new Promise((resolve, reject) => {
      let timer;
      const done = (error) => { clearTimeout(timer); waiters.delete(inspect); error ? reject(error) : resolve(); };
      const inspect = () => {
        if (failOnErrors && failures.length) done(failures[0]);
        else if (predicate()) done();
        else arm();
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => done(new Error('Owned child/transport finalization deadline exceeded.')), Math.max(1, (capFinalization ? Math.min(until, finalizationAt) : until) - Date.now()));
      };
      waiters.add(inspect); inspect();
    });
  }
  async function releaseWriterAndHandle(until, complete) {
    if (complete) assert(state.writerFinish, 'Cannot release an unfinished log writer as complete.');
    if (!writer.destroyed) writer.destroy();
    event('writer-release-requested');
    if (!handleCloseStarted) {
      handleCloseStarted = true;
      try {
        void handle.close().then(
          () => { state.handleClosed = true; event('handle-close'); },
          (error) => { handleCloseRejected = true; handleCloseError = error; failed(error); },
        );
      } catch (error) { handleCloseRejected = true; handleCloseError = error; failed(error); }
    }
    await wait(() => writerClosed && state.handleClosed || handleCloseRejected, until, complete, complete);
    if (handleCloseRejected) throw handleCloseError;
  }
  const details = () => ({ ...state, events: [...state.events], errors: failures.map(errorRecord) });
  function retainDisposal() {
    if (!disposalPrimary || disposalRecord || !(state.handleClosed && writerClosed && (!child || state.stdoutClosed && state.stderrClosed))) return disposalRecord;
    disposalRecord = Promise.resolve().then(async () => {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        state.liveDirectPidAtDisposal = child.pid;
        child.unref(); state.directHandleUnref = true; event('live-direct-handle-unref');
      }
      await exclusive(diagnosticPath + '.disposal.json', { primary: errorRecord(disposalPrimary), state: details(), completeLog: false, descendantClosure: 'UNPROVEN', lateSettlement: Date.now() > disposalUntil });
    });
    void disposalRecord.catch((error) => { failures.push(error); });
    return disposalRecord;
  }
  try {
    check(deadlineAt);
    child = spawn(nodePath, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', failed);
    child.once('exit', (code, signal) => {
      state.exitObserved = true; state.exitCode = code; state.signal = signal;
      finalizationAt = Math.min(finalizationAt, Date.now() + 5000); event('child-exit');
      if (code !== 0 || signal !== null) failed(new Error(`Owned Node child failed: ${code}/${signal}.`));
    });
    child.once('close', (code, signal) => { state.closeObserved = true; state.exitCode = code; state.signal = signal; event('child-close'); });
    for (const [stream, field, closed] of [[child.stdout, 'stdoutEOF', 'stdoutClosed'], [child.stderr, 'stderrEOF', 'stderrClosed']]) {
      assert(stream);
      stream.on('error', failed);
      stream.once('end', () => { state[field] = true; event(field); });
      stream.once('close', () => { state[closed] = true; event(closed); if (!state[field] && !state.truncated) failed(new Error(`Premature readable close: ${field}.`)); });
      stream.pipe(writer, { end: false });
    }
    await wait(() => state.exitObserved && state.closeObserved && state.stdoutEOF && state.stderrEOF && state.stdoutClosed && state.stderrClosed, deadlineAt);
    writer.end();
    await wait(() => state.writerFinish, Math.min(deadlineAt, finalizationAt));
    await releaseWriterAndHandle(Math.min(deadlineAt, finalizationAt), true);
    if (failures.length) throw failures[0];
    check(Math.min(deadlineAt, finalizationAt));
    assert.equal(state.exitCode, 0); assert.equal(state.signal, null);
    assert.deepEqual(await pin(nodePath), { path: node.path, bytes: node.bytes, sha256: node.sha256 }, 'Node executable drift.');
    const log = await pin(logPath);
    if (failures.length) throw failures[0];
    check(Math.min(deadlineAt, finalizationAt));
    const result = { argv: [nodePath, ...args], cwd, node, environment: { ...environment }, log, outcome: { exitCode: 0, signal: null, exitObserved: true, closeObserved: true, logWritersSettled: true }, details: details() };
    executedLifecycles.set(result, structuredClone(result));
    return result;
  } catch (primary) {
    state.truncated = true;
    disposalPrimary = primary;
    terminateOnce();
    disposalUntil = Date.now() + 5000;
    try { await exclusive(diagnosticPath, { classification: 'REFUSED truncated log; no complete-writer/compiler proof', primary: errorRecord(primary), state: details() }); }
    catch (error) { failures.push(error); }
    for (const stream of [child?.stdout, child?.stderr]) if (stream) { stream.unpipe(writer); stream.destroy(); }
    try { if (child) await wait(() => state.stdoutClosed && state.stderrClosed, disposalUntil, false, false); }
    catch (error) { failures.push(error); }
    try {
      if (!writer.writableEnded && !writer.destroyed) writer.end();
      if (!writer.destroyed) await wait(() => state.writerFinish || Boolean(writer.errored), disposalUntil, false, false);
    } catch (error) { failures.push(error); writer.destroy(); }
    try { await releaseWriterAndHandle(disposalUntil, false); }
    catch (error) { failures.push(error); }
    const retained = retainDisposal();
    if (retained) await retained.catch(() => {});
    throw new AggregateError([primary, ...failures.filter((error) => error !== primary)], 'Stage A owned Node operation refused; retained tree/log.', { cause: primary });
  }
}

async function packageOwner(file) {
  let directory = path.dirname(await realpath(file));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (typeof manifest.name === 'string' && typeof manifest.version === 'string') return directory;
    } catch (error) { if (!missing(error)) throw error; }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, 'No package owner: ' + file);
    directory = parent;
  }
}
async function resolvePackage(name, from) {
  const require = createRequire(from);
  try { return await packageOwner(require.resolve(name + '/package.json')); }
  catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && error.code !== 'MODULE_NOT_FOUND') throw error;
    return packageOwner(require.resolve(name));
  }
}
async function dependencyContext(root, ownedRoot, deadlineAt) {
  const owners = new Map();
  const links = [];
  const resolutions = [];
  const nativeBranches = [];
  const logicalDirectories = [path.join(root, 'node_modules'), path.join(root, 'packages/core/node_modules')];
  async function owner(directory) {
    check(deadlineAt);
    directory = await realpath(directory);
    if (!owners.has(directory)) {
      const packageJson = await pin(path.join(directory, 'package.json'), path.join(directory, 'package.json'), deadlineAt);
      const metadata = JSON.parse(await readFile(packageJson.path, 'utf8'));
      assert(typeof metadata.name === 'string' && typeof metadata.version === 'string');
      owners.set(directory, { packageRoot: directory, name: metadata.name, version: metadata.version, packageJson, toolPins: [] });
      assert(owners.size <= 1024, 'Dependency owner budget.');
    }
    return owners.get(directory);
  }
  async function addTool(file) {
    file = await realpath(file);
    const entry = await owner(await packageOwner(file));
    if (file !== entry.packageJson.path && !entry.toolPins.some((item) => item.path === file)) entry.toolPins.push(await pin(file, file, deadlineAt));
    assert(entry.toolPins.length <= 256, 'Owner tool pin budget: ' + entry.name);
    return file;
  }
  async function compilerPackage(name, importer) {
    const directory = await resolvePackage(name, importer);
    const entry = await owner(directory);
    resolutions.push({ importer, specifier: name, packageRoot: directory, role: 'resolved compiler owner; not a runtime load observation' });
    for (const file of await inventory(directory, '', new Set(['node_modules']), deadlineAt)) await addTool(path.join(directory, file.path));
    return entry;
  }
  for (const relative of ['node_modules', 'packages/core/node_modules']) {
    const original = path.join(root, relative);
    const target = path.join(ownedRoot, relative);
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(original, { withFileTypes: true })) {
      check(deadlineAt);
      if (entry.name.startsWith('.')) continue;
      const names = entry.name.startsWith('@') ? (await readdir(path.join(original, entry.name))).map((name) => entry.name + '/' + name) : [entry.name];
      for (const name of names) {
        const originalLogical = path.join(original, name);
        const canonical = await realpath(originalLogical);
        assert((await lstat(canonical)).isDirectory());
        await owner(canonical);
        const ownedLogical = path.join(target, name);
        assert(inside(ownedRoot, ownedLogical));
        await mkdir(path.dirname(ownedLogical), { recursive: true });
        try { await symlink(canonical, ownedLogical, 'dir'); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          assert((await lstat(ownedLogical)).isSymbolicLink() && await realpath(ownedLogical) === canonical, 'Conflicting owned dependency link.');
        }
        links.push({ originalLogical, originalLinkText: (await lstat(originalLogical)).isSymbolicLink() ? await readlink(originalLogical) : null, canonical, ownedLogical, name });
      }
    }
  }
  const corePackage = path.join(root, 'packages/core/package.json');
  const tsup = await compilerPackage('tsup', corePackage);
  const tsupMetadata = JSON.parse(await readFile(tsup.packageJson.path, 'utf8'));
  assert(typeof tsupMetadata.bin?.tsup === 'string');
  const tsupBin = await addTool(path.join(tsup.packageRoot, tsupMetadata.bin.tsup));
  const esbuild = await compilerPackage('esbuild', tsup.packageJson.path);
  const rollup = await compilerPackage('rollup', tsup.packageJson.path);
  const bundle = await compilerPackage('bundle-require', tsup.packageJson.path);
  const bundleEsbuild = await compilerPackage('esbuild', bundle.packageJson.path);
  const wrapper = await compilerPackage('fix-dts-default-cjs-exports', tsup.packageJson.path);
  const wrapperRollup = await compilerPackage('rollup', createRequire(wrapper.packageJson.path).resolve('fix-dts-default-cjs-exports/rollup'));
  const tsupTypeScript = await compilerPackage('typescript', tsup.packageJson.path);
  const cwdTypeScript = await compilerPackage('typescript', path.join(ownedRoot, 'packages/core/package.json'));
  assert.equal(cwdTypeScript.packageRoot, tsupTypeScript.packageRoot, 'TypeScript cwd availability differs from compiler require; held.');
  assert.equal(process.platform, 'darwin', 'Current selector support is held outside darwin.');
  assert.equal(process.arch, 'arm64', 'Current selector support is held outside arm64.');
  for (const candidate of new Map([esbuild, bundleEsbuild].map((entry) => [entry.packageRoot, entry])).values()) {
    const selector = path.join(candidate.packageRoot, 'lib/main.js');
    const text = await readFile(selector, 'utf8');
    assert(text.includes('darwin arm64 LE') && text.includes('@esbuild/darwin-arm64'), 'Unknown esbuild selector.');
    assert(!Object.hasOwn(process.env, 'ESBUILD_BINARY_PATH'), 'Environment native binary override held.');
    const selected = await addTool(createRequire(candidate.packageJson.path).resolve('@esbuild/darwin-arm64/bin/esbuild'));
    nativeBranches.push({ kind: 'esbuild-current-platform', selector: await pin(selector), selected: await pin(selected), overrideAbsent: true });
  }
  for (const candidate of new Map([rollup, wrapperRollup].map((entry) => [entry.packageRoot, entry])).values()) {
    const selector = path.join(candidate.packageRoot, 'dist/native.js');
    const text = await readFile(selector, 'utf8');
    assert(text.includes("arm64: { base: 'darwin-arm64' }") && text.includes('existsSync(path.join(__dirname, localName)) ? localName'), 'Unknown Rollup selector.');
    const local = path.join(candidate.packageRoot, 'dist/rollup.darwin-arm64.node');
    let localPresent;
    try { assert((await lstat(local)).isFile()); localPresent = true; }
    catch (error) { if (!missing(error)) throw error; localPresent = false; }
    const selected = await addTool(localPresent ? local : createRequire(candidate.packageJson.path).resolve('@rollup/rollup-darwin-arm64'));
    nativeBranches.push({ kind: 'rollup-local-first', selector: await pin(selector), local, localPresent, selected: await pin(selected) });
  }
  const ts = createRequire(tsup.packageJson.path)('typescript');
  return { owners, links, resolutions, nativeBranches, tsupBin, ts, addTool, deadlineAt, logicalDirectories };
}

function recipe(ts, bytes, packageBytes) {
  assert.equal(hash(bytes), CONFIG_SHA, 'Unknown compiler recipe requires adjudication.');
  const packageMetadata = JSON.parse(packageBytes.toString('utf8'));
  assert.equal(packageMetadata.scripts?.build, 'tsup');
  assert.equal(packageMetadata.type, 'module');
  const source = ts.createSourceFile('tsup.config.ts', bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  const exported = source.statements.find((statement) => ts.isExportAssignment(statement));
  assert(exported && ts.isCallExpression(exported.expression) && exported.expression.arguments.length === 1);
  const array = exported.expression.arguments[0];
  assert(ts.isArrayLiteralExpression(array) && array.elements.length === 2);
  function field(object, name) {
    assert(ts.isObjectLiteralExpression(object));
    return object.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === name)?.initializer;
  }
  function string(node) { assert(node && ts.isStringLiteralLike(node)); return node.text; }
  const configurations = array.elements.map((object) => {
    const entries = field(object, 'entry');
    const formats = field(object, 'format');
    assert(ts.isObjectLiteralExpression(entries) && ts.isArrayLiteralExpression(formats));
    for (const name of ['dts', 'sourcemap', 'clean', 'treeshake']) assert.equal(field(object, name)?.kind, ts.SyntaxKind.TrueKeyword, name);
    return {
      platform: string(field(object, 'platform')),
      outDir: string(field(object, 'outDir')),
      entries: entries.properties.map((property) => {
        assert(ts.isPropertyAssignment(property));
        return { name: ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(source), input: string(property.initializer) };
      }),
      formats: formats.elements.map(string),
    };
  });
  assert.deepEqual(configurations.map((config) => config.platform), ['browser', 'node']);
  const required = configurations.flatMap((config) => config.entries.flatMap((entry) => config.formats.flatMap((format) => {
    const base = `${config.platform}/${entry.name}`;
    assert(format === 'esm' || format === 'cjs');
    const extension = format === 'esm' ? '.js' : '.cjs';
    return [base + extension, base + extension + '.map', base + (format === 'esm' ? '.d.ts' : '.d.cts')];
  })));
  assert.equal(required.length, 21);
  return { configurations, required: required.sort(), packageMetadata };
}

function imports(ts, filename, text) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, filename.endsWith('.json') ? ts.ScriptKind.JSON : undefined);
  assert.equal(source.parseDiagnostics.length, 0, 'Unsupported/malformed parsed source: ' + filename);
  const edges = [];
  function walk(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (!(bindings && ts.isNamedImports(bindings) && !node.importClause.name && bindings.elements.length > 0 && bindings.elements.every((entry) => entry.isTypeOnly))) edges.push({ kind: 'static-import', specifier: node.moduleSpecifier.text });
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      if (!(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((entry) => entry.isTypeOnly))) edges.push({ kind: 'static-export', specifier: node.moduleSpecifier.text });
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      assert(ts.isStringLiteralLike(node.moduleReference.expression));
      edges.push({ kind: 'literal-require', specifier: node.moduleReference.expression.text });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const argument = node.arguments[0];
      if (node.arguments.length === 1 && argument && ts.isStringLiteralLike(argument)) edges.push({ kind: dynamic ? 'literal-dynamic-import' : 'literal-require', specifier: argument.text });
      else edges.push({ kind: 'runtime-only-expression', expression: node.getText(source).slice(0, 4096) });
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  return edges;
}
async function resolveLocal(candidate) {
  const extension = path.extname(candidate);
  const choices = extension === '.js' ? [candidate.slice(0, -3) + '.ts', candidate.slice(0, -3) + '.tsx', candidate] : extension ? [candidate] : ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'].map((suffix) => candidate + suffix);
  for (const file of [...choices, ...['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs', 'index.json'].map((name) => path.join(candidate, name))]) {
    try { if ((await lstat(file)).isFile()) return await realpath(file); }
    catch (error) { if (!missing(error)) throw error; }
  }
  throw new Error('Unresolved literal input: ' + candidate);
}
function selectTarget(value, conditions) {
  if (typeof value === 'string') return value;
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Unsupported conditional package target.');
  for (const [condition, target] of Object.entries(value)) if (condition === 'default' || conditions.has(condition)) return selectTarget(target, conditions);
  throw new Error('No matching package target.');
}
async function resolveBare(specifier, importer, platform, kind) {
  assert(!specifier.startsWith('#'), 'Package imports-map selection held.');
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const subpath = specifier.slice(name.length);
  const directory = await resolvePackage(name, importer);
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  let selected;
  if (metadata.exports !== undefined) {
    let target = metadata.exports;
    if (target && typeof target === 'object' && !Array.isArray(target) && Object.keys(target).some((key) => key.startsWith('.'))) {
      const key = '.' + subpath;
      target = target[key];
      if (target === undefined) {
        const matches = Object.keys(metadata.exports).filter((pattern) => pattern.includes('*') && key.startsWith(pattern.split('*')[0]) && key.endsWith(pattern.split('*')[1]));
        assert.equal(matches.length, 1, 'Ambiguous/unmapped package export: ' + specifier);
        const pattern = matches[0];
        const capture = key.slice(pattern.split('*')[0].length, key.length - pattern.split('*')[1].length);
        target = selectTarget(metadata.exports[pattern], new Set([platform, kind === 'literal-require' ? 'require' : 'import', 'module'])).replaceAll('*', capture);
      }
    }
    selected = selectTarget(target, new Set([platform, kind === 'literal-require' ? 'require' : 'import', 'module']));
    assert(selected.startsWith('./'), 'Unconfined package target.');
  } else if (subpath) selected = '.' + subpath;
  else selected = platform === 'browser' && typeof metadata.browser === 'string' ? metadata.browser : platform === 'browser' ? metadata.module ?? metadata.main ?? 'index.js' : metadata.main ?? metadata.module ?? 'index.js';
  if (platform === 'browser' && metadata.browser && typeof metadata.browser === 'object') {
    const replacement = metadata.browser[selected] ?? metadata.browser['./' + selected.replace(/^\.\//, '')];
    if (replacement !== undefined) { assert(typeof replacement === 'string', 'Unsupported browser false/virtual module.'); selected = replacement; }
  }
  const file = await resolveLocal(path.resolve(directory, selected));
  assert(inside(directory, file), 'Escaping package selection.');
  return file;
}

async function deriveGraphs(root, ownedRoot, specification, dependencies, sourceInputs) {
  const sourceFiles = new Map(sourceInputs.map((item) => [path.join(root, item.path), item]));
  const copiedCore = path.join(ownedRoot, 'packages/core');
  const external = new Set([...Object.keys(specification.packageMetadata.dependencies ?? {}), ...Object.keys(specification.packageMetadata.peerDependencies ?? {})]);
  const graphs = [];
  const inputMaps = new Map();
  const resolutionEdges = [];
  for (const config of specification.configurations) {
    for (const entry of config.entries) {
      const files = new Set();
      const runtime = [];
      async function visit(filename) {
        check(dependencies.deadlineAt);
        filename = await realpath(filename);
        if (files.has(filename)) return;
        files.add(filename);
        assert(files.size <= 10000, 'Input graph budget.');
        if (inside(copiedCore, filename)) {
          const original = path.join(root, 'packages/core', path.relative(copiedCore, filename));
          const guarded = sourceFiles.get(original);
          assert(guarded, 'Unrecorded copied source: ' + filename);
          assert.deepEqual(await pin(filename, guarded.path), guarded, 'Copied source differs.');
        } else await dependencies.addTool(filename);
        const text = await readFile(filename, 'utf8');
        if (filename.endsWith('.json')) { JSON.parse(text); return; }
        assert(/\.(?:[cm]?js|jsx|ts|tsx)$/.test(filename), 'Unsupported inlined input type: ' + filename);
        if (/[/\\]pdfjs-dist[/\\]legacy[/\\]build[/\\]pdf(?:\.worker)?\.mjs$/.test(filename)) {
          const comments = text.match(/\/\/# sourceMappingURL=[^\r\n]+/g) ?? [];
          const raw = comments.at(-1);
          assert.equal(raw, '//# sourceMappingURL=' + path.basename(filename) + '.map', 'Unsupported PDF input mappingURL.');
          const mapPath = await dependencies.addTool(filename + '.map');
          const map = JSON.parse(await readFile(mapPath, 'utf8'));
          assert.equal(map.sourceRoot, '');
          assert(Array.isArray(map.sources) && Array.isArray(map.sourcesContent) && map.sources.length === map.sourcesContent.length);
          assert(map.sources.every((raw) => typeof raw === 'string') && map.sourcesContent.every((content) => typeof content === 'string'), 'Incomplete opaque input-map content.');
          inputMaps.set(filename, { module: await pin(filename), map: await pin(mapPath), sourceMappingURL: raw, rawMap: map });
          if (filename.endsWith('/pdf.mjs')) {
            assert(text.includes('if (intentState.opListReadCapability) {\n          intentState.opListReadCapability.reject(reason);\n        }\n        if (intentState.operatorList)'));
            assert(text.includes('} else if (!intentState.opListReadCapability) {\n          throw reason;'));
          }
        }
        for (const edge of imports(dependencies.ts, filename, text)) {
          if (edge.kind === 'runtime-only-expression') { runtime.push({ input: filename, ...edge }); continue; }
          const specifier = edge.specifier;
          if (builtin.has(specifier)) { resolutionEdges.push({ input: filename, ...edge, platform: config.platform, disposition: 'runtime-builtin' }); continue; }
          const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
          const noExternal = config.platform === 'browser' ? /^pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs$/ : /^pdfjs-dist\/legacy\/build\/pdf\.mjs$/;
          if (!specifier.startsWith('.') && external.has(packageName) && !noExternal.test(specifier)) {
            resolutionEdges.push({ input: filename, ...edge, platform: config.platform, disposition: 'declared-external-not-inlined' });
            continue;
          }
          let resolved;
          if (config.platform === 'node' && ['./file-job-platform.js', './bank-pdf-platform.js'].includes(specifier)) resolved = path.join(copiedCore, 'src/utilities', specifier === './file-job-platform.js' ? 'file-job-node.ts' : 'bank-pdf-node.ts');
          else resolved = specifier.startsWith('.') ? await resolveLocal(path.resolve(path.dirname(filename), specifier)) : await resolveBare(specifier, filename, config.platform, edge.kind);
          resolutionEdges.push({ input: filename, ...edge, platform: config.platform, resolved, disposition: 'accounted-literal-input' });
          await visit(resolved);
        }
      }
      await visit(path.join(copiedCore, entry.input));
      graphs.push({ platform: config.platform, entry: entry.name, files: [...files].sort(), runtime });
    }
  }
  return { graphs, inputMaps, resolutionEdges };
}
function opaqueKey(raw, input) {
  assert(typeof raw === 'string' && raw.startsWith(input ? 'webpack://pdf.js/' : 'webpack:/pdf.js/'), 'Unsupported opaque origin.');
  assert(!/[\\?#\0]/.test(raw) && !raw.split('/').includes('..'), 'Unsupported opaque path.');
  if (input) assert(!raw.includes('%'), 'Encoded input opaque origin refused.');
  else assert(!raw.includes(' ') && !/%(?!20)/.test(raw), 'Output opaque encoding refused.');
  return path.posix.normalize(input ? raw.replaceAll(' ', '%20') : raw);
}
async function mapRelationships(ownedRoot, outputs, specification, dependencies, derived, sourceInputs) {
  const outputRoot = path.join(ownedRoot, 'packages/core/dist');
  const js = outputs.filter((item) => /\.(?:js|cjs)$/.test(item.path));
  const names = new Set(js.map((item) => item.path));
  const edges = new Map();
  const texts = new Map();
  for (const item of js) {
    check(dependencies.deadlineAt);
    const text = await readFile(path.join(outputRoot, item.path), 'utf8');
    texts.set(item.path, text);
    const comment = text.match(/\/\/# sourceMappingURL=[^\r\n]+/g)?.at(-1);
    assert.equal(comment, '//# sourceMappingURL=' + path.basename(item.path) + '.map', 'Missing/unsupported emitted source map: ' + item.path);
    assert(outputs.some((candidate) => candidate.path === item.path + '.map' && candidate.bytes > 0));
    const linked = [];
    for (const edge of imports(dependencies.ts, item.path, text)) {
      if (!edge.specifier?.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(item.path), edge.specifier));
      assert(target.startsWith(item.path.split('/')[0] + '/') && names.has(target), 'Wrong/unaccountable output namespace edge: ' + target);
      linked.push({ target, kind: edge.kind });
    }
    edges.set(item.path, linked);
  }
  const rootsByOutput = new Map();
  for (const config of specification.configurations) for (const entry of config.entries) for (const format of config.formats) {
    const root = `${config.platform}/${entry.name}${format === 'esm' ? '.js' : '.cjs'}`;
    const reached = new Set();
    function visit(name) {
      if (reached.has(name)) return;
      reached.add(name);
      assert(names.has(name));
      const roots = rootsByOutput.get(name) ?? new Set();
      roots.add(config.platform + ':' + entry.name); rootsByOutput.set(name, roots);
      for (const edge of edges.get(name)) visit(edge.target);
    }
    visit(root);
  }
  const toolFiles = new Map([...dependencies.owners.values()].flatMap((entry) => entry.toolPins.map((item) => [item.path, item])));
  const ledger = [];
  const generated = [];
  const validated = new Map();
  const generatedOutputs = [];
  const originalRoot = path.dirname(dependencies.logicalDirectories[0]);
  let sdkContext;
  async function generatedSdk(output) {
    if (sdkContext) return sdkContext;
    try {
      const requiredToolPins = new Map();
      function requireContext(condition, reason) { assert(condition, reason); }
      function resolution(importer, specifier) {
        const matches = dependencies.resolutions.filter((item) => item.importer === importer && item.specifier === specifier);
        requireContext(matches.length === 1, 'unique direct ' + specifier + ' resolution');
        return matches[0];
      }
      async function owner(record, name, version) {
        check(dependencies.deadlineAt);
        const entry = dependencies.owners.get(record.packageRoot);
        requireContext(entry && entry.packageRoot === record.packageRoot && entry.name === name && entry.version === version, 'direct ' + name + ' owner/version');
        requireContext(await realpath(entry.packageRoot) === entry.packageRoot && entry.packageJson.path === path.join(entry.packageRoot, 'package.json'), 'canonical ' + name + ' package owner');
        assert.deepEqual(await pin(entry.packageJson.path, entry.packageJson.path, dependencies.deadlineAt), entry.packageJson, name + ' captured package identity');
        const metadata = JSON.parse(await phase(dependencies.deadlineAt, () => readFile(entry.packageJson.path, 'utf8')));
        requireContext(metadata.name === name && metadata.version === version, name + ' package metadata');
        requiredToolPins.set(entry.packageJson.path, entry.packageJson);
        return entry;
      }
      async function tool(entry, file, expected) {
        const matches = entry.toolPins.filter((item) => item.path === file);
        requireContext(matches.length === 1, entry.name + ' required owned tool: ' + path.relative(entry.packageRoot, file));
        const captured = matches[0];
        assert.deepEqual(await pin(file, file, dependencies.deadlineAt), captured, entry.name + ' captured tool identity');
        if (expected) requireContext(captured.bytes === expected.bytes && captured.sha256 === expected.sha256, entry.name + ' required whole tool pin: ' + path.relative(entry.packageRoot, file));
        requiredToolPins.set(file, captured);
        return captured;
      }
      const corePackage = await realpath(path.join(originalRoot, 'packages/core/package.json'));
      const tsupResolution = resolution(corePackage, 'tsup');
      const tsup = await owner(tsupResolution, 'tsup', '8.5.1');
      requireContext(await packageOwner(dependencies.tsupBin) === tsup.packageRoot, 'selected tsup bin owner');
      await tool(tsup, dependencies.tsupBin);
      await tool(tsup, path.join(tsup.packageRoot, 'dist/index.js'), { bytes: 59220, sha256: '8d68123d7e85aab57156133f122dfe83a254ecd506eed26d63c50e8cff8c5cd2' });
      const esbuildResolution = resolution(tsup.packageJson.path, 'esbuild');
      const rollupResolution = resolution(tsup.packageJson.path, 'rollup');
      const esbuild = await owner(esbuildResolution, 'esbuild', '0.28.2');
      const rollup = await owner(rollupResolution, 'rollup', '4.64.2');
      const esbuildSelector = await tool(esbuild, path.join(esbuild.packageRoot, 'lib/main.js'));
      const rollupSelector = await tool(rollup, path.join(rollup.packageRoot, 'dist/native.js'));
      await tool(rollup, path.join(rollup.packageRoot, 'dist/shared/rollup.js'), { bytes: 982863, sha256: '9a7e2371483d8f2b6ddd38efb694cf95dde77382d5c73789e54f8011cbda9b88' });
      function branch(kind, selector) {
        const matches = dependencies.nativeBranches.filter((item) => item.kind === kind && item.selector.path === selector.path);
        requireContext(matches.length === 1, 'unique direct ' + kind + ' native branch');
        assert.deepEqual(matches[0].selector, selector, kind + ' direct selector identity');
        return matches[0];
      }
      const esbuildNativeBranch = branch('esbuild-current-platform', esbuildSelector);
      const rollupNativeBranch = branch('rollup-local-first', rollupSelector);
      requireContext(esbuildNativeBranch.overrideAbsent === true, 'direct esbuild override absence');
      requireContext(rollupNativeBranch.local === path.join(rollup.packageRoot, 'dist/rollup.darwin-arm64.node') && typeof rollupNativeBranch.localPresent === 'boolean', 'direct Rollup local-first selector');
      async function selectedNative(record, name, version) {
        const packageRoot = await packageOwner(record.selected.path);
        const entry = await owner({ packageRoot }, name, version);
        const selected = await tool(entry, record.selected.path);
        assert.deepEqual(selected, record.selected, name + ' branch selected pin in actual native package owner');
        return selected;
      }
      const binary = await selectedNative(esbuildNativeBranch, '@esbuild/darwin-arm64', '0.28.2');
      requireContext(binary.bytes === 10590882 && binary.sha256 === '10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384', 'direct esbuild required whole native binary pin');
      if (rollupNativeBranch.localPresent) {
        requireContext(rollupNativeBranch.selected.path === rollupNativeBranch.local && await packageOwner(rollupNativeBranch.selected.path) === rollup.packageRoot, 'direct Rollup local native owner');
        assert.deepEqual(await tool(rollup, rollupNativeBranch.selected.path), rollupNativeBranch.selected, 'direct Rollup local selected pin');
      } else await selectedNative(rollupNativeBranch, '@rollup/rollup-darwin-arm64', '4.64.2');
      const binaryBytes = await phase(dependencies.deadlineAt, () => readFile(binary.path));
      requireContext(binaryBytes.length === binary.bytes && hash(binaryBytes) === binary.sha256, 'direct esbuild whole binary before derived span');
      const span = binaryBytes.subarray(5084656, 5084656 + 397);
      requireContext(span.length === 397 && hash(span) === 'ba66a6b3c94727a332f4323bcbc2d9a12e017bfacc0f0029d3bfb5b381a10d3b', 'direct esbuild derived native template span');
      sdkContext = { tsupResolution, esbuildResolution, rollupResolution, esbuildNativeBranch, rollupNativeBranch, requiredToolPins: [...requiredToolPins.values()].sort(order), nativeTemplateSpan: { binary, offset: 5084656, bytes: 397, sha256: 'ba66a6b3c94727a332f4323bcbc2d9a12e017bfacc0f0029d3bfb5b381a10d3b' } };
      return sdkContext;
    } catch (error) {
      throw new Error('Generated map SDK context refused: ' + output + ' (' + error.message + ')', { cause: error });
    }
  }
  function parsed(filename, text, message) {
    const source = dependencies.ts.createSourceFile(filename, text, dependencies.ts.ScriptTarget.Latest, true);
    assert.equal(source.parseDiagnostics.length, 0, message);
    return source;
  }
  function functionBindings(source, emitted, message) {
    const ts = dependencies.ts;
    const bindings = [];
    const functions = new Map();
    for (const statement of source.statements) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const defaulted = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      if (ts.isFunctionDeclaration(statement)) {
        if (statement.name && ts.isIdentifier(statement.name) && statement.body) {
          const name = statement.name.text;
          functions.set(name, (functions.get(name) ?? 0) + 1);
          if (exported) { assert(!defaulted, message); bindings.push(name); }
        } else if (exported) assert.fail(message);
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly || statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length > 0 && statement.exportClause.elements.every((element) => element.isTypeOnly)) continue;
        assert(emitted && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause), message);
        for (const element of statement.exportClause.elements) {
          assert(!element.isTypeOnly && !element.propertyName && ts.isIdentifier(element.name), message);
          bindings.push(element.name.text);
        }
      } else if (ts.isExportAssignment(statement)) assert.fail(message);
      else if (exported && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) assert.fail(message);
    }
    assert(bindings.every((name) => functions.get(name) === 1) && new Set(bindings).size === bindings.length, message);
    return bindings.sort();
  }
  for (const item of js) {
    check(dependencies.deadlineAt);
    const roots = rootsByOutput.get(item.path);
    assert(roots?.size, 'Unreferenced/unmapped emitted output: ' + item.path);
    const eligibleFiles = new Set(derived.graphs.filter((graph) => roots.has(graph.platform + ':' + graph.entry)).flatMap((graph) => graph.files));
    const eligibleMaps = [...derived.inputMaps.values()].filter((input) => eligibleFiles.has(input.module.path));
    const mapPath = path.join(outputRoot, item.path + '.map');
    const outputMapPin = await pin(mapPath);
    const mapBytes = await readFile(mapPath);
    const map = JSON.parse(mapBytes.toString('utf8'));
    if (Array.isArray(map.sources) && map.sources.length === 0) {
      const message = 'Zero-source map shape refused: ' + item.path;
      assert.deepEqual(Object.keys(map).sort(), ['file', 'mappings', 'names', 'sources', 'version'], message);
      assert(map.version === 3 && Array.isArray(map.names) && map.names.length === 0 && map.mappings === '' && map.file === path.posix.basename(item.path), message);
      const canonical = Buffer.from(JSON.stringify({ version: 3, sources: [], names: [], mappings: '', file: path.posix.basename(item.path) }));
      assert.deepEqual(mapBytes, canonical, 'Zero-source map canonical bytes refused: ' + item.path);
      assert(/^(?:browser|node)\/[^/]+\.js$/.test(item.path), 'Generated map namespace refused: ' + item.path);
      const text = texts.get(item.path);
      const footer = '\n//# sourceMappingURL=' + path.posix.basename(item.path) + '.map\n//# sourceMappingURL=' + path.posix.basename(item.path) + '.map';
      assert(text.endsWith(footer), 'Generated helper executable refused: ' + item.path);
      generated.push({ item, map: outputMapPin, roots, body: text.slice(0, -footer.length) });
      continue;
    }
    assert.equal(map.version, 3);
    assert(Array.isArray(map.sources) && Array.isArray(map.sourcesContent) && map.sources.length === map.sourcesContent.length && map.sources.length <= 10000, 'Incomplete output map.');
    assert(typeof map.sourceRoot === 'string' || map.sourceRoot === undefined);
    const sourceStart = ledger.length;
    for (let index = 0; index < map.sources.length; index++) {
      const rawSource = map.sources[index];
      const content = map.sourcesContent[index];
      assert(typeof rawSource === 'string' && (typeof content === 'string' || content === null));
      const common = { output: item.path, map: outputMapPin, sourceIndex: index, rawSource, sourceRoot: map.sourceRoot ?? null, eligibleEntries: [...roots].sort(), ...GENERATED_RELATION_LIMITS };
      if (rawSource.startsWith('webpack:')) {
        assert(!map.sourceRoot && typeof content === 'string', 'Unsupported opaque output root/content.');
        const key = opaqueKey(rawSource, false);
        const matches = [];
        for (const input of eligibleMaps) for (let sourceIndex = 0; sourceIndex < input.rawMap.sources.length; sourceIndex++) {
          const inputRaw = input.rawMap.sources[sourceIndex];
          const inputContent = input.rawMap.sourcesContent[sourceIndex];
          if (opaqueKey(inputRaw, true) === key) matches.push({ input, sourceIndex, inputRaw, inputContent });
        }
        assert(new Set(matches.map((match) => match.inputRaw)).size <= 1, 'Opaque comparison-key collision: ' + key);
        assert(new Set(matches.map((match) => match.inputContent)).size <= 1, 'Opaque candidate content conflict: ' + key);
        assert(matches.every(({ inputContent }) => typeof inputContent === 'string' && inputContent === content), 'Unmapped opaque source content: ' + rawSource);
        const candidates = matches.map(({ input, sourceIndex, inputRaw, inputContent }) => ({ module: input.module, inputMap: input.map, sourceMappingURL: input.sourceMappingURL, sourceIndex, rawSource: inputRaw, content: { bytes: Buffer.byteLength(inputContent), sha256: hash(inputContent) } }));
        assert(candidates.length > 0, 'Unmapped opaque source: ' + rawSource);
        ledger.push({ ...common, classification: 'eligible identical candidate set; consumed candidate UNPROVEN; never physical upstream file; code/source relation and mapping coverage UNVALIDATED; runtime consumption UNPROVEN', descriptor: 'pdfjs-webpack-posix-space-v1', comparisonKey: key, candidates });
      } else {
        assert(!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawSource) && !/[\0\\]/.test(rawSource), 'Unsupported virtual map source.');
        assert(!map.sourceRoot || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(map.sourceRoot), 'Unsupported physical sourceRoot.');
        const file = await realpath(path.resolve(path.dirname(mapPath), map.sourceRoot ?? '', rawSource));
        assert(eligibleFiles.has(file), 'Map source not in eligible input graph: ' + file);
        const actual = await pin(file);
        if (inside(path.join(ownedRoot, 'packages/core'), file)) {
          if (content !== null) assert.deepEqual(Buffer.from(content, 'utf8'), await readFile(file), 'Copied map source content mismatch.');
        } else {
          assert.deepEqual(actual, toolFiles.get(file), 'Unpinned installed map source.');
          if (content !== null) assert.deepEqual(Buffer.from(content, 'utf8'), await readFile(file), 'Installed map source content mismatch.');
        }
        ledger.push({ ...common, classification: 'physical byte-pinned eligible input, not runtime execution; code/source relation and mapping coverage UNVALIDATED; runtime consumption UNPROVEN', input: actual });
      }
    }
    validated.set(item.path, { item, map: outputMapPin, rawMap: map, roots, sourceRelationships: ledger.slice(sourceStart) });
  }
  const helpers = new Map();
  const wrappers = [];
  for (const candidate of generated) {
    check(dependencies.deadlineAt);
    const { item, roots, body } = candidate;
    const source = parsed(item.path, body, 'Generated wrapper serialization refused: ' + item.path);
    const first = source.statements[0];
    const looksLikeHelper = first && dependencies.ts.isVariableStatement(first) && first.declarationList.declarations.some((declaration) => dependencies.ts.isIdentifier(declaration.name) && declaration.name.text === '__require');
    if (body !== GENERATED_REQUIRE_HELPER && !looksLikeHelper) { wrappers.push(candidate); continue; }
    assert.equal(body, GENERATED_REQUIRE_HELPER, 'Generated helper executable refused: ' + item.path);
    const context = await generatedSdk(item.path);
    const record = { output: item.path, outputPin: await pin(path.join(outputRoot, item.path), undefined, dependencies.deadlineAt), map: candidate.map, descriptor: 'esbuild0282-require-runtime-compatible-v1', eligibleEntries: [...roots].sort(), classification: 'compiler-template-compatible helper; application physical origin NONE; actual compiler/runtime/Vite consumption UNPROVEN; code/source relation and mapping coverage UNVALIDATED', ...GENERATED_RELATION_LIMITS, sdkContext: context };
    helpers.set(item.path, record);
    generatedOutputs.push(record);
  }
  for (const candidate of wrappers) {
    check(dependencies.deadlineAt);
    const { item, roots, body } = candidate;
    const ts = dependencies.ts;
    const serializationError = 'Generated wrapper serialization refused: ' + item.path;
    const bindingError = 'Generated wrapper target bindings refused: ' + item.path;
    const sourceError = 'Generated wrapper eligible source refused: ' + item.path;
    const source = parsed(item.path, body, serializationError);
    assert(source.statements.length === 2, serializationError);
    const [exported, imported] = source.statements;
    assert(ts.isExportDeclaration(exported) && !exported.isTypeOnly && exported.exportClause && ts.isNamedExports(exported.exportClause) && exported.moduleSpecifier && ts.isStringLiteral(exported.moduleSpecifier) && !exported.attributes, serializationError);
    assert(ts.isImportDeclaration(imported) && !imported.importClause && ts.isStringLiteral(imported.moduleSpecifier) && !imported.attributes, serializationError);
    const bindings = exported.exportClause.elements.map((element) => {
      assert(!element.isTypeOnly && !element.propertyName && ts.isIdentifier(element.name), serializationError);
      return element.name.text;
    });
    assert(bindings.length > 0 && new Set(bindings).size === bindings.length, serializationError);
    const sorted = [...bindings].sort();
    const targetSpecifier = exported.moduleSpecifier.text;
    const helperSpecifier = imported.moduleSpecifier.text;
    assert(targetSpecifier.startsWith('.') && helperSpecifier.startsWith('.'), serializationError);
    const targetName = path.posix.normalize(path.posix.join(path.posix.dirname(item.path), targetSpecifier));
    const helperName = path.posix.normalize(path.posix.join(path.posix.dirname(item.path), helperSpecifier));
    assert(targetName.startsWith(item.path.split('/')[0] + '/') && helperName.startsWith(item.path.split('/')[0] + '/') && names.has(targetName) && names.has(helperName), serializationError);
    assert.equal(body, "export { " + sorted.join(', ') + " } from '" + targetSpecifier + "';\nimport '" + helperSpecifier + "';", serializationError);
    const target = validated.get(targetName);
    const helper = helpers.get(helperName);
    assert(target && helper && targetName.endsWith('.js') && target.rawMap.sources.length === 1 && typeof target.rawMap.sourcesContent[0] === 'string' && target.sourceRelationships.length === 1, sourceError);
    const relationship = target.sourceRelationships[0];
    assert(relationship.input && inside(path.join(ownedRoot, 'packages/core'), relationship.input.path), sourceError);
    const logicalSource = path.relative(ownedRoot, relationship.input.path).split(path.sep).join('/');
    const expected = GENERATED_WRAPPER_BINDINGS.get(logicalSource);
    assert(expected, sourceError);
    const selectedInputs = sourceInputs.filter((input) => input.path === logicalSource);
    assert(selectedInputs.length === 1, sourceError);
    const input = selectedInputs[0];
    assert.deepEqual(await pin(path.join(originalRoot, logicalSource), logicalSource, dependencies.deadlineAt), input, sourceError);
    const copiedInput = await pin(relationship.input.path, relationship.input.path, dependencies.deadlineAt);
    assert.deepEqual(copiedInput, relationship.input, sourceError);
    assert(copiedInput.bytes === input.bytes && copiedInput.sha256 === input.sha256, sourceError);
    const inputBody = await phase(dependencies.deadlineAt, () => readFile(copiedInput.path, 'utf8'));
    assert.equal(inputBody, target.rawMap.sourcesContent[0], sourceError);
    assert.deepEqual([...roots].sort(), [...target.roots].sort(), sourceError);
    for (const root of roots) {
      assert(root === item.path.split('/')[0] + ':index' && helper.eligibleEntries.includes(root), sourceError);
      const config = specification.configurations.find((config) => config.platform === item.path.split('/')[0]);
      assert(config?.entries.some((entry) => entry.name === 'index'), sourceError);
      const graph = derived.graphs.filter((graph) => graph.platform + ':' + graph.entry === root);
      assert(graph.length === 1 && graph[0].files.includes(copiedInput.path), sourceError);
    }
    assert.deepEqual(sorted, expected, bindingError);
    assert.deepEqual(functionBindings(parsed(copiedInput.path, inputBody, bindingError), false, bindingError), expected, bindingError);
    assert.deepEqual(functionBindings(parsed(targetName, texts.get(targetName), bindingError), true, bindingError), expected, bindingError);
    await generatedSdk(item.path);
    generatedOutputs.push({ output: item.path, outputPin: await pin(path.join(outputRoot, item.path), undefined, dependencies.deadlineAt), map: candidate.map, descriptor: 'rollup4642-two-source-reexport-v1', eligibleEntries: [...roots].sort(), classification: 'linker-only output edge associated with an eligible byte-pinned map source; emitted-code/source relation and mapping coverage UNVALIDATED; runtime consumption UNPROVEN', ...GENERATED_RELATION_LIMITS, bindings: sorted, target: { output: targetName, outputPin: await pin(path.join(outputRoot, targetName), undefined, dependencies.deadlineAt), map: target.map, sourceRelationship: relationship }, helper: { output: helperName, outputPin: helper.outputPin, descriptor: helper.descriptor }, input, copiedInput });
  }
  generatedOutputs.sort((a, b) => a.output < b.output ? -1 : a.output > b.output ? 1 : 0);
  return { classification: 'Actual compiler-static output/input/map relationships only; runtime/Vite/global descendant consumption UNPROVEN; code/source relation and mapping coverage UNVALIDATED', outputEdges: [...edges].map(([output, imports]) => ({ output, imports })), sourceRelationships: ledger, generatedOutputs, pinnedButUnreferenced: [...toolFiles.values()].filter((item) => !ledger.some((record) => record.input?.path === item.path || record.candidates?.some((candidate) => candidate.module.path === item.path || candidate.inputMap.path === item.path))) };
}

async function currentDependencies(context) {
  const records = [];
  for (const directory of context.logicalDirectories) {
    const current = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const names = entry.name.startsWith('@') ? (await readdir(path.join(directory, entry.name))).map((name) => entry.name + '/' + name) : [entry.name];
      current.push(...names.map((name) => path.join(directory, name)));
    }
    const expected = context.links.filter((entry) => inside(directory, entry.originalLogical)).map((entry) => entry.originalLogical);
    assert.deepEqual(current.sort(), expected.sort(), 'Logical dependency directory set changed.');
  }
  for (const owner of context.owners.values()) {
    check(context.deadlineAt);
    const metadata = JSON.parse(await readFile(owner.packageJson.path, 'utf8'));
    const packageJson = await pin(owner.packageJson.path, owner.packageJson.path, context.deadlineAt);
    const toolPins = [];
    for (const tool of owner.toolPins) toolPins.push(await pin(tool.path, tool.path, context.deadlineAt));
    records.push({ packageRoot: owner.packageRoot, name: metadata.name, version: metadata.version, packageJson, toolPins: toolPins.sort(order) });
  }
  for (const link of context.links) {
    assert.equal(await realpath(link.originalLogical), link.canonical, 'Original dependency link changed.');
    if (link.originalLinkText !== null) assert.equal(await readlink(link.originalLogical), link.originalLinkText);
    assert.equal(await realpath(link.ownedLogical), link.canonical, 'Owned dependency link changed.');
  }
  for (const branch of context.nativeBranches) {
    assert.deepEqual(await pin(branch.selector.path), branch.selector, 'Native selector drift.');
    assert.deepEqual(await pin(branch.selected.path), branch.selected, 'Selected native/branch drift.');
    if (branch.local) {
      let present;
      try { assert((await lstat(branch.local)).isFile()); present = true; }
      catch (error) { if (!missing(error)) throw error; present = false; }
      assert.equal(present, branch.localPresent, 'Higher-precedence native branch changed.');
    }
  }
  return records.sort((a, b) => a.packageRoot < b.packageRoot ? -1 : a.packageRoot > b.packageRoot ? 1 : 0);
}
async function copyInputs(root, ownedRoot, sourceInputs, deadlineAt) {
  const copied = sourceInputs.filter((item) => !/^packages\/(exceljs|mammoth)\//.test(item.path));
  for (const item of copied) {
    check(deadlineAt);
    const target = path.join(ownedRoot, logical(item.path));
    assert(inside(ownedRoot, target));
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(path.join(root, item.path));
    assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256);
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return copied;
}
async function rehashCopy(ownedRoot, copied, deadlineAt) {
  const result = [];
  for (const item of copied) result.push(await pin(path.join(ownedRoot, item.path), item.path, deadlineAt));
  assert.deepEqual(result, copied, 'Copied input/config drift.');
}
async function prune(ownedRoot, deadlineAt) {
  const retained = new Set(['packages/core/tsup.config.ts', 'packages/core/package.json']);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      check(deadlineAt);
      const file = path.join(directory, entry.name);
      assert(inside(ownedRoot, file));
      const name = path.relative(ownedRoot, file).split(path.sep).join('/');
      if (retained.has(name)) { assert(entry.isFile()); continue; }
      if (entry.isDirectory()) { await walk(file); if (!(await readdir(file)).length) await rmdir(file); }
      else await rm(file);
    }
  }
  await walk(ownedRoot);
  const remaining = await inventory(ownedRoot, '', new Set(), deadlineAt);
  assert.deepEqual(remaining.map((item) => item.path), [...retained].sort());
}

async function remainingOwnedState(ownedRoot) {
  const records = [];
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(file, relative + '/');
      else if (entry.isSymbolicLink()) records.push({ path: relative, kind: 'owned-link-only', target: await readlink(file) });
      else if (entry.isFile()) records.push({ ...await pin(file, relative), kind: 'remaining-regular-file' });
      else records.push({ path: relative, kind: 'remaining-special-file' });
      assert(records.length <= 10000, 'Remaining-tree diagnostic budget.');
    }
  }
  await walk(ownedRoot, '');
  return records.sort(order);
}
async function publishProof(runDirectory, proof, deadlineAt) {
  const bytes = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`);
  assert(bytes.length <= 10 * 1024 * 1024);
  const candidate = path.join(runDirectory, 'core-build-proof.candidate.json');
  const target = path.join(runDirectory, 'core-build-proof.json');
  let expected;
  let published = false;
  const state = { candidateClosed: false, published: false, late: false, ownDescriptorRemoved: false, cleanup: 'not-needed', transientVisibilityPossible: true };
  try {
    check(deadlineAt);
    await writeFile(candidate, bytes, { flag: 'wx' });
    state.candidateClosed = true;
    check(deadlineAt);
    expected = await phase(deadlineAt, () => lstat(candidate));
    assert(expected.isFile() && !expected.isSymbolicLink());
    assert.equal(await phase(deadlineAt, () => realpath(candidate)), candidate);
    assert.deepEqual(await phase(deadlineAt, () => readFile(candidate)), bytes);
    check(deadlineAt);
    await link(candidate, target);
    published = true; state.published = true;
    check(deadlineAt);
    const actual = await phase(deadlineAt, () => lstat(target));
    assert(actual.isFile() && !actual.isSymbolicLink() && actual.dev === expected.dev && actual.ino === expected.ino, 'Published descriptor identity differs.');
    assert.deepEqual(await phase(deadlineAt, () => readFile(target)), bytes);
    return { path: target, bytes: bytes.length, sha256: hash(bytes) };
  } catch (primary) {
    state.late = Date.now() >= deadlineAt;
    const cleanupErrors = [];
    if (published) {
      try {
        const actual = await lstat(target);
        assert(actual.isFile() && !actual.isSymbolicLink() && actual.dev === expected.dev && actual.ino === expected.ino, 'Refuse to unlink non-owned/replaced descriptor.');
        assert.equal(await realpath(target), target);
        assert.deepEqual(await readFile(target), bytes, 'Refuse to unlink changed descriptor bytes.');
        await rm(target);
        state.ownDescriptorRemoved = true; state.cleanup = 'own-regular-dev-ino-content-checked-unlink-settled';
      } catch (error) { cleanupErrors.push(error); state.cleanup = 'UNSETTLED_OR_NONOWNED_ROOT_DISCOVERY_HOLD'; }
    }
    try { await exclusive(path.join(runDirectory, 'core-build-publication-refusal.json'), { classification: 'REFUSED; a transient or unsettled file never qualifies without producer native EXIT0 and final guards', primary: errorRecord(primary), state, cleanupErrors: cleanupErrors.map(errorRecord) }); }
    catch (error) { cleanupErrors.push(error); }
    throw new AggregateError([primary, ...cleanupErrors], 'Stage A publication refused: ' + primary.message, { cause: primary });
  }
}

/** Private descriptor preparation/commit. Unit-owned fake compiler layouts are schema controls only. */
export async function createCoreBuildProof({ root, runId, deadlineAt }) {
  assert.equal(await realpath(root), root);
  assert(/^[A-Za-z0-9-]{1,100}$/.test(runId), 'Invalid run identifier.');
  assert(Number.isFinite(deadlineAt) && deadlineAt > Date.now() && deadlineAt - Date.now() <= 180000);
  const runRelative = `docs/catalog-artifacts/${runId}`;
  const artifacts = path.join(root, 'docs/catalog-artifacts');
  await phase(deadlineAt, () => mkdir(artifacts, { recursive: true }));
  assert.equal(await realpath(artifacts), artifacts, 'Artifact parent escapes source root.');
  const runDirectory = path.join(root, runRelative);
  await phase(deadlineAt, () => mkdir(runDirectory));
  const evidence = path.join(runDirectory, 'build-evidence');
  await mkdir(evidence);
  const ownedRoot = await realpath(await mkdtemp(path.join(evidence, 'owned-core-')));
  const cwd = path.join(ownedRoot, 'packages/core');
  const logPath = path.join(evidence, 'core-build.log');
  const diagnosticPath = path.join(evidence, 'core-build-failure.json');
  let sourceBefore;
  let guardBefore;
  let copied;
  let dependencies;
  let derived;
  let beforeDependencies;
  let specification;
  const producerBefore = await pin(await realpath(fileURLToPath(import.meta.url)));
  try {
    sourceBefore = await phase(deadlineAt, () => sourceInventory(root, deadlineAt));
    guardBefore = await phase(deadlineAt, () => protection(root, deadlineAt));
    copied = await phase(deadlineAt, () => copyInputs(root, ownedRoot, sourceBefore, deadlineAt));
    dependencies = await phase(deadlineAt, () => dependencyContext(root, ownedRoot, deadlineAt));
    specification = recipe(dependencies.ts, await readFile(path.join(cwd, 'tsup.config.ts')), await readFile(path.join(cwd, 'package.json')));
    derived = await phase(deadlineAt, () => deriveGraphs(root, ownedRoot, specification, dependencies, sourceBefore));
    beforeDependencies = await phase(deadlineAt, () => currentDependencies(dependencies));
    await rehashCopy(ownedRoot, copied, deadlineAt);
    await exclusive(path.join(evidence, 'input-before.json'), { sourceInputs: sourceBefore, copiedInputs: copied, originalProtection: guardBefore, dependencyIdentities: beforeDependencies, nativeBranches: dependencies.nativeBranches, producerImplementation: producerBefore });
    await exclusive(path.join(evidence, 'dependency-input-ledger.json'), { links: dependencies.links, resolutions: dependencies.resolutions, nativeBranches: dependencies.nativeBranches, graphInputs: derived.graphs, inputEdges: derived.resolutionEdges, boundary: 'Static/resolved context only; no syscall/runtime/Vite consumption claim.' });
  } catch (error) {
    try { await exclusive(diagnosticPath, { classification: 'Preparation refused; owned failed tree retained and potentially discoverable', primary: errorRecord(error) }); }
    catch (diagnosticFailure) { throw new AggregateError([error, diagnosticFailure], 'Stage A preparation refused; diagnostic persistence UNSETTLED/root discovery hold.', { cause: error }); }
    throw error;
  }
  const PATH = process.env.PATH;
  assert(typeof PATH === 'string' && PATH && Buffer.byteLength(PATH) <= 8192 && !/[\0\r\n]/.test(PATH), 'Unsupported PATH.');
  const environment = { NODE_ENV: 'production', CI: '1', TZ: 'UTC', LANG: 'C', LC_ALL: 'C', PATH, COREPACK_ENABLE_STRICT: '0' };
  const command = [await realpath(process.execPath), dependencies.tsupBin];
  let committed = false;
  async function commit(lifecycle) {
    assert(!committed, 'Proof session already committed.');
    check(deadlineAt);
    assert(executedLifecycles.has(lifecycle), 'Constructed/unexecuted lifecycle cannot commit.');
    assert.deepEqual(lifecycle, executedLifecycles.get(lifecycle), 'Lifecycle observation mutated.');
    assert.deepEqual(lifecycle.argv, command, 'Compiler argument binding.');
    assert.equal(lifecycle.cwd, cwd);
    assert.deepEqual(lifecycle.environment, environment);
    assert.equal(lifecycle.log.path, logPath);
    assert(lifecycle.log.bytes > 0);
    assert.deepEqual(await pin(logPath), lifecycle.log);
    assert.deepEqual(lifecycle.outcome, { exitCode: 0, signal: null, exitObserved: true, closeObserved: true, logWritersSettled: true });
    assert.equal(lifecycle.node.path, await realpath(process.execPath));
    assert.equal(lifecycle.node.version, process.version);
    assert.deepEqual(await pin(lifecycle.node.path), { path: lifecycle.node.path, bytes: lifecycle.node.bytes, sha256: lifecycle.node.sha256 });
    const afterInputs = await phase(deadlineAt, () => sourceInventory(root, deadlineAt));
    assert.deepEqual(afterInputs, sourceBefore, 'Original source/config input drift.');
    await phase(deadlineAt, () => rehashCopy(ownedRoot, copied, deadlineAt));
    const afterDependencies = await phase(deadlineAt, () => currentDependencies(dependencies));
    assert.deepEqual(afterDependencies, beforeDependencies, 'Installed entry/native/input-map/dependency drift.');
    assert.deepEqual(await phase(deadlineAt, () => protection(root, deadlineAt)), guardBefore, 'Original dist/cache mutation.');
    const freshOutputs = await phase(deadlineAt, () => inventory(path.join(cwd, 'dist'), '', new Set(), deadlineAt));
    assert(freshOutputs.length && freshOutputs.every((item) => /^(?:browser|node)\//.test(item.path)));
    for (const required of specification.required) assert(freshOutputs.some((item) => item.path === required && item.bytes > 0), 'Missing mandatory JS/map/declaration: ' + required);
    const relations = await phase(deadlineAt, () => mapRelationships(ownedRoot, freshOutputs, specification, dependencies, derived, sourceBefore));
    await exclusive(path.join(evidence, 'compiled-map-input-ledger.json'), relations);
    const archived = path.join(runDirectory, 'core-build-output');
    await phase(deadlineAt, () => mkdir(archived));
    for (const item of freshOutputs) {
      const bytes = await phase(deadlineAt, () => readFile(path.join(cwd, 'dist', item.path)));
      assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256);
      const target = path.join(archived, logical(item.path));
      await mkdir(path.dirname(target), { recursive: true });
      await phase(deadlineAt, () => writeFile(target, bytes, { flag: 'wx' }));
    }
    const outputs = await phase(deadlineAt, () => inventory(archived, '', new Set(), deadlineAt));
    assert.deepEqual(outputs, freshOutputs, 'Archive mismatch.');
    assert.deepEqual(await phase(deadlineAt, () => inventory(path.join(cwd, 'dist'), '', new Set(), deadlineAt)), freshOutputs, 'Fresh output drift during archive.');
    await phase(deadlineAt, () => rehashCopy(ownedRoot, copied, deadlineAt));
    const finalSource = await phase(deadlineAt, () => sourceInventory(root, deadlineAt));
    assert.deepEqual(finalSource, sourceBefore);
    assert.deepEqual(await phase(deadlineAt, () => currentDependencies(dependencies)), beforeDependencies);
    assert.deepEqual(await phase(deadlineAt, () => protection(root, deadlineAt)), guardBefore);
    assert.deepEqual(await phase(deadlineAt, () => pin(producerBefore.path, producerBefore.path, deadlineAt)), producerBefore, 'Producer implementation bytes changed.');
    const configPin = await pin(path.join(cwd, 'tsup.config.ts'), path.relative(root, path.join(cwd, 'tsup.config.ts')).split(path.sep).join('/'));
    assert.equal(configPin.sha256, sourceBefore.find((item) => item.path === 'packages/core/tsup.config.ts').sha256);
    const proof = {
      schemaVersion: 1, mode: 'owned-current-core-build-v1', runId, sourceRoot: root, ownedBuildRoot: ownedRoot,
      sourceInputs: sourceBefore, sourceInputsAfter: finalSource, dependencyIdentities: beforeDependencies,
      build: { argv: lifecycle.argv, cwd, node: lifecycle.node, environment, configPin, log: { ...lifecycle.log, path: path.relative(root, logPath).split(path.sep).join('/') }, outcome: lifecycle.outcome },
      outputRoot: 'core-build-output', outputs,
      packageManifest: sourceBefore.find((item) => item.path === 'packages/core/package.json'),
      sourcePathMapping: { originalPrefix: path.join(root, 'packages/core'), ownedPrefix: cwd, logicalPrefix: 'packages/core/' },
    };
    assert(Buffer.byteLength(JSON.stringify(proof)) <= 10 * 1024 * 1024, 'Proof exceeds reader byte limit.');
    await exclusive(path.join(evidence, 'build-observation.json'), { argv: lifecycle.argv, cwd, node: lifecycle.node, environment, details: lifecycle.details, originalProtectionBefore: guardBefore, originalProtectionAfter: await protection(root, deadlineAt), copiedInputAfter: copied, requiredMatrix: specification.required, producerImplementationBefore: producerBefore, producerImplementationAfter: await pin(producerBefore.path, producerBefore.path, deadlineAt), descendantClosure: 'UNPROVEN', declarationsSemanticCorrectness: 'UNPROVEN' });
    await phase(deadlineAt, () => prune(ownedRoot, deadlineAt));
    assert.deepEqual(await pin(path.join(cwd, 'tsup.config.ts'), configPin.path), configPin);
    const published = await publishProof(runDirectory, proof, deadlineAt);
    committed = true;
    return { proof, descriptor: { ...published, path: runRelative + '/core-build-proof.json' }, outputDirectory: archived };
  }
  return Object.freeze({ argv: Object.freeze(command), cwd, environment: Object.freeze(environment), logPath, diagnosticPath, ownedRoot, runDirectory, commit });
}

async function main(args) {
  assert(args.length === 2 && args[0] === '--run' && /^[A-Za-z0-9-]{1,100}$/.test(args[1]), 'Usage: node tools/catalog-core-build-proof.mjs --run <ASCII-run>');
  const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  assert.equal(await realpath(process.cwd()), root, 'Producer must run from its own canonical checkout root.');
  const deadlineAt = Date.now() + 180000;
  let session;
  try {
    session = await createCoreBuildProof({ root, runId: args[1], deadlineAt });
    const lifecycle = await runOwnedNode({ args: session.argv.slice(1), cwd: session.cwd, logPath: session.logPath, diagnosticPath: session.diagnosticPath, environment: session.environment, deadlineAt });
    const result = await session.commit(lifecycle);
    console.log(JSON.stringify({ descriptor: result.descriptor, outputs: result.proof.outputs.length, currentNode: result.proof.build.node.version, browserSourceQualification: 'HELD', midiWorkerAssociation: 'HELD' }));
  } catch (error) {
    if (session) {
      let remaining;
      try { remaining = { actualRemainingOwnedTree: await remainingOwnedState(session.ownedRoot), byteCompleteCopiedTreeAfterPruneFailure: 'NOT_CLAIMED' }; }
      catch (failure) { remaining = { stateCapture: 'UNSETTLED_ROOT_DISCOVERY_HOLD', error: errorRecord(failure) }; }
      try { await exclusive(path.join(session.runDirectory, 'core-build-refusal.json'), { classification: 'REFUSED; actual remaining tree plus completed archives/input ledger retained; potentially discoverable; root must wait for native EXIT0 and final guards before any consumer', primary: errorRecord(error), errors: error instanceof AggregateError ? error.errors.map(errorRecord) : [], remaining }); }
      catch (diagnosticFailure) { throw new AggregateError([error, diagnosticFailure], 'Stage A refused; diagnostic persistence UNSETTLED/root discovery hold.', { cause: error }); }
    }
    throw error;
  }
}

const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entry === await realpath(fileURLToPath(import.meta.url))) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ classification: 'REFUSED native nonzero; no consumer until root final guards', primary: errorRecord(error), errors: error instanceof AggregateError ? error.errors.map(errorRecord) : [] })); process.exitCode = 1; }
}
