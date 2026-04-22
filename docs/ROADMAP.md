# Wyreup Roadmap

_Updated: 2026-04-22_

A single source-of-truth for what's shipped, what's next, and what we've
deliberately deferred or rejected. Memory references point at entries in
`~/.claude/projects/-Users-jacob-Projects-toanother-one/memory/` where the
background lives.

---

## 0. Shipped

### Product
- **`@wyreup/core`** — 72 tools across 11 categories, 831 tests, dual browser/node build
- **`@wyreup/web`** — 82-page Astro static site live at `wyreup.pages.dev`
- **`@wyreup/cli`** — shell binary wrapping core
- **`@wyreup/mcp`** — MCP server (14 tests, 53 tools exposed via stdio)
- **`@wyreup/skill`** — dual-backend agent skill (CLI + MCP)
- **`@wyreup/cli-skill`** — CLI-only variant (smaller token footprint)
- **`@wyreup/mcp-skill`** — MCP-only variant (smaller token footprint)

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

These are small, but only you can do them. Each unblocks something downstream.

- [ ] **Flip GitHub repo to public** — `gh repo edit --visibility public`.
  Required for OSS credibility, search indexing, and Contributor sign-ups.
- [ ] **Create `@wyreup` npm org** at `https://www.npmjs.com/org/create`
  (or as a user scope). Required before any `pnpm publish`.
- [ ] **Verify `NPM_TOKEN` repo secret** is set (it is as of 2026-04-21).
- [ ] **Merge the Version Packages PR** once it appears. Triggers first
  publish of all 6 packages at 0.1.0 to npmjs.com.
- [ ] **Point `wyreup.com` DNS at the Cloudflare Pages project** and add
  `wyreup.com` + `www.wyreup.com` as custom domains on the Pages project.
- [ ] **Verify email routing** for `hello@`, `security@`, and future
  `noreply@`, `support@` addresses via Zoho SMTP.

Optional near-term:
- Upgrade Cloudflare Pages to Pro ($5/mo) before high-activity dev stretches
  (500-build-per-month limit on free tier).

---

## 2. Waves (sequential)

Each wave is self-contained, pushes to main, and leaves the site green.

### Wave J — Chain builder + My Kit + SDK (next)

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

### Wave K — Library expansions

Three high-leverage additions that open whole categories.

- **ffmpeg.wasm** (~30 MB, opt-in via PWA settings) — audio + video
  category: convert-audio, convert-video, extract-audio, trim-media,
  compress-video, video-to-gif, subtitle convert (SRT↔VTT), burn
  subtitles. Gated behind the tool-opt-in settings page from Wave H
  so install footprint stays manageable on mobile.
- **openpgp.js** (~600 KB) — PGP encrypt, decrypt, sign, verify.
  Exactly aligned with privacy positioning.
- **JSZip wiring** — create-zip, extract-zip, zip-info. Library is
  already a dep from Wave D; just needs tool modules.

### Wave L — AI expansion (browser ML)

Queued per `packages/core/docs/ai-models.md` recommendations.

- **BiRefNet_lite** — background removal (MIT, ~100 MB fp16) — free tier
- **Swin2SR x2** — image upscale (~22 MB q4) — free tier
- **TrOCR-small** — handwriting + print OCR (~150 MB q8) — free tier
- **CLIP ViT-B/16** — perceptual similarity / dedupe — free tier
- **LaMa** — object erase / inpainting (~208 MB) — paid tier candidate
- **GFPGAN** — face restoration (~350 MB) — paid tier candidate
- **DDColor** — B&W colorization — paid tier candidate

Each gated behind `ToolRequires` (most preferred, some required). Heavy
models opt-in via the PWA settings page.

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

### Wave N — Tier 2 utility tools

From `competitor_your_everyday_tools.md` queue.

- **Excel I/O** — XLSX ↔ CSV/JSON via SheetJS (consumer/office gap)
- **HTML → PDF** — jsPDF + html2canvas (high-traffic keyword)
- **Barcode generator** — jsbarcode (Code128, EAN, UPC, ISBN)
- **Animated GIF ↔ WebP** — niche but cheap to add
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

---

## 3. Technical debt

Captured here so it doesn't disappear.

- [ ] **`packages/web/src/sw.ts` lint error** — 1 pre-existing error from
  Wave H service worker. Non-blocking, CI passes via the build-before-
  lint fix. Clean up when next touching the SW.
- [ ] **Self-host AI model CDNs on R2** — eliminate third-party touches
  (jsdelivr, googleapis, huggingface). Tracked in-line in
  `tools/check-privacy.mjs` allowlist comment.
- [ ] **OG image is SVG** — most platforms accept it but LinkedIn and
  Twitter may not. Generate a 1200×630 PNG fallback.
- [ ] **`@vite-pwa/astro` dev deps** — verify none leak into production
  bundle. Bundle analyzer check on next major wave.
- [ ] **`face-blur` integration test skip in Node** — MediaPipe doesn't
  init under vitest's jsdom-less env. Re-enable if a better headless
  test path emerges.
- [ ] **Chain file size limit (10 MB)** — sessionStorage caps at ~10 MB
  in most browsers. For larger chain passthroughs, IndexedDB would lift
  this. Current graceful message is acceptable; revisit if users hit it.

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
