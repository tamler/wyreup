import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Prospective test helper. Syntax checking does not execute its host or build.
const BUILD_BUDGET = 180000;
const CLEANUP_BUDGET = 5000;
const START_BUDGET = 30000;
const SYNTHETIC_SECRET = 'wyreup-acceptance-only-domain-secret';
const DATABASE_ID = '00000000-0000-4000-8000-000000000006';
const SOURCE_FILES = [
  'functions/api/domain-age.ts',
  'functions/_lib/rdap.ts',
  'functions/_lib/public-rate-limit.ts',
  'functions/_lib/crypto.ts',
  'functions/_lib/env.ts',
  'functions/_lib/types.ts',
  'packages/core/src/lib/domain-registration.ts',
  'packages/core/src/lib/tr46.d.ts',
  'packages/core/src/utilities/common.ts',
  'packages/core/src/types.ts',
  'migrations/0008_public_domain_limits.sql',
  'package.json',
  'packages/core/package.json',
  'pnpm-lock.yaml',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function pin(file, relative) {
  const bytes = await fs.readFile(file);
  return { path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function filesUnder(directory, prefix = '') {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Acceptance input contains a symlink: ${relative}`);
    if (entry.isDirectory()) result.push(...await filesUnder(file, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Acceptance input is not a regular file: ${relative}`);
  }
  return result;
}

async function pinTree(directory, prefix) {
  return Promise.all((await filesUnder(directory)).map(relative => pin(path.join(directory, relative), `${prefix}/${relative}`)));
}

function equalPins(actual, expected, label) {
  const sort = values => [...values].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(sort(actual)) !== JSON.stringify(sort(expected))) throw new Error(`${label} changed; no acceptance result is valid.`);
}

function checkDeadline(signal, deadlineAt) {
  if (signal?.aborted) throw new Error('Owned acceptance operation was canceled.');
  if (Date.now() >= deadlineAt) throw new Error('Owned acceptance operation exceeded its declared deadline.');
}

function lifetime(deadlineAt) {
  const now = Date.now();
  if (deadlineAt === undefined) return now + BUILD_BUDGET;
  if (!Number.isFinite(deadlineAt) || deadlineAt <= now || deadlineAt - now > 2147483647)
    throw new Error('Acceptance deadlineAt must be a future finite timestamp within the native timer range.');
  return deadlineAt;
}

function childEnvironment(owned) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return {
    ...env,
    TMPDIR: path.join(owned, 'tmp'),
    XDG_CONFIG_HOME: path.join(owned, 'config'),
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: path.join(owned, 'wrangler.log'),
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    CI: 'true',
  };
}

function errorReferences(error, references) {
  if (!(error instanceof Error) || references.has(error)) return;
  references.add(error);
  if (error instanceof AggregateError) {
    for (const nested of error.errors) errorReferences(nested, references);
  }
}

function combineErrors(...groups) {
  const result = [];
  const references = new Set();
  for (const group of groups) {
    for (const error of group) {
      if (error instanceof Error && references.has(error)) continue;
      result.push(error);
      errorReferences(error, references);
    }
  }
  return result;
}

function failure(errors, message) {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
}

function diagnosticErrors(...groups) {
  const errors = [];
  const references = new Set();
  let visited = 0;
  let errorsTruncated = false;
  const text = (value, limit) => {
    if (value.length <= limit) return { value, truncated: false };
    let end = limit;
    const last = value.charCodeAt(end - 1), next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    return { value: value.slice(0, end), truncated: true };
  };
  const visit = (error, depth) => {
    if (visited >= 128 || errors.length >= 32) { errorsTruncated = true; return false; }
    visited++;
    if (!(error instanceof Error)) {
      errors.push({ name: 'Error', message: 'Non-Error failure value omitted.' });
      errorsTruncated = true;
      return true;
    }
    if (references.has(error)) return true;
    if (references.size >= 128) { errorsTruncated = true; return false; }
    references.add(error);
    if (error instanceof AggregateError) {
      if (depth >= 16 || !Array.isArray(error.errors)) { errorsTruncated = true; return false; }
      for (let index = 0; index < error.errors.length; index++) {
        if (!visit(error.errors[index], depth + 1)) return false;
      }
      return true;
    }
    const name = text(typeof error.name === 'string' ? error.name : 'Error', 128);
    const message = text(typeof error.message === 'string' ? error.message : 'Non-Error failure value omitted.', 2048);
    errors.push({ name: name.value, message: message.value, ...(name.truncated ? { nameTruncated: true } : {}), ...(message.truncated ? { messageTruncated: true } : {}) });
    return true;
  };
  outer: for (const group of groups) {
    for (let index = 0; index < group.length; index++) {
      if (!visit(group[index], 0)) break outer;
    }
  }
  return { errors, ...(errorsTruncated ? { errorsTruncated: true } : {}) };
}

function observeAbort(signal) {
  let reject;
  const failed = new Promise((_, fail) => { reject = fail; });
  void failed.catch(() => undefined);
  const onAbort = () => reject(new Error('Owned acceptance operation was canceled.'));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return { failed, dispose: () => signal?.removeEventListener('abort', onAbort) };
}

function exitOf(child) {
  const state = { child, closed: false, result: null, errors: [], signalErrors: [], terminationRequested: false };
  let fail;
  state.failed = new Promise((_, reject) => { fail = reject; });
  // The native error remains handled even after an owned wait has expired.
  void state.failed.catch(() => undefined);
  state.exited = new Promise(resolve => {
    child.on('error', error => { state.errors.push(error); fail(error); });
    child.once('close', (code, signal) => {
      state.closed = true;
      state.result = { code, signal };
      resolve(state.result);
    });
  });
  return state;
}

async function bounded(pending, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function signalOwned(state) {
  if (!state || state.closed || state.terminationRequested || state.child.exitCode !== null || state.child.signalCode !== null) return;
  if (!Number.isSafeInteger(state.child.pid) || state.child.pid <= 0) return;
  state.terminationRequested = true;
  try { state.child.kill('SIGTERM'); }
  catch (error) { state.signalErrors.push(error); }
}

async function terminateOwned(state) {
  signalOwned(state);
  let result;
  const errors = [];
  try {
    result = await bounded(state.exited, CLEANUP_BUDGET, `Owned child ${state.child.pid} did not exit after SIGTERM; retain its PID and evidence. No SIGKILL was sent.`);
  } catch (error) { errors.push(error); }
  const failures = combineErrors(state.signalErrors, errors);
  if (failures.length) throw failure(failures, 'Owned child termination failed.');
  return result;
}

function observeWriter(output, label) {
  const state = { output, label, endRequested: false, finished: false, settled: false, timedOut: false, errors: [], detached: false, finalizePromise: null, onFailure: null };
  let fail;
  state.failed = new Promise((_, reject) => { fail = reject; });
  void state.failed.catch(() => undefined);
  state.captureError = error => {
    state.errors.push(error);
    fail(error);
    if (!state.endRequested) state.onFailure?.();
  };
  output.on('finish', () => { state.finished = true; });
  output.on('error', state.captureError);
  return state;
}

function attachWriter(state, childState) {
  for (const stream of [childState.child.stdout, childState.child.stderr]) {
    if (!stream) continue;
    stream.on('error', state.captureError);
    stream.pipe(state.output, { end: false });
  }
}

function detachWriter(state, childState) {
  if (state.detached || !childState) return;
  state.detached = true;
  for (const stream of [childState.child.stdout, childState.child.stderr]) {
    if (!stream) continue;
    stream.unpipe(state.output);
    // The already-owned pipe is drained without writing more bytes to this log.
    stream.resume();
  }
}

function finalizeWriter(state, childState) {
  if (state.finalizePromise) return state.finalizePromise;
  detachWriter(state, childState);
  state.endRequested = true;
  state.finalizePromise = new Promise((resolve, reject) => {
    // Arm the fixed policy before requesting native finalization.
    const timer = setTimeout(() => {
      state.timedOut = true;
      reject(new Error(`Owned ${state.label} log finalization exceeded 5000ms; retain its stream and evidence.`));
    }, CLEANUP_BUDGET);
    try {
      state.output.end(error => {
        state.settled = true;
        clearTimeout(timer);
        if (error) { state.errors.push(error); reject(error); }
        else resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      state.errors.push(error);
      reject(error);
    }
  });
  // Late native callbacks stay observed, without starting guard or persistence work.
  void state.finalizePromise.catch(() => undefined);
  return state.finalizePromise;
}

function lifecycleSnapshot(owned, run, phase = run?.label ?? 'preparation') {
  const childState = run?.childState;
  const writer = run?.writer;
  return {
    schemaVersion: 1,
    status: 'incomplete',
    phase,
    ownedRoot: owned,
    child: { pid: childState?.child.pid ?? null, closed: childState?.closed ?? false, exitCode: childState?.child.exitCode ?? null, signalCode: childState?.child.signalCode ?? null },
    writer: { endRequested: writer?.endRequested ?? false, finished: writer?.finished ?? false },
  };
}

async function runOwned(command, args, { owned, signal, deadlineAt, label, ledger, captureRun }) {
  checkDeadline(signal, deadlineAt);
  const writer = observeWriter(createWriteStream(path.join(owned, `${label}.log`), { flags: 'wx' }), label);
  const run = { label, writer, childState: null, blocked: false, lifecycle: null };
  captureRun(run);
  const record = { command, args, cwd: owned, pid: null, log: `${label}.log`, startedAt: new Date().toISOString() };
  ledger.push(record);
  const operationErrors = [];
  const processErrors = [];
  const streamErrors = [];
  const onAbort = () => signalOwned(run.childState);
  const abort = observeAbort(signal);
  try {
    const child = spawn(command, args, { cwd: owned, env: childEnvironment(owned), stdio: ['ignore', 'pipe', 'pipe'] });
    run.childState = exitOf(child);
    record.pid = child.pid;
    writer.onFailure = () => signalOwned(run.childState);
    attachWriter(writer, run.childState);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const result = await bounded(Promise.race([run.childState.exited, run.childState.failed, writer.failed, abort.failed]), Math.max(1, deadlineAt - Date.now()), `Owned ${label} exceeded its declared deadline.`);
    Object.assign(record, { ...result, finishedAt: new Date().toISOString() });
    checkDeadline(signal, deadlineAt);
    if (result.code !== 0) throw new Error(`Owned ${label} failed: ${JSON.stringify(result)}; see ${record.log}.`);
  } catch (error) {
    operationErrors.push(error);
    if (run.childState) {
      try { record.cleanup = await terminateOwned(run.childState); }
      catch (cleanupError) { processErrors.push(cleanupError); }
    }
  } finally {
    abort.dispose();
    signal?.removeEventListener('abort', onAbort);
    try { await finalizeWriter(writer, run.childState); }
    catch (error) { streamErrors.push(error); }
    run.blocked = Boolean((run.childState && !run.childState.closed) || !writer.settled || writer.timedOut);
    run.lifecycle = lifecycleSnapshot(owned, run);
    run.lifecycleCapturedAt = new Date().toISOString();
    const evidenceComplete = !run.blocked && writer.finished && writer.errors.length === 0 && operationErrors.length === 0 && processErrors.length === 0 && streamErrors.length === 0 && run.childState?.errors.length === 0;
    Object.assign(record, { finishedAt: run.lifecycleCapturedAt, evidenceComplete });
    if (!evidenceComplete) Object.assign(record, { lifecycle: run.lifecycle, lifecycleCapturedAt: run.lifecycleCapturedAt });
  }
  const errors = combineErrors(operationErrors, run.childState?.errors ?? [], processErrors, writer.errors, streamErrors);
  if (errors.length) throw failure(errors, `Owned ${label} failed with lifecycle errors.`);
}

async function linkDependencies(source, destination, check) {
  check();
  await fs.mkdir(destination, { recursive: true });
  check();
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    check();
    if (['.astro', '.vite', '.vite-temp', '.cache'].includes(entry.name)) continue;
    await fs.symlink(await fs.realpath(path.join(source, entry.name)), path.join(destination, entry.name));
    check();
  }
}

/**
 * Future runtime test helper: a genuine selected Pages route, not an all-backend host.
 * expectedCoreDistPins must come from the coordinated current build; no count is hardcoded.
 */
export async function startDomainFunctionsHost({ projectDir, distDir, evidenceDir, expectedCoreDistPins, callerAbortSignal, deadlineAt, fault = 'none' }) {
  if (!['none', 'missing-secret', 'missing-database'].includes(fault)) throw new Error('Unknown test-only binding fault.');
  if (!Array.isArray(expectedCoreDistPins) || expectedCoreDistPins.length === 0) throw new Error('A nonempty coordinated core-dist pin array is required.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('The pinned Wrangler host requires Node22 or newer.');
  const started = Date.now();
  const hostDeadline = lifetime(deadlineAt);
  const buildDeadline = Math.min(started + BUILD_BUDGET, hostDeadline);
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  checkDeadline(callerAbortSignal, buildDeadline);
  const project = await fs.realpath(projectDir);
  checkDeadline(callerAbortSignal, buildDeadline);
  const dist = await fs.realpath(distDir);
  checkDeadline(callerAbortSignal, buildDeadline);
  await fs.mkdir(evidenceDir, { recursive: true });
  checkDeadline(callerAbortSignal, buildDeadline);
  const owned = await fs.mkdtemp(path.join(await fs.realpath(evidenceDir), 'domain-functions-'));
  callerAbortSignal?.addEventListener('abort', onCallerAbort, { once: true });
  if (callerAbortSignal?.aborted) controller.abort();
  const ledger = [];
  let child;
  let exited;
  let hostState;
  let hostWriter;
  let activeRun;
  let currentPhase = 'preparation';
  let hostAbort;
  let startupComplete = false;
  let startupFailed = false;
  let startupFailure;
  const failedLaunchPersistenceErrors = [];
  let incompleteLifecycle;
  let incompleteLifecycleCapturedAt;
  let deadlineTimer;
  let requestNumber = 0;
  let closed = false;
  let closePromise;
  let closeWorkPromise;
  const pending = new Map();
  const check = () => checkDeadline(controller.signal, buildDeadline);
  const coreDir = path.join(project, 'packages/core/dist');
  let coreBefore;
  let sourceBefore;
  let assetsBefore;
  let manifest;
  const manifestFile = path.join(owned, 'manifest.json');
  manifest = { scope: 'Prospective genuine selected Pages Functions browser host', project, dist, owned, fault, startedAt: new Date(started).toISOString(), deadlineAt: hostDeadline, ledger, realBrowserAcceptanceExecutedByHelper: false };
  const captureRun = run => { activeRun = run; currentPhase = run.label; };

  async function guard() {
    equalPins(await pinTree(coreDir, 'packages/core/dist'), coreBefore, 'Original core dist');
    equalPins(await Promise.all(SOURCE_FILES.map(relative => pin(path.join(project, relative), relative))), sourceBefore, 'Original Functions closure');
    equalPins(await pinTree(dist, 'assets'), assetsBefore, 'Original production assets');
  }

  async function request(command, data = {}) {
    if (closed || !child?.connected) return Promise.reject(new Error('Owned Functions host is closed.'));
    checkDeadline(controller.signal, hostDeadline);
    const id = ++requestNumber;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Owned Functions host IPC ${command} exceeded its declared deadline.`));
      }, Math.min(START_BUDGET, Math.max(1, hostDeadline - Date.now())));
      pending.set(id, { resolve, reject, timer });
      child.send({ id, command, ...data }, error => {
        if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    });
  }

  function closeWork() {
    if (closeWorkPromise) return closeWorkPromise;
    closeWorkPromise = (async () => {
      closed = true;
      clearTimeout(deadlineTimer);
      callerAbortSignal?.removeEventListener('abort', onCallerAbort);
      controller.signal.removeEventListener('abort', onHostAbort);
      hostAbort?.dispose();
      const processErrors = [];
      const streamErrors = [];
      const guardErrors = [];
      const persistenceErrors = [];
      const cleanupRecord = {};
      if (hostState) {
        try {
          if (child.connected) child.send({ id: 0, command: 'close' });
          const result = await bounded(Promise.race([hostState.exited, hostState.failed]), CLEANUP_BUDGET, `Owned Functions host ${child.pid} graceful cleanup exceeded 5000ms.`);
          cleanupRecord.graceful = result;
          if (result.code !== 0) processErrors.push(new Error(`Owned Functions host cleanup exited unsuccessfully: ${JSON.stringify(result)}`));
        } catch (error) {
          processErrors.push(error);
          cleanupRecord.graceful = String(error);
          try {
            cleanupRecord.sigterm = await terminateOwned(hostState);
            if (cleanupRecord.sigterm.code !== 0)
              processErrors.push(new Error(`Owned Functions host cleanup exited unsuccessfully: ${JSON.stringify(cleanupRecord.sigterm)}`));
          } catch (terminationError) { processErrors.push(terminationError); }
        }
        processErrors.push(...hostState.errors, ...hostState.signalErrors);
      }
      if (hostWriter) {
        try { await finalizeWriter(hostWriter, hostState); }
        catch (error) { streamErrors.push(error); }
        streamErrors.push(...hostWriter.errors);
      }
      for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Owned Functions host was closed.')); }
      pending.clear();
      const blocked = Boolean(activeRun?.blocked || (hostState && !hostState.closed) || (hostWriter && (!hostWriter.settled || hostWriter.timedOut)));
      if (!blocked && coreBefore && sourceBefore && assetsBefore) {
        try { await guard(); }
        catch (error) { guardErrors.push(error); }
      }
      manifest.closedAt = new Date().toISOString();
      const incomplete = startupFailed || blocked || processErrors.length || streamErrors.length || guardErrors.length;
      manifest.cleanup = incomplete
        ? 'Incomplete owned acceptance; retained child, stream and source evidence is not certified.'
        : 'Owned process exited; original pins unchanged.';
      manifest.cleanupRecord = cleanupRecord;
      if (incomplete) {
        manifest.lifecycle = lifecycleSnapshot(owned, activeRun, currentPhase);
        manifest.lifecycleCapturedAt = new Date().toISOString();
        Object.assign(manifest, diagnosticErrors(startupFailed ? [startupFailure] : [], processErrors, streamErrors, guardErrors, failedLaunchPersistenceErrors));
      }
      try {
        await bounded(fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n'), CLEANUP_BUDGET, 'Owned terminal diagnostic persistence exceeded 5000ms; evidence remains incomplete.');
      } catch (error) { persistenceErrors.push(error); }
      return { processErrors, streamErrors, guardErrors, persistenceErrors };
    })();
    return closeWorkPromise;
  }

  function close() {
    if (closePromise) return closePromise;
    closePromise = closeWork().then(outcome => {
      const errors = combineErrors(outcome.processErrors, outcome.streamErrors, outcome.guardErrors, outcome.persistenceErrors);
      if (errors.length) throw failure(errors, 'Owned Functions host cleanup failed.');
    });
    return closePromise;
  }
  const onHostAbort = () => {
    if (!startupComplete) { signalOwned(hostState); return; }
    void close().catch(error => { process.stderr.write(String(error) + '\n'); });
  };

  try {
    check();
    coreBefore = await pinTree(coreDir, 'packages/core/dist');
    check();
    equalPins(coreBefore, expectedCoreDistPins, 'Coordinated core dist');
    sourceBefore = await Promise.all(SOURCE_FILES.map(relative => pin(path.join(project, relative), relative)));
    check();
    // This selected endpoint currently has no ancestor middleware. A new one requires review.
    for (const directory of ['functions', 'functions/api']) {
      const names = await fs.readdir(path.join(project, directory));
      check();
      if (names.some(name => name.startsWith('_middleware.'))) throw new Error('New Pages ancestor middleware requires host-scope review.');
    }
    assetsBefore = await pinTree(dist, 'assets');
    check();
    if (assetsBefore.some(entry => entry.path === 'assets/_worker.js' || entry.path.startsWith('assets/_worker.js/')))
      throw new Error('Advanced-mode worker is outside this selected Functions host.');
    Object.assign(manifest, { coreBefore, sourceBefore, assetsBefore });
    await bounded(fs.writeFile(path.join(owned, 'startup-manifest.json'), JSON.stringify(manifest, null, 2) + '\n'), CLEANUP_BUDGET, 'Owned initial manifest persistence exceeded 5000ms; evidence remains incomplete.');
    check();
    for (const relative of SOURCE_FILES) {
      check();
      const destination = path.join(owned, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      check();
      await fs.copyFile(path.join(project, relative), destination);
      check();
    }
    await fs.mkdir(path.join(owned, 'assets'), { recursive: true });
    check();
    for (const entry of assetsBefore) {
      check();
      const relative = entry.path.slice('assets/'.length);
      const destination = path.join(owned, 'assets', relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      check();
      await fs.copyFile(path.join(dist, relative), destination);
      check();
    }
    equalPins(await Promise.all(SOURCE_FILES.map(relative => pin(path.join(owned, relative), relative))), sourceBefore, 'Copied Functions closure');
    check();
    equalPins(await pinTree(path.join(owned, 'assets'), 'assets'), assetsBefore, 'Copied production assets');
    check();
    for (const directory of ['tmp', 'config', 'worker']) { await fs.mkdir(path.join(owned, directory)); check(); }
    await fs.writeFile(path.join(owned, 'wrangler.json'), JSON.stringify({ name: 'wyreup-domain-functions-acceptance', compatibility_date: '2026-04-21', pages_build_output_dir: path.join(owned, 'assets') }, null, 2) + '\n');
    check();
    await linkDependencies(path.join(project, 'node_modules'), path.join(owned, 'node_modules'), check);
    await linkDependencies(path.join(project, 'packages/core/node_modules'), path.join(owned, 'packages/core/node_modules'), check);
    const wranglerPackage = await fs.realpath(path.join(project, 'node_modules/wrangler/package.json'));
    check();
    const wranglerDirectory = path.dirname(wranglerPackage);
    const wranglerBin = path.join(wranglerDirectory, 'bin/wrangler.js');
    const requireSdk = createRequire(wranglerPackage);
    const miniflarePackage = requireSdk.resolve('miniflare/package.json');
    const sdk = [
      await pin(wranglerPackage, 'sdk/wrangler/package.json'),
      await pin(wranglerBin, 'sdk/wrangler/bin/wrangler.js'),
      await pin(path.join(wranglerDirectory, 'wrangler-dist/cli.js'), 'sdk/wrangler/wrangler-dist/cli.js'),
      await pin(miniflarePackage, 'sdk/miniflare/package.json'),
      await pin(requireSdk.resolve('miniflare'), 'sdk/miniflare/dist/src/index.js'),
    ];
    check();
    if (JSON.parse(await fs.readFile(wranglerPackage, 'utf8')).version !== '4.148.0' || JSON.parse(await fs.readFile(miniflarePackage, 'utf8')).version !== '5.20261006.0-alpha')
      throw new Error('Native Pages/D1 SDK version differs from the reviewed host.');
    check();
    currentPhase = 'functions-build';
    await runOwned(process.execPath, [...process.execArgv, path.join(wranglerDirectory, 'wrangler-dist/cli.js'), 'pages', 'functions', 'build', path.join(owned, 'functions'), '--outdir', path.join(owned, 'worker'), '--build-output-directory', path.join(owned, 'assets'), '--compatibility-date', '2026-04-21'], { owned, signal: controller.signal, deadlineAt: buildDeadline, label: 'functions-build', ledger, captureRun });
    activeRun = null;
    const workerFile = path.join(owned, 'worker/index.js');
    currentPhase = 'functions-worker-syntax';
    await runOwned(process.execPath, [...process.execArgv, '--check', workerFile], { owned, signal: controller.signal, deadlineAt: buildDeadline, label: 'functions-worker-syntax', ledger, captureRun });
    activeRun = null;
    currentPhase = 'post-build-guard';
    await guard();
    check();
    currentPhase = 'host-configuration';
    const configuration = {
      owned, wranglerPackage, workerFile, fault,
      assets: path.join(owned, 'assets'),
      migration: path.join(owned, 'migrations/0008_public_domain_limits.sql'),
      deadlineAt: hostDeadline,
    };
    const configPath = path.join(owned, 'host-config.json');
    await fs.writeFile(configPath, JSON.stringify(configuration, null, 2) + '\n');
    check();
    currentPhase = 'functions-host';
    hostWriter = observeWriter(createWriteStream(path.join(owned, 'functions-host.log'), { flags: 'wx' }), 'functions-host');
    activeRun = { label: 'functions-host', writer: hostWriter, childState: null, blocked: false };
    child = fork(fileURLToPath(import.meta.url), ['--host-child', configPath], { cwd: owned, env: childEnvironment(owned), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    hostState = exitOf(child);
    activeRun.childState = hostState;
    exited = hostState.exited;
    ledger.push({ command: process.execPath, args: [...process.execArgv, fileURLToPath(import.meta.url), '--host-child', configPath], cwd: owned, pid: child.pid, log: 'functions-host.log', startedAt: new Date().toISOString() });
    hostWriter.onFailure = () => signalOwned(hostState);
    attachWriter(hostWriter, hostState);
    void exited.then(() => finalizeWriter(hostWriter, hostState)).catch(() => undefined);
    const ready = new Promise((resolve, reject) => {
      const onMessage = message => {
        if (message?.kind === 'ready') { child.off('message', onMessage); resolve(message); }
        if (message?.kind === 'startup-error') { child.off('message', onMessage); reject(new Error(message.error)); }
      };
      child.on('message', onMessage);
      void exited.then(result => { child.off('message', onMessage); reject(new Error(`Owned Functions host exited before readiness: ${JSON.stringify(result)}`)); });
    });
    child.on('message', message => {
      if (!Number.isSafeInteger(message?.id)) return;
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id); clearTimeout(callback.timer);
      if (message.error) callback.reject(new Error(message.error)); else callback.resolve(message.value);
    });
    controller.signal.addEventListener('abort', onHostAbort, { once: true });
    hostAbort = observeAbort(controller.signal);
    if (controller.signal.aborted) onHostAbort();
    deadlineTimer = setTimeout(() => controller.abort(), Math.max(1, hostDeadline - Date.now()));
    const startedHost = await bounded(Promise.race([ready, hostState.failed, hostWriter.failed, hostAbort.failed]), Math.min(START_BUDGET, Math.max(1, buildDeadline - Date.now())), 'Owned Functions host did not become ready within its startup budget.');
    hostAbort.dispose();
    check();
    const parsedUrl = new URL(startedHost.url);
    if (parsedUrl.hostname !== '127.0.0.1' || parsedUrl.protocol !== 'http:') throw new Error('Owned host did not bind the required loopback origin.');
    Object.assign(manifest, { coreBefore, sourceBefore, assetsBefore, sdk, testOnlyConfig: await pin(path.join(owned, 'wrangler.json'), 'wrangler.json'), worker: await pin(workerFile, 'worker/index.js'), workerModules: await pinTree(path.join(owned, 'worker'), 'worker'), platform: startedHost.platform, migration: startedHost.migration, conventionalDependenciesOnly: true });
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    checkDeadline(controller.signal, hostDeadline);
    startupComplete = true;
    return {
      url: parsedUrl.origin,
      manifest: manifestFile,
      setProviderScenario: scenario => request('scenario', { scenario }),
      resetAdmission: () => request('reset'),
      inspect: () => request('inspect'),
      close,
    };
  } catch (error) {
    startupFailed = true;
    startupFailure = error;
    incompleteLifecycle = activeRun?.lifecycle ?? lifecycleSnapshot(owned, activeRun, currentPhase);
    incompleteLifecycleCapturedAt = activeRun?.lifecycleCapturedAt ?? new Date().toISOString();
    const abortCleanup = controller.signal.aborted ? closeWork() : null;
    void abortCleanup?.catch(() => undefined);
    try {
      await bounded(fs.writeFile(path.join(owned, 'failed-launch.json'), JSON.stringify({ error: String(startupFailure), ...diagnosticErrors([startupFailure]), ledger, owned, lifecycle: incompleteLifecycle, lifecycleCapturedAt: incompleteLifecycleCapturedAt }, null, 2) + '\n'), CLEANUP_BUDGET, 'Owned failed-launch diagnostic persistence exceeded 5000ms; evidence remains incomplete.');
    } catch (writeError) { failedLaunchPersistenceErrors.push(writeError); }
    const outcome = await (abortCleanup ?? closeWork());
    const errors = combineErrors([error], outcome.processErrors, outcome.streamErrors, outcome.guardErrors, failedLaunchPersistenceErrors, outcome.persistenceErrors);
    throw failure(errors, 'Owned Functions startup failed with cleanup errors.');
  }
}

async function childMain(configPath) {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const requireSdk = createRequire(config.wranglerPackage);
  const { Miniflare, Response, convertV4MiniflareOptions } = requireSdk('miniflare');
  const { unstable_generateASSETSBinding } = requireSdk('wrangler');
  const assetController = new AbortController();
  let mf;
  let db;
  let scenario = 'ok';
  let outboundCalls = 0;
  let unexpectedOutbound = 0;
  const requests = [];
  let closing;
  let deadlineTimer;
  const log = Object.fromEntries(['debug', 'log', 'info', 'warn', 'error'].map(level => [level, value => process.stderr.write(`[assets:${level}] ${String(value)}\n`)]));
  const send = value => new Promise((resolve, reject) => {
    if (!process.connected) { resolve(); return; }
    process.send(value, error => error ? reject(error) : resolve());
  });
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      clearTimeout(deadlineTimer);
      assetController.abort();
      if (mf) await bounded(mf.dispose(), CLEANUP_BUDGET, `Native owned runtime cleanup did not settle; retain host PID ${process.pid}.`);
      await send({ kind: 'closed' });
      if (process.connected) process.disconnect();
    })();
    return closing;
  };
  const onSignal = () => { void close().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; }); };
  process.once('SIGTERM', onSignal);
  process.once('disconnect', onSignal);
  try {
    checkDeadline(assetController.signal, config.deadlineAt);
    const assets = await unstable_generateASSETSBinding({ directory: config.assets, log, signal: assetController.signal });
    checkDeadline(assetController.signal, config.deadlineAt);
    mf = new Miniflare(convertV4MiniflareOptions({
      host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
      resourcePersistencePath: path.join(config.owned, 'persist'),
      resourceTmpPath: path.join(config.owned, 'runtime-tmp'),
      unsafeDevRegistryPath: path.join(config.owned, 'registry'),
      name: 'wyreup-domain-functions-acceptance', modules: true,
      scriptPath: config.workerFile, compatibilityDate: '2026-04-21',
      d1Databases: { [config.fault === 'missing-database' ? '__TEST_DB' : 'DB']: DATABASE_ID },
      bindings: config.fault === 'missing-secret' ? {} : { SESSION_SECRET: SYNTHETIC_SECRET },
      cacheAPI: false,
      serviceBindings: { ASSETS: assets },
      outboundService: async request => {
        outboundCalls++;
        const allowedBootstrap = request.url === 'https://data.iana.org/rdap/dns.json';
        const allowedProvider = request.url === 'https://rdap.verisign.com/com/v1/domain/example.com';
        const headers = {
          accept: request.headers.get('Accept'),
          authorization: request.headers.get('Authorization'),
          cookie: request.headers.get('Cookie'),
          referer: request.headers.get('Referer'),
        };
        if (requests.length < 256) requests.push({ dependency: allowedBootstrap ? 'bootstrap' : allowedProvider ? 'registry' : 'unexpected', method: request.method, headers, scenario });
        if (outboundCalls > 256 || request.method !== 'GET' || (!allowedBootstrap && !allowedProvider)) {
          unexpectedOutbound++;
          return new Response('Unexpected upstream request refused by conventional dependency fixture.', { status: 502 });
        }
        if (allowedBootstrap) return Response.json({ services: [[['com'], ['https://rdap.verisign.com/com/v1/']]] });
        if (scenario === 'provider-rate-limited') return new Response('', { status: 429, headers: { 'Retry-After': '7' } });
        if (scenario === 'provider-error') return new Response('', { status: 503 });
        return new Response(JSON.stringify({ objectClassName: 'domain', ldhName: 'example.com', events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }] }), { status: 200, headers: { 'Content-Type': 'application/rdap+json' } });
      },
    }));
    const url = await bounded(mf.ready, Math.min(START_BUDGET, Math.max(1, config.deadlineAt - Date.now())), 'Native owned runtime did not become ready.');
    checkDeadline(assetController.signal, config.deadlineAt);
    db = await mf.getD1Database(config.fault === 'missing-database' ? '__TEST_DB' : 'DB');
    checkDeadline(assetController.signal, config.deadlineAt);
    const migrationText = await fs.readFile(config.migration, 'utf8');
    checkDeadline(assetController.signal, config.deadlineAt);
    const expression = /CREATE TABLE[\s\S]*?;\n|CREATE INDEX[^\n]+;\n|CREATE TRIGGER[\s\S]*?END;/g;
    const statements = migrationText.match(expression);
    if (!statements || statements.length !== 9 || migrationText.replace(expression, '').trim()) throw new Error('Actual migration0008 shape changed; no partial migration is accepted.');
    const result = await db.batch(statements.map(sql => db.prepare(sql)));
    if (result.length !== 9 || result.some(value => value.success !== true)) throw new Error('Native isolated migration0008 did not succeed.');
    checkDeadline(assetController.signal, config.deadlineAt);
    deadlineTimer = setTimeout(onSignal, Math.max(1, config.deadlineAt - Date.now()));
    await send({ kind: 'ready', url: url.href, platform: { host: '127.0.0.1', cf: false, syntheticDatabase: DATABASE_ID, syntheticSecret: true, receivedHeaderObserver: false }, migration: { statements: 9, sha256: sha256(Buffer.from(migrationText)) } });
    let queue = Promise.resolve();
    process.on('message', message => {
      queue = queue.then(async () => {
        if (message?.command === 'close') { await close(); return; }
        if (!Number.isSafeInteger(message?.id) || message.id < 1) return;
        try {
          checkDeadline(assetController.signal, config.deadlineAt);
          let value;
          if (message.command === 'scenario') {
            if (!['ok', 'provider-rate-limited', 'provider-error'].includes(message.scenario)) throw new Error('Unknown conventional dependency scenario.');
            scenario = message.scenario;
            value = { scenario };
          } else if (message.command === 'reset') {
            const active = await db.prepare('SELECT count(*) AS count FROM public_api_inflight_leases').first();
            if (active.count !== 0) throw new Error('Cannot reset admission while real endpoint leases remain.');
            const reset = await db.batch([db.prepare('DELETE FROM public_api_rate_windows'), db.prepare('DELETE FROM public_api_inflight_leases')]);
            if (reset.some(item => item.success !== true)) throw new Error('Native admission reset failed.');
            value = { reset: true };
          } else if (message.command === 'inspect') {
            const counters = await db.prepare('SELECT route,window_start,scope_key,count FROM public_api_rate_windows ORDER BY window_start,scope_key').all();
            const leases = await db.prepare('SELECT count(*) AS count FROM public_api_inflight_leases').first();
            const clock = await db.prepare('SELECT unixepoch() AS now_seconds,(unixepoch()/60)*60 AS window_start').first();
            const expectedLoopbackDigest = createHmac('sha256', SYNTHETIC_SECRET).update(`wyreup:domain-age:rate:v1:${clock.window_start}:127.0.0.1`).digest('hex');
            value = { outboundCalls, unexpectedOutbound, requests: [...requests], counters: counters.results, leaseCount: leases.count, clock, expectedLoopbackDigest, realBindings: { database: config.fault !== 'missing-database', secret: config.fault !== 'missing-secret' } };
          } else throw new Error('Unknown owned parent IPC command.');
          await send({ id: message.id, value });
        } catch (error) { await send({ id: message.id, error: String(error) }); }
      }).catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
    });
  } catch (error) {
    await send({ kind: 'startup-error', error: String(error) });
    process.exitCode = 1;
    await close();
  }
}

if (process.argv[2] === '--host-child') {
  void childMain(process.argv[3]).catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
}
