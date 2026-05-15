---
'@wyreup/core': minor
---

Add `ToolSeoContent` — optional richer content for the public tool page.

A tool can now declare `seoContent` with:
- `intro` — one to three paragraphs explaining what the tool is for.
- `useCases` — bullet list of common uses.
- `faq` — Q&A pairs (also emitted as FAQPage JSON-LD).
- `alsoTry` — curated cross-links with the reason to click them.

When `seoContent` is present the public page renders the full body and
adds a FAQPage schema for SERP enhancement. When absent the page falls
back to auto-generated sections from existing metadata
(`description` / `llmDescription` / `input` / `output` / `cost` /
`memoryEstimate` / `installGroup`) — every tool page is now richer
than the previous one-line description, regardless of whether
`seoContent` was filled in.

`seoContent` populated for: `regex-from-text`, `regex-explain`,
`regex-visualize`, `cron-from-text`, `sql-format-explain`,
`image-to-ascii`, `prompt-injection-demo`, `pdf-extract-data`.
