-- 0012_open_collabs: creators publish collaboration availability + terms.
-- A creator declares: my follower count, the minimum partner size I accept,
-- languages I work in, and topics. Two creators are threshold-compatible when
-- EACH side's follower count satisfies the OTHER side's minimum, and they
-- share at least one language (either may use '*' for any).
CREATE TABLE IF NOT EXISTS open_collabs (
  creator_id            TEXT PRIMARY KEY REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  open_to_collab        INTEGER NOT NULL DEFAULT 1 CHECK (open_to_collab IN (0, 1)),
  my_followers          INTEGER NOT NULL DEFAULT 0 CHECK (my_followers >= 0),
  min_partner_followers INTEGER NOT NULL DEFAULT 0 CHECK (min_partner_followers >= 0),
  languages             TEXT NOT NULL DEFAULT 'en',
  topics                TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS open_collabs_open ON open_collabs (open_to_collab);

CREATE TRIGGER IF NOT EXISTS open_collabs_touch_updated_at
  BEFORE UPDATE ON open_collabs
  FOR EACH ROW
BEGIN
  UPDATE open_collabs
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE creator_id = OLD.creator_id;
END;

-- 0012b: contract decisions on a negotiated collaboration. Both sides must
-- sign for the collaboration to become accepted; a rejection cancels it.
CREATE TABLE IF NOT EXISTS collab_contracts (
  id               TEXT PRIMARY KEY,
  collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
  creator_id       TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  decision         TEXT NOT NULL CHECK (decision IN ('signed', 'rejected')),
  reason           TEXT NOT NULL DEFAULT '',
  score            INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS collab_contracts_collab ON collab_contracts (collaboration_id);
