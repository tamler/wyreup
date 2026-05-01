# Wyreup Architecture (Quick Reference)

See the full design specification: [`superpowers/specs/2026-04-15-wyreup-tool-library-design.md`](./superpowers/specs/2026-04-15-wyreup-tool-library-design.md).

## One-page summary

**Wyreup is a tool library with four surfaces.**

```
                +---------------------------+
                |   @wyreup/core            |
                |  Tool modules             |
                |  Chain engine             |
                |  Type graph               |
                |  Registry                 |
                |  Runtime adapters         |
                |  (framework-free)         |
                +----------+----------------+
                           |
            +--------------+-------------+-----------------+
            v              v             v                 v
       +----------+  +----------+  +----------+     +----------+
       |   web    |  |   mcp    |  |   cli    |     |  skill   |
       +----------+  +----------+  +----------+     +----------+
```

- **`@wyreup/core`** — the library. Framework-free. Dual browser/node build.
- **`@wyreup/web`** — wyreup.com, landing pages, editor, PWA (Astro + Cloudflare Pages).
- **`@wyreup/mcp`** — MCP server for agents (Claude Code, Cline, Continue, and any MCP-compatible client).
- **`@wyreup/cli`** — `wyreup` command. Installs agent skills via `wyreup install-skill [cli|mcp|combined]`, which fetches the current `skill.md` from GitHub into the agent's skills directory.

## Invariants

- `@wyreup/core` imports nothing framework-shaped. CI enforces this.
- Free tier runs entirely client-side. CI enforces this via privacy scan + runtime CSP.
- Every tool is a `ToolModule` satisfying the same interface, regardless of surface.
- Chains are first-class tools. Saved chains become `ToolModule` instances at runtime.

## Status

Wave 0 foundation — scaffolding only. Wave 1 adds the first 8 tools across all four surfaces.
