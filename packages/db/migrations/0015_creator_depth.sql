-- 0015_creator_depth: deeper creator-profiling fields for the extended
-- onboarding interview. All nullable; multi-value fields are JSON arrays.
ALTER TABLE creator_profile_details ADD COLUMN content_format     TEXT; -- JSON array: short-form / long-form / live / audio / written
ALTER TABLE creator_profile_details ADD COLUMN posting_frequency  TEXT; -- bucket: daily / few-per-week / weekly / irregular
ALTER TABLE creator_profile_details ADD COLUMN editing_skills     TEXT; -- bucket: none / basic / pro
ALTER TABLE creator_profile_details ADD COLUMN equipment          TEXT; -- free text, e.g. 'camera + mic + light setup'
ALTER TABLE creator_profile_details ADD COLUMN audience_age       TEXT; -- bucket: under-18 / 18-24 / 25-34 / 35+
ALTER TABLE creator_profile_details ADD COLUMN audience_regions   TEXT; -- free text top regions, e.g. 'BD, India'
ALTER TABLE creator_profile_details ADD COLUMN collab_experience  TEXT; -- bucket: never / a-few / many
ALTER TABLE creator_profile_details ADD COLUMN growth_stage       TEXT; -- bucket: finding-niche / growing / established
ALTER TABLE creator_profile_details ADD COLUMN timezone           TEXT; -- free text, e.g. 'UTC+6'
