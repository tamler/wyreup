// Runner coverage check: every tool in packages/core/src/tools must have a
// matching entry in packages/web/src/components/runners/variantMap.ts.
//
// Without this, missing entries fall through to `SimpleImageRunner` silently
// — wrong behavior for video, ZIP, PGP, spreadsheet, and JSON-result tools.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = join(root, 'packages/core/src/tools');
const variantMapFile = join(root, 'packages/web/src/components/runners/variantMap.ts');

const tools = readdirSync(toolsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const src = readFileSync(variantMapFile, 'utf8');
const re = /^\s+(['"]?)([a-z][a-z0-9-]*)\1:\s*['"]/gm;
const mapped = new Set();
for (const m of src.matchAll(re)) mapped.add(m[2]);

const missing = tools.filter((t) => !mapped.has(t));
const extra = [...mapped].filter((k) => !tools.includes(k));

if (missing.length === 0 && extra.length === 0) {
  console.log(`runner coverage: ok (${tools.length} tools mapped)`);
  process.exit(0);
}

if (missing.length) {
  console.error(`runner coverage: ${missing.length} tool(s) missing from VARIANT_MAP:`);
  for (const m of missing) console.error(`  - ${m}`);
}
if (extra.length) {
  console.error(`runner coverage: ${extra.length} stale entry(ies) in VARIANT_MAP:`);
  for (const e of extra) console.error(`  - ${e}`);
}
process.exit(1);
