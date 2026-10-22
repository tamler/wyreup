import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { bindingTemplateFromSource, validateBindingRunRelation, validateBindingRoleJoin, validateObservedBindingPolicy,
  protectedBrowserFixtures, boundFixtureOracle, checkBrowserProductionBinding } from '../check-catalog-evidence.mjs';
import { projectBindingPolicy, readCoordinatedCoreProof } from '../../packages/web/test/productionBuildBindingObserver.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(new URL('../../', import.meta.url).pathname);
const runId = 'unit-only-synthetic';
const claims = { consumedModuleGraphObserved: false, moduleLevelViteMapping: false,
  midiWorkerBuildGraphObserved: false, workerDistToEmittedAssociation: false,
  fixedWorkflowOnly: true, servedResponseBodyEquality: false };

function environment() {
  const build = { ssr: false, target: 'es2022', outDir: '/unit-output',
    rolldownOptions: { external: ['node:fs'], output: { chunkFileNames: () => 'unused.js' }, onwarn() {} } };
  Object.defineProperty(build, 'rollupOptions', { get() { throw new Error('Excluded compatibility getter evaluated'); } });
  return { config: { consumer: 'client', command: 'build', mode: 'production',
    resolve: { alias: [{ find: /^astro:/, replacement: '/unit-alias' }], conditions: ['browser'],
      mainFields: ['browser', 'module'], external: [], noExternal: [], builtins: [/^node:/] },
    build, worker: { format: 'es', rolldownOptions: { external: ['node:fs'] } } } };
}
test('unit-only limited policy supports RegExp while excluding naming callbacks and compatibility getter', () => {
  const projected = projectBindingPolicy(environment());
  assert.equal(projected.resolve.alias[0].find.kind, 'regexp');
  assert.deepEqual(projected.resolve.alias[0].find, { kind: 'regexp', source: '^astro:', flags: '' });
  assert.equal(projected.consumer, 'client');
  validateObservedBindingPolicy(projected);
  assert.equal(projected.resolve.extensions.kind, 'absent');
  const value = environment();
  value.config.resolve.extensions = undefined;
  assert.equal(projectBindingPolicy(value).resolve.extensions.kind, 'undefined');
  value.config.resolve.extensions = null;
  assert.equal(projectBindingPolicy(value).resolve.extensions, null);
});
for (const [name, mutate, message] of [
  ['selected external function', (value) => { value.config.build.rolldownOptions.external = () => true; }, /build\.rolldownOptions\.external/],
  ['selected external accessor', (value) => { Object.defineProperty(value.config.build.rolldownOptions, 'external', { get() { throw new Error('must not execute'); } }); }, /build\.rolldownOptions\.external/],
  ['alias custom resolver', (value) => { value.config.resolve.alias[0].customResolver = () => undefined; }, /resolve\.alias\[0\]\.customResolver/],
  ['unknown alias field', (value) => { value.config.resolve.alias[0].ignored = true; }, /resolve\.alias\[0\]/],
  ['sparse array', (value) => { value.config.resolve.conditions = new Array(1); }, /resolve\.conditions/],
  ['array count', (value) => { value.config.resolve.conditions = Array(257).fill('a'); }, /resolve\.conditions/],
  ['string size', (value) => { value.config.resolve.conditions = ['a'.repeat(8193)]; }, /resolve\.conditions/],
  ['cycle', (value) => { const cycle = {}; cycle.self = cycle; value.config.resolve.external = cycle; }, /cycle/],
  ['symbol', (value) => { value.config.resolve.external = { [Symbol('x')]: 'x' }; }, /symbol/],
  ['custom prototype', (value) => { value.config.resolve.external = Object.create({ inherited: true }); }, /prototype/],
]) test(`unit-only policy refuses ${name} at the selected path`, () => {
  const value = environment(); mutate(value); assert.throws(() => projectBindingPolicy(value), message);
});

const templateLines = [
  "import { fileURLToPath } from 'node:url';",
  "import production from './astro.config.mjs';",
  "import { createProductionBindingObserver } from './test/productionBuildBindingObserver.mjs';",
  'const bindingOptions = __WYREUP_BINDING_OPTIONS_JSON__;',
  'export default {', '  ...production,',
  '  integrations: [...(production.integrations ?? []), createProductionBindingObserver(bindingOptions)],',
  "  cacheDir: fileURLToPath(new URL('./.acceptance-cache/astro/', import.meta.url)),",
  '  vite: {', '    ...production.vite,',
  "    cacheDir: fileURLToPath(new URL('./.acceptance-cache/vite/', import.meta.url)),",
  '  },', '};', '',
];
const literals = { runId, observationDir: '/unit/docs/catalog-artifacts/unit-only-synthetic/build-evidence/binding-unit-only-synthetic',
  observerIdentity: { relativePath: 'packages/web/test/productionBuildBindingObserver.mjs', bytes: 7, sha256: 'a'.repeat(64) } };
test('unit-only checker derives exact reviewed literal template without importing helper code', async () => {
  const helper = await fs.readFile(path.join(root, 'packages/web/test/productionBrowserHarness.ts'), 'utf8');
  const expected = templateLines.join('\n').replace('__WYREUP_BINDING_OPTIONS_JSON__', JSON.stringify(literals));
  assert.equal(bindingTemplateFromSource(helper, literals), expected);
  for (const source of [
    'const BINDING_CONFIG_TEMPLATE = buildTemplate();',
    `const BINDING_CONFIG_TEMPLATE = ${JSON.stringify(templateLines)}.join('');`,
    `const BINDING_CONFIG_TEMPLATE = ${JSON.stringify(templateLines)}.join('\\n'); const BINDING_CONFIG_TEMPLATE = [];`,
  ]) assert.throws(() => bindingTemplateFromSource(source, literals), /generated-config template mismatch/);
});
test('unit-only absent-mode source keeps the exact default template and manifest key list', async () => {
  const helper = await fs.readFile(path.join(root, 'packages/web/test/productionBrowserHarness.ts'), 'utf8');
  const ts = createRequire(import.meta.url)('typescript');
  const ast = ts.createSourceFile('helper.ts', helper, ts.ScriptTarget.Latest, true);
  let defaultBody, manifestKeys;
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.text === 'CACHE_CONFIG_BODY')
      defaultBody = node.initializer.expression.expression.elements.map((item) => item.text).join('\n');
    if (ts.isVariableDeclaration(node) && node.name.text === 'manifest' && ts.isObjectLiteralExpression(node.initializer))
      manifestKeys = node.initializer.properties.map((item) => item.name.text);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.equal(defaultBody, ["import { fileURLToPath } from 'node:url';", "import production from './astro.config.mjs';",
    'export default {', '  ...production,', "  cacheDir: fileURLToPath(new URL('./.acceptance-cache/astro/', import.meta.url)),",
    '  vite: {', '    ...production.vite,', "    cacheDir: fileURLToPath(new URL('./.acceptance-cache/vite/', import.meta.url)),", '  },', '};', ''].join('\n'));
  assert.deepEqual(manifestKeys, ['kind', 'inputs', 'generatedInputs', 'dependencyLinks', 'coreDist', 'preserved',
    'beforeGuardPath', 'afterGuardPath', 'artifacts', 'commands', 'cwd', 'buildLogs', 'started', 'deadline', 'aliases']);
  // This is a source/shape control, not the required real default-path build gate.
});
test('explicit undefined binding option refuses before any filesystem/build work', async () => {
  const { buildProductionCatalogFixture } = await import('../../packages/web/test/productionBrowserHarness.ts');
  await assert.rejects(buildProductionCatalogFixture({ webDir: '/unit-path-must-not-be-read',
    evidenceDir: '/unit-path-must-not-be-written', observeBinding: undefined }), /run identity mismatch/);
});

test('unit-only role joins refuse missing/conflicting phase records instead of crediting another inventory', () => {
  const item = { path: 'packages/web/source.ts', bytes: 1, sha256: 'b'.repeat(64) };
  const role = { captureClass: 'copied-original', logicalPath: item.path, bytes: item.bytes, sha256: item.sha256 };
  const build = { inputs: [item], preparedInputs: [item], generatedInputs: [], artifacts: [], dependencyIdentities: [] };
  validateBindingRoleJoin(role, build, runId);
  assert.throws(() => validateBindingRoleJoin(role, { ...build, inputs: [] }, runId), /copied-input mismatch/);
  assert.throws(() => validateBindingRoleJoin(role, { ...build, inputs: [item, item] }, runId), /unmapped source role/);
  assert.throws(() => validateBindingRoleJoin({ ...role, captureClass: 'emitted-output' }, build, runId), /unmapped source role/);
  assert.throws(() => validateBindingRoleJoin({ captureClass: 'unmapped', logicalPath: item.path }, build, runId), /unmapped source role/);
});
test('unit-only declared durable suffix remains valid after relocating evidence without rewriting old absolute literals', () => {
  const suffix = `docs/catalog-artifacts/${runId}/build-evidence/binding-${runId}`;
  const binding = { runId, observationDir: `/historical-checkout/${suffix}`,
    durableConfig: { path: `${suffix}/generated-config.mjs.txt` },
    templateBinding: { originalRoot: '/historical-checkout', producerPathConvention: 'posix',
      literals: { runId, observationDir: `/historical-checkout/${suffix}` } } };
  assert.equal(validateBindingRunRelation(binding, runId).suffix, suffix);
  const wrong = structuredClone(binding); wrong.templateBinding.originalRoot = '/current-relocated-root';
  assert.throws(() => validateBindingRunRelation(wrong, runId), /run identity mismatch/);
  const conflict = structuredClone(binding); conflict.durableConfig.path = `${suffix}/../outside.txt`;
  assert.throws(() => validateBindingRunRelation(conflict, runId), /run identity mismatch/);
});

/** This writes ONLY labelled schema-test data. No compiler/process/browser ever runs. */
async function syntheticProof() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'browser-binding-unit-only-')));
  async function write(relative, content) {
    const bytes = Buffer.from(content);
    await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
    await fs.writeFile(path.join(directory, relative), bytes, { flag: 'wx' });
    if (/\.(js|mjs|cjs)$/.test(relative))
      execFileSync(process.execPath, ['--check', '--input-type=module'], { input: bytes, timeout: 5000, killSignal: 'SIGTERM' });
    return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
  }
  const prefix = `docs/catalog-artifacts/${runId}`;
  const packageJson = JSON.stringify({ name: '@wyreup/core', version: '0.0.0-unit-only', scripts: { build: 'tsup' }, exports: { '.': { browser: './dist/browser/index.js', node: './dist/node/index.js' } } });
  const sourceInputs = [];
  for (const [file, body] of [
    ['package.json', '{"private":true}'], ['pnpm-lock.yaml', 'unit-only'], ['pnpm-workspace.yaml', 'unit-only'],
    ['packages/core/package.json', packageJson], ['packages/core/tsup.config.ts', '// synthetic schema control; not executed'],
    ['packages/core/tsconfig.json', '{}'], ['packages/core/src/index.ts', 'export const unitOnly = true;'],
  ]) sourceInputs.push(await write(file, body));
  sourceInputs.sort((a, b) => a.path < b.path ? -1 : 1);
  const outputs = [];
  for (const file of ['browser/index.js', 'browser/index.js.map', 'browser/index.d.ts', 'node/index.js', 'node/index.js.map', 'node/index.d.ts', 'node/index.cjs']) {
    const body = file.endsWith('.map') ? JSON.stringify({ version: 3, file: 'index.js', names: [], mappings: '',
      sources: ['../../src/index.ts'], sourcesContent: ['export const unitOnly = true;'] }) : '// UNIT ONLY schema bytes; NOT built output\n';
    const item = await write(`${prefix}/core-build-output/${file}`, body);
    outputs.push({ ...item, path: file });
  }
  outputs.sort((a, b) => a.path < b.path ? -1 : 1);
  const tool = await write('unit-dependency/tool.mjs', '// never executed');
  const dependencyPackage = await write('unit-dependency/package.json', '{"name":"tsup","version":"0.0.0-unit-only","bin":{"tsup":"./tool.mjs"}}');
  await fs.mkdir(path.join(directory, 'packages/core/node_modules'), { recursive: true });
  await fs.symlink(path.join(directory, 'unit-dependency'), path.join(directory, 'packages/core/node_modules/tsup'), 'dir');
  const nodePath = await fs.realpath(process.execPath), nodeBytes = await fs.readFile(nodePath);
  const proof = { schemaVersion: 1, mode: 'owned-current-core-build-v1', runId,
    sourceRoot: directory, ownedBuildRoot: path.join(directory, 'owned-unit-compile'),
    sourceInputs, sourceInputsAfter: structuredClone(sourceInputs),
    dependencyIdentities: [{ packageRoot: path.join(directory, 'unit-dependency'), name: 'tsup', version: '0.0.0-unit-only',
      packageJson: { ...dependencyPackage, path: path.join(directory, dependencyPackage.path) },
      toolPins: [{ ...tool, path: path.join(directory, tool.path) }] }],
    build: { argv: [nodePath, path.join(directory, tool.path)], cwd: path.join(directory, 'owned-unit-compile/packages/core'),
      node: { path: nodePath, version: process.version, bytes: nodeBytes.length, sha256: sha(nodeBytes) },
      environment: { NODE_ENV: 'production' },
      configPin: await write(`${prefix}/unit-config.ts`, '// synthetic'),
      log: await write(`${prefix}/unit-log.txt`, 'SYNTHETIC UNIT CONTROL: no native build was run\n'),
      outcome: { exitCode: 0, signal: null, exitObserved: true, closeObserved: true, logWritersSettled: true } },
    outputRoot: 'core-build-output', outputs,
    packageManifest: sourceInputs.find((item) => item.path === 'packages/core/package.json'),
    sourcePathMapping: { originalPrefix: path.join(directory, 'packages/core'), ownedPrefix: path.join(directory, 'owned-unit-compile/packages/core'), logicalPrefix: 'packages/core/' } };
  await write('UNIT-ONLY-NOT-PRODUCER-EVIDENCE.txt', 'No native build or accepted Stage A evidence.\n');
  const descriptor = path.join(directory, prefix, 'core-build-proof.json');
  async function save() { await fs.writeFile(descriptor, JSON.stringify(proof)); }
  await save();
  return { directory, proof, save, descriptor, write, async close() { await fs.rm(directory, { recursive: true }); } };
}
test('unit-only schema reader accepts a coherent synthetic descriptor WITHOUT establishing a real build', async () => {
  const fixture = await syntheticProof();
  try {
    const result = await readCoordinatedCoreProof(fixture.directory, runId);
    assert.equal(result.proof.mode, 'owned-current-core-build-v1');
    assert.equal(result.proof.outputs.length, 7);
    assert.match(await fs.readFile(path.join(fixture.directory, 'UNIT-ONLY-NOT-PRODUCER-EVIDENCE.txt'), 'utf8'), /No native build/);
  } finally { await fixture.close(); }
});
for (const [name, mutate] of [
  ['unknown field', (fixture) => { fixture.proof.extra = true; }],
  ['wrong schema', (fixture) => { fixture.proof.schemaVersion = 2; }],
  ['wrong run', (fixture) => { fixture.proof.runId = 'another-run'; }],
  ['different after inputs', (fixture) => { fixture.proof.sourceInputsAfter[0].sha256 = 'a'.repeat(64); }],
  ['duplicate input', (fixture) => { fixture.proof.sourceInputs.push(fixture.proof.sourceInputs[0]); }],
  ['missing original input', (fixture) => { fixture.proof.sourceInputs = fixture.proof.sourceInputs.filter((item) => item.path !== 'pnpm-lock.yaml'); fixture.proof.sourceInputsAfter = structuredClone(fixture.proof.sourceInputs); }],
  ['unknown environment secret', (fixture) => { fixture.proof.build.environment.ACCESS_TOKEN = 'unit-control-not-secret'; }],
  ['missing close observation', (fixture) => { fixture.proof.build.outcome.closeObserved = false; }],
  ['unsettled log writers', (fixture) => { fixture.proof.build.outcome.logWritersSettled = false; }],
  ['native failure', (fixture) => { fixture.proof.build.outcome.exitCode = 1; }],
  ['Node bytes', (fixture) => { fixture.proof.build.node.sha256 = '0'.repeat(64); }],
  ['different Node version', (fixture) => { fixture.proof.build.node.version = 'v0.0.0'; }],
  ['tool not pinned', (fixture) => { fixture.proof.build.argv[1] = '/unit/unpinned-tool'; }],
  ['source mapping basename guess', (fixture) => { fixture.proof.sourcePathMapping.ownedPrefix = '/unit/probable'; }],
  ['output traversal', (fixture) => { fixture.proof.outputs[0].path = '../escape.js'; }],
  ['output bytes', (fixture) => { fixture.proof.outputs[0].sha256 = '0'.repeat(64); }],
  ['unrecorded output', async (fixture) => { await fixture.write(`docs/catalog-artifacts/${runId}/core-build-output/browser/unrecorded.js`, '// UNIT ONLY extra unrecorded output\n'); }],
]) test(`unit-only Stage A refuses ${name}`, async () => {
  const fixture = await syntheticProof();
  try { await mutate(fixture); await fixture.save(); await assert.rejects(readCoordinatedCoreProof(fixture.directory, runId), /coordinated core proof mismatch/); }
  finally { await fixture.close(); }
});
test('unit-only missing observation mode refuses before any Stage A read or stronger pairing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-binding-mode-unit-'));
  try {
    const bytes = Buffer.from('{}');
    await fs.writeFile(path.join(directory, 'build.json'), bytes);
    await assert.rejects(checkBrowserProductionBinding(directory,
      { productionBuildManifest: { path: 'build.json', bytes: bytes.length, sha256: sha(bytes) } }, {}, { id: 'stopwatch' }), /missing observation mode/);
  } finally { await fs.rm(directory, { recursive: true }); }
});

test('actual protected fixture shape rejects history inside a fixture while preserving top-level history', async () => {
  const oracles = JSON.parse(await fs.readFile(path.join(root, 'docs/CATALOG-INTEGRATION-ORACLES.json'), 'utf8'));
  const mapping = JSON.parse(await fs.readFile(path.join(root, 'docs/CATALOG-INTEGRATION-MAPPING.json'), 'utf8'));
  const fixtures = await protectedBrowserFixtures(root);
  assert.equal(fixtures.length, 6);
  for (const fixture of fixtures) {
    const engine = mapping.rows.flatMap((row) => row.engines).find((item) => item.id === fixture.engineId);
    const clone = { ...oracles, browserFixtureSourceHistory: [{ unitOnly: true, note: 'top-level only; grants no history waiver' }] };
    await boundFixtureOracle(root, fixture, clone, engine);
    await assert.rejects(boundFixtureOracle(root, { ...fixture, browserFixtureSourceHistory: [] }, clone, engine), /Browser fixture differs/);
  }
});

async function protocolFixture() {
  const fixture = await syntheticProof();
  const helperPath = 'packages/web/test/productionBrowserHarness.ts';
  const observerPath = 'packages/web/test/productionBuildBindingObserver.mjs';
  const helper = await fs.readFile(path.join(root, helperPath));
  const observer = await fs.readFile(path.join(root, observerPath));
  const helperPin = await fixture.write(helperPath, helper);
  const observerPin = await fixture.write(observerPath, observer);
  const suffix = `docs/catalog-artifacts/${runId}/build-evidence/binding-${runId}`;
  const literal = { runId, observationDir: path.join(fixture.directory, suffix),
    observerIdentity: { relativePath: observerPath, bytes: observer.length, sha256: sha(observer) } };
  const durable = await fixture.write(`${suffix}/generated-config.mjs.txt`, bindingTemplateFromSource(helper.toString(), literal));
  const proofBytes = await fs.readFile(fixture.descriptor);
  const ownedCore = path.join(fixture.directory, 'owned-browser/packages/core');
  function core(namespace) {
    const entry = fixture.proof.outputs.find((item) => item.path === `${namespace}/index.js`);
    const map = fixture.proof.outputs.find((item) => item.path === `${namespace}/index.js.map`);
    return { supported: true, packageRoot: ownedCore, name: '@wyreup/core', version: '0.0.0-unit-only',
      package: { ...fixture.proof.packageManifest, path: path.join(ownedCore, 'package.json') },
      entry: { ...entry, path: path.join(ownedCore, 'dist', entry.path) },
      map: { ...map, path: path.join(ownedCore, 'dist', map.path) } };
  }
  const records = [];
  const stages = ['prerender-start', 'prerender-end', 'client-start', 'client-end', 'build-done'];
  for (const [sequence, stage] of stages.entries()) {
    const record = { version: 1, runId, sequence, stage };
    if (stage !== 'build-done') {
      record.environment = stage.startsWith('client') ? 'client' : 'prerender';
      const value = environment(); value.config.consumer = record.environment === 'client' ? 'client' : 'server';
      record.policy = projectBindingPolicy(value);
      record.core = core(record.environment === 'client' ? 'browser' : 'node');
    } else {
      record.outputDir = path.join(fixture.directory, 'owned-browser/packages/web/dist');
      record.observer = { path: path.join(fixture.directory, 'owned-browser/packages/web/test/productionBuildBindingObserver.mjs'), bytes: observer.length, sha256: sha(observer) };
      record.identities = [{ environment: 'prerender', core: core('node') }, { environment: 'client', core: core('browser') }];
    }
    records.push(await fixture.write(`${suffix}/${String(sequence).padStart(2, '0')}-${stage}.json`, JSON.stringify(record) + '\n'));
  }
  const totalBytes = records.reduce((total, item) => total + item.bytes, 0);
  records.push(durable);
  records.push(await fixture.write(`${suffix}/terminal.json`, JSON.stringify({ version: 1, runId, completed: true, records: 5, totalBytes, stages, claimLimits: claims }) + '\n'));
  const build = { cwd: path.join(fixture.directory, 'owned-browser/packages/web'),
    inputs: [], preparedInputs: [], artifacts: [], dependencyIdentities: [],
    generatedInputs: [
      { ...durable, path: 'packages/web/astro.acceptance.config.mjs' },
      { ...observerPin, path: observerPath },
    ],
    browserBindingObservation: { mode: 'production-source-artifact-context-v1', runId,
      proofPin: { path: `docs/catalog-artifacts/${runId}/core-build-proof.json`, bytes: proofBytes.length, sha256: sha(proofBytes) },
      consumedCoordinatedCoreDist: { packageTarget: 'packages/core', outputs: fixture.proof.outputs },
      observationDir: literal.observationDir, durableConfig: durable, records, failures: [],
      templateBinding: { helperSource: helperPin, literals: literal, originalRoot: fixture.directory, producerPathConvention: path.sep === '/' ? 'posix' : 'win32' } } };
  const producer = { productionBuildManifest: undefined,
    manifest: { path: `docs/catalog-artifacts/${runId}/browser-producer-manifest.json` } };
  const manifest = { run: runId, resolvedProductionBuild: { mode: 'owned-production-build' },
    browserProductionArtifactContextBinding: { version: 1, runId, origin: 'http://127.0.0.1:49152',
      browserResponses: [], controllerSnapshots: [], emittedArtifacts: [], emittedWorkerEvidence: [], bindingFailures: [], claimLimits: claims } };
  async function saveBuild() {
    const terminalPin = build.browserBindingObservation.records.find((item) => item.path.endsWith('/terminal.json'));
    if (terminalPin) {
      const terminal = JSON.parse(await fs.readFile(path.join(fixture.directory, terminalPin.path), 'utf8'));
      terminal.totalBytes = build.browserBindingObservation.records.filter((item) => /\/[0-9]{2}-/.test(item.path)).reduce((total, item) => total + item.bytes, 0);
      const terminalBytes = Buffer.from(JSON.stringify(terminal) + '\n');
      await fs.writeFile(path.join(fixture.directory, terminalPin.path), terminalBytes);
      terminalPin.bytes = terminalBytes.length; terminalPin.sha256 = sha(terminalBytes);
    }
    const file = `docs/catalog-artifacts/${runId}/production-build-manifest.json`;
    const bytes = Buffer.from(JSON.stringify(build));
    await fs.writeFile(path.join(fixture.directory, file), bytes);
    producer.productionBuildManifest = { path: file, bytes: bytes.length, sha256: sha(bytes) };
  }
  await saveBuild();
  return { ...fixture, build, producer, manifest, saveBuild, suffix };
}
for (const [name, mutate, message] of [
  ['mixed run', (fixture) => { fixture.manifest.run = 'other-run'; }, /run identity mismatch/],
  ['coordinated legacy mode', (fixture) => { fixture.manifest.resolvedProductionBuild.mode = 'coordinated-dist'; }, /run identity mismatch/],
  ['missing terminal', (fixture) => { fixture.build.browserBindingObservation.records = fixture.build.browserBindingObservation.records.filter((item) => !item.path.endsWith('/terminal.json')); }, /Incomplete browser build observation/],
  ['mixed sidecar suffix', (fixture) => { fixture.build.browserBindingObservation.observationDir += '-other'; }, /run identity mismatch/],
  ['durable config removal', async (fixture) => { await fs.rm(path.join(fixture.directory, fixture.build.browserBindingObservation.durableConfig.path)); }, /generated-config template mismatch/],
  ['nonliteral config line', async (fixture) => {
    const pin = fixture.build.browserBindingObservation.durableConfig;
    const bytes = Buffer.from((await fs.readFile(path.join(fixture.directory, pin.path), 'utf8')).replace('export default {', 'export default {\n  resolve: { alias: [] },'));
    await fs.writeFile(path.join(fixture.directory, pin.path), bytes); pin.bytes = bytes.length; pin.sha256 = sha(bytes);
    Object.assign(fixture.build.generatedInputs.find((item) => item.path.endsWith('astro.acceptance.config.mjs')), { bytes: bytes.length, sha256: sha(bytes) });
  }, /generated-config template mismatch/],
  ['copied observer contradiction', (fixture) => { fixture.build.generatedInputs.find((item) => item.path.endsWith('productionBuildBindingObserver.mjs')).sha256 = 'a'.repeat(64); }, /generated-config template mismatch/],
  ['SW response', (fixture) => { fixture.manifest.browserProductionArtifactContextBinding.browserResponses.push({ fromServiceWorker: true }); }, /served by service worker/],
  ['ambient controller', (fixture) => { fixture.manifest.browserProductionArtifactContextBinding.controllerSnapshots.push({ controlled: true }); }, /served by service worker/],
  ['unknown policy field', async (fixture) => {
    const pin = fixture.build.browserBindingObservation.records.find((item) => item.path.endsWith('-client-start.json'));
    const record = JSON.parse(await fs.readFile(path.join(fixture.directory, pin.path), 'utf8'));
    record.policy.unreviewed = true;
    const bytes = Buffer.from(JSON.stringify(record)); await fs.writeFile(path.join(fixture.directory, pin.path), bytes);
    pin.bytes = bytes.length; pin.sha256 = sha(bytes);
  }, /Incomplete browser build observation/],
  ['wrong environment with individually valid equal-content map pins', async (fixture) => {
    for (const pin of fixture.build.browserBindingObservation.records.filter((item) => /-client-(start|end)\.json$/.test(item.path))) {
      const record = JSON.parse(await fs.readFile(path.join(fixture.directory, pin.path), 'utf8'));
      record.core.map.path = record.core.map.path.replace('/browser/', '/node/');
      const bytes = Buffer.from(JSON.stringify(record)); await fs.writeFile(path.join(fixture.directory, pin.path), bytes);
      pin.bytes = bytes.length; pin.sha256 = sha(bytes);
    }
  }, /core environment-map mismatch/],
]) test(`unit-only protocol refuses ${name}; not a genuine build fixture`, async () => {
  const fixture = await protocolFixture();
  try { await mutate(fixture); await fixture.saveBuild(); await assert.rejects(checkBrowserProductionBinding(fixture.directory, fixture.producer, fixture.manifest, { id: 'stopwatch' }), message); }
  finally { await fixture.close(); }
});
