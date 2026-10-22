import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BrowserDriver, NativeCollector, inspectHeaders, compactHttpEvidence } from '../../packages/web/scripts/check-pwa-update.mjs';
import { parseProductionHeaders } from '../../packages/web/scripts/production-headers.mjs';

// Controlled event payloads qualify checker behavior, not Chromium migration.
const origin = 'http://127.0.0.1:12345';
function fixture() {
  const context = new EventEmitter();
  const collector = new NativeCollector(origin);
  const driver = new BrowserDriver(context, collector, { origin, healthy() {}, headerPaths: new Set(['/tools/hash', '/_astro/HashRunner.js']) });
  return { context, collector, driver };
}
function request(worker, pathname = '/_astro/HashRunner.js') {
  return { url: () => origin + pathname, method: () => 'GET', resourceType: () => 'script', serviceWorker: () => worker, failure: () => null };
}

test('UNIT-ONLY worker precache requests are recorded without marking a page runner loaded', () => {
  const { context, collector, driver } = fixture();
  try {
    context.emit('request', request({}));
    assert.equal(driver.requests.has('/_astro/HashRunner.js'), false);
    assert.equal(collector.records.at(-1).payload.initiator, 'service-worker');
    context.emit('request', request(null));
    assert.equal(driver.requests.has('/_astro/HashRunner.js'), true);
    assert.equal(collector.records.at(-1).payload.initiator, 'page');
  } finally { driver.dispose(); }
});

test('UNIT-ONLY redirect responses retain status/location without attempting a body read', async () => {
  const { context, driver } = fixture();
  const redirect = request({}, '/tools/hash');
  let reads = 0;
  try {
    context.emit('request', redirect);
    context.emit('response', {
      url: redirect.url, request: () => redirect, status: () => 301,
      body() { reads++; return Promise.reject(new Error('Response body is unavailable for redirect responses')); },
      headersArray: () => Promise.resolve([{ name: 'location', value: '/tools/hash/' }]),
      fromServiceWorker: () => false,
    });
    await driver.flush();
    assert.equal(reads, 0);
    assert.equal(driver.responses.length, 1);
    assert.equal(driver.responses[0].status, 301);
    assert.equal(driver.responses[0].sha256, null);
    assert.equal(driver.responses[0].initiator, 'service-worker');
    assert.deepEqual(driver.responses[0].rawHeaders, [{ name: 'location', value: '/tools/hash/' }]);
  } finally { driver.dispose(); }
});

test('UNIT-ONLY cached304 responses retain their actual delivered body pin', async () => {
  const { context, driver } = fixture();
  const body = Buffer.from('cached script body');
  const first = request(null);
  const revalidated = request(null);
  let unavailableBodyReads = 0;
  try {
    context.emit('request', first);
    context.emit('response', {
      url: first.url, request: () => first, status: () => 200,
      body: () => Promise.resolve(body), headersArray: () => Promise.resolve([{ name: 'etag', value: '"controlled"' }]),
      fromServiceWorker: () => false,
    });
    await driver.flush();
    context.emit('request', revalidated);
    context.emit('response', {
      url: revalidated.url, request: () => revalidated, status: () => 304,
      body() { unavailableBodyReads++; return Promise.reject(new Error('Response body is unavailable for redirect responses')); }, headersArray: () => Promise.resolve([{ name: 'etag', value: '"controlled"' }]),
      fromServiceWorker: () => false,
    });
    await driver.flush();
    assert.equal(unavailableBodyReads, 0);
    assert.equal(driver.responses[1].status, 304);
    assert.equal(driver.responses[1].sha256, createHash('sha256').update(body).digest('hex'));
    assert.equal(driver.responses[1].bytes, body.length);
    assert.equal(driver.responses[1].bodyObserved, false);
    assert.equal(driver.responses[1].revalidatedFrom, driver.responses[0].id);
  } finally { driver.dispose(); }
});

for (const mode of ['missing-body-pin', 'wrong-etag']) {
  test('UNIT-ONLY304 refuses ' + mode, async () => {
    const { context, driver } = fixture();
    let reads = 0;
    try {
      if (mode === 'wrong-etag') {
        const first = request(null);
        context.emit('request', first);
        context.emit('response', { url: first.url, request: () => first, status: () => 200, body: () => Promise.resolve(Buffer.from('known body')), headersArray: () => Promise.resolve([{ name: 'etag', value: '"first"' }]), fromServiceWorker: () => false });
        await driver.flush();
      }
      const next = request(null);
      context.emit('request', next);
      context.emit('response', { url: next.url, request: () => next, status: () => 304, body() { reads++; return Promise.reject(new Error('unavailable304 body')); }, headersArray: () => Promise.resolve([{ name: 'etag', value: '"other"' }]), fromServiceWorker: () => false });
      await assert.rejects(driver.flush(), /previously observed matching URL\/ETag/);
      assert.equal(reads, 0);
      assert(!driver.responses.some(record => record.status === 304));
    } finally { driver.dispose(); }
  });
}

test('UNIT-ONLY an abandoned outer waiter rejection permits owned cleanup and a terminal record', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wyreup-waiter-control-'));
  const terminal = path.join(directory, 'terminal.json');
  const module = new URL('../../packages/web/scripts/check-pwa-update.mjs', import.meta.url).href;
  const program = `
    import { EventEmitter } from 'node:events';
    import { writeFile } from 'node:fs/promises';
    import { setTimeout as delay } from 'node:timers/promises';
    import { BrowserDriver, NativeCollector } from ${JSON.stringify(module)};
    const collector = new NativeCollector(${JSON.stringify(origin)});
    const driver = new BrowserDriver(new EventEmitter(), collector, { origin: ${JSON.stringify(origin)}, healthy() {} });
    driver.run('armed waiter', () => new Promise((_, reject) => setTimeout(() => reject(new Error('late owned waiter')), 5)));
    try { await driver.run('failed action', () => { throw new Error('action failed'); }); } catch {}
    await delay(30);
    driver.dispose();
    await Promise.allSettled([...driver.pending.values()].map(entry => entry.promise));
    await writeFile(${JSON.stringify(terminal)}, JSON.stringify({ status: 'controlled failure retained', failure: driver.failure?.message, pending: driver.pending.size }), { flag: 'wx' });
  `;
  try {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', chunk => { stderr += chunk; });
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 0, signal: null }, stderr);
    const record = JSON.parse(await readFile(terminal, 'utf8'));
    assert.equal(record.status, 'controlled failure retained');
    assert.equal(record.failure, 'action failed');
    assert.equal(record.pending, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CONTROLLED HTTP missing duplicate worker-scope header cannot pass source-derived inspection', async () => {
  const rules = parseProductionHeaders(await readFile(new URL('../../packages/web/public/_headers', import.meta.url), 'utf8'));
  const body = Buffer.from('controlled artifact');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const snapshot = { name: 'old', rules, files: new Map(['sw.js', 'registerSW.js', 'manifest.webmanifest'].map(file => [file, { sha256 }])) };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, origin).pathname;
    const fields = rules.filter(rule => rule.path.endsWith('*') ? pathname.startsWith(rule.path.slice(0, -1)) : rule.path === pathname).flatMap(rule => rule.fields);
    // Actual source requires two occurrences on /sw.js; deliberately remove one.
    const damaged = pathname === '/sw.js' ? fields.filter(([name], index) => name !== 'service-worker-allowed' || index === fields.findIndex(([key]) => key === name)) : fields;
    const raw = damaged.flat();
    if (!damaged.some(([name]) => name === 'content-type')) raw.push('content-type', 'text/javascript; charset=utf-8');
    raw.push('etag', '"' + sha256 + '"', 'content-length', String(body.length));
    response.writeHead(200, raw).end(body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const actualOrigin = 'http://127.0.0.1:' + server.address().port;
  const adapter = { origin: actualOrigin, selectBuild() {}, healthy() {} };
  try {
    await assert.rejects(inspectHeaders(adapter, snapshot, new NativeCollector(actualOrigin)), /source-derived|header/i);
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('UNIT-ONLY full three-install traffic with actual CSP fits the fixed cap using explicit header retention', async () => {
  const rules = parseProductionHeaders(await readFile(new URL('../../packages/web/public/_headers', import.meta.url), 'utf8'));
  const raw = ['content-type', 'text/html; charset=utf-8', 'etag', '"' + 'a'.repeat(64) + '"', ...rules[0].fields.flat(), 'content-length', '15000'];
  const browserHeaders = [];
  for (let index = 0; index < raw.length; index += 2) browserHeaders.push({ name: raw[index], value: raw[index + 1] });
  const collector = new NativeCollector(origin);
  const retained = new Set(['/sw.js', '/registerSW.js', '/manifest.webmanifest', '/app-update', '/app-update/', '/tools/base64', '/tools/base64/', '/tools/hash', '/tools/hash/', ...Array.from({ length: 20 }, (_, index) => '/_astro/deferred-' + index + '.js'), ...Array.from({ length: 4 }, (_, index) => '/_astro/recovery-' + index + '.js')]);
  const driver = new BrowserDriver(new EventEmitter(), collector, { origin, healthy() {}, headerPaths: retained });
  for (const build of ['old', 'new', 'next']) {
    // Representative redirect/selected-script stress trace, not a Workbox observation.
    for (let index = 0; index < 543; index++) {
      const url = index === 0 ? '/sw.js' : index <= 20 ? '/_astro/deferred-' + (index - 1) + '.js' : index <= 24 ? '/_astro/recovery-' + (index - 21) + '.js' : '/tools/example-' + index + '/';
      if (index < 327) {
        const redirect = '/tools/redirect-' + index;
        collector.add('server-inbound', { cursor: collector.sequence, time: Date.now(), build, method: 'GET', url: redirect });
        driver.recordTraffic('browser-request', { id: index + 1000, url: origin + redirect, method: 'GET', resourceType: 'fetch', initiator: 'service-worker' });
        driver.recordTraffic('browser-response', compactHttpEvidence({ id: index + 1000, url: origin + redirect, status: 301, sha256: null, bytes: 0, initiator: 'service-worker', fromServiceWorker: false, rawHeaders: [{ name: 'location', value: redirect + '/' }], capturedStep: 1 }, retained));
      }
      const hit = { cursor: collector.sequence, time: Date.now(), build, method: 'GET', url };
      collector.add('server-inbound', hit);
      collector.add('server-response', compactHttpEvidence({ ...hit, status: 200, artifact: url.slice(1), sha256: 'a'.repeat(64), rawHeaders: raw }, retained));
      driver.recordTraffic('browser-request', { id: index, url: origin + url, method: 'GET', resourceType: 'fetch', initiator: 'service-worker' });
      driver.recordTraffic('browser-response', compactHttpEvidence({ id: index, url: origin + url, status: 200, sha256: 'a'.repeat(64), bytes: 15000, initiator: 'service-worker', fromServiceWorker: false, rawHeaders: browserHeaders, capturedStep: 1 }, retained));
    }
  }
  await driver.flush();
  driver.dispose();
  assert(collector.bytes < 2 * 1024 * 1024);
  assert.equal(driver.workerTraffic.requests, 2535);
  assert.equal(driver.workerTraffic.responses, 2535);
  assert.equal(driver.workerTraffic.redirects, 981);
  const responseRecords = collector.records.filter(record => record.kind === 'server-response' || record.kind === 'browser-response');
  assert.equal(responseRecords.filter(record => record.payload.headersRetained).length, 150);
  assert(responseRecords.filter(record => !record.payload.headersRetained).every(record => !Object.hasOwn(record.payload, 'rawHeaders') && record.payload.sha256 === 'a'.repeat(64)));
  assert(responseRecords.filter(record => record.payload.headersRetained).every(record => Array.isArray(record.payload.rawHeaders)));
});

for (const pending of ['body', 'headers', 'headers-and-body']) {
  test('UNIT_ONLY delayed earlier200 ' + pending + ' joins matching304 without reading304 body', async () => {
    const { context, driver } = fixture();
    const bytes = Buffer.from('UNIT_ONLY actual earlier response bytes');
    const first = request(null), next = request(null);
    const headers = [{ name: 'etag', value: '"unit-delayed"' }];
    let releaseHeaders, releaseBody, reads304 = 0;
    const headerGate = new Promise(resolve => { releaseHeaders = resolve; });
    const bodyGate = new Promise(resolve => { releaseBody = resolve; });
    try {
      context.emit('request', first);
      context.emit('response', {
        url: first.url, request: () => first, status: () => 200,
        headersArray: () => pending === 'body' ? Promise.resolve(headers) : headerGate,
        body: () => pending === 'headers' ? Promise.resolve(bytes) : bodyGate,
        fromServiceWorker: () => false,
      });
      await new Promise(resolve => setImmediate(resolve));
      context.emit('request', next);
      context.emit('response', {
        url: next.url, request: () => next, status: () => 304,
        headersArray: () => Promise.resolve(headers),
        body() { reads304++; throw new Error('UNIT_ONLY304 body must never be fetched'); },
        fromServiceWorker: () => false,
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reads304, 0);
      assert.equal(driver.responses.some(record => record.status === 304), false);
      releaseHeaders(headers);
      releaseBody(bytes);
      await driver.flush();
      assert.equal(driver.failure, null);
      assert.equal(reads304, 0);
      assert.equal(driver.pending.size, 0);
      assert.deepEqual(driver.responses.map(record => [record.id, record.status]), [[1, 200], [2, 304]]);
      assert.equal(driver.responses[0].bodyObserved, true);
      assert.equal(driver.responses[1].bodyObserved, false);
      assert.equal(driver.responses[1].revalidatedFrom, 1);
      assert.equal(driver.responses[1].bytes, bytes.length);
      assert.equal(driver.responses[1].sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(driver.responses[1].rawHeaders[0].value, '"unit-delayed"');
    } finally {
      releaseHeaders(headers);
      releaseBody(bytes);
      await Promise.allSettled([...driver.pending.values()].map(entry => entry.promise));
      driver.dispose();
    }
  });
}

for (const refusal of ['later200-is-not-prior', 'pending-wrong-etag', 'pending-other-url']) {
  test('UNIT_ONLY304 refuses ' + refusal + ' with delayed event ordering preserved', async () => {
    const { context, driver } = fixture();
    const first = request(null, refusal === 'pending-other-url' ? '/tools/hash' : '/_astro/HashRunner.js');
    const next = request(null);
    const bytes = Buffer.from('UNIT_ONLY real response fixture');
    let releaseBody, reads304 = 0;
    const bodyGate = new Promise(resolve => { releaseBody = resolve; });
    const emit200 = () => {
      context.emit('request', first);
      context.emit('response', { url: first.url, request: () => first, status: () => 200, body: () => bodyGate, headersArray: () => Promise.resolve([{ name: 'etag', value: '"known"' }]), fromServiceWorker: () => false });
    };
    const emit304 = () => {
      context.emit('request', next);
      context.emit('response', { url: next.url, request: () => next, status: () => 304, body() { reads304++; throw new Error('UNIT_ONLY unavailable304 body'); }, headersArray: () => Promise.resolve([{ name: 'etag', value: refusal === 'pending-wrong-etag' ? '"wrong"' : '"known"' }]), fromServiceWorker: () => false });
    };
    try {
      if (refusal !== 'later200-is-not-prior') { emit200(); await new Promise(resolve => setImmediate(resolve)); }
      emit304();
      if (refusal === 'later200-is-not-prior') emit200();
      await new Promise(resolve => setImmediate(resolve));
      releaseBody(bytes);
      await assert.rejects(driver.flush(), /previously observed matching URL\/ETag/);
      assert.equal(reads304, 0);
      assert(!driver.responses.some(record => record.status === 304));
    } finally {
      releaseBody(bytes);
      await Promise.allSettled([...driver.pending.values()].map(entry => entry.promise));
      driver.dispose();
    }
  });
}

test('UNIT_ONLY representative three-install traffic plus Step1–7 native, graph, storage and endpoint families reports2MiB margin', async () => {
  const rules = parseProductionHeaders(await readFile(new URL('../../packages/web/public/_headers', import.meta.url), 'utf8'));
  const raw = ['content-type', 'text/html; charset=utf-8', 'etag', '"' + 'a'.repeat(64) + '"', ...rules[0].fields.flat(), 'content-length', '15000'];
  const browserHeaders = [];
  for (let index = 0; index < raw.length; index += 2) browserHeaders.push({ name: raw[index], value: raw[index + 1] });
  const retained = new Set(['/sw.js', '/registerSW.js', '/manifest.webmanifest', '/app-update', '/app-update/', '/tools/base64', '/tools/base64/', '/tools/hash', '/tools/hash/', ...Array.from({ length: 20 }, (_, index) => '/_astro/deferred-' + index + '.js'), ...Array.from({ length: 4 }, (_, index) => '/_astro/recovery-' + index + '.js')]);
  const collector = new NativeCollector(origin);
  const driver = new BrowserDriver(new EventEmitter(), collector, { origin, healthy() {}, headerPaths: retained });
  const graphNodes = Array.from({ length: 64 }, (_, index) => ({ pathname: '/_astro/unit-graph-' + index + '.js', sha256: 'a'.repeat(64), staticImports: index ? ['/_astro/unit-graph-' + (index - 1) + '.js'] : [], dynamicImports: [] }));
  let token;
  try {
    for (let step = 1; step <= 7; step++) {
      collector.beginStep(step);
      if (step === 1) {
        token = collector.startSession('UNIT_ONLY-A');
        collector.acknowledged(token);
        collector.envelope(token, 'version', { versions: [{ versionId: 'old', registrationId: 'root', scriptURL: origin + '/sw.js', runningStatus: 'running', status: 'activated', controlledClients: ['UNIT_ONLY-A', 'UNIT_ONLY-B'] }] });
        collector.envelope(token, 'registration', { registrations: [{ registrationId: 'root', scopeURL: origin + '/', isDeleted: false }] });
      }
      if (step === 6) {
        collector.beginGap(token, 'UNIT_ONLY authored drain/handoff');
        collector.endSession(token);
        token = collector.startSession('UNIT_ONLY-C');
        collector.acknowledged(token);
        collector.endGap('UNIT_ONLY authored new association');
      }
      collector.envelope(token, 'registration', { registrations: [{ registrationId: 'root', scopeURL: origin + '/', isDeleted: false }] });
      collector.envelope(token, 'version', { versions: [{ versionId: step < 6 ? 'old' : 'new', registrationId: 'root', scriptURL: origin + '/sw.js', runningStatus: 'running', status: 'activated', controlledClients: step < 6 ? ['UNIT_ONLY-A', 'UNIT_ONLY-B'] : ['UNIT_ONLY-C'] }] });
      if (step === 2 || step === 7) collector.envelope(token, 'version', { versions: [{ versionId: step === 2 ? 'new' : 'next', registrationId: 'root', scriptURL: origin + '/sw.js', runningStatus: 'stopped', status: 'installed', controlledClients: [] }] });
      collector.add('owned-target-association', { name: step < 6 ? 'A' : 'C', marker: 'UNIT_ONLY owned marker', targetId: token.targetId });
      collector.add('owned-storage-observation', { localStorage: 'UNIT_ONLY sentinel', indexedDB: 'UNIT_ONLY sentinel' });
      if (step === 1) {
        collector.add('base64-fixture', { classification: 'UNIT_ONLY authored bytes', bytes: 2, sha256: 'a'.repeat(64) });
        collector.add('base64-result', { classification: 'UNIT_ONLY authored result', bytes: 3, value: '-_8' });
        collector.add('production-header-observation', { classification: 'UNIT_ONLY actual source header DATA; no network', path: '/sw.js', rawHeaders: raw });
        collector.add('app-schema-storage-qualification', { shareIntake: 'UNRUN', runtimeEntries: 'UNRUN' });
      }
      if (step === 2) collector.add('before-visibility-gap', { classification: 'UNIT_ONLY authored shape', ordinaryReloadAndQueryNavigation: true, waitingInstructionsAbsent: true, forceReload: 'UNRUN' });
      if (step === 3) {
        collector.add('actual-emitted-old-deferred-graph', { classification: 'UNIT_ONLY authored graph shape; not emitted code', route: '/tools/hash/', selected: graphNodes[63].pathname, nodes: graphNodes, dependencies: graphNodes.map(node => node.pathname) });
        collector.add('retained-cache-qualification', { classification: 'UNIT_ONLY authored shape', selectedURLs: graphNodes.slice(0, 20).map(node => ({ pathname: node.pathname, oldOnly: true, sha256: node.sha256 })), zeroInboundRequests: true, mounted: true });
      }
      if (step === 4) collector.add('offline-recovery-observation', { classification: 'UNIT_ONLY authored shape', status: 200, recoveryUnavailable: true, actualHeading: "You're offline." });
      if (step === 6) collector.add('new-offline-observations', { classification: 'UNIT_ONLY authored shape', cachedBase64Bytes: '-_8', fallbackHeading: "You're offline." });
      if (step === 7) collector.add('next-waiting-endpoint', { classification: 'UNIT_ONLY authored shape', activeVersionId: 'new', waitingVersionId: 'next', ownedControlledTabs: ['UNIT_ONLY-C', 'UNIT_ONLY-D', 'UNIT_ONLY-E'], newlyWaitingAndAlreadyWaiting: true });
      const build = ({ 1: 'old', 2: 'new', 7: 'next' })[step];
      if (!build) continue;
      collector.add('selected-build', { build, classification: 'UNIT_ONLY authored traffic, no server/Workbox' });
      for (let index = 0; index < 543; index++) {
        const url = index === 0 ? '/sw.js' : index <= 20 ? '/_astro/deferred-' + (index - 1) + '.js' : index <= 24 ? '/_astro/recovery-' + (index - 21) + '.js' : '/tools/example-' + index + '/';
        if (index < 327) {
          const redirect = '/tools/redirect-' + index;
          collector.add('server-inbound', { cursor: collector.sequence, time: Date.now(), build, method: 'GET', url: redirect });
          driver.recordTraffic('browser-request', { id: index + 1000, url: origin + redirect, method: 'GET', resourceType: 'fetch', initiator: 'service-worker' });
          driver.recordTraffic('browser-response', compactHttpEvidence({ id: index + 1000, url: origin + redirect, status: 301, sha256: null, bytes: 0, initiator: 'service-worker', fromServiceWorker: false, rawHeaders: [{ name: 'location', value: redirect + '/' }], capturedStep: step }, retained));
        }
        const hit = { cursor: collector.sequence, time: Date.now(), build, method: 'GET', url };
        collector.add('server-inbound', hit);
        collector.add('server-response', compactHttpEvidence({ ...hit, status: 200, artifact: url.slice(1), sha256: 'a'.repeat(64), rawHeaders: raw }, retained));
        driver.recordTraffic('browser-request', { id: index, url: origin + url, method: 'GET', resourceType: 'fetch', initiator: 'service-worker' });
        driver.recordTraffic('browser-response', compactHttpEvidence({ id: index, url: origin + url, status: 200, sha256: 'a'.repeat(64), bytes: 15000, initiator: 'service-worker', fromServiceWorker: false, rawHeaders: browserHeaders, capturedStep: step }, retained));
      }
    }
    await driver.flush();
    const result = collector.finish(), cap = 2 * 1024 * 1024;
    const serializedRecordBytes = result.records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0);
    const serializedFinishBytes = Buffer.byteLength(JSON.stringify(result));
    assert.equal(result.bytes, serializedRecordBytes);
    assert(result.bytes < cap);
    assert(serializedFinishBytes < cap);
    assert.deepEqual(result.records.filter(record => record.kind === 'step-start').map(record => record.payload.ordinal), [1, 2, 3, 4, 5, 6, 7]);
    for (const kind of ['native-registration', 'native-version', 'native-association', 'session-detach-settled', 'unobserved-handoff-start', 'unobserved-handoff-end', 'owned-target-association', 'owned-storage-observation', 'actual-emitted-old-deferred-graph', 'retained-cache-qualification', 'base64-fixture', 'base64-result', 'production-header-observation', 'app-schema-storage-qualification', 'before-visibility-gap', 'offline-recovery-observation', 'new-offline-observations', 'next-waiting-endpoint', 'selected-build', 'server-inbound', 'server-response', 'browser-request', 'browser-response', 'opaque-worker-traffic-summary']) assert(result.records.some(record => record.kind === kind), kind);
    assert.equal(driver.workerTraffic.requests, 2535);
    assert.equal(driver.workerTraffic.responses, 2535);
    assert.equal(driver.workerTraffic.redirects, 981);
    console.info('UNIT_ONLY representative full record-family capacity', JSON.stringify({ steps: 7, installs: 3, records: result.records.length, graphNodes: graphNodes.length, serializedRecordBytes, serializedFinishBytes, serializedPrettyFinishBytes: Buffer.byteLength(JSON.stringify(result, null, 2)), cap, recordCapMargin: cap - result.bytes, compactFinishMargin: cap - serializedFinishBytes, genuineWorkboxObservation: false }));
  } finally { driver.dispose(); }
});
