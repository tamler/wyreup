---
'@wyreup/core': patch
---

249 of 261 tools now carry curated chainSuggestions (semantic next-step lists from the phase-1 tool review, filtered to MIME-legal edges; JSON-report tools fall back to the generic JSON utilities). Inline per-tool suggestions keep precedence. The web chain panel, CLI, and MCP all read this via the default registry.
