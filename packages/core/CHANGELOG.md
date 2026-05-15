# @wyreup/core

## 0.5.0

### Minor Changes

- 490b3d5: Add `cron-from-text` — generate a cron expression from a natural-language schedule.

  Recognises: `every N minutes/hours/days/weeks/months`, specific times
  (`HH:MM`, 12h with am/pm, `midnight`, `noon`), days of week
  (`monday`–`sunday`, `weekdays`, `weekends`, lists), and days of month
  (`1st`, `last day`).

  Output is JSON with `cron` (5-field), `fields` breakdown,
  `explanation`, `confidence`, `matchedTokens`. Free permanent — no
  LLM, no model. When no heuristic matches, returns `confidence:
'no-match'` with an `upgrade` field for the future hosted-AI fallback.

  Public exports: `cronFromText` (ToolModule), `generateCronFromText`
  (standalone function), types, defaults.

- c31656b: Add `image-to-ascii` — convert any image to ASCII or Unicode-block art.

  Configurable output width (10-400 columns), three character ramps
  (standard 70-char Paul Bourke ramp, simple 10-char, Unicode blocks),
  optional invert for dark-mode terminals. Rec. 709 luminance with
  alpha-blend onto white background.

  Output is `text/plain` — paste anywhere monospace renders. Free
  permanent — pure canvas + math, no LLM.

  Public exports: `imageToAsciiArt`, `imageToAscii`, types, defaults.

- 84e2a81: Add `setModelCdn` — single configuration point for AI model fetch host.

  `packages/core/src/lib/model-cdn.ts` provides:
  - `setModelCdn(base)` — point all model fetches at a different host.
  - `getModelCdn()` — read the configured base (null = upstream defaults).
  - `modelUrl(path, upstreamFallback)` — used inside tools to resolve URLs.

  Wired up:
  - `face-blur` (MediaPipe WASM + face-detector model)
  - `audio-enhance` (FlashSR ONNX)
  - `convert-geo` (gdal3.js WASM/data/js)
  - `transformers.js` pipeline loader (auto-mirrors `env.remoteHost`)

  Defaults stay the upstream CDNs (jsdelivr, googleapis, huggingface) so
  this change is a no-op until `setModelCdn()` is called.

  Migration path to R2 self-hosting:
  1. Provision an R2 bucket `wyreup-models`, mirror upstream model paths.
  2. Call `setModelCdn('https://models.wyreup.com')` once at app startup.
  3. Drop third-party domains from the privacy-scan allow-list.

  8 new tests cover the helper; existing tool tests unaffected.

- c0fd450: Add `pdf-extract-data` — extract structured fields from invoice /
  receipt PDFs without an LLM.

  Pure heuristic — runs pdf.js text extraction in-browser, then a
  labelled-money + date + invoice-number + line-item pass over the
  text. No model download, no upload.

  Detected fields:
  - **vendor** — first non-numeric line near the top of the PDF.
  - **invoiceNumber** — after Invoice / Receipt / Order / Reference labels.
  - **date** — first ISO (`YYYY-MM-DD`), US (`MM/DD/YYYY`), or long-form
    (`May 14, 2026`) date.
  - **total** — after Total / Amount Due / Grand Total labels; fallback
    to the largest currency amount in the document.
  - **subtotal** — after Subtotal / Sub-total labels.
  - **tax** — after Tax / Sales Tax / VAT / GST labels.
  - **lineItems** — description + amount pairs from rows that match the
    layout (excludes the total/subtotal/tax lines).

  Configurable currency symbol (`$` default; works with `£`, `€`, etc.).
  Output includes a confidence score (`high` / `medium` / `low`),
  warnings for missing fields, and the raw extracted text so callers
  can run their own checks.

  Public exports: `pdfExtractData` (ToolModule), `extractPdfData`
  (PDF → fields), `extractFieldsFromText` (pure text → fields, useful
  for testing and downstream composition), types, defaults.

  19 tests using a synthetic invoice text corpus.

- a76433d: Add `prompt-injection-demo` — visualise where prompt-injection content
  hides in text.

  Surfaces three categories of risk in one pass:
  1. **Hidden / invisible content** — zero-width characters, BOM, control
     chars (would be hidden from a human reader but seen by an LLM).
  2. **Confusable lookalikes** — Cyrillic а vs Latin a, Greek ο vs Latin o,
     fullwidth and mathematical alphanumeric impersonators. Mixed-script
     tokens that combine alphabets in one word.
  3. **Instruction-override phrases and chat fences** — "ignore previous
     instructions", "disregard the above", "you are now", `[INST]` /
     `[/INST]`, `<|im_start|>` / `<|im_end|>`, `System:` role spoofing,
     named jailbreaks (DAN).

  Each finding has a start/end offset, severity, kind, and human-readable
  detail. Output JSON also includes a pre-rendered HTML view with
  `<mark data-kind="…" data-severity="…">` spans the UI can show directly
  — ready for a side-by-side "before/after" demo.

  Composes `text-confusable`'s analyzer for the homoglyph layer. Free
  permanent — no LLM. 19 tests.

  Public exports: `promptInjectionDemo`, `analyzePromptInjection`,
  types, defaults.

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

- 7adf1f8: Add `regex-explain` — translate a regex into plain English.

  Walks the regexp-tree AST (same parser as `regex-visualize`) and emits
  an ordered per-part breakdown: each entry has the source fragment, a
  plain-English meaning, and a kind tag (`literal` / `class` / `group` /
  `assertion` / `quantifier` / `alternation` / `backreference` /
  `special`).

  Recognises ~30 known patterns by shape (emails, URLs, UUIDs, IPv4,
  dates, hex colors, etc.) via shared `regex-from-text` patterns table —
  when the input regex matches a known shape, the summary calls it out
  ("Recognised pattern: Email addresses.").

  Notes active flags in the summary (`g`, `i`, `m`, `s`, `u`, `y`).
  Output is JSON. Free permanent — no LLM. Completes the regex tool
  suite: `from-text` → `tester` → `visualize` → `explain`.

  Public exports: `regexExplain`, `explainRegex`, types, defaults.

- b8a8027: Add `regex-from-text` — generate a regex from a natural-language description.

  Heuristic engine covers ~30 common patterns: emails, URLs, phone numbers,
  ISO and US dates, UUIDs, hex colors, IPv4 / IPv6, credit cards, SSNs, ZIPs,
  hashtags, mentions, markdown links, HTML tags, semver, prices, percentages,
  unix timestamps, comments (JS/Python/HTML), file paths, emoji, and more.

  Detects flag modifiers in the description ("case insensitive", "multiline",
  "first match only", etc.) and combines them with each pattern's defaults.

  Output is JSON with `pattern`, `flags`, `fullRegex`, `explanation`,
  `confidence` (`high` | `medium` | `low` | `no-match`), and any
  `alternatives`. Chains cleanly into `regex-tester` and `regex-visualize`.

  When no heuristic matches, returns `confidence: 'no-match'` and an
  `upgrade` field — the no-match path is the seam where the future hosted-AI
  variant will plug in.

  Public exports: `regexFromText` (ToolModule), `generateRegexFromText`
  (standalone function), `RegexFromTextParams`, `RegexFromTextResult`,
  `defaultRegexFromTextParams`.

- 6d8214a: Add `ToolSeoContent` — optional richer content for the public tool page.

  A tool can now declare `seoContent` with:
  - `intro` — one to three paragraphs explaining what the tool is for.
  - `useCases` — bullet list of common uses.
  - `faq` — Q&A pairs (also emitted as FAQPage JSON-LD).
  - `alsoTry` — curated cross-links with the reason to click them.

  When `seoContent` is present the public page renders the full body and
  adds a FAQPage schema for SERP enhancement. When absent the page falls
  back to auto-generated sections from existing metadata
  (`description` / `llmDescription` / `input` / `output` / `cost` /
  `memoryEstimate` / `installGroup`) — every tool page is now richer
  than the previous one-line description, regardless of whether
  `seoContent` was filled in.

  `seoContent` populated for: `regex-from-text`, `regex-explain`,
  `regex-visualize`, `cron-from-text`, `sql-format-explain`,
  `image-to-ascii`, `prompt-injection-demo`, `pdf-extract-data`.

- a93afa8: Add `sql-format-explain` — pretty-print SQL and annotate each clause
  with a plain-English meaning.

  Walks the formatted SQL clause by clause (SELECT, FROM, JOIN /
  LEFT / RIGHT / FULL / CROSS, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT,
  OFFSET, UNION / INTERSECT / EXCEPT, INSERT / UPDATE / DELETE,
  RETURNING, WITH / CTEs) and emits structured annotations: the clause
  keyword, its body, and an explanation.

  Detects the statement type, flags aggregate functions in SELECT, and
  builds a one-line summary (e.g. "Read query, with joins, with grouping,
  with filtering, with sorting, with row limit.").

  Supports dialects: standard SQL, PostgreSQL, MySQL, SQLite, BigQuery.
  Free permanent — no LLM. Composes the existing `sql-formatter` library.

  Public exports: `sqlFormatExplain`, `explainSql`, types, defaults.

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

## 0.3.0

### Minor Changes

- 372a312: Add ~70 new tools across five sprints + emergent compositions.

  **Secrets / auth suite:** hmac, base32, base58, totp-code, hotp-code, jwt-sign, signed-url, backup-codes, otpauth-uri, webhook-verify, webhook-replay, signed-cookie-decode, api-key-format, license-key, pgp-armor.

  **Data wrangling:** csv-deduplicate, csv-merge, csv-diff, csv-info, csv-to-json-schema, csv-template (NEW mail-merge — render N documents from a CSV + mustache template), json-flatten, json-unflatten, json-diff, json-path, json-merge (NEW deep-merge with conflict report), json-schema-infer, json-schema-validate, frontmatter-to-csv, yaml-validate, xml-to-json, json-to-xml.

  **Security inspect:** text-confusable, text-redact, text-suspicious (NEW prompt-injection verdict), pdf-suspicious (NEW PDF prompt-injection scanner).

  **Spec validators:** openapi-validate, package-json-validate.

  **Text / HTML:** unicode-info, markdown-toc, markdown-frontmatter, color-contrast, password-strength, text-frequency, text-stats-by-paragraph, morse-code, roman-numeral, mime-detect, url-parse, url-build, url-shorten-local, html-clean, html-extract-links, favicon-from-url, css-minify, html-minify, file-fingerprint, text-template, color-blind-simulator.

  All tools ship as `presence: 'both'` — available in web, CLI (`wyreup run <tool>`), and MCP (`@wyreup/mcp`).

## 0.2.0

### Minor Changes

- ebe8507: Initial public release — Wyreup 0.1.0.
  - 72 tools across image, PDF, audio, text/dev, create, and finance categories
  - CLI for shell invocation
  - MCP server for agent integration
  - Agent skill for Claude and skill-compatible runtimes
  - CLI-only agent skill (smaller token footprint, no MCP)
  - MCP-only agent skill (smaller token footprint, no CLI)
