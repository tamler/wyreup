import './install-egress.js';
import { setEgressAllowedOrigin } from './egress.js';
import { createDefaultRegistry, toolRunsOnSurface } from '@wyreup/core';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assertPathAllowed } from './paths.js';
import { atomicPublish } from './atomic-publish.js';
import type { WorkerJob, WorkerResult } from './worker-types.js';

const TEXT_OUTPUT_CAP = 10 * 1024 * 1024; // 10 MB per [spec §#8]

function inferMimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain',
    html: 'text/html',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function runJob(job: WorkerJob): Promise<WorkerResult> {
  // The egress lock installed at import time defaults to the hardcoded Pro
  // origin (https://wyreup.com). Narrow it to the trusted job.proOrigin so Pro
  // tools reach the origin the parent validated. proOrigin arrives via IPC and
  // is NOT settable through the worker's scrubbed env — an attacker who only
  // controls env cannot use this to broaden egress.
  if (job.proOrigin) setEgressAllowedOrigin(job.proOrigin);
  const registry = createDefaultRegistry();
  const tool = registry.toolsById.get(job.toolId);
  if (!tool || !toolRunsOnSurface(tool, 'mcp')) {
    return { ok: false, error: `Unknown tool: ${job.toolId}`, stage: 'validate' };
  }

  // Re-validate every path inside the worker — closes the TOCTOU window per [spec §#1].
  for (const p of job.inputPaths) {
    const r = await assertPathAllowed(p, 'read', job.allowedRoots);
    if (!r.ok) return { ok: false, error: r.error, stage: 'validate' };
  }
  if (job.outputPath) {
    const r = await assertPathAllowed(job.outputPath, 'write', job.allowedRoots);
    if (!r.ok) return { ok: false, error: r.error, stage: 'validate' };
  }
  if (job.outputDir) {
    const r = await assertPathAllowed(job.outputDir, 'write', job.allowedRoots);
    if (!r.ok) return { ok: false, error: r.error, stage: 'validate' };
  }

  // Read inputs.
  const files: File[] = [];
  for (const p of job.inputPaths) {
    try {
      const data = await readFile(p);
      files.push(new File([data], basename(p), { type: inferMimeFromPath(p) }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `read ${p}: ${msg}`, stage: 'read' };
    }
  }

  // Run.
  let result: Blob | Blob[];
  try {
    result = await tool.run(files, job.params, {
      onProgress: () => {},
      signal: job.timeoutMs > 0 ? AbortSignal.timeout(job.timeoutMs) : new AbortController().signal,
      cache: new Map(),
      executionId: randomUUID(),
      apiKey: job.proApiKey,
      proOrigin: job.proOrigin,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, stage: 'run' };
  }

  const outputs = Array.isArray(result) ? result : [result];

  // textOutput inline if (a) single text/json blob AND (b) no output_path/output_dir set
  // AND (c) under TEXT_OUTPUT_CAP.
  if (outputs.length === 1 && !job.outputPath && !job.outputDir) {
    const b = outputs[0]!;
    if (b.type.startsWith('text/') || b.type === 'application/json') {
      const text = await b.text();
      if (Buffer.byteLength(text, 'utf8') <= TEXT_OUTPUT_CAP) {
        return { ok: true, writtenPaths: [], textOutput: text };
      }
      // Fall through to write path below.
    } else {
      // Binary output with no output path — caller must retry with output_path.
      const isMultiple = tool.output.multiple === true;
      return {
        ok: false,
        error: `Tool "${tool.id}" produced binary output but no output_path${isMultiple ? '/output_dir' : ''} was provided. Rerun with an output path.`,
        stage: 'write',
      };
    }
  }

  // Write outputs using atomic publish (symlink-safe, TOCTOU-safe).
  const writtenPaths: string[] = [];

  if (outputs.length === 1 && job.outputPath) {
    const buf = new Uint8Array(await outputs[0]!.arrayBuffer());
    const writeErr = await atomicPublish(job.outputPath, buf, job.allowOverwrite);
    if (writeErr) return { ok: false, error: writeErr, stage: 'write' };
    writtenPaths.push(job.outputPath);
  } else if (job.outputDir) {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/html': '.html',
      'text/markdown': '.md',
      'application/json': '.json',
      'text/csv': '.csv',
      'audio/wav': '.wav',
      'audio/mpeg': '.mp3',
      'video/mp4': '.mp4',
    };
    for (let i = 0; i < outputs.length; i++) {
      const ext = mimeToExt[outputs[i]!.type] ?? '.bin';
      const target = join(job.outputDir, `${job.toolId}-${i}${ext}`);
      const buf = new Uint8Array(await outputs[i]!.arrayBuffer());
      const writeErr = await atomicPublish(target, buf, job.allowOverwrite);
      if (writeErr) return { ok: false, error: writeErr, stage: 'write' };
      writtenPaths.push(target);
    }
  } else {
    // Spill large text to a temp file.
    for (let i = 0; i < outputs.length; i++) {
      const target = join(tmpdir(), `wyreup-mcp-${randomUUID()}.bin`);
      const buf = new Uint8Array(await outputs[i]!.arrayBuffer());
      const writeErr = await atomicPublish(target, buf, true);
      if (writeErr) return { ok: false, error: writeErr, stage: 'write' };
      writtenPaths.push(target);
    }
  }

  return { ok: true, writtenPaths };
}

if (!process.send) {
  process.stderr.write('worker.ts must be spawned via child_process.fork\n');
  process.exit(2);
}

process.once('message', (msg) => {
  const job = msg as WorkerJob;
  void (async () => {
    try {
      const result = await runJob(job);
      process.send!(result);
      process.exit(result.ok ? 0 : 1);
    } catch (err) {
      const m2 = err instanceof Error ? err.message : String(err);
      process.send!({
        ok: false,
        error: `worker uncaught: ${m2}`,
        stage: 'run',
      } satisfies WorkerResult);
      process.exit(1);
    }
  })();
});

process.on('uncaughtException', (err) => {
  process.send?.({
    ok: false,
    error: `uncaught: ${err.message}`,
    stage: 'run',
  } satisfies WorkerResult);
  process.exit(1);
});
