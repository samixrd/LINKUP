import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { createCreatorProfile, getCreatorProfile } from './profiles.js'
import type { CreatorProfile } from './profiles.js'

/**
 * Passcode auth: handle + 4+ digit PIN. PINs are hashed with scrypt
 * (random salt per account); sessions are opaque 32-byte tokens with a
 * server-side expiry. No plaintext secret is ever stored or logged.
 */

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const MIN_PIN_LENGTH = 4
export const MAX_PIN_LENGTH = 12
const HANDLE_RE = /^[a-z0-9_]{3,24}$/

export interface AuthAccount {
  handle: string
  creatorId: string
  createdAt: string
}

export interface AuthSession {
  token: string
  handle: string
  creatorId: string
  expiresAt: string
}

interface AccountRow {
  handle: string
  creator_id: string
  pin_hash: string
  created_at: string
  updated_at: string
}

interface SessionRow {
  token: string
  handle: string
  created_at: string
  expires_at: string
}

function assertHandle(value: string): string {
  const handle = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!HANDLE_RE.test(handle)) {
    throw new Error('handle must be 3-24 characters: lowercase letters, numbers, underscores')
  }
  return handle
}

function assertPin(value: string): void {
  if (typeof value !== 'string' || !/^\d{4,12}$/.test(value)) {
    throw new Error(`pin must be ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} digits`)
  }
}

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1]
  const hash = parts[2]
  if (salt === undefined || hash === undefined) return false
  const candidate = scryptSync(pin, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

function toAccount(row: AccountRow): AuthAccount {
  return { handle: row.handle, creatorId: row.creator_id, createdAt: row.created_at }
}

/**
 * Registers a new account and its creator profile in one transaction.
 * Throws `handle already taken` on conflict; other errors mirror profile
 * validation (displayName required, etc.).
 */
export function registerAccount(
  db: Database.Database,
  input: { handle: string; pin: string; displayName: string; bio?: string },
): { account: AuthAccount; profile: CreatorProfile } {
  const handle = assertHandle(input.handle)
  assertPin(input.pin)
  if (typeof input.displayName !== 'string' || input.displayName.trim() === '') {
    throw new Error('displayName is required and must be a non-empty string')
  }

  const existing = db.prepare('SELECT handle FROM accounts WHERE handle = ?').get(handle)
  if (existing !== undefined) {
    throw new Error('handle already taken')
  }

  const creatorId = `u_${handle}`
  const pinHash = hashPin(input.pin)
  const tx = db.transaction(() => {
    const profile = createCreatorProfile(db, {
      creatorId,
      displayName: input.displayName.trim(),
      ...(input.bio !== undefined && input.bio.trim() !== '' ? { bio: input.bio.trim() } : {}),
    })
    db.prepare(
      'INSERT INTO accounts (handle, creator_id, pin_hash) VALUES (?, ?, ?)',
    ).run(handle, creatorId, pinHash)
    return profile
  })
  const profile = tx()
  const row = db.prepare('SELECT * FROM accounts WHERE handle = ?').get(handle) as AccountRow
  return { account: toAccount(row), profile }
}

/**
 * Logs in with handle + PIN. Returns a session on success; throws
 * `invalid handle or pin` on any mismatch (same message for both cases so
 * attackers cannot enumerate handles).
 */
export function loginWithPin(
  db: Database.Database,
  handle: string,
  pin: string,
): AuthSession {
  const normalized = assertHandle(handle)
  assertPin(pin)
  const row = db.prepare('SELECT * FROM accounts WHERE handle = ?').get(normalized) as
    | AccountRow
    | undefined
  // Constant-shape: verify against a dummy hash even when the account is
  // missing, so timing does not reveal whether the handle exists.
  const stored = row?.pin_hash ?? hashPin('0000')
  const ok = verifyPin(pin, stored)
  if (row === undefined || !ok) {
    throw new Error('invalid handle or pin')
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  // Lazy prune of this account's expired sessions.
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
  db.prepare('INSERT INTO sessions (token, handle, expires_at) VALUES (?, ?, ?)').run(
    token,
    row.handle,
    expiresAt,
  )
  return { token, handle: row.handle, creatorId: row.creator_id, expiresAt }
}

/**
 * Resolves a session token to its account, or undefined when invalid or
 * expired (expired tokens are deleted on sight).
 */
export function resolveSession(db: Database.Database, token: string): AuthSession | undefined {
  if (typeof token !== 'string' || token.length < 32 || !/^[a-f0-9]+$/.test(token)) {
    return undefined
  }
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as
    | SessionRow
    | undefined
  if (row === undefined) return undefined
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return undefined
  }
  const account = db.prepare('SELECT * FROM accounts WHERE handle = ?').get(row.handle) as
    | AccountRow
    | undefined
  if (account === undefined) return undefined
  return { token: row.token, handle: row.handle, creatorId: account.creator_id, expiresAt: row.expires_at }
}

/** Deletes a session (logout). Returns true when a session existed. */
export function logoutSession(db: Database.Database, token: string): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  return result.changes > 0
}

/** Looks up the creator profile behind a handle. */
export function getAccountProfile(db: Database.Database, handle: string): CreatorProfile | undefined {
  const normalized = assertHandle(handle)
  const row = db.prepare('SELECT creator_id FROM accounts WHERE handle = ?').get(normalized) as
    | { creator_id: string }
    | undefined
  if (row === undefined) return undefined
  return getCreatorProfile(db, row.creator_id)
}

/** Unused-id helper kept local to avoid importing uuid in the db layer. */
export const _newSessionId = randomUUID
