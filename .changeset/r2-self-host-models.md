---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Self-host every AI model fetch on R2 via `models.wyreup.com`.

The browser, CLI, and MCP no longer touch huggingface.co,
cdn.jsdelivr.net, or storage.googleapis.com at runtime. All model
URLs (face-blur WASM + tflite, audio-enhance ONNX, convert-geo
gdal3.js bundle, and every transformers.js pipeline) route through
`models.wyreup.com` — a first-party Cloudflare Worker
(`packages/worker-models/`) backed by the `wyreup-models` R2 bucket.

The Worker serves cached objects directly from R2 and lazy-mirrors
from the original upstream on cache-miss, writing back to R2 in
the background. Cold-start cost: one upstream fetch per file ever,
happening server-side inside Cloudflare's network. Hot path:
first-party R2 origin, no third-party touch.

Wired automatically in:
- **Web app** — `BaseLayout.astro` calls `setModelCdn` before any
  tool runner hydrates.
- **`@wyreup/cli`** — startup; override with `WYREUP_MODEL_CDN=<url>`
  or `WYREUP_MODEL_CDN=disabled` to fall back to upstream CDNs.
- **`@wyreup/mcp`** — same startup pattern.

Privacy-scan allow-list updated to remove `jsdelivr.net`,
`googleapis.com`, and `huggingface.co` — any future code that
sneaks them back in will now fail `tools/check-privacy.mjs`.
