# TinyWow Discovery UX Research

Studied: tinywow.com, 2026-04-17

## What we observed and borrowed

**1. Always-visible search in the global header**
TinyWow puts a search input directly in the sticky nav bar, reachable from any page without navigating to /tools first. CMD+K is also wired as a focus shortcut. We adopted this: a persistent header search input, CMD+K focus, navigates to /tools?q= on Enter, and shows a live dropdown of up to 8 matching tools.

**2. Per-category landing pages with SEO copy**
TinyWow has dedicated /pdf-tools, /image-tools etc. pages with a short paragraph of copy explaining the use case before the tool grid. These pages rank independently in search. We adopted this as /category/[slug] pages with hand-written 60-120 word introductions per category, a tool grid, and related-categories footer. 14 new pages, each a keyword-targeted landing.

**3. Curated "popular tools" section on the homepage**
TinyWow surfaces an "Our Most Popular Tools" section above the full catalog — hand-curated, not analytics-driven. The section is on the value/marketing surface of the homepage, not inside the catalog. We adopted this as a hand-curated 8-tool grid between the chain demo and privacy sections.

**4. "Related tools" cross-linking on per-tool pages**
TinyWow pages link to related tools at the bottom of every tool page. We adopted this as a "Related tools" footer showing 4-6 tools from the same category plus 2-3 tools that share the same output MIME type (natural chain next-steps), computed at build time from the registry.

**5. Recently-used list for returning users**
TinyWow tracks recently-used tools (with account/cookies). We adopted the pattern without tracking: a localStorage-backed strip at the top of /tools showing the last 10 visited tool pages, with a Clear button. No analytics, works offline.

## What we did not adopt

- TinyWow's "My Files" cloud storage (no server, no account)
- Trending/analytics-driven sections (no tracking principle)
- Light mode toggle (Signal is dark-only at v1)
- Nested dropdown nav menus (not needed at 117 tools)
- Upgrade/premium messaging (Wyreup is free and open source)
