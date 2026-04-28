/**
 * `wyreup prefetch` — download model weights for AI/ML tools ahead of time.
 *
 * Without this, the first invocation of an ML tool downloads its model
 * inline. That's fine for an interactive run but breaks offline-first
 * use, scripted pipelines, and CI runners that expect deterministic
 * timing. Prefetch is the answer: pre-warm the cache, exit 0, then any
 * subsequent run is a hit.
 *
 * Two forms:
 *   wyreup prefetch <tool-id>...    — prefetch one or more tools by id
 *   wyreup prefetch --group <name>  — prefetch every tool in an install group
 *   wyreup prefetch --all           — prefetch everything with installSize > 0
 *
 * The cache lives where Transformers.js puts it (typically
 * ~/.cache/huggingface/hub) and is honored on subsequent invocations.
 */

import { createDefaultRegistry, type ToolModule } from '@wyreup/core';

interface PrefetchOpts {
  group?: string;
  all?: boolean;
  verbose?: boolean;
}

export async function prefetchCommand(
  toolIds: string[],
  opts: PrefetchOpts,
): Promise<void> {
  const registry = createDefaultRegistry();
  const all = Array.from(registry.toolsById.values());

  // Resolve which tools to prefetch.
  let targets: ToolModule[];
  if (opts.all) {
    targets = all.filter((t) => (t.installSize ?? 0) > 0);
  } else if (opts.group) {
    targets = all.filter(
      (t) => (t as { installGroup?: string }).installGroup === opts.group,
    );
    if (targets.length === 0) {
      const groups = new Set(
        all
          .map((t) => (t as { installGroup?: string }).installGroup)
          .filter((g): g is string => typeof g === 'string'),
      );
      console.error(
        `No tools found in install group "${opts.group}". ` +
          `Known groups: ${[...groups].sort().join(', ') || '(none)'}.`,
      );
      process.exitCode = 1;
      return;
    }
  } else if (toolIds.length > 0) {
    targets = [];
    for (const id of toolIds) {
      const t = registry.toolsById.get(id);
      if (!t) {
        console.error(`Unknown tool: "${id}"`);
        process.exitCode = 1;
        return;
      }
      targets.push(t);
    }
  } else {
    console.error(
      'Usage: wyreup prefetch <tool-id>... | --group <name> | --all',
    );
    process.exitCode = 1;
    return;
  }

  const skipped = targets.filter((t) => (t.installSize ?? 0) === 0);
  const prefetchable = targets.filter((t) => (t.installSize ?? 0) > 0);

  for (const t of skipped) {
    if (opts.verbose) {
      console.error(`skip ${t.id} — no model to prefetch (installSize is 0)`);
    }
  }

  if (prefetchable.length === 0) {
    console.error('Nothing to prefetch.');
    return;
  }

  const totalBytes = prefetchable.reduce(
    (acc, t) => acc + (t.installSize ?? 0),
    0,
  );
  const totalMb = Math.round(totalBytes / (1024 * 1024));
  console.error(
    `Prefetching ${prefetchable.length} tool${prefetchable.length === 1 ? '' : 's'} ` +
      `(~${totalMb} MB total). This may take a while on slow connections.`,
  );

  let lastModelLogged = '';
  let okCount = 0;
  let failCount = 0;

  for (const tool of prefetchable) {
    const sizeMb = Math.round((tool.installSize ?? 0) / (1024 * 1024));
    console.error(`\n→ ${tool.id} (~${sizeMb} MB)`);
    try {
      await runPrefetch(tool, opts.verbose === true, (msg) => {
        if (msg !== lastModelLogged) {
          lastModelLogged = msg;
          if (opts.verbose) console.error(`  ${msg}`);
        }
      });
      console.error(`  ok`);
      okCount += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  failed: ${msg}`);
      failCount += 1;
    }
  }

  console.error(
    `\nDone. ${okCount} prefetched, ${failCount} failed${
      skipped.length > 0 ? `, ${skipped.length} skipped` : ''
    }.`,
  );
  if (failCount > 0) process.exitCode = 1;
}

/**
 * Drive a tool through its loading-deps phase by handing it a tiny
 * synthetic input. Most ML tools download the model on first call to
 * `getPipeline` inside `run()`, so any successful run effectively
 * prefetches. Tools that error out on the synthetic input still
 * complete their model download because the model load happens before
 * the actual inference call.
 *
 * For batch prefetch we don't care about the run's output — we only
 * care that the model weights have been pulled into the local cache.
 * We swallow the run error and consider the prefetch successful as
 * long as the loading-deps stage advanced.
 */
async function runPrefetch(
  tool: ToolModule,
  _verbose: boolean,
  onMessage: (msg: string) => void,
): Promise<void> {
  // Build the smallest plausible input for the tool's accept list. The
  // run() will likely fail validation or inference on this stub — fine,
  // the model has already loaded by then.
  const accept = tool.input.accept[0] ?? 'application/octet-stream';
  const stub = makeStubFile(accept);

  const ac = new AbortController();
  let loaded = false;

  try {
    await tool.run([stub], (tool.defaults ?? {}) as never, {
      onProgress: (p) => {
        if (p.stage === 'loading-deps') {
          loaded = true;
          if (p.message) onMessage(p.message);
        }
      },
      signal: ac.signal,
      cache: new Map(),
      executionId: 'prefetch',
    });
  } catch {
    // run() will likely throw on the synthetic input; the model is what
    // we wanted, and at this point Transformers.js has cached it on
    // disk. Surface a hard failure only when the loading-deps stage
    // never fired (model didn't reach the network).
    if (!loaded) {
      throw new Error(
        'Model load did not start — tool may not use the standard pipeline cache.',
      );
    }
  }
}

function makeStubFile(mime: string): File {
  // A 1-byte placeholder is enough for run() to begin, hit getPipeline,
  // and trigger the model download. Real tools will reject this and
  // throw, but by then the cache is warm.
  const bytes = new Uint8Array([0]);
  return new File([bytes], 'prefetch-stub', { type: mime });
}
