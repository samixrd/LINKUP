-- 0007_mind_interactions: persistent Mind chat history.
-- Each interaction is a single turn (user or mind) belonging to a creator.
-- Deleting a creator removes its history (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS mind_interactions (
  id         TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'mind')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(content) > 0)
);

-- History reconstruction: chronological per creator.
CREATE INDEX IF NOT EXISTS mind_interactions_creator_created
  ON mind_interactions (creator_id, created_at, id);

-- Filtered history: e.g. user-only or mind-only.
CREATE INDEX IF NOT EXISTS mind_interactions_creator_role_created
  ON mind_interactions (creator_id, role, created_at);
