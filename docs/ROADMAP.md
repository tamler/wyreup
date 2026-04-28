# Wyreup Roadmap

_Updated: 2026-04-27_

A single source-of-truth for what's shipped, what's next, and what we've
deliberately deferred or rejected. Memory references point at entries in
`~/.claude/projects/-Users-jacob-Projects-toanother-one/memory/` where the
background lives.

---

## 0. Shipped

### Product
- **`@wyreup/core`** — **119 tools across 14 categories, 1566 tests**, dual browser/node build
- **`@wyreup/web`** — **147-page** Astro static site live at `wyreup.pages.dev` and `wyreup.com`
- **`@wyreup/cli`** — shell binary wrapping core, full execution surface (`run`, `chain`, stdin/stdout piping)
- **`@wyreup/mcp`** — MCP server (14 tests, 53 tools exposed via stdio)
- **`@wyreup/skill`** — dual-backend agent skill (CLI + MCP) — superseded by `wyreup install-skill`
- **`@wyreup/cli-skill`** — CLI-only variant — superseded by `wyreup install-skill cli`
- **`@wyreup/mcp-skill`** — MCP-only variant — superseded by `wyreup install-skill mcp`

### Tool inventory (by category)
edit (15) · media (14) · inspect (14) · dev (12) · convert (12) · create (11) · text (9) · privacy (7) · pdf (6) · optimize (6) · export (5) · archive (3) · finance (2) · audio (1)

### Install groups (opt-in, surfaced on `/settings`)
- **core** — ~90 deterministic tools, always loaded, ~5 MB
- **ffmpeg** — 14 audio/video tools sharing ffmpeg.wasm (~30 MB)
- **image-ai** — 4 image ML tools (bg-remove, upscale-2x, image-similarity, ocr-pro)
- **nlp-standard** — 4 NLP tools (sentiment, NER, summarize, embeddings)
- **speech** *(new)* — 1 tool today (`transcribe` via Whisper-tiny, ~30 MB)
- **vision-llm** *(new)* — 1 tool today (`image-caption` via vit-gpt2, ~100 MB)

### Platform
- Design system v1.3 ("Signal") locked in `packages/web/DESIGN.md`
- PWA: manifest, service worker, icons, Web Share Target, shortcuts, file_handlers
- Signal visual identity: corner brackets, solder-pad terminators, node connector dots, amber #FFB000 on near-black, Geist Sans body + Geist Mono labels/metrics
- CI: lint, typecheck, unit tests, build, isolation check, privacy scan, bundle size
- Deploy: GitHub Actions → Cloudflare Pages on push to main
- Release: changeset-based versioning via `changesets/action@v1`

### Privacy + ethics
- Every tool runs client-side
- No analytics, no cookies, no third-party scripts on pages
- No uploads — `check-privacy.mjs` gates static output
- MIT licensed

---

## 1. Pending user action (blockers)

_All previous launch blockers cleared as of 2026-04-27. Verified via
npm (`@wyreup/core`, `@wyreup/cli`, `@wyreup/mcp` all published at
0.2.0) and live site at `wyreup.com`._

Optional / when justified:
- Upgrade Cloudflare Pages to Pro ($5/mo) before high-activity dev
  stretches (500-build-per-month limit on free tier).

---

## 2. Waves (sequential)

Each wave is self-contained, pushes to main, and leaves the site green.

### Wave J — Chain builder + My Kit + SDK (done v0.3.0)

The "build-your-own-tool" surface. Chains become first-class, shareable,
and savable.

- **`/chain/build`** — linear dropdown-based chain builder. No node graphs
  (locked per `product_chain_ux.md`). Pick first tool → compatible next
  tools filter to match output MIME → repeat. Drop a file at the top to
  execute in sequence.
- **`/chain/run?steps=...`** — URL-encoded shareable chain executor.
  Anyone with the URL can drop a file and run the exact pipeline. This is
  the **"share tool"** primitive.
- **`/my-kit`** — localStorage-backed personal toolkit: saved chains with
  names, rename/delete/duplicate, JSON export/import for multi-device.
  No accounts, no backend.
- **Share button** on chain builder — copies the `/chain/run?...` URL.
- **`wyreup init-tool`** CLI scaffold — bootstraps a new `ToolModule` with
  the right folder structure, types, defaults, test file, and registry
  update. Enables community contribution.

### Wave K2 — Skill-installer pivot (done v0.4.3)

Replace the three npm skill packages (`@wyreup/skill`, `@wyreup/cli-skill`,
`@wyreup/mcp-skill`) with a unified **`wyreup install-skill`** CLI command.
npm distribution adds zero auto-wiring value for markdown skill files;
the CLI can detect the agent's skill directory, fetch the right skill.md
from GitHub, and write it in place — which npm can't do.

- Deprecate/unpublish the three skill packages from npm (within the 72h
  window) OR mark them deprecated with a pointer to the CLI command.
- Extend `@wyreup/cli`: `wyreup install-skill [cli|mcp|combined]`
  - Interactive picker if no arg given
  - Auto-detects Claude Code config (`.claude/skills/` etc.)
  - Fetches current skill.md from GitHub raw
  - `--update` flag re-fetches to pick up upstream changes
  - `--list` shows installed skills + versions
- Update `/skill`, and any doc that promoted `npm install -g @wyreup/skill`
  to promote `wyreup install-skill` instead.
- GitHub raw URLs stay available as a manual fallback for users who
  want to copy-paste into a non-standard agent runtime.

### Wave L2 — Param schema + browser Translator + UI gating (mostly shipped 2026-04-27)

Foundation UI improvement that unlocks better ergonomics everywhere.

- **`ToolModule.paramSchema?`** — shipped. Supports `string`, `number`,
  `range`, `boolean`, `enum`, `multi-enum`, `array`, `json`. Plus
  `showWhen` (conditional fields) and `optionsFrom` (cascading
  category → unit dropdowns). The web's auto-generated params form
  consumes the schema when present and falls back to `defaults`-based
  inference otherwise.
- **Retrofit the heavy hitters**: shipped for the obvious enum/cascade
  cases — `split-pdf`, `base64`, `url-encoder`, `flip-image`,
  `pdf-to-image`, `pdf-metadata`, `html-to-markdown`, `uuid-generator`,
  `calculator`, `date-calculator`, `image-to-pdf`, `page-numbers-pdf`,
  `watermark-pdf`, `unit-converter` (cascading from category),
  `regex-tester`, plus the previous batch (`compress`, `convert`, etc.).
  Still queued: visual-rectangle UIs for `pdf-redact` / `pdf-crop`
  (tracked under Tech debt; needs canvas runners).
- **Browser Translator API for `text-translate`** — queued. Plan
  unchanged:
  1. Try `translation.createTranslator()` (Chrome 131+)
  2. Try `window.translator` (Firefox Translations)
  3. Fall back to M2M100 (our 400 MB bundled model)
  Saves every user on modern browsers from the 400 MB download.

### Wave L3 — Finance UI (shipped)

Custom Svelte runners for finance tools (`CompoundInterestRunner`,
`InvestmentDcaRunner`, `PercentageCalculatorRunner`,
`DateCalculatorRunner`) with bespoke layouts — currency formatting,
live recalc, mode chips, calendar pickers. All four are wired into
`VARIANT_MAP`.

### Wave K — Library expansions (shipped)

All three category openers landed:

- **ffmpeg.wasm** — shipped, opt-in via `/settings`. Group `ffmpeg`
  shares ~30 MB across 14 tools: `convert-audio`, `convert-video`,
  `extract-audio`, `trim-media`, `compress-video`, `video-to-gif`,
  `convert-subtitles`, `burn-subtitles`, `video-concat`,
  `video-add-text`, `video-speed`, `video-overlay-image`,
  `video-crossfade`, `video-color-correct`.
- **openpgp.js** — shipped: `pgp-encrypt`, `pgp-decrypt`, `pgp-sign`,
  `pgp-verify`.
- **JSZip wiring** — shipped: `zip-create`, `zip-extract`, `zip-info`.

### Wave L — AI expansion (browser ML) (partially shipped)

Per `packages/core/docs/ai-models.md` recommendations.

**Shipped:**
- **BiRefNet_lite** → `bg-remove` (MIT, ~100 MB fp16) — free tier
- **Swin2SR x2** → `upscale-2x` (~22 MB q4) — free tier
- **TrOCR-small** → `ocr-pro` (~150 MB q8) — free tier
- **CLIP ViT-B/16** → `image-similarity` + `text-embed` — free tier
- **DistilBART** → `text-summarize` (~80 MB) — free tier
- **DistilBERT** → `text-sentiment`, `text-ner` (~65 MB) — free tier
- **M2M100 418M** → `text-translate` (~400 MB, fallback only) — free tier
- **all-MiniLM-L6-v2** → `text-embed` (~23 MB) — free tier

**Queued** (paid-tier candidates):
- **LaMa** — object erase / inpainting (~208 MB)
- **GFPGAN** — face restoration (~350 MB)
- **DDColor** — B&W colorization

Heavy models opt-in via `/settings` install groups.

### Wave M — Monetization (Lemon Squeezy)

The first paid surface. Requires a tiny amount of server-side work.

- **Pricing page** (`/pricing`) — two tiers: Free (current) + Pro.
- **Pro tier scope** — my recommended split:
  - Premium AI models (LaMa, GFPGAN, DDColor, future)
  - CLI Pro features: batch mode flags, chain scripting, premium model
    access
  - My Kit cloud sync across devices
  - Priority support
- **Lemon Squeezy overlay checkout** — JS embed, no redirect.
- **Cloudflare Worker** for webhook handling (the only server component) —
  validates Lemon Squeezy signatures, stores license-key → subscription
  state in Workers KV.
- **License key validation** endpoint — called by CLI/MCP to gate Pro
  features. Rate-limited; caches locally for offline grace period.
- **Customer portal link** — Lemon Squeezy hosted.
- **Paid tier does NOT change the free tier's privacy pitch.** Free web
  stays free + fully private. Pro adds features, not restrictions.

### Wave N — Tier 2 utility tools (shipped)

From `competitor_your_everyday_tools.md` queue. 9 tools shipped: +32 KB core bundle.

- **excel-to-csv** — SheetJS, single sheet or all-sheets ZIP
- **excel-to-json** — SheetJS, array of objects / arrays / multi-sheet envelope
- **csv-to-excel** — SheetJS, auto-detect delimiter, multi-file to multi-sheet
- **json-to-excel** — SheetJS, objects / arrays / {sheets:...} multi-sheet format
- **excel-info** — inspect sheet count, row/col counts, 5-row preview
- **merge-workbooks** — combine 2-20 XLSX files, optional sheet-name prefix
- **split-sheets** — one XLSX per sheet, output as ZIP
- **html-to-pdf** — jsPDF + html2canvas; browser-only (throws in Node with clear error)
- **barcode** — jsbarcode; Code 128, Code 39, EAN-13/8, UPC-A, ITF-14, MSI; SVG (Node-safe) + PNG (browser)
- **Animated GIF ↔ WebP** — deferred; ImageDecoder/ImageEncoder API coverage
  acceptable for a stretch goal but not worth the complexity in this wave.
  Candidate for Wave P if demand warrants.
- **Date calculator** — already shipped in Wave I (skip)
- **Unit converter** — already shipped in Wave I (skip)

### Wave O — Self-hosted Docker

Competes directly with BentoPDF and Ashim for the homelab/self-hosted
audience. Wyreup + all its tools + CLI + MCP server in one container,
installable via `docker run`.

- **Dockerfile** — node:20-slim base + build artifacts
- **docker-compose.yml** — single-service deploy
- **Image tags** — GHCR + Docker Hub
- **Homelab docs** — reverse proxy examples (Traefik, Caddy), persistent
  volume mounts for user uploads, environment variable reference

### Wave R — Offline LLM (WebLLM + Gemma / Phi / Llama)

Opt-in, WebGPU-required, 500 MB – 1.5 GB download. Enables on-device
language model capability without phoning home. Adjacent to Wave Q's
generative-AI direction but scoped specifically to instruct-tuned
text generation via WebLLM (chat, rewrite, explain) — Wave Q owns
the media generation surface (image / speech / audio).

- **Runtime:** WebLLM (MIT) + MLC-AI's quantized models
- **Candidate models:**
  - Gemma 2 2B Q4 (~500 MB, Apache-2.0)
  - Phi 3.5 mini (~1 GB, MIT)
  - Llama 3.2 1B (~500 MB, Llama license — check commercial terms)
- **Tools enabled:**
  - `local-chat` — opt-in chat tool, labelled "experimental, large download"
  - `text-rewrite` — tone changes, simplification, formalization
  - `text-summarize-llm` — better than DistilBART when LLM is installed
  - `text-explain-code` — code walkthrough
  - `wyreup-agent` (stretch) — micro-agent that picks Wyreup tools
    from natural-language tasks, limited to single-tool invocations
- **Install group:** `llm` — standalone PWA toggle, WebGPU-required
- **Paid-tier candidate:** larger models (7B/8B at ~4 GB) behind Pro

### Wave P — CLI core execution + truth-in-advertising audit (done v0.5.3)

Shipped the CLI's core tool-execution surface and audited every documentation
surface against the live implementation.

- **`wyreup run <tool-id>`** — single-tool execution with `-o`, `-O`, `--param`, per-tool flags
- **Tool-id shorthand** — `wyreup <tool-id> ...` falls through to `run`
- **`wyreup chain`** — `--steps "tool1|tool2[key=val]"` and `--from-url` support
- **`parseChainString` / `serializeChain`** — shared util in `@wyreup/core`, imported by CLI (and available for web)
- **Stdin/stdout piping** — single-in/single-out tools support Unix pipes
- **Multi-output routing** — multi-output tools require `-O <dir>` and print clear error otherwise
- **Truth-in-advertising audit** — every public surface checked; drift fixed; audit log at `docs/audit-2026-04-17.md`
- **87 CLI tests** (was 33 pre-wave)

### Recurring: Truth-in-advertising audit

Run quarterly. For each public surface:
1. Check every command example runs without error
2. Verify every tool ID mentioned exists in the registry
3. Confirm every URL resolves to a working page
4. Update the audit log at `docs/audit-YYYY-MM-DD.md`

### Wave P+ — Longer horizon

No priority order; surface when justified.

- **Self-hosted AI models on R2** — eliminates the third-party CDN touches
  (jsdelivr, googleapis, huggingface) currently flagged in
  `tools/check-privacy.mjs`. R2 egress is free, so no cost impact.
- **Multi-user / team surface** — Pro tier add-on
- **Additional language skills** — translate the CLI/MCP skill.md files
  to Spanish, Japanese, etc. for broader agent reach
- **Browser extension** — right-click "send to Wyreup" on images / links
- **Video tools beyond ffmpeg** — optical flow interpolation, upscaling
  models for video
- **Contribution scaffold maturity** — richer `wyreup init-tool` with
  param schema generation, component stubs, test templates

### Wave Q — Generative AI (kicked off 2026-04-27)

Opens the **generation** category alongside the existing
processing/inspection categories. Six capability tracks: speech-to-
text, text-to-speech, text-to-image, image-to-text, image-to-image,
audio (music + source separation). Each track has a four-step ladder
(OS-native → tiny → medium → heavy/Pro).

#### Status

- ✅ **`TextInputRunner` runner variant** — shipped 2026-04-27.
  28 text-input tools (`text-translate`, `text-summarize`, every
  formatter, `regex-tester`, `url-encoder`, etc.) now open with a
  textarea instead of a file dropzone. Unlocks every Wave Q
  text-input tool retroactively.
- ✅ **"Speak this text" Tier-0 TTS** — shipped 2026-04-27. Button
  on `TextInputRunner` and `TextResultRunner` pipes visible text to
  `speechSynthesis`. Zero download, OS voices, playback-only.
- ✅ **`transcribe` (Whisper-tiny STT)** — shipped 2026-04-27.
  First chainable Wave Q tool. Audio file → text. ~30 MB Xenova/
  whisper-tiny via transformers.js, opt-in via `speech` install
  group. Decodes any browser-supported audio (wav/mp3/m4a/ogg/webm/
  flac), resamples to 16 kHz mono via OfflineAudioContext, runs
  through Whisper. Optional language hint, transcribe-vs-translate
  toggle, optional timestamps (JSON output).
- ✅ **`image-caption` (vit-gpt2)** — shipped 2026-04-28.
  Image → text caption. ~100 MB Xenova/vit-gpt2-image-captioning
  via transformers.js `image-to-text` pipeline. Opt-in via
  `vision-llm` install group. Tier-2 upgrade path: Florence-2-base
  for richer captions / VQA / OCR-style extraction.
- 🟡 **Canonical MIME picks** — pending. Decisions to make before
  any tool ships, so chains compose without surprises:
  - TTS output: `audio/wav` (recommended — uncompressed, universal)
    or `audio/mpeg` (smaller, lossy)
  - Image-gen output: `image/png` (lossless) or `image/webp`
  - STT / caption output: `text/plain`
  - Music-gen output: `audio/wav`
  - Stem split: multiple `audio/wav` outputs

#### Three principles

1. **Delegate to the OS/browser when it exists.** `speechSynthesis`,
   the global `Translator` API, Chrome Built-in AI (Gemini Nano) all
   ship with the platform — zero download, on-device, free. Always
   feature-detect first, fall back to bundled second.
2. **Smallest viable model first.** Validate the install / WebGPU /
   first-load consent UX with a tiny model before committing to a
   heavier one. Tier-0 demonstration → Tier-1 shipped → Tier-2 added
   on demand → Tier-3 behind Pro.
3. **Privacy non-negotiable.** Nothing leaves the device by default.
   Cloud APIs that phone home (`edge-tts`, ElevenLabs, AWS Polly,
   Chrome's `webkitSpeechRecognition` for non-on-device languages)
   are **off by default** and require explicit, labelled opt-in if
   ever offered.

#### Capability tracks

##### 1. Speech → Text (STT)
| Tier | Option | Size | Notes |
|---|---|---|---|
| 0 | Chrome `SpeechRecognition` *(when on-device)* | 0 | Many langs route through Google servers — feature-detect carefully; opt-in only |
| 1 | **Moonshine-tiny** | ~30 MB | Designed for edge, fast on short clips. **First STT to ship.** |
| 2 | Distil-Whisper / Whisper-base | ~150 MB | Long-form, multi-language |
| 3 | Whisper-large-v3 | ~1.5 GB | Best in class — Pro tier |

##### 2. Text → Speech (TTS)
| Tier | Option | Size | Notes |
|---|---|---|---|
| 0 | **Web Speech API (`speechSynthesis`)** | 0 | Uses OS voices (macOS/Win/Android/iOS). **First TTS to ship.** Quality varies by OS. |
| 1 | **Kitten-TTS-15M** | ~15 MB | Floor option for OSes with poor voices |
| 1 | **Kokoro-82M** | ~80 MB | Multi-voice, natural-sounding |
| 3 | F5-TTS / XTTS-v2 voice cloning | 500 MB – 1 GB | Pro tier. Needs consent UX (recording-of-self) |

##### 3. Text → Image
| Tier | Option | Size | Notes |
|---|---|---|---|
| 1 | **MobileDiffusion-tiny** at 256–512 px | ~520 MB | **First diffusion to ship** — validates the stack |
| 2 | SD-XS / SD-Turbo at 512 px | ~1.5 GB int4 | 1-step generation, ~3-5 s on M2 |
| 3 | SDXL-Turbo distilled | ~3 GB int4 | Pro tier |
| — | FLUX.2 [klein] 4B | ~2 GB int4, 3-4 GB working | Track only — won't fit consumer WebGPU today |

##### 4. Image → Text (caption / VQA)
| Tier | Option | Size | Notes |
|---|---|---|---|
| 1 | **Florence-2-base** | ~200 MB | "Describe this", "extract receipt total", "alt text". Underrated. |
| 1 | Moondream2 / BLIP-base | 200 – 800 MB | Alternatives if Florence-2 quality lags |

##### 5. Image → Image
| Tier | Option | Size | Notes |
|---|---|---|---|
| 1 | Fast neural style transfer nets | 5 – 50 MB | Tiny, fun |
| 2 | SD-inpaint | ~1 GB | Object erase / outpaint |
| 2 | IP-Adapter on top of MobileDiffusion | +50 MB | Variation in style of an uploaded image |
| 3 | ControlNet-Lite + SD-small | ~1 GB | Sketch → image |

##### 6. Audio (music + source separation)
| Tier | Option | Size | Notes |
|---|---|---|---|
| 2 | **Demucs-tiny** | ~100 MB | Vocal / drum / bass stem split. Counterpart to bg-remove. |
| 2 | MusicGen-small | ~300 MB | Text → music, niche |
| 3 | AudioLDM2 | ~600 MB | Higher-quality audio gen |

#### Adjacent — Compose / Scratchpad tool *(evaluate after first ship)*

A "type text, then send to..." surface. Markdown editor + live
preview + chain-launcher that lists every text-accepting tool via
`toolsForFiles([syntheticTxtFile])`. Higher leverage than a
standalone markdown editor (which just duplicates `markdown-to-html`
behind a heavier UI). Defer until at least one Wave Q generative
tool ships — that decides whether typing-then-doing is the actual
flow, or whether per-tool `TextInputRunner` surfaces are enough.

#### Hard "no" by default

- **Cloud TTS APIs** — `edge-tts` (Microsoft), AWS Polly, Google
  Cloud TTS, ElevenLabs. Free or cheap, but they violate the
  "everything runs on your device" pitch. **Never default to these.**
  If offered, gate behind explicit consent UI labelled "this sends
  your text to {vendor}" and flag in `check-privacy.mjs`.
- **Chrome `webkitSpeechRecognition`** — uses Google servers for
  many languages. Only use if we can confirm on-device for the
  user's selected language; otherwise prefer bundled Moonshine.

#### First three to ship (in order)

1. **"Speak this text" UI affordance** *(0 MB, no tool)* — a button
   on `TextInputRunner` / `TextResultRunner` that pipes the visible
   text to `speechSynthesis`. **Not a Wyreup tool** because the Web
   Speech API plays through the OS speakers and **does not expose
   the audio waveform** — there's no standard way to capture it as
   a file across browsers (Chromium has hacky paths via
   `getDisplayMedia`, Safari/Firefox have nothing). Treat it as
   playback-only. Universal across every text-result tool, ships
   the OS-delegate pattern with zero model footprint.
2. **TTS via Kitten-TTS-15M** *(~15 MB, opt-in)* — first **chainable**
   TTS. Outputs `audio/wav` so it slots into chains. Tool ID:
   `tts-kitten`. Smaller than Kokoro and good enough as a starting
   point; bump to Kokoro-82M when quality demands it.
3. **STT via Moonshine-tiny** *(~30 MB, opt-in)* — opens the
   speech-input category. Tool ID: `stt-moonshine`. Outputs
   `text/plain`. Combined with #2 you get the **voice-memo workflow**:
   record → `stt-moonshine` → `text-summarize` → `tts-kitten`.
   ~45 MB of new download for a complete chainable pipeline.

After those, **Florence-2-base** image captioning (~200 MB) is the
highest-leverage next add — opens image-to-text. Then
**MobileDiffusion-tiny** to validate the diffusion stack.

#### Install groups to add on `/settings`

| Group | Capability tracks | Cumulative size |
|---|---|---|
| `speech` *(new)* | STT (Moonshine) + TTS bundled (Kokoro / Kitten) | 30 – 200 MB |
| `vision-llm` *(new)* | Image captioning / VQA (Florence-2, Moondream) | 200 – 800 MB |
| `generative-image` *(new)* | Diffusion (MobileDiffusion → SD-XS → SDXL) | 0.5 – 3 GB |
| `generative-audio` *(stretch)* | Music gen + source separation (Demucs, MusicGen) | 100 – 600 MB |
| Existing | `core`, `ffmpeg`, `image-ai`, `nlp-standard`, `llm` (Wave R) | — |

#### Open product questions

These need answers before shipping the first track:

- **TTS output format** — `audio/wav` (universal, large) vs
  `audio/mpeg` (smaller, needs encoder). Recommendation: `wav`,
  add a separate `compress-audio` step in chains if size matters.
- **Image-gen size cap** — what resolution to allow on free tier
  before Pro gates it? 512 px feels right; 1024 px for Pro.
- **Voice cloning consent UX** — F5-TTS lets anyone clone any
  voice from a 3-second sample. Privacy-amazing for personal use,
  weaponizable for impersonation. Either ship behind aggressive
  "you must own this voice" consent + watermarking, or skip.
- **Whether to expose the Compose / Scratchpad tool** — see the
  Adjacent section above.

---

## 3. Technical debt

Captured here so it doesn't disappear.

- [ ] **Self-host AI model CDNs on R2** — eliminate third-party touches
  (jsdelivr, googleapis, huggingface). Tracked in-line in
  `tools/check-privacy.mjs` allowlist comment.
- [ ] **`@vite-pwa/astro` dev deps** — verify none leak into production
  bundle. Bundle analyzer check on next major wave.
- [ ] **`face-blur` integration test skip in Node** — MediaPipe doesn't
  init under vitest's jsdom-less env. Re-enable if a better headless
  test path emerges.
- [ ] **`pdf-redact` visual rectangle UI** — currently the tool's
  `rectangles` param falls back to a JSON textarea, which is unusable
  for non-developers. The right UX is a canvas-based "drag to draw"
  overlay on the PDF preview, similar to how `face-blur` works. Reuse
  `PreviewRunner`'s preview pipeline; add a redaction-rectangles
  drawing layer that emits the same `[{x, y, width, height, page}]`
  shape the tool already accepts. Standalone project — separate from
  the param-schema audit.
- [ ] **Regex visualizer (railroad diagrams)** — the user asked about
  [regex-vis](https://github.com/Bowen7/regex-vis) and
  [regexper-static](https://gitlab.com/javallone/regexper-static).
  regex-vis is React + reactflow — embedding it in Astro/Svelte means
  mounting a React island per page (real complexity). regexper-static
  is older, pure-JS, SVG output, low-maintenance — better fit but the
  upstream isn't actively maintained. Cleanest path: add a new
  `regex-visualize` tool that builds an AST with `regexp-tree`
  (already mature) and renders railroad SVG ourselves (~200 lines).
  Keep `regex-tester` as the matcher; let users chain matcher →
  visualizer. Estimate: 1–2 days. Not a paramSchema problem; it's a
  feature gap.
- [ ] **Lazy-load runner variants in `ToolRunner.svelte`** — currently
  statically imports all 11 runner components, so every tool page ships
  ~162 KB containing 10 unused variants. Switching to dynamic imports
  keyed off `VARIANT_MAP` would let each page load only its own runner.
  Real savings are smaller than the headline number (~10–30 KB/variant
  after Vite hoists shared deps like `DropZone`, `ParamsForm`,
  `ProgressBar`, `ChainSection`). Cost: extra request hop and a brief
  loading state post-hydration. Pair with `<link rel="modulepreload">`
  in the SSG'd page `<head>` (variant is known at build time) to fetch
  page chunk + runner chunk in parallel and avoid the waterfall. Skip
  for now — defer until bundle analysis shows it's worth the loading-
  state UX cost.

---

## 4. Explicitly deferred or rejected

These are closed questions. Do not reopen without explicit re-evaluation.

- **Visual node-graph chain editor** — linear file-to-file only. Locked
  per `product_chain_ux.md`. BentoPDF and Ashim both ship node editors;
  we differentiate on simplicity.
- **Server-side AI** (OpenAI, Anthropic, etc. via API) — contradicts the
  privacy pitch. Every Wyreup tool runs on the user's device.
- **User accounts for free tier** — no. Free stays account-less.
- **Social-share widgets** — Twitter/Reddit/LinkedIn bookmarklets track
  users. `navigator.share` + clipboard fallback (shipped) is sufficient.
- **Third-party analytics** — Plausible, Fathom, etc. still phone home.
  We use zero tracking. Privacy scan enforces this.
- **Newsletter signup UI** — not aligned with tool-first positioning.
  Interested users follow the repo or star on GitHub.
- **Pomodoro timer, basic calculator** (beyond the scientific one we
  shipped) — not file-oriented. Out of scope.
- **CAD (DXF/DWG) conversion** — requires ODA File Converter binary.
  Skip unless a pure-JS alternative emerges.
- **PDF → Word (.docx)** — docx generation in-browser is genuinely heavy
  and niche. Skip unless a lightweight library appears.

---

## 5. Memory references

Long-form context lives here. Future sessions read these for background:

- [`competitor_bentopdf.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_bentopdf.md) — 12.7k-star PDF toolkit, AGPL-3.0, already ships visual workflow builder
- [`competitor_ashim.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_ashim.md) — self-hosted Docker image manipulator with 13 local-AI tools
- [`competitor_your_everyday_tools.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/competitor_your_everyday_tools.md) — 89-tool Python/Flask reference + Tier 1-3 queue
- [`product_chain_ux.md`](../../../.claude/projects/-Users-jacob-Projects-toanother-one/memory/product_chain_ux.md) — linear-only chain UX decision (locked)

---

## 6. Checklist snapshot

What's actually on the critical path right now:

1. ✅ Flip repo public (done 2026-04-22)
2. Create `@wyreup` npm scope (still pending — `npm view @wyreup/core` returns 404)
3. Merge first Version Packages PR (unblocked once lockfile + scope are resolved)
4. Wave J — chain builder + My Kit + SDK
5. Wave K — ffmpeg + PGP + ZIP
6. Wave L — AI expansion (interleaves with K)
7. Wave N — Tier 2 utility tools
8. Wave M — Lemon Squeezy (only after N, once the capability surface
   justifies a Pro tier)
9. Wave O — Docker self-host (after Wave M — targets a distinct audience
   but easier to build once the platform is monetized and stable)
10. Wave P+ — longer horizon

Monetization and Docker intentionally come after capability expansion.
Building Pro before there's enough value is the wrong order; launching
Docker before the core is stable creates support burden.
