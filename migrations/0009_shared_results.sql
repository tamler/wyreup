-- Opt-in public links for the text result of a hosted PRO run.
-- Created only by the signed-in owner, readable by anyone with the id until
-- expires_at, deletable by the owner, removed with the account. Expired rows
-- are deleted in bounded batches by the share endpoints (functions/_lib/shares.ts).
CREATE TABLE shared_results (
  id         TEXT PRIMARY KEY CHECK (length(id) = 22),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id    TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX idx_shared_results_user ON shared_results(user_id, expires_at);
CREATE INDEX idx_shared_results_expiry ON shared_results(expires_at);

-- One row per link ever created, kept after the link is deleted. The primary
-- key makes each paid run_history row back at most one link, and the rows
-- feed the per-day creation cap. Dropped after 48 hours, when neither can
-- apply any more.
CREATE TABLE share_creations (
  run_id     TEXT PRIMARY KEY,
  share_id   TEXT NOT NULL UNIQUE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_share_creations_user ON share_creations(user_id, created_at);
CREATE INDEX idx_share_creations_age ON share_creations(created_at);
