# Web repositioning — implementation spec (2026-07-13)

Delegation contract for the approved repositioning program. Thesis: **do not
narrow Wyreup's capabilities; narrow the amount a new visitor must understand.**
The web surface sells completed file-jobs in consumer language; chains, triggers,
CLI, MCP, and the PWA remain fully available but become the expansion path shown
after a successful workflow. Voice rule: simple for mom, capable for engineers
(DESIGN.md §11 voice still applies: terse, outcomes with data, no exclamation
marks).

## Standing decisions (do not re-litigate)

- Keep the word **"chains"** — framed as "a chain of actions". No "recipes" rename.
- **Local-first persistence stays canonical** for saved chains (localStorage +
  export/import JSON + share URLs). No plaintext D1 chain sync ever; the dormant
  `saved_chains` table stays unused. If demand justifies sync later, it is the
  Pro email+key identity with an E2E-encrypted blob (passphrase-derived key) in
  R2, D1 metadata only.
- Pro merchandising is contextual and gentle: adjacent to results, never
  interrupting, one honest seam, concrete value copy with credits + approximate
  dollar cost.
- The 15 internal `ToolCategory` values are load-bearing and do not change; the
  consumer layer is additive (`packages/web/src/data/jobs.ts`).
- Pricing pack data gets a single source before any new surface repeats it
  (today duplicated in `pro.astro:28–32` and the index PRO callout).
- Naming rule going forward: "Pro"/"-pro" in a tool name/id is reserved for
  hosted credit tools. (Existing collision: free on-device `ocr-pro` vs hosted
  `ocr-hq` — rename plan lands in Phase 4.)

## Already true in code (verified 2026-07-13 — do not rebuild)

- Per-tool privacy callout branches honestly on `cost === 'credit'`
  (`packages/web/src/pages/tools/[slug].astro:261–279`); all 30 credit tools'
  SEO prose verified honest. The false claims are the site-wide blanket ones
  (Phase 0b list).
- `compress` keeps the original on same-format inflation
  (`packages/core/src/tools/compress/index.ts:91–103`); web UI cannot request a
  format change. Gaps: `pdf-compress`, `compress-video`,
  `compress-image-to-size` have no guard; `PreviewRunner.svelte` shows no size
  Change/warning row (SimpleImageRunner does, lines 204–216).
- Nav already says "Saved chains"; chain-builder picker is a custom
  MIME-filtered combobox (gap: substring match — upgrade to Fuse
  `lib/tool-search.ts`); `saveChain` CRUD exists in `toolbeltStorage.ts` (gap:
  the ad-hoc tool→tool hop path never offers saving); `chainSuggestions:
  string[]` exists on ToolModule (gap: mostly unpopulated);
  `ScenarioGrid.svelte` already holds 8 outcome-phrased cards.

## Phases

### Phase 0 — trust fixes (behavioral)
0a. Compress-family inflation guards: shared `pickSmaller()` in
    `packages/core/src/lib/`; keep-original guards in `pdf-compress`,
    `compress-video` (same-container only), `compress-image-to-size`;
    cross-format warning path in `compress`; PreviewRunner Change row +
    inflation warning gated to `category === 'optimize'`; tests; patch
    changeset for `@wyreup/core`.
0b. Site-wide privacy honesty: replace blanket "Nothing uploads / 0 uploads /
    never leave your machine / nothing is sent to a server / every tool runs
    on your device / files never upload" claims across `index.astro`,
    `about.astro`, `HeroDrop.svelte`, `HowItWorks.svelte`, `DropZone.svelte`,
    `PwaOnboardBanner.svelte`, `triggers.astro`, and the `BaseLayout.astro`
    meta default with free-vs-hosted-scoped copy (trust strip becomes
    data-driven `{localCount} run fully on-device`; "No cookies" becomes "No
    tracking cookies" — PRO sign-in sets a session cookie); new
    `packages/web/test/privacy-claims.test.ts` — credit-tool forbidden-claims
    ratchet over descriptions + SEO_CONTENT (allowlist for honest
    comparatives) + site-copy needle lint over all eight files. Makes future
    seo-assemble regenerations safe. Adjudicated deferral: the site
    title/footer tagline "File tools that run on your device" is an identity
    claim, not a per-run promise; it is replaced in Phase 1 with the new brand
    promise rather than patched twice.

### Phase 1 — homepage rebuilt around jobs
New hero with two starting points: **Drop a file** (HeroDrop) and **Describe
what you need** (Fuse search over tools + jobs, no LLM) with example-job chips.
Headline moves to the job promise ("Drop a file. Get it ready for whatever
comes next."). Section reorder: jobs/scenarios adjacent to hero; chain demo
reframed as chain-of-actions showcase; "Use Wyreup anywhere" demoted to the
bottom as the expansion path ("Like the workflow? Run it from your terminal or
give it to your AI assistant."); PRO callout reframed from catalog to outcome
upgrades. Content-fit sections (drop forced viewport rhythm + scroll hint);
DESIGN.md §4 updated; footer tagline + default meta description updated.

### Phase 2 — jobs taxonomy + file-aware grouping
`packages/web/src/data/jobs.ts`. Job contract (decided — implementers do not
invent): `{ slug: string; title: string; description: string; action:
{ kind: 'tool'; toolId: string; params?: Record<string, unknown> } |
{ kind: 'chain'; steps: ToolbeltChainStep[] }; acceptMimes: MimePattern[];
priority: number; proUpsellId?: string }`. No string chain grammar — steps
reuse the existing `ToolbeltChainStep` shape, avoiding the paren-vs-bracket
encoding seam. MIME matching reuses the registry's `mimeMatches` wildcard
rules. "Recommended" for a dropped file = jobs whose `acceptMimes` match,
ordered by `priority` then slug; ties never reorder at runtime. Search merges
jobs and tools in one Fuse index with a `kind` tag; a job outranks a tool at
equal score. Every `toolId`/step id is validated against the registry by an
executable check. ~12–16 seed jobs (from ScenarioGrid +
docs/tinywow-research.md). Grouped drop results by outcome ("Make smaller /
Convert / Edit / Remove private info / Understand / Improve with AI") with
the Recommended row above. Chain-builder picker switches to Fuse ranking.

### Phase 3 — chains reframe + retention loop
One-click "Save this chain" on the ad-hoc hop path (result panel, auto-named
from step names, inline rename); `chainSuggestions` curation across top ~50
tools (executable check validates every id against the registry); saved-chains
page becomes the retention surface (recent tools + saved chains + run-again;
empty state reframed); consumer vocabulary pass ("a chain of actions";
trigger copy demoted to advanced).

### Phase 4 — contextual Pro + outcome landing pages
Result-moment Pro upsells driven by a web-side map in jobs.ts; single-source
pack pricing module consumed by pro.astro + homepage + upsell cards; outcome
landing pages (`/compress-photo-for-email`, …) via `getStaticPaths` over
jobs.ts, each launching the job's ready-made chain, FAQ/prose via a job-keyed
seo-assemble bucket; sitemap + LD-JSON parity with tool pages; Pro naming rule
applied. Tool renames ship ONLY with a compatibility contract: a registry
alias table (old id resolves to the new module for lookups, saved-chain
validation, kit import, share URLs, CLI args, and MCP tool names), 301
redirects for `/tools/<old-slug>`, and a changeset documenting the alias.
Durable user artifacts (localStorage chains, exported kits, inbound links)
must keep working unmodified.

## Gates (every phase)

- Every delegated task: executable check, exit 0 is the only PASS; existing
  test files are gate property (hashed before dispatch, asserted unchanged).
- Phase gate (exact commands, all must exit 0): `pnpm build`, `pnpm test`,
  `pnpm lint`, `pnpm typecheck`, `pnpm lint:root`. `pnpm audit --prod` runs at
  every phase gate; new advisories are adjudicated by the boss against the
  CVE-mapped suppression list (CI runs it advisory; the swarm gate does not).
  Bundle budgets are enforced by the existing budget tests inside `pnpm test`.
  Boss diff review of every lane artifact; cross-family adversarial review at
  the phase boundary.
- UX phases (1/2/4) additionally: build + preview walkthrough of the
  cold-visitor flows that exist as of that phase — Phase 1: drop → tool → run;
  Phase 2: drop → grouped tools → run → suggest; Phase 3 adds → save → return;
  Phase 4 adds landing page → chain launch.
- Ship = the full CLAUDE.md release gate (origin/main + green Cloudflare
  deploy + live-URL content check + changeset/npm state).
