import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat, lstat, readlink, mkdir, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { parseProductionHeaders, parseProductionRedirects } from './production-headers.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const executeFile = promisify(execFile);
const MAX_BYTES = 2 * 1024 * 1024;
const DESCRIPTION = 'File tools and calculators. Check each tool for where it processes input and what it needs offline.';
const WAITING = 'An update is ready. Finish your work and download your results. Close all Wyreup tabs and windows, including the recovery tab, then reopen Wyreup to use it.';
const headerEvidenceRoutes = ['/sw.js', '/registerSW.js', '/manifest.webmanifest', '/app-update', '/app-update/', '/tools/base64', '/tools/base64/', '/tools/hash', '/tools/hash/'];

export function compactHttpEvidence(record, retainedPaths = new Set(headerEvidenceRoutes)) {
  const pathname = new URL(record.url, 'http://fixture.invalid').pathname;
  if (retainedPaths.has(pathname)) return { ...record, headersRetained: true };
  const { rawHeaders: _rawHeaders, ...compact } = record;
  return { ...compact, headersRetained: false };
}
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.map': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' };

/**
 * Native payload fields used by the collector; additional CDP fields stay opaque.
 * @typedef {{registrationId:string,scopeURL:string,isDeleted:boolean}} NativeRegistration
 * @typedef {'new'|'installing'|'installed'|'activating'|'activated'|'redundant'} NativeVersionStatus
 * @typedef {{versionId:string,registrationId:string,scriptURL:string,runningStatus:'stopped'|'starting'|'running'|'stopping',status:NativeVersionStatus,controlledClients?:string[]} & Record<string,unknown>} NativeVersion
 * @typedef {{ordinal:number,targetId:string,valid:boolean,attachedAt:number,startSequence:number}} CollectorSession
 * @typedef {{ordinal:number,envelopes:number}} CollectorStep
 * @typedef {number|'setup'|'gap-boundary'} CollectorStepLabel
 * @typedef {{sequence:number,time:number,step:CollectorStepLabel,session:number|null}} CollectorRecordBase
 * @typedef {'step-start'|'session-attach'|'ServiceWorker.enable-ack'|'unobserved-handoff-start'|'session-detach-settled'|'unobserved-handoff-end'|'native-association'|'server-inbound'|'server-response'|'selected-build'|'browser-request'|'browser-response'|'browser-request-failed'|'opaque-worker-traffic-summary'|'owned-target-association'|'base64-fixture'|'base64-result'|'owned-storage-observation'|'tool-document-pin'|'production-header-observation'|'actual-emitted-old-deferred-graph'|'app-schema-storage-qualification'|'before-visibility-gap'|'retained-cache-qualification'|'offline-recovery-observation'|'new-offline-observations'|'next-waiting-endpoint'|'first-install-observation'|'limit-fixture'|'one-more-byte'} OtherCollectorKind
 * @typedef {{'native-registration':{registrations:NativeRegistration[]},'native-version':{versions:NativeVersion[],unassociatedCount:number}} & Record<OtherCollectorKind,unknown>} CollectorPayloads
 */
/**
 * @template {keyof CollectorPayloads} [Kind=keyof CollectorPayloads]
 * @typedef {{[Key in Kind]:CollectorRecordBase & {kind:Key,payload:CollectorPayloads[Key]}}[Kind]} CollectorRecord
 */

// UNIT-ONLY controls import this exact collector; they do not simulate browser acceptance.
export class NativeCollector {
  /** @param {string} origin */
  constructor(origin) {
    this.scope = origin + '/';
    /** @type {CollectorRecord[]} */
    this.records = [];
    this.bytes = 0;
    this.sequence = 0;
    /** @type {CollectorStep|null} */
    this.step = null;
    /** @type {CollectorSession|null} */
    this.active = null;
    this.ordinal = 0;
    /** @type {Map<string,boolean>} */
    this.registrations = new Map();
    /** @type {Set<string>} */
    this.deletedRegistrations = new Set();
    /** @type {Map<string,{version:NativeVersion,sequence:number,session:number|null,step:CollectorStepLabel}>} */
    this.versions = new Map();
    /** @type {Set<string>} */
    this.versionIds = new Set();
    /** @type {Array<{version:NativeVersion,record:CollectorRecord<'native-version'>}>} */
    this.pending = [];
    /** @type {Error|null} */
    this.failure = null;
    this.unrelated = 0;
    this.boundary = false;
  }
  /** @param {string} message @returns {never} */
  refuse(message) {
    this.failure ??= new Error(message);
    throw this.failure;
  }
  healthy() { if (this.failure) throw this.failure; }
  /**
   * @template {keyof CollectorPayloads} Kind
   * @param {Kind} kind
   * @param {CollectorPayloads[Kind]} payload
   * @param {CollectorSession|null} [owner]
   * @param {CollectorStepLabel} [owningStep]
   * @returns {CollectorRecord<Kind>}
   */
  add(kind, payload, owner = this.active, owningStep = this.boundary ? 'gap-boundary' : this.step?.ordinal ?? 'setup') {
    this.healthy();
    const record = { sequence: this.sequence + 1, time: Date.now(), step: owningStep, session: owner?.ordinal ?? null, kind, payload };
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (this.bytes + bytes > MAX_BYTES) this.refuse('Collector serialized ledger exceeds 2MiB.');
    this.bytes += bytes;
    this.sequence++;
    this.records.push(record);
    return record;
  }
  /** @param {number} ordinal */
  beginStep(ordinal) {
    this.healthy();
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 7 || ordinal !== (this.step?.ordinal ?? 0) + 1) this.refuse('Non-sequential acceptance step.');
    this.flushAssociations();
    this.step = { ordinal, envelopes: 0 };
    this.boundary = false;
    this.add('step-start', { ordinal });
  }
  flushAssociations() { if (this.pending.length) this.refuse('Unresolved native registration/version association.'); }
  /** @param {string} targetId @returns {CollectorSession} */
  startSession(targetId) {
    this.healthy();
    if (this.active) this.refuse('A second concurrently registered native stream is forbidden.');
    const token = { ordinal: ++this.ordinal, targetId, valid: true, attachedAt: Date.now(), startSequence: this.sequence };
    this.active = token;
    this.add('session-attach', { targetId, ordinal: token.ordinal }, token);
    return token;
  }
  /** @param {CollectorSession} token */
  acknowledged(token) { assert.equal(token, this.active); this.add('ServiceWorker.enable-ack', {}, token); }
  /** @param {CollectorSession} token @param {string} reason */
  beginGap(token, reason) {
    assert.equal(token, this.active);
    this.flushAssociations();
    this.boundary = true;
    this.add('unobserved-handoff-start', { reason, lastSnapshot: [...this.versions.values()].map((entry) => entry.version) }, token);
  }
  /** @param {CollectorSession} token */
  endSession(token) {
    assert.equal(token, this.active);
    this.add('session-detach-settled', { targetId: token.targetId }, token);
    token.valid = false;
    this.active = null;
  }
  /** @param {string} reason */
  endGap(reason) { this.add('unobserved-handoff-end', { reason }); this.boundary = false; }
  /**
   * @overload
   * @param {CollectorSession} token
   * @param {'registration'} kind
   * @param {{registrations:NativeRegistration[]}} payload
   * @returns {void}
   */
  /**
   * @overload
   * @param {CollectorSession} token
   * @param {'version'} kind
   * @param {{versions:NativeVersion[]}} payload
   * @returns {void}
   */
  /** @param {CollectorSession} token @param {'registration'|'version'} kind @param {{registrations:NativeRegistration[]}|{versions:NativeVersion[]}} payload */
  envelope(token, kind, payload) {
    this.healthy();
    if (token !== this.active || !token.valid) {
      // Old callbacks never enter another session or step, even after handoff.
      this.refuse('Late callback from a detached native stream.');
    }
    const registrations = kind === 'registration' ? payload.registrations : null;
    const versions = kind === 'version' ? payload.versions : null;
    if (!Array.isArray(registrations ?? versions)) this.refuse('Invalid native envelope.');
    const trusted = [];
    const unresolved = [];
    if (registrations) {
      for (const registration of registrations) {
        const root = registration.scopeURL === this.scope;
        this.registrations.set(registration.registrationId, root);
        if (registration.isDeleted) this.deletedRegistrations.add(registration.registrationId);
        else this.deletedRegistrations.delete(registration.registrationId);
        if (root) trusted.push(registration);
        else this.unrelated++;
      }
    } else {
      for (const version of versions) {
        const association = this.registrations.get(version.registrationId);
        if (association === true && !this.deletedRegistrations.has(version.registrationId)) trusted.push(version);
        else if (association === undefined && !this.deletedRegistrations.has(version.registrationId)) unresolved.push(version);
        else this.unrelated++;
      }
    }
    if (registrations) {
      this.pending = this.pending.filter((item) => {
        if (this.registrations.get(item.version.registrationId) === false || this.deletedRegistrations.has(item.version.registrationId)) {
          // Discard known foreign/deleted payloads without refunding their raw byte charge.
          this.unrelated++;
          return false;
        }
        return true;
      });
    }
    if (!trusted.length && !unresolved.length) return;
    if (!this.step) this.refuse('Native collection outside a numbered step.');
    if (this.step.envelopes >= 256) this.refuse('Native event envelope cap 256 exceeded for this step.');
    const prospective = new Set(this.versionIds);
    for (const version of trusted) if (versions) prospective.add(version.versionId);
    if (registrations) for (const item of this.pending) if (this.registrations.get(item.version.registrationId) === true) prospective.add(item.version.versionId);
    if (prospective.size > 8) this.refuse('Relevant native version cap 8 exceeded.');
    this.step.envelopes++;
    const record = this.add('native-' + kind, registrations ? { registrations: trusted } : { versions: trusted, unassociatedCount: unresolved.length }, token);
    for (const version of trusted) if (versions) this.acceptVersion(version, record);
    for (const version of unresolved) {
      const charged = Buffer.byteLength(JSON.stringify(version));
      if (this.bytes + charged > MAX_BYTES) this.refuse('Collector serialized ledger exceeds 2MiB.');
      this.bytes += charged;
      this.pending.push({ version, record });
    }
    if (registrations) {
      const pending = this.pending;
      this.pending = [];
      for (const item of pending) {
        const association = this.registrations.get(item.version.registrationId);
        if (association === true) {
          item.record.payload.versions.push(item.version);
          this.acceptVersion(item.version, item.record);
          this.add('native-association', { registrationId: item.version.registrationId, versionId: item.version.versionId, nativeSequence: item.record.sequence }, token);
        } else if (association === undefined) this.pending.push(item);
        else {
          // A foreign payload cannot remain in exported records. Its charged bytes stay charged.
          this.unrelated++;
        }
      }
    }
  }
  /** @param {NativeVersion} version @param {CollectorRecord<'native-version'>} record */
  acceptVersion(version, record) {
    if (!this.versionIds.has(version.versionId) && this.versionIds.size >= 8) this.refuse('Relevant native version cap 8 exceeded.');
    this.versionIds.add(version.versionId);
    this.versions.set(version.versionId, { version, sequence: record.sequence, session: record.session, step: record.step });
  }
  /** @param {string[]} targetIds @param {NativeVersionStatus} status @param {number} after @param {string} [expectedId] @returns {NativeVersion|null} */
  endpoint(targetIds, status, after, expectedId) {
    this.healthy();
    this.flushAssociations();
    const matches = [...this.versions.values()].filter((entry) => !this.deletedRegistrations.has(entry.version.registrationId) && entry.sequence > after && entry.session === this.active?.ordinal && entry.version.status === status && (!expectedId || entry.version.versionId === expectedId) && targetIds.every((id) => entry.version.controlledClients?.includes(id)));
    if (matches.length !== 1) return null;
    return matches[0].version;
  }
  /** @param {number} after @param {string} activeId @returns {NativeVersion|null} */
  waiting(after, activeId) {
    this.healthy();
    this.flushAssociations();
    const entries = [...this.versions.values()].filter((entry) => entry.sequence > after && entry.session === this.active?.ordinal && entry.version.status === 'installed' && entry.version.versionId !== activeId);
    return entries.length === 1 ? entries[0].version : null;
  }
  finish() { this.healthy(); this.flushAssociations(); return { bytes: this.bytes, unrelatedOriginCount: this.unrelated, records: this.records }; }
}

/** @param {string} root @returns {Promise<Array<{path:string,bytes:number,sha256:string}>>} */
export async function inventory(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile()) {
        const bytes = await readFile(filename);
        result.push({ path: path.relative(root, filename).split(path.sep).join('/'), bytes: bytes.length, sha256: sha256(bytes) });
      } else throw new Error('Pinned input contains a symlink or special file.');
    }
  }
  await walk(root);
  result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return result;
}

// The installed workbox-build injectManifest writes a unique stable-JSON array.
// This extractor accepts only that emitted grammar; it never evaluates worker code.
/** @param {string} worker */
export function extractManifest(worker) {
  if (Buffer.byteLength(worker) > 8 * 1024 * 1024 || worker.includes('self.__WB_MANIFEST')) throw new Error('Unsupported worker manifest input.');
  const candidates = [];
  const startPattern = /\[\{"(?:integrity|revision|url)":/g;
  for (const match of worker.matchAll(startPattern)) {
    let quote = false;
    let escaped = false;
    let depth = 0;
    let end = -1;
    for (let index = match.index; index < worker.length; index++) {
      const char = worker[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quote = false;
      } else if (char === '"') quote = true;
      else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') {
        depth--;
        if (depth === 0) { end = index + 1; break; }
      }
    }
    if (end < 0) continue;
    let entries;
    try { entries = JSON.parse(worker.slice(match.index, end)); } catch { continue; }
    if (!Array.isArray(entries) || !entries.length || entries.some((entry) => !entry || typeof entry.url !== 'string' || !Object.hasOwn(entry, 'revision') || (entry.revision !== null && typeof entry.revision !== 'string') || Object.keys(entry).some((key) => !['url', 'revision', 'integrity'].includes(key)))) continue;
    if (entries.length > 10000) throw new Error('Precache manifest entry limit.');
    candidates.push({ start: match.index, end, entries, sha256: sha256(worker.slice(match.index, end)) });
  }
  if (candidates.length !== 1) throw new Error('Worker does not have one unambiguous injected JSON precache manifest.');
  const manifest = candidates[0];
  const paths = manifest.entries.map((entry) => {
    const url = new URL(entry.url, 'http://fixture.invalid/');
    if (url.origin !== 'http://fixture.invalid' || url.hash || url.username || url.password) throw new Error('Unsupported precache URL.');
    return url.pathname;
  });
  for (const recovery of ['/app-update', '/app-update/', '/app-update/index.html', '/app-update.html']) assert(!paths.includes(recovery), 'Recovery alias appears in actual injected manifest: ' + recovery);
  return { ...manifest, paths };
}

async function serveSnapshots(snapshots, collector) {
  const headerPaths = new Set([...headerEvidenceRoutes, ...Object.values(snapshots).flatMap((snapshot) => snapshot.recoveryScripts)]);
  let selected = snapshots.old;
  let closed = false;
  const connections = new Set();
  const pending = new Set();
  const hits = [];
  let serverFailure;
  async function file(snapshot, pathname) {
    const candidate = path.resolve(snapshot.root, '.' + pathname);
    if (!inside(snapshot.root, candidate)) return null;
    try {
      const actual = await realpath(candidate);
      if (!inside(snapshot.root, actual) || !(await stat(actual)).isFile()) return null;
      const relative = path.relative(snapshot.root, actual).split(path.sep).join('/');
      if (!snapshot.files.has(relative)) throw new Error('Unpinned served artifact.');
      return { actual, relative };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
  }
  const server = createServer((request, response) => {
    if (serverFailure) { response.writeHead(500).end('Owned acceptance server refused further collection.'); return; }
    const snapshot = selected;
    const hit = { cursor: hits.length, time: Date.now(), build: snapshot.name, method: request.method, url: request.url };
    try { collector?.add('server-inbound', { ...hit }); }
    catch (error) { serverFailure ??= error; response.writeHead(500).end('Owned acceptance server refused further collection.'); return; }
    hits.push(hit);
    const operation = (async () => {
      if (closed) throw new Error('Owned server closed.');
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
      const target = request.url ?? '/';
      const badChars = (value) => [...value].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127);
      if (!target.startsWith('/') || target.startsWith('//') || badChars(target)) { response.writeHead(400).end(); return; }
      const url = new URL(target, 'http://127.0.0.1');
      let pathname;
      try { pathname = decodeURIComponent(target.split('?')[0]); } catch { response.writeHead(400).end(); return; }
      if (pathname.includes('\\') || badChars(pathname) || pathname.split('/').some((part) => part === '.' || part === '..')) { response.writeHead(400).end(); return; }
      const explicit = snapshot.redirects.find((rule) => rule.from === pathname);
      if (explicit) { response.writeHead(explicit.status, { location: explicit.to + url.search }).end(); return; }
      const redirect = (location) => response.writeHead(301, { location: location + url.search }).end();
      if (pathname.endsWith('/index.html') && await file(snapshot, pathname)) { redirect(pathname.slice(0, -10)); return; }
      if (pathname.endsWith('.html') && await file(snapshot, pathname)) { redirect(pathname.slice(0, -5)); return; }
      let actual;
      if (!pathname.split('/').some((part) => part === '_headers' || part === '_redirects')) {
        actual = await file(snapshot, pathname);
        if (!actual && pathname.endsWith('/')) actual = await file(snapshot, pathname + 'index.html');
        if (!actual && !pathname.endsWith('/') && await file(snapshot, pathname + '/index.html')) { redirect(url.pathname + '/'); return; }
        if (!actual && !pathname.endsWith('/') && !path.extname(pathname)) actual = await file(snapshot, pathname + '.html');
      }
      let status = 200;
      if (!actual) {
        status = 404;
        let directory = pathname.endsWith('/') ? pathname.replace(/\/$/, '') : path.dirname(pathname);
        while (!actual) {
          actual = await file(snapshot, (directory === '/' ? '' : directory) + '/404.html');
          if (directory === '/' || directory === '.') break;
          directory = path.dirname(directory);
        }
      }
      if (!actual) throw new Error('Missing pinned 404 artifact.');
      const bytes = await readFile(actual.actual);
      assert.equal(sha256(bytes), snapshot.files.get(actual.relative).sha256, 'Served artifact drift.');
      const etag = '"' + sha256(bytes) + '"';
      const fields = snapshot.rules.filter((rule) => rule.path.endsWith('*') ? pathname.startsWith(rule.path.slice(0, -1)) : rule.path === pathname).flatMap((rule) => rule.fields);
      const overrides = new Set(fields.map(([name]) => name));
      const raw = [];
      if (!overrides.has('content-type')) raw.push('content-type', mime[path.extname(actual.actual).toLowerCase()] ?? 'application/octet-stream');
      if (!overrides.has('etag')) raw.push('etag', etag);
      for (const [name, value] of fields) raw.push(name, value);
      if (status === 200 && request.headers['if-none-match'] === etag) { response.writeHead(304, raw).end(); return; }
      raw.push('content-length', String(bytes.length));
      const completed = compactHttpEvidence({ ...hit, status, artifact: actual.relative, sha256: sha256(bytes), rawHeaders: raw }, headerPaths);
      collector?.add('server-response', completed);
      Object.assign(hit, completed);
      response.writeHead(status, raw).end(request.method === 'HEAD' ? undefined : bytes);
    })().catch((error) => {
      serverFailure ??= error;
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Owned acceptance server failed.');
    });
    pending.add(operation);
    operation.finally(() => pending.delete(operation));
  });
  server.on('connection', (socket) => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin, hits, pending, headerPaths,
    selectBuild(name) { assert(!closed && snapshots[name]); selected = snapshots[name]; collector?.add('selected-build', { name }); },
    healthy() { if (serverFailure) throw serverFailure; collector?.healthy(); },
    async close() {
      closed = true;
      const stop = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      for (const socket of connections) socket.destroy();
      await bounded(stop, 5000, 'Owned listener close');
      await bounded(Promise.all([...pending]), 5000, 'Owned server readers settle');
      if (serverFailure) throw serverFailure;
    },
  };
}

async function bounded(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' exceeded owned timeout.')), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export class BrowserDriver {
  constructor(context, collector, server) {
    this.context = context;
    this.collector = collector;
    this.server = server;
    this.deadline = Date.now() + 180000;
    this.pending = new Map();
    this.tabs = [];
    this.responses = [];
    this.bodyPins = new Map();
    this.requests = new Set();
    this.disposers = [];
    this.session = null;
    this.failure = null;
    this.requestOrdinal = 0;
    this.requestIds = new WeakMap();
    this.workerTraffic = { requests: 0, responses: 0, redirects: 0, failures: 0 };
    this.workerTrafficHash = createHash('sha256');
    const onRequest = (request) => {
      const requested = new URL(request.url());
      if (!['data:', 'blob:', 'about:'].includes(requested.protocol) && requested.origin !== this.server.origin) { this.failure ??= new Error('External request attempted by owned acceptance page.'); return; }
      if (!this.relevant(request.url())) return;
      const id = ++this.requestOrdinal;
      this.requestIds.set(request, id);
      const initiator = request.serviceWorker() === null ? 'page' : 'service-worker';
      if (initiator === 'page') this.requests.add(new URL(request.url()).pathname);
      try { this.recordTraffic('browser-request', { id, url: request.url(), method: request.method(), resourceType: request.resourceType(), initiator }); }
      catch (error) { this.failure ??= error; }
    };
    const onResponse = (response) => {
      if (!this.relevant(response.url())) return;
      const step = this.collector.step?.ordinal ?? 'setup';
      const session = this.collector.active;
      const status = response.status();
      const requestId = this.requestIds.get(response.request()) ?? null;
      const previousPin = status === 304 ? this.bodyPins.get(response.url()) : null;
      /** @type {{requestId:number|null,promise:Promise<{etag:string,sha256:string,bytes:number,requestId:number|null}|null>|null}|null} */
      const pendingPin = status === 200 ? { requestId, promise: null } : null;
      if (pendingPin) this.bodyPins.set(response.url(), pendingPin);
      const operation = (async () => {
        const rawHeaders = await response.headersArray();
        const etags = rawHeaders.filter((field) => field.name.toLowerCase() === 'etag').map((field) => field.value);
        let bodySha256 = null;
        let bodyBytes = 0;
        let revalidatedFrom = null;
        let bodyObserved = false;
        /** @type {{etag:string,sha256:string,bytes:number,requestId:number|null}|null} */
        let deliveredPin = null;
        if (status === 304) {
          assert(previousPin && Number.isSafeInteger(previousPin.requestId) && previousPin.requestId > 0 && Number.isSafeInteger(requestId) && requestId > previousPin.requestId && previousPin.promise, '304 has no previously observed matching URL/ETag body pin.');
          const previous = await bounded(previousPin.promise, this.remaining(), 'Earlier200 delivered body pin');
          assert(previous && etags.length === 1 && etags[0] === previous.etag, '304 has no previously observed matching URL/ETag body pin.');
          bodySha256 = previous.sha256;
          bodyBytes = previous.bytes;
          revalidatedFrom = previous.requestId;
        } else if (![301, 302, 303, 307, 308].includes(status)) {
          const body = await response.body();
          bodySha256 = sha256(body);
          bodyBytes = body.length;
          bodyObserved = true;
          if (status === 200 && etags.length === 1) deliveredPin = { etag: etags[0], sha256: bodySha256, bytes: bodyBytes, requestId };
        }
        const initiator = response.request().serviceWorker() === null ? 'page' : 'service-worker';
        const record = compactHttpEvidence({ id: this.requestIds.get(response.request()) ?? null, url: response.url(), status, sha256: bodySha256, bytes: bodyBytes, bodyObserved, revalidatedFrom, initiator, fromServiceWorker: response.fromServiceWorker(), rawHeaders, capturedStep: step }, this.server.headerPaths);
        this.responses.push(record);
        this.recordTraffic('browser-response', record, session, step);
        return deliveredPin;
      })();
      if (pendingPin) pendingPin.promise = operation;
      this.own('response-body:' + response.url(), operation).catch((error) => { this.failure ??= error; });
    };
    const onFailed = (request) => {
      if (!this.relevant(request.url())) return;
      try { this.recordTraffic('browser-request-failed', { id: this.requestIds.get(request) ?? null, url: request.url(), initiator: request.serviceWorker() === null ? 'page' : 'service-worker', error: request.failure()?.errorText ?? 'Unavailable' }); }
      catch (error) { this.failure ??= error; }
    };
    context.on('request', onRequest);
    context.on('response', onResponse);
    context.on('requestfailed', onFailed);
    this.disposers.push(() => { context.off('request', onRequest); context.off('response', onResponse); context.off('requestfailed', onFailed); });
  }
  relevant(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === this.server.origin && (!path.extname(parsed.pathname) || /\.(?:html|m?js|webmanifest)$/.test(parsed.pathname));
    } catch { return false; }
  }
  recordTraffic(kind, record, session = this.collector.active, step = this.collector.step?.ordinal ?? 'setup') {
    const retained = this.server.headerPaths ?? new Set(headerEvidenceRoutes);
    if (record.initiator === 'service-worker' && !retained.has(new URL(record.url).pathname)) {
      if (kind === 'browser-request') this.workerTraffic.requests++;
      else if (kind === 'browser-request-failed') this.workerTraffic.failures++;
      else {
        this.workerTraffic.responses++;
        if ([301, 302, 303, 307, 308].includes(record.status)) this.workerTraffic.redirects++;
      }
      this.workerTrafficHash.update(JSON.stringify({ kind, record }) + '\n');
      return;
    }
    this.collector.add(kind, record, session, step);
  }
  healthy() { if (this.failure) throw this.failure; this.collector.healthy(); this.server.healthy(); }
  remaining(cap = 60000) {
    this.healthy();
    const remaining = Math.min(cap, this.deadline - Date.now());
    if (remaining <= 0) throw new Error('Scenario absolute 180000ms acceptance budget expired.');
    return remaining;
  }
  own(label, operation) {
    const key = Symbol(label);
    const observed = Promise.resolve(operation).then((value) => { this.pending.delete(key); return value; }, (error) => { this.pending.delete(key); throw error; });
    this.pending.set(key, { label, promise: observed });
    return observed;
  }
  run(label, action, cap = 60000) {
    const milliseconds = this.remaining(cap);
    const operation = this.own(label, Promise.resolve().then(() => action(milliseconds)));
    const result = bounded(operation, milliseconds, label).then((value) => {
      this.healthy();
      return value;
    });
    void result.catch((error) => { this.failure ??= error; });
    return result;
  }
  async flush() {
    const operations = [...this.pending.values()].map((entry) => entry.promise);
    await this.run('Owned already-started readers settle', () => Promise.all(operations));
    this.collector.add('opaque-worker-traffic-summary', { ...this.workerTraffic, digest: this.workerTrafficHash.copy().digest('hex'), individualRecordsRetained: false });
    this.collector.flushAssociations();
  }
  async wait(label, predicate) {
    const until = Date.now() + this.remaining();
    while (Date.now() < until) {
      this.healthy();
      const result = await this.run(label, predicate, Math.min(60000, until - Date.now()));
      if (result) return result;
      await delay(Math.min(50, Math.max(1, until - Date.now())));
    }
    throw new Error(label + ' did not produce required actual evidence.');
  }
  async newTab(name) {
    const page = await this.run('Create owned tab ' + name, () => this.context.newPage());
    const marker = 'data:text/html,' + encodeURIComponent('<title>wyreup-owned-' + name + '-' + randomUUID() + '</title>');
    await this.run('Owned marker ' + name, (timeout) => page.goto(marker, { timeout }));
    const tab = { name, page, marker, targetId: null };
    this.tabs.push(tab);
    const onError = (error) => { this.failure ??= error; };
    page.on('pageerror', onError);
    this.disposers.push(() => page.off('pageerror', onError));
    if (this.session) await this.identify(tab);
    return tab;
  }
  async identify(tab) {
    assert(this.session && !tab.page.isClosed());
    if (!tab.targetId) {
      const targets = await this.run('Target.getTargets owned marker ' + tab.name, () => this.session.cdp.send('Target.getTargets'));
      const matches = targets.targetInfos.filter((info) => info.type === 'page' && info.url === tab.marker);
      assert.equal(matches.length, 1, 'Owned marker Target identity unavailable or ambiguous.');
      tab.targetId = matches[0].targetId;
    }
    const { targetInfo } = await this.run('Target.getTargetInfo owned ' + tab.name, () => this.session.cdp.send('Target.getTargetInfo', { targetId: tab.targetId }));
    assert.equal(targetInfo.targetId, tab.targetId);
    assert.equal(targetInfo.type, 'page');
    assert.equal(targetInfo.url, tab.page.url(), 'Owned Page URL/TargetID association changed.');
    this.collector.add('owned-target-association', { name: tab.name, targetId: tab.targetId, url: targetInfo.url });
    return tab.targetId;
  }
  async attach(tab) {
    assert.equal(this.session, null, 'Only one designated page session may exist.');
    const cdp = await this.run('Attach owned native session ' + tab.name, () => this.context.newCDPSession(tab.page));
    this.session = { cdp, tab, token: null, listeners: [] };
    await this.identify(tab);
    const { targetInfo } = await this.run('Native owning Target identity', () => cdp.send('Target.getTargetInfo'));
    assert.equal(targetInfo.targetId, tab.targetId);
    const token = this.collector.startSession(tab.targetId);
    this.session.token = token;
    for (const [event, kind] of [['ServiceWorker.workerRegistrationUpdated', 'registration'], ['ServiceWorker.workerVersionUpdated', 'version']]) {
      const handler = (payload) => { try { this.collector.envelope(token, kind, payload); } catch (error) { this.failure ??= error; } };
      cdp.on(event, handler);
      this.session.listeners.push([event, handler]);
    }
    await this.run('ServiceWorker.enable acknowledgement', () => cdp.send('ServiceWorker.enable'));
    this.collector.acknowledged(token);
    return token.startSequence;
  }
  async detach(reason) {
    if (!this.session) return;
    const owned = this.session;
    this.collector.beginGap(owned.token, reason);
    await this.run('ServiceWorker.disable settlement', () => owned.cdp.send('ServiceWorker.disable'));
    for (const [event, handler] of owned.listeners) owned.cdp.off(event, handler);
    await this.run('CDP detach settlement', () => owned.cdp.detach());
    this.collector.endSession(owned.token);
    this.session = null;
  }
  async go(tab, route) {
    const response = await this.run('Navigate owned ' + tab.name + ' ' + route, (timeout) => tab.page.goto(this.server.origin + route, { waitUntil: 'load', timeout }));
    assert(response, 'Actual document response missing.');
    await this.identify(tab);
    return response;
  }
  async nativeState(tab, state) {
    return this.run('Actual root registration ' + state, () => tab.page.evaluate(async (expected) => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration || registration.scope !== location.origin + '/') return false;
      return expected === 'waiting'
        ? registration.active?.state === 'activated' && registration.waiting?.state === 'installed'
        : registration.active?.state === 'activated' && !registration.waiting;
    }, state));
  }
  async controlled(tabs, after, expectedId) {
    for (const tab of tabs) await this.identify(tab);
    return this.wait('Fresh native activated/controllee endpoint', () => this.collector.endpoint(tabs.map((tab) => tab.targetId), 'activated', after, expectedId));
  }
  async waiting(tab, after, activeId) {
    await this.wait('Actual installed waiting worker', () => this.nativeState(tab, 'waiting'));
    return this.wait('Fresh native installed waiting identity', () => this.collector.waiting(after, activeId));
  }
  dispose() { for (const dispose of this.disposers.splice(0)) dispose(); }
}

async function useBase64(driver, tab, evidence, suffix) {
  const page = tab.page;
  const fixture = Buffer.from([0xfb, 0xff]);
  driver.collector.add('base64-fixture', { hex: fixture.toString('hex'), sha256: sha256(fixture), standardOracle: '+/8=', urlSafeOracle: '-_8' });
  const chooser = driver.run('Actual Base64 file chooser', (timeout) => page.waitForEvent('filechooser', { timeout }));
  await driver.run('Open authored file chooser', (timeout) => page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click({ timeout }));
  await driver.run('Choose authored two-byte fixture', () => chooser.then((value) => value.setFiles({ name: 'pwa-bytes.bin', mimeType: 'application/octet-stream', buffer: fixture })));
  await driver.run('Run standard Base64 control', (timeout) => page.getByRole('button', { name: 'Run Base64', exact: true }).click({ timeout }));
  await driver.wait('Complete standard Text result', async () => (await page.getByRole('region', { name: 'Text result', exact: true }).textContent().catch(() => null)) === '+/8=');
  await driver.run('Set actual URL-safe parameter', (timeout) => page.getByLabel('URL-safe', { exact: true }).check({ timeout }));
  await driver.run('Run URL-safe Base64', (timeout) => page.getByRole('button', { name: 'Run Base64 again', exact: true }).click({ timeout }));
  await driver.wait('Complete URL-safe Text result', async () => (await page.getByRole('region', { name: 'Text result', exact: true }).textContent().catch(() => null)) === '-_8');
  const download = driver.run('Actual downloaded UTF8 artifact', (timeout) => page.waitForEvent('download', { timeout }));
  await driver.run('Download authored Base64 result', (timeout) => page.getByRole('button', { name: 'Download', exact: true }).click({ timeout }));
  const artifact = await download;
  const filename = path.join(evidence, 'base64-' + suffix + '.txt');
  await driver.run('Persist actual downloaded artifact', () => artifact.saveAs(filename));
  const bytes = await driver.run('Read actual downloaded bytes', () => readFile(filename));
  assert.deepEqual(bytes, Buffer.from('-_8'));
  driver.collector.add('base64-result', { parameter: true, visibleResult: '-_8', artifact: filename, bytes: [...bytes], sha256: sha256(bytes) });
  return filename;
}

async function workSnapshot(driver, tab) {
  return driver.run('Observe retained authored work', async () => ({
    url: tab.page.url(),
    urlSafe: await tab.page.getByLabel('URL-safe', { exact: true }).isChecked(),
    result: await tab.page.getByRole('region', { name: 'Text result', exact: true }).textContent(),
    fileText: await tab.page.locator('.drop-zone').innerText(),
  }));
}

async function storage(driver, tab, identity, initialize = false) {
  const result = await driver.run('Checker-owned sentinel storage', () => tab.page.evaluate(async ({ key, value, database, initialize }) => {
    if (initialize) localStorage.setItem(key, value);
    if (!initialize) {
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === database)) throw new Error('Owned sentinel database missing.');
    }
    const request = indexedDB.open(database, 1);
    const db = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        if (!initialize) { request.transaction.abort(); return; }
        request.result.createObjectStore('fixture');
      };
      request.onerror = () => reject(new Error('Owned sentinel database unavailable.'));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const record = await new Promise((resolve, reject) => {
        const transaction = db.transaction('fixture', initialize ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('fixture');
        const operation = initialize ? store.put(value, key) : store.get(key);
        let actual;
        operation.onsuccess = () => { actual = initialize ? value : operation.result; };
        transaction.oncomplete = () => resolve(actual);
        transaction.onerror = () => reject(new Error('Owned sentinel transaction failed.'));
        transaction.onabort = () => reject(new Error('Owned sentinel transaction aborted.'));
      });
      return { localStorage: localStorage.getItem(key), indexedDB: record };
    } finally { db.close(); }
  }, { ...identity, initialize }));
  assert.deepEqual(result, { localStorage: identity.value, indexedDB: identity.value });
  driver.collector.add('owned-storage-observation', result);
  return result;
}

async function exactToolDocument(driver, response, snapshot, tool, fromWorker) {
  const candidates = ['tools/' + tool + '/index.html', 'tools/' + tool + '.html'].filter((filename) => snapshot.files.has(filename));
  assert.equal(candidates.length, 1, 'Tool document artifact missing or ambiguous.');
  assert.equal(response.status(), 200);
  assert.equal(response.fromServiceWorker(), fromWorker);
  const body = await driver.run('Actual ' + snapshot.name + ' ' + tool + ' document body', () => response.body());
  assert.equal(sha256(body), snapshot.files.get(candidates[0]).sha256, 'Actual tool document does not match pinned selected build.');
  driver.collector.add('tool-document-pin', { build: snapshot.name, tool, url: response.url(), artifact: candidates[0], sha256: sha256(body), fromServiceWorker: response.fromServiceWorker() });
}

async function recovery(driver, tab, snapshot, oldId) {
  const before = driver.collector.sequence;
  const requestCursor = driver.requestOrdinal;
  const response = await driver.go(tab, '/app-update/');
  assert.equal(response.status(), 200);
  const bytes = await driver.run('Recovery document bytes', () => response.body());
  assert.equal(sha256(bytes), snapshot.files.get(snapshot.recoveryFile).sha256);
  assert(!snapshot.manifest.paths.some((pathname) => pathname.startsWith('/app-update')));
  assert.match(await driver.run('Recovery final actual headers', () => response.headerValue('cache-control')) ?? '', /(?:^|[,\s])no-store(?:[,\s]|$)/i);
  assert(await driver.server.hits.some((hit) => hit.build === snapshot.name && hit.artifact === snapshot.recoveryFile && hit.time >= response.request().timing().startTime));
  await driver.run('Readable recovery h1', (timeout) => tab.page.getByRole('heading', { name: 'Update Wyreup', exact: true }).waitFor({ timeout }));
  assert.match(await driver.run('Recovery readable instructions', () => tab.page.locator('main').innerText()), /including this recovery tab/);
  const status = tab.page.getByRole('region', { name: 'Update check', exact: true }).getByRole('status');
  await driver.wait('Recovery truthful waiting state', async () => (await status.textContent()) === WAITING);
  assert.equal(await driver.run('Recovery public action count', () => tab.page.getByRole('button').count()), 1);
  await driver.run('Recovery actual single Check', (timeout) => tab.page.getByRole('button', { name: 'Check for update', exact: true }).click({ timeout }));
  await driver.wait('Recovery waiting after Check', async () => (await status.textContent()) === WAITING);
  await driver.flush();
  const scripts = snapshot.recoveryScripts;
  for (const script of scripts) assert(driver.responses.some((record) => record.id !== null && record.id > requestCursor && record.initiator === 'page' && new URL(record.url).pathname === script && record.sha256 === snapshot.files.get(script.slice(1))?.sha256), 'Actual recovery status script was not delivered from NEW during this navigation.');
  await driver.controlled([tab], before, oldId);
  return status;
}

function astWalk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) astWalk(child, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const [key, child] of Object.entries(node)) if (!['parent', 'loc', 'range', 'tokens', 'comments'].includes(key) && child && typeof child === 'object') astWalk(child, visit);
}

async function emittedGraph(snapshot, route, parseAst) {
  const relative = route.replace(/^\//, '').replace(/\/$/, '') + '/index.html';
  const fallback = route.replace(/^\//, '').replace(/\/$/, '') + '.html';
  const filename = snapshot.files.has(relative) ? relative : snapshot.files.has(fallback) ? fallback : null;
  assert(filename, 'Actual selected route output missing.');
  const html = await readFile(path.join(snapshot.root, filename), 'utf8');
  assert(Buffer.byteLength(html) <= 2 * 1024 * 1024, 'HTML graph extraction budget.');
  const roots = new Set();
  for (const match of html.matchAll(/(?:component-url|renderer-url|src)="([^"<>]+)"/g)) {
    const url = new URL(match[1], 'http://fixture.invalid' + route);
    if (url.origin === 'http://fixture.invalid' && /\.m?js$/.test(url.pathname)) roots.add(url.pathname);
  }
  const nodes = new Map();
  const queue = [...roots];
  let mappedHash = false;
  const hashRunners = new Set();
  while (queue.length) {
    const pathname = queue.shift();
    if (nodes.has(pathname)) continue;
    assert(nodes.size < 512, 'Emitted graph node cap.');
    const pin = snapshot.files.get(pathname.slice(1));
    assert(pin && pin.bytes <= 8 * 1024 * 1024, 'Graph literal import not in pinned output.');
    const code = await readFile(path.join(snapshot.root, pathname.slice(1)), 'utf8');
    const ast = parseAst(code);
    const staticImports = new Set();
    const dynamicImports = new Set();
    const local = (specifier) => {
      assert(typeof specifier === 'string' && (specifier.startsWith('.') || specifier.startsWith('/')), 'Unsupported bare/external emitted graph import.');
      const url = new URL(specifier, 'http://fixture.invalid' + pathname);
      assert(url.origin === 'http://fixture.invalid' && !url.search && !url.hash && /\.m?js$/.test(url.pathname), 'Unsupported emitted graph URL.');
      return url.pathname;
    };
    astWalk(ast, (node) => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) staticImports.add(local(node.source.value));
      if (node.type === 'ImportExpression' && node.source.type === 'Literal' && typeof node.source.value === 'string' && (node.source.value.startsWith('.') || node.source.value.startsWith('/'))) dynamicImports.add(local(node.source.value));
      if (node.type === 'Property') {
        const key = node.key.name ?? node.key.value;
        if (key === 'hash' && node.value?.value === 'HashRunner') mappedHash = true;
        if (key === 'HashRunner') astWalk(node.value, (child) => {
          if (child.type === 'ImportExpression' && child.source.type === 'Literal') hashRunners.add(local(child.source.value));
        });
      }
    });
    nodes.set(pathname, { pathname, sha256: pin.sha256, staticImports: [...staticImports], dynamicImports: [...dynamicImports] });
    queue.push(...staticImports, ...hashRunners);
  }
  assert(mappedHash && hashRunners.size === 1, 'Actual emitted hash-to-HashRunner association missing or ambiguous.');
  const selected = [...hashRunners][0];
  assert(snapshot.manifest.paths.includes(selected), 'Selected OLD deferred runner absent from OLD precache manifest.');
  const dependencies = new Set([selected]);
  const visit = (pathname) => { for (const child of nodes.get(pathname)?.staticImports ?? []) if (!dependencies.has(child)) { dependencies.add(child); visit(child); } };
  visit(selected);
  return { route, filename, htmlSha256: sha256(html), roots: [...roots], selected, dependencies: [...dependencies], nodes: [...nodes.values()] };
}

function orderedPins(pins, absolute = false) {
  assert(Array.isArray(pins) && pins.length > 0, 'Missing complete pin inventory.');
  let previous = '';
  for (const pin of pins) {
    assert(pin && typeof pin.path === 'string' && pin.path > previous, 'Pins require unique code-unit path ordering.');
    previous = pin.path;
    assert(absolute ? path.isAbsolute(pin.path) : !path.isAbsolute(pin.path) && !pin.path.includes('\\') && !pin.path.split('/').some((part) => !part || part === '.' || part === '..'), 'Invalid pin path.');
    assert(Number.isSafeInteger(pin.bytes) && pin.bytes >= 0 && /^[a-f0-9]{64}$/.test(pin.sha256), 'Invalid pin byte/hash fields.');
  }
}

async function canonicalDirectory(value) {
  assert(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value, 'Expected canonical absolute local directory.');
  assert.equal(await realpath(value), value, 'Fixture/source/evidence root has symlink alias.');
  assert((await lstat(value)).isDirectory(), 'Expected regular directory.');
  return value;
}

async function verifyPin(pin, domains) {
  orderedPins([pin], true);
  assert(domains.some((domain) => inside(domain, pin.path)), 'Pin escaped declared source/build/evidence/dependency domains.');
  assert.equal(await realpath(pin.path), pin.path, 'Pin contains a symlink escape.');
  assert((await lstat(pin.path)).isFile(), 'Pin is not a regular nonsymlink file.');
  const bytes = await readFile(pin.path);
  assert.equal(bytes.length, pin.bytes, 'Pinned size changed: ' + pin.path);
  assert.equal(sha256(bytes), pin.sha256, 'Pinned bytes changed: ' + pin.path);
  return bytes;
}

function nativeClosure(record) {
  assert(Array.isArray(record.argv) && record.argv.length && record.argv.every((arg) => typeof arg === 'string'), 'Missing exact build argv.');
  assert(typeof record.cwd === 'string' && path.isAbsolute(record.cwd), 'Missing canonical command cwd.');
  assert.equal(record.exitCode, 0, 'Build native exit not zero.');
  assert.equal(record.signal, null, 'Build terminated by signal.');
  for (const field of ['exitObserved', 'closeObserved', 'stdoutReaderSettled', 'stderrReaderSettled', 'logWriterSettled']) assert.equal(record[field], true, 'Missing actual native/reader closure: ' + field);
}

async function verifyDependencies(receipt, alreadyQualified = false) {
  assert(Array.isArray(receipt.dependencyIdentities) && receipt.dependencyIdentities.length, 'Missing installed dependency identities.');
  const domains = [];
  const logical = [];
  for (const identity of receipt.dependencyIdentities) {
    assert(typeof identity.name === 'string' && typeof identity.version === 'string' && identity.name && identity.version, 'Invalid dependency identity.');
    orderedPins([{ path: identity.logicalPath, bytes: 0, sha256: '0'.repeat(64) }]);
    await canonicalDirectory(identity.canonicalRoot);
    domains.push(identity.canonicalRoot);
    const link = path.join(receipt.sourceRoot, identity.logicalPath);
    assert.equal(await realpath(link), identity.canonicalRoot, 'Dependency logical link changed.');
    logical.push(link);
    assert.equal(identity.packagePin.path, path.join(identity.canonicalRoot, 'package.json'));
    const metadata = JSON.parse((await verifyPin(identity.packagePin, [identity.canonicalRoot])).toString('utf8'));
    assert.equal(metadata.name, identity.name);
    assert.equal(metadata.version, identity.version);
  }
  assert.deepEqual(receipt.dependencyBefore, receipt.dependencyAfter, 'Installed dependency before/after inventories differ.');
  assert(Array.isArray(receipt.dependencyBefore) && receipt.dependencyBefore.length, 'Missing dependency byte/link inventory.');
  let previous = '';
  for (const entry of receipt.dependencyBefore) {
    assert(typeof entry.path === 'string' && entry.path > previous && path.isAbsolute(entry.path), 'Dependency inventory requires unique code-unit ordered absolute paths.');
    previous = entry.path;
    assert(domains.some((domain) => inside(domain, entry.path)) || logical.includes(entry.path), 'Dependency pin outside declared dependency domain.');
    const info = await lstat(entry.path);
    if (entry.kind === 'file') {
      assert(info.isFile() && !info.isSymbolicLink(), 'Dependency regular file changed kind.');
      if (!alreadyQualified) await verifyPin(entry, domains);
    }
    else {
      assert.equal(entry.kind, 'symlink');
      assert(info.isSymbolicLink(), 'Dependency link lost.');
      assert(typeof entry.target === 'string' && path.isAbsolute(entry.target) && await realpath(entry.path) === entry.target, 'Dependency link target drift.');
      assert(domains.some((domain) => inside(domain, entry.target)), 'Dependency symlink escape.');
      assert(await readlink(entry.path), 'Dependency link absent.');
    }
  }
  // At least the declared manifest and logical link for every identity must be inventoried.
  for (const [index, identity] of receipt.dependencyIdentities.entries()) {
    assert(receipt.dependencyBefore.some((pin) => pin.path === identity.packagePin.path && pin.kind === 'file' && pin.sha256 === identity.packagePin.sha256), 'Dependency inventory omitted identity manifest.');
    const info = await lstat(logical[index]);
    if (info.isSymbolicLink()) assert(receipt.dependencyBefore.some((pin) => pin.path === logical[index] && pin.kind === 'symlink'), 'Dependency inventory omitted logical link.');
  }
  const actual = new Map();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) {
        const bytes = await readFile(filename);
        actual.set(filename, { path: filename, kind: 'file', bytes: bytes.length, sha256: sha256(bytes) });
      } else if (entry.isSymbolicLink()) {
        const target = await realpath(filename);
        assert(domains.some((domain) => inside(domain, target)), 'Installed owner includes undeclared dependency link target.');
        actual.set(filename, { path: filename, kind: 'symlink', target });
      } else throw new Error('Unexpected special file in installed dependency owner.');
    }
  }
  const workspaceNames = new Set(receipt.packages.map((pin) => pin.name));
  const installedRoots = [...new Set(receipt.dependencyIdentities.filter((identity) => !workspaceNames.has(identity.name)).map((identity) => identity.canonicalRoot))];
  for (const root of installedRoots) await visit(root);
  for (const [index, identity] of receipt.dependencyIdentities.entries()) {
    if (workspaceNames.has(identity.name)) actual.set(identity.packagePin.path, { ...identity.packagePin, kind: 'file' });
    if ((await lstat(logical[index])).isSymbolicLink()) actual.set(logical[index], { path: logical[index], kind: 'symlink', target: identity.canonicalRoot });
  }
  const normalized = (entries) => entries.map((entry) => entry.kind === 'file' ? { path: entry.path, kind: entry.kind, bytes: entry.bytes, sha256: entry.sha256 } : { path: entry.path, kind: entry.kind, target: entry.target }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  assert.deepEqual(normalized([...actual.values()]), normalized(receipt.dependencyBefore), 'Complete installed-owner byte/link inventory mismatch.');
  return domains;
}

async function loadSnapshot(name, root, evidence, qualified = null) {
  await canonicalDirectory(root);
  const receiptPath = root + '.pwa-build-provenance.json';
  assert.equal(await realpath(receiptPath), receiptPath, 'Receipt symlink alias refused.');
  assert((await lstat(receiptPath)).isFile(), 'Missing regular sibling build provenance receipt.');
  const receiptBytes = await readFile(receiptPath);
  if (qualified) {
    assert.equal(qualified.name, name);
    assert.equal(qualified.root, root);
    assert.equal(sha256(receiptBytes), qualified.receiptSha256, 'Previously qualified receipt changed.');
  }
  assert(receiptBytes.length <= 64 * 1024 * 1024, 'Receipt size limit.');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert.equal(receipt.schemaVersion, 1, 'Unsupported build receipt schema.');
  assert.equal(receipt.classification, name === 'old' ? 'historical-source-reproduction' : 'reviewed-candidate');
  await canonicalDirectory(receipt.sourceRoot);
  assert(/^[a-f0-9]{40}$/.test(receipt.sourceCommit), 'Missing pinned committed source revision.');
  const git = await executeFile('git', ['-C', receipt.sourceRoot, 'rev-parse', 'HEAD'], { timeout: 10000, killSignal: 'SIGTERM', maxBuffer: 4096 });
  assert.equal(git.stdout.trim(), receipt.sourceCommit, 'Current source commit differs from receipt.');
  orderedPins(receipt.sourceInputs);
  assert.deepEqual(receipt.sourceInputsBefore, receipt.sourceInputs);
  assert.deepEqual(receipt.sourceInputsAfter, receipt.sourceInputs);
  for (const pin of receipt.sourceInputs) {
    const bytes = await verifyPin({ ...pin, path: path.join(receipt.sourceRoot, pin.path) }, [receipt.sourceRoot]);
    if (!qualified) {
      const committed = await executeFile('git', ['-C', receipt.sourceRoot, 'show', receipt.sourceCommit + ':' + pin.path], { encoding: 'buffer', timeout: 10000, killSignal: 'SIGTERM', maxBuffer: Math.max(4096, pin.bytes + 1024) });
      assert.deepEqual(committed.stdout, bytes, 'Build input was not actual pinned committed source: ' + pin.path);
    }
  }
  for (const required of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/web/astro.config.mjs', 'packages/web/scripts/pwa.mjs', 'packages/web/src/sw.ts', 'packages/core/package.json']) assert(receipt.sourceInputs.some((pin) => pin.path === required), 'Missing build input: ' + required);
  const actualSrc = (await inventory(path.join(receipt.sourceRoot, 'packages/web/src'))).map((pin) => ({ ...pin, path: 'packages/web/src/' + pin.path }));
  assert.deepEqual(actualSrc, receipt.sourceInputs.filter((pin) => pin.path.startsWith('packages/web/src/')), 'Complete immutable app source inventory mismatch.');
  assert(Array.isArray(receipt.packages) && receipt.packages.length, 'Missing source package manifests.');
  orderedPins(receipt.packages);
  for (const pin of receipt.packages) {
    const metadata = JSON.parse((await verifyPin({ ...pin, path: path.join(receipt.sourceRoot, pin.path) }, [receipt.sourceRoot])).toString('utf8'));
    assert.equal(metadata.name, pin.name);
    assert.equal(metadata.version, pin.version);
    assert(receipt.sourceInputs.some((input) => input.path === pin.path && input.sha256 === pin.sha256), 'Package pin omitted from source inputs.');
  }
  const dependencyDomains = await verifyDependencies(receipt, qualified !== null);
  nativeClosure(receipt.build);
  await canonicalDirectory(receipt.build.cwd);
  assert(inside(receipt.sourceRoot, receipt.build.cwd), 'Build cwd escaped owned source root.');
  assert(Number.isFinite(receipt.build.startedAt) && Number.isFinite(receipt.build.deadlineAt) && receipt.build.startedAt < receipt.build.deadlineAt, 'Invalid build time budget.');
  const evidenceDomains = [evidence, receipt.sourceRoot, root];
  await verifyPin(receipt.build.logPin, evidenceDomains);
  const producer = JSON.parse((await verifyPin(receipt.producerRecordPin, evidenceDomains)).toString('utf8'));
  assert.equal(producer.schemaVersion, 1);
  assert(Array.isArray(producer.commandNativeEvidence) && producer.commandNativeEvidence.length, 'Missing producer command evidence.');
  let matchingBuild = false;
  for (const command of producer.commandNativeEvidence) {
    nativeClosure(command);
    await canonicalDirectory(command.cwd);
    assert(Number.isSafeInteger(command.pid) && command.pid > 0, 'Missing owned producer PID.');
    if (JSON.stringify(command.argv) === JSON.stringify(receipt.build.argv) && command.cwd === receipt.build.cwd) matchingBuild = true;
  }
  assert(matchingBuild, 'Producer native evidence lacks this exact web build command.');
  assert(Array.isArray(producer.workspaceArtifacts) && producer.workspaceArtifacts.some((artifact) => artifact.packageName === '@wyreup/core'), 'Missing consumed core artifact qualification.');
  const artifactDomains = [...evidenceDomains, ...dependencyDomains];
  for (const artifact of producer.workspaceArtifacts) {
    const metadata = JSON.parse((await verifyPin(artifact.manifestPin, artifactDomains)).toString('utf8'));
    assert.equal(metadata.name, artifact.packageName);
    assert(receipt.packages.some((pin) => pin.name === artifact.packageName && pin.sha256 === artifact.manifestPin.sha256 && pin.version === metadata.version), 'Compiled workspace owner lacks matching source manifest.');
    orderedPins(artifact.outputs, true);
    const packageRoot = path.dirname(artifact.manifestPin.path);
    assert(receipt.dependencyIdentities.some((identity) => identity.name === artifact.packageName && identity.canonicalRoot === packageRoot), 'Consumed workspace owner is not the actual declared dependency target.');
    const artifacts = new Map();
    for (const output of artifact.outputs) { await verifyPin(output, [packageRoot]); artifacts.set(output.path, output); }
    const declared = new Set();
    function references(value) { if (typeof value === 'string' && value.startsWith('./') && !value.includes('*')) declared.add(path.resolve(packageRoot, value)); else if (value && typeof value === 'object') for (const child of Object.values(value)) references(child); }
    references(metadata.exports);
    for (const key of ['main', 'module', 'browser', 'types']) if (typeof metadata[key] === 'string') declared.add(path.resolve(packageRoot, metadata[key]));
    assert(declared.size, 'Workspace manifest has no concrete referenced exports.');
    for (const declaredPath of declared) assert(artifacts.has(declaredPath), 'Consumed artifact list omitted actual package export: ' + declaredPath);
    const actualOutputs = await inventory(path.join(packageRoot, 'dist'));
    const distPins = artifact.outputs.filter((pin) => inside(path.join(packageRoot, 'dist'), pin.path)).map((pin) => ({ ...pin, path: path.relative(path.join(packageRoot, 'dist'), pin.path).split(path.sep).join('/') }));
    assert.deepEqual(actualOutputs, distPins, 'Consumed workspace dist inventory incomplete or drifted.');
  }
  assert(Array.isArray(receipt.sourceReviewEvidencePins) && receipt.sourceReviewEvidencePins.length, 'Missing root source-review/historical-source evidence pins.');
  orderedPins(receipt.sourceReviewEvidencePins, true);
  for (const pin of receipt.sourceReviewEvidencePins) await verifyPin(pin, evidenceDomains);
  orderedPins(receipt.outputInventory);
  const actual = await inventory(root);
  assert.deepEqual(actual, receipt.outputInventory, 'Complete immutable output inventory mismatch.');
  const files = new Map(actual.map((pin) => [pin.path, pin]));
  for (const required of ['sw.js', 'registerSW.js', '_headers', '_redirects', '404.html', 'manifest.webmanifest']) assert(files.has(required), 'Missing production output artifact: ' + required);
  const worker = await readFile(path.join(root, 'sw.js'), 'utf8');
  const manifest = extractManifest(worker);
  const rules = parseProductionHeaders(await readFile(path.join(root, '_headers'), 'utf8'));
  const redirects = parseProductionRedirects(await readFile(path.join(root, '_redirects'), 'utf8'));
  const recoveryFile = files.has('app-update/index.html') ? 'app-update/index.html' : files.has('app-update.html') ? 'app-update.html' : null;
  const recoveryScripts = [];
  if (name !== 'old') {
    assert(recoveryFile, 'NEW/NEXT real recovery output missing.');
    assert.equal(JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8')).description, DESCRIPTION);
    const config = await readFile(path.join(receipt.sourceRoot, 'packages/web/astro.config.mjs'), 'utf8');
    assert(config.includes("'app-update/index.html'") && config.includes("'app-update.html'"), 'Actual committed recovery glob exclusions missing.');
    const recoveryHtml = await readFile(path.join(root, recoveryFile), 'utf8');
    for (const match of recoveryHtml.matchAll(/(?:component-url|renderer-url|src)="([^"<>]+)"/g)) {
      const url = new URL(match[1], 'http://fixture.invalid/app-update/');
      assert.equal(url.origin, 'http://fixture.invalid', 'External recovery import refused.');
      if (/\.m?js$/.test(url.pathname)) { assert(files.has(url.pathname.slice(1)), 'Unpinned recovery script.'); recoveryScripts.push(url.pathname); }
    }
    assert(recoveryScripts.length, 'Actual recovery status component body missing.');
  }
  return { name, root, receiptPath, receipt, receiptSha256: sha256(receiptBytes), files, workerSha256: files.get('sw.js').sha256, manifest, rules, redirects, recoveryFile, recoveryScripts };
}

export async function inspectHeaders(server, snapshot, collector) {
  server.selectBuild(snapshot.name);
  for (const route of ['/sw.js', '/registerSW.js', '/app-update', '/app-update/', '/manifest.webmanifest']) {
    let location = server.origin + route;
    let final;
    for (let index = 0; index < 8; index++) {
      const raw = await bounded(new Promise((resolve, reject) => {
        const request = httpRequest(location, { method: 'GET' }, (response) => {
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => { size += chunk.length; if (size > 8 * 1024 * 1024) response.destroy(new Error('Header observation body limit.')); else chunks.push(chunk); });
          response.on('error', reject);
          response.on('end', () => resolve({ status: response.statusCode, rawHeaders: response.rawHeaders, headers: response.headers, body: Buffer.concat(chunks) }));
        });
        request.once('error', reject);
        request.setTimeout(10000, () => request.destroy(new Error('Owned header request timeout.')));
        request.end();
      }), 10000, 'Owned production header observation');
      const combined = await bounded(fetch(location, { redirect: 'manual', signal: AbortSignal.timeout(10000) }).then(async (response) => ({ status: response.status, headers: Object.fromEntries(response.headers), sha256: sha256(await response.arrayBuffer().then((body) => Buffer.from(body))) })), 10000, 'Combined Fetch header observation');
      assert.equal(raw.status, combined.status);
      assert.equal(sha256(raw.body), combined.sha256);
      if (raw.status === 200) {
        const pathname = new URL(location).pathname;
        const fields = snapshot.rules.filter((rule) => rule.path.endsWith('*') ? pathname.startsWith(rule.path.slice(0, -1)) : rule.path === pathname).flatMap((rule) => rule.fields);
        const names = new Set(fields.map(([name]) => name));
        for (const name of names) {
          const expected = fields.filter(([key]) => key === name).map(([, value]) => value);
          const observed = [];
          for (let index = 0; index < raw.rawHeaders.length; index += 2) {
            if (raw.rawHeaders[index].toLowerCase() === name) observed.push(raw.rawHeaders[index + 1]);
          }
          assert.deepEqual(observed, expected, 'Raw source-derived header multiset differs: ' + name);
          assert.equal(combined.headers[name], expected.join(', '), 'Combined source-derived header differs: ' + name);
        }
        const actualMime = mime[path.extname(pathname)] ?? 'text/html; charset=utf-8';
        if (!names.has('content-type')) {
          assert.equal(raw.headers['content-type'], actualMime, 'Default source-derived content-type differs.');
          assert.equal(combined.headers['content-type'], actualMime, 'Combined source-derived content-type differs.');
        }
        if (!names.has('etag')) {
          const expected = '"' + sha256(raw.body) + '"';
          assert.equal(raw.headers.etag, expected, 'Default source-derived etag differs.');
          assert.equal(combined.headers.etag, expected, 'Combined source-derived etag differs.');
        }
      }
      collector.add('production-header-observation', { build: snapshot.name, route, location, status: raw.status, rawHeaders: raw.rawHeaders, combined: combined.headers, bodySha256: sha256(raw.body), mime: raw.headers['content-type'] ?? null });
      if ([301, 302, 303, 307, 308].includes(raw.status)) {
        assert(typeof raw.headers.location === 'string');
        location = new URL(raw.headers.location, location).href;
        assert.equal(new URL(location).origin, server.origin, 'Header chain escaped owned origin.');
        continue;
      }
      final = raw;
      break;
    }
    assert(final, 'Header canonical chain exceeded 8 hops.');
    if (['/sw.js', '/registerSW.js', '/manifest.webmanifest'].includes(route)) {
      assert.equal(final.status, 200);
      assert.equal(sha256(final.body), snapshot.files.get(route.slice(1)).sha256);
    } else if (snapshot.name !== 'old') {
      assert.equal(final.status, 200);
      assert.equal(sha256(final.body), snapshot.files.get(snapshot.recoveryFile).sha256);
      assert.match(final.headers['cache-control'] ?? '', /(?:^|[,\s])no-store(?:[,\s]|$)/i);
    }
  }
  server.healthy();
}

async function migrate(driver, snapshots, evidence, parseAst) {
  const collector = driver.collector;
  const { old, new: nextBuild, next } = snapshots;
  const graph = await driver.run('Actual emitted OLD graph preparation', () => emittedGraph(old, '/tools/hash/', parseAst));
  for (const pathname of graph.dependencies) driver.server.headerPaths.add(pathname);
  collector.add('actual-emitted-old-deferred-graph', graph);
  const sentinel = { key: 'wyreup-checker-' + randomUUID(), value: 'owned-pwa-update-sentinel', database: 'wyreup-checker-' + randomUUID() };
  let oldId;
  let waitingId;
  let newId;
  let a;
  let b;
  let c;
  let work;
  let reference;

  collector.beginStep(1);
  driver.server.selectBuild('old');
  a = await driver.newTab('A');
  const attached = await driver.attach(a);
  b = await driver.newTab('B');
  await driver.go(a, '/tools/base64/');
  await driver.wait('OLD normal native activation', () => driver.nativeState(a, 'active'));
  let fresh = collector.sequence;
  await driver.run('Ordinary initial OLD control reload A', (timeout) => a.page.reload({ timeout, waitUntil: 'load' }));
  await driver.identify(a);
  await driver.go(b, '/tools/base64/');
  await driver.run('Ordinary initial OLD control reload B', (timeout) => b.page.reload({ timeout, waitUntil: 'load' }));
  await driver.identify(b);
  oldId = (await driver.controlled([a, b], Math.max(attached, fresh))).versionId;
  await useBase64(driver, a, evidence, 'OLD');
  work = await workSnapshot(driver, a);
  reference = await driver.run('Retain actual A document/controller references', () => a.page.evaluateHandle(() => ({ document, controller: navigator.serviceWorker.controller })));
  await storage(driver, a, sentinel, true);
  collector.add('app-schema-storage-qualification', { shareIntake: 'UNRUN: no supplied independently initialized actual schema fixture', runtimeEntries: 'UNRUN: no supplied independently initialized actual schema fixture' });
  await driver.flush();

  collector.beginStep(2);
  driver.server.selectBuild('new');
  fresh = collector.sequence;
  const selectedAt = driver.server.hits.length;
  await driver.run('One explicit OLD registration update check', () => a.page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration('/'); if (!registration) throw new Error('Root registration missing.'); await registration.update(); }));
  waitingId = (await driver.waiting(a, fresh, oldId)).versionId;
  assert(driver.server.hits.slice(selectedAt).some((hit) => hit.build === 'new' && hit.artifact === 'sw.js' && hit.sha256 === nextBuild.workerSha256), 'Actual NEW worker bytes were not supplied during update.');
  fresh = collector.sequence;
  const oldReload = await driver.run('BEFORE ordinary B page.reload', (timeout) => b.page.reload({ waitUntil: 'load', timeout }));
  assert(oldReload);
  await exactToolDocument(driver, oldReload, old, 'base64', true);
  await driver.identify(b);
  await driver.controlled([a, b], fresh, oldId);
  fresh = collector.sequence;
  const oldQuery = await driver.go(b, '/tools/base64/?pwa-checker=ordinary-navigation');
  await exactToolDocument(driver, oldQuery, old, 'base64', true);
  await driver.controlled([a, b], fresh, oldId);
  assert.equal(await driver.run('BEFORE waiting instruction visibility', () => b.page.getByText(WAITING, { exact: true }).count()), 0, 'BEFORE cached OLD shell unexpectedly has new waiting instructions.');
  collector.add('before-visibility-gap', { ordinaryReloadAndQueryNavigation: true, waitingInstructionsAbsent: true, forceReload: 'UNRUN: no specified force-reload premise' });
  assert.deepEqual(await workSnapshot(driver, a), work);
  assert(await driver.run('Same-document OLD controller reference', () => reference.evaluate((saved) => saved.document === document && saved.controller === navigator.serviceWorker.controller)));
  await driver.flush();

  collector.beginStep(3);
  assert(!driver.requests.has(graph.selected), 'Selected actual OLD deferred runner was loaded earlier.');
  const cursor = driver.server.hits.length;
  const responseCursor = driver.responses.length;
  fresh = collector.sequence;
  const oldDeferredDocument = await driver.go(b, graph.route);
  await exactToolDocument(driver, oldDeferredDocument, old, 'hash', true);
  await driver.run('Actual deferred Hash runner mounted', (timeout) => b.page.getByRole('button', { name: 'Hash file', exact: true }).waitFor({ timeout }));
  const chooser = driver.run('Deferred Hash actual file chooser', (timeout) => b.page.waitForEvent('filechooser', { timeout }));
  await driver.run('Open Hash chooser', (timeout) => b.page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click({ timeout }));
  await driver.run('Choose real Hash fixture', () => chooser.then((value) => value.setFiles({ name: 'pwa-hash.txt', mimeType: 'text/plain', buffer: Buffer.from('pwa deferred mount') })));
  await driver.run('Run mounted Hash tool', (timeout) => b.page.getByRole('button', { name: 'Hash file', exact: true }).click({ timeout }));
  await driver.run('Actual successful Hash mount/result', (timeout) => b.page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor({ timeout }));
  await driver.flush();
  const delivered = driver.responses.slice(responseCursor).filter((record) => new URL(record.url).pathname === graph.selected);
  assert.equal(delivered.length, 1, 'Exactly one newly requested selected deferred runner response required.');
  assert.equal(delivered[0].status, 200);
  assert.equal(delivered[0].fromServiceWorker, true);
  assert.equal(delivered[0].sha256, old.files.get(graph.selected.slice(1)).sha256);
  const selectedURLs = new Set(graph.dependencies.filter((pathname) => driver.responses.slice(responseCursor).some((record) => new URL(record.url).pathname === pathname)));
  assert(selectedURLs.has(graph.selected));
  const inbound = driver.server.hits.slice(cursor).filter((hit) => selectedURLs.has(new URL(hit.url, driver.server.origin).pathname));
  assert.equal(inbound.length, 0, 'Retained-cache qualification failed: selected deferred chunk reached server.');
  collector.add('retained-cache-qualification', { cursorBefore: cursor, cursorAfter: driver.server.hits.length, selectedURLs: [...selectedURLs].map((pathname) => ({ pathname, oldOnly: !nextBuild.files.has(pathname.slice(1)), sha256: old.files.get(pathname.slice(1)).sha256 })), zeroInboundRequests: true, observedSelectedResponse: delivered[0], mounted: true });
  await driver.controlled([a, b], fresh, oldId);
  assert.deepEqual(await workSnapshot(driver, a), work);
  assert(await driver.run('Deferred load preserves A native reference', () => reference.evaluate((saved) => saved.document === document && saved.controller === navigator.serviceWorker.controller)));

  collector.beginStep(4);
  const recoveryStatus = await recovery(driver, b, nextBuild, oldId);
  assert.deepEqual(await workSnapshot(driver, a), work);
  await driver.run('Set only owned context offline', () => driver.context.setOffline(true));
  try {
    await driver.run('Real offline recovery Check action', (timeout) => b.page.getByRole('button', { name: 'Check for update', exact: true }).click({ timeout }));
    await driver.wait('Real offline recovery refusal status', async () => /offline/i.test(await recoveryStatus.textContent()));
    assert(!/updated|latest/i.test(await driver.run('Offline recovery truthful wording', () => recoveryStatus.textContent())));
    const offlineResponse = await driver.go(b, '/app-update/?pwa-checker=offline-network-first');
    assert.equal(await driver.run('Offline first recovery heading unavailable', () => b.page.getByRole('heading', { name: 'Update Wyreup', exact: true }).count()), 0, 'Recovery first network request unexpectedly available offline.');
    collector.add('offline-recovery-observation', { status: offlineResponse.status(), recoveryUnavailable: true, actualHeading: await driver.run('Actual offline fallback heading', () => b.page.locator('h1').innerText()) });
  } finally { await driver.run('Restore owned offline setting', () => driver.context.setOffline(false)); }
  await recovery(driver, b, nextBuild, oldId);
  await driver.flush();

  collector.beginStep(5);
  await storage(driver, a, sentinel);
  await storage(driver, b, sentinel);
  assert.deepEqual(await workSnapshot(driver, a), work);
  await driver.flush();

  collector.beginStep(6);
  assert.deepEqual(await driver.run('Complete download before drain', () => readFile(path.join(evidence, 'base64-OLD.txt'))), Buffer.from('-_8'));
  assert.deepEqual(await workSnapshot(driver, a), work);
  await driver.run('Dispose owned A reference', () => reference.dispose());
  await driver.detach('A-to-existing-B handoff; activation transition unobserved during gap');
  const bAttach = await driver.attach(b);
  collector.endGap('Only existing B now owns native stream');
  await driver.controlled([a, b], bAttach, oldId);
  fresh = collector.sequence;
  await driver.run('Close only owned A', () => a.page.close());
  await driver.controlled([b], fresh, oldId);
  await driver.detach('No-active-page gap before drain/reopen; NEW activation transition unobserved');
  await driver.run('Close owned B including recovery tab', () => b.page.close());
  c = await driver.newTab('C');
  const cAttach = await driver.attach(c);
  collector.endGap('Owned C native stream attached; fresh endpoint required');
  fresh = collector.sequence;
  await driver.go(c, '/tools/base64/');
  await driver.wait('NEW naturally activated after native client drain', () => driver.nativeState(c, 'active'));
  const newDocument = await driver.run('Ordinary NEW control navigation', (timeout) => c.page.reload({ waitUntil: 'load', timeout }));
  assert(newDocument);
  await exactToolDocument(driver, newDocument, nextBuild, 'base64', true);
  await driver.identify(c);
  newId = (await driver.controlled([c], Math.max(cAttach, fresh), waitingId)).versionId;
  assert.equal(newId, waitingId, 'Waiting/activated native version identity mismatch.');
  await storage(driver, c, sentinel);
  const manifestDescription = await driver.run('Actual NEW emitted manifest description', () => c.page.evaluate(async () => (await fetch('/manifest.webmanifest').then((response) => response.json())).description));
  assert.equal(manifestDescription, DESCRIPTION);
  await useBase64(driver, c, evidence, 'NEW');
  const cWork = await workSnapshot(driver, c);
  await driver.run('Owned NEW offline mode', () => driver.context.setOffline(true));
  try {
    await driver.go(c, '/tools/base64/?pwa-checker=offline-cached-tool');
    await useBase64(driver, c, evidence, 'NEW-offline');
    await driver.go(c, '/pwa-update-owned-uncached-' + randomUUID());
    assert.equal(await driver.run('Actual NEW fallback heading', () => c.page.locator('h1').innerText()), "You're offline.");
    collector.add('new-offline-observations', { cachedBase64Bytes: '-_8', fallbackHeading: "You're offline." });
  } finally { await driver.run('Restore owned NEW online mode', () => driver.context.setOffline(false)); }
  await driver.go(c, '/tools/base64/');
  await useBase64(driver, c, evidence, 'NEW-retained');
  assert.deepEqual(await workSnapshot(driver, c), cWork);
  await driver.flush();

  collector.beginStep(7);
  const d = await driver.newTab('D');
  fresh = collector.sequence;
  await driver.go(d, '/tools/base64/');
  await driver.controlled([c, d], fresh, newId);
  const preserved = await workSnapshot(driver, c);
  const cReference = await driver.run('Retain actual NEW C references', () => c.page.evaluateHandle(() => ({ document, controller: navigator.serviceWorker.controller })));
  driver.server.selectBuild('next');
  fresh = collector.sequence;
  const nextWorkerCursor = driver.server.hits.length;
  await driver.run('One explicit NEW native registration check for NEXT', () => c.page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration('/'); if (!registration) throw new Error('Root registration missing.'); await registration.update(); }));
  const nextWaiting = await driver.waiting(c, fresh, newId);
  assert(driver.server.hits.slice(nextWorkerCursor).some((hit) => hit.build === 'next' && hit.artifact === 'sw.js' && hit.sha256 === next.workerSha256), 'Actual NEXT worker bytes were not supplied during newly waiting update.');
  assert.notEqual(nextWaiting.versionId, newId);
  await driver.wait('NEW shell newly installed waiting prompt', async () => (await c.page.locator('.pwa-toast[role="status"]').textContent())?.includes(WAITING));
  assert.deepEqual(await workSnapshot(driver, c), preserved);
  assert(await driver.run('Waiting preserves NEW C references', () => cReference.evaluate((saved) => saved.document === document && saved.controller === navigator.serviceWorker.controller)));
  await driver.run('Actual NEW shell Later', (timeout) => c.page.getByRole('button', { name: 'Dismiss update notification', exact: true }).click({ timeout }));
  assert.equal(await driver.run('Later dismisses only visible prompt', () => c.page.locator('.pwa-toast[role="status"]').count()), 0);
  assert.deepEqual(await workSnapshot(driver, c), preserved);
  assert(await driver.run('Later preserves NEW C references', () => cReference.evaluate((saved) => saved.document === document && saved.controller === navigator.serviceWorker.controller)));
  assert(await driver.nativeState(c, 'waiting'));
  const e = await driver.newTab('E');
  fresh = collector.sequence;
  await driver.go(e, '/tools/base64/');
  await driver.controlled([c, d, e], fresh, newId);
  await driver.wait('NEW shell mount while already waiting', async () => (await e.page.locator('.pwa-toast[role="status"]').textContent())?.includes(WAITING));
  await recovery(driver, d, next, newId);
  await storage(driver, c, sentinel);
  await driver.run('Dispose owned C reference', () => cReference.dispose());
  collector.add('next-waiting-endpoint', { activeVersionId: newId, waitingVersionId: nextWaiting.versionId, ownedControlledTabs: [c.targetId, d.targetId, e.targetId], newlyWaitingAndAlreadyWaiting: true });
  await driver.flush();
  // Owned third client remains until cleanup; no unseen activation claim follows closing it.
  return { oldVersionId: oldId, newVersionId: newId, nextWaitingVersionId: nextWaiting.versionId, sentinel, completedSteps: [1, 2, 3, 4, 5, 6, 7], handoffCoverage: 'Qualified endpoints; transitions inside recorded gaps were unobserved.' };
}

async function firstInstall(driver) {
  driver.collector.beginStep(1);
  driver.server.selectBuild('new');
  const page = await driver.newTab('first-install');
  const after = await driver.attach(page);
  await driver.go(page, '/tools/base64/');
  await driver.wait('Fresh first install activation', () => driver.nativeState(page, 'active'));
  await driver.run('Fresh initial ordinary control navigation', (timeout) => page.page.reload({ waitUntil: 'load', timeout }));
  await driver.identify(page);
  const version = await driver.controlled([page], after);
  assert.equal(await driver.run('Fresh first-install banner visibility', () => page.page.locator('.pwa-toast[role="status"]').count()), 0, 'First install incorrectly displayed update-ready banner.');
  driver.collector.add('first-install-observation', { activatedVersionId: version.versionId, waitingBannerAbsent: true });
  await driver.flush();
  return { firstInstallBannerAbsent: true, nativeActivatedControlledEndpoint: version.versionId };
}

/** @param {string[]} args @returns {{old:string,new:string,next:string,evidence:string}} */
export function parseArguments(args) {
  assert.equal(args.length, 8, 'Usage: node packages/web/scripts/check-pwa-update.mjs --old <OLD> --new <NEW> --next <NEXT> --evidence <owned-dir>');
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    assert(['--old', '--new', '--next', '--evidence'].includes(key) && !Object.hasOwn(values, key.slice(2)), 'Unknown or duplicate CLI flag.');
    const value = args[index + 1];
    assert(typeof value === 'string' && path.isAbsolute(value) && value === path.resolve(value), 'CLI inputs must be canonical absolute local paths.');
    assert(!value.includes('\0'), 'Invalid CLI path.');
    values[key.slice(2)] = value;
  }
  assert.equal(new Set(Object.values(values)).size, 4, 'Build roots and evidence directory must be distinct.');
  const roots = Object.values(values);
  for (let left = 0; left < roots.length; left++) for (let right = left + 1; right < roots.length; right++) assert(!inside(roots[left], roots[right]) && !inside(roots[right], roots[left]), 'Build/evidence roots cannot overlap.');
  return values;
}

async function main(args) {
  const input = parseArguments(args);
  await mkdir(input.evidence, { recursive: true });
  await canonicalDirectory(input.evidence);
  const evidence = path.join(input.evidence, 'pwa-update-owned-' + randomUUID());
  await mkdir(evidence);
  const report = { schemaVersion: 1, command: [process.execPath, fileURLToPath(import.meta.url), ...args], cwd: process.cwd(), startedAt: Date.now(), status: 'UNRUN', exitCode: null, limitations: ['Chromium software gate only; Firefox/WebKit and installed-PWA windows UNRUN.', 'This checker cannot authenticate historical human/model approval from a producer JSON receipt.', 'Exact original stale-user worker recovery remains unverified without that worker identity.', 'Live production cache policy and release delivery remain separate.', 'App-specific share/runtime storage fixtures UNRUN unless separately supplied.'], errors: [], cleanup: [], pendingOwnership: [] };
  const snapshots = {};
  let browser;
  let server;
  let collector;
  const contexts = [];
  const drivers = [];
  const scenarios = [];
  const setupOperations = new Map();
  let setupBudget = 180000;
  const setup = async (label, action, cap = 180000) => {
    const remaining = Math.min(cap, setupBudget);
    if (remaining <= 0) throw new Error('Preparation absolute 180000ms budget expired.');
    const key = Symbol(label);
    const operation = Promise.resolve().then(action).then((value) => { setupOperations.delete(key); return value; }, (error) => { setupOperations.delete(key); throw error; });
    setupOperations.set(key, { label, promise: operation });
    const started = Date.now();
    try { return await bounded(operation, remaining, label); }
    finally { setupBudget -= Date.now() - started; }
  };
  let failure;
  try {
    for (const name of ['old', 'new', 'next']) snapshots[name] = await setup('Qualified ' + name + ' immutable input readers', () => loadSnapshot(name, input[name], input.evidence));
    assert.notEqual(snapshots.new.receipt.sourceCommit, snapshots.next.receipt.sourceCommit, 'NEXT committed revision must differ from NEW.');
    assert.notEqual(snapshots.old.workerSha256, snapshots.new.workerSha256, 'OLD/NEW worker bytes must differ.');
    assert.notEqual(snapshots.new.workerSha256, snapshots.next.workerSha256, 'NEW/NEXT genuine worker bytes must differ.');
    assert.notEqual(snapshots.old.manifest.sha256, snapshots.new.manifest.sha256, 'OLD/NEW actual injected manifests must differ.');
    assert.notEqual(snapshots.new.manifest.sha256, snapshots.next.manifest.sha256, 'NEW/NEXT actual injected manifests must differ.');
    const changes = snapshots.next.receipt.appContentChangeEvidence;
    assert(Array.isArray(changes) && changes.length, 'Missing NEXT genuine committed app-content change evidence.');
    for (const change of changes) {
      assert(typeof change.path === 'string' && change.path.startsWith('packages/web/src/') && change.path !== 'packages/web/src/sw.ts' && !/(?:^|\/)(?:test|tests|generated)(?:\/|\.)/.test(change.path) && !/(?:config|\.test\.|\.spec\.)/.test(change.path), 'NEXT app-content change must be first-party app source.');
      const oldPin = snapshots.new.receipt.sourceInputs.find((pin) => pin.path === change.path);
      const newPin = snapshots.next.receipt.sourceInputs.find((pin) => pin.path === change.path);
      assert(oldPin && newPin && oldPin.sha256 === change.oldSha256 && newPin.sha256 === change.newSha256 && oldPin.sha256 !== newPin.sha256, 'NEXT app-content evidence does not match actual committed source inputs.');
    }
    report.inputPins = Object.fromEntries(Object.entries(snapshots).map(([name, snapshot]) => [name, { root: snapshot.root, receiptPath: snapshot.receiptPath, receiptSha256: snapshot.receiptSha256, sourceCommit: snapshot.receipt.sourceCommit, classification: snapshot.receipt.classification, workerSha256: snapshot.workerSha256, injectedManifest: { start: snapshot.manifest.start, end: snapshot.manifest.end, sha256: snapshot.manifest.sha256 }, outputInventory: snapshot.receipt.outputInventory }]));
    const { chromium } = await import('playwright');
    const { parseAst } = await import('vite');
    assert.equal(typeof parseAst, 'function', 'Installed public Vite AST API unavailable.');
    await setup('Owned selector listener creation', async () => { server = await serveSnapshots(snapshots, { add: (...values) => collector?.add(...values), healthy: () => collector?.healthy() }); });
    collector = new NativeCollector(server.origin);
    for (const snapshot of Object.values(snapshots)) await setup('Actual ' + snapshot.name + ' production header readers', () => inspectHeaders(server, snapshot, collector));
    await writeFile(path.join(evidence, 'headers.json'), JSON.stringify(collector.finish(), null, 2) + '\n', { flag: 'wx' });
    await setup('Owned Chromium launch', async () => { browser = await chromium.launch({ headless: true, timeout: 10000 }); }, 10000);
    for (const scenario of ['migration', 'fresh-first-install']) {
      collector = new NativeCollector(server.origin);
      let context;
      await setup('Owned Chromium context creation', async () => { context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true }); contexts.push(context); }, 10000);
      const driver = new BrowserDriver(context, collector, server);
      drivers.push(driver);
      const record = { scenario, collector, result: null };
      scenarios.push(record);
      record.result = scenario === 'migration' ? await migrate(driver, snapshots, evidence, parseAst) : await firstInstall(driver);
      // End this scenario before starting another; streams and contexts never overlap.
      await driver.detach('End scenario; subsequent activation transitions unobserved');
      driver.dispose();
      await bounded(context.close(), 20000, 'Owned completed scenario context close');
      contexts.splice(contexts.indexOf(context), 1);
      await writeFile(path.join(evidence, scenario + '.json'), JSON.stringify({ result: record.result, collection: collector.finish() }, null, 2) + '\n', { flag: 'wx' });
    }
    report.status = 'observed-all-required-local-checks';
  } catch (error) {
    failure = error;
    report.errors.push({ message: error.message, stack: error.stack });
    report.status = Object.keys(snapshots).length < 3 ? 'UNRUN: preparation refused' : 'FAIL';
  } finally {
    const cleanupStartedAt = Date.now();
    const cleanupDeadline = cleanupStartedAt + 60000;
    const pendingDeadline = Math.min(cleanupDeadline, cleanupStartedAt + 10000);
    const cleanupOperations = new Map();
    const cleanup = async (label, action, cap) => {
      const remaining = Math.min(cap, cleanupDeadline - Date.now());
      if (remaining <= 0) { const error = new Error('Absolute cleanup envelope expired: ' + label); report.cleanup.push({ label, settled: false, error: error.message }); failure ??= error; return; }
      const key = Symbol(label);
      const operation = Promise.resolve().then(action).then((value) => { cleanupOperations.delete(key); return value; }, (error) => { cleanupOperations.delete(key); throw error; });
      cleanupOperations.set(key, { label, promise: operation });
      try { await bounded(operation, remaining, label); report.cleanup.push({ label, settled: true }); }
      catch (error) { report.cleanup.push({ label, settled: false, error: error.message }); failure ??= error; }
    };
    for (const driver of drivers) driver.dispose();
    for (const scenario of scenarios) {
      const captured = JSON.stringify({ result: scenario.result, failure: scenario.collector.failure?.message ?? null, capturePhase: 'Cleanup entry; outstanding readers may still add records. Completed scenario evidence is separately retained; pending ownership is in terminal.json.', collection: { bytes: scenario.collector.bytes, unrelatedOriginCount: scenario.collector.unrelated, pendingAssociationCount: scenario.collector.pending.length, records: scenario.collector.records } }, null, 2) + '\n';
      await cleanup('Preserve ' + scenario.scenario + ' collection before teardown and rehash', () => writeFile(path.join(evidence, scenario.scenario + '-final.json'), captured, { flag: 'wx' }), pendingDeadline - Date.now());
    }
    await cleanup('Already-owned preparation/launch operations settle', async () => {
      const results = await Promise.allSettled([...setupOperations.values()].map((entry) => entry.promise));
      const rejected = results.filter((entry) => entry.status === 'rejected');
      if (rejected.length) throw new AggregateError(rejected.map((entry) => entry.reason), 'Owned preparation readers rejected.');
    }, pendingDeadline - Date.now());
    for (const pending of setupOperations.values()) report.pendingOwnership.push({ resource: 'preparation/launch operation', label: pending.label });
    for (const driver of drivers) {
      if (driver.session) {
        const owned = driver.session;
        for (const [event, handler] of owned.listeners) owned.cdp.off(event, handler);
        await cleanup('Owned outstanding ServiceWorker.disable', () => owned.cdp.send('ServiceWorker.disable'), pendingDeadline - Date.now());
        await cleanup('Owned outstanding CDP detach', () => owned.cdp.detach(), pendingDeadline - Date.now());
      }
      await cleanup('Already-owned pending browser operations settle', async () => {
        const results = await Promise.allSettled([...driver.pending.values()].map((entry) => entry.promise));
        const rejected = results.filter((entry) => entry.status === 'rejected');
        if (rejected.length) throw new AggregateError(rejected.map((entry) => entry.reason), 'Owned pending readers rejected.');
      }, pendingDeadline - Date.now());
      for (const pending of driver.pending.values()) report.pendingOwnership.push({ resource: 'browser operation', label: pending.label });
    }
    const contextDeadline = Math.min(cleanupDeadline, Date.now() + 20000);
    for (const context of contexts) {
      await cleanup('Restore owned context offline setting', () => context.setOffline(false), Math.max(1, contextDeadline - Date.now()));
      await cleanup('Owned context close sequentially', () => context.close(), Math.max(1, contextDeadline - Date.now()));
    }
    if (browser) await cleanup('Owned browser close', () => browser.close(), 15000);
    if (server) await cleanup('Owned listener/readers close', () => server.close(), 5000);
    const verificationDeadline = Math.min(cleanupDeadline, Date.now() + 10000);
    let verificationPending = null;
    await cleanup('Before/after input receipt/source/package/dependency/artifact rehash', async () => {
      const operation = (async () => {
        for (const [name, snapshot] of Object.entries(snapshots)) {
          verificationPending = { resource: 'input verification operation', label: name + ' receipt/source/dependency/artifact readers', sourceRoot: snapshot.receipt.sourceRoot, buildRoot: snapshot.root };
          const after = await loadSnapshot(name, input[name], input.evidence, snapshot);
          assert.equal(after.receiptSha256, snapshot.receiptSha256, 'Receipt changed during owned readers.');
          assert.deepEqual(after.receipt.outputInventory, snapshot.receipt.outputInventory);
        }
      })().finally(() => { verificationPending = null; });
      await operation;
    }, Math.max(1, verificationDeadline - Date.now()));
    if (verificationPending) report.pendingOwnership.push(verificationPending);
    for (const operation of cleanupOperations.values()) report.pendingOwnership.push({ resource: 'cleanup operation', label: operation.label });
    if (failure && report.status === 'observed-all-required-local-checks') report.status = 'FAIL: cleanup/input pin qualification';
    report.exitCode = failure ? 1 : 0;
    report.finishedAt = Date.now();
    report.evidence = evidence;
    report.retention = 'All input and evidence trees retained; no deletion was attempted.';
    await writeFile(path.join(evidence, 'terminal.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  process.stdout.write(JSON.stringify({ status: report.status, exitCode: report.exitCode, evidence }) + '\n');
  if (failure) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write('UNRUN/refused: ' + error.message + '\n'); process.exitCode = 1; });
}
