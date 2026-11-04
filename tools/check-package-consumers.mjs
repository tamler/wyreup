import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import yaml from 'js-yaml';
import { loadArtifacts } from './check-release-artifacts.mjs';
import { build } from 'esbuild';
import { assertMinimumVersion, checkInstalledVersions } from './check-dependency-versions.mjs';
import { assertNpmMajor, resolveNpmCli } from './consumer-package-managers.mjs';

const exec = promisify(execFile);
const limits = { policy: 256 * 1024, lock: 2 * 1024 * 1024, stream: 2 * 1024 * 1024, error: 4 * 1024, receipt: 16 * 1024 * 1024, manifest: 64 * 1024 };
const receiptNames = ['migration-npm.json', 'migration-pnpm.json'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = value => value.split(path.sep).join('/');
let normalizeDiagnostics = value => value;

function pathNormalizer(aliases, platform = process.platform) {
  const spellings = aliases.flatMap(([value, label]) => [...new Set([value, value.replaceAll('\\', '/'), JSON.stringify(value).slice(1, -1)])]
    .map(spelling => ({ spelling, label }))).sort((left, right) => right.spelling.length - left.spelling.length);
  return value => {
    let result = value;
    for (const { spelling, label } of spellings) {
      const literal = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(literal, platform === 'win32' ? 'gi' : 'g'), () => label);
    }
    return result;
  };
}

function contained(owner, candidate) {
  const relative = path.relative(owner, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function sameFile(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && after.isFile();
}

function writtenFileMatches(identity, observed, size) {
  return identity.dev === observed.dev && identity.ino === observed.ino && identity.isFile() && observed.isFile()
    && !observed.isSymbolicLink() && observed.size === size;
}

function evidenceDiagnostic(context) {
  try {
    const stats = Object.fromEntries(Object.entries(context.stats).map(([key, value]) => [key, value ? {
      dev: Number.isFinite(value.dev) ? value.dev : null, ino: Number.isFinite(value.ino) ? value.ino : null,
      size: Number.isFinite(value.size) ? value.size : null, mtimeMs: Number.isFinite(value.mtimeMs) ? value.mtimeMs : null,
      regular: value.isFile(), link: value.isSymbolicLink(),
    } : null]));
    const encoded = JSON.stringify({ output: context.output, operation: context.operation, phase: context.phase,
      close: context.close, secondary: context.secondary ?? false, absent: context.absent ?? false,
      overLimit: context.overLimit ?? false, stats, checks: context.checks });
    if (Buffer.byteLength(encoded) <= 4096) return encoded;
  } catch {}
  return '{"operation":"evidence-io","diagnostic":"UNAVAILABLE_OR_OVER_LIMIT"}';
}

function emitEvidenceDiagnostic(context) {
  try { process.stderr.write(`Evidence I/O failure: ${evidenceDiagnostic(context)}\n`); } catch {}
}

function evidenceGuard(context, condition, message) {
  if (!context) { assert(condition, message); return; }
  if (context) context.checks[context.phase] = Boolean(condition);
  if (condition) return;
  const error = new Error(message);
  if (context) {
    try { error.message += `; ${evidenceDiagnostic(context)}`; } catch {}
  }
  throw error;
}

function matchesEvidence(actual, bytes) {
  return actual.status === 'COMPLETE' && actual.sha256 === sha256(bytes);
}

function descriptorIdentityValid(value) {
  const dev = value.dev, ino = value.ino;
  return value.isFile() && (process.platform !== 'win32' ||
    (Number.isSafeInteger(dev) && dev > 0 && Number.isSafeInteger(ino) && ino > 0));
}

function pathFileCandidate(observed, descriptor) {
  const dev = descriptor.dev, ino = descriptor.ino;
  if (!descriptorIdentityValid(descriptor) || !observed.isFile() || observed.isSymbolicLink()
    || !Number.isSafeInteger(observed.dev) || observed.dev < 0
    || !Number.isSafeInteger(observed.ino) || observed.ino <= 0
    || !Number.isSafeInteger(observed.size) || observed.size < 0
    || !Number.isFinite(observed.mtimeMs) || !Number.isFinite(descriptor.mtimeMs)) return false;
  if (observed.dev === 0) {
    // This is only metadata eligibility; independent FD joins remain mandatory.
    return process.platform === 'win32' && Number.isSafeInteger(dev) && dev > 0
      && Number.isSafeInteger(ino) && ino > 0 && observed.ino === ino
      && observed.size === descriptor.size && observed.mtimeMs === descriptor.mtimeMs;
  }
  return sameFile(descriptor, observed);
}

async function closeEvidenceHandles(handles, context, primary) {
  context.owners ??= [];
  for (const handle of handles) {
    let owner = context.owners.find(item => item.handle === handle);
    if (!owner) { owner = { handle, attempted: false, closed: false }; context.owners.push(owner); }
    if (owner.attempted) continue;
    context.phase = 'close';
    owner.attempted = true;
    try { await handle.close(); owner.closed = true; }
    catch (error) {
      context.secondary = Boolean(primary || context.closeError);
      context.closeError ??= error;
      context.close = 'FAILED';
      emitEvidenceDiagnostic(context);
    }
    if (context.close !== 'FAILED')
      context.close = context.owners.some(item => !item.closed) ? 'OPEN' : 'SUCCEEDED';
  }
  if (primary) throw primary;
  if (context.closeError) throw context.closeError;
}

async function closeEvidenceHandle(handle, context, primary) {
  return closeEvidenceHandles([handle], context, primary);
}

async function ownedFile(owner, relative, maximum, retain = true, expected) {
  const context = { output: path.basename(relative), operation: 'readback', phase: 'owner-realpath',
    close: 'NOT_OPENED', stats: expected ? { expected } : {}, checks: {}, owners: [] };
  let handle;
  let primary;
  let bytes;
  try {
    const owned = await realpath(owner);
    const target = path.resolve(owned, relative);
    if (context) context.phase = 'owned-path';
    evidenceGuard(context, contained(owned, target), 'Evidence input escaped its owned root');
    if (context) context.phase = 'before-lstat';
    const before = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (context) { context.stats.before = before; context.absent = !before; }
    if (!before) {
      evidenceGuard(context, !expected, 'Expected evidence readback is absent');
      return { status: 'ABSENT', complete: true, bytes: 0 };
    }
    if (context) context.phase = 'before-type';
    evidenceGuard(context, before.isFile() && !before.isSymbolicLink(), 'Evidence input is not a nonlink regular file');
    if (context) context.phase = 'before-realpath';
    evidenceGuard(context, contained(owned, await realpath(target)), 'Evidence input resolved outside its owned root');
    if (expected) {
      context.phase = 'expected-path-join';
      evidenceGuard(context, pathFileCandidate(before, expected), 'Evidence readback differs from its closed writer');
    }
    if (context) { context.phase = 'size-bound'; context.overLimit = before.size > maximum; }
    if (before.size > maximum) {
      evidenceGuard(context, !expected, 'Expected evidence readback exceeds its bound');
      return { status: 'OVER_LIMIT', complete: false, bytes: before.size, maximum };
    }
    if (context) context.phase = 'open';
    handle = await open(target, 'r');
    context.owners.push({ handle, attempted: false, closed: false });
    if (context) { context.close = 'OPEN'; context.phase = 'opened-stat'; }
    const opened = await handle.stat();
    if (expected) {
      context.stats.opened = opened;
      context.phase = 'expected-fd-join';
      evidenceGuard(context, descriptorIdentityValid(expected) && descriptorIdentityValid(opened)
        && sameFile(expected, opened), 'Evidence readback differs from its closed writer');
    }
    if (context) { context.stats.opened = opened; context.phase = 'path-fd-join'; }
    evidenceGuard(context, pathFileCandidate(before, opened), 'Evidence input changed before reading');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    if (context) context.phase = 'read';
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (context) context.phase = 'read-eof';
    evidenceGuard(context, length === before.size, 'Evidence input size changed while reading');
    if (context) context.phase = 'after-fd-stat';
    const afterFd = await handle.stat();
    if (context) { context.stats.afterFd = afterFd; context.phase = 'after-fd-join'; }
    evidenceGuard(context, descriptorIdentityValid(opened) && descriptorIdentityValid(afterFd)
      && sameFile(opened, afterFd), 'Evidence input FD changed while reading');
    if (context) context.phase = 'after-path-lstat';
    const afterPath = await lstat(target);
    if (context) { context.stats.afterPath = afterPath; context.phase = 'after-path-join'; }
    evidenceGuard(context, sameFile(before, afterPath) && !afterPath.isSymbolicLink(), 'Evidence input path changed while reading');
    if (context) context.phase = 'after-realpath';
    evidenceGuard(context, contained(owned, await realpath(target)), 'Evidence input ownership changed');
    context.phase = 'reopen';
    const reopened = await open(target, 'r');
    context.owners.push({ handle: reopened, attempted: false, closed: false });
    context.phase = 'reopened-stat';
    const reopenedStat = await reopened.stat();
    context.stats.reopened = reopenedStat;
    context.phase = 'reopened-fd-join';
    // Without expected, this proves FD stability across reopen, not a dev0 path volume.
    evidenceGuard(context, descriptorIdentityValid(afterFd) && descriptorIdentityValid(reopenedStat)
      && sameFile(afterFd, reopenedStat), 'Evidence input FD changed while reopening');
    context.phase = 'reopened-path-lstat';
    const reopenedPath = await lstat(target);
    context.stats.reopenedPath = reopenedPath;
    context.phase = 'reopened-path-join';
    evidenceGuard(context, sameFile(afterPath, reopenedPath) && pathFileCandidate(reopenedPath, reopenedStat),
      'Evidence input path changed while reading');
    context.phase = 'reopened-realpath';
    evidenceGuard(context, contained(owned, await realpath(target)), 'Evidence input ownership changed');
    bytes = buffer.subarray(0, length);
  } catch (error) {
    primary = error;
    if (context) emitEvidenceDiagnostic(context);
  }
  await closeEvidenceHandles(context.owners.map(item => item.handle), context, primary);
  if (primary) throw primary;
  return { status: 'COMPLETE', complete: true, bytes: bytes.length, sha256: sha256(bytes), ...(retain ? { raw: bytes.toString('utf8') } : {}) };
}

async function ownedWrite(owner, name, bytes) {
  assert(receiptNames.includes(name) || name === 'run-manifest.json', 'Unexpected evidence output');
  const context = { output: name, operation: 'write', phase: 'owner-realpath', close: 'NOT_OPENED', stats: {}, checks: {}, owners: [] };
  let owned;
  let target;
  let handle;
  let primary;
  let written;
  let anchor;
  let anchorStat;
  try {
    owned = await realpath(owner);
    target = path.join(owned, name);
    context.phase = 'before-lstat';
    const before = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    context.stats.before = before;
    if (before) {
      context.phase = 'before-type';
      evidenceGuard(context, before.isFile() && !before.isSymbolicLink(), 'Evidence output is not a nonlink regular file');
      context.phase = 'before-realpath';
      evidenceGuard(context, contained(owned, await realpath(target)), 'Evidence output escaped its owned root');
    }
    if (before && process.platform === 'win32' && before.dev === 0) {
      context.phase = 'anchor-open';
      anchor = await open(target, 'r');
      context.owners.push({ handle: anchor, attempted: false, closed: false });
      context.close = 'OPEN';
      context.phase = 'anchor-stat';
      anchorStat = await anchor.stat();
      context.stats.anchor = anchorStat;
      context.phase = 'anchor-path-join';
      evidenceGuard(context, pathFileCandidate(before, anchorStat), 'Evidence output changed before writing');
    }
    context.phase = 'open';
    handle = await open(target, before ? 'r+' : 'wx');
    context.owners.push({ handle, attempted: false, closed: false });
    context.close = 'OPEN';
    context.phase = 'opened-stat';
    const opened = await handle.stat();
    context.stats.opened = opened;
    context.phase = 'before-fd-join';
    evidenceGuard(context, descriptorIdentityValid(opened) && (anchorStat
      ? descriptorIdentityValid(anchorStat) && sameFile(anchorStat, opened)
      : before ? pathFileCandidate(before, opened) : opened.isFile()), 'Evidence output changed before writing');
    if (anchor) {
      context.phase = 'before-write-path-lstat';
      const beforeWrite = await lstat(target);
      context.stats.beforeWrite = beforeWrite;
      context.phase = 'before-write-path-join';
      evidenceGuard(context, sameFile(before, beforeWrite) && pathFileCandidate(beforeWrite, opened),
        'Evidence output changed before writing');
      context.phase = 'before-write-realpath';
      evidenceGuard(context, contained(owned, await realpath(target)), 'Evidence output escaped its owned root');
      await closeEvidenceHandles([anchor], context);
    }
    context.phase = 'write';
    await handle.writeFile(bytes);
    context.phase = 'truncate';
    await handle.truncate(bytes.length);
    context.phase = 'written-stat';
    written = await handle.stat();
    context.stats.written = written;
    context.phase = 'written-identity-size';
    evidenceGuard(context, descriptorIdentityValid(opened) && descriptorIdentityValid(written)
      && writtenFileMatches(opened, written, bytes.length), 'Evidence output FD changed while writing');
  } catch (error) { primary = error; emitEvidenceDiagnostic(context); }
  if (handle && context.owners.every(item => item.handle === handle || item.attempted))
    await closeEvidenceHandle(handle, context, primary);
  else await closeEvidenceHandles(context.owners.map(item => item.handle), context, primary);
  if (primary) throw primary;
  let baseline;
  let verification;
  try {
    context.phase = 'post-close-lstat';
    const postClose = await lstat(target);
    context.stats.postClose = postClose;
    context.phase = 'post-close-type';
    evidenceGuard(context, postClose.isFile() && !postClose.isSymbolicLink(), 'Evidence output path differs from its closed writer');
    context.phase = 'post-close-realpath';
    evidenceGuard(context, contained(owned, await realpath(target)), 'Evidence output ownership changed');
    context.phase = 'post-close-open';
    verification = await open(target, 'r');
    context.owners.push({ handle: verification, attempted: false, closed: false });
    context.close = 'OPEN';
    context.phase = 'post-close-opened-stat';
    const reopened = await verification.stat();
    context.stats.reopened = reopened;
    context.phase = 'post-close-fd-join';
    evidenceGuard(context, descriptorIdentityValid(written) && descriptorIdentityValid(reopened)
      && writtenFileMatches(written, reopened, bytes.length), 'Evidence output path differs from its closed writer');
    context.phase = 'post-close-path-candidate';
    evidenceGuard(context, pathFileCandidate(postClose, reopened), 'Evidence output path differs from its closed writer');
    context.phase = 'post-close-path-lstat';
    const finalPath = await lstat(target);
    context.stats.finalPath = finalPath;
    context.phase = 'post-close-path-join';
    evidenceGuard(context, sameFile(postClose, finalPath) && pathFileCandidate(finalPath, reopened),
      'Evidence output path differs from its closed writer');
    context.phase = 'post-close-final-realpath';
    evidenceGuard(context, contained(owned, await realpath(target)), 'Evidence output ownership changed');
    baseline = reopened;
  } catch (error) { primary = error; emitEvidenceDiagnostic(context); }
  if (verification) await closeEvidenceHandle(verification, context, primary);
  if (primary) throw primary;
  return baseline;
}

function describeError(error) {
  const descriptor = { code: error.code ?? null, signal: error.signal ?? null, killed: error.killed ?? false, complete: true };
  for (const [key, value] of Object.entries({ name: error.name ?? 'Error', message: error.message ?? String(error), code: descriptor.code, signal: descriptor.signal })) {
    if (typeof value !== 'string') continue;
    const { raw, ...details } = retainedStream(value, normalizeDiagnostics, key === 'message' ? limits.error : 256);
    descriptor[key] = raw;
    descriptor[`${key}Evidence`] = details;
    descriptor.complete &&= details.complete;
  }
  return descriptor;
}

async function preserveError(primary, record, secondary = error => process.stderr.write(`Secondary evidence error: ${error.message}\n`)) {
  let recordingError;
  try { await record(); } catch (error) { recordingError = error; }
  if (primary) {
    if (recordingError) secondary(recordingError);
    throw primary;
  }
  if (recordingError) throw recordingError;
}

function retainedStream(value, normalize = value => value, maximum = limits.stream) {
  const bytes = Buffer.from(value ?? '');
  const normalized = Buffer.from(normalize(bytes.toString('utf8')));
  let raw = normalized.subarray(0, maximum).toString('utf8');
  if (Buffer.byteLength(raw) > maximum) raw = raw.slice(0, -1);
  const complete = bytes.length <= maximum && normalized.length <= maximum;
  return { raw, bytes: bytes.length, normalizedBytes: normalized.length, retainedBytes: Buffer.byteLength(raw),
    maximum, complete, status: complete ? 'COMPLETE' : 'OVER_LIMIT' };
}

function commandRecord(cli, version, args, result, failure, ignoreScripts, normalize) {
  return { cli: path.basename(cli), version, argv: args, ignoreScriptsRequested: ignoreScripts, status: failure ? 'FAILED' : 'SUCCEEDED',
    code: failure ? failure.code ?? null : 0, signal: failure?.signal ?? null, killed: failure?.killed ?? false,
    stdout: retainedStream(result.stdout, normalize), stderr: retainedStream(result.stderr, normalize) };
}

function parseAudit(record, strict = false) {
  assert(record.stdout.complete && record.stderr.complete, 'Incomplete audit output');
  assert(!record.signal && !record.killed && [0, 1].includes(record.code), 'Audit transport or process failure');
  const report = JSON.parse(record.stdout.raw);
  assert(report && !report.error && !report.message, 'Audit returned an error response');
  const counts = report.metadata?.vulnerabilities;
  assert(counts && ['info', 'low', 'moderate', 'high', 'critical'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0), 'Invalid audit vulnerability counts');
  assert(Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0), 'Invalid audit count');
  const findingMaps = [report.advisories, report.vulnerabilities].filter(value => value !== undefined);
  assert(findingMaps.length && findingMaps.every(value => value && typeof value === 'object' && !Array.isArray(value)), 'Invalid audit advisory schema');
  const findings = findingMaps.flatMap(value => Object.values(value));
  const hasFindings = Object.values(counts).some(value => value > 0);
  assert.equal(findings.length > 0, hasFindings, 'Inconsistent audit findings and vulnerability counts');
  assert(record.code === 0 || hasFindings, 'Nonzero audit without vulnerability findings');
  if (strict) assert(record.code === 0 && !hasFindings, 'Consumer audit contains advisories');
  return { counts, sharp: findings.some(entry => entry?.module_name === 'sharp' || entry?.name === 'sharp') };
}

function lockPolicy(lock, manager) {
  if (manager === 'npm') return lock.packages?.[''] ?? null;
  const result = structuredClone(lock);
  delete result.packages;
  delete result.snapshots;
  for (const importer of Object.values(result.importers ?? {})) {
    for (const category of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const dependency of Object.values(importer[category] ?? {})) {
        if (dependency && typeof dependency === 'object') delete dependency.version;
      }
    }
  }
  return result;
}

function assertConsumerPolicy(manifest) {
  for (const category of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert(!Object.hasOwn(manifest[category] ?? {}, 'sharp'), 'Real consumer acquired direct Sharp');
  }
  for (const key of ['overrides', 'resolutions', 'pnpm', 'patchedDependencies']) assert(!Object.hasOwn(manifest, key), `Real consumer acquired resolution policy: ${key}`);
}

function assertPolicyUnchanged(before, after) {
  assertConsumerPolicy(before.manifest);
  assertConsumerPolicy(after.manifest);
  assert.deepEqual(after.manifest, before.manifest, 'Migration changed package.json semantics');
  assert.deepEqual(after.workspace, before.workspace, 'Migration changed workspace policy');
  assert.deepEqual(after.npmrc, before.npmrc, 'Migration changed npmrc policy');
  assert.deepEqual(after.lock, before.lock, 'Migration changed lock importer or settings policy');
}

function lockGraph(lock, manager, manifest) {
  const hfEdges = [];
  const sharp = [];
  const visited = new Set();
  const unresolved = [];
  if (manager === 'pnpm') {
    function visit(name, reference) {
      const version = typeof reference === 'object' ? reference.version : reference;
      const key = `${name}@${version}`;
      if (visited.has(key)) return;
      visited.add(key);
      const entry = lock.snapshots?.[key];
      if (!entry) { unresolved.push(key); return; }
      if (name === '@huggingface/transformers') hfEdges.push({ hf: version, sharp: entry.dependencies?.sharp ?? null });
      if (name === 'sharp') sharp.push(version);
      for (const [child, ref] of Object.entries({ ...entry.dependencies, ...entry.optionalDependencies })) visit(child, ref);
    }
    for (const importer of Object.values(lock.importers ?? {})) {
      for (const [name, reference] of Object.entries({ ...importer.dependencies, ...importer.devDependencies, ...importer.optionalDependencies })) visit(name, reference);
    }
  } else {
    const packages = lock.packages ?? {};
    function resolve(from, name) {
      let cursor = from;
      while (true) {
        const key = path.posix.join(cursor, 'node_modules', name);
        if (packages[key]) return key;
        if (!cursor) return null;
        const parent = path.posix.dirname(cursor);
        cursor = parent === '.' ? '' : parent;
      }
    }
    function visit(name, key) {
      if (!key || visited.has(key)) return;
      visited.add(key);
      const entry = packages[key];
      if (name === '@huggingface/transformers') {
        const child = resolve(key, 'sharp');
        hfEdges.push({ hf: entry.version, sharp: child ? packages[child].version : null });
      }
      if (name === 'sharp') sharp.push(entry.version);
      for (const child of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) {
        const resolved = resolve(key, child);
        if (resolved) visit(child, resolved);
        else if (entry.dependencies?.[child]) unresolved.push(`${key} -> ${child}`);
      }
    }
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies })) {
      const key = resolve('', name);
      if (key) visit(name, key);
      else unresolved.push(name);
    }
  }
  return { status: hfEdges.length ? 'OBSERVED' : 'ABSENT', hfEdges, sharp, unresolved };
}

async function resolveManifest(owner, from, name) {
  const owned = await realpath(owner);
  for (const search of createRequire(from).resolve.paths(`${name}/package.json`) ?? []) {
    const candidate = await realpath(path.join(search, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!candidate) continue;
    assert(contained(owned, candidate), 'Package resolution escaped owned consumer');
    const relative = path.relative(owned, path.join(candidate, 'package.json'));
    const file = await ownedFile(owned, relative, limits.policy);
    assert(file.status === 'COMPLETE', 'Resolved package manifest is incomplete');
    const manifest = JSON.parse(file.raw);
    assert.equal(manifest.name, name, 'Resolved package has unexpected name');
    return { path: portable(path.relative(owned, candidate)), name, version: manifest.version };
  }
  return { status: 'ABSENT' };
}

async function physicalGraph(directory) {
  const owned = await realpath(directory);
  const hf = await resolveManifest(owned, path.join(owned, 'package.json'), '@huggingface/transformers');
  const sharp = hf.path ? await resolveManifest(owned, path.join(owned, hf.path, 'package.json'), 'sharp') : { status: 'ABSENT' };
  return { hf, hfRelativeSharp: sharp };
}

async function migrationSnapshot(directory, manager) {
  const wanted = manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';
  const installed = manager === 'npm' ? 'node_modules/.package-lock.json' : 'node_modules/.pnpm/lock.yaml';
  const files = {};
  for (const name of ['package.json', 'pnpm-workspace.yaml', '.npmrc', wanted, installed]) {
    files[name] = await ownedFile(directory, name, [wanted, installed].includes(name) ? limits.lock : limits.policy, name !== '.npmrc');
  }
  const state = { status: 'PARTIAL', files, errors: [] };
  try {
    assert(files['package.json'].status === 'COMPLETE' && files[wanted].status === 'COMPLETE', 'Missing required migration manifest/lock');
    assert(Object.values(files).every(file => file.complete), 'Migration input exceeded its evidence bound');
    const manifest = JSON.parse(files['package.json'].raw);
    const parse = raw => manager === 'npm' ? JSON.parse(raw) : yaml.load(raw);
    const lock = parse(files[wanted].raw);
    state.policy = { manifest, workspace: { status: files['pnpm-workspace.yaml'].status, sha256: files['pnpm-workspace.yaml'].sha256 ?? null },
      npmrc: { status: files['.npmrc'].status, sha256: files['.npmrc'].sha256 ?? null }, lock: lockPolicy(lock, manager) };
    state.wanted = lockGraph(lock, manager, manifest);
    state.installed = files[installed].status === 'COMPLETE' ? lockGraph(parse(files[installed].raw), manager, manifest) : { status: 'ABSENT' };
    state.physical = await physicalGraph(directory);
    state.status = 'COMPLETE';
  } catch (error) { state.errors.push(describeError(error)); }
  return state;
}

function sharpState(snapshot) {
  if (!snapshot || (snapshot.snapshotStatus ?? snapshot.status) !== 'COMPLETE') return 'UNKNOWN';
  const physical = snapshot.physical?.hfRelativeSharp?.version;
  const graphs = [snapshot.wanted, snapshot.installed];
  if (!physical || graphs.some(graph => graph.status !== 'OBSERVED' || !graph.hfEdges.length)) return 'UNKNOWN';
  const versions = graphs.flatMap(graph => graph.hfEdges.map(edge => edge.sharp));
  if (versions.some(version => typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))) return 'UNKNOWN';
  if (versions.some(version => version !== physical)) return 'DIVERGENT';
  try { assertMinimumVersion('sharp', physical); return 'GOOD'; } catch { return 'BAD'; }
}

function classifyTarget(before, after) {
  const initial = sharpState(before);
  const final = sharpState(after);
  if (['UNKNOWN', 'DIVERGENT'].includes(initial)) return initial;
  if (['UNKNOWN', 'DIVERGENT'].includes(final)) return final;
  if (final === 'BAD') return 'STILL_BAD';
  return initial === 'BAD' ? 'CHANGED_BAD_TO_GOOD' : 'NOT_REPRODUCED';
}

function beginPhase(migration, phase) {
  migration.phase = phase;
  migration.receipt.phases[phase].status = 'RUNNING';
}

function completePhase(migration) {
  migration.receipt.phases[migration.phase].status = 'COMPLETE';
}

function failPhase(migration, error) {
  const descriptor = describeError(error);
  const phase = migration.receipt.phases[migration.phase];
  phase.status = 'FAILED';
  phase.stepError = descriptor;
  migration.receipt.failedPhase = migration.phase;
  migration.receipt.primaryError = descriptor;
}

async function runSelfControls(manifest, operation) {
  manifest.selfControls = { status: 'RUNNING' };
  try { manifest.selfControls = { ...await operation(), status: 'PASSED' }; }
  catch (error) {
    manifest.selfControls = { status: 'FAILED', error: describeError(error) };
    throw error;
  }
}

function overLimitReceipt(receipt, bytes) {
  return { schemaVersion: 1, manager: receipt.manager, status: 'OVER_LIMIT', complete: false,
    requiredBytes: bytes.length, maximum: limits.receipt, omittedDataSha256: sha256(bytes),
    failedPhase: receipt.failedPhase ?? null, primaryError: receipt.primaryError ?? null,
    phases: Object.fromEntries(Object.entries(receipt.phases).map(([phase, state]) => [phase, { status: state.status, snapshotStatus: state.snapshotStatus ?? null }])),
    commandCount: receipt.commands.length };
}

async function selfControls(scratch) {
  const baseline = { manifest: { dependencies: { '@wyreup/core': '2.1.0', '@huggingface/transformers': '^4.3.1' } },
    workspace: { status: 'COMPLETE', sha256: 'workspace' }, npmrc: { status: 'COMPLETE', sha256: 'npmrc' },
    lock: lockPolicy({ settings: { autoInstallPeers: true }, importers: { '.': { dependencies: { '@huggingface/transformers': { specifier: '^4.3.1', version: '4.3.1' } } } } }, 'pnpm') };
  const resolvedOnly = structuredClone(baseline);
  resolvedOnly.lock = lockPolicy({ settings: { autoInstallPeers: true }, importers: { '.': { dependencies: { '@huggingface/transformers': { specifier: '^4.3.1', version: '4.3.2' } } } } }, 'pnpm');
  assertPolicyUnchanged(baseline, resolvedOnly);
  for (const mutate of [
    state => { state.manifest.name = 'changed'; }, state => { state.workspace.sha256 = 'changed'; }, state => { state.npmrc.sha256 = 'changed'; },
    state => { state.lock.importers['.'].dependencies['@huggingface/transformers'].specifier = '*'; },
    state => { state.lock.importers['.'].dependencies.other = state.lock.importers['.'].dependencies['@huggingface/transformers']; },
    state => { state.lock.importers['.'].devDependencies = state.lock.importers['.'].dependencies; delete state.lock.importers['.'].dependencies; },
    state => { state.lock.importers['.'].unknownPolicy = true; }, state => { state.lock.settings.autoInstallPeers = false; },
    state => { state.lock.unknownSetting = true; }, state => { state.manifest.dependencies.sharp = '0.35.5'; },
    state => { state.manifest.overrides = { sharp: '0.35.5' }; },
  ]) {
    const changed = structuredClone(baseline);
    mutate(changed);
    assert.throws(() => assertPolicyUnchanged(baseline, changed));
  }
  const directory = await mkdtemp(path.join(scratch, 'self-control-'));
  const hf = path.join(directory, 'owned-hf');
  await mkdir(path.join(directory, 'node_modules', '@huggingface'), { recursive: true });
  await mkdir(path.join(directory, 'node_modules', 'sharp'), { recursive: true });
  await mkdir(path.join(hf, 'node_modules', 'sharp'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), '{}');
  await writeFile(path.join(hf, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', version: '4.3.1', dependencies: { sharp: '^0.35.4' } }));
  await writeFile(path.join(directory, 'node_modules', 'sharp', 'package.json'), JSON.stringify({ name: 'sharp', version: '0.35.5' }));
  await writeFile(path.join(hf, 'node_modules', 'sharp', 'package.json'), JSON.stringify({ name: 'sharp', version: '0.35.4' }));
  await symlink(hf, path.join(directory, 'node_modules', '@huggingface', 'transformers'), process.platform === 'win32' ? 'junction' : 'dir');
  const graph = await physicalGraph(directory);
  assert.equal(graph.hfRelativeSharp.version, '0.35.4');
  assert.throws(() => assertMinimumVersion('sharp', graph.hfRelativeSharp.version));
  assert.equal((await resolveManifest(directory, path.join(directory, 'package.json'), 'sharp')).version, '0.35.5');
  const original = Object.assign(new Error('synthetic failed audit'), { code: 1, stdout: '{partial', stderr: 'partial diagnostic', signal: null, killed: false });
  const retained = commandRecord('pnpm.cjs', '10.34.5', ['audit', '--json'], original, original, true);
  let secondary;
  await assert.rejects(preserveError(original, async () => { throw new Error('synthetic evidence failure'); }, error => { secondary = error; }), error => error === original);
  assert.equal(secondary.message, 'synthetic evidence failure');
  await assert.rejects(preserveError(null, async () => { throw secondary; }), error => error === secondary);
  assert.equal(retained.stdout.raw, original.stdout);
  assert.equal(retained.stderr.raw, original.stderr);
  assert.equal(retained.code, 1);
  assert.throws(() => parseAudit(retained));
  const valid = { ...retained, stdout: retainedStream(JSON.stringify({ advisories: { sharp: { module_name: 'sharp' } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } } })), stderr: retainedStream('') };
  assert.equal(parseAudit(valid).sharp, true);
  assert.throws(() => parseAudit(valid, true));
  for (const invalid of [
    { ...valid, code: 2 }, { ...valid, signal: 'SIGTERM' }, { ...valid, killed: true },
    { ...valid, stdout: retainedStream('{"error":{"code":"NETWORK"}}') },
    { ...valid, stdout: { ...valid.stdout, complete: false } },
  ]) assert.throws(() => parseAudit(invalid));
  const zero = { ...valid, code: 0, stdout: retainedStream(JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } })) };
  parseAudit(zero, true);
  assert.throws(() => parseAudit({ ...zero, code: 1 }, true));
  const inconsistent = { ...zero, stdout: retainedStream(JSON.stringify({ advisories: { sharp: { module_name: 'sharp' } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } })) };
  assert.throws(() => parseAudit(inconsistent, true), 'Zero counts must not hide nonempty findings');
  assert.throws(() => parseAudit({ ...zero, stdout: retainedStream(JSON.stringify({ advisories: {}, vulnerabilities: { sharp: { name: 'sharp' } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } })) }, true));
  const regressionFailures = [];
  const canonicalScratch = await realpath(scratch);
  for (const [finding, check] of [
    ['F2', () => assert.equal(portable(evidence.normalize(path.join(canonicalScratch, 'diagnostic'))), '<scratch>/diagnostic')],
    ['F3', () => assert.equal(commandRecord('pnpm.cjs', '10.34.5', ['audit', '--json'], original,
      { code: null, signal: 'SIGTERM', killed: true }, true).code, null)],
    ['F4', () => assert(Buffer.byteLength(describeError(new Error('x'.repeat(limits.stream + 32))).message) <= limits.error)],
  ]) {
    try { check(); } catch (error) { regressionFailures.push({ finding, message: error.message }); }
  }
  assert.deepEqual(regressionFailures, [], `Review regression controls failed: ${JSON.stringify(regressionFailures)}`);
  const windowsNormalize = pathNormalizer([
    ['C:\\Users\\RUNNER~1\\Temp\\owned', '<scratch>'], ['C:\\Users\\Runner Long\\Temp\\owned', '<scratch>'],
    ['C:\\a\\wyreup', '<project>'],
  ], 'win32');
  assert.equal(windowsNormalize('c:\\users\\runner long\\temp\\owned\\diagnostic'), '<scratch>\\diagnostic');
  assert.equal(windowsNormalize('c:/users/runner long/temp/owned/diagnostic'), '<scratch>/diagnostic');
  assert.equal(windowsNormalize('c:\\users\\runner~1\\temp\\owned\\diagnostic'), '<scratch>\\diagnostic');
  assert.equal(windowsNormalize(`${JSON.stringify('C:\\Users\\Runner Long\\Temp\\owned').slice(1, -1)}\\\\diagnostic`), '<scratch>\\\\diagnostic');
  assert.equal(windowsNormalize('c:\\a\\wyreup\\node_modules\\typescript'), '<project>\\node_modules\\typescript');
  assert.equal(pathNormalizer([['/var/owned', '<scratch>'], ['/private/var/owned', '<scratch>']])('/private/var/owned/diagnostic'), '<scratch>/diagnostic');
  const oversizedError = new Error('x'.repeat(limits.stream + 32));
  const boundedError = describeError(oversizedError);
  assert.equal(Buffer.byteLength(boundedError.message), limits.error);
  assert.equal(boundedError.complete, false);
  assert.equal(boundedError.messageEvidence.complete, false);
  assert.equal(boundedError.messageEvidence.bytes, limits.stream + 32);
  assert.equal(oversizedError.message.length, limits.stream + 32);
  assert(Buffer.byteLength(describeError(new Error(`${'a'.repeat(limits.error - 1)}🙂`)).message) <= limits.error);
  const fixture = { receipt: { manager: 'pnpm', commands: [], phases: { postOrdinary: { status: 'NOT_REACHED' }, finalAudit: { status: 'NOT_REACHED' } } } };
  beginPhase(fixture, 'postOrdinary');
  assert.equal(fixture.receipt.phases.postOrdinary.status, 'RUNNING');
  const savedFiles = { lock: { raw: 'saved snapshot bytes' } };
  Object.assign(fixture.receipt.phases.postOrdinary, { snapshotStatus: 'COMPLETE', files: savedFiles });
  failPhase(fixture, original);
  assert.equal(fixture.receipt.phases.postOrdinary.status, 'FAILED');
  assert.equal(fixture.receipt.phases.postOrdinary.snapshotStatus, 'COMPLETE');
  assert.equal(fixture.receipt.phases.postOrdinary.files, savedFiles);
  beginPhase(fixture, 'finalAudit');
  failPhase(fixture, oversizedError);
  assert.equal(fixture.receipt.phases.finalAudit.status, 'FAILED');
  const stub = overLimitReceipt(fixture.receipt, Buffer.from('synthetic omitted encoded receipt'));
  assert.equal(stub.failedPhase, 'finalAudit');
  assert.equal(stub.phases.finalAudit.status, 'FAILED');
  assert.equal(stub.phases.postOrdinary.snapshotStatus, 'COMPLETE');
  assert.equal(stub.primaryError.messageEvidence.complete, false);
  const controlFailure = { selfControls: { status: 'NOT_REACHED' } };
  await assert.rejects(runSelfControls(controlFailure, async () => { throw original; }), error => error === original);
  assert.equal(controlFailure.selfControls.status, 'FAILED');
  const escapableError = Object.assign(new Error('\u0000'.repeat(limits.error + 32)), {
    name: '\u0000'.repeat(512), code: '\u0000'.repeat(512), signal: '\u0000'.repeat(512),
  });
  const failureManifest = structuredClone(evidence.manifest);
  await assert.rejects(runSelfControls(failureManifest, async () => { throw escapableError; }), error => error === escapableError);
  const encodedFailureManifestBytes = Buffer.byteLength(JSON.stringify(failureManifest, null, 2));
  assert(encodedFailureManifestBytes <= limits.manifest, 'Encoded self-control failure exceeds manifest bound');
  assert.equal(failureManifest.selfControls.error.messageEvidence.complete, false);
  const writtenMetadata = { dev: 1, ino: 2, size: 8, mtimeMs: 10, isFile: () => true, isSymbolicLink: () => false };
  const closedMetadata = { ...writtenMetadata, mtimeMs: 11 };
  assert(writtenFileMatches(writtenMetadata, closedMetadata, 8), 'Write transition must allow changed mtime before the post-close baseline');
  assert(!sameFile(writtenMetadata, closedMetadata), 'Stable reads must still refuse changed mtime');
  for (const changed of [
    { ...writtenMetadata, dev: 3 }, { ...writtenMetadata, ino: 3 }, { ...writtenMetadata, size: 9 },
    { ...writtenMetadata, isFile: () => false }, { ...writtenMetadata, isSymbolicLink: () => true },
  ]) assert(!writtenFileMatches(writtenMetadata, changed, 8), 'Writer identity/type/size predicate accepted a mutation');
  assert.equal(evidence.normalize(lexicalScratch), '<scratch>');
  const ioName = 'migration-npm.json';
  const longBytes = Buffer.from('12345678');
  const freshBaseline = await ownedWrite(directory, ioName, longBytes);
  const freshRead = await ownedFile(directory, ioName, limits.policy, true, freshBaseline);
  assert(matchesEvidence(freshRead, longBytes));
  assert(!matchesEvidence(freshRead, Buffer.from('87654321')), 'Intended SHA256 predicate accepted different same-length content');
  assert.deepEqual(Object.keys(freshRead).sort(), ['bytes', 'complete', 'raw', 'sha256', 'status']);
  const shortBytes = Buffer.from('abc');
  const shortBaseline = await ownedWrite(directory, ioName, shortBytes);
  assert.equal(shortBaseline.ino, freshBaseline.ino);
  const shortRead = await ownedFile(directory, ioName, limits.policy, true, shortBaseline);
  assert(matchesEvidence(shortRead, shortBytes));
  assert.equal(shortRead.raw, 'abc');
  assert.equal(shortRead.bytes, 3);
  await assert.rejects(ownedFile(directory, ioName, 2, true, shortBaseline), /exceeds its bound/);
  await assert.rejects(ownedFile(directory, 'absent-readback', limits.policy, true, shortBaseline), /is absent/);
  await assert.rejects(ownedFile(path.join(directory, 'absent-owner'), ioName, limits.policy, true, shortBaseline), error => error.code === 'ENOENT');
  const absentPrefix = 'Expected evidence readback is absent; ';
  const malformedPathRefusal = (error, platform = process.platform) => {
    if (platform !== 'win32') return error.code === 'ENOTDIR';
    if (error.code !== undefined || typeof error.message !== 'string' || !error.message.startsWith(absentPrefix)) return false;
    try {
      const diagnostic = JSON.parse(error.message.slice(absentPrefix.length));
      return diagnostic.output === 'child' && diagnostic.operation === 'readback' && diagnostic.phase === 'before-lstat'
        && diagnostic.absent === true && diagnostic.overLimit === false && diagnostic.close === 'NOT_OPENED'
        && diagnostic.stats?.before === null && diagnostic.checks?.['before-lstat'] === false;
    } catch { return false; }
  };
  await assert.rejects(ownedFile(directory, `${ioName}/child`, limits.policy, true, shortBaseline), malformedPathRefusal);
  let actualAbsentGuard;
  await assert.rejects(ownedFile(directory, 'absent-component/child', limits.policy, true, shortBaseline), error => {
    actualAbsentGuard = error;
    return malformedPathRefusal(error, 'win32');
  });
  assert(malformedPathRefusal({ code: 'ENOTDIR' }, 'darwin'));
  assert(!malformedPathRefusal(actualAbsentGuard, 'darwin'));
  for (const code of ['ENOTDIR', 'ENOENT']) assert(!malformedPathRefusal({ code, message: actualAbsentGuard.message }, 'win32'));
  assert(!malformedPathRefusal(new Error('unrelated failure'), 'win32'));
  assert(!malformedPathRefusal(new Error(`${absentPrefix}{malformed`), 'win32'));
  for (const [key, value] of [['output', 'different'], ['operation', 'write'], ['phase', 'close'], ['absent', false], ['close', 'SUCCEEDED']]) {
    const diagnostic = JSON.parse(actualAbsentGuard.message.slice(absentPrefix.length));
    diagnostic[key] = value;
    assert(!malformedPathRefusal(new Error(absentPrefix + JSON.stringify(diagnostic)), 'win32'));
  }
  const malformedStatError = new Error('synthetic metadata accessor failure');
  const malformedBaseline = { get dev() { throw malformedStatError; } };
  await assert.rejects(ownedFile(directory, ioName, limits.policy, true, malformedBaseline), error => error === malformedStatError);
  const modifiedTime = new Date(shortBaseline.mtimeMs + 2000);
  await utimes(path.join(directory, ioName), modifiedTime, modifiedTime);
  const retimed = await lstat(path.join(directory, ioName));
  assert.equal(retimed.ino, shortBaseline.ino);
  assert.notEqual(retimed.mtimeMs, shortBaseline.mtimeMs);
  await assert.rejects(ownedFile(directory, ioName, limits.policy, true, shortBaseline), /differs from its closed writer/);
  const replacementBaseline = await ownedWrite(directory, ioName, shortBytes);
  const replacement = path.join(directory, 'replacement-data');
  await writeFile(replacement, shortBytes);
  const replacementStat = await lstat(replacement);
  assert(replacementStat.ino !== replacementBaseline.ino, 'Replacement fixture lacks distinguishable inode identity');
  await rename(replacement, path.join(directory, ioName));
  await assert.rejects(ownedFile(directory, ioName, limits.policy, true, replacementBaseline), /differs from its closed writer/);
  await mkdir(path.join(directory, 'run-manifest.json'));
  await assert.rejects(ownedWrite(directory, 'run-manifest.json', shortBytes), /nonlink regular file/);
  const diagnosticContext = { output: ioName, operation: 'readback', phase: 'expected-path-join', close: 'NOT_OPENED',
    stats: { expected: writtenMetadata, before: { ...writtenMetadata, ino: 3 } }, checks: { 'expected-path-join': false } };
  const diagnostic = evidenceDiagnostic(diagnosticContext);
  assert(Buffer.byteLength(diagnostic) <= 4096);
  assert.equal(JSON.parse(diagnostic).stats.before.ino, 3);
  assert.equal(JSON.parse(evidenceDiagnostic({ ...diagnosticContext, stats: { malformed: malformedBaseline } })).diagnostic, 'UNAVAILABLE_OR_OVER_LIMIT');
  const readError = new Error('synthetic read failure');
  const closeError = new Error('synthetic close failure');
  let closeCount = 0;
  await assert.rejects(closeEvidenceHandle({ async close() { closeCount++; throw closeError; } }, diagnosticContext, readError), error => error === readError);
  assert.equal(closeCount, 1);
  assert.equal(diagnosticContext.close, 'FAILED');
  closeCount = 0;
  await assert.rejects(closeEvidenceHandle({ async close() { closeCount++; throw closeError; } }, { ...diagnosticContext }, null), error => error === closeError);
  assert.equal(closeCount, 1);
  await rm(directory, { recursive: true, force: true });
  return { policy: 'PASSED', nestedResolution: 'PASSED', auditErrorIdentity: 'PASSED', junction: process.platform === 'win32',
    reviewRegressionSubcases: ['failed phases', 'canonical paths', 'null exit code', 'bounded errors'], encodedFailureManifestBytes,
    writeReadSubcases: ['write/stable metadata predicates', 'new/short overwrite and EOF', 'intended SHA256', 'replacement inode refusal',
      'stable baseline mtime refusal', 'absent/over-limit and IO diagnostics', 'malformed diagnostics', 'single close and primary identity'] };
}

async function createEvidence(root, scratch, lexicalScratch) {
  const artifactsRoot = await realpath(path.join(root, 'artifacts'));
  const directory = await mkdtemp(path.join(artifactsRoot, 'consumer-migration-'));
  const basename = path.basename(directory);
  assert(/^consumer-migration-[A-Za-z0-9]+$/.test(basename) && path.dirname(directory) === artifactsRoot, 'Invalid generated evidence directory');
  const relative = `artifacts/${basename}`;
  const aliases = [[lexicalScratch, '<scratch>'], [scratch, '<scratch>'], [root, '<project>'], [await realpath(root), '<project>']];
  for (const cli of [npmCli, pnpmCli, process.execPath]) {
    aliases.push([cli, path.basename(cli)], [await realpath(cli), path.basename(cli)]);
  }
  normalizeDiagnostics = pathNormalizer(aliases);
  const receipts = Object.fromEntries(['npm', 'pnpm'].map(manager => [manager, {
    schemaVersion: 1, manager, platform: process.platform, node: process.version, status: 'NOT_REACHED', complete: false,
    phases: Object.fromEntries(['original', 'postInstall', 'postOrdinary', 'postTarget', 'finalAudit', 'finalChecks'].map(phase => [phase, { status: 'NOT_REACHED' }])),
    commands: [], secondaryEvidenceErrors: [],
    ...(manager === 'pnpm' ? { localCommandSemanticsExperiment: { status: 'NOT_APPLICABLE', reason: 'This 24-case run did not execute the separate pre-implementation local experiment.' } } : {}),
  }]));
  const manifest = { schemaVersion: 1, directory: relative, terminalStatus: 'RUNNING', complete: false,
    selfControls: { status: 'NOT_REACHED' }, protectedPriorHistory: {}, files: {} };
  for (const manager of ['npm', 'pnpm']) {
    for (const name of ['seed-package.json', 'original-lock', 'original-audit.json', 'updated-package.json', 'updated-lock', 'updated-versions.json', 'updated-audit.json']) {
      const relative = `seeded-lock-${manager}/${name}`;
      const file = await ownedFile(artifactsRoot, relative, name.includes('lock') || name.includes('audit') ? limits.lock : limits.policy, false);
      manifest.protectedPriorHistory[relative] = file;
      assert(file.complete, 'Protected prior history exceeds evidence bound');
    }
  }
  const evidence = { directory, relative, receipts, manifest,
    normalize: normalizeDiagnostics,
    async flush() {
      let complete = true;
      let total = 0;
      for (const [manager, receipt] of Object.entries(receipts)) {
        const name = `migration-${manager}.json`;
        let bytes = Buffer.from(JSON.stringify(receipt, null, 2));
        if (bytes.length > limits.receipt) {
          receipt.status = 'OVER_LIMIT';
          receipt.complete = false;
          receipt.requiredBytes = bytes.length;
          bytes = Buffer.from(JSON.stringify(overLimitReceipt(receipt, bytes), null, 2));
        }
        const baseline = await ownedWrite(directory, name, bytes);
        const actual = await ownedFile(directory, name, limits.receipt, false, baseline);
        assert(matchesEvidence(actual, bytes), 'Receipt verification failed');
        manifest.files[name] = { status: receipt.status, complete: receipt.complete, ...actual };
        manifest.files[name].status = receipt.status;
        manifest.files[name].complete = receipt.complete;
        total += actual.bytes;
        if (receipt.status !== 'COMPLETED' || !receipt.complete) complete = false;
      }
      manifest.complete = manifest.terminalStatus === 'SUCCEEDED' && complete;
      const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
      assert(bytes.length <= limits.manifest && total + bytes.length <= 33_619_968, 'Evidence manifest/joint bound exceeded');
      const baseline = await ownedWrite(directory, 'run-manifest.json', bytes);
      const actual = await ownedFile(directory, 'run-manifest.json', limits.manifest, false, baseline);
      assert(matchesEvidence(actual, bytes), 'Manifest verification failed');
      assert(Object.values(receipts).every(receipt => receipt.status !== 'OVER_LIMIT'), 'Migration receipt exceeded 16 MiB');
    },
  };
  await evidence.flush();
  if (process.env.GITHUB_OUTPUT) {
    const handle = await open(process.env.GITHUB_OUTPUT, 'a');
    try { await handle.writeFile(`migration-evidence=${relative}\n`); } finally { await handle.close(); }
  }
  console.log(`Migration evidence: ${relative}`);
  return evidence;
}

const root = await realpath(path.resolve(import.meta.dirname, '..'));
const { artifacts } = await loadArtifacts('artifacts');
const npmCli = await resolveNpmCli();
const pnpmCli = process.env.npm_execpath;
assert(pnpmCli?.includes('pnpm'), 'Run this check through pnpm check:consumers');
const lexicalScratch = await mkdtemp(path.join(tmpdir(), 'wyreup-consumers-'));
const scratch = await realpath(lexicalScratch);
const temporaryRoot = await realpath(tmpdir());
assert(contained(temporaryRoot, scratch) && scratch !== temporaryRoot, 'Consumer scratch escaped its temporary root');
console.log(`Packed consumer scratch: ${scratch}`);
const entries = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
let origin;
const server = createServer((request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const artifact = entries.get(pathname.slice(1));
    if (artifact) {
      const body = JSON.stringify({ name: artifact.name, 'dist-tags': { latest: artifact.version }, versions: {
        [artifact.version]: { ...artifact.manifest, dist: { tarball: `${origin}/tar/${path.basename(artifact.file)}`, integrity: artifact.integrity } },
      } });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    const tarball = artifacts.find((entry) => pathname === `/tar/${path.basename(entry.file)}`);
    if (tarball) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(tarball.file).on('error', () => response.destroy()).pipe(response);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
  } catch { response.writeHead(400).end(); }
});

const userConfig = path.join(scratch, 'user.npmrc');
await writeFile(userConfig, '');
const managerOptions = {
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|LOGNAME|LANG|LC_ALL|TMPDIR|TEMP|TMP|SystemRoot|COMSPEC|PATHEXT|windir)$/i.test(key))),
    npm_config_cache: path.join(scratch, 'npm-cache'),
    npm_config_userconfig: userConfig,
  },
  maxBuffer: 16 * 1024 * 1024,
  timeout: 300_000,
};
const evidence = await createEvidence(root, scratch, lexicalScratch);
const managerVersions = {};

async function recordCommand(migration, cli, args, result, failure, ignoreScripts, version) {
  if (!migration) {
    if (failure) throw failure;
    return;
  }
  const row = { phase: migration.phase, ...commandRecord(cli, version, args.map(value => evidence.normalize(value)), result, failure, ignoreScripts, evidence.normalize) };
  migration.receipt.commands.push(row);
  migration.lastProcessError = failure;
  migration.lastEvidenceError = null;
  await preserveError(failure, async () => {
    await evidence.flush();
    assert(row.stdout.complete && row.stderr.complete, 'Command output exceeded its evidence bound');
  }, error => {
    migration.lastEvidenceError = error;
    migration.receipt.secondaryEvidenceErrors.push(describeError(error));
    process.stderr.write(`Secondary evidence error: ${error.message}\n`);
  });
}

async function run(cli, args, cwd, ignoreScripts = false, migration = null) {
  const verboseInstall = cli === npmCli && args[0] === 'install';
  const commandArgs = verboseInstall ? [...args, '--loglevel=verbose', '--timing'] : args;
  let result;
  let failure;
  try {
    const pending = exec(process.execPath, [cli, ...commandArgs], {
      ...managerOptions,
      timeout: process.platform === 'win32' && ['install', 'update'].includes(args[0]) ? 600_000 : managerOptions.timeout,
      ...(ignoreScripts ? { env: { ...managerOptions.env, npm_config_ignore_scripts: 'true' } } : {}),
      cwd,
    });
    if (verboseInstall) {
      pending.child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
      pending.child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    }
    result = await pending;
  } catch (error) {
    failure = error;
    result = error;
    if (!verboseInstall) {
      process.stderr.write(error.stdout ?? '');
      process.stderr.write(error.stderr ?? '');
    }
  }
  await recordCommand(migration, cli, commandArgs, result, failure, ignoreScripts || args.includes('--ignore-scripts'), managerVersions[migration?.manager]);
  return result;
}

async function auxiliary(args, directory, migration) {
  let result;
  let failure;
  try { result = await exec(process.execPath, args, { ...managerOptions, cwd: directory }); }
  catch (error) { failure = error; result = error; }
  await recordCommand(migration, process.execPath, args, result, failure, false, process.version);
  return result;
}

async function capture(migration, directory, phase) {
  migration.phase = phase;
  const state = await migrationSnapshot(directory, migration.manager);
  state.snapshotStatus = state.status;
  state.status = 'RUNNING';
  migration.receipt.phases[phase] = state;
  await evidence.flush();
  assert.equal(state.snapshotStatus, 'COMPLETE', `Incomplete ${phase} migration snapshot`);
  return state;
}

async function audit(cli, directory, migration, { strict = false, seed = false } = {}) {
  let failure;
  try { await run(cli, ['audit', '--json'], directory, false, migration); }
  catch (error) {
    if (error !== migration.lastProcessError || migration.lastEvidenceError) throw error;
    failure = error;
  }
  const row = migration.receipt.commands.at(-1);
  let summary;
  try {
    summary = parseAudit(row, strict);
    if (seed) assert(failure && row.code === 1 && summary.sharp, 'Seed audit did not reproduce the Sharp advisory');
  } catch (error) {
    if (failure) throw failure;
    throw error;
  }
  if (strict && failure) throw failure;
  return { status: 'COMPLETE', summary, commandIndex: migration.receipt.commands.length - 1 };
}

let succeeded = false;
let primaryError;
try {
  evidence.manifest.selfControls = { status: 'RUNNING' };
  await evidence.flush();
  await runSelfControls(evidence.manifest, () => selfControls(scratch));
  await evidence.flush();
  console.log('Migration self-controls: policy, nested resolution and audit error identity passed');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const npmVersion = (await run(npmCli, ['--version'], root)).stdout.trim();
  assertNpmMajor(npmVersion, process.env.WYREUP_EXPECTED_NPM_MAJOR);
  console.log(`npm executable: ${npmCli}`);
  for (const [manager, cli] of [['npm', npmCli], ['pnpm', pnpmCli]]) {
    managerVersions[manager] = manager === 'npm' ? npmVersion : (await run(cli, ['--version'], root)).stdout.trim();
    console.log(`${manager} ${managerVersions[manager]}`);
    for (const ignoreScripts of [false, true]) {
      for (const artifact of artifacts) {
        for (const withPeer of artifact.name === '@wyreup/core' ? [false, true] : [false]) {
          const directory = await realpath(await mkdtemp(path.join(scratch, `${manager}-`)));
          assert(contained(scratch, directory) && directory !== scratch, 'Consumer directory escaped canonical scratch');
          console.log(`Consumer case: manager=${manager} package=${artifact.name} peer=${withPeer ? 'explicit' : 'default'} scripts=${ignoreScripts ? 'disabled' : 'normal'} directory=${directory}`);
          const dependencies = { [artifact.name]: artifact.version };
          if (withPeer) dependencies['@huggingface/transformers'] = '^4.3.1';
          const migration = withPeer && ignoreScripts ? { manager, phase: 'original', receipt: evidence.receipts[manager] } : null;
          let caseError;
          try {
          if (migration) {
            migration.receipt.status = 'RUNNING';
            migration.receipt.packageManagerVersion = managerVersions[manager];
            beginPhase(migration, 'original');
            await evidence.flush();
          }
          await writeFile(path.join(directory, '.npmrc'), `registry=https://registry.npmjs.org/\n@wyreup:registry=${origin}/\n`);
          if (migration) {
            const seed = { name: 'wyreup-seeded-lock', version: '1.0.0', private: true, dependencies: {
              '@huggingface/transformers': '4.3.1', sharp: '0.35.4',
            } };
            await writeFile(path.join(directory, 'package.json'), JSON.stringify(seed));
            await run(cli, ['install', manager === 'npm' ? '--package-lock-only' : '--lockfile-only', '--ignore-scripts'], directory, true, migration);
            const original = await capture(migration, directory, 'original');
            original.audit = await audit(cli, directory, migration, { seed: true });
            completePhase(migration);
            await evidence.flush();
          }
          await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'wyreup-consumer-check', version: '1.0.0', private: true, type: 'module', dependencies }));
          if (manager === 'pnpm') {
            await writeFile(path.join(directory, 'pnpm-workspace.yaml'), "onlyBuiltDependencies:\n  - 'onnxruntime-node'\n");
          }
          if (migration) beginPhase(migration, 'postInstall');
          await run(cli, ['install', ...(ignoreScripts ? ['--ignore-scripts'] : []), ...(manager === 'npm' ? ['--no-fund'] : [])], directory, false, migration);
          if (migration) {
            const postInstall = await capture(migration, directory, 'postInstall');
            assertConsumerPolicy(postInstall.policy.manifest);
            completePhase(migration);
            beginPhase(migration, 'postOrdinary');
            await run(cli, ['update', ...(manager === 'pnpm' ? ['--depth', 'Infinity'] : [])], directory, true, migration);
            const postOrdinary = await capture(migration, directory, 'postOrdinary');
            assertConsumerPolicy(postOrdinary.policy.manifest);
            try {
              assertPolicyUnchanged(postInstall.policy, postOrdinary.policy);
              migration.receipt.ordinaryPolicyComparison = { status: 'UNCHANGED' };
            } catch (error) {
              migration.receipt.ordinaryPolicyComparison = { status: 'CHANGED', error: describeError(error) };
            }
            postOrdinary.audit = await audit(cli, directory, migration);
            completePhase(migration);
            await evidence.flush();
            if (manager === 'pnpm') {
              beginPhase(migration, 'postTarget');
              await run(cli, ['update', 'sharp', '--depth', 'Infinity'], directory, true, migration);
              const postTarget = await capture(migration, directory, 'postTarget');
              const classification = classifyTarget(postOrdinary, postTarget);
              migration.receipt.target = { classification, baseline: 'postOrdinary', platform: process.platform,
                wantedLockChanged: postOrdinary.files['pnpm-lock.yaml'].sha256 !== postTarget.files['pnpm-lock.yaml'].sha256,
                installedLockChanged: postOrdinary.files['node_modules/.pnpm/lock.yaml'].sha256 !== postTarget.files['node_modules/.pnpm/lock.yaml'].sha256 };
              await evidence.flush();
              assertPolicyUnchanged(postOrdinary.policy, postTarget.policy);
              migration.receipt.target.policy = 'UNCHANGED';
              assert(['CHANGED_BAD_TO_GOOD', 'NOT_REPRODUCED'].includes(classification), `Targeted migration blocked: ${classification}`);
              completePhase(migration);
            } else {
              migration.receipt.phases.postTarget = { status: 'NOT_APPLICABLE', reason: 'No targeted step for npm' };
            }
          }
          if (migration) {
            beginPhase(migration, 'finalAudit');
            migration.receipt.phases.finalAudit = await audit(cli, directory, migration, { strict: true });
            await evidence.flush();
          } else {
            const finalAudit = await run(cli, ['audit', '--json'], directory);
            parseAudit(commandRecord(cli, managerVersions[manager], ['audit', '--json'], finalAudit, null, false), true);
          }
          if (migration) beginPhase(migration, 'finalChecks');
          if (manager === 'npm') await run(cli, ['ls', '--all'], directory, false, migration);
          const versions = await checkInstalledVersions(directory);
          if (migration) {
            migration.receipt.installedVersions = versions;
            const physical = await physicalGraph(directory);
            migration.receipt.finalPhysical = physical;
            assert(physical.hfRelativeSharp.version, 'HF-relative Sharp is missing');
            assertMinimumVersion('sharp', physical.hfRelativeSharp.version);
          }
          if (withPeer || ['@wyreup/cli', '@wyreup/mcp'].includes(artifact.name)) {
            assert(versions.some(entry => entry.name === '@huggingface/transformers'), 'Required official AI runtime is missing');
          } else {
            assert(!versions.some(entry => entry.name === '@huggingface/transformers'), 'Optional AI runtime installed unexpectedly');
          }
          const smoke = path.join(directory, 'smoke.mjs');
          await copyFile(path.join(root, 'tools/package-consumer-smoke.mjs'), smoke);
          await auxiliary(['--check', smoke], directory, migration);
          const result = await auxiliary([smoke, artifact.name, ...(withPeer ? ['with-ai'] : [])], directory, migration);
          process.stdout.write(result.stdout);
          const types = path.join(directory, 'consumer.mts');
          const typeChecks = {
            '@wyreup/core': "import { createDefaultRegistry } from '@wyreup/core';\ncreateDefaultRegistry();\n",
            '@wyreup/exceljs': "import ExcelJS from '@wyreup/exceljs';\nnew ExcelJS.Workbook();\n",
            '@wyreup/mammoth': "import mammoth from '@wyreup/mammoth';\nvoid mammoth.extractRawText({ arrayBuffer: new ArrayBuffer(1) });\n",
          };
          if (typeChecks[artifact.name]) {
            await writeFile(types, typeChecks[artifact.name] + (withPeer ? "import { Tensor, pipeline } from '@huggingface/transformers';\nnew Tensor('float32', new Float32Array([1]), [1]);\nvoid pipeline;\n" : ''));
            await auxiliary([path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', types], directory, migration);
          }
          if (withPeer || ['@wyreup/exceljs', '@wyreup/mammoth'].includes(artifact.name)) {
            const contents = withPeer
              ? "import { pipeline, Tensor } from '@huggingface/transformers'; console.log(pipeline, Tensor);"
              : artifact.name === '@wyreup/exceljs'
                ? "import { Workbook } from '@wyreup/exceljs'; console.log(new Workbook());"
                : "import mammoth from '@wyreup/mammoth'; console.log(mammoth.extractRawText);";
            const browser = await build({ absWorkingDir: directory,
              stdin: { contents, resolveDir: directory, sourcefile: 'browser-consumer.mjs' },
              bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
            assert(browser.outputFiles[0]?.contents.length > 0, 'Packed browser entrypoint did not bundle');
          }
          if (migration) {
            migration.receipt.phases.finalChecks = { status: 'COMPLETE', installedFloors: 'PASSED', hfRelativeSharpFloor: 'PASSED', nativeSmoke: 'PASSED', types: 'PASSED', browserBundle: 'PASSED' };
            migration.receipt.status = 'COMPLETED';
            migration.receipt.complete = true;
          }
          } catch (error) { caseError = error; }
          await preserveError(caseError, async () => {
            if (!migration) return;
            if (caseError) {
              migration.receipt.status = 'FAILED';
              migration.receipt.complete = false;
              failPhase(migration, caseError);
              let snapshotError;
              try { migration.receipt.failureSnapshot = await migrationSnapshot(directory, manager); }
              catch (error) {
                snapshotError = error;
                migration.receipt.failureSnapshot = { status: 'FAILED', error: describeError(error) };
              }
              await evidence.flush();
              if (snapshotError) throw snapshotError;
            } else await evidence.flush();
          }, error => {
            if (migration) migration.receipt.secondaryEvidenceErrors.push(describeError(error));
            process.stderr.write(`Secondary evidence error: ${error.message}\n`);
          });
          console.log(`${manager} ${artifact.name}${withPeer ? ' with optional peer' : ''}: scripts ${ignoreScripts ? 'disabled' : 'normal default installation'}, audit, nested version floors and smoke passed${migration ? '; HF/Sharp seeded-lock update passed' : ''}`);
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  }
  succeeded = true;
} catch (error) { primaryError = error; }
let terminalError;
try {
  await preserveError(primaryError, async () => {
    evidence.manifest.terminalStatus = succeeded ? 'SUCCEEDED' : 'FAILED';
    await evidence.flush();
  });
} catch (error) { terminalError = error; }
await preserveError(terminalError, async () => {
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (succeeded && !terminalError) await rm(scratch, { recursive: true, force: true });
  else process.stderr.write(`Consumer check failed; owned scratch retained at ${scratch}\nNpm verbose/timing logs: ${path.join(scratch, 'npm-cache', '_logs')}\n`);
});
