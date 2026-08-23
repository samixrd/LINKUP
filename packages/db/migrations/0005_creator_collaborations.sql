-- 0005_creator_collaborations: creator collaboration / negotiation foundation.
-- Each collaboration links an initiator and a target creator, tracks negotiation
-- via an explicit status, and holds the proposal. Deleting a creator removes
-- its collaborations (ON DELETE CASCADE). Status is an explicit state machine:
-- pending -> accepted | rejected | cancelled (terminal).
CREATE TABLE IF NOT EXISTS collaborations (
  id           TEXT PRIMARY KEY,
  initiator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  target_id    TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')) DEFAULT 'pending',
  proposal     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (initiator_id <> target_id),
  CHECK (length(proposal) > 0)
);

-- Creator lookup: list all collaborations where a creator is initiator or target.
CREATE INDEX IF NOT EXISTS collaborations_initiator_id ON collaborations (initiator_id);
CREATE INDEX IF NOT EXISTS collaborations_target_id ON collaborations (target_id);

-- Status filtering: e.g. list pending collaborations for a creator.
CREATE INDEX IF NOT EXISTS collaborations_status ON collaborations (status);

-- Recent ordering: supports ORDER BY created_at for list endpoints.
CREATE INDEX IF NOT EXISTS collaborations_created_at ON collaborations (created_at);

-- Combined filter: creator + status + recency (covers listCollaborationsForCreator with status).
CREATE INDEX IF NOT EXISTS collaborations_initiator_status_created
  ON collaborations (initiator_id, status, created_at);
CREATE INDEX IF NOT EXISTS collaborations_target_status_created
  ON collaborations (target_id, status, created_at);

-- Keep updated_at in sync on every row update.
CREATE TRIGGER IF NOT EXISTS collaborations_touch_updated_at
  BEFORE UPDATE ON collaborations
  FOR EACH ROW
BEGIN
  UPDATE collaborations
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.id;
END;

-- Enforce proposal non-empty at the database level as well.
CREATE TRIGGER IF NOT EXISTS collaborations_proposal_not_empty
  BEFORE INSERT ON collaborations
  FOR EACH ROW
  WHEN NEW.proposal = ''
BEGIN
  SELECT RAISE(ABORT, 'proposal must not be empty');
END;
