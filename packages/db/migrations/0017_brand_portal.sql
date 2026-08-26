-- 0017_brand_portal.sql
-- Adds brand sponsorship options to open_collabs and creates brand campaigns table

ALTER TABLE open_collabs ADD COLUMN open_for_brands INTEGER NOT NULL DEFAULT 0;
ALTER TABLE open_collabs ADD COLUMN brand_min_rate REAL DEFAULT 0;

CREATE TABLE IF NOT EXISTS brand_campaigns (
  id TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  brand_handle TEXT NOT NULL,
  title TEXT NOT NULL,
  niche TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Instagram',
  min_followers INTEGER NOT NULL DEFAULT 0,
  min_views INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL,
  languages TEXT NOT NULL DEFAULT 'en',
  budget_total REAL NOT NULL DEFAULT 0,
  rate_per_creator REAL NOT NULL DEFAULT 0,
  deliverables TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brand_campaigns_niche ON brand_campaigns(niche);
CREATE INDEX IF NOT EXISTS idx_brand_campaigns_status ON brand_campaigns(status);

CREATE TABLE IF NOT EXISTS brand_proposals (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  offer_amount REAL NOT NULL,
  deliverable_terms TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES brand_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES creators(creator_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brand_proposals_creator ON brand_proposals(creator_id);