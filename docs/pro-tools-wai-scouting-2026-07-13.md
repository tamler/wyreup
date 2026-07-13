# Quality-only Pro jobs on Workers AI — scouting decision (2026-07-13)

Constraint from the operator: Cloudflare Workers AI models only, 50% margin
floor stands, quality-first framing (never pitch on price).

| Job | WAI feasibility | Decision |
|---|---|---|
| Translate a whole document | m2m100-1.2b ($0.342/M tokens each way) + local PDF text extraction already in the stack. 40-page doc ≈ $0.025 COGS; 3 credits ≈ $0.068 revenue → 63% worst-case margin, 85%+ typical. Top traffic (PH/TH) is multilingual — direct fit. | **BUILD NOW** (`translate-document-pro`, 3 credits, 40-page cap) |
| Remove an object from a photo | `stable-diffusion-v1-5-inpainting` exists; cost is pennies. Two risks: SD1.5-era quality is not magic-eraser grade, and it needs a mask-drawing canvas (new interactive runner). | **PROTOTYPE NEXT** — quality spike behind a gate before any public tool |
| Restore an old photo | No restoration/enhancement model in the WAI catalog. img2img (SD1.5) would be unpredictable — fails the wow bar the quality story depends on. | **PARKED** until WAI adds a restoration-class model (or the Replicate constraint lifts) |
| Colorize a black-and-white photo | No colorization model on WAI. | **PARKED** (same trigger) |

Pricing reference: credits sell at ~$0.020–0.023; neurons at $0.011/1k;
whisper $0.0005/min; flux ~$0.015/MP. Free daily allocation 10k neurons.

Revisit triggers: WAI catalog additions (watch for restoration/upscale/
colorize models), or an operator decision to allow Replicate for GPU img2img
(margins previously validated ≥50% for Real-ESRGAN-class work).
