// Trigger rules — public entry point.
//
// IMPORTANT: every consumer of this module must implement preview-before-run
// per docs/triggers-security.md. The matcher is intentionally low-level —
// it does NOT execute chains. It only resolves a file's MIME to the rule
// that *would* fire if the user confirms.

export type { TriggerRule, TriggerKit } from './types.js';
export {
  TRIGGER_KIT_VERSION,
  DEFAULT_RATE_LIMIT,
  MAX_RATE_LIMIT,
} from './types.js';

export {
  parseTriggerKit,
  serializeTriggerKit,
  updateTriggerRule,
  strippedForImport,
} from './storage.js';

export type { FireRecord, MatchOutcome } from './match.js';
export { matchRule, clampRateLimit, pruneFires } from './match.js';

export type {
  PreflightVerdict,
  PreflightFinding,
  PreflightResult,
  FileHeader,
} from './preflight.js';
export { runPreflight, readFileHeader } from './preflight.js';
