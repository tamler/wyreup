---
'@wyreup/cli': patch
---

`wyreup install-skill` works again: the three agent skills (wyreup, wyreup-cli, wyreup-mcp) were deleted from the repo in the May cleanup, leaving every variant fetching a 404. Rewritten from scratch against the current CLI/MCP surface (run/chain/watch grammar, discovery via `wyreup list`, prefetch groups, PRO flow, chainSuggestions) and SHA-256 pins are now enforced end-to-end — SKILL_DEFS carries each file's hash, install-skill verifies it, and a CI test fails on any drift between pins and committed skill files.
