# Wyreup — Design Specification

**Date:** 2026-04-15
**Status:** Draft, pending review
**Working name:** Wyreup (may evolve; `wyreup.com` and `wyrup.com` owned; `toanother.one` retained as tagline source)
**Related:** This spec supersedes the exploratory thread that produced it.

---

## 1. Executive Summary

**Wyreup is a free, privacy-first, open-source tool library for transforming files.** Images, PDFs, and (in v1.5) documents, video, and dev-tool formats. Its distinguishing properties:

- **Free tier runs entirely client-side.** Files never leave the user's device. No uploads, no servers, no accounts, no signup friction.
- **Pro tier adds AI operations** (via kie.ai) through a small Cloudflare Workers backend. Pro is opt-in, account-gated, and honest pass-through pricing with a margin.
- **Library-first architecture.** The tool modules live in a standalone package (`@wyreup/core`) that is consumed by four surfaces: the web app, an MCP server, a CLI, and a Claude Code skill. One tool implementation serves all four.
- **Agent-native.** The tool module contract is framework-free, self-describing, and exposes a type graph that AI agents can reason about and compose via chains.
- **"Wire up your tools. One thing to another, free forever."** Users compose their own workflows via a visual chain builder in the command palette and save them as reusable tools.

**v1 is 31 top-level tools** (19 image + 12 PDF), plus approximately 50 SEO-targeted alias pages, a context-aware editor installable as a PWA, an MCP server, a CLI, and a Claude Code skill — all shipped simultaneously as open source.

**The strategic window is narrow.** Free tool sites (ILoveImg, SmallPDF, etc.) are entrenched with SEO moats but annoying paywalls. Agent-accessible tool libraries do not exist in free form. Wyreup's moat is the combination: exceptional UX, fully private, free forever at the core, and natively usable by both humans and agents.

---

## 2. Product Positioning

### 2.1 The problem

Free image and document tools on the web are broken:
- Most require signup, watermark output, cap usage, or paywall the final step.
- "Free" AI tools train on your inputs.
- Privacy is advertised but not architectural — inputs are uploaded.
- Agents that want to process images or PDFs have only paid SaaS APIs with upload requirements and rate limits.

### 2.2 The Wyreup positioning

Six non-negotiable principles:

1. **Free is free.** No signup, no paywall, no nag modals, no "almost finished — now pay." Free operations run entirely in the user's browser. There is no backend involved in free-tier operations at all.
2. **Pro exists because some operations actually cost us money.** AI generation via kie.ai has real per-call cost. Pro passes that through with a margin. It is not manufactured scarcity. Credits are non-expiring.
3. **Privacy is architectural.** Free operations run in WebAssembly on the user's device. A CI check (the privacy scan) fails the build if any third-party domain appears in the built output.
4. **Ease of use is the meta-feature.** Every tool is measured against five UX gates and three automated quality gates before merge. "Beating ILoveImg on UX" is the bar.
5. **Open source, library-first.** The tool modules are an npm package. The web app is one consumer. The MCP server, CLI, and Claude Code skill are equal consumers. Developers can build their own tools on top of `@wyreup/core`.
6. **Agents are first-class users.** Every surface (web / MCP / CLI / skill) exposes the same capabilities through the same registry. An agent has the same access an end user does.

### 2.3 Tagline

*"Wire up your tools. One thing to another, free forever."*

---

## 3. v1 Scope

### 3.1 Tool list (31 top-level tools)

**Image tools (19):**

| # | Route | Purpose |
|---|---|---|
| 1 | `/compress` | Smart image compression with auto-format selection |
| 2 | `/convert` | PNG ↔ JPEG ↔ WebP ↔ AVIF format conversion |
| 3 | `/heic-to-jpg` | HEIC → JPG (dedicated SEO landing page, isolated LGPL WASM) |
| 4 | `/crop` | Interactive crop with aspect ratio lock |
| 5 | `/resize` | Resize with aspect lock, percent/pixel modes |
| 6 | `/rotate` | Rotate and flip |
| 7 | `/remove-background` | WASM-based background removal (single + batch) |
| 8 | `/strip-exif` | EXIF metadata stripper |
| 9 | `/blur-faces` | Automatic face detection + blur (single + batch) |
| 10 | `/watermark` | Text or image watermark, single and batch |
| 11 | `/image-to-pdf` | Combine images into a PDF |
| 12 | `/pdf-to-image` | Extract PDF pages as images |
| 13 | `/color-palette` | Extract dominant colors from an image |
| 14 | `/collage` | Grid / masonry / circle-pack auto-layout collage |
| 15 | `/gif-maker` | Build animated GIFs from frame sequences |
| 16 | `/image-diff` | Side-by-side / pixel-diff comparison |
| 17 | `/favicon` | Favicon pack generator (ICO + PNG sizes + manifest) |
| 18 | `/filters` | Brightness / contrast / saturation / hue / sepia / grayscale / invert |
| 19 | `/qr` | Styled QR codes with embedded image |

**PDF tools (12):**

| # | Route | Purpose |
|---|---|---|
| 20 | `/merge-pdf` | Combine PDFs into one |
| 21 | `/split-pdf` | Split PDF by page ranges |
| 22 | `/rotate-pdf` | Rotate pages (all or specific) |
| 23 | `/compress-pdf` | Real PDF compression via image re-encoding |
| 24 | `/pdf-to-text` | Extract plain text from PDF |
| 25 | `/watermark-pdf` | Add watermark to PDF pages |
| 26 | `/protect-pdf` | Password-protect a PDF |
| 27 | `/unlock-pdf` | Remove password (user must know it) |
| 28 | `/reorder-pdf` | Rearrange pages |
| 29 | `/page-numbers-pdf` | Add page numbers |
| 30 | `/html-to-pdf` | Convert pasted HTML or URL to PDF |
| 31 | `/sign-pdf` | Add drawn or typed signature |

### 3.2 SEO alias pages (~50)

Dedicated routes targeting specific high-volume queries, powered by the underlying tool modules with `preset` configuration. Examples:

- Format conversions: `/png-to-jpg`, `/jpg-to-png`, `/png-to-webp`, `/webp-to-jpg`, `/heic-to-png`, `/jpg-to-avif`, `/svg-to-png`, etc.
- PDF format conversions: `/jpg-to-pdf`, `/png-to-pdf`, `/pdf-to-jpg`, `/pdf-to-png`
- Size-specific: `/compress-image-to-500kb`, `/resize-to-1080p`, `/profile-picture-resizer`, `/passport-photo`
- Task-specific: `/combine-pdf`, `/extract-pdf-pages`, `/unlock-pdf-password`

**Generated from a central config, not maintained as individual files.** Managing ~50 hand-written Astro pages would guarantee content drift (stale FAQs, inconsistent copy, orphaned routes). Instead, all aliases live in a single `src/data/aliases.ts` config and are rendered via Astro's dynamic routing (`src/pages/[alias].astro`). Adding a new alias is one entry in the config, not a new file.

```ts
// src/data/aliases.ts
import type { AliasConfig } from './types';

export const aliases: AliasConfig[] = [
  {
    slug: 'png-to-jpg',
    toolId: 'convert',
    preset: { from: 'png', to: 'jpg' },
    title: 'PNG to JPG — Free, No Signup',
    h1: 'Convert PNG to JPG',
    subtitle: 'Fast PNG to JPEG conversion, right in your browser.',
    faqSlug: 'png-to-jpg',              // references content/faq/png-to-jpg.mdx
    relatedAliases: ['jpg-to-png', 'png-to-webp', 'png-to-ico'],
  },
  // ... ~50 entries
];
```

```astro
---
// src/pages/[alias].astro
import { aliases } from '../data/aliases';
import { toolsById } from '@wyreup/core';
import ToolPageLayout from '../layouts/ToolLayout.astro';

export async function getStaticPaths() {
  return aliases.map(a => ({ params: { alias: a.slug }, props: a }));
}

const { alias, toolId, preset, title, h1, subtitle, faqSlug } = Astro.props;
const tool = toolsById.get(toolId);
const FAQ = await import(`../content/faq/${faqSlug}.mdx`);
---

<ToolPageLayout title={title} h1={h1} subtitle={subtitle}>
  <tool.Component client:load preset={preset} surface="landing-page" />
  <FAQ.default />
</ToolPageLayout>
```

**Consequences of this approach:**

- One source of truth for the full alias graph.
- Adding / renaming / retiring aliases is a config change, not a file shuffle.
- The sitemap generator reads from the same config, so SEO sitemap, alias routes, and internal link graph all stay in sync automatically.
- FAQ MDX content is kept in `src/content/faq/` and referenced by slug — still hand-authored, but centralized.
- Dead aliases (e.g., a retired conversion) get a single config removal + a redirect entry instead of a file to delete and a broken-link hunt.

Full alias list curated from search volume analysis before launch; lives in `aliases.ts` as the canonical record.

### 3.3 Editor

A unified workspace at `/editor`, installable as a PWA. Hosts approximately 28 file-operation tools (Tier 1: all 31 v1 tools minus the 3 standalone-only tools — `/qr`, `/html-to-pdf`, `/sign-pdf` — which are reachable via the command palette but don't appear in the editor's main UI). Uses rule-based suggestions for top chips and a visual chain builder via command palette for composition. Not an attempt at a Photoshop replacement — it is an AI-era workspace where "tools" are composable operations and users can save their own chains as new tools.

### 3.4 Shell routes

`/` (home), `/about`, `/privacy`, `/terms`, `/licenses`, `/accessibility`, `/404`.

### 3.5 v1 packages — core library plus four surfaces

- **`@wyreup/core`** — the tool library (npm package); the load-bearing dependency for everything else
- **`@wyreup/web`** — the wyreup.com website, landing pages, editor, PWA *(surface 1)*
- **`@wyreup/mcp`** — MCP server for Claude / Continue / Cursor / any MCP-aware agent *(surface 2)*
- **`@wyreup/cli`** — command-line interface for shell users and shell-based agents *(surface 3)*
- **`claude-code-wyreup-skill`** — skill file teaching Claude how to use Wyreup effectively *(surface 4)*

All five are published together at v1 launch. When the spec refers to "the four surfaces," it means the four consumers of `@wyreup/core` (web, mcp, cli, skill); the fifth package is the library itself.

### 3.6 Explicitly not in v1

- Pro tier, accounts, Stripe, credits, AI operations (deferred to v2)
- OCR, DOCX, video, dev tools, raster-to-vector (deferred to v1.5 library expansion)
- Multi-user collaboration, cloud sync, team accounts (likely never — Wyreup is single-user by design)
- Photoshop-style layers, brush tools, vector editing (not the product — Photopea exists for that)

### 3.7 Free AI tease — explicitly rejected

An earlier iteration considered shipping a free AI tease in v1 (rate-limited z-image generations). Rejected on three grounds:

1. The free tier is already substantial without it. 31 polished tools is a complete product.
2. Free AI trials train users to live within the cap, making Pro conversion harder later.
3. A free AI tease requires a backend on day one (kie.ai proxy, rate limiting, abuse prevention, cost alarms), which compromises the "v1 is static files only" simplicity.

Pro AI lands in v2 as a paid tier with clear value, not a free trial that devalues itself.

---

## 4. Information Architecture

### 4.1 Route map

**Tool routes (31):** as listed in §3.1.

**Alias routes (~50):** as listed in §3.2.

**Shell routes:** `/`, `/editor`, `/about`, `/privacy`, `/terms`, `/licenses`, `/accessibility`, `/404`.

**SEO artifacts:** `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/opensearch.xml`.

**Static asset directories:**
- `/icons/*` — PWA icons (192, 512, maskable)
- `/og/*` — OpenGraph images per tool page, pre-generated at build
- `/fonts/*` — self-hosted fonts (no Google Fonts)

**External asset hosting (R2, not in repo):**
- `/models/*` on R2 — RMBG ONNX model, MediaPipe WASM assets, referenced via a `MODELS_BASE` constant

### 4.2 Landing page template

Every tool page follows the same structural template. Content inside each section is unique per tool; structure is uniform.

```
┌─ <header> ────────────────────────────────┐
│ Logo | minimal nav | "Install app" (PWA)  │
├─ <h1> ────────────────────────────────────┤
│ "Compress images free — no signup"         │
│ Subtitle promise ("Runs in your browser.   │
│                   Nothing uploaded.")      │
├─ <the tool> ──────────────────────────────┤
│ [ Drop zone / file picker ]                │
│ [ Live preview ]                           │
│ [ Action button ]                          │
│ [ Privacy badge: "Nothing leaves device" ] │
├─ "How it works" ──────────────────────────┤
│ 3 short steps with icons                   │
├─ "Related tools" ─────────────────────────┤
│ 3–4 contextual links to adjacent tools     │
├─ FAQ ─────────────────────────────────────┤
│ 5–8 questions with schema.org/FAQPage JSON-LD │
├─ <footer> ────────────────────────────────┤
│ Full tool list + legal links               │
└───────────────────────────────────────────┘
```

The tool is above the fold. The SEO content (how-it-works, FAQ, related) is below the fold for crawlers. FAQ schema markup is shipped for rich search results.

### 4.3 Shared chrome

**Header (all pages except `/editor`):**
- Logo (links to `/`)
- Minimal nav: "Tools" dropdown, "About"
- "Install app" button (visible only when `beforeinstallprompt` has fired)

**Footer (every page):**
- One-line privacy promise: *"Your images never leave your device. Everything runs in your browser."*
- Tool list grouped by category
- Legal links: `/privacy`, `/terms`, `/licenses`, `/about`, `/accessibility`
- Attribution microcopy for major dependencies
- GitHub link (if open source)

### 4.4 Editor chrome

The `/editor` route uses a different header component (`EditorHeader`) because the editor's role is different from a marketing page. It detects `display-mode: standalone` at runtime and switches between three states:

1. **Browser, not installed:** editor controls + compact install button + small "All tools" link back to `/`.
2. **Browser, already installed:** editor controls + compact back-to-site link + optional "open in app" nudge.
3. **Standalone PWA:** editor controls only. No marketing chrome. External links (settings, licenses, privacy) open in the browser via `target="_blank"`.

**LGPL attribution in the editor.** The editor loads LGPL-3.0 WASM modules when users drop compatible files — specifically `heic-to` for HEIC input. The LGPL-3.0 license requires attribution and the ability to replace the LGPL component. The editor satisfies this by:

- Including a **full Licenses panel** in the editor's settings modal (reachable in all three chrome states), listing every open-source dependency with version, license, and homepage link. This is the same content as `/licenses` but packaged inside the app for standalone-mode users who can't navigate to the web page directly.
- Linking to the LGPL source code location (the `heic-to` repo on GitHub) so users can verify / rebuild / replace the WASM if desired.
- Shipping the WASM blob unmodified, hashed, and served as a static asset (no in-place modification at build time).

This applies equally to **any future LGPL additions** (ffmpeg.wasm in v1.5). Each LGPL dependency gets its own entry in the Licenses panel.

### 4.5 Internal linking strategy

- Home (`/`) links to all 31 tools in a grid.
- Every tool page has a "Related tools" section with 3–4 hand-curated contextual links (graph defined in `src/data/related-graph.ts`).
- Footer has the full tool list on every page for crawl depth.
- No JavaScript-based navigation between tool pages. Every page is a fresh static HTML load.

### 4.6 PWA split

**Only `/editor` is installable.** Landing pages are drive-by pages for SEO; installing them would be incoherent. The service worker's scope is restricted to `/editor`.

**Service worker caches:**
- App shell (HTML / CSS / core JS): stale-while-revalidate
- Tool modules: cache-first with version check
- Static assets (fonts, icons): cache-first, immutable hashed filenames
- WASM models (RMBG, MediaPipe): cache-first with manual invalidation — large and rarely updated
- WASM codecs (jSquash, pdfjs worker): cache-first

After first visit, the entire free toolkit works offline. Pro tools (v2+) detect `navigator.onLine === false` and show a "Requires internet" state.

**PWA manifest:**
- `name: "Wyreup — Tool Library"`
- `short_name: "Wyreup"`
- `start_url: "/editor"`
- `display: "standalone"`
- `file_handlers`: registers Wyreup as an `image/*` and `application/pdf` handler so users can "Open with Wyreup" from their OS file browser after install

---

## 5. Tool Module Contract

The load-bearing architectural decision. Every tool — free, Pro, user-created chain, built-in, third-party — satisfies this single interface.

### 5.1 The `ToolModule` interface

```ts
// packages/core/src/types.ts

export type ToolCategory =
  | 'optimize' | 'convert' | 'edit' | 'privacy'
  | 'pdf' | 'create' | 'inspect' | 'export';

export type ToolPresence = 'editor' | 'standalone' | 'both';

export type MimePattern = string; // e.g. 'image/*', 'application/pdf'

export interface ToolInputSpec {
  accept: MimePattern[];
  min: number;
  max?: number;
  sizeLimit?: number; // per-file byte cap, default 500 MB
}

export interface ToolOutputSpec {
  mime: MimePattern;
  multiple?: boolean;
  filename?: (input: File, params: unknown) => string;
}

export interface ToolProgress {
  stage: 'loading-deps' | 'processing' | 'encoding' | 'done';
  percent?: number;
  message?: string;
}

export interface ToolRunContext {
  onProgress: (p: ToolProgress) => void;
  signal: AbortSignal;
  cache: Map<string, unknown>;
  executionId: string;              // stable UUID for this invocation; used as idempotency key for v2 AI calls so retries don't double-charge credits
}

/**
 * Approximate working-set memory (in MB) when run() is active.
 * Used by the worker pool to gate concurrent execution on low-memory devices.
 * Values are rough estimates, not hard guarantees.
 */
export type MemoryEstimate =
  | 'low'      // <50 MB: most pure-WASM tools (compress, convert, strip-exif)
  | 'medium'   // 50-200 MB: background removal, face detection, PDF rendering
  | 'high'     // 200-500 MB: video processing (v1.5), OCR (v1.5)
  | 'extreme'; // >500 MB: reserved; not used in v1 or v1.5

export interface ToolModule<Params = unknown> {
  // Metadata
  id: string;
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  presence: ToolPresence;
  keywords: string[];

  // Capabilities
  input: ToolInputSpec;
  output: ToolOutputSpec;
  interactive: boolean;
  batchable: boolean;
  cost: 'free' | 'credit';
  memoryEstimate: MemoryEstimate;   // used by worker pool to gate concurrent execution

  // Core operation (v1 tools use this)
  run(inputs: File[], params: Params, ctx: ToolRunContext): Promise<Blob[] | Blob>;

  // Streaming operation (v1.5+ for large-file tools like video, big PDFs)
  // Tools declare `streaming: true` and implement runStream to handle inputs/outputs
  // as chunked streams instead of whole blobs. Prevents OOM on large files.
  // v1 tools: streaming is undefined/false; all I/O is blob-based.
  streaming?: boolean;
  runStream?: (
    inputs: ReadableStream<Uint8Array>[],
    params: Params,
    ctx: ToolRunContext
  ) => Promise<ReadableStream<Uint8Array>[]>;

  // UI component (same component renders in all surfaces)
  Component: React.FC<ToolComponentProps<Params>>;

  // Presets (for SEO alias pages and editor chips)
  defaults: Params;
  applyPreset?: (preset: Partial<Params>, defaults: Params) => Params;

  // Testing contract (consumed by CI)
  __testFixtures: {
    valid: string[];
    weird: string[];
    expectedOutputMime: string[];
  };
}

export interface ToolComponentProps<Params> {
  surface: 'landing-page' | 'editor-chip' | 'editor-modal' | 'focused-mode';
  preset?: Partial<Params>;
  inputs: File[];
  onInputsChange: (files: File[]) => void;
  onComplete: (outputs: Blob[]) => void;
  onCancel: () => void;
}
```

### 5.2 Key properties of the contract

**One component, four surfaces.** The `Component` field is a single React (or Preact) component that renders the tool's UI. It receives a `surface` prop and adapts chrome — full hero + drop zone + download button on landing pages, compact card in editor chips, modal-style in command-palette invocation, canvas-takeover in focused mode. The interactive region is identical; only the chrome differs.

**Presets enable SEO alias pages.** An alias page like `/png-to-jpg` is a ~30-line Astro page rendering `<ConvertTool preset={{ from: 'png', to: 'jpg' }} />`. The tool's `applyPreset` merges the preset over defaults, the page targets a specific query, the underlying module is shared.

**Metadata drives the editor.** The editor queries the registry by `presence`, `category`, and `input.accept` compatibility with the current selection. This is the engine behind context-aware chip suggestions, the visual chain builder, and the command palette autocomplete.

**Lazy-loading lives inside `run()`, not at module-level imports.** The tool module file itself is small (interface, metadata, component). Heavy dependencies (jSquash, pdfjs-dist, Transformers.js, ffmpeg) are dynamically imported inside `run()` when the user commits to the action. This is how the <150 KB initial JS per page budget is met.

**Abort signals prevent runaway work.** Every `run()` receives an `AbortSignal`. Cancel / undo / switch-file operations fire `abort()` on in-flight runs. Tools are responsible for checking `signal.aborted` at natural checkpoints. Load-bearing for batch operations.

**No global state.** Tool modules don't read from or write to global stores. State is passed via `params` and `inputs`. This keeps them testable in isolation and usable from any surface without coupling.

**No framework coupling in logic.** The `run()` function is pure TypeScript. The `Component` field uses React/Preact because the web editor is React/Preact, but the processing logic could be called from a Node test, a Web Worker, or a v3 automation daemon without changes. A CI check enforces that `@wyreup/core/tools/*` imports nothing framework-shaped.

### 5.3 Multi-input and export-type modules

The contract accommodates tools that don't fit "one file in, one file out":

- `image-diff`: `input.min: 2, max: 2`. Component has two drop slots. Produces one diff image.
- `gif-maker`: `input.min: 2, max: undefined`. Produces one GIF.
- `collage`: `input.min: 2, max: undefined`. Produces one composite image.
- `image-to-pdf`: `input.min: 1, max: undefined`. Produces one PDF.
- `pdf-to-image`: `input.min: 1, max: 1`, `output.multiple: true`. Produces N image blobs.
- `favicon`: `input.min: 1, max: 1`, `output.multiple: true`. Produces a pack of PNGs and an ICO.
- `qr`: `input.min: 0`. Takes text via params, no file required.

### 5.4 v2 Pro tools slot in without changes

Pro tools are just `ToolModule` instances with `cost: 'credit'`. Their `run()` function calls a backend proxy (`/api/ai/<operation>`) instead of a WASM function. The editor gates execution on auth and credit balance but otherwise treats them identically. See §7.

### 5.5 Tool registry

```ts
// packages/core/src/registry.ts

export const tools: ToolModule[] = [ /* all 31 */ ];
export const toolsById = new Map(tools.map(t => [t.id, t]));

export const toolsForFiles = (files: File[]): ToolModule[] =>
  tools.filter(t => filesMatchInput(files, t.input));

export const toolsByCategory = (cat: ToolCategory): ToolModule[] =>
  tools.filter(t => t.category === cat);

export const searchTools = (query: string): ToolModule[] => /* fuzzy match */;
```

Single source of truth. The editor, command palette, home page grid, sitemap generator, MCP server schema generator, and CLI all consume this registry.

---

## 6. Editor Design

### 6.1 Layout

Three panels plus a history timeline and status bar:

```
┌──────────────────────────────────────────────────────────┐
│ EditorHeader (browser vs standalone-aware)               │
├──────────┬────────────────────────┬──────────────────────┤
│ FilmStrip│      CanvasArea        │    ToolPanel         │
│ (auto-   │  • active selection    │  Suggested (chips)   │
│  hidden  │  • grid when many      │  ────────────────    │
│  when ≤1 │  • focused-mode        │  [context chip 1]    │
│  file)   │    overlay when        │  [context chip 2]    │
│          │    interactive tool    │  [context chip 3]    │
│          │    is active           │  ────────────────    │
│          │                        │  Show all tools ⚙    │
├──────────┴────────────────────────┴──────────────────────┤
│ HistoryTimeline  (linear op history, undo/redo, jump-to) │
├──────────────────────────────────────────────────────────┤
│ StatusBar  (progress / errors / v2: credits balance)     │
└──────────────────────────────────────────────────────────┘
```

The command palette overlays everything on `Cmd-K`. Focused mode takes over the center area when an interactive tool is active.

### 6.2 FilmStrip (not a permanent tray)

- **0–1 files:** no tray visible. Canvas is full-width.
- **2+ files:** the FilmStrip appears. It has two view modes:
  - **Strip view (default, 2–10 files):** thin horizontal row, ~80 px tall, single row, horizontal scroll. Click to switch active file, shift-click / cmd-click for multi-select.
  - **Grid view (auto-enabled at >10 files, manual toggle always available):** expands into a 2D grid occupying more vertical space. Rows wrap at the container width. Virtualized via `react-window` above ~100 files. Comfortable for batch operations on 50+ files where horizontal scrolling becomes unusable.
- **Manual toggle** between strip and grid is always available via a small icon button at the top of the FilmStrip. State persists across sessions (`editor.preferences.filmStripMode`).
- **Optional "Files" drawer** for richer management (rename, duplicate, remove, reorder, metadata, individual history) — closed by default, opens on demand.

For interactive multi-file tools (collage, gif-maker, image-diff), entering focused mode expands the strip into the tool's specific UI — a reorderable frame list for gif-maker, drag-to-rearrange for collage, two-slot picker for image-diff.

### 6.3 CanvasArea

- **Single-selection mode:** one file, full-size preview in a raw `<canvas>`.
- **Multi-selection mode:** grid view of selected files with a "N files selected" badge.
- **Focused mode:** the tool's Component renders directly on the canvas with full control.
- **Zoom and pan:** via CSS transforms, no re-render.
- **Before/after view:** optional split view for a few seconds after an op commits, with undo prompt.

### 6.4 ToolPanel

Three tiers:

**Default view — context chips:** 3–5 suggested chips at the top, generated by the rule engine (§6.5). Chips have: icon, label, optional preset-specific subtitle. Click → params panel or immediate run.

**"Show all tools" view:** optional toggle in settings. Every editor-tier tool grouped by category. Greyed out when incompatible with current selection.

**Command palette:** universal access on `Cmd-K`. See §6.6.

### 6.5 Rule engine (simple, ordered, self-limiting)

Two engines, clearly separated:

**Type compatibility (automatic, derived from metadata):** the chain builder and "what can I do with this file" use the `input.accept` / `output.mime` metadata directly. No hand-written rules. Tools that declare they accept a file type are the ones shown. This is the dominant engine.

**Contextual suggestions (short hand-written list):** a small ordered list of rules (<20) that incorporate *content* beyond type — file size, face presence, EXIF presence, PDF page count. Used only for the top chips in the editor. Self-limiting because each file type has a bounded set of reasonable operations.

```ts
// packages/core/src/editor/suggestions/rules.ts

type Rule = {
  toolId: string;
  preset?: Record<string, unknown>;
  label: string;
  when: (ctx: SuggestionContext) => boolean;
};

const rules: Rule[] = [
  { toolId: 'heic-to-jpg', label: 'Convert HEIC to JPG',
    when: ({ files }) => files.some(f => f.mime === 'image/heic') },

  { toolId: 'merge-pdf', label: 'Merge PDFs',
    when: ({ files }) => files.filter(isPdf).length >= 2 },

  { toolId: 'compress', label: 'Compress',
    when: ({ files }) => files.some(f => isImage(f) && f.size > 2 * MB) },

  { toolId: 'blur-faces', label: 'Blur faces',
    when: ({ analysis }) => analysis.some(a => a.faces?.length > 0) },

  { toolId: 'strip-exif', label: 'Strip metadata',
    when: ({ analysis }) => analysis.some(a => a.exifPresent) },

  // ... 10-15 more rules total
];

export const suggest = (ctx: SuggestionContext): Suggestion[] =>
  rules.filter(r => r.when(ctx)).slice(0, 5);
```

No scoring. No weights. No tie-breakers. Rules are ordered by priority (hand-authored). Top 5 matches become chips in order.

**What the rule engine is not:**
- No ML, no learned rankings, no A/B infrastructure.
- No personalization (same inputs = same outputs, privacy-respecting).
- Maximum ~15-20 rules (naturally bounded by file-type reality).

### 6.6 Command palette with chain mode

`Cmd-K` opens a universal search overlay. It has two modes.

**Search mode (default):**
- Indexed items: all tools (regardless of tier), file tray contents, recent operations, settings, static commands.
- Fuzzy match via Fuse.js or hand-rolled scored substring match.
- Keyboard nav: up/down/enter/esc/tab.
- Selecting a file focuses it; selecting a tool opens its params or modal; selecting a setting jumps to it.

**Chain mode (for power users):**
Activated by typing pipe-separated syntax or by explicitly choosing "build a chain." Shows a visual next-step picker powered by the type compatibility engine:

```
┌─────────────────────────────────────────────────┐
│ 🔍 Type a tool or build a chain...              │
├─────────────────────────────────────────────────┤
│ Current: 1 file · image/heic · 4.2 MB           │
│                                                 │
│ ─ Chain ────────────────────────────────────    │
│   1. Convert HEIC to JPG       →  image/jpeg    │
│   2. Compress                  →  image/jpeg    │
│   [ + add next step ]                           │
│                                                 │
│ ─ Available now ─────────────────────────────   │
│   ▸ Resize                    →  image/jpeg     │
│   ▸ Crop                      →  image/jpeg     │
│   ▸ Strip metadata            →  image/jpeg     │
│   ▸ Add watermark             →  image/jpeg     │
│   ▸ Image to PDF              →  application/pdf│
│                                                 │
│ [Enter] Run    [Ctrl+S] Save as...    [Esc]    │
└─────────────────────────────────────────────────┘
```

At each step, only type-compatible tools are offered. Invalid chains are impossible to construct. The text pipeline syntax (`compress | strip-exif | convert webp`) parses to the same data structure.

**Chain execution safety:**

- **`MAX_CHAIN_DEPTH = 10`** — a hard cap on chain nesting depth. Chains that reference other chains (user chains as steps) are counted. If execution exceeds this depth, `runChain` throws `ChainError('Maximum chain depth exceeded')`. Prevents runaway recursion from freezing the browser.
- **Cycle detection at save time.** When a user saves a chain that references other user chains, the save flow runs a DFS over the referenced chains looking for cycles. If a cycle is found (chain A → chain B → chain A), the save is rejected with "This chain would reference itself through [path]." Cycles are caught at save, not run, so users get immediate feedback instead of a mysterious error later.
- **Per-step abort check.** Every chain step checks `ctx.signal.aborted` before and after execution. User cancellation propagates immediately.
- **Execution ID.** Every chain run generates a fresh `executionId` on `ctx`, used for idempotency in v2 AI calls within the chain. Each step can reference `ctx.executionId` when calling the backend proxy to prevent double-charging on retries.

### 6.7 Chains as tools

A saved chain is a `ToolModule`. The `chainToToolModule` adapter converts a `SavedChain` into a valid `ToolModule` at runtime and registers it alongside the built-in tools. Consequences:

- User chains participate in chip suggestions (when their first-step input matches the current selection)
- User chains appear in the command palette with a distinct icon
- User chains appear in "Show all tools" under a "My Tools" category
- User chains can be steps in other chains (recursive composition, bounded by `MAX_CHAIN_DEPTH` and cycle-checked on save)
- User chains inherit `cost: 'credit'` if any step is Pro — gated accordingly

**Sharing:**
- Export a chain as JSON
- Import via paste or URL (base64-encoded JSON in query params)
- No account required to share
- Chain marketplace is v3 territory; foundation is in place

**Starter chains shipped with v1:**
- `Web-ready photo` — compress + resize + strip-exif + convert WebP
- `iOS app icons` — resize + convert PNG + favicon-ish sizes
- `Privacy cleanup` — strip EXIF + blur faces
- `PDF optimize` — compress-pdf + strip metadata
- `Print-ready` — convert TIFF + resize to print DPI

### 6.8 State management

**Zustand store.** ~3 KB, no provider, clean subscriptions, middleware for IndexedDB persistence.

```ts
interface EditorState {
  files: Map<FileId, EditorFile>;
  order: FileId[];
  selection: Set<FileId>;
  analysis: Map<FileId, ImageAnalysis>;
  preview: Map<FileId, Blob>;
  history: HistoryEntry[];
  historyCursor: number;
  activeTool: ToolId | null;
  focusedMode: boolean;
  commandPaletteOpen: boolean;
  showAllTools: boolean;
  preferences: EditorPreferences;

  addFiles: (files: File[]) => Promise<void>;
  removeFile: (id: FileId) => void;
  select: (ids: FileId[], mode: 'replace' | 'add' | 'toggle') => void;
  runTool: (toolId: ToolId, params: unknown) => Promise<void>;
  runChain: (chain: Chain) => Promise<void>;
  undo: () => void;
  redo: () => void;
  // ...
}
```

File blobs persist in IndexedDB as native `Blob` values (no base64). Debounced writes (150 ms) on every state change. Editor hydrates from IndexedDB on load.

### 6.9 History

- Linear op log across all files.
- Each entry: tool id, params, input file ids, pre-op blob references, output blobs, timestamp.
- Undo restores pre-op blobs. Redo reapplies.
- Cmd-Z / Cmd-Shift-Z.
- Click a timeline entry to jump to that point.
- Cap at 50 operations; older entries disposed.

### 6.10 Worker pool

- **Shared pool** of `Math.min(hardwareConcurrency, 4)` Web Workers spawned at editor boot.
- Each worker has a standard runtime that can dynamically import any tool's `run()` function.
- Dependencies cached per worker — once a worker has loaded jSquash, subsequent jobs reusing jSquash have zero init cost.
- OffscreenCanvas used where supported.
- Main thread handles UI; all processing offloaded.

**Memory-aware scheduling:**

The worker pool reads each tool's `memoryEstimate` before dispatching and gates concurrent execution to avoid OOM crashes — especially critical on mobile devices and for heavy tools (Transformers.js ~44 MB model, ffmpeg.wasm ~25 MB, tesseract.js ~10 MB, all in v1.5 or already in v1 for background removal).

**Scheduling rules:**

- **`low` memory tools (<50 MB):** run fully in parallel, up to pool size.
- **`medium` memory tools (50–200 MB):** at most 2 concurrent on desktop, 1 on mobile.
- **`high` memory tools (200–500 MB):** at most 1 concurrent ever.
- **Mixed workloads:** a running `high` job blocks new `medium` or `high` jobs until it completes; `low` jobs continue unaffected.
- **Mobile detection:** `navigator.deviceMemory` is used to further reduce concurrency on phones and low-memory tablets. If `deviceMemory < 4` (less than 4 GB RAM), the pool caps at 2 total workers regardless of CPU count, and no more than 1 `medium`+ job runs at a time.

**Streaming tools (v1.5+):** tools with `streaming: true` can be scheduled even alongside high-memory tools because their working set is bounded to the chunk size, not the whole file. The pool tracks streaming vs. blob-based tools separately for scheduling purposes.

**When the pool is saturated:** new operations queue with a visible indicator ("Queued — waiting for a worker"). Users can cancel queued operations before they start. This is friendlier than silently backing up.

This memory-aware scheduling is what prevents the "drop 50 large photos, hit Remove Background, crash the browser tab" scenario that naive worker pools fall into.

### 6.11 Browser-native API usage

Core architectural principle: use the platform, don't reinvent.

| API | Purpose |
|---|---|
| File System Access API | Open files without hidden input tricks, save without download dialogs, persistent folder handles for v3 automations |
| Clipboard API | Paste images into editor, copy results |
| Web Share API | Native share sheet for results |
| `createImageBitmap` | Fast native image decoding |
| OffscreenCanvas + Web Workers | Processing off main thread |
| WebCodecs (`ImageDecoder`, `ImageEncoder`) | Native WebP/AVIF on supporting browsers; jSquash fallback otherwise |
| IndexedDB | File tray, history, project persistence, model cache |
| Service Worker | PWA offline, model caching, updates |
| File Handling API | Register Wyreup as a handler for image and PDF types |
| Native browser HEIC (Safari) | Skip LGPL decoder on Safari |
| CSS `filter:` | Live filter previews without pixel math |
| Permissions API | Graceful permission handling |
| Page Lifecycle API | Pause heavy work when tab is hidden |
| Web Locks API | Prevent cross-tab races |

Feature detection + fallback, never assume an API exists.

### 6.12 Error handling

- Every `run()` wrapped in try/catch at orchestration layer.
- Errors never crash the editor — they localize to the failing op.
- Failing files marked `status: 'error'` in the tray; toast + status-bar log.
- Abort errors silent.
- Unknown errors get a "report this" link (GitHub issue template or mailto with diagnostic info).

---

## 7. v2 Hook Points

v1 must leave the right doors open for v2 without any wasted work. This section describes the shape of v2, not its full specification.

### 7.1 What changes in v2

1. **A backend.** Cloudflare Workers + D1 + KV + R2, all under one Cloudflare account.
2. **Accounts.** Passwordless via magic link (Email Workers) and passkey (WebAuthn).
3. **Stripe.** Subscriptions and one-time top-ups. Credits non-expiring.
4. **AI tool modules.** New tools with `cost: 'credit'` whose `run()` calls a backend proxy.
5. **API keys.** Users generate keys in their account for CLI / MCP / SDK use.

### 7.2 What does NOT change in v2

- `@wyreup/core`'s public interface.
- The free tier. Free tools still run client-side, no regression.
- The chain engine. Chains can mix free and Pro steps.
- The four surfaces. All of them get new Pro tools automatically.

### 7.3 Pro tool example

```ts
// packages/core/src/tools/ai/z-image/index.ts

import type { ToolModule } from '../../../types';
import { proxyAICall } from '../../../runtime/ai-proxy';

export const zImage: ToolModule<ZImageParams> = {
  id: 'z-image',
  slug: 'z-image',
  name: 'Generate Image',
  description: 'Text-to-image generation via Wyreup AI',
  category: 'create',
  presence: 'editor',
  keywords: ['generate', 'ai', 'text-to-image'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'image/png' },
  interactive: false,
  batchable: false,
  cost: 'credit',

  defaults: { prompt: '', width: 1024, height: 1024, style: 'natural' },
  Component: ZImageComponent,

  async run(_inputs, params, ctx) {
    ctx.onProgress({ stage: 'loading-deps', message: 'Connecting to Wyreup AI...' });
    const result = await proxyAICall({
      operation: 'z-image',
      params,
      signal: ctx.signal,
      onProgress: ctx.onProgress,
    });
    return [result.blob];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['image/png'] },
};
```

~30 lines per Pro tool. All the heavy lifting (auth, credit gating, rate limiting, kie.ai integration) lives on the backend and is shared.

### 7.4 Backend shape

- **Cloudflare Workers** for `/api/*` endpoints
- **D1** for users, credit balance, credit ledger, API keys, Stripe customer IDs
- **KV** for rate limits, session tokens, ephemeral state
- **R2** for model hosting and any large exports
- **Email Workers** for magic links
- **Turnstile** for bot protection on any free-tier AI tease (not v1)

**Credit model:**
- Credits live server-side in D1.
- Each AI call atomically decrements credits in a D1 transaction before hitting kie.ai.
- Non-expiring (no expiry field).
- Subscription adds credits monthly; top-ups add once. Same bucket.
- Credit ledger append-only; users see full history.

**Auth flow:**
- Web: magic link via Email Workers → session cookie. Passkey upgrade path later.
- CLI / MCP: user generates an API key in web settings, configures via `wyreup auth login` or `WYREUP_API_KEY` env var.

**Rate limiting:**
- Per-user: N concurrent Pro operations, M per minute.
- Global kill switch: if daily kie.ai spend exceeds threshold, Pro pauses with friendly message.

### 7.5 Pricing model

- **$5/month subscription** = baseline tier, credits refresh monthly, non-expiring. Thin margin at launch (founder's tier pricing) with grandfathering for early adopters; steady-state 70% margin for later cohorts.
- **Top-up packs** available to anyone:
  - $3 one-time: fewer credits per dollar (incentive to subscribe)
  - $10 one-time: baseline rate
  - $25 one-time: best rate (power users)
- **All credits non-expiring.** Stack with any unused from subscription.
- **Credit unit:** clean integers. 1 credit = 1 z-image (the cheapest AI op, ~$0.004 kie.ai cost). Weighted for more expensive ops (WAN-2.7 Pro = 15 credits, 8K upscale = 50 credits).
- **What users see on the /pro page:** a live slider showing "Your $5 gets you about: 1000 quick images OR 65 premium images OR 20 8K upscales — mix and match." No fine print, no hidden cost-per-op tables.

### 7.6 All four surfaces absorb v2 uniformly

- **`@wyreup/web`:** new editor chips and command-palette entries for Pro tools with credit-cost badges. Pricing page. Account UI. Credit balance display.
- **`@wyreup/mcp`:** MCP server auto-discovers new Pro tools from the registry. Agents see metadata "requires API key, costs N credits per call." Agents with configured keys invoke directly.
- **`@wyreup/cli`:** `wyreup z-image "a cat wearing a hat"` works. First run prompts for auth setup if unconfigured.
- **`claude-code-wyreup-skill`:** skill docs updated to describe Pro tool invocation.

One implementation, four deployment targets, zero duplication.

### 7.7 Graceful degradation

- Offline: Pro chips disabled, "Requires internet" tooltip. Free tools unaffected.
- No credits: 402 response, friendly message, "Top up credits" button.
- Kill switch: 503 response, "We've hit today's generosity cap — come back tomorrow or top up for immediate access." Free tier unaffected.
- kie.ai outage: 503 response, "AI backend temporarily unavailable, credits not deducted." Idempotency key prevents double-charge on retry.

### 7.8 Privacy posture for v2

**Free tier** (unchanged from v1): nothing leaves the device, nothing logged, nothing tracked, no telemetry.

**Pro tier:**
- Input is necessarily transmitted to kie.ai via the proxy (AI requires remote compute).
- The proxy never stores inputs or outputs. Pass-through only.
- Aggregate logs: user id, operation type, timestamp, credit cost. No prompts, no image data.
- No behavioral tracking, no personalization, no model training on user data.
- Privacy policy clearly states: "Free tools run locally. Pro AI tools send your input to our server and then to our AI provider (kie.ai) for processing. We do not store your inputs or outputs."
- Pro tool UI shows a "→ sent to AI backend" indicator when the user is about to submit. No surprise.

Marketing-true line: *"Wyreup Pro doesn't learn from you."*

### 7.9 What v1 must do to not block v2

- Tool module contract supports `cost: 'credit'`. ✓ (done)
- `run()` can dispatch to async remote calls. ✓ (done — it's already an async function)
- Editor reads `cost` metadata and renders differently. ~20 lines of UI to add.
- Chain engine handles mixed free/credit steps. ✓ (trivially — it iterates over tools)
- UI header has a placeholder slot for a future "Sign in" button.
- No decision in v1 precludes adding auth later.
- No architectural decision forces backend coupling to the frontend.

**v1 is complete as a product without v2. v2 is additive, not a rewrite.**

---

## 8. Non-Functional Requirements

### 8.1 UX gates (every tool must pass before merge)

**Five human gates:**
1. **Three-step rule.** Drop → (optionally adjust one control) → click action. Max three steps to first result.
2. **Zero documentation rule.** First-time user reaches the result without reading help text.
3. **Mobile-first test.** Tested on phone first. If it doesn't work on mobile, it doesn't ship.
4. **Weird-input test.** Correct file, wrong format, huge file, tiny file, corrupted file, empty selection — all produce graceful, human error messages.
5. **Competitor-beat test.** Observably faster / clearer / nicer than the best free competitor for the same task before merge.

**Three automated gates (CI-enforced):**
1. **Lighthouse CI.** Performance / Accessibility / Best Practices / SEO all ≥ 95 on every page. Below → build fails.
2. **Bundle size budget.** <100 KB initial gz per tool page (ceiling 150 KB). Heavy deps must be dynamically imported inside handlers. Exceeding → build fails.
3. **Privacy enforcement — defense in depth (runtime CSP + build-time scan).**
   - **Runtime CSP is the primary enforcement.** A strict `Content-Security-Policy` header ships with every response: `connect-src 'self' https://static.cloudflareinsights.com`, `script-src 'self'`, no `unsafe-inline`, no `unsafe-eval`. This blocks any network request to a disallowed origin at the browser level, regardless of how the code was obfuscated (string concatenation, `atob`, dynamic imports from computed URLs, worker-spawned fetches, etc.). This is the real security boundary — obfuscated JS cannot bypass a browser-enforced CSP.
   - **Build-time privacy scan is belt-and-suspenders.** Greps the built output for external domain references in `<script src>`, `<link href>`, `import` statements, and string literals matching URL patterns. Fails the build if any non-allowlisted domain is found. Cannot catch obfuscated strings or runtime-computed URLs — that's what CSP is for. Catches typos, "I forgot this was a CDN link," and unintended dependencies before they ship.
   - **Together:** CSP prevents runtime exfiltration even if malicious code sneaks into the bundle. The scan catches honest mistakes at build time before CSP has to do its job. Neither alone is enough; both together give strong, auditable privacy.

**Continuous practices:**
- Design review before merging any new tool. One human uses the tool and writes a short "how this felt" note.
- User-watching sessions at least monthly. Watch cold users, take notes.

### 8.2 Testing strategy

| Layer | Tool | Scope | When |
|---|---|---|---|
| Unit | Vitest | Pure logic in `@wyreup/core` | Every commit |
| Integration | Vitest + jsdom | Tool modules end-to-end with fixtures | Every commit |
| E2E | Playwright | Critical user flows (10 tests) | On PR to main |
| Visual regression | Playwright screenshots | Home, editor shell, 2–3 representative tool pages | On PR to main |

Tool module unit tests follow a pattern enforced by `__testFixtures`. CI walks the registry, ensures every tool has fixtures declared, and runs the standard test suite against them.

### 8.3 CI pipeline (GitHub Actions)

Parallel jobs targeting <10 minute total PR check time:

1. `lint-and-types` — ESLint, Prettier, TypeScript across all packages
2. `unit-tests` — Vitest across all packages with coverage
3. `build` — Turbo-powered parallel build
4. `isolation-check` — fails if `@wyreup/core` imports framework code
5. `bundle-size-check` — fails if any tool page exceeds budget
6. `lighthouse-ci` — runs against preview deploy, 5 representative pages
7. `e2e-tests` — Playwright against preview deploy
8. `privacy-scan` — grep built output for non-allowlisted external domains
9. `visual-regression` — Playwright screenshot comparison

All three custom checks (isolation, bundle size, privacy) are small scripts in `tools/`, each <100 lines.

### 8.4 Performance budgets

| Metric | Target | Enforcement |
|---|---|---|
| Tool page initial JS (gz) | <150 KB | CI fails |
| Home page initial JS (gz) | <50 KB | CI fails |
| Lighthouse Performance | ≥95 | CI fails |
| Lighthouse Accessibility | ≥95 | CI fails |
| Lighthouse Best Practices | ≥95 | CI fails |
| Lighthouse SEO | ≥95 | CI fails |
| LCP (4G) | <1.5s | Monitored |
| TTI (4G) | <2s | Monitored |
| CLS | <0.05 | Monitored |

Heavy deps (WASM, models) are not counted toward initial JS because they're dynamically imported on action. Measured separately as "activation cost."

### 8.5 Accessibility

**Target: WCAG 2.1 AA.** Non-negotiable floor.

Automated: axe-core in Vitest integration tests; Lighthouse Accessibility ≥95 in CI.

Manual: keyboard navigation, VoiceOver / NVDA / JAWS tested, reduced motion respected, high contrast mode tested.

No "accessibility overlay" widgets — those are trash.

### 8.6 Deploy pipeline

**v1 (static):**
- Main branch pushes trigger Cloudflare Pages production deploy
- PR branches get preview deploys at `pr-<n>.wyreup.pages.dev`; E2E runs against them
- Rollback: revert commit, Cloudflare redeploys
- No staging environment; preview deploys cover it

**v2 (with Workers):**
- Same pattern for Pages; Workers deploy via `wrangler deploy`
- Preview environments via `wrangler deploy --env preview`
- D1 migrations version-controlled, applied in CI
- Secrets via `wrangler secret put`, never in code, per-environment
- Workers rollback via `wrangler rollback`

**Not auto-deployed:** model files (manual versioning on R2), secrets (never).

### 8.7 Monitoring and observability

**v1:**
- Cloudflare Web Analytics (aggregate, cookieless, free)
- No Sentry, LogRocket, or behavioral tracking
- `?debug=1` query param enables verbose console logging for debugging

**v2:**
- Cloudflare Workers Logs for backend errors (aggregate, no PII)
- Built-in Workers observability for response times and error rates
- No user session replay, no behavioral telemetry
- Cost dashboards and alerts for kie.ai, D1, KV, R2
- Frontend errors still not collected (privacy)

### 8.8 Security practices

**Secrets management:**
- Never in code, CI configs, or commits
- `wrangler secret` or Pages env vars via dashboard
- `gitleaks` pre-commit hook

**Dependency security:**
- Renovate auto-updates weekly; minor/patch auto-merge if tests pass
- `pnpm audit` runs in CI; vulnerable deps fail the build
- GitHub Dependabot Alerts enabled

**Content Security Policy:**
- Strict CSP: `script-src 'self'` plus Cloudflare Web Analytics only
- No `unsafe-inline`, no `unsafe-eval`, no external CDNs
- Reporting endpoint in v2

**Subresource Integrity:** required for any external asset (none in v1)

**Backend (v2):**
- All endpoints require auth except explicitly public
- Rate limiting on every endpoint
- Stripe webhook signatures verified
- Input validation via Zod or Valibot at the API boundary
- Prepared statements only
- CSRF protection via SameSite cookies and double-submit tokens

### 8.9 Documentation

**v1 scope (minimal):**
- README per package
- CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
- ARCHITECTURE.md (summarized version of this spec)
- Each tool module has a short README

**v1.5:** full docs site at `docs.wyreup.com` via Starlight, API reference generated from TypeScript types, recipes, migration guides.

### 8.10 Privacy commitments (lifted into `/privacy`)

**Free tier:**
- Nothing leaves your device.
- Nothing is logged.
- Nothing is tracked.
- No telemetry beyond cookieless aggregate page-view counts via Cloudflare Web Analytics.
- Nothing is stored by us.

**Pro tier:**
- Your input is sent to our server and then to our AI provider (kie.ai) for processing. We tell you this before you submit.
- We do not store your prompts, inputs, or outputs. Pass-through only.
- We log only what we need for billing integrity: user id, operation type, timestamp, credit cost.
- We do not track what you generate, how often, or what you do with it.
- We do not share aggregate data with third parties.
- We do not profile users, A/B test on users, or use prompts / outputs to improve models.

---

## 9. Build Sequencing

### Wave 0 — Foundation (no external release)

Monorepo scaffold, shared config, CI, tool module types, registry skeleton, chain engine skeleton, runtime adapter interface, three custom CI checks (isolation, bundle size, privacy scan), placeholder site deployed.

**Exit:** scaffold builds green, placeholder live.

### Wave 1 — Core + Web launch (first external release)

**Tools (8):** compress, convert, crop, resize, rotate, remove-background, strip-exif, blur-faces.

**Pages:** 8 tool pages, home, about, privacy, terms, licenses, accessibility, 404.

**Editor:** context-aware chips, command palette with search + chain mode, visual chain builder, Cmd-K, history, IndexedDB persistence, Zustand store, worker pool, PWA install, file handler registration, chain save/load, starter chains.

**Four surfaces:** `@wyreup/web`, `@wyreup/mcp`, `@wyreup/cli`, `claude-code-wyreup-skill` all ship with these 8 tools.

**Infra:** Cloudflare Pages + Web Analytics only. No Workers yet.

**Exit:** all five packages publishable, all 8 tools pass all 5 UX gates and 3 automated gates. MCP callable from Claude. CLI installable. Skill usable.

### Wave 2 — Expansion

**New tools (9):** watermark, image-to-pdf, pdf-to-image, color-palette, merge-pdf, split-pdf, rotate-pdf, pdf-to-text, html-to-pdf.

**New SEO alias pages (~25):** most common image-format and PDF-format conversions.

**Exit:** 17 top-level tools live. Alias pages indexed.

### Wave 3 — v1 completion

**Remaining tools (14):** collage, gif-maker, image-diff, favicon, filters, qr, compress-pdf, watermark-pdf, protect-pdf, unlock-pdf, reorder-pdf, page-numbers-pdf, sign-pdf, heic-to-jpg.

**Remaining alias pages (~25):** size-specific variants and remaining format conversions.

**Polish:** UX review across all tools, accessibility audit, performance optimization, visual regression baseline, first user-watching sessions, per-tool documentation.

**Exit:** 31 top-level tools + ~50 alias pages live. v1 feature-complete.

### Wave 4 — v1.5 library + surface expansion

- OCR via tesseract.js (~6 tools)
- DOCX via mammoth + docx (~8 tools)
- Vectorize via potrace (license permitting, ~4 tools)
- Video via ffmpeg.wasm (~10+ tools, separate editor mode)
- Dev tools (~20 tools)
- SDK docs site launches

### Wave 5 — v2 Pro tier

Backend scaffolding, auth (magic link + passkey), Stripe integration, first AI tool (z-image) end-to-end, second AI tool (AI upscale), MCP/CLI/skill updates for new tools, pricing page, account UI, launch polish.

### Wave 6 — v3 automations & community

File System Access API folder watching (web), chokidar file watching (CLI), chain marketplace, community sharing, webhooks for automation triggers.

---

## 10. Monorepo Structure and Release Process

### 10.1 Workspace layout

```
wyreup/
├── packages/
│   ├── core/              # @wyreup/core — tool modules, chain engine, registry
│   ├── web/               # @wyreup/web — Astro site, editor, PWA
│   ├── mcp/               # @wyreup/mcp — MCP server
│   ├── cli/               # @wyreup/cli — wyreup command
│   └── claude-skill/      # Claude Code skill (not on npm)
├── tools/                 # dev scripts (CI checks, sitemap gen, etc.)
├── docs/                  # specs, ADRs, architecture notes
├── .github/workflows/     # CI
├── .changeset/            # changeset files
├── package.json           # workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── LICENSE                # MIT
└── README.md
```

### 10.2 Package dependencies

```
@wyreup/web ─┐
             ├──→ @wyreup/core
@wyreup/mcp ─┤
             │
@wyreup/cli ─┘
```

`@wyreup/core` has no internal dependencies. The three consumers depend only on core.

### 10.3 Runtime adapters

`@wyreup/core` publishes dual builds via conditional exports:

```json
"exports": {
  ".": {
    "browser": "./dist/browser/index.js",
    "node": "./dist/node/index.js",
    "default": "./dist/browser/index.js"
  }
}
```

- `runtime/browser.ts` — native browser APIs (canvas, OffscreenCanvas, Workers, IndexedDB)
- `runtime/node.ts` — Node equivalents (`@napi-rs/canvas`, `worker_threads`, in-memory or filesystem storage)

Most tools run in Node natively via WASM (jSquash, pdf-lib, pdfjs-dist, etc.). The 7 canvas-using tools (crop, resize, rotate, watermark, collage, filters, favicon) use the canvas polyfill in Node.

### 10.4 Build tooling

- **Turborepo** for task orchestration, topological build ordering, caching, parallelism
- **tsup** for package builds (ESM/CJS dual, minification, tree-shaking)
- **Astro** for `@wyreup/web`
- **TypeScript project references** for editor propagation

### 10.5 Release process

**Changesets** for versioning and changelog generation.

1. Contributor runs `pnpm changeset`, describes the change
2. PR merges to main with changeset file
3. Changesets bot opens a "Version Packages" PR with aggregated bumps
4. Merging that PR triggers the release workflow, publishes changed packages to npm, creates git tags

**Versioning:**
- `@wyreup/core` — strict semver
- `@wyreup/web` — not published to npm; versioned as git tags and Cloudflare Pages deploys
- `@wyreup/mcp` and `@wyreup/cli` — semver on their public surface

**All packages released at v1.0.0 at launch** and can diverge later.

**npm publishing:** public access, scoped `@wyreup`, 2FA required, tokens in GitHub secrets.

### 10.6 Local development

- `pnpm dev` — Turbo watch mode starts all packages with HMR
- `pnpm test` — Vitest across all packages
- `pnpm build` — parallel build with Turbo caching
- Pre-commit hook: lint-staged, type check, format check, gitleaks

### 10.7 Contribution workflow (assumes open source)

1. Fork or clone
2. Feature branch
3. Changes + tests
4. `pnpm changeset`
5. PR against main
6. CI runs all checks
7. Maintainer reviews and merges
8. Changesets bot PR; maintainer merges for release

### 10.8 Monorepo invariants (CI-enforced)

1. No circular dependencies between packages
2. `@wyreup/core` imports nothing from other `@wyreup/*` packages
3. `@wyreup/core` imports nothing framework-shaped (isolation check)
4. Every package has its own CHANGELOG.md
5. Every package has a README.md
6. Every public export in `@wyreup/core` has JSDoc comments

### 10.9 Documentation strategy

- **v1:** READMEs, CONTRIBUTING.md, SECURITY.md, this spec in `docs/`, ADRs for decisions
- **v1.5:** full docs site at `docs.wyreup.com` (Starlight), generated API reference, recipes, migration guides
- **v2+:** docs site expanded for Pro features, API key setup, pricing

---

## 11. Design Principles (Summary)

1. **Free is free.** Architecturally enforced: free operations run in WASM on the user's device. A CI privacy scan fails the build if any third-party domain appears in the built output.
2. **Tool modules are pure, framework-free, and self-contained.** `@wyreup/core` imports nothing from Astro, React, or any UI framework. CI enforces this via an isolation check.
3. **Ease of use is measurable.** Every tool passes five human UX gates and three automated quality gates before merge.
4. **Use the platform.** Browser-native APIs first; libraries fill gaps.
5. **The tool module contract is the only architectural abstraction.** Landing pages, editor chips, command palette, chain builder, MCP tools, CLI commands, Claude skill — all are consumers of the same contract.
6. **User chains are tools.** A saved chain is a `ToolModule`, indistinguishable from built-in tools in every surface.
7. **Every v1 decision must leave v2 and v3 room to grow without rewrites.**

---

## 12. Library Choices (Reference Table)

| Tool | Library | License | Status |
|---|---|---|---|
| Compress | `@jsquash/*` | Apache-2.0 | Current, active |
| Convert | `@jsquash/*` + heic-to | Apache-2.0 / LGPL-3.0 | See HEIC note below |
| Crop | Cropper.js v2 | MIT | Current (web-components, API-incompatible with v1) |
| Resize / Rotate / Watermark / Filters | Raw canvas / ImageData | — | No library |
| Background removal | `@huggingface/transformers` + RMBG-1.4 | Apache-2.0 | **Replaces AGPL `@imgly/background-removal`** |
| EXIF | exifr + canvas re-encode | MIT | exifr frozen 2022 but feature-complete |
| Face detect | `@mediapipe/tasks-vision` | Apache-2.0 | Current, Google-maintained |
| Images → PDF | pdf-lib | MIT | Frozen 2022 but complete |
| PDF → image | pdfjs-dist | Apache-2.0 | Current, Mozilla |
| Color palette | node-vibrant v4 | MIT | Current (v4 is browser-first rewrite) |
| Collage | d3-hierarchy (pack) + custom masonry + CSS grid | ISC | Hand-built orchestrator |
| GIF maker | gifenc | MIT | Frozen 2022 but feature-complete |
| Image diff | pixelmatch | ISC | Current, Mapbox |
| Favicon | Custom ICO encoder + jszip | MIT | Roll your own |
| QR | qr-code-styling | MIT | Current |
| PDF merge/split/rotate/protect/etc. | pdf-lib | MIT | Frozen 2022 but complete |
| PDF compress | pdfjs-dist + jSquash (re-encode embedded images) | Apache-2.0 | Custom implementation |
| PDF to text | pdfjs-dist | Apache-2.0 | Current |
| HTML to PDF | pdf-lib + custom HTML renderer | MIT | Custom |

**HEIC note:** `heic-to` is LGPL-3.0. Isolated to `/heic-to-jpg` on a dedicated route. Safari users skip the WASM entirely via native HEIC support detection. LGPL compliance: WASM shipped unmodified, attribution in footer + `/licenses`.

**Background removal note:** `@imgly/background-removal` is AGPL-3.0 and cannot be used. Transformers.js with RMBG-1.4 is the replacement.

**Canvas framework note:** No Fabric.js, no Konva.js. Raw canvas + small state layer. Lazy-load a framework into specific tools only if a future tool genuinely requires it.

### v1.5 deferred libraries

| Category | Library | Unlocks | License |
|---|---|---|---|
| OCR | tesseract.js (~10 MB WASM) | /ocr, /pdf-ocr, /image-to-text, etc. | Apache-2.0 |
| DOCX | mammoth.js + docx | /docx-to-pdf, /docx-to-html, etc. | MIT |
| Vectorize | potrace (license TBD) | /png-to-svg, /logo-vectorizer | ⚠ needs verification |
| Video | ffmpeg.wasm (~25 MB) | /video-to-gif, /video-compress, etc. | LGPL-3.0 (same posture as HEIC) |
| Dev tools | mostly native APIs + small libs | JSON, base64, regex, hash, UUID, etc. | Various MIT |

---

## 13. Open Questions and Deferred Decisions

1. **Final name.** Wyreup is the working commit, `wyreup.com` owned. `toanother.one` retained for the tagline. Spec is name-neutral; find/replace if anything shifts.
2. **Open source timing.** Design assumes public from day one (MIT) because it makes LGPL compliance trivial and the privacy promise auditable. Final call is author's.
3. **Potrace license verification.** Need to confirm browser-side potrace library license before committing to v1.5 vectorize tools.
4. **CLI binary distribution.** `npm install -g @wyreup/cli` is v1 baseline. Homebrew tap, scoop, apt/yum repos are post-launch considerations based on demand.
5. **Analytics opt-in for tool usage counts.** v1 uses Cloudflare Web Analytics (aggregate page views only). An opt-in for "counts of tool invocations" could be added to help prioritize tool improvements — documented in privacy policy, default off. Decision deferred.
6. **Starter chain list.** v1 ships 5–10 starter chains. Exact list TBD based on usage research before launch.
7. **Gemini as a development aid.** During v1 build, repetitive work (FAQ content for ~50 landing pages, alt text, meta tags, test fixtures, related-tools blurbs, license attribution formatting) is offloaded to Gemini while architecture and core logic stays with Claude. This is a workflow note, not a product decision.
8. **`@napi-rs/canvas` vs alternatives** for Node runtime. Picked pragmatically; may revisit if it causes issues.
9. **Dependency maintenance risk for "frozen" libraries.** Several load-bearing dependencies are feature-complete but no longer actively maintained (last publishes 2022): `pdf-lib`, `exifr`, `piexifjs`, `gifenc`, `pica`, `d3-hierarchy`. These work today and have no functional gaps, but browser API evolution (e.g., private class field behavior, new global types, deprecation of older WebAssembly patterns) could theoretically break them without an upstream maintainer to fix them. **Mitigation strategy:**
   - **Pin exact versions** in the lockfile — no floating patches that could silently break us.
   - **CI runs integration tests against latest Chrome / Firefox / Safari stable releases** on every PR, not just pinned versions, to catch browser-side breakage early before users hit it.
   - **Maintain a private fork ready-to-publish.** If any frozen library breaks and has no upstream maintainer willing to fix, we fork under `@wyreup/fork-<name>` and maintain the minimum necessary. We're not committing to becoming a general-purpose maintainer of these libraries; we're committing to keeping our own integration working.
   - **Monitor the replacement landscape.** If a healthier alternative emerges (e.g., a modern `pdf-lib` successor), we switch. Not urgently — the current libraries are stable — but we don't ignore the ecosystem.
   - **This is a real risk but a well-understood one.** The alternative (writing our own PDF library, EXIF parser, etc.) is vastly more expensive and slower-to-ship than depending on stable-but-unmaintained libraries.

---

## 14. Appendix: The "Four Surfaces" Mental Model

```
                ┌───────────────────────┐
                │   @wyreup/core        │
                │                       │
                │  • Tool modules       │
                │  • Chain engine       │
                │  • Type graph         │
                │  • Registry           │
                │  • Runtime adapters   │
                │                       │
                │  Framework-free       │
                │  Dual build (browser  │
                │  + Node)              │
                └──────┬────────────────┘
                       │
        ┌──────────────┼──────────────┬────────────────┐
        ▼              ▼              ▼                ▼
   ┌─────────┐   ┌─────────┐    ┌─────────┐      ┌──────────┐
   │  web    │   │   mcp   │    │   cli   │      │  skill   │
   │         │   │         │    │         │      │          │
   │ Astro   │   │  MCP    │    │ wyreup  │      │ Claude   │
   │ site +  │   │ server  │    │ command │      │ Code     │
   │ editor  │   │         │    │         │      │ skill    │
   │ + PWA   │   │         │    │         │      │          │
   └─────────┘   └─────────┘    └─────────┘      └──────────┘
      ▲              ▲              ▲                 ▲
      │              │              │                 │
   End users    AI agents via    Shell users,     Claude Code
               MCP (Claude,     scripts, agents    users
               Continue, etc.)  that shell out
```

Every v2 or v3 capability added to `@wyreup/core` automatically flows to all four surfaces. No duplication, no second implementations, no "the web app has it but the CLI doesn't."

This is the strategic wedge: no other free tool library is agent-native by construction. The window to become *the* toolbelt is real, and the architecture we're shipping in v1 establishes the claim.

---

**End of design specification.**
