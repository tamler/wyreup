/**
 * `wyreup cache` — inspect and manage the local model cache.
 *
 *   wyreup cache list                show what's downloaded + total size
 *   wyreup cache clear               wipe the cache (with confirmation)
 *   wyreup cache clear --force       skip confirmation
 *
 * The cache is Transformers.js's standard cache directory — typically
 * `~/.cache/huggingface/hub` on macOS/Linux, `%LOCALAPPDATA%\huggingface\hub`
 * on Windows. It's shared with anything else that uses Transformers.js
 * on the same machine.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { stat, readdir, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

interface CacheListOpts {
  json?: boolean;
}

interface CacheClearOpts {
  force?: boolean;
}

function getCacheDir(): string {
  // Transformers.js honors HF_HOME / TRANSFORMERS_CACHE env vars; otherwise
  // defaults to ~/.cache/huggingface/hub on POSIX, %LOCALAPPDATA%\huggingface\hub
  // on Windows. We mirror that resolution.
  const env =
    process.env['TRANSFORMERS_CACHE'] ??
    (process.env['HF_HOME'] ? join(process.env['HF_HOME'], 'hub') : undefined);
  if (env) return env;
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return join(local, 'huggingface', 'hub');
  }
  return join(homedir(), '.cache', 'huggingface', 'hub');
}

async function dirSize(path: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const e of entries) {
    const full = join(path, e.name);
    if (e.isDirectory()) {
      const sub = await dirSize(full);
      bytes += sub.bytes;
      files += sub.files;
    } else if (e.isFile() || e.isSymbolicLink()) {
      try {
        const s = await stat(full);
        bytes += s.size;
        files += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return { bytes, files };
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function cacheListCommand(opts: CacheListOpts): Promise<void> {
  const dir = getCacheDir();

  let exists = true;
  try {
    await stat(dir);
  } catch {
    exists = false;
  }

  if (!exists) {
    if (opts.json) {
      console.log(JSON.stringify({ path: dir, exists: false, models: [] }, null, 2));
    } else {
      console.log(`Cache: ${dir}`);
      console.log('(empty — no models downloaded yet)');
    }
    return;
  }

  // Transformers.js caches each model as `models--<org>--<repo>` under
  // the hub directory. Walk one level deep to get per-model totals.
  const models: { id: string; bytes: number; files: number }[] = [];
  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    /* keep models empty */
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (!name.startsWith('models--')) continue;
    const id = name.replace(/^models--/, '').replace(/--/g, '/');
    const sub = await dirSize(join(dir, name));
    models.push({ id, bytes: sub.bytes, files: sub.files });
  }

  models.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = models.reduce((acc, m) => acc + m.bytes, 0);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          path: dir,
          exists: true,
          totalBytes,
          models: models.map((m) => ({ id: m.id, bytes: m.bytes, files: m.files })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Cache: ${dir}`);
  if (models.length === 0) {
    console.log('(empty — no models downloaded yet)');
    return;
  }
  console.log(`Total: ${fmtBytes(totalBytes)} across ${models.length} model${models.length === 1 ? '' : 's'}\n`);
  for (const m of models) {
    console.log(`  ${fmtBytes(m.bytes).padStart(8)}  ${m.id}`);
  }
}

export async function cacheClearCommand(opts: CacheClearOpts): Promise<void> {
  const dir = getCacheDir();

  let stats;
  try {
    stats = await dirSize(dir);
  } catch {
    console.log(`Cache: ${dir}`);
    console.log('(empty — nothing to clear)');
    return;
  }

  if (stats.bytes === 0) {
    console.log('(empty — nothing to clear)');
    return;
  }

  console.log(`Cache: ${dir}`);
  console.log(`Will remove ${fmtBytes(stats.bytes)} across ${stats.files} files.`);

  if (!opts.force) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question('Continue? [y/N] ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  try {
    await rm(dir, { recursive: true, force: true });
    console.log('Cleared.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to clear cache: ${msg}`);
    process.exitCode = 1;
  }
}
