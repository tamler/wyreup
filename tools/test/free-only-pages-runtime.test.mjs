import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const startBudget = 30_000;
const cleanupBudget = 5_000;
const retired = [
  '/api', '/api/', '/api/unknown-future-route',
  '/api/tools/pro/run', '/api/tools/pro/run/',
  '/api/credits/checkout', '/api/webhooks/lemonsqueezy', '/api/metrics/hit',
  '/api/account/create', '/api/account/verify', '/api/account/balance',
  '/api/account/history', '/api/account/keys', '/api/account/keys/revoke',
  '/api/account/signout', '/api/admin/alerts', '/api/admin/grant',
  '/api/admin/limits', '/api/admin/runs', '/api/admin/stats',
  '/api/admin/users', '/api/admin/users/delete',
  '/api//tools/pro/run', '/api/%74ools/pro/run',
];

function bounded(work, milliseconds, label) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), milliseconds);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

async function childMain(configPath) {
  const { sdkPath, bundlePath, assetsPath, scratchPath } = JSON.parse(await readFile(configPath, 'utf8'));
  const requireSdk = createRequire(sdkPath);
  const { Miniflare, Response, convertV4MiniflareOptions } = requireSdk('miniflare');
  const { unstable_generateASSETSBinding } = requireSdk('wrangler');
  const assetsController = new AbortController();
  const log = Object.fromEntries(['debug', 'log', 'info', 'warn', 'error'].map(
    level => [level, value => process.stderr.write(`[assets:${level}] ${String(value)}\n`)],
  ));
  let runtime;
  let outboundCalls = 0;
  let closing;
  const send = message => new Promise((resolve, reject) => {
    if (!process.connected) { resolve(); return; }
    process.send(message, error => error ? reject(error) : resolve());
  });
  const close = () => {
    closing ??= (async () => {
      assetsController.abort();
      try {
        if (runtime) await bounded(runtime.dispose(), cleanupBudget, 'Native Pages disposal timed out.');
      } finally {
        if (process.connected) process.disconnect();
      }
    })();
    return closing;
  };
  const report = error => {
    process.stderr.write(`${error.stack ?? String(error)}\n`);
    process.exitCode = 1;
  };
  const stop = () => { void close().catch(report); };
  process.once('disconnect', stop);
  process.once('SIGTERM', stop);
  process.on('message', message => {
    if (message?.command === 'close') stop();
    if (message?.command === 'stats' && !closing)
      void send({ kind: 'stats', outboundCalls }).catch(report);
  });
  try {
    const assets = await unstable_generateASSETSBinding({
      directory: assetsPath, log, signal: assetsController.signal,
    });
    assetsController.signal.throwIfAborted();
    runtime = new Miniflare(convertV4MiniflareOptions({
      name: 'wyreup-free-only-acceptance', modules: true,
      scriptPath: bundlePath, compatibilityDate: '2026-04-21',
      host: '127.0.0.1', port: 0, cf: false, cacheAPI: false,
      telemetry: { enabled: false },
      resourcePersistencePath: join(scratchPath, 'persist'),
      resourceTmpPath: join(scratchPath, 'runtime-tmp'),
      unsafeDevRegistryPath: join(scratchPath, 'registry'),
      serviceBindings: { ASSETS: assets },
      outboundService: async () => {
        outboundCalls++;
        return new Response('Unexpected egress denied', { status: 502 });
      },
    }));
    const url = await bounded(runtime.ready, startBudget, 'Native Pages host did not become ready.');
    assetsController.signal.throwIfAborted();
    await send({ kind: 'ready', url: url.href });
  } catch (error) {
    report(error);
    try { await send({ kind: 'startup-error', error: String(error) }); }
    finally { await close(); }
  }
}

function waitForHost(child, kind, milliseconds) {
  let cleanup;
  const reply = new Promise((resolve, reject) => {
    function onMessage(message) {
      if (message?.kind === kind) resolve(message);
      if (message?.kind === 'startup-error') reject(new Error(message.error));
    }
    function onExit(code, signal) {
      reject(new Error(`Owned Pages host exited before ${kind} (code ${code}, signal ${signal}).`));
    }
    cleanup = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', reject);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', reject);
  });
  return bounded(reply, milliseconds, `Owned Pages host did not report ${kind}.`).finally(cleanup);
}

async function probeCompiledPages() {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-free-runtime-')));
  let child;
  let childDone;
  let childClosed = false;
  let childErrors = '';
  let failure;
  try {
    const wranglerPackage = import.meta.resolve('wrangler/package.json');
    const wranglerDirectory = dirname(fileURLToPath(wranglerPackage));
    const bundle = join(scratch, 'worker');
    const env = {
      PATH: process.env.PATH,
      TMPDIR: scratch,
      XDG_CONFIG_HOME: join(scratch, 'config'),
      CLOUDFLARE_SEND_METRICS: 'false',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: join(scratch, 'build.log'),
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    };
    await execute(process.execPath, [
      join(wranglerDirectory, 'wrangler-dist/cli.js'), 'pages', 'functions', 'build',
      join(project, 'functions'), '--outdir', bundle,
      '--compatibility-date', '2026-04-21',
    ], { cwd: scratch, env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    const assetsPath = join(scratch, 'assets');
    await mkdir(assetsPath);
    for (const filename of ['index.html', '404.html', '_redirects'])
      await copyFile(join(project, 'packages/web/dist', filename), join(assetsPath, filename));
    const homepage = await readFile(join(assetsPath, 'index.html'), 'utf8');
    assert.match(homepage, /Wyreup/);
    const configPath = join(scratch, 'host.json');
    await writeFile(configPath, JSON.stringify({
      sdkPath: wranglerPackage, bundlePath: join(bundle, 'index.js'), assetsPath, scratchPath: scratch,
    }));
    child = fork(fileURLToPath(import.meta.url), ['--host-child', configPath], {
      cwd: scratch, env, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { childErrors = (childErrors + chunk).slice(-16_384); });
    child.on('error', error => { childErrors = (childErrors + String(error)).slice(-16_384); });
    childDone = new Promise(resolve => child.once('close', (code, signal) => {
      childClosed = true;
      resolve({ code, signal });
    }));
    const ready = await waitForHost(child, 'ready', startBudget + cleanupBudget);
    const origin = new URL(ready.url);
    assert.equal(origin.protocol, 'http:');
    assert.equal(origin.hostname, '127.0.0.1');
    const lifetime = AbortSignal.timeout(30_000);
    const request = (path, init) => fetch(new URL(path, origin), {
      ...init, redirect: 'manual',
      signal: AbortSignal.any([lifetime, AbortSignal.timeout(5_000)]),
    });
    let probes = 0;
    for (const path of retired) {
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const response = await request(path, {
          method,
          headers: {
            Authorization: 'Bearer synthetic-retired-key',
            Cookie: '__Host-wyreup_session=synthetic-retired-session',
            'Content-Type': 'application/json',
          },
          ...(method === 'GET' || method === 'HEAD' ? {} : { body: '{invalid-json' }),
        });
        assert.equal(response.status, 410, `${method} ${path}`);
        if (method !== 'HEAD') assert.match(await response.text(), /disabled|retired/i);
        probes++;
      }
    }
    const staticResponse = await request('/');
    assert.equal(staticResponse.status, 200);
    assert.equal(await staticResponse.text(), homepage);
    for (const path of ['/api/domain-age']) {
      const response = await request(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(response.status, 400, `${path} still reaches input validation`);
      await response.arrayBuffer();
    }
    const stats = waitForHost(child, 'stats', cleanupBudget);
    child.send({ command: 'stats' });
    const { outboundCalls } = await stats;
    assert.equal(outboundCalls, 0, 'retirement and validation probes must make zero upstream calls');
    console.log(JSON.stringify({ retirementProbes: probes, publicValidationControls: 1, outboundCalls }));
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (child) {
        if (child.connected) child.send({ command: 'close' });
        try {
          const { code, signal } = await bounded(childDone, cleanupBudget * 2, 'Owned Pages host shutdown timed out.');
          assert.deepEqual({ code, signal }, { code: 0, signal: null });
        } catch (error) {
          failure ??= error;
          if (child.exitCode === null && child.signalCode === null && !childClosed) {
            child.kill('SIGTERM');
            await bounded(childDone, cleanupBudget, `Owned Pages host PID ${child.pid} did not exit; retain ${scratch}.`);
          }
        }
      }
    } finally {
      if (!child || childClosed) await rm(scratch, { recursive: true, force: true });
      if (childErrors && failure) console.error(childErrors.trim());
    }
  }
  if (failure) throw failure;
}

if (process.argv[2] === '--host-child') {
  await childMain(process.argv[3]);
} else {
  test('compiled Pages retires hosted, payment and account APIs without any egress', { timeout: 155_000 }, probeCompiledPages);
}
