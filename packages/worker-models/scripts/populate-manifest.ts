/**
 * One-time / periodic population of the SHA-256 manifest. Run via:
 *   pnpm --filter @wyreup/worker-models populate-manifest
 *
 * Downloads each pinned asset (sequentially to avoid hammering upstreams),
 * computes SHA-256, and prints the manifest entries to stdout. Operator
 * pastes the output into src/manifest.ts and commits.
 *
 * Does NOT modify manifest.ts directly — manifest edits should be a
 * reviewed change in git. The script is a one-shot CLI.
 *
 * Assets larger than MAX_HASHABLE_BYTES (~100 MB) are skipped with a notice;
 * the Cloudflare Worker cannot hash them in-band either (same memory budget).
 * m2m100_418M decoder weights (~1 GB) are the primary affected model.
 */

import { createHash } from 'node:crypto';

const ALLOWED_HF_MODELS: string[] = [
  'YatharthS/FlashSR',
  'Xenova/distilbart-cnn-6-6',
  'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  'Xenova/bert-base-NER',
  'Xenova/m2m100_418M',
  'Xenova/all-MiniLM-L6-v2',
  'Xenova/vit-gpt2-image-captioning',
  'Xenova/blip-image-captioning-base',
  'Xenova/clip-vit-base-patch16',
  'Xenova/trocr-small-handwritten',
  'Xenova/swin2SR-classical-sr-x2-64',
  'Xenova/whisper-tiny',
  'Xenova/whisper-base',
  'Xenova/whisper-small',
  'onnx-community/BiRefNet_lite-ONNX',
];

/**
 * Per-model file lists — what transformers.js actually fetches.
 * Adjust by observing actual network traffic from running each tool.
 * This is a conservative starting point; models without an override
 * fall back to the "default" list.
 */
const HF_FILES_PER_MODEL: Record<string, string[]> = {
  default: [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
  ],
  // Per-model overrides. Add as needed after observing real traffic.
  // Example:
  // 'Xenova/whisper-tiny': ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_fp16.onnx'],
};

/**
 * Pinned-prefix paths to hash. Populate from observed network traffic of the
 * mediapipe / GDAL tools. Each entry is the path segment used as the R2 key
 * (same as ALLOWED_PREFIXES in index.ts, minus the trailing slash).
 *
 * Example:
 *   '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_internal.wasm'
 */
const PINNED_PREFIX_PATHS: Array<{ key: string; upstreamBase: string }> = [
  // Populate from observed network traffic. For example:
  // { key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_internal.wasm', upstreamBase: 'https://cdn.jsdelivr.net/npm/' },
  // { key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_internal.js', upstreamBase: 'https://cdn.jsdelivr.net/npm/' },
];

/** Must match MAX_HASHABLE_BYTES in src/index.ts. */
const MAX_HASHABLE_BYTES = 100 * 1024 * 1024; // 100 MB

async function hashUrl(
  url: string,
): Promise<{ sha256: string; bytes: number } | null> {
  const res = await fetch(url);
  if (!res.ok) {
    process.stderr.write(`  ! ${url} — HTTP ${res.status}\n`);
    return null;
  }
  const clHeader = res.headers.get('content-length');
  const cl = clHeader ? Number(clHeader) : 0;
  if (cl > MAX_HASHABLE_BYTES) {
    process.stderr.write(
      `  ~ ${url} — ${(cl / 1024 / 1024).toFixed(0)} MB exceeds ${MAX_HASHABLE_BYTES / 1024 / 1024} MB cap; skipping (worker can't verify large assets)\n`,
    );
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_HASHABLE_BYTES) {
    process.stderr.write(
      `  ~ ${url} — ${(buf.byteLength / 1024 / 1024).toFixed(0)} MB exceeds cap (no Content-Length declared); skipping\n`,
    );
    return null;
  }
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return { sha256, bytes: buf.byteLength };
}

async function main(): Promise<void> {
  process.stdout.write('// Auto-generated manifest entries — paste into src/manifest.ts\n');
  process.stdout.write(`// Generated at: ${new Date().toISOString()}\n`);
  process.stdout.write('//\n');
  process.stdout.write('// MANIFEST entries:\n');

  for (const model of ALLOWED_HF_MODELS) {
    const files = HF_FILES_PER_MODEL[model] ?? HF_FILES_PER_MODEL['default']!;
    process.stdout.write(`\n  // ${model}\n`);
    for (const file of files) {
      const key = `${model}/resolve/main/${file}`;
      const url = `https://huggingface.co/${key}`;
      process.stderr.write(`fetching ${key}...\n`);
      const result = await hashUrl(url);
      if (result) {
        process.stdout.write(
          `  '${key}': { sha256: '${result.sha256}', bytes: ${result.bytes} },\n`,
        );
      } else {
        process.stdout.write(`  // '${key}': skipped (see stderr)\n`);
      }
    }
  }

  if (PINNED_PREFIX_PATHS.length > 0) {
    process.stdout.write('\n  // Pinned-prefix paths\n');
    for (const { key, upstreamBase } of PINNED_PREFIX_PATHS) {
      const url = `${upstreamBase}${key}`;
      process.stderr.write(`fetching ${key}...\n`);
      const result = await hashUrl(url);
      if (result) {
        process.stdout.write(
          `  '${key}': { sha256: '${result.sha256}', bytes: ${result.bytes} },\n`,
        );
      } else {
        process.stdout.write(`  // '${key}': skipped (see stderr)\n`);
      }
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`populate-manifest failed: ${String(err)}\n`);
  process.exit(1);
});
