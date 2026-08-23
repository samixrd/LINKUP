-- 0011_accounts: passcode auth for creators.
-- A creator account = handle (unique, lowercase) + scrypt-hashed 4+ digit PIN.
-- Sessions are opaque tokens stored server-side; the cookie carries only the
-- token. No email/password — deliberately lightweight for the jam demo while
-- remaining real auth (hashed secrets, constant-time compares).
CREATE TABLE IF NOT EXISTS accounts (
  handle        TEXT PRIMARY KEY,
  creator_id    TEXT NOT NULL UNIQUE REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  pin_hash      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  handle        TEXT NOT NULL REFERENCES accounts(handle) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_handle ON sessions (handle);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

-- Expired-session cleanup trigger is unnecessary; the API prunes lazily.

CREATE TRIGGER IF NOT EXISTS accounts_touch_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
BEGIN
  UPDATE accounts
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE handle = OLD.handle;
END;
