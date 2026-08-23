-- 0010_growth_outcomes: Track-1 audience-growth evidence layer.
-- After a collaboration reaches a terminal state, each participant can
-- report an audience metric (e.g. followers/reach/views) before and after.
-- These rows power the growth story: measurable deltas, stored per
-- collaboration, feeding the Mind's memory so future matching can prefer
-- collaborators whose partnerships historically grew the audience.
CREATE TABLE IF NOT EXISTS growth_outcomes (
  id               TEXT PRIMARY KEY,
  collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
  creator_id       TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  metric           TEXT NOT NULL CHECK (length(metric) > 0 AND length(metric) <= 64),
  value_before     INTEGER NOT NULL CHECK (value_before >= 0),
  value_after      INTEGER NOT NULL CHECK (value_after >= 0),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS growth_outcomes_collaboration_id
  ON growth_outcomes (collaboration_id);

-- Per-creator growth history lookup (summary endpoint).
CREATE INDEX IF NOT EXISTS growth_outcomes_creator_id
  ON growth_outcomes (creator_id);

-- Keep updated_at in sync on every row update.
CREATE TRIGGER IF NOT EXISTS growth_outcomes_touch_updated_at
  BEFORE UPDATE ON growth_outcomes
  FOR EACH ROW
BEGIN
  UPDATE growth_outcomes
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.id;
END;
