// Bundle size check: enforce per-file gzipped size budget.
//
// Default budget is tight (150 KB gzipped) so per-page entry chunks stay
// fast. A handful of vendor lazy-chunks legitimately exceed that — each is
// loaded only when a specific tool runs, behind a dynamic import — so we
// give them their own budget with a documented reason. New entries here
// require justification in the comment.

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

const DEFAULT_BUDGET_KB = 150;

/**
 * Per-file budget overrides. Filename matches by basename startsWith
 * (Astro emits hashed names like `gpt-4o.D_UW28gY.js`). Each entry is a
 * line of "this big lib is loaded only when X tool runs" justification.
 *
 * If a user is on a slow connection, these only download when the tool
 * is invoked — not on first paint of the homepage.
 */
const VENDOR_BUDGETS_KB = [
  // gpt-tokenizer's BPE vocabulary for GPT-4o; lazy-loaded by token-count.
  { prefix: 'gpt-4o.', budgetKb: 1100, why: 'gpt-tokenizer vocab; token-count tool only' },
  // pdfjs-dist worker; loaded by every PDF tool but as a Web Worker.
  { prefix: 'pdf.worker.', budgetKb: 600, why: 'pdfjs Web Worker; PDF tools only' },
  // pdfjs main chunk; loaded by PDF render tools.
  { prefix: 'pdf.', budgetKb: 500, why: 'pdfjs core; PDF tools only' },
  // SVGO; loaded by svg-optimizer.
  { prefix: 'svgo-node.', budgetKb: 250, why: 'svgo; svg-optimizer tool only' },
  // OpenPGP.js; loaded by PGP tools.
  { prefix: 'openpgp.', budgetKb: 250, why: 'openpgp; pgp-* tools only' },
  // transformers.js base; loaded by AI text/image tools.
  { prefix: 'transformers.web.', budgetKb: 200, why: 'transformers.js; AI text/image tools' },
  // ONNX Runtime web bundle; loaded by AI tools that need it.
  { prefix: 'ort.bundle.', budgetKb: 500, why: 'onnxruntime-web; AI tools only' },
  // xlsx (SheetJS); loaded by Excel tools.
  { prefix: 'xlsx.', budgetKb: 500, why: 'sheetjs; excel-* tools only' },
  // Main app entry. Larger than ideal — see ROADMAP "Tech debt" #5
  // (lazy-load runner variants in ToolRunner.svelte). Capped at 500 KB
  // to ring the alarm if it grows further while we work toward shrinking
  // it. Don't raise this without first re-evaluating the runner-split.
  { prefix: 'main.', budgetKb: 500, why: 'app entry; ROADMAP tech debt #5 to shrink' },
  // Astro tool runner top-level chunk.
  { prefix: 'ToolRunner.', budgetKb: 500, why: 'shared runner shell; same as main' },
  // html-minifier-terser is the bulk of the html-minify tool; lazy-loaded.
  { prefix: 'htmlminifier.', budgetKb: 200, why: 'html-minifier-terser; html-minify tool only' },
  // clean-css for css-minify; lazy-loaded.
  { prefix: 'clean-css.', budgetKb: 200, why: 'clean-css; css-minify tool only' },
];

/**
 * @param {string} file
 * @returns {number}
 */
function budgetForFile(file) {
  const name = basename(file);
  for (const { prefix, budgetKb } of VENDOR_BUDGETS_KB) {
    if (name.startsWith(prefix)) return budgetKb;
  }
  return DEFAULT_BUDGET_KB;
}

/**
 * @param {object} options
 * @param {string} options.targetDir
 * @param {string[]} options.extensions
 * @param {number} [options.maxGzipKb] When set, overrides every per-file
 *   budget with a single uniform cap. Used by tests; production callers
 *   omit this and rely on the per-file VENDOR_BUDGETS_KB table.
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, sizeKb: number, budgetKb: number }> }>}
 */
export async function checkBundleSize({ targetDir, extensions, maxGzipKb }) {
  const violations = [];
  const files = await walkDir(targetDir);

  for (const file of files) {
    if (!extensions.some((ext) => file.endsWith(ext))) continue;
    const content = await readFile(file);
    const gzipped = await gzipAsync(content);
    const sizeKb = gzipped.length / 1024;
    const budgetKb = maxGzipKb ?? budgetForFile(file);
    if (sizeKb > budgetKb) {
      violations.push({
        file,
        sizeKb: Number(sizeKb.toFixed(2)),
        budgetKb,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

async function walkDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkDir(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkBundleSize({
    targetDir: 'packages/web/dist',
    extensions: ['.js', '.mjs'],
  });

  if (!result.ok) {
    console.error('Bundle size check FAILED:');
    for (const v of result.violations) {
      console.error(`  ${v.file}: ${v.sizeKb} KB (budget ${v.budgetKb} KB)`);
    }
    process.exit(1);
  }

  console.log(`Bundle size check passed`);
}
