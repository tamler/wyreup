import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parseProductionHeaders, parseProductionRedirects, productionResponseHeaders } from '../scripts/production-headers.mjs';
import type { readCoordinatedCoreProof } from './productionBuildBindingObserver.mjs';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const MAX_SERVER_TIMER_MS = 2_147_483_647;
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function inside(root: string, path: string) {
  return path === root || path.startsWith(root + sep);
}

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

/** Static acceptance server, not a Pages Functions/CDN/cache emulator. */
export async function serveBuiltCatalog(options: {
  distDir: string; headersFile: string; callerAbortSignal?: AbortSignal; deadlineAt?: number;
}) {
  function remainingLifetime() {
    if (options.deadlineAt === undefined) return undefined;
    const remaining = options.deadlineAt - Date.now();
    if (!Number.isFinite(options.deadlineAt) || !Number.isFinite(remaining) || remaining > MAX_SERVER_TIMER_MS) {
      throw new Error('Invalid static server deadline.');
    }
    if (remaining <= 0) throw new Error('Static server caller lifetime ended.');
    return remaining;
  }
  function checkLifetime() {
    if (options.callerAbortSignal?.aborted) throw new Error('Static server caller lifetime ended.');
    remainingLifetime();
  }
  checkLifetime();
  const root = await realpath(options.distDir);
  checkLifetime();
  const rules = parseProductionHeaders(await readFile(options.headersFile, 'utf8'));
  checkLifetime();
  const redirects = parseProductionRedirects(await readFile(join(root, '_redirects'), 'utf8'));
  checkLifetime();

  async function file(path: string) {
    const candidate = resolve(root, '.' + path);
    if (!inside(root, candidate)) return null;
    try {
      const actual = await realpath(candidate);
      if (!inside(root, actual) || !(await stat(actual)).isFile()) return null;
      return actual;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  if (!(await file('/404.html'))) throw new Error('Production catalog must contain /404.html.');
  checkLifetime();
  const connections = new Set<Socket>();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return;
      }
      const target = request.url ?? '/';
      if (!target.startsWith('/') || target.startsWith('//') || Array.from(target).some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)) {
        response.writeHead(400); response.end(); return;
      }
      const url = new URL(target, 'http://127.0.0.1');
      let path: string;
      try { path = decodeURIComponent(target.split('?')[0]); }
      catch { response.writeHead(400); response.end(); return; }
      if (path.includes('\\') || Array.from(path).some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127) || path.split('/').some((part) => part === '.' || part === '..')) {
        response.writeHead(400); response.end(); return;
      }
      const explicit = redirects.find((rule) => rule.from === path);
      if (explicit) {
        response.writeHead(explicit.status, { location: explicit.to + url.search }); response.end(); return;
      }
      const redirect = (location: string) => {
        response.writeHead(301, { location: location + url.search }); response.end();
      };
      let actual: string | null = null;
      if (path.endsWith('/index.html') && await file(path)) {
        redirect(path.slice(0, -'index.html'.length)); return;
      }
      if (path.endsWith('.html') && await file(path)) {
        redirect(path.slice(0, -'.html'.length)); return;
      }
      if (!path.split('/').some((part) => part === '_headers' || part === '_redirects')) {
        actual = await file(path);
        if (!actual && path.endsWith('/')) actual = await file(path + 'index.html');
        if (!actual && !path.endsWith('/') && await file(path + '/index.html')) {
          redirect(url.pathname + '/'); return;
        }
        if (!actual && !path.endsWith('/') && !extname(path)) actual = await file(path + '.html');
      }
      let status = 200;
      if (!actual) {
        status = 404;
        let directory = path.endsWith('/') ? path.replace(/\/$/, '') : dirname(path);
        while (!actual) {
          actual = await file((directory === '/' ? '' : directory) + '/404.html');
          if (directory === '/' || directory === '.') break;
          directory = dirname(directory);
        }
      }
      if (!actual) throw new Error('Production catalog lost its 404 artifact.');
      const bytes = await readFile(actual);
      const etag = `"${sha256(bytes)}"`;
      const headers = productionResponseHeaders(rules, path, mime[extname(actual).toLowerCase()] ?? 'application/octet-stream', etag);
      if (status === 200 && request.headers['if-none-match'] === etag) {
        response.writeHead(304, headers); response.end(); return;
      }
      response.writeHead(status, { ...headers, 'content-length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Static acceptance server failed.');
    });
  });
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close(); throw new Error('Static acceptance server unavailable.');
  }
  let closePromise: Promise<void> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => { void close().catch(() => undefined); };
  function close(): Promise<void> {
    if (closePromise) return closePromise;
    clearTimeout(lifetimeTimer);
    options.callerAbortSignal?.removeEventListener('abort', onAbort);
    closePromise = (async () => {
      const stopped = new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
      for (const socket of connections) socket.destroy();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([stopped, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Owned static server close exceeded 5000ms.')), 5000);
        })]);
      } finally { clearTimeout(timer); }
    })();
    return closePromise;
  }
  options.callerAbortSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    checkLifetime();
    const remaining = remainingLifetime();
    if (remaining !== undefined) lifetimeTimer = setTimeout(onAbort, remaining);
    checkLifetime();
  } catch (error) { await close(); throw error; }
  return { url: `http://127.0.0.1:${address.port}`, close };
}

async function pins(directory: string, check: () => void = () => undefined) {
  const output: { path: string; bytes: number; sha256: string }[] = [];
  async function walk(current: string) {
    check();
    const entries = await readdir(current, { withFileTypes: true });
    check();
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      check();
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        check();
        output.push({ path: relative(directory, path), bytes: bytes.length, sha256: sha256(bytes) });
      } else throw new Error('Unexpected symlink in pinned catalog input/artifact.');
    }
  }
  await walk(directory);
  return output;
}

async function optionalDirectoryPins(directory: string, check: () => void) {
  check();
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error('Expected original cache/artifact directory.');
    check();
    return { directory, present: true, files: await pins(directory, check) };
  } catch (error) {
    if (missing(error)) { check(); return { directory, present: false, files: [] }; }
    throw error;
  }
}

export const PRODUCTION_FIXTURE_BUILD_BUDGET_MS = 180_000;
const OWNED_CHILD_CLEANUP_BUDGET_MS = 5000;
const CACHE_CONFIG_NAME = 'astro.acceptance.config.mjs';
const CACHE_CONFIG_BODY = [
  "import { fileURLToPath } from 'node:url';",
  "import production from './astro.config.mjs';",
  'export default {',
  '  ...production,',
  "  cacheDir: fileURLToPath(new URL('./.acceptance-cache/astro/', import.meta.url)),",
  '  vite: {',
  '    ...production.vite,',
  "    cacheDir: fileURLToPath(new URL('./.acceptance-cache/vite/', import.meta.url)),",
  '  },',
  '};',
  '',
].join('\n');

const BINDING_CONFIG_TEMPLATE = [
  "import { fileURLToPath } from 'node:url';",
  "import production from './astro.config.mjs';",
  "import { createProductionBindingObserver } from './test/productionBuildBindingObserver.mjs';",
  'const bindingOptions = __WYREUP_BINDING_OPTIONS_JSON__;',
  'export default {',
  '  ...production,',
  '  integrations: [...(production.integrations ?? []), createProductionBindingObserver(bindingOptions)],',
  "  cacheDir: fileURLToPath(new URL('./.acceptance-cache/astro/', import.meta.url)),",
  '  vite: {',
  '    ...production.vite,',
  "    cacheDir: fileURLToPath(new URL('./.acceptance-cache/vite/', import.meta.url)),",
  '  },',
  '};',
  '',
].join('\n');

async function preparedPins(directory: string, check: () => void) {
  const excluded = new Set(['node_modules', 'packages/web/node_modules', 'packages/core/node_modules']);
  const output: { path: string; bytes: number; sha256: string }[] = [];
  async function walk(current: string) {
    check();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(current, entry.name);
      if (excluded.has(relative(directory, file))) continue;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const bytes = await readFile(file);
        check();
        output.push({ path: relative(directory, file), bytes: bytes.length, sha256: sha256(bytes) });
      } else throw new Error('Unexpected symlink in pinned catalog preparation input.');
    }
  }
  await walk(directory);
  return output;
}

async function dependencyIdentities(links: { source: string; target: string; names: string[] }[], check: () => void) {
  const owners = new Map<string, { packageRoot: string; name: string; version: string; packageJson: { path: string; bytes: number; sha256: string }; logicalRoots: string[] }>();
  async function owner(logical: string) {
    check();
    const packageRoot = await realpath(logical);
    const metadataPath = join(packageRoot, 'package.json');
    const bytes = await readFile(metadataPath);
    check();
    const metadata = JSON.parse(bytes.toString('utf8')) as { name?: unknown; version?: unknown };
    if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') throw new Error('Invalid binding dependency metadata.');
    const previous = owners.get(packageRoot);
    if (previous) { previous.logicalRoots.push(logical); return; }
    owners.set(packageRoot, { packageRoot, name: metadata.name, version: metadata.version,
      packageJson: { path: metadataPath, bytes: bytes.length, sha256: sha256(bytes) }, logicalRoots: [logical] });
    if (owners.size > 1024 || Buffer.byteLength(JSON.stringify([...owners.values()])) > 2 * 1024 * 1024)
      throw new Error('Binding dependency metadata budget.');
  }
  for (const link of links) {
    for (const name of link.names) {
      if (name.startsWith('.')) continue;
      const logical = join(link.target, name);
      if (name.startsWith('@')) {
        for (const entry of await readdir(logical, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          await owner(join(logical, entry.name));
        }
      } else await owner(logical);
    }
  }
  return [...owners.values()].sort((a, b) => a.packageRoot.localeCompare(b.packageRoot));
}

/** Build the controlled route with the real configuration and packaged core. */
export async function buildProductionCatalogFixture(options: {
  webDir: string; evidenceDir: string; callerAbortSignal?: AbortSignal; deadlineAt?: number;
  observeBinding?: { runId: string; observationDir: string };
}) {
  const started = Date.now();
  const bindingDescriptor = Object.getOwnPropertyDescriptor(options, 'observeBinding');
  if (bindingDescriptor && (!('value' in bindingDescriptor) || bindingDescriptor.value === undefined))
    throw new Error('Browser binding run identity mismatch');
  if (options.deadlineAt !== undefined && !Number.isFinite(options.deadlineAt)) throw new Error('Invalid catalog build deadline.');
  const deadline = Math.min(options.deadlineAt ?? Infinity, started + PRODUCTION_FIXTURE_BUILD_BUDGET_MS);
  const controller = new AbortController();
  const callerAbort = () => controller.abort(new Error('Catalog build caller aborted.'));
  const timer = setTimeout(() => controller.abort(new Error('Catalog build deadline elapsed.')), Math.max(0, deadline - started));
  options.callerAbortSignal?.addEventListener('abort', callerAbort, { once: true });
  if (options.callerAbortSignal?.aborted) callerAbort();
  function check() {
    if (Date.now() >= deadline && !controller.signal.aborted) controller.abort(new Error('Catalog build deadline elapsed.'));
    controller.signal.throwIfAborted();
  }
  async function phase<T>(action: () => Promise<T>): Promise<T> {
    check();
    const result = await action();
    check();
    return result;
  }
  async function runOwnedChild(args: string[], cwd: string, fd: number, index: number) {
    check();
    await new Promise<void>((done, reject) => {
      const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', fd, fd] });
      let settled = false;
      let cancelled = false;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      function finish(error?: Error) {
        if (settled) return;
        settled = true;
        clearTimeout(cleanupTimer);
        controller.signal.removeEventListener('abort', abort);
        if (error) reject(error); else done();
      }
      function abort() {
        if (settled || cancelled) return;
        cancelled = true;
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        cleanupTimer = setTimeout(() => finish(new Error(`Catalog build step ${index} failed cleanup: owned PID ${child.pid ?? 'not assigned'} did not exit within ${OWNED_CHILD_CLEANUP_BUDGET_MS}ms after SIGTERM; tree/logs retained.`)), OWNED_CHILD_CLEANUP_BUDGET_MS);
      }
      controller.signal.addEventListener('abort', abort, { once: true });
      child.once('error', (error) => finish(error));
      child.once('exit', (code, signal) => {
        if (cancelled || code !== 0) finish(new Error(`Catalog build step ${index} ${cancelled ? 'cancelled' : 'failed'}: native exit=${String(code)}, signal=${String(signal)}, owned PID=${String(child.pid)}.`));
        else finish();
      });
      if (controller.signal.aborted) abort();
    });
    check();
  }
  let owned: string | undefined;
  try {
    const originalWeb = await phase(() => realpath(options.webDir));
    const originalRoot = resolve(originalWeb, '../..');
    const originalCore = resolve(originalWeb, '../core');
    const requestedEvidence = resolve(options.evidenceDir);
    await phase(() => mkdir(requestedEvidence, { recursive: true }));
    const evidence = await phase(() => realpath(requestedEvidence));
    let bindingDirectory: string | undefined;
    if (options.observeBinding !== undefined) {
      const binding = options.observeBinding;
      if (!binding || Object.getPrototypeOf(binding) !== Object.prototype ||
          Object.keys(binding).join(',') !== 'runId,observationDir' ||
          !/^[A-Za-z0-9-]{1,100}$/.test(binding.runId) ||
          relative(originalRoot, evidence).split(sep).join('/') !== `docs/catalog-artifacts/${binding.runId}/build-evidence` ||
          binding.observationDir !== join(evidence, `binding-${binding.runId}`))
        throw new Error('Browser binding run identity mismatch');
      await phase(() => mkdir(binding.observationDir));
      bindingDirectory = await phase(() => realpath(binding.observationDir));
      if (bindingDirectory !== binding.observationDir) throw new Error('Browser binding run identity mismatch');
    }
    check();
    const tree = await phase(() => mkdtemp(join(evidence, 'production-catalog-')));
    owned = tree;
    check();
    const web = join(tree, 'packages/web');
    const core = join(tree, 'packages/core');
    const coreBefore = await phase(() => pins(join(originalCore, 'dist'), check));
    const preservedPaths = [...new Set([
      join(originalWeb, 'dist'),
      ...[originalRoot, originalWeb, originalCore].flatMap((directory) => [
        join(directory, '.astro'),
        ...['.astro', '.vite', '.vite-temp', '.cache'].map((name) => join(directory, 'node_modules', name)),
      ]),
    ])].sort();
    const preservedBefore: Awaited<ReturnType<typeof optionalDirectoryPins>>[] = [];
    for (const directory of preservedPaths) preservedBefore.push(await phase(() => optionalDirectoryPins(directory, check)));
    const beforeGuardPath = join(evidence, `${basename(tree)}-original-before.json`);
    await phase(() => writeFile(beforeGuardPath, JSON.stringify({ coreDist: coreBefore, preserved: preservedBefore }, null, 2) + '\n', { flag: 'wx' }));
    await phase(() => mkdir(web, { recursive: true }));
    await phase(() => mkdir(core, { recursive: true }));
    let coordinatedCore: Awaited<ReturnType<typeof readCoordinatedCoreProof>> | undefined;
    if (options.observeBinding) {
      const reader = await import('./productionBuildBindingObserver.mjs');
      coordinatedCore = await phase(() => reader.readCoordinatedCoreProof(originalRoot, options.observeBinding!.runId));
    }
    for (const path of ['src', 'public', 'scripts', 'licenses', 'package.json', 'astro.config.mjs', 'tsconfig.json']) {
      await phase(() => cp(join(originalWeb, path), join(web, path), { recursive: true, dereference: true }));
    }
    await phase(() => cp(join(originalCore, 'package.json'), join(core, 'package.json')));
    if (coordinatedCore) {
      const actualPackage = await phase(() => readFile(join(core, 'package.json')));
      if (!actualPackage.equals(coordinatedCore.packageBytes)) throw new Error('Browser binding coordinated core proof mismatch: copied package');
      await phase(() => mkdir(join(core, 'dist')));
      for (const directory of ['browser', 'node'])
        await phase(() => cp(join(coordinatedCore.outputDirectory, directory), join(core, 'dist', directory), { recursive: true }));
      const copied = (await phase(() => pins(join(core, 'dist'), check))).map((item) => ({ ...item, path: item.path.split(sep).join('/') }));
      copied.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      if (JSON.stringify(copied) !== JSON.stringify(coordinatedCore.proof.outputs)) throw new Error('Browser binding coordinated core proof mismatch: copied outputs');
    }
    await phase(() => mkdir(join(core, 'src/lib'), { recursive: true }));
    await phase(() => cp(join(originalCore, 'src/lib/onnx-assets.json'), join(core, 'src/lib/onnx-assets.json')));
    for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      await phase(() => cp(join(originalRoot, path), join(tree, path)));
    }
    for (const name of ['skill', 'cli-skill', 'mcp-skill']) {
      await phase(() => mkdir(join(tree, 'packages', name), { recursive: true }));
      await phase(() => cp(join(originalRoot, 'packages', name, 'skill.md'), join(tree, 'packages', name, 'skill.md')));
    }
    await phase(() => mkdir(join(web, 'test/fixtures'), { recursive: true }));
    for (const name of ['ProductionCatalogHarness.svelte', 'ProductionCatalogRoute.astro.txt']) {
      await phase(() => cp(join(originalWeb, 'test/fixtures', name), join(web, 'test/fixtures', name)));
    }
    await phase(() => mkdir(join(web, 'src/pages/acceptance'), { recursive: true }));
    await phase(() => cp(join(web, 'test/fixtures/ProductionCatalogRoute.astro.txt'), join(web, 'src/pages/acceptance/catalog.astro')));
    const inputs = await phase(() => pins(tree, check));
    if (options.observeBinding) for (const item of inputs) item.path = item.path.split(sep).join('/');
    // Real node_modules roots own default caches. Preserve installed dependency,
    // pnpm and bin entries; exclude only the named runtime-cache directories.
    const dependencyLinks: { source: string; target: string; names: string[] }[] = [];
    for (const [source, target] of [[originalWeb, web], [originalCore, core], [originalRoot, tree]]) {
      const sourceModules = join(source, 'node_modules');
      const targetModules = join(target, 'node_modules');
      await phase(() => mkdir(targetModules));
      const entries = await phase(() => readdir(sourceModules, { withFileTypes: true }));
      const names = entries.map((entry) => entry.name).filter((name) => !['.astro', '.vite', '.vite-temp', '.cache'].includes(name)).sort();
      for (const name of names) {
        const sourceEntry = join(sourceModules, name);
        const entry = await phase(() => stat(sourceEntry));
        if (!entry.isDirectory() && !entry.isFile()) throw new Error('Unsupported installed dependency entry.');
        if (coordinatedCore && name === '@wyreup') {
          const scope = join(targetModules, name);
          await phase(() => mkdir(scope));
          for (const child of await phase(() => readdir(sourceEntry))) {
            const target = child === 'core' ? core : join(sourceEntry, child);
            await phase(() => symlink(target, join(scope, child), 'dir'));
          }
        } else await phase(() => symlink(sourceEntry, join(targetModules, name), entry.isDirectory() ? 'dir' : 'file'));
      }
      dependencyLinks.push({ source: sourceModules, target: targetModules, names });
    }
    const commands: string[][] = [];
    const buildLogs: string[] = [];
    async function execute(args: string[]) {
      const index = commands.length;
      commands.push(args);
      const log = join(evidence, `${basename(tree)}-build-${index}.log`);
      buildLogs.push(log);
      check();
      const handle = await open(log, 'wx');
      try {
        check();
        await runOwnedChild(args, web, handle.fd, index);
      } finally { await handle.close(); }
    }
    const generatedConfig = join(web, CACHE_CONFIG_NAME);
    let configBody = CACHE_CONFIG_BODY;
    let observerInput: { path: string; bytes: number; sha256: string } | undefined;
    let templateBinding: unknown;
    let durableConfig: { path: string; bytes: number; sha256: string } | undefined;
    let copiedObserver: string | undefined;
    if (options.observeBinding && bindingDirectory) {
      const observerTarget = join(web, 'test/productionBuildBindingObserver.mjs');
      copiedObserver = observerTarget;
      await phase(() => cp(join(originalWeb, 'test/productionBuildBindingObserver.mjs'), observerTarget));
      const observerBytes = await phase(() => readFile(copiedObserver!));
      await execute(['--check', copiedObserver]);
      observerInput = { path: relative(tree, copiedObserver).split(sep).join('/'), bytes: observerBytes.length, sha256: sha256(observerBytes) };
      const literals = { runId: options.observeBinding.runId, observationDir: bindingDirectory,
        observerIdentity: { relativePath: 'packages/web/test/productionBuildBindingObserver.mjs', bytes: observerBytes.length, sha256: sha256(observerBytes) } };
      configBody = BINDING_CONFIG_TEMPLATE.replace('__WYREUP_BINDING_OPTIONS_JSON__', () => JSON.stringify(literals));
      const sourceBytes = await phase(() => readFile(join(originalWeb, 'test/productionBrowserHarness.ts')));
      templateBinding = { declaration: 'BINDING_CONFIG_TEMPLATE', marker: '__WYREUP_BINDING_OPTIONS_JSON__', literals,
        originalRoot, evidenceRelative: `docs/catalog-artifacts/${options.observeBinding.runId}/build-evidence`,
        producerPathConvention: sep === '/' ? 'posix' : 'win32',
        helperSource: { path: 'packages/web/test/productionBrowserHarness.ts', bytes: sourceBytes.length, sha256: sha256(sourceBytes) } };
    }
    await phase(() => writeFile(generatedConfig, configBody, { flag: 'wx' }));
    if (bindingDirectory) {
      const actualConfig = await phase(() => readFile(generatedConfig));
      if (!actualConfig.equals(Buffer.from(configBody))) throw new Error('Browser binding generated-config template mismatch');
      const durablePath = join(bindingDirectory, 'generated-config.mjs.txt');
      await phase(() => writeFile(durablePath, actualConfig, { flag: 'wx' }));
      const durableBytes = await phase(() => readFile(durablePath));
      if (!durableBytes.equals(actualConfig)) throw new Error('Browser binding generated-config template mismatch');
      durableConfig = { path: relative(originalRoot, durablePath).split(sep).join('/'), bytes: durableBytes.length, sha256: sha256(durableBytes) };
    }
    // Immediately syntax-check the newly generated JavaScript before any build.
    await execute(['--check', generatedConfig]);
    await execute([join(web, 'scripts/copy-skills.mjs')]);
    const preparedInputs = bindingDirectory ? (await phase(() => preparedPins(tree, check))).map((item) => ({ ...item, path: item.path.split(sep).join('/') })) : undefined;
    const dependencies = bindingDirectory ? await phase(() => dependencyIdentities(dependencyLinks, check)) : undefined;
    await execute([join(originalWeb, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', web, '--config', CACHE_CONFIG_NAME, '--force']);
    const coreAfter = await phase(() => pins(join(originalCore, 'dist'), check));
    const preservedAfter: Awaited<ReturnType<typeof optionalDirectoryPins>>[] = [];
    for (const directory of preservedPaths) preservedAfter.push(await phase(() => optionalDirectoryPins(directory, check)));
    const afterGuardPath = join(evidence, `${basename(tree)}-original-after.json`);
    await phase(() => writeFile(afterGuardPath, JSON.stringify({ coreDist: coreAfter, preserved: preservedAfter }, null, 2) + '\n', { flag: 'wx' }));
    if (JSON.stringify(coreBefore) !== JSON.stringify(coreAfter) || JSON.stringify(preservedBefore) !== JSON.stringify(preservedAfter)) {
      throw new Error('Original cache/dist changed during production fixture build.');
    }
    const artifacts = await phase(() => pins(join(web, 'dist'), check));
    if (!artifacts.some((artifact) => artifact.path === 'acceptance/catalog/index.html')) {
      throw new Error('Production fixture build omitted the controlled acceptance route artifact.');
    }
    const generatedInput = { path: relative(tree, generatedConfig), bytes: Buffer.byteLength(configBody), sha256: sha256(Buffer.from(configBody)) };
    if (options.observeBinding) {
      generatedInput.path = generatedInput.path.split(sep).join('/');
      for (const artifact of artifacts) artifact.path = artifact.path.split(sep).join('/');
    }
    const manifest = { kind: 'temporary-real-Astro-controlled-route', inputs, generatedInputs: [generatedInput], dependencyLinks, coreDist: coreAfter, preserved: preservedAfter, beforeGuardPath, afterGuardPath, artifacts, commands, cwd: web, buildLogs, started, deadline, aliases: [] };
    if (options.observeBinding && bindingDirectory && observerInput && copiedObserver && durableConfig) {
      const actualConfig = await phase(() => readFile(generatedConfig));
      const actualObserver = await phase(() => readFile(copiedObserver));
      if (!actualConfig.equals(Buffer.from(configBody)) || actualObserver.length !== observerInput.bytes || sha256(actualObserver) !== observerInput.sha256)
        throw new Error('Browser binding generated-config template mismatch');
      const records = await phase(() => pins(bindingDirectory, check));
      if (!records.some((record) => record.path === 'terminal.json')) throw new Error('Incomplete browser build observation');
      Object.assign(manifest, { preparedInputs, dependencyIdentities: dependencies,
        browserBindingObservation: { mode: 'production-source-artifact-context-v1', runId: options.observeBinding.runId,
          observationDir: bindingDirectory, observerInput, durableConfig, templateBinding,
          proofPin: coordinatedCore?.proofPin,
          consumedCoordinatedCoreDist: coordinatedCore ? { packageTarget: relative(tree, core).split(sep).join('/'), outputs: coordinatedCore.proof.outputs } : undefined,
          records: records.map((record) => ({ ...record, path: `${durableConfig.path.slice(0, -'generated-config.mjs.txt'.length)}${record.path}` })), failures: [] } });
      manifest.generatedInputs.push(observerInput);
    }
    const manifestPath = join(evidence, `${basename(tree)}-manifest.json`);
    await phase(() => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }));
    const ownedTree = tree;
    let closed = false;
    return {
      distDir: join(web, 'dist'), manifest: manifestPath,
      async close() {
        if (closed) return;
        closed = true;
        await rm(ownedTree, { recursive: true, force: true });
      },
    };
  } catch (error) {
    throw new Error(`Production fixture build failed; ${owned ? `evidence retained at ${owned}` : 'no owned build tree established'}.`, { cause: error });
  } finally {
    clearTimeout(timer);
    options.callerAbortSignal?.removeEventListener('abort', callerAbort);
  }
}
