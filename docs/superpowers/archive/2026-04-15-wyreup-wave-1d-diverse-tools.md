# Wyreup — Wave 1d: Diverse Tools Batch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add 5 tools spanning different libraries: `color-palette` (node-vibrant), `qr` (qr-code-styling), `watermark-pdf` (pdf-lib), `pdf-to-text` (pdfjs-dist), `image-diff` (pixelmatch + jSquash). Each follows the established tool-module pattern. After this wave, `@wyreup/core` has **14 tools**.

**Preceding plan:** Wave 1c (tagged `v0.1.0-wave1c`).

**Out of scope:** html-to-pdf and compress-pdf (bigger), heic-to-jpg (needs LGPL policy confirmation), protect-pdf/unlock-pdf (need different library), any canvas-using tools.

---

## Dependencies to install

```bash
pnpm --filter @wyreup/core add node-vibrant@^4.0.0 qr-code-styling@^1.9.0 pdfjs-dist@^5.6.0 pixelmatch@^7.1.0
```

Verify each resolves. If any package fails to install or the API has changed significantly from the plan, report and adjust.

---

## Tool specs

### `color-palette`

- **Id:** `color-palette`
- **Category:** `inspect`
- **Purpose:** Extract dominant colors from an image as hex codes.
- **Input:** image/jpeg, image/png, image/webp. Min 1, max 1.
- **Output:** `application/json` — a JSON blob with the palette (since this is inspect, not edit).
- **Params:** `{ count?: number }` — number of colors to extract, default 5.
- **Memory:** low.
- **Implementation:** decode via jSquash (reuse codec loader), pass ImageData-like structure to node-vibrant.

```ts
interface ColorPaletteParams {
  /** Number of colors to extract. Default 5. */
  count?: number;
}
interface ColorPaletteResult {
  vibrant: string | null;
  muted: string | null;
  darkVibrant: string | null;
  darkMuted: string | null;
  lightVibrant: string | null;
  lightMuted: string | null;
  topColors: string[]; // top N by population
}
```

Return a `Blob` containing `JSON.stringify(result)` with type `application/json`.

**Note on node-vibrant:** node-vibrant v4 uses an ImageData-compatible API. Call it with an object like `{ data, width, height }` (from jSquash's decode). If v4's API differs, consult its README.

### `qr`

- **Id:** `qr`
- **Category:** `create`
- **Purpose:** Generate styled QR codes with optional embedded image.
- **Input:** Minimum 0 files (text-based). If a file is supplied, it's used as the embedded logo image.
- **Output:** image/png (single).
- **Params:** `{ text: string, size?: number, foregroundColor?: string, backgroundColor?: string }`.
- **Memory:** low.
- **Implementation:** `qr-code-styling` supports both browser and Node. In Node, use the `nodeCanvas` option from `qr-code-styling/lib/core/QRCodeStyling`. The simplest path: use its SVG output, then convert SVG to PNG via... hmm, SVG to PNG needs canvas or a converter.

**Alternative simpler implementation:** use a lighter library `qrcode` (MIT, pure JS, generates PNG directly without canvas). Install `qrcode@^1.5.3` if qr-code-styling's Node story is awkward.

If qr-code-styling works cleanly in Node: use it with logo embedding.
If not: fall back to `qrcode` library (simpler, no logo embedding in v1), document the limitation, plan to upgrade later.

### `watermark-pdf`

- **Id:** `watermark-pdf`
- **Category:** `pdf`
- **Purpose:** Add a text or image watermark to every page of a PDF.
- **Input:** application/pdf. Min 1, max 1.
- **Output:** application/pdf.
- **Params:**
```ts
interface WatermarkPdfParams {
  /** 'text' or 'image'. Default 'text'. */
  mode: 'text' | 'image';
  /** Text to stamp when mode is 'text'. Required for text mode. */
  text?: string;
  /** Data URL or ArrayBuffer for the image when mode is 'image'. Required for image mode. */
  imageBuffer?: ArrayBuffer;
  /** Image MIME type when mode is 'image'. 'image/jpeg' or 'image/png'. */
  imageMime?: 'image/jpeg' | 'image/png';
  /** Opacity, 0-1. Default 0.3. */
  opacity?: number;
  /** Font size in points when mode is 'text'. Default 48. */
  fontSize?: number;
  /** Rotation in degrees. Default -45 (diagonal). */
  rotation?: number;
  /** Color as CSS hex string. Default '#888888' for text. */
  color?: string;
}
```
- **Implementation:** pdf-lib. For each page: embed font (text) or embed image. Compute center position. Draw with rotation and opacity.
- **Memory:** low.

### `pdf-to-text`

- **Id:** `pdf-to-text`
- **Category:** `export`
- **Purpose:** Extract plain text from a PDF.
- **Input:** application/pdf. Min 1, max 1.
- **Output:** `text/plain`.
- **Params:** `{ separator?: string }` — page separator, default `\n\n=== Page {n} ===\n\n`.
- **Implementation:** pdfjs-dist with its worker. In Node, set `GlobalWorkerOptions.workerSrc` to the installed worker path (use `createRequire` to resolve `pdfjs-dist/build/pdf.worker.mjs` or similar).
- **Memory:** medium (pdfjs-dist loads the whole PDF into memory).

**Gotcha:** pdfjs-dist worker setup is the tricky part. Steps:
1. `import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'` (legacy build works in Node; the standard build assumes browser).
2. Set `GlobalWorkerOptions.workerSrc` to the worker path.
3. Load the PDF: `const pdf = await getDocument({ data: buffer }).promise`.
4. For each page: `const page = await pdf.getPage(i); const content = await page.getTextContent(); const text = content.items.map(it => it.str).join(' ');`.

If the worker setup proves complex in Node, document any failures and try the `pdfjs-dist/legacy` entry which has better Node support.

### `image-diff`

- **Id:** `image-diff`
- **Category:** `inspect`
- **Purpose:** Pixel-level diff between two images of the same dimensions.
- **Input:** image/jpeg, image/png, image/webp. Min 2, max 2.
- **Output:** `image/png` (diff visualization) + `application/json` metadata. Declare `output.mime: 'image/png'` and `output.multiple: true`; return `[diffImageBlob, metadataJsonBlob]`.
- **Params:**
```ts
interface ImageDiffParams {
  /** Pixel threshold, 0-1. Default 0.1. Higher = more tolerance. */
  threshold?: number;
  /** Color of diff highlights (RGB tuple). Default [255, 0, 0]. */
  diffColor?: [number, number, number];
}
```
- **Implementation:** decode both images via jSquash. If dimensions differ, throw with a clear message. Call pixelmatch with the two pixel buffers + an output buffer. Encode the output as PNG via jSquash. Return both the PNG and a JSON summary blob:
```ts
interface ImageDiffResult {
  pixelsDifferent: number;
  totalPixels: number;
  percentDifferent: number;
}
```

---

## Task 1: Install dependencies

```bash
pnpm --filter @wyreup/core add node-vibrant@^4.0.0 qr-code-styling@^1.9.0 pdfjs-dist@^5.6.0 pixelmatch@^7.1.0
```

If `pdfjs-dist@^5.6.0` is not available (version may have drifted), use the latest `^5.x`. If that fails, use `^4.x`. Document the actual installed version in the commit message.

Commit: `feat(core): add node-vibrant, qr-code-styling, pdfjs-dist, pixelmatch`

---

## Task 2–6: Implement each tool (follow the Wave 1b/1c pattern)

For each of the 5 tools:
1. Create `packages/core/src/tools/<id>/types.ts` with the params interface and defaults.
2. Write the TDD test file at `packages/core/test/tools/<id>/<id>.test.ts` with:
   - Metadata tests (id, category, input.accept, memoryEstimate, etc.)
   - 3–5 behavior tests (happy path, batch if applicable, error paths)
3. Run tests — confirm failure.
4. Implement `packages/core/src/tools/<id>/index.ts` exporting the ToolModule.
5. Run tests — confirm pass.
6. Commit with message like `feat(core): <tool-id> tool (<library>)`.

### Test fixtures note

- color-palette can use `photo.jpg` — verify it returns a non-null vibrant color.
- qr needs no file fixture; test with text input.
- watermark-pdf uses `doc-a.pdf` or `doc-multipage.pdf`.
- pdf-to-text uses `doc-a.pdf` (which has known text "Document A" and "This is a fixture PDF").
- image-diff needs two images of the same dimensions. The easiest approach: load `photo.jpg` twice (should show 0% diff), or compress `photo.jpg` to a slightly-different quality and use that as the second input.

### Specific test expectations

**color-palette:** Verify result is a parseable JSON blob with at least `topColors` being an array of hex color strings.

**qr:** Verify output is a valid PNG (starts with `0x89 P N G`). Verify it contains SOME data (size > 100 bytes).

**watermark-pdf:** Verify output is a valid PDF, size > input size (watermark adds bytes).

**pdf-to-text:** Verify output text contains "Document A" (from the fixture). Verify output is type `text/plain`.

**image-diff:** Verify two identical images give `pixelsDifferent: 0`. Verify two different images give `pixelsDifferent > 0`.

---

## Task 7: Update default registry + exports

Add all 5 tools to `default-registry.ts` and `index.ts`. Update `default-registry.test.ts` with 5 new "includes <tool-id>" tests.

Commit: `feat(core): register wave 1d tools in default registry`

---

## Task 8: End-to-end verification and tag

- [ ] Full build, test, CI checks all pass
- [ ] Tag: `v0.1.0-wave1d`
- [ ] Push to origin/main

---

## Exit criteria

- All 5 tools implemented OR documented as BLOCKED/DEFERRED with specific reasons
- Tests pass (~150+ total)
- CI checks green
- Tag pushed

## Fallback guidance

If a tool is genuinely unworkable (library doesn't work in Node, API has drifted significantly, too complex to implement without re-planning):
- DEFER the tool with a README in its folder
- Continue with the others
- Do not ship a stub that doesn't work

Ship what works. Defer what doesn't. Report clearly.
