# Wyreup Roadmap

_Updated: 2026-05-01_

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

Direction set 2026-05-01: **finish Wave T, ship two high-confidence tool
wins, then push Wave U (standalone tools).** No new ML / LLM work until
the catalog has visibly grown and the rules engine is in users' hands.

Sequence below is the order to land things.

### 1. Wave T — Triggers, rules, PWA drop entry

Make Wyreup automatic. The foundation is shipped; the rules engine is the
missing 20% that turns the existing pieces (auto-run, batch, watch, saved
chains) into one product story.

**Already shipped (foundation):**
- `/chain/run?steps=...&auto=1` — runs immediately when a file is available
- `chainStorage` IndexedDB hand-off for cross-page chain navigation
- PWA standalone redirect to `/tools` (installed users skip the marketing landing)
- Saved chains as first-class cards on `/tools`
- Batch mode — run a chain on every file in a folder, ZIP outputs
- `wyreup watch` daemon — runs a chain on every new file in a folder
- Consent gate for auto-run chains with AI/heavy install footprint
- Shareable chain URLs with name display + step-count cap

**Remaining scope:**
- **Trigger rules** — persistent declarative `"any audio/* → run chain X"`
  in localStorage / `/my-kit`. Resolution: most-specific MIME first, then
  user-defined order. UI in `/my-kit`.
- **Trigger node primitive** in the chain builder — first step declares
  the MIME match. Saving a chain with a trigger registers the rule.
- **`file_handlers` wired through the trigger system** — OS-level "Open
  with Wyreup" routes to the matching saved chain.
- **Conflict resolution UX** — reorderable list when two chains claim the
  same MIME.

**Open questions:**
- Default off vs on for auto-run on first use (preview-before-run toggle?)
- Cross-device rule sync — Pro tier feature (Wave M)
- Should `record-audio → transcribe` be a default trigger? Probably no —
  better as a pre-built saved chain users opt into.

### 2. Two high-confidence tool wins

Both are small, deterministic, and fix real friction in existing tools.

- **`pdf-redact` / `pdf-crop` visual rectangle UI** (~1–2 days). Canvas
  drag-to-draw overlay on the PDF preview, emits the
  `[{x, y, width, height, page}]` shape the tools already accept. Reuses
  `PreviewRunner`'s pipeline. Replaces the current JSON-textarea fallback
  that's unusable for non-developers.
- **`regex-visualize`** new tool (~1–2 days). `regexp-tree` AST → SVG
  railroad render (~200 lines of render code). Chains after `regex-tester`.

### 3. Wave U — Standalone tool expansion

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

**Batch 1 — libraries already installed (near-free):**
- **`text-diff`** — uses `diff` (already in deps). Unified + side-by-side output.
- **`sql-format`** — uses `sql-formatter` (already in deps). Dialect picker.
- **`pdf-rotate`** — `pdf-lib` (already in deps). Per-page rotation.
- **`pdf-encrypt`** / **`pdf-decrypt`** — `pdf-lib` password protection.
- **`pdf-extract-images`** — `pdfjs-dist` (already in deps) to pull
  embedded images out as a ZIP.
- **`color-contrast`** — `culori` (already in deps). WCAG AA/AAA pass/fail
  for two colors at given font sizes.
- **`color-blind-simulator`** — `culori` matrix transforms. Simulate
  protanopia / deuteranopia / tritanopia on an uploaded image.

**Batch 2 — small new libs (low risk):**
- **`csv-diff`** / **`csv-deduplicate`** / **`csv-merge`** — Papa Parse
  + key-based join logic.
- **`markdown-toc`** — walks `marked` AST (already in deps).
- **`xml-format`** / **`xml-to-json`** / **`json-to-xml`** — `fast-xml-parser`.
- **`json-schema-validate`** — `ajv`.
- **`html-minify`** / **`css-minify`** — `html-minifier-terser`,
  `clean-css`. (`prettier` already in deps for the format counterparts.)
- **`unicode-info`** — character details for selected text. No lib.
- **`hmac`** — Web Crypto. Pairs with existing `hash`.

**Out-of-scope for Wave U:**
- Anything that needs a model download (that's Wave Q, paused)
- Anything that needs a server roundtrip
- Anything beyond a single command's worth of UX

Ship Batch 1 first (probably 1–2 days each, several can land in a week).
Re-evaluate Batch 2 after Batch 1 is in users' hands — community signal
should drive the next picks.

---

## Next (scoped, not started)

Ordered by recommended sequence.

### Wave M — Monetization (Lemon Squeezy)

The first paid surface. Comes after Wave T + Wave U so Pro tier sits on
top of a visibly broader catalog instead of one experimental ML feature.

- Pricing page (`/pricing`), two tiers: Free + Pro
- Pro scope: CLI Pro features (batch flags, chain scripting), My Kit
  cloud sync, priority support, premium-model surfaces if/when Wave Q
  resumes
- Lemon Squeezy overlay checkout (JS embed, no redirect)
- Cloudflare Worker for webhook validation + license-key state in KV
- License-key validation endpoint, rate-limited, local cache for offline grace
- **Paid tier does NOT change the free tier's privacy pitch.**

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

### Wave AI-Chrome — Chrome Built-in AI (Gemini Nano APIs)

User-approved 2026-05-03. Distinct lane from the paused Wave R (WebLLM)
because Chrome's built-in APIs are **zero install** — Gemini Nano is
baked into the browser, hardware-accelerated, no model download we have
to host or warn about. The transformers.js fallback already shipping in
existing tools means non-Chrome users see no regression.

Two-pronged execution:

1. **Capability adapter for existing tools.** When `'translator' in
   self`, `'summarizer' in self`, `'languageDetector' in self`, etc.
   resolve true at runtime, route the call to the native API; otherwise
   fall back to transformers.js. Affects `text-translate`,
   `text-summarize`. Net effect: Chrome users get ~10× faster runs and
   skip the 156 KB transformers.web.js chunk download.

2. **New tools for capabilities we don't have.** Three candidates,
   pending the brainstorm scoping pass to lock the order:
   - `text-proofread` — grammar + readability rewrites
   - `text-write` — generate content to spec (subject + tone + length)
   - `text-rewrite` — adjust tone/length of existing text

Tradeoffs:
- All seven Chrome built-in APIs are origin-trial today (Translator,
  Summarizer, Proofreader, Writer, Rewriter, Language Detector, Prompt).
  Feature-detect each at runtime and degrade gracefully — never throw
  on a non-Chrome browser.
- Origin trial means API surface may shift. Pin behavior behind our own
  thin wrapper so a breaking upstream change is one diff, not seven.
- The `Prompt API` is the most flexible (general-purpose chat-style
  input) but also the most likely to ship with usage caps. Hold off on
  building tools that depend on it as their primary backend until after
  GA.

Resume signal for the still-paused Wave R (WebLLM): unchanged — confirmed
user pull for sub-500 MB instruct models or a paid Pro tier that
justifies the heavy download. Chrome Built-in AI does *not* satisfy
that signal because it solves a different shape of problem (small
ambient text ops, not full chat).

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

### Wave R — Offline LLM (WebLLM)

Gemma 2 / Phi 3.5 / Llama 3.2 in the browser via WebLLM. 500 MB – 1.5 GB
download, WebGPU-required. Tools would have been `local-chat`,
`text-rewrite`, `text-summarize-llm`, `text-explain-code`, stretch
`wyreup-agent`.

Resume signal: a sub-500 MB instruct model that runs at usable speed on
average hardware, OR a paid Pro tier where the heavy download is
justified by sticky use.

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
