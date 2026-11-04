import { it } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pathModule from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../check-package-consumers.mjs', import.meta.url), 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
const originalHash = 'a53cfd2f8fb3dd4032df85761dbae9f856f5f483a7f18af6303793fa84852c03';
const required = ['contained', 'sameFile', 'writtenFileMatches', 'evidenceDiagnostic',
  'emitEvidenceDiagnostic', 'evidenceGuard', 'matchesEvidence', 'closeEvidenceHandle', 'ownedFile', 'ownedWrite'];
const successor = ['pathFileCandidate', 'descriptorIdentityValid', 'closeEvidenceHandles'];
const constants = ['sha256', 'receiptNames'];
const ast = ts.createSourceFile('check-package-consumers.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length, 0);
const declarations = new Map([...required, ...successor, ...constants].map(name => [name, []]));
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
const extracted = [...declarations.values()].flat().join('\n');
const path = pathModule.posix;
const owner = '/synthetic-owned';
const target = path.join(owner, 'migration-npm.json');
const W = 3436560750;
const I = 281474976787152;
const M = 1793765790016.5876;
const body = Buffer.alloc(550, 120);

function stats(changes = {}) {
  return { dev: W, ino: I, size: body.length, mtimeMs: M,
    isFile: () => true, isSymbolicLink: () => false, ...changes };
}
const op = (name, value, error) => ({ name, value, error });
const root = () => op('realpath:owner', owner);
const real = value => op('realpath:path', value ?? target);
const ls = value => op('lstat', value);
const opened = (mode, name) => op(`open:${mode}`, name);
const fs = (name, value) => op(`${name}.stat`, value);
const close = (name, error) => op(`${name}.close`, undefined, error);
const read = (name, bytes, error) => op(`${name}.read`, bytes, error);

function fixture(steps, platform = 'win32') {
  const pending = [...steps], calls = [], diagnostics = [];
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
      async stat() { return take(`${name}.stat`); },
      async close() { take(`${name}.close`); },
      async writeFile(bytes) { assert.deepEqual(bytes, body); take(`${name}.writeFile`); },
      async truncate(size) { assert.equal(size, body.length); take(`${name}.truncate`); },
      async read(buffer, offset, length, position) {
        assert.equal(offset, position);
        const bytes = Buffer.from(take(`${name}.read`));
        assert(bytes.length <= length);
        bytes.copy(buffer, offset);
        return { bytesRead: bytes.length };
      },
    };
  }
  const api = vm.runInNewContext(`${extracted}\n({ ownedWrite, ownedFile, matchesEvidence })`, {
    assert, createHash, path, Error, Object, Number, JSON,
    Buffer: { alloc(size) { allocations++; return Buffer.alloc(size); }, byteLength: Buffer.byteLength },
    process: { platform, stderr: { write(message) {
      const prefix = 'Evidence I/O failure: ';
      assert(message.startsWith(prefix));
      diagnostics.push(JSON.parse(message.slice(prefix.length)));
    } } },
    async realpath(value) { assert([owner, target].includes(value)); return take(value === owner ? 'realpath:owner' : 'realpath:path'); },
    async lstat(value) { assert.equal(value, target); return take('lstat'); },
    async open(value, mode) { assert.equal(value, target); return handle(take(`open:${mode}`)); },
  });
  return { api, calls, diagnostics, get allocations() { return allocations; },
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

function freshWriteTail({ pathRow = stats({ dev: 0 }), reopenedRow = stats(), finalPath = pathRow } = {}) {
  return [ls(pathRow), real(), opened('r', 'verify'), fs('verify', reopenedRow),
    ls(finalPath), real(), close('verify')];
}
function freshWriteHead(openedRow = stats({ size: 0, mtimeMs: 1793765790015.7983 }), written = stats()) {
  return [root(), ls(null), opened('wx', 'writer'), fs('writer', openedRow),
    op('writer.writeFile'), op('writer.truncate'), fs('writer', written), close('writer')];
}
function readHead({ before = stats({ dev: 0 }), openedRow = stats() } = {}) {
  return [root(), ls(before), real(), opened('r', 'read1'), fs('read1', openedRow)];
}
function readTail({ before = stats({ dev: 0 }), afterFd = stats(), second = stats(), finalPath = before, bytes = body } = {}) {
  return [read('read1', bytes), read('read1', Buffer.alloc(0)), fs('read1', afterFd), ls(before), real(),
    opened('r', 'read2'), fs('read2', second), ls(finalPath), real(), close('read1'), close('read2')];
}

it('accepts the captured Windows writer rows only after a SYNTHETIC independent reopened FD join', async () => {
  // Only opened/written/postClose rows were captured in CI. verify FD is synthetic.
  const f = fixture([...freshWriteHead(), ...freshWriteTail()]);
  const baseline = await f.api.ownedWrite(owner, 'migration-npm.json', body);
  assert.equal(baseline.dev, W);
  assert.equal(baseline.ino, I);
  assert.equal(baseline.size, body.length);
  f.consumed();
});

it('keeps a permitted write-close mtime transition out of the later stable baseline', async () => {
  const after = stats({ mtimeMs: M + 10 });
  const f = fixture([...freshWriteHead(), ...freshWriteTail({ pathRow: { ...after, dev: 0 }, reopenedRow: after })]);
  const baseline = await f.api.ownedWrite(owner, 'migration-npm.json', body);
  assert.equal(baseline.mtimeMs, M + 10);
  f.consumed();
});

it('refuses a same-inode post-close FD on another device', async () => {
  const f = fixture([...freshWriteHead(), ls(stats({ dev: 0 })), real(), opened('r', 'verify'),
    fs('verify', stats({ dev: W + 1 })), close('verify')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'post-close-fd-join',
    'post-close-fd-join', 'Evidence output path differs from its closed writer');
});

it('refuses pathname replacement during the post-close reopen', async () => {
  const f = fixture([...freshWriteHead(), ls(stats({ dev: 0 })), real(), opened('r', 'verify'),
    fs('verify', stats()), ls(stats({ dev: 0, ino: I + 1 })), close('verify')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'post-close-path-join',
    'post-close-path-join', 'Evidence output path differs from its closed writer');
});

it('does not accept path dev0 without a successful independent FD observation', async () => {
  const failure = new Error('synthetic reopen failure');
  const f = fixture([...freshWriteHead(), ls(stats({ dev: 0 })), real(), op('open:r', undefined, failure)]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'post-close-open', null, null, failure);
});

it('anchors an existing Windows output and closes that anchor before any write', async () => {
  const before = stats({ dev: 0 });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(before), real(), close('anchor'),
    op('writer.writeFile'), op('writer.truncate'), fs('writer', stats()), close('writer'), ...freshWriteTail()]);
  await f.api.ownedWrite(owner, 'migration-npm.json', body);
  assert(f.calls.indexOf('anchor.close') < f.calls.indexOf('writer.writeFile'));
  f.consumed();
});

it('refuses a mismatched anchor before even opening r+', async () => {
  const f = fixture([root(), ls(stats({ dev: 0 })), real(), opened('r', 'anchor'),
    fs('anchor', stats({ ino: I + 1 })), close('anchor')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'anchor-path-join',
    'anchor-path-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('open:r+'));
  assert(!f.calls.includes('writer.writeFile'));
});

it('refuses a writer device mismatch and closes both prewrite handles without writing', async () => {
  const f = fixture([root(), ls(stats({ dev: 0 })), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats({ dev: W + 1 })), close('anchor'), close('writer')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'before-fd-join',
    'before-fd-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('refuses an anchor close failure, still closes the writer, and never writes', async () => {
  const failure = new Error('synthetic anchor close failure');
  const before = stats({ dev: 0 });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(before), real(), close('anchor', failure), close('writer')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body), 'close', null, null, failure);
  assert.equal(f.diagnostics.at(-1).close, 'FAILED');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('preserves expected-path refusal before bounds, open and allocation', async () => {
  const f = fixture([root(), ls(stats({ dev: 0, ino: I + 1, size: 1000 })), real()]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1, false, stats()),
    'expected-path-join', 'expected-path-join', 'Evidence readback differs from its closed writer');
  assert.equal(f.allocations, 0);
  assert(!f.calls.includes('open:r'));
});

it('strictly joins expected writer and first read FD before any bytes', async () => {
  const f = fixture([...readHead({ openedRow: stats({ dev: W + 1 }) }), close('read1')]);
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
  ['path and first FD dev0; a second dev0 cannot repair missing evidence', { dev: 0 }, 'win32'],
  ['zero inode', { ino: 0 }, 'win32'],
  ['unsafe inode', { ino: Number.MAX_SAFE_INTEGER + 1 }, 'win32'],
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
  const before = stats({ dev: 0 });
  const f = fixture([...readHead(), read('read1', body), read('read1', Buffer.alloc(0)), fs('read1', stats()),
    ls(before), real(), opened('r', 'read2'), fs('read2', stats({ dev: 0 })), close('read1'), close('read2')]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false),
    'reopened-fd-join', 'reopened-fd-join', 'Evidence input FD changed while reopening');
});

it('refuses a same-inode read reopen on a different device', async () => {
  const before = stats({ dev: 0 });
  const f = fixture([...readHead(), read('read1', body), read('read1', Buffer.alloc(0)), fs('read1', stats()),
    ls(before), real(), opened('r', 'read2'), fs('read2', stats({ dev: W + 1 })), close('read1'), close('read2')]);
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
  const before = stats({ dev: 0 });
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
  const large = fixture([root(), ls(stats({ dev: 0 })), real()]);
  assert.equal((await large.api.ownedFile(owner, 'migration-npm.json', 1, false)).status, 'OVER_LIMIT');
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
  const f = fixture([root(), ls(null), opened('wx', 'writer'), fs('writer', stats({ dev: 0 })), close('writer')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'before-fd-join', 'before-fd-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it.each([
  ['changed inode', stats({ dev: 0, ino: I + 1 })],
  ['mtime-only change', stats({ dev: 0, mtimeMs: M + 1 })],
])('refuses a prewrite pathname %s and closes both handles without mutation', async (_label, beforeWrite) => {
  const before = stats({ dev: 0 });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(beforeWrite), close('anchor'), close('writer')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'before-write-path-join', 'before-write-path-join', 'Evidence output changed before writing');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it('refuses an escaped prewrite realpath and closes both handles without mutation', async () => {
  const before = stats({ dev: 0 });
  const f = fixture([root(), ls(before), real(), opened('r', 'anchor'), fs('anchor', stats()),
    opened('r+', 'writer'), fs('writer', stats()), ls(before), real('/outside-owned/migration-npm.json'),
    close('anchor'), close('writer')]);
  await refuses(f, () => f.api.ownedWrite(owner, 'migration-npm.json', body),
    'before-write-realpath', 'before-write-realpath', 'Evidence output escaped its owned root');
  assert(!f.calls.includes('writer.writeFile'));
  assert(!f.calls.includes('writer.truncate'));
});

it.each(['anchor-open', 'anchor-stat', 'writer-open'])('retains the actual %s error and closes only acquired prewrite handles', async phase => {
  const failure = new Error(`synthetic ${phase} failure`);
  const steps = [root(), ls(stats({ dev: 0 })), real()];
  if (phase === 'anchor-open') steps.push(op('open:r', undefined, failure));
  else {
    steps.push(opened('r', 'anchor'));
    if (phase === 'anchor-stat') steps.push(op('anchor.stat', undefined, failure));
    else steps.push(fs('anchor', stats()), op('open:r+', undefined, failure));
    steps.push(close('anchor'));
  }
  const f = fixture(steps);
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
  const before = stats({ dev: 0 });
  const f = fixture([...readHead(), read('read1', body), read('read1', Buffer.alloc(0)), fs('read1', stats()),
    ls(before), real(), opened('r', 'read2'), op('read2.stat', undefined, primary),
    close('read1', new Error('synthetic close one')), close('read2', new Error('synthetic close two'))]);
  await refuses(f, () => f.api.ownedFile(owner, 'migration-npm.json', 1024, false), 'close', null, null, primary);
  assert.deepEqual(f.diagnostics.slice(-2).map(row => [row.close, row.secondary]), [['FAILED', true], ['FAILED', true]]);
});
