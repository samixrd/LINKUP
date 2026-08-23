-- 0001_baseline: infrastructure only.
-- Domain tables (creators, memory, collaborations, ...) intentionally
-- arrive with their respective features. This baseline exists to prove
-- the migration pipeline works end to end.
CREATE TABLE IF NOT EXISTS system_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
