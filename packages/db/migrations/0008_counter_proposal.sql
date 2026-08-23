-- 0008_counter_proposal: two-sided collaboration negotiation.
-- Adds a nullable counter_proposal column holding the latest counter-proposal
-- while `proposal` keeps the original, and a proposed_by column tracking who
-- authored the latest proposal (initiator for the original, the countering
-- participant for each counter). Extends the status state machine with
-- `countered`: pending -> accepted | rejected | cancelled | countered,
-- countered -> accepted | rejected | cancelled | countered. Terminal states
-- (accepted, rejected, cancelled) remain terminal.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt: a new
-- table with the widened status CHECK is created, data is copied, the old
-- table is dropped, and the new one is renamed. Indexes and triggers are
-- recreated afterwards.
CREATE TABLE IF NOT EXISTS collaborations_new (
  id           TEXT PRIMARY KEY,
  initiator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  target_id    TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'countered')) DEFAULT 'pending',
  proposal     TEXT NOT NULL,
  counter_proposal TEXT,
  proposed_by  TEXT REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (initiator_id <> target_id),
  CHECK (length(proposal) > 0)
);

INSERT INTO collaborations_new (id, initiator_id, target_id, status, proposal, proposed_by, created_at, updated_at)
SELECT id, initiator_id, target_id, status, proposal, initiator_id, created_at, updated_at FROM collaborations;

DROP TABLE collaborations;

ALTER TABLE collaborations_new RENAME TO collaborations;

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
