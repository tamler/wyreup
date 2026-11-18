---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Add `pdf-scan-q-and-a-pro` (Ask a Scanned PDF), a 1-credit PRO tool for PDFs with no text layer. It renders up to 10 pages to JPEG at up to 1536 pixels on the long side, then sends those page images and the question to a hosted vision model. A `pages` parameter such as `"12-15, 20"` picks other pages. The answer notes when only the first 10 pages were read, and suggests `pdf-q-and-a` when the pages have selectable text.
