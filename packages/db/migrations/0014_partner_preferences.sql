-- 0014_partner_preferences: what a creator wants in a collaboration partner
-- and deal terms. All nullable; null means "not yet provided". Multi-value
-- fields are JSON arrays of strings. These power preference-aware matching
-- and compensation-aware Mind proposals.
ALTER TABLE creator_profile_details ADD COLUMN partner_min_audience TEXT; -- bucket: 'any', '~1k', '~10k', '~100k+'
ALTER TABLE creator_profile_details ADD COLUMN partner_max_audience TEXT; -- bucket: 'no-limit', '~1M+', ...
ALTER TABLE creator_profile_details ADD COLUMN partner_niches       TEXT; -- JSON array of acceptable partner niches
ALTER TABLE creator_profile_details ADD COLUMN min_avg_views        TEXT; -- bucket: '<1k', '1k-10k', '10k-100k', '100k+'
ALTER TABLE creator_profile_details ADD COLUMN languages            TEXT; -- JSON array, e.g. '["English","Bangla"]'
ALTER TABLE creator_profile_details ADD COLUMN preferred_platforms  TEXT; -- JSON array of platforms wanted in a partner
ALTER TABLE creator_profile_details ADD COLUMN compensation         TEXT; -- JSON array: paid / barter / revenue-share / free
ALTER TABLE creator_profile_details ADD COLUMN min_budget           TEXT; -- free text, e.g. '$50 per video'
ALTER TABLE creator_profile_details ADD COLUMN open_to_small        TEXT; -- 'yes' / 'no': willing to collab with 0-follower creators
ALTER TABLE creator_profile_details ADD COLUMN avg_views            TEXT; -- own stats: average views bucket
