# Spec: AI-powered PDF form field detection (CommonForms)

**Status:** Approved scope, implementation in a follow-up session.
**Drafted:** 2026-05-24.
**Roadmap entry:** "CommonForms — auto-detect form fields in PDFs."

---

## Goal

Ship a free in-browser tool that takes a PDF and produces a **fillable
PDF** — interactive AcroForm fields auto-placed where a paper form has
blanks, checkboxes, signature lines, and other interactive widgets. The
canonical "make this PDF fillable" problem that none of our 20+ existing
PDF tools solve, and that drives users to upload-required SaaS today.

License is clear (FFDNet is Apache 2.0 per huggingface.co/jbarrow/FFDNet-
S-cpu). Model is purpose-built. We have every dep we need already in
@wyreup/core. The pipeline is real engineering but well-bounded.

---

## Model choice

Two viable variants live on HuggingFace, both Apache 2.0:

| Model | Repo | ONNX size | Trade-off |
|---|---|---|---|
| **FFDNet-S-cpu** | `jbarrow/FFDNet-S-cpu` | ~57 MB | Smaller download, faster cold start, good enough on common forms |
| FFDNet-L-cpu | `jbarrow/FFDNet-L-cpu` | ~101 MB | Higher accuracy on dense layouts; bigger download |

**Pick: FFDNet-S** for v1. Matches the install-group story for other
ONNX models (bg-remove, ocr-pro) at ~50 MB tiers. Users with accuracy
complaints can opt into FFDNet-L in a later iteration.

**Skipped: FFDetr.** The newer architecture (`jbarrow/FFDetr`,
RF-DETR-based) only ships `.pth` PyTorch weights — no ONNX export yet.
Revisit when an ONNX is published; until then FFDNet-S is the right
shipping choice.

**Model hosting.** Mirror to `models.wyreup.com` (our R2 bucket) so
first-tool-use doesn't depend on HuggingFace's bandwidth. Use the
existing `setModelCdn()` plumbing in `@wyreup/core` — same pattern as
the transformers.js models. The HuggingFace URL stays as a fallback
when `WYREUP_MODEL_CDN=disabled`.

---

## Pipeline architecture

```
PDF input
   │
   ▼
[pdfjs-dist] render each page → ImageData / OffscreenCanvas
   │           (dpi: 150, configurable; matches FFDNet training)
   ▼
[image preprocess] resize → 1024×1024 (model input size) + normalize
   │                ── keep transform matrix M (img→pdf)
   ▼
[onnxruntime-web] FFDNet-S inference on each page
   │                outputs: boxes [N, 4] + scores [N] + classes [N]
   ▼
[postprocess] NMS, score threshold (0.5 default), class map:
   │             0 = text_input
   │             1 = checkbox
   │             2 = radio
   │             3 = signature
   │             4 = dropdown   (if model emits — confirm in v1 testing)
   ▼
[coordinate transform] image-space box → PDF user units via M⁻¹
   │                    (handles page rotation, DPI scaling, origin flip)
   ▼
[@cantoo/pdf-lib] open original PDF, add AcroForm widgets at those
   │              coords with auto-generated names (field_001, field_002,
   │              ...) and the detected type
   ▼
Output: fillable PDF (same content + interactive fields)
```

Every stage's library is already in `packages/core` deps. No new
dependencies needed.

---

## Tool shape

**ID:** `pdf-make-fillable` (or `pdf-auto-form-fields` — bikeshed in
implementation)

**Category:** `pdf`
**Cost:** free
**Memory estimate:** `medium` (ONNX inference + PDF rendering)
**Requires:** `webgpu: 'preferred'` (ONNX runs on WASM fallback too, just
slower)

**Input:** `application/pdf`, single file, sizeLimit 50 MB
**Output:** `application/pdf`

**Params:**
- `threshold` (range, 0.1–0.9, default 0.5) — detection confidence cutoff
- `pages` (string, optional) — page range (`1-5`, `1,3,5`); default all
- `addLabels` (boolean, default true) — auto-name fields from any nearby
  text via pdfjs's text layer; otherwise generic `field_NNN`
- `dpi` (range, 72–300, default 150) — render DPI; higher = better
  detection but slower

**Chain story:** Pairs naturally with `pdf-redact` (sanitize before
making fillable), `pdf-encrypt` (lock after), `pdf-form-fields` (inspect
the detected fields), `pdf-flatten` (un-fillable counterpart).

---

## MVP cut decisions

To bound the first session of implementation:

- **Text inputs + checkboxes only** in v1. Radio groups, signatures,
  dropdowns deferred to v2 once we see real-world inputs and the
  AcroForm-creation patterns for those types in pdf-lib.
- **Auto-generated field names** (`field_001`, `field_002`, ...) only.
  Pdfjs text-layer-driven labels deferred to v2 — non-trivial to map
  "the word to the left of this checkbox is the label" reliably.
- **No multi-page form continuity.** Each page is independent. v2 could
  detect "this is the same group of fields across pages" and link them.
- **Whole-PDF only, no page range.** Add range param in v2.

This gets us to "drop PDF, get usably fillable PDF" — the headline
pitch — without the long tail of edge cases.

---

## Open design questions (to resolve at implementation start)

1. **Coordinate transform precision.** PDF user units, image pixels, and
   pdfjs's viewport scale don't perfectly align. Need a small test
   harness with known-position fields to validate the transform before
   building the full pipeline. ~30 min spike at the start of the
   implementation session.

2. **AcroForm vs XFA.** pdf-lib creates AcroForm widgets (the older,
   more compatible standard). Some forms are XFA. v1 = AcroForm only;
   XFA detection + a friendly "this is an XFA form, AcroForm widgets
   may not work in all readers" warning is a v1.1 polish.

3. **Existing form detection.** If the PDF already has form fields,
   should we (a) refuse / warn, (b) replace, (c) augment? v1 default:
   refuse with `'PDF already has form fields — use pdf-form-fields to
   inspect them.'` Less surprising for the user.

4. **NMS thresholds.** The detection model returns redundant boxes; NMS
   IoU threshold matters for clean output. Standard value (0.5) is the
   starting point; needs visual eval against a few real forms.

5. **Inference performance.** Per-page inference time at 1024×1024 on a
   modern laptop CPU is ~1 sec. A 20-page PDF = 20 sec. Acceptable for
   the use case but worth a progress bar. WebGPU acceleration via
   onnxruntime-web should drop this 5–10×; mark `requires.webgpu:
   'preferred'`.

---

## Tests

- Unit: coordinate transform (image px ↔ PDF user units) against
  hand-crafted matrices with known rotations and DPIs.
- Unit: NMS implementation on synthetic boxes.
- Integration: feed a known PDF (e.g. an IRS W-9 PDF without fields)
  through the pipeline, assert that the output PDF has interactive
  fields, that the count matches the expected number ±20%, and that the
  fields are roughly where we expect.
- Snapshot: visual regression test would be nice but probably
  overkill for v1.

---

## Estimated effort

- Coordinate-transform spike: 30 min
- ONNX model loading + first-pass inference: 1 hour
- Postprocess + NMS + class mapping: 1 hour
- pdf-lib AcroForm field creation: 1.5 hours
- Tool module + paramSchema + tests: 1 hour
- Verification on 3–5 real-world PDFs + tweaks: 1 hour

**Total: ~6 hours.** Single focused session is the right shape — too
much context to split across two without re-warming each time.

---

## Out of scope

- **FFDetr** (newer model, .pth only). Revisit when ONNX exports.
- **FFDNet-L** (~100 MB). Ship FFDNet-S first; offer L as a `accuracy:
  'high'` param later if signal warrants.
- **XFA form handling.** AcroForm only in v1.
- **Custom field labels from PDF text layer.** Field names auto-
  generated in v1.
- **Multi-page form linking.** Each page detected independently in v1.
- **CommonForms training pipeline.** We use the released checkpoint; we
  don't fine-tune.
