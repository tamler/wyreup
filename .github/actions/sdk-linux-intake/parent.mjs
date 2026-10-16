import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const startedAtMs = Date.now(), startedMonotonicNs = process.hrtime.bigint();
const deadlineAtMs = startedAtMs + 30000, deadlineMonotonicNs = startedMonotonicNs + 30000000000n;
const SOURCE = fileURLToPath(import.meta.url), DIRECTORY = path.dirname(SOURCE);
const OWNED_PARENT = '/home/runner/work/_temp';
const STREAM_CAP = 65536, STAGED_CAP = 1048576, BODY_CAP = 67108864, BODY_TOTAL = 268435456;
const ENV = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' };
const files = [], live = new Map();
const causes = [], secondary = [];
let expired = false, owner = null, finished = false, keeper = null, root = null, rootIdentity = null;
let bodyBytes = 0, stagedBytes = 0, timer, resolveEndpoint;
let unavailablePython = null;
let imageContextInvalid = false;
let parentStdoutBytes = 0, parentStdoutFailed = false;
const endpoint = new Promise(resolve => { resolveEndpoint = resolve; });
function remember(reason, role) {
  if (!causes.length) causes.push({ reason, role });
  else if (!Object.is(causes[0].reason, reason) && secondary.length < 32) secondary.push({ reason, role });
}
function errorData(reason) {
  try {
    const name = Object.getOwnPropertyDescriptor(reason, 'code');
    return { type: typeof reason, code: name && Object.hasOwn(name, 'value') && typeof name.value === 'string' ? name.value : null };
  } catch { return { type: typeof reason, code: null }; }
}
function remaining() { return Math.min(deadlineAtMs - Date.now(), Number(deadlineMonotonicNs - process.hrtime.bigint()) / 1e6); }
function arm() {
  const left = remaining();
  if (left <= 0) { expired = true; remember(new Error('ORIGINAL_ENDPOINT_EXPIRED'), 'endpoint'); resolveEndpoint(); }
  else timer = setTimeout(arm, Math.max(1, left));
}
arm();
function check() {
  if (remaining() <= 0) { expired = true; remember(new Error('ORIGINAL_ENDPOINT_EXPIRED'), 'endpoint'); }
  assert(!expired, 'ORIGINAL_ENDPOINT_EXPIRED');
}
function identity(st) {
  return { dev: String(st.dev), ino: String(st.ino), mode: String(st.mode), uid: String(st.uid), gid: String(st.gid),
    nlink: String(st.nlink), size: String(st.size), mtime_ns: String(st.mtimeNs), ctime_ns: String(st.ctimeNs) };
}
function noLinks(p, directory = false) {
  check(); assert(path.isAbsolute(p) && path.normalize(p) === p);
  let current = '/';
  for (const part of p.slice(1).split('/')) { current = path.join(current, part); assert(!fs.lstatSync(current).isSymbolicLink()); check(); }
  assert.equal(fs.realpathSync(p), p);
  const st = fs.lstatSync(p, { bigint: true }); assert(directory ? st.isDirectory() : st.isFile()); check(); return st;
}
function open(p, flags, role, mode) {
  check(); assert(files.length < 64);
  const record = { path: p, role, openAttempted: true, acquired: false, bytes: 0, closeAttempted: false, closeReturned: false };
  files.push(record);
  try { record.fd = fs.openSync(p, flags | fs.constants.O_NOFOLLOW, mode); record.acquired = true; live.set(record.fd, record); }
  catch (reason) { record.error = errorData(reason); remember(reason, role + ':open'); throw reason; }
  return record;
}
function close(record) {
  if (!record?.acquired || record.closeAttempted) return;
  record.closeAttempted = true;
  try { fs.closeSync(record.fd); record.closeReturned = true; live.delete(record.fd); }
  catch (reason) { record.closeError = errorData(reason); remember(reason, record.role + ':close'); }
  retain();
}
function read(p, cap, role, body = false) {
  check(); const before = fs.lstatSync(p, { bigint: true }); assert(before.isFile());
  const record = open(p, fs.constants.O_RDONLY, role), digest = createHash('sha256'), chunks = [];
  try {
    assert.deepEqual(identity(fs.fstatSync(record.fd, { bigint: true })), identity(before));
    const buffer = Buffer.alloc(65536);
    for (;;) {
      check(); const n = fs.readSync(record.fd, buffer, 0, Math.min(buffer.length, cap - record.bytes + 1), null);
      record.bytes += n; bodyBytes += n; check();
      assert(record.bytes <= cap && bodyBytes <= BODY_TOTAL, 'BODY_CAP');
      if (!n) break;
      digest.update(buffer.subarray(0, n)); if (body) chunks.push(Buffer.from(buffer.subarray(0, n)));
    }
    assert.deepEqual(identity(fs.fstatSync(record.fd, { bigint: true })), identity(before));
  } catch (reason) { remember(reason, role); throw reason; }
  finally { close(record); }
  assert(record.closeReturned); assert.deepEqual(identity(fs.lstatSync(p, { bigint: true })), identity(before)); check();
  return { pin: { path: p, bytes: record.bytes, sha256: digest.digest('hex'), physical: identity(before) },
    body: body ? Buffer.concat(chunks) : null };
}
function write(record, bytes) {
  assert(record.acquired && !record.closeAttempted);
  let offset = 0;
  while (offset < bytes.length) {
    check(); assert(record.bytes < STREAM_CAP && stagedBytes < STAGED_CAP, 'STAGING_CAP');
    const count = Math.min(bytes.length - offset, STREAM_CAP - record.bytes, STAGED_CAP - stagedBytes);
    const n = fs.writeSync(record.fd, bytes, offset, count); assert(n > 0);
    record.bytes += n; stagedBytes += n; offset += n; check();
  }
}
function json(record, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert(bytes.length <= STREAM_CAP, 'RESULT_CAP'); write(record, bytes);
}
function pending() { return live.size > 0 || (owner !== null && !owner.finished); }
function retain() {
  if (!finished) return;
  if (pending() && keeper === null) keeper = setInterval(() => {}, 1000);
  else if (!pending() && keeper !== null) { clearInterval(keeper); keeper = null; }
}
function pythonCandidate(preExec = false) {
  const candidate = '/usr/bin/python3', links = [], steps = [], seen = new Set();
  let current = '/', queue = candidate.slice(1).split('/');
  while (queue.length) {
    check(); const next = path.join(current, queue.shift());
    let st;
    try { st = fs.lstatSync(next, { bigint: true }); }
    catch (reason) {
      if (preExec && ['EACCES', 'EPERM'].includes(reason.code)) unavailablePython = { candidate, status: 'DENIED', errno: reason.code };
      else if (preExec && reason.code === 'ENOENT' && next === candidate && queue.length === 0 && links.length === 0) unavailablePython = { candidate, status: 'ABSENT', errno: reason.code };
      throw reason;
    }
    steps.push({ path: next, physical: identity(st) });
    if (st.isSymbolicLink()) {
      assert(links.length < 8 && !seen.has(next), 'PYTHON_LINK_HELD'); seen.add(next);
      const literal = fs.readlinkSync(next); assert(Buffer.byteLength(literal) <= 4096);
      links.push({ path: next, literal, physical: identity(st) });
      assert.deepEqual(identity(fs.lstatSync(next, { bigint: true })), identity(st));
      const target = path.resolve(current, literal); queue = [...target.slice(1).split('/'), ...queue]; current = '/';
    } else { assert(!queue.length || st.isDirectory()); current = next; }
  }
  const st = fs.lstatSync(current, { bigint: true }); assert(st.isFile());
  assert(['/usr/bin', '/usr/sbin', '/usr/lib', '/usr/lib64', '/lib', '/lib64'].some(prefix => current.startsWith(prefix + '/')));
  return { candidate, status: 'OBSERVED', canonical: current, physical: identity(st), links, steps };
}
function startCollector(python, collector, image, captures) {
  check();
  const o = { program: '/usr/bin/python3', args: ['-I', '-S', collector, root], cwd: root,
    suppliedEnvironment: ENV, spawnAttempted: true, spawnObserved: false, pid: null,
    errorPresent: false, error: null, exitObserved: false, exit: null, closeObserved: false, close: null,
    stdin: { endAttempted: false, callbackObserved: false, finish: false, close: false, errors: [] },
    stdout: { total: 0, retained: 0, dropped: 0, end: false, close: false, errors: [] },
    stderr: { total: 0, retained: 0, dropped: 0, end: false, close: false, errors: [] }, finished: false };
  owner = o; let resolve; o.done = new Promise(r => { resolve = r; });
  function settle() {
    if (o.finished || !o.closeObserved || !o.stdin.close || !o.stdout.close || !o.stderr.close) return;
    close(captures.stdout); close(captures.stderr); o.finished = true; resolve(o); retain();
  }
  function stream(label, value) {
    const state = o[label], record = captures[label];
    assert(value, 'MISSING_COLLECTOR_PIPE');
    value.on('data', chunk => {
      const before = record.bytes;
      try {
        assert(Buffer.isBuffer(chunk) && Number.isSafeInteger(state.total + chunk.length)); state.total += chunk.length;
        if (state.total > STREAM_CAP) { state.overflow = true; remember(new Error('COLLECTOR_STREAM_CAP'), label); }
        if (remaining() <= 0) { expired = true; return; }
        const take = Math.min(chunk.length, STREAM_CAP - state.retained); if (take > 0) write(record, chunk.subarray(0, take));
      } catch (reason) { state.recordingFailed = true; remember(reason, label + ':data'); }
      finally { state.retained += record.bytes - before; state.dropped = state.total - state.retained; }
    });
    value.on('error', reason => { if (state.errors.length < 8) state.errors.push(errorData(reason)); remember(reason, label + ':error'); });
    value.once('end', () => { state.end = true; });
    value.once('close', () => { state.close = true; settle(); });
  }
  try {
    assert.equal(python.candidate, '/usr/bin/python3');
    o.child = spawn(o.program, o.args, { cwd: root, env: ENV, stdio: ['pipe', 'pipe', 'pipe'] }); o.pid = o.child.pid ?? null;
    o.child.once('spawn', () => { o.spawnObserved = true; });
    o.child.on('error', reason => { o.errorPresent = true; o.error = errorData(reason); remember(reason, 'collector:error'); });
    o.child.once('exit', (code, signal) => { o.exitObserved = true; o.exit = { code, signal }; });
    o.child.once('close', (code, signal) => { o.closeObserved = true; o.close = { code, signal }; settle(); });
    stream('stdout', o.child.stdout); stream('stderr', o.child.stderr);
    assert(o.child.stdin, 'MISSING_COLLECTOR_STDIN');
    o.child.stdin.on('error', reason => { if (o.stdin.errors.length < 8) o.stdin.errors.push(errorData(reason)); remember(reason, 'stdin:error'); });
    o.child.stdin.once('finish', () => { o.stdin.finish = true; });
    o.child.stdin.once('close', () => { o.stdin.close = true; settle(); });
    const encoded = Buffer.from(JSON.stringify(image) + '\n'); assert(encoded.length <= 1024);
    o.stdin.endAttempted = true;
    o.child.stdin.end(encoded, reason => { o.stdin.callbackObserved = true; if (reason !== undefined && reason !== null) remember(reason, 'stdin:callback'); });
  } catch (reason) {
    remember(reason, 'collector:launch');
    if (!o.child) { close(captures.stdout); close(captures.stderr); o.finished = true; resolve(o); }
  }
  return o;
}
function nativeData() {
  if (owner === null) return null;
  const { child, done, ...record } = owner; return record;
}
function outputLine(value) {
  try {
    assert(!parentStdoutFailed, 'PARENT_STDOUT_ALREADY_FAILED');
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    assert(bytes.length <= STREAM_CAP - parentStdoutBytes, 'PARENT_STDOUT_TOTAL_CAP');
    let offset = 0;
    while (offset < bytes.length) {
      check(); const n = fs.writeSync(1, bytes, offset); assert(n > 0);
      offset += n; parentStdoutBytes += n; check();
    }
  } catch (reason) { parentStdoutFailed = true; remember(reason, 'parent-stdout'); throw reason; }
}
async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert(/^v24\./.test(process.version));
  assert.deepEqual(process.execArgv, []);
  const run = process.env.INPUT_RUN_ID, attempt = process.env.INPUT_RUN_ATTEMPT;
  assert(typeof run === 'string' && /^[0-9]{1,20}$/.test(run) && typeof attempt === 'string' && /^[0-9]{1,20}$/.test(attempt), 'WORKFLOW_CONTEXT_INVALID');
  const image = { ImageOS: process.env.ImageOS ?? null, ImageVersion: process.env.ImageVersion ?? null };
  imageContextInvalid = !Object.values(image).every(value => value === null || typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value));
  assert(!imageContextInvalid, 'IMAGE_CONTEXT_INVALID');
  const outputPath = process.env.GITHUB_OUTPUT;
  assert(typeof outputPath === 'string' && path.isAbsolute(outputPath) && !/[\r\n\0]/.test(outputPath), 'WORKFLOW_OUTPUT_INVALID');
  const source = path.join(DIRECTORY, 'collector.py'); noLinks(SOURCE); noLinks(source);
  const bindingPath = path.join(DIRECTORY, 'collector-binding.json'); noLinks(bindingPath);
  const bindingRead = read(bindingPath, 4096, 'source-binding', true), binding = JSON.parse(bindingRead.body);
  assert.deepEqual(Object.keys(binding).sort(), ['schemaVersion', 'relativePath', 'bytes', 'sha256'].sort());
  assert.equal(binding.schemaVersion, 1); assert.equal(binding.relativePath, 'collector.py');
  const sourceRead = read(source, 65536, 'collector-source');
  assert.equal(sourceRead.pin.bytes, binding.bytes); assert.equal(sourceRead.pin.sha256, binding.sha256);
  const python = pythonCandidate(true);
  try { python.pin = read(python.canonical, BODY_CAP, 'python-before-exec').pin; }
  catch (reason) {
    if (['EACCES', 'EPERM'].includes(reason.code)) unavailablePython = { candidate: python.candidate, status: 'DENIED', errno: reason.code };
    throw reason;
  }
  assert.deepEqual(python.physical, python.pin.physical);
  const pythonAgain = pythonCandidate(true); assert.deepEqual(pythonAgain, (({ pin, ...record }) => record)(python));
  noLinks(OWNED_PARENT, true); root = path.join(OWNED_PARENT, 'wyreup-linux-intake-' + run + '-' + attempt);
  check(); fs.mkdirSync(root, { mode: 0o700 }); const st = noLinks(root, true);
  assert.equal(st.mode & 0o777n, 0o700n); assert.equal(st.uid, BigInt(process.getuid()));
  const names = ['invocation.json', 'collector.stdout.log', 'collector.stderr.log', 'parent-result.json', 'closure.json', 'manifest.json'];
  const outputs = new Map();
  for (const name of names) {
    const record = open(path.join(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, name, 0o600);
    const own = fs.fstatSync(record.fd, { bigint: true }); assert(own.isFile() && own.nlink === 1n && (own.mode & 0o777n) === 0o600n); outputs.set(name, record);
  }
  rootIdentity = identity(noLinks(root, true));
  const invocation = { schemaVersion: 1, classification: 'ROOT_OWNED_LINUX_INTAKE_INVOCATION',
    source: { path: source, bytes: sourceRead.pin.bytes, sha256: sourceRead.pin.sha256 }, python,
    root: { path: root, physical: rootIdentity }, startedAtMs, deadlineAtMs,
    startedMonotonicNs: String(startedMonotonicNs), deadlineMonotonicNs: String(deadlineMonotonicNs) };
  json(outputs.get('invocation.json'), invocation); close(outputs.get('invocation.json')); assert(!causes.length);
  const invocationPin = read(path.join(root, 'invocation.json'), STREAM_CAP, 'invocation-before-spawn').pin;
  const native = startCollector(python, source, image, { stdout: outputs.get('collector.stdout.log'), stderr: outputs.get('collector.stderr.log') });
  await Promise.race([native.done, endpoint]); check();
  assert(native.finished && native.spawnObserved && native.exitObserved && native.closeObserved && !native.errorPresent);
  assert.equal(native.exit.signal, null); assert.equal(native.close.signal, null); assert.equal(native.exit.code, native.close.code);
  assert(native.stdin.callbackObserved && native.stdin.finish && native.stdin.close && native.stdin.errors.length === 0);
  for (const label of ['stdout', 'stderr']) assert(native[label].end && native[label].close && native[label].errors.length === 0 && native[label].dropped === 0 && !native[label].recordingFailed);
  assert(!causes.length);
  const stdout = read(path.join(root, 'collector.stdout.log'), STREAM_CAP, 'collector-result-read', true);
  const collector = JSON.parse(stdout.body); const statuses = ['COMPLETE_USABLE', 'COMPLETE_UNAVAILABLE', 'INCOMPLETE_CLOSED', 'PENDING_OWNERSHIP', 'LOST_CUSTODY'];
  assert.equal(collector.classification, 'READ_ONLY_LINUX_INTAKE_NOT_QUALIFICATION'); assert(statuses.includes(collector.status));
  assert.equal(collector.expired, false); assert.deepEqual(collector.pendingFileDescriptors, []);
  assert.deepEqual(collector.invocationPin, invocationPin); assert.equal(collector.source.sha256, binding.sha256);
  assert(Number.isSafeInteger(collector.bodyReadBytes) && collector.bodyReadBytes >= python.pin.bytes && collector.bodyReadBytes <= BODY_TOTAL);
  const collectorActualReadBytes = collector.bodyReadBytes - python.pin.bytes;
  assert(Number.isSafeInteger(bodyBytes + collectorActualReadBytes) && bodyBytes + collectorActualReadBytes <= BODY_TOTAL);
  bodyBytes += collectorActualReadBytes;
  assert.deepEqual(read(source, 65536, 'collector-source-postguard').pin, sourceRead.pin);
  assert.deepEqual(read(bindingPath, 4096, 'binding-postguard').pin, bindingRead.pin);
  assert.deepEqual(pythonCandidate(), pythonAgain);
  assert.deepEqual(read(python.canonical, BODY_CAP, 'python-postguard').pin, python.pin);
  assert.deepEqual(identity(noLinks(root, true)), rootIdentity);
  assert.deepEqual(fs.readdirSync(root).sort(), names.slice().sort());
  const usable = collector.status === 'COMPLETE_USABLE' && native.exit.code === 0 && collector.packageQuery?.returncode === 0;
  assert(usable || native.exit.code !== 0, 'NONUSABLE_COLLECTOR_EXIT_ZERO');
  const result = { schemaVersion: 1, classification: 'READ_ONLY_LINUX_INTAKE_PARENT_NOT_QUALIFICATION', status: collector.status,
    startedAtMs, deadlineAtMs, startedMonotonicNs: String(startedMonotonicNs), deadlineMonotonicNs: String(deadlineMonotonicNs),
    root, rootIdentity, source: invocation.source, python, imageContext: image, native: nativeData(),
    collectorOutput: stdout.pin, collector, actualBodyReadBytes: bodyBytes, expired: false,
    fileRecords: files, firstFailure: null, secondary: [],
    ownResultAndWorkflowExitClosure: 'PRETERMINAL_WORKFLOW_RUNNER_MUST_OBSERVE_ACTUAL_ACTION_EXIT',
    retention: 'NORMAL_ONLY_ARTIFACT_NONUSABLE_JOB_ROOT_RETENTION_NOT_GUARANTEED', SDKQualified: false };
  json(outputs.get('parent-result.json'), result); close(outputs.get('parent-result.json'));
  json(outputs.get('closure.json'), { schemaVersion: 1, native: nativeData(), fileRecords: files,
    expired, ownFinalWritersPreterminal: true, externalActionClosureStillWorkflowObserved: true }); close(outputs.get('closure.json'));
  const safePins = [];
  for (const name of names.filter(name => name !== 'manifest.json')) {
    assert(outputs.get(name).closeReturned); safePins.push(read(path.join(root, name), STREAM_CAP, 'safe-member-readback').pin);
  }
  json(outputs.get('manifest.json'), { schemaVersion: 1, classification: 'FINITE_LINUX_INTAKE_SAFE_FILES_NOT_QUALIFICATION',
    members: safePins, selfManifestIntentionallyNotSelfHashed: true, byteCeiling: STAGED_CAP, retentionDays: 1,
    sourceInputs: [sourceRead.pin, bindingRead.pin], normalOnly: true }); close(outputs.get('manifest.json'));
  const finalPins = safePins.concat(read(path.join(root, 'manifest.json'), STREAM_CAP, 'manifest-readback').pin);
  assert(finalPins.reduce((sum, pin) => sum + pin.bytes, 0) <= STAGED_CAP);
  assert.deepEqual(identity(noLinks(root, true)), rootIdentity); assert(!pending() && !causes.length); check();
  outputLine({ classification: result.classification, status: result.status, root, nativePID: native.pid,
    actualClosed: native.finished, expired: false, uploadEligible: usable, members: finalPins });
  // Only usable, on-time normal action success may enable the separate trusted
  // uploader. Closed nonusable records never claim artifact preservation.
  if (usable) {
    const service = open(outputPath, fs.constants.O_WRONLY | fs.constants.O_APPEND, 'github-output');
    try {
      const bytes = Buffer.from('upload_safe=true\nroot=' + root + '\n');
      let offset = 0;
      while (offset < bytes.length) { check(); const n = fs.writeSync(service.fd, bytes, offset); assert(n > 0); service.bytes += n; offset += n; check(); }
    } catch (reason) { remember(reason, 'github-output'); throw reason; }
    finally { close(service); }
    assert(service.closeReturned && !causes.length); check();
  } else process.exitCode = 1;
}
try { await main(); }
catch (reason) {
  remember(reason, 'main'); process.exitCode = 1;
  // Capture FDs stay with an actual pending collector. Before launch, the
  // parent closes its own captures; close uncertainty remains pending.
  for (const record of files) {
    const nativeCapturePending = ['collector.stdout.log', 'collector.stderr.log'].includes(record.role) && owner !== null && !owner.finished;
    if (record.acquired && !record.closeAttempted && !nativeCapturePending) close(record);
  }
  if (!expired && !parentStdoutFailed) {
    try { outputLine({ classification: 'LINUX_INTAKE_REFUSED_NOT_QUALIFICATION', status: pending() ? 'PENDING_OWNERSHIP' : unavailablePython !== null ? 'COMPLETE_UNAVAILABLE' : 'INCOMPLETE_CLOSED',
      root, expired, unavailablePython, diagnostic: imageContextInvalid ? 'IMAGE_CONTEXT_INVALID' : null, firstCause: errorData(causes[0].reason), secondary: secondary.map(value => ({ role: value.role, error: errorData(value.reason) })),
      native: nativeData(), uncertainFileRecords: [...live.values()], uploadEligible: false }); }
    catch (publicationReason) { remember(publicationReason, 'failure-stdout'); }
  }
} finally { finished = true; clearTimeout(timer); retain(); }
