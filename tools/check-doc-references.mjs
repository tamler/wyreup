// Doc reference check: scans READMEs, docs, and changelogs for tool IDs
// and skill-package names that don't exist in the current registry.
// Catches drift like "wyreup foo-tool" examples after a tool is renamed,
// or stale @wyreup/skill references after the npm packages were retired.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = join(root, 'packages/core/src/tools');

const validToolIds = new Set(
  readdirSync(toolsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name),
);

// Packages retired 2026-05-01. Anyone still pointing at these is leading
// users to npm tarballs that exist but should not be installed.
const RETIRED_PACKAGES = new Set([
  '@wyreup/skill',
  '@wyreup/cli-skill',
  '@wyreup/mcp-skill',
]);

// Words that look like tool IDs but aren't — build/utility scripts,
// directory names in code-block file trees, etc. Add here only when
// you've verified the false-positive rate.
const ALLOWED_NON_TOOL_REFS = new Set([
  'gen-pwa-icons', // build script under tools/, invoked as `node tools/gen-pwa-icons.mjs`
]);

// Lines may legitimately mention a retired package when the context is
// itself the deprecation. Skip retired-package warnings on lines that
// include any of these markers — but still warn elsewhere.
const DEPRECATION_CONTEXT = /\b(deprecat|retired|removed|superseded|replac|former|unpublish)/i;

const SCAN_DIRS = ['', 'docs', 'packages/cli', 'packages/core', 'packages/mcp', 'packages/web'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.astro',
  '.git',
  'coverage',
  'test',
  // Planning artifacts and historical audits are immutable archives, not
  // user-facing docs. Drift here is just history.
  'superpowers',
]);

const SKIP_FILE_PATTERN = /audit-\d{4}-\d{2}-\d{2}\.md$|CHANGELOG\.md$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && /\.md$/.test(entry.name) && !SKIP_FILE_PATTERN.test(entry.name)) {
      yield full;
    }
  }
}

const violations = [];

function record(file, line, kind, value, context) {
  violations.push({
    file: relative(root, file),
    line,
    kind,
    value,
    context: context.length > 80 ? context.slice(0, 77) + '...' : context,
  });
}

const seenFiles = new Set();
for (const baseDir of SCAN_DIRS) {
  const dir = baseDir ? join(root, baseDir) : root;
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const file of walk(dir)) {
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Retired skill packages — only warn outside deprecation context.
      // Check the surrounding lines too: prose naturally wraps and the
      // keyword may sit one line away from the mention.
      for (const pkg of RETIRED_PACKAGES) {
        if (!line.includes(pkg)) continue;
        const window = [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].join('\n');
        if (DEPRECATION_CONTEXT.test(window)) continue;
        record(file, i + 1, 'retired-package', pkg, line.trim());
      }

      // `wyreup <tool-id>` shell examples in code fences
      const cliRe = /\bwyreup\s+([a-z][a-z0-9-]*)/g;
      let m;
      while ((m = cliRe.exec(line)) !== null) {
        const id = m[1];
        // Subcommands of the CLI itself, not tool ids
        if (
          [
            'run',
            'chain',
            'watch',
            'prefetch',
            'cache',
            'init-tool',
            'install-skill',
            'list',
            'help',
            'version',
          ].includes(id)
        ) {
          continue;
        }
        if (validToolIds.has(id)) continue;
        if (ALLOWED_NON_TOOL_REFS.has(id)) continue;
        record(file, i + 1, 'unknown-tool-id', id, line.trim());
      }

      // /tools/<tool-id> page links
      const pageRe = /\/tools\/([a-z][a-z0-9-]*)(?![a-z0-9-])/g;
      while ((m = pageRe.exec(line)) !== null) {
        const id = m[1];
        if (validToolIds.has(id)) continue;
        if (ALLOWED_NON_TOOL_REFS.has(id)) continue;
        record(file, i + 1, 'unknown-tools-link', id, line.trim());
      }

      // chain URLs ?steps=a|b|c (literal or %7C)
      const chainRe = /[?&]steps=([a-z0-9|%-]+)/gi;
      while ((m = chainRe.exec(line)) !== null) {
        const decoded = m[1].replace(/%7C/gi, '|');
        for (const step of decoded.split('|')) {
          // step may have key=val params after a colon — strip those
          const id = step.split(':')[0];
          if (!id) continue;
          if (validToolIds.has(id)) continue;
          if (ALLOWED_NON_TOOL_REFS.has(id)) continue;
          record(file, i + 1, 'unknown-chain-step', id, line.trim());
        }
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`doc references: ok (${seenFiles.size} markdown files scanned)`);
  process.exit(0);
}

const byKind = new Map();
for (const v of violations) {
  if (!byKind.has(v.kind)) byKind.set(v.kind, []);
  byKind.get(v.kind).push(v);
}

console.error(`doc references: ${violations.length} issue(s) across ${seenFiles.size} files\n`);
for (const [kind, items] of byKind) {
  console.error(`${kind}: ${items.length}`);
  for (const v of items) {
    console.error(`  ${v.file}:${v.line}  ${v.value}`);
    console.error(`    ${v.context}`);
  }
  console.error('');
}
process.exit(1);
