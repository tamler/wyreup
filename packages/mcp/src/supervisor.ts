import { fork, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { WorkerJob, WorkerResult } from './worker-types.js';

// Resolve worker path relative to the running module. After build this lands
// next to dist/index.js as dist/worker.js. In dev with tsx/vitest, import.meta.url
// points at src/supervisor.ts, so we fall back to ../dist/worker.js.
const WORKER_PATH = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, 'worker.js');
  const distPath = join(here, '..', 'dist', 'worker.js');
  try { statSync(sibling); return sibling; } catch { /* ignore */ }
  try { statSync(distPath); return distPath; } catch { /* ignore */ }
  return sibling; // last resort — let fork fail with a clear error
})();

const STDERR_CAP = 8 * 1024;   // [spec §#8] — 8 KB ring buffer
const KILL_GRACE_MS = 5_000;   // SIGTERM → SIGKILL grace

const ALLOWED_EXEC_ARGV = new Set(['--enable-source-maps']);

function scrubbedEnv(): NodeJS.ProcessEnv {
  const carry = [
    'PATH', 'HOME', 'TMPDIR', 'LANG',
    'WYREUP_DISABLE_EGRESS_LOCK', 'WYREUP_ALLOW_PATHS',
    'WYREUP_MAX_INPUT_BYTES', 'WYREUP_ORIGIN',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of carry) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LC_')) env[k] = process.env[k];
  }
  // Explicitly NOT carried: NODE_OPTIONS, WYREUP_API_KEY (Pro key passed via IPC).
  return env;
}

function filteredExecArgv(): string[] {
  return process.execArgv.filter((a) => ALLOWED_EXEC_ARGV.has(a.split('=')[0]!));
}

export type SupervisorResult = WorkerResult & { stderr: string };

export async function runInWorker(job: WorkerJob): Promise<SupervisorResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = fork(WORKER_PATH, [], {
      silent: true,
      env: scrubbedEnv(),
      execArgv: filteredExecArgv(),
    });

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      if (stderrBuf.length > STDERR_CAP) stderrBuf = stderrBuf.slice(-STDERR_CAP);
    });

    let settled = false;
    const finalize = (r: SupervisorResult) => { if (!settled) { settled = true; resolve(r); } };

    let killTimer: NodeJS.Timeout | undefined;
    let sigkillTimer: NodeJS.Timeout | undefined;
    if (job.timeoutMs > 0) {
      killTimer = setTimeout(() => {
        child.kill('SIGTERM');
        sigkillTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      }, job.timeoutMs + 1000);
    }

    child.once('message', (msg) => {
      const result = msg as WorkerResult;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      finalize({ ...result, stderr: stderrBuf });
    });

    child.once('exit', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (!settled) {
        const tt = signal === 'SIGKILL' || signal === 'SIGTERM' ? 'timeout' : 'crash';
        finalize({
          ok: false,
          error: tt === 'timeout'
            ? `Tool worker timed out (signal ${signal}). Raise timeout_ms.`
            : `Tool worker crashed (exit=${code}, signal=${signal}).`,
          stage: 'run',
          stderr: stderrBuf,
        });
      }
    });

    child.once('error', (err) => {
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      finalize({ ok: false, error: `Worker spawn failed: ${err.message}`, stage: 'run', stderr: stderrBuf });
    });

    child.send(job);
  });
}
