-- Subscription support.
--
-- One subscription per user. We trust LS as source of truth for billing
-- state; the columns below are a local cache so we don't hit their API
-- on every PRO run. Webhook keeps them in sync.
--
-- Credits granted by the subscription land in credit_events as
-- kind='subscription_grant' — same ledger, no separate balance to track.
-- Existing credits don't expire on cancellation; users keep what they have.

ALTER TABLE users ADD COLUMN ls_subscription_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT;
-- subscription_status values: 'active' | 'cancelled' | 'expired' | 'paused'
-- NULL = never had a subscription.

CREATE INDEX idx_users_ls_subscription
  ON users(ls_subscription_id)
  WHERE ls_subscription_id IS NOT NULL;
