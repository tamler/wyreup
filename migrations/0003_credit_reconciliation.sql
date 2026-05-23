-- Orphan-spend reconciliation.
--
-- The reserve-then-refund pattern in functions/api/tools/pro/run.ts is
-- robust to model errors (the catch block inserts a refund row) but NOT
-- to mid-handler crashes — CF runtime timeout / OOM / D1 transient
-- between the spend INSERT and the refund INSERT leaves an orphan
-- `spend` row with the user's credits gone and no compensating row.
--
-- This migration adds the foreign-key columns we need to detect orphans
-- (a spend row with no run_history row and no refund row referencing it)
-- so functions/api/tools/pro/run.ts can sweep + auto-refund on the next
-- request from the same user. Idempotent via the partial UNIQUE index:
-- if a sweep races a normal refund, the second INSERT is a no-op.
--
-- Apply with:
--   wrangler d1 migrations apply wyreup-prod          (prod)
--   wrangler d1 migrations apply wyreup-prod --local  (local dev DB)

ALTER TABLE credit_events ADD COLUMN refund_of TEXT;
ALTER TABLE run_history   ADD COLUMN spend_event_id TEXT;

-- One refund per spend, max. Makes the orphan-sweep INSERT OR IGNORE-able
-- against a racing normal refund. NULL values are excluded from the
-- uniqueness check (SQLite partial-index semantics) so legacy rows and
-- LS-side refunds (which leave refund_of NULL) are unaffected.
CREATE UNIQUE INDEX idx_credit_refund_of_unique
  ON credit_events(refund_of)
  WHERE refund_of IS NOT NULL;

CREATE INDEX idx_history_spend
  ON run_history(spend_event_id)
  WHERE spend_event_id IS NOT NULL;
