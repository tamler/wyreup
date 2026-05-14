# Wyreup Architecture (Quick Reference)

_Last refresh: 2026-05-14_

The original design spec lives at [`superpowers/specs/2026-04-15-wyreup-tool-library-design.md`](./superpowers/specs/2026-04-15-wyreup-tool-library-design.md). This page is the short-form current state.

## One-page summary

**Wyreup is a tool library with four surfaces and ~190 tools, written once and exposed everywhere.**

```
                +---------------------------+
                |   @wyreup/core            |
                |  Tool modules             |
                |  Chain engine             |
                |  Registry                 |
                |  Runtime adapters         |
                |  (framework-free)         |
                +----------+----------------+
                           |
            +--------------+--------------+-----------------+
            v              v              v                 v
       +----------+  +----------+  +----------+      +----------+
       |   web    |  |   cli    |  |   mcp    |      |  skill   |
       +----------+  +----------+  +----------+      +----------+
```

- **`@wyreup/core`** — the library. Framework-free, dual browser/Node build. Holds every `ToolModule`, the chain engine, and the registry.
- **`@wyreup/web`** — wyreup.com (Astro + Svelte islands, Cloudflare Pages). Per-tool pages + `/tools` catalog + `/chain/build` + PWA.
- **`@wyreup/cli`** — `wyreup` command. Wraps the registry as a shell tool: `wyreup <tool-id> [inputs...]`, plus `chain`, `watch`, `list`, `install-skill`.
- **`@wyreup/mcp`** — MCP server. Exposes every registry tool (with `surfaces` filter) over stdio to Claude Code, Cline, Continue, Claude Desktop.
- **Agent skill** — installed by `wyreup install-skill [cli|mcp|combined]` into the host agent's skills directory. Teaches the agent how to invoke Wyreup.

All three npm packages publish in lockstep via Changesets + OIDC trusted-publishing.

## The `ToolModule` contract

The interface is the source of truth. Each tool's `index.ts` exports a `ToolModule<Params>` with:

- **Metadata** — `id`, `slug`, `name`, `description`, `category`, `keywords`, optional `llmDescription` for MCP/agent surfaces, optional `categories[]` for multi-category tools.
- **Capabilities** — `input` (MIME accept list, min/max files, size limit), `output` (MIME + multiple flag), `interactive`, `batchable`, `cost`, `memoryEstimate`, optional `requires` (WebGPU / device-memory floor), optional `surfaces` (subset of `['web','cli','mcp']` — used to hide tools from surfaces where they can't run, e.g. `record-audio` is web-only).
- **`async run(inputs, params, ctx)`** — the one operation each tool implements. Returns `Blob | Blob[]`. CPU-only tools have no awaits; an ESLint override allows that without warnings.
- **Defaults + `paramSchema`** — `defaults: Params` plus an optional declarative schema so the web auto-form picks the right control (range slider, enum select, multi-enum chips, etc.).
- **`__testFixtures`** — declarative test contract consumed by CI.

UI is _not_ on the ToolModule. The web surface renders each tool via a runner variant picked from `packages/web/src/components/runners/variantMap.ts` — most tools share a generic runner (`TextInputRunner`, `JsonResultRunner`, `MultiInputRunner`, etc.), so 189 tools fit ~20 runner variants. Per-tool components are rare and only used when a bespoke UI is genuinely required.

CLI and MCP surfaces have no UI; they invoke `run()` directly.

## The registry

`createDefaultRegistry()` returns a frozen `ToolRegistry` exposing:

- `tools` — the flat `ToolModule[]`
- `toolsById: Map<string, ToolModule>` — fast lookup
- `toolsByCategory: Map<ToolCategory, ToolModule[]>`
- `toolsForFiles(files)` — MIME-match filter for "what can run on this drop?"
- `searchTools(query)` — name/description/keyword text search

Every surface consumes the same registry. Adding a new tool is one entry in `default-registry.ts`; the web pages, CLI list, and MCP tool surface all light up automatically.

## Chains

Chains are first-class. A chain is a sequence of tool IDs (with optional inline params) whose output MIMEs feed the next input. Runtime: `runChain(chainString, inputs, ctx, registry)`. Surfaces:

- Web: `/chain/build` (compose), `/chain/run?steps=...&auto=1` (execute)
- CLI: `wyreup chain receipt1.jpg --steps "image-to-pdf|pdf-compress"` + `wyreup watch ./dir --steps "..."` daemon
- MCP: chains are also exposed as a dedicated `chain` tool, so agents compose pipelines via one MCP call

Saved chains live in localStorage on the web and in `~/wyreup-kit.json` on CLI. Either can roundtrip the kit JSON.

## Invariants (CI-enforced)

- `@wyreup/core` imports nothing framework-shaped. Verified by build separation.
- Free tier runs entirely client-side. Verified by `tools/check-privacy.mjs` scanning HTML output for non-allowlisted domain references, plus a runtime CSP.
- Per-chunk gzipped bundle budgets enforced by `tools/check-bundle-size.mjs` (default 150 KB, per-chunk overrides for big lazy-loaded libs like pdfjs, openpgp, html-minifier-terser).
- All 1,600+ tests pass on every push.

## Release plumbing

- **Changesets** — drop a `.changeset/*.md` in any PR; merge to main; the `Release` workflow opens an auto-PR titled "Version Packages". Merging that PR fans out version bumps + publishes to npm.
- **OIDC trusted-publishing** — npm registry trusts the GitHub workflow's id-token directly; no `NPM_TOKEN` secret to rotate.
- **Cloudflare Pages** — separate workflow auto-deploys `wyreup.com` on every push to main.

## Status (2026-05-14)

- ~190 tools in the registry, spanning image, PDF, audio/video, text, dev, security/auth, privacy, data, geo, archive, finance, create
- All four packages published at `0.3.0` on npm via OIDC
- `Component` field has been removed from `ToolModule` (was vestigial — UI lives in runner variants)
- `presence` field removed for the same reason
- See `docs/ROADMAP.md` for what's next
