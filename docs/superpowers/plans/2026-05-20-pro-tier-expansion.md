# Pro Tier Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new Workers-AI-backed Pro tools (5-tool vision flow, object detection, 2 chain tools) to Wyreup, with no new infrastructure.

**Architecture:** Each tool follows the existing four-place Pro wiring: a provider wrapper (`functions/_lib/providers/`), a server runner (`functions/_lib/runners.ts`), a server-authoritative price (`functions/_lib/pricing.ts`), and a client `ToolModule` (`packages/core/src/tools/<id>/index.ts`). All inference runs through the zero-ops `env.AI` Cloudflare binding. The existing reserve-then-refund ledger and `POST /api/tools/pro/run` endpoint already handle any tool present in `PRICING`.

**Tech Stack:** TypeScript, Cloudflare Pages Functions, Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct`, `@cf/facebook/detr-resnet-50`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/openai/whisper-large-v3-turbo`), Vitest, Svelte/Astro frontend.

Spec: `docs/superpowers/specs/2026-05-20-pro-tier-expansion-design.md`

---

## File Structure

**New files:**
- `functions/_lib/providers/vision-models.ts` — wraps the vision LLM + DETR detector
- `functions/_lib/providers/vision-models.test.ts` — provider unit tests
- `functions/_lib/runners.test.ts` — runner input-validation tests
- `packages/core/src/tools/ocr-hq/index.ts`
- `packages/core/src/tools/image-describe/index.ts`
- `packages/core/src/tools/analyze-chart/index.ts`
- `packages/core/src/tools/image-q-and-a/index.ts`
- `packages/core/src/tools/read-handwriting/index.ts`
- `packages/core/src/tools/detect-objects/index.ts`
- `packages/core/src/tools/translate-image/index.ts`
- `packages/core/src/tools/transcribe-and-translate/index.ts`

**Modified files:**
- `functions/_lib/runners.ts` — add 8 runner functions + register in `RUNNERS`
- `functions/_lib/pricing.ts` — add 8 `PRICING` entries
- `packages/core/src/tools/index.ts` — register the 8 new `ToolModule`s (confirm exact path in Task 11)

**Out of scope for this plan:** the LLM upgrade-seam for `regex/cron/sql-from-text` (separate plan — it modifies free-tool UX, a different integration shape), and Phase 1.5 embeddings.

---

## Task 1: Vision provider wrapper

**Files:**
- Create: `functions/_lib/providers/vision-models.ts`
- Test: `functions/_lib/providers/vision-models.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/_lib/providers/vision-models.test.ts
import { describe, it, expect, vi } from 'vitest';
import { visionPrompt, detectObjects } from './vision-models';
import type { Env } from '../env';

function mockEnv(aiResult: unknown): Env {
  return { AI: { run: vi.fn().mockResolvedValue(aiResult) } } as unknown as Env;
}

describe('visionPrompt', () => {
  it('returns the trimmed response string', async () => {
    const env = mockEnv({ response: '  hello text  ' });
    const out = await visionPrompt(env, new Uint8Array([1, 2, 3]), 'extract text');
    expect(out).toBe('hello text');
  });

  it('throws when the model returns no response', async () => {
    const env = mockEnv({ tool_calls: [] });
    await expect(visionPrompt(env, new Uint8Array([1]), 'x')).rejects.toThrow(
      'Vision model returned no response',
    );
  });
});

describe('detectObjects', () => {
  it('passes through a detection array', async () => {
    const dets = [{ score: 0.9, label: 'cat', box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } }];
    const env = mockEnv(dets);
    const out = await detectObjects(env, new Uint8Array([1]));
    expect(out).toEqual(dets);
  });

  it('throws when the model does not return an array', async () => {
    const env = mockEnv({ error: 'nope' });
    await expect(detectObjects(env, new Uint8Array([1]))).rejects.toThrow(
      'Detection model returned no array',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/providers/vision-models.test.ts`
Expected: FAIL — cannot find module `./vision-models`.

- [ ] **Step 3: Write the provider**

```typescript
// functions/_lib/providers/vision-models.ts
//
// Vision-model provider wrapper.
//
// One file, one vendor — replace the body when switching backends. Public
// signatures (`visionPrompt`, `detectObjects`) are what the rest of the
// code imports, so swaps don't ripple beyond this module.
//
// Current backend: Cloudflare Workers AI. The env.AI binding ships with
// Pages Functions — no token needed.

import type { Env } from '../env';

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DETECTION_MODEL = '@cf/facebook/detr-resnet-50';

export interface DetectedObject {
  score: number;
  label: string;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

// Single-turn vision prompt: one image + one instruction → text.
export async function visionPrompt(
  env: Env,
  imageBytes: Uint8Array,
  prompt: string,
): Promise<string> {
  const res = (await env.AI.run(VISION_MODEL, {
    image: Array.from(imageBytes),
    prompt,
    max_tokens: 1024,
  })) as { response?: string };
  if (!res || typeof res.response !== 'string') {
    throw new Error('Vision model returned no response');
  }
  return res.response.trim();
}

export async function detectObjects(
  env: Env,
  imageBytes: Uint8Array,
): Promise<DetectedObject[]> {
  const res = (await env.AI.run(DETECTION_MODEL, {
    image: Array.from(imageBytes),
  })) as unknown;
  if (!Array.isArray(res)) {
    throw new Error('Detection model returned no array');
  }
  return res as DetectedObject[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/providers/vision-models.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Probe the live binding to confirm API shapes**

The Cloudflare docs do not fully specify the vision `image` field format or
the DETR output object keys. Confirm against the live binding before
relying on the wrapper:

Run: `pnpm wrangler pages dev packages/web/dist` (after a build), then in a
scratch function or via the existing `/api/tools/pro/run` path, call each
model once with a small test image and log the raw result.

Expected: `visionPrompt` — raw result has a string `response`. `detectObjects`
— raw result is an array of objects with `score`, `label`, `box` keys.
If either differs, adjust ONLY `vision-models.ts` (the wrapper isolates it).

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/providers/vision-models.ts functions/_lib/providers/vision-models.test.ts
git commit -m "feat(pro): add vision-models provider wrapper (Workers AI)"
```

---

## Task 2: Shared image-input helper in runners.ts

**Files:**
- Modify: `functions/_lib/runners.ts`
- Test: `functions/_lib/runners.test.ts`

`runners.ts` already has `base64ToUint8Array`. Vision runners need a helper
that reads an untrusted `imageBase64` field, enforces a size cap, and
decodes — mirroring how `transcribePro` caps audio.

- [ ] **Step 1: Write the failing test**

```typescript
// functions/_lib/runners.test.ts
import { describe, it, expect } from 'vitest';
import { __readImageBytes } from './runners';

// A 1x1 PNG, base64.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('__readImageBytes', () => {
  it('decodes a valid base64 image', () => {
    const bytes = __readImageBytes({ imageBase64: TINY_PNG });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('throws when imageBase64 is missing', () => {
    expect(() => __readImageBytes({})).toThrow('imageBase64 required');
  });

  it('throws when the image exceeds the size cap', () => {
    const huge = 'A'.repeat(20 * 1024 * 1024);
    expect(() => __readImageBytes({ imageBase64: huge })).toThrow('exceeds');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `__readImageBytes` is not exported.

- [ ] **Step 3: Add the helper to runners.ts**

Add near the other helpers at the bottom of `functions/_lib/runners.ts`
(after `readImageRef`):

```typescript
// 10 MB cap on vision inputs — bounds the per-run inference cost so a
// malicious caller can't bypass the client check. Exported as
// __readImageBytes for unit testing only.
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export function __readImageBytes(raw: RunnerInput): Uint8Array {
  const v = (raw as Record<string, unknown>).imageBase64;
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('imageBase64 required');
  }
  if (v.length > Math.ceil(IMAGE_MAX_BYTES * 1.4)) {
    throw new Error(`Image exceeds ${IMAGE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  const bytes = base64ToUint8Array(v);
  if (bytes.length > IMAGE_MAX_BYTES) {
    throw new Error(`Image exceeds ${IMAGE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  return bytes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add image-input helper with size cap to runners"
```

---

## Task 3: `ocr-hq` runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`:

```typescript
import { runPro } from './runners';
import { vi } from 'vitest';

function aiEnv(result: unknown) {
  return { AI: { run: vi.fn().mockResolvedValue(result) } } as unknown as import('./env').Env;
}

describe('ocr-hq runner', () => {
  it('returns extracted text', async () => {
    const env = aiEnv({ response: 'INVOICE 2024' });
    const out = (await runPro('ocr-hq', { imageBase64: TINY_PNG }, env)) as { text: string };
    expect(out.text).toBe('INVOICE 2024');
  });

  it('rejects a missing image', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('ocr-hq', {}, env)).rejects.toThrow('imageBase64 required');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'ocr-hq'`.

- [ ] **Step 3: Add the runner**

In `functions/_lib/runners.ts`: add the import (merge with existing
provider imports at the top):

```typescript
import { visionPrompt, detectObjects } from './providers/vision-models';
```

Add `'ocr-hq': ocrHq,` to the `RUNNERS` map. Add the runner function in a
new "Vision tools" section:

```typescript
// ────────────────────────────────────────────────────────────────────────
// Vision tools — Workers AI vision model via the vision-models wrapper
// ────────────────────────────────────────────────────────────────────────

async function ocrHq(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const text = await visionPrompt(
    env,
    image,
    'Extract all text from this image exactly as it appears, preserving line breaks and reading order. Return ONLY the extracted text — no commentary, no description.',
  );
  return { text };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add to the `PRICING` object:

```typescript
  'ocr-hq': 2,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add ocr-hq server runner"
```

---

## Task 4: `image-describe` runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`:

```typescript
describe('image-describe runner', () => {
  it('returns a description', async () => {
    const env = aiEnv({ response: 'A red bicycle leaning on a wall.' });
    const out = (await runPro('image-describe', { imageBase64: TINY_PNG }, env)) as {
      description: string;
    };
    expect(out.description).toBe('A red bicycle leaning on a wall.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'image-describe'`.

- [ ] **Step 3: Add the runner**

Add `'image-describe': imageDescribe,` to `RUNNERS`. Add to the Vision
section of `functions/_lib/runners.ts`:

```typescript
async function imageDescribe(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const description = await visionPrompt(
    env,
    image,
    'Describe this image in 1-3 clear sentences suitable as alt-text. Be factual and concise. Return ONLY the description.',
  );
  return { description };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add: `'image-describe': 2,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add image-describe server runner"
```

---

## Task 5: `analyze-chart` runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`:

```typescript
describe('analyze-chart runner', () => {
  it('returns an analysis', async () => {
    const env = aiEnv({ response: 'Bar chart: sales rose Q1 to Q4.' });
    const out = (await runPro('analyze-chart', { imageBase64: TINY_PNG }, env)) as {
      analysis: string;
    };
    expect(out.analysis).toBe('Bar chart: sales rose Q1 to Q4.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'analyze-chart'`.

- [ ] **Step 3: Add the runner**

Add `'analyze-chart': analyzeChart,` to `RUNNERS`. Add to the Vision
section:

```typescript
async function analyzeChart(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const analysis = await visionPrompt(
    env,
    image,
    'This image is a chart, graph, or diagram. Identify the chart type, then summarize the data and the main trend or takeaway in plain text. List key data points if readable. Return ONLY the analysis.',
  );
  return { analysis };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add: `'analyze-chart': 2,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add analyze-chart server runner"
```

---

## Task 6: `image-q-and-a` runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`:

```typescript
describe('image-q-and-a runner', () => {
  it('returns an answer to the question', async () => {
    const env = aiEnv({ response: 'Three people are visible.' });
    const out = (await runPro(
      'image-q-and-a',
      { imageBase64: TINY_PNG, question: 'How many people?' },
      env,
    )) as { answer: string };
    expect(out.answer).toBe('Three people are visible.');
  });

  it('rejects a missing question', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(
      runPro('image-q-and-a', { imageBase64: TINY_PNG }, env),
    ).rejects.toThrow("'question'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'image-q-and-a'`.

- [ ] **Step 3: Add the runner**

Add `'image-q-and-a': imageQandA,` to `RUNNERS`. Add to the Vision section
(`readText` already exists in `runners.ts` and enforces a non-empty string
and a 100k cap):

```typescript
async function imageQandA(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const question = readText(raw, 'question');
  const answer = await visionPrompt(
    env,
    image,
    `Answer this question about the image based only on what is visible. Question: ${question}\nReturn ONLY the answer.`,
  );
  return { answer };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add: `'image-q-and-a': 2,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add image-q-and-a server runner"
```

---

## Task 7: `read-handwriting` runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`:

```typescript
describe('read-handwriting runner', () => {
  it('returns transcribed handwriting', async () => {
    const env = aiEnv({ response: 'Meeting at 3pm' });
    const out = (await runPro('read-handwriting', { imageBase64: TINY_PNG }, env)) as {
      text: string;
    };
    expect(out.text).toBe('Meeting at 3pm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'read-handwriting'`.

- [ ] **Step 3: Add the runner**

Add `'read-handwriting': readHandwriting,` to `RUNNERS`. Add to the Vision
section:

```typescript
async function readHandwriting(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const text = await visionPrompt(
    env,
    image,
    'This image contains handwritten text. Transcribe the handwriting as accurately as possible, preserving line breaks. If a word is illegible, write [illegible]. Return ONLY the transcription.',
  );
  return { text };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add: `'read-handwriting': 2,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add read-handwriting server runner"
```

---

## Task 8: `detect-objects` runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`:

```typescript
describe('detect-objects runner', () => {
  it('returns detected objects sorted by score', async () => {
    const env = aiEnv([
      { score: 0.5, label: 'dog', box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
      { score: 0.9, label: 'cat', box: { xmin: 2, ymin: 2, xmax: 3, ymax: 3 } },
    ]);
    const out = (await runPro('detect-objects', { imageBase64: TINY_PNG }, env)) as {
      objects: { label: string; score: number }[];
    };
    expect(out.objects[0].label).toBe('cat');
    expect(out.objects.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'detect-objects'`.

- [ ] **Step 3: Add the runner**

Add `'detect-objects': detectObjectsPro,` to `RUNNERS`. Add to the Vision
section (`detectObjects` is already imported in Task 3's import line):

```typescript
async function detectObjectsPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const found = await detectObjects(env, image);
  // Highest-confidence first; round scores for a clean UI / chainable JSON.
  const objects = found
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((o) => ({
      label: o.label,
      score: Math.round(o.score * 1000) / 1000,
      box: o.box,
    }));
  return { objects, count: objects.length };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add: `'detect-objects': 1,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add detect-objects server runner"
```

---

## Task 9: `translate-image` chain runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

This runner chains two model calls: vision OCR, then text translation. The
`chat` text-model wrapper is already imported in `runners.ts`.

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`:

```typescript
describe('translate-image runner', () => {
  it('OCRs then translates, returning both', async () => {
    // First AI.run = vision OCR, second = text translation.
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: 'Hola mundo' })
      .mockResolvedValueOnce({ response: 'Hello world' });
    const env = { AI: { run } } as unknown as import('./env').Env;
    const out = (await runPro(
      'translate-image',
      { imageBase64: TINY_PNG, target: 'English' },
      env,
    )) as { sourceText: string; translation: string; target: string };
    expect(out.sourceText).toBe('Hola mundo');
    expect(out.translation).toBe('Hello world');
    expect(out.target).toBe('English');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'translate-image'`.

- [ ] **Step 3: Add the runner**

Add `'translate-image': translateImage,` to `RUNNERS`. Add a new "Chain
tools" section to `functions/_lib/runners.ts`:

```typescript
// ────────────────────────────────────────────────────────────────────────
// Chain tools — combine more than one model in a single runner
// ────────────────────────────────────────────────────────────────────────

async function translateImage(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const target =
    typeof (raw as Record<string, unknown>).target === 'string' &&
    ((raw as Record<string, unknown>).target as string).trim().length > 0
      ? ((raw as Record<string, unknown>).target as string).trim()
      : 'English';

  const sourceText = await visionPrompt(
    env,
    image,
    'Extract all text from this image exactly as it appears. Return ONLY the text.',
  );
  if (sourceText.trim().length === 0) {
    throw new Error('No text found in the image to translate');
  }
  const translation = await chat(
    env,
    `You are a translator. Translate the user message into ${target}. Return ONLY the translation — no commentary, no original text, no quotation marks.`,
    sourceText,
  );
  return { sourceText, translation, target };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add: `'translate-image': 3,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add translate-image chain runner"
```

---

## Task 10: `transcribe-and-translate` chain runner + price

**Files:**
- Modify: `functions/_lib/runners.ts`
- Modify: `functions/_lib/pricing.ts`
- Test: `functions/_lib/runners.test.ts`

Chains Whisper transcription then text translation. `runTranscribe` is
already imported in `runners.ts`.

- [ ] **Step 1: Write the failing test**

Add to `functions/_lib/runners.test.ts`. A tiny valid base64 audio payload
is not needed — the transcribe path accepts any non-empty `audioBase64`
string under the cap; the mocked `AI.run` returns the transcript.

```typescript
describe('transcribe-and-translate runner', () => {
  it('transcribes then translates', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bonjour le monde' }) // whisper
      .mockResolvedValueOnce({ response: 'Hello world' }); // translate
    const env = { AI: { run } } as unknown as import('./env').Env;
    const out = (await runPro(
      'transcribe-and-translate',
      { audioBase64: 'QUJD', target: 'English' },
      env,
    )) as { transcript: string; translation: string; target: string };
    expect(out.transcript).toBe('Bonjour le monde');
    expect(out.translation).toBe('Hello world');
  });

  it('rejects missing audio', async () => {
    const env = aiEnv({ text: 'x' });
    await expect(
      runPro('transcribe-and-translate', { target: 'English' }, env),
    ).rejects.toThrow('audioBase64 required');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: FAIL — `No hosted runner registered for tool 'transcribe-and-translate'`.

- [ ] **Step 3: Add the runner**

Add `'transcribe-and-translate': transcribeAndTranslate,` to `RUNNERS`. Add
to the Chain tools section:

```typescript
async function transcribeAndTranslate(
  raw: RunnerInput,
  env: Env,
): Promise<RunnerOutput> {
  const input = raw as TranscribeInput;
  if (typeof input.audioBase64 !== 'string' || input.audioBase64.length === 0) {
    throw new Error('audioBase64 required');
  }
  if (input.audioBase64.length > Math.ceil(TRANSCRIBE_MAX_BYTES * 1.4)) {
    throw new Error(`Audio exceeds ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  const bytes = base64ToUint8Array(input.audioBase64);
  if (bytes.length > TRANSCRIBE_MAX_BYTES) {
    throw new Error(`Audio exceeds ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  const target =
    typeof (raw as Record<string, unknown>).target === 'string' &&
    ((raw as Record<string, unknown>).target as string).trim().length > 0
      ? ((raw as Record<string, unknown>).target as string).trim()
      : 'English';

  const { text: transcript } = await runTranscribe(env, {
    bytes,
    language: input.language,
  });
  if (transcript.trim().length === 0) {
    throw new Error('No speech found in the audio to translate');
  }
  const translation = await chat(
    env,
    `You are a translator. Translate the user message into ${target}. Return ONLY the translation — no commentary, no original text, no quotation marks.`,
    transcript,
  );
  return { transcript, translation, target };
}
```

- [ ] **Step 4: Add the price**

In `functions/_lib/pricing.ts`, add: `'transcribe-and-translate': 6,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run functions/_lib/runners.test.ts`
Expected: PASS — all runner tests green.

- [ ] **Step 6: Typecheck the functions package**

Run: `pnpm exec tsc --noEmit -p functions/tsconfig.json`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/runners.ts functions/_lib/pricing.ts functions/_lib/runners.test.ts
git commit -m "feat(pro): add transcribe-and-translate chain runner"
```

---

## Task 11: Locate the client tool registry

**Files:**
- Inspect: `packages/core/src/tools/index.ts` (confirm path)

The 8 client `ToolModule`s must be registered where existing Pro tools are.
Before writing them, confirm the registry location and pattern.

- [ ] **Step 1: Find where existing Pro tools are registered**

Run: `grep -rn "textSummarizePro" packages/core/src --include="*.ts"`
Expected: an import + a registration entry, likely in
`packages/core/src/tools/index.ts` or a registry array.

- [ ] **Step 2: Note the exact file and pattern**

Record the registry file path and how a tool is added (import line +
array/map entry). Tasks 12-19 each add one tool; Task 20 wires all 8 imports
+ registrations into this file in one edit.

No commit — inspection only.

---

## Task 12: `ocr-hq` client ToolModule

**Files:**
- Create: `packages/core/src/tools/ocr-hq/index.ts`

The `run()` reads the input image File, base64-encodes it, and calls
`runPro`. Pattern follows `text-summarize-pro/index.ts`. A File is converted
to base64 by reading an ArrayBuffer and `btoa`-ing the bytes.

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/ocr-hq/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const ocrHq: ToolModule<Record<string, never>> = {
  id: 'ocr-hq',
  slug: 'ocr-hq',
  name: 'OCR (PRO)',
  description:
    'High-quality text extraction from images and scans, powered by a hosted vision model. Output is plain text — chains into translate, summarize, and other text tools. Uses 2 credits per run.',
  category: 'image',
  keywords: ['ocr', 'text', 'extract', 'scan', 'pro', 'vision', 'hosted'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro', 'text-summarize-pro', 'text-sentences'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('ocr-hq accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ text: string }>(
      'ocr-hq',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.text], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean (the tool is not yet registered, but the file must compile).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/ocr-hq/index.ts
git commit -m "feat(pro): add ocr-hq client tool module"
```

---

## Task 13: `image-describe` client ToolModule

**Files:**
- Create: `packages/core/src/tools/image-describe/index.ts`

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/image-describe/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const imageDescribe: ToolModule<Record<string, never>> = {
  id: 'image-describe',
  slug: 'image-describe',
  name: 'Describe Image (PRO)',
  description:
    'Generates a concise description / alt-text for an image using a hosted vision model. Output is plain text. Uses 2 credits per run.',
  category: 'image',
  keywords: ['describe', 'caption', 'alt-text', 'accessibility', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro', 'text-summarize-pro'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('image-describe accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ description: string }>(
      'image-describe',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.description], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/image-describe/index.ts
git commit -m "feat(pro): add image-describe client tool module"
```

---

## Task 14: `analyze-chart` client ToolModule

**Files:**
- Create: `packages/core/src/tools/analyze-chart/index.ts`

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/analyze-chart/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const analyzeChart: ToolModule<Record<string, never>> = {
  id: 'analyze-chart',
  slug: 'analyze-chart',
  name: 'Analyze Chart (PRO)',
  description:
    'Reads a chart, graph, or diagram image and explains the data and main trend in plain text. Uses 2 credits per run.',
  category: 'image',
  keywords: ['chart', 'graph', 'diagram', 'analyze', 'data', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-translate-pro'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('analyze-chart accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ analysis: string }>(
      'analyze-chart',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.analysis], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/analyze-chart/index.ts
git commit -m "feat(pro): add analyze-chart client tool module"
```

---

## Task 15: `image-q-and-a` client ToolModule

**Files:**
- Create: `packages/core/src/tools/image-q-and-a/index.ts`

This tool has a required `question` parameter.

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/image-q-and-a/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface ImageQandAParams {
  question: string;
}

export const defaultImageQandAParams: ImageQandAParams = { question: '' };

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const imageQandA: ToolModule<ImageQandAParams> = {
  id: 'image-q-and-a',
  slug: 'image-q-and-a',
  name: 'Ask About Image (PRO)',
  description:
    'Ask a question about an image and get an answer from a hosted vision model. Uses 2 credits per run.',
  category: 'image',
  keywords: ['question', 'answer', 'vqa', 'image', 'ask', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro'],

  defaults: defaultImageQandAParams,
  paramSchema: {
    question: {
      type: 'string',
      label: 'question',
      placeholder: 'What is written on the sign?',
      help: 'The question to ask about the uploaded image.',
    },
  },

  async run(
    inputs: File[],
    params: ImageQandAParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('image-q-and-a accepts exactly one image.');
    const question = params.question?.trim();
    if (!question) throw new Error('A question is required.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ answer: string }>(
      'image-q-and-a',
      { imageBase64, question, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.answer], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/image-q-and-a/index.ts
git commit -m "feat(pro): add image-q-and-a client tool module"
```

---

## Task 16: `read-handwriting` client ToolModule

**Files:**
- Create: `packages/core/src/tools/read-handwriting/index.ts`

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/read-handwriting/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const readHandwriting: ToolModule<Record<string, never>> = {
  id: 'read-handwriting',
  slug: 'read-handwriting',
  name: 'Read Handwriting (PRO)',
  description:
    'Transcribes handwritten text from an image using a hosted vision model. Output is plain text. Uses 2 credits per run.',
  category: 'image',
  keywords: ['handwriting', 'handwritten', 'transcribe', 'ocr', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro', 'text-summarize-pro'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('read-handwriting accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ text: string }>(
      'read-handwriting',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.text], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/read-handwriting/index.ts
git commit -m "feat(pro): add read-handwriting client tool module"
```

---

## Task 17: `detect-objects` client ToolModule

**Files:**
- Create: `packages/core/src/tools/detect-objects/index.ts`

Output is JSON (object list). `outputDisplay` is `'json'` and `output.mime`
is `application/json` so downstream JSON tools can chain.

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/detect-objects/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

interface DetectedObject {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const detectObjects: ToolModule<Record<string, never>> = {
  id: 'detect-objects',
  slug: 'detect-objects',
  name: 'Detect Objects (PRO)',
  description:
    'Detects and locates objects in an image, returning labels, confidence scores, and bounding boxes as JSON. Uses 1 credit per run.',
  category: 'image',
  keywords: ['detect', 'objects', 'bounding box', 'count', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'json',

  chainSuggestions: ['json-path', 'json-to-xml'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('detect-objects accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ objects: DetectedObject[]; count: number }>(
      'detect-objects',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/detect-objects/index.ts
git commit -m "feat(pro): add detect-objects client tool module"
```

---

## Task 18: `translate-image` client ToolModule

**Files:**
- Create: `packages/core/src/tools/translate-image/index.ts`

Has an optional `target` language parameter (defaults to English).

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/translate-image/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TranslateImageParams {
  target: string;
}

export const defaultTranslateImageParams: TranslateImageParams = { target: 'English' };

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const translateImage: ToolModule<TranslateImageParams> = {
  id: 'translate-image',
  slug: 'translate-image',
  name: 'Translate Image Text (PRO)',
  description:
    'Extracts text from an image and translates it. Photograph a sign or document, get the translation. Uses 3 credits per run.',
  category: 'image',
  keywords: ['translate', 'image', 'ocr', 'sign', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 3,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-sentences'],

  defaults: defaultTranslateImageParams,
  paramSchema: {
    target: {
      type: 'string',
      label: 'translate to',
      placeholder: 'English',
      help: 'The language to translate the image text into.',
    },
  },

  async run(
    inputs: File[],
    params: TranslateImageParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('translate-image accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ translation: string; target: string }>(
      'translate-image',
      { imageBase64, target: params.target?.trim() || 'English', fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.translation], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/translate-image/index.ts
git commit -m "feat(pro): add translate-image client tool module"
```

---

## Task 19: `transcribe-and-translate` client ToolModule

**Files:**
- Create: `packages/core/src/tools/transcribe-and-translate/index.ts`

Audio input. Has an optional `target` language parameter. The audio is
base64-encoded the same way the existing `transcribe-pro` tool does it —
use the same `fileToBase64` helper since it is modality-agnostic.

- [ ] **Step 1: Write the ToolModule**

```typescript
// packages/core/src/tools/transcribe-and-translate/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TranscribeAndTranslateParams {
  target: string;
}

export const defaultTranscribeAndTranslateParams: TranscribeAndTranslateParams = {
  target: 'English',
};

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const transcribeAndTranslate: ToolModule<TranscribeAndTranslateParams> = {
  id: 'transcribe-and-translate',
  slug: 'transcribe-and-translate',
  name: 'Transcribe & Translate (PRO)',
  description:
    'Transcribes an audio file and translates the transcript in one step. Uses 6 credits per run.',
  category: 'audio',
  keywords: ['transcribe', 'translate', 'audio', 'speech', 'pro', 'hosted'],

  input: {
    accept: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'],
    min: 1,
    max: 1,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 6,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-sentences'],

  defaults: defaultTranscribeAndTranslateParams,
  paramSchema: {
    target: {
      type: 'string',
      label: 'translate to',
      placeholder: 'English',
      help: 'The language to translate the transcript into.',
    },
  },

  async run(
    inputs: File[],
    params: TranscribeAndTranslateParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) {
      throw new Error('transcribe-and-translate accepts exactly one audio file.');
    }
    const audioBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ translation: string; transcript: string; target: string }>(
      'transcribe-and-translate',
      { audioBase64, target: params.target?.trim() || 'English', fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.translation], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wyreup/core exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/transcribe-and-translate/index.ts
git commit -m "feat(pro): add transcribe-and-translate client tool module"
```

---

## Task 20: Register all 8 tools in the core registry

**Files:**
- Modify: the registry file confirmed in Task 11 (expected `packages/core/src/tools/index.ts`)

- [ ] **Step 1: Add the imports**

In the registry file, alongside the existing Pro-tool imports (e.g.
`textSummarizePro`), add:

```typescript
import { ocrHq } from './ocr-hq/index.js';
import { imageDescribe } from './image-describe/index.js';
import { analyzeChart } from './analyze-chart/index.js';
import { imageQandA } from './image-q-and-a/index.js';
import { readHandwriting } from './read-handwriting/index.js';
import { detectObjects } from './detect-objects/index.js';
import { translateImage } from './translate-image/index.js';
import { transcribeAndTranslate } from './transcribe-and-translate/index.js';
```

(Match the exact import style observed in Task 11 — with or without
`/index.js`, named vs default.)

- [ ] **Step 2: Add the registrations**

Add all 8 to the registry array/map exactly where `textSummarizePro` is
registered:

```typescript
  ocrHq,
  imageDescribe,
  analyzeChart,
  imageQandA,
  readHandwriting,
  detectObjects,
  translateImage,
  transcribeAndTranslate,
```

- [ ] **Step 3: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: all packages pass, 0 errors.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, including the registry's tool-validation tests
(every registered tool must have valid metadata + `__testFixtures`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/index.ts
git commit -m "feat(pro): register 8 new Workers AI Pro tools"
```

---

## Task 21: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build and serve locally**

Run: `pnpm --filter @wyreup/web build && pnpm wrangler pages dev packages/web/dist`

- [ ] **Step 2: Grant yourself credits**

Sign in with your API key, then use the `/admin` credit-grant (or a direct
`credit_events` insert) to give your account ~50 credits. LS is not
required for this.

- [ ] **Step 3: Exercise each new tool in the browser**

For each of `ocr-hq`, `image-describe`, `analyze-chart`, `image-q-and-a`,
`read-handwriting`, `detect-objects`, `translate-image`,
`transcribe-and-translate`: upload a real input, run it, confirm a
sensible result and that the credit balance drops by the tool's cost.

- [ ] **Step 4: Confirm refund-on-failure**

Run one tool with a deliberately invalid input (e.g. a 0-byte file).
Confirm the run fails gracefully and the reserved credits are refunded
(balance unchanged after the failed run).

- [ ] **Step 5: Confirm one chain**

Run `ocr-hq` on an image, then feed its text output into
`text-summarize-pro`. Confirm the chain suggestion appears and the
hand-off works.

- [ ] **Step 6: Final commit (docs)**

Mark the plan complete and update the roadmap if desired. No code commit
needed if Steps 1-5 revealed no defects.

---

## Self-Review

**Spec coverage:**
- 5-tool vision flow → Tasks 3-7 (runners), 12-16 (clients) ✓
- `detect-objects` → Task 8, 17 ✓
- `translate-image`, `transcribe-and-translate` chain tools → Tasks 9-10, 18-19 ✓
- Provider wrapper (`vision-models.ts`) → Task 1 ✓
- Pricing entries → Tasks 3-10 ✓
- Client `ToolModule`s + registration → Tasks 12-20 ✓
- Testing (fixtures, runner validation tests) → every task + Task 21 ✓
- Chaining (MIME-compatible outputs, `chainSuggestions`) → set in every client task ✓
- LLM upgrade-seam → explicitly deferred to a separate plan (noted in File Structure) ✓
- Phase 1.5 embeddings, Phase 2 GPU → out of scope, noted ✓

**Placeholder scan:** No TBD/TODO. Task 11 is an inspection task feeding Task 20; Task 1 Step 5 is a real live-binding probe, not a placeholder. The only intentional flexibility is "match the exact import style from Task 11" — unavoidable until the registry file is read.

**Type consistency:** Runner return shapes match client `runPro<…>` generics: `ocr-hq`/`read-handwriting` → `{ text }`; `image-describe` → `{ description }`; `analyze-chart` → `{ analysis }`; `image-q-and-a` → `{ answer }`; `detect-objects` → `{ objects, count }`; `translate-image` → `{ translation, target }` (also returns `sourceText`, unused by the client); `transcribe-and-translate` → `{ translation, transcript, target }`. `visionPrompt` / `detectObjects` signatures match between Task 1 and their callers. `__readImageBytes` defined in Task 2, used Tasks 3-9.
