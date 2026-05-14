// Trigger rules — matcher.
// Pure-function: given a file's MIME + the rule set + recent fire history,
// return the rule that should fire (if any) and the reason another rule
// might have been suppressed.

import type { TriggerRule } from './types.js';
import { DEFAULT_RATE_LIMIT, MAX_RATE_LIMIT } from './types.js';

/**
 * Past fires for rate-limit enforcement. One entry per fired match,
 * with the rule id + epoch-ms timestamp. The caller persists this list
 * (typically a bounded in-memory deque trimmed to the longest rule
 * window).
 */
export interface FireRecord {
  ruleId: string;
  firedAt: number;
}

export type MatchOutcome =
  | { kind: 'match'; rule: TriggerRule }
  | { kind: 'rate-limited'; rule: TriggerRule; recentFires: number; windowMs: number }
  | { kind: 'no-match' };

/**
 * Score a rule's MIME pattern by specificity. Higher score wins.
 *
 *   exact match (application/pdf)  → 100
 *   top/wildcard (image/*)         →  10
 *   anything else                  →   0 (rejected at parse time)
 */
function specificity(pattern: string): number {
  if (pattern.endsWith('/*')) return 10;
  return 100;
}

function mimeMatches(filemime: string, pattern: string): boolean {
  if (pattern === filemime) return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return filemime.startsWith(prefix + '/');
  }
  return false;
}

/**
 * Resolve which rule should fire for a given file. Selection order:
 *   1. Drop disabled rules.
 *   2. Filter rules whose MIME pattern matches.
 *   3. Take the most-specific match (exact > wildcard).
 *   4. Tie-break by user-defined `order` (lower number wins).
 *   5. Final stable tiebreaker: rule id ascending (deterministic for tests).
 *   6. Apply rate-limit gate (G7). A rate-limited match still surfaces
 *      so the caller can show the user *why* it didn't fire.
 */
export function matchRule(
  fileMime: string,
  rules: TriggerRule[],
  fires: FireRecord[],
  now = Date.now(),
): MatchOutcome {
  const eligible = rules
    .filter((r) => r.enabled && mimeMatches(fileMime, r.mime))
    .map((r) => ({ rule: r, score: specificity(r.mime) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.rule.order !== b.rule.order) return a.rule.order - b.rule.order;
      return a.rule.id < b.rule.id ? -1 : 1;
    });

  if (eligible.length === 0) return { kind: 'no-match' };
  const winner = eligible[0]!.rule;

  // Rate limit gate.
  const limit = clampRateLimit(winner.rateLimit ?? DEFAULT_RATE_LIMIT);
  const windowStart = now - limit.windowMs;
  const recentFires = fires.filter(
    (f) => f.ruleId === winner.id && f.firedAt >= windowStart,
  ).length;

  if (recentFires >= limit.count) {
    return { kind: 'rate-limited', rule: winner, recentFires, windowMs: limit.windowMs };
  }

  return { kind: 'match', rule: winner };
}

/**
 * Clamp a user-configured rate limit against the hard ceiling. Per G7
 * (docs/triggers-security.md), the limit cannot be disabled — only
 * tuned within the [MIN, MAX] band.
 */
export function clampRateLimit(rl: { count: number; windowMs: number }): {
  count: number;
  windowMs: number;
} {
  return {
    count: Math.max(1, Math.min(rl.count, MAX_RATE_LIMIT.count)),
    windowMs: Math.max(1_000, Math.min(rl.windowMs, MAX_RATE_LIMIT.windowMs)),
  };
}

/**
 * Trim fire records older than the longest active rate-limit window.
 * Call after recording a fire so the history list stays bounded.
 */
export function pruneFires(
  fires: FireRecord[],
  rules: TriggerRule[],
  now = Date.now(),
): FireRecord[] {
  const longestWindow = rules.reduce<number>(
    (max, r) => Math.max(max, clampRateLimit(r.rateLimit ?? DEFAULT_RATE_LIMIT).windowMs),
    DEFAULT_RATE_LIMIT.windowMs,
  );
  const cutoff = now - longestWindow;
  return fires.filter((f) => f.firedAt >= cutoff);
}
