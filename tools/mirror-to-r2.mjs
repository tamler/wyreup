#!/usr/bin/env node
/**
 * One-time mirror script: fetch the AI-model assets from their upstream
 * CDNs and upload them to the wyreup-models R2 bucket at their canonical
 * paths. Idempotent — already-mirrored objects are skipped.
 *
 * Run:    node tools/mirror-to-r2.mjs [direct|transformers|all]
 * Default: direct
 */

import { execSync, spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUCKET = 'wyreup-models';
const TMP = join(tmpdir(), 'wyreup-mirror');
mkdirSync(TMP, { recursive: true });

const DIRECT_FILES = [
  // MediaPipe tasks-vision WASM (face-blur). Six files in the wasm/ dir.
  { upstream: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_internal.js',          key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_internal.js' },
  { upstream: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_internal.wasm',        key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_internal.wasm' },
  { upstream: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_module_internal.js',   key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_module_internal.js' },
  { upstream: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_module_internal.wasm', key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_module_internal.wasm' },
  { upstream: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_nosimd_internal.js',   key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_nosimd_internal.js' },
  { upstream: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_nosimd_internal.wasm', key: '@mediapipe/tasks-vision@0.10.34/wasm/vision_wasm_nosimd_internal.wasm' },
  // MediaPipe face-detector model (face-blur).
  { upstream: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite', key: 'mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
  // FlashSR ONNX (audio-enhance).
  { upstream: 'https://huggingface.co/YatharthS/FlashSR/resolve/main/onnx/model.onnx', key: 'YatharthS/FlashSR/resolve/main/onnx/model.onnx' },
  // gdal3.js bundle (convert-geo).
  { upstream: 'https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package/gdal3WebAssembly.wasm', key: 'gdal3.js@2.8.1/dist/package/gdal3WebAssembly.wasm' },
  { upstream: 'https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package/gdal3WebAssembly.data', key: 'gdal3.js@2.8.1/dist/package/gdal3WebAssembly.data' },
  { upstream: 'https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package/gdal3.js',              key: 'gdal3.js@2.8.1/dist/package/gdal3.js' },
];

const TRANSFORMERS_MODELS = [
  { id: 'onnx-community/BiRefNet_lite-ONNX', revision: 'main' },
  { id: 'Xenova/vit-gpt2-image-captioning',   revision: 'main' },
  { id: 'Xenova/blip-image-captioning-base',  revision: 'main' },
  { id: 'Xenova/clip-vit-base-patch16',       revision: 'main' },
  { id: 'Xenova/trocr-small-handwritten',     revision: 'main' },
  { id: 'Xenova/bert-base-NER',               revision: 'main' },
  { id: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english', revision: 'main' },
  { id: 'Xenova/all-MiniLM-L6-v2',            revision: 'main' },
  { id: 'Xenova/distilbart-cnn-6-6',          revision: 'main' },
  { id: 'Xenova/m2m100_418M',                 revision: 'main' },
  { id: 'Xenova/swin2SR-classical-sr-x2-64',  revision: 'main' },
  { id: 'Xenova/whisper-tiny',                revision: 'main' },
  { id: 'Xenova/whisper-base',                revision: 'main' },
  { id: 'Xenova/whisper-small',               revision: 'main' },
];

async function objectExists(key) {
  try {
    const out = execSync(
      `pnpm exec wrangler r2 object info ${BUCKET}/${JSON.stringify(key)} 2>&1`,
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString();
    return out.includes('Size') || out.includes('size');
  } catch {
    return false;
  }
}

async function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const p = spawn('curl', ['-fsSL', '-o', dest, url], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`curl failed for ${url}`))));
  });
}

async function uploadFile(key, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'pnpm',
      ['exec', 'wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (out += d.toString()));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`upload failed: ${key}\n${out}`))));
  });
}

async function mirrorOne({ upstream, key }) {
  if (await objectExists(key)) {
    console.log(`  skip (exists): ${key}`);
    return { skipped: true };
  }
  const tmpFile = join(TMP, key.replace(/[^a-zA-Z0-9.-]/g, '_'));
  console.log(`  fetch: ${upstream}`);
  await fetchToFile(upstream, tmpFile);
  const size = statSync(tmpFile).size;
  console.log(`  upload: ${key} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  await uploadFile(key, tmpFile);
  unlinkSync(tmpFile);
  return { skipped: false };
}

async function mirrorDirect() {
  console.log(`Mirroring ${DIRECT_FILES.length} direct-fetch files…`);
  let n = 0;
  for (const entry of DIRECT_FILES) {
    const r = await mirrorOne(entry);
    if (!r.skipped) n += 1;
  }
  console.log(`Direct mirror complete (${n} uploaded).`);
}

async function listHfTree(modelId, revision) {
  const url = `https://huggingface.co/api/models/${modelId}/tree/${revision}?recursive=true`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HF tree fetch failed: ${url} (${r.status})`);
  const tree = await r.json();
  return tree.filter((e) => e.type === 'file').map((e) => e.path);
}

async function mirrorTransformersModel({ id, revision }) {
  console.log(`Mirroring ${id}@${revision}…`);
  const files = await listHfTree(id, revision);
  console.log(`  ${files.length} files`);
  for (const f of files) {
    const upstream = `https://huggingface.co/${id}/resolve/${revision}/${f}`;
    const key = `${id}/resolve/${revision}/${f}`;
    await mirrorOne({ upstream, key });
  }
}

async function mirrorTransformers() {
  console.log(`Mirroring ${TRANSFORMERS_MODELS.length} transformers.js models…`);
  for (const m of TRANSFORMERS_MODELS) {
    await mirrorTransformersModel(m);
  }
  console.log('Transformers mirror complete.');
}

const mode = process.argv[2] ?? 'direct';
if (mode === 'direct') await mirrorDirect();
else if (mode === 'transformers') await mirrorTransformers();
else if (mode === 'all') {
  await mirrorDirect();
  await mirrorTransformers();
} else {
  console.error('Usage: node tools/mirror-to-r2.mjs [direct|transformers|all]');
  process.exit(1);
}
