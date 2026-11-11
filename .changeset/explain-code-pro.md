---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Add Explain Code (`explain-code-pro`), a 1-credit Pro tool that walks through a pasted code snippet in plain English on Cloudflare's hosted Qwen2.5 Coder 32B model. Optional `language` (up to 40 characters) and `level` (`beginner` or `expert`) parameters. Takes up to 12,000 characters per run; code with many non-English characters has a lower limit. Over-limit input is rejected before any credits are spent.
