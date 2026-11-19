import { it } from 'vitest';
import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import { lstat as actualLstat, mkdir as actualMkdir, mkdtemp, open as actualOpen, readFile, realpath as actualRealpath,
  rm, symlink as actualSymlink, writeFile as actualWriteFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pathModule from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { tmpdir } from 'node:os';

const source = await readFile(new URL('../check-package-consumers.mjs', import.meta.url), 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
const originalHash = 'a53cfd2f8fb3dd4032df85761dbae9f856f5f483a7f18af6303793fa84852c03';
const required = ['contained', 'sameFile', 'writtenFileMatches', 'evidenceDiagnostic',
  'emitEvidenceDiagnostic', 'evidenceGuard', 'matchesEvidence', 'closeEvidenceHandle', 'ownedFile', 'ownedWrite'];
const successor = ['pathFileCandidate', 'descriptorIdentityValid', 'closeEvidenceHandles'];
const helpers = ['evidenceOpenFlags', 'pinEvidenceRoot', 'trustVerifiedEvidence'];
const constants = ['sha256', 'receiptNames'];
const ast = ts.createSourceFile('check-package-consumers.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length, 0);
const declarations = new Map([...required, ...successor, ...helpers, ...constants].map(name => [name, []]));
for (const statement of ast.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name && declarations.has(statement.name.text))
    declarations.get(statement.name.text).push(statement.getText(ast));
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !constants.includes(declaration.name.text)) continue;
      assert.equal(statement.declarationList.declarations.length, 1);
      declarations.get(declaration.name.text).push(statement.getText(ast));
    }
  }
}
for (const name of [...required, ...constants]) assert.equal(declarations.get(name).length, 1, name);
for (const name of successor) assert.equal(declarations.get(name).length, sourceHash === originalHash ? 0 : 1, name);
for (const name of helpers) assert(declarations.get(name).length <= 1, name);
const extracted = [...declarations.values()].flat().join('\n');
const path = pathModule.posix;
const owner = '/synthetic-owned';
const target = path.join(owner, 'migration-npm.json');
const W = 3436560750n;
const I = (1n << 53n) + 777n;
const M = 1793765790016.5876;
const MNS = 1793765790016587600n;
const body = Buffer.alloc(550, 120);
const simulatedPosixConstants = { O_RDONLY: 0, O_RDWR: 2, O_NOFOLLOW: 0x20000, O_NONBLOCK: 0x800 };

function stats(changes = {}) {
  return { dev: W, ino: I, size: BigInt(body.length), mtimeMs: M, mtimeNs: MNS,
    isFile: () => true, isSymbolicLink: () => false, ...changes };
}
function directoryStats(changes = {}) {
  return { dev: W, ino: I + 99n, size: 0n, mtimeMs: M, mtimeNs: MNS,
    isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, ...changes };
}
const op = (name, value, error) => ({ name, value, error });
const root = () => op('realpath:owner', owner);
const real = value => op('realpath:path', value ?? target);
const ls = value => op('lstat', value);
const opened = (mode, name) => op(`open:${mode}`, name);
const fs = (name, value) => op(`${name}.stat`, value);
const close = (name, error) => op(`${name}.close`, undefined, error);
const read = (name, bytes, error) => op(`${name}.read`, bytes, error);

function fixture(steps, platform = 'win32', selectedTarget = target) {
  const parentTarget = path.dirname(selectedTarget);
  const pending = [...steps], calls = [], diagnostics = [], statOptions = [], openRequests = [];
  const trustedEvidenceWrites = new Map();
  let ownerMetadata = directoryStats();
  let allocations = 0;
  function take(name) {
    calls.push(name);
    const next = pending.shift();
    assert.equal(next?.name, name, `source ${sourceHash}: unexpected call; remaining ${pending.map(x => x.name)}`);
    if (next.error) throw next.error;
    return next.value;
  }
  function handle(name) {
    return {
      async stat(options) { statOptions.push(options); return take(`${name}.stat`); },
      async close() { take(`${name}.close`); },
      async writeFile(bytes) { const expected = take(`${name}.writeFile`); assert.deepEqual(bytes, expected ?? body); },
      async truncate(size) { const expected = take(`${name}.truncate`); assert.equal(size, expected ?? body.length); },
      async read(buffer, offset, length, position) {
        assert.equal(offset, position);
        const bytes = Buffer.from(take(`${name}.read`));
        assert(bytes.length <= length);
        bytes.copy(buffer, offset);
        return { bytesRead: bytes.length };
      },
    };
  }
  const api = vm.runInNewContext(`${extracted}\n({ ownedWrite, ownedFile, matchesEvidence, trustVerifiedEvidence })`, {
    assert, createHash, path, Error, Object, Number, JSON,
    fsConstants: platform === 'darwin' ? simulatedPosixConstants : fsConstants,
    trustedEvidenceWrites, pinnedEvidenceRoots: new Map(),
    Buffer: { alloc(size) { allocations++; return Buffer.alloc(size); }, byteLength: Buffer.byteLength },
    process: { platform, stderr: { write(message) {
      const prefix = 'Evidence I/O failure: ';
      assert(message.startsWith(prefix));
      diagnostics.push(JSON.parse(message.slice(prefix.length)));
    } } },
    async realpath(value) {
      assert([owner, selectedTarget, parentTarget].includes(value));
      return take(value === owner ? 'realpath:owner' : value === parentTarget ? 'realpath:parent' : 'realpath:path');
    },
    async lstat(value, options) {
      statOptions.push(options);
      if (value === owner) return ownerMetadata;
      if (value === parentTarget && parentTarget !== owner) return take('lstat:parent');
      assert.equal(value, selectedTarget);
      return take('lstat');
    },
    async open(value, flags) {
      assert.equal(value, selectedTarget);
      openRequests.push(flags);
      const mode = typeof flags === 'string' ? flags
        : (flags & simulatedPosixConstants.O_RDWR) === simulatedPosixConstants.O_RDWR ? 'r+' : 'r';
      return handle(take(`open:${mode}`));
    },
  });
  return { api, calls, diagnostics, get allocations() { return allocations; },
    statOptions, openRequests,
    setOwnerMetadata(value) { ownerMetadata = value; },
    trustPrevious(name, value) { trustedEvidenceWrites.set(path.join(owner, name), value); },
    consumed() { assert.deepEqual(pending.map(x => x.name), [], `unconsumed source transcript ${sourceHash}`); } };
}

async function refuses(f, invoke, phase, check, message, identity) {
  await assert.rejects(invoke, error => {
    if (identity) assert.equal(error, identity);
    if (message) assert(error.message.startsWith(message), error.message);
    const diagnostic = f.diagnostics.at(-1);
    assert(diagnostic, 'missing actual source failure diagnostic');
    assert.equal(diagnostic.phase, phase);
    if (check) assert.equal(diagnostic.checks[check], false);
    return true;
  });
  f.consumed();
}

function freshWriteTail({ pathRow = stats({ dev: 0n }), reopenedRow = stats(), finalPath = pathRow } = {}) {
  return [ls(pathRow), real(), opened('r', 'verify'), fs('verify', reopenedRow),
    ls(finalPath), real(), close('verify')];
}
function freshWriteHead(openedRow = stats({ size: 0n, mtimeMs: 1793765790015.7983 }), written = stats()) {
  return [root(), ls(null), opened('wx', 'writer'), fs('writer', openedRow),
    op('writer.writeFile'), op('writer.truncate'), fs('writer', written), close('writer')];
}
function readHead({ before = stats({ dev: 0n }), openedRow = stats() } = {}) {
  return [root(), ls(before), real(), opened('r', 'read1'), fs('read1', openedRow)];
}
function readTail({ before = stats({ dev: 0n }), afterFd = stats(), second = stats(), finalPath = before, bytes = body } = {}) {
  return [read('read1', bytes), read('read1', Buffer.alloc(0)), fs('read1', afterFd), ls(before), real(),
    opened('r', 'read2'), fs('read2', second), ls(finalPath), real(), close('read1'), close('read2')];
}

it('accepts the captured Windows writer rows only after a SYNTHETIC independent reopened FD join', async () => {
  // Only opened/written/postClose rows were captured in CI. verify FD is synthetic.
  const f = fixture([...freshWriteHead(), ...freshWriteTail()]);
  const baseline = await f.api.ownedWrite(owner, 'migration-npm.json', body);
  assert.equal(baseline.dev, W);
  assert.equal(baseline.ino, I);
  assert.equal(baseline.size, BigInt(body.length));
  f.consumed();
});

it('refuses an untrusted preexisting output before opening it for the first write', async () => {
  const f = fixture([root(), ls(stats()), real()], 'darwin');
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'before-existing-check', 'before-existing-check', 'Evidence output already exists without a trusted writer');
  assert(!f.calls.some(call => call.startsWith('open:')));
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('refuses replacement of a previously verified output before mutation', async () => {
  const replacement = stats({ ino: I + 1n });
  const f = fixture([
    ...freshWriteHead(), ...freshWriteTail({ pathRow: stats(), reopenedRow: stats(), finalPath: stats() }),
    root(), ls(replacement), real(),
  ], 'darwin');
  const baseline = await f.api.ownedWrite(owner, 'migration-npm.json', body);
  f.trustPrevious('migration-npm.json', baseline);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'previous-writer-join', 'previous-writer-join', 'Evidence output differs from its previous verified writer');
  assert.equal(f.calls.filter(call => call === 'writer.writeFile').length, 1);
  assert.equal(f.calls.filter(call => call === 'writer.truncate').length, 1);
  assert.equal(f.openRequests.length, 2);
});

it('allows a shorter rewrite of the same previously verified inode', async () => {
  const shortBytes = Buffer.from('abc');
  const shortStat = stats({ size: BigInt(shortBytes.length), mtimeNs: MNS + 1_000_000n });
  const f = fixture([
    ...freshWriteHead(), ...freshWriteTail({ pathRow: stats(), reopenedRow: stats(), finalPath: stats() }),
    root(), ls(stats()), real(), opened('r+', 'writer'), fs('writer', stats()),
    op('writer.writeFile', shortBytes), op('writer.truncate', shortBytes.length), fs('writer', shortStat), close('writer'),
    ls(shortStat), real(), opened('r', 'verify'), fs('verify', shortStat), ls(shortStat), real(), close('verify'),
  ], 'darwin');
  const firstBaseline = await f.api.ownedWrite(owner, 'migration-npm.json', body);
  f.trustPrevious('migration-npm.json', firstBaseline);
  const rewritten = await f.api.ownedWrite(owner, 'migration-npm.json', shortBytes);
  assert.equal(rewritten.ino, firstBaseline.ino);
  assert.equal(rewritten.size, 3n);
  assert.equal(f.calls.filter(call => call === 'writer.writeFile').length, 2);
  assert.equal(f.calls.filter(call => call === 'writer.truncate').length, 2);
  f.consumed();
});

it('requests BigInt metadata for every path and descriptor observation', async () => {
  const f = fixture([...freshWriteHead(), ...freshWriteTail()]);
  await f.api.ownedWrite(owner, 'migration-npm.json', body);
  assert(f.statOptions.length > 0);
  assert(f.statOptions.every(options => options?.bigint === true), 'Every lstat/stat call must request bigint metadata');
  assert(f.openRequests.every(flags => typeof flags === 'string'), 'Windows must retain native string open modes');
  f.consumed();
});

it('refuses a linked caller-owned root before resolving or reading children', async () => {
  const f = fixture([], 'darwin');
  f.setOwnerMetadata(directoryStats({ isDirectory: () => false, isSymbolicLink: () => true }));
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false),
    'owner-type', 'owner-type', 'Evidence owner is not a nonlink directory');
});

it('refuses a caller-owned root whose canonical directory identity changes', async () => {
  const f = fixture([...freshWriteHead(), ...freshWriteTail({ pathRow: stats(), reopenedRow: stats(), finalPath: stats() }), root()], 'darwin');
  await f.api.ownedWrite(owner, 'migration-npm.json', body);
  f.setOwnerMetadata(directoryStats({ ino: I + 100n }));
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'owner-identity', 'owner-identity', 'Evidence owner identity changed');
  assert.equal(f.calls.filter(call => call === 'writer.writeFile').length, 1);
});

it('rejects a linked optional history parent without reading through it', async () => {
  const seededTarget = path.join(owner, 'seeded-lock-npm', 'seed-package.json');
  const f = fixture([root(), op('lstat:parent', directoryStats({ isDirectory: () => false, isSymbolicLink: () => true }))], 'darwin', seededTarget);
  await refuses(f, () => f.api.ownedFile(owner, 'seeded-lock-npm/seed-package.json', 1024, false, undefined, true),
    'seed-parent-type', 'seed-parent-type', 'Optional history parent is not a nonlink directory');
  assert(!f.calls.includes('open:r'));
});

it('rejects an optional history parent redirected outside its canonical root', async () => {
  const seededTarget = path.join(owner, 'seeded-lock-npm', 'seed-package.json');
  const parent = directoryStats();
  const f = fixture([root(), op('lstat:parent', parent), op('realpath:parent', '/outside/seeded-lock-npm')], 'darwin', seededTarget);
  await refuses(f, () => f.api.ownedFile(owner, 'seeded-lock-npm/seed-package.json', 1024, false, undefined, true),
    'seed-parent-realpath', 'seed-parent-realpath', 'Optional history parent escaped its owned root');
  assert(!f.calls.includes('open:r'));
});

it('keeps a genuinely absent optional history parent ABSENT', async () => {
  const seededTarget = path.join(owner, 'seeded-lock-npm', 'seed-package.json');
  const f = fixture([root(), op('lstat:parent', null)], 'darwin', seededTarget);
  const result = await f.api.ownedFile(owner, 'seeded-lock-npm/seed-package.json', 1024, false, undefined, true);
  assert.equal(result.status, 'ABSENT');
  assert.equal(result.bytes, 0);
  f.consumed();
});

it('uses nonblocking no-follow flags on POSIX evidence reads to avoid FIFO hangs', async () => {
  const stable = stats();
  const f = fixture([...readHead({ before: stable }), ...readTail({ before: stable, finalPath: stable })], 'darwin');
  await f.api.ownedFile(owner, 'migration-npm.json', 1024, false);
  assert.equal(f.openRequests.length, 2);
  const requiredFlags = simulatedPosixConstants.O_NOFOLLOW | simulatedPosixConstants.O_NONBLOCK;
  assert(f.openRequests.every(flags => typeof flags === 'number' && (flags & requiredFlags) === requiredFlags));
  f.consumed();
});

it('accepts a matching large BigInt inode when a Windows path reports device zero', async () => {
  const ino = (1n << 53n) + 17n;
  const before = stats({ dev: 0n, ino });
  const descriptor = stats({ dev: W, ino });
  const f = fixture([...readHead({ before, openedRow: descriptor }),
    ...readTail({ before, afterFd: descriptor, second: descriptor, finalPath: before })]);
  const result = await f.api.ownedFile(owner, 'migration-npm.json', 1024, false);
  assert.equal(result.status, 'COMPLETE');
  assert.deepEqual(f.openRequests, ['r', 'r']);
  f.consumed();
});

it('rejects distinct adjacent BigInt inodes that collide when converted to Number', async () => {
  const pathIno = 1n << 53n;
  const descriptorIno = pathIno + 1n;
  assert.equal(Number(pathIno), Number(descriptorIno));
  const before = stats({ dev: 0n, ino: pathIno });
  const descriptor = stats({ dev: W, ino: descriptorIno });
  const f = fixture([...readHead({ before, openedRow: descriptor }), close('read1')]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false),
    'path-fd-join', 'path-fd-join', 'Evidence input changed before reading');
  assert.equal(f.allocations, 0);
  assert(!f.calls.includes('read1.read'));
});

it('round-trips owned evidence with actual filesystem BigIntStats', async () => {
  const directory = await mkdtemp(pathModule.join(tmpdir(), 'consumer-bigint-identity-'));
  try {
    const api = vm.runInNewContext(`${extracted}\n({ ownedWrite, ownedFile, matchesEvidence, trustVerifiedEvidence })`, {
      assert, createHash, path: pathModule, Error, Object, Number, JSON, Buffer, fsConstants,
      trustedEvidenceWrites: new Map(), pinnedEvidenceRoots: new Map(),
      process: { platform: process.platform, stderr: { write() {} } },
      realpath: actualRealpath,
      lstat: actualLstat,
      open: actualOpen,
    });
    const bytes = Buffer.from('synthetic real-filesystem BigIntStats evidence');
    const baseline = await api.ownedWrite(directory, 'migration-npm.json', bytes);
    assert.equal(typeof baseline.dev, 'bigint');
    assert.equal(typeof baseline.ino, 'bigint');
    assert.equal(typeof baseline.size, 'bigint');
    assert.equal(typeof baseline.mtimeNs, 'bigint');
    const actual = await api.ownedFile(directory, 'migration-npm.json', 1024, false, baseline);
    assert.equal(actual.status, 'COMPLETE');
    assert.equal(typeof actual.bytes, 'number');
    assert(api.matchesEvidence(actual, bytes));
    const canonicalDirectory = await actualRealpath(directory);
    api.trustVerifiedEvidence(canonicalDirectory, 'migration-npm.json', baseline, actual, bytes);

    const packageDirectory = pathModule.join(directory, 'package-target');
    await actualMkdir(packageDirectory);
    await actualWriteFile(pathModule.join(packageDirectory, 'package.json'), bytes);
    const linkPath = pathModule.join(directory, 'node_modules', 'linked-package');
    await actualMkdir(pathModule.dirname(linkPath));
    await actualSymlink(packageDirectory, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    const resolvedPackage = await actualRealpath(linkPath);
    assert(resolvedPackage.startsWith(`${canonicalDirectory}${pathModule.sep}`));
    const linkedManifest = await api.ownedFile(canonicalDirectory, pathModule.relative(canonicalDirectory,
      pathModule.join(resolvedPackage, 'package.json')), 1024, false);
    assert.equal(linkedManifest.status, 'COMPLETE');
    assert(api.matchesEvidence(linkedManifest, bytes));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps a permitted write-close mtime transition out of the later stable baseline', async () => {
  const after = stats({ mtimeMs: M + 10, mtimeNs: MNS + 10_000_000n });
  const f = fixture([...freshWriteHead(), ...freshWriteTail({ pathRow: { ...after, dev: 0n }, reopenedRow: after })]);
  const baseline = await f.api.ownedWrite(owner, 'migration-npm.json', body);
  assert.equal(baseline.mtimeNs, MNS + 10_000_000n);
  f.consumed();
});

it('refuses a same-inode post-close FD on another device', async () => {
  const f = fixture([...freshWriteHead(), ls(stats({ dev: 0n })), real(), opened('r', 'verify'),
    fs('verify', stats({ dev: W + 1n })), close('verify')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'post-close-fd-join',
    'post-close-fd-join', 'Evidence output path differs from its closed writer');
});

it('refuses pathname replacement during the post-close reopen', async () => {
  const f = fixture([...freshWriteHead(), ls(stats({ dev: 0n })), real(), opened('r', 'verify'),
    fs('verify', stats()), ls(stats({ dev: 0n, ino: I + 1n })), close('verify')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'post-close-path-join',
    'post-close-path-join', 'Evidence output path differs from its closed writer');
});

it('does not accept path dev0 without a successful independent FD observation', async () => {
  const failure = new Error('synthetic reopen failure');
  const f = fixture([...freshWriteHead(), ls(stats({ dev: 0n })), real(), op('open:r', undefined, failure)]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'post-close-open', null, null, failure);
});

it('anchors an existing Windows output and closes that anchor before any write', async () => {
  const before = stats({ dev: 0n });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(before), real(), close('anchor'),
    op('writer.writeFile'), op('writer.truncate'), fs('writer', stats()), close('writer'), ...freshWriteTail()]);
  f.trustPrevious('migration-npm.json', stats());
  await f.api.ownedWrite(owner, 'migration-npm.json', body);
  assert(f.calls.indexOf('anchor.close') < f.calls.indexOf('writer.writeFile'));
  f.consumed();
});

it('joins a Windows dev0 anchor to the trusted prior FD volume before writer open', async () => {
  const f = fixture([root(), ls(stats({ dev: 0n })), real(), opened('r', 'anchor'),
    fs('anchor', stats({ dev: W + 1n })), close('anchor')]);
  f.trustPrevious('migration-npm.json', stats());
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'anchor-path-join', 'anchor-path-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('open:r+'));
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('refuses a mismatched anchor before even opening r+', async () => {
  const f = fixture([root(), ls(stats({ dev: 0n })), real(), opened('r', 'anchor'),
    fs('anchor', stats({ ino: I + 1n })), close('anchor')]);
  f.trustPrevious('migration-npm.json', stats());
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'anchor-path-join',
    'anchor-path-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('open:r+'));
  assert(!f.calls.includes('writer.writeFile'));
});

it('refuses a writer device mismatch and closes both prewrite handles without writing', async () => {
  const f = fixture([root(), ls(stats({ dev: 0n })), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats({ dev: W + 1n })), close('anchor'), close('writer')]);
  f.trustPrevious('migration-npm.json', stats());
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'before-fd-join',
    'before-fd-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('refuses an anchor close failure, still closes the writer, and never writes', async () => {
  const failure = new Error('synthetic anchor close failure');
  const before = stats({ dev: 0n });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(before), real(), close('anchor', failure), close('writer')]);
  f.trustPrevious('migration-npm.json', stats());
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'close', null, null, failure);
  assert.equal(f.diagnostics.at(-1).close, 'FAILED');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('preserves expected-path refusal before bounds, open and allocation', async () => {
  const f = fixture([root(), ls(stats({ dev: 0n, ino: I + 1n, size: 1000n })), real()]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1, false, stats()),
    'expected-path-join', 'expected-path-join', 'Evidence readback differs from its closed writer');
  assert.equal(f.allocations, 0);
  assert(!f.calls.includes('open:r'));
});

it('strictly joins expected writer and first read FD before any bytes', async () => {
  const f = fixture([...readHead({ openedRow: stats({ dev: W + 1n }) }), close('read1')]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false, stats()),
    'expected-fd-join', 'expected-fd-join', 'Evidence readback differs from its closed writer');
  assert.equal(f.allocations, 0);
  assert(!f.calls.includes('read1.read'));
});

it('proves no-expected Windows read stability across two reopened FDs, not a path volume value', async () => {
  const f = fixture([...readHead(), ...readTail()]);
  const result = await f.api.ownedFile(owner, 'migration-npm.json', 1024, false);
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.sha256, createHash('sha256').update(body).digest('hex'));
  f.consumed();
});

it('preserves the ordinary POSIX stable read with strict reopen joins', async () => {
  const before = stats();
  const f = fixture([...readHead({ before }), ...readTail({ before })], 'darwin');
  assert.equal((await f.api.ownedFile(owner, 'migration-npm.json', 1024, false, before)).status, 'COMPLETE');
  f.consumed();
});

it.each([
  ['path and first FD dev0; a second dev0 cannot repair missing evidence', { dev: 0n }, 'win32'],
  ['zero inode', { ino: 0n }, 'win32'],
  ['unsafe Number inode', { ino: Number.MAX_SAFE_INTEGER + 1 }, 'win32'],
  ['unknown device', { dev: undefined }, 'win32'],
  ['path dev0 on non-Windows', {}, 'darwin'],
])('refuses %s before allocation/read', async (_label, change, platform) => {
  const f = fixture([...readHead({ openedRow: stats(change) }), close('read1')], platform);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false),
    'path-fd-join', 'path-fd-join', 'Evidence input changed before reading');
  assert.equal(f.allocations, 0);
  assert(!f.calls.includes('read1.read'));
  assert(!f.calls.includes('open:r') || f.calls.filter(x => x === 'open:r').length === 1);
});

it('refuses a zero-device reopened FD even when another zero observation could agree', async () => {
  const before = stats({ dev: 0n });
  const f = fixture([...readHead(), read('read1', body), read('read1', Buffer.alloc(0)), fs('read1', stats()),
    ls(before), real(), opened('r', 'read2'), fs('read2', stats({ dev: 0n })), close('read1'), close('read2')]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false),
    'reopened-fd-join', 'reopened-fd-join', 'Evidence input FD changed while reopening');
});

it('refuses a same-inode read reopen on a different device', async () => {
  const before = stats({ dev: 0n });
  const f = fixture([...readHead(), read('read1', body), read('read1', Buffer.alloc(0)), fs('read1', stats()),
    ls(before), real(), opened('r', 'read2'), fs('read2', stats({ dev: W + 1n })), close('read1'), close('read2')]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false),
    'reopened-fd-join', 'reopened-fd-join', 'Evidence input FD changed while reopening');
});

it('keeps read errors primary over a once-attempted close failure without expected metadata', async () => {
  const primary = new Error('synthetic read failure');
  const closing = new Error('synthetic read close failure');
  const f = fixture([...readHead(), read('read1', null, primary), close('read1', closing)]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false), 'close', null, null, primary);
  assert.equal(f.diagnostics.at(-1).close, 'FAILED');
});

it('attempts both acquired closes after a reopen-stat primary and reports the close failure', async () => {
  const primary = new Error('synthetic second stat failure');
  const closing = new Error('synthetic first close failure');
  const before = stats({ dev: 0n });
  const f = fixture([...readHead(), read('read1', body), read('read1', Buffer.alloc(0)), fs('read1', stats()),
    ls(before), real(), opened('r', 'read2'), op('read2.stat', undefined, primary), close('read1', closing), close('read2')]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false), 'close', null, null, primary);
  assert.equal(f.diagnostics.at(-1).close, 'FAILED');
});

it('does not return COMPLETE when a close fails after both successful FD joins', async () => {
  const primary = new Error('synthetic close after complete read');
  const tail = readTail();
  tail[tail.length - 2] = close('read1', primary);
  const f = fixture([...readHead(), ...tail]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false), 'close', null, null, primary);
  assert.equal(f.diagnostics.at(-1).close, 'FAILED');
});

it('leaves same-length body tamper detection with the actual intended-byte SHA check', async () => {
  const tampered = Buffer.alloc(body.length, 121);
  const f = fixture([...readHead(), ...readTail({ bytes: tampered })]);
  const result = await f.api.ownedFile(owner, 'migration-npm.json', 1024, false, stats());
  assert.equal(result.status, 'COMPLETE');
  assert.equal(f.api.matchesEvidence(result, body), false);
  assert.equal(f.api.matchesEvidence(result, tampered), true);
  f.consumed();
});

it('preserves optional absent and over-limit outcomes without opening files', async () => {
  const absent = fixture([root(), op('lstat', null, Object.assign(new Error('absent'), { code: 'ENOENT' }))]);
  assert.equal((await absent.api.ownedFile(owner, 'migration-npm.json', 1, false)).status, 'ABSENT');
  absent.consumed();
  const large = fixture([root(), ls(stats({ dev: 0n })), real()]);
  assert.equal((await large.api.ownedFile(owner, 'migration-npm.json', 1, false)).status, 'OVER_LIMIT');
  large.consumed();
});

it('keeps safe over-limit byte counts numeric and preserves larger counts exactly', async () => {
  const safeSize = 550n;
  const safe = fixture([root(), ls(stats({ dev: 0n, size: safeSize })), real()]);
  const safeResult = await safe.api.ownedFile(owner, 'migration-npm.json', 1, false);
  assert.equal(safeResult.status, 'OVER_LIMIT');
  assert.equal(safeResult.bytes, 550);
  assert.equal(typeof safeResult.bytes, 'number');
  assert.equal(safe.allocations, 0);
  safe.consumed();

  const largeSize = (1n << 53n) + 123n;
  const large = fixture([root(), ls(stats({ dev: 0n, size: largeSize })), real()]);
  const largeResult = await large.api.ownedFile(owner, 'migration-npm.json', 1, false);
  assert.equal(largeResult.status, 'OVER_LIMIT');
  assert.equal(largeResult.bytes, largeSize.toString());
  assert.equal(large.allocations, 0);
  large.consumed();
});

it.each([
  ['zero', 0],
  ['unsafe', Number.MAX_SAFE_INTEGER + 1],
])('refuses matched %s path and FD inodes before allocation/read', async (_label, ino) => {
  const row = stats({ ino });
  const f = fixture([...readHead({ before: row, openedRow: row }), close('read1')]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false),
    'path-fd-join', 'path-fd-join', 'Evidence input changed before reading');
  assert.equal(f.allocations, 0);
  assert(!f.calls.includes('read1.read'));
});

it('refuses a fresh wx zero-device FD before writing or truncating', async () => {
  const f = fixture([root(), ls(null), opened('wx', 'writer'), fs('writer', stats({ dev: 0n })), close('writer')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'before-fd-join', 'before-fd-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it.each([
  ['changed inode', stats({ dev: 0n, ino: I + 1n })],
  ['mtime-only sub-ms change', stats({ dev: 0n, mtimeNs: MNS + 1n })],
])('refuses a prewrite pathname %s and closes both handles without mutation', async (_label, beforeWrite) => {
  const before = stats({ dev: 0n });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(beforeWrite), close('anchor'), close('writer')]);
  f.trustPrevious('migration-npm.json', stats());
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'before-write-path-join', 'before-write-path-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('refuses an escaped prewrite realpath and closes both handles without mutation', async () => {
  const before = stats({ dev: 0n });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(before), real('/outside-owned/migration-npm.json'),
    close('anchor'), close('writer')]);
  f.trustPrevious('migration-npm.json', stats());
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'before-write-realpath', 'before-write-realpath', 'Evidence output escaped its owned root');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it.each(['anchor-open', 'anchor-stat', 'writer-open'])('retains the actual %s error and closes only acquired prewrite handles', async phase => {
  const failure = new Error(`synthetic ${phase} failure`);
  const steps = [root(), ls(stats({ dev: 0n })), real()];
  if (phase === 'anchor-open') steps.push(op('open:r', undefined, failure));
  else {
    steps.push(opened('r', 'anchor'));
    if (phase === 'anchor-stat') steps.push(op('anchor.stat', undefined, failure));
    else steps.push(fs('anchor', stats()), op('open:r+', undefined, failure));
    steps.push(close('anchor'));
  }
  const f = fixture(steps);
  f.trustPrevious('migration-npm.json', stats());
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    phase === 'writer-open' ? 'open' : phase, null, null, failure);
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
  if (phase !== 'writer-open') assert(!f.calls.includes('open:r+'));
});

it('attempts both failing closes and retains the first close error without a primary', async () => {
  const first = new Error('synthetic first close error');
  const second = new Error('synthetic second close error');
  const tail = readTail();
  tail[tail.length - 2] = close('read1', first);
  tail[tail.length - 1] = close('read2', second);
  const f = fixture([...readHead(), ...tail]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false), 'close', null, null, first);
  assert.equal(f.diagnostics.length, 2);
  assert.deepEqual(f.diagnostics.map(row => [row.close, row.secondary]), [['FAILED', false], ['FAILED', true]]);
});

it('preserves a reopen-stat primary across two failing close attempts', async () => {
  const primary = new Error('synthetic reopen stat primary');
  const before = stats({ dev: 0n });
  const f = fixture([...readHead(), read('read1', body), read('read1', Buffer.alloc(0)), fs('read1', stats()),
    ls(before), real(), opened('r', 'read2'), op('read2.stat', undefined, primary),
    close('read1', new Error('synthetic close one')), close('read2', new Error('synthetic close two'))]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false), 'close', null, null, primary);
  assert.deepEqual(f.diagnostics.slice(-2).map(row => [row.close, row.secondary]), [['FAILED', true], ['FAILED', true]]);
});
