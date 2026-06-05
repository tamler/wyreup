# Media tools expansion — design spec

**Date:** 2026-06-04
**Branch:** `feat/media-tools-expansion`
**Status:** approved (scope), pending implementation

## Origin

Evaluation of external projects for fit with wyreup's ffmpeg.wasm tool platform:

- [ffmpeg-webCLI](https://github.com/tejaswigowda/ffmpeg-webCLI) — browser ffmpeg editor (GPL-3.0)
- [easyVmaf](https://github.com/gdavila/easyVmaf), [psy-ex/metrics](https://github.com/psy-ex/metrics), [ffmpeg-quality-metrics](https://github.com/slhck/ffmpeg-quality-metrics) — video quality metrics
- [Ardour loudness analyzer/normalizer](https://manual.ardour.org/mixing/basic-mixing/loudness-analyzer-and-normalizer/) — EBU R128 loudness

**Key finding:** wyreup already runs the identical engine (`@ffmpeg/core-mt@0.12.6` via CDN). No engine or code to import (and GPL/research licenses bar code reuse anyway). Value is a shopping list of *operation gaps*, each expressible as a native typed tool. VMAF is the one capability our wasm core can't do (needs `libvmaf`, not compiled in — same class of constraint as a missing external lib).

## Conventions (all tools follow the existing `video-*` template)

- `src/tools/<slug>/index.ts` exports a `ToolModule` + pure helper functions (arg-builders, parsers) + `defaults` + a params interface.
- Registered in `src/default-registry.ts` (import + array entry); re-exported from `src/index.ts`.
- Test in `test/tools/<slug>/<slug>.test.ts`: metadata assertions + pure-function tests. `run()` is skipped in Node (ffmpeg.wasm needs SharedArrayBuffer + CDN).
- Metadata for ffmpeg tools: `category: 'media'`, `cost: 'free'`, `installGroup: 'ffmpeg'`, `installSize: 30_000_000`, `memoryEstimate: 'high'`, `batchable: false`, `interactive: true`, `sizeLimit: 500 * 1024 * 1024`.
- ffmpeg accessed via `getFFmpeg(ctx)` from `lib/ffmpeg.js`; container-preserving ops reuse `getExtFromFile`/`getMimeFromFile`/`runFFmpeg` (see `trim-media`).

## Tools to build (8)

### Editing (5)

| # | Tool | Input → Output | Params | ffmpeg recipe (pure `buildXArgs`) |
|---|---|---|---|---|
| 1 | `resize-video` | video → `video/mp4` | `width?`, `height?`, `crf` (0–51, def 23) | `-vf scale=W:H` where a blank dimension becomes `-2` (preserve aspect, even-dimension safe); `-c:v libx264 -crf <crf> -preset fast -c:a copy`. Require ≥1 of width/height (throw otherwise). |
| 2 | `mute-video` | video → `*/*` (preserve container) | none | `-c copy -an`. Stream-copy; reuse `getExtFromFile`/`getMimeFromFile`. |
| 3 | `rotate-video` | video → `video/mp4` | `mode`: `90cw\|90ccw\|180\|flip-h\|flip-v\|flip-both` | filter map: `transpose=1` / `transpose=2` / `transpose=1,transpose=1` / `hflip` / `vflip` / `hflip,vflip`; `-c:v libx264 -crf 23 -preset fast -c:a copy`. |
| 4 | `extract-frame` | video → `image/png` \| `image/jpeg` | `timestamp` (sec, def 0), `format`: `png\|jpeg` (def png) | `-ss <ts> -i input -vframes 1 output.<fmt>`. Output mime via FORMAT_MIME map (see `convert-video`). |
| 5 | `replace-audio` | **2 inputs** (video + audio) → `video/mp4` | none | `-i <video> -i <audio> -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest`. Inputs sorted by MIME (video vs audio); throw if not exactly one of each. |

### Measurement (3) — leaf/inspection tools (output reports, not media)

| # | Tool | Input → Output | Params | Recipe + pure functions |
|---|---|---|---|---|
| 6 | `normalize-loudness` | audio or video → `*/*` (preserve container) | `preset`: `ebu-r128\|atsc-a85\|spotify\|apple-music\|youtube\|amazon` (def `spotify`) | Single-pass `loudnorm` (EBU R128) for v1 — deterministic, no log round-trip. Targets from preset table below. Video: `-c:v copy -af loudnorm=...`; audio: `-af loudnorm=...`. `buildLoudnormArgs(preset, hasVideo)` is pure. |
| 7 | `analyze-loudness` | audio or video → `application/json` | none | `-af ebur128 -f null -`; capture ffmpeg log via `ff.on('log', …)`; `parseEbur128Summary(log)` (pure) → `{ integratedLufs, loudnessRange, truePeakDbtp, threshold }`. |
| 8 | `video-quality-metrics` | **2 inputs** (reference, distorted) → `application/json` | `metrics`: subset of `psnr`, `ssim` (def both) | `inputs[0]`=reference, `inputs[1]`=distorted. `-lavfi "[0:v][1:v]scale2ref...;psnr;ssim"` (distorted auto-scaled to reference). Capture log; `parseQualityMetrics(log)` (pure) → `{ psnr: {...}, ssim: {...} }`. |

**Loudness preset targets** (integrated LUFS / true-peak dBTP), from the Ardour table:

| preset | LUFS (I) | TP (dBTP) |
|---|---|---|
| `ebu-r128` | −23 | −1.0 |
| `atsc-a85` | −24 | −2.0 |
| `spotify` | −14 | −1.0 |
| `apple-music` | −16 | −1.0 |
| `youtube` | −14 | −1.0 |
| `amazon` | −14 | −2.0 |

`loudnorm` LRA target fixed at 11 (broadcast default). v1 is single-pass; two-pass (measure then apply) is a future accuracy improvement noted in the tool's code comment.

## TDD seams (pure functions tested in Node)

- `buildResizeArgs`, `buildRotateArgs`, `buildExtractFrameArgs`, `buildReplaceAudioArgs`, `buildLoudnormArgs` — arg-builders.
- `parseEbur128Summary`, `parseQualityMetrics` — log parsers, tested against captured sample log strings.
- `mute-video` has no params; tested via metadata + the shared `runFFmpeg` arg shape.

## Roadmap (not built here)

Added to `docs/ROADMAP.md`:

1. **VMAF (Pro candidate).** Needs `libvmaf` + Netflix model files, absent from `@ffmpeg/core-mt`. Paths: (a) host a custom `@ffmpeg/core-vmaf` wasm (bigger binary + model JSON, second install group); (b) server/Pro metric (paid backend → Pro per pricing policy). Bundle easyVmaf-style preprocessing (deinterlace / scale / framerate / frame-sync) with whichever path is chosen.
2. **PWA / offline / wake-lock** (`packages/web`). Service-worker caching of the ffmpeg-core wasm (~31 MB) + static assets for offline reuse; installable PWA manifest; Screen Wake Lock during long encodes. Natural hook: we already fetch ffmpeg-core from CDN via `@ffmpeg/util`.

## Declined

- **Raw ffmpeg command box** — breaks the typed/chainable model; not runnable on CLI/MCP cleanly.
- **PiP overlay upgrade** to `video-overlay-image` (scaled video inset) — deferred.
- **psy-ex/metrics** (SSIMULACRA2 / Butteraugli / CVVDP / XPSNR via GPU FFVship) — research-grade, GPU-bound, off-model; revisit only with own-GPU-infra.

## Release

One changeset, `minor` bump for `@wyreup/core` / `@wyreup/cli` / `@wyreup/mcp` (new consumable tools).
