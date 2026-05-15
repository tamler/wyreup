# @wyreup/mcp

## 0.5.0

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
- Updated dependencies [6d8214a]
- Updated dependencies [a93afa8]
- Updated dependencies [bb025af]
  - @wyreup/core@0.5.0

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
