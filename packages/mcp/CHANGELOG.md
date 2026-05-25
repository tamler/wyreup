# @wyreup/mcp

## 0.6.0

### Minor Changes

- 909186d: Self-host every AI model fetch on R2 via `models.wyreup.com`.

  The browser, CLI, and MCP no longer touch huggingface.co,
  cdn.jsdelivr.net, or storage.googleapis.com at runtime. All model
  URLs (face-blur WASM + tflite, audio-enhance ONNX, convert-geo
  gdal3.js bundle, and every transformers.js pipeline) route through
  `models.wyreup.com` — a first-party Cloudflare Worker
  (`packages/worker-models/`) backed by the `wyreup-models` R2 bucket.

  The Worker serves cached objects directly from R2 and lazy-mirrors
  from the original upstream on cache-miss, writing back to R2 in
  the background. Cold-start cost: one upstream fetch per file ever,
  happening server-side inside Cloudflare's network. Hot path:
  first-party R2 origin, no third-party touch.

  Wired automatically in:
  - **Web app** — `BaseLayout.astro` calls `setModelCdn` before any
    tool runner hydrates.
  - **`@wyreup/cli`** — startup; override with `WYREUP_MODEL_CDN=<url>`
    or `WYREUP_MODEL_CDN=disabled` to fall back to upstream CDNs.
  - **`@wyreup/mcp`** — same startup pattern.

  Privacy-scan allow-list updated to remove `jsdelivr.net`,
  `googleapis.com`, and `huggingface.co` — any future code that
  sneaks them back in will now fail `tools/check-privacy.mjs`.

- 3e30ec5: Comprehensive security hardening across the toolkit. Full design + threat model in `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md`; this release applies the full plan plus follow-ups from two external security reviews.

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

- bb025af: Wave T — trigger rules: drop a file, get the right pipeline proposed.

  A trigger rule binds a file MIME pattern to a saved chain. When a
  matching file arrives anywhere on Wyreup, the rule's chain is
  _proposed_ via a preview sheet — never auto-run. The user confirms;
  the chain executes locally.

  **`@wyreup/core` additions** (all new public API):
  - `TriggerRule`, `TriggerKit` types — versioned schema (v1).
  - `matchRule(fileMime, rules, fires)` — pure-function matcher,
    most-specific MIME wins, user-`order` tiebreak, deterministic id
    tiebreak; rate-limit gate is part of the match outcome.
  - `parseTriggerKit`, `serializeTriggerKit` — validates MIME shape,
    rejects bare wildcards. Forward-compat migration shape.
  - `updateTriggerRule(rule, patch)` — enforces G2: meaningful field
    changes re-arm `confirmed: false`. The receiver has to re-approve.
  - `strippedForImport(kit)` — every imported rule lands unconfirmed.
  - `runPreflight(file)` — suspicious-content pre-flight; uses
    text-suspicious / pdf-suspicious depending on MIME. Returns a
    verdict the UI surfaces before showing Run.
  - `readFileHeader(file)` — first 256 bytes + recognised magic
    (PDF / PNG / JPEG / GIF / ZIP-shaped / GZIP / WebP). Helps users
    spot MIME-spoofed files.
  - `validateChain(chain, registry)` — spoof gate. Reports any chain
    step that references a tool ID not in the built-in registry.
  - `DEFAULT_RATE_LIMIT`, `MAX_RATE_LIMIT`, `clampRateLimit`,
    `pruneFires` — flood-prevention helpers.

  **Security model**

  Eight enforced guarantees in code:
  G1 preview before every run, G2 per-rule "don't ask again",
  G3 file_handlers route through the preview, G4 suspicious-file
  pre-flight, G5 no network egress, G6 output-collision reporting,
  G7 per-rule rate limit, G8 spoof gate (only built-in tools run).
  Full spec: docs/triggers-security.md.

  **`@wyreup/cli`**: `--from-kit` flag help updated for the
  "My Kit" → "Toolbelt" rename.

  **`@wyreup/mcp`**: no API surface change; tracks the core minor.

### Patch Changes

- Updated dependencies [490b3d5]
- Updated dependencies [c31656b]
- Updated dependencies [84e2a81]
- Updated dependencies [c0fd450]
- Updated dependencies [a76433d]
- Updated dependencies [909186d]
- Updated dependencies [7adf1f8]
- Updated dependencies [b8a8027]
- Updated dependencies [3e30ec5]
- Updated dependencies [6d8214a]
- Updated dependencies [a93afa8]
- Updated dependencies [bb025af]
  - @wyreup/core@0.5.0

## Unreleased

### Added

- Path allowlist enforcement on `input_paths`, `output_path`, `output_dir`. Configure via `WYREUP_ALLOW_PATHS` (colon-separated absolute paths, `*` to disable). Defaults to CWD + os.tmpdir().
- MCP capability annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every tool listing.
- `timeout_ms` parameter on every tool, default 300000, range [1, 3600000]. `0` requires `WYREUP_ALLOW_DISABLE_TIMEOUT=1`.
- `allow_overwrite` parameter on every tool, default `false`. Atomic+symlink-safe publishing.
- `WYREUP_MAX_INPUT_BYTES` aggregate input size cap (default 500 MB).
- `WYREUP_AUDIT_LOG` opt-in JSONL audit log. Strict mode via `WYREUP_AUDIT_REQUIRED=1`.
- Bearer-token sanitization plumbing on all error paths.

### Behavioral changes

- Output files are no longer silently overwritten. Pass `allow_overwrite: true` to keep old behavior.

### Added (Stage B)

- Free and Pro tools run in a `child_process.fork` worker per call. Worker inherits a scrubbed environment (no `NODE_OPTIONS`, no `WYREUP_API_KEY`); Pro key passed via IPC.
- Fetch egress lock: `globalThis.fetch` accepts only `WYREUP_ORIGIN` (default `https://wyreup.com`). Cross-origin redirects are blocked. Disable with `WYREUP_DISABLE_EGRESS_LOCK=1`.
- Worker isolation can be disabled for debugging via `WYREUP_DISABLE_WORKER_ISOLATION=1`.
- Bounded worker stderr ring buffer (8 KB cap) prevents audit log inflation.

### Security limitations (documented)

- Egress lock covers `fetch` only. Raw `node:http`/`node:https`/`node:net`/native sockets are NOT intercepted.
- Subprocesses spawned by tools are not sandboxed.
- See `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md § Security limitations` for the full list.

## 0.4.0

### Minor Changes

- 72787e1: Architectural cleanup + test backfill.

  **Breaking-but-internal (`@wyreup/core`)**:
  - Removed the vestigial `Component` field from `ToolModule`. The UI lives in
    the web package's runner variants; the field was unused in every tool. The
    re-exported `ComponentType` / `ToolComponentProps` types are removed too.
  - Removed the `presence: 'editor' | 'standalone' | 'both'` field. It was a
    leftover from the original spec and had no consumer.
  - Added `llmDescription?: string` to `ToolModule`. When set, MCP / agent
    surfaces use this in place of the default `${name}: ${description}`.
    Migrated the 7 genuinely-useful overrides; deleted the 57 that were no
    better than the canonical description.

  **`@wyreup/mcp`**:
  - Deleted the 64-entry `TOOL_DESCRIPTIONS` map. Tool descriptions now come
    from the canonical `description` (or `llmDescription` when overridden).

  **`@wyreup/cli`**:
  - `wyreup install-skill --source <path>` flag for local skill dev — reads
    skill.md from a local file or directory instead of fetching from GitHub.

  **Tests**: added a meta-test that iterates the entire default registry and
  verifies structural invariants + smoke-runs every cheap-to-test tool against
  synthetic input. Test count grew from 1,623 to 3,409 — closing the gap on
  the 65 tools that had no per-tool test directory.

  **Docs**: `docs/ARCHITECTURE.md` refreshed to reflect the 189-tool reality,
  OIDC publishing, and the variantMap pattern.

### Patch Changes

- Updated dependencies [72787e1]
  - @wyreup/core@0.4.0

## 0.3.0

### Minor Changes

- 372a312: Add ~70 new tools across five sprints + emergent compositions.

  **Secrets / auth suite:** hmac, base32, base58, totp-code, hotp-code, jwt-sign, signed-url, backup-codes, otpauth-uri, webhook-verify, webhook-replay, signed-cookie-decode, api-key-format, license-key, pgp-armor.

  **Data wrangling:** csv-deduplicate, csv-merge, csv-diff, csv-info, csv-to-json-schema, csv-template (NEW mail-merge — render N documents from a CSV + mustache template), json-flatten, json-unflatten, json-diff, json-path, json-merge (NEW deep-merge with conflict report), json-schema-infer, json-schema-validate, frontmatter-to-csv, yaml-validate, xml-to-json, json-to-xml.

  **Security inspect:** text-confusable, text-redact, text-suspicious (NEW prompt-injection verdict), pdf-suspicious (NEW PDF prompt-injection scanner).

  **Spec validators:** openapi-validate, package-json-validate.

  **Text / HTML:** unicode-info, markdown-toc, markdown-frontmatter, color-contrast, password-strength, text-frequency, text-stats-by-paragraph, morse-code, roman-numeral, mime-detect, url-parse, url-build, url-shorten-local, html-clean, html-extract-links, favicon-from-url, css-minify, html-minify, file-fingerprint, text-template, color-blind-simulator.

  All tools ship as `presence: 'both'` — available in web, CLI (`wyreup run <tool>`), and MCP (`@wyreup/mcp`).

### Patch Changes

- Updated dependencies [372a312]
  - @wyreup/core@0.3.0

## 0.2.0

### Minor Changes

- ebe8507: Initial public release — Wyreup 0.1.0.
  - 72 tools across image, PDF, audio, text/dev, create, and finance categories
  - CLI for shell invocation
  - MCP server for agent integration
  - Agent skill for Claude and skill-compatible runtimes
  - CLI-only agent skill (smaller token footprint, no MCP)
  - MCP-only agent skill (smaller token footprint, no CLI)

### Patch Changes

- Updated dependencies [ebe8507]
  - @wyreup/core@0.2.0
