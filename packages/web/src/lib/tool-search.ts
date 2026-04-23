import Fuse from 'fuse.js';

export interface SearchableTool {
  id: string;
  name: string;
  description: string;
  category: string;
  keywords: string[];
}

export interface SearchResult {
  tool: SearchableTool;
  score: number; // 0 = perfect match, 1 = no match
}

/**
 * Create a Fuse search index with weighted fields.
 * Usage: const fuse = createToolSearch(allTools); fuse.search('compres').slice(0, 10)
 */
export function createToolSearch(tools: SearchableTool[]): Fuse<SearchableTool> {
  return new Fuse(tools, {
    // Fields, ordered and weighted. `id` is the slug (most specific); `name`
    // is what users read; `keywords` is curated aliases per tool; then
    // `category` and finally `description` as a long-form fallback.
    keys: [
      { name: 'id', weight: 5 },
      { name: 'name', weight: 4 },
      { name: 'keywords', weight: 3 },
      { name: 'category', weight: 2 },
      { name: 'description', weight: 1 },
    ],
    threshold: 0.35,         // lenient — tolerates typos
    ignoreLocation: true,    // match anywhere in a field
    minMatchCharLength: 2,   // ignore single-char noise
    includeScore: true,
    shouldSort: true,        // rank by relevance (lower score = better)
  });
}

/**
 * Convenience: search and return the top N results, sorted by relevance.
 */
export function searchTools(
  fuse: Fuse<SearchableTool>,
  query: string,
  limit = 10,
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  return fuse.search(q).slice(0, limit).map((r) => ({
    tool: r.item,
    score: r.score ?? 1,
  }));
}
