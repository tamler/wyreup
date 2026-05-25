---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Comprehensive security hardening across the toolkit. Full design + threat model in `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md`; this release applies the full plan plus follow-ups from two external security reviews.

**`@wyreup/mcp`** — nine defense-in-depth layers around tool execution:

- **Process isolation** — every tool call (free + Pro) runs in a `child_process.fork` worker. Native-binding SIGSEGV cannot take down the server. Worker spawns with a strict env allowlist (no `NODE_OPTIONS`, no `LD_PRELOAD`, no `WYREUP_API_KEY`; Pro bearer passed via IPC). `execArgv` filtered to a vetted allowlist (no `--inspect`, `--require`, etc.). Disable for debugging via `WYREUP_DISABLE_WORKER_ISOLATION=1`.
- **Path allowlist** — `input_paths` / `output_path` / `output_dir` resolved via `fs.realpath` and prefix-checked against `WYREUP_ALLOW_PATHS` (default: CWD + `os.tmpdir()`; `*` disables). Worker re-validates immediately before each `fs` op to close the TOCTOU window. Symlink-escape blocked. Resolved allowed roots logged to stderr at startup.
- **Atomic, symlink-safe output writes** — `atomicPublish` writes to `<target>.tmp.<pid>-<uuid>` with `O_EXCL`, then publishes via `rename` (overwrite mode) or `link` (exclusive-create mode). Symlinks at the target rejected via `lstat` in **both** modes — `open(target, 'w')` is never called. Published files have mode `0o600` (owner-only).
- **Per-tool timeout** — `timeout_ms` on every tool, default 300 000, range [1, 3 600 000]; `0` requires `WYREUP_ALLOW_DISABLE_TIMEOUT=1`. Strict validation rejects NaN / Infinity / negative / fractional. No kill timer scheduled when timeout disabled.
- **Capability annotations** — MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every tool listing so clients (e.g. Claude Code) can drive approval UI. `wyreup_chain` advertises worst-case annotations.
- **Input / intermediate / output size caps** — aggregate `WYREUP_MAX_INPUT_BYTES` (default 500 MB) checked at three points.
- **Audit log** — opt-in JSONL via `WYREUP_AUDIT_LOG` (file created mode `0o600`); strict mode via `WYREUP_AUDIT_REQUIRED=1`. `params` intentionally excluded from records.
- **Bearer-token sanitizer** — wraps every error output path. Redacts the literal API key plus `Bearer <token>` patterns.
- **`fetch` egress lock** — `globalThis.fetch` restricted to `WYREUP_ORIGIN`. Manual-redirect handling: cross-origin 3xx blocked, 5-hop max. Installed via side-effect import in the bin entry so no module captures the original fetch first. Disable with `WYREUP_DISABLE_EGRESS_LOCK=1`.

Schema invariant: every tool exposes `input_paths`, `params`, `timeout_ms`, `allow_overwrite`, plus `output_path` or `output_dir`. No other path-bearing field. CI-enforced.

**Behavioral change:** outputs no longer silently overwrite. Pass `allow_overwrite: true` to preserve old behavior. Symlink targets are rejected regardless of `allow_overwrite`.

**`@wyreup/cli`** — symmetric defenses for the shell surface:

- `atomicPublish` replaces 5 plain `writeFile` call sites in `run` and `chain`. Same symlink rejection and atomic publish semantics as MCP.
- `--overwrite` flag (default false), `--timeout <ms>` flag (same validation as MCP).
- Multi-origin egress lock — allows both `WYREUP_ORIGIN` (default `https://wyreup.com`) and `WYREUP_MODEL_CDN` (default `https://models.wyreup.com`).
- Bearer-token sanitizer wired through `printError` helper; applied to `executeTool`, `executeChain`, and `balance` error paths.

**`@wyreup/core`** — parser-level hardening and per-tool budgets:

- **New module `lib/budget.ts`** — exports `BudgetExceededError`, `assertPdfPageBudget`, `assertDurationBudget`, `assertDimensionsBudget`. New optional `Tool.budget?: ToolBudget` field.
- **New module `lib/zip-safety.ts`** — exports `MAX_ZIP_ENTRIES` (50 000), `MAX_ZIP_UNCOMPRESSED_BYTES` (4 GB), `sanitizeZipEntryName`, `assertEntryBudget`, `assertDeclaredSizeBudget`, `ZipSafetyError`.
- **Archive bomb defenses** — `zip-extract`, `zip-flatten`, `zip-remove`, `zip-info` enforce: entry-count cap (50 000), aggregate uncompressed cap (4 GB), filename sanitization (strips leading slashes, drops `..` traversal, normalizes Windows separators, blocks null-byte tricks). Enforcement runs **before decompression** via declared `uncompressedSize` + **per-chunk during stream** via `entry.internalStream()` — bytes never accumulate in heap before the cap fires.
- **PDF page-count budgets** declared on 27 tools — `chat-long-pdf-pro` / `pdf-q-and-a` / `pdf-summarize` / `pdf-suspicious` get 500 (LLM-backed, per-page cost is huge); `pdf-compress` / `pdf-flatten` / `rotate-pdf` / `pdf-redact` / extraction tools get 2 000; metadata / split / merge tools get 5 000.
- **Audio / video duration budgets** declared on 7 tools — `transcribe` / `convert-audio` / `extract-audio` get 4 hr; `audio-enhance` / `convert-video` / `compress-video` / `burn-subtitles` get 2 hr. Probe runs after the existing duration-known step, before the transform.
- Adversarial lock-down tests for `parseChainString` — pin the threat model so a future refactor cannot silently add regex (ReDoS), eval-like coercion (RCE), or nested-object coercion (prototype pollution).

**Cross-cutting follow-ups from two external security reviews:**

- `__Host-` cookie prefix on the session cookie (was `wyreup_session`, now `__Host-wyreup_session`). Browser-enforced invariants for `Secure` + `Path=/` + no `Domain`.
- `X-Wyreup-CSRF: 1` header gate on every state-changing cookie-authed POST endpoint (`tools/pro/run`, `account/keys`, `account/keys/revoke`, `account/signout`, `credits/checkout`, `admin/grant`). Bearer-authed callers (CLI / MCP) bypass — cookies aren't in play.
- `/api/tools/pro/run` error sanitization — raw `String(err)` no longer returned to the client. Generic message + `requestId` (the spend ledger ID, already in scope) for operator correlation.
- Cap of 10 active (non-revoked) keys per user — closes the persistence vector if a session or key is compromised.
- PWA share-intake cache: per-file 100 MB cap, timestamp + 10-minute TTL sweep on service-worker `activate` and at every `handleShareTarget`. Backstop for the `/share-receive` page failing to clean up.
- Triggers system **G5** — confirmed-bypass now disabled for chains containing Pro tools (`tool.cost === 'credit'`). The preview sheet always shows for Pro-tool chains so the user sees the network-egress disclosure before any byte reaches `wyreup.com`. Same pattern as G4's high-suspicion-verdict force.
- `worker-models` ships streaming SHA-256 manifest verification via Cloudflare's `crypto.DigestStream` — no memory cap, every cached model size including `m2m100_418M` (~1 GB) is verified. R2 cache write passes the stream directly (no chunk buffering). Mismatch deletes the just-uploaded R2 object.

**Documented non-defenses** in `SECURITY.md`: raw `node:http` / `node:net` / native-extension sockets; tool-spawned subprocesses; DNS-channel exfiltration; MCP clients ignoring capability annotations; image-dimension per-tool budgets (sharp / jsquash internal limits cover the practical surface).
