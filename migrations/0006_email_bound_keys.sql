-- Existing keys were potentially disclosed before mailbox ownership was
-- established, including keys created using those credentials. Preserve
-- account data; require an email-delivered recovery key for authentication.
ALTER TABLE api_keys ADD COLUMN email_bound INTEGER NOT NULL DEFAULT 0
  CHECK (email_bound IN (0, 1));
