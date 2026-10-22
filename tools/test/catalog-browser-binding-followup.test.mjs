import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { checkBrowserProductionBinding } from '../check-catalog-evidence.mjs';

// Applied path: tools/test/catalog-browser-binding-followup.test.mjs.
// UNIT ONLY: real parser/whole-check execution, synthetic source/maps/build metadata.
// No native tool build, browser, source runtime, SDK, catalogue or release evidence.
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const runId = 'unit-whole-binding-followup';
const prefix = `docs/catalog-artifacts/${runId}`;
const suffix = `${prefix}/build-evidence/binding-${runId}`;
const helperPath = 'packages/web/test/productionBrowserHarness.ts';
const observerPath = 'packages/web/test/productionBuildBindingObserver.mjs';
const marker = '__WYREUP_BINDING_OPTIONS_JSON__';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const claims = { consumedModuleGraphObserved: false, moduleLevelViteMapping: false,
  midiWorkerBuildGraphObserved: false, workerDistToEmittedAssociation: false,
  fixedWorkflowOnly: true, servedResponseBodyEquality: false };
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
const sourceBodies = {
  'package.json': '{"private":true,"unitOnly":true}',
  'pnpm-lock.yaml': 'UNIT ONLY; not an installed lockfile\n',
  'pnpm-workspace.yaml': 'packages: []\n',
  'packages/core/package.json': JSON.stringify({ name: '@wyreup/core', version: '0.0.0-unit-only',
    scripts: { build: 'tsup' }, exports: { '.': { browser: './dist/browser/index.js', node: './dist/node/index.js' } } }),
  'packages/core/tsup.config.ts': '// UNIT ONLY metadata; no tsup invocation\n',
  'packages/core/tsconfig.json': '{}',
  'packages/core/src/index.ts': "export { middleCounter as selectedCounter } from './bridge.js';\nexport type { CounterInfo } from './types.js';\n",
  'packages/core/src/bridge.ts': "export { counterDefinition as middleCounter } from './definition.js';\n",
  'packages/core/src/definition.ts': 'export const counterDefinition = 1;\n',
  'packages/core/src/types.ts': 'export interface CounterInfo { n: number }\n',
  'packages/web/package.json': '{"name":"unit-only-web","private":true}',
  'packages/web/src/pages/tools/[slug].astro': "---\nimport { selectedCounter } from '@wyreup/core';\n---\n<p>{selectedCounter}</p>\n",
  'packages/web/src/layouts/BaseLayout.astro': '<html><body><slot /></body></html>\n',
  'packages/web/src/components/ToolRunner.svelte': "<script>import { configured } from './shared.js';</script><p>{configured}</p>\n",
  'packages/web/src/components/shared.ts': "import owner from 'unit-context';\nimport type { CounterInfo } from '@wyreup/core';\nexport const configured = 1;\n",
  'packages/web/src/components/runners/StopwatchRunner.svelte': "<script>import { selectedCounter } from '@wyreup/core';</script><p>{selectedCounter}</p>\n",
  'packages/web/src/components/runners/variantMap.ts': "export const VARIANT_MAP = { stopwatch: 'StopwatchRunner' };\n",
  'packages/web/astro.config.mjs': 'export default {};\n',
  'packages/web/src/sw.ts': 'export const unitOnlyServiceWorkerSource = true;\n',
  'packages/web/scripts/pwa.mjs': 'export const unitOnlyPwaSource = true;\n',
  'packages/web/scripts/copy-skills.mjs': 'export const unitOnlyPreparationSource = true;\n',
  'packages/web/test/fixtures/ProductionCatalogHarness.svelte': '<p>UNIT ONLY harness source</p>\n',
  'packages/web/test/fixtures/ProductionCatalogRoute.astro.txt': '<p>UNIT ONLY route source</p>\n',
  'packages/web/public/_headers': '/*\n  X-Unit-Only: true\n',
  'packages/skill/skill.md': 'UNIT ONLY web skill source\n',
  'packages/cli-skill/skill.md': 'UNIT ONLY CLI skill source\n',
  'packages/mcp-skill/skill.md': 'UNIT ONLY MCP skill source\n',
};

function policy(environment) {
  const absent = () => ({ kind: 'absent' });
  return { consumer: environment === 'client' ? 'client' : 'server', command: 'build', mode: 'production',
    resolve: { conditions: ['browser'], externalConditions: absent(), mainFields: ['browser', 'module'],
      extensions: absent(), dedupe: absent(), preserveSymlinks: absent(), builtins: absent(),
      noExternal: [], external: [], alias: [] },
    build: { ssr: false, target: 'es2022', outDir: '/unit-output', rolldownOptions: { external: [] } },
    worker: { format: 'es', rolldownOptions: { external: [] } } };
}

async function wholeFixture({ dollarPath = false } = {}) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'binding-whole-unit-')));
  const root = dollarPath ? path.join(base, 'valid-$&-$$') : base;
  await fs.mkdir(root, { recursive: true });
  let closed = false;
  const bodies = new Map();
  const pins = new Map();
  async function write(relative, content) {
    assert(!closed, 'No fixture writes after cleanup.');
    assert.equal(path.posix.isAbsolute(relative), false);
    assert.equal(relative.split('/').includes('..'), false);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    if (/\.(js|mjs|cjs)$/.test(relative)) {
      // Own syntax-only Node process immediately after each generated JS write.
      execFileSync(process.execPath, ['--check', '--input-type=module'], {
        input: bytes, timeout: 5000, killSignal: 'SIGTERM', env: { PATH: process.env.PATH ?? '' },
      });
    }
    bodies.set(relative, bytes);
    const pin = { path: relative, bytes: bytes.length, sha256: sha(bytes) };
    pins.set(relative, pin);
    return pin;
  }
  async function close() {
    if (closed) return;
    closed = true;
    // Delete only this exact mkdtemp tree; symlink targets are never traversed.
    await fs.rm(base, { recursive: true });
  }
  try {
    for (const [file, body] of Object.entries(sourceBodies)) await write(file, body);
    await write('UNIT-ONLY-NOT-PRODUCER-EVIDENCE.txt', 'Synthetic fixture: no tsup/Astro/browser/source-runtime or accepted Stage A run.\n');
    const helperPin = await write(helperPath, await fs.readFile(path.join(projectRoot, helperPath)));
    const observerPin = await write(observerPath, await fs.readFile(path.join(projectRoot, observerPath)));
    const checkerPin = await write('tools/check-catalog-evidence.mjs', await fs.readFile(path.join(projectRoot, 'tools/check-catalog-evidence.mjs')));

    // Actual installed parser modules are read through the ordinary web anchor.
    const parserModules = await fs.realpath(path.join(projectRoot, 'packages/web/node_modules'));
    await fs.symlink(parserModules, path.join(root, 'packages/web/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

    const compilerTool = await write('unit-dependencies/tsup/tool.mjs', 'export const unitOnlyCompilerMetadata = true;\n');
    const compilerPackage = await write('unit-dependencies/tsup/package.json', JSON.stringify({ name: 'tsup', version: '0.0.0-unit-only', bin: { tsup: './tool.mjs' } }));
    const contextPackage = await write('unit-dependencies/context/package.json', JSON.stringify({ name: 'unit-context', version: '0.0.0-unit-only' }));
    await fs.mkdir(path.join(root, 'packages/core/node_modules'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.symlink(path.join(root, 'unit-dependencies/tsup'), path.join(root, 'packages/core/node_modules/tsup'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.symlink(path.join(root, 'unit-dependencies/context'), path.join(root, 'node_modules/unit-context'), process.platform === 'win32' ? 'junction' : 'dir');
    const contextOwner = { packageRoot: path.join(root, 'unit-dependencies/context'), name: 'unit-context', version: '0.0.0-unit-only',
      packageJson: { ...contextPackage, path: path.join(root, contextPackage.path) }, logicalRoots: ['node_modules/unit-context'] };
    const nodePath = await fs.realpath(process.execPath), nodeBytes = await fs.readFile(nodePath);
    const proof = { schemaVersion: 1, mode: 'owned-current-core-build-v1', runId,
      sourceRoot: root, ownedBuildRoot: path.join(root, 'owned-unit-compile'), sourceInputs: [], sourceInputsAfter: [],
      dependencyIdentities: [{ packageRoot: path.join(root, 'unit-dependencies/tsup'), name: 'tsup', version: '0.0.0-unit-only',
        packageJson: { ...compilerPackage, path: path.join(root, compilerPackage.path) },
        toolPins: [{ ...compilerTool, path: path.join(root, compilerTool.path) }] }],
      build: { argv: [nodePath, path.join(root, compilerTool.path)], cwd: path.join(root, 'owned-unit-compile/packages/core'),
        node: { path: nodePath, version: process.version, bytes: nodeBytes.length, sha256: sha(nodeBytes) },
        environment: { NODE_ENV: 'production' },
        configPin: await write(`${prefix}/unit-config.ts`, '// UNIT ONLY no actual config evaluation\n'),
        log: await write(`${prefix}/unit-build-log.txt`, 'UNIT ONLY: no native tool build was executed\n'),
        outcome: { exitCode: 0, signal: null, exitObserved: true, closeObserved: true, logWritersSettled: true } },
      outputRoot: 'core-build-output', outputs: [], packageManifest: undefined,
      sourcePathMapping: { originalPrefix: path.join(root, 'packages/core'), ownedPrefix: path.join(root, 'owned-unit-compile/packages/core'), logicalPrefix: 'packages/core/' } };
    const mapSources = ['definition', 'index', 'bridge', 'types'];
    for (const namespace of ['browser', 'node']) {
      await write(`${prefix}/core-build-output/${namespace}/index.js`, 'export const selectedCounter = 1;\n');
      await write(`${prefix}/core-build-output/${namespace}/index.js.map`, JSON.stringify({ version: 3, file: 'index.js', names: [], mappings: 'AAAA',
        sources: mapSources.map(name => `../../src/${name}.ts`), sourcesContent: mapSources.map(name => sourceBodies[`packages/core/src/${name}.ts`]) }));
      await write(`${prefix}/core-build-output/${namespace}/index.d.ts`, 'export declare const selectedCounter: number;\n');
    }
    await write(`${prefix}/core-build-output/node/index.cjs`, 'module.exports = { selectedCounter: 1 };\n');
    const origin = 'http://127.0.0.1:49152';
    const artifacts = [];
    const emitted = [];
    const responses = [];
    const emittedSpecifications = [
      ['tools/stopwatch/index.html', '/tools/stopwatch/', 'document', '<p>UNIT ONLY emitted document</p>\n'],
      ['_astro/app.js', '/_astro/app.js', 'script', 'export const unitOnlyArtifact = true;\n'],
      ['_astro/app.css', '/_astro/app.css', 'stylesheet', 'body { color: black; }\n'],
      ['_astro/font.woff', '/_astro/font.woff', 'font', 'UNIT ONLY font bytes, no font/browser decoding claim\n'],
      ['_astro/file-worker.js', '/_astro/file-worker.js', null, 'export const unitOnlyWorkerContext = true;\n'],
    ];
    for (const [logicalPath, pathname, resourceType, content] of emittedSpecifications) {
      const captured = await write(`${prefix}/build-evidence/emitted/${logicalPath}`, content);
      artifacts.push({ ...captured, path: logicalPath });
      emitted.push({ ...captured, logicalPath, url: origin + pathname });
      if (resourceType) responses.push({ url: origin + pathname, resourceType, status: 200, fromServiceWorker: false });
    }
    const literals = { runId, observationDir: path.join(root, suffix), observerIdentity: { relativePath: observerPath, bytes: observerPin.bytes, sha256: observerPin.sha256 } };
    const binding = { mode: 'production-source-artifact-context-v1', runId, proofPin: undefined,
      consumedCoordinatedCoreDist: { packageTarget: 'packages/core', outputs: [] }, observationDir: literals.observationDir,
      durableConfig: undefined, records: [], failures: [],
      templateBinding: { declaration: 'BINDING_CONFIG_TEMPLATE', marker, helperSource: helperPin, literals,
        originalRoot: root, producerPathConvention: path.sep === '/' ? 'posix' : 'win32' } };
    const build = { cwd: path.join(root, 'owned-browser/packages/web'), inputs: [], preparedInputs: [], artifacts,
      dependencyIdentities: [contextOwner], generatedInputs: [], browserBindingObservation: binding };
    for (const [name, source] of [['', 'skill'], ['-cli', 'cli-skill'], ['-mcp', 'mcp-skill']]) {
      build.preparedInputs.push(await write(`packages/web/public/skills/wyreup${name}.md`, sourceBodies[`packages/${source}/skill.md`]));
    }
    build.inputs = Object.keys(sourceBodies).map(file => pins.get(file));
    const producer = { commandSourcePins: [helperPin, observerPin, checkerPin], manifest: undefined, productionBuildManifest: undefined };
    const manifest = { run: runId, resolvedProductionBuild: { mode: 'owned-production-build' },
      browserProductionArtifactContextBinding: { version: 1, runId, origin, browserResponses: responses,
        controllerSnapshots: [], emittedArtifacts: emitted, emittedWorkerEvidence: [origin + '/_astro/file-worker.js'], bindingFailures: [], claimLimits: claims } };
    const state = { templateLines: [...templateLines], mapSources, records: [] };
    const sort = values => values.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    function core(namespace) {
      const entry = proof.outputs.find(item => item.path === `${namespace}/index.js`);
      const map = proof.outputs.find(item => item.path === `${namespace}/index.js.map`);
      const ownedCore = path.join(root, 'owned-browser/packages/core');
      return { supported: true, packageRoot: ownedCore, name: '@wyreup/core', version: '0.0.0-unit-only',
        package: { ...proof.packageManifest, path: path.join(ownedCore, 'package.json') },
        entry: { ...entry, path: path.join(ownedCore, 'dist', entry.path) }, map: { ...map, path: path.join(ownedCore, 'dist', map.path) } };
    }
    async function save({ mutateRecords } = {}) {
      proof.sourceInputs = sort([...pins.values()].filter(item => ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/core/package.json', 'packages/core/tsup.config.ts', 'packages/core/tsconfig.json'].includes(item.path) || item.path.startsWith('packages/core/src/')).map(item => ({ ...item })));
      proof.sourceInputsAfter = structuredClone(proof.sourceInputs);
      proof.packageManifest = proof.sourceInputs.find(item => item.path === 'packages/core/package.json');
      proof.outputs = sort([...pins.values()].filter(item => item.path.startsWith(`${prefix}/core-build-output/`)).map(item => ({ ...item, path: item.path.slice(`${prefix}/core-build-output/`.length) })));
      binding.proofPin = await write(`${prefix}/core-build-proof.json`, JSON.stringify(proof));
      binding.consumedCoordinatedCoreDist.outputs = structuredClone(proof.outputs);
      // Independent exact renderer: function replacement never interprets path dollars.
      const config = state.templateLines.join('\n').replace(marker, () => JSON.stringify(literals));
      binding.durableConfig = await write(`${suffix}/generated-config.mjs.txt`, config);
      await write('packages/web/astro.acceptance.config.mjs', config);
      build.generatedInputs = [{ ...binding.durableConfig, path: 'packages/web/astro.acceptance.config.mjs' }, { ...observerPin }];
      const stages = ['prerender-start', 'prerender-end', 'client-start', 'client-end', 'build-done'];
      state.records = stages.map((stage, sequence) => {
        if (stage === 'build-done') return { version: 1, runId, sequence, stage, outputDir: path.join(build.cwd, 'dist'),
          observer: { path: path.join(build.cwd, 'test/productionBuildBindingObserver.mjs'), bytes: observerPin.bytes, sha256: observerPin.sha256 } };
        const environment = stage.startsWith('client') ? 'client' : 'prerender';
        return { version: 1, runId, sequence, stage, environment, policy: policy(environment), core: core(environment === 'client' ? 'browser' : 'node') };
      });
      if (mutateRecords) mutateRecords(state.records);
      state.records[4].identities = ['prerender', 'client'].map(environment => ({ environment,
        core: structuredClone(state.records.find(item => item.stage === `${environment}-end`).core) }));
      binding.records = [];
      for (const record of state.records) binding.records.push(await write(`${suffix}/${String(record.sequence).padStart(2, '0')}-${record.stage}.json`, JSON.stringify(record) + '\n'));
      const totalBytes = binding.records.reduce((total, item) => total + item.bytes, 0);
      binding.records.push(binding.durableConfig);
      binding.records.push(await write(`${suffix}/terminal.json`, JSON.stringify({ version: 1, runId, completed: true, records: 5, totalBytes, stages, claimLimits: claims }) + '\n'));
      producer.productionBuildManifest = await write(`${prefix}/production-build-manifest.json`, JSON.stringify(build));
      producer.manifest = await write(`${prefix}/browser-producer-manifest.json`, JSON.stringify(manifest));
    }
    await save();
    const check = () => checkBrowserProductionBinding(root, producer, manifest, { id: 'stopwatch' });
    async function changeSource(file, content) {
      const pin = await write(file, content);
      const index = build.inputs.findIndex(item => item.path === file);
      if (index >= 0) build.inputs[index] = pin;
      return pin;
    }
    async function changeMap(namespace, mutate) {
      const file = `${prefix}/core-build-output/${namespace}/index.js.map`;
      const map = JSON.parse(bodies.get(file).toString('utf8'));
      mutate(map);
      await write(file, JSON.stringify(map));
    }
    return { root, base, write, close, bodies, pins, proof, build, binding, producer, manifest, state, save, check, changeSource, changeMap };
  } catch (error) {
    await close();
    throw error;
  }
}

test('UNIT ONLY whole exported checker completes with populated source/preparation/dependency/maps/artifacts', async () => {
  const f = await wholeFixture();
  try {
    assert(f.build.inputs.length > 20);
    assert.equal(f.build.preparedInputs.length, 3);
    assert.equal(f.build.dependencyIdentities.length, 1);
    assert.equal(f.build.artifacts.length, 5);
    const result = await f.check();
    assert.equal(result.rowPromotion, 'pending');
    assert.equal(result.fullMidiSourceQualification, 'held');
    assert.deepEqual(result.claimLimits, claims);
    for (const file of ['packages/core/src/index.ts', 'packages/core/src/bridge.ts']) {
      assert(result.derivedRoles.some(role => role.logicalPath === file && role.captureClass === 'selected-named-export-edge'));
      assert.equal(result.derivedRoles.some(role => role.logicalPath === file && role.captureClass === 'selected-core-runtime'), false);
    }
    const leaf = result.derivedRoles.find(role => role.logicalPath === 'packages/core/src/definition.ts' && role.captureClass === 'selected-core-runtime');
    assert(leaf);
    assert.deepEqual(leaf.association.map(item => item.environment).sort(), ['client', 'prerender']);
    assert(result.derivedRoles.some(role => role.captureClass === 'selected-dependency-context'));
    assert.equal(result.derivedRoles.filter(role => role.captureClass === 'preparation-output').length, 3);
  } finally { await f.close(); }
});

function refusal(name, mutate, expected) {
  test(`UNIT ONLY whole-check refusal: ${name}`, async () => {
    const f = await wholeFixture();
    try {
      // Every mutation begins with an independently completing WHOLE checker.
      const baseline = await f.check();
      assert.equal(baseline.rowPromotion, 'pending');
      await mutate(f);
      await f.save();
      await assert.rejects(f.check(), error => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message, expected);
        return true;
      });
    } finally { await f.close(); }
  });
}

const unmapped = 'Browser binding unmapped source role';
const copied = 'Browser binding copied-input mismatch';
const templateMismatch = 'Browser binding generated-config template mismatch';
const emittedMismatch = 'Browser binding emitted artifact path mismatch';
const parserRefusal = 'Browser binding source parser refusal';
const sourceAssociation = 'Browser binding core source association mismatch';

void refusal('missing binding-failure observation', f => {
  delete f.manifest.browserProductionArtifactContextBinding.bindingFailures;
}, 'Incomplete browser build observation');
for (const [name, value] of [
  ['null', null], ['false', false], ['zero', 0], ['empty string', ''],
  ['object', {}], ['array-like object', { length: 0 }], ['nonempty array', ['capture failed']],
]) {
  void refusal(`invalid binding-failure observation: ${name}`, f => {
    f.manifest.browserProductionArtifactContextBinding.bindingFailures = value;
  }, 'Incomplete browser build observation');
}

void refusal('missing named preparation record', f => {
  f.build.preparedInputs = f.build.preparedInputs.filter(pin => pin.path !== 'packages/web/public/skills/wyreup.md');
}, unmapped);
void refusal('altered selected preparation identity while actual prepared bytes stay fixed', f => {
  f.build.preparedInputs.find(pin => pin.path === 'packages/web/public/skills/wyreup.md').sha256 = '0'.repeat(64);
}, unmapped);
void refusal('conflicting duplicate preparation record', f => {
  f.build.preparedInputs.push(structuredClone(f.build.preparedInputs[0]));
}, unmapped);
void refusal('removed selected owning dependency', f => { f.build.dependencyIdentities = []; }, unmapped);
void refusal('altered selected owning dependency identity with actual metadata fixed', f => {
  f.build.dependencyIdentities[0].packageJson.sha256 = '0'.repeat(64);
}, unmapped);
void refusal('duplicate selected owning dependency', f => {
  f.build.dependencyIdentities.push(structuredClone(f.build.dependencyIdentities[0]));
}, unmapped);
void refusal('emitted output cannot borrow copied-original authority', f => {
  const asset = f.build.artifacts.find(pin => pin.path === '_astro/app.js');
  f.build.inputs.push(structuredClone(asset));
  f.build.artifacts = f.build.artifacts.filter(pin => pin.path !== '_astro/app.js');
}, unmapped);
void refusal('conflicting emitted artifact inventory entry', f => {
  f.build.artifacts.push(structuredClone(f.build.artifacts[0]));
}, unmapped);
void refusal('actual reached first-party module missing from copied inventory', async f => {
  await f.changeSource('packages/web/src/components/shared.ts', sourceBodies['packages/web/src/components/shared.ts'] + "import './unmapped.ts';\n");
  await f.write('packages/web/src/components/unmapped.ts', 'export const unitOnlyUnmapped = 1;\n');
}, copied);
void refusal('current copied byte change cannot use prior source identity', async f => {
  // Intentionally do not update this original input pin; other inventories stay valid.
  await f.write('packages/web/src/layouts/BaseLayout.astro', sourceBodies['packages/web/src/layouts/BaseLayout.astro'] + '\n');
}, copied);

for (const [name, body] of [
  ['changed public export alias', "export { middleCounter as wrongName } from './bridge.js';\n"],
  ['star export cannot impersonate selected named edge', "export * from './bridge.js';\n"],
  ['type-only export cannot impersonate runtime import', "export type { middleCounter as selectedCounter } from './bridge.js';\n"],
  ['unexported definition cannot impersonate selected pure edge', 'const selectedCounter = 1;\n'],
  ['comment text cannot impersonate selected named edge', "// export { middleCounter as selectedCounter } from './bridge.js';\nexport const unrelated = 1;\n"],
]) void refusal(name, async f => { await f.changeSource('packages/core/src/index.ts', body); }, parserRefusal);
void refusal('malformed actual reached TypeScript is not a regex edge', async f => {
  await f.changeSource('packages/web/src/components/shared.ts', 'export const configured = ;\n');
}, parserRefusal);
void refusal('unsupported dynamic core import is refused through the actual AST', async f => {
  await f.changeSource('packages/web/src/components/shared.ts', "const loaded = import('@wyreup/core');\nexport const configured = 1;\n");
}, parserRefusal);

void refusal('removed current runtime-source association with valid archived map pins', async f => {
  for (const namespace of ['browser', 'node']) await f.changeMap(namespace, map => {
    map.sources.splice(0, 1); map.sourcesContent.splice(0, 1);
  });
}, sourceAssociation);
void refusal('invented static map source path is not a current runtime-source association', async f => {
  await f.changeMap('browser', map => { map.sources[0] = '../../src/invented.ts'; });
}, sourceAssociation);
void refusal('changed selected sourcesContent cannot borrow a pure-edge source map entry', async f => {
  await f.changeMap('browser', map => { map.sourcesContent[0] = sourceBodies['packages/core/src/index.ts']; });
}, sourceAssociation);

test('UNIT ONLY whole-check refuses wrong-environment map with all individual output pins valid', async () => {
  const f = await wholeFixture();
  try {
    await f.check();
    await f.save({ mutateRecords(records) {
      for (const record of records.filter(item => item.environment === 'client')) {
        record.core.map.path = record.core.map.path.replace(`${path.sep}browser${path.sep}`, `${path.sep}node${path.sep}`);
      }
    } });
    await assert.rejects(f.check(), error => {
      assert.equal(error.message, 'Browser binding core environment-map mismatch'); return true;
    });
  } finally { await f.close(); }
});

void refusal('different confined helper cannot become reviewed template authority', async f => {
  f.state.templateLines.splice(6, 0, '  resolve: { alias: [] },');
  const evil = await f.write('packages/web/test/unreviewedTemplate.ts', `const BINDING_CONFIG_TEMPLATE = ${JSON.stringify(f.state.templateLines)}.join('\\n');\n`);
  f.binding.templateBinding.helperSource = evil;
  f.producer.commandSourcePins.push(evil);
}, templateMismatch);
void refusal('missing actual command helper authority', f => {
  f.producer.commandSourcePins = f.producer.commandSourcePins.filter(pin => pin.path !== helperPath);
}, templateMismatch);
void refusal('conflicting actual command helper pin', f => {
  f.producer.commandSourcePins = f.producer.commandSourcePins.map(pin => pin.path === helperPath ? { ...pin, sha256: '0'.repeat(64) } : pin);
}, templateMismatch);
void refusal('incorrect template declaration contract', f => { f.binding.templateBinding.declaration = 'OTHER_TEMPLATE'; }, templateMismatch);
void refusal('incorrect template marker contract', f => { f.binding.templateBinding.marker = 'OTHER_MARKER'; }, templateMismatch);

void refusal('selected script response requires its own captured emitted artifact', f => {
  f.manifest.browserProductionArtifactContextBinding.emittedArtifacts = f.manifest.browserProductionArtifactContextBinding.emittedArtifacts.filter(pin => pin.logicalPath !== '_astro/app.js');
}, emittedMismatch);
void refusal('selected worker context requires its own captured emitted artifact', f => {
  f.manifest.browserProductionArtifactContextBinding.emittedArtifacts = f.manifest.browserProductionArtifactContextBinding.emittedArtifacts.filter(pin => pin.logicalPath !== '_astro/file-worker.js');
}, emittedMismatch);
void refusal('engine own route document cannot be absent despite other valid captures', f => {
  const c = f.manifest.browserProductionArtifactContextBinding;
  c.browserResponses = c.browserResponses.filter(item => item.resourceType !== 'document');
  c.emittedArtifacts = c.emittedArtifacts.filter(pin => pin.logicalPath !== 'tools/stopwatch/index.html');
}, emittedMismatch);
void refusal('absent emitted capture array is not empty credit', f => { delete f.manifest.browserProductionArtifactContextBinding.emittedArtifacts; }, emittedMismatch);
void refusal('nonarray emitted capture field is refused', f => { f.manifest.browserProductionArtifactContextBinding.emittedArtifacts = {}; }, emittedMismatch);
void refusal('absent worker evidence array is refused', f => { delete f.manifest.browserProductionArtifactContextBinding.emittedWorkerEvidence; }, emittedMismatch);
void refusal('nonarray worker evidence cannot use string includes as array membership', f => {
  f.manifest.browserProductionArtifactContextBinding.emittedWorkerEvidence = f.manifest.browserProductionArtifactContextBinding.emittedWorkerEvidence[0];
}, emittedMismatch);

test('UNIT ONLY valid dollar-containing path preserves exact literal JSON through whole checker', async () => {
  const f = await wholeFixture({ dollarPath: true });
  try {
    assert(f.root.includes('$&') && f.root.includes('$$'));
    const result = await f.check();
    assert.equal(result.rowPromotion, 'pending');
    assert.deepEqual(result.claimLimits, claims);
  } finally { await f.close(); }
});
