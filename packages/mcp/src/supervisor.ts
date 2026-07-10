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
  try {
    statSync(sibling);
    return sibling;
  } catch {
    /* ignore */
  }
  try {
    statSync(distPath);
    return distPath;
  } catch {
    /* ignore */
  }
  return sibling; // last resort — let fork fail with a clear error
})();

const STDERR_CAP = 8 * 1024; // [spec §#8] — 8 KB ring buffer
const KILL_GRACE_MS = 5_000; // SIGTERM → SIGKILL grace

const ALLOWED_EXEC_ARGV = new Set(['--enable-source-maps']);

export function scrubbedEnv(): NodeJS.ProcessEnv {
  // Strict allowlist of environment variables passed to the worker. Anything
  // not in this list — including dynamic loader controls (LD_PRELOAD,
  // LD_LIBRARY_PATH, DYLD_INSERT_LIBRARIES, DYLD_LIBRARY_PATH), Node controls
  // (NODE_OPTIONS, NODE_EXTRA_CA_CERTS), TLS overrides (SSL_CERT_FILE,
  // SSL_CERT_DIR), and the Pro bearer (WYREUP_API_KEY) — is dropped.
  // The Pro key reaches Pro tools via the WorkerJob IPC payload, never env.
  // WYREUP_DISABLE_EGRESS_LOCK is deliberately NOT carried: the worker holds
  // the Pro key and must ALWAYS install the egress lock, regardless of the
  // parent's env. Forwarding it would hand an attacker a ready-made
  // "no egress restriction" path inside the very process that handles the key.
  // A dev who wants to disable egress can do so in the PARENT only.
  //
  // WYREUP_ORIGIN is also NOT carried: the worker's egress allowlist must not
  // be settable from the worker's own env, or an attacker who controls env
  // could re-point it to broaden egress. The worker installs the lock from the
  // hardcoded default (https://wyreup.com) at import time, then narrows it to
  // the trusted WorkerJob.proOrigin (delivered via IPC, validated parent-side)
  // in runJob() — see worker.ts / egress.setEgressAllowedOrigin.
  const CARRY: readonly string[] = [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'WYREUP_ALLOW_PATHS',
    'WYREUP_MAX_INPUT_BYTES',
    // Explicit LC_* allowlist — previously a prefix wildcard. Locale vars
    // are needed for libraries that format numbers/dates/text by user locale
    // (sharp, ffmpeg, etc.). Tighten to the standard POSIX set so an
    // attacker can't sneak a custom LC_<garbage> variable through.
    'LC_ALL',
    'LC_CTYPE',
    'LC_COLLATE',
    'LC_MESSAGES',
    'LC_MONETARY',
    'LC_NUMERIC',
    'LC_TIME',
    'LC_PAPER',
    'LC_NAME',
    'LC_ADDRESS',
    'LC_TELEPHONE',
    'LC_MEASUREMENT',
    'LC_IDENTIFICATION',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of CARRY) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
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
    const finalize = (r: SupervisorResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

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
          error:
            tt === 'timeout'
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
      finalize({
        ok: false,
        error: `Worker spawn failed: ${err.message}`,
        stage: 'run',
        stderr: stderrBuf,
      });
    });

    child.send(job);
  });
}
