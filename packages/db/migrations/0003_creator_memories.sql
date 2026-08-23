-- 0003_creator_memories: persistent creator memory.
-- A memory is a single recorded fact about a creator, tagged with a
-- category. Memories belong to a creator profile and are removed when
-- the profile is deleted (ON DELETE CASCADE), so creator data stays
-- self-contained.
CREATE TABLE IF NOT EXISTS creator_memories (
  id         TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (
    category IN (
      'preference',
      'goal',
      'relationship',
      'collaboration_outcome',
      'lesson',
      'constraint',
      'interaction'
    )
  ),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Lookups filter by creator and category, so index the pair.
CREATE INDEX IF NOT EXISTS creator_memories_creator_category
  ON creator_memories (creator_id, category);

-- Enforce that content is non-empty at the database level too.
CREATE TRIGGER IF NOT EXISTS creator_memories_content_not_empty
  BEFORE INSERT ON creator_memories
  FOR EACH ROW
  WHEN NEW.content = ''
BEGIN
  SELECT RAISE(ABORT, 'content must not be empty');
END;

-- Keep updated_at in sync on every row update.
CREATE TRIGGER IF NOT EXISTS creator_memories_touch_updated_at
  BEFORE UPDATE ON creator_memories
  FOR EACH ROW
BEGIN
  UPDATE creator_memories
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.id;
END;
