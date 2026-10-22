import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { checkBrowserProductionBinding } from '../check-catalog-evidence.mjs';

// Applied path: tools/test/catalog-browser-binding-parser-followup.test.mjs.
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


test('UNIT ONLY parser followup populated whole baseline completes', async () => {
  const f = await wholeFixture();
  try {
    const result = await f.check();
    assert.equal(result.rowPromotion, 'pending');
    assert.deepEqual(result.claimLimits, claims);
    assert.equal(f.build.preparedInputs.length, 3);
    assert.equal(f.build.dependencyIdentities.length, 1);
    assert.equal(f.build.artifacts.length, 5);
  } finally { await f.close(); }
});

function refuses(name, mutate) {
  test(`UNIT ONLY parser followup refuses: ${name}`, async () => {
    const f = await wholeFixture();
    try {
      const baseline = await f.check();
      assert.equal(baseline.rowPromotion, 'pending');
      await mutate(f);
      await f.save();
      await assert.rejects(f.check(), error => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message, 'Browser binding source parser refusal');
        return true;
      });
    } finally { await f.close(); }
  });
}

function svelteBody(addition) {
  return "<script>import { configured } from './shared.js';\n" + addition + "\n</script><p>{configured}</p>\n";
}

refuses('ToolRunner destructured dynamic core import is not silently excluded', async f => {
  await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(
    "async function unsupported() { const { selectedCounter } = await import('@wyreup/core'); return selectedCounter; }"));
});
refuses('ToolRunner bare dynamic core import is not silently excluded', async f => {
  await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(
    "const unsupported = import('@wyreup/core');"));
});

for (const [name, addition] of [
  ['identifier specifier', "const specifier = './shared.js'; const unsupported = import(specifier);"],
  ['substituted template specifier', "const name = 'shared'; const unsupported = import(\`./\${name}.js\`);"],
]) {
  refuses(`reached Svelte nonliteral import: ${name}`, async f => {
    await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(addition));
  });
  refuses(`reached TypeScript nonliteral import: ${name}`, async f => {
    await f.changeSource('packages/web/src/components/shared.ts',
      sourceBodies['packages/web/src/components/shared.ts'] + addition + '\n');
  });
}

refuses('Svelte module-script export-star cannot omit an unsupported reached edge', async f => {
  const hidden = await f.write('packages/web/src/components/hidden.ts',
    "export const hidden = import('@wyreup/core');\n");
  f.build.inputs.push(hidden);
  await f.changeSource('packages/web/src/components/ToolRunner.svelte',
    '<script context="module">export * from "./hidden.js";</script>\n' + svelteBody(''));
});
refuses('Svelte module-script core export-star cannot invent a selected named edge', async f => {
  await f.changeSource('packages/web/src/components/ToolRunner.svelte',
    '<script context="module">export * from "@wyreup/core";</script>\n' + svelteBody(''));
});
refuses('outer member above an array cannot name the enclosed dynamic core import', async f => {
  await f.changeSource('packages/web/src/components/runners/StopwatchRunner.svelte',
    "<script>import { selectedCounter } from '@wyreup/core'; async function unsupported() { return [await import('@wyreup/core')].selectedCounter; }</script><p>{selectedCounter}</p>\n");
});

function positive(name, mutate, inspect) {
  test(`UNIT ONLY parser followup positive: ${name}`, async () => {
    const f = await wholeFixture();
    try {
      assert.equal((await f.check()).rowPromotion, 'pending');
      await mutate(f);
      await f.save();
      const result = await f.check();
      assert.equal(result.rowPromotion, 'pending');
      assert.deepEqual(result.claimLimits, claims);
      inspect(result);
    } finally { await f.close(); }
  });
}

void positive('relative nonrunner lazy source is independently derived', async f => {
  const pin = await f.write('packages/web/src/components/lazy-context.ts', 'export const lazyContext = 1;\n');
  f.build.inputs.push(pin);
  await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(
    "const loadContext = () => import('./lazy-context.js');"));
}, result => {
  assert.equal(result.derivedRoles.filter(role => role.logicalPath === 'packages/web/src/components/lazy-context.ts'
    && role.captureClass === 'copied-original').length, 1);
});

void positive('literal selected runner remains supported', async f => {
  await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(
    "const loadRunner = () => import('./runners/StopwatchRunner.svelte');"));
}, result => {
  assert.equal(result.derivedRoles.filter(role => role.logicalPath === 'packages/web/src/components/runners/StopwatchRunner.svelte'
    && role.captureClass === 'copied-original').length, 1);
});

void positive('only an actually mapped nonselected runner may be skipped', async f => {
  await f.changeSource('packages/web/src/components/runners/variantMap.ts',
    "export const VARIANT_MAP = { stopwatch: 'StopwatchRunner', 'other-tool': 'OtherRunner' };\n");
  // OtherRunner intentionally has no file: this is only the declared nonselected route.
  await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(
    "const loadOther = () => import('./runners/OtherRunner.svelte');"));
}, result => {
  assert.equal(result.derivedRoles.some(role => typeof role.logicalPath === 'string' && role.logicalPath.endsWith('/OtherRunner.svelte')), false);
});

void positive('undeclared literal runner path is followed rather than blanket skipped', async f => {
  const pin = await f.write('packages/web/src/components/runners/UndeclaredRunner.svelte', '<p>Unit-only reached source</p>\n');
  f.build.inputs.push(pin);
  await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(
    "const loadOther = () => import('./runners/UndeclaredRunner.svelte');"));
}, result => {
  assert.equal(result.derivedRoles.filter(role => role.logicalPath === 'packages/web/src/components/runners/UndeclaredRunner.svelte'
    && role.captureClass === 'copied-original').length, 1);
});

for (const selectedFile of ['packages/web/src/components/ToolRunner.svelte', 'packages/web/src/components/runners/StopwatchRunner.svelte']) {
  void positive(`immediate awaited member supplies the sole runtime core edge: ${selectedFile}`, async f => {
    await f.changeSource('packages/web/src/pages/tools/[slug].astro', '<p>Unit-only route without a static core import</p>\n');
    await f.changeSource('packages/web/src/components/shared.ts',
      "import owner from 'unit-context'; export const configured = 1;\n");
    await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(''));
    await f.changeSource('packages/web/src/components/runners/StopwatchRunner.svelte', '<p>Unit-only runner</p>\n');
    const addition = "async function selected() { return ((await import('@wyreup/core'))).selectedCounter; }";
    await f.changeSource(selectedFile, selectedFile.endsWith('/ToolRunner.svelte')
      ? svelteBody(addition) : '<script>' + addition + '</script><p>Unit-only runner</p>\n');
  }, result => {
    const roles = result.derivedRoles.filter(role => role.captureClass === 'selected-core-runtime');
    assert.equal(roles.length, 1);
    assert.equal(roles[0].logicalPath, 'packages/core/src/definition.ts');
    assert.deepEqual(roles[0].association.map(item => item.environment).sort(), ['client', 'prerender']);
    for (const file of ['packages/core/src/index.ts', 'packages/core/src/bridge.ts']) {
      assert(result.derivedRoles.some(role => role.logicalPath === file && role.captureClass === 'selected-named-export-edge'));
    }
  });
}

async function onlyCoreReference(f, language, statement) {
  await f.changeSource('packages/web/src/pages/tools/[slug].astro', '<p>Unit-only route</p>\n');
  await f.changeSource('packages/web/src/components/shared.ts',
    "import owner from 'unit-context'; export const configured = 1;\n");
  await f.changeSource('packages/web/src/components/ToolRunner.svelte', svelteBody(''));
  await f.changeSource('packages/web/src/components/runners/StopwatchRunner.svelte', '<p>Unit-only runner</p>\n');
  const indexSource = sourceBodies['packages/core/src/index.ts'] + 'export const runtimeSentinel = 1;\n';
  await f.changeSource('packages/core/src/index.ts', indexSource);
  for (const namespace of ['browser', 'node']) {
    await f.changeMap(namespace, map => {
      const indexes = map.sources.flatMap((source, index) => source === '../../src/index.ts' ? [index] : []);
      assert.equal(indexes.length, 1);
      map.sourcesContent[indexes[0]] = indexSource;
    });
  }
  if (language === 'TypeScript') {
    await f.changeSource('packages/web/src/components/shared.ts',
      "import owner from 'unit-context';\n" + statement + '\nexport const configured = 1;\n');
  } else if (language === 'Astro') {
    await f.changeSource('packages/web/src/pages/tools/[slug].astro', '---\n' + statement + '\n---\n<p>Unit-only route</p>\n');
  } else {
    await f.changeSource('packages/web/src/components/ToolRunner.svelte',
      '<script context="module" lang="ts">' + statement + '</script>\n' + svelteBody(''));
  }
}

for (const language of ['TypeScript', 'Astro', 'Svelte']) {
  for (const [kind, statement] of [
    ['side-effect import', "import '@wyreup/core';"],
    ['empty named import', "import {} from '@wyreup/core';"],
    ['all-type-specifier import', "import { type CounterInfo } from '@wyreup/core';"],
    ['empty named re-export', "export {} from '@wyreup/core';"],
    ['all-type-specifier re-export', "export { type CounterInfo } from '@wyreup/core';"],
  ]) {
    test(`SOURCE3 empty runtime core edge refuses: ${language} ${kind}`, async () => {
      const f = await wholeFixture();
      try {
        assert.equal((await f.check()).rowPromotion, 'pending');
        await onlyCoreReference(f, language, statement);
        await f.save();
        await assert.rejects(f.check(), error => {
          assert.equal(error instanceof Error, true);
          assert.equal(error.message, 'Browser binding source parser refusal');
          return true;
        });
      } finally { await f.close(); }
    });
  }
  test(`SOURCE3 explicit type-only core declaration remains supported: ${language}`, async () => {
    const f = await wholeFixture();
    try {
      assert.equal((await f.check()).rowPromotion, 'pending');
      await onlyCoreReference(f, language, "import type { CounterInfo } from '@wyreup/core';");
      await f.save();
      const result = await f.check();
      assert.equal(result.rowPromotion, 'pending');
      assert.deepEqual(result.claimLimits, claims);
      assert.equal(result.derivedRoles.some(role => role.captureClass === 'selected-core-runtime'), false);
      assert(result.derivedRoles.some(role => role.kind === 'type-only-export-edge'
        && role.logicalPath === 'packages/core/src/index.ts'));
    } finally { await f.close(); }
  });
}

// SOURCE4: actual whole-check parser operations with coherent UNIT_ONLY source/map records.
async function localReexportSource(f, relative, body) {
  await f.changeSource(relative, body);
  for (const namespace of ['browser', 'node']) {
    await f.changeMap(namespace, map => {
      const source = '../../src/' + relative.slice('packages/core/src/'.length);
      const matches = map.sources.flatMap((value, index) => value === source ? [index] : []);
      assert.equal(matches.length, 1);
      map.sourcesContent[matches[0]] = body;
    });
  }
}

for (const [name, typeOnly, aliased] of [
  ['type import and local type export', true, false],
  ['type import and local export aliases', true, true],
  ['runtime class import and local export', false, false],
  ['runtime class import and local export aliases', false, true],
]) {
  test(`SOURCE4 local named reexport positive: ${name}`, async () => {
    const f = await wholeFixture();
    try {
      assert.equal((await f.check()).rowPromotion, 'pending');
      const localName = aliased ? 'localAlias' : typeOnly ? 'CounterInfo' : 'middleCounter';
      const targetName = typeOnly ? 'DeclaredInfo' : 'counterDefinition';
      const exportedName = typeOnly ? 'CounterInfo' : 'middleCounter';
      const file = typeOnly ? 'packages/core/src/types.ts' : 'packages/core/src/bridge.ts';
      if (typeOnly) await onlyCoreReference(f, 'TypeScript', "import type { CounterInfo } from '@wyreup/core';");
      const importStatement = `import${typeOnly ? ' type' : ''} { ${targetName} as ${localName} } from './definition.js';`;
      const exportStatement = `export${typeOnly ? ' type' : ''} { ${localName}${localName === exportedName ? '' : ' as ' + exportedName} };`;
      const body = importStatement + '\n' + exportStatement + '\n';
      await localReexportSource(f, file, body);
      await localReexportSource(f, 'packages/core/src/definition.ts', typeOnly
        ? 'export interface DeclaredInfo { n: number }\nexport const counterDefinition = 1;\n'
        : 'export class counterDefinition {}\n');
      await f.save();
      const result = await f.check();
      assert.equal(result.rowPromotion, 'pending');
      assert.deepEqual(result.claimLimits, claims);
      const roles = result.derivedRoles.filter(role => role.logicalPath === file
        && role.kind === (typeOnly ? 'type-only-export-edge' : 'named-export-edge'));
      assert.equal(roles.length, 1);
      const edge = roles[0].edge;
      assert.equal(edge.requestedName, exportedName);
      assert.equal(edge.exportedName, exportedName);
      assert.equal(edge.importedName, targetName);
      assert.equal(edge.supportingType, typeOnly);
      assert.equal(edge.moduleSpecifier, './definition.js');
      assert.equal(edge.start, importStatement.length + 1);
      assert.equal(edge.end, importStatement.length + 1 + exportStatement.length);
      assert.equal(edge.statementSha256, sha(Buffer.from(exportStatement)));
      assert.deepEqual(edge.localImport, { localName, importedName: targetName,
        moduleSpecifier: './definition.js', start: 0, end: importStatement.length,
        statementSha256: sha(Buffer.from(importStatement)) });
      assert.equal(edge.nextSourcePath, 'packages/core/src/definition.ts');
      assert.deepEqual(edge.nextSourcePin, f.pins.get('packages/core/src/definition.ts'));
      if (typeOnly) assert.equal(result.derivedRoles.some(role => role.captureClass === 'selected-core-runtime'), false);
      else for (const source of [file, 'packages/core/src/definition.ts']) {
        assert(result.derivedRoles.some(role => role.logicalPath === source && role.captureClass === 'selected-core-runtime'));
      }
    } finally { await f.close(); }
  });
}

for (const [name, source] of [
  ['missing local binding', 'export { absent as middleCounter };\n'],
  ['duplicate named imports', "import { counterDefinition as middleCounter } from './definition.js';\nimport { CounterInfo as middleCounter } from './types.js';\nexport { middleCounter };\n"],
  ['namespace binding', "import * as middleCounter from './definition.js';\nexport { middleCounter };\n"],
  ['default binding', "import middleCounter from './definition.js';\nexport { middleCounter };\n"],
  ['nonrelative named import', "import { counterDefinition as middleCounter } from 'unit-context';\nexport { middleCounter };\n"],
  ['runtime selection of type import', "import type { counterDefinition as middleCounter } from './definition.js';\nexport { middleCounter };\n"],
  ['runtime selection of type export', "import { counterDefinition as middleCounter } from './definition.js';\nexport type { middleCounter };\n"],
  ['missing exported target', "import { absent as middleCounter } from './definition.js';\nexport { middleCounter };\n"],
  ['cyclic imported reexport', "import { selectedCounter as middleCounter } from './index.js';\nexport { middleCounter };\n"],
  ['mismatched local alias', "import { counterDefinition as actualLocal } from './definition.js';\nexport { missingLocal as middleCounter };\n"],
]) {
  test(`SOURCE4 local named reexport refuses: ${name}`, async () => {
    const f = await wholeFixture();
    try {
      assert.equal((await f.check()).rowPromotion, 'pending');
      await localReexportSource(f, 'packages/core/src/bridge.ts', source);
      await f.save();
      await assert.rejects(f.check(), error => {
        assert(error instanceof Error);
        assert.equal(error.message, 'Browser binding source parser refusal');
        return true;
      });
    } finally { await f.close(); }
  });
}

// SOURCE5: empty generated context is reachable but never supplies a source role.
async function source5EmptyMapContext(f) {
  for (const namespace of ['browser', 'node']) {
    const directory = `${prefix}/core-build-output/${namespace}`;
    const entry = `${directory}/index.js`;
    await f.write(entry, "import './unit-empty-context.js';\n" + f.bodies.get(entry).toString('utf8'));
    await f.write(`${directory}/unit-empty-context.js`, 'export const unitOnlyGeneratedContext = 1;\n');
    await f.write(`${directory}/unit-empty-context.js.map`, JSON.stringify({ version: 3,
      file: 'unit-empty-context.js', names: [], mappings: '', sources: [], sourcesContent: [] }));
  }
}

async function source5ChangeEmptyMap(f, mutate) {
  for (const namespace of ['browser', 'node']) {
    const file = `${prefix}/core-build-output/${namespace}/unit-empty-context.js.map`;
    const map = JSON.parse(f.bodies.get(file).toString('utf8'));
    mutate(map);
    await f.write(file, JSON.stringify(map));
  }
}

function source5AssertNonemptyRole(result) {
  assert.equal(result.rowPromotion, 'pending');
  assert.deepEqual(result.claimLimits, claims);
  const roles = result.derivedRoles.filter(role => role.captureClass === 'selected-core-runtime'
    && role.logicalPath === 'packages/core/src/definition.ts');
  assert.equal(roles.length, 1);
  assert.deepEqual(roles[0].association.map(({ environment, sourceMap, sourceIndex }) =>
    ({ environment, sourceMap, sourceIndex })), [
    { environment: 'prerender', sourceMap: 'node/index.js.map', sourceIndex: 0 },
    { environment: 'client', sourceMap: 'browser/index.js.map', sourceIndex: 0 },
  ]);
  assert(roles[0].association.every(item => !item.sourceMap.endsWith('/unit-empty-context.js.map')));
}

test('SOURCE5 empty-source map omitted sourcesContent preserves role and missing-role refusal', async () => {
  const f = await wholeFixture();
  try {
    source5AssertNonemptyRole(await f.check());
    await source5EmptyMapContext(f);
    await f.save();
    source5AssertNonemptyRole(await f.check());
    await source5ChangeEmptyMap(f, map => { delete map.sourcesContent; });
    await f.save();
    source5AssertNonemptyRole(await f.check());
    for (const namespace of ['browser', 'node']) {
      await f.changeMap(namespace, map => {
        assert.equal(map.sources[0], '../../src/definition.ts');
        map.sourcesContent[0] = null;
      });
    }
    await f.save();
    await assert.rejects(f.check(), error => {
      assert(error instanceof Error);
      assert.equal(error.message, 'Browser binding core source association mismatch');
      return true;
    });
  } finally { await f.close(); }
});

test('SOURCE5 empty-source map exact empty sourcesContent preserves nonempty role', async () => {
  const f = await wholeFixture();
  try {
    source5AssertNonemptyRole(await f.check());
    await source5EmptyMapContext(f);
    await f.save();
    source5AssertNonemptyRole(await f.check());
  } finally { await f.close(); }
});

const source5RejectedMapCases = [
  { group: 'version', name: 'missing', target: 'empty', mutate: map => { delete map.version; } },
  { group: 'version', name: 'wrong number', target: 'empty', mutate: map => { map.version = 2; } },
  { group: 'version', name: 'string', target: 'empty', mutate: map => { map.version = '3'; } },
  { group: 'sources', name: 'missing', target: 'empty', mutate: map => { delete map.sources; } },
  { group: 'sources', name: 'null', target: 'empty', mutate: map => { map.sources = null; } },
  { group: 'sources', name: 'object', target: 'empty', mutate: map => { map.sources = {}; } },
  { group: 'sources', name: 'string', target: 'empty', mutate: map => { map.sources = ''; } },
  { group: 'sources', name: 'number', target: 'empty', mutate: map => { map.sources = 0; } },
  { group: 'empty sourcesContent', name: 'null', target: 'empty', mutate: map => { map.sourcesContent = null; } },
  { group: 'empty sourcesContent', name: 'object', target: 'empty', mutate: map => { map.sourcesContent = {}; } },
  { group: 'empty sourcesContent', name: 'string', target: 'empty', mutate: map => { map.sourcesContent = ''; } },
  { group: 'empty sourcesContent', name: 'number', target: 'empty', mutate: map => { map.sourcesContent = 0; } },
  { group: 'empty sourcesContent', name: 'boolean', target: 'empty', mutate: map => { map.sourcesContent = false; } },
  { group: 'empty sourcesContent', name: 'nonempty strings', target: 'empty', mutate: map => { map.sourcesContent = ['unexpected']; } },
  { group: 'empty sourcesContent', name: 'nonempty null', target: 'empty', mutate: map => { map.sourcesContent = [null]; } },
  { group: 'nonempty sourcesContent', name: 'missing', target: 'entry', mutate: map => { delete map.sourcesContent; } },
  { group: 'nonempty length', name: 'shorter', target: 'entry', mutate: map => { map.sourcesContent.pop(); } },
  { group: 'nonempty length', name: 'longer', target: 'entry', mutate: map => { map.sourcesContent.push('unexpected'); } },
];

for (const item of source5RejectedMapCases) {
  test(`SOURCE5 empty-source map refuses: ${item.group} ${item.name}`, async () => {
    const f = await wholeFixture();
    try {
      source5AssertNonemptyRole(await f.check());
      await source5EmptyMapContext(f);
      await f.save();
      source5AssertNonemptyRole(await f.check());
      if (item.target === 'empty') await source5ChangeEmptyMap(f, item.mutate);
      else for (const namespace of ['browser', 'node']) await f.changeMap(namespace, item.mutate);
      await f.save();
      await assert.rejects(f.check(), error => {
        assert(error instanceof Error);
        assert.equal(error.message, 'Browser binding core source association mismatch');
        return true;
      });
    } finally { await f.close(); }
  });
}
