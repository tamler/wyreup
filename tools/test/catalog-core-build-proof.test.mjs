import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile, lstat, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createCoreBuildProof, runOwnedNode } from '../catalog-core-build-proof.mjs';
import { readCoordinatedCoreProof } from '../../packages/web/test/productionBuildBindingObserver.mjs';

const execute = promisify(execFile);
const currentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const environment = { PATH: process.env.PATH, CI: '1' };
const producer = fileURLToPath(new URL('../catalog-core-build-proof.mjs', import.meta.url));
async function owned() { return realpath(await mkdtemp(path.join(os.tmpdir(), 'wyreup-core-proof-unit-'))); }
async function write(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
  if (/\.(?:js|cjs|mjs)$/.test(file)) await execute(await realpath(process.execPath), ['--check', file]);
}
async function metadata(file, value) { await write(file, JSON.stringify(value)); }
async function link(file, target) { await mkdir(path.dirname(file), { recursive: true }); await symlink(target, file, 'dir'); }
async function packageRoot(name, from) {
  const require = createRequire(from);
  let file;
  try { file = require.resolve(name + '/package.json'); }
  catch { file = require.resolve(name); }
  let directory = path.dirname(await realpath(file));
  while (!(await readFile(path.join(directory, 'package.json'), 'utf8').catch(() => '')).includes('"name"')) directory = path.dirname(directory);
  return directory;
}

// UNIT-ONLY authored package/source/output layouts. No tsup, Rollup/native, PDF.js or tool engine executes.
async function fixture({ localRollup = false, misleadingCoreRollup = false, adapter = false, opaque = false, opaqueCollision = false, encodedInput = false, literal = false, runtime = false, deadlineAt = Date.now() + 180000 } = {}) {
  const temporary = await owned();
  const root = path.join(temporary, 'source');
  await mkdir(root);
  const toolRoot = path.join(temporary, 'fixture-packages');
  const actualTsup = await packageRoot('tsup', path.join(currentRoot, 'packages/core/package.json'));
  const fakeTsup = path.join(toolRoot, 'tsup');
  const tsupMetadata = JSON.parse(await readFile(path.join(actualTsup, 'package.json')));
  await metadata(path.join(fakeTsup, 'package.json'), tsupMetadata);
  await write(path.join(fakeTsup, tsupMetadata.bin.tsup), 'console.log("UNIT_ONLY_NO_COMPILER_EXECUTION");\n');
  for (const name of ['esbuild', 'bundle-require', 'fix-dts-default-cjs-exports', 'typescript']) await link(path.join(fakeTsup, 'node_modules', name), await packageRoot(name, path.join(actualTsup, 'package.json')));
  const actualRollup = await packageRoot('rollup', path.join(actualTsup, 'package.json'));
  const fakeRollup = path.join(toolRoot, 'rollup');
  await metadata(path.join(fakeRollup, 'package.json'), JSON.parse(await readFile(path.join(actualRollup, 'package.json'))));
  await write(path.join(fakeRollup, 'dist/native.js'), await readFile(path.join(actualRollup, 'dist/native.js')));
  await write(path.join(fakeRollup, 'dist/rollup.js'), 'module.exports = {}; // UNIT_ONLY not loaded\n');
  if (localRollup) await write(path.join(fakeRollup, 'dist/rollup.darwin-arm64.node'), 'UNIT_ONLY_NATIVE_NOT_LOADED');
  await link(path.join(fakeRollup, 'node_modules/@rollup/rollup-darwin-arm64'), await packageRoot('@rollup/rollup-darwin-arm64', path.join(actualRollup, 'package.json')));
  await link(path.join(fakeTsup, 'node_modules/rollup'), fakeRollup);
  await link(path.join(root, 'node_modules/tsup'), fakeTsup);
  await link(path.join(root, 'node_modules/typescript'), await packageRoot('typescript', path.join(actualTsup, 'package.json')));
  await link(path.join(root, 'packages/core/node_modules/tsup'), fakeTsup);
  await link(path.join(root, 'packages/core/node_modules/typescript'), await packageRoot('typescript', path.join(actualTsup, 'package.json')));
  if (misleadingCoreRollup) await link(path.join(root, 'packages/core/node_modules/rollup'), actualRollup);
  await metadata(path.join(root, 'package.json'), { name: 'UNIT_ONLY_SCHEMA_SOURCE', pnpm: { patchedDependencies: {} } });
  await write(path.join(root, 'pnpm-lock.yaml'), 'UNIT_ONLY_NOT_AN_INSTALL_LOCK\n');
  await write(path.join(root, 'pnpm-workspace.yaml'), 'packages: [packages/*]\n');
  await write(path.join(root, 'tsconfig.base.json'), await readFile(path.join(currentRoot, 'tsconfig.base.json')));
  await write(path.join(root, 'packages/core/package.json'), await readFile(path.join(currentRoot, 'packages/core/package.json')));
  await write(path.join(root, 'packages/core/tsup.config.ts'), await readFile(path.join(currentRoot, 'packages/core/tsup.config.ts')));
  await write(path.join(root, 'packages/core/tsconfig.json'), await readFile(path.join(currentRoot, 'packages/core/tsconfig.json')));
  await write(path.join(root, 'packages/core/README.md'), 'UNIT_ONLY_SCHEMA_NOT_BUILD');
  for (const name of ['exceljs', 'mammoth']) {
    await metadata(path.join(root, `packages/${name}/package.json`), { name: '@wyreup/' + name, version: '0.0.0-unit-only' });
    for (const file of ['vendor/index.d.ts', 'UPSTREAM.json', 'NOTICE', 'README.md']) await write(path.join(root, `packages/${name}/${file}`), 'UNIT_ONLY_FIXED_INPUT');
  }
  const source = adapter ? "export { worker } from './utilities/file-job.js';\n" : opaque ? "import 'pdfjs-dist/legacy/build/pdf.mjs';\nexport const value = 1;\n" : literal ? "export const future = () => import('./literal.js');\n" : runtime ? 'export const future = (name) => import(name);\n' : 'export const value = 1;\n';
  await write(path.join(root, 'packages/core/src/index.ts'), source);
  // CURRENT45 adds six source inputs and seven entry/format output sets.
  await write(path.join(root, 'packages/core/src/execution.ts'), 'export const unitOnly = true;\n');
  for (const name of ['planning', 'building', 'hardware', 'finance', 'text-developer']) {
    await write(path.join(root, 'packages/core/src/utilities', name + '.ts'), 'export const unitOnly = true;\n');
  }
  if (literal) await write(path.join(root, 'packages/core/src/literal.ts'), 'export const literal = 123;\n');
  await write(path.join(root, 'packages/core/src/utilities/file-worker-browser.ts'), 'export const worker = 1;\n');
  await write(path.join(root, 'packages/core/src/utilities/file-worker-node.ts'), 'export const worker = 2;\n');
  await write(path.join(root, 'packages/core/src/utilities/bank-pdf-worker.ts'), opaque ? "import 'pdfjs-dist/legacy/build/pdf.worker.mjs';\n" : 'export const worker = 3;\n');
  if (adapter) {
    await write(path.join(root, 'packages/core/src/utilities/file-job.ts'), "export { worker } from './file-job-platform.js';\n");
    await write(path.join(root, 'packages/core/src/utilities/file-job-platform.ts'), 'export const worker = 4;\n');
    await write(path.join(root, 'packages/core/src/utilities/file-job-node.ts'), 'export const worker = 5;\n');
  }
  const fakePdf = path.join(toolRoot, 'pdfjs-dist');
  const content = 'UNIT_ONLY_OPAQUE_SOURCE_CONTENT';
  if (opaque) {
    await metadata(path.join(fakePdf, 'package.json'), { name: 'pdfjs-dist', version: '0.0.0-unit-only', main: 'legacy/build/pdf.mjs' });
    const patchContext = 'function neverCalled(intentState, reason) {\n        if (intentState.opListReadCapability) {\n          intentState.opListReadCapability.reject(reason);\n        }\n        if (intentState.operatorList) {}\n        if (intentState.displayReadyCapability) {} else if (!intentState.opListReadCapability) {\n          throw reason;\n        }\n}\n';
    for (const base of ['pdf.mjs', 'pdf.worker.mjs']) {
      await write(path.join(fakePdf, 'legacy/build', base), patchContext + `//# sourceMappingURL=${base}.map\n`);
      await metadata(path.join(fakePdf, 'legacy/build', base + '.map'), { version: 3, sourceRoot: '', sources: [encodedInput ? 'webpack://pdf.js/src/unit%20input.js' : ['same-content', 'different-content'].includes(opaqueCollision) && base === 'pdf.worker.mjs' ? 'webpack://pdf.js/src/unit input.js' : 'webpack://pdf.js/./src/unit input.js'], sourcesContent: [['different-content', 'same-raw-different-content'].includes(opaqueCollision) && base === 'pdf.worker.mjs' ? 'UNIT_ONLY_DISTINCT_COLLIDING_CONTENT' : content], names: [], mappings: '' });
    }
    await link(path.join(root, 'packages/core/node_modules/pdfjs-dist'), fakePdf);
  }
  const session = await createCoreBuildProof({ root, runId: 'UNIT-only', deadlineAt });
  await metadata(path.join(session.runDirectory, 'UNIT-ONLY.json'), { classification: 'Synthetic controlled source/compiler/output layouts; never genuine Stage A, vendor or browser proof' });
  return { temporary, root, session, fakeRollup, fakePdf, opaqueContent: content, cleanup: () => rm(temporary, { recursive: true }) };
}
async function outputFiles(value, { extras = false, wrongAdapter = false, dynamic = false, outputSpace = false, opaqueContent, literalSource = false, runtime = false } = {}) {
  const { session } = value;
  const variants = [['browser', ['index', 'execution', 'utility-planning', 'utility-building', 'utility-hardware', 'utility-finance', 'utility-text-developer', 'file-worker', 'bank-pdf-worker'], ['.js']], ['node', ['index', 'execution', 'file-worker'], ['.js', '.cjs']]];
  for (const [platform, entries, extensions] of variants) for (const name of entries) for (const extension of extensions) {
    const filename = `${platform}/${name}${extension}`;
    const file = path.join(session.cwd, 'dist', filename);
    let body = extension === '.cjs' ? 'exports.unitOnly = true;\n' : 'export const unitOnly = true;\n';
    if (runtime && name === 'index') body += 'const future = (name) => import(name);\n';
    if (dynamic && platform === 'browser' && name === 'index') body += "import('./UNIT-chunk.js');\n";
    if (dynamic && platform === 'browser' && name === 'bank-pdf-worker') body += "import('./UNIT-chunk.js');\n";
    await write(file, body + `//# sourceMappingURL=${name}${extension}.map\n`);
    const input = name === 'index' ? wrongAdapter && platform === 'node' ? 'src/utilities/file-job-platform.ts' : 'src/index.ts'
      : name === 'execution' ? 'src/execution.ts'
        : name.startsWith('utility-') ? 'src/utilities/' + name.slice('utility-'.length) + '.ts'
          : `src/utilities/${name === 'file-worker' ? 'file-worker-' + platform : 'bank-pdf-worker'}.ts`;
    const inputPath = path.join(session.cwd, input);
    await metadata(file + '.map', { version: 3, sources: [path.relative(path.dirname(file), inputPath).split(path.sep).join('/')], sourcesContent: [await readFile(inputPath, 'utf8')], names: [], mappings: '' });
    await write(path.join(session.cwd, 'dist', platform, name + (extension === '.cjs' ? '.d.cts' : '.d.ts')), 'export declare const unitOnly: boolean;\n');
  }
  if (extras || dynamic) {
    const file = path.join(session.cwd, 'dist/browser/UNIT-chunk.js');
    await write(file, 'export const unitOnlyChunk = 1;\n//# sourceMappingURL=UNIT-chunk.js.map\n');
    const source = dynamic && value.fakePdf && (await lstat(value.fakePdf).catch(() => null)) ? outputSpace ? 'webpack:/pdf.js/src/unit input.js' : 'webpack:/pdf.js/src/unit%20input.js' : literalSource ? '../../src/literal.ts' : '../../src/index.ts';
    await metadata(file + '.map', { version: 3, sources: [source], sourcesContent: [source.startsWith('webpack:') ? opaqueContent ?? value.opaqueContent : await readFile(path.join(session.cwd, literalSource ? 'src/literal.ts' : 'src/index.ts'), 'utf8')], names: [], mappings: '' });
    if (extras && !dynamic) {
      const file = path.join(session.cwd, 'dist/browser/index.js');
      await rm(file);
      await write(file, "export const unitOnly = true;\nexport { unitOnlyChunk } from './UNIT-chunk.js';\n//# sourceMappingURL=index.js.map\n");
    }
  }
}
async function completed(session) {
  return runOwnedNode({ args: session.argv.slice(1), cwd: session.cwd, logPath: session.logPath, diagnosticPath: session.diagnosticPath, environment: session.environment, deadlineAt: Date.now() + 10000 });
}
async function noProof(session) { await assert.rejects(lstat(path.join(session.runDirectory, 'core-build-proof.json')), { code: 'ENOENT' }); }
async function settledFixtureWrites(marker) {
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    if (await lstat(marker).catch(() => null)) return;
    await delay(30);
  }
  throw new Error('UNIT-ONLY finite fixture writes not observed settled; retain owned directory rather than removing it.');
}

test('UNIT-ONLY import guard and strict CLI create no run/compiler output', async () => {
  const directory = await owned();
  try {
    const code = `const before = process.exitCode; await import(${JSON.stringify(pathToFileURL(producer).href)}); if (before !== process.exitCode) throw Error('import exit drift'); console.log('UNIT_IMPORT_ONLY');`;
    const result = await execute(await realpath(process.execPath), ['--input-type=module', '-e', code], { cwd: directory, env: environment });
    assert.equal(result.stdout.trim(), 'UNIT_IMPORT_ONLY');
    assert.deepEqual(await readdir(directory), []);
    await assert.rejects(execute(await realpath(process.execPath), [producer, '--unknown', 'UNIT'], { cwd: directory, env: environment }), /Usage/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true }); }
});

test('UNIT-ONLY normal child captures both streams then EOF/close/finish/handle closure', async () => {
  const directory = await owned();
  try {
    const result = await runOwnedNode({ args: ['-e', 'process.stdout.write("UNIT_OUT"); process.stderr.write("UNIT_ERR");'], cwd: directory, logPath: path.join(directory, 'log'), diagnosticPath: path.join(directory, 'failure.json'), environment, deadlineAt: Date.now() + 10000 });
    const log = await readFile(result.log.path, 'utf8');
    assert(log.includes('UNIT_OUT') && log.includes('UNIT_ERR'));
    assert(result.details.stdoutEOF && result.details.stderrEOF && result.details.closeObserved && result.details.writerFinish && result.details.handleClosed);
    const events = result.details.events.map((entry) => entry.kind);
    assert(events.indexOf('child-close') < events.indexOf('writer-finish'));
    assert(events.indexOf('stdoutEOF') < events.indexOf('writer-finish'));
    assert(events.indexOf('stderrEOF') < events.indexOf('writer-finish'));
    assert(events.indexOf('writer-finish') < events.indexOf('handle-close'));
    assert.equal(result.details.sigtermCount, 0);
  } finally { await rm(directory, { recursive: true }); }
});

for (const refuses of [false, true]) test('UNIT-ONLY owned writer reference and handle settle before wrapper return: ' + (refuses ? 'nonzero refusal' : 'complete success'), async () => {
  const directory = await owned();
  let disposalSettled = false;
  try {
    const childScript = refuses ? 'process.stdout.write("UNIT_REFUSED_OUTPUT"); process.exitCode=7;' : 'process.stdout.write("UNIT_RELEASE_STDOUT"); process.stderr.write("UNIT_RELEASE_STDERR");';
    const logPath = path.join(directory, 'log'), diagnosticPath = path.join(directory, 'failure.json');
    const wrapper = `import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import {runOwnedNode} from ${JSON.stringify(pathToFileURL(producer).href)};
      let result, rejection;
      try {result=await runOwnedNode({args:['-e',${JSON.stringify(childScript)}],cwd:${JSON.stringify(directory)},logPath:${JSON.stringify(logPath)},diagnosticPath:${JSON.stringify(diagnosticPath)},environment:${JSON.stringify(environment)},deadlineAt:Date.now()+10000});}catch(error){rejection=error;}
      if (${JSON.stringify(refuses)}) {assert(rejection instanceof AggregateError);const disposal=JSON.parse(await readFile(${JSON.stringify(diagnosticPath + '.disposal.json')},'utf8'));console.log(JSON.stringify({refused:true,state:disposal.state,completeLog:disposal.completeLog,primary:disposal.primary}));}
      else {if(rejection)throw rejection;console.log(JSON.stringify({refused:false,state:result.details,outcome:result.outcome,log:await readFile(result.log.path,'utf8')}));}`;
    const native = await execute(await realpath(process.execPath), ['--input-type=module', '-e', wrapper], { cwd: directory, env: environment, timeout: 15000 });
    const facts = JSON.parse(native.stdout.trim());
    disposalSettled = facts.state.handleClosed === true && facts.state.stdoutClosed === true && facts.state.stderrClosed === true && facts.state.events.some((entry) => entry.kind === 'writer-close');
    assert.equal(facts.refused, refuses);
    assert.equal(facts.state.handleClosed, true);
    assert.equal(facts.state.stdoutClosed, true);
    assert.equal(facts.state.stderrClosed, true);
    const events = facts.state.events.map((entry) => entry.kind);
    assert(events.includes('writer-close'));
    assert(events.includes('handle-close'));
    assert(events.includes('writer-release-requested'));
    if (refuses) {
      assert.equal(facts.completeLog, false);
      assert.equal(facts.state.truncated, true);
      assert.match(facts.primary.message, /Owned Node child failed: 7\/null/);
      assert(facts.state.sigtermCount <= 1);
    } else {
      assert.equal(facts.state.writerFinish, true);
      assert.equal(facts.state.sigtermCount, 0);
      assert.equal(facts.outcome.logWritersSettled, true);
      assert(events.indexOf('writer-finish') < events.indexOf('writer-release-requested'));
      assert(events.indexOf('writer-finish') < events.indexOf('handle-close'));
      assert(facts.log.includes('UNIT_RELEASE_STDOUT') && facts.log.includes('UNIT_RELEASE_STDERR'));
      assert.equal(Buffer.byteLength(facts.log), Buffer.byteLength('UNIT_RELEASE_STDOUTUNIT_RELEASE_STDERR'));
      await assert.rejects(lstat(diagnosticPath), { code: 'ENOENT' });
    }
  } finally {
    if (disposalSettled) await rm(directory, { recursive: true });
    else process.stderr.write('UNIT-ONLY incomplete wrapper/writer disposal; retained owned tree: ' + directory + '\n');
  }
});

test('UNIT-ONLY inherited writer late marker prevents exit-only success', async () => {
  const directory = await owned();
  try {
    const descendant = 'setTimeout(() => { process.stdout.write("UNIT_LATE_MARKER"); }, 150);';
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:['ignore',process.stdout,process.stderr]}); process.exit(0);`;
    const result = await runOwnedNode({ args: ['-e', parent], cwd: directory, logPath: path.join(directory, 'log'), diagnosticPath: path.join(directory, 'failure.json'), environment, deadlineAt: Date.now() + 10000 });
    assert((await readFile(result.log.path, 'utf8')).includes('UNIT_LATE_MARKER'));
    const events = result.details.events.map((entry) => entry.kind);
    assert(events.indexOf('child-exit') < events.indexOf('stdoutEOF'));
    assert(result.details.handleClosed && result.details.writerFinish);
  } finally { await rm(directory, { recursive: true }); }
});

for (const script of ['process.exit(7);', 'process.kill(process.pid,"SIGTERM");']) test('UNIT-ONLY nonzero/signal child refuses successful outcome: ' + script, async () => {
  const directory = await owned();
  try {
    await assert.rejects(runOwnedNode({ args: ['-e', script], cwd: directory, logPath: path.join(directory, 'log'), diagnosticPath: path.join(directory, 'failure.json'), environment, deadlineAt: Date.now() + 10000 }), AggregateError);
    const disposed = JSON.parse(await readFile(path.join(directory, 'failure.json.disposal.json')));
    assert.equal(disposed.completeLog, false);
    assert.equal(disposed.state.truncated, true);
    assert.equal(disposed.state.handleClosed, true);
    assert(disposed.state.sigtermCount <= 1);
  } finally { await rm(directory, { recursive: true }); }
});

test('UNIT-ONLY inherited pipe exceeds refusal; only own IO closes while descendant self-exits', async () => {
  const directory = await owned();
  const selfExit = path.join(directory, 'descendant-self-exit');
  try {
    const descendant = `process.stdout.on('error',()=>{}); process.stderr.on('error',()=>{}); setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(selfExit)},'UNIT_SELF_EXIT');}, 6200);`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore',process.stdout,process.stderr]}); process.exit(0);`;
    await assert.rejects(runOwnedNode({ args: ['-e', parent], cwd: directory, logPath: path.join(directory, 'log'), diagnosticPath: path.join(directory, 'failure.json'), environment, deadlineAt: Date.now() + 10000 }), AggregateError);
    const disposal = JSON.parse(await readFile(path.join(directory, 'failure.json.disposal.json')));
    assert.equal(disposal.state.handleClosed, true);
    assert.equal(disposal.state.stdoutClosed, true);
    assert.equal(disposal.state.stderrClosed, true);
    assert.equal(disposal.state.truncated, true);
    assert.equal(disposal.state.sigtermCount, 0);
    assert.equal(disposal.completeLog, false);
    await assert.rejects(lstat(selfExit), { code: 'ENOENT' });
    for (let index = 0; index < 100 && !(await lstat(selfExit).catch(() => null)); index++) await delay(30);
    assert.equal(await readFile(selfExit, 'utf8'), 'UNIT_SELF_EXIT');
  } finally { await settledFixtureWrites(selfExit); await rm(directory, { recursive: true }); }
});

for (const hold of [80, 5200]) test('UNIT-ONLY expired transport finalization retains actual delayed handle disposal: ' + hold, async () => {
  const directory = await owned();
  const selfExit = path.join(directory, 'descendant-self-exit');
  try {
    const descendant = `process.stdout.on('error',()=>{}); process.stderr.on('error',()=>{}); setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(selfExit)},'UNIT_SELF_EXIT'),6200);`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore',process.stdout,process.stderr]}); process.exit(0);`;
    const wrapper = `import assert from 'node:assert/strict'; import {open,readFile} from 'node:fs/promises'; import {setTimeout as delay} from 'node:timers/promises'; import {runOwnedNode} from ${JSON.stringify(pathToFileURL(producer).href)};
const probe=await open(${JSON.stringify(path.join(directory, 'probe'))},'wx'); const prototype=Object.getPrototypeOf(probe); await probe.close(); const create=prototype.createWriteStream;
prototype.createWriteStream=function(options){const close=this.close.bind(this); this.close=async()=>{await delay(${hold});return close();};return create.call(this,options);};
try {await assert.rejects(runOwnedNode({args:['-e',${JSON.stringify(parent)}],cwd:${JSON.stringify(directory)},logPath:${JSON.stringify(path.join(directory, 'log'))},diagnosticPath:${JSON.stringify(path.join(directory, 'failure.json'))},environment:${JSON.stringify(environment)},deadlineAt:Date.now()+20000}),AggregateError);
const disposalPath=${JSON.stringify(path.join(directory, 'failure.json.disposal.json'))};
${hold > 5000 ? `let bytes; for(let i=0;i<100;i++){bytes=await readFile(disposalPath).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});if(bytes)break;await delay(100);} assert(bytes,'Actual late handle closure must retain its disposal record'); const disposal=JSON.parse(bytes);` : 'const disposal=JSON.parse(await readFile(disposalPath));'}
assert.equal(disposal.state.handleClosed,true); assert.equal(disposal.state.stdoutClosed,true); assert.equal(disposal.state.stderrClosed,true); assert.equal(disposal.state.sigtermCount,0); assert.equal(disposal.completeLog,false); assert.equal(disposal.descendantClosure,'UNPROVEN');
} finally {prototype.createWriteStream=create;}`;
    await execute(await realpath(process.execPath), ['--input-type=module', '-e', wrapper], { cwd: directory, env: environment, timeout: 25000 });
    await settledFixtureWrites(selfExit);
    assert.equal(await readFile(selfExit, 'utf8'), 'UNIT_SELF_EXIT');
  } finally { await settledFixtureWrites(selfExit); await rm(directory, { recursive: true }); }
});

test('UNIT-ONLY SIGTERM-handling direct child is unreferenced only after own IO; wrapper exits then child self-exits', async () => {
  const directory = await owned();
  const selfExit = path.join(directory, 'direct-self-exit');
  try {
    const direct = `process.on('SIGTERM',()=>{}); console.log('UNIT_READY'); setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(selfExit)},'UNIT_SELF_EXIT'),3000);`;
    const wrapper = `import {runOwnedNode} from ${JSON.stringify(pathToFileURL(producer).href)}; try {await runOwnedNode({args:['-e',${JSON.stringify(direct)}],cwd:${JSON.stringify(directory)},logPath:${JSON.stringify(path.join(directory, 'log'))},diagnosticPath:${JSON.stringify(path.join(directory, 'failure.json'))},environment:${JSON.stringify(environment)},deadlineAt:Date.now()+1000});throw Error('unexpected success');}catch(error){if(!(error instanceof AggregateError))throw error;process.exitCode=1;}`;
    await assert.rejects(execute(await realpath(process.execPath), ['--input-type=module', '-e', wrapper], { cwd: directory, env: environment, timeout: 2500 }), (error) => error.code === 1 && error.killed === false);
    const disposal = JSON.parse(await readFile(path.join(directory, 'failure.json.disposal.json')));
    assert.equal(disposal.state.handleClosed, true);
    assert.equal(disposal.state.stdoutClosed, true);
    assert.equal(disposal.state.stderrClosed, true);
    assert.equal(disposal.state.sigtermCount, 1);
    assert.equal(disposal.state.directHandleUnref, true);
    assert(Number.isInteger(disposal.state.liveDirectPidAtDisposal));
    await assert.rejects(lstat(selfExit), { code: 'ENOENT' });
    for (let index = 0; index < 120 && !(await lstat(selfExit).catch(() => null)); index++) await delay(30);
    assert.equal(await readFile(selfExit, 'utf8'), 'UNIT_SELF_EXIT');
  } finally { await settledFixtureWrites(selfExit); await rm(directory, { recursive: true }); }
});

test('UNIT-ONLY session derives owned argv/env/strict owners and reader-compatible full mixed-case schema', async () => {
  const value = await fixture();
  try {
    await outputFiles(value, { extras: true });
    const lifecycle = await completed(value.session);
    assert.equal(lifecycle.argv[0], await realpath(process.execPath));
    assert.equal(lifecycle.node.version, process.version);
    assert.equal(lifecycle.cwd, value.session.cwd);
    assert.deepEqual(Object.keys(lifecycle.environment).sort(), ['CI', 'COREPACK_ENABLE_STRICT', 'LANG', 'LC_ALL', 'NODE_ENV', 'PATH', 'TZ']);
    assert(!Object.hasOwn(lifecycle.environment, 'NODE_OPTIONS'));
    assert((await readFile(lifecycle.log.path, 'utf8')).includes('UNIT_ONLY_NO_COMPILER_EXECUTION'));
    const result = await value.session.commit(lifecycle);
    const parsed = await readCoordinatedCoreProof(value.root, 'UNIT-only');
    assert.deepEqual(parsed.proof, result.proof);
    assert.equal(result.proof.outputs.length, 47);
    assert(result.proof.outputs.some((item) => item.path === 'browser/UNIT-chunk.js.map'));
    assert(result.proof.sourceInputs.every((item, index, all) => !index || all[index - 1].path < item.path));
    const readme = result.proof.sourceInputs.findIndex((item) => item.path === 'packages/core/README.md');
    const manifest = result.proof.sourceInputs.findIndex((item) => item.path === 'packages/core/package.json');
    assert(readme >= 0 && manifest > readme);
    for (const owner of result.proof.dependencyIdentities) assert.deepEqual(Object.keys(owner).sort(), ['name', 'packageJson', 'packageRoot', 'toolPins', 'version']);
    assert.equal(result.proof.build.configPin.sha256, hash(await readFile(path.join(value.root, 'packages/core/tsup.config.ts'))));
    assert.equal(await readFile(path.join(value.session.ownedRoot, 'packages/core/package.json'), 'utf8'), await readFile(path.join(value.root, 'packages/core/package.json'), 'utf8'));
    assert.deepEqual(await readdir(value.session.cwd), ['package.json', 'tsup.config.ts']);
    await assert.rejects(lstat(path.join(value.session.ownedRoot, 'node_modules')), { code: 'ENOENT' });
    const target = await realpath(path.join(value.root, 'node_modules/typescript'));
    assert((await lstat(path.join(target, 'package.json'))).isFile());
    const archived = path.join(result.outputDirectory, 'browser/index.js');
    await writeFile(archived, '// UNIT_ONLY_ARCHIVE_DRIFT\n');
    await execute(await realpath(process.execPath), ['--check', archived]);
    await assert.rejects(readCoordinatedCoreProof(value.root, 'UNIT-only'), /complete archived output inventory/);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY a preexisting run is never reused or overwritten', async () => {
  const value = await fixture();
  try {
    await assert.rejects(createCoreBuildProof({ root: value.root, runId: 'UNIT-only', deadlineAt: Date.now() + 180000 }), { code: 'EEXIST' });
    assert.equal(JSON.parse(await readFile(path.join(value.session.runDirectory, 'UNIT-ONLY.json'))).classification, 'Synthetic controlled source/compiler/output layouts; never genuine Stage A, vendor or browser proof');
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY handcrafted, wrong command and mutated lifecycle observations cannot commit', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    const lifecycle = await completed(value.session);
    await assert.rejects(value.session.commit(structuredClone(lifecycle)), /Constructed\/unexecuted/);
    lifecycle.argv[0] = '/UNIT_ONLY_OTHER_EXECUTABLE';
    await assert.rejects(value.session.commit(lifecycle), /Lifecycle observation mutated/);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY exit0 with each of the CURRENT45 mandatory output members missing refuses', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    const lifecycle = await completed(value.session);
    assert.equal(lifecycle.outcome.exitCode, 0);
    const required = [
      'browser/bank-pdf-worker.js', 'browser/bank-pdf-worker.js.map', 'browser/bank-pdf-worker.d.ts',
      'browser/file-worker.js', 'browser/file-worker.js.map', 'browser/file-worker.d.ts',
      'browser/index.js', 'browser/index.js.map', 'browser/index.d.ts',
      'browser/execution.js', 'browser/execution.js.map', 'browser/execution.d.ts',
      'browser/utility-planning.js', 'browser/utility-planning.js.map', 'browser/utility-planning.d.ts',
      'browser/utility-building.js', 'browser/utility-building.js.map', 'browser/utility-building.d.ts',
      'browser/utility-hardware.js', 'browser/utility-hardware.js.map', 'browser/utility-hardware.d.ts',
      'browser/utility-finance.js', 'browser/utility-finance.js.map', 'browser/utility-finance.d.ts',
      'browser/utility-text-developer.js', 'browser/utility-text-developer.js.map', 'browser/utility-text-developer.d.ts',
      'node/file-worker.js', 'node/file-worker.js.map', 'node/file-worker.d.ts',
      'node/file-worker.cjs', 'node/file-worker.cjs.map', 'node/file-worker.d.cts',
      'node/index.js', 'node/index.js.map', 'node/index.d.ts',
      'node/index.cjs', 'node/index.cjs.map', 'node/index.d.cts',
      'node/execution.js', 'node/execution.js.map', 'node/execution.d.ts',
      'node/execution.cjs', 'node/execution.cjs.map', 'node/execution.d.cts',
    ];
    assert.equal(required.length, 45);
    assert.equal(new Set(required).size, 45);
    for (const missing of required) {
      const file = path.join(value.session.cwd, 'dist', missing);
      const original = await readFile(file);
      await rm(file);
      await assert.rejects(value.session.commit(lifecycle), /Missing mandatory JS\/map\/declaration/);
      await noProof(value.session);
      await write(file, original);
    }
  } finally { await value.cleanup(); }
});

for (const scope of ['original', 'copied', 'compiler-entry', 'native', 'input-map', 'original-dist', 'logical-package-set']) test('UNIT-ONLY actual guarded input mutation refuses: ' + scope, async () => {
  const value = await fixture({ localRollup: true, opaque: scope === 'input-map' });
  try {
    await outputFiles(value);
    const lifecycle = await completed(value.session);
    if (scope === 'original' || scope === 'copied') await writeFile(path.join(scope === 'original' ? value.root : value.session.ownedRoot, 'packages/core/tsup.config.ts'), '// UNIT_ONLY_CONFIG_DRIFT\n');
    else if (scope === 'compiler-entry') {
      await writeFile(value.session.argv[1], '// UNIT_ONLY_ENTRY_DRIFT\n');
      await execute(await realpath(process.execPath), ['--check', value.session.argv[1]]);
    } else if (scope === 'native') await writeFile(path.join(value.fakeRollup, 'dist/rollup.darwin-arm64.node'), 'UNIT_ONLY_NATIVE_DRIFT');
    else if (scope === 'input-map') await writeFile(path.join(value.fakePdf, 'legacy/build/pdf.mjs.map'), '{}');
    else if (scope === 'logical-package-set') await metadata(path.join(value.root, 'node_modules/UNIT-new-package/package.json'), { name: 'UNIT-new-package', version: '0.0.0-unit-only' });
    else await write(path.join(value.root, 'packages/core/dist/sentinel.txt'), 'UNIT_ONLY_ORIGINAL_DIST_MUTATION');
    await assert.rejects(value.session.commit(lifecycle), /drift|mutation|differs|dependency directory set changed/i);
    await noProof(value.session);
    assert((await lstat(path.join(value.session.cwd, 'src/index.ts'))).isFile());
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY actual parent Rollup selection chooses local file ahead of package and misleading core owner', async () => {
  const value = await fixture({ localRollup: true, misleadingCoreRollup: true });
  try {
    const ledger = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/dependency-input-ledger.json')));
    const selected = ledger.nativeBranches.find((branch) => branch.kind === 'rollup-local-first' && branch.local.startsWith(value.fakeRollup));
    assert.equal(selected.localPresent, true);
    assert.equal(selected.selected.path, path.join(value.fakeRollup, 'dist/rollup.darwin-arm64.node'));
    const rollupEdge = ledger.resolutions.find((edge) => edge.specifier === 'rollup' && edge.importer === path.join(path.dirname(path.dirname(value.session.argv[1])), 'package.json'));
    assert.equal(rollupEdge.packageRoot, value.fakeRollup);
    await outputFiles(value);
    const result = await value.session.commit(await completed(value.session));
    const owner = result.proof.dependencyIdentities.find((item) => item.packageRoot === value.fakeRollup);
    assert(owner.toolPins.some((item) => item.path === selected.selected.path && item.bytes === 'UNIT_ONLY_NATIVE_NOT_LOADED'.length));
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY absent local native selects actual package then higher-precedence introduction refuses', async () => {
  const value = await fixture();
  try {
    const ledger = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/dependency-input-ledger.json')));
    const selected = ledger.nativeBranches.find((branch) => branch.kind === 'rollup-local-first' && branch.local.startsWith(value.fakeRollup));
    assert.equal(selected.localPresent, false);
    assert(!selected.selected.path.startsWith(value.fakeRollup + '/dist/'));
    await outputFiles(value);
    const lifecycle = await completed(value.session);
    await write(path.join(value.fakeRollup, 'dist/rollup.darwin-arm64.node'), 'UNIT_ONLY_NEW_LOCAL_PRECEDENCE');
    await assert.rejects(value.session.commit(lifecycle), /Higher-precedence native branch changed/);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY actual Node redirect graph cannot borrow browser platform source', async () => {
  const value = await fixture({ adapter: true });
  try {
    const ledger = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/dependency-input-ledger.json')));
    const node = ledger.graphInputs.find((entry) => entry.platform === 'node' && entry.entry === 'index');
    const browser = ledger.graphInputs.find((entry) => entry.platform === 'browser' && entry.entry === 'index');
    assert(node.files.includes(path.join(value.session.cwd, 'src/utilities/file-job-node.ts')));
    assert(!node.files.includes(path.join(value.session.cwd, 'src/utilities/file-job-platform.ts')));
    assert(browser.files.includes(path.join(value.session.cwd, 'src/utilities/file-job-platform.ts')));
    await outputFiles(value, { wrongAdapter: true });
    await assert.rejects(value.session.commit(await completed(value.session)), /Map source not in eligible input graph/);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY input and output literal dynamic edges reach actual graph, nonliteral remains runtime context', async () => {
  const value = await fixture({ literal: true });
  try {
    await outputFiles(value, { dynamic: true, literalSource: true });
    const result = await value.session.commit(await completed(value.session));
    const input = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/dependency-input-ledger.json')));
    assert(input.inputEdges.some((edge) => edge.kind === 'literal-dynamic-import' && edge.specifier === './literal.js' && edge.resolved === path.join(value.session.cwd, 'src/literal.ts')));
    const compiled = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/compiled-map-input-ledger.json')));
    assert(compiled.outputEdges.some((edge) => edge.output === 'browser/index.js' && edge.imports.some((entry) => entry.kind === 'literal-dynamic-import' && entry.target === 'browser/UNIT-chunk.js')));
    assert(result.proof.outputs.some((entry) => entry.path === 'browser/UNIT-chunk.js'));
  } finally { await value.cleanup(); }
  const runtime = await fixture({ runtime: true });
  try {
    await outputFiles(runtime, { runtime: true });
    await runtime.session.commit(await completed(runtime.session));
    const input = JSON.parse(await readFile(path.join(runtime.session.runDirectory, 'build-evidence/dependency-input-ledger.json')));
    assert(input.graphInputs.some((entry) => entry.runtime.some((edge) => edge.kind === 'runtime-only-expression' && edge.expression === 'import(name)')));
  } finally { await runtime.cleanup(); }
});

test('UNIT-ONLY unaccountable emitted chunk and source content mismatch refuse', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    const extra = path.join(value.session.cwd, 'dist/browser/UNREACHED.js');
    await write(extra, 'export const unitOnly = true;\n//# sourceMappingURL=UNREACHED.js.map\n');
    await metadata(extra + '.map', { version: 3, sources: ['../../src/index.ts'], sourcesContent: ['wrong'], names: [], mappings: '' });
    const lifecycle = await completed(value.session);
    await assert.rejects(value.session.commit(lifecycle), /Unreferenced\/unmapped emitted output/);
    await rm(extra); await rm(extra + '.map');
    const map = path.join(value.session.cwd, 'dist/browser/index.js.map');
    const original = JSON.parse(await readFile(map)); original.sourcesContent[0] = 'UNIT_ONLY_WRONG_CONTENT';
    await writeFile(map, JSON.stringify(original));
    await assert.rejects(value.session.commit(lifecycle), /Copied map source content mismatch/);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY actual opaque map candidate set retains both raw origins without claiming consumed module', async () => {
  const value = await fixture({ opaque: true });
  try {
    await outputFiles(value, { dynamic: true });
    await value.session.commit(await completed(value.session));
    const ledger = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/compiled-map-input-ledger.json')));
    const relation = ledger.sourceRelationships.find((entry) => entry.output === 'browser/UNIT-chunk.js');
    assert.equal(relation.rawSource, 'webpack:/pdf.js/src/unit%20input.js');
    assert.equal(relation.descriptor, 'pdfjs-webpack-posix-space-v1');
    assert.equal(relation.candidates.length, 2);
    assert(relation.candidates.every((candidate) => candidate.rawSource === 'webpack://pdf.js/./src/unit input.js' && candidate.content.sha256 === hash(value.opaqueContent)));
    assert(relation.candidates.every((candidate) => candidate.module.path.startsWith(value.fakePdf) && candidate.inputMap.path.endsWith('.map')));
    assert(!Object.hasOwn(relation, 'consumedModule'));
    assert(relation.classification.includes('consumed candidate UNPROVEN'));
  } finally { await value.cleanup(); }
});

for (const collision of ['same-content', 'different-content']) test('UNIT-ONLY distinct opaque raw origins refuse normalized collision before content filtering: ' + collision, async () => {
  const value = await fixture({ opaque: true, opaqueCollision: collision });
  try {
    await outputFiles(value, { dynamic: true });
    await assert.rejects(value.session.commit(await completed(value.session)), /opaque comparison-key collision/i);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY identical opaque raw origins with conflicting eligible content refuse before filtering', async () => {
  const value = await fixture({ opaque: true, opaqueCollision: 'same-raw-different-content' });
  try {
    await outputFiles(value, { dynamic: true });
    await assert.rejects(value.session.commit(await completed(value.session)), /opaque candidate content conflict/i);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

for (const variant of ['encoded-input', 'output-space', 'wrong-content', 'unknown-origin', 'unexpected-escape']) test('UNIT-ONLY opaque source refusal uses production normalization/eligibility: ' + variant, async () => {
  const value = await fixture({ opaque: true, encodedInput: variant === 'encoded-input' });
  try {
    await outputFiles(value, { dynamic: true, outputSpace: variant === 'output-space', opaqueContent: variant === 'wrong-content' ? 'UNIT_ONLY_WRONG_OPAQUE_CONTENT' : undefined });
    if (variant === 'unknown-origin' || variant === 'unexpected-escape') {
      const file = path.join(value.session.cwd, 'dist/browser/UNIT-chunk.js.map');
      const map = JSON.parse(await readFile(file)); map.sources[0] = variant === 'unknown-origin' ? 'virtual:UNIT_ONLY_UNKNOWN' : 'webpack:/pdf.js/src/unit%2Finput.js';
      await writeFile(file, JSON.stringify(map));
    }
    await assert.rejects(value.session.commit(await completed(value.session)), /opaque|virtual/i);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY actual emitted literal dynamic edge cannot borrow Node namespace for browser', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    const file = path.join(value.session.cwd, 'dist/browser/index.js');
    await writeFile(file, "export const unitOnly = true;\nimport('../node/index.js');\n//# sourceMappingURL=index.js.map\n");
    await execute(await realpath(process.execPath), ['--check', file]);
    await assert.rejects(value.session.commit(await completed(value.session)), /Wrong\/unaccountable output namespace edge/);
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY proof cannot commit a pending child or a preexisting archive namespace', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    const pending = completed(value.session);
    await assert.rejects(value.session.commit(pending), /Constructed\/unexecuted/);
    const lifecycle = await pending;
    await mkdir(path.join(value.session.runDirectory, 'core-build-output'));
    await write(path.join(value.session.runDirectory, 'core-build-output/UNIT_OTHER_OWNER.txt'), 'UNIT_ONLY_OTHER_OWNER');
    await assert.rejects(value.session.commit(lifecycle), { code: 'EEXIST' });
    assert.equal(await readFile(path.join(value.session.runDirectory, 'core-build-output/UNIT_OTHER_OWNER.txt'), 'utf8'), 'UNIT_ONLY_OTHER_OWNER');
    await noProof(value.session);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY invalid safe environment refuses before child/log creation', async () => {
  const directory = await owned();
  try {
    await assert.rejects(runOwnedNode({ args: ['-e', 'console.log("must not run")'], cwd: directory, logPath: path.join(directory, 'log'), diagnosticPath: path.join(directory, 'failure.json'), environment: { NODE_OPTIONS: '--require UNIT_ONLY_FORBIDDEN' }, deadlineAt: Date.now() + 10000 }), { name: 'AssertionError' });
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true }); }
});

test('UNIT-ONLY permission failure during prune retains actual remainder plus full archived outputs', async () => {
  assert.notEqual(process.getuid?.(), 0, 'Permission control requires a non-root unit lane; no silent skip.');
  const value = await fixture();
  const source = path.join(value.session.cwd, 'src');
  try {
    await outputFiles(value);
    const lifecycle = await completed(value.session);
    await chmod(source, 0o500);
    await assert.rejects(value.session.commit(lifecycle), /EACCES|EPERM/);
    assert((await lstat(path.join(value.session.runDirectory, 'core-build-output/node/index.cjs'))).isFile());
    assert((await lstat(path.join(value.session.runDirectory, 'build-evidence/input-before.json'))).isFile());
    assert((await lstat(path.join(source, 'index.ts'))).isFile());
    await noProof(value.session);
  } finally { await chmod(source, 0o700); await value.cleanup(); }
});

for (const replace of [false, true]) test('UNIT-ONLY actual publication event with controlled late clock preserves identity/cleanup refusal: replaced=' + replace, async () => {
  const deadlineAt = Date.now() + 180000;
  const value = await fixture({ deadlineAt });
  const originalNow = Date.now;
  let observed = false;
  try {
    await outputFiles(value);
    const lifecycle = await completed(value.session);
    const target = path.join(value.session.runDirectory, 'core-build-proof.json');
    Date.now = () => {
      if (!observed && existsSync(target)) {
        observed = true;
        if (replace) { unlinkSync(target); writeFileSync(target, 'UNIT_ONLY_REPLACEMENT_OTHER_OWNER', { flag: 'wx' }); }
      }
      return observed ? deadlineAt + 1 : originalNow();
    };
    await assert.rejects(value.session.commit(lifecycle), /publication refused/);
    assert.equal(observed, true, 'Actual owned filesystem publication must have been observed; no simulated successful native build.');
    const refusal = JSON.parse(await readFile(path.join(value.session.runDirectory, 'core-build-publication-refusal.json')));
    assert.equal(refusal.state.published, true);
    assert.equal(refusal.state.late, true);
    assert.equal(refusal.state.transientVisibilityPossible, true);
    if (replace) {
      assert.equal(refusal.state.ownDescriptorRemoved, false);
      assert.equal(refusal.state.cleanup, 'UNSETTLED_OR_NONOWNED_ROOT_DISCOVERY_HOLD');
      assert.equal(await readFile(target, 'utf8'), 'UNIT_ONLY_REPLACEMENT_OTHER_OWNER');
      assert(refusal.cleanupErrors.some((error) => /non-owned\/replaced/.test(error.message)));
    } else {
      assert.equal(refusal.state.ownDescriptorRemoved, true);
      assert.equal(refusal.state.cleanup, 'own-regular-dev-ino-content-checked-unlink-settled');
      await assert.rejects(lstat(target), { code: 'ENOENT' });
    }
  } finally { Date.now = originalNow; await value.cleanup(); }
});

// PLAN4 UNIT-ONLY generated-map controls. Authored outputs are never compiler/runtime proof.
const plan4HelperLiteral = "var __require = /* @__PURE__ */ ((x) => typeof require !== \"undefined\" ? require : typeof Proxy !== \"undefined\" ? new Proxy(x, {\n  get: (a, b) => (typeof require !== \"undefined\" ? require : a)[b]\n}) : x)(function(x) {\n  if (typeof require !== \"undefined\") return require.apply(this, arguments);\n  throw Error('Dynamic require of \"' + x + '\" is not supported');\n});\n\nexport { __require };";
const plan4NativePin = { bytes: 10590882, sha256: '10b6243df618d374bb2d5c9cfbe7052e1405f6aa4e53a6164f11a91b9f2e1384' };
const plan4ModuleCases = [
  { logical: 'packages/core/src/lib/excel.ts', wrapper: 'A-excel.js', target: 'Z-excel-target.js', names: ['addAOAToSheet', 'addObjectsToSheet', 'addWorksheet', 'getSheet', 'newWorkbook', 'readWorkbook', 'sheetNames', 'sheetToAOA', 'sheetToCsv', 'sheetToObjects', 'writeWorkbookBuffer'], bytes: 8969, sha256: '6e21c24048e5b0510dc3658ee2bafe5ac5899db84f7f5c5aa3039e011205004d' },
  { logical: 'packages/core/src/lib/pdf-ranges.ts', wrapper: 'B-ranges.js', target: 'Z-range-target.js', names: ['parseRangeSpec'], bytes: 1995, sha256: 'cbf1d1aa1058163747c217b3c332d3a2063cbba5eda93401c2186ce524860161' },
];
function plan4Footer(name) { return '\n//# sourceMappingURL=' + name + '.map\n//# sourceMappingURL=' + name + '.map'; }
function plan4Map(name) { return '{"version":3,"sources":[],"names":[],"mappings":"","file":' + JSON.stringify(name) + '}'; }
async function plan4Pin(file, displayPath = file) {
  const bytes = await readFile(file);
  return { path: displayPath, bytes: bytes.length, sha256: hash(bytes) };
}
async function plan4WriteJs(file, body) {
  assert(/\.(?:js|cjs|mjs)$/.test(file));
  // Existing write() immediately awaits Node --check for every JavaScript path.
  await write(file, body);
}
async function plan4ReplaceJs(file, body, malformed = false) {
  await writeFile(file, body);
  const pending = execute(await realpath(process.execPath), ['--check', file]);
  if (malformed) await assert.rejects(pending, (error) => error.code === 1);
  else await pending;
}
async function plan4NoPublishedArtifacts(session) {
  for (const name of ['core-build-proof.json', 'core-build-output', 'build-evidence/compiled-map-input-ledger.json']) await assert.rejects(lstat(path.join(session.runDirectory, name)), { code: 'ENOENT' });
}
async function plan4Refuses(value, lifecycle, expected) {
  await assert.rejects(value.session.commit(lifecycle), expected instanceof RegExp ? (error) => {
    assert(error instanceof Error);
    assert.match(error.message, expected);
    return true;
  } : expected);
  await plan4NoPublishedArtifacts(value.session);
}
async function plan4FreshWrongNativeScaffold(base) {
  const root = path.join(base.temporary, 'fresh-source');
  await mkdir(root);
  assert.equal(await realpath(root), root);
  async function copyOwnInput(relative) {
    const input = path.join(base.root, relative);
    const entry = await lstat(input);
    if (entry.isDirectory()) {
      for (const name of await readdir(input)) await copyOwnInput(path.join(relative, name));
    } else {
      assert(entry.isFile(), 'UNIT_ONLY scaffold input must be an owned regular file');
      await write(path.join(root, relative), await readFile(input));
    }
  }
  for (const relative of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'packages/core/package.json', 'packages/core/tsup.config.ts', 'packages/core/tsconfig.json', 'packages/core/README.md', 'packages/core/src', 'packages/exceljs', 'packages/mammoth']) await copyOwnInput(relative);
  const actualTsup = await packageRoot('tsup', path.join(currentRoot, 'packages/core/package.json'));
  const actualEsbuild = await packageRoot('esbuild', path.join(actualTsup, 'package.json'));
  const actualNative = await packageRoot('@esbuild/darwin-arm64', path.join(actualEsbuild, 'package.json'));
  const fakeTsup = path.join(base.temporary, 'fixture-packages/fresh-tsup');
  const fakeEsbuild = path.join(base.temporary, 'fixture-packages/fresh-direct-esbuild');
  const fakeNative = path.join(base.temporary, 'fixture-packages/fresh-direct-esbuild-native');
  const tsupMetadata = JSON.parse(await readFile(path.join(actualTsup, 'package.json')));
  await metadata(path.join(fakeTsup, 'package.json'), tsupMetadata);
  await plan4WriteJs(path.join(fakeTsup, tsupMetadata.bin.tsup), 'console.log("UNIT_ONLY_NO_COMPILER_EXECUTION");\n');
  await metadata(path.join(fakeEsbuild, 'package.json'), JSON.parse(await readFile(path.join(actualEsbuild, 'package.json'))));
  await plan4WriteJs(path.join(fakeEsbuild, 'lib/main.js'), await readFile(path.join(actualEsbuild, 'lib/main.js')));
  await metadata(path.join(fakeNative, 'package.json'), JSON.parse(await readFile(path.join(actualNative, 'package.json'))));
  await write(path.join(fakeNative, 'bin/esbuild'), 'UNIT_ONLY_WRONG_NATIVE_NOT_EXECUTED');
  await link(path.join(fakeEsbuild, 'node_modules/@esbuild/darwin-arm64'), fakeNative);
  await link(path.join(fakeTsup, 'node_modules/esbuild'), fakeEsbuild);
  for (const name of ['bundle-require', 'fix-dts-default-cjs-exports', 'typescript']) await link(path.join(fakeTsup, 'node_modules', name), await packageRoot(name, path.join(actualTsup, 'package.json')));
  await link(path.join(fakeTsup, 'node_modules/rollup'), base.fakeRollup);
  for (const relative of ['node_modules', 'packages/core/node_modules']) {
    await link(path.join(root, relative, 'tsup'), fakeTsup);
    await link(path.join(root, relative, 'typescript'), await packageRoot('typescript', path.join(actualTsup, 'package.json')));
  }
  return { ...base, root, freshTsup: fakeTsup, directEsbuild: fakeEsbuild, directNative: fakeNative, alternateNative: actualNative };
}
async function plan4Fixture({ sdk = 'valid', opaque = false } = {}) {
  // The existing fixture/session is an untouched scaffold. It is never executed or committed.
  let base = await fixture({ opaque });
  try {
    if (sdk === 'wrong-esbuild-native') base = await plan4FreshWrongNativeScaffold(base);
    const actualTsup = await packageRoot('tsup', path.join(currentRoot, 'packages/core/package.json'));
    const fakeTsup = await packageRoot('tsup', path.join(base.root, 'packages/core/package.json'));
    const actualRollup = await packageRoot('rollup', path.join(actualTsup, 'package.json'));
    await plan4WriteJs(path.join(fakeTsup, 'dist/index.js'), await readFile(path.join(actualTsup, 'dist/index.js')));
    if (sdk !== 'missing-rollup') {
      const bytes = sdk === 'altered-rollup' ? 'module.exports = {}; // UNIT_ONLY wrong direct owner bytes\n' : await readFile(path.join(actualRollup, 'dist/shared/rollup.js'));
      await plan4WriteJs(path.join(base.fakeRollup, 'dist/shared/rollup.js'), bytes);
    }
    for (const module of plan4ModuleCases) {
      const bytes = await readFile(path.join(currentRoot, module.logical));
      assert.equal(bytes.length, module.bytes);
      assert.equal(hash(bytes), module.sha256);
      await write(path.join(base.root, module.logical), bytes);
    }
    await writeFile(path.join(base.root, 'packages/core/src/index.ts'), (opaque ? "import 'pdfjs-dist/legacy/build/pdf.mjs';\n" : '') + "export * from './lib/excel.js';\nexport * from './lib/pdf-ranges.js';\n");
    const session = await createCoreBuildProof({ root: base.root, runId: 'UNIT-generated-plan4', deadlineAt: Date.now() + 180000 });
    const context = JSON.parse(await readFile(path.join(session.runDirectory, 'build-evidence/dependency-input-ledger.json')));
    const before = JSON.parse(await readFile(path.join(session.runDirectory, 'build-evidence/input-before.json')));
    const tsupResolution = context.resolutions.find((edge) => edge.importer === path.join(base.root, 'packages/core/package.json') && edge.specifier === 'tsup');
    assert.equal(tsupResolution.packageRoot, fakeTsup);
    const esbuildResolution = context.resolutions.find((edge) => edge.importer === path.join(fakeTsup, 'package.json') && edge.specifier === 'esbuild');
    const rollupResolution = context.resolutions.find((edge) => edge.importer === path.join(fakeTsup, 'package.json') && edge.specifier === 'rollup');
    assert.equal(rollupResolution.packageRoot, base.fakeRollup);
    const esbuildNativeBranch = context.nativeBranches.find((branch) => branch.selector.path === path.join(esbuildResolution.packageRoot, 'lib/main.js'));
    const rollupNativeBranch = context.nativeBranches.find((branch) => branch.selector.path === path.join(rollupResolution.packageRoot, 'dist/native.js'));
    assert(esbuildNativeBranch && rollupNativeBranch);
    return { ...base, session, context, before, sdkExpected: { tsupResolution, esbuildResolution, rollupResolution, esbuildNativeBranch, rollupNativeBranch } };
  } catch (error) { await base.cleanup(); throw error; }
}
async function plan4Outputs(value) {
  await outputFiles(value);
  for (const platform of ['browser', 'node']) {
    const directory = path.join(value.session.cwd, 'dist', platform);
    const index = path.join(directory, 'index.js');
    await plan4ReplaceJs(index, "export const unitOnly = true;\nimport './A-excel.js';\nimport './B-ranges.js';\n//# sourceMappingURL=index.js.map\n");
    const helper = path.join(directory, 'Z-runtime.js');
    await plan4WriteJs(helper, plan4HelperLiteral + plan4Footer('Z-runtime.js'));
    await write(helper + '.map', plan4Map('Z-runtime.js'));
    for (const module of plan4ModuleCases) {
      const target = path.join(directory, module.target);
      const source = path.join(value.session.ownedRoot, module.logical);
      const declarations = module.names.map((name) => "function " + name + "() { return 'UNIT_ONLY_BINDING_SET_NOT_TRANSPILE_FIDELITY'; }").join('\n');
      await plan4WriteJs(target, declarations + '\nexport { ' + module.names.join(', ') + ' };\n//# sourceMappingURL=' + module.target + '.map\n');
      await metadata(target + '.map', { version: 3, sources: [path.relative(directory, source).split(path.sep).join('/')], sourcesContent: [await readFile(source, 'utf8')], names: [], mappings: '' });
      const wrapper = path.join(directory, module.wrapper);
      await plan4WriteJs(wrapper, "export { " + module.names.join(', ') + " } from './" + module.target + "';\nimport './Z-runtime.js';" + plan4Footer(module.wrapper));
      await write(wrapper + '.map', plan4Map(module.wrapper));
    }
  }
}
function plan4FalseFlags(record) {
  assert.equal(record.codeSourceRelationValidated, false);
  assert.equal(record.mappingCoverageValidated, false);
  assert.equal(record.runtimeConsumptionValidated, false);
}
function plan4Owner(before, resolution) {
  const result = before.dependencyIdentities.find((owner) => owner.packageRoot === resolution.packageRoot);
  assert(result);
  return result;
}
test('UNIT-ONLY PLAN4 closes actual empty-sourcesContent unknown-executable admission', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    await plan4ReplaceJs(path.join(value.session.cwd, 'dist/browser/index.js'), 'globalThis.UNIT_ONLY_UNACCOUNTED_CALL?.();\n//# sourceMappingURL=index.js.map\n');
    await writeFile(path.join(value.session.cwd, 'dist/browser/index.js.map'), '{"version":3,"sources":[],"sourcesContent":[],"names":[],"mappings":"","file":"index.js"}');
    await plan4Refuses(value, await completed(value.session), /^Zero-source map shape refused: browser\/index\.js/);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 generated helper and both wrappers bind exact private identities in both namespaces', async () => {
  const value = await plan4Fixture();
  try {
    await plan4Outputs(value);
    const expectedPins = new Map();
    for (const platform of ['browser', 'node']) for (const name of ['Z-runtime.js', ...plan4ModuleCases.flatMap((module) => [module.wrapper, module.target])]) {
      const relative = platform + '/' + name;
      expectedPins.set(relative, await plan4Pin(path.join(value.session.cwd, 'dist', relative), path.join(value.session.ownedRoot, 'packages/core/dist', relative)));
      expectedPins.set(relative + '.map', await plan4Pin(path.join(value.session.cwd, 'dist', relative + '.map')));
    }
    const committed = await value.session.commit(await completed(value.session));
    const ledger = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/compiled-map-input-ledger.json')));
    assert.equal(ledger.generatedOutputs.length, 6);
    assert.deepEqual(ledger.generatedOutputs.map((record) => record.output), ['browser/A-excel.js', 'browser/B-ranges.js', 'browser/Z-runtime.js', 'node/A-excel.js', 'node/B-ranges.js', 'node/Z-runtime.js']);
    for (const record of [...ledger.generatedOutputs, ...ledger.sourceRelationships]) {
      plan4FalseFlags(record);
      assert.match(record.classification, /UNVALIDATED|not validated/i);
    }
    for (const platform of ['browser', 'node']) {
      const helper = ledger.generatedOutputs.find((record) => record.output === platform + '/Z-runtime.js');
      assert.equal(helper.descriptor, 'esbuild0282-require-runtime-compatible-v1');
      assert.deepEqual(helper.outputPin, expectedPins.get(helper.output));
      assert.deepEqual(helper.map, expectedPins.get(helper.output + '.map'));
      assert.deepEqual(helper.eligibleEntries, [platform + ':index']);
      assert(!Object.hasOwn(helper, 'sourceIndex'));
      assert(!Object.hasOwn(helper, 'input'));
      for (const name of ['tsupResolution', 'esbuildResolution', 'rollupResolution', 'esbuildNativeBranch', 'rollupNativeBranch']) assert.deepEqual(helper.sdkContext[name], value.sdkExpected[name]);
      assert.deepEqual(helper.sdkContext.nativeTemplateSpan, { binary: value.sdkExpected.esbuildNativeBranch.selected, offset: 5084656, bytes: 397, sha256: 'ba66a6b3c94727a332f4323bcbc2d9a12e017bfacc0f0029d3bfb5b381a10d3b' });
      assert.equal(helper.sdkContext.nativeTemplateSpan.binary.bytes, plan4NativePin.bytes);
      assert.equal(helper.sdkContext.nativeTemplateSpan.binary.sha256, plan4NativePin.sha256);
      const tsup = plan4Owner(value.before, value.sdkExpected.tsupResolution);
      const rollup = plan4Owner(value.before, value.sdkExpected.rollupResolution);
      const required = [
        tsup.toolPins.find((pin) => pin.path === path.join(tsup.packageRoot, 'dist/index.js')),
        rollup.toolPins.find((pin) => pin.path === path.join(rollup.packageRoot, 'dist/shared/rollup.js')),
        value.sdkExpected.esbuildNativeBranch.selected,
      ];
      assert(required.every(Boolean));
      assert.equal(required[0].bytes, 59220); assert.equal(required[0].sha256, '8d68123d7e85aab57156133f122dfe83a254ecd506eed26d63c50e8cff8c5cd2');
      assert.equal(required[1].bytes, 982863); assert.equal(required[1].sha256, '9a7e2371483d8f2b6ddd38efb694cf95dde77382d5c73789e54f8011cbda9b88');
      for (const pin of required) {
        assert(helper.sdkContext.requiredToolPins.some((actual) => actual.path === pin.path && actual.bytes === pin.bytes && actual.sha256 === pin.sha256));
        assert(ledger.pinnedButUnreferenced.some((actual) => actual.path === pin.path && actual.bytes === pin.bytes && actual.sha256 === pin.sha256));
        assert(!ledger.sourceRelationships.some((source) => source.input?.path === pin.path || source.candidates?.some((candidate) => candidate.module.path === pin.path || candidate.inputMap.path === pin.path)));
      }
      for (const module of plan4ModuleCases) {
        const record = ledger.generatedOutputs.find((entry) => entry.output === platform + '/' + module.wrapper);
        const target = platform + '/' + module.target;
        const relation = ledger.sourceRelationships.find((entry) => entry.output === target);
        assert.equal(record.descriptor, 'rollup4642-two-source-reexport-v1');
        assert.deepEqual(record.outputPin, expectedPins.get(record.output));
        assert.deepEqual(record.map, expectedPins.get(record.output + '.map'));
        assert.deepEqual(record.eligibleEntries, [platform + ':index']);
        assert.deepEqual(record.bindings, module.names);
        assert.deepEqual(record.target, { output: target, outputPin: expectedPins.get(target), map: expectedPins.get(target + '.map'), sourceRelationship: relation });
        assert.deepEqual(record.helper, { output: helper.output, outputPin: helper.outputPin, descriptor: helper.descriptor });
        assert.deepEqual(record.input, value.before.sourceInputs.find((pin) => pin.path === module.logical));
        assert.deepEqual(record.copiedInput, relation.input);
        assert.equal(record.copiedInput.path, path.join(value.session.ownedRoot, module.logical));
        assert.equal(record.copiedInput.bytes, module.bytes);
        assert.equal(record.copiedInput.sha256, module.sha256);
        assert(!Object.hasOwn(record, 'sourceIndex'));
        assert.equal(relation.sourceIndex, 0);
      }
    }
    const reopened = await readCoordinatedCoreProof(value.root, 'UNIT-generated-plan4');
    assert.deepEqual(reopened.proof, committed.proof);
    assert.equal(committed.proof.outputs.length, 65);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 normal physical and opaque relationship predicates retain honest false flags', async () => {
  const value = await fixture({ opaque: true });
  try {
    await outputFiles(value, { dynamic: true });
    await value.session.commit(await completed(value.session));
    const ledger = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/compiled-map-input-ledger.json')));
    assert(ledger.sourceRelationships.some((record) => record.input));
    assert(ledger.sourceRelationships.some((record) => record.candidates));
    for (const record of ledger.sourceRelationships) plan4FalseFlags(record);
    const opaque = ledger.sourceRelationships.find((record) => record.candidates);
    assert.equal(opaque.candidates.length, 2);
    assert.match(opaque.classification, /consumed candidate UNPROVEN/);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 raw zero-map duplicates padding order BOM and extra fields refuse before publication', async () => {
  const value = await plan4Fixture();
  try {
    await plan4Outputs(value);
    const map = path.join(value.session.cwd, 'dist/browser/Z-runtime.js.map');
    const canonical = plan4Map('Z-runtime.js');
    const variants = [
      '{"version":3,"sources":["unaccounted"],"sources":[],"names":[],"mappings":"","file":"Z-runtime.js"}',
      ' ' + canonical,
      canonical + '\n',
      canonical + 'TRAILING_GARBAGE',
      '\ufeff' + canonical,
      '{"sources":[],"version":3,"names":[],"mappings":"","file":"Z-runtime.js"}',
      '{"version":3,"sources":[],"names":[],"mappings":"","file":"Z-runtime.js","sourcesContent":[]}',
      '{"version":3,"sources":[],"names":[],"mappings":"","file":"Z-runtime.js","sourceRoot":""}',
      '{"version":3,"sources":[],"names":[],"mappings":"","file":"Z-runtime.js","sections":[]}',
      '{"version":3,"sources":[],"names":["unexpected"],"mappings":"","file":"Z-runtime.js"}',
      '{"version":3,"sources":[],"names":[],"mappings":"AAAA","file":"Z-runtime.js"}',
      '{"version":3,"sources":[],"names":[],"mappings":"","file":"OTHER.js"}',
    ];
    const lifecycle = await completed(value.session);
    for (const bytes of variants) {
      await writeFile(map, bytes);
      const parseInvalid = bytes.startsWith('\ufeff') || bytes.endsWith('TRAILING_GARBAGE');
      const shapeInvalid = bytes.includes('sourcesContent') || bytes.includes('sourceRoot') || bytes.includes('sections') || bytes.includes('unexpected') || bytes.includes('AAAA') || bytes.includes('OTHER.js');
      await plan4Refuses(value, lifecycle, parseInvalid ? SyntaxError : shapeInvalid ? /^Zero-source map shape refused: browser\/Z-runtime\.js/ : /^Zero-source map canonical bytes refused: browser\/Z-runtime\.js/);
    }
    await writeFile(map, canonical);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 exact helper executable getter error export footer and residue controls refuse', async () => {
  const value = await plan4Fixture();
  try {
    await plan4Outputs(value);
    const file = path.join(value.session.cwd, 'dist/browser/Z-runtime.js');
    const original = plan4HelperLiteral + plan4Footer('Z-runtime.js');
    const variants = [
      plan4HelperLiteral.replace('get: (a, b) => (typeof require !== "undefined" ? require : a)[b]', 'get: (a, b) => undefined') + plan4Footer('Z-runtime.js'),
      plan4HelperLiteral.replace('return require.apply(this, arguments);', "return 'UNIT_ONLY_WRONG_GETTER';") + plan4Footer('Z-runtime.js'),
      plan4HelperLiteral.replace('is not supported', 'UNIT_ONLY_CHANGED_ERROR') + plan4Footer('Z-runtime.js'),
      plan4HelperLiteral.replace('export { __require };', 'export { __require as other };') + plan4Footer('Z-runtime.js'),
      plan4HelperLiteral + '\nglobalThis.UNIT_ONLY_EXTRA_CALL?.();' + plan4Footer('Z-runtime.js'),
      original + '\n',
      plan4HelperLiteral + '\n//# sourceMappingURL=Z-runtime.js.map',
    ];
    const lifecycle = await completed(value.session);
    for (const body of variants) {
      await plan4ReplaceJs(file, body);
      await plan4Refuses(value, lifecycle, /^Generated helper executable refused: browser\/Z-runtime\.js/);
    }
    await plan4ReplaceJs(file, original);
  } finally { await value.cleanup(); }
});
for (const sdk of ['missing-rollup', 'altered-rollup', 'wrong-esbuild-native']) test('UNIT-ONLY PLAN4 cannot borrow alternative compiler SDK owner: ' + sdk, async () => {
  const value = await plan4Fixture({ sdk });
  try {
    await plan4Outputs(value);
    const direct = value.sdkExpected;
    if (sdk === 'wrong-esbuild-native') {
      assert.equal(direct.tsupResolution.packageRoot, value.freshTsup);
      assert.equal(direct.esbuildResolution.packageRoot, value.directEsbuild);
      const bundle = value.context.resolutions.filter((edge) => edge.specifier === 'bundle-require' && edge.importer === path.join(value.freshTsup, 'package.json'));
      assert.equal(bundle.length, 1);
      const alternatives = value.context.resolutions.filter((edge) => edge.specifier === 'esbuild' && edge.importer === path.join(bundle[0].packageRoot, 'package.json'));
      assert.equal(alternatives.length, 1);
      const alternate = alternatives[0];
      assert.notEqual(alternate.packageRoot, direct.esbuildResolution.packageRoot);
      const alternateBranch = value.context.nativeBranches.find((branch) => branch.selector.path === path.join(alternate.packageRoot, 'lib/main.js'));
      assert(alternateBranch);
      assert.equal(direct.esbuildNativeBranch.kind, 'esbuild-current-platform');
      assert.equal(alternateBranch.kind, 'esbuild-current-platform');
      const badBytes = Buffer.from('UNIT_ONLY_WRONG_NATIVE_NOT_EXECUTED');
      assert.deepEqual(direct.esbuildNativeBranch.selected, { path: path.join(value.directNative, 'bin/esbuild'), bytes: badBytes.length, sha256: hash(badBytes) });
      assert.equal(alternateBranch.selected.path, path.join(value.alternateNative, 'bin/esbuild'));
      assert.equal(alternateBranch.selected.bytes, plan4NativePin.bytes);
      assert.equal(alternateBranch.selected.sha256, plan4NativePin.sha256);
      assert.notEqual(direct.esbuildNativeBranch.selected.sha256, plan4NativePin.sha256);
      for (const [branch, ownerRoot] of [[direct.esbuildNativeBranch, value.directNative], [alternateBranch, value.alternateNative]]) {
        const owner = value.before.dependencyIdentities.find((entry) => entry.packageRoot === ownerRoot);
        assert(owner);
        assert.equal(owner.name, '@esbuild/darwin-arm64');
        assert.deepEqual(owner.toolPins.find((pin) => pin.path === branch.selected.path), branch.selected);
        assert.deepEqual(value.before.nativeBranches.find((entry) => entry.selector.path === branch.selector.path), branch);
      }
    } else {
      const alternate = value.context.resolutions.find((edge) => edge.specifier === 'rollup' && edge.importer !== path.join(direct.tsupResolution.packageRoot, 'package.json'));
      assert(alternate && alternate.packageRoot !== direct.rollupResolution.packageRoot);
      const actual = plan4Owner(value.before, alternate).toolPins.find((pin) => pin.path === path.join(alternate.packageRoot, 'dist/shared/rollup.js'));
      assert.equal(actual.sha256, '9a7e2371483d8f2b6ddd38efb694cf95dde77382d5c73789e54f8011cbda9b88');
      const directPin = plan4Owner(value.before, direct.rollupResolution).toolPins.find((pin) => pin.path === path.join(direct.rollupResolution.packageRoot, 'dist/shared/rollup.js'));
      if (sdk === 'missing-rollup') assert.equal(directPin, undefined);
      else assert.notEqual(directPin.sha256, actual.sha256);
    }
    await plan4Refuses(value, await completed(value.session), (error) => {
      assert.match(error.message, /^Generated map SDK context refused: (?:browser|node)\/(?:A-excel|B-ranges|Z-runtime)\.js/);
      assert.match(error.message, sdk === 'wrong-esbuild-native' ? /esbuild|native/i : /rollup/i);
      return true;
    });
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 wrapper binding shape and exact serialization cannot add executable statements', async () => {
  const value = await plan4Fixture();
  try {
    await plan4Outputs(value);
    const module = plan4ModuleCases[0];
    const file = path.join(value.session.cwd, 'dist/browser', module.wrapper);
    const original = await readFile(file, 'utf8');
    const variants = [
      "export { " + module.names.slice(1).join(', ') + " } from './Z-excel-target.js';\nimport './Z-runtime.js';" + plan4Footer(module.wrapper),
      "export { " + [...module.names, 'extra'].sort().join(', ') + " } from './Z-excel-target.js';\nimport './Z-runtime.js';" + plan4Footer(module.wrapper),
      original.replace('addAOAToSheet,', 'addAOAToSheet as changed,'),
      "export * from './Z-excel-target.js';\nimport './Z-runtime.js';" + plan4Footer(module.wrapper),
      original.replace("';\nimport", "';\n\nimport"),
      original.replace('export { ', 'export  { '),
      "globalThis.UNIT_ONLY_EXTRA_CALL?.();\n" + original,
      original.replace("import './Z-runtime.js';", "import './Z-range-target.js';"),
    ];
    const lifecycle = await completed(value.session);
    for (let index = 0; index < variants.length; index++) {
      await plan4ReplaceJs(file, variants[index]);
      const expected = index < 2 ? /^Generated wrapper target bindings refused: browser\/A-excel\.js/ : index === 7 ? /^Generated wrapper eligible source refused: browser\/A-excel\.js/ : /^Generated wrapper serialization refused: browser\/A-excel\.js/;
      await plan4Refuses(value, lifecycle, expected);
    }
    await plan4ReplaceJs(file, original);
    const duplicate = original.replace('addAOAToSheet,', 'addAOAToSheet, addAOAToSheet,');
    await plan4ReplaceJs(file, duplicate, true);
    await plan4Refuses(value, lifecycle, /^Generated wrapper serialization refused: browser\/A-excel\.js/);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 wrapper cannot accept an invalid target content or bind an unexported function', async () => {
  const value = await plan4Fixture();
  try {
    await plan4Outputs(value);
    const target = path.join(value.session.cwd, 'dist/browser/Z-range-target.js');
    const map = target + '.map';
    const original = await readFile(map, 'utf8');
    const lifecycle = await completed(value.session);
    const parsed = JSON.parse(original);
    parsed.sourcesContent = ['UNIT_ONLY_TARGET_CONTENT_MISMATCH'];
    await writeFile(map, JSON.stringify(parsed));
    await plan4Refuses(value, lifecycle, /Copied map source content mismatch/);
    parsed.sourcesContent = [null];
    await writeFile(map, JSON.stringify(parsed));
    await plan4Refuses(value, lifecycle, /^Generated wrapper eligible source refused: browser\/B-ranges\.js/);
    await writeFile(map, original);
    await plan4ReplaceJs(target, 'const parseRangeSpec = () => 0;\nexport { parseRangeSpec };\n//# sourceMappingURL=Z-range-target.js.map\n');
    await plan4Refuses(value, lifecycle, /^Generated wrapper target bindings refused: browser\/B-ranges\.js/);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 index source ownership cannot be borrowed by a worker wrapper', async () => {
  const value = await plan4Fixture();
  try {
    await plan4Outputs(value);
    const worker = path.join(value.session.cwd, 'dist/browser/file-worker.js');
    await plan4ReplaceJs(worker, "export const unitOnly = true;\nimport './B-ranges.js';\n//# sourceMappingURL=file-worker.js.map\n");
    await plan4Refuses(value, await completed(value.session), /^Generated wrapper eligible source refused: browser\/B-ranges\.js/);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 orphan generated output is refused by the existing root predicate', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    const helper = path.join(value.session.cwd, 'dist/browser/Z-runtime.js');
    await plan4WriteJs(helper, plan4HelperLiteral + plan4Footer('Z-runtime.js'));
    await write(helper + '.map', plan4Map('Z-runtime.js'));
    await plan4Refuses(value, await completed(value.session), /Unreferenced\/unmapped emitted output/);
  } finally { await value.cleanup(); }
});
test('UNIT-ONLY PLAN4 zero-source CJS is held instead of admitted as an ESM generated class', async () => {
  const value = await fixture();
  try {
    await outputFiles(value);
    const file = path.join(value.session.cwd, 'dist/node/index.cjs');
    await plan4ReplaceJs(file, 'exports.UNIT_ONLY_GENERATED = true;' + plan4Footer('index.cjs'));
    await writeFile(file + '.map', plan4Map('index.cjs'));
    await plan4Refuses(value, await completed(value.session), /^Generated map namespace refused: node\/index\.cjs/);
  } finally { await value.cleanup(); }
});

// CURRENT45 desired controls are authored before the producer correction.
// Literal source/export/output fixtures are not a transpiler or genuine build proof.
const current45Cases = [
  { entry: 'execution', source: 'src/execution.ts', owner: 'src/utilities/common.ts', platforms: ['browser', 'node'], names: [
    'DEFAULT_RATE_LIMIT', 'STL_LIMITS', 'TRIGGER_KIT_VERSION', 'UtilityInputError', 'analyzeMp3File', 'assertUnicode', 'bankDefaults', 'calculateConstructionEstimate', 'checkToolCapabilities', 'clearPipelineCache', 'cloneUtilityJson', 'couldFlowTo', 'createDefaultRegistry', 'createMp3Decoder', 'cspHeader', 'detectCapabilities', 'editCsvCell', 'encodePitchMidi', 'exportBankStatement', 'exportCsv', 'fileMatchesMime', 'financeSourcesForTool', 'hreflangTags', 'matchRule', 'mimeMatches', 'nginxRedirects', 'numberParam', 'parseCsv', 'parseGradeWeight', 'parsePlanningRows', 'parseTextRows', 'parseTriggerKit', 'pruneFires', 'readFileHeader', 'readGamepadSnapshot', 'reviewBankStatement', 'robotsText', 'runBankFileJob', 'runChain', 'runCsvFileJob', 'runPreflight', 'runStlFileJob', 'safeCsvCell', 'selectCsvRows', 'selectPitchNotes', 'serializeTriggerKit', 'setModelCdn', 'strippedForImport', 'summarizeTouchscreenSession', 'touchscreenCellIndex', 'updateTriggerRule', 'utilityDependencyOrder', 'utilityFieldOptions', 'utilityFieldVisible', 'validateBankParams', 'validateBoardFootPieces', 'validateChain', 'validateConstructionEstimate', 'validateContractParticulars', 'validateGeneratorLoads', 'validateGutterCandidates', 'validatePitchParams', 'validatePlanningSnapshot', 'validateStlParams', 'validateUtilityParams',
  ] },
  { entry: 'utility-planning', source: 'src/utilities/planning.ts', platforms: ['browser'], names: ['bmiCategory', 'cookingBand', 'countdownTool', 'parseGradeWeight', 'parsePlanningRows', 'planningTools', 'safeCsvCell', 'sampleUniqueIntegers', 'seatingCsv', 'seatingTool', 'secureUint32', 'stopwatchTool', 'uniformInteger', 'validateContractParticulars', 'validatePlanningSnapshot'] },
  { entry: 'utility-building', source: 'src/utilities/building.ts', platforms: ['browser'], names: ['BUILDING_UNITS', 'buildingChoice', 'buildingCount', 'buildingError', 'buildingN', 'buildingNumber', 'buildingResult', 'buildingRows', 'buildingSpecs', 'buildingTools', 'buildingUtility', 'calculateConstructionEstimate', 'constructionEstimateGenerator', 'purchaseCeiling', 'validateBoardFootPieces', 'validateBuildingRows', 'validateConstructionEstimate', 'validateGutterCandidates'] },
  { entry: 'utility-hardware', source: 'src/utilities/hardware.ts', platforms: ['browser'], names: ['cameraShutterCountChecker', 'gamepadTester', 'hardwareTools', 'readGamepadSnapshot', 'summarizeTouchscreenSession', 'touchscreenCellIndex', 'touchscreenTester', 'validateGeneratorLoads'] },
  { entry: 'utility-finance', source: 'src/utilities/finance.ts', platforms: ['browser'], names: ['financeSourcesForTool', 'financeTools'] },
  { entry: 'utility-text-developer', source: 'src/utilities/text-developer.ts', platforms: ['browser'], names: ['assertUnicode', 'bulkMetaDescriptions', 'chmodResult', 'cspHeader', 'cssGradient', 'decimalParts', 'escapeHtml', 'hreflangTags', 'markdownTable', 'nginxRedirects', 'numberToWords', 'parseTextRows', 'pxRem', 'removeDuplicateLines', 'robotsText', 'textDeveloperTools', 'utmLink'] },
  { entry: 'C45-cron', source: 'src/tools/cron-from-text/generate.ts', platforms: ['browser', 'node'], names: ['generateCronFromText'], lazy: true },
  { entry: 'C45-regex', source: 'src/tools/regex-from-text/generate.ts', platforms: ['browser', 'node'], names: ['generateRegexFromText'], lazy: true },
  { entry: 'C45-explain', source: 'src/tools/regex-explain/explain.ts', platforms: ['browser', 'node'], names: ['explainRegex'], lazy: true },
];
const current45Constants = new Set(['DEFAULT_RATE_LIMIT', 'STL_LIMITS', 'TRIGGER_KIT_VERSION', 'bankDefaults', 'BUILDING_UNITS', 'constructionEstimateGenerator', 'countdownTool', 'seatingTool', 'stopwatchTool', 'cameraShutterCountChecker', 'gamepadTester', 'touchscreenTester']);
function current45Declarations(names, exported) {
  return names.map(name => (exported ? 'export ' : '') + (name === 'UtilityInputError'
    ? 'class UtilityInputError extends Error {}'
    : current45Constants.has(name) || name.endsWith('Tools')
      ? 'const ' + name + ' = [];'
      : 'function ' + name + '() { return "UNIT_ONLY_NOT_TRANSPILE_EQUIVALENCE"; }')).join('\n') + '\n';
}
async function current45Fixture({ sourceVariant } = {}) {
  const base = await plan4Fixture();
  try {
    const core = path.join(base.root, 'packages/core');
    await write(path.join(core, 'src/lib/model-cdn.ts'), 'export const unitOnlyEffects = true;\n');
    await write(path.join(core, 'src/utilities/finance-sources.json'), '{"UNIT_ONLY":"second map source"}');
    for (const item of current45Cases) {
      let body = item.entry === 'execution'
        ? "export { " + item.names.join(', ') + " } from './utilities/common.js';\nexport type * from './index.js';\n"
        : current45Declarations(item.names, true);
      if (item.entry === 'utility-finance') body = "import data from './finance-sources.json' with { type: 'json' };\n" + body;
      body = "import " + JSON.stringify(path.posix.relative(path.posix.dirname(item.source), 'src/lib/model-cdn.js').replace(/^(?!\.)/, './')) + ';\n' + body;
      if (sourceVariant && item.entry === 'execution') body = sourceVariant(body);
      const file = path.join(core, item.source);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    }
    await write(path.join(core, 'src/utilities/common.ts'), current45Declarations(current45Cases[0].names, true)
      + current45Cases.filter(item => item.lazy).map(item => "import '../" + item.source.slice(4, -3) + ".js';").join('\n') + '\n');
    const originalIndex = await readFile(path.join(core, 'src/index.ts'), 'utf8');
    await writeFile(path.join(core, 'src/index.ts'), originalIndex + current45Cases.map(item => "import './" + item.source.slice(4, -3) + ".js';").join('\n') + '\n');
    const session = await createCoreBuildProof({ root: base.root, runId: 'UNIT-current45', deadlineAt: Date.now() + 180000 });
    const before = JSON.parse(await readFile(path.join(session.runDirectory, 'build-evidence/input-before.json')));
    return { ...base, session, before };
  } catch (error) { await base.cleanup(); throw error; }
}
async function current45Outputs(value) {
  await plan4Outputs(value);
  const records = [];
  for (const item of current45Cases) for (const platform of item.platforms) {
    const directory = path.join(value.session.cwd, 'dist', platform);
    const source = path.join(value.session.cwd, item.owner ?? item.source);
    const groups = item.names.length === 1 ? [item.names] : [item.names.slice(0, Math.ceil(item.names.length / 2)), item.names.slice(Math.ceil(item.names.length / 2))];
    const targets = [];
    for (let index = 0; index < groups.length; index++) {
      const target = 'C45-' + item.entry + '-target' + index + '.js';
      const imports = item.entry === 'execution' && index === 0 ? current45Cases.filter(candidate => candidate.lazy).map(candidate => "import './" + candidate.entry + ".js';\n").join('') : '';
      await plan4WriteJs(path.join(directory, target), current45Declarations(groups[index], false) + imports + 'export { ' + groups[index].join(', ') + ' };\n//# sourceMappingURL=' + target + '.map\n');
      const sources = [source];
      if (item.entry === 'utility-finance') sources.push(path.join(value.session.cwd, 'src/utilities/finance-sources.json'));
      await metadata(path.join(directory, target + '.map'), { version: 3, sources: sources.map(file => path.relative(directory, file).split(path.sep).join('/')), sourcesContent: await Promise.all(sources.map(file => readFile(file, 'utf8'))), names: [], mappings: '' });
      targets.push({ output: platform + '/' + target, names: groups[index] });
    }
    const filename = item.entry + '.js';
    const body = targets.map(target => "export { " + target.names.join(', ') + " } from './" + path.posix.basename(target.output) + "';").join('\n') + "\nimport './C45-effects.js';\nimport './Z-runtime.js';" + plan4Footer(filename);
    const file = path.join(directory, filename);
    if (item.lazy) await plan4WriteJs(file, body);
    else await plan4ReplaceJs(file, body);
    if (item.lazy) await write(file + '.map', plan4Map(filename));
    else await writeFile(file + '.map', plan4Map(filename));
    records.push({ ...item, platform, output: platform + '/' + filename, file, body, targets, physicalSource: source });
  }
  for (const platform of ['browser', 'node']) {
    const directory = path.join(value.session.cwd, 'dist', platform);
    const effect = path.join(directory, 'C45-effects.js');
    const input = path.join(value.session.cwd, 'src/lib/model-cdn.ts');
    await plan4WriteJs(effect, 'export const unitOnlyEffects = true;\n//# sourceMappingURL=C45-effects.js.map\n');
    await metadata(effect + '.map', { version: 3, sources: [path.relative(directory, input).split(path.sep).join('/')], sourcesContent: [await readFile(input, 'utf8')], names: [], mappings: '' });
    const index = path.join(directory, 'index.js');
    const old = await readFile(index, 'utf8');
    const imports = records.filter(item => item.platform === platform).map(item => "import './" + path.posix.basename(item.output) + "';\n").join('');
    await plan4ReplaceJs(index, imports + old);
  }
  return records;
}

test('UNIT-ONLY CURRENT45 literal matrix and finite pure entry/lazy classes retain source and target joins', async () => {
  const value = await current45Fixture();
  try {
    assert.deepEqual(current45Cases.map(item => item.names.length), [65, 15, 18, 8, 2, 17, 1, 1, 1]);
    const records = await current45Outputs(value);
    assert.equal(records.length, 13);
    const expected = new Map();
    for (const item of records) {
      expected.set(item.output, await plan4Pin(item.file));
      expected.set(item.output + '.map', await plan4Pin(item.file + '.map'));
      for (const target of item.targets) {
        expected.set(target.output, await plan4Pin(path.join(value.session.cwd, 'dist', target.output)));
        expected.set(target.output + '.map', await plan4Pin(path.join(value.session.cwd, 'dist', target.output + '.map')));
      }
    }
    await value.session.commit(await completed(value.session));
    const ledger = JSON.parse(await readFile(path.join(value.session.runDirectory, 'build-evidence/compiled-map-input-ledger.json')));
    assert.equal(ledger.generatedOutputs.length, 19);
    for (const item of records) {
      const actual = ledger.generatedOutputs.find(record => record.output === item.output);
      assert(actual, 'Each literal new stub must be classified rather than omitted.');
      assert.equal(actual.descriptor, 'rollup4642-current-entry-reexport-v1');
      assert.deepEqual(actual.bindings, item.names);
      assert.equal(actual.outputPin.sha256, expected.get(item.output).sha256);
      assert.deepEqual(actual.map, expected.get(item.output + '.map'));
      assert.equal(actual.input.path, 'packages/core/' + item.source);
      assert.deepEqual(actual.input, value.before.sourceInputs.find(pin => pin.path === actual.input.path));
      assert.equal(actual.bindingOwners.length, item.names.length);
      for (const name of item.names) {
        const owners = actual.bindingOwners.filter(owner => owner.name === name);
        assert.equal(owners.length, 1);
        const owner = owners[0];
        assert.equal(owner.input.path, 'packages/core/' + (item.owner ?? item.source));
        assert.deepEqual(owner.input, value.before.sourceInputs.find(pin => pin.path === owner.input.path));
        assert.equal(owner.sourceIndex, 0);
        assert(item.targets.some(target => target.output === owner.output && target.names.includes(name)));
        const target = actual.targets.find(target => target.output === owner.output);
        assert(target);
        assert.equal(target.outputPin.sha256, expected.get(owner.output).sha256);
        assert.deepEqual(target.map, expected.get(owner.output + '.map'));
      }
      assert(actual.eligibleEntries.includes(item.platform + ':index'));
      if (!item.lazy) assert(actual.eligibleEntries.includes(item.platform + ':' + item.entry));
      else assert(actual.eligibleEntries.includes(item.platform + ':execution'));
      plan4FalseFlags(actual);
    }
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY CURRENT45 new-class executable default star alias import and canonical residue refuse', async () => {
  const value = await current45Fixture();
  try {
    const records = await current45Outputs(value);
    const item = records.find(record => record.output === 'browser/execution.js');
    const variants = [
      ['globalThis.UNIT_ONLY_EXTRA_CALL?.();\n' + item.body, false],
      [item.body.replace('export { DEFAULT_RATE_LIMIT,', 'export { DEFAULT_RATE_LIMIT as default,'), false],
      [item.body.replace(/export \{[^\n]+\} from/, 'export * from'), false],
      [item.body.replace('DEFAULT_RATE_LIMIT,', 'DEFAULT_RATE_LIMIT as changed,'), false],
      [item.body.replace("import './C45-effects.js';", "import { unitOnlyEffects } from './C45-effects.js';"), false],
      [item.body.replace('export { ', 'export  { '), false],
      [item.body + '\n', false, /^Generated helper executable refused: browser\/execution\.js$/],
      [item.body.replace('DEFAULT_RATE_LIMIT,', 'DEFAULT_RATE_LIMIT, DEFAULT_RATE_LIMIT,'), true],
    ];
    const lifecycle = await completed(value.session);
    for (const [body, malformed, expected = /^Generated entry stub .*refused: browser\/execution\.js/] of variants) {
      await plan4ReplaceJs(item.file, body, malformed);
      await plan4Refuses(value, lifecycle, expected);
    }
    await plan4ReplaceJs(item.file, item.body);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY CURRENT45 missing invented and nonlocal selected target bindings refuse', async () => {
  const value = await current45Fixture();
  try {
    const records = await current45Outputs(value);
    const item = records.find(record => record.output === 'browser/utility-finance.js');
    const target = path.join(value.session.cwd, 'dist', item.targets[0].output);
    const original = await readFile(target, 'utf8');
    const lifecycle = await completed(value.session);
    for (const body of [
      original.replace('export { financeSourcesForTool };', 'export { financeSourcesForTool as changed };'),
      original.replace('function financeSourcesForTool() { return "UNIT_ONLY_NOT_TRANSPILE_EQUIVALENCE"; }', "import { financeSourcesForTool } from './C45-effects.js';"),
    ]) {
      await plan4ReplaceJs(target, body);
      await plan4Refuses(value, lifecycle, /^Generated entry stub .*refused: browser\/utility-finance\.js/);
    }
    await plan4ReplaceJs(target, original);
    const missingExport = item.body.replace(/^export \{[^\n]+\n/, '').replace("import './C45-effects.js';",
      "import './C45-effects.js';\nimport './" + path.posix.basename(item.targets[0].output) + "';");
    for (const body of [item.body.replace('financeSourcesForTool', 'inventedFinanceName'), missingExport]) {
      await plan4ReplaceJs(item.file, body);
      await plan4Refuses(value, lifecycle, /^Generated entry stub .*refused: browser\/utility-finance\.js/);
    }
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY CURRENT45 changed and null selected source content never supplies a named owner', async () => {
  const value = await current45Fixture();
  try {
    const records = await current45Outputs(value);
    const item = records.find(record => record.output === 'browser/utility-finance.js');
    const file = path.join(value.session.cwd, 'dist', item.targets[0].output + '.map');
    const original = await readFile(file, 'utf8');
    const lifecycle = await completed(value.session);
    for (const content of ['UNIT_ONLY_WRONG_OWNER_CONTENT', null]) {
      const map = JSON.parse(original); map.sourcesContent[0] = content;
      await writeFile(file, JSON.stringify(map));
      await plan4Refuses(value, lifecycle, content === null ? /^Generated entry stub .*refused:/ : /Copied map source content mismatch/);
    }
  } finally { await value.cleanup(); }
});

for (const variant of ['default', 'star', 'alias', 'duplicate', 'foreign', 'cycle']) test('UNIT-ONLY CURRENT45 selected source export refusal: ' + variant, async () => {
  const sourceVariant = body => {
    if (variant === 'default') return body + 'export default 1;\n';
    if (variant === 'star') return body.replace(/export \{[^\n]+\} from/, 'export * from');
    if (variant === 'alias') return body.replace('DEFAULT_RATE_LIMIT,', 'DEFAULT_RATE_LIMIT as renamed,');
    if (variant === 'duplicate') return body.replace('DEFAULT_RATE_LIMIT,', 'DEFAULT_RATE_LIMIT, DEFAULT_RATE_LIMIT,');
    if (variant === 'foreign') return body.replace("from './utilities/common.js'", "from '@wyreup/exceljs'") + "import './utilities/common.js';\n";
    return body.replace("from './utilities/common.js'", "from './execution.js'") + "import './utilities/common.js';\n";
  };
  const value = await current45Fixture({ sourceVariant });
  try {
    await current45Outputs(value);
    await plan4Refuses(value, await completed(value.session), /^Generated entry stub .*refused: (?:browser|node)\/execution\.js/);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY CURRENT45 a worker cannot borrow entry ownership or a side-effect source from another root', async () => {
  const value = await current45Fixture();
  try {
    await current45Outputs(value);
    const worker = path.join(value.session.cwd, 'dist/browser/file-worker.js');
    const original = await readFile(worker, 'utf8');
    await plan4ReplaceJs(worker, "import './utility-finance.js';\n" + original);
    await plan4Refuses(value, await completed(value.session), /^Generated entry stub .*refused: browser\/utility-finance\.js/);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY CURRENT45 noncanonical map and foreign zero-map helper remain refused', async () => {
  const value = await current45Fixture();
  try {
    const records = await current45Outputs(value);
    const item = records.find(record => record.output === 'browser/execution.js');
    const lifecycle = await completed(value.session);
    await writeFile(item.file + '.map', plan4Map('execution.js') + '\n');
    await plan4Refuses(value, lifecycle, /^Zero-source map canonical bytes refused: browser\/execution\.js/);
    await writeFile(item.file + '.map', plan4Map('execution.js'));
    await plan4WriteJs(path.join(value.session.cwd, 'dist/browser/C45-foreign-helper.js'), 'export const UNIT_ONLY_FOREIGN_HELPER = true;' + plan4Footer('C45-foreign-helper.js'));
    await write(path.join(value.session.cwd, 'dist/browser/C45-foreign-helper.js.map'), plan4Map('C45-foreign-helper.js'));
    await plan4ReplaceJs(item.file, item.body.replace("import './Z-runtime.js';", "import './C45-foreign-helper.js';"));
    await plan4Refuses(value, lifecycle, /Generated (?:entry stub .*refused: browser\/execution\.js|wrapper serialization refused: browser\/C45-foreign-helper\.js)/);
  } finally { await value.cleanup(); }
});

for (const extraWorkerTarget of [false, true]) test('UNIT-ONLY CURRENT45 old wrappers keep exact shared root equality: extraWorkerTarget=' + extraWorkerTarget, async () => {
  const base = await plan4Fixture();
  try {
    await writeFile(path.join(base.root, 'packages/core/src/execution.ts'), "import './lib/excel.js';\nimport './lib/pdf-ranges.js';\nexport const unitOnly = true;\n");
    const session = await createCoreBuildProof({ root: base.root, runId: 'UNIT-current45-old-shared', deadlineAt: Date.now() + 180000 });
    const value = { ...base, session };
    await plan4Outputs(value);
    for (const platform of ['browser', 'node']) {
      await plan4ReplaceJs(path.join(session.cwd, 'dist', platform, 'execution.js'), "export const unitOnly = true;\nimport './A-excel.js';\nimport './B-ranges.js';\n//# sourceMappingURL=execution.js.map\n");
    }
    if (extraWorkerTarget) {
      const worker = path.join(session.cwd, 'dist/browser/file-worker.js');
      await plan4ReplaceJs(worker, "export const unitOnly = true;\nimport './Z-range-target.js';\n//# sourceMappingURL=file-worker.js.map\n");
      await plan4Refuses(value, await completed(session), /^Generated wrapper eligible source refused: browser\/B-ranges\.js/);
    } else {
      await session.commit(await completed(session));
      const ledger = JSON.parse(await readFile(path.join(session.runDirectory, 'build-evidence/compiled-map-input-ledger.json')));
      for (const platform of ['browser', 'node']) for (const name of ['A-excel.js', 'B-ranges.js']) {
        const wrapper = ledger.generatedOutputs.find(record => record.output === platform + '/' + name);
        assert.deepEqual(wrapper.eligibleEntries, [platform + ':execution', platform + ':index']);
        assert.equal(wrapper.descriptor, 'rollup4642-two-source-reexport-v1');
        plan4FalseFlags(wrapper);
      }
    }
  } finally { await base.cleanup(); }
});

for (const scope of ['export target', 'bare import target']) test('UNIT-ONLY SOURCE-REVIEW A per-root physical source refusal: ' + scope, async () => {
  const value = await current45Fixture();
  try {
    await current45Outputs(value);
    const directory = path.join(value.session.cwd, 'dist/browser');
    const filename = scope === 'export target' ? 'C45-utility-finance-target0.js.map' : 'C45-effects.js.map';
    const file = path.join(directory, filename);
    const map = JSON.parse(await readFile(file, 'utf8'));
    const input = path.join(value.session.cwd, 'src/index.ts');
    map.sources.push(path.relative(directory, input).split(path.sep).join('/'));
    map.sourcesContent.push(await readFile(input, 'utf8'));
    await writeFile(file, JSON.stringify(map));
    const exact = scope === 'export target'
      ? /^Generated entry stub source refused: browser\/utility-finance\.js$/
      : /^Generated entry stub source refused: browser\/C45-cron\.js$/;
    await plan4Refuses(value, await completed(value.session), exact);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY SOURCE-REVIEW A last import must be the actual validated helper', async () => {
  const value = await current45Fixture();
  try {
    const records = await current45Outputs(value);
    const item = records.find(record => record.output === 'browser/execution.js');
    const changed = item.body.replace("\nimport './Z-runtime.js';", '');
    assert.notEqual(changed, item.body);
    await plan4ReplaceJs(item.file, changed);
    await plan4Refuses(value, await completed(value.session), /^Generated entry stub serialization refused: browser\/execution\.js$/);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY SOURCE-REVIEW A same-name target export cannot borrow a different terminal source owner', async () => {
  const value = await current45Fixture();
  try {
    await current45Outputs(value);
    const directory = path.join(value.session.cwd, 'dist/browser');
    const file = path.join(directory, 'C45-utility-planning-target0.js.map');
    const map = JSON.parse(await readFile(file, 'utf8'));
    const wrongOwner = path.join(value.session.cwd, 'src/lib/model-cdn.ts');
    map.sources[0] = path.relative(directory, wrongOwner).split(path.sep).join('/');
    map.sourcesContent[0] = await readFile(wrongOwner, 'utf8');
    await writeFile(file, JSON.stringify(map));
    await plan4Refuses(value, await completed(value.session), /^Generated entry stub source refused: browser\/utility-planning\.js$/);
  } finally { await value.cleanup(); }
});

test('UNIT-ONLY SOURCE-REVIEW A duplicate local target declarations cannot supply one named binding', async () => {
  const value = await current45Fixture();
  try {
    await current45Outputs(value);
    const file = path.join(value.session.cwd, 'dist/browser/C45-utility-finance-target0.js');
    await plan4ReplaceJs(file, 'var financeSourcesForTool = 1;\nvar financeSourcesForTool = 2;\nexport { financeSourcesForTool };\n//# sourceMappingURL=C45-utility-finance-target0.js.map\n');
    await plan4Refuses(value, await completed(value.session), (error) => {
      assert.equal(error.code, 'ERR_ASSERTION');
      assert.equal(error.message.split('\n')[0], 'Generated entry stub bindings refused: browser/utility-finance.js');
      assert.equal(error.actual, 2);
      assert.equal(error.expected, 1);
      return true;
    });
  } finally { await value.cleanup(); }
});

for (const form of ['export type', 'inline type', 'namespace', 'attributes', 'wrong root', 'cross namespace']) test('UNIT-ONLY SOURCE-REVIEW A finite stub form refusal: ' + form, async () => {
  const value = await current45Fixture();
  try {
    const records = await current45Outputs(value);
    const item = records.find(record => record.output === 'browser/execution.js');
    const firstLine = item.body.split('\n')[0];
    const firstTarget = path.posix.basename(item.targets[0].output);
    let changed;
    let malformed = false;
    let exact = /^Generated entry stub serialization refused: browser\/execution\.js$/;
    if (form === 'export type') {
      changed = item.body.replace('export { ', 'export type { ').replace("import './Z-runtime.js';", "import './" + firstTarget + "';\nimport './Z-runtime.js';");
      malformed = true;
    } else if (form === 'inline type') {
      changed = item.body.replace('export { DEFAULT_RATE_LIMIT,', 'export { type DEFAULT_RATE_LIMIT,');
      malformed = true;
    } else if (form === 'namespace') {
      changed = item.body.replace(firstLine, "export * as named from './" + firstTarget + "';");
    } else if (form === 'attributes') {
      changed = item.body.replace(firstLine, firstLine.replace(/';$/, "' with { type: 'json' };"));
    } else if (form === 'wrong root') {
      const finance = records.find(record => record.output === 'browser/utility-finance.js');
      const retainedTargets = item.targets.map(target => "import './" + path.posix.basename(target.output) + "';").join('\n');
      changed = finance.body.slice(0, -plan4Footer('utility-finance.js').length)
        .replace("import './Z-runtime.js';", retainedTargets + "\nimport './Z-runtime.js';") + plan4Footer('execution.js');
      exact = /^Generated entry stub bindings refused: browser\/execution\.js$/;
    } else {
      changed = item.body.replace("'./" + firstTarget + "'", "'../node/" + firstTarget + "'");
      exact = /^Wrong\/unaccountable output namespace edge: node\/C45-execution-target0\.js$/;
    }
    assert.notEqual(changed, item.body);
    await plan4ReplaceJs(item.file, changed, malformed);
    await plan4Refuses(value, await completed(value.session), form === 'wrong root' ? (error) => {
      assert.equal(error.code, 'ERR_ASSERTION');
      assert.equal(error.message.split('\n')[0], 'Generated entry stub bindings refused: browser/execution.js');
      assert.deepEqual(error.actual, ['financeSourcesForTool', 'financeTools']);
      assert.deepEqual(error.expected, current45Cases[0].names);
      return true;
    } : exact);
  } finally { await value.cleanup(); }
});
