# wyreup-mcp hardening — design

**Date:** 2026-05-24
**Owner:** Tamler
**Status:** approved (round 2), implementation greenlit
**Scope:** `packages/mcp` only

## Goal

Close the gaps in wyreup-mcp's tool-execution surface: the agent currently passes absolute paths the server trusts, has no per-tool timeouts, no size limits, no overwrite protection, no capability hints for the client to use in approvals, no audit trail, no crash isolation between tools, and no network egress restriction. Defense-in-depth across all of these.

## Non-goals

- Kernel-level sandboxing (seccomp, chroot, Landlock) — out of scope for a Node MCP server
- Per-tool RBAC — single API key model stays
- Encryption at rest, key rotation, multi-tenant auth — Pro auth model is unchanged
- Anything outside `packages/mcp`. Tool registry from `packages/core` is consumed as-is; per-tool metadata (e.g. idempotency) lives in an MCP-local override map.

## Schema invariant (do not break)

The MCP layer's input schema is closed and stable: path-bearing fields are `input_paths[]`, `output_path`, and `output_dir`. All other fields under `params` carry JSON values (numbers, strings, booleans, nested config) and MUST NOT carry filesystem paths. Tools receive `(files: File[], params: Record<string, unknown>, ctx)` and have no general fs access to anything in `params`. This is what makes path allowlisting (#1) complete: there is no second path channel to forget. Any future tool that needs additional input/output paths must extend the MCP schema, at which point path validation extends with it.

## Threat model (what this defends against)

| Threat | Defense |
| --- | --- |
| Agent writes to `~/.ssh/authorized_keys` or other sensitive path | Path allowlist (#1) + atomic exclusive create (#4) |
| Agent OOMs the host by loading huge file | Input/intermediate/output size cap (#5) |
| Compromised dependency exfiltrates via `fetch` | Egress lock (#9) — fetch-only, see Security limitations |
| Tool hangs forever, blocks server | Per-tool timeout (#3) |
| Agent silently clobbers user files | Overwrite protection via `O_EXCL` (#4) |
| Operator cannot reconstruct what ran | Audit log (#6) |
| Native binding crashes whole server | Crash isolation via `child_process.fork` (#8) |
| MCP client cannot tell which tools are network-bound / non-idempotent | Capability annotations (#2) |
| Bearer token leaks into error output | No-key-in-errors (#7) |
| TOCTOU: symlink swapped between path validation and worker I/O | Worker revalidates with `assertPathAllowed` before each fs call |

## Security limitations (what this does NOT defend against)

- **Raw socket egress:** the egress lock patches `globalThis.fetch` only. Direct use of `node:http`, `node:https`, `node:net`, `node:tls`, `node:dgram`, or native-extension sockets is NOT intercepted. A compromised dependency that uses raw sockets can still exfiltrate. Audit finding from `packages/core` shows no current tool uses raw http; this is a forward-looking limitation.
- **Subprocesses:** a tool that spawns its own child process can ignore every defense in this spec. Cog/Replicate-style tools don't apply here (Pro = remote call); free tools in the registry use libraries, not subprocesses.
- **DNS exfiltration:** allowed origin still resolves DNS; a compromised dependency could encode data in DNS queries.
- **Filesystem races outside the allowlist boundary:** if `/tmp` itself is hostile (another user with write access), our defenses inside it are best-effort.
- **The MCP client itself:** approvals and capability hints are advisory. A client that ignores `openWorldHint` can still call Pro tools.

## Architecture overview

```
ListTools  ──> emits per-tool annotations (#2) — Pro filtered if no API key (unchanged)

CallTool ──> path validation (#1) + size cap pre-check (#5) + overwrite check (#4)
          ──> child_process.fork('worker.js') for BOTH free and Pro (#8)
                 ├─ worker installs egress lock at startup (#9)
                 ├─ worker re-validates paths before each fs call (#1 defense)
                 ├─ worker imports registry, runs tool.run(...)
                 ├─ worker writes output via tmp+link/rename (#4, #13)
                 └─ worker exits; main reads {ok|error|textOutput} via IPC

Around the dispatch: timeout (#3), audit-log write (#6), error sanitization (#7).
```

Both free and Pro tools fork. Pro tools' fork overhead (~50–100 ms) is invisible against typical 5–60 s remote-call runtimes, and the unified path removes the "what if Pro tool adds preprocessing" footgun.

Escape hatch `WYREUP_DISABLE_WORKER_ISOLATION=1` runs everything in-process for debugging.

## Layer-by-layer design

### #1 Path allowlist

**Config:** `WYREUP_ALLOW_PATHS` — colon-separated absolute paths. `*` disables (escape hatch). Default: `process.cwd()` + `os.tmpdir()`.

**Startup normalization:** at server boot, each configured root is resolved via `fs.realpath` (resolves symlinks once, canonicalizes case on case-insensitive filesystems, strips trailing separators). Roots that don't exist log a stderr warning and are dropped. The resolved allowed-roots list is logged to stderr at startup so operators can audit what's actually allowed:
```
wyreup MCP: allowed paths: /Users/jacob/Projects/foo, /private/var/folders/.../T
```

**Validation function** (`packages/mcp/src/paths.ts`):
```ts
export async function assertPathAllowed(
  p: string,
  intent: 'read' | 'write',
  allowed: string[] | '*',
): Promise<{ ok: true; resolved: string } | { ok: false; error: string }>
```
- Reject relative paths up-front (require absolute)
- For `read`: `fs.realpath(p)`, prefix-check against allowed roots
- For `write`: `fs.realpath(path.dirname(p))`, prefix-check
- Prefix check: `resolved === root || resolved.startsWith(root + path.sep)` (no `/tmp` matching `/tmpfoo`)
- On reject: clear error with the resolved path and the allowed list

Called for every `input_paths[i]`, `output_path`, and `output_dir` in the main process before fork, AND re-called in the worker immediately before each `open()` to close the TOCTOU window.

### #2 MCP capability annotations

`ListTools` response includes per-tool MCP `annotations`:
```ts
annotations: {
  readOnlyHint: false,             // we always write at least one output
  destructiveHint: false,          // we never modify inputs in place
  idempotentHint: <per-tool>,      // see override map
  openWorldHint: tool.cost === 'credit',
}
```

**MCP-local idempotency override** (`packages/mcp/src/idempotency.ts`):
```ts
// Default: assume idempotent. List non-idempotent tools by id.
const NON_IDEMPOTENT_TOOLS = new Set([
  'chat-long-pdf-pro', 'image-generate-pro', 'text-summarize',
  // ...any tool whose output depends on stochastic LLM/diffusion output
]);
```
No change to `packages/core` types. The list is reviewed when tools are added/removed.

`wyreup_chain` annotations: `idempotentHint: false`, `openWorldHint: true` (defensive worst-case at list time).

### #3 Per-tool timeout

Add to every tool's `inputSchema`:
```ts
timeout_ms: {
  type: 'number',
  description: 'Max runtime in ms. Default 300000 (5 min). Range [1, 3600000]. 0 disables — requires WYREUP_ALLOW_DISABLE_TIMEOUT=1.'
}
```

Validation:
- Non-finite (NaN/Infinity), negative, or fractional → reject
- `0` and `WYREUP_ALLOW_DISABLE_TIMEOUT !== '1'` → reject with hint
- Clamp upper bound to 3_600_000 (1 hour)

Enforcement: `AbortSignal.timeout(timeout_ms)` passed to worker via job message.
- If `timeout_ms > 0`: main process runs `setTimeout(() => worker.kill('SIGTERM'), timeout_ms + 1000)`; after 5 s grace, `SIGKILL`.
- If `timeout_ms === 0` (and env permit present): **no kill timer scheduled**. The worker runs to completion or until the MCP client disconnects.

### #4 Overwrite protection (atomic, symlink-safe)

Add to every tool's `inputSchema`:
```ts
allow_overwrite: {
  type: 'boolean',
  description: 'Overwrite existing output files. Default false.'
}
```

**The worker NEVER opens `target` directly for writing.** All writes go through a tmp file in the same directory, then are atomically published. This closes both the access-then-write TOCTOU and the symlink-as-target attack (`/allowed/foo` → `/etc/passwd`):

1. Write the full output to `<target>.tmp.<pid>-<seq>` opened with `'wx'` (O_CREAT|O_EXCL — won't collide with another worker's tmp).
2. Publish:
   - `allow_overwrite === true`: `fs.rename(tmp, target)`. POSIX `rename` replaces a symlink entry rather than following it, so a malicious symlink at `target` is overwritten as a directory entry — the symlink's target is untouched.
   - `allow_overwrite !== true`: `fs.link(tmp, target)`. Atomic exclusive create — fails `EEXIST` if `target` exists (including if it's a symlink). Then `fs.unlink(tmp)`.
3. On any failure between step 1 and step 2: `fs.unlink(tmp)`.

**Symlink defense-in-depth:** before step 2, `fs.lstat(target)` and reject if the result indicates a symlink, regardless of `allow_overwrite`. The reviewer's concern with overwrite mode was that opening `target` with `'w'` follows symlinks; we don't do that, but the explicit lstat-and-reject removes any doubt and keeps both modes symmetric on this dimension.

Multi-output (`output_dir`): same pattern per file. Tmp suffix includes a monotonic sequence so concurrent outputs from one worker don't collide.

**Cross-platform note:** `fs.link` for atomic exclusive create works on macOS, Linux, and NTFS. Documented as macOS/Linux-first; Windows-NTFS works but is not covered by CI.

### #5 Size caps

**Config:** `WYREUP_MAX_INPUT_BYTES` (default `500 * 1024 * 1024`, 500 MB). Applies to:
- Aggregate `input_paths` size (`fs.stat` sum, checked before reading)
- Total intermediate Blob size in chains (checked between chain steps)
- Aggregate output size (checked before writing each output)

One env var, three checkpoints, same limit. Error: `Size <n> MB exceeds limit <m> MB at <stage>. Raise WYREUP_MAX_INPUT_BYTES if intentional.`

### #6 Audit log

**Config:** `WYREUP_AUDIT_LOG` — absolute path to a JSONL file. Unset = no logging.

**File handling:**
- File created with mode `0o600` (operator-owner-only).
- Append-only `fs.appendFile` per call. No rotation.

**Per-call record (success or failure):**
```json
{
  "ts": "2026-05-24T14:00:00.000Z",
  "tool": "compress",
  "input_paths": ["/a.jpg"],
  "output_path": "/b.jpg",
  "status": "ok",
  "duration_ms": 1234
}
```
Failure adds `"error": "<sanitized message>"`. **`params` is intentionally excluded** (may contain user prompts / PII). **Paths are included** — operator opted in by setting the env var and accepts that.

**Strict mode:** if `WYREUP_AUDIT_REQUIRED=1` AND `WYREUP_AUDIT_LOG` is set, an audit-write failure fails the tool call. Default is loose: audit failures stderr-log only.

### #7 No-key-in-errors

**Pre-implementation audit step:** `grep -rn 'apiKey\|WYREUP_API_KEY\|Bearer' packages/mcp packages/core` before writing any sanitizer code. Document findings.

If no leak path exists, ship a no-op `sanitize()` that we wire through anyway so the plumbing exists for future regressions.

Sanitizer scope (when active):
- Replace literal API key with `[REDACTED]`
- Replace `Bearer <token>` patterns (case-insensitive) with `Bearer [REDACTED]`

Out of scope (paranoid, no realistic attack vector today): URL-encoded variants, base64 variants, generic `Authorization:` headers in arbitrary strings.

Applied to every `errorResult(...)` and every audit `error` field.

### #8 Crash isolation (`child_process.fork`)

**New file:** `packages/mcp/src/worker.ts`.

**Worker path resolution:** at runtime, resolved relative to the running module via `fileURLToPath(import.meta.url)` so it works for both `dist/server.js` (production) and ts-node-style dev runs. Path stored once at startup.

**Spawn:**
```ts
const child = fork(workerPath, [], {
  silent: true,                          // capture stdout/stderr
  env: scrubbedEnv(),                    // see below
  execArgv: process.execArgv,            // preserve --experimental-vm-modules, etc.
});
```

**Env scrubbing** (`scrubbedEnv()`):
- Carry: `PATH`, `HOME`, `TMPDIR`, `WYREUP_DISABLE_EGRESS_LOCK`, `WYREUP_ALLOW_PATHS`, `WYREUP_MAX_INPUT_BYTES`, `WYREUP_ORIGIN`, locale vars (`LANG`, `LC_*`)
- **Drop `NODE_OPTIONS`:** an attacker who can set `NODE_OPTIONS=--require ./evil.js` in the MCP server's env would otherwise preload arbitrary code into every worker. We don't carry it through. If a developer legitimately needs node flags during dev/test, they belong in `execArgv` below.
- **Drop `WYREUP_API_KEY`** for all worker spawns. For Pro tools, the key is passed via the `WorkerJob` IPC message so it never appears in `/proc/<pid>/environ`.

**`execArgv` filtering:** instead of passing `process.execArgv` verbatim, pass only a vetted allowlist: `--enable-source-maps`. Other flags (`--inspect`, `--inspect-brk`, `--require`, `--import`) are explicitly NOT carried because they enable preload or open debugger ports in the worker.

**stdio handling:**
- `silent: true` routes worker stdout/stderr to pipes the parent owns; IPC has its own channel.
- Parent drains worker stderr into a **bounded** ring buffer (max 8 KB; older bytes drop). This prevents a chatty tool from producing a 20 MB audit line or pegging memory.
- **Default policy:** worker stderr is captured but only **emitted on failure** (included in `errorResult` and audit `error` field, sanitized). On success it's discarded. Opt-in: `WYREUP_AUDIT_STDERR_ON_SUCCESS=1` includes the (capped, sanitized) stderr in the success audit line as `worker_stderr`.
- This prevents both accidental secret logging from reaching the MCP client and runaway audit growth.

**Worker protocol (IPC via `process.send`):**

Main → worker:
```ts
type WorkerJob = {
  toolId: string;
  inputPaths: string[];        // pre-validated by main
  params: Record<string, unknown>;
  outputPath?: string;
  outputDir?: string;
  timeoutMs: number;           // 0 if disabled (only with env permit)
  proApiKey?: string;          // Pro tools only
  proOrigin: string;
  allowedRoots: string[] | '*';
  allowOverwrite: boolean;
  maxBytes: number;
};
```

Worker → main:
```ts
type WorkerResult =
  | { ok: true; writtenPaths: string[]; textOutput?: string }
  | { ok: false; error: string; stage: 'validate' | 'read' | 'run' | 'write' };
```

**`textOutput` cap:** 10 MB. If exceeded, worker writes to `<os.tmpdir()>/wyreup-mcp-<uuid>.txt` and returns the path in `writtenPaths` instead.

**Worker startup sequence:**
1. Install egress lock (#9)
2. Import registry
3. Wait for `WorkerJob` message
4. Re-validate `inputPaths` and `outputPath`/`outputDir` using passed `allowedRoots`
5. Read inputs (size cap enforced)
6. Run `tool.run(...)` with `AbortSignal.timeout(timeoutMs)`
7. Write outputs atomically (#4, #13)
8. Send `WorkerResult`, exit 0
9. Top-level uncaught exception → send `{ok:false, error, stage}`, exit 1
10. SIGTERM: best-effort cleanup of `.tmp.<pid>` files in target dirs, exit 1

**Main supervision:**
- `setTimeout(timeoutMs + 1000) → SIGTERM`, +5 s → SIGKILL
- Listen for `message` (result), `exit` (unexpected → `errorResult('worker crashed exit=<code> sig=<sig>')` + cleanup any `.tmp.<pid>` files belonging to the dead worker in the target dirs), `error` (spawn failure)
- `clearTimeout` + remove listeners on every termination path

**Escape hatch:** `WYREUP_DISABLE_WORKER_ISOLATION=1` runs in-process. For debugging only.

### #9 Network egress lock

**New file:** `packages/mcp/src/egress.ts`:
```ts
const INSTALLED = Symbol.for('@wyreup/mcp/egress-installed');
const MAX_REDIRECTS = 5;

export function installEgressLock(allowedOrigin: string): void {
  if ((globalThis as any)[INSTALLED]) return;
  (globalThis as any)[INSTALLED] = true;

  const allowed = new URL(allowedOrigin).origin;
  const original = globalThis.fetch;

  async function locked(input: RequestInfo | URL, init: RequestInit = {}, hops = 0): Promise<Response> {
    const url = toUrl(input);
    if (url.origin !== allowed) throw new EgressBlockedError(url.origin, allowed);

    const userRedirect = init.redirect ?? 'follow';
    const response = await original(input, { ...init, redirect: 'manual' });

    if (response.status >= 300 && response.status < 400 && userRedirect === 'follow') {
      if (hops >= MAX_REDIRECTS) throw new EgressBlockedError('max-redirects', allowed);
      const loc = response.headers.get('location');
      if (!loc) return response;
      const next = new URL(loc, response.url);
      if (next.origin !== allowed) throw new EgressBlockedError(next.origin, allowed);
      return locked(next, init, hops + 1);
    }
    if (response.status >= 300 && response.status < 400 && userRedirect === 'error') {
      throw new TypeError('redirect not allowed');
    }
    return response;
  }

  globalThis.fetch = locked as typeof fetch;
}
```

**Install order is enforced via a bin entry point.** `packages/mcp/bin/wyreup-mcp.js`:
```js
import { installEgressLock } from '../dist/egress.js';
installEgressLock(process.env.WYREUP_ORIGIN ?? 'https://wyreup.com');
import('../dist/server.js').then(({ main }) => main());
```
And the same pattern at the top of `worker.ts`. Modules that capture `fetch` as a local reference at module-load time will see the patched version because the lock installs before any other import resolves.

**Scope:** see Security limitations. fetch-only.

**Origin matching:** by `URL.origin` (scheme + host + port). Different ports = different origins. Paths/query don't matter.

**Redirect handling:** the wrapper forces `redirect: 'manual'` on the underlying call, then inspects the response:
- 2xx/4xx/5xx (terminal): return as-is.
- 3xx with `Location` header: parse the location against `response.url`. If the resolved origin matches `allowed`, recurse into the wrapper (re-checks origin, follows max 5 hops). If it doesn't match, throw `EgressBlockedError`.
- If the caller explicitly passed `init.redirect`, we honor it: `'manual'` returns the 3xx response directly; `'error'` throws on any 3xx; `'follow'` (default) is what our wrapper implements above. A naive wrapper that just inspects the initial URL would NOT block cross-origin redirects — without this manual-follow loop the egress lock is bypassable by any allowed-origin endpoint that 302s elsewhere.

**Escape hatch:** `WYREUP_DISABLE_EGRESS_LOCK=1` skips installation.

## File layout

```
packages/mcp/
  bin/wyreup-mcp.js   (new: install egress lock, then import server)
  src/server.ts       (modified: thread allowlist, capability annotations,
                       size cap, timeout, overwrite, audit log, fork dispatcher)
  src/worker.ts       (new: child_process worker for both free and Pro tools)
  src/paths.ts        (new: assertPathAllowed, root normalization)
  src/egress.ts       (new: installEgressLock)
  src/audit.ts        (new: appendAuditLine, sanitizer)
  src/idempotency.ts  (new: NON_IDEMPOTENT_TOOLS override set)
  test/
    paths.test.ts
    egress.test.ts
    overwrite.test.ts
    size-cap.test.ts
    timeout.test.ts
    worker-isolation.test.ts
    audit.test.ts
    chain.test.ts
    annotations.test.ts
    schema-invariant.test.ts
```

No changes to `packages/core`.

## Testing strategy (expanded)

**Path tests** (`paths.test.ts`):
- Absolute outside allowlist → reject
- Traversal `/tmp/../etc/passwd` → reject after realpath
- Symlink-escape (symlink in tmpdir → /etc) → reject
- Configured-root symlink (allowed root is itself a symlink) → normalized at startup, works correctly
- Trailing slash variants → equivalent
- macOS case sensitivity (HFS+/APFS default case-insensitive) → matches
- Nonexistent allowed root → dropped at startup with stderr warning
- Parent directory replaced after main-side validation → worker re-validation catches it
- Output symlink that points outside allowlist → rejected
- **Symlink output inside allowed root pointing outside:** create `/<allowed>/foo → /etc/passwd`, set as `output_path` with `allow_overwrite=false` → fails at lstat-and-reject (or at the link step which sees EEXIST). With `allow_overwrite=true` → still fails at lstat-and-reject. `/etc/passwd` untouched.
- **No-overwrite atomic publish:** existing target, `allow_overwrite=false` → fails with `EEXIST`, target byte-identical to before, tmp file cleaned up
- **Concurrent two-worker race:** two workers attempt `link(tmp, target)` to the same path in parallel → exactly one succeeds, the other gets `EEXIST`, both tmp files cleaned up
- `*` disables → all paths accepted
- CWD accept, tmpdir accept

**Schema invariant tests** (`schema-invariant.test.ts`):
- Every registered tool's `inputSchema.properties` contains `input_paths`, no other path-bearing field, plus `timeout_ms` and `allow_overwrite`
- Annotations present for every tool
- Failing this test means a tool was added with a path field outside the closed schema — caught in CI

**Chain tests** (`chain.test.ts`):
- Mixed free + Pro chain
- Step 2 has a blocked output path → chain errors at validation, no billable work done
- Aggregate size cap counts intermediates: 200 MB input + 400 MB intermediate trips 500 MB cap
- Overwrite conflict in final step → chain errors before write
- One audit record per chain (not per step) with the full chain string
- Chain-level timeout covers slow first step, even if remaining steps are fast

**Worker tests** (`worker-isolation.test.ts`):
- Real free tool (image compress) → output written, worker exits 0
- Tool that calls `process.exit(99)` via stub registry → main sees `errorResult('worker crashed exit=99')`, MCP server still alive
- Tool that throws → main sees structured error with `stage`
- Large `textOutput` (>10 MB) → spilled to tmpdir, path returned
- Stdout/stderr from worker captured; secret leak in stderr is sanitized before audit
- **Stderr cap:** worker writes 20 MB to stderr → stderr ring buffer caps at 8 KB, audit line stays small
- Inherited env scrubbed: worker's `process.env.WYREUP_API_KEY` is undefined for free tools
- **Env attack:** parent process has `NODE_OPTIONS=--require ./evil.js` set; spawn worker; verify `evil.js` did NOT preload (worker globals unchanged)
- Worker startup failure (bad path) → `errorResult` with spawn error
- Timeout → SIGTERM, then SIGKILL after grace; `.tmp.<pid>` files cleaned up
- **No timer when disabled:** `timeout_ms: 0` + permit env → no kill timer scheduled (assert via fake-timer count); long-running stub runs to completion
- Partial output on timeout → cleaned up
- Two simultaneous workers don't see each other's `.tmp.<pid>` files

**Egress tests** (`egress.test.ts`):
- `fetch('https://evil.com')` → `EgressBlockedError`
- `fetch(proOrigin + '/x')` → allowed
- `fetch(new Request('https://evil.com'))` → blocked
- Relative URL → resolved against base, then checked
- **Redirect to disallowed origin:** mock allowed-origin endpoint returning `302 Location: https://evil.com` → wrapper sees the 302, parses Location, throws `EgressBlockedError`. Body of the disallowed request is never sent.
- Redirect chain within allowed origin (3 hops) → followed; 6 hops → `max-redirects` error
- Caller passes `redirect: 'manual'` → 3xx returned verbatim, no follow
- Caller passes `redirect: 'error'` → 3xx throws TypeError
- Module that captures `fetch` at top-level pre-lock → fixed by bin install order
- Pro origin with port mismatch → blocked (different origin)
- `node:http` raw call → NOT blocked (documented limitation)
- `WYREUP_DISABLE_EGRESS_LOCK=1` → lock not installed

**Audit tests** (`audit.test.ts`):
- JSONL append under concurrent calls — no interleaving (each `appendFile` is atomic for small payloads)
- File created with 0600
- Error sanitization: API key in error never appears in audit line
- `WYREUP_AUDIT_REQUIRED=1` + bad path → tool fails
- Default (loose) + bad path → tool succeeds, stderr warning
- `params` never appears in audit
- Malformed `WYREUP_AUDIT_LOG` (not absolute, etc.) → stderr warning, no logging
- **Stderr size cap:** worker emits 20 MB stderr + fails → audit line < 16 KB (8 KB cap on stderr + headroom for envelope)

**Timeout tests** (`timeout.test.ts`):
- Slow tool > limit → timeout error from worker side
- Slow tool > limit + worker ignores SIGTERM → SIGKILL after 5 s
- `timeout_ms: 0` without env permit → reject
- `timeout_ms: 0` with `WYREUP_ALLOW_DISABLE_TIMEOUT=1` → runs to completion
- `timeout_ms: -1`, `NaN`, `Infinity`, `1.5` → reject
- `timeout_ms: 999999999` (over 1 h) → clamped to 1 h

**Annotations tests** (`annotations.test.ts`):
- Every tool's `ListTools` entry has all four annotations
- `openWorldHint` matches `cost === 'credit'`
- `idempotentHint` matches override map
- `wyreup_chain` is `openWorldHint: true, idempotentHint: false`

## Rollout

Single PR per stage, two stages:

**Stage A (additive):** #1, #2, #3, #4, #5, #6, #7 — all merge before any architecture change. Worker isolation off (in-process), egress lock off.

**Stage B (architecture):** #8, #9 — worker + egress lock. Bin entry point added. Stage A's defenses get a second checkpoint inside the worker.

Single npm release at the end: `@wyreup/mcp` minor bump (0.1.0 → 0.2.0).

**Behavioral change (not strictly breaking, but worth flagging in release notes):** `allow_overwrite` defaults to `false`. Existing callers that overwrite output files will get a hard error until they pass `allow_overwrite: true`. The MCP server has no existing public API contract guaranteeing overwrite, but agents/scripts in the wild may rely on the old behavior. Document prominently.

README updates: new env vars table, new schema fields, security model section, escape hatches.

## Open questions — resolved

- **Crash isolation mechanism:** `child_process.fork` (chose true OS isolation over `worker_threads` because native binding SIGSEGV is the actual threat).
- **Isolation scope (Pro vs free):** Pro tools also fork. Removes the "Pro never preprocesses" assumption; cost is invisible at Pro runtimes.
- **Egress lock scope:** fetch-only. Raw http/https is a documented limitation, not a future requirement. Re-evaluate if a tool ever needs raw sockets.
- **Default allow paths:** CWD + tmpdir. Resolved roots logged to stderr at startup so operators can see what's actually permitted.
- **Audit strictness:** opt-in strict via `WYREUP_AUDIT_REQUIRED=1`. Default loose to preserve availability.
- **Disabling timeout:** allowed but gated by `WYREUP_ALLOW_DISABLE_TIMEOUT=1` so an agent can't disable a defense on its own.
- **#7 sanitizer scope:** literal key + `Bearer` pattern. Wider variants (URL-encoded, base64) deferred — no realistic vector today.
- **"Max" cost/benefit:** #7 may show no leak in audit (then ships as no-op plumbing); #8 pays permanent ~50–100 ms per call for crash containment. Both kept per user instruction; flagged for trim review after one release if perf or operational burden warrants.
