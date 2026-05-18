-- Wyreup PRO — initial schema.
-- Apply with:
--   wrangler d1 migrations apply wyreup-prod          (prod)
--   wrangler d1 migrations apply wyreup-prod --local  (local dev DB)
--
-- See docs/pro-auth-spec.md §4 for design notes.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

CREATE TABLE api_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  last_used   INTEGER,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE TABLE credit_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  tool_id     TEXT,
  ls_order_id TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE saved_chains (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  steps       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE run_history (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id      TEXT NOT NULL,
  tier         TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  file_name    TEXT,
  ran_at       INTEGER NOT NULL
);

-- Rate-limit ledger for /api/account/create (per-email + per-IP).
-- Tiny, append-only, periodically pruned by a cron task.
CREATE TABLE create_attempts (
  id          TEXT PRIMARY KEY,
  bucket_kind TEXT NOT NULL,   -- 'email' | 'ip'
  bucket_val  TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX        idx_api_keys_hash    ON api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX        idx_credit_user      ON credit_events(user_id, created_at DESC);
CREATE INDEX        idx_history_user     ON run_history(user_id, ran_at DESC);
CREATE INDEX        idx_chains_user      ON saved_chains(user_id);
CREATE UNIQUE INDEX idx_credit_ls_order  ON credit_events(ls_order_id) WHERE ls_order_id IS NOT NULL;
CREATE INDEX        idx_attempts_bucket  ON create_attempts(bucket_kind, bucket_val, attempted_at DESC);
