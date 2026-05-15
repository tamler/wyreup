---
'@wyreup/core': minor
---

Add `setModelCdn` — single configuration point for AI model fetch host.

`packages/core/src/lib/model-cdn.ts` provides:
- `setModelCdn(base)` — point all model fetches at a different host.
- `getModelCdn()` — read the configured base (null = upstream defaults).
- `modelUrl(path, upstreamFallback)` — used inside tools to resolve URLs.

Wired up:
- `face-blur` (MediaPipe WASM + face-detector model)
- `audio-enhance` (FlashSR ONNX)
- `convert-geo` (gdal3.js WASM/data/js)
- `transformers.js` pipeline loader (auto-mirrors `env.remoteHost`)

Defaults stay the upstream CDNs (jsdelivr, googleapis, huggingface) so
this change is a no-op until `setModelCdn()` is called.

Migration path to R2 self-hosting:
1. Provision an R2 bucket `wyreup-models`, mirror upstream model paths.
2. Call `setModelCdn('https://models.wyreup.com')` once at app startup.
3. Drop third-party domains from the privacy-scan allow-list.

8 new tests cover the helper; existing tool tests unaffected.
