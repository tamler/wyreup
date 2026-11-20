-- Retired Pro admission even for installations that still carry the old
-- operator-controlled setting. API retirement is enforced in code as well.
INSERT INTO system_settings (key, value, updated_at, updated_by)
VALUES ('system_disabled', '1', 0, NULL)
ON CONFLICT(key) DO UPDATE SET value = '1';
