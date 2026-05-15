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
period.** No Pro deployment until there's an audience to convert.
Wave M (monetization) stays scoped but deployment defers until weekly
active users justify the gate.

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

**Still to ship:**
- **SEO surface area.** Every tool needs a real page with examples,
  not just a runner. Long-tail wins.
- **Toolbelt as the wedge.** Showpiece preset chains on landing
  (PDF → text → translate; image → describe → alt-text).
- **One Show HN attempt** with triggers + catalog-breadth angle.
- **Traffic measurement.** Cloud-hosted analytics (Plausible, Fathom,
  etc.) is a hard no — see below. Options: server-side log analysis
  on Cloudflare access logs, or self-hosted Plausible on our own
  infra. Decision deferred; not load-bearing for the free push.

### 4. Wave U — Standalone tool expansion

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

**Remaining Wave-U deck (Bucket 2, defer until user signal):**
- **`openapi-report`** — chain `openapi-validate` → `text-template`
  → Markdown summary for CI / PR comments.
- **`html-redact`** — `text-redact` PII patterns over HTML preserving
  structure (today's `text-redact` is plaintext-only).
- **`ocr-suspicious`** — `ocr` + `text-suspicious` on images.
  Threat model: prompt-injection in product/poster screenshots.
- **`csv-sort`** / **`csv-filter`** — close the papaparse family
  (dedupe + merge + diff exist, sort/filter don't).
- **`diff-apply`** — apply a unified diff to a file. Consumer of the
  text-diff producer.

---

## Next (scoped, not started)

Ordered by recommended sequence.

### Wave M — Monetization (Lemon Squeezy + hosted AI)

Scope decided 2026-05-14, framing sharpened 2026-05-15;
**deployment deferred** until the free push produces measurable
weekly actives. Build the infrastructure (license keys, billing,
hosted-AI client) in branches; flip the gate when ready.

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
- **Vision (Replicate vision LLMs)** — `image-ocr-hq`,
  `image-describe-hq`, `extract-table-from-image-hq`,
  `read-handwriting`, `analyze-chart`. tesseract OCR stays free
  baseline.
- **Image generation (Replicate Flux schnell + Real-ESRGAN)** —
  `image-generate`, `upscale-hq`, `inpaint`, `style-transfer`,
  `image-variants`. We have **no** in-browser image generation
  today, so these are pure-Pro.
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

Ordered by priority. The `pdf-redact` visual UI and `regex-visualize`
tool are now in **Now** as the two high-confidence wins.

1. **Self-host AI model CDNs on R2.** Eliminates third-party touches
   (jsdelivr, googleapis, huggingface) currently flagged by
   `tools/check-privacy.mjs`. R2 egress is free. Highest-leverage privacy
   improvement we have. Affects shipped AI tools, not paused ones.
2. **Unpublish deprecated skill packages from npm.** `@wyreup/skill`,
   `@wyreup/cli-skill`, `@wyreup/mcp-skill` were removed from the repo on
   2026-05-01. The npm tarballs at `0.2.0` still exist — mark them
   deprecated with a pointer to `wyreup install-skill`, or unpublish.
3. **`@vite-pwa/astro` dev deps audit.** Run bundle analyzer; verify no
   dev tooling leaks into production. Cheap, do on next wave boundary.
4. **`face-blur` Node integration test skip.** MediaPipe doesn't init
   under vitest's jsdom-less env. Re-enable if a better headless test
   path emerges.
5. **Lazy-load runner variants in `ToolRunner.svelte`.** Currently
   statically imports 11 runners (~162 KB containing 10 unused per page).
   Real savings ~10–30 KB/variant after Vite hoists shared deps. Pair
   with `<link rel="modulepreload">` to avoid the waterfall. **Defer**
   until bundle analysis shows the loading-state UX cost is worth it.
7. **PWA manifest screenshots[].** The 2026-05-04 PWA pass added
   manifest id, lang/dir/categories, monochrome icon, msapplication
   tile metas, /offline fallback, and the iOS Safari install hint.
   Screenshots[] was deferred because it needs real product captures
   (not OG marketing imagery) at the recommended form factors:
   540×720 narrow + 1280×720 wide, both PNG. Capture during the next
   designer pass, drop into `packages/web/public/screenshots/` and add
   the entries to `astro.config.mjs` manifest.
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
- Translated CLI/MCP `skill.md` (Spanish, Japanese, etc.)
- Richer `wyreup init-tool` (param schema generation, component stubs,
  test templates)
- Animated GIF ↔ WebP conversion (ImageDecoder/ImageEncoder API)
- Compose / Scratchpad tool — evaluate after a chainable text-output tool ships
- **CommonForms — auto-detect form fields in PDFs.** Joe Barrow's
  FFDNet-S/L models (paper arXiv:2509.16506, ~1k stars on
  github.com/jbarrow/commonforms) take a PDF and return a fillable
  version. Solves a real pain ("make this PDF fillable") that none of
  our 20+ PDF tools cover. Gating questions before we commit:
  (a) does FFDNet have an ONNX export that runs under
  `onnxruntime-web` — if yes, drops in alongside `bg-remove`/`ocr-pro`
  cleanly; if no, we're stuck with CLI-only via a Python sidecar,
  which doesn't fit the cross-surface story.
  (b) license is unstated in the repo; README invites non-academic use
  to email the author. Resolve before shipping.
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

The previously-listed heavy-ML candidates (LaMa, GFPGAN, DDColor,
optical-flow video interpolation, ML video upscaling) move under the
Paused section's resume signal. They're not rejected — just not on the
horizon while AI work is on hold.

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

---

## Memory references

Long-form context for future sessions:

- [`competitor_bentopdf.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_bentopdf.md) — 12.7k-star PDF toolkit (AGPL-3.0), ships visual workflow builder
- [`competitor_ashim.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_ashim.md) — self-hosted Docker image manipulator with 13 local-AI tools
- [`competitor_your_everyday_tools.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_your_everyday_tools.md) — 89-tool Python/Flask reference + Tier 1–3 queue
- [`product_chain_ux.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/product_chain_ux.md) — linear-only chain UX decision (locked)
