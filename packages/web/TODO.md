# Web Package — Deferred Polish Items

Items identified in the 2026-04-17 design audit that were not fixed (P2/P3).
All P0 and P1 items have been resolved. See commit history for what changed.

---

## P2 — Polish

**Install Lucide package for true icon imports**
The tool card icons are currently inline SVG strings defined per-file
(`index.astro` and `ToolFilter.svelte`). This duplicates the icon data and
makes updates fragile. Install `lucide-svelte` (or `@lucide/astro`) and replace
the inline SVG strings with proper component imports. Icon-to-category mapping
lives in two places right now; should be one shared source of truth.

**Tool card `aria-label` is just the name**
`aria-label="{tool.name} — {tool.category}"` in ToolFilter is an improvement
but the homepage featured cards still use `aria-label={tool.name}` only. When
screen readers land on the card, there is no category context in the label.
Consider including category: `aria-label="{tool.name} ({tool.category})"`.

**`results-count` has no motif treatment**
The "52 tools" count above the grid on `/tools` is plain text with no
solder-stat or solder-row motif. The homepage stats section uses the solder-stat
pattern; the tools page count should match for consistency.

**Hard-coded "52" in hero and "View all 52 tools" CTA**
`index.astro` hard-codes the count in two places. If the tool registry grows,
both strings drift silently. Fix: import `createDefaultRegistry` in
`index.astro` and derive the count the same way `tools.astro` does.

**Search input width cap at 360px feels narrow at large viewports**
At 1920px the filter search input is pinned to `max-width: 360px`. Consider
letting it grow to `max-width: 480px` at wide viewports to fill the visual
weight of the 4-column grid above it.

**Footer solder-pad direction**
The footer `footer-rule` has a line that terminates in a solder pad on the
right side only. Per DESIGN.md §9, solder-pad terminators cap both ends with a
filled square. The footer currently has: `[line] ■` — consider: `■ [line] ■`.
Low visual impact but improves spec fidelity.

---

## P3 — Nits

**`wordmark` hover has no transition on initial render**
The `transition` on `.wordmark` is defined inside the `:hover` rule rather than
on the element itself, so on first hover there is no transition in — it snaps,
then transitions back. Move the transition declaration to the base `.wordmark`
rule.

**`filter-chip` label text for "pdf" renders as "PDF" but chip shows "PDF"**
Categories are uppercased via CSS `text-transform: uppercase`. The rendered
chip text is correct but the DOM value is lowercase "pdf" — fine, but worth
noting if you ever need to use the chip label for display elsewhere.

**`clear-btn` and `btn-ghost` in ToolFilter have no `focus-visible` ring**
`clear-btn` has no `:focus-visible` style. It should match the system focus
ring: `outline: 2px solid var(--accent); outline-offset: 2px`.

**Hero h1 "Zero signup" reads as marketing on close reading**
"Zero signup" is a product value claim, not a data point. The voice rules say
"the interface is silent about product values and loud about data." Consider
"No account required." (still a value claim but more factual in register) or
trim to "52 tools." — but this is subjective and the current phrasing is mild.
User should decide.
