import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const caseName = 'real stopwatch restore/export preserves the complete independent fixed lap session';

test('standalone browser Vitest refuses a retained binding failure after successful workflow and normal cleanup', {
  skip: process.env.CATALOG_BROWSER_BINDING_FAILURE_REGRESSION !== 'run-native'
    ? 'Run the explicit admitted native browser regression command; a skip is not evidence.' : false,
  timeout: 480000,
}, async () => {
  const deadlineAt = Date.now() + 480000;
  const artifacts = join(root, 'docs/catalog-artifacts');
  await mkdir(artifacts, { recursive: true });
  const run = `browser-binding-failure-${randomUUID()}`;
  const output = join(artifacts, run);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
  const preload = join(root, 'packages/web/test/fixtures/catalogBrowserBindingFailure.preload.mjs');
  const reportPath = join(output, 'vitest-report.json');
  const args = ['exec', 'vitest', 'run', '--config', 'vitest.production.config.ts',
    'packages/web/test/catalog-baseline-browser.test.ts', '--testNamePattern', `^${caseName}$`,
    '--pool=forks', `--execArgv=--import=${pathToFileURL(preload).href}`,
    '--reporter=json', `--outputFile=${reportPath}`];
  const env = { ...process.env, CATALOG_BROWSER_RUN: run,
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter) };
  delete env.WYREUP_CATALOG_DIST;
  delete env.WYREUP_CATALOG_MANIFEST;
  delete env.NODE_OPTIONS;
  const coreArgs = [join(root, 'tools/catalog-core-build-proof.mjs'), '--run', run];
  const coreDiagnosticPrefix = join(artifacts, `${run}-core`);
  const core = await new Promise((done) => {
    const child = execFile(process.execPath, coreArgs, {
      cwd: root, env, timeout: Math.min(180000, deadlineAt - Date.now()), maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => done({ code: error?.code ?? 0, signal: error?.signal ?? null,
      killed: error?.killed ?? false, pid: child.pid, stdout, stderr }));
  });
  await writeFile(`${coreDiagnosticPrefix}.stdout.log`, core.stdout, { flag: 'wx' });
  await writeFile(`${coreDiagnosticPrefix}.stderr.log`, core.stderr, { flag: 'wx' });
  await writeFile(`${coreDiagnosticPrefix}.command.json`, JSON.stringify({
    command: [process.execPath, ...coreArgs], cwd: root, code: core.code, signal: core.signal,
    killed: core.killed, pid: core.pid,
  }, null, 2) + '\n', { flag: 'wx' });
  assert.equal(core.code, 0, 'The actual coordinated core proof must complete before browser setup.');
  assert.equal(core.signal, null);
  assert.equal(core.killed, false);
  const coreResult = JSON.parse(core.stdout);
  assert.equal(coreResult.descriptor.path, `docs/catalog-artifacts/${run}/core-build-proof.json`);
  assert(coreResult.outputs > 0);
  const remaining = deadlineAt - Date.now();
  assert(remaining > 0, 'The original regression deadline expired before browser setup.');
  const result = await new Promise((done) => {
    const child = execFile('pnpm', args, { cwd: root, env, timeout: remaining, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => done({ code: error?.code ?? 0, signal: error?.signal ?? null,
        killed: error?.killed ?? false, pid: child.pid, stdout, stderr }));
  });
  await writeFile(join(output, 'regression-child.stdout.log'), result.stdout, { flag: 'wx' });
  await writeFile(join(output, 'regression-child.stderr.log'), result.stderr, { flag: 'wx' });
  await writeFile(join(output, 'regression-command.json'), JSON.stringify({ command: ['pnpm', ...args],
    cwd: root, code: result.code, signal: result.signal, killed: result.killed, pid: result.pid,
    scope: 'Native failing-target regression only; no browser receipt, current-source acceptance or row promotion' }, null, 2) + '\n', { flag: 'wx' });
  assert.equal(result.signal, null, 'A signal or timeout cannot satisfy this regression.');
  assert.equal(result.killed, false, 'A killed command cannot satisfy this regression.');
  assert.equal(typeof result.code, 'number', 'A launch/dependency/buffer failure is not the target.');

  const manifest = JSON.parse(await readFile(join(output, 'browser-producer-manifest.json'), 'utf8'));
  const preloadWitness = JSON.parse(await readFile(join(output, 'binding-failure-preload.json'), 'utf8'));
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(manifest.setupFailure, undefined);
  assert.deepEqual(manifest.cleanupFailures, []);
  assert.deepEqual(manifest.completedCases, ['stopwatch']);
  assert.equal(manifest.resolvedProductionBuild.mode, 'owned-production-build');
  assert.equal(report.numPassedTests, 1, 'The independent actual stopwatch assertions must pass.');
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
  assert.equal(assertions.filter((item) => item.title === caseName && item.status === 'passed').length, 1);
  assert.equal(assertions.filter((item) => item.status === 'failed').length, 0);
  assert.deepEqual(manifest.browserProductionArtifactContextBinding.bindingFailures,
    [{ name: 'Error', message: 'Browser binding emitted artifact unavailable' }]);
  assert.equal(preloadWitness.armed, true);
  assert.equal(preloadWitness.injectionFailure, undefined);
  assert.equal(preloadWitness.browserConnectedAfterClose, false);
  const response = preloadWitness.response;
  assert.equal(response.status, 404);
  assert.equal(response.resourceType, 'font');
  assert.equal(response.fromServiceWorker, false);
  assert.equal(new URL(response.url).pathname, '/__catalog-binding-failure-regression__.woff2');
  assert.equal(preloadWitness.fontLoadOutcome.loaded, false);
  assert.equal(typeof preloadWitness.fontLoadOutcome.error.name, 'string');
  assert(preloadWitness.fontLoadOutcome.error.name.length > 0);
  assert.equal(typeof preloadWitness.fontLoadOutcome.error.message, 'string');
  assert(preloadWitness.fontLoadOutcome.error.message.length > 0);
  const origin = manifest.browserProductionArtifactContextBinding.origin;
  assert.equal(new URL(response.url).origin, origin);
  assert(manifest.browserProductionArtifactContextBinding.browserResponses.some((item) =>
    item.url === response.url && item.resourceType === 'font' && item.status === 404 && !item.fromServiceWorker));
  const build = JSON.parse(await readFile(join(output, 'production-build-manifest.json'), 'utf8'));
  assert.equal(build.kind, 'temporary-real-Astro-controlled-route');
  await assert.rejects(lstat(resolve(build.cwd, '../..')), { code: 'ENOENT' });
  const address = new URL(origin);
  assert.equal(address.hostname, '127.0.0.1');
  await new Promise((done, reject) => {
    let outcome;
    const socket = createConnection({ host: address.hostname, port: Number(address.port) });
    socket.once('connect', () => { outcome = new Error('Owned production server remained open.'); socket.destroy(); });
    socket.once('error', (error) => { outcome = error; });
    socket.setTimeout(10000, () => { outcome = new Error('Owned server closure probe timed out.'); socket.destroy(); });
    socket.once('close', () => {
      if (outcome?.code === 'ECONNREFUSED') done();
      else reject(outcome ?? new Error('Owned server closure was not observed.'));
    });
  });
  assert.equal(result.code, 1, 'Standalone Vitest must fail for the persisted binding failure after normal cleanup.');
  assert.equal(report.success, false);
  assert.equal(report.numFailedTestSuites, 1);
  assert.match(report.testResults[0].message, /binding/i);
});
