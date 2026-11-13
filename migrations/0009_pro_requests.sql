-- Managed paid attempts keep their key as a permanent tombstone until account deletion.
CREATE TABLE pro_requests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  digest_version INTEGER NOT NULL DEFAULT 1,
  owner_id TEXT NOT NULL,
  spend_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'dispatching', 'completed', 'failed_refunded', 'unknown_refunded')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_key)
);
CREATE TRIGGER pro_requests_protect_refund BEFORE INSERT ON credit_events
WHEN NEW.kind = 'refund' AND EXISTS (
  SELECT 1 FROM pro_requests WHERE spend_id = NEW.refund_of
    AND state NOT IN ('failed_refunded', 'unknown_refunded')
)
BEGIN SELECT RAISE(IGNORE); END;
