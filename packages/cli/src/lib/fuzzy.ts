/**
 * Tiny Levenshtein distance + "did you mean?" helper for CLI error UX.
 * Used by `run` and `chain` to suggest the likely-intended tool ID
 * when the user mistypes one (the registry has ~129 tools; printing
 * them all is unreadable, printing nothing is unhelpful).
 *
 * No external deps. The implementation is the standard two-row DP —
 * fast enough for hundreds of candidates against a typo of any
 * reasonable length.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row DP. We only need the previous row to compute the current.
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1, // insertion
        prev[j]! + 1, // deletion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Rank `candidates` by how close each one is to `query`, then return
 * the top `limit` that fall within `maxDistance`. Sort is stable so
 * ties preserve the candidate order — useful when the registry's
 * presentation order is meaningful.
 */
export function suggestSimilar(
  query: string,
  candidates: string[],
  { limit = 5, maxDistance = 4 }: { limit?: number; maxDistance?: number } = {},
): string[] {
  const q = query.toLowerCase();
  const scored = candidates
    .map((c) => ({ id: c, d: levenshtein(q, c.toLowerCase()) }))
    .filter((s) => s.d <= maxDistance)
    .sort((a, b) => a.d - b.d);
  return scored.slice(0, limit).map((s) => s.id);
}

/**
 * Format a "did you mean?" error string for an unknown tool ID. Returns
 * a multi-line message ending with a newline; empty string if the
 * candidate list is empty (caller decides what to fall back to).
 */
export function formatSuggestion(query: string, candidates: string[]): string {
  const suggestions = suggestSimilar(query, candidates);
  if (suggestions.length === 0) {
    return `Unknown tool: "${query}".\n` +
      `Run "wyreup list" to see all available tools.\n`;
  }
  return (
    `Unknown tool: "${query}".\n` +
    `Did you mean:\n` +
    suggestions.map((s) => `  ${s}`).join('\n') +
    `\nRun "wyreup list" to see all available tools.\n`
  );
}
