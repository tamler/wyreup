# @wyreup/core

## 0.4.0

### Minor Changes

- 72787e1: Architectural cleanup + test backfill.

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

## 0.3.0

### Minor Changes

- 372a312: Add ~70 new tools across five sprints + emergent compositions.

  **Secrets / auth suite:** hmac, base32, base58, totp-code, hotp-code, jwt-sign, signed-url, backup-codes, otpauth-uri, webhook-verify, webhook-replay, signed-cookie-decode, api-key-format, license-key, pgp-armor.

  **Data wrangling:** csv-deduplicate, csv-merge, csv-diff, csv-info, csv-to-json-schema, csv-template (NEW mail-merge — render N documents from a CSV + mustache template), json-flatten, json-unflatten, json-diff, json-path, json-merge (NEW deep-merge with conflict report), json-schema-infer, json-schema-validate, frontmatter-to-csv, yaml-validate, xml-to-json, json-to-xml.

  **Security inspect:** text-confusable, text-redact, text-suspicious (NEW prompt-injection verdict), pdf-suspicious (NEW PDF prompt-injection scanner).

  **Spec validators:** openapi-validate, package-json-validate.

  **Text / HTML:** unicode-info, markdown-toc, markdown-frontmatter, color-contrast, password-strength, text-frequency, text-stats-by-paragraph, morse-code, roman-numeral, mime-detect, url-parse, url-build, url-shorten-local, html-clean, html-extract-links, favicon-from-url, css-minify, html-minify, file-fingerprint, text-template, color-blind-simulator.

  All tools ship as `presence: 'both'` — available in web, CLI (`wyreup run <tool>`), and MCP (`@wyreup/mcp`).

## 0.2.0

### Minor Changes

- ebe8507: Initial public release — Wyreup 0.1.0.
  - 72 tools across image, PDF, audio, text/dev, create, and finance categories
  - CLI for shell invocation
  - MCP server for agent integration
  - Agent skill for Claude and skill-compatible runtimes
  - CLI-only agent skill (smaller token footprint, no MCP)
  - MCP-only agent skill (smaller token footprint, no CLI)
