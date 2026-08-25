-- 0013_profile_details: structured creator profile fields for richer matching
-- and proposal context. Each field is nullable; a null value means "not yet
-- provided". Multi-value fields (niche, platforms, collab_types, goals) are
-- stored as JSON arrays of strings. Single-value fields are plain TEXT.
CREATE TABLE IF NOT EXISTS creator_profile_details (
  creator_id    TEXT PRIMARY KEY REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  niches        TEXT,  -- JSON array, e.g. '["Music","Video","Art"]'
  platforms     TEXT,  -- JSON array, e.g. '["YouTube","TikTok"]'
  audience_size TEXT,  -- bucket: 'Just starting', '~1k', '~10k', '~100k+', '~1M+'
  collab_types  TEXT,  -- JSON array, e.g. '["co-create","cross-promo","guest"]'
  availability  TEXT,  -- bucket: '~1 hr/week', '~5 hrs/week', '~10+ hrs/week', 'Full-time'
  location      TEXT,  -- free-text city/region
  goals         TEXT,  -- JSON array, e.g. '["Grow audience","Monetize"]'
  dealbreakers  TEXT,  -- free-text "no tobacco, no politics"
  portfolio_url TEXT,  -- link to best work
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS profile_details_touch_updated_at
  BEFORE UPDATE ON creator_profile_details
  FOR EACH ROW
BEGIN
  UPDATE creator_profile_details
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE creator_id = OLD.creator_id;
END;