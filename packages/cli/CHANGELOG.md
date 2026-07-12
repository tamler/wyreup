# @wyreup/cli

## 0.7.11

### Patch Changes

- Updated dependencies [9fe2e7a]
  - @wyreup/core@0.7.0

## 0.7.10

### Patch Changes

- 9fb5f7b: `wyreup install-skill` works again: the three agent skills (wyreup, wyreup-cli, wyreup-mcp) were deleted from the repo in the May cleanup, leaving every variant fetching a 404. Rewritten from scratch against the current CLI/MCP surface (run/chain/watch grammar, discovery via `wyreup list`, prefetch groups, PRO flow, chainSuggestions) and SHA-256 pins are now enforced end-to-end — SKILL_DEFS carries each file's hash, install-skill verifies it, and a CI test fails on any drift between pins and committed skill files.

## 0.7.9

### Patch Changes

- Updated dependencies [174011f]
  - @wyreup/core@0.6.9

## 0.7.8

### Patch Changes

- Updated dependencies [42a4e90]
  - @wyreup/core@0.6.8

## 0.7.7

### Patch Changes

- Updated dependencies [e763e4b]
  - @wyreup/core@0.6.7

## 0.7.6

### Patch Changes

- Updated dependencies [955165a]
  - @wyreup/core@0.6.6

## 0.7.5

### Patch Changes

- Updated dependencies [d1191e4]
  - @wyreup/core@0.6.5

## 0.7.4

### Patch Changes

- 69fa8a4: Follow-up hardening: linear indexOf-based comment stripping in css/xml/html-clean formatters, backslash escaping in openapi-report table cells, bounded money regex in pdf-extract-data, formula-backed Date headers stringify correctly again in Excel-to-JSON, and install-skill's local read is race-free and FreeBSD-correct via open+fstat.
- Updated dependencies [69fa8a4]
  - @wyreup/core@0.6.4

## 0.7.3

### Patch Changes

- Updated dependencies [61af8e9]
  - @wyreup/core@0.6.3

## 0.7.2

### Patch Changes

- 5861f16: Update runtime dependencies to current majors: tesseract.js ^7.0.0 and gpt-tokenizer ^3.4.0 in core, commander ^15.0.0 in the CLI. No API changes; full test suite passes on the new versions.
- 8b8bff3: Security hardening: password-generator now draws characters and shuffles with rejection-sampled unbiased randomness (a bare modulo over getRandomValues skewed toward low charset indices), and install-skill reads local --source files without a stat-then-read TOCTOU window.
- Updated dependencies [5861f16]
- Updated dependencies [b556b2e]
- Updated dependencies [8b8bff3]
  - @wyreup/core@0.6.2

## 0.7.1

### Patch Changes

- 5b603dc: Security hardening from a full-platform review.
  - **html-to-pdf**: sandbox the render iframe (`allow-same-origin` without `allow-scripts`) so untrusted HTML can no longer execute scripts in the page origin, while preserving html2canvas screenshotting.
  - **markdown-to-html**: escape raw embedded HTML and neutralize `javascript:`/`data:`/`vbscript:` link hrefs (marked 15 does not strip these by default) to prevent XSS, especially when chained into html-to-pdf.
  - **csv-to-excel / json-to-excel**: defang spreadsheet formula injection by prefixing cell values that begin with `= + - @` (or tab/CR) so they import as literal text.
  - **regex tools**: reject catastrophic-backtracking (ReDoS) patterns and cap pattern length before execution.
  - **preflight**: distinguish un-analysed files (oversized / no checker) from genuinely clean ones via a new `unanalysed` verdict.
  - **MCP egress lock**: the key-holding worker now always installs the lock and derives its allowlist from the IPC-delivered, parent-validated origin; the disable flag and origin override are no longer forwarded into the worker, and the test-only reset is inert outside tests.
  - **MCP chains**: enforce per-step and cumulative size caps on intermediate outputs to prevent memory exhaustion.
  - **CLI**: `watch` now writes outputs via the atomic, symlink-safe, 0600 publisher; `login` warns when an API key is passed as a positional argument; `install-skill` enforces content-type, size, and optional SHA-256 integrity checks on fetched skills.

- Updated dependencies [5b603dc]
  - @wyreup/core@0.6.1

## 0.7.0

### Minor Changes

- f2b1c8f: Add 18 ffmpeg.wasm media tools, all client-side and free-tier on the existing ffmpeg core (no new dependencies):
  - Editing: resize-video, mute-video, rotate-video, extract-frame, replace-audio, crop-video, reverse-video, fade-video (in/out), loop-video, letterbox-video, vignette-video, video-volume, video-side-by-side.
  - Audio: normalize-loudness (EBU R128 / ATSC / Spotify / Apple Music / YouTube / Amazon targets), analyze-loudness (LUFS/true-peak report), mix-audio (background music), strip-video-metadata.
  - Measurement: video-quality-metrics (PSNR/SSIM).

  Also fixes discoverability: audio/convert/inspect tools (trim-media, convert-audio, etc.) now carry secondary `categories[]` so they surface under the right filters, and `registry.byCategory` matches `categories[]` so CLI/MCP listings agree with the web catalog.

### Patch Changes

- Updated dependencies [f2b1c8f]
  - @wyreup/core@0.6.0

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

- `--overwrite` flag on `run` and `chain` (default `false`). Output files are no longer silently overwritten — pass `--overwrite` to keep old behavior.
- `--timeout <ms>` flag on `run` and `chain`, default 300000, range [1, 3600000]. `0` requires `WYREUP_ALLOW_DISABLE_TIMEOUT=1`.
- Symlink-safe atomic publishing: refuses to write to a symlink target, regardless of `--overwrite`.
- Fetch egress lock at CLI entry: blocks any `fetch` to origins other than `WYREUP_ORIGIN` (default `https://wyreup.com`) and `WYREUP_MODEL_CDN` (default `https://models.wyreup.com`). Disable with `WYREUP_DISABLE_EGRESS_LOCK=1` or `WYREUP_MODEL_CDN=disabled` (which disables both the model CDN pin and the egress lock — they're coupled because the upstream CDN set isn't enumerable).
- Bearer-token sanitization plumbing on CLI error output paths.

### Security limitations (documented)

- Egress lock covers `fetch` only. Raw `node:http`/`node:https`/`node:net` and native sockets are NOT intercepted.
- See `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md § Security limitations` for the authoritative list — CLI inherits the same limitations as MCP.

### Behavioral changes

- Output files are no longer silently overwritten. Pass `--overwrite` to keep old behavior.

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
