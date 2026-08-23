-- 0009_collaboration_proposals: append-only negotiation history.
-- Each collaboration proposal is a versioned entry in the negotiation chain.
-- The original proposal is seq=1 by the initiator; each counter appends the
-- next seq by either participant. The table is append-only; updates are not
-- allowed in the repository layer. Deleting a collaboration removes its
-- history (ON DELETE CASCADE). UNIQUE ensures deterministic ordering.

CREATE TABLE IF NOT EXISTS collaboration_proposals (
  id               TEXT PRIMARY KEY,
  collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  author_id        TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  proposal         TEXT NOT NULL CHECK (length(trim(proposal)) > 0),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(collaboration_id, seq)
);

CREATE INDEX IF NOT EXISTS collaboration_proposals_collaboration_id_seq
  ON collaboration_proposals (collaboration_id, seq);

CREATE INDEX IF NOT EXISTS collaboration_proposals_author_id
  ON collaboration_proposals (author_id);

-- Backfill history for collaborations that existed before this migration.
-- Use the collaboration id with a deterministic suffix; if a history row
-- already exists for seq=1 (e.g. from a concurrent insert), ignore.
INSERT OR IGNORE INTO collaboration_proposals (id, collaboration_id, seq, author_id, proposal, created_at)
SELECT
  id || '_seq1' AS id,
  id AS collaboration_id,
  1 AS seq,
  initiator_id AS author_id,
  proposal AS proposal,
  created_at AS created_at
FROM collaborations;

-- Backfill the latest counter as seq=2 for collaborations that were already countered.
-- This preserves the visible negotiation state for pre-migration countered rows.
INSERT OR IGNORE INTO collaboration_proposals (id, collaboration_id, seq, author_id, proposal, created_at)
SELECT
  id || '_seq2' AS id,
  id AS collaboration_id,
  2 AS seq,
  proposed_by AS author_id,
  counter_proposal AS proposal,
  updated_at AS created_at
FROM collaborations
WHERE counter_proposal IS NOT NULL AND proposed_by IS NOT NULL;

-- Enforce non-empty proposal at DB level on insert as well (already via CHECK, but keep explicit trigger for clarity)
CREATE TRIGGER IF NOT EXISTS collaboration_proposals_proposal_not_empty
  BEFORE INSERT ON collaboration_proposals
  FOR EACH ROW
  WHEN trim(NEW.proposal) = ''
BEGIN
  SELECT RAISE(ABORT, 'proposal must not be empty');
END;
