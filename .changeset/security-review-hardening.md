---
'@wyreup/core': patch
'@wyreup/cli': patch
'@wyreup/mcp': patch
---

Security hardening from a full-platform review.

- **html-to-pdf**: sandbox the render iframe (`allow-same-origin` without `allow-scripts`) so untrusted HTML can no longer execute scripts in the page origin, while preserving html2canvas screenshotting.
- **markdown-to-html**: escape raw embedded HTML and neutralize `javascript:`/`data:`/`vbscript:` link hrefs (marked 15 does not strip these by default) to prevent XSS, especially when chained into html-to-pdf.
- **csv-to-excel / json-to-excel**: defang spreadsheet formula injection by prefixing cell values that begin with `= + - @` (or tab/CR) so they import as literal text.
- **regex tools**: reject catastrophic-backtracking (ReDoS) patterns and cap pattern length before execution.
- **preflight**: distinguish un-analysed files (oversized / no checker) from genuinely clean ones via a new `unanalysed` verdict.
- **MCP egress lock**: the key-holding worker now always installs the lock and derives its allowlist from the IPC-delivered, parent-validated origin; the disable flag and origin override are no longer forwarded into the worker, and the test-only reset is inert outside tests.
- **MCP chains**: enforce per-step and cumulative size caps on intermediate outputs to prevent memory exhaustion.
- **CLI**: `watch` now writes outputs via the atomic, symlink-safe, 0600 publisher; `login` warns when an API key is passed as a positional argument; `install-skill` enforces content-type, size, and optional SHA-256 integrity checks on fetched skills.
