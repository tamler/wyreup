# Wyreup Roadmap

_Updated: 2026-05-14 (post Wave T)_

Three sections: **Now** (in flight), **Next** (scoped, not started), **Later**
(one-liners). Tech debt is inlined into the wave that absorbs it; the rest
sits in its own section, prioritized.

For shipped work, see `packages/core/CHANGELOG.md` and `git log`. Wave letters
preserved so existing commit messages still resolve.

---

## State of the project

- **`@wyreup/core`** — privacy-first browser-native tool library, dual
  browser/node build. Published `0.2.0` on npm. Run
  `pnpm --filter @wyreup/core test 2>&1 | grep -i 'tools'` for live
  counts; we deliberately don't pin a number here so this section
  doesn't rot.
- **`@wyreup/cli`** — `0.2.0` on npm. Surface: `run`, `chain`, `watch`, `prefetch`,
  `cache`, `init-tool`, `install-skill`, `list`, stdin/stdout piping.
- **`@wyreup/mcp`** — `0.2.0` on npm. Exposes every registry tool whose
  `surfaces` includes `mcp` over stdio. The set tracks the registry
  automatically — no separate registration.
- **`@wyreup/web`** — live at `wyreup.com` (Cloudflare Pages). Per-tool
  pages and category indexes are static-site-generated from the registry.
- **Tool inventory:** spans image, PDF, audio, video, text, dev, geo,
  finance, and other categories. The chip filter on `/tools` is the
  source of truth — counts shift between releases.
- **Install groups:** `core`, `ffmpeg`, `image-ai`, `nlp-standard`,
  `speech`, `vision-llm`.
- **Privacy posture:** every tool runs client-side. No analytics, cookies,
  third-party scripts, or uploads. `check-privacy.mjs` gates the static
  output. MIT licensed.

---

## Now (in flight)

Direction reset 2026-05-14 (post Wave T + tool wins): **free-push
period.** Original plan was to defer Pro deployment until weekly
actives justified it; that was reversed on 2026-05-18 — Pro
infrastructure shipped end-to-end so the gate is in place when
audience arrives rather than scrambling to build it then. Free push
continues in parallel.

### Pro framing (refined 2026-05-15)

The earlier framing — "Pro is 40 tools shipped as free for now" —
was wrong. Sharpened version:

- **Heuristic tools are permanent free.** If a tool costs us $0/call
  to run, it stays free forever. `regex-from-text`, `cron-from-text`,
  `sql-format-explain`, `regex-explain`, `prompt-injection-demo`,
  `image-to-ascii`, `pdf-extract-data` — all permanent free.
- **Small/medium models are free.** Anything in our existing
  in-browser model size band (~75-250 MB) stays free. Adding a
  ~180 MB zero-shot classifier doesn't justify a paywall.
- **Pro = cloud-hosted variants of capabilities the in-browser tier
  genuinely can't match.** Whisper-large-v3 hosted (vs. our
  whisper-tiny), Llama 70B / 405B hosted (vs. small heuristics),
  hosted vision models for higher-quality OCR / captioning, Flux
  hosted for image generation (we have no in-browser equivalent).
- **The `upgrade` field** on no-match results from heuristic tools
  is the **only** Pro touchpoint on free tools. When a heuristic
  returns `confidence: 'no-match'`, the response carries an
  `upgrade` field pointing to the hosted-AI fallback. Free users
  see "no match" and an opt-in path; the tool itself stays free.

Pitch: *"Everything that runs in-browser is free, forever. Pro is
the stuff that genuinely needs a GPU we can't put in your tab."*

### Free-push priorities

- Build heuristic / small-model versions of every "Pro candidate"
  capability. Ship them free.
- More free tools, SEO surface area, one Show HN attempt.
- Keep the privacy pitch inviolate: **free is zero tracking, zero upload.**

### 1. Wave T — Triggers, rules, PWA drop entry — **SHIPPED 2026-05-14**

Make Wyreup automatic. Foundation + rules engine + preview-before-run
all landed in one sustained session. See `docs/triggers-security.md`
for the load-bearing security model (G1–G8 enforced in code), and
`packages/core/src/triggers/` for the implementation.

**Shipped (full Wave T):**
- ~~Trigger rules persistence (`@wyreup/core` types + storage)~~
- ~~Matcher (most-specific MIME wins, user-`order` tiebreak, rate-limit gate)~~
- ~~Preview-before-run sheet (TriggerPreviewSheet.svelte)~~
- ~~Suspicious-file pre-flight (G4: text + PDF analyser before Run)~~
- ~~`/toolbelt` rules management UI~~
- ~~Trigger runtime: file-drop interceptor with `cancelable: true` event~~
- ~~G8 spoof gate: imported chains can't reference unknown tools~~
- ~~Chain-builder integration: save chain + register trigger in one step~~
- ~~`file_handlers` wired through `/share-receive` to the preview sheet~~
- ~~`/triggers` public security-model doc + landing hero rewrite~~

Resolved open questions:
- Preview-before-run is on **by default**, opt-out per-rule only (never global)
- No default triggers — users build their own

### 2. Two high-confidence tool wins — **SHIPPED 2026-05-14**

- ~~**`pdf-crop` visual rectangle UI**~~ — `PdfCropRunner.svelte`,
  canvas drag-to-draw, single-rect-per-page, applyToAllPages toggle.
  Replaces the JSON-textarea fallback.
- ~~**`regex-visualize`**~~ — `regexp-tree` AST → SVG with labeled
  boxes. Chains after `regex-tester`. 13 tests, ships at
  `packages/core/src/tools/regex-visualize/`.

### 3. Free-push period (current) — heuristic tool sweep

Audience-building period. Permanent-free heuristic tools that compose
into the Pro story later as fallback seams.

**Shipped 2026-05-14 / 2026-05-15:**
- ~~`regex-from-text`~~ — heuristic regex generator, 30+ patterns,
  `upgrade` seam for the Pro AI fallback.
- ~~`cron-from-text`~~ — heuristic cron generator covering intervals,
  times, days of week, days of month.
- ~~`sql-format-explain`~~ — pretty-print + clause-by-clause English
  breakdown. SELECT / JOIN / WHERE / GROUP BY / etc.
- ~~`regex-explain`~~ — regex → AST → per-part English breakdown.
  Cross-recognises known patterns via `regex-from-text`'s table.
  Completes the regex suite: from-text → tester → visualize → explain.
- ~~`image-to-ascii`~~ — image → ASCII / Unicode-block art.
  Configurable width, three ramps, dark/light invert.
- ~~`prompt-injection-demo`~~ — visualise where prompt-injection
  content hides. Invisible chars, confusables, mixed-script,
  override phrases, ChatML / Llama / OpenAI fences. Returns
  positions + pre-rendered HTML with `<mark>` spans.
- ~~`pdf-extract-data`~~ — heuristic invoice/receipt field
  extraction (vendor, invoice #, date, total, subtotal, tax,
  line items). No LLM, no upload. Configurable currency.

**Shipped 2026-05-17 / 2026-05-18 (library-driven batch):**
- ~~`text-sentences`~~ — compromise-powered sentence splitter,
  strong chain primitive.
- ~~`text-keywords`~~ — topic-bearing noun + phrase extraction
  (compromise). Distinct from text-frequency (statistical).
- ~~`text-dates`~~ — pull `#Date` mentions with best-effort ISO
  normalization for absolute forms (compromise).
- ~~`docx-to-text`~~ — extract plain text from `.docx` via mammoth.
- ~~`extract-article-text`~~ — Reader-mode declutter via Mozilla
  Readability. Pastes-only for v1 (URL fetch deferred — CORS).
- ~~`pdf-flatten`~~ — lock AcroForm field values into static content
  (pdf-lib).
- ~~`pdf-form-fields`~~ — read-only inspection of interactive form
  field metadata + values (pdf-lib).
- ~~`zip-remove`~~ — glob-based entry stripping (JSZip).
- ~~`zip-flatten`~~ — collapse directory structure to root with
  configurable collision handling (JSZip).

**Still to ship:**
- ~~**SEO surface area.**~~ Shipped 2026-05-21 — per-tool pages carry
  SoftwareApplication + FAQ + BreadcrumbList JSON-LD, canonical URLs,
  and an auto-generated facts table + About section for every tool.
  Hand-written `seoContent` is enriched per tool as signal warrants.
- **Toolbelt as the wedge.** Showpiece preset chains on landing
  (PDF → text → translate; image → describe → alt-text).
- **One Show HN attempt** with triggers + catalog-breadth angle.
- **Traffic measurement.** Cloud-hosted analytics (Plausible, Fathom,
  etc.) is a hard no — see below. Options: server-side log analysis
  on Cloudflare access logs, or self-hosted Plausible on our own
  infra. Decision deferred; not load-bearing for the free push.

### 4. Wave M — Monetization — **SHIPPED 2026-05-17 / 2026-05-18**

Original Wave M scope (line items below) was scaled back during
implementation — these are the decisions we made vs. the spec:

| Aspect | Original plan | What shipped |
|---|---|---|
| Deployment | Defer until weekly actives | Live in production |
| Auth | Anonymous license key | Account-based (email + multiple keys per account) |
| Infra | CF Worker + KV | CF Pages Functions + D1 |
| Pricing | $10/200, $25/600, $50/1500 + $8/mo sub | $5/220, $10/480, $20/1000 packs + $8/mo for 440 credits (initial pack sizes 2026-05-20; bumped +45% on 2026-05-22 alongside Wave 1 Workers AI expansion) |
| Checkout | LS overlay (no redirect) | LS overlay (lemon.js) with redirect fallback |
| Tool naming | `transcribe-hq`, `summarize-hq` (`-hq`) | `transcribe-pro`, `text-summarize-pro` (`-pro`) |
| Marketing | "No separate /pro page" | `/pro` landing page exists |
| Free-tier seam | `upgrade` field on heuristic no-match | Shipped 2026-05-21 — regex/cron-from-text no-match results show an in-result CTA to the PRO fallback tools |

**Shipped surfaces:**
- ~~D1 schema, append-only credit ledger, UNIQUE(ls_order_id)
  webhook idempotency.~~
- ~~Account create / verify (signed HttpOnly session cookie) /
  signout / balance / history / keys (list+create+revoke).~~
- ~~/api/tools/pro/run with reserve-then-refund credit pattern
  and per-account 30/min rate limit.~~
- ~~/api/credits/checkout — server-side userId stamping into LS
  checkout custom_data.~~
- ~~/api/webhooks/lemonsqueezy — constant-time HMAC verify, INSERT
  OR IGNORE for purchase + refund, userId validation guard.~~
- ~~Provider abstraction layer (functions/_lib/providers/) for
  text, audio, image models — swap vendor by editing one file
  per modality. Today: Workers AI (text + audio) + Replicate
  (image) via generic IMAGE_MODEL_TOKEN.~~
- ~~AuthModal, AccountMenu (header ⚡ badge + dropdown),
  BuyCreditsSheet (LS overlay + 5-min poll fallback),
  CreditBadge, ProBadge, /account dashboard.~~
- ~~/admin dashboard, gated by ADMIN_EMAILS allowlist — metrics,
  recent signups, accounts table with email search + per-row
  grant button (confirm() guard on > 100 credits or debits),
  recent PRO runs, per-tool refund-rate.~~
- ~~ToolRunner PRO gate (cost === 'credit') with sign-in /
  buy-credits / pass states.~~
- ~~Live ⚡ balance refresh after PRO runs via
  `wyreup:balance-changed` event.~~
- ~~CSP, X-Frame-Options: DENY, DOMPurify on every {@html},
  audited via two background-agent reviews.~~
- ~~Legal: /legal/terms, /legal/privacy, /legal/refund,
  /legal/pricing.~~
- ~~PRO tools wired end-to-end. Initial eight: transcribe-pro,
  text-summarize/translate/sentiment/ner/redact-pro, bg-remove-pro,
  upscale-2x-pro. Expanded 2026-05-20/21 to 20 tools — a 5-tool
  vision flow (ocr-hq, image-describe, analyze-chart, image-q-and-a,
  read-handwriting), detect-objects, two chain tools (translate-image,
  transcribe-and-translate), the regex/cron-from-text upgrade-seam
  pair, and pdf-summarize / pdf-q-and-a. All on Workers AI except
  bg-remove/upscale (Replicate). Per-tool credit costs are
  server-authoritative in functions/_lib/pricing.ts. Surface
  restriction lifted 2026-05-23 — Pro tools now run on web, CLI, and
  MCP via a shared API key (see "CLI/MCP PRO support" below).~~

**Pending — Lemon Squeezy store approval only:**
- All monetization code is shipped — packs, the $8/mo subscription
  (440 credits/cycle, D1 subscription state, subscription_* webhook
  handlers), checkout, and the credit ledger. What remains is LS
  approving the store for live sales; the end-to-end purchase test
  (T21) waits on that. The auto-pause cron was dropped — the
  subscription is blocked-on-empty: run out and you wait for the next
  cycle or buy a pack.

**Deliberately not done (deviations from original spec):**
- ~~CLI/MCP PRO support. Tools ship with `surfaces: ['web']`;
  enabling CLI/MCP needs ToolRunContext to carry an API key
  and the runner variants to wire that through.~~ Shipped 2026-05-23
  per docs/specs/pro-cli-mcp.md — ToolRunContext gained `apiKey` and
  `proOrigin`, pro-runner picks cookie vs Bearer based on context,
  CLI added `wyreup login/logout/balance` with `~/.wyreup/config.json`
  + WYREUP_API_KEY env-var fallback, and the MCP server reads the key
  from env and degrades gracefully (Pro tools hidden) when it's
  absent.

### 5. Wave U — Standalone tool expansion

The new direction: **deterministic, file-oriented, no models, no
downloads.** Each tool ships in hours-to-days, validates with a test
suite, and slots into chains by MIME. No install group. Targets the
"things people open random websites to do" surface.

**Selection criteria:**
- Pure-JS, runs client-side, deterministic
- Output is a file or text — chainable
- The library either already lives in `packages/core` deps, or is small
  (<100 KB) and well-maintained
- Solves something a normal user would Google for

**Batches 1–5 (shipped, 2026-05).** The Wave-U sprint landed five
batches totalling ~70 tools across two weeks. Inline status preserved
for cross-reference with commit history; full diff in
`packages/core/CHANGELOG.md`.

**Batch 1 — libraries already installed (near-free): all shipped.**
- ~~`text-diff`, `sql-formatter`, `rotate-pdf`, `pdf-encrypt`,
  `pdf-decrypt`, `color-contrast`, `pdf-extract-images`,
  `color-blind-simulator`~~

**Batch 2 — small new libs (low risk): all shipped.**
- ~~`csv-deduplicate`, `csv-merge`, `csv-diff`, `markdown-toc`,
  `xml-to-json`, `json-to-xml`, `json-schema-validate`, `html-minify`,
  `css-minify`, `unicode-info`, `hmac`~~
  (Added deps: papaparse, fast-xml-parser, ajv, clean-css,
  html-minifier-terser.)

**Batch 3 — emergent chains surfaced by the sprint: all shipped.**
- ~~`csv-to-json-schema`, `csv-info`, `json-path`,
  `url-shorten-local`, `text-stats-by-paragraph`,
  `favicon-from-url`~~

**Batch 4 — speculative picks promoted on user signal: all shipped.**
- ~~`openapi-validate`, `package-json-validate`, `api-key-format`,
  `license-key`, `pgp-armor`, `base58`, `text-template`,
  `signed-cookie-decode`, `text-suspicious`~~
- Skipped: `webhook-replay-to-server` (server-roundtrip
  out-of-scope for Wave U).

**Batch 5 — second-order chains over the new primitives: all shipped.**
- ~~`json-merge`~~ — deep-merge with conflict tree. Closes the
  diff/merge pair against the existing `json-diff`.
- ~~`csv-template`~~ — mail-merge. CSV + mustache → ZIP of N rendered
  files. The canonical text-template chain.
- ~~`pdf-suspicious`~~ — PDF prompt-injection / homoglyph scanner.
  Composes `pdf-to-text` + `text-suspicious`. Timely as LLMs ingest
  PDFs routinely.

**Out-of-scope for Wave U:**
- Anything that needs a model download (that's Wave Q, paused)
- Anything that needs a server roundtrip
- Anything beyond a single command's worth of UX

**Wave-U Bucket 2 — all shipped 2026-05-21:**
- ~~`csv-sort` / `csv-filter`~~ — close the papaparse family.
- ~~`diff-apply`~~ — apply a unified diff to a file; verifies each
  hunk against the source and fails loudly on a mismatch.
- ~~`ocr-suspicious`~~ — `ocr` + `text-suspicious` on images
  (prompt-injection in screenshots / poster photos).
- ~~`html-redact`~~ — `text-redact` PII patterns over HTML,
  structure-preserving (tags and attributes left untouched).
- ~~`openapi-report`~~ — `openapi-validate` → Markdown report for
  CI logs / PR comments.

---

## Next (scoped, not started)

Ordered by recommended sequence.

### Wave V — Data workbench (`/workbench` page, persistent local SQL)

Companion to the just-shipped `csv-sql` tool. Same SQLite-WASM engine,
but a dedicated UI surface (not a tool):

- New route `/workbench` (alongside `/triggers`, `/chain/build`).
- File-drop pane (left) → table list + schema view (middle) → SQL
  editor + result grid (right).
- Persists to **OPFS** (Origin Private File System) as a single
  `.sqlite` file, so "export workspace" = download the file and
  "import workspace" = drop the file. Stays on-brand for a file-first
  tool library.
- Query history, named queries, schema export, result download as
  CSV/Parquet/JSON.
- Engine code shared with `csv-sql`; this wave is mostly UX +
  persistence wiring.
- Free tier; nothing uploads; no account required.

The hypothetical "Wave V-CLI" (a `wyreup db` REPL) is **explicitly
out of scope** — agents and CLI users get all the value via the
`csv-sql` tool already, no stateful CLI surface needed.

### Wave W — Semantic-search Pro tools (embeddings + reranker)

Surveyed 2026-05-23 against the Cloudflare AI catalog. A new category
we don't have: native-pricing embedding + reranker models that unlock
"find similar" / "rank these" workflows.

**Candidate tools:**
- **`text-find-similar-pro`** (1 credit) — input: target text + JSON
  array of candidate strings. Output: ranked similarities. Backend:
  `@cf/baai/bge-m3` ($0.012/M input tokens, dirt cheap). The
  mom-friendly framing: "find me documents that match this one."
- **`rank-results-pro`** (1 credit) — input: query + array of candidate
  answers/passages. Output: scored ranking. Backend:
  `@cf/baai/bge-reranker-base` ($0.003/M, even cheaper). Pairs
  naturally with `text-find-similar-pro` for "search then rerank."
- **`text-cluster-pro`** (2 credits) — input: JSON array of texts.
  Output: cluster labels per row. Backend: embeddings + k-means or
  HDBSCAN client-side. Useful for "group my customer feedback by
  theme."

**Why native pricing matters:** all three backends are Workers AI
native, billed in neurons. At ~$0.001/run typical, every tool clears
the 50% margin floor by a wide margin.

**Tradeoff to note:** vectors aren't a useful end-state on their own
— these tools only chain well into each other or into csv-sql
(`SELECT … ORDER BY score`). Not as flashy as TTS or image-gen, but
genuinely missing capability for any "search inside my data" flow.

**Estimated effort:** 2-3 hours per tool. Could ship all three in one
session.

### Wave M — Monetization (Lemon Squeezy + hosted AI) — **SHIPPED 2026-05-18, see Now §4**

Original scope kept below for posterity. Adopted version is recorded
in the Now section with the deviation table. The remainder of this
entry describes what was planned but not all of which was built —
read alongside the "Deliberately not done" callout in §4.

**Tier shape (refined):**
- Free unchanged — zero tracking, zero upload, all current tools
  (including heuristic versions of every "Pro" capability).
- Pro = **cloud-hosted-only** capabilities the in-browser tier
  genuinely can't match: hosted Whisper-large vs. our whisper-tiny,
  hosted Llama 70B / 405B vs. small heuristics, hosted vision
  models, hosted image generation (we have no in-browser equivalent).
- Heuristic Pro candidates ship as free permanently; their `upgrade`
  field on no-match results is the only Pro touchpoint.

**Pricing (hybrid):**
- Token packs — $10/200, $25/600, $50/1500. No subscription.
- Subscription — $8/mo, 200 included tokens, topup at $0.04/token.
  **Auto-pause if unused for one billing cycle** (CF Worker watches
  usage). Differentiator: forgotten subs don't generate revenue.

**Pro-only catalog (genuinely cloud-only):**
- **Audio (Groq Whisper-large-v3-turbo)** — `transcribe-hq` and
  `transcribe-and-translate`. Whisper-tiny stays as free baseline;
  Pro is the quality / speed upgrade.
- **Text LLM (Groq Llama 70B)** — `summarize-hq`, `classify-hq`,
  `translate-hq`, `extract-hq`, generic LLM fallback for the
  `upgrade` field on `regex-from-text`, `cron-from-text`,
  `sql-from-text`, etc. Free heuristics handle the 80% case;
  Pro handles the 20% the heuristic can't.
- **Vision (hosted vision LLMs via external image-model provider)** —
  `image-ocr-hq`, `image-describe-hq`,
  `extract-table-from-image-hq`, `read-handwriting`,
  `analyze-chart`. tesseract OCR stays free baseline.
- **Image generation (Flux-class + Real-ESRGAN via external image-model
  provider)** — `image-generate`, `upscale-hq`, `inpaint`,
  `style-transfer`, `image-variants`. We have **no** in-browser image
  generation today, so these are pure-Pro.
- **Document workflows (Llama 70B over PDF text)** —
  `pdf-summarize-hq`, `pdf-q-and-a`, `pdf-translate-full`,
  `pdf-rewrite-format`. Free `pdf-extract-data` (heuristic) and
  `pdf-to-text` stay free.

Scale: ~15-20 cloud-only tools, not the original 40. The other
20+ candidates fit the heuristic / small-model tier and stay free.

**Infrastructure:**
- Lemon Squeezy overlay checkout (JS embed, no redirect).
- Cloudflare Worker: webhook validation, license-key state in KV,
  per-key token balance, usage metering, auto-pause logic.
- License-key validation endpoint, rate-limited, local cache for
  offline grace. License key paste-in via Settings panel.
- No accounts. Key is the credential.

**Marketing surface:** landing page sells Pro (headline split between
"Free: 200+ tools, zero upload, zero tracking" and "Pro: cloud-only
capabilities, no-train providers"); per-tool pages show a small lock
badge for Pro entries; Settings adds a License panel. No separate
`/pro` page.

**Paid tier does NOT change the free tier's privacy pitch.**
Pro is hosted on contractually no-train providers and is opt-in.

Out of Wave-M scope (kept on the wishlist, not in launch):
- E2E encrypted Toolbelt cloud sync (passphrase-derived key, R2).
- `wyreup serve` daemon for scheduled triggers.
- CLI Pro features (batch flags, chain scripting).
- Priority support — dropped 2026-05-14; "most things just work."

### Wave S — Browser extension

Fifth surface alongside web/CLI/MCP/library. Reuses Wave T's rules engine
(right-click → one-shot trigger).

- Full-page screenshot of the current tab — a native extension
  capability (debugger `Page.captureScreenshot` with
  `captureBeyondViewport`, or scroll-stitch). The "full-length
  screenshot" the web app provably cannot do — cross-origin iframes
  can't be captured and there is no in-tab headless browser.
- Hybrid architecture: popup for light tools (~30 of catalog),
  offscreen document for medium (compress, convert, rotate),
  tab hand-off via `chainStorage` for heavy ML, optional Native Messaging
  to local `@wyreup/cli` for native-speed inference
- New package: `@wyreup/extension`. MV3 manifest, background SW, popup,
  offscreen doc, content script only where needed for inline UX
- Distribution: Chrome Web Store, Firefox Add-ons, Edge. Safari deferred to v2
- Right-click context menus per MIME — generated dynamically from the
  registry via `toolsForFiles`

### Wave O — Self-hosted Docker

Targets the homelab/self-hosted audience. Build after the platform is
stable enough that support burden is low.

- Dockerfile (node:20-slim base + build artifacts)
- docker-compose.yml (single-service deploy)
- Image tags on GHCR + Docker Hub
- Homelab docs: reverse-proxy examples (Traefik, Caddy), persistent
  volume mounts, env var reference

---

## Paused

Direction set 2026-05-01: **no new ML / LLM work** until the Now sequence
completes and there's user signal for it. Existing AI tools
(`transcribe`, `image-caption`, `image-caption-detailed`,
`text-summarize`, `text-sentiment`, `text-ner`, `text-translate`,
`bg-remove`, `upscale-2x`, `ocr-pro`, `image-similarity`, `text-embed`)
keep running — this only blocks *adding* more.

### Wave Q — Generative AI (further adds paused)

What was queued before the pause:
- Florence-2-base captioning (custom architecture, integration risk)
- Chainable TTS via Kitten-TTS-15M or Kokoro-82M
- Demucs source separation (no first-class transformers.js support)
- Diffusion (text→image) — already deferred 2026-04-29 on bench results

Resume signal: confirmed user pull for one of these specific capabilities.
"Could be cool" doesn't count.

### Wave R — Offline LLM (Gemma 4 via transformers.js / WebLLM)

In-browser local LLM, no vendor lock, cross-browser via WebGPU. Tools
would have been `local-chat`, `text-rewrite`, `text-write`,
`text-proofread`, `text-summarize-llm`, `text-explain-code`,
`language-detect`, stretch `wyreup-agent`.

**Candidate model**: Gemma 4 E2B (released 2026-04-02, Apache 2.0).
2.3B effective parameters (~5.1B with embeddings), multimodal (text +
audio + image inputs), 128k context. At int4 the on-disk weights run
~1.5–2 GB — significantly larger than the previous "sub-500 MB"
threshold but the quality and capability ceiling jumps far enough that
the original threshold is now arguably wrong. The MMLU-Pro / AIME /
LiveCodeBench numbers (85.2 / 89.2 / 80.0 on the 31B variant) and the
multimodal surface mean one model could power what would otherwise be
five separate transformers.js downloads.

Why we're considering it now (recorded 2026-05-04):
- **No vendor lock** (Apache 2.0). Runs anywhere transformers.js +
  WebGPU exists — Chrome, Firefox, Safari, Edge.
- **Multimodal capability** — image, audio, text inputs in one model
  unlocks tools we don't have any path to today (audio Q&A,
  on-device image-to-text-with-context).
- **Open weights** = self-host on R2 (already on the privacy
  tech-debt list), no third-party model CDN.

Why we're still not starting:
- ~1.5–2 GB download is heavy. PWA settings UI needs a strong opt-in
  prompt (similar to the conversation we'd have had for Chrome AI's
  22 GB Gemini Nano).
- Wave-sized investment: model hosting, WebLLM/transformers.js
  integration, streaming runner UI, prompt engineering per tool, eval
  harness. Not a half-day spike.
- The current Now sequence (Wave T, Wave U) hasn't completed.

Resume signal (any one):
1. Now sequence (Wave T + U) completes.
2. Confirmed user pull for one of the specific Gemma-powered tool
   ideas above — "we want a local LLM" doesn't count, "I want to
   proofread without sending text to a cloud API" does.
3. A paid Pro tier exists where the heavy download is justified by
   sticky use.

---

## Tech debt (not absorbed by a wave)

Ordered by priority.

1. ~~**Self-host AI model CDNs on R2.**~~ Done 2026-05-15 — every
   model fetch now routes through `models.wyreup.com`, a first-party
   Cloudflare Worker backed by the `wyreup-models` R2 bucket. The
   Worker (`packages/worker-models/`) serves cached objects from R2
   and lazy-mirrors from the relevant upstream (huggingface.co,
   cdn.jsdelivr.net, storage.googleapis.com) on cache-miss, then
   writes back to R2 in the background via `ctx.waitUntil`. The
   browser never touches a third-party origin; the upstream fetch
   happens server-side, once per file ever, inside Cloudflare. The
   three former third-party domains were dropped from the privacy
   allow-list — if anything sneaks back in, the scan catches it.
   Override path for testing or upstream-fallback:
   `WYREUP_MODEL_CDN=disabled` (or any URL) for CLI / MCP.
2. ~~**Unpublish deprecated skill packages from npm.**~~ Done
   2026-05-15 — `@wyreup/skill`, `@wyreup/cli-skill`, `@wyreup/mcp-skill`
   are no longer on the registry.
3. ~~**`@vite-pwa/astro` dev deps audit.**~~ Done 2026-05-15 — build
   output verified clean, workbox runtime correctly tree-shaken into
   the bundled service worker; no dev tooling leaks.
4. **`face-blur` Node integration test skip.** MediaPipe doesn't init
   under vitest's jsdom-less env. Re-enable if a better headless test
   path emerges.

4a. **`detr-resnet-50` is tagged Beta on Workers AI** (the backend for
    our `detect-objects` Pro tool). No deprecation date yet, but
    Cloudflare's Beta tier can change without warning. Migration
    candidates if/when it disappears: switch to a vision LLM call
    via llama-4-scout asking for structured `{label, box}` JSON, or
    move object detection to a Replicate model alongside bg-remove.
    Watch the catalog; no action until then.
5. ~~**Lazy-load runner variants in `ToolRunner.svelte`.**~~ Done
   2026-05-15 — 29 runners converted to dynamic imports keyed off
   `RunnerVariant`; entry chunk dropped from a ~250KB aggregator to
   ~17KB. Each runner is now its own Vite chunk fetched on demand.
7. **PWA manifest screenshots[].** The 2026-05-04 PWA pass added
   manifest id, lang/dir/categories, monochrome icon, msapplication
   tile metas, /offline fallback, and the iOS Safari install hint.
   Screenshots[] was deferred because it needs real product captures
   (not OG marketing imagery) at the recommended form factors:
   540×720 narrow + 1280×720 wide, both PNG. Capture during the next
   designer pass, drop into `packages/web/public/screenshots/` and add
   the entries to `astro.config.mjs` manifest.
8. **LemonSqueezy webhook: handle the events we left as no-ops.** Wave M
   wired the seven events the credit ledger actually needs (`order_created`,
   `order_refunded`, `subscription_created`, `subscription_payment_success`,
   `subscription_cancelled`, `subscription_expired`, `subscription_paused`).
   The LS dashboard is enabled for several more; the handler returns 200
   OK on each, which is safe but leaves one real gap and a couple of
   cosmetic ones.

   - **`subscription_payment_refunded` (revenue leak — priority).** If a
     user refunds a monthly renewal, the 440 credits granted on the prior
     `subscription_payment_success` stay on the account. Bounded today by
     the account-wide daily spend cap (migration 0004) and reversible via
     `/admin` grant with a negative amount, but should be automatic.
     Fix: mirror `order_refunded`, but find the original by
     `kind='subscription_grant'` and the composite key
     `sub_{subscription_id}:inv_{invoice_id}`. Insert a `refund` row with
     `-MONTHLY_CREDITS_PER_CYCLE` and the same idempotency guard.
   - **`subscription_resumed` / `subscription_unpaused` (cosmetic).**
     After resume, `users.subscription_status` stays `'paused'` until the
     next `subscription_payment_success` flips it via the existing CASE
     guard. Could flip eagerly on resume so `/admin` reflects reality
     between cycles.
   - **`subscription_payment_failed` (admin visibility).** No record kept
     today. A `'past_due'` status flag would surface failing renewals in
     `/admin` before they roll to `_expired`.
   - **`dispute_created` / `dispute_resolved` / `customer_updated` /
     `subscription_plan_changed` / `subscription_payment_recovered`** —
     no-op stays correct unless `/admin` gains dedicated views.

   Estimated effort: ~1 hour including idempotency tests against
   `credit_events.refund_of`. Standalone follow-up; not blocking.
6. **`convert-geo` Node bridge — drop the chdir hack.** `gdal3.js`'s
   Node loader hardcodes `./node_modules/gdal3.js/dist/package/` and
   *concatenates* user-supplied `paths:` onto it, so absolute paths
   produce nonsense. Workaround in `loadGdal()`:
   `process.chdir()` to the directory whose layout the lib expects,
   init, restore. Works under both pnpm and flat npm-install.
   - **File upstream issue** at https://github.com/bugra9/gdal3.js asking
     for absolute paths in `paths:` to be honoured as-is. When fixed,
     drop the chdir block entirely.
   - **Concurrency.** chdir is process-global. Init happens once per
     `ToolRunContext` (cached), so serial use is safe. If MCP ever
     processes concurrent tool calls in one process, wrap `loadGdal()`
     in a module-scope mutex (~10 LOC) — or wait for the upstream fix
     and the issue disappears.
   - **`useWorker: false` in Node** — Workers don't init in plain Node
     ESM. No parallelism cost today; revisit if we ever batch ogr2ogr
     calls in one process.
   - **Stale VFS files.** `gdal3.js` shares one WASM filesystem across
     every call; `getOutputFiles()` returns *everything* the lib has
     ever written. We use `ogr2ogr()`'s returned `FilePath` instead.
     The VFS still grows unboundedly across a long-lived MCP session;
     no clear-VFS helper exists short of re-init. Live with it until
     it OOMs someone.
9. **CSP: drop `blob:` + `'unsafe-inline'` from `script-src`.** From the
   2026-06-09 security review. The web CSP (`packages/web/public/_headers`)
   keeps both `blob:` and `'unsafe-inline'` in `script-src`; together they
   let an inline-script foothold escalate to a full module via
   `new Blob([js]) → createObjectURL → import(blobUrl)`. Severity dropped
   sharply once the review closed the two critical XSS sinks that made it
   reachable (html-to-pdf iframe sandbox, markdown-to-html sanitization,
   both shipped), so this is now defense-in-depth with no live entry point.
   It is a two-part fix and `blob:`-removal alone is only half of it:
   - **Remove `blob:`** requires moving ONNX Runtime off the main thread.
     Today `@wyreup/core` loads transformers.js/ORT on the main thread
     (`lib/transformers.ts`, `tools/audio-enhance/index.ts`), and ORT
     bootstraps its wasm backend via `import(blob:)`, which `script-src`
     governs. Set `ort.env.wasm.proxy = true` (or run inference in a
     dedicated worker) so the blob import moves to `worker-src` (already
     allows `blob:`). Independently valuable as a perf win — keeps heavy
     inference off the UI thread. Verify by loading a transformers.js tool
     (e.g. `/tools/audio-enhance`, an OCR/embedding tool) in a real browser
     and confirming no `script-src` / "no available backend found" errors.
   - **Remove `'unsafe-inline'`** is the bigger win but needs a Cloudflare
     Pages Function doing per-response nonce injection — a static cached
     build can't carry per-visitor nonces, and hashing is intractable (~1049
     distinct inline-script hashes, 782 of them per-page JSON-LD that change
     on any content edit). Treat the two together as one deliberate "CSP
     hardening" project; not urgent.
10. **Release publish doesn't auto-fire after the changesets version PR.**
    *Partially addressed 2026-07-12:* Release now has a `workflow_dispatch`
    trigger, so the manual step is `gh workflow run Release` instead of an
    empty commit. Fully hands-off still needs the PAT/app-token merge.
    Hit on 2026-06-09. `.github/workflows/release.yml` triggers only on
    `push: branches: [main]`. The version PR is auto-merged by the Actions
    bot's `GITHUB_TOKEN`, and GitHub deliberately suppresses workflow runs
    on bot-token pushes — so the merge commit fires *no* Release run, the
    `changeset publish` step never executes, and `main` sits ahead of npm
    until something else pushes. Worked around by pushing an empty commit to
    re-fire Release (it then publishes since no changesets remain). To make
    releases hands-off, decouple publish from the bot merge: add a
    `workflow_dispatch` trigger to Release (so `gh workflow run Release` can
    publish on demand), or split publishing into its own job/workflow that
    runs on the version-packages merge via a PAT/app token rather than
    `GITHUB_TOKEN`. ~30 min; removes a recurring manual step every release.

11. **pdfjs-dist 6 migration.** Deferred 2026-07-10 (Dependabot #38
    closed, majors ignored in dependabot.yml). v6 drops the
    `pdfjs-dist/legacy/build/*` entry points that PdfRedactRunner and
    PdfCropRunner import, so the bump is a real migration: switch both
    runners to the modern `pdfjs-dist/build/pdf.mjs` + worker URL,
    confirm the supported-browser floor is acceptable, and exercise the
    PDF tools in a real browser (web unit coverage is too thin to catch
    a broken worker handoff). Until then we stay on the patched 5.x line.

### Recurring: Truth-in-advertising audit

Run quarterly. For each public surface:
1. Every command example runs without error
2. Every tool ID mentioned exists in the registry
3. Every URL resolves
4. Update the audit log at `docs/audit-YYYY-MM-DD.md`

Last audit: `docs/audit-2026-04-17.md`. Next due: 2026-07-17.

---

## Later (one-liners, no priority order)

- Multi-user / team surface (Pro tier add-on)
- **Hosted HTTP API (Pro-only doorway, added 2026-05-26).** Additional
  surface alongside web/CLI/MCP. Caller hits
  `api.wyreup.com/v1/tools/:id` with a bearer token (existing Pro API
  key, same account, same balance — no separate plan or metering) and
  gets a JSON response. No local install, no MCP subprocess; sells the
  convenience axis: *skip running anything locally.*

  Free MCP stays free — gating is on the doorway, not the tool. Even
  a "free" tool consumes Cloudflare Worker CPU when served from our
  edge, so via API it carries a small per-call cost. Margin floor is
  unchanged: `price = 2 × (request + CPU-ms + upstream + storage ops)`,
  no subsidies.

  **Open before scoping:** flat-per-tool vs input-tiered pricing. Heavy
  inputs (10k-feature geo, 4096px images) shift p95 CPU 10×+; tiered
  keeps margin tight, flat is simpler. Decide after the measurement
  pass.

  **Measurement plan (drafted in conversation 2026-05-26):** enable
  `[observability]` on a staging Worker route, load-script 200 warm +
  300 cold calls per (tool, input-class) cell, pull p50/p95 CPU-ms
  from the Workers dashboard, compute `price = 2 × cost_p95`. Top 5
  free + top 3 Pro tools first; rest after.

  **Resume signal:** unprompted user pull from a dev or agent-framework
  operator wanting access without an MCP client — at least one
  concrete "I would pay for this" message. "Could be useful" doesn't
  count.
- Translated CLI/MCP `skill.md` (Spanish, Japanese, etc.)
- Richer `wyreup init-tool` (param schema generation, component stubs,
  test templates)
- Animated GIF ↔ WebP conversion (ImageDecoder/ImageEncoder API)
- **VMAF video quality metric (Pro candidate, added 2026-06-04).** The
  `video-quality-metrics` tool shipped with PSNR + SSIM (built-in
  libavfilter filters). VMAF is the notable gap: it needs ffmpeg built
  `--enable-libvmaf` plus Netflix model files, and our CDN
  `@ffmpeg/core-mt@0.12.6` does not include libvmaf (same class of
  constraint as a missing external lib — cf. why we hardsub but can't
  bundle every codec). Two paths:
  (a) **Client-side** — host a custom `@ffmpeg/core-vmaf` wasm with
  libvmaf + the `.json` model as a second `installGroup`; bigger binary,
  stays free-tier.
  (b) **Pro/server** — VMAF is CPU-heavy; a paid backend makes it a Pro
  metric per [[feedback_pro_vs_free_pricing]]. Recommended default.
  Either way, bundle easyVmaf-style preprocessing (deinterlace, scale,
  framerate adaptation, frame-to-frame sync) ahead of scoring —
  ungated VMAF on mismatched clips returns garbage. References:
  github.com/gdavila/easyVmaf, github.com/slhck/ffmpeg-quality-metrics.
  **Resume signal:** an unprompted user pull for VMAF specifically.
  Declined alongside: github.com/psy-ex/metrics (SSIMULACRA2 /
  Butteraugli / CVVDP / XPSNR via GPU FFVship) — research-grade,
  GPU-bound, off-model for consumer chaining; revisit only with
  own-GPU-infra ([[project_pro_gpu_catalog]]).
- **PWA / offline / wake-lock for the ffmpeg tools (added 2026-06-04).**
  Inspired by github.com/tejaswigowda/ffmpeg-webCLI (GPL-3.0; ideas only,
  no code reuse). We already fetch ffmpeg-core from CDN via `@ffmpeg/util`,
  so the natural hook is a service worker that caches the ffmpeg-core
  wasm (~31 MB) + static assets for offline reuse after first load; add
  an installable PWA manifest and a Screen Wake Lock during long encodes
  so mobile devices don't sleep mid-render. This is a `packages/web`
  platform decision, decoupled from the tools themselves. Note: a Wave-T
  PWA drop entry already shipped 2026-05-14 (see Now §1) — this extends
  it to cover the heavy ffmpeg asset specifically.
- Compose / Scratchpad tool — evaluate after a chainable text-output tool ships
- **CommonForms — auto-detect form fields in PDFs.** Joe Barrow's
  FFDNet-S/L models (paper arXiv:2509.16506, ~1k stars on
  github.com/jbarrow/commonforms) take a PDF and return a fillable
  version. Solves a real pain ("make this PDF fillable") that none of
  our 20+ PDF tools cover.
  Gate (a) — ONNX export — **RESOLVED 2026-05-21**: huggingface.co/
  jbarrow/FFDNet-S-cpu and FFDNet-L-cpu ship ONNX-only weights
  (`FFDNet-S.onnx` is 38.4 MB), so it runs under `onnxruntime-web` and
  drops in alongside `bg-remove`/`ocr-pro`/`upscale`.
  Gate (b) — the license is still unstated; the README invites
  non-academic use by emailing the author. Resolve the license before
  shipping; the technical path is otherwise clear.
- **PDF chat-fill assistant** (revisit after Wave AI-Chrome lands).
  Inspired by SimplePDF Copilot
  (github.com/SimplePDF/simplepdf-embed/tree/main/copilot) — a chat
  sidebar that reads a PDF, fills fields, navigates pages, and
  submits. We can't use SimplePDF's reference impl directly: it requires
  a paid SimplePDF Pro account for the iframe and routes chat through
  a server with an LLM API key (both violate the no-server posture).
  But the *concept* is strong, and once Chrome's Prompt API + our
  existing pdf.js + form-fill primitives are in place, a fully local
  reimplementation is plausible. Keep on the wishlist; don't start
  while AI-Chrome is in flight.
- **`@wyreup/cli-browser` — opt-in Chromium-backed browser tools.**
  Separate npm package depending on Puppeteer/Playwright; not bundled
  with `@wyreup/cli` because Chromium adds 150–300 MB to the install.
  Users who want browser tools opt in via `npm i -g
  @wyreup/cli-browser`; tools declare `requires: { browser: 'required' }`
  so the registry's surface filter hides them where Chromium isn't
  present (same pattern as `webgpu` today). Candidate tool surface:
  `url-to-screenshot`, `url-to-pdf` (real Chrome rendering — better
  output than the existing jsPDF+html2canvas `html-to-pdf`), `web-archive`
  (single-file HTML capture), `url-to-markdown` (Reader-mode-style
  cleanup), `web-scrape` (selector-driven extraction). Strong chain
  fit: URL → text → summarize/translate. Decision: do **not** use this
  to bring Chrome Built-in AI into CLI/MCP — bundling 200 MB of Chromium
  to access an API our transformers.js fallback already covers in CLI
  is the wrong tradeoff.
- **`explain-code-pro`** (Pro, 1–2 credits) — paste a code snippet,
  get a plain-English walkthrough. Backend: `@cf/qwen/qwen2.5-coder-
  32b-instruct` (native Workers AI). Pairs with the free `regex-
  explain` and `sql-format-explain` heuristic tools — fills the
  general-code slot. Engineer-leaning audience. ~1-2 hours to ship
  once we want a code-focused Pro entry.
- **Alternative backend candidates for existing tools** (surveyed
  2026-05-23). Not new tools — model swaps to evaluate if the current
  backend hits a quality or pricing wall:
  - `@cf/openai/gpt-oss-120b` / `gpt-oss-20b` — reasoning + function
    calls, alternative to DeepSeek R1 for `deep-analysis-pro`. Open-
    weight, native pricing.
  - `@cf/google/gemma-4-26b-a4b-it` — multimodal (text + image),
    alternative to llama-3.2-11b-vision for the OCR/vision flow.
  - `@cf/nvidia/nemotron-3-120b-a12b` — reasoning, agentic. Another
    deep-analysis backend option.
  - `@cf/moonshotai/kimi-k2.6` — frontier-class 1T param successor to
    k2.5. **Rejected 2026-05-23** as a chat-long-pdf-pro target:
    pricing 60% higher than k2.5 ($0.95 + $4.00/M vs $0.60 + $3.00/M)
    would drop margin to 30% at our 2-credit price. Migrated to
    `llama-4-scout` instead (10M context, 4× cheaper). Keep noted
    in case quality complaints surface.
  - `@cf/qwen/qwen3-30b-a3b-fp8` — function-calling specialist for
    a future `json-extract-pro` swap if Llama 4 Scout disappoints.

### Catalog items evaluated 2026-05-23 — partner-billed, deferred

Surveyed against the full Cloudflare AI catalog (not just Workers
AI). These all exist as Cloudflare-hosted models, but with **partner
pass-through pricing** instead of Workers AI's neuron-cheap model.
Per-call cost at provider rates breaks our $0.02/credit gross
revenue math. Revisit if/when wyreup adds a higher-priced "Premium"
credit tier or a per-call billing surface.

- **`@cf/recraftv4-pro-vector` / `recraftv4-vector`** — text-to-SVG
  generation. **Unique in our catalog** (no in-browser equivalent;
  Flux gives raster). ~$0.025-0.04/call → would need 3+ credits to
  hit the 50% margin floor.
- **`@cf/black-forest-labs/flux-2-dev`, `flux-2-klein-4b`, `flux-2-
  klein-9b`** — premium image generation tiers above schnell.
  Klein-9b was specced as a 2-credit "HD" companion to image-
  generate-pro in Wave 2; still queued there.
- **`@cf/leonardo/phoenix-1.0`, `lucid-origin`** — premium image
  generation (Leonardo). Same partner-billing constraint.
- **`@cf/deepgram/aura-1`, `aura-2-en`, `aura-2-es`** — premium TTS.
  Specced as Wave 2 "text-to-speech-premium" with a 2-credit/800-char
  cap; still queued there.
- **`@cf/deepgram/nova-3`, `flux`** — conversational / real-time ASR.
  Better for multi-speaker meetings than Whisper but real-time
  surface (WebSocket/Durable Object) is its own engineering project.
- **`@cf/minimax/speech-2.8-turbo`, `speech-2.8-hd`** — voice cloning
  + emotion control. Only valuable if we build a voice-focused
  product.
- **`@cf/openai/gpt-image-1.5`, `@cf/bytedance/seedream-4.0`,
  `@cf/google/imagen-*`, `@cf/black-forest-labs/flux-kontext-*`** —
  image editing (vs generation). True "edit this photo from a
  prompt" surface; proxied at provider rates.
- **Video gen — `@cf/google/veo-3`, `veo-3.1`, `@cf/hailuo/hailuo-
  2.3`, `@cf/runwayml/gen-4.5`, `@cf/pixverse/*`, `@cf/wan/*`,
  `@cf/vidu/*`** — 13 partner-billed text-to-video models. Way out
  of our cost band.
- **`@cf/minimax/music-2.6`** — music generation. Cool, partner-
  billed, no chain story.
- **`@cf/pipecat-ai/smart-turn-v2`** — voice activity / turn detec-
  tion. Only useful as part of a voice-product surface; if we ever
  build that, this is a primitive.

Revisit conditions for any of the above: (1) wyreup ships a higher-
tier credit pack at $0.05+/credit, OR (2) Cloudflare moves the model
to native neuron pricing.

The previously-listed heavy-ML candidates (LaMa, GFPGAN, DDColor,
optical-flow video interpolation, ML video upscaling) move under the
Paused section's resume signal. They're not rejected — just not on the
horizon while AI work is on hold.

### Library expansion backlog (added 2026-05-17, closed 2026-05-18)

Seven libraries reviewed during the 2026-05-17 / 2026-05-18 push.
Outcomes:

- **PDF-lib** — ~~Already installed; covered by 22+ existing PDF
  tools.~~ Closed 2026-05-18 — added `pdf-flatten` (lock AcroForm
  fields into static content) and `pdf-form-fields` (read-only
  inspection of interactive fields). The CommonForms ML-based
  variant remains in Later.
- **SheetJS (`xlsx`)** — Already installed; 10+ csv/xlsx tools
  cover the surface (`csv-deduplicate`, `csv-diff`, `csv-info`,
  `csv-json`, `csv-merge`, `csv-template`, `csv-to-excel`,
  `csv-to-geojson`, `csv-to-json-schema`, `excel-info`,
  `excel-to-csv`). No new tools needed.
- **Mammoth.js** — ~~Closed 2026-05-18~~. `docx-to-text` shipped
  with text + Markdown-heading output modes. Dynamic-import keeps
  the ~120 KB gz cost out of the base bundle.
- **remark** — Closed without adding the dep. Existing markdown
  tools (`html-to-markdown`, `markdown-frontmatter`,
  `markdown-to-html`, `markdown-toc`) cover the surface via a
  different stack. Revisit only if a specific need arises.
- **@mozilla/readability** — ~~Closed 2026-05-18~~.
  `extract-article-text` shipped — text / HTML output with optional
  title prepend. URL-fetch variant deferred (browser CORS limits;
  CLI surface could ship later with a server fetcher).
- **JSZip** — Already installed (used by 6+ existing tools).
  ~~Closed 2026-05-18~~ with `zip-remove` (glob-based stripping)
  and `zip-flatten` (collapse to root with collision strategies).
- **pdf.js (`pdfjs-dist`)** — Already installed; no new tools
  identified beyond what `pdf-to-text` / `pdf-to-image` /
  `pdf-info` cover.

Net: **9 new free tools** from the audit (Mammoth ×1, Readability
×1, pdf-lib ×2, JSZip ×2, compromise ×3). All `permanent free`.
The compromise additions (`text-sentences`, `text-keywords`,
`text-dates`) weren't on the original list — added because
compromise enables the "free heuristic, PRO upgrade" pattern with
real semantic primitives.

---

## Hard nos (do not reopen without explicit re-evaluation)

- **Visual node-graph chain editor** — locked linear-only per
  `product_chain_ux.md`. We differentiate on simplicity.
- **Server-side AI** (OpenAI, Anthropic via API) — contradicts the privacy
  pitch. Every Wyreup tool runs on the user's device.
- **Chrome Built-in AI (Gemini Nano APIs)** — investigated and rejected
  2026-05-04 after a multi-stage brainstorm. Rationale, durable: (a)
  vendor lock to Google's model + Chrome's API + Google's roadmap, same
  shape as "server-side AI" above; (b) 22 GB Gemini Nano download is
  100× our current largest model and only Chrome desktop hardware that
  meets the floor (16 GB RAM, 22 GB disk) gets to use the result;
  (c) origin-trial API surface that may break before GA; (d) the only
  genuinely new capabilities it would unlock (proofread / rewrite /
  write) are already addressable via Gemma 4 E2B (~1.5–2 GB at int4,
  Apache 2.0, cross-browser) when Wave R resumes — and Gemma's
  multimodal surface gives us more than Chrome AI's seven text-only
  APIs. Reopen only if the Chrome APIs become a W3C standard
  implemented across Firefox + Safari + Chrome (eliminating the
  vendor-lock and asymmetry concerns) AND there's confirmed user
  demand. The Wave R / Gemma 4 path subsumes everything Chrome AI
  would have offered, with none of the lock-in.
- **User accounts for the free tier** — free stays account-less.
- **Cloud TTS / STT APIs** (`edge-tts`, AWS Polly, Google Cloud TTS,
  ElevenLabs, `webkitSpeechRecognition` for non-on-device langs) — phone
  home. Never the default.
- **Third-party analytics** (Plausible, Fathom, etc.) — still phone home.
- **Social-share widgets** — `navigator.share` + clipboard fallback is enough.
- **Newsletter signup UI** — not aligned with tool-first positioning.
- **Pomodoro / basic calculator** — not file-oriented.
- **CAD (DXF/DWG)** — needs ODA File Converter binary.
- **PDF → Word (`.docx`)** — heavy and niche in-browser.
- **DjVu support (`djvujs`)** — the only mature in-browser DjVu
  decoder, `RussCoder/djvujs`, is GPL-licensed (v3+). Bundling it into
  MIT-licensed `@wyreup/core` is a copyleft conflict. Reopen only if a
  permissively-licensed DjVu decoder appears. (Evaluated 2026-05-21.)

---

## Memory references

Long-form context for future sessions:

- [`competitor_bentopdf.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_bentopdf.md) — 12.7k-star PDF toolkit (AGPL-3.0), ships visual workflow builder
- [`competitor_ashim.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_ashim.md) — self-hosted Docker image manipulator with 13 local-AI tools
- [`competitor_your_everyday_tools.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_your_everyday_tools.md) — 89-tool Python/Flask reference + Tier 1–3 queue
- [`product_chain_ux.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/product_chain_ux.md) — linear-only chain UX decision (locked)
