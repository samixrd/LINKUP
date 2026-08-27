-- 0018_brand_accounts.sql
-- Brand-specific auth: handle/PIN/session, separate from creator accounts

CREATE TABLE IF NOT EXISTS brand_accounts (
  handle          TEXT PRIMARY KEY,
  brand_id        TEXT NOT NULL UNIQUE,
  brand_name      TEXT NOT NULL,
  pin_hash        TEXT NOT NULL,
  industry        TEXT NOT NULL DEFAULT 'Tech & AI',
  target_platform TEXT NOT NULL DEFAULT 'Instagram',
  collab_format   TEXT NOT NULL DEFAULT 'Dedicated 60s Reel / TikTok',
  budget_tier     TEXT NOT NULL DEFAULT '$300 - $1,000 (Mid-tier Growth)',
  guardrails      TEXT NOT NULL DEFAULT 'Family-friendly content only',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS brand_sessions (
  token      TEXT PRIMARY KEY,
  handle     TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (handle) REFERENCES brand_accounts(handle) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brand_sessions_handle ON brand_sessions(handle);
CREATE INDEX IF NOT EXISTS idx_brand_sessions_expires ON brand_sessions(expires_at);
