// Trigger rules — declarative MIME-pattern → saved-chain bindings.
// See docs/triggers-security.md for the load-bearing security model.

/**
 * A single trigger rule. The matcher resolves an inbound file's MIME to
 * the most-specific matching rule (audio/wav beats audio/*; ties broken
 * by user-defined `order`).
 */
export interface TriggerRule {
  /** Stable opaque id (UUID-shape recommended). */
  id: string;
  /** Human-readable name shown in /my-kit and on the preview sheet. */
  name: string;
  /**
   * MIME match. Supports trailing wildcard ('audio/*', 'image/*') and
   * full match ('application/pdf', 'text/csv'). The matcher rejects
   * unconstrained '*' / '*\/*' patterns — every rule must commit to at
   * least a top-level type.
   */
  mime: string;
  /**
   * Saved-chain id this rule fires. The rule does not embed the chain
   * itself — the chain is dereferenced at match time so rule + chain
   * stay editable independently.
   */
  chainId: string;
  /**
   * User-defined ordering tiebreaker when two rules have identically
   * specific MIME patterns. Lower number = higher priority.
   */
  order: number;
  /**
   * Per-rule preview opt-out. When true, matches skip the preview sheet.
   *
   * G2 invariant (docs/triggers-security.md): this is the ONLY way to
   * suppress previews; there is no global setting. Editing any of the
   * rule's other fields forces this back to false.
   */
  confirmed: boolean;
  /**
   * Disables the rule without deleting it. Disabled rules don't match.
   */
  enabled: boolean;
  /**
   * Hidden flood-prevention rate limit (G7). A rule cannot fire more
   * than `rateLimit.count` times in `rateLimit.windowMs` milliseconds.
   * Defaults applied by the matcher when undefined.
   */
  rateLimit?: {
    count: number;
    windowMs: number;
  };
  /** When the rule was created (epoch ms). */
  createdAt: number;
  /** When the rule was last edited (epoch ms). Resets `confirmed` to false. */
  updatedAt: number;
  /** When `confirmed` was last set to true (epoch ms). */
  confirmedAt?: number;
}

/**
 * Outer kit shape persisted to localStorage / kit.json. Versioned so
 * the loader can migrate old shapes forward.
 */
export interface TriggerKit {
  version: 1;
  rules: TriggerRule[];
}

export const TRIGGER_KIT_VERSION = 1 as const;

/**
 * Default rate limit applied when a rule omits one. The cap is
 * non-disablable per G7 — a rule can raise N or T but the matcher
 * enforces a hard ceiling (200 / 60_000) to defeat flood attacks even
 * for permissive rules.
 */
export const DEFAULT_RATE_LIMIT = { count: 10, windowMs: 60_000 } as const;
export const MAX_RATE_LIMIT = { count: 200, windowMs: 60_000 } as const;
