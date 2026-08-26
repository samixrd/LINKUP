-- 0016_linkup_spec_upgrade.sql: extended Go Open criteria, escrow tracking, submissions, and disputes.
ALTER TABLE open_collabs ADD COLUMN platform TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE open_collabs ADD COLUMN niche TEXT NOT NULL DEFAULT '';
ALTER TABLE open_collabs ADD COLUMN min_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE open_collabs ADD COLUMN collab_types TEXT NOT NULL DEFAULT 'Paid,Barter';
ALTER TABLE open_collabs ADD COLUMN start_date TEXT NOT NULL DEFAULT '';
ALTER TABLE open_collabs ADD COLUMN end_date TEXT NOT NULL DEFAULT '';
ALTER TABLE open_collabs ADD COLUMN guardrails TEXT NOT NULL DEFAULT '';

-- Escrow and deliverable submissions
CREATE TABLE IF NOT EXISTS collab_escrows (
  collaboration_id TEXT PRIMARY KEY REFERENCES collaborations(id) ON DELETE CASCADE,
  amount           REAL NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  status           TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'submitted', 'released', 'disputed')),
  dispute_reason   TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS collab_submissions (
  id               TEXT PRIMARY KEY,
  collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
  creator_id       TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  deliverable_url  TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  submitted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS collab_submissions_collab ON collab_submissions (collaboration_id);
