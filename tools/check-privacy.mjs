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
  // We scan HTML, CSS, JSON, and text — the surfaces WE author.
  // We deliberately skip bundled JS (in _astro/, dist/browser/, dist/node/),
  // because regex-matching URL-shaped strings in minified third-party library
  // code produces overwhelming false positives (namespace URIs like w3.org,
  // author attributions like feross.org, "localhost" dev placeholders, spec
  // links in license headers, etc.). Real runtime exfiltration is caught by
  // the browser CSP, which is the primary enforcement layer — this scan is
  // belt-and-suspenders for "I forgot this was a CDN link" in static assets.
  return /\.(html|css|json|webmanifest|txt)$/i.test(file);
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
  const allowlist = [
    // First-party.
    'wyreup.com',
    'static.cloudflareinsights.com',

    // SEO / metadata references (not runtime fetches):
    'schema.org', // JSON-LD @context URI in per-tool page structured data
    'github.com', // source-code link in footer + privacy block (user-initiated navigation)
    'modelcontextprotocol.io', // doc link on /mcp page to the MCP spec (user-initiated navigation)

    // Third-party model CDNs for AI tools. The models fetch on first use, which
    // creates a third-party origin touch. TODO: self-host these on wyreup.com
    // (e.g. r2://wyreup-models) to eliminate the third-party leak — tracked as
    // a post-launch privacy upgrade. Until then, these are allow-listed.
    'jsdelivr.net',       // @mediapipe/tasks-vision WASM (face-blur)
    'googleapis.com',     // MediaPipe model storage (face-blur)
    'huggingface.co',     // FlashSR ONNX (audio-enhance), future: BiRefNet, TrOCR, etc.
  ];

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
