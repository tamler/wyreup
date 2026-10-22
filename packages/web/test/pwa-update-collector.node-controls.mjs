import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeCollector, extractManifest, parseArguments, inventory } from '../scripts/check-pwa-update.mjs';

// UNIT-ONLY: authored API payloads exercise collection controls, never browser migration.
const ORIGIN = 'http://127.0.0.1:12345';
/** @param {string} [id] @param {string} [scopeURL] @returns {import('../scripts/check-pwa-update.mjs').NativeRegistration} */
const registration = (id = 'root', scopeURL = ORIGIN + '/') => ({ registrationId: id, scopeURL, isDeleted: false });
/** @param {string} [id] @param {string[]} [controlledClients] @param {import('../scripts/check-pwa-update.mjs').NativeVersionStatus} [status] @param {string} [registrationId] @returns {import('../scripts/check-pwa-update.mjs').NativeVersion} */
const version = (id = 'old', controlledClients = ['A'], status = 'activated', registrationId = 'root') => ({ versionId: id, registrationId, scriptURL: ORIGIN + '/sw.js', runningStatus: 'running', status, controlledClients });
function fixture() {
  const collector = new NativeCollector(ORIGIN);
  collector.beginStep(1);
  const token = collector.startSession('A');
  collector.acknowledged(token);
  return { collector, token };
}
/** @param {NativeCollector} collector @param {import('../scripts/check-pwa-update.mjs').CollectorSession} token */
const roots = (collector, token) => collector.envelope(token, 'registration', { registrations: [registration()] });
/** @param {NativeCollector} collector @param {import('../scripts/check-pwa-update.mjs').CollectorSession} token @param {import('../scripts/check-pwa-update.mjs').NativeVersion} value */
const emit = (collector, token, value) => collector.envelope(token, 'version', { versions: [value] });

void test('UNIT-ONLY second concurrent stream refuses before native capture', () => {
  const { collector, token } = fixture();
  const count = collector.records.length;
  assert.throws(() => collector.startSession('B'), /concurrently/);
  assert.equal(collector.records.length, count);
  assert.equal(collector.active, token);
});

void test('UNIT-ONLY sequential handoff records gaps and requires a fresh joined endpoint', () => {
  const { collector, token } = fixture();
  roots(collector, token);
  emit(collector, token, version('old', ['A', 'B']));
  assert.equal(collector.endpoint(['A', 'B'], 'activated', token.startSequence)?.versionId, 'old');
  collector.beginGap(token, 'unobserved A-to-B handoff');
  collector.endSession(token);
  const next = collector.startSession('B');
  collector.acknowledged(next);
  collector.endGap('B reattached');
  assert.equal(collector.endpoint(['B'], 'activated', next.startSequence, 'old'), null);
  roots(collector, next);
  assert.equal(collector.endpoint(['B'], 'activated', next.startSequence, 'old'), null);
  emit(collector, next, version('old', ['B']));
  assert.equal(collector.endpoint(['B'], 'activated', next.startSequence, 'old')?.versionId, 'old');
  assert.equal(collector.endpoint(['B'], 'activated', next.startSequence, 'new'), null);
  assert.equal(collector.records.filter((record) => record.kind.startsWith('unobserved-handoff-')).length, 2);
  assert(!collector.records.some((record) => record.kind === 'native-version' && record.payload.versions.some((value) => value.versionId === 'new')));
});

void test('UNIT-ONLY late old session callbacks cannot enter new step or stream', () => {
  const { collector, token } = fixture();
  roots(collector, token);
  collector.beginGap(token, 'handoff');
  collector.endSession(token);
  collector.beginStep(2);
  collector.startSession('B');
  const count = collector.records.length;
  assert.throws(() => emit(collector, token, version('old', ['B'])), /Late callback/);
  assert.equal(collector.records.length, count);
});

void test('UNIT-ONLY actual registration association precedes trusted version/control joins', () => {
  const { collector, token } = fixture();
  emit(collector, token, version());
  assert.equal(collector.versions.size, 0);
  assert.throws(() => collector.endpoint(['A'], 'activated', 0), /Unresolved/);
  const second = fixture();
  emit(second.collector, second.token, version());
  roots(second.collector, second.token);
  assert.equal(second.collector.endpoint(['A'], 'activated', 0)?.versionId, 'old');
  assert(second.collector.records.some((record) => record.kind === 'native-association'));
});

void test('UNIT-ONLY native controlledClients changes and status churn are retained', () => {
  const { collector, token } = fixture();
  roots(collector, token);
  emit(collector, token, version('old', ['A', 'B']));
  emit(collector, token, version('old', ['B']));
  emit(collector, token, { ...version('old', ['B']), runningStatus: 'stopped' });
  const native = collector.records.filter((record) => record.kind === 'native-version');
  assert.equal(native.length, 3);
  assert.deepEqual(native.map((record) => record.payload.versions[0].controlledClients), [['A', 'B'], ['B'], ['B']]);
  assert.equal(native[2].payload.versions[0].runningStatus, 'stopped');
});

void test('UNIT-ONLY foreign native payloads are not exported, including before association', () => {
  const { collector, token } = fixture();
  const foreign = { ...version('foreign-secret', [], 'activated', 'foreign'), scriptURL: 'https://foreign.invalid/private' };
  emit(collector, token, foreign);
  collector.envelope(token, 'registration', { registrations: [registration('foreign', 'https://foreign.invalid/')] });
  emit(collector, token, foreign);
  const exported = JSON.stringify(collector.finish());
  assert(!exported.includes('foreign-secret'));
  assert(!exported.includes('foreign.invalid'));
  assert(collector.unrelated > 0);
  assert.equal(collector.pending.length, 0);
});

void test('UNIT-ONLY exactly 256 retained native envelopes per step; 257 refuses', () => {
  const { collector, token } = fixture();
  for (let index = 0; index < 256; index++) roots(collector, token);
  assert.equal(collector.step.envelopes, 256);
  const count = collector.records.length;
  assert.throws(() => roots(collector, token), /cap 256/);
  assert.equal(collector.records.length, count);
  const other = fixture();
  for (let index = 0; index < 256; index++) roots(other.collector, other.token);
  other.collector.beginStep(2);
  roots(other.collector, other.token);
  assert.equal(other.collector.step.envelopes, 1);
});

void test('UNIT-ONLY exactly 8 relevant version identities; ninth refuses before capture', () => {
  const { collector, token } = fixture();
  roots(collector, token);
  for (let index = 0; index < 8; index++) emit(collector, token, version(String(index)));
  assert.equal(collector.versionIds.size, 8);
  const count = collector.records.length;
  assert.throws(() => emit(collector, token, version('ninth')), /cap 8/);
  assert.equal(collector.records.length, count);
});

void test('UNIT-ONLY exact 2MiB serialized retained ledger cap', () => {
  const { collector } = fixture();
  const cap = 2 * 1024 * 1024;
  const fixedTime = Date.now();
  const originalNow = Date.now;
  Date.now = () => fixedTime;
  try {
    const draft = { sequence: collector.sequence + 1, time: fixedTime, step: 1, session: collector.active.ordinal, kind: 'limit-fixture', payload: '' };
    const overhead = Buffer.byteLength(JSON.stringify(draft));
    const padding = cap - collector.bytes - overhead;
    collector.add('limit-fixture', 'a'.repeat(padding));
    assert.equal(collector.bytes, cap);
    const count = collector.records.length;
    assert.throws(() => collector.add('one-more-byte', 'x'), /2MiB/);
    assert.equal(collector.records.length, count);
  } finally { Date.now = originalNow; }
});

void test('UNIT-ONLY unknown association buffers charge raw native bytes', () => {
  const { collector, token } = fixture();
  const before = collector.bytes;
  const raw = { ...version(), routerRules: 'x'.repeat(100000) };
  emit(collector, token, raw);
  assert(collector.bytes - before >= Buffer.byteLength(JSON.stringify(raw)));
  assert.equal(collector.versions.size, 0);
});

void test('UNIT-ONLY stored snapshots cannot substitute for fresh endpoint association', () => {
  const { collector, token } = fixture();
  roots(collector, token);
  emit(collector, token, version());
  const after = collector.sequence;
  assert.equal(collector.endpoint(['A'], 'activated', after), null);
  emit(collector, token, version('old', []));
  assert.equal(collector.endpoint(['A'], 'activated', after), null);
  collector.envelope(token, 'registration', { registrations: [{ ...registration(), isDeleted: true }] });
  emit(collector, token, version());
  assert.equal(collector.endpoint(['A'], 'activated', after), null);
});

void test('UNIT-ONLY boundary callbacks retain gap label', () => {
  const { collector, token } = fixture();
  roots(collector, token);
  collector.beginGap(token, 'handoff');
  emit(collector, token, version());
  assert.equal(collector.records.at(-1).step, 'gap-boundary');
});

void test('UNIT-ONLY emitted JSON manifest extraction does not execute worker', () => {
  const manifest = extractManifest('throw new Error("must never execute"); fn([{"revision":"hash","url":"/tools/hash"},{"revision":null,"url":"_astro/real.js"}],{});');
  assert.deepEqual(manifest.paths, ['/tools/hash', '/_astro/real.js']);
  assert.throws(() => extractManifest('fn([{"revision":"hash","url":"/app-update/?x=1"}],{});'), /Recovery alias/);
  assert.throws(() => extractManifest('fn(self.__WB_MANIFEST);'), /Unsupported/);
  assert.throws(() => extractManifest('fn([{"revision":"hash","url":"/"}]); fn([{"revision":"second","url":"/two"}]);'), /unambiguous/);
});

void test('UNIT-ONLY exact local CLI rejects ambiguous roots and unknown flags', () => {
  assert.deepEqual(parseArguments(['--old', '/owned/old', '--new', '/owned/new', '--next', '/owned/next', '--evidence', '/owned/evidence']), { old: '/owned/old', new: '/owned/new', next: '/owned/next', evidence: '/owned/evidence' });
  assert.throws(() => parseArguments(['--old', '/owned/old', '--new', '/owned/old/new', '--next', '/owned/next', '--evidence', '/owned/evidence']), /overlap/);
  assert.throws(() => parseArguments(['--old', '/owned/old', '--new', '/owned/new', '--next', '/owned/next', '--wrong', '/owned/evidence']), /Unknown/);
});

void test('UNIT-ONLY actual inventory globally orders nested and sibling paths by code unit', async () => {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'wyreup-pwa-inventory-order-'));
  try {
    await mkdir(path.join(owned, 'a'));
    await writeFile(path.join(owned, 'a/x.txt'), 'x', { flag: 'wx' });
    await writeFile(path.join(owned, 'a.txt'), 'y', { flag: 'wx' });
    assert.deepEqual(await inventory(owned), [
      { path: 'a.txt', bytes: 1, sha256: 'a1fce4363854ff888cff4b8e7875d600c2682390412a8cf79b37d0b11148b0fa' },
      { path: 'a/x.txt', bytes: 1, sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' },
    ]);
  } finally {
    await rm(owned, { recursive: true });
  }
});

// Shape fixture only: it is intentionally not authenticated history or a qualified build.
export const benignReceiptShape = {
  schemaVersion: 1,
  classification: 'reviewed-candidate',
  sourceRoot: '/unit-only/source',
  sourceCommit: '1'.repeat(40),
  sourceInputs: [{ path: 'package.json', bytes: 2, sha256: '0'.repeat(64) }],
  sourceInputsBefore: [{ path: 'package.json', bytes: 2, sha256: '0'.repeat(64) }],
  sourceInputsAfter: [{ path: 'package.json', bytes: 2, sha256: '0'.repeat(64) }],
  packages: [{ path: 'package.json', bytes: 2, sha256: '0'.repeat(64), name: 'unit-only', version: '0.0.0' }],
  dependencyIdentities: [{ logicalPath: 'node_modules/unit-only', canonicalRoot: '/unit-only/dependency', name: 'unit-only', version: '0.0.0', packagePin: { path: '/unit-only/dependency/package.json', bytes: 2, sha256: '0'.repeat(64) } }],
  dependencyBefore: [{ path: '/unit-only/dependency/package.json', kind: 'file', bytes: 2, sha256: '0'.repeat(64) }, { path: '/unit-only/source/node_modules/unit-only', kind: 'symlink', target: '/unit-only/dependency' }],
  dependencyAfter: [{ path: '/unit-only/dependency/package.json', kind: 'file', bytes: 2, sha256: '0'.repeat(64) }, { path: '/unit-only/source/node_modules/unit-only', kind: 'symlink', target: '/unit-only/dependency' }],
  build: { argv: ['node', 'unit-only-build'], cwd: '/unit-only/source', startedAt: 1, deadlineAt: 2, exitCode: 0, signal: null, exitObserved: true, closeObserved: true, stdoutReaderSettled: true, stderrReaderSettled: true, logWriterSettled: true, logPin: { path: '/unit-only/evidence/build.log', bytes: 2, sha256: '0'.repeat(64) } },
  outputInventory: [{ path: 'unit-only.html', bytes: 2, sha256: '0'.repeat(64) }],
  sourceReviewEvidencePins: [{ path: '/unit-only/evidence/review.txt', bytes: 2, sha256: '0'.repeat(64) }],
  producerRecordPin: { path: '/unit-only/evidence/producer.json', bytes: 2, sha256: '0'.repeat(64) },
  appContentChangeEvidence: [{ path: 'packages/web/src/pages/unit-only.astro', oldSha256: '0'.repeat(64), newSha256: '1'.repeat(64) }],
};

export const benignProducerShape = { schemaVersion: 1, workspaceArtifacts: [{ packageName: '@wyreup/core', manifestPin: { path: '/unit-only/source/packages/core/package.json', bytes: 2, sha256: '0'.repeat(64) }, outputs: [{ path: '/unit-only/source/packages/core/dist/browser/index.js', bytes: 2, sha256: '0'.repeat(64) }] }], commandNativeEvidence: [{ argv: ['node', 'unit-only-build'], cwd: '/unit-only/source', pid: 1, exitCode: 0, signal: null, exitObserved: true, closeObserved: true, stdoutReaderSettled: true, stderrReaderSettled: true, logWriterSettled: true }] };

import { info as writeCapacityEvidence } from 'node:console';

void test('UNIT_ONLY Step1–7 native association, handoff, graph and storage families charge exact serialized bytes', () => {
  const collector = new NativeCollector(ORIGIN);
  let token;
  for (let step = 1; step <= 7; step++) {
    collector.beginStep(step);
    if (step === 1) {
      token = collector.startSession('A');
      collector.acknowledged(token);
      emit(collector, token, version());
      roots(collector, token);
    } else if (step === 6) {
      collector.beginGap(token, 'UNIT_ONLY authored A-to-C handoff');
      collector.endSession(token);
      token = collector.startSession('C');
      collector.acknowledged(token);
      collector.endGap('UNIT_ONLY authored C association');
      roots(collector, token);
    }
    for (let index = 0; index < 8; index++) {
      roots(collector, token);
      emit(collector, token, version(step < 6 ? 'old' : 'new', [step < 6 ? 'A' : 'C']));
    }
    collector.add('owned-target-association', { name: step < 6 ? 'A' : 'C', marker: 'UNIT_ONLY target', targetId: token.targetId });
    collector.add('owned-storage-observation', { localStorage: 'UNIT_ONLY sentinel', indexedDB: 'UNIT_ONLY sentinel' });
  }
  const nodes = Array.from({ length: 64 }, (_, index) => ({ pathname: '/_astro/unit-' + index + '.js', sha256: 'a'.repeat(64), staticImports: index ? ['/_astro/unit-' + (index - 1) + '.js'] : [], dynamicImports: [] }));
  collector.add('actual-emitted-old-deferred-graph', { classification: 'UNIT_ONLY authored graph shape; not emitted bytes', route: '/tools/hash/', selected: nodes[63].pathname, nodes, dependencies: nodes.map(node => node.pathname) });
  const result = collector.finish();
  const serializedRecordBytes = result.records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0);
  assert.equal(result.bytes, serializedRecordBytes);
  assert.deepEqual(result.records.filter(record => record.kind === 'step-start').map(record => {
    const payload = record.payload;
    assert(payload !== null && typeof payload === 'object' && !Array.isArray(payload));
    assert('ordinal' in payload);
    const ordinal = payload.ordinal;
    assert(typeof ordinal === 'number');
    return ordinal;
  }), [1, 2, 3, 4, 5, 6, 7]);
  for (const kind of ['native-registration', 'native-version', 'native-association', 'session-attach', 'session-detach-settled', 'unobserved-handoff-start', 'unobserved-handoff-end', 'owned-target-association', 'actual-emitted-old-deferred-graph', 'owned-storage-observation']) assert(result.records.some(record => record.kind === kind), kind);
  assert.equal(collector.pending.length, 0);
  assert(result.bytes < 2 * 1024 * 1024);
  writeCapacityEvidence('UNIT_ONLY Step1–7 record-family capacity', JSON.stringify({ records: result.records.length, serializedRecordBytes, serializedFinishBytes: Buffer.byteLength(JSON.stringify(result)), cap: 2 * 1024 * 1024, margin: 2 * 1024 * 1024 - result.bytes, genuineWorkboxObservation: false }));
});
