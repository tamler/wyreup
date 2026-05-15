# Light-Mode Default + Marketing Surface Redesign — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a light-default, warm off-white repaint of the entire web app with a redesigned marketing surface (homepage, /about, /category/*) and copy/microcopy pass, while preserving brand identity (corner brackets, mono wordmark, amber accent family) and keeping all existing functionality intact.

**Architecture:** Three-layer CSS token system (primitives → semantic → surface modes), light-default with `@media (prefers-color-scheme: dark)` reassigning semantic tokens to existing dark primitives. Marketing surfaces redesigned holistically (layout + copy + theme together). Functional surfaces inherit the new tokens via a "doesn't look broken" sweep — no layout changes. Three semantic accent tokens (`--accent` fill, `--accent-text` foreground, `--accent-hover` stroke) split because amber bright enough to feel like a brand is not dark enough to read as foreground text on warm white.

**Tech Stack:** Astro 4 (static), Svelte 4 (interactive components), pnpm + Turbo, Geist Sans + Geist Mono, custom CSS tokens (no Tailwind/CSS-in-JS).

**Spec:** `docs/superpowers/specs/2026-05-04-light-mode-marketing-redesign-design.md`

---

## File Structure

Files this plan modifies or creates, grouped by responsibility:

**Token & global styling**
- Modify: `packages/web/src/styles/tokens.css` (add light primitives, semantic mappings, dark media-query reassignment, three-token accent system, shadow tokens)
- Modify: `packages/web/src/styles/global.css` (button colors derive from semantic tokens; typography baseline bumped from 14→15px; shadow tokens applied to `.anywhere-card`)
- Modify: `packages/web/src/styles/motifs.css` (corner brackets get softer resting state in light, retain amber lock-on hover)

**Layout & meta**
- Modify: `packages/web/src/layouts/BaseLayout.astro` (mode-aware `theme-color` meta via `media` attribute; status-bar style; `surface-welcome` class kept; light/dark verification)
- Modify: `packages/web/astro.config.mjs` (PWA manifest `theme_color` + `background_color` updated for light)

**Marketing surfaces — redesigned**
- Modify: `packages/web/src/pages/index.astro` (hero copy + layout, scenario rhythm, mono demotion, all-caps demotion)
- Modify: `packages/web/src/pages/about.astro` (copy rewrite, layout pass)
- Modify: `packages/web/src/pages/category/[slug].astro` (top-of-page intro + repaint)

**Marketing surfaces — repaint only**
- Modify (verify-only): `packages/web/src/pages/cli.astro`, `mcp.astro`, `skill.astro`

**Functional surface fixes (transparency-on-dark)**
- Modify: `packages/web/src/components/runners/PdfRedactRunner.svelte` (replace `rgba(255, 255, 255, 0.4)` and `rgba(255, 255, 255, 0.6)` borders with semantic tokens)

**Brand assets**
- Verify / modify: `packages/web/public/favicon.svg`, `apple-touch-icon.png`, `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`, `pwa-monochrome-512.png`, `og-image.svg`, `og-image.png`

**Verification scaffolding**
- Create (test-only): `packages/web/tests/tokens.test.ts` (CSS variable presence + value sanity checks)
- Create (one-shot script): `packages/web/scripts/screenshot-pages.mjs` (Playwright-driven side-by-side capture for spec verification)

---

## Pre-flight checks

Before starting Task 1, confirm:
- `pnpm install` succeeds at the repo root.
- `pnpm --filter @wyreup/web dev` boots the dev server on `http://localhost:4321` (or current Astro default).
- `pnpm --filter @wyreup/web build` completes cleanly against current `main`.
- `pnpm test` passes against current `main`.
- A new branch is checked out for this work: `git checkout -b feat/light-mode-wave-1`.

If any of these fail on `main`, stop and report — they need to pass before adding new work on top.

---

## Task 0: Branch setup and baseline screenshots

**Files:**
- Create (one-shot, will be deleted): `/tmp/wave1-baseline-screenshots/`

- [ ] **Step 1: Create branch**

```bash
cd /Users/jacob/Projects/wyreup.com
git checkout main
git pull --ff-only
git checkout -b feat/light-mode-wave-1
```

Expected: clean checkout, branch created.

- [ ] **Step 2: Boot dev server in background**

```bash
pnpm --filter @wyreup/web dev > /tmp/wave1-dev.log 2>&1 &
```

Wait ~5 seconds, then verify with `curl -s http://localhost:4321 | head -5`. Expected: HTML output beginning with `<!DOCTYPE html>`.

- [ ] **Step 3: Capture baseline (current dark) screenshots for visual regression**

Use a headless browser to capture the surfaces we will compare against later:
```bash
mkdir -p /tmp/wave1-baseline-screenshots
npx -y playwright@latest install chromium
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  for (const url of ['/', '/about', '/cli', '/mcp', '/skill', '/tools', '/chain/build', '/my-kit', '/settings']) {
    await page.goto('http://localhost:4321' + url, { waitUntil: 'networkidle' });
    const safeName = url === '/' ? 'home' : url.replace(/\\//g, '_').replace(/^_/, '');
    await page.screenshot({ path: '/tmp/wave1-baseline-screenshots/' + safeName + '.png', fullPage: true });
    console.log('captured', url);
  }
  await browser.close();
})();
"
```

Expected: 9 screenshot files saved. These are the *baseline* dark renderings; auto-dark in the new build must match these.

---

## Task 1: Token system rewrite

**Files:**
- Modify: `packages/web/src/styles/tokens.css`

This task is the load-bearing change. Every other visual change downstream depends on these tokens being right.

- [ ] **Step 1: Replace `tokens.css` with the new structure**

Open `packages/web/src/styles/tokens.css` and replace its entire contents with:

```css
:root {
  /* ─────────────────────────────────────────────────────────────
     LAYER 1: Primitives — all available colors, both modes
     ───────────────────────────────────────────────────────────── */

  /* Existing dark primitives — preserved as-is */
  --black:        #0A0A0A;
  --gray-950:     #111113;
  --gray-900:     #18181B;
  --gray-800:     #27272A;
  --gray-700:     #3F3F46;
  --gray-600:     #52525B;
  --gray-400:     #A1A1AA;
  --gray-200:     #E4E4E7;
  --gray-100:     #F4F4F5;

  --amber-500:    #FFB000;
  --amber-400:    #FFC233;
  --amber-900:    #2D1F00;

  --green-500:    #22C55E;
  --yellow-500:   #EAB308;
  --red-500:      #EF4444;

  /* New light primitives */
  --paper:              #FAF7F0;
  --paper-recessed:     #F4F0E5;
  --paper-raised:       #FFFFFF;
  --ink:                #1A1714;
  --ink-muted:          #5C5852;
  --ink-subtle:         #736E64;
  --border-warm:        #E5DECC;
  --border-warm-subtle: #EFE9D8;
  --amber-deep:         #D98A00;
  --amber-text:         #8A5500;
  --amber-deep-hover:   #B87505;

  /* ─────────────────────────────────────────────────────────────
     LAYER 2: Semantic tokens — defaults point to LIGHT primitives
     ───────────────────────────────────────────────────────────── */

  --bg:             var(--paper);
  --bg-elevated:    var(--paper-recessed);
  --bg-raised:      var(--paper-raised);
  --border:         var(--border-warm);
  --border-subtle:  var(--border-warm-subtle);
  --text-primary:   var(--ink);
  --text-muted:     var(--ink-muted);
  --text-subtle:    var(--ink-subtle);

  /* Three-token accent system — see spec for rationale */
  --accent:         var(--amber-deep);        /* fill: button bg, badge bg */
  --accent-text:    var(--amber-text);        /* foreground: links, inline */
  --accent-hover:   var(--amber-deep-hover);  /* stroke: focus ring, border */
  --accent-dim:     var(--amber-900);         /* unchanged usage */

  --success:        var(--green-500);
  --warning:        var(--yellow-500);
  --danger:         var(--red-500);

  /* Shadows — soft warm-tinted lift for light mode */
  --shadow-sm: 0 1px 2px rgba(26, 23, 20, 0.04);
  --shadow-md: 0 2px 8px rgba(26, 23, 20, 0.06), 0 1px 2px rgba(26, 23, 20, 0.04);
  --shadow-lg: 0 8px 24px rgba(26, 23, 20, 0.08), 0 2px 6px rgba(26, 23, 20, 0.05);

  /* ── Font families ── */
  --font-sans: 'Geist Sans', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Consolas, monospace;

  /* ── Type scale (raised to support light-mode legibility) ── */
  --text-xs:    0.6875rem;  /* 11px */
  --text-sm:    0.8125rem;  /* 13px */
  --text-base:  0.9375rem;  /* 15px — was 14px */
  --text-md:    1rem;       /* 16px */
  --text-lg:    1.125rem;   /* 18px */
  --text-xl:    1.5rem;     /* 24px */
  --text-2xl:   1.875rem;   /* 30px */
  --text-hero:  3.5rem;     /* 56px — was 44px */

  /* ── Spacing scale (unchanged) ── */
  --space-1:   0.25rem;
  --space-2:   0.5rem;
  --space-3:   0.75rem;
  --space-4:   1rem;
  --space-6:   1.5rem;
  --space-8:   2rem;
  --space-12:  3rem;
  --space-16:  4rem;
  --space-24:  6rem;

  /* ── Radius scale (unchanged) ── */
  --radius-none:  0;
  --radius-sm:    2px;
  --radius-md:    4px;
  --radius-lg:    6px;

  /* ── Motion (unchanged) ── */
  --duration-instant:  100ms;
  --duration-fast:     150ms;
  --duration-base:     200ms;
  --duration-slow:     300ms;

  --ease-sharp:   cubic-bezier(0.25, 0, 0, 1);
  --ease-out:     cubic-bezier(0, 0, 0.2, 1);
  --ease-in:      cubic-bezier(0.4, 0, 1, 1);
  --ease-linear:  linear;
}

/* ─────────────────────────────────────────────────────────────
   LAYER 2 (continued): Auto-dark — reassign semantics only
   Components consume semantic tokens, so they render correctly
   in both modes with zero conditional CSS.
   ───────────────────────────────────────────────────────────── */
@media (prefers-color-scheme: dark) {
  :root {
    --bg:             var(--gray-950);
    --bg-elevated:    var(--gray-900);
    --bg-raised:      var(--gray-800);
    --border:         var(--gray-700);
    --border-subtle:  var(--gray-800);
    --text-primary:   var(--gray-100);
    --text-muted:     var(--gray-400);
    --text-subtle:    var(--gray-600);

    --accent:         var(--amber-500);   /* dark fill — bright */
    --accent-text:    var(--amber-500);   /* dark foreground — bright reads fine on dark */
    --accent-hover:   var(--amber-400);   /* dark stroke / hover */
    --accent-dim:     var(--amber-900);

    /* Dark shadows — black, slightly heavier */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
  }
}

/* ─────────────────────────────────────────────────────────────
   LAYER 3: Surface modes
   `surface-welcome` is applied to marketing surfaces (homepage,
   /about, /category/*) by BaseLayout via the `surfaceMode` prop.
   In light mode it's the default paper warmth (no override needed
   since defaults are already paper). In dark mode it lifts the
   warmth back in (same as previous behavior).
   ───────────────────────────────────────────────────────────── */
.surface-welcome {
  /* Light mode: no override — defaults already use --paper warmth */
}

@media (prefers-color-scheme: dark) {
  .surface-welcome {
    --bg:           #17161a;   /* warmer than gray-950 */
    --text-primary: #ECE7DE;   /* ivory-tinted off-white */
  }
}
```

- [ ] **Step 2: Verify file has no syntax errors**

Run `pnpm --filter @wyreup/web build` and confirm it completes without CSS errors.
Expected: build succeeds.

- [ ] **Step 3: Visual sanity check — load the dev server in light mode**

The dev server should still be running from Task 0. In a browser, open http://localhost:4321 with the OS preference set to **light**. Expected: page renders on warm off-white background, primary text is warm near-black, the homepage hero amber CTA is the deeper `#D98A00`. No Astro errors.

- [ ] **Step 4: Visual sanity check — switch to dark**

Toggle OS preference to **dark** and reload http://localhost:4321. Expected: page matches the baseline dark screenshot from Task 0 within reason — dark near-black background, bright amber CTA, ivory text. If anything looks visibly different from the baseline, note which surface and which element; this needs to be tracked in Task 16.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/tokens.css
git commit -m "feat(web): light-default token system with auto-dark via prefers-color-scheme

Three-layer architecture: light primitives + dark primitives both
declared in :root; semantic tokens default to light values and get
reassigned inside a prefers-color-scheme: dark media query. Adds
three-token accent system (fill / text / hover) to satisfy WCAG AA
on warm off-white. Adds soft shadow tokens for light-mode elevation.
Bumps body type from 14px to 15px and hero from 44px to 56px."
```

---

## Task 2: Update BaseLayout meta theme-color for both modes

**Files:**
- Modify: `packages/web/src/layouts/BaseLayout.astro:34`

The current `theme-color` meta is hardcoded to `#FFB000` (the dark amber). Browsers use this for the address bar / status bar tint. Need to provide both modes.

- [ ] **Step 1: Read current meta tags around line 34**

Read lines 30–55 of `packages/web/src/layouts/BaseLayout.astro` to understand surrounding meta tag context.

- [ ] **Step 2: Replace the single theme-color meta with a mode-aware pair**

Find this line:
```astro
<meta name="theme-color" content="#FFB000" />
```

Replace with:
```astro
<meta name="theme-color" content="#FAF7F0" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)" />
```

- [ ] **Step 3: Verify status-bar style still works on iOS**

Find the line:
```astro
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

Leave this as-is. `black-translucent` works for both light and dark home-screen launches; changing it would alter PWA behavior.

- [ ] **Step 4: Verify build still passes**

```bash
pnpm --filter @wyreup/web build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/layouts/BaseLayout.astro
git commit -m "feat(web): mode-aware theme-color meta for light + dark"
```

---

## Task 3: Update PWA manifest theme_color and background_color

**Files:**
- Modify: `packages/web/astro.config.mjs:27-28`

The PWA manifest currently advertises `theme_color: '#FFB000'` and `background_color: '#111113'`. The OS uses these for the splash screen on launch. Light-default means these need to be the light-mode values.

- [ ] **Step 1: Read the PWA manifest block in astro.config.mjs**

Open `packages/web/astro.config.mjs` and locate the `manifest:` block (around lines 20–40). Confirm the current `theme_color` and `background_color` lines.

- [ ] **Step 2: Replace the values**

Find:
```js
theme_color: '#FFB000',
background_color: '#111113',
```

Replace with:
```js
theme_color: '#FAF7F0',
background_color: '#FAF7F0',
```

(Both set to the paper background — the splash screen and theme bar should both be the warm off-white.)

- [ ] **Step 3: Build and inspect generated manifest**

```bash
pnpm --filter @wyreup/web build
cat packages/web/dist/manifest.webmanifest | head -20
```

Expected: `theme_color` and `background_color` both show `#FAF7F0`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/astro.config.mjs
git commit -m "feat(web): update PWA manifest theme_color and background_color for light default"
```

---

## Task 4: Audit JS theme switching (verification only)

**Files:**
- No file changes expected.

The spec promises no JS-driven theme switching. Confirm none exists.

- [ ] **Step 1: Search the source tree**

```bash
grep -rn "data-theme\|colorScheme\|color-scheme.*=\|theme-toggle\|themeToggle\|setTheme\|getTheme\|dark-mode" \
  packages/web/src/ packages/cli/src/ packages/mcp/src/ 2>/dev/null | grep -v node_modules
```

- [ ] **Step 2: Categorize findings**

For every match, decide one of:
- **Unrelated** (e.g., a tool that uses the word "theme" for a different reason — color theme on an image, etc.) — record briefly.
- **Related** — must be removed in the same PR.

Expected outcome: zero "related" findings (the codebase already relies entirely on `prefers-color-scheme` per the design). If a finding is "related," remove it as part of this task and re-run the search to confirm clean.

- [ ] **Step 3: Document findings as a comment if non-trivial**

If matches were found and triaged as "unrelated," there's no commit needed. If anything was removed, commit:

```bash
git add <files>
git commit -m "chore(web): remove residual JS theme switching (unused; prefers-color-scheme is canonical)"
```

---

## Task 5: Audit and fix transparency-on-dark borders

**Files:**
- Modify: `packages/web/src/components/runners/PdfRedactRunner.svelte:518,537`
- Modify (if other matches found): the matching files

Several places may use `rgba(255,255,255,0.0X)` borders that vanish on warm white. Pre-audit identified `PdfRedactRunner.svelte`; sweep the rest now.

- [ ] **Step 1: Find all matches**

```bash
grep -rn "rgba(255" packages/web/src/ 2>/dev/null
```

- [ ] **Step 2: Read each match in context**

For each file/line, read 10 lines before and after to understand the use. Categorize:
- **Border / outline** — replace with `1px solid var(--border)` or `1px solid var(--border-subtle)` per visual weight needed.
- **Background tint** — replace with `var(--bg-raised)` or `var(--bg-elevated)` depending on intent.
- **Other** (text shadow, etc.) — review case by case.

- [ ] **Step 3: Fix `PdfRedactRunner.svelte`**

Read `packages/web/src/components/runners/PdfRedactRunner.svelte` lines 510–545 to see the surrounding rule sets. The two flagged lines:

Line 518:
```svelte
border: 1px solid rgba(255, 255, 255, 0.4);
```
Replace with:
```svelte
border: 1px solid var(--border);
```

Line 537:
```svelte
border: 1px dashed rgba(255, 255, 255, 0.6);
```
Replace with:
```svelte
border: 1px dashed var(--text-muted);
```

(Dashed borders need more visual weight than solid; `--text-muted` provides it without becoming a hard rule.)

- [ ] **Step 4: Apply same fix pattern to any other matches found**

For each remaining `rgba(255` match in step 1 that isn't PdfRedactRunner: apply the same categorization and replacement.

- [ ] **Step 5: Re-run the grep to confirm clean**

```bash
grep -rn "rgba(255" packages/web/src/ 2>/dev/null
```

Expected: zero matches (or only matches that are intentionally `rgba(255,255,255,1)` opaque-white usages — none should exist for borders).

- [ ] **Step 6: Build to verify no Svelte syntax errors**

```bash
pnpm --filter @wyreup/web build
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/runners/PdfRedactRunner.svelte
# add any other files that were fixed
git commit -m "fix(web): replace transparency-on-dark borders with semantic tokens for light-mode legibility"
```

---

## Task 6: Soften corner brackets for light mode

**Files:**
- Modify: `packages/web/src/styles/motifs.css`

The brackets need to be present but quieter on marketing surfaces in light mode. Current resting state: `1px solid var(--border)` (was `--gray-700` in dark, becomes `--border-warm` in light — already softer by virtue of token mapping). Verify this reads correctly; adjust hover if needed.

- [ ] **Step 1: Read current motifs.css**

Read `packages/web/src/styles/motifs.css` in full (~237 lines).

- [ ] **Step 2: Verify brackets render in both modes**

Open the dev server. Visit the homepage and inspect any card with `.brackets` class (e.g., the install cards, the anywhere cards). Confirm:
- **Light mode:** the bracket strokes are visible but quiet (warm border tone). Hover should still lock to amber but use `--accent-hover` not raw `--accent`.
- **Dark mode:** brackets render the same as today.

- [ ] **Step 3: Update hover color to use `--accent-hover` instead of `--accent`**

In `motifs.css`, find the four hover rules (around lines 86–108):
```css
.brackets:hover::before { ... border-color: var(--accent); }
.brackets:hover::after { ... border-color: var(--accent); }
.brackets:hover .brackets-inner::before { ... border-color: var(--accent); }
.brackets:hover .brackets-inner::after { ... border-color: var(--accent); }
```

Change every `border-color: var(--accent)` to `border-color: var(--accent-hover)` in the hover and `.brackets-active` rules. Reason: amber-fill (`--accent`) on light backgrounds doesn't meet 3:1 contrast for stroke/non-text UI; amber-hover (`--accent-hover` = `#B87505`) does.

- [ ] **Step 4: Reload and re-verify**

Hover a card. Light mode: brackets snap to a deeper, slightly burnt amber that's clearly visible. Dark mode: still bright amber (because in dark mode `--accent-hover` is `--amber-400` which is bright).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/motifs.css
git commit -m "fix(web): brackets hover uses --accent-hover for light-mode contrast"
```

---

## Task 7: Update global.css for new tokens, type, shadows

**Files:**
- Modify: `packages/web/src/styles/global.css`

Apply the new type scale, the shadow tokens to `.anywhere-card`, ensure no hardcoded dark-mode values remain.

- [ ] **Step 1: Read current global.css**

Read `packages/web/src/styles/global.css` in full (~259 lines).

- [ ] **Step 2: Update body line-height for the new larger base size**

The current rule sets `font-size: var(--text-base)` (now 15px) and `line-height: 1.6`. That's fine; leave it.

- [ ] **Step 3: Update `.btn-primary` to use the new accent system**

Find:
```css
.btn-primary {
  background: var(--accent);
  color: var(--black);
  border-color: var(--accent);
}

.btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
```

Change `color: var(--black)` to `color: var(--ink)`. Reason: in light mode, `--black` is still pure-black `#0A0A0A` which is fine, but `--ink` matches the rest of the type system and reads warmer on amber. Verify dark text on amber still hits ~6:1 contrast.

- [ ] **Step 4: Update `.skip-link` similarly**

Find:
```css
.skip-link {
  ...
  background: var(--accent);
  color: var(--black);
  ...
}
```

Change `color: var(--black)` to `color: var(--ink)` for consistency.

- [ ] **Step 5: Apply shadow tokens to `.anywhere-card`**

Find `.anywhere-card` and `.anywhere-card__inner` rules. Add `box-shadow: var(--shadow-sm)` to `.anywhere-card`, and `box-shadow: var(--shadow-md)` on `:hover` for a gentle lift. Replace any pre-existing box-shadow on these rules.

Existing rule:
```css
.anywhere-card {
  display: block;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 1px;
  text-decoration: none;
  color: inherit;
  transition: border-color var(--duration-fast) var(--ease-sharp);
  position: relative;
  overflow: visible;
}
```

Change to:
```css
.anywhere-card {
  display: block;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 1px;
  text-decoration: none;
  color: inherit;
  transition: border-color var(--duration-fast) var(--ease-sharp),
              box-shadow var(--duration-fast) var(--ease-sharp);
  position: relative;
  overflow: visible;
  box-shadow: var(--shadow-sm);
}

.anywhere-card:hover {
  border-color: var(--text-muted);
  box-shadow: var(--shadow-md);
}
```

(Replace the existing `.anywhere-card:hover` rule entirely; merge `box-shadow` with the existing `border-color` change.)

- [ ] **Step 6: Update `.anywhere-card__headline code` to use `--accent-text` instead of `--accent`**

Find:
```css
.anywhere-card__headline code {
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--accent);
}
```

Change `color: var(--accent)` to `color: var(--accent-text)`. Reason: this is foreground text on a card background, must hit 4.5:1 in light.

- [ ] **Step 7: Build, then visit homepage and confirm**

```bash
pnpm --filter @wyreup/web build
```

Reload the dev server. Confirm the "Use Wyreup anywhere" cards have a soft drop shadow in light mode that lifts on hover.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/styles/global.css
git commit -m "fix(web): global styles use --accent-text for foreground amber and shadow tokens for elevation"
```

---

## Task 8: Sweep all components for `--accent` foreground misuse

**Files:**
- Modify: any component that uses `var(--accent)` for `color` (foreground) instead of `background` (fill).

`--accent` is now fill-only in light mode; foreground-text uses must switch to `--accent-text`. The grep finds them.

- [ ] **Step 1: Find all `color: var(--accent)` usages**

```bash
grep -rn "color:\s*var(--accent)" packages/web/src/ 2>/dev/null | grep -v "\-\-accent\-"
```

This intentionally excludes `--accent-text`, `--accent-hover`, `--accent-dim`.

- [ ] **Step 2: Replace each match**

For every match, change `color: var(--accent)` to `color: var(--accent-text)`. The tokens map identically in dark mode (both resolve to `--amber-500`), so dark mode is unaffected; light mode gains the contrast-safe foreground value.

Same sweep for any inline-styled `style="color: var(--accent)"` if the grep finds them.

- [ ] **Step 3: Find border / outline uses of `--accent` and confirm they should stay or move to `--accent-hover`**

```bash
grep -rn "border-color:\s*var(--accent)\b\|outline:\s*[^;]*var(--accent)\b" packages/web/src/ 2>/dev/null | grep -v "\-\-accent\-"
```

For each: keep `--accent` only if the surface beneath it is dark in both modes (rare). If unsure, switch to `--accent-hover` (3:1+ in light, bright in dark).

- [ ] **Step 4: Check focus-visible outlines specifically**

```bash
grep -rn "outline: 2px solid var(--accent)" packages/web/src/ 2>/dev/null
```

Found in `global.css` (`.btn:focus-visible` and `a:focus-visible`). These need to stay visible on light backgrounds. Change `var(--accent)` to `var(--accent-hover)` for the same 3:1 reason. Verify the focus ring is still visible after change.

- [ ] **Step 5: Build and visual spot-check**

```bash
pnpm --filter @wyreup/web build
```

Walk through the homepage, click into a tool page, tab through interactive elements. Confirm focus rings are visible against light backgrounds and amber-colored text reads clearly.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/
git commit -m "fix(web): split --accent into fill/text/hover semantics across all components"
```

---

## Task 9: Homepage redesign — hero copy + layout

**Files:**
- Modify: `packages/web/src/pages/index.astro` (hero section, lines ~42–91)

The hero is the highest-stakes surface. Current copy: `120+ file tools that run on your device.` (declarative, technical, mono-feel). Target: conversational, sentence-case, clear.

- [ ] **Step 1: Read the current hero block (lines 42–91)**

Confirm structure: `<section class="hero section-rhythm">` containing left copy column + right HeroDrop component, plus a trust strip and a scroll hint.

- [ ] **Step 2: Replace the hero copy block**

Find the entire `<div class="hero__copy">` block and replace its contents with:

```astro
<div class="hero__copy">
  <h1 class="hero__headline">Tools for your files. <span class="hero__headline-accent">Nothing uploads.</span></h1>
  <p class="hero__body">
    Drop a file. We'll show you what you can do with it — compress, convert, transcribe, redact, and {allTools.length - 5}+ more. Everything happens on your device. No signup. No tracking.
  </p>
  <p class="hero__surfaces">
    Use Wyreup in your <a href="/" class="hero__surface-link" aria-current="page">browser</a>, your <a href="/cli" class="hero__surface-link">terminal</a>, or your <a href="/skill" class="hero__surface-link">AI assistant</a>.
  </p>
  <div class="hero__actions">
    <a href="/tools" class="btn btn-primary">Browse all tools &rarr;</a>
  </div>
</div>
```

Notes:
- Headline becomes a two-clause sentence with the privacy promise as the accent.
- Body switches from listing tools as nouns to conversational "drop a file, we'll show you what you can do."
- Tool count appears in the body, not the headline (less noisy first impression).
- Surfaces line is reframed in second person ("your browser, your terminal, your AI assistant").

- [ ] **Step 3: Update hero scoped styles**

Locate the `<style>` block in this file and find `.hero__headline`. Update it to use the new larger hero size and add an accent treatment:

```css
.hero__headline {
  font-family: var(--font-sans);
  font-size: var(--text-hero);
  line-height: 1.05;
  letter-spacing: -0.03em;
  color: var(--text-primary);
  margin: 0 0 var(--space-6);
  font-weight: 700;
}

.hero__headline-accent {
  color: var(--accent-text);
  display: inline;
}

.hero__body {
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  line-height: 1.5;
  color: var(--text-muted);
  margin: 0 0 var(--space-4);
  max-width: 36rem;
}

.hero__body strong {
  color: var(--text-primary);
  font-weight: 600;
}
```

(If existing rules differ in property names, replace them; if they have additional rules like responsive breakpoints, preserve those.)

- [ ] **Step 4: Increase vertical breathing room on the hero**

Find the hero section's container styles (likely `.hero` or `.hero__container`) and increase top/bottom padding. If the current value is `padding: var(--space-12) 0` change to `padding: var(--space-24) 0 var(--space-16)`. If on mobile the hero has tighter padding, leave that as-is.

- [ ] **Step 5: De-mono and de-cap the trust strip**

Find:
```astro
<div class="trust-strip" aria-label="Key facts">
  <div class="container trust-strip__inner">
    <span class="trust-stat">{allTools.length} tools</span>
    ...
  </div>
</div>
```

Keep the structure but find the `.trust-stat` rule in the scoped `<style>` and confirm it does NOT use `font-family: var(--font-mono)` or `text-transform: uppercase`. If it does, remove both. The trust strip should read as quiet sans-serif metadata, not a circuit-board readout.

- [ ] **Step 6: Visual check**

Reload the homepage. Confirm:
- Hero headline reads "Tools for your files. *Nothing uploads.*" with the second clause in deeper amber.
- Body copy is conversational and around 18px.
- Surface links read in plain prose, not as code-style chips.
- Trust strip uses sans, no all-caps.
- Scroll hint still works.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/index.astro
git commit -m "feat(web): redesign homepage hero with conversational copy and larger type"
```

---

## Task 10: Homepage redesign — body sections (mono demotion + rhythm)

**Files:**
- Modify: `packages/web/src/pages/index.astro` (sections after the hero, lines ~93–end)
- Modify (if needed): `packages/web/src/components/ScenarioGrid.svelte`, `HowItWorks.svelte`, `InstallCard.svelte` (mono demotion)

- [ ] **Step 1: Read the rest of `index.astro` (lines 93–end)**

Identify each section after the hero: scenarios, how-it-works, install cards, etc. Note their headings and any all-caps mono labels.

- [ ] **Step 2: For each section heading, soften the copy**

Find any pattern like `<h2 class="section-label">SCENARIOS</h2>` or `<span class="eyebrow">INSTALL ANYWHERE</span>` and:
- Remove `text-transform: uppercase` from the corresponding CSS rule.
- Remove `font-family: var(--font-mono)` from the corresponding CSS rule.
- Rewrite the text in sentence case: `Scenarios` becomes `What can you do with Wyreup?`; `INSTALL ANYWHERE` becomes `Use it everywhere`.

Specific copy changes (apply each where it appears):
| Current | New |
|---|---|
| `SCENARIOS` / similar | `What you can do` |
| `HOW IT WORKS` | `How it works` (sentence case only — no copy change) |
| `INSTALL ANYWHERE` | `Take it with you` |
| `STRIP THE FILE. RUN THE TOOL.` | (already removed in Task 9) |
| Tool category labels in mono caps | Plain sans, sentence case |

- [ ] **Step 3: De-mono interior chips and labels**

In each Svelte component (`ScenarioGrid.svelte`, `HowItWorks.svelte`, `InstallCard.svelte`), find any element that uses `font-family: var(--font-mono)` and is NOT one of: the wordmark, a file extension (`.heic`), a CLI command, a tool ID (e.g., `strip-exif` rendered inline as a literal token reference), or chain syntax (`strip-exif → compress`). Remove the mono font; the element inherits sans.

Tool IDs in chain syntax displays *stay* mono because they're literal references to tool identifiers.

- [ ] **Step 4: Increase section spacing**

Find `.section-rhythm` in `global.css` or `index.astro`'s scoped styles. If it uses `margin-top: var(--space-12)` or similar, increase to `var(--space-24)` between marketing sections to support the "one idea per section" rhythm.

- [ ] **Step 5: Visual check — full homepage scroll**

Reload and scroll the homepage end-to-end. Confirm:
- No all-caps mono headings anywhere.
- Section transitions feel airy, not dense.
- Tool IDs (`strip-exif` etc.) inside example chain syntax stay mono.
- File extensions in copy stay mono.
- Plain copy reads sans, sentence case.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/index.astro packages/web/src/components/
git commit -m "feat(web): demote mono and all-caps from homepage body, expand section rhythm"
```

---

## Task 11: /about copy rewrite + layout pass

**Files:**
- Modify: `packages/web/src/pages/about.astro`

- [ ] **Step 1: Read the full file (~362 lines)**

Identify each section. The page covers what Wyreup is, who it's for, the privacy stance, and how it's built.

- [ ] **Step 2: Rewrite headline + intro for warmth**

Find the H1. Replace any technical-feel framing with a sentence-case, conversational version. Concrete change:

If current intro reads like "Wyreup is a privacy-first file tool engine that runs entirely on your device," replace with:

```astro
<h1>Wyreup is for everyone with files.</h1>
<p class="lede">
  Photos that need stripping. PDFs that need merging. Audio that needs cleaning. Video that needs trimming. The kind of small file tasks that show up in everyday life — and the kind that big SaaS tools want you to upload your private data to solve.
</p>
<p class="lede">
  Wyreup runs every tool on your device. Your files never leave your computer. There's no account, no upload, no tracking — just tools that do their job and get out of the way.
</p>
```

(Adjust selectors to match the file's existing class names. Preserve whatever wrapping divs exist.)

- [ ] **Step 3: Reframe the "who it's for" section**

If the page has sections like "Built for Developers" / "Built for Power Users," reframe as "Built for everyone, however you work." Then list the surfaces:
- "If you're at your desk, drop a file in your browser."
- "If you live in the terminal, install the CLI."
- "If you work alongside an AI assistant, install the agent skill."

Use `ul` with three `li` items, each linking to the relevant page (`/`, `/cli`, `/skill`).

- [ ] **Step 4: Apply layout pass**

For each section in the page, ensure:
- Headings are sentence case sans (not mono caps).
- Section spacing uses `var(--space-24)` between major blocks.
- Body type is `var(--text-md)` (16px) or `var(--text-lg)` (18px) for lede paragraphs.

- [ ] **Step 5: Visual check**

Reload `/about`. Read the page top to bottom from a non-technical user's perspective. Confirm the page now answers "what is this and why should I care" in human terms within the first scroll.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/about.astro
git commit -m "feat(web): rewrite /about with conversational voice and 'for everyone' framing"
```

---

## Task 12: /category/[slug] light pass + intro

**Files:**
- Modify: `packages/web/src/pages/category/[slug].astro`

Light treatment per the spec — no full redesign, just add a friendlier top-of-page intro and verify the new tokens render correctly.

- [ ] **Step 1: Read the file**

```bash
wc -l packages/web/src/pages/category/[slug].astro
```

Read the full file.

- [ ] **Step 2: Add or update the category intro**

Find the section at the top of the page that introduces the category (e.g., "Image tools" / "PDF tools"). If it's already a heading + description, soften the copy. If it's missing, add one:

```astro
<header class="category-header">
  <h1 class="category-header__title">{category.name}</h1>
  <p class="category-header__lede">
    {category.tagline}
  </p>
</header>
```

Where `category.tagline` is a one-sentence "what these tools do for you" framing per category. Define the tagline strings inline in the page or pull from `@wyreup/core`'s registry if a similar field exists.

If `tagline` doesn't exist on the category record, add a simple inline map keyed by category id at the top of the script section:

```ts
const categoryTaglines: Record<string, string> = {
  image: 'Edit, convert, and clean up images without uploading them.',
  pdf: 'Merge, split, redact, and reshape PDFs entirely in your browser.',
  audio: 'Trim, transcribe, and enhance audio without sending it anywhere.',
  video: 'Compress, convert, and reformat video on your own machine.',
  text: 'Format, transform, and analyze text and data right here.',
  privacy: 'Strip metadata, encrypt, and protect your files locally.',
  finance: 'Quick math and date tools that run in your browser.',
  create: 'Generate codes, IDs, and snippets without a server round-trip.',
};
```

Use `categoryTaglines[category.id] ?? ''` as the lede value.

- [ ] **Step 3: Visual check on every category**

Visit `/category/image`, `/category/pdf`, `/category/audio`, `/category/video`, `/category/text`, `/category/privacy`, `/category/finance`, `/category/create`. For each: header reads warmly, tool grid renders correctly in light, dark mode still matches baseline.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/category/[slug].astro
git commit -m "feat(web): friendlier category page intros with per-category taglines"
```

---

## Task 13: /cli, /mcp, /skill repaint verification (token-only)

**Files:**
- No file changes expected unless verification surfaces issues.

These pages get the new tokens automatically via the global stylesheet. No layout or copy changes per spec scope. Verify the repaint reads correctly.

- [ ] **Step 1: Visual walkthrough**

Visit `/cli`, `/mcp`, `/skill` in light mode. For each, confirm:
- Background is warm off-white (`--paper`).
- Code blocks (which should be many on these pages) render clearly — light gray background, dark mono text.
- Amber accents (links, highlights) are the deeper amber and read clearly.
- Corner brackets on cards are visible (warm border tone).
- No transparency-on-dark border failures.

- [ ] **Step 2: Compare dark mode against baseline**

Toggle OS to dark, reload. Compare against `/tmp/wave1-baseline-screenshots/cli.png`, `_mcp.png`, `_skill.png`. Differences should be invisible (token reorganization preserved values exactly).

- [ ] **Step 3: If any code-block readability issue surfaces, address it**

Code blocks likely use a darkish background tone. In light mode, this should be `var(--bg-elevated)` (paper-recessed) with `var(--ink)` text. If something hardcodes a dark color, replace with the semantic token.

- [ ] **Step 4: If changes were needed, commit; otherwise skip**

```bash
git status
# If clean, no commit. Otherwise:
git add packages/web/src/pages/cli.astro packages/web/src/pages/mcp.astro packages/web/src/pages/skill.astro
git commit -m "fix(web): code-block tokens for cli/mcp/skill pages in light mode"
```

---

## Task 14: Functional surface "doesn't look broken" sweep

**Files:**
- Modify: any functional surface where verification finds issues.

Per the spec, three high-complexity surfaces require side-by-side screenshot review: `/chain/build`, a tool result panel, `/my-kit`. Other functional surfaces get a manual spot-check.

- [ ] **Step 1: Capture new (light) screenshots**

With the dev server running and OS preference set to **light**:

```bash
mkdir -p /tmp/wave1-new-screenshots
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  for (const url of ['/', '/about', '/cli', '/mcp', '/skill', '/tools', '/chain/build', '/my-kit', '/settings']) {
    await page.goto('http://localhost:4321' + url, { waitUntil: 'networkidle' });
    const safeName = url === '/' ? 'home' : url.replace(/\\//g, '_').replace(/^_/, '');
    await page.screenshot({ path: '/tmp/wave1-new-screenshots/' + safeName + '_light.png', fullPage: true });
  }
  await browser.close();
})();
"
```

- [ ] **Step 2: Capture new (dark) screenshots for regression check**

Same script with `colorScheme: 'dark'`, save to `/tmp/wave1-new-screenshots/` with `_dark.png` suffix. These will be compared against `/tmp/wave1-baseline-screenshots/`.

- [ ] **Step 3: Visual diff dark mode vs. baseline**

For each baseline screenshot in `/tmp/wave1-baseline-screenshots/`, open it and the matching `_dark.png` from `/tmp/wave1-new-screenshots/` side by side (e.g., in macOS Preview). They should be visually identical (within rounding error). Note any differences.

If any difference is visible, root-cause it in the token system and fix before proceeding. The most likely cause: a token primitive value got renamed and a component is referencing a stale name.

- [ ] **Step 4: Light-mode "broken" inspection**

Open `_light.png` for `/chain/build`, the tool index `/tools`, and `/my-kit`. For each, check the spec's "broken" criteria:

1. Any text that's hard to read (likely contrast fail)?
2. Any border that was visible on dark and now invisible?
3. Any element using `mix-blend-mode` or transparency that reads wrong?
4. Hover/focus state perceivable (you'll need to interact with the live site, not the screenshot, for this)?

Fix any issues by updating the offending CSS to use semantic tokens.

- [ ] **Step 5: Live walkthrough of `/chain/build`**

Open `/chain/build` in light mode. Build a chain (drop a tool from the catalog, connect it to another). Confirm:
- The wiring lines and node connectors are visible (they use `--border` and `--accent` already; should work).
- Hover states on tool nodes are clear.
- Drag-and-drop visual feedback is visible (no relying on white/dark contrast invisibly).

- [ ] **Step 6: Live walkthrough of a tool with results panel**

Visit `/tools/strip-exif` (or any tool with a result panel). Drop a file. Confirm:
- The result panel renders correctly in light.
- File-info display (the solder-pad rows) is legible.
- Download button is amber (`--accent` fill, dark text) and reads correctly.

- [ ] **Step 7: Run an automated contrast check**

```bash
npx -y @axe-core/cli http://localhost:4321 \
  --tags wcag2a,wcag2aa,wcag21a,wcag21aa \
  > /tmp/wave1-axe-home.json
npx -y @axe-core/cli http://localhost:4321/tools/strip-exif > /tmp/wave1-axe-tool.json
npx -y @axe-core/cli http://localhost:4321/chain/build > /tmp/wave1-axe-chain.json
```

Parse each output for `color-contrast` violations. For every violation, identify the offending element and fix.

- [ ] **Step 8: Commit any fixes**

```bash
git add packages/web/src/
git commit -m "fix(web): functional surface contrast and visibility fixes for light mode"
```

---

## Task 15: Favicon + PWA icon verification

**Files:**
- Verify and possibly modify: `packages/web/public/favicon.svg`, `apple-touch-icon.png`, `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`, `pwa-monochrome-512.png`, `og-image.svg`, `og-image.png`

The current icons may have been designed against the dark theme. Verify they read on a light browser tab.

- [ ] **Step 1: Inspect favicon.svg**

```bash
cat packages/web/public/favicon.svg
```

Look at the SVG source. If it uses a transparent background (no `fill` on the root or a `viewBox` with no painted backdrop), the icon depends on the browser's tab color — usually white on light mode, dark on dark mode. If the foreground is amber, it'll read on both. If the foreground is white-on-black with a black background rect, it'll look wrong on a light tab.

- [ ] **Step 2: Decide whether to adapt**

Three outcomes:
1. **Already mode-agnostic** (e.g., amber-on-transparent or amber-on-amber-circle): no change needed.
2. **Dark-only** (e.g., amber on a black square): create a new `favicon.svg` that's amber + light-warm background, OR convert to amber-on-transparent so the browser's tab background shows through.
3. **Truly bi-mode** (uses `prefers-color-scheme` inside the SVG via `<style>`): verify the light branch is the warm off-white, not pure white.

If outcome 2, the simplest fix is to remove any background `<rect>` filling the canvas and rely on transparency. The amber wordmark mark / brackets stay.

- [ ] **Step 3: Verify apple-touch-icon.png and PWA icons**

These are PNGs. Open each in macOS Preview or any image viewer:
- `apple-touch-icon.png` — used on iOS home screen. The home screen background is the user's wallpaper, so opaque background is required. The icon's background should be the warm off-white `#FAF7F0` (matches the new theme) OR amber if the design intent is "amber square mark." Decide based on which the design currently is, and either keep or regenerate.
- `pwa-192.png` and `pwa-512.png` — used by Android / desktop PWA. Same logic.
- `pwa-maskable-512.png` — used when the OS clips the icon into a shape. Background must extend to the full canvas.
- `pwa-monochrome-512.png` — used by Android themed icons. Single-color silhouette; should already be mode-agnostic.

If any icon's opaque background is the old `#111113`, regenerate it with `#FAF7F0` background (or amber, depending on design intent). Use a vector source if one exists; otherwise, exporting from a design tool is fastest.

- [ ] **Step 4: Inspect og-image.svg / og-image.png**

These appear in social shares (Twitter, Slack, iMessage, etc.). They're rendered against whatever background the social platform uses (often dark on Twitter, light on iMessage). Confirm legibility on both. If the current og-image is dark-themed and the goal is light-default brand, regenerate to match the new look — this is borderline scope, but worth doing now since the social card is a brand-public asset.

- [ ] **Step 5: Test favicon in browser**

Reload the dev server in light mode, then in dark mode. Look at the browser tab favicon in each. Confirm it reads in both.

- [ ] **Step 6: Commit any changed icons**

```bash
git add packages/web/public/
git commit -m "feat(web): refresh favicon and PWA icons for light-default brand"
```

If no icons needed changing, skip the commit.

---

## Task 16: Final regression and accessibility sweep

**Files:**
- No file changes unless issues surface.

- [ ] **Step 1: Re-run dark-mode visual diff against baseline**

Re-capture dark screenshots (Task 14 step 2) and re-compare against the baseline. Any drift introduced during Tasks 7–15 must be reconciled now.

- [ ] **Step 2: Re-run axe contrast checks**

```bash
npx -y @axe-core/cli http://localhost:4321 > /tmp/wave1-final-home.json
npx -y @axe-core/cli http://localhost:4321/about > /tmp/wave1-final-about.json
npx -y @axe-core/cli http://localhost:4321/category/image > /tmp/wave1-final-cat.json
npx -y @axe-core/cli http://localhost:4321/tools > /tmp/wave1-final-tools.json
npx -y @axe-core/cli http://localhost:4321/chain/build > /tmp/wave1-final-chain.json
```

Confirm zero `color-contrast` violations across all five.

- [ ] **Step 3: PWA install flow smoke test**

In Chrome (desktop or mobile), open the dev server, look for the install prompt (or use Chrome's omnibox install icon). Install. Confirm:
- The PWA splash screen uses the new warm off-white (`background_color: #FAF7F0`).
- The PWA window's title bar tint matches the new theme color.
- The installed app launches into `/tools` per the existing standalone redirect.

- [ ] **Step 4: Share-target flow smoke test**

If on iOS or Android, open Safari/Chrome, share a file from another app to Wyreup. Confirm the share-receive page renders correctly in light mode and in dark mode.

- [ ] **Step 5: Mobile responsive check**

Open the homepage in Chrome DevTools at viewport widths 375 (iPhone SE), 414 (iPhone Plus), 768 (iPad portrait). Confirm:
- Hero copy doesn't overflow.
- Section spacing scales reasonably (the `--space-24` desktop rhythm should compress on small screens — verify it does, or add a media query if it doesn't).

- [ ] **Step 6: Lighthouse run**

```bash
npx -y lighthouse http://localhost:4321 --only-categories=accessibility,performance --chrome-flags="--headless" --output=json --output-path=/tmp/wave1-lighthouse.json
```

Parse the result. Confirm accessibility score is >= the score on `main` (you can re-run on `main` for comparison if you want a baseline). Performance score should not regress materially.

- [ ] **Step 7: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass. If anything fails that wasn't failing on `main`, root-cause and fix.

- [ ] **Step 8: Commit any final fixes**

```bash
git add packages/web/
git commit -m "fix(web): final pre-merge cleanup from accessibility and regression sweep"
```

---

## Task 17: PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/light-mode-wave-1
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(web): light-default theme + marketing redesign (Wave 1)" --body "$(cat <<'EOF'
## Summary

- Light-default token system with auto-dark via `prefers-color-scheme`. Three-token accent system (`--accent` fill, `--accent-text` foreground, `--accent-hover` stroke) split for WCAG AA compliance on warm off-white.
- Marketing redesign on `/`, `/about`, `/category/*`: conversational voice, sentence-case sans, mono restricted to code-like things, larger hero, generous section rhythm.
- "Doesn't look broken" pass on functional surfaces with token-only repaint, side-by-side screenshot verification on `/chain/build`, tool result panel, `/my-kit`.
- PWA manifest + favicon updated for light-default. Mode-aware `theme-color` meta.

## Spec
`docs/superpowers/specs/2026-05-04-light-mode-marketing-redesign-design.md`

## Plan
`docs/superpowers/plans/2026-05-04-light-mode-marketing-redesign-plan.md`

## Test plan
- [ ] Visit `/` in light mode — hero reads "Tools for your files. Nothing uploads." with deeper amber accent.
- [ ] Toggle to dark mode — page matches current production dark visually.
- [ ] Walk through `/about`, `/category/*` — copy reads conversationally; layout has breathing room.
- [ ] Walk through `/cli`, `/mcp`, `/skill` — repaint clean, no copy/layout changes.
- [ ] `/chain/build`, `/my-kit`, a tool result panel — light mode legible, no broken borders, hover/focus visible.
- [ ] Install PWA — splash uses warm off-white.
- [ ] Axe contrast clean on `/`, `/about`, `/tools`, `/chain/build`.
- [ ] All existing tests pass.

## Wave 2
Functional surface redesign starts immediately after this ships. Spec to follow.
EOF
)"
```

- [ ] **Step 3: Verify PR opened, capture URL**

```bash
gh pr view --web
```

(Optional — opens in browser.)

---

## Self-Review Checklist (run before handing off to executor)

The plan author runs this checklist; no subagent dispatch required.

**1. Spec coverage**

Walk through each section of `docs/superpowers/specs/2026-05-04-light-mode-marketing-redesign-design.md` and confirm a task implements it:

| Spec section | Implementing task(s) |
|---|---|
| Visual language — background, surfaces, text | Task 1 |
| Visual language — accent (3-token split) | Task 1, Task 8 |
| Visual language — type system | Task 1 (token), Task 9 (hero), Task 10 (body) |
| Visual language — motifs (corner brackets softened) | Task 6 |
| Visual language — density | Task 9, Task 10, Task 11 |
| Visual language — elevation (shadow tokens) | Task 1, Task 7 |
| Editorial — voice shift | Task 9, Task 10, Task 11 |
| Editorial — frame user's problem first | Task 9, Task 11 |
| Editorial — grade 7 reading level | Task 9, Task 11 |
| Editorial — privacy framing | Task 9, Task 11 |
| Editorial — tool naming (IDs stay, copy softens) | Task 9, Task 10, Task 11 |
| Layout strategy — hero, one idea per section, show-then-tell | Task 9, Task 10 |
| Per-surface scope — `/` full | Task 9, Task 10 |
| Per-surface scope — `/about` rewrite + layout | Task 11 |
| Per-surface scope — `/category/*` light | Task 12 |
| Per-surface scope — `/cli`, `/mcp`, `/skill` repaint only | Task 13 |
| Per-surface scope — functional "doesn't look broken" | Task 14 |
| Token system architecture (3 layers) | Task 1 |
| Auto-dark via prefers-color-scheme | Task 1 |
| Mode-aware accent | Task 1, Task 8 |
| Done — token system | Task 1 |
| Done — marketing redesign acceptance | Tasks 9–12 |
| Done — repaint-only acceptance | Task 13 |
| Done — functional surfaces (concrete "broken" criteria) | Task 14 |
| Done — wordmark + brackets render correctly | Task 6, Task 9 |
| Done — semantic accent token usage everywhere | Task 8 |
| Done — favicon + PWA icons | Task 15 |
| Done — JS theme audit | Task 4 |
| Done — no regressions | Task 14, Task 16 |
| Risk — fine-but-not-great | Task 14 (defines "broken," surfaces requiring pause) |
| Risk — amber tuning | Task 1 (note in token comments), Task 16 (re-verify if retuned) |
| Risk — copy quality | Task 9, 10, 11 (each has visual check from non-tech reader pov) |
| Risk — dark-mode regression | Task 0 (baseline), Task 14, Task 16 (final diff) |
| Risk — Wave 2 shortcuts | All tasks use semantic tokens, no surface-specific patches |
| Risk — hairline borders | Task 5 |
| Wave 2 cadence | Spec; not implemented here |

No gaps identified.

**2. Placeholder scan**

No "TBD", "TODO", "implement later," "fill in details," or "similar to Task N" patterns appear in tasks. Every code change shows the actual code. Every command shows the expected output or the verification step.

One potential exception: Task 12 says "If `tagline` doesn't exist on the category record, add a simple inline map" — this is contingent guidance, not a placeholder. The map is fully specified inline.

**3. Type / name consistency**

- Token names (`--paper`, `--ink`, `--accent`, `--accent-text`, `--accent-hover`, `--shadow-sm/md/lg`) are used identically across Tasks 1, 6, 7, 8, 9, 10, 11, 12, 13.
- Class names referenced (`.btn-primary`, `.skip-link`, `.anywhere-card`, `.surface-welcome`, `.brackets`, `.hero__headline`, `.hero__body`, `.hero__surfaces`, `.hero__actions`, `.trust-strip`) match the existing codebase as inspected during planning.
- File paths (`packages/web/src/styles/tokens.css`, `packages/web/src/styles/global.css`, `packages/web/src/styles/motifs.css`, `packages/web/src/layouts/BaseLayout.astro`, `packages/web/src/pages/index.astro`, `packages/web/src/pages/about.astro`, `packages/web/src/pages/category/[slug].astro`, `packages/web/astro.config.mjs`, `packages/web/public/...`) are consistent across all tasks.
- The Playwright capture script in Task 0 and Task 14 use the same surface list.

No inconsistencies found.
