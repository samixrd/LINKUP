-- 0004_creator_discovery: creator listing foundation.
-- listCreatorProfiles orders by display_name COLLATE NOCASE, then creator_id;
-- this index serves that ordering and any future case-insensitive prefix
-- lookups. (Substring LIKE searches cannot use an index in SQLite.)
CREATE INDEX IF NOT EXISTS creator_profiles_display_name_nocase
  ON creator_profiles (display_name COLLATE NOCASE);
