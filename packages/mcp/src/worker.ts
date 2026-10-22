import './install-egress.js';
import { setEgressAllowedOrigins } from './egress.js';
import { createDefaultRegistry, setModelCdn, toolRunsOnSurface } from '@wyreup/core';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertPathAllowed } from './paths.js';
import { atomicPublish } from './atomic-publish.js';
import type { WorkerJob, WorkerResult } from './worker-types.js';
import { readCanonicalFileBounded } from './bounded-file-read.js';

const TEXT_OUTPUT_CAP = 10 * 1024 * 1024; // 10 MB per [spec §#8]

function inferMimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    nef: 'image/tiff',
    psd: 'image/vnd.adobe.photoshop',
    stl: 'model/stl',
    pdf: 'application/pdf',
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    xml: 'application/xml',
    css: 'text/css',
    js: 'text/javascript',
    sql: 'application/sql',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function runJob(job: WorkerJob, clientSignal: AbortSignal): Promise<WorkerResult> {
  const signal = job.timeoutMs > 0
    ? AbortSignal.any([clientSignal, AbortSignal.timeout(job.timeoutMs)]) : clientSignal;
  signal.throwIfAborted();
  // Both values arrive over IPC from the parent rather than the scrubbed worker
  // environment. Configure the same model routing and narrow egress policy used
  // by in-process tools and chains before constructing the registry.
  setModelCdn(job.modelCdn);
  setEgressAllowedOrigins([job.proOrigin, ...job.modelAllowedOrigins]);
  const registry = createDefaultRegistry();
  const tool = registry.toolsById.get(job.toolId);
  if (!tool || !toolRunsOnSurface(tool, 'mcp')) {
    return { ok: false, error: `Unknown tool: ${job.toolId}`, stage: 'validate' };
  }

  // Re-validate every path inside the worker — closes the TOCTOU window per [spec §#1].
  const resolvedInputPaths: string[] = [];
  for (const p of job.inputPaths) {
    const r = await assertPathAllowed(p, 'read', job.allowedRoots);
    if (!r.ok) return { ok: false, error: r.error, stage: 'validate' };
    resolvedInputPaths.push(r.resolved);
  }
  let resolvedOutputPath: string | undefined;
  if (job.outputPath) {
    const r = await assertPathAllowed(job.outputPath, 'write', job.allowedRoots);
    if (!r.ok) return { ok: false, error: r.error, stage: 'validate' };
    resolvedOutputPath = r.resolved;
  }
  let resolvedOutputDir: string | undefined;
  if (job.outputDir) {
    const r = await assertPathAllowed(job.outputDir, 'write-directory', job.allowedRoots);
    if (!r.ok) return { ok: false, error: r.error, stage: 'validate' };
    resolvedOutputDir = r.resolved;
  }

  // Read only the canonical paths returned by validation. Reject directories
  // writable by another OS identity, bind each read to one O_NOFOLLOW handle,
  // and verify the pathname still names that handle before reading.
  const files: File[] = [];
  let totalInputBytes = 0;
  for (const p of resolvedInputPaths) {
    try {
      const data = await readCanonicalFileBounded(p, job.maxBytes - totalInputBytes);
      totalInputBytes += data.byteLength;
      files.push(new File([data], basename(p), { type: inferMimeFromPath(p) }));
    } catch (err) {
      if (err instanceof RangeError) {
        return {
          ok: false,
          error: `Input size exceeds limit ${(job.maxBytes / 1024 / 1024).toFixed(0)} MB. Raise WYREUP_MAX_INPUT_BYTES if intentional.`,
          stage: 'validate',
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `read ${p}: ${msg}`, stage: 'read' };
    }
  }

  // Run.
  let result: Blob | Blob[];
  try {
    result = await tool.run(files, job.params, {
      onProgress: () => {},
      signal,
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
  signal.throwIfAborted();

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

  // Write outputs with protected-parent and identity checks. Processes sharing
  // this server's uid are inside its trust boundary.
  const writtenPaths: string[] = [];

  if (outputs.length === 1 && resolvedOutputPath) {
    const buf = new Uint8Array(await outputs[0]!.arrayBuffer());
    const writeErr = await atomicPublish(resolvedOutputPath, buf, job.allowOverwrite, {}, signal);
    if (writeErr) return { ok: false, error: writeErr, stage: 'write' };
    writtenPaths.push(resolvedOutputPath);
  } else if (resolvedOutputDir) {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/x-icon': '.ico',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg',
      'image/tiff': '.tiff',
      'image/vnd.adobe.photoshop': '.psd',
      'model/stl': '.stl',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/html': '.html',
      'text/markdown': '.md',
      'application/json': '.json',
      'text/csv': '.csv',
      'text/tab-separated-values': '.tsv',
      'application/xml': '.xml',
      'text/css': '.css',
      'text/javascript': '.js',
      'application/javascript': '.js',
      'application/sql': '.sql',
      'audio/wav': '.wav',
      'audio/mpeg': '.mp3',
      'video/mp4': '.mp4',
    };
    for (let i = 0; i < outputs.length; i++) {
      const ext = mimeToExt[outputs[i]!.type] ?? '.bin';
      const target = join(resolvedOutputDir, `${job.toolId}-${i}${ext}`);
      const buf = new Uint8Array(await outputs[i]!.arrayBuffer());
      const writeErr = await atomicPublish(target, buf, job.allowOverwrite, {}, signal);
      if (writeErr) return { ok: false, error: writeErr, stage: 'write' };
      writtenPaths.push(target);
    }
  } else {
    // Spill large text to a temp file.
    const canonicalTempDir = await realpath(tmpdir());
    for (let i = 0; i < outputs.length; i++) {
      const target = join(canonicalTempDir, `wyreup-mcp-${randomUUID()}.bin`);
      const buf = new Uint8Array(await outputs[i]!.arrayBuffer());
      const writeErr = await atomicPublish(target, buf, true, {}, signal);
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

const cancellation = new AbortController();
process.once('SIGTERM', () => cancellation.abort(new Error('Tool request cancelled.')));
process.once('message', (msg) => {
  const job = msg as WorkerJob;
  void (async () => {
    try {
      const result = await runJob(job, cancellation.signal);
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
