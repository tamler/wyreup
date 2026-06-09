// Best-effort ReDoS mitigation for the regex-* tools.
//
// JavaScript regex execution cannot be interrupted on the same thread, so a
// catastrophic-backtracking pattern (e.g. /(a+)+$/) run against a long
// non-matching input hangs the event loop in Node/CLI/MCP and freezes the
// browser tab. True interruption requires running the match in a terminable
// worker (Web Worker / worker_threads). That harness is deferred — see the
// security review. Until then we apply two cheap, synchronous defenses:
//
//   1. A static heuristic that rejects the classic nested-quantifier ReDoS
//      shapes BEFORE the pattern is ever compiled or executed.
//   2. A hard cap on pattern length.
//
// These do not catch every pathological pattern, but they block the common
// (a+)+ / (a*)* / (.*a){n} families that account for nearly all reported
// ReDoS in the wild.

/** Hard upper bound on the length of a user-supplied pattern. */
export const MAX_PATTERN_LENGTH = 1000;

/**
 * Detect nested-quantifier shapes that are classic ReDoS triggers: a
 * quantified group whose body itself contains a quantifier. Catches
 * (a+)+, (a*)*, (a+)*, (a*)+, (?:a+)+ and the bounded (.*a){n} form.
 *
 * Heuristic, not a parser — it deliberately errs toward rejecting a few
 * safe patterns rather than admitting a catastrophic one.
 */
function hasNestedQuantifier(pattern: string): boolean {
  // A group ( ... ) whose contents include a quantifier (+, *, or {..}),
  // immediately followed by an outer quantifier (+, *, or {..}).
  // The inner [^()]* keeps the group body flat so we match the innermost
  // group rather than spanning unbalanced parens.
  const nested = /\([^()]*[+*}][^()]*\)\s*[*+]/;
  const nestedBounded = /\([^()]*[+*][^()]*\)\s*\{\d+,?\d*\}/;
  return nested.test(pattern) || nestedBounded.test(pattern);
}

/**
 * Validate a user-supplied regex pattern before compiling/executing it.
 * Returns an error string when the pattern is rejected, or null when it
 * passes the best-effort checks.
 */
export function checkPatternSafety(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `Pattern too long (${pattern.length} chars; max ${MAX_PATTERN_LENGTH}).`;
  }
  if (hasNestedQuantifier(pattern)) {
    return 'Pattern rejected: nested quantifiers (e.g. (a+)+) can cause catastrophic backtracking (ReDoS).';
  }
  return null;
}
