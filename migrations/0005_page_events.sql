-- Aggregate, cookieless funnel counters (no per-user data, no identifiers).
-- One row per (day, kind, detail); n is a plain counter.
CREATE TABLE page_events (
  day    TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  kind   TEXT NOT NULL,             -- allowlisted event name
  detail TEXT NOT NULL DEFAULT '',  -- e.g. tool id for seam clicks
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, detail)
);
