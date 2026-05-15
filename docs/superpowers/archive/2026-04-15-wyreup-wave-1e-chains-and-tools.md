# Wyreup — Wave 1e: Chain Engine + 8 More Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (A) Finish the chain engine so multi-step tool pipelines actually execute, and (B) add 8 more tools that demonstrate the chain capability. After this wave, `@wyreup/core` has **22 tools** and working chain execution.

**Preceding plan:** Wave 1d (tagged `v0.1.0-wave1d`).

---

## Phase A: Chain Engine Implementation

Wave 0 shipped a skeleton `runChain()` in `packages/core/src/chain/engine.ts` that validates depth but doesn't execute tools. Wave 1e Phase A finishes it.

### Task A1: Flesh out `runChain()` to accept registry and execute

**Files:**
- Modify: `packages/core/src/chain/engine.ts`
- Create: `packages/core/src/chain/run-default.ts` (convenience wrapper)
- Modify: `packages/core/src/index.ts`

**Contract:** `runChain` takes a `ToolRegistry` (new required param), looks up each step's `toolId`, runs `tool.run(currentInputs, stepParams, ctx)`, converts the output Blobs into `File[]` for the next step.

- [ ] **Step A1.1: Update the `runChain` signature to accept a registry**

New signature:
```ts
export async function runChain(
  chain: Chain,
  inputs: File[],
  ctx: ToolRunContext,
  registry: ToolRegistry,
  depth = 0,
): Promise<Blob[]>
```

This is a BREAKING change to the signature (adds a required param before `depth`). The current callers are only tests — they need to be updated too.

- [ ] **Step A1.2: Write the execution body**

In `runChain`:
1. Check `depth >= MAX_CHAIN_DEPTH` — throw `ChainError` as before.
2. If chain is empty, return empty array (preserve empty-chain behavior).
3. For each step (indexed):
   - Check `ctx.signal.aborted`, throw if so.
   - Look up `tool = registry.toolsById.get(step.toolId)`. If undefined, throw `ChainError(\`Unknown tool: \${step.toolId}\`, i)`.
   - **Type compatibility check** — verify `currentInputs` match `tool.input.accept` (use the same helper the registry uses, import `mimeMatches` from `../registry.js`). If incompatible, throw `ChainError(\`Step \${i+1} (\${tool.id}) expects \${tool.input.accept.join(', ')} but got \${currentInputs.map(f => f.type).join(', ')}\`, i)`.
   - Merge params: `const params = { ...tool.defaults, ...step.params }`.
   - Call `const outputs = await tool.run(currentInputs, params, ctx)`.
   - Normalize to array: `const blobs = Array.isArray(outputs) ? outputs : [outputs]`.
   - Wrap blobs as `File` objects for the next step (use `new File([blob], filename, { type: blob.type })`). Keep original filename from input files when possible; if N input files became M output files, use the index-matched name or fall back to `step-${i}-${j}` naming.
   - `currentInputs = newFiles`.
4. After the loop, return the final `Blob[]` (not Files — return type stays `Promise<Blob[]>`).

- [ ] **Step A1.3: Create `packages/core/src/chain/run-default.ts`**

```ts
import type { Chain } from './types.js';
import { runChain } from './engine.js';
import { createDefaultRegistry } from '../default-registry.js';
import type { ToolRunContext } from '../types.js';

/**
 * Convenience wrapper: run a chain against the default Wyreup registry.
 * Most callers will use this — pass a custom registry via runChain when
 * they need non-default tools.
 */
export async function runDefaultChain(
  chain: Chain,
  inputs: File[],
  ctx: ToolRunContext,
): Promise<Blob[]> {
  return runChain(chain, inputs, ctx, createDefaultRegistry());
}
```

- [ ] **Step A1.4: Export `runDefaultChain` from `packages/core/src/index.ts`**

```ts
export { runDefaultChain } from './chain/run-default.js';
```

- [ ] **Step A1.5: Update the existing chain engine test file**

`packages/core/test/chain/engine.test.ts` currently tests runChain with no registry. Update each test to pass a registry — use `createRegistry([])` for tests that don't care about tools, or `createDefaultRegistry()` for tests that do.

The existing 4 tests stay but get a registry argument. Verify all 4 still pass after the update.

- [ ] **Step A1.6: Commit**

```bash
git add packages/core/src/chain packages/core/src/index.ts packages/core/test/chain
git commit -m "feat(core): runChain now actually executes tools from registry"
```

### Task A2: Integration tests for real chains

**File:** `packages/core/test/chain/integration.test.ts`

Tests that exercise real multi-step chains end-to-end.

- [ ] **Step A2.1: Write integration tests**

```ts
import { describe, it, expect } from 'vitest';
import { runDefaultChain } from '../../src/chain/run-default.js';
import type { ToolRunContext } from '../../src/types.js';
import { loadFixture } from '../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'chain-test',
  };
}

describe('chain integration — real tool chains', () => {
  it('runs compress → strip-exif on an image', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'compress', params: { quality: 60 } },
      { toolId: 'strip-exif', params: {} },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
    expect(outputs[0]!.size).toBeGreaterThan(0);
  });

  it('runs convert → compress to transform format and shrink', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const chain = [
      { toolId: 'convert', params: { targetFormat: 'webp', quality: 80 } },
      { toolId: 'compress', params: { quality: 50 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/webp');
  });

  it('throws ChainError when step references unknown tool', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'compress', params: {} },
      { toolId: 'nonexistent-tool', params: {} },
    ];
    await expect(runDefaultChain(chain, [input], makeCtx())).rejects.toThrow(/unknown tool/i);
  });

  it('throws ChainError on type incompatibility', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    // merge-pdf expects PDFs, not JPEGs
    const chain = [
      { toolId: 'compress', params: {} },
      { toolId: 'merge-pdf', params: {} },
    ];
    await expect(runDefaultChain(chain, [input], makeCtx())).rejects.toThrow(/expects/i);
  });

  it('reports progress across multiple chained steps', async () => {
    const events: Array<{ stage: string }> = [];
    const ctx: ToolRunContext = {
      onProgress: (p) => events.push({ stage: p.stage }),
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'chain-progress',
    };
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'compress', params: {} },
      { toolId: 'strip-exif', params: {} },
    ];
    await runDefaultChain(chain, [input], ctx);
    // Each step reports at least 'processing' and 'done'. Chain of 2 steps = 2+ done events.
    const doneEvents = events.filter((e) => e.stage === 'done');
    expect(doneEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('runs a 3-step chain: convert → strip-exif → compress', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const chain = [
      { toolId: 'convert', params: { targetFormat: 'jpeg', quality: 90 } },
      { toolId: 'strip-exif', params: {} },
      { toolId: 'compress', params: { quality: 50 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
  });
});
```

- [ ] **Step A2.2: Run tests**

```bash
pnpm --filter @wyreup/core test
```

All integration tests should pass. Previous tests must still pass.

- [ ] **Step A2.3: Commit**

```bash
git add packages/core/test/chain/integration.test.ts
git commit -m "test(core): chain engine integration tests with real tools"
```

### Task A3: Phase A verification

- [ ] Run full test suite — ensure 187 previous tests + ~6 new chain integration tests all pass.
- [ ] Run `pnpm build` — builds still work.
- [ ] Run `node tools/check-isolation.mjs` — no new violations.

---

## Phase B: 8 New Tools

Each tool follows the established pattern (see `packages/core/src/tools/compress/` for reference). For each:
1. `types.ts` with params interface + defaults
2. `index.ts` with ToolModule export
3. `test/tools/<id>/<id>.test.ts` with TDD tests
4. Export from `packages/core/src/index.ts`
5. Register in `default-registry.ts`
6. Commit

### Task B1: `rotate-image`

- **Id:** `rotate-image`
- **Category:** `edit`
- **Input:** image/jpeg, image/png, image/webp. Min 1.
- **Output:** same format as input (multiple).
- **Params:** `{ degrees: 90 | 180 | 270 }`. Default `{ degrees: 90 }`.
- **Memory:** low.
- **Implementation:** decode via jSquash, rotate pixel array by the specified angle (array reshuffle with dimension swap for 90/270), re-encode.

**Rotation math:**
- 90°: new dimensions (height, width). For each source pixel at (x, y), new pixel at (height-1-y, x). Iterate over source, write to dest at the rotated position.
- 180°: same dimensions. New pixel at (width-1-x, height-1-y).
- 270°: (height, width). New pixel at (y, width-1-x).

Write 3-5 tests:
- Metadata
- Rotates JPEG by 90°, output dimensions swapped
- Rotates PNG by 180°, output dimensions preserved
- Throws for invalid degrees

### Task B2: `flip-image`

- **Id:** `flip-image`
- **Category:** `edit`
- **Input:** image/*. Min 1.
- **Output:** same format.
- **Params:** `{ direction: 'horizontal' | 'vertical' }`. Default `{ direction: 'horizontal' }`.
- **Memory:** low.
- **Implementation:** decode, iterate pixels, reverse within each row (horizontal) or across rows (vertical), re-encode.

Tests: metadata, flips horizontally, flips vertically, preserves dimensions.

### Task B3: `grayscale`

- **Id:** `grayscale`
- **Category:** `edit`
- **Input:** image/*. Min 1.
- **Output:** same format.
- **Params:** `Record<string, never>`. No params.
- **Implementation:** decode, per pixel compute `0.299*R + 0.587*G + 0.114*B`, set R=G=B=that value, keep alpha, re-encode.

Tests: metadata, converts photo to grayscale (output pixels have R≈G≈B).

### Task B4: `sepia`

- **Id:** `sepia`
- **Category:** `edit`
- **Input:** image/*. Min 1.
- **Output:** same format.
- **Params:** no params.
- **Implementation:** per pixel:
  ```
  newR = min(255, 0.393*R + 0.769*G + 0.189*B)
  newG = min(255, 0.349*R + 0.686*G + 0.168*B)
  newB = min(255, 0.272*R + 0.534*G + 0.131*B)
  ```
  Standard sepia matrix.

Tests: metadata, applies sepia, output has warm tones (R > B).

### Task B5: `invert`

- **Id:** `invert`
- **Category:** `edit`
- **Input:** image/*. Min 1.
- **Output:** same format.
- **Params:** no params.
- **Implementation:** per pixel: `newR = 255 - R`, same for G and B, keep alpha.

Tests: metadata, inverts, double-inverting gives original (approximately).

### Task B6: `image-info`

- **Id:** `image-info`
- **Category:** `inspect`
- **Input:** image/jpeg, image/png, image/webp. Min 1, max 1.
- **Output:** `application/json`.
- **Params:** no params.
- **Implementation:** decode via jSquash to get width/height. Return JSON with:
  ```ts
  {
    format: 'jpeg' | 'png' | 'webp',
    mimeType: string,
    width: number,
    height: number,
    aspectRatio: string,    // e.g. "16:9" or "4:3" computed from GCD
    bytes: number,
    megapixels: number,
  }
  ```

Tests: metadata, extracts dimensions from photo.jpg, aspect ratio computed correctly.

### Task B7: `pdf-info`

- **Id:** `pdf-info`
- **Category:** `inspect`
- **Input:** application/pdf. Min 1, max 1.
- **Output:** application/json.
- **Params:** no params.
- **Implementation:** use pdf-lib (already installed). `PDFDocument.load(buf)` and read `.getPageCount()`, `.getTitle()`, `.getAuthor()`, `.getSubject()`, `.getProducer()`, `.getCreator()`, `.getCreationDate()`, `.getModificationDate()`.

Return JSON with:
```ts
{
  pageCount: number,
  bytes: number,
  title: string | null,
  author: string | null,
  subject: string | null,
  producer: string | null,
  creator: string | null,
  createdAt: string | null,       // ISO timestamp
  modifiedAt: string | null,
}
```

Tests: metadata, reads pageCount from doc-a.pdf, handles missing fields as null.

### Task B8: `hash`

- **Id:** `hash`
- **Category:** `inspect`
- **Input:** any (`*/*`). Min 1.
- **Output:** `application/json`.
- **Params:** `{ algorithms: Array<'SHA-256' | 'SHA-1' | 'SHA-512'> }`. Default `{ algorithms: ['SHA-256'] }`. (MD5 omitted — not in Web Crypto, and users who want it can ask in a future wave.)
- **Implementation:** use `crypto.subtle.digest(algorithm, buffer)` — native Web Crypto API, works in both browser and Node (Node 20+ has global `crypto`).

Return JSON per input file:
```ts
{
  name: string,
  bytes: number,
  hashes: { [algorithm]: string }   // lowercase hex
}
```

For batch (multiple inputs), return an array.

Tests: metadata, SHA-256 of photo.jpg is stable (same hash on repeat), supports multiple algorithms, handles batch inputs.

### Task B9: Register all 8 in default registry

Update `packages/core/src/default-registry.ts` to import and include all 8. Update exports in `packages/core/src/index.ts`. Add registry tests for each.

Commit: `feat(core): register wave 1e phase B tools in default registry`

### Task B10: Integration test — full chain demo

**File:** `packages/core/test/chain/wave-1e-chains.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runDefaultChain } from '../../src/chain/run-default.js';
import type { ToolRunContext } from '../../src/types.js';
import { loadFixture } from '../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'wave-1e-chain',
  };
}

describe('wave 1e chain demos', () => {
  it('rotate-image → sepia → compress on a photo', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'rotate-image', params: { degrees: 90 } },
      { toolId: 'sepia', params: {} },
      { toolId: 'compress', params: { quality: 70 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
  });

  it('grayscale → invert → compress inverts lightness', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'grayscale', params: {} },
      { toolId: 'invert', params: {} },
      { toolId: 'compress', params: { quality: 80 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
  });

  it('flip-image → strip-exif preserves format', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const chain = [
      { toolId: 'flip-image', params: { direction: 'vertical' } },
      { toolId: 'strip-exif', params: {} },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs[0]!.type).toBe('image/png');
  });
});
```

Commit: `test(core): integration tests for wave 1e chain demos`

### Task B11: End-to-end verification and tag

- [ ] `pnpm --filter @wyreup/core test` — all tests pass (expect ~230+ tests)
- [ ] `pnpm build` — all packages build
- [ ] `node tools/check-isolation.mjs && node tools/check-privacy.mjs && node tools/check-bundle-size.mjs` — all pass
- [ ] Tag: `git tag -a v0.1.0-wave1e -m "Wave 1e: chain execution + 8 tools (rotate/flip/filters/info/hash)"`
- [ ] Push: `git push origin main --tags`

---

## Exit summary

- `@wyreup/core` has **22 tools**
- `runChain()` actually executes multi-step chains against the default registry
- Real chain integration tests prove "rotate → sepia → compress" etc. work
- Tag `v0.1.0-wave1e` on GitHub

## What's next

After Wave 1e, remaining work before web:
- Canvas tools + runtime adapters (crop, resize, arbitrary rotation, pdf-to-image, image watermark) — 1 wave
- Complex non-canvas (html-to-pdf, compress-pdf, heic-to-jpg) — 1 wave
- Model-based (blur-faces, remove-background) — 1 wave

Or: pivot to web with 22 tools, which is already more than most competitors.
