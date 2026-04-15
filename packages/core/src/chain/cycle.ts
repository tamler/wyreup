import type { SavedChain } from './types.js';

/**
 * Detect a cycle in a chain-of-chains graph.
 *
 * User chains can reference other user chains as steps (via toolId like
 * "user:<chainId>"). If A references B and B references A (or through a
 * longer path), execution would loop forever. This function runs a DFS
 * from the given chain and returns the cycle path if one is found, or
 * null if no cycle exists.
 *
 * Called at save time so users get immediate feedback instead of a
 * runtime error later.
 *
 * @param chain      The chain to check.
 * @param allChains  All known user chains keyed by id (for reference resolution).
 * @returns          The cycle path as an array of chain ids (first id
 *                   appears at both ends), or null if no cycle.
 */
export function detectCycle(
  chain: SavedChain,
  allChains: Map<string, SavedChain>,
): string[] | null {
  return dfs(chain.id, allChains, []);
}

function dfs(
  currentId: string,
  allChains: Map<string, SavedChain>,
  path: string[],
): string[] | null {
  // Cycle detection: if we've seen this id in the current path, we have a cycle.
  if (path.includes(currentId)) {
    return [...path, currentId];
  }

  const current = allChains.get(currentId);
  if (!current) {
    return null; // reference to a missing chain; not a cycle per se
  }

  const newPath = [...path, currentId];

  for (const step of current.steps) {
    if (step.toolId.startsWith('user:')) {
      const referencedId = step.toolId.slice('user:'.length);
      const cycle = dfs(referencedId, allChains, newPath);
      if (cycle !== null) {
        return cycle;
      }
    }
  }

  return null;
}
