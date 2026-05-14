---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Architectural cleanup + test backfill.

**Breaking-but-internal (`@wyreup/core`)**:

- Removed the vestigial `Component` field from `ToolModule`. The UI lives in
  the web package's runner variants; the field was unused in every tool. The
  re-exported `ComponentType` / `ToolComponentProps` types are removed too.
- Removed the `presence: 'editor' | 'standalone' | 'both'` field. It was a
  leftover from the original spec and had no consumer.
- Added `llmDescription?: string` to `ToolModule`. When set, MCP / agent
  surfaces use this in place of the default `${name}: ${description}`.
  Migrated the 7 genuinely-useful overrides; deleted the 57 that were no
  better than the canonical description.

**`@wyreup/mcp`**:

- Deleted the 64-entry `TOOL_DESCRIPTIONS` map. Tool descriptions now come
  from the canonical `description` (or `llmDescription` when overridden).

**`@wyreup/cli`**:

- `wyreup install-skill --source <path>` flag for local skill dev — reads
  skill.md from a local file or directory instead of fetching from GitHub.

**Tests**: added a meta-test that iterates the entire default registry and
verifies structural invariants + smoke-runs every cheap-to-test tool against
synthetic input. Test count grew from 1,623 to 3,409 — closing the gap on
the 65 tools that had no per-tool test directory.

**Docs**: `docs/ARCHITECTURE.md` refreshed to reflect the 189-tool reality,
OIDC publishing, and the variantMap pattern.
