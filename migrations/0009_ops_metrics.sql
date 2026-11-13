-- Only an approved public campaign label is attached to a newly created account.
ALTER TABLE users ADD COLUMN signup_ref TEXT;

-- No visitor identifier, IP address, URL, or account id is stored here.
CREATE TABLE attribution_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('visit', 'heard')),
  label TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, label)
);
