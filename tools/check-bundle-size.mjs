// Bundle size check: enforce per-file gzipped size budget.
// Wave 0 scaffold: simple per-file check. Wave 1 will add per-page entry-point analysis.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/**
 * @param {object} options
 * @param {string} options.targetDir
 * @param {number} options.maxGzipKb
 * @param {string[]} options.extensions
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, sizeKb: number }> }>}
 */
export async function checkBundleSize({ targetDir, maxGzipKb, extensions }) {
  const violations = [];
  const files = await walkDir(targetDir);

  for (const file of files) {
    if (!extensions.some((ext) => file.endsWith(ext))) continue;
    const content = await readFile(file);
    const gzipped = await gzipAsync(content);
    const sizeKb = gzipped.length / 1024;
    if (sizeKb > maxGzipKb) {
      violations.push({ file, sizeKb: Number(sizeKb.toFixed(2)) });
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
    maxGzipKb: 150,
    extensions: ['.js', '.mjs'],
  });

  if (!result.ok) {
    console.error('Bundle size check FAILED:');
    for (const v of result.violations) {
      console.error(`  ${v.file}: ${v.sizeKb} KB (budget 150 KB)`);
    }
    process.exit(1);
  }

  console.log(`Bundle size check passed (${result.violations.length} violations)`);
}
