-- Cost-control "oh shit" switches.
--
-- Three new defenses on top of the existing 30/min per-account rate
-- limit and the per-call `withTimeout()` budgets:
--
--   1. Account-wide daily spend cap — refuse Pro runs once the day's
--      credits-spent across ALL users exceeds the configured cap.
--      Resets at UTC midnight. Master existential defense.
--
--   2. Per-key daily cap — refuse Pro runs from a single user once
--      their day's spend exceeds the per-key cap. Catches compromised
--      keys / runaway scripts on an account.
--
--   3. Manual emergency kill switch — admin toggle that disables all
--      Pro runs immediately, no redeploy.
--
-- All three values live in `system_settings`. Rows are lazy: missing
-- key → use the default baked into functions/_lib/limits.ts. Only an
-- admin POST creates / updates rows.
--
-- Apply with:
--   wrangler d1 migrations apply wyreup-prod          (prod)
--   wrangler d1 migrations apply wyreup-prod --local  (local dev DB)

CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT             -- users.id of admin who last changed it
);
