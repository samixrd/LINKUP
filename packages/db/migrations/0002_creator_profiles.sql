-- 0002_creator_profiles: persistent creator identity.
-- Each creator is identified by a unique creatorId (a ULID or similar
-- opaque identifier chosen by the application layer). The profile holds
-- human-readable metadata about the creator.
CREATE TABLE IF NOT EXISTS creator_profiles (
  creator_id    TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Enforce that display_name is non-empty at the database level too.
CREATE TRIGGER IF NOT EXISTS creator_profiles_display_name_not_empty
  BEFORE INSERT ON creator_profiles
  FOR EACH ROW
  WHEN NEW.display_name = ''
BEGIN
  SELECT RAISE(ABORT, 'display_name must not be empty');
END;

-- Keep updated_at in sync on every row update.
CREATE TRIGGER IF NOT EXISTS creator_profiles_touch_updated_at
  BEFORE UPDATE ON creator_profiles
  FOR EACH ROW
BEGIN
  UPDATE creator_profiles
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE creator_id = OLD.creator_id;
END;