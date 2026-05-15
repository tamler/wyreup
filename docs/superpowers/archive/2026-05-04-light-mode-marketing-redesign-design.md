# Light-Mode Default + Marketing Surface Redesign — Wave 1

**Status:** Design approved · Implementation plan pending
**Date:** 2026-05-04
**Owner:** Tamler
**Related:** Wave 2 (functional-surface redesign) starts immediately after Wave 1 ships

---

## Problem

The current Wyreup web UI is a deliberately technical surface: dark near-black background (`#111113`), electric amber accent (`#FFB000`), heavy use of monospace type for buttons/labels/chips, and a "Wyreup Signal" motif system (corner brackets on cards, solder-pad rows, node connectors) that reads as engineering tooling. This identity is well-executed but it filters the audience: a non-technical visitor lands and reads "this is a tool for hackers," when in fact the underlying value (drop a file, get something done, nothing leaves your device) is universally applicable.

The product's strategic position is to broaden the audience to general users while keeping the technical surfaces (CLI, MCP, agent skill) usable by power users. The current UI works against that position. General users may not see the value because the surface signals "for builders only."

## Goal

Reposition the marketing surfaces as approachable to general users — light by default, warmer palette, sentence-case sans-serif typography, conversational copy, generous whitespace — without erasing the brand identity (corner-bracket logo treatment, mono wordmark, amber accent family). Establish the new design language so Wave 2 can extend it across functional surfaces immediately afterwards.

This brainstorm produces the spec for **Wave 1 only**. Wave 2 (functional-surface redesign) will be brainstormed and specced separately, but starts immediately after Wave 1 ships — it is not deferred indefinitely.

## Non-goals

- Theme toggle UI. Mode follows the user's OS preference via `prefers-color-scheme`.
- Changes to the engine, tools, MCP server, CLI, or agent skill behavior.
- Redesign of functional surfaces (tool pages, `/chain/build`, `/toolbelt`, `/tools` index, `/settings`, `/share*`, `/share-receive`, `/toolbelt`, `/404`). These get a "doesn't look broken" repaint pass in Wave 1; their proper redesign is Wave 2.
- Mobile-first reimagining. Responsive must hold; no new mobile-only flows.
- README, social cards, OG images. Separate work if desired. (PWA manifest icons and favicon **are** in scope — they're functional brand surfaces that must work in both modes; see Cross-cutting done criteria.)

## Direction

### Visual language

**Background.** Light by default, warm off-white `#FAF7F0` (paper-like ivory). Auto-dark via `@media (prefers-color-scheme: dark)` keeps the existing near-black palette for users whose OS preference is dark. No toggle UI.

**Surfaces.** Three tones: `base`, slightly recessed (cards), slightly raised (sticky bars / floating UI). Warm-shifted, low contrast against base — surfaces sit closer to the page than the current dark palette's layered "OS chrome" feel.

**Text.** Primary becomes warm near-black `#1A1714` (not pure black; softer). Muted secondary `#5C5852` (passes WCAG AA at standard body sizes against `#FAF7F0` — ~6.0:1). Subtle tertiary `#736E64` (passes AA at ~4.6:1; the originally proposed `#8A8478` only hit ~3.4:1 and would fail at body sizes). Body type increases from `14px` to `15–16px` base — small mono is legible in dark, reads tiny in light.

**Accent.** Amber stays as the brand color; the value re-tunes per mode **and per usage**. The accent has two distinct roles in light mode that need separate tokens because of contrast requirements:

- **Accent fill** (`--amber-deep` = `#D98A00`) — used wherever amber is a *background* (primary button fills, badge fills, decorative blocks). Dark ink on amber-fill hits ~6:1 contrast, which passes AA. **This token is not safe for foreground use** (e.g., link text, standalone icons on paper) — it only hits ~2.6:1 against the paper background, failing even AA Large 3:1.
- **Accent text** (`--amber-text` = `#8A5500`) — used wherever amber is a *foreground* (links, inline accent spans, standalone amber icons on paper). Hits ~5.4:1 against paper, passes AA for body text. This is the value the brand "feels" amber but lives at the legible end of the family.
- **Accent stroke / focus ring** (`--amber-deep-hover` = `#B87505`) — passes 3:1 for non-text UI affordances (focus rings, hover borders) on both base and recessed paper.

Dark mode keeps the existing `--amber-500` (`#FFB000`) and `--amber-400` (`#FFC233`). The light-mode values are **starting points, tunable in implementation** — Tamler flagged interest in pushing brighter / more pure orange. Any retune must re-verify all three contrast roles; pushing brighter degrades contrast, so the trade is real.

**Type system.**
- Sans-serif (Geist Sans) becomes the default everywhere: buttons, labels, body, chips, headings.
- Mono (Geist Mono) restricted to code-like things only: the wordmark, file extensions (`.heic`), CLI commands (`wyreup ...`), tool IDs (`strip-exif`), the chain syntax (`strip-exif → compress`).
- Heading scale increased on marketing surfaces: hero from `2.75rem` to `~3.5–4rem`. Larger, friendlier, easier to scan.

**Motifs (the "Wyreup Signal" / PCB language).**
- **Corner brackets — kept on marketing surfaces, softened.** The brackets are part of the brand identity (the wordmark itself is mono `wyreup`; the brackets are the visual signature). Same geometry as today; quieter color in resting state (border-warm tone rather than saturated amber); gentler hover transition. Still recognizably the brand mark, just less aggressive.
- **Solder-pad rows — removed from marketing surfaces.** These are decoration, not brand identity. They survive on tool pages and chain builder (Wave 2 territory) where they display file metadata and conversion specs.
- **Node connectors — chain-builder only.** Unchanged.
- **Wordmark `wyreup` — stays mono.** Brand-literal.

**Density.** Generous whitespace on marketing. Hero gets dramatic vertical breathing room. Feature blocks get more air. All-caps mono labels (`STRIP THE FILE`, `RUN IT NOW`) become normal sentence-case sans-serif headings.

**Elevation.** Dark mode creates depth via background lightness (`bg → bg-elevated → bg-raised`). On warm ivory, that mechanism produces near-invisible recessed/raised tones — everything blurs into a flat sheet. Light mode needs **soft shadows** (and slightly more visible borders) to achieve the same hierarchy. Three tokens:
- `--shadow-sm` — hairline lift for inline cards and chips.
- `--shadow-md` — standard card elevation.
- `--shadow-lg` — floating UI (sticky bars, dropdowns, modals).

Shadows are mode-aware: in light mode they're tinted warm-near-black at low opacity; in dark mode they're black at higher opacity (closer to current dark behavior, which uses background tone changes plus near-zero shadow). Avoiding the "muddy ivory blur" failure mode is the goal.

### Editorial direction

**Voice shift.** From declarative-technical to conversational-confident. Example:

- Current: `STRIP THE FILE. RUN THE TOOL. NOTHING UPLOADS.` (mono, all caps, three-clause assertion)
- New: `Tools for your files. Nothing uploads.` (sans, sentence case, conversational)

Same promise, no shouting.

**Frame the user's problem first, the architecture second.** Current copy talks about "the engine" and "the surfaces." New copy talks about "your photos," "your receipts," "your files." Architecture is a *consequence* mentioned later, not a feature.

**Reading level target: ~grade 7.** A non-technical visitor lands and understands "drop a file, this happens, nothing leaves my device" within three seconds.

**Privacy stays the headline promise, framed warmly.** Less `NOTHING UPLOADS` (technical assertion); more `Everything happens on your device` (felt benefit).

**Tool naming — what gets softened, what doesn't.** Tool *IDs* (`strip-exif`, `image-to-pdf`, `audio-enhance`, etc.) stay as-is — they're permalinks (`/tools/strip-exif`), public CLI commands (`wyreup strip-exif`), and chain syntax (`strip-exif → compress`). Renaming would break URLs, the CLI, the MCP API, saved chains, and SEO. They continue to render in mono everywhere they appear inline.

What changes is the **descriptive copy around them**. Headlines, page titles, and surface descriptions reframe in user terms: instead of leading with `strip-exif`, lead with "Remove the location and camera data from your photos" and let the tool ID appear as a quiet `strip-exif` chip alongside. The tool ID is a stable handle; the friendly name is the human framing. Wave 2 will likely formalize a `displayName` field on tool definitions, but Wave 1 just commits to the editorial pattern in marketing copy.

### Layout strategy (applied to every redesigned marketing surface)

- **Hero: dramatic vertical breathing room.** Headline + one-line sub + one primary CTA. Optional secondary CTA below. No more dense three-line subhead with mono syntax.
- **One idea per section.** Each section makes one point with one strong example, separated by whitespace. Current homepage tries to convey "what's possible," "the toolbelt," "everywhere your files are," "install as app," and architecture in one scroll — the new rhythm slows this down.
- **Show, then tell.** Each example surface (e.g., "share a photo safely") leads with a visual or interactive element, then explains. Current order is reversed.
- **Mono examples become inline, contextual.** The chain syntax `strip-exif → compress` appears *inside* sentences as a mono inline phrase, not as a standalone code block headline.

### Per-surface scope (Wave 1)

| Surface | Treatment in Wave 1 |
|---|---|
| `/` (homepage) | Full redesign — layout + copy + theme |
| `/about` | Copy rewrite + layout pass + theme |
| `/category/*` | Light pass — top-of-page intro + theme repaint |
| `/cli`, `/mcp`, `/skill` | **Theme repaint only** — layout and copy unchanged. If you're there, you're already in. |
| All functional surfaces (tool pages, `/tools` index, `/chain/build`, `/toolbelt`, `/settings`, `/share*`, `/share-receive`, `/toolbelt`, `/404`) | **"Doesn't look broken" pass** — token repaint only, contrast/hover/focus verified, no layout changes. Proper redesign in Wave 2. |

### Token system & theming mechanism

Three-layer architecture, same shape as the current `tokens.css`:

1. **Primitive palette** — both modes coexist in `:root`. Add new light-mode primitives (warm whites, warm near-blacks, light-mode amber). Keep all existing dark primitives.
2. **Semantic tokens** (`--bg`, `--text-primary`, `--accent`, `--border`, etc.) — default values point to **light primitives**. Inside `@media (prefers-color-scheme: dark)`, the same semantic names get reassigned to **dark primitives**. Components only ever consume semantic tokens, so the same component renders correctly in both modes with zero conditional CSS.
3. **Surface modes** — the existing `surface-welcome` class is updated for both modes and continues to apply to homepage / `/about` / `/category/*` (rename to `surface-marketing` is optional; either choice is fine, but if renamed, update all template usages in the same change). Keeps the existing pattern of marketing-specific surface tuning.

**Illustrative additions to `packages/web/src/styles/tokens.css` (values are starting points, not final; all light values verified for WCAG AA against `--paper`):**

```
/* Light primitives — new */
--paper:              #FAF7F0;   /* warm off-white base */
--paper-recessed:     #F4F0E5;   /* recessed cards */
--paper-raised:       #FFFFFF;   /* sticky / floating UI */
--ink:                #1A1714;   /* primary text, warm near-black (~13:1) */
--ink-muted:          #5C5852;   /* secondary text (~6.0:1, AA) */
--ink-subtle:         #736E64;   /* labels, metadata (~4.6:1, AA) */
--border-warm:        #E5DECC;
--border-warm-subtle: #EFE9D8;
--amber-deep:         #D98A00;   /* accent fill — bg only, dark text on top */
--amber-text:         #8A5500;   /* accent foreground — links, inline (~5.4:1) */
--amber-deep-hover:   #B87505;   /* accent stroke / focus ring (~3:1+) */

/* Light shadows — soft warm-tinted lift */
--shadow-sm: 0 1px 2px rgba(26, 23, 20, 0.04);
--shadow-md: 0 2px 8px rgba(26, 23, 20, 0.06), 0 1px 2px rgba(26, 23, 20, 0.04);
--shadow-lg: 0 8px 24px rgba(26, 23, 20, 0.08), 0 2px 6px rgba(26, 23, 20, 0.05);
```

**Accent semantics across modes.** Three semantic accent tokens, each mapped per mode:

| Semantic | Light | Dark | Use |
|---|---|---|---|
| `--accent` (fill) | `--amber-deep` `#D98A00` | `--amber-500` `#FFB000` | Button fills, badge fills — never as foreground on `--bg` |
| `--accent-text` | `--amber-text` `#8A5500` | `--amber-500` `#FFB000` | Links, inline accent text, foreground icons on `--bg` |
| `--accent-hover` | `--amber-deep-hover` `#B87505` | `--amber-400` `#FFC233` | Stroke color, focus rings, hover border, fill-hover state |

Components consume the right semantic for their context — a button fill uses `--accent`, an inline link uses `--accent-text`, a focus ring uses `--accent-hover`. The split exists because amber that's *bright enough to feel like a brand* is not *dark enough to be readable as foreground text* on warm white. This is the trade.

**Implementation order (informational; the implementation plan will sequence properly).** Token rewrite lands first; then marketing surface redesign on top of new tokens; then "doesn't look broken" sweep across functional surfaces; then verification. Copy work happens alongside marketing layout work because they're interdependent.

## Done criteria

Wave 1 ships when **all** of the following are true.

**Token system**
- New light primitives + semantic mappings live in `packages/web/src/styles/tokens.css`.
- `@media (prefers-color-scheme: dark)` block reassigns semantic tokens to existing dark primitives.
- No component contains hardcoded color values; everything resolves through semantic tokens.

**Marketing surfaces — full redesign (`/`, `/about`, `/category/*`)**
- New hero pattern (sentence-case sans, generous vertical, single primary CTA).
- One idea per section; show-then-tell rhythm.
- Copy rewritten to ~grade-7 reading level, conversational voice, "your files / your photos" framing.
- Corner brackets present on cards in softened resting state; solder-pad rows removed from these surfaces.
- Mono restricted to wordmark, file extensions, CLI commands, tool IDs, chain syntax.
- Renders correctly in both light and auto-dark.

**Marketing surfaces — repaint only (`/cli`, `/mcp`, `/skill`)**
- New tokens applied; layout and copy unchanged.
- Renders correctly in both modes.

**Functional surfaces — "doesn't look broken" pass**

"Broken" is defined concretely. A functional surface fails this gate if any of the following is true in light mode:

- WCAG AA contrast fails for any body text (< 4.5:1) or any non-text UI affordance (< 3:1).
- A border, divider, or outline that was visible on dark is invisible or near-invisible on warm ivory (common cause: `rgba(255,255,255,0.06)` style tokens that vanish on light).
- Any element relies on `mix-blend-mode`, `backdrop-filter`, or transparency-on-dark patterns that read wrong on light (e.g., a translucent overlay built for darkening that now lightens further).
- Hover/focus state is not perceivable against the new background.
- Any usability regression vs. the current dark version of the same surface.

Verification mechanism: capture **side-by-side screenshots** (current dark production vs. new light, full page) for the three highest-complexity functional surfaces — `/chain/build`, a tool result panel (e.g., `/tools/strip-exif` after a file is loaded), and `/toolbelt` — and review for the failure modes above before merge. Other functional surfaces get a manual spot-check.

Other criteria for the "doesn't look broken" pass:
- Mono-heavy regions remain legible at their existing sizes on warm white.
- Auto-dark renders identically to current production dark theme (visual diff against current production for the same surfaces).
- No layout changes.

**Cross-cutting**
- Wordmark + corner-bracket logo treatment renders correctly in both modes.
- All accent uses resolve to the *correct semantic token* for context: button fills use `--accent`, links use `--accent-text`, focus rings use `--accent-hover`. No `--accent` foreground text usages remain on the page background.
- Favicon (`favicon.svg` and any PNG fallbacks) and PWA manifest icons render legibly on a light browser tab, a dark browser tab, and on iOS / Android home screens. If the current icon is amber-on-dark and loses its motif on a light tab background, an updated icon variant is included in the PR.
- No JavaScript-based theme switching exists in the codebase or is added in this work. Mode is purely CSS-driven via `prefers-color-scheme`. Implementation includes a code search for any `theme`, `dark-mode`, `colorScheme`, or `data-theme` JS state — if found and unrelated to this work, document it; if related, remove it.
- No regression in PWA install flow, share-target flow, or any tool's runtime behavior.

## Risks

- **"Fine but not great" risk on functional surfaces.** Path A means tool pages and chain builder will look like a flat repaint of dark UI. If during the legibility pass any surface looks materially worse than its current dark version, Wave 1 should pause to fix that surface specifically — do not ship a degradation.
- **Amber tuning vs. contrast.** `#D98A00` (fill) and `#8A5500` (text) are starting values. Tamler flagged wanting room to push brighter / more pure orange. Pushing the *fill* amber brighter degrades the focus-ring contrast (3:1 floor); pushing the *text* amber brighter degrades link contrast (4.5:1 floor). Any retune must re-verify all three contrast roles. Do not bake derived assumptions (focus-ring tints, hover blends) on top of literal hexes; derive from semantic tokens.
- **Hairline borders / transparency tokens.** Several existing components likely use `rgba(255,255,255,0.04–0.08)` for subtle borders that work on dark and vanish on light. The "doesn't look broken" pass must catch these — automated check would be a grep for `rgba(255` in component CSS, manual check for any disappearing dividers in chain builder and result panels.
- **Copy rewrite quality has no automated test.** Plan a fresh-eyes review pass on all rewritten copy before merging. A single off-key headline can undo the approachability gain that the rest of the work delivered.
- **Dark mode regression.** The auto-dark path must produce visually identical output to the current production dark theme. Risk vector: token reorganization changes a value subtly. Verification should include a side-by-side of current production vs. dark-mode rendering of the same pages.
- **Wave 1 shortcuts that block Wave 2.** Avoid hardcoded light-only values, surface-specific patches, or copy/layout decisions that would force Wave 2 to undo them. The "doesn't look broken" pass on functional surfaces must use the same tokens Wave 2 will inherit.

## Wave 2 cadence

Wave 2 (functional-surface redesign — tool pages, `/chain/build`, `/toolbelt`, `/tools` index, possibly `/settings` and the share flows) starts **immediately** after Wave 1 ships. It is not a deferred backlog item. To support that:

- **Wave 1 stays tight on scope.** Resist scope-creep into "small Wave 2 things" because they're nearby. Fastest path to Wave 2 is shipping Wave 1 cleanly.
- **Wave 2 brainstorming may start during Wave 1 implementation.** The harder design questions (tool page rethink, chain builder onboarding for non-technical users, kit / settings restructure) can be explored in parallel without waiting for Wave 1 to merge.
- **Wave 1 establishes the design vocabulary Wave 2 inherits.** Tokens, type system, motif rules, and editorial voice all get locked in Wave 1. Wave 2 extends them, doesn't redefine them.

## Open questions for Wave 2 (out of scope here, listed for planning)

- Tool page layout: how does a non-technical user understand what a tool does, what the inputs/outputs are, and how to use it, before they drop a file?
- Chain builder onboarding: what does the first run look like for someone who's never seen a chain syntax?
- Kit / saved chains: surface as a feature for non-technical users, or stay as a power-user convenience?
- Tools index (`/tools`): is the catalog browsable and learnable, or is it currently a dump?
- README + repo identity: separate work, but should track the new visual language eventually.
