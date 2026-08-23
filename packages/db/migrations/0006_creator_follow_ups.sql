-- 0006_creator_follow_ups: follow-up foundation.
-- Each follow-up belongs to a collaboration and tracks a scheduled check-in.
-- Deleting a collaboration removes its follow-ups (ON DELETE CASCADE).
-- Status is an explicit state machine: pending -> completed | cancelled (terminal).
CREATE TABLE IF NOT EXISTS follow_ups (
  id               TEXT PRIMARY KEY,
  collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
  due_at           TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')) DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(due_at) > 0)
);

-- Follow-up lookup: list all follow-ups for a collaboration.
CREATE INDEX IF NOT EXISTS follow_ups_collaboration_id ON follow_ups (collaboration_id);

-- Status filtering: e.g. list pending follow-ups for a collaboration.
CREATE INDEX IF NOT EXISTS follow_ups_status ON follow_ups (status);

-- Due ordering: supports ORDER BY due_at for list endpoints.
CREATE INDEX IF NOT EXISTS follow_ups_due_at ON follow_ups (due_at);

-- Combined filter: collaboration + status + due recency.
CREATE INDEX IF NOT EXISTS follow_ups_collaboration_status_due
  ON follow_ups (collaboration_id, status, due_at);

-- Keep updated_at in sync on every row update.
CREATE TRIGGER IF NOT EXISTS follow_ups_touch_updated_at
  BEFORE UPDATE ON follow_ups
  FOR EACH ROW
BEGIN
  UPDATE follow_ups
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.id;
END;

-- Enforce due_at non-empty at the database level as well.
CREATE TRIGGER IF NOT EXISTS follow_ups_due_at_not_empty
  BEFORE INSERT ON follow_ups
  FOR EACH ROW
  WHEN NEW.due_at = ''
BEGIN
  SELECT RAISE(ABORT, 'due_at must not be empty');
END;
