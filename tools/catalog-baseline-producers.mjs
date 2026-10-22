import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import {
  confinedPath,
  boundFixtureOracle,
  checkFixtureArtifacts,
  checkBrowserProductionBinding,
  checkBrowserAuthorityCommandPins,
  protectedBrowserFixtures,
  qualifiesExpectedEmptyArtifact,
  sourceBindingDigest,
  verifyPin,
} from './check-catalog-evidence.mjs';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const registryCache = new Map();
const exec = promisify(execFile);
export async function publicRegistry(format = 'esm') {
  if (!['esm', 'cjs'].includes(format))
    throw new Error('Only actual public ESM/CJS formats are supported.');
  if (!registryCache.has(format)) {
    const entry = path.join(
      root,
      `packages/core/dist/node/index.${format === 'esm' ? 'js' : 'cjs'}`,
    );
    const core =
      format === 'esm'
        ? await import(pathToFileURL(entry).href)
        : createRequire(path.join(root, 'package.json'))(entry);
    registryCache.set(format, core.createDefaultRegistry());
  }
  return registryCache.get(format);
}
export async function runBaselineFixture({ fixtureKey, format, outputDirectory, signal }) {
  const oracles = JSON.parse(
    await fs.readFile(path.join(root, 'docs/CATALOG-INTEGRATION-ORACLES.json'), 'utf8'),
  );
  const mapping = JSON.parse(
    await fs.readFile(path.join(root, 'docs/CATALOG-INTEGRATION-MAPPING.json'), 'utf8'),
  );
  const fixture = oracles.executableFixtures.find((item) => item.key === fixtureKey);
  if (!fixture) throw new Error(`Named independent fixture unavailable: ${fixtureKey}`);
  for (const pin of fixture.authorityPins) await verifyPin(root, pin, { nonempty: true });
  const registry = await publicRegistry(format);
  const tool = registry.toolsById.get(fixture.engineId);
  if (!tool || !(tool.surfaces ?? ['web', 'cli', 'mcp']).includes('cli'))
    throw new Error(
      'Fixture requires its genuine browser/native lane; Node simulation is forbidden.',
    );
  const inputs = fixture.inputs.map((item) => {
    if (
      typeof item.text !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.mime !== 'string'
    )
      throw new Error(
        'This fixed collector supports independently bound literal text inputs; other files require their original-byte producer.',
      );
    if (new TextEncoder().encode(item.text).length > 1024 * 1024)
      throw new Error('Fixed literal text fixture exceeds the collector bound.');
    return new File([item.text], item.name, { type: item.mime });
  });
  if (!registry.toolsForFiles(inputs).some((item) => item.id === tool.id))
    throw new Error('Actual module input count/MIME contract refuses this independent fixture.');
  if (tool.cost !== 'free') throw new Error('Paid producer is outside fixed local baseline.');
  if (
    fixture.usesPinnedDefaults &&
    JSON.stringify(tool.defaults) !== JSON.stringify(fixture.params)
  )
    throw new Error('Actual built defaults differ from the pinned independent fixture input.');
  const engine = mapping.rows.flatMap((row) => row.engines).find((item) => item.id === tool.id);
  if (!engine) throw new Error('Actual module lacks current row authority.');
  await boundFixtureOracle(root, fixture, oracles, engine);
  for (const pin of engine.sourceBinding.pins) await verifyPin(root, pin);
  const directory = confinedPath(root, outputDirectory);
  if (!outputDirectory.startsWith('docs/catalog-artifacts/'))
    throw new Error('Artifacts must use owned durable catalog directory.');
  await fs.mkdir(directory, { recursive: true });
  const artifacts = [],
    progress = [];
  const context = {
    signal,
    cache: new Map(),
    executionId: `catalog-${fixtureKey}-${format}`,
    onProgress(value) {
      progress.push(value);
    },
  };
  const startedAt = new Date().toISOString();
  const result = await tool.run(inputs, structuredClone(fixture.params), context);
  const outputs = Array.isArray(result) ? result : [result];
  if (signal.aborted) throw new Error('Actual baseline producer cancelled.');
  if (!outputs.length || outputs.some((blob) => !(blob instanceof Blob)))
    throw new Error('Actual producer did not return complete Blob artifacts.');
  if (outputs.length !== fixture.artifactOracles.length)
    throw new Error('Actual complete output count differs from its independent authority.');
  for (let index = 0; index < outputs.length; index++) {
    const output = outputs[index];
    if (
      fixture.artifactOracles[index].mime !== undefined &&
      output.type !== fixture.artifactOracles[index].mime
    )
      throw new Error('Actual ordered output MIME differs from its independent authority.');
    const expectedEmpty =
      output.size === 0 &&
      (await qualifiesExpectedEmptyArtifact(root, fixture.artifactOracles[index]));
    if ((!expectedEmpty && output.size === 0) || output.size > 64 * 1024 * 1024)
      throw new Error(
        'Actual producer artifact exceeds fixed baseline bounds or lacks a qualified empty control.',
      );
    const bytes = new Uint8Array(await output.arrayBuffer());
    const relative = `${outputDirectory}/output-${index + 1}.${output.type === 'application/json' ? 'json' : 'bin'}`;
    await fs.writeFile(confinedPath(root, relative), bytes, { flag: 'wx' });
    artifacts.push({ path: relative, bytes: bytes.length, sha256: sha(bytes), mime: output.type });
  }
  const entry = `packages/core/dist/node/index.${format === 'esm' ? 'js' : 'cjs'}`;
  const entryBytes = await fs.readFile(path.join(root, entry));
  const manifest = {
    caseKey: `${fixtureKey}-${format}`,
    engineId: tool.id,
    oracleKey: fixtureKey,
    format,
    surface: 'cli',
    params: fixture.params,
    inputs: fixture.inputs,
    artifacts,
    sourceBindingDigest: sourceBindingDigest(engine.sourceBinding),
    builtEntry: { path: entry, bytes: entryBytes.length, sha256: sha(entryBytes) },
    startedAt,
    finishedAt: new Date().toISOString(),
    progress,
    scope:
      'Actual current public default registry/module run; independent fixed scalar/text case only. No full row/branch/source/package/browser acceptance.',
  };
  const manifestPath = `${outputDirectory}/producer-manifest.json`;
  await fs.writeFile(confinedPath(root, manifestPath), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  return { manifestPath, manifest };
}
export async function runBrowserBaseline({ distDirectory, outputDirectory, signal }) {
  if (!/^docs\/catalog-artifacts\/[a-zA-Z0-9-]{1,100}$/.test(outputDirectory))
    throw new Error('One owned browser run directory is required.');
  const directory = confinedPath(root, outputDirectory);
  const run = path.basename(directory);
  const oracles = JSON.parse(await fs.readFile(path.join(root, 'docs/CATALOG-INTEGRATION-ORACLES.json'), 'utf8'));
  const preflightFixtures = await protectedBrowserFixtures(root);
  const preflightBridges = new Map();
  for (const fixture of preflightFixtures) {
    const authority = oracles.executableFixtures.find((item) => item.key === fixture.key);
    if (!authority) throw new Error('Browser fixture sealed authority is missing.');
    preflightBridges.set(fixture.key, await boundFixtureOracle(root, authority, oracles, { id: fixture.engineId }));
  }
  const command = [
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.production.config.ts',
    'packages/web/test/catalog-baseline-browser.test.ts',
  ];
  const startedAt = new Date().toISOString();
  const environment = { ...process.env, CATALOG_BROWSER_RUN: run };
  if (distDirectory) environment.WYREUP_CATALOG_DIST = path.resolve(distDirectory);
  else {
    delete environment.WYREUP_CATALOG_DIST;
    delete environment.WYREUP_CATALOG_MANIFEST;
  }
  let result;
  try {
    result = await exec(command[0], command.slice(1), {
      cwd: root,
      signal,
      timeout: distDirectory ? 90000 : 480000,
      maxBuffer: 1024 * 1024,
      env: environment,
    });
  } catch (error) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'failed-browser-native.log'),
      `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${String(error)}\n`,
      { flag: 'wx' },
    );
    throw error;
  }
  const finishedAt = new Date().toISOString();
  const logPath = `${outputDirectory}/browser-native.log`;
  await fs.writeFile(confinedPath(root, logPath), result.stdout + '\n' + result.stderr, {
    flag: 'wx',
  });
  async function pin(relative) {
    const bytes = await fs.readFile(confinedPath(root, relative));
    return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
  }
  const manifestPath = `${outputDirectory}/browser-producer-manifest.json`;
  const manifest = JSON.parse(await fs.readFile(confinedPath(root, manifestPath), 'utf8'));
  assert.equal(manifest.setupFailure, undefined);
  assert.deepEqual(manifest.cleanupFailures, []);
  if (!distDirectory) assert.equal(manifest.resolvedProductionBuild.mode, 'owned-production-build');
  const fixtures = await protectedBrowserFixtures(root);
  assert.deepEqual(fixtures, preflightFixtures, 'Browser fixture source/input changed during the actual command.');
  assert.deepEqual(
    [...manifest.completedCases].sort(),
    fixtures.map((fixture) => fixture.engineId).sort(),
  );
  assert.equal(manifest.observedMidi.sampleRate, 48000);
  assert(
    manifest.observedMidi.workers.some((url) => new URL(url).pathname.includes('file-worker')),
  );
  const receipts = [];
  for (const fixture of fixtures) {
    const authority = oracles.executableFixtures.find((item) => item.key === fixture.key);
    const browserAuthorityBridge = await boundFixtureOracle(root, authority, oracles, { id: fixture.engineId });
    assert.deepEqual(browserAuthorityBridge, preflightBridges.get(fixture.key), 'Browser fixture bridge changed during the actual command.');
    const context = manifest.sourceContext.find((item) => item.engineId === fixture.engineId);
    const artifacts = manifest.artifacts
      .filter((item) => item.engineId === fixture.engineId)
      .map((item) => item.artifact);
    await checkFixtureArtifacts(root, artifacts, authority);
    const receipt = {
      role: 'producer',
      engineId: fixture.engineId,
      caseKey: `${run}-${fixture.engineId}`,
      oracleKey: fixture.key,
      browserAuthorityBridge,
      owner: 'catalog_gap_inventory',
      command,
      cwd: '.',
      exitCode: 0,
      caseCount: 1,
      startedAt,
      finishedAt,
      sourceBindingDigest: sourceBindingDigest(context.declaredPendingSourceBinding),
      log: await pin(logPath),
      commandSourcePins: [
        await pin('tools/catalog-baseline-producers.mjs'),
        ...manifest.commandSourcePins,
      ],
      manifest: await pin(manifestPath),
      productionBuildManifest: manifest.buildManifestPin,
      artifactPins: artifacts,
      sourceContext: context,
      observedMidi: fixture.engineId === 'mp3-to-midi' ? manifest.observedMidi : undefined,
      browserProductionArtifactContextBinding: manifest.browserProductionArtifactContextBinding,
      scope:
        'Actual native6 genuine production-browser producer; fixed workflows only, pending independent checker/final current source and build parity/mobile/physical/full-row acceptance.',
    };
    await checkBrowserAuthorityCommandPins(root, receipt, manifest, browserAuthorityBridge);
    await checkBrowserProductionBinding(root, receipt, manifest, { id: fixture.engineId });
    const receiptPath = `${outputDirectory}/producer-${fixture.engineId}.json`;
    await fs.writeFile(confinedPath(root, receiptPath), JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
    });
    receipts.push(await pin(receiptPath));
  }
  return { outputDirectory, receipts, fixtureCases: 6, nativeExitCode: 0, rowPromotion: 'pending' };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index],
      value = process.argv[index + 1];
    if (
      !['--fixture', '--format', '--out', '--browser-dist', '--browser-build'].includes(key) ||
      !value ||
      options[key]
    )
      throw new Error(
        'Use exact --fixture KEY --format esm|cjs --out docs/catalog-artifacts/PATH, or --browser-dist DIST / --browser-build owned with --out.',
      );
    options[key] = value;
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options['--browser-build'] ? 480000 : options['--browser-dist'] ? 90000 : 60000,
  );
  try {
    if (options['--browser-dist'] || options['--browser-build']) {
      if (
        !options['--out'] ||
        options['--fixture'] ||
        options['--format'] ||
        (options['--browser-build'] &&
          (options['--browser-build'] !== 'owned' || options['--browser-dist']))
      )
        throw new Error(
          'Browser mode requires --out and exactly --browser-dist DIST or --browser-build owned.',
        );
      console.log(
        JSON.stringify(
          await runBrowserBaseline({
            distDirectory: options['--browser-dist'],
            outputDirectory: options['--out'],
            signal: controller.signal,
          }),
        ),
      );
    } else {
      if (!options['--fixture'] || !options['--format'] || !options['--out'])
        throw new Error('All literal producer options are required.');
      console.log(
        JSON.stringify(
          await runBaselineFixture({
            fixtureKey: options['--fixture'],
            format: options['--format'],
            outputDirectory: options['--out'],
            signal: controller.signal,
          }),
        ),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}
