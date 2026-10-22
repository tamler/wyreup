-- Atomic Pro admission reads these indexes while holding SQLite's write lock.
CREATE INDEX idx_credit_kind_created ON credit_events(kind, created_at);
CREATE INDEX idx_credit_user_kind_created ON credit_events(user_id, kind, created_at);

-- Preserve operator settings, including invalid rows that readers fail closed.
INSERT OR IGNORE INTO system_settings(key,value,updated_at,updated_by)
VALUES ('daily_spend_cap_credits','5000',0,NULL), ('system_disabled','0',0,NULL);
