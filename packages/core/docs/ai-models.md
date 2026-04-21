# Wyreup AI Model Strategy — April 2026

Research date: April 2026. All claims below are web-verified unless marked "(training data)".

---

## 1. Executive Summary

Ten AI tool categories were evaluated. Based on licensing, model size, browser viability, and quality:

**Ship in v1 (browser tier, ready today):**
1. **Background removal** — BiRefNet_lite (MIT, ~100 MB fp16, Transformers.js v4, ~2–4 s on M2)
2. **Face detection + blur** — MediaPipe Face Detector (`@mediapipe/tasks-vision` v0.10.34, Apache 2.0, ~1 MB, sub-100 ms)
3. **Image similarity / near-duplicate detection** — CLIP ViT-B/16 via Transformers.js (MIT, 87 MB quantized, ~300 ms on M2)
4. **Image upscaling** — Swin2SR x2 via Transformers.js (Apache 2.0, ~22 MB q4, 2–5 s per image)
5. **OCR (printed + handwritten)** — TrOCR-small via Transformers.js (MIT, ~150 MB quantized, 1–3 s)

**Ship in v2 (needs more testing / larger download):**
6. **Object erase / inpainting** — LaMa ONNX (Apache 2.0, 208 MB fp32, browser-viable via raw ORT Web)
7. **Colorization** — DDColor via ONNX (Apache 2.0, ~200 MB, browser possible but slow on WASM)
8. **Face enhancement / restoration** — GFPGAN ONNX (Apache 2.0, ~350 MB — CLI tier confident, browser marginal)

**Not viable in browser yet (be honest with users):**
9. **Photo restoration (non-face, whole-image)** — NAFNet: no packaged browser ONNX, tiling complexity, not ready
10. **Semantic image search (CLIP)** — CLIP embedding is viable; full semantic search needs an index layer (not an AI limitation, but an architecture one — flag as v2)

**Single biggest risk:** WebGPU fallback. ~30% of browser sessions lack WebGPU (mobile, older Safari, Firefox on Linux/Android). All recommendations must have a WASM fallback path, which is 5–30x slower. For 200 MB+ models, WASM fallback may be too slow to be useful (>60 s inference). Design the UI to gate AI tools behind a WebGPU capability check and show honest timing estimates.

---

## 2. Landscape as of April 2026

### 2.1 Transformers.js

Transformers.js v4 shipped February 9, 2026 after 11 months of development. Key facts:

- **New WebGPU runtime** rewritten in C++ in collaboration with the ONNX Runtime team. The same code now runs in browsers, Node.js, Bun, and Deno.
- **Bundle size**: `transformers.web.js` is 53% smaller than v3. Build times dropped from 2 s to 200 ms.
- **Supported tasks relevant to Wyreup**: background removal (`image-segmentation`), image-to-image (super-resolution via Swin2SR), image-to-text (OCR via TrOCR), feature extraction (CLIP embeddings), zero-shot image classification.
- **NOT natively supported**: inpainting, colorization, whole-image restoration. These require raw ONNX Runtime Web.
- The `ModelRegistry` API now allows querying which dtypes are cached locally, enabling smarter download UX.
- Default caching: browser fetch with HTTP cache for WASM; IndexedDB for model weights (configurable via `env.useWasmCache`).

Sources: [Transformers.js v4 blog](https://huggingface.co/blog/transformersjs-v4), [GitHub releases](https://github.com/huggingface/transformers.js/releases/tag/4.0.0)

### 2.2 ONNX Runtime Web

- Current stable: ORT Web 1.21.x (as of early 2026).
- WebGPU EP has been the default GPU execution provider since ORT 1.17. Features added through 2025: Flash Attention optimizations, graph capture, Split-K MatMul, FP16 support (Chrome 121+, Edge 122+).
- Supported quantization in WebGPU: fp32, fp16. WASM supports fp32, int8, int4 (q4/q8).
- Not all ONNX operators are supported in WebGPU; WASM covers all operators but is CPU-only.
- `onnxruntime-node` for the CLI tier supports CUDA EP (Linux x64), DML EP (Windows), and WebGPU EP (cross-platform via GPU). Install via `onnxruntime-node` or `onnxruntime-node-gpu` for GPU builds.

Sources: [ORT Web docs](https://onnxruntime.ai/docs/tutorials/web/), [ORT WebGPU release blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/)

### 2.3 MediaPipe Tasks

`@mediapipe/tasks-vision` v0.10.34 published March 2026. Face Detector, Face Landmarker, Object Detector, Image Segmenter, and Gesture Recognizer are all available. Models ship as ~1–8 MB WASM bundles via CDN. Apache 2.0. No WebGPU required — runs on CPU via WASM delegate with real-time performance. This is the best option for any task where MediaPipe has a pre-packaged solution.

Source: [MediaPipe NPM](https://www.npmjs.com/package/@mediapipe/tasks-vision), [Google AI Edge docs](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js)

### 2.4 WebGPU Adoption (April 2026)

- Chrome/Edge: default since v113 (May 2023); ~65% of global browser traffic.
- Firefox: enabled by default on Windows (v141, early 2026) and ARM64 macOS (v145). Linux and Android still behind a flag.
- Safari: shipped by default in macOS Tahoe 26 / iOS 26 (Apple silicon only). Older iOS devices excluded.
- **Overall desktop coverage estimate: ~70%.** Mobile coverage is lower (~50–55%) due to Android Firefox lag and older iOS devices.
- FP16 support (needed for some models): Chrome v121+, Edge v122+. Not yet widely available in Firefox WebGPU or older Safari versions.
- Bottom line: **plan for 25–35% of sessions to lack WebGPU** through 2026.

Sources: [WebGPU hits critical mass](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/), [WebGPU 2026 support stats](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/), [Firefox WebGPU](https://zircon.tech/blog/webgpu-just-got-real-what-firefox-141-and-upcoming-safari-mean-for-ai-in-the-browser/)

### 2.5 WebLLM and WebNN

- **WebLLM**: Production-ready for LLM inference in-browser via WebGPU. npm downloads grew 340% in 2025. Not relevant to Wyreup's image tool focus but demonstrates browser AI maturity.
- **WebNN**: W3C standard for hardware-agnostic ML acceleration (CPU/GPU/NPU). Real-world adoption is effectively zero (0.000029% of page loads peak in 2025). Not yet usable as a target for Wyreup.

---

## 3. Task-by-Task Analysis

---

### 3.1 Background Removal

**What it needs to do:** Remove backgrounds from person photos, product shots, and general images. Output: alpha mask or transparent PNG.

#### Candidates

**RMBG-2.0 (briaai/RMBG-2.0)**
- License: **CC BY-NC 4.0** — non-commercial. **REJECTED.** Commercial use requires a separate agreement with BRIA AI.
- ONNX available: yes (514 MB fp16). Transformers.js: blocked by a known bug in ORT Web. Source: [HF discussion](https://huggingface.co/briaai/RMBG-2.0/discussions/12)

**BiRefNet (ZhengPeng7/BiRefNet)**
- License: **MIT** — APPROVED.
- ONNX community version: `onnx-community/BiRefNet-ONNX` (MIT). Full model: ~973 MB fp32, ~490 MB fp16. Too large for browser default.
- Lite version: `onnx-community/BiRefNet_lite-ONNX` (MIT). Significantly smaller. Transformers.js example code provided on the model card, using `AutoModel` + `AutoProcessor`.
- Known issue: 1024×1024 inference can cause OOM in browser; developers note they have only tested Node.js. A discussion thread reports Chrome errors at full resolution. Reduce to 512×512 for browser tier.
- Tasks: background removal, salient object detection, camouflaged object detection, dichotomous image segmentation.
- Sources: [BiRefNet-ONNX HF](https://huggingface.co/onnx-community/BiRefNet-ONNX), [BiRefNet_lite-ONNX HF](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX), [GitHub](https://github.com/ZhengPeng7/BiRefNet)

**RMBG-1.4 (briaai/RMBG-1.4)**
- License: **CC BY-NC 4.0** — **REJECTED** for same reason as 2.0.

**MODNet (Xenova/modnet)**
- License: MIT (training data). Works in browser via Transformers.js. Smaller than BiRefNet but lower quality on non-portrait images.

---

**Recommendation:**

```
Task: Background removal
Browser tier: BiRefNet_lite (onnx-community/BiRefNet_lite-ONNX, MIT, ~100 MB fp16 est.,
  Transformers.js v4, image-segmentation pipeline, WebGPU preferred / WASM fallback at
  512x512, ~2-4 s on M2 with WebGPU)
CLI tier: BiRefNet full (onnx-community/BiRefNet-ONNX, MIT, ~490 MB fp16,
  onnxruntime-node with CUDA EP, ~0.5 s on GPU)
Notes: Cap browser inference at 512x512 to avoid OOM. Users with 4 GB devices hitting
  large images should be warned. Full BiRefNet at 1024x1024 is CLI-only.
  RMBG-2.0 and RMBG-1.4 are license-rejected (CC-BY-NC).
Verdict: SHIP in v1 (browser lite / CLI full)
```

---

### 3.2 Image Upscaling

**What it needs to do:** Upscale photos and illustrations 2x or 4x with quality better than bicubic interpolation.

#### Candidates

**Swin2SR (Xenova/swin2SR-* variants)**
- License: **Apache 2.0** (original `caidas/swin2SR-*` — Apache 2.0). APPROVED.
- ONNX available: yes, multiple Xenova-converted variants with quantization.
- Classical SR x2: `Xenova/swin2SR-classical-sr-x2-64` — fp32: 54.4 MB, fp16: 32.4 MB, q4: 23.2 MB, q4f16: 15.6 MB. Very browser-viable.
- Classical SR x4: `Xenova/swin2SR-classical-sr-x4-64` — larger.
- Real-world SR x4: `Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr` — photo-realistic upscaling trained on real-world degradation.
- Transformers.js pipeline: `image-to-image` — supported natively in v4.
- Performance: SwinIR Medium x4 takes ~4 s per 64×64 patch on CPU via ORT WASM (from josephrocca/super-resolution-js demo). With WebGPU, expected 3–8x speedup per patch. Full images are tiled.
- Sources: [Xenova swin2SR-classical-sr-x2-64](https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64), [onnx-community x4 realworld](https://huggingface.co/onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX), [super-resolution-js demo](https://josephrocca.github.io/super-resolution-js/)

**Real-ESRGAN**
- License: **BSD 3-Clause** — APPROVED for commercial use.
- ONNX: available (~67 MB for x2plus and x4 variants).
- Browser: a TensorFlow.js + WebGPU implementation exists (`xororz/web-realesrgan`). Not natively in Transformers.js. Would require raw ORT Web integration.
- Real-CUGAN noted as 5–10x faster than Real-ESRGAN in the browser with similar quality.
- Sources: [Real-ESRGAN GitHub](https://github.com/xinntao/Real-ESRGAN), [BSD-3 LICENSE](https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE), [web-realesrgan](https://github.com/xororz/web-realesrgan)

**UpscalerJS**
- Open-source, supports ESRGAN models in browser. Worth evaluating as an abstraction layer if Swin2SR integration proves complex.

---

**Recommendation:**

```
Task: Image upscaling
Browser tier: Swin2SR x2 (Xenova/swin2SR-classical-sr-x2-64, Apache 2.0, ~22 MB q4,
  Transformers.js v4 image-to-image pipeline, WebGPU preferred, ~3-6 s on M2 for a
  512x512 image). For x4 photo-realistic: Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr
  (larger, recommend CLI or explicit download prompt).
CLI tier: Real-ESRGAN x4 ONNX (BSD 3-Clause, 67 MB, onnxruntime-node GPU) or
  Swin2SR x4 (same model, more tooling support).
Notes: Swin2SR processes images in tiles; large images require tiling logic in the
  integration layer. The q4 quantized x2 model at ~22 MB is an excellent first-run
  experience. Illustration vs. photo: Swin2SR classical is trained on bicubic
  downsampling (good for illustrations), realworld variant is better for photos with
  noise/blur. Offer both.
Verdict: SHIP in v1 (x2 lightweight), SHIP in v2 (x4 realworld, larger download)
```

---

### 3.3 Photo Restoration

**What it needs to do:** Improve old, damaged, or low-quality photos — noise removal, deblurring, scratch removal. Distinct from face restoration (section 3.7).

#### Candidates

**NAFNet (megvii-research/NAFNet)**
- License: Apache 2.0 (via BasicSR dependency) — APPROVED in principle.
- Capabilities: state-of-the-art deblurring (33.69 dB PSNR on GoPro) and denoising (40.30 dB PSNR on SIDD).
- ONNX status: an unofficial ONNX conversion exists (`opencv/deblurring_nafnet`, `mikestealth/nafnet-models` on HF). No packaged Transformers.js integration. Requires manual ORT Web wiring.
- Browser viability: unknown, untested at scale. Model is ~170 MB (estimated). Tiling required for large images.
- No published browser demo found.
- Sources: [NAFNet GitHub](https://github.com/megvii-research/NAFNet), [opencv/deblurring_nafnet](https://huggingface.co/opencv/deblurring_nafnet)

**Real-ESRGAN (for restoration + upscaling)**
- Already covered in 3.2. Its real-world variant is trained on degraded photos and implicitly handles some restoration alongside upscaling. Could double as a restoration tool with honest UX copy ("reduce noise and sharpen").

**Restormer / MPRNet**
- Research models. No packaged ONNX + browser pipeline found. Sizes are large (hundreds of MB to 1+ GB).

---

**Recommendation:**

```
Task: Photo restoration (whole image, non-face)
Browser tier: NOT VIABLE YET in a clean packaged form. No model has a Transformers.js
  or cleanly packaged ORT Web pipeline in April 2026. Use Real-ESRGAN x4 realworld as a
  proxy for light restoration + upscaling — it handles some degradation but is not a
  dedicated restoration tool. True denoising/deblurring without upscaling is not
  browser-ready.
CLI tier: NAFNet via onnxruntime-node (Apache 2.0, GPU-accelerated, fast on server-grade
  GPU). Manual ORT wiring required — not a drop-in package.
Notes: Honest framing for v1: "upscale and enhance" via Swin2SR realworld is a reasonable
  substitute. True restoration (scratch removal, severe damage) is a v3+ consideration
  pending a packaged browser ONNX pipeline for NAFNet or Restormer.
Verdict: SKIP browser v1. CLI tier: SHIP in v2 with NAFNet (requires integration work).
```

---

### 3.4 Colorization (Black & White to Color)

**What it needs to do:** Automatically add plausible color to grayscale/B&W photos.

#### Candidates

**DDColor (piddnad/DDColor)**
- License: **Apache 2.0** — APPROVED.
- Paper: ICCV 2023. Dual-decoder architecture produces photo-realistic colorization.
- ONNX: `DDColor-onnx` project on GitHub (`instant-high/DDColor-onnx`). Model variants include artistic, modelscope, and paper_tiny.
- Browser: Not natively in Transformers.js. An ONNX conversion exists. Browser inference feasibility depends on model size — paper_tiny is smaller and has an ONNX export demo.
- Quality: considered state-of-the-art for automatic colorization as of 2025.
- Sources: [DDColor GitHub](https://github.com/piddnad/DDColor), [DDColor-onnx](https://github.com/instant-high/DDColor-onnx), [HF models](https://huggingface.co/piddnad/DDColor-models)

**DeOldify**
- License: **MIT** — APPROVED.
- Browser ONNX demo exists (`akbartus/DeOldify-on-Browser` — MIT, powered by ONNX, no server required).
- Quality: lower than DDColor for modern comparisons, but well-established. Slightly dated (2019-era architecture).
- A modernized fork targets PyTorch 2.5+ and CUDA 12.x.
- Sources: [DeOldify GitHub](https://github.com/jantic/DeOldify), [DeOldify-on-Browser](https://github.com/akbartus/DeOldify-on-Browser)

---

**Recommendation:**

```
Task: Colorization
Browser tier: DeOldify-on-Browser (MIT, ONNX, proven to run without a server). Start
  here for v2 — the browser demo proves feasibility. DDColor paper_tiny ONNX is the
  quality upgrade path. Neither is currently in Transformers.js — requires raw ORT Web
  integration.
CLI tier: DDColor artistic/modelscope (Apache 2.0, onnxruntime-node GPU).
Notes: Neither model does semantically-guided colorization (i.e., user controls what
  color a car becomes). Both are fully automatic. Set user expectations accordingly.
  For v1, colorization is lower priority than background removal and upscaling — it is
  slower, niche, and requires custom ORT Web wiring.
Verdict: SHIP in v2. CLI confident; browser needs integration work.
```

---

### 3.5 Object Erase / Inpainting

**What it needs to do:** User draws a mask over an object; the tool fills the masked region with a plausible background.

#### Candidates

**LaMa (Large Mask inpainting)**
- License: **Apache 2.0** (Carve/LaMa-ONNX) — APPROVED.
- ONNX available: `Carve/LaMa-ONNX` (lama_fp32.onnx ~207 MB, opset 17 — use this; opset 18 version has known performance issues).
- Input: fixed 512×512. Preprocessing must resize and pad.
- Browser: a Next.js app runs LaMa entirely client-side via ORT Web. Live demo confirmed working. Source: [Client-side inpainting article](https://medium.com/@geronimo7/client-side-image-inpainting-with-onnx-and-next-js-3d9508dfd059).
- Not in Transformers.js — requires raw ORT Web (`onnxruntime-web`) integration.
- Quality: "incredibly fast and does a good job at removing people or objects from photos, particularly for small patches and homogenous backgrounds." Complex textures or large objects are harder.
- Sources: [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX), [LaMa GitHub](https://github.com/advimman/lama)

**Diffusion-based inpainting (Stable Diffusion, etc.)**
- Models are 1–8 GB. Not browser-viable. CLI-only and complex to integrate.

---

**Recommendation:**

```
Task: Object erase / inpainting
Browser tier: LaMa (Carve/LaMa-ONNX, Apache 2.0, 207 MB fp32, raw ORT Web,
  512x512 input, ~3-8 s on M2 with WebGPU). Requires a mask-drawing UI component.
  WASM fallback will be slow (~30-60 s) — consider showing a warning when WebGPU is
  absent.
CLI tier: LaMa same model via onnxruntime-node (GPU-accelerated, sub-1 s).
Notes: 207 MB download is large for a first-run experience. Display a download progress
  bar. Consider gating this tool behind an explicit "download AI model" step. Quality is
  good for simple scenes, limited for complex textures.
Verdict: SHIP in v2 (browser requires ORT Web wiring + mask UI). CLI: SHIP in v1.
```

---

### 3.6 Face Detection and Face Blur

**What it needs to do:** Detect all faces in an image, apply a blur or pixelation effect to each detected face region. Core privacy tool.

#### Candidates

**MediaPipe Face Detector (`@mediapipe/tasks-vision`)**
- License: **Apache 2.0** — APPROVED.
- Version: 0.10.34 (March 2026).
- Model size: ~1 MB (BlazeFace short-range). Sub-100 ms inference on any modern device.
- No WebGPU required — runs via WASM delegate with CPU.
- Outputs bounding boxes + 6 keypoints per face. Detects up to 20 faces simultaneously.
- Full WASM bundle ships via CDN (unpkg or jsdelivr) — no HuggingFace model download needed.
- Sources: [MediaPipe face detector web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js), [tasks-vision NPM](https://www.npmjs.com/package/@mediapipe/tasks-vision)

**BlazeFace ONNX**
- Available as a standalone ONNX model (Apache 2.0 via MediaPipe). Alternative if `@mediapipe/tasks-vision` package is too large as a dependency.

---

**Recommendation:**

```
Task: Face detection + face blur
Browser tier: MediaPipe Face Detector (@mediapipe/tasks-vision v0.10.34, Apache 2.0,
  ~1 MB model, WASM, <100 ms per image). Apply Gaussian blur via Canvas API to each
  bounding box. No AI model download needed beyond the MediaPipe WASM binary.
CLI tier: Same — @mediapipe/tasks-vision works in Node.js, or use onnxruntime-node
  with BlazeFace ONNX for a pure-Node solution.
Notes: This is the simplest AI integration on the list. The blur is Canvas API — no
  second model required. Offer blur radius as a user control (light/medium/strong).
  For video frames, use the detectForVideo() API.
Verdict: SHIP in v1 (easiest win, smallest footprint, best privacy story)
```

---

### 3.7 Face Enhancement / Restoration

**What it needs to do:** Improve degraded, low-resolution, or blurry faces in photos. Separate from whole-image restoration.

#### Candidates

**CodeFormer (sczhou/CodeFormer)**
- License: **S-Lab License 1.0** — restricts redistribution and commercial use. **REJECTED.**
- ONNX: available in ComfyUI wrappers. Not safe for Wyreup.
- Sources: [CodeFormer GitHub](https://github.com/sczhou/CodeFormer)

**GFPGAN (TencentARC/GFPGAN)**
- License: **Apache 2.0** — APPROVED. Note: uses several third-party components; all upstream licenses must be reviewed for commercial use when integrating.
- ONNX: `HowToSD/GFPGAN-ONNX` on HuggingFace. Third-party conversion.
- GFPGAN leverages StyleGAN2 priors for blind face restoration. Handles low-resolution, noisy, compressed, blurry faces.
- Browser viability: model size estimated ~350 MB (ONNX fp32). Browser inference feasible but requires WebGPU for acceptable speed. WASM fallback may exceed 60 s.
- No published, working browser demo found (as of April 2026).
- Sources: [GFPGAN GitHub](https://github.com/TencentARC/GFPGAN), [Apache 2.0 LICENSE](https://github.com/TencentARC/GFPGAN/blob/master/LICENSE), [HowToSD GFPGAN-ONNX](https://huggingface.co/HowToSD/GFPGAN-ONNX)

**RestoreFormer++ / GPEN**
- Research models. Non-commercial or unclear licenses. **Reject or flag for individual review.**

---

**Recommendation:**

```
Task: Face enhancement / restoration
Browser tier: MARGINAL. GFPGAN ONNX (Apache 2.0) is technically feasible with WebGPU
  but has no packaged browser demo and requires raw ORT Web integration + WebGPU
  presence. WASM fallback is too slow. Gate behind WebGPU capability check.
  Estimated: ~5-15 s on M2 with WebGPU, >60 s on WASM. Ship only in v2 with explicit
  "requires a modern GPU" warning in the UI.
CLI tier: GFPGAN ONNX via onnxruntime-node (Apache 2.0, GPU, ~0.5-1 s per face).
  Confident for v1.
Notes: CodeFormer (widely recommended) is license-rejected. GFPGAN is the best
  Apache-licensed option but requires upstream license audit for the StyleGAN2
  components before shipping. Do that audit before v1 CLI.
Verdict: CLI SHIP in v1 (after license sub-audit). Browser SHIP in v2 with
  WebGPU-only gating.
```

---

### 3.8 Better OCR

**What it needs to do:** Recognize text in images better than Tesseract — specifically: handwritten text, multi-language documents, layout-aware recognition.

#### Candidates

**TrOCR (Microsoft)**
- License: **MIT** — APPROVED.
- ONNX: Xenova-converted versions available: `Xenova/trocr-small-handwritten`, `Xenova/trocr-base-handwritten`, `Xenova/trocr-small-printed`, `Xenova/trocr-base-printed`.
- Size: trocr-small quantized ~150 MB (estimated, based on known architecture); trocr-base ~250 MB+ quantized.
- Transformers.js: `image-to-text` pipeline — fully supported.
- Performance: strong on printed and handwritten English text. Multilingual coverage limited — it is not the choice for non-Latin scripts.
- Sources: [Xenova/trocr-small-handwritten](https://huggingface.co/Xenova/trocr-small-handwritten), [Xenova/trocr-base-printed](https://huggingface.co/Xenova/trocr-base-printed)

**PaddleOCR**
- Supports 100+ languages, structured document layout analysis.
- License: Apache 2.0 — APPROVED in principle.
- Browser: no clean ONNX + browser pipeline found. It's a Python-first toolkit. Inference via ONNX Runtime is supported but requires wiring. No Transformers.js support.
- Best for CLI tier.

**Tesseract (current baseline)**
- Already in use. Works for printed Latin text. Poor on handwriting, non-standard fonts, and some scripts.

---

**Recommendation:**

```
Task: Better OCR (printed and handwritten)
Browser tier: TrOCR-small (Xenova/trocr-small-handwritten + Xenova/trocr-small-printed,
  MIT, ~150 MB quantized, Transformers.js v4 image-to-text pipeline, WebGPU preferred,
  ~1-3 s on M2). Use the handwritten model for handwriting, printed model for documents.
  The user picks the mode, or auto-detect with a lightweight classifier.
CLI tier: PaddleOCR (Apache 2.0, onnxruntime-node, 100+ languages, layout-aware).
  Integrates well with the existing Tesseract fallback for CLI users who need non-Latin
  scripts.
Notes: TrOCR is English-centric for handwriting. For multilingual printed text,
  Tesseract with a good model selection is competitive. PaddleOCR in the CLI tier is
  the real upgrade for multilingual/layout use cases.
Verdict: SHIP in v1 (TrOCR-small browser + Tesseract fallback is a meaningful
  upgrade). CLI PaddleOCR in v2.
```

---

### 3.9 Image Similarity / Near-Duplicate Detection

**What it needs to do:** Detect visually similar or near-duplicate images — for dedup workflows or reverse image search within a local set.

#### Candidates

**CLIP ViT-B/16 (OpenAI, via Xenova)**
- License: **MIT** — APPROVED.
- HuggingFace: `Xenova/clip-vit-base-patch16`.
- Size: image model 345 MB fp32, **87 MB quantized (q8)**. Text model separate.
- Output: 512-dimensional image embeddings.
- Transformers.js: `feature-extraction` or `zero-shot-image-classification` pipeline — fully supported.
- Similarity: compute cosine similarity between embedding vectors. Near-duplicate detection is a query against a cached index of embeddings.
- Performance: sub-second embedding computation on M2 with WebGPU.
- Sources: [Xenova/clip-vit-base-patch16](https://huggingface.co/Xenova/clip-vit-base-patch16)

**MobileViT (Xenova/mobilevit-small)**
- Smaller and faster than CLIP for classification. Produces image embeddings, but embedding space is not cross-modal (no text matching). Good for pure image-to-image similarity, insufficient for semantic text-image search.

**MobileCLIP (Xenova/mobileclip_b)**
- Compact CLIP variant from Apple. License: Apple (verify if commercial use is permitted — check `apple/MobileCLIP` license before using).

**Perceptual hashing (pHash, dHash)**
- Not an AI model. Pure deterministic algorithm. ~microsecond per image, zero download. For exact or near-exact duplicates this beats any neural approach. Recommend offering this as the default and CLIP as the "semantic similarity" upgrade.

---

**Recommendation:**

```
Task: Image similarity / near-duplicate detection
Browser tier: Two-speed approach.
  - Near-exact duplicates: perceptual hash (no model, no download, instant).
  - Semantic similarity: CLIP ViT-B/16 (Xenova/clip-vit-base-patch16, MIT, 87 MB
    quantized, Transformers.js feature-extraction, ~200-400 ms per image on M2).
    Embeddings are stored in memory (or IndexedDB for persistence). Cosine similarity
    against stored embeddings. No server needed.
CLI tier: Same CLIP model via onnxruntime-node. GPU-accelerated for batch processing
  large image libraries.
Notes: For a "find duplicates in this folder" tool, pHash covers 90% of use cases with
  zero download friction. CLIP adds semantic matching ("find images similar to this
  person") but is a meaningfully larger download. Offer both modes explicitly.
Verdict: pHash SHIP in v1 (no model needed). CLIP SHIP in v2.
```

---

### 3.10 Semantic Image Search (Stretch Goal)

**What it needs to do:** User types "red car on a beach" and finds matching images in a local set. Requires text-image embedding alignment.

#### Candidates

**CLIP ViT-B/16 (same as 3.9)**
- Same model handles text embeddings too via `Xenova/clip-vit-base-patch16` text encoder.
- Both the vision and text encoders ship in the same quantized package (87 MB image + ~60 MB text encoder).
- Transformers.js: zero-shot image classification pipeline demonstrates this cross-modal matching.
- A local semantic search would: (1) embed all images offline; (2) store 512-dim vectors in IndexedDB; (3) on query, embed the text; (4) sort by cosine similarity.

**Jina CLIP v2 (jinaai/jina-clip-v2)**
- Newer CLIP variant with Transformers.js support added. Potentially stronger on multilingual text. License: Apache 2.0. Worth evaluating against OpenAI CLIP.

---

**Recommendation:**

```
Task: Semantic image search
Browser tier: CLIP ViT-B/16 (same model as 3.9, amortized download). The AI piece
  is solved; the engineering piece is an IndexedDB-backed embedding store + a simple
  cosine sort. Not a model limitation — an architecture task.
CLI tier: Same, with optional upgrade to a larger CLIP variant (ViT-L/14) for
  better accuracy.
Notes: This feature is gated behind having a library of images to search. It is most
  valuable as a companion to other Wyreup tools ("search my processed images"). The
  CLIP download is shared with the image similarity tool — encourage a single model
  load.
Verdict: SHIP in v2 (architecture work needed, not AI research).
```

### 3.11 Audio Super-Resolution

**What it needs to do:** Upscale low-quality (16 kHz) audio to broadcast-quality (48 kHz). Targets phone recordings, Zoom/Meet calls, old podcasts, and voice memos.

**Model: FlashSR (YatharthS/FlashSR)**
- License: **Apache 2.0** — APPROVED.
- Architecture: HierSpeech++-based audio super-resolution model.
- ONNX version: Xenova-converted at `YatharthS/FlashSR/onnx/model.onnx`. Size: **~500 KB** — trivially small.
- Input: 16 kHz mono Float32 audio, shape `[1, n_samples]`. Output: 48 kHz audio at `[1, m_samples]` (~3x samples).
- Speed (from FlashSR README): 200–400x realtime.
- Input decoding: Web Audio API (`AudioContext` at `sampleRate: 16000`). WASM fallback for browsers ignoring the rate hint (linear interpolation resample).
- WAV encoding: hand-rolled 44-byte PCM encoder; no audio library dependency added.
- Long audio: v1 throws a clear error if the model's input shape is fixed and exceeded. Chunking deferred to v2.
- Runtime: `onnxruntime-web`. WebGPU preferred, WASM fallback always available.

```
Task: Audio super-resolution
Browser tier: FlashSR (YatharthS/FlashSR, Apache 2.0, ~500 KB ONNX, raw ORT Web,
  WebGPU preferred / WASM fallback, 200-400x realtime on CPU-WASM)
CLI tier: Same model — onnxruntime-web works in Node. Future: onnxruntime-node with
  CUDA EP for batch processing.
Notes: 500 KB model is fetched on demand from HF CDN; no bundling in npm package.
  AudioContext required for browser decode — tool surfaces a clear error in CLI/Node.
  Long audio (chunking) is a v2 concern; v1 throws if fixed input length is exceeded.
Verdict: SHIP in v1 browser, CLI
```

---

## 4. Final Recommendation Matrix

| Task | Browser Tier | CLI Tier | Model / HF ID | License | Approx Size (browser) | Verdict |
|---|---|---|---|---|---|---|
| Background removal | BiRefNet_lite | BiRefNet full | `onnx-community/BiRefNet_lite-ONNX` | MIT | ~100 MB fp16 est. | v1 browser, v1 CLI |
| Image upscaling 2x | Swin2SR x2 | Swin2SR or Real-ESRGAN | `Xenova/swin2SR-classical-sr-x2-64` | Apache 2.0 | ~22 MB q4 | v1 browser |
| Image upscaling 4x | Swin2SR realworld | Real-ESRGAN x4 | `Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr` | Apache 2.0 | ~100 MB est. | v2 browser |
| Photo restoration | Not viable | NAFNet | `opencv/deblurring_nafnet` | Apache 2.0 | N/A (CLI only) | SKIP browser v1, v2 CLI |
| Colorization | DeOldify ONNX | DDColor artistic | `akbartus/DeOldify-on-Browser` / `piddnad/DDColor-models` | MIT / Apache 2.0 | ~150 MB est. | v2 browser |
| Object erase | LaMa ONNX | LaMa ONNX | `Carve/LaMa-ONNX` | Apache 2.0 | 207 MB fp32 | v2 browser, v1 CLI |
| Face detection + blur | MediaPipe | MediaPipe | `@mediapipe/tasks-vision` | Apache 2.0 | ~1 MB | v1 browser |
| Face enhancement | GFPGAN (WebGPU-only) | GFPGAN ONNX | `HowToSD/GFPGAN-ONNX` | Apache 2.0* | ~350 MB est. | v2 browser (WebGPU gate), v1 CLI* |
| OCR (print+handwrite) | TrOCR-small | PaddleOCR | `Xenova/trocr-small-handwritten` | MIT | ~150 MB q8 est. | v1 browser |
| Image similarity | pHash + CLIP | pHash + CLIP | `Xenova/clip-vit-base-patch16` | MIT | 87 MB q8 | v1 (pHash), v2 (CLIP) |
| Semantic image search | CLIP (same) | CLIP larger | `Xenova/clip-vit-base-patch16` | MIT | shared with above | v2 browser |
| Audio super-resolution | FlashSR ONNX | FlashSR ONNX | `YatharthS/FlashSR` | Apache 2.0 | ~500 KB | v1 browser, v1 CLI |

*GFPGAN: conduct upstream license sub-audit (StyleGAN2 components) before shipping.

---

## 5. Implementation Notes

### 5.1 Model Delivery

- **10 MB bundle budget**: no model ships in the main bundle. Every model is downloaded on demand.
- **CDN**: use the HuggingFace CDN (`https://huggingface.co/<model>/resolve/main/onnx/...`). Do not self-host unless you need SLA guarantees or want to avoid HF rate limits. HF CDN is globally distributed and free.
- **Transformers.js default**: models are fetched from HuggingFace and cached by the browser's HTTP cache mechanism. The `env.useWasmCache = true` setting in v4 enables offline use after first download.
- **Manual ORT Web models** (LaMa, DeOldify, DDColor): fetch the `.onnx` file manually and pass it to `ort.InferenceSession.create(arrayBuffer)`. Use a progress event on the fetch to drive a download progress bar.
- Consider prefetching the next model while the user is interacting with the current result (speculative loading), using the `ModelRegistry.is_pipeline_cached()` API to skip if already cached.

### 5.2 Caching

- **Transformers.js v4** caches model shards via `IndexedDB` by default (configurable). After first run, model is served from local storage — no re-download.
- **Quota**: IndexedDB storage is not unlimited. Browsers enforce quotas (commonly 50% of available disk). For large models (200+ MB), warn users if storage is nearly full.
- **Cache invalidation**: Transformers.js ties cache to the model revision SHA. Updating the model version invalidates the cache automatically.
- **Raw ORT Web models** (LaMa etc.): cache the ArrayBuffer in IndexedDB manually using the Cache API or a simple IDB wrapper. Key on the model filename + a version string you control.
- **Service Worker**: not strictly necessary for model caching (IndexedDB works without one), but a Service Worker enables offline use of the tool UI itself. Recommended for v2 as a PWA enhancement.

### 5.3 First-Run UX

For a model like BiRefNet_lite (~100 MB fp16):

1. User drops an image. Wyreup detects no cached model.
2. Show a dialog: "This tool requires a 100 MB AI model. It downloads once and runs privately on your device." with a [Download and run] button.
3. On confirm: show a progress bar driven by the fetch stream (`response.body.getReader()`).
4. After download + cache: run inference. Show a spinner during inference.
5. On subsequent visits: skip straight to inference (model is cached).

For small models like MediaPipe (~1 MB), skip the dialog — just download silently with a spinner.

**Timing expectations to communicate to users (approximate, M2 MacBook with WebGPU):**
- MediaPipe face detection: < 1 s (model loads in <1 s too)
- CLIP embedding: 1–3 s
- Swin2SR x2 upscaling: 2–6 s per image
- BiRefNet_lite background removal: 2–5 s
- TrOCR-small OCR: 1–4 s
- LaMa inpainting: 3–8 s
- GFPGAN face restoration: 5–15 s

Multiply by 5–30x for WASM-only (no WebGPU). For anything over 30 s on WASM, show a "this will be slow on your browser — consider using the CLI version" message.

### 5.4 WebGPU Fallback Story

**Decision (2026-04-19):** For WebGPU-preferred tools, ship WASM fallback ON with an honest "slower mode" badge. Being transparent about speed is less alienating than locking users out. Only WebGPU-required tools (large models where WASM is unusable) are gated.

Detection:
```javascript
const hasWebGPU = !!navigator.gpu;
const adapter = hasWebGPU ? await navigator.gpu.requestAdapter() : null;
```

Each `ToolModule` carries a `requires` field:
- `requires: undefined` — universal, always enabled
- `requires: { webgpu: 'preferred' }` — runs on WASM too, shows "slower mode" badge
- `requires: { webgpu: 'required' }` — hidden/greyed on non-WebGPU with CLI escape hatch: `npx @wyreup/cli <tool> <file>`

Strategy by tool tier:
- **Universal** (MediaPipe face-detect ~1 MB, pHash, Swin2SR 22 MB): No fallback needed. Fast on WASM. Always enabled.
- **WebGPU-preferred** (BiRefNet_lite ~100 MB, TrOCR 150 MB, CLIP 87 MB): Ship with WASM fallback. Show "Processing may take 20–60 seconds on your device — faster on browsers with GPU acceleration" badge.
- **WebGPU-required** (LaMa 207 MB, GFPGAN ~350 MB, DDColor ~200 MB): Disable when WebGPU is absent. Tool page still renders (for SEO + discoverability) but the run button is replaced with "This tool needs GPU acceleration. Use the CLI: `npx @wyreup/cli <tool>`."

The `dtype` selection in Transformers.js v4:
- WebGPU: use `fp16` (smaller, faster on GPU) or `fp32`.
- WASM: use `q8` or `q4` (quantized — faster and smaller than fp32 on CPU).
- Let Transformers.js select automatically via `dtype: 'auto'` where supported.

### 5.5 Licensing Audit Template

Copy this checklist for every new AI model added to Wyreup:

```
## Model License Audit

Model name:
HuggingFace ID:
Source paper / repo URL:

[ ] License identifier (SPDX): ___
[ ] License file URL verified (not just the model card badge): ___
[ ] Commercial use explicitly allowed? YES / NO / UNCLEAR
[ ] Attribution required? If YES, what text?
[ ] Redistribution allowed? (Does Wyreup bundle or just stream the weights?)
[ ] Dataset license checked (some models inherit dataset restrictions)?
    - Training data license: ___
    - Any non-commercial dataset clauses? YES / NO

Upstream dependencies (list all components with separate licenses):
- Component: ___, License: ___
- Component: ___, License: ___

RED FLAGS (auto-reject if any checked):
[ ] CC-BY-NC or similar non-commercial Creative Commons
[ ] GPL / LGPL / AGPL (viral — affects Wyreup code)
[ ] OpenRAIL-M with restrictive use clauses (check Attachment A of the license)
[ ] Research-only or academic-only language in license text
[ ] Stability AI SAI Community License (ambiguous — flag, do not auto-approve)
[ ] "Non-commercial" in README even if no formal license
[ ] License requires no-compete clauses or field-of-use restrictions

APPROVED by: ___
Date: ___
Notes: ___
```

---

## 6. Licensing Audit for Models Recommended in This Document

| Model | License | Commercial? | Gotchas |
|---|---|---|---|
| BiRefNet_lite (onnx-community) | MIT | Yes | None |
| Swin2SR (caidas/Xenova) | Apache 2.0 | Yes | None |
| Real-ESRGAN | BSD 3-Clause | Yes | None |
| LaMa (Carve/LaMa-ONNX) | Apache 2.0 | Yes | None |
| MediaPipe / tasks-vision | Apache 2.0 | Yes | None |
| GFPGAN | Apache 2.0 | Yes* | StyleGAN2 sub-components — conduct full upstream audit before shipping |
| TrOCR (Microsoft/Xenova) | MIT | Yes | None |
| CLIP ViT-B/16 (OpenAI/Xenova) | MIT | Yes | None |
| DDColor (piddnad) | Apache 2.0 | Yes | None |
| DeOldify | MIT | Yes | None |
| NAFNet (megvii) | Apache 2.0 | Yes | BasicSR dependency also Apache 2.0 |
| RMBG-2.0 (briaai) | CC-BY-NC 4.0 | **NO** | Rejected |
| CodeFormer (sczhou) | S-Lab License 1.0 | **NO** | Rejected |

---

*Sources cited throughout this document:*

- [Transformers.js v4 blog](https://huggingface.co/blog/transformersjs-v4)
- [Transformers.js GitHub releases](https://github.com/huggingface/transformers.js/releases/tag/4.0.0)
- [ORT Web WebGPU docs](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [ORT WebGPU launch blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/)
- [WebGPU hits critical mass](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/)
- [WebGPU 2026 stats](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/)
- [Firefox WebGPU status](https://zircon.tech/blog/webgpu-just-got-real-what-firefox-141-and-upcoming-safari-mean-for-ai-in-the-browser/)
- [MediaPipe face detector web](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js)
- [tasks-vision NPM](https://www.npmjs.com/package/@mediapipe/tasks-vision)
- [onnx-community/BiRefNet-ONNX](https://huggingface.co/onnx-community/BiRefNet-ONNX)
- [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)
- [RMBG-2.0 license discussion](https://huggingface.co/briaai/RMBG-2.0/discussions/12)
- [Xenova/swin2SR-classical-sr-x2-64](https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64)
- [onnx-community/swin2SR-realworld-sr-x4 ONNX](https://huggingface.co/onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX)
- [super-resolution-js demo](https://josephrocca.github.io/super-resolution-js/)
- [Real-ESRGAN GitHub / BSD-3](https://github.com/xinntao/Real-ESRGAN)
- [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX)
- [Client-side inpainting with LaMa](https://medium.com/@geronimo7/client-side-image-inpainting-with-onnx-and-next-js-3d9508dfd059)
- [LaMa GitHub](https://github.com/advimman/lama)
- [GFPGAN GitHub / Apache 2.0](https://github.com/TencentARC/GFPGAN)
- [HowToSD/GFPGAN-ONNX](https://huggingface.co/HowToSD/GFPGAN-ONNX)
- [CodeFormer GitHub / S-Lab license](https://github.com/sczhou/CodeFormer)
- [Xenova/trocr-small-handwritten](https://huggingface.co/Xenova/trocr-small-handwritten)
- [Xenova/clip-vit-base-patch16](https://huggingface.co/Xenova/clip-vit-base-patch16)
- [DDColor GitHub / Apache 2.0](https://github.com/piddnad/DDColor)
- [DDColor HF models](https://huggingface.co/piddnad/DDColor-models)
- [DeOldify GitHub / MIT](https://github.com/jantic/DeOldify)
- [DeOldify-on-Browser](https://github.com/akbartus/DeOldify-on-Browser)
- [NAFNet GitHub](https://github.com/megvii-research/NAFNet)
- [opencv/deblurring_nafnet](https://huggingface.co/opencv/deblurring_nafnet)
- [WebLLM GitHub](https://github.com/mlc-ai/web-llm)
- [WebNN adoption stats](https://almanac.httparchive.org/en/2025/generative-ai)
- [Transformers.js IndexedDB caching issue](https://github.com/huggingface/transformers.js/issues/900)
