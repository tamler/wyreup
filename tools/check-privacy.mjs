// Privacy scan: grep built output for external domain references.
// Belt-and-suspenders alongside runtime CSP (which is the primary enforcement).
// Catches honest mistakes like "I forgot this was a CDN link" before they ship.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {object} options
 * @param {string} options.distDir
 * @param {string[]} options.allowlist
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, domain: string }> }>}
 */
export async function checkPrivacy({ distDir, allowlist }) {
  const violations = [];
  const files = await walkDir(distDir);

  // Match http://... or https://... URLs (but not relative paths).
  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+)/g;

  for (const file of files) {
    if (!isScannable(file)) continue;
    const content = await readFile(file, 'utf8');

    for (const match of content.matchAll(urlRegex)) {
      const domain = match[1];
      if (isAllowed(domain, allowlist)) continue;
      violations.push({ file, domain });
    }
  }

  // Deduplicate by file+domain pair
  const dedup = new Map();
  for (const v of violations) {
    dedup.set(`${v.file}::${v.domain}`, v);
  }

  return {
    ok: dedup.size === 0,
    violations: Array.from(dedup.values()),
  };
}

function isAllowed(domain, allowlist) {
  return allowlist.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function isScannable(file) {
  return /\.(html|js|mjs|cjs|css|json|webmanifest|txt)$/i.test(file);
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
  const distDirs = ['packages/web/dist', 'packages/core/dist'];
  const allowlist = ['wyreup.com', 'static.cloudflareinsights.com'];

  let totalViolations = 0;
  for (const dir of distDirs) {
    const result = await checkPrivacy({ distDir: dir, allowlist });
    if (!result.ok) {
      console.error(`Privacy scan FAILED in ${dir}:`);
      for (const v of result.violations) {
        console.error(`  ${v.file}: references "${v.domain}"`);
      }
      totalViolations += result.violations.length;
    }
  }

  if (totalViolations > 0) {
    process.exit(1);
  }
  console.log('Privacy scan passed');
}
