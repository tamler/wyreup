# Pro tier expansion — design

Date: 2026-05-20
Status: approved, ready for implementation planning

## Context & goal

Wyreup's Pro tier currently ships 8 hosted-model tools (transcribe, 5 text
tools, bg-remove, upscale). The goal is to expand the catalog into something
worth paying for, without the catalog quality being capped by what a cheap
CPU box can run.

The breakthrough in this design: **Cloudflare Workers AI's model catalog is
far broader than assumed** — it includes vision/multimodal, embeddings,
image generation, translation, reranking, and object detection models, all
reachable through the existing zero-ops `env.AI` binding. That lets us ship
a substantial catalog expansion *now*, with no new infrastructure and no
dependency on any external team.

## Decisions

- **Phase 1 runs entirely on Workers AI.** No new infrastructure, no GPU
  box, no cold starts, no external-team dependency. Ships on our own
  timeline.
- **The GPU box is Phase 2** — an *improvement* lever, not a blocker. It
  hosts only what Workers AI genuinely cannot do (document-layout
  specialist, background-removal, upscaling). A separate team provisions a
  scale-to-zero GPU instance; Phase 1 does not wait on it.
- **No Groq.** Verified pricing: for our input-heavy text workloads Workers
  AI ties or beats Groq, and Workers AI Whisper ($0.03/hr) beats Groq turbo
  ($0.04/hr). Groq's edge (speed, output-heavy jobs) does not justify a
  second vendor, key, and failure mode. Filed for later: Groq's Orpheus TTS
  is a Phase-2 alternative to self-hosting TTS.
- **No CPU VPS.** Scale-to-zero GPU (Phase 2) removes its cost rationale.
- **Image generation is out of scope.** Available on Workers AI (Flux,
  SDXL) but deprioritized — not a selling point for a file-tools product.
- **Model-flow principle** (applies to Phase 2 GPU models): every hosted
  model is evaluated on tools-per-model. Launch each model as a *flow* of
  tools, not one tool — amortizes scale-to-zero cold starts.

## Phase 1 catalog — 8 new tools + the upgrade-seam

All on Workers AI via the existing `env.AI` binding. All Pro-gated (added
to the server-authoritative `PRICING` table).

### Vision flow — `@cf/meta/llama-3.2-11b-vision-instruct` (one model, 5 tools)

| Tool ID | Input → output | Extends | Credit cost (rough) |
|---|---|---|---|
| `ocr-hq` | image → text | free tesseract `ocr` | 2 |
| `image-describe` | image → text description / alt-text | paused `image-caption` | 2 |
| `analyze-chart` | chart image → text data + explanation | net-new (image category) | 2 |
| `image-q-and-a` | image + question → answer | net-new (image category) | 2 |
| `read-handwriting` | handwriting image → text | net-new (OCR family) | 2 |

### Object detection — `@cf/facebook/detr-resnet-50`

| Tool ID | Input → output | Extends | Credit cost (rough) |
|---|---|---|---|
| `detect-objects` | image → object list (labels + bounding boxes), optionally annotated image | net-new (image category) | 1 |

### Chain tools — combine models already in use

| Tool ID | Pipeline | Credit cost (rough) |
|---|---|---|
| `translate-image` | vision OCR (`llama-3.2-11b-vision`) → translate (`llama-3.3-70b`) | 3 |
| `transcribe-and-translate` | Whisper (`whisper-large-v3-turbo`) → translate (`llama-3.3-70b`) | 6 |

### LLM upgrade-seam — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

When the free heuristic tools `regex-from-text`, `cron-from-text`,
`sql-from-text` return a `no-match` result, the response already carries an
`upgrade` field (designed in roadmap §3). Phase 1 wires that field to an
LLM fallback that produces the answer the heuristic could not. Pro-gated,
~2 credits per fallback.

Credit costs are rough. `functions/_lib/pricing.ts` is server-authoritative
and trivially tunable; real numbers get calibrated against measured Workers
AI token/usage cost once the tools run on live traffic.

## Architecture — follow existing patterns

The existing Pro wiring (see `docs/pro-auth-spec.md`) is reused unchanged.
The reserve-then-refund ledger, rate limiting, and `POST /api/tools/pro/run`
endpoint already handle any tool present in `PRICING`. New tools slot into
four places:

1. **Provider wrapper** — new `functions/_lib/providers/vision-models.ts`,
   one file/one vendor like the existing `text-models.ts` /
   `audio-models.ts`. Exposes a public function (e.g. `vision(env, image,
   prompt)`) calling `env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct',
   …)`. A second small wrapper (or a function in the same file) covers
   `detr-resnet-50` for `detect-objects`.
2. **Server runner** — one async function per tool ID in
   `functions/_lib/runners.ts`, registered in the `RUNNERS` map. Validates
   the untrusted client `input`, calls the provider, returns plain JSON.
   Chain tools (`translate-image`, `transcribe-and-translate`) call two
   providers in sequence inside one runner.
3. **Pricing** — one entry per tool in `functions/_lib/pricing.ts`.
4. **Tool definition (client)** — one `ToolModule` per tool under
   `packages/core/src/tools/<id>/index.ts`, following `text-summarize-pro`:
   `cost: 'credit'`, `creditCost`, `input.accept` MIME types, `output.mime`,
   `chainSuggestions`, `paramSchema`, and a `run()` that calls `runPro`.

Input conventions (from `runners.ts`): images arrive as an https URL or a
`data:` URL; binary inputs are base64; every runner enforces a size cap so a
malicious caller cannot bypass the client check and burn margin. New vision
runners must set image-size caps the same way `transcribe-pro` caps audio.

### Chaining

Per the project's core goal, tool output MIME must feed downstream tools.
`ocr-hq`, `read-handwriting`, `translate-image` output `text/plain` →
chain into the text tools. `detect-objects` outputs JSON (and optionally an
annotated image). `image-describe` output feeds an alt-text / text chain.
`chainSuggestions` on each `ToolModule` must point at real downstream tools.

## Testing

- Each new `ToolModule` ships with `__testFixtures` like existing tools.
- Server runners: unit-test input validation (missing/oversized/malformed
  input throws) without calling Workers AI.
- Manual verification: run each tool end-to-end in the browser against the
  live `env.AI` binding via `wrangler pages dev`, with an admin-granted
  credit balance (LS not required — see below).

## Phase 1.5 — embeddings (deferred, small)

`@cf/qwen/qwen3-embedding-0.6b` is on Workers AI. An embeddings-powered tool
(`find-similar` / `semantic-dedupe`) is valuable but needs its own small UX
design — it is not just a model call. Slotted after Phase 1; not blocking.

## Phase 2 — GPU box (when the other team's infra lands)

Only what Workers AI cannot do:

- **Granite Docling** → `pdf-extract-structured`, `pdf-tables`,
  `pdf-to-markdown` (document-layout specialist).
- **Migrate `bg-remove-pro` / `upscale-2x-pro`** off Replicate to the GPU —
  pure cost optimization; they keep working on Replicate until then, so
  this is low-priority.
- **VLM / OCR bake-off** — test GPU specialist models (PaddleOCR-VL, a
  specialist VLM) against the Workers AI vision model on real samples;
  swap in a specialist only where Workers AI quality disappoints.

Infrastructure shape for the other team: scale-to-zero GPU, weights baked
for fast cold start, a cold-start budget as an explicit requirement, one
shared bearer secret between Pages Functions and the box, Cloudflare-IP
allowlist as defense-in-depth. Provider abstraction means a Phase-2
backend swap is a new file under `functions/_lib/providers/`.

## Gating & launch readiness

- All new tools are Pro-gated: presence in `PRICING` triggers the
  server-side credit check in `run.ts`.
- The Pro **gate** (auth, API keys, sessions, credit ledger, balance
  checks, refund-on-failure) is fully implemented and does **not** depend
  on Lemon Squeezy.
- What is pending is **LS account configuration**, not code: `LS_API_KEY`,
  `LS_STORE_ID`, `LS_WEBHOOK_SECRET` are still empty in `.dev.vars`. LS only
  enables self-serve credit *purchasing*.
- Consequence: Phase 1 tools can be exercised and soft-launched immediately
  via admin-granted credits, before LS is configured.

## Out of scope

- Image generation (Flux/SDXL) — available on Workers AI, deliberately not
  built.
- Groq as a vendor.
- CPU VPS.
- omnisearch / search engine — Phase B net-new category, decided on signal;
  would need a persistent box, not scale-to-zero.
- `classify-image` (resnet-50) — weaker than the VLM's `image-describe`.

## Open items

- **Speaker diarization**: verify whether Workers AI's Deepgram `nova-3`
  exposes diarization. If yes, `transcribe-with-speakers` is a strong
  fast-follow tool.
- **Credit cost calibration**: rough costs above get tuned against measured
  Workers AI usage once tools are on live traffic.
