-- Opt-in public links for the text result of a hosted PRO run.
-- Created only by the signed-in owner, readable by anyone with the id until
-- expires_at, deletable by the owner, removed with the account.
CREATE TABLE shared_results (
  id         TEXT PRIMARY KEY CHECK (length(id) = 22),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id    TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX idx_shared_results_user ON shared_results(user_id, expires_at);
