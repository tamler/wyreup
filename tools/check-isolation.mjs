// Isolation check: @wyreup/core must not import from UI frameworks.
// Walks every .ts/.tsx file in packages/core/src and scans import statements.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {object} options
 * @param {string} options.coreDir
 * @param {string[]} options.forbiddenPackages
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, importPath: string }> }>}
 */
export async function checkIsolation({ coreDir, forbiddenPackages }) {
  const violations = [];
  const files = await walkDir(coreDir);

  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const content = await readFile(file, 'utf8');
    const importMatches = content.matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*\{[^}]*\})?\s*from\s+['"]([^'"]+)['"]/g);

    for (const match of importMatches) {
      const importPath = match[1];
      if (importPath.startsWith('.') || importPath.startsWith('/')) continue; // relative
      const pkg = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0];
      if (forbiddenPackages.includes(pkg)) {
        violations.push({ file, importPath });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

async function walkDir(dir) {
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
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkIsolation({
    coreDir: 'packages/core/src',
    forbiddenPackages: ['astro', 'react', 'react-dom', 'preact', 'svelte', 'vue', '@astrojs/check'],
  });

  if (!result.ok) {
    console.error('Isolation check FAILED:');
    for (const v of result.violations) {
      console.error(`  ${v.file}: imports "${v.importPath}"`);
    }
    process.exit(1);
  }

  console.log(`Isolation check passed (${result.violations.length} violations)`);
}
