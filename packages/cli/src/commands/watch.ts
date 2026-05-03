import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { basename, join, resolve, sep, extname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import chokidar from 'chokidar';
import { createDefaultRegistry, runChain, parseChainString, serializeChain } from '@wyreup/core';
import type { ToolRunContext } from '@wyreup/core';
import { inferMimeFromPath, extFromMime } from '../lib/mime.js';

// ──── options ─────────────────────────────────────────────────────────────────

export interface WatchOptions {
  steps?: string;
  fromUrl?: string;
  fromKit?: string;
  name?: string;
  outDir?: string;
  concurrency?: number;
  followSymlinks?: boolean;
  allowSystem?: boolean;
  verbose?: boolean;
  /**
   * Stop the watcher after this many files have finished (succeeded or
   * failed). Skipped files don't count. Useful for piloting a chain on
   * a few files before letting it run on a bulk drop.
   */
  maxFiles?: number;
}

interface KitChainStep {
  toolId: string;
  params: Record<string, unknown>;
}
interface KitChain {
  id: string;
  name: string;
  steps: KitChainStep[];
}

// ──── chain loaders (mirror chain.ts) ─────────────────────────────────────────

function extractStepsFromUrl(input: string): string {
  try {
    const url = new URL(input);
    const steps = url.searchParams.get('steps');
    if (steps) return decodeURIComponent(steps);
    throw new Error('No "steps" query parameter in URL');
  } catch {
    if (input.startsWith('steps=')) return decodeURIComponent(input.slice('steps='.length));
    return input;
  }
}

async function loadFromKit(path: string, nameOrId: string): Promise<string> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Kit file must be a JSON array of chains: ${path}`);
  }
  const chains = parsed as KitChain[];
  const needle = nameOrId.trim().toLowerCase();
  const exactId = chains.find((c) => c.id === nameOrId);
  if (exactId) return serializeChain(exactId.steps);
  const exactName = chains.filter((c) => c.name.toLowerCase() === needle);
  if (exactName.length === 1) return serializeChain(exactName[0]!.steps);
  if (exactName.length > 1) throw new Error(`Multiple chains named "${nameOrId}" in kit file.`);
  const partial = chains.filter((c) => c.name.toLowerCase().includes(needle));
  if (partial.length === 1) return serializeChain(partial[0]!.steps);
  throw new Error(`No unique chain matching "${nameOrId}" in ${path}.`);
}

// ──── path-scope guard ────────────────────────────────────────────────────────

/**
 * Disallow watching system directories or the user's whole home dir
 * unless --allow-system is passed. Watching `/` or `$HOME` would queue
 * every dotfile change for the rest of forever.
 */
function isSystemPath(absPath: string): boolean {
  const home = homedir();
  const blocked = [
    '/',
    home,
    '/etc', '/usr', '/var', '/bin', '/sbin',
    '/System', '/Library', '/private', '/Applications',
    'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
  ];
  for (const b of blocked) {
    // Exact match OR `b` followed by a path separator (don't block /etcd because of /etc)
    if (absPath === b) return true;
    if (b !== '/' && absPath === b + sep) return true;
  }
  return false;
}

// ──── MIME helpers ────────────────────────────────────────────────────────────

function mimeMatches(fileMime: string, accept: string[]): boolean {
  if (accept.length === 0 || accept.includes('*/*')) return true;
  for (const a of accept) {
    if (a === fileMime) return true;
    if (a.endsWith('/*')) {
      const prefix = a.slice(0, -2);
      if (fileMime.startsWith(prefix + '/')) return true;
    }
  }
  return false;
}

// ──── concurrency-bounded queue ───────────────────────────────────────────────

class WorkQueue {
  private inFlight = 0;
  private queue: Array<() => Promise<void>> = [];
  private drainResolvers: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  add(task: () => Promise<void>): void {
    this.queue.push(task);
    this.kick();
  }

  size(): number {
    return this.queue.length + this.inFlight;
  }

  /** Resolves once all queued + in-flight tasks finish. */
  drain(): Promise<void> {
    if (this.size() === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainResolvers.push(resolve));
  }

  private kick(): void {
    while (this.inFlight < this.limit && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.inFlight++;
      void task().finally(() => {
        this.inFlight--;
        if (this.size() === 0) {
          for (const r of this.drainResolvers) r();
          this.drainResolvers = [];
        }
        this.kick();
      });
    }
  }
}

// ──── runner ──────────────────────────────────────────────────────────────────

export async function executeWatch(
  watchPath: string,
  opts: WatchOptions,
): Promise<void> {
  // Resolve chain
  let rawSteps = '';
  if (opts.fromKit) {
    if (!opts.name) {
      process.stderr.write('--from-kit requires --name <chain-name>.\n');
      process.exit(1);
    }
    rawSteps = await loadFromKit(opts.fromKit, opts.name);
  } else if (opts.fromUrl) {
    rawSteps = extractStepsFromUrl(opts.fromUrl);
  } else {
    rawSteps = opts.steps ?? '';
  }

  if (!rawSteps.trim()) {
    process.stderr.write('Provide --steps "tool1|tool2", --from-url <url>, or --from-kit <kit.json> --name <chain-name>.\n');
    process.exit(1);
  }

  const chain = parseChainString(rawSteps);
  if (chain.length === 0) {
    process.stderr.write('Chain is empty after parsing.\n');
    process.exit(1);
  }

  // Validate every step against the registry up-front so we fail fast,
  // not on the first inbound file event.
  const registry = createDefaultRegistry();
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!;
    if (!registry.toolsById.has(step.toolId)) {
      process.stderr.write(`Unknown tool in step ${i + 1}: "${step.toolId}"\n`);
      process.exit(1);
    }
  }

  // Resolve and validate the watch path
  const absWatch = resolve(watchPath);
  try {
    const st = await stat(absWatch);
    if (!st.isDirectory()) {
      process.stderr.write(`Not a directory: ${absWatch}\n`);
      process.exit(1);
    }
  } catch {
    process.stderr.write(`Directory not found: ${absWatch}\n`);
    process.exit(1);
  }

  if (isSystemPath(absWatch) && !opts.allowSystem) {
    process.stderr.write(
      `Refusing to watch ${absWatch} — looks like a system or home directory.\n` +
      `Pass --allow-system to override (you almost certainly don't want to).\n`,
    );
    process.exit(1);
  }

  // Output directory inside the watched folder. Default name avoids
  // colliding with anything plausible. Files written here are always
  // skipped by the watcher (recursion guard below).
  const outDirName = opts.outDir ?? '_wyreup-out';
  const absOut = resolve(absWatch, outDirName);
  await mkdir(absOut, { recursive: true });

  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 2));
  const queue = new WorkQueue(concurrency);

  // Recently-written outputs — TTL-based skip set so events fired
  // because we wrote a file don't loop back into a chain run.
  const recentlyWritten = new Map<string, number>();
  const RECENT_TTL_MS = 30_000;
  function markWritten(path: string) {
    recentlyWritten.set(path, Date.now());
  }
  function wasRecentlyWritten(path: string): boolean {
    const t = recentlyWritten.get(path);
    if (t === undefined) return false;
    if (Date.now() - t > RECENT_TTL_MS) {
      recentlyWritten.delete(path);
      return false;
    }
    return true;
  }

  // First-step accept MIME — used to skip irrelevant files (.DS_Store
  // etc.) before we do any work.
  const firstTool = registry.toolsById.get(chain[0]!.toolId)!;
  const firstStepAccept = firstTool.input.accept ?? ['*/*'];

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let aborting = false;

  const ac = new AbortController();
  const log = (msg: string) => process.stderr.write(`[watch] ${msg}\n`);

  // Validate --max-files. parseInt of garbage returns NaN; treat any
  // non-positive number as "no limit" so we don't immediately exit.
  const maxFiles =
    opts.maxFiles !== undefined &&
    Number.isFinite(opts.maxFiles) &&
    opts.maxFiles > 0
      ? Math.floor(opts.maxFiles)
      : undefined;

  function reachedLimit(): boolean {
    return maxFiles !== undefined && processed + failed >= maxFiles;
  }

  // Forward declaration so handleFile/queue tasks can call shutdown when
  // the cap is hit. The actual binding is set further down.
  let triggerShutdown: () => void = () => {};

  // ──── handle one file event ────────────────────────────────────────────────

  function handleFile(absPath: string): void {
    // Recursion guard: anything inside the output dir, or a path we
    // just wrote, gets ignored.
    if (absPath.startsWith(absOut + sep) || absPath === absOut) return;
    if (wasRecentlyWritten(absPath)) return;

    // Once --max-files has been reached, drop new events on the floor.
    // The shutdown path will close the watcher, but events between the
    // cap-hit and `watcher.close()` resolving still arrive here.
    if (reachedLimit()) return;

    const name = basename(absPath);

    // Dotfiles (incl. .DS_Store, .git/*, .lock) are skipped.
    if (name.startsWith('.')) { skipped++; return; }

    const mime = inferMimeFromPath(absPath);
    if (!mimeMatches(mime, firstStepAccept)) {
      skipped++;
      if (opts.verbose) log(`skip ${name} (mime ${mime} doesn't match)`);
      return;
    }

    queue.add(async () => {
      // Re-check the cap at execution time. A burst of events may have
      // queued more files than the cap — those tasks abort here without
      // doing any I/O.
      if (reachedLimit()) return;

      const start = Date.now();
      try {
        const bytes = await readFile(absPath);
        const file = new File([bytes], name, { type: mime });

        const ctx: ToolRunContext = {
          onProgress: opts.verbose
            ? (p) => {
                const pct = p.percent !== undefined ? ` ${p.percent}%` : '';
                process.stderr.write(`[watch] ${name} [${p.stage}]${pct}${p.message ? ' ' + p.message : ''}\n`);
              }
            : () => {},
          signal: ac.signal,
          cache: new Map(),
          executionId: randomUUID(),
        };

        const outputs = await runChain(chain, [file], ctx, registry);
        const blob = outputs[0];
        if (!blob) throw new Error('chain produced no output');

        const ext = extFromMime(blob.type) || extname(name);
        const baseStem = name.replace(/\.[^.]+$/, '') || name;
        const outPath = join(absOut, `${baseStem}${ext}`);

        await writeFile(outPath, Buffer.from(await blob.arrayBuffer()));
        markWritten(outPath);

        const dur = Date.now() - start;
        // Log path + size + duration only — never file bodies.
        log(`done ${name} → ${basename(outPath)} (${blob.size} B, ${dur} ms)`);
        processed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        log(`fail ${name}: ${msg}`);
      } finally {
        if (reachedLimit() && !aborting) {
          log(`reached --max-files=${String(maxFiles)} — shutting down`);
          triggerShutdown();
        }
      }
    });
  }

  // ──── chokidar setup ──────────────────────────────────────────────────────

  log(`watching ${absWatch}`);
  log(`chain: ${chain.map((s) => s.toolId).join(' → ')}`);
  log(`outputs: ${absOut}/`);
  log(`concurrency: ${concurrency}`);
  log(`accepts: ${firstStepAccept.join(', ') || '*/*'}`);
  if (maxFiles !== undefined) log(`max files: ${String(maxFiles)} (will exit after that many runs)`);
  log(`Ctrl-C to stop.`);

  const watcher = chokidar.watch(absWatch, {
    ignoreInitial: true,
    followSymlinks: opts.followSymlinks ?? false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
    ignored: [
      // Always ignore the output dir, dotfiles, and common temp suffixes.
      absOut,
      /(^|[/\\])\../,
      /\.tmp$/i,
      /\.swp$/i,
      /\.DS_Store$/,
    ],
  });

  watcher.on('add', (path) => { handleFile(path); });

  watcher.on('error', (err) => {
    log(`watcher error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // ──── graceful shutdown ───────────────────────────────────────────────────

  const shutdown = async () => {
    if (aborting) return;
    aborting = true;
    log(`shutting down — draining ${queue.size()} in-flight…`);
    // Close the watcher first so no new events arrive. Don't abort the
    // signal here — in-flight work should finish naturally. (SIGINT is a
    // separate path that does abort.)
    await watcher.close();
    await queue.drain();
    log(`done. processed=${processed} failed=${failed} skipped=${skipped}`);
    process.exit(0);
  };

  triggerShutdown = () => { void shutdown(); };

  const sigShutdown = async () => {
    // Same as shutdown but also aborts in-flight work, so Ctrl-C is snappy.
    if (aborting) return;
    ac.abort();
    await shutdown();
  };

  process.on('SIGINT', () => { void sigShutdown(); });
  process.on('SIGTERM', () => { void sigShutdown(); });
}
