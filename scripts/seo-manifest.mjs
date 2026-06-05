// One-off: emit the manifest of tools that need seoContent (no inline
// seoContent yet) plus a compact catalog for alsoTry cross-links.
import { createDefaultRegistry } from '../packages/core/dist/node/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const registry = createDefaultRegistry();
const all = Array.from(registry.toolsById.values());

const catalog = all.map((t) => ({ id: t.id, name: t.name, category: t.category }));

const thin = all
  .filter((t) => !t.seoContent)
  .map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    categories: t.categories ?? [],
    keywords: t.keywords ?? [],
    accept: t.input?.accept ?? [],
    outputMime: t.output?.mime ?? '',
    cost: t.cost,
  }));

mkdirSync('/tmp/wyreup-seo', { recursive: true });
writeFileSync('/tmp/wyreup-seo/manifest.json', JSON.stringify({ thin, catalog }, null, 2));
console.log(`thin tools needing seoContent: ${thin.length} / total ${all.length}`);
console.log(`catalog size: ${catalog.length}`);
