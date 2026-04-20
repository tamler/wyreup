# Wyreup Design System
## Signal — Visual Identity Reference

Version 1.3 | Dark-only at launch | Last updated: 2026-04-19

---

## 1. Principles

**Signal over noise.** Every visual element earns its place by conveying information or reinforcing trust. Decoration that does not carry meaning is removed.

**Engineering trust.** The interface looks like it was built by engineers, for engineers. Monospace type, hairline borders, precise spacing — the visual language of a tool that respects the user's intelligence.

**Restraint is the brand.** One accent color. One primary typeface. No gradients, no blur, no shadows on flat surfaces. Constraint is the aesthetic.

**The metaphor is structural.** "Wire up" is not a logo treatment — it is the product's information architecture. Wires connect nodes. Circuits have signal paths. Every UI pattern should be expressible in those terms.

**Density is a feature.** Power users want information-rich interfaces. Generous whitespace is a consumer pattern. Wyreup presents data at density, with clear hierarchy enforced by type weight and color — not padding.

**Homepage is value-first. Tool pages are task-first.** The density principle above applies to task-first surfaces: `/tools` catalog, per-tool pages, chain builder. The homepage is a value surface — the job is to answer "What is this? Why should I care? What can I do right now?" in the first viewport. That means generous breathing room, narrative over metadata, and concrete scenarios over tool names. Signal's restraint is preserved through typography, palette, and motifs; not through cramming.

---

## 2. Color System

### Primitive Palette

```
--black:        #0A0A0A   true black for extreme contrast (text on accent)
--gray-950:     #111113   near-black, primary background
--gray-900:     #18181B   elevated surfaces
--gray-800:     #27272A   cards, panels
--gray-700:     #3F3F46   borders, dividers
--gray-600:     #52525B   disabled states
--gray-400:     #A1A1AA   muted text
--gray-200:     #E4E4E7   subtle text (rare)
--gray-100:     #F4F4F5   off-white (light mode placeholder only)

--amber-500:    #FFB000   accent — signal amber
--amber-400:    #FFC233   accent hover (lighter, warmer)
--amber-900:    #2D1F00   accent dim (for backgrounds behind amber text)

--green-500:    #22C55E   success
--yellow-500:   #EAB308   warning
--red-500:      #EF4444   danger / error
```

**Accent rationale:** Terminal amber (#FFB000). Not phosphor green — that reads as retro affectation. Not red — danger association. Amber is the color of a signal LED in active state: warm, precise, industrial. It sits on near-black with contrast ratio > 7:1. One accent. No exceptions.

### Semantic Tokens

```
--bg:               #111113   (gray-950) — page background
--bg-elevated:      #18181B   (gray-900) — cards, sidebars, modals
--bg-raised:        #27272A   (gray-800) — nested panels, hover states
--border:           #3F3F46   (gray-700) — all borders at 1px
--border-subtle:    #27272A   (gray-800) — inset borders, table rules
--text-primary:     #F4F4F5   (gray-100) — headings, labels, primary content
--text-muted:       #A1A1AA   (gray-400) — supporting text, metadata
--text-subtle:      #52525B   (gray-600) — placeholders, disabled
--accent:           #FFB000   (amber-500) — CTAs, active states, key data
--accent-hover:     #FFC233   (amber-400) — hover on accent elements
--accent-dim:       #2D1F00   (amber-900) — background tint for accent regions
--success:          #22C55E   (green-500)
--warning:          #EAB308   (yellow-500)
--danger:           #EF4444   (red-500)
```

### Dark-Only at Launch

Wyreup ships dark-only. Light mode is a v2 concern. The Signal aesthetic depends on near-black backgrounds — a light inversion risks the entire identity. When light mode ships, it uses the same token names mapped to inverted primitives; the component layer does not change.

---

## 3. Typography

> **Evolution note — v1.1 (2026-04-19):** Transitioned from mono-only to hybrid Sans/Mono system after implementation showed mono body text creates fatigue over long reads. Signal's engineering feel is preserved through mono labels and data while Sans carries narrative.

### Typeface Decisions

**Display + body:** Geist Sans (Apache-2.0, self-hosted, weights 400/500/600/700). Clean, contemporary sans-serif by Vercel — shares DNA with Geist Mono so the two faces read as a system, not a mismatch.

**Labels, buttons, data metrics, code, tool IDs:** Geist Mono (unchanged, self-hosted). This is the identity accent of the product. Mono type signals "this is data, not copy." It stays wherever information density and precision matter.

**No third typeface.** Sans for narrative, Mono for data. Two faces, clear rule, no exceptions.

### Which Elements Use Which Font

**Geist Sans:** `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `p`, `li`, `a` (in prose body), section headings, hero headline, privacy copy.

**Geist Mono:** `.btn`, `button`, `code`, `kbd`, `pre`, `.badge`, `.tool-id`, `.metric`, `.category-tag`, `.solder-stat`, `.solder-stat__text`, `.solder-stat__value`, filter chips, filter search input, nav links (wordmark + category links), results count, clear button. Any element that displays system output, a data value, or a control label.

**Token references:** `--font-sans` and `--font-mono` (defined in tokens.css). Never hardcode `'Geist Mono'` or `'Geist Sans'` in component styles — use the tokens.

### Type Scale

```
--text-xs:    0.625rem   (10px)  captions, timestamps, secondary metadata
--text-sm:    0.75rem    (12px)  table data, form labels, badge text
--text-base:  0.875rem   (14px)  body copy, UI labels, nav items
--text-md:    1rem       (16px)  card titles, section headers
--text-lg:    1.125rem   (18px)  panel headings, modal titles
--text-xl:    1.375rem   (22px)  page headings (h2)
--text-2xl:   1.75rem    (28px)  section titles (h1 in tool pages)
--text-hero:  2.75rem    (44px)  homepage hero only
```

Eight steps. --text-hero is used in exactly one place: the homepage h1. Every other heading falls within --text-xl or below.

### Weight Scale

```
400   regular   — body, metadata, secondary labels (Sans + Mono)
500   medium    — nav items, card titles, emphasized labels (Sans + Mono)
600   semibold  — subheadings, strong UI labels (Sans only)
700   bold      — primary headings h1/h2, CTAs (Sans + Mono)
```

Four weights available; 500 is the workhorse. 600 is available for Sans subheadings where 700 reads too heavy and 500 reads too light.

### Line-Height Rules

```
display (--text-2xl and above):  line-height: 1.1   tight, billboard
headings (--text-lg to --text-xl): line-height: 1.25
body (--text-base):              line-height: 1.6   readable
small (--text-sm, --text-xs):   line-height: 1.4   compact but clear
```

### Letter-Spacing Rules

```
display / hero:      letter-spacing: -0.03em   pulls tight, high-authority
headings:            letter-spacing: -0.01em
body:                letter-spacing: 0          no adjustment
labels / uppercase:  letter-spacing: 0.08em    caps need to breathe
mono data output:    letter-spacing: 0          monospace is already spaced
```

Uppercase labels (status badges, category tags) always use `letter-spacing: 0.08em`. They read as system output, not shouting.

---

## 4. Spacing + Grid

### Spacing Scale

```
--space-1:   0.25rem    (4px)
--space-2:   0.5rem     (8px)
--space-3:   0.75rem    (12px)
--space-4:   1rem       (16px)
--space-6:   1.5rem     (24px)
--space-8:   2rem       (32px)
--space-12:  3rem       (48px)
--space-16:  4rem       (64px)
```

8-step scale. The gap between --space-8 and --space-12 is intentional — large jumps distinguish section-level spacing from component-level spacing.

### Grid

```
Max-width container:  1200px
Column structure:     12 columns
Gutter (column gap):  24px (--space-6)
Horizontal padding:   32px (--space-8) on container edges
Breakpoints:
  mobile:    < 640px   — 1 column, 16px gutters
  tablet:    640–1024px — 6-column, 20px gutters
  desktop:   > 1024px  — 12-column, 24px gutters
```

### Layout Density Target

Dense. The tools grid shows 3–4 cards per row at desktop. Table rows are 36–40px tall. Input heights are 32–36px. Padding inside cards is --space-4 (16px), not --space-8. This is not a landing page — it is a tool dashboard.

### Section rhythm (homepage)

**The homepage uses viewport-rhythm**: each major section is sized to ~100vh (clamped to a sane floor and ceiling — `min-height: clamp(640px, 90vh, 960px)`) so that only one section fully occupies the viewport at a time. Each section's next neighbor peeks into the bottom of the viewport — the next section's heading (or a thin scroll affordance) should be visible at the fold, signaling "more below."

This rhythm applies ONLY to the homepage's value surfaces. The `/tools` catalog, per-tool pages, and chain builder use normal flow: content sized to itself, with the section rhythm discarded.

Implementation: each hero-equivalent section uses `min-height: clamp(...)` + `display: flex; flex-direction: column; justify-content: flex-start; padding-block-end: 64-96px` so there's a deliberate gap between the section's content and the fold. The next section's header peeks into view either via a hairline scroll indicator or via a carefully-sized `padding-block` that pulls its heading to roughly 90% of the fold.

---

## 5. Radius + Borders

### Radius Scale

```
--radius-none:  0
--radius-sm:    2px    hairline curves — inputs, inline badges
--radius-md:    4px    cards, panels, buttons
--radius-lg:    6px    modals, dropdowns
```

Default component radius is --radius-md (4px). Nothing uses --radius-lg unless it floats above the page (modal, popover). Nothing uses values above 6px. Signal is not a rounded aesthetic — corners are nearly square.

### Border Rules

```
Weight:  1px always. No 2px borders except focus rings (2px).
Color:   --border (#3F3F46) is the default.
         --border-subtle (#27272A) for nested inset borders.
Inset:   Prefer box-shadow: inset 0 0 0 1px var(--border) over border property
         on elements where layout shift is a concern.
```

Focus ring: 2px solid --accent, offset 2px. Not a glow, not a blur — a clean amber rectangle.

---

## 6. Motion

### Philosophy

Signal motion is mechanical, not organic. A relay closing. A switch toggling. Precise onset, abrupt stop. No spring physics. No easing that suggests weight or momentum. No decorative animation.

### Duration Tokens

```
--duration-instant:  100ms   tooltip appearance, toggle state change
--duration-fast:     150ms   button press feedback, checkbox, small reveal
--duration-base:     200ms   dropdown open, tab switch, panel slide
--duration-slow:     300ms   modal enter, full-page transition
```

Nothing above 300ms. If a transition feels slow, cut the duration — do not add easing curves to compensate.

### Easing Tokens

```
--ease-sharp:    cubic-bezier(0.25, 0, 0, 1)     standard UI — sharp out
--ease-out:      cubic-bezier(0, 0, 0.2, 1)       elements entering viewport
--ease-in:       cubic-bezier(0.4, 0, 1, 1)       elements exiting (dismiss)
--ease-linear:   linear                            progress bars, spinners
```

No ease-in-out. It implies indecision at both ends. Signal enters sharp, exits faster.

### What Animates

```
Animate:
  - Opacity transitions on show/hide (fast, 150ms)
  - Transform: translateY on dropdown/modal entry (8px slide, 200ms)
  - Color transitions on hover/active states (100ms)
  - Progress bar fill (linear, real-time)
  - Focus ring appearance (instant, 100ms)

Do not animate:
  - Layout (width, height, grid changes)
  - Page-level content reflow
  - Decorative elements (connectors, wire motifs)
  - Loading skeletons (static, not pulsing)
```

Loading skeletons are static — a static mid-gray block. No shimmer, no pulse. The terminal cursor blinks at 1s interval (CSS animation only, 50% duty cycle). That is the only looping animation in the system.

---

## 7. Elevation + Shadows

Signal is flat. Depth comes from background color shifts and borders, not drop shadows.

```
Level 0 — page:         --bg (#111113), no shadow
Level 1 — raised:       --bg-elevated (#18181B) + 1px --border
Level 2 — float:        --bg-elevated (#18181B) + 1px --border
                        + box-shadow: 0 4px 16px rgba(0,0,0,0.5)
```

Level 2 is used only for modals and popovers. The shadow is heavy (0.5 alpha black) because it needs contrast against --bg. Avoid drop shadows on cards and panels — use the background shift from Level 0 to Level 1.

---

## 8. Iconography

**Library:** Lucide Icons. 1.5px stroke weight, squared line caps, geometric construction. Available as individual SVG imports — zero bundle-weight overhead.

**Sizing scale:**
```
14px  — inline with --text-sm labels, badge icons
16px  — default inline icon, nav icons, button icons
20px  — card-level icons, tool category headers
24px  — hero/empty state icons
```

Icons are always --text-muted (#A1A1AA) unless they are interactive or carry semantic meaning (then they use the semantic color: --accent, --success, --danger). Never use icon color to decorate.

Stroke weight stays 1.5px across all sizes. Do not use filled icon variants.

---

## 9. Visual Motifs

Three signature motifs compose the Wyreup wire language. Each is a reusable atom, not a one-off illustration.

### Motif 1: Corner Brackets

Terminal-UI framing applied to cards and panels. Four right-angle L-shapes at the corners of an element, inset 4px from the edge. Each bracket arm is 8px long, 1px thick, --border color.

```
 ┌─ · · · · · · · · ─┐
 │                    │
 │   card content     │
 │                    │
 └─ · · · · · · · · ─┘
     ↑ bracket arms: 8px each side
```

Applied to: tool result panels, featured tool cards, the chain-builder canvas. Not applied to every card — used for emphasis on the primary content area of a view. The bracket sits outside the card border, rendered via CSS `::before`/`::after` pseudo-elements so it does not affect layout.

### Motif 2: Solder Pad Terminators

Hairline horizontal rules that terminate in a 3×3px filled square at both ends. Used as section dividers and to connect related metadata to a data point.

```
  Processing time  ─────────────────────■  0.4s
  Output format    ─────────────────────■  PNG
  Original size    ─────────────────────■  4.2 MB
```

The square is --border (#3F3F46) by default. On active/selected rows, the square becomes --accent (#FFB000). This motif replaces traditional table formatting in the tool result panel — it reads as a circuit board readout.

### Motif 3: Node Connector Dots

For the chain-builder and any UI showing tool-to-tool connections: circular nodes (5px diameter, 1px --border stroke, --bg-elevated fill) at connection points, connected by 1px --border lines. When a connection is live/active, the node fills --accent and the line becomes 1px --accent.

```
 [Image Compress] ○────────────○ [PDF Pack]
                  ↑            ↑
               output        input
               node          node
```

At rest: hollow nodes, --border lines. Active: --accent fill nodes, --accent lines with no glow or blur. The transition is instant (100ms). This motif is the visual language of the product's core promise — wiring tools together.

---

## 10. Component Patterns

### Button

**Anatomy:** Label only (or icon + label). No decorative icon-only buttons except in toolbars with tooltips. Height: 32px. Horizontal padding: 12px. Font: --text-base, weight 500.

**Primary:** Background --accent (#FFB000), text --black (#0A0A0A), radius --radius-md. Hover: --accent-hover background. Active: scale(0.98) transform, 100ms. No box-shadow.

**Secondary:** Background transparent, border 1px --border, text --text-primary. Hover: background --bg-raised, border --text-muted. Active: scale(0.98).

**Ghost:** No background, no border, text --text-muted. Hover: text --text-primary. Used for tertiary actions (cancel, dismiss) and icon buttons in dense toolbars.

**Do:** Sentence case labels. Specific verbs ("Compress", "Download result", "Copy"). Match label to the action completing, not starting ("Compressing..." during processing).
**Don't:** "Submit", "Click here", "Go". All-caps labels. Icon-only primary buttons.

---

### Input / File Drop Zone

**Text input anatomy:** Height 32px, 1px --border, radius --radius-sm, background --bg-elevated, text --text-primary at --text-base. Placeholder: --text-subtle. Focus ring: 2px --accent, offset 2px.

**File drop zone anatomy:**
```
 ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
 |                              |  dashed 1px --border
 |   [upload icon 20px]         |  dash pattern: 4px dash, 4px gap
 |   Drop file or click to      |  background: --bg-elevated
 |   browse                     |  min-height: 120px
 |                              |
 └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```

Drag-active state: border changes from dashed --border to solid 1px --accent, background --accent-dim. No scale animation, no glow.

File accepted state: border solid --success, small checkmark + filename replaces the drop prompt. No celebration animation.

**Don't:** Drag-in animations that scale the dropzone. "Drop your file here!" copy. Multiple nested drop zones on one page.

---

### Card (Tool Card on /tools Grid)

**Anatomy:**
```
 ┌────────────────────────────┐
 │ [icon 20px]  Tool Name     │  header row: --text-md weight 500
 │              category tag  │  tag: uppercase --text-xs --text-muted
 ├────────────────────────────┤  1px --border-subtle
 │ One-sentence description   │  --text-sm --text-muted, 2 lines max
 │ of what this tool does.    │
 └────────────────────────────┘
```

Background: --bg-elevated. Border: 1px --border. Radius: --radius-md. Padding: 16px. No shadow.

Hover state: border shifts to --text-muted (#A1A1AA), background shifts to --bg-raised. The icon color shifts to --accent. Transition: 150ms --ease-sharp. No lift, no shadow.

Category tag: uppercase, --text-xs, letter-spacing 0.08em, --text-muted. Not a pill badge — plain text.

**Do:** Keep description to one declarative sentence. Show category tag.
**Don't:** Show a preview image. Add hover animations beyond border/bg shift. Use card-level CTAs.

---

### Navigation

**Structure:** Top bar, full-width, --bg (#111113), 1px --border bottom. Height: 48px. Left: wordmark ("Wyreup" in Geist Mono 500 weight, --text-md, --text-primary). Center: tool category nav links. Right: GitHub link (ghost icon button).

**Category nav links:** --text-sm, weight 500, --text-muted. Active: --text-primary with 2px --accent underline (not full-width — matches text width only). Hover: --text-primary, no underline. No dropdown menus at launch.

**Mobile:** Wordmark left, hamburger ghost button right. Drawer slides in from left over 200ms --ease-out. Categories stacked as --text-base links, 48px touch targets.

**Don't:** Sticky nav with backdrop blur. Colored nav backgrounds. Active state as colored background pill.

---

### Tool Result Panel

The primary output surface. Appears below the tool inputs after processing completes.

**Anatomy:**
```
 RESULT                         0.4s          ← uppercase label, --text-xs
 ─────────────────────────────────────────────
  Original     ─────────────────────■  4.2 MB
  Compressed   ─────────────────────■  312 KB
  Reduction    ─────────────────────■  92.6%   ← --accent color
 ─────────────────────────────────────────────
 [Download result]  [Copy path]                ← secondary + ghost buttons
```

Corner bracket motif applied to this panel. Solder pad terminator rows for key metrics. The reduction/primary metric value renders in --accent. All other values in --text-primary.

Background: --bg-elevated. Border: 1px --border. Padding: 16px.

**Don't:** Animate the result in with a dramatic entrance. Show a success toast in addition to this panel. Use checkmarks or celebration icons.

---

### Empty State

Used when a tool category has no tools matching a filter, or a tool history is empty.

**Anatomy:**
```
       [Lucide icon 24px, --text-subtle]

       No tools match this filter.
       [--text-muted, --text-sm, centered]

       Clear filter              ← ghost button, only if action exists
```

No illustrations. No large hero text. Centered vertically in its container. Maximum 2 lines of copy. Action only appears if there is a concrete recoverable action.

**Don't:** Full-page empty states for filtering. Animated illustrations. "Nothing here yet!" copy.

---

### Loading State

Two patterns:

**Inline / button loading:** Button label changes to "Processing..." with a blinking terminal cursor appended. Cursor: `_` character, blinks at 1s interval (CSS animation, 50% duty cycle). Button is disabled, secondary style during processing.

**Full tool result loading:**
```
 Processing
 ─────────────────────────────────────────────
  [████████████░░░░░░░░░░░░░░░░░░]  68%        ← --accent fill, 1px --border bar
 ─────────────────────────────────────────────
  Analyzing image data_
```

Progress bar: 4px height, --bg-raised track, --accent fill. No animation on the fill — it moves in real increments driven by actual progress. The status line below updates with precise technical description of the current step. Cursor blink on status line.

**Don't:** Spinner animations. Bouncing dots. Indeterminate bars that animate when no real progress data exists (show the cursor pattern instead). "Almost there!" copy.

---

### Error State

```
 ERROR                                         ← uppercase --text-xs --danger
 ─────────────────────────────────────────────
  File exceeds 50 MB limit. Input must be
  a valid JPEG, PNG, or WebP.                  ← --text-sm --text-muted
 ─────────────────────────────────────────────
 [Try again]                                   ← secondary button
```

Error panel replaces the result panel. Same dimensions and border treatment. Border color shifts to 1px --danger. No modal, no toast. Error message is a complete sentence: what went wrong and what the constraint is.

**Don't:** "Oops!", "Something went wrong", "Unexpected error". Errors that do not tell the user what to do next. Error toasts that auto-dismiss.

---

## 11. Voice + Microcopy

### Tone

Terse. Technically precise. Present tense or past tense for completed actions — never future tense for things already done. No exclamation marks in the product UI. No first-person ("We compressed your file") — the tool acts, not the company.

### Rules

**Button labels:** Imperative verb + object. "Compress image", "Convert to PDF", "Copy result". Never "Submit" or "Continue".

**Processing labels:** Present participle + object. "Compressing...", "Extracting text...", "Generating QR code..."

**Error messages:** State the constraint, not the failure. "File must be under 50 MB." not "Upload failed."

**Empty states:** Declarative. "No tools match this filter." not "We couldn't find anything!"

**Success / result states:** State the outcome with data. Never congratulate the user.

**Metadata and labels:** Omit articles. "Output format" not "The output format". "Compression ratio" not "Your compression ratio".

### Microcopy Examples

```
Result ready.
4.2 MB → 312 KB — 92.6% smaller.

Extracting text from 14 pages.

Output copied to clipboard.

PDF split into 6 files.

No tools in this category match "resi".

File must be a valid JPEG, PNG, or WebP. Received: .bmp

QR code generated. 256×256px, PNG.

Drop a file to get started — or click to browse.
```

---

## 12. What Signal Is Not

**No gradients.** Backgrounds are flat. The only permitted gradient is a single 1-stop transparency fade on overflowing content (e.g., text fading to --bg at a truncation edge). No color-to-color gradients, no mesh gradients, no aurora effects.

**No blur.** No backdrop-filter: blur. No frosted glass. No translucent panels. Every surface has an opaque, defined background.

**No oversized rounded corners.** Maximum 6px (--radius-lg), used only on floating elements. No pill buttons. No rounded cards.

**No playful illustrations.** No isometric scenes, no character illustrations, no blob shapes, no abstract SVG backgrounds.

**No emoji in UI.** The product is not writing text messages. Status is communicated by color, text, and icon — not glyphs.

**No hero sections with gradients, blurs, or decorative backgrounds.** The homepage IS a value surface with a clear hero — just without the AI-SaaS visual idioms (gradient auras, floating blob shapes, mesh backgrounds, hero CTAs layered over blurred screenshots). Flat color, solid type, real content.

**No shadows on flat surfaces.** Cards do not have drop shadows. Only modals and popovers (Level 2 elevation) use shadows.

**No bouncing or spring-physics animation.** No cubic-bezier values with overshoot (y > 1 or y < 0). No Lottie animations.

**No "lorem ipsum" content density.** Placeholder states show real structural content — category names, example tool names — not generic placeholder copy.

**No marketing language in the UI.** "Privacy-first" and "free forever" live on the landing page, not in the tool interface. Inside the tool, the interface is silent about the product's values and loud about the data.

---

## Appendix: Wire Motif Reference

A quick-reference for developers implementing the three signature motifs.

### Corner Bracket Implementation

```
Four L-shapes at card corners, each with:
  - arm length: 8px
  - stroke weight: 1px
  - color: --border
  - inset from card edge: 4px
  - positioned outside card border via absolute positioning

Activation (result panel only):
  - color shifts to --border-subtle (passive) or --accent (active result)
```

### Solder Pad Terminator Row

```
Row anatomy (single line):
  [label]  [spacer dots/rule]  ■  [value]

  label:    --text-sm, --text-muted, weight 400
  rule:     flex-grow, 1px bottom border --border-subtle
  square:   3×3px, fill --border, margin-left 8px
  value:    --text-sm, --text-primary, weight 500, margin-left 8px

  Active/highlighted row:
    square fill → --accent
    value color → --accent
```

### Node Connector

```
Node (connection point):
  - diameter: 5px
  - border: 1px --border
  - fill: --bg-elevated

Connector line:
  - height: 1px
  - color: --border

Active state:
  - node fill: --accent
  - node border: --accent
  - line color: --accent
  - transition: instant (100ms)

Label above node (optional):
  - --text-xs, --text-subtle, letter-spacing 0.08em, uppercase
  - centered on node x-position
```
