# Wyreup — Wave 1b: More Core Tools (convert, strip-exif, image-to-pdf, merge-pdf)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four more tools to `@wyreup/core` following the compress pattern established in Wave 1a. After this wave, `@wyreup/core` has 5 working tools: compress, convert, strip-exif, image-to-pdf, merge-pdf. All are pure WASM/math — no canvas or model downloads required.

**Architecture:** Reuse the jSquash codec loader for format-converting tools (convert, strip-exif). Install pdf-lib for PDF-producing tools (image-to-pdf, merge-pdf). Every tool follows the same shape: `packages/core/src/tools/<id>/` folder with `types.ts` + `index.ts`, tests in `packages/core/test/tools/<id>/`, real fixtures in `packages/core/test/fixtures/`, registered in `default-registry.ts`.

**Tech stack additions:** `pdf-lib@^1.17.1` (MIT, frozen 2022 but feature-complete).

**Source spec:** `docs/superpowers/specs/2026-04-15-wyreup-tool-library-design.md` §3.1, §5.1.

**Preceding plan:** Wave 1a (tagged `v0.1.0-wave1a`).

**Out of scope:** Canvas-requiring tools (crop/resize/rotate/watermark/filters), model-based tools (blur-faces/remove-background), HEIC (LGPL license decision separately), web pages, MCP/CLI wiring, deployment.

---

## Exit criteria

1. `@wyreup/core` exports `convert`, `stripExif`, `imageToPdf`, `mergePdf` tool modules.
2. `createDefaultRegistry()` includes all 5 tools (compress + new 4).
3. Each tool has TDD tests with real fixtures; all pass.
4. All CI checks still green (isolation, privacy, bundle size).
5. Dual browser/node build still works.
6. Tagged `v0.1.0-wave1b`, pushed to origin/main.

---

## Tool specifications

### `convert`

- **Id:** `convert`
- **Purpose:** Re-encode an image from one format to another (JPEG ↔ PNG ↔ WebP).
- **Input:** `image/jpeg`, `image/png`, `image/webp`. Min 1 file.
- **Output:** `image/*` per file, multiple.
- **Params:** `{ targetFormat: 'jpeg' | 'png' | 'webp', quality?: number }` (quality only meaningful for jpeg/webp, default 90).
- **Category:** `convert`.
- **Memory:** `low`.
- **Implementation:** Very similar to compress — use `detectFormat`, `getCodec`, decode from source codec, encode with target codec. Must handle JPEG↔PNG (lossless→lossy and vice versa).
- **Fixtures:** Reuse `photo.jpg`, `graphic.png`, `photo.webp`, `corrupted.jpg`.

### `stripExif` (id: `strip-exif`)

- **Id:** `strip-exif`
- **Purpose:** Remove EXIF metadata from images by re-encoding at near-lossless quality (95). Simplest working implementation; true byte-preserving strip can be a future enhancement.
- **Input:** `image/jpeg`, `image/png`, `image/webp`. Min 1 file.
- **Output:** Same format as input.
- **Params:** `{}` (no user-facing params; quality fixed at 95 internally).
- **Category:** `privacy`.
- **Memory:** `low`.
- **Implementation:** decode with jSquash → encode at quality 95. The decode step drops EXIF metadata because jSquash's decoded buffer is raw pixel data with no metadata. The re-encoded output has no EXIF.
- **Note in tool description:** "Strips EXIF metadata including GPS location, camera model, and timestamps. Image is re-encoded at near-lossless quality."

### `imageToPdf` (id: `image-to-pdf`)

- **Id:** `image-to-pdf`
- **Purpose:** Combine one or more images into a single PDF, one image per page.
- **Input:** `image/jpeg`, `image/png`. Min 1. (WebP not supported by pdf-lib's embedImage — document this limitation.)
- **Output:** One `application/pdf`.
- **Params:** `{ pageSize?: 'auto' | 'a4' | 'letter', margin?: number }` (default auto — each page sized to the image).
- **Category:** `export`.
- **Memory:** `low`.
- **Implementation:** use `pdf-lib`. For each input, embed as a page. Return one Blob.
- **Fixtures:** Reuse existing jpg/png. Output is a PDF; test by checking header bytes start with `%PDF-`.

### `mergePdf` (id: `merge-pdf`)

- **Id:** `merge-pdf`
- **Purpose:** Combine multiple PDF files into one PDF.
- **Input:** `application/pdf`. Min 2 files.
- **Output:** One `application/pdf`.
- **Params:** `{}` (no user-facing params).
- **Category:** `pdf`.
- **Memory:** `low`.
- **Implementation:** use `pdf-lib`. Load each PDF, copy pages into a new document, save.
- **Fixtures:** Generate two minimal PDF fixtures (one-page PDFs via pdf-lib in the fixture-generation step).

---

## Task 1: Install pdf-lib and create PDF fixtures

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/test/fixtures/doc-a.pdf`
- Create: `packages/core/test/fixtures/doc-b.pdf`
- Modify: `packages/core/test/fixtures/README.md`

- [ ] **Step 1: Install pdf-lib**

```bash
pnpm --filter @wyreup/core add pdf-lib@^1.17.1
```

- [ ] **Step 2: Generate two PDF fixtures**

Create a one-off fixture generator and run it from `packages/core/`:

```bash
cat > /tmp/gen-pdf.mjs << 'EOF'
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function make(title, outPath) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]); // A4
  page.drawText(title, { x: 50, y: 780, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('This is a fixture PDF.', { x: 50, y: 740, size: 12, font });
  const bytes = await doc.save();
  writeFileSync(outPath, bytes);
  console.log(outPath, bytes.length, 'bytes');
}

await make('Document A', 'packages/core/test/fixtures/doc-a.pdf');
await make('Document B', 'packages/core/test/fixtures/doc-b.pdf');
EOF
node /tmp/gen-pdf.mjs
```

Expected: both PDFs created, typically 1-3 KB each.

- [ ] **Step 3: Update fixtures README**

Append to `packages/core/test/fixtures/README.md`:
```markdown

- `doc-a.pdf` — minimal A4 PDF with title "Document A"
- `doc-b.pdf` — minimal A4 PDF with title "Document B"
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/test/fixtures
git commit -m "feat(core): add pdf-lib dependency and PDF test fixtures"
```

---

## Task 2: Implement `convert` tool

**Files:**
- Create: `packages/core/src/tools/convert/types.ts`
- Create: `packages/core/src/tools/convert/index.ts`
- Create: `packages/core/test/tools/convert/convert.test.ts`

- [ ] **Step 1: Create `packages/core/src/tools/convert/types.ts`**

```ts
import type { ImageFormat } from '../../lib/codecs.js';

export interface ConvertParams {
  /** Target format. Required. */
  targetFormat: ImageFormat;
  /** Output quality, 1-100. Only meaningful for jpeg/webp. Default 90. */
  quality?: number;
}

export const defaultConvertParams: ConvertParams = {
  targetFormat: 'webp',
  quality: 90,
};
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/tools/convert/convert.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { convert } from '../../../src/tools/convert/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('convert — metadata', () => {
  it('has id "convert" and category "convert"', () => {
    expect(convert.id).toBe('convert');
    expect(convert.category).toBe('convert');
  });

  it('accepts image MIME patterns', () => {
    expect(convert.input.accept).toContain('image/jpeg');
    expect(convert.input.accept).toContain('image/png');
    expect(convert.input.accept).toContain('image/webp');
  });

  it('has defaults with targetFormat webp', () => {
    expect(convert.defaults.targetFormat).toBe('webp');
  });
});

describe('convert — run()', () => {
  it('converts JPEG to PNG', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await convert.run([input], { targetFormat: 'png' }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/png');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('converts PNG to JPEG', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await convert.run([input], { targetFormat: 'jpeg', quality: 85 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/jpeg');
  });

  it('converts PNG to WebP', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await convert.run([input], { targetFormat: 'webp' }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/webp');
  });

  it('processes multiple files in batch', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');
    const outputs = await convert.run([a, b], { targetFormat: 'webp' }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(2);
    expect(blobs[0]!.type).toBe('image/webp');
    expect(blobs[1]!.type).toBe('image/webp');
  });

  it('throws for unsupported input type', async () => {
    const fakePdf = new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' });
    await expect(
      convert.run([fakePdf], { targetFormat: 'jpeg' }, makeCtx()),
    ).rejects.toThrow(/unsupported|format/i);
  });

  it('respects abort signal', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const controller = new AbortController();
    controller.abort();
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: controller.signal,
      cache: new Map(),
      executionId: 'abort',
    };
    await expect(convert.run([input], { targetFormat: 'png' }, ctx)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run tests — confirm failure**

```bash
pnpm --filter @wyreup/core test
```

Expected: convert tests fail (no export yet); 56 other tests pass.

- [ ] **Step 4: Create `packages/core/src/tools/convert/index.ts`**

```ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ConvertParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';

export type { ConvertParams } from './types.js';
export { defaultConvertParams } from './types.js';

const ConvertComponentStub = (): unknown => null;

export const convert: ToolModule<ConvertParams> = {
  id: 'convert',
  slug: 'convert',
  name: 'Convert format',
  description: 'Convert images between JPEG, PNG, and WebP formats.',
  category: 'convert',
  presence: 'both',
  keywords: ['convert', 'format', 'change', 'transform', 'png', 'jpg', 'jpeg', 'webp'],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/*',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { targetFormat: 'webp', quality: 90 },

  Component: ConvertComponentStub,

  async run(
    inputs: File[],
    params: ConvertParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { targetFormat, quality = 90 } = params;
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Processing ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(
          `Unsupported input format "${input.type}". convert accepts image/jpeg, image/png, and image/webp.`,
        );
      }

      const buffer = await input.arrayBuffer();
      const sourceCodec = await getCodec(sourceFormat);
      const decoded = await sourceCodec.decode(buffer);

      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'encoding',
        percent: Math.floor(((i + 0.5) / inputs.length) * 100),
        message: `Encoding as ${targetFormat}`,
      });

      const targetCodec = await getCodec(targetFormat);
      const encoded = await targetCodec.encode(decoded, { quality });
      outputs.push(new Blob([encoded], { type: mimeFor(targetFormat) }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png', 'photo.webp'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

function mimeFor(format: ImageFormat): string {
  switch (format) {
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
  }
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
pnpm --filter @wyreup/core test
```

Expected: convert tests pass + all previous tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/convert packages/core/test/tools/convert
git commit -m "feat(core): convert tool (JPEG/PNG/WebP format conversion)"
```

---

## Task 3: Implement `stripExif` tool

**Files:**
- Create: `packages/core/src/tools/strip-exif/types.ts`
- Create: `packages/core/src/tools/strip-exif/index.ts`
- Create: `packages/core/test/tools/strip-exif/strip-exif.test.ts`

- [ ] **Step 1: Create `packages/core/src/tools/strip-exif/types.ts`**

```ts
// strip-exif takes no user-facing parameters; re-encoding at quality 95
// is an internal detail that naturally drops metadata.
export type StripExifParams = Record<string, never>;

export const defaultStripExifParams: StripExifParams = {};
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/tools/strip-exif/strip-exif.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { stripExif } from '../../../src/tools/strip-exif/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('strip-exif — metadata', () => {
  it('has id "strip-exif" and category "privacy"', () => {
    expect(stripExif.id).toBe('strip-exif');
    expect(stripExif.category).toBe('privacy');
  });

  it('accepts image MIME patterns', () => {
    expect(stripExif.input.accept).toContain('image/jpeg');
    expect(stripExif.input.accept).toContain('image/png');
    expect(stripExif.input.accept).toContain('image/webp');
  });
});

describe('strip-exif — run()', () => {
  it('re-encodes a JPEG and preserves the JPEG type', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await stripExif.run([input], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('re-encodes a PNG and preserves the PNG type', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await stripExif.run([input], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/png');
  });

  it('processes multiple files in batch', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');
    const outputs = await stripExif.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(2);
  });

  it('throws for unsupported input type', async () => {
    const fakePdf = new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' });
    await expect(stripExif.run([fakePdf], {}, makeCtx())).rejects.toThrow(/unsupported|format/i);
  });
});
```

- [ ] **Step 3: Run tests — confirm failure**

- [ ] **Step 4: Create `packages/core/src/tools/strip-exif/index.ts`**

```ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import type { StripExifParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';

export type { StripExifParams } from './types.js';
export { defaultStripExifParams } from './types.js';

const StripExifComponentStub = (): unknown => null;

/**
 * Strip EXIF metadata by re-encoding the image at near-lossless quality (95).
 * Because jSquash decodes to raw pixel data (no metadata), the re-encode
 * necessarily has no EXIF, GPS, or camera metadata. Visually indistinguishable
 * from the input at quality 95.
 */
export const stripExif: ToolModule<StripExifParams> = {
  id: 'strip-exif',
  slug: 'strip-exif',
  name: 'Strip EXIF metadata',
  description: 'Remove EXIF metadata (including GPS, camera model, timestamps) by re-encoding at near-lossless quality.',
  category: 'privacy',
  presence: 'both',
  keywords: ['strip', 'exif', 'metadata', 'privacy', 'gps', 'location', 'remove'],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/*',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  Component: StripExifComponentStub,

  async run(
    inputs: File[],
    _params: StripExifParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const outputs: Blob[] = [];
    const STRIP_QUALITY = 95;

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Stripping ${input.name} (${i + 1}/${inputs.length})`,
      });

      const format = detectFormat(input.type);
      if (!format) {
        throw new Error(
          `Unsupported input format "${input.type}". strip-exif accepts image/jpeg, image/png, and image/webp.`,
        );
      }

      const buffer = await input.arrayBuffer();
      const codec = await getCodec(format);
      const decoded = await codec.decode(buffer);
      const encoded = await codec.encode(decoded, { quality: STRIP_QUALITY });

      outputs.push(new Blob([encoded], { type: mimeFor(format) }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png', 'photo.webp'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

function mimeFor(format: ImageFormat): string {
  switch (format) {
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
  }
}
```

- [ ] **Step 5: Run tests and verify pass**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/strip-exif packages/core/test/tools/strip-exif
git commit -m "feat(core): strip-exif tool (re-encode to drop metadata)"
```

---

## Task 4: Implement `imageToPdf` tool

**Files:**
- Create: `packages/core/src/tools/image-to-pdf/types.ts`
- Create: `packages/core/src/tools/image-to-pdf/index.ts`
- Create: `packages/core/test/tools/image-to-pdf/image-to-pdf.test.ts`

- [ ] **Step 1: Create `packages/core/src/tools/image-to-pdf/types.ts`**

```ts
export interface ImageToPdfParams {
  /** 'auto' sizes each page to the image dimensions; 'a4' / 'letter' use standard sizes. Default 'auto'. */
  pageSize?: 'auto' | 'a4' | 'letter';
  /** Page margin in points when using a4/letter. Default 36 (0.5 inch). */
  margin?: number;
}

export const defaultImageToPdfParams: ImageToPdfParams = {
  pageSize: 'auto',
  margin: 36,
};
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/tools/image-to-pdf/image-to-pdf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { imageToPdf } from '../../../src/tools/image-to-pdf/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('image-to-pdf — metadata', () => {
  it('has id "image-to-pdf" and category "export"', () => {
    expect(imageToPdf.id).toBe('image-to-pdf');
    expect(imageToPdf.category).toBe('export');
  });

  it('accepts jpeg and png (not webp — pdf-lib limitation)', () => {
    expect(imageToPdf.input.accept).toContain('image/jpeg');
    expect(imageToPdf.input.accept).toContain('image/png');
    expect(imageToPdf.input.accept).not.toContain('image/webp');
  });

  it('output mime is application/pdf (single file)', () => {
    expect(imageToPdf.output.mime).toBe('application/pdf');
  });
});

describe('image-to-pdf — run()', () => {
  it('produces a valid PDF from a single JPEG', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await imageToPdf.run([input], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('application/pdf');

    // Verify PDF magic bytes.
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  });

  it('combines multiple images into a multi-page PDF', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');
    const outputs = await imageToPdf.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.size).toBeGreaterThan(a.size);
  });

  it('throws for unsupported input type', async () => {
    const fakeHeic = new File([''], 'x.heic', { type: 'image/heic' });
    await expect(imageToPdf.run([fakeHeic], {}, makeCtx())).rejects.toThrow(/unsupported|format/i);
  });
});
```

- [ ] **Step 3: Run tests — confirm failure**

- [ ] **Step 4: Create `packages/core/src/tools/image-to-pdf/index.ts`**

```ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ImageToPdfParams } from './types.js';

export type { ImageToPdfParams } from './types.js';
export { defaultImageToPdfParams } from './types.js';

const ImageToPdfComponentStub = (): unknown => null;

export const imageToPdf: ToolModule<ImageToPdfParams> = {
  id: 'image-to-pdf',
  slug: 'image-to-pdf',
  name: 'Images → PDF',
  description: 'Combine one or more images into a single PDF document.',
  category: 'export',
  presence: 'both',
  keywords: ['pdf', 'image', 'combine', 'document', 'jpg', 'png'],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { pageSize: 'auto', margin: 36 },

  Component: ImageToPdfComponentStub,

  async run(
    inputs: File[],
    params: ImageToPdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    // Dynamic import so pdf-lib only loads when this tool runs.
    const { PDFDocument } = await import('pdf-lib');

    const pageSize = params.pageSize ?? 'auto';
    const margin = params.margin ?? 36;

    const doc = await PDFDocument.create();

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      const mime = input.type.toLowerCase();

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Embedding ${input.name} (${i + 1}/${inputs.length})`,
      });

      const buffer = await input.arrayBuffer();
      let image;
      if (mime === 'image/jpeg' || mime === 'image/jpg') {
        image = await doc.embedJpg(buffer);
      } else if (mime === 'image/png') {
        image = await doc.embedPng(buffer);
      } else {
        throw new Error(
          `Unsupported input format "${input.type}". image-to-pdf accepts image/jpeg and image/png.`,
        );
      }

      let pageWidth: number;
      let pageHeight: number;
      let drawX = 0;
      let drawY = 0;
      let drawWidth = image.width;
      let drawHeight = image.height;

      if (pageSize === 'a4') {
        pageWidth = 595;
        pageHeight = 842;
        const available = { w: pageWidth - 2 * margin, h: pageHeight - 2 * margin };
        const scale = Math.min(available.w / image.width, available.h / image.height, 1);
        drawWidth = image.width * scale;
        drawHeight = image.height * scale;
        drawX = (pageWidth - drawWidth) / 2;
        drawY = (pageHeight - drawHeight) / 2;
      } else if (pageSize === 'letter') {
        pageWidth = 612;
        pageHeight = 792;
        const available = { w: pageWidth - 2 * margin, h: pageHeight - 2 * margin };
        const scale = Math.min(available.w / image.width, available.h / image.height, 1);
        drawWidth = image.width * scale;
        drawHeight = image.height * scale;
        drawX = (pageWidth - drawWidth) / 2;
        drawY = (pageHeight - drawHeight) / 2;
      } else {
        // 'auto' — page matches image dimensions
        pageWidth = image.width;
        pageHeight = image.height;
      }

      const page = doc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
    const bytes = await doc.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['application/pdf'],
  },
};
```

- [ ] **Step 5: Run tests and verify pass**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/image-to-pdf packages/core/test/tools/image-to-pdf
git commit -m "feat(core): image-to-pdf tool (pdf-lib)"
```

---

## Task 5: Implement `mergePdf` tool

**Files:**
- Create: `packages/core/src/tools/merge-pdf/types.ts`
- Create: `packages/core/src/tools/merge-pdf/index.ts`
- Create: `packages/core/test/tools/merge-pdf/merge-pdf.test.ts`

- [ ] **Step 1: Create `packages/core/src/tools/merge-pdf/types.ts`**

```ts
export type MergePdfParams = Record<string, never>;

export const defaultMergePdfParams: MergePdfParams = {};
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/tools/merge-pdf/merge-pdf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mergePdf } from '../../../src/tools/merge-pdf/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('merge-pdf — metadata', () => {
  it('has id "merge-pdf" and category "pdf"', () => {
    expect(mergePdf.id).toBe('merge-pdf');
    expect(mergePdf.category).toBe('pdf');
  });

  it('accepts application/pdf only, min 2 files', () => {
    expect(mergePdf.input.accept).toEqual(['application/pdf']);
    expect(mergePdf.input.min).toBe(2);
  });

  it('output mime is application/pdf', () => {
    expect(mergePdf.output.mime).toBe('application/pdf');
  });
});

describe('merge-pdf — run()', () => {
  it('merges two PDFs into one', async () => {
    const a = loadFixture('doc-a.pdf', 'application/pdf');
    const b = loadFixture('doc-b.pdf', 'application/pdf');
    const outputs = await mergePdf.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('application/pdf');

    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF magic
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  });

  it('merged PDF is larger than either input', async () => {
    const a = loadFixture('doc-a.pdf', 'application/pdf');
    const b = loadFixture('doc-b.pdf', 'application/pdf');
    const outputs = await mergePdf.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    const mergedSize = blobs[0]!.size;
    // Merged should be at least near the sum of both (sometimes smaller due to dedup of fonts)
    expect(mergedSize).toBeGreaterThan(Math.min(a.size, b.size));
  });
});
```

- [ ] **Step 3: Run tests — confirm failure**

- [ ] **Step 4: Create `packages/core/src/tools/merge-pdf/index.ts`**

```ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import type { MergePdfParams } from './types.js';

export type { MergePdfParams } from './types.js';
export { defaultMergePdfParams } from './types.js';

const MergePdfComponentStub = (): unknown => null;

export const mergePdf: ToolModule<MergePdfParams> = {
  id: 'merge-pdf',
  slug: 'merge-pdf',
  name: 'Merge PDFs',
  description: 'Combine multiple PDF files into a single document.',
  category: 'pdf',
  presence: 'both',
  keywords: ['merge', 'pdf', 'combine', 'concatenate', 'join'],

  input: {
    accept: ['application/pdf'],
    min: 2,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  Component: MergePdfComponentStub,

  async run(
    inputs: File[],
    _params: MergePdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.create();

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Reading ${input.name} (${i + 1}/${inputs.length})`,
      });

      const buffer = await input.arrayBuffer();
      const src = await PDFDocument.load(buffer);
      const copiedPages = await merged.copyPages(src, src.getPageIndices());
      for (const page of copiedPages) {
        merged.addPage(page);
      }
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving merged PDF' });
    const bytes = await merged.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-a.pdf', 'doc-b.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
```

- [ ] **Step 5: Run tests and verify pass**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/merge-pdf packages/core/test/tools/merge-pdf
git commit -m "feat(core): merge-pdf tool (pdf-lib)"
```

---

## Task 6: Update default registry and exports

**Files:**
- Modify: `packages/core/src/default-registry.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/default-registry.test.ts`

- [ ] **Step 1: Update `packages/core/src/default-registry.ts`**

Replace with:
```ts
import { createRegistry, type ToolRegistry } from './registry.js';
import { compress } from './tools/compress/index.js';
import { convert } from './tools/convert/index.js';
import { stripExif } from './tools/strip-exif/index.js';
import { imageToPdf } from './tools/image-to-pdf/index.js';
import { mergePdf } from './tools/merge-pdf/index.js';
import type { ToolModule } from './types.js';

/**
 * All first-party Wyreup tools, in presentation order.
 * Typed as ToolModule<any> because TypeScript's function parameter
 * contravariance makes it hard to hold Params-parameterized tools in
 * a single heterogeneous array without losing type safety on each one.
 */
export const defaultTools: ToolModule<any>[] = [
  compress,
  convert,
  stripExif,
  imageToPdf,
  mergePdf,
];

export function createDefaultRegistry(): ToolRegistry {
  return createRegistry(defaultTools as ToolModule[]);
}
```

- [ ] **Step 2: Update `packages/core/src/index.ts`**

Add these exports:
```ts
export { convert, type ConvertParams, defaultConvertParams } from './tools/convert/index.js';
export { stripExif, type StripExifParams, defaultStripExifParams } from './tools/strip-exif/index.js';
export { imageToPdf, type ImageToPdfParams, defaultImageToPdfParams } from './tools/image-to-pdf/index.js';
export { mergePdf, type MergePdfParams, defaultMergePdfParams } from './tools/merge-pdf/index.js';
```

- [ ] **Step 3: Update `packages/core/test/default-registry.test.ts`**

Append new tests to verify the new tools are registered:
```ts
  it('includes convert', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('convert')).toBeDefined();
  });

  it('includes strip-exif', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('strip-exif')).toBeDefined();
  });

  it('includes image-to-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('image-to-pdf')).toBeDefined();
  });

  it('includes merge-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('merge-pdf')).toBeDefined();
  });

  it('merge-pdf is compatible when 2 PDFs are dropped', () => {
    const registry = createDefaultRegistry();
    const pdf1 = new File([], 'a.pdf', { type: 'application/pdf' });
    const pdf2 = new File([], 'b.pdf', { type: 'application/pdf' });
    const compatible = registry.toolsForFiles([pdf1, pdf2]);
    expect(compatible.some((t) => t.id === 'merge-pdf')).toBe(true);
  });
```

- [ ] **Step 4: Run tests and verify all pass**

```bash
pnpm --filter @wyreup/core test
```

Expected: all 56 + 4 tool test suites pass, plus new default-registry tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/default-registry.ts packages/core/src/index.ts packages/core/test/default-registry.test.ts
git commit -m "feat(core): register convert, strip-exif, image-to-pdf, merge-pdf in default registry"
```

---

## Task 7: End-to-end verification and tag

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules packages/*/node_modules packages/*/dist tools/node_modules
pnpm install
```

- [ ] **Step 2: Full typecheck + test + build**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 3: All three CI checks**

```bash
node tools/check-isolation.mjs && node tools/check-privacy.mjs && node tools/check-bundle-size.mjs
```

Expected: all pass.

- [ ] **Step 4: Tag and push**

```bash
git tag -a v0.1.0-wave1b -m "Wave 1b: convert, strip-exif, image-to-pdf, merge-pdf in @wyreup/core"
git push origin main --tags
```

---

## Exit summary

- 5 tools in `@wyreup/core`: compress, convert, strip-exif, image-to-pdf, merge-pdf
- All tests pass
- All CI checks green
- Tag `v0.1.0-wave1b` pushed to GitHub

## What's next: Wave 1c

Continue in core with tools that need pdfjs-dist (pdf-to-image, pdf-to-text, split-pdf, rotate-pdf), or start adding canvas-using tools by completing the runtime adapter implementations (crop, resize, rotate, watermark). Or pivot to `@wyreup/web` for the first web surface.
