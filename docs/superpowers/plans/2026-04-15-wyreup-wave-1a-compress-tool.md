# Wyreup — Wave 1a: Compress Tool in `@wyreup/core`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first real tool (`compress`) in `@wyreup/core` end-to-end — logic, tests, fixtures, registry registration. Establishes the tool module implementation pattern that Waves 1b+ will follow for every other tool.

**Architecture:** `compress` uses jSquash codecs (JPEG, PNG, WebP) directly on `ArrayBuffer`/`Blob`. No canvas runtime adapter needed because compression doesn't require pixel transformation — just decode and re-encode at lower quality. Tests use real image fixtures committed to the repo so the test suite is deterministic. The Component field on the ToolModule is a minimal stub in Wave 1a; consuming UIs (web, editor, CLI, MCP) will each render their own in later waves.

**Tech Stack:** @jsquash/jpeg, @jsquash/png, @jsquash/webp (Apache-2.0, WASM codecs).

**Scope:** `@wyreup/core` only. One tool. Nothing in `@wyreup/web`, `@wyreup/mcp`, or `@wyreup/cli` yet — those are touched in Wave 1b and Wave 1c.

**Source spec:** `/Users/jacob/Projects/toanother.one/docs/superpowers/specs/2026-04-15-wyreup-tool-library-design.md`

**Preceding plan:** Wave 0 Foundation (complete, tagged `v0.0.0-wave0`).

**Deliverable:** `@wyreup/core` exports a working `compress` ToolModule that passes unit + integration tests against real image fixtures. Library is usable by any consumer (web, mcp, cli) that imports `@wyreup/core`. No UI in this plan, no deployment.

---

## Exit criteria

Wave 1a is complete when:

1. `@wyreup/core` exports `compress: ToolModule<CompressParams>` with full metadata and a working `run()` implementation.
2. `compress.run()` correctly compresses real JPEG, PNG, and WebP fixtures (output is valid, smaller than input, preserves mime type unless `targetFormat` is set).
3. Error handling is graceful: corrupted input throws a readable error, unsupported MIME types throw a readable error, aborted runs throw promptly.
4. `createDefaultRegistry()` includes compress; it's queryable by id, category, file compatibility, and search.
5. All existing Wave 0 tests still pass. New compress + codec tests pass. Total ~45 tests.
6. `pnpm --filter @wyreup/core build` still succeeds for both browser and node targets.
7. All three CI checks (isolation, privacy, bundle size) still pass.
8. Commit history is clean, each task is one logical commit, all on `main`.
9. `v0.1.0-wave1a` tag created.

---

## Task 1: Install jSquash codecs

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add jSquash codecs as dependencies**

Run from the repo root:
```bash
pnpm --filter @wyreup/core add @jsquash/jpeg@^1.6.0 @jsquash/png@^3.1.0 @jsquash/webp@^1.5.0
```

Expected: three packages added to `packages/core/package.json` under `dependencies`.

- [ ] **Step 2: Verify installation**

Run:
```bash
grep -A 3 '"dependencies"' packages/core/package.json
```

Expected: shows the three `@jsquash/*` deps.

- [ ] **Step 3: Smoke test the codecs load in Node**

Run:
```bash
node -e "import('@jsquash/jpeg').then(m => console.log('jpeg:', typeof m.encode, typeof m.decode))"
```

Expected: `jpeg: function function`.

Repeat for png and webp:
```bash
node -e "import('@jsquash/png').then(m => console.log('png:', typeof m.encode, typeof m.decode))"
node -e "import('@jsquash/webp').then(m => console.log('webp:', typeof m.encode, typeof m.decode))"
```

Expected: each prints `<format>: function function`. If any prints `undefined`, STOP — the codec API may have changed and the plan needs updating.

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add jSquash codec dependencies (jpeg/png/webp)"
```

---

## Task 2: Create shared codec loader module

**Files:**
- Create: `packages/core/src/lib/codecs.ts`
- Create: `packages/core/test/lib/codecs.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/lib/codecs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { detectFormat, getCodec } from '../../src/lib/codecs.js';

describe('detectFormat', () => {
  it('returns "jpeg" for image/jpeg', () => {
    expect(detectFormat('image/jpeg')).toBe('jpeg');
  });

  it('returns "jpeg" for image/jpg (common alias)', () => {
    expect(detectFormat('image/jpg')).toBe('jpeg');
  });

  it('returns "png" for image/png', () => {
    expect(detectFormat('image/png')).toBe('png');
  });

  it('returns "webp" for image/webp', () => {
    expect(detectFormat('image/webp')).toBe('webp');
  });

  it('returns null for unsupported types', () => {
    expect(detectFormat('application/pdf')).toBeNull();
    expect(detectFormat('image/heic')).toBeNull();
    expect(detectFormat('text/plain')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectFormat('IMAGE/JPEG')).toBe('jpeg');
    expect(detectFormat('Image/Png')).toBe('png');
  });
});

describe('getCodec', () => {
  it('returns a codec with decode and encode for jpeg', async () => {
    const codec = await getCodec('jpeg');
    expect(typeof codec.decode).toBe('function');
    expect(typeof codec.encode).toBe('function');
  });

  it('returns a codec with decode and encode for png', async () => {
    const codec = await getCodec('png');
    expect(typeof codec.decode).toBe('function');
    expect(typeof codec.encode).toBe('function');
  });

  it('returns a codec with decode and encode for webp', async () => {
    const codec = await getCodec('webp');
    expect(typeof codec.decode).toBe('function');
    expect(typeof codec.encode).toBe('function');
  });

  it('memoizes codecs across calls (same reference)', async () => {
    const a = await getCodec('jpeg');
    const b = await getCodec('jpeg');
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @wyreup/core test
```

Expected: FAIL with `Cannot find module '../../src/lib/codecs.js'`.

- [ ] **Step 3: Create `packages/core/src/lib/codecs.ts`**

Create `packages/core/src/lib/codecs.ts`:
```ts
/**
 * Shared codec loader. Lazy-imports jSquash codecs on demand and memoizes
 * them for the session. Used by compress, convert, image-to-pdf, and any
 * tool that needs to encode or decode image bitmaps.
 *
 * Codecs are loaded only when actually needed (inside a tool's run()),
 * keeping initial bundle size minimal.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface Codec {
  /** Decode a compressed image buffer into an ImageData-like structure. */
  decode(buffer: ArrayBuffer | Uint8Array): Promise<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }>;
  /** Encode an ImageData-like structure into a compressed format-specific buffer. */
  encode(
    image: { data: Uint8ClampedArray; width: number; height: number },
    options?: Record<string, unknown>,
  ): Promise<ArrayBuffer>;
}

/**
 * Detect the jSquash-supported format from a MIME type.
 * Returns null for unsupported types so callers can surface a clear error.
 */
export function detectFormat(mime: string): ImageFormat | null {
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpeg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  return null;
}

const codecCache = new Map<ImageFormat, Codec>();

/**
 * Load a codec for the given format. Dynamic import so the WASM blob is
 * fetched/loaded only when the codec is actually used. Memoized per session.
 */
export async function getCodec(format: ImageFormat): Promise<Codec> {
  const cached = codecCache.get(format);
  if (cached) return cached;

  let codec: Codec;
  switch (format) {
    case 'jpeg': {
      const mod = await import('@jsquash/jpeg');
      codec = { decode: mod.decode, encode: mod.encode };
      break;
    }
    case 'png': {
      const mod = await import('@jsquash/png');
      codec = { decode: mod.decode, encode: mod.encode };
      break;
    }
    case 'webp': {
      const mod = await import('@jsquash/webp');
      codec = { decode: mod.decode, encode: mod.encode };
      break;
    }
  }

  codecCache.set(format, codec);
  return codec;
}
```

- [ ] **Step 4: Update `packages/core/src/index.ts`**

Add these exports to `packages/core/src/index.ts`:
```ts
export { detectFormat, getCodec, type ImageFormat, type Codec } from './lib/codecs.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm --filter @wyreup/core test
```

Expected: 10 new codec tests pass. All 24 previous tests still pass. 34 total.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lib packages/core/src/index.ts packages/core/test/lib
git commit -m "feat(core): shared codec loader with lazy jSquash imports"
```

---

## Task 3: Generate and commit test fixtures

**Files:**
- Create: `packages/core/test/fixtures/photo.jpg`
- Create: `packages/core/test/fixtures/graphic.png`
- Create: `packages/core/test/fixtures/photo.webp`
- Create: `packages/core/test/fixtures/corrupted.jpg`
- Create: `packages/core/test/fixtures/README.md`
- Create: `packages/core/test/lib/load-fixture.ts`

- [ ] **Step 1: Create the fixtures directory**

Run:
```bash
mkdir -p packages/core/test/fixtures
```

- [ ] **Step 2: Generate a reference JPEG using jSquash itself**

Create a one-off generator script at `/tmp/gen-jpeg.mjs`:
```bash
cat > /tmp/gen-jpeg.mjs << 'EOF'
import { writeFileSync } from 'node:fs';
import { encode } from '@jsquash/jpeg';

const width = 800;
const height = 600;
const data = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = Math.floor((x / width) * 255);
    data[i + 1] = Math.floor((y / height) * 255);
    data[i + 2] = 128;
    data[i + 3] = 255;
  }
}
const encoded = await encode({ data, width, height }, { quality: 90 });
writeFileSync('packages/core/test/fixtures/photo.jpg', Buffer.from(encoded));
console.log('photo.jpg:', encoded.byteLength, 'bytes');
EOF
```

Run it from the repo root:
```bash
cd /Users/jacob/Projects/toanother.one && node /tmp/gen-jpeg.mjs
```

Expected output: `photo.jpg: <n> bytes` where `<n>` is between 10000 and 100000.

- [ ] **Step 3: Generate a reference PNG**

Create `/tmp/gen-png.mjs`:
```bash
cat > /tmp/gen-png.mjs << 'EOF'
import { writeFileSync } from 'node:fs';
import { encode } from '@jsquash/png';

const width = 400;
const height = 400;
const data = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const inCircle = Math.hypot(x - width / 2, y - height / 2) < 150;
    data[i] = inCircle ? 255 : 30;
    data[i + 1] = inCircle ? 100 : 200;
    data[i + 2] = inCircle ? 50 : 100;
    data[i + 3] = 255;
  }
}
const encoded = await encode({ data, width, height });
writeFileSync('packages/core/test/fixtures/graphic.png', Buffer.from(encoded));
console.log('graphic.png:', encoded.byteLength, 'bytes');
EOF
```

Run:
```bash
node /tmp/gen-png.mjs
```

Expected: `graphic.png: <n> bytes`.

- [ ] **Step 4: Generate a reference WebP from the JPEG**

Create `/tmp/gen-webp.mjs`:
```bash
cat > /tmp/gen-webp.mjs << 'EOF'
import { writeFileSync, readFileSync } from 'node:fs';
import { decode } from '@jsquash/jpeg';
import { encode } from '@jsquash/webp';

const jpegBuffer = readFileSync('packages/core/test/fixtures/photo.jpg');
const decoded = await decode(jpegBuffer);
const encoded = await encode(decoded, { quality: 85 });
writeFileSync('packages/core/test/fixtures/photo.webp', Buffer.from(encoded));
console.log('photo.webp:', encoded.byteLength, 'bytes');
EOF
```

Run:
```bash
node /tmp/gen-webp.mjs
```

Expected: `photo.webp: <n> bytes`.

- [ ] **Step 5: Create a corrupted fixture**

Run:
```bash
printf 'not a real jpeg just some bytes that are clearly invalid\n' > packages/core/test/fixtures/corrupted.jpg
```

- [ ] **Step 6: Create the fixtures README**

Create `packages/core/test/fixtures/README.md`:
```markdown
# Core test fixtures

Reference images for tool module tests. Committed to the repo so tests are deterministic.

- `photo.jpg` — 800×600 gradient JPEG at quality 90
- `graphic.png` — 400×400 PNG with a solid shape
- `photo.webp` — the JPEG re-encoded as WebP at quality 85
- `corrupted.jpg` — intentionally invalid bytes for error-path testing

To regenerate, run the one-off scripts in `/tmp/gen-*.mjs` as described in the Wave 1a plan (Task 3).
```

- [ ] **Step 7: Create the fixture loader helper**

Create `packages/core/test/lib/load-fixture.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a fixture file as a File object so tests exercise the same shape
 * that browser-dropped files present. Tests for tool modules should always
 * use this helper rather than reading fixtures ad hoc.
 */
export function loadFixture(name: string, mimeType: string): File {
  const path = join(__dirname, '..', 'fixtures', name);
  const buffer = readFileSync(path);
  // Node 20+ has global File.
  return new File([buffer], name, { type: mimeType });
}
```

- [ ] **Step 8: Verify the fixtures exist and have reasonable sizes**

Run:
```bash
ls -la packages/core/test/fixtures/
```

Expected: 4 files (photo.jpg, graphic.png, photo.webp, corrupted.jpg) + README.md. All image files should be between 1 KB and 200 KB.

- [ ] **Step 9: Commit the fixtures**

```bash
git add packages/core/test/fixtures packages/core/test/lib
git commit -m "test(core): add reference image fixtures for tool tests"
```

---

## Task 4: Scaffold the compress tool folder and params type

**Files:**
- Create: `packages/core/src/tools/compress/types.ts`
- Create: `packages/core/src/tools/compress/index.ts` (stub)

- [ ] **Step 1: Create the tool directory**

Run:
```bash
mkdir -p packages/core/src/tools/compress packages/core/test/tools/compress
```

- [ ] **Step 2: Create `packages/core/src/tools/compress/types.ts`**

Create `packages/core/src/tools/compress/types.ts`:
```ts
import type { ImageFormat } from '../../lib/codecs.js';

/**
 * Parameters for the compress tool.
 */
export interface CompressParams {
  /** Output quality, 1-100. Default 80. Only meaningful for JPEG/WebP. */
  quality: number;
  /**
   * Output format. If undefined, preserves the input format.
   * Set explicitly to re-encode as a different format (e.g. JPEG → WebP).
   */
  targetFormat?: ImageFormat;
}

export const defaultCompressParams: CompressParams = {
  quality: 80,
};
```

- [ ] **Step 3: Create a placeholder `packages/core/src/tools/compress/index.ts`**

Create `packages/core/src/tools/compress/index.ts`:
```ts
// Wave 1a stub — full implementation lives in Task 6.
// This file will export the compress ToolModule once implemented.

export type { CompressParams } from './types.js';
export { defaultCompressParams } from './types.js';
```

- [ ] **Step 4: Commit the scaffold**

```bash
git add packages/core/src/tools/compress
git commit -m "feat(core): scaffold compress tool folder and params type"
```

---

## Task 5: Write compress tool tests (TDD)

**Files:**
- Create: `packages/core/test/tools/compress/compress.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/tools/compress/compress.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { compress } from '../../../src/tools/compress/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(signal?: AbortSignal): ToolRunContext {
  return {
    onProgress: () => {},
    signal: signal ?? new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('compress — metadata', () => {
  it('has the expected id and slug', () => {
    expect(compress.id).toBe('compress');
    expect(compress.slug).toBe('compress');
  });

  it('is in the optimize category', () => {
    expect(compress.category).toBe('optimize');
  });

  it('accepts image MIME patterns', () => {
    expect(compress.input.accept).toContain('image/jpeg');
    expect(compress.input.accept).toContain('image/png');
    expect(compress.input.accept).toContain('image/webp');
  });

  it('requires at least 1 file and has no upper bound', () => {
    expect(compress.input.min).toBe(1);
    expect(compress.input.max).toBeUndefined();
  });

  it('is batchable and free', () => {
    expect(compress.batchable).toBe(true);
    expect(compress.cost).toBe('free');
  });

  it('declares low memory estimate', () => {
    expect(compress.memoryEstimate).toBe('low');
  });

  it('is not interactive and not streaming in v1', () => {
    expect(compress.interactive).toBe(false);
    expect(compress.streaming ?? false).toBe(false);
  });

  it('has defaults including quality 80', () => {
    expect(compress.defaults.quality).toBe(80);
  });

  it('declares test fixtures', () => {
    expect(compress.__testFixtures.valid).toContain('photo.jpg');
    expect(compress.__testFixtures.valid).toContain('graphic.png');
    expect(compress.__testFixtures.valid).toContain('photo.webp');
    expect(compress.__testFixtures.weird).toContain('corrupted.jpg');
  });
});

describe('compress — run()', () => {
  it('compresses a JPEG to a smaller JPEG at quality 50', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const originalSize = input.size;

    const outputs = await compress.run([input], { quality: 50 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[0]!.size).toBeGreaterThan(0);
    expect(blobs[0]!.size).toBeLessThan(originalSize);
  });

  it('compresses a PNG and returns a PNG by default', async () => {
    const input = loadFixture('graphic.png', 'image/png');

    const outputs = await compress.run([input], { quality: 80 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/png');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('compresses a WebP to a smaller WebP at quality 50', async () => {
    const input = loadFixture('photo.webp', 'image/webp');
    const originalSize = input.size;

    const outputs = await compress.run([input], { quality: 50 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/webp');
    expect(blobs[0]!.size).toBeLessThan(originalSize);
  });

  it('re-encodes a JPEG as WebP when targetFormat is webp', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');

    const outputs = await compress.run(
      [input],
      { quality: 80, targetFormat: 'webp' },
      makeCtx(),
    );
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs[0]!.type).toBe('image/webp');
  });

  it('processes multiple files in batch and preserves their formats', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('graphic.png', 'image/png');

    const outputs = await compress.run([a, b], { quality: 80 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];

    expect(blobs.length).toBe(2);
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[1]!.type).toBe('image/png');
  });

  it('throws a readable error for an unsupported input type', async () => {
    const fakePdf = new File(['%PDF-1.4 fake'], 'x.pdf', { type: 'application/pdf' });

    await expect(
      compress.run([fakePdf], { quality: 80 }, makeCtx()),
    ).rejects.toThrow(/unsupported|format|pdf/i);
  });

  it('throws for corrupted input', async () => {
    const input = loadFixture('corrupted.jpg', 'image/jpeg');

    await expect(
      compress.run([input], { quality: 80 }, makeCtx()),
    ).rejects.toThrow();
  });

  it('respects a pre-aborted signal', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const controller = new AbortController();
    controller.abort();

    await expect(
      compress.run([input], { quality: 80 }, makeCtx(controller.signal)),
    ).rejects.toThrow();
  });

  it('reports progress events during a batch', async () => {
    const events: Array<{ stage: string }> = [];
    const ctx: ToolRunContext = {
      onProgress: (p) => events.push({ stage: p.stage }),
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'progress-test',
    };

    const input = loadFixture('photo.jpg', 'image/jpeg');
    await compress.run([input, input], { quality: 80 }, ctx);

    expect(events.some((e) => e.stage === 'processing')).toBe(true);
    expect(events.some((e) => e.stage === 'done')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @wyreup/core test
```

Expected: the compress tests fail because the `compress` export doesn't exist yet in `src/tools/compress/index.ts` (only the stub does). All previous tests still pass.

---

## Task 6: Implement `compress.run()` and the full ToolModule

**Files:**
- Modify: `packages/core/src/tools/compress/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Replace `packages/core/src/tools/compress/index.ts` with the full implementation**

Replace the stub contents with:
```ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import type { CompressParams } from './types.js';
import { detectFormat, getCodec, type ImageFormat } from '../../lib/codecs.js';

export type { CompressParams } from './types.js';
export { defaultCompressParams } from './types.js';

/**
 * Placeholder UI component for the compress tool. Wave 1a keeps UI concerns
 * out of @wyreup/core; consuming surfaces (web, cli, mcp) provide their own
 * UIs for this tool. The full "one component, four surfaces" pattern from
 * §5 of the spec arrives in later waves when the editor lands.
 */
const CompressComponentStub = (): unknown => null;

/**
 * Compress one or more images by re-encoding at a lower quality.
 * Preserves the input format unless `targetFormat` is set.
 *
 * Input types: image/jpeg (or image/jpg), image/png, image/webp.
 * Output type: same as input by default; set `targetFormat` to re-encode.
 */
export const compress: ToolModule<CompressParams> = {
  id: 'compress',
  slug: 'compress',
  name: 'Compress',
  description: 'Reduce image file size by re-encoding at a lower quality.',
  category: 'optimize',
  presence: 'both',
  keywords: ['compress', 'shrink', 'reduce', 'optimize', 'smaller', 'quality'],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024, // 500 MB
  },
  output: {
    mime: 'image/*',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { quality: 80 },

  Component: CompressComponentStub,

  async run(
    inputs: File[],
    params: CompressParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { quality, targetFormat } = params;
    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) {
        throw new Error('Aborted');
      }

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Processing ${input.name} (${i + 1}/${inputs.length})`,
      });

      const sourceFormat = detectFormat(input.type);
      if (!sourceFormat) {
        throw new Error(
          `Unsupported input format "${input.type}". compress accepts image/jpeg, image/png, and image/webp.`,
        );
      }

      const outputFormat: ImageFormat = targetFormat ?? sourceFormat;

      const buffer = await input.arrayBuffer();
      const sourceCodec = await getCodec(sourceFormat);
      const decoded = await sourceCodec.decode(buffer);

      if (ctx.signal.aborted) {
        throw new Error('Aborted');
      }

      ctx.onProgress({
        stage: 'encoding',
        percent: Math.floor(((i + 0.5) / inputs.length) * 100),
        message: `Encoding ${input.name}`,
      });

      const targetCodec = await getCodec(outputFormat);
      const encoded = await targetCodec.encode(decoded, { quality });

      outputs.push(new Blob([encoded], { type: mimeFor(outputFormat) }));
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
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
  }
}
```

- [ ] **Step 2: Export `compress` from the package index**

Add to `packages/core/src/index.ts`:
```ts
export { compress, type CompressParams, defaultCompressParams } from './tools/compress/index.js';
```

- [ ] **Step 3: Run tests and verify all pass**

Run:
```bash
pnpm --filter @wyreup/core test
```

Expected: all compress tests pass (19 new tests), all previous tests still pass. ~53 total.

- [ ] **Step 4: Run the build to confirm dual browser/node output works**

Run:
```bash
pnpm --filter @wyreup/core build
```

Expected: browser and node builds both succeed. If the build errors on jSquash WASM imports, STOP — the tsup config may need an `external` entry for `@jsquash/*` so codecs are loaded at runtime, not bundled. Report as BLOCKED.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/compress packages/core/src/index.ts packages/core/test/tools
git commit -m "feat(core): compress tool with jSquash codec integration"
```

---

## Task 7: Add compress to the default registry

**Files:**
- Create: `packages/core/src/default-registry.ts`
- Create: `packages/core/test/default-registry.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/default-registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../src/default-registry.js';

describe('default registry', () => {
  it('includes compress', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('compress')).toBeDefined();
  });

  it('exposes compress via category filter', () => {
    const registry = createDefaultRegistry();
    const optimizeTools = registry.toolsByCategory('optimize');
    expect(optimizeTools.some((t) => t.id === 'compress')).toBe(true);
  });

  it('compress is findable via search by keyword', () => {
    const registry = createDefaultRegistry();
    const results = registry.searchTools('shrink');
    expect(results.some((t) => t.id === 'compress')).toBe(true);
  });

  it('compress is compatible with dropped JPEG files', () => {
    const registry = createDefaultRegistry();
    const jpg = new File([], 'x.jpg', { type: 'image/jpeg' });
    const compatible = registry.toolsForFiles([jpg]);
    expect(compatible.some((t) => t.id === 'compress')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @wyreup/core test
```

Expected: FAIL — `createDefaultRegistry` not yet exported.

- [ ] **Step 3: Create `packages/core/src/default-registry.ts`**

Create `packages/core/src/default-registry.ts`:
```ts
import { createRegistry, type ToolRegistry } from './registry.js';
import { compress } from './tools/compress/index.js';
import type { ToolModule } from './types.js';

/**
 * All first-party Wyreup tools, in presentation order. Consumers that want
 * the standard toolset import this. Custom consumers can build their own
 * registries via `createRegistry(...)`.
 *
 * Wave 1a: just compress. Later waves add the other tools.
 */
export const defaultTools: ToolModule[] = [compress];

/**
 * Factory for the default registry. Returns a fresh instance each call
 * so consumers can augment or override.
 */
export function createDefaultRegistry(): ToolRegistry {
  return createRegistry(defaultTools);
}
```

- [ ] **Step 4: Export from the package index**

Add to `packages/core/src/index.ts`:
```ts
export { defaultTools, createDefaultRegistry } from './default-registry.js';
```

- [ ] **Step 5: Run tests and verify all pass**

Run:
```bash
pnpm --filter @wyreup/core test
```

Expected: 4 new registry tests pass, all previous tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/default-registry.ts packages/core/src/index.ts packages/core/test/default-registry.test.ts
git commit -m "feat(core): default registry now includes compress"
```

---

## Task 8: End-to-end verification

**Files:** none (verification task)

- [ ] **Step 1: Clean install**

Run:
```bash
rm -rf node_modules packages/*/node_modules packages/*/dist tools/node_modules
pnpm install
```

Expected: all deps resolve, no errors.

- [ ] **Step 2: Full typecheck**

Run:
```bash
pnpm typecheck
```

Expected: no TypeScript errors across any package.

- [ ] **Step 3: Full test suite**

Run:
```bash
pnpm test
```

Expected: all tests pass. `@wyreup/core` now has ~57 tests (24 from Wave 0 + 10 codec + 19 compress + 4 default-registry).

- [ ] **Step 4: Full build**

Run:
```bash
pnpm build
```

Expected: all packages build successfully. `packages/core/dist/browser/`, `packages/core/dist/node/` both populated.

- [ ] **Step 5: Isolation check**

Run:
```bash
node tools/check-isolation.mjs
```

Expected: `Isolation check passed (0 violations)`. jSquash is not a forbidden UI framework.

- [ ] **Step 6: Privacy scan**

Run:
```bash
node tools/check-privacy.mjs
```

Expected: `Privacy scan passed`.

- [ ] **Step 7: Bundle size check**

Run:
```bash
node tools/check-bundle-size.mjs
```

Expected: `Bundle size check passed`. Wave 1a doesn't change `@wyreup/web/dist` meaningfully, so this should still pass trivially.

- [ ] **Step 8: Direct smoke test — compress a real image via the library**

Create a one-off script at `/tmp/smoke-compress.mjs`:
```bash
cat > /tmp/smoke-compress.mjs << 'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
import { compress } from './packages/core/dist/node/index.js';

const inputBytes = readFileSync('packages/core/test/fixtures/photo.jpg');
const inputFile = new File([inputBytes], 'photo.jpg', { type: 'image/jpeg' });

const ctx = {
  onProgress: (p) => console.log(`[${p.stage}] ${p.message ?? ''}`),
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'smoke-test',
};

const outputs = await compress.run([inputFile], { quality: 40 }, ctx);
const out = Array.isArray(outputs) ? outputs[0] : outputs;
const outBytes = new Uint8Array(await out.arrayBuffer());
writeFileSync('/tmp/smoke-compressed.jpg', Buffer.from(outBytes));

console.log('Input:', inputFile.size, 'bytes');
console.log('Output:', outBytes.length, 'bytes');
console.log('Savings:', ((1 - outBytes.length / inputFile.size) * 100).toFixed(1), '%');
EOF
```

Run:
```bash
node /tmp/smoke-compress.mjs
```

Expected output shows progress events, input/output sizes, and savings percentage. Output size should be meaningfully smaller than input.

Verify the output file:
```bash
file /tmp/smoke-compressed.jpg
```

Expected: something like `JPEG image data, JFIF standard 1.01, ...`. If it says anything non-JPEG, STOP.

- [ ] **Step 9: Commit any stray changes**

Run:
```bash
git status
```

If anything uncommitted:
```bash
git add -A
git commit -m "chore: wave 1a final cleanup"
```

- [ ] **Step 10: Tag the release**

Run:
```bash
git tag -a v0.1.0-wave1a -m "Wave 1a: compress tool in @wyreup/core"
git push origin main --tags
```

Expected: push succeeds; tag appears at `https://github.com/tamler/wyreup/releases/tag/v0.1.0-wave1a`.

---

## Plan exit summary

Wave 1a is complete when:

1. [ ] `@wyreup/core` exports a working `compress` ToolModule.
2. [ ] `compress` compresses JPEG, PNG, and WebP fixtures correctly in the test suite.
3. [ ] `createDefaultRegistry()` includes compress and all registry queries work.
4. [ ] All ~57 tests pass.
5. [ ] All three CI checks (isolation, privacy, bundle size) pass.
6. [ ] Dual browser/node build produces valid output.
7. [ ] Direct smoke-test script from Task 8 Step 8 shows real compression savings.
8. [ ] `v0.1.0-wave1a` tag pushed to `origin/main`.

## What Wave 1a does NOT include

- Any `@wyreup/web` work (no `/compress` page, no React integration).
- Any `@wyreup/mcp` wiring (MCP server still reports 0 tools).
- Any `@wyreup/cli` subcommand (only `wyreup list` exists from Wave 0, still reports 0 tools until the CLI consumes `defaultTools`).
- Runtime canvas adapters (not needed until convert/crop/resize/rotate — those land in later plans).
- Any deployment.

## Subsequent plans

- **Wave 1b:** Web app structure — React integration, `/compress` landing page, maybe `/convert` too, editor shell groundwork. At the end of 1b or after 1c, first Cloudflare Pages deploy happens when there's enough on the site to warrant it.
- **Wave 1c:** MCP and CLI integration — `@wyreup/mcp` exposes the registry over stdio, `@wyreup/cli` invokes tools directly, Claude Code skill documents the real tools. These surfaces become useful once `@wyreup/core` has a few tools (compress + maybe 1–2 more).
- **Wave 1d:** The remaining Wave 1 tools — convert, crop, resize, rotate, remove-background, strip-exif, blur-faces — added in parallel across surfaces following the compress pattern.
