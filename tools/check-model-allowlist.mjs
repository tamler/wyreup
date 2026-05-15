#!/usr/bin/env node
/**
 * Sync-check: every HuggingFace model ID referenced by a tool in
 * `packages/core/src/tools/` must appear in the Worker's allowlist
 * (`packages/worker-models/src/index.ts`). If a new AI tool is added
 * and the developer forgets to add the model to the Worker's allowlist,
 * production fetches would 403 — this check catches that pre-deploy.
 *
 * Run:    node tools/check-model-allowlist.mjs
 * Exits:  0 if in sync, 1 if anything is missing.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const TOOLS_DIR = 'packages/core/src/tools';
const WORKER_FILE = 'packages/worker-models/src/index.ts';

// Three patterns we recognise:
//  1. A bare `'owner/model'` literal — for `MODEL_ID = '<id>'` constants.
//  2. A `'owner/model/path/to/file'` literal — for tools that store the
//     full resolve path in a constant (audio-enhance / FlashSR shape).
//  3. A `huggingface.co/<owner>/<model>/...` URL — for tools that fetch
//     model files via URL rather than via transformers.js.
const QUOTED_PREFIX_RE = /['"`]([A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)(?:\/[^'"`]*)?['"`]/g;
const HF_URL_RE = /huggingface\.co\/([A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)\//g;

const SCAN_PREFIXES = [
  'Xenova/',
  'onnx-community/',
  'YatharthS/',
];

async function listToolFiles() {
  const entries = await readdir(TOOLS_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexFile = join(TOOLS_DIR, entry.name, 'index.ts');
    try {
      const content = await readFile(indexFile, 'utf8');
      files.push({ tool: entry.name, content });
    } catch {
      // tool has no index.ts (split files) — skip
    }
  }
  return files;
}

async function collectReferencedIds() {
  const tools = await listToolFiles();
  const refs = new Map(); // id → set of tool names
  function record(tool, id) {
    if (!SCAN_PREFIXES.some((p) => id.startsWith(p))) return;
    if (id.split('/').length !== 2) return;
    if (!refs.has(id)) refs.set(id, new Set());
    refs.get(id).add(tool);
  }
  for (const { tool, content } of tools) {
    QUOTED_PREFIX_RE.lastIndex = 0;
    let m;
    while ((m = QUOTED_PREFIX_RE.exec(content)) !== null) record(tool, m[1]);
    HF_URL_RE.lastIndex = 0;
    while ((m = HF_URL_RE.exec(content)) !== null) record(tool, m[1]);
  }
  return refs;
}

async function collectAllowedIds() {
  const content = await readFile(WORKER_FILE, 'utf8');
  // Match every string literal inside the ALLOWED_HF_MODELS Set.
  const section = content.match(/ALLOWED_HF_MODELS[^=]*=[^[]*\[([\s\S]*?)\]/);
  if (!section) {
    console.error('Could not locate ALLOWED_HF_MODELS in worker source.');
    process.exit(1);
  }
  const ids = new Set();
  for (const m of section[1].matchAll(/['"`]([A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)['"`]/g)) {
    ids.add(m[1]);
  }
  return ids;
}

const referenced = await collectReferencedIds();
const allowed = await collectAllowedIds();

const missing = [];
for (const [id, tools] of referenced.entries()) {
  if (!allowed.has(id)) missing.push({ id, tools: [...tools] });
}

const unused = [];
for (const id of allowed) {
  if (!referenced.has(id)) unused.push(id);
}

if (missing.length > 0) {
  console.error('Missing from Worker allowlist:');
  for (const { id, tools } of missing) {
    console.error(`  ${id}  (used by: ${tools.join(', ')})`);
  }
}
if (unused.length > 0) {
  console.warn('Allowed in Worker but no tool references it (safe to remove):');
  for (const id of unused) {
    console.warn(`  ${id}`);
  }
}

if (missing.length > 0) {
  console.error(
    `\n${missing.length} model id(s) need to be added to ALLOWED_HF_MODELS in ${WORKER_FILE}.`,
  );
  process.exit(1);
}

console.log(`Model allowlist sync OK — ${allowed.size} ids allowed, ${referenced.size} referenced.`);
