import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'

export const BRAND_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface BrandAccount {
  handle: string
  brandId: string
  brandName: string
  industry: string
  targetPlatform: string
  collabFormat: string
  budgetTier: string
  guardrails: string
  createdAt: string
}

export interface BrandSession {
  token: string
  handle: string
  brandId: string
  brandName: string
  expiresAt: string
}

interface BrandAccountRow {
  handle: string
  brand_id: string
  brand_name: string
  pin_hash: string
  industry: string
  target_platform: string
  collab_format: string
  budget_tier: string
  guardrails: string
  created_at: string
}

interface BrandSessionRow {
  token: string
  handle: string
  expires_at: string
}

const HANDLE_RE = /^[a-z0-9_]{3,24}$/

function assertHandle(value: unknown): string {
  const h = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!HANDLE_RE.test(h)) {
    throw new Error('handle must be 3-24 characters: lowercase letters, numbers, underscores')
  }
  return h
}

function assertPin(value: unknown): void {
  if (typeof value !== 'string' || !/^\d{4,12}$/.test(value)) {
    throw new Error('pin must be 4-12 digits')
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
  if (!salt || !hash) return false
  const candidate = scryptSync(pin, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

function toAccount(row: BrandAccountRow): BrandAccount {
  return {
    handle: row.handle,
    brandId: row.brand_id,
    brandName: row.brand_name,
    industry: row.industry,
    targetPlatform: row.target_platform,
    collabFormat: row.collab_format,
    budgetTier: row.budget_tier,
    guardrails: row.guardrails,
    createdAt: row.created_at,
  }
}

export interface RegisterBrandInput {
  handle: string
  pin: string
  brandName: string
  industry: string
  targetPlatform: string
  collabFormat: string
  budgetTier: string
  guardrails: string
}

function createBrandSession(
  db: Database.Database,
  handle: string,
  brandId: string,
  brandName: string,
): BrandSession {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + BRAND_SESSION_TTL_MS).toISOString()
  db.prepare("DELETE FROM brand_sessions WHERE expires_at <= ?").run(new Date().toISOString())
  db.prepare("INSERT INTO brand_sessions (token, handle, expires_at) VALUES (?, ?, ?)").run(
    token, handle, expiresAt,
  )
  return { token, handle, brandId, brandName, expiresAt }
}

export function registerBrandAccount(
  db: Database.Database,
  input: RegisterBrandInput,
): { account: BrandAccount; session: BrandSession } {
  const handle = assertHandle(input.handle)
  assertPin(input.pin)
  if (typeof input.brandName !== 'string' || input.brandName.trim() === '') {
    throw new Error('brandName is required')
  }

  const existing = db.prepare('SELECT handle FROM brand_accounts WHERE handle = ?').get(handle)
  if (existing !== undefined) throw new Error('handle already taken')

  const brandId = `brand_${handle}`
  const pinHash = hashPin(input.pin)

  db.prepare(`
    INSERT INTO brand_accounts
      (handle, brand_id, brand_name, pin_hash, industry, target_platform, collab_format, budget_tier, guardrails)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    handle, brandId, input.brandName.trim(), pinHash,
    input.industry, input.targetPlatform, input.collabFormat, input.budgetTier, input.guardrails,
  )

  // Seed a minimal creator profile row so brand can appear in open_collabs negotiations
  try {
    const bio = `Brand Mind: ${input.industry} | ${input.targetPlatform} | ${input.budgetTier}`
    db.prepare(`
      INSERT OR IGNORE INTO creators (creator_id, display_name, bio, created_at, updated_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `).run(brandId, input.brandName.trim(), bio)
  } catch {
    // Silently skip if schema differs
  }

  const row = db.prepare('SELECT * FROM brand_accounts WHERE handle = ?').get(handle) as BrandAccountRow
  const account = toAccount(row)
  const session = createBrandSession(db, handle, brandId, input.brandName.trim())
  return { account, session }
}

export function loginBrand(db: Database.Database, handle: string, pin: string): BrandSession {
  const normalized = assertHandle(handle)
  assertPin(pin)
  const row = db.prepare('SELECT * FROM brand_accounts WHERE handle = ?').get(normalized) as
    | BrandAccountRow
    | undefined
  const stored = row?.pin_hash ?? hashPin('0000')
  const ok = verifyPin(pin, stored)
  if (!row || !ok) throw new Error('invalid handle or pin')
  return createBrandSession(db, row.handle, row.brand_id, row.brand_name)
}

export function resolveBrandSession(
  db: Database.Database,
  token: string,
): BrandSession | undefined {
  if (typeof token !== 'string' || token.length < 32 || !/^[a-f0-9]+$/.test(token)) return undefined
  const row = db.prepare('SELECT * FROM brand_sessions WHERE token = ?').get(token) as
    | BrandSessionRow
    | undefined
  if (!row) return undefined
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM brand_sessions WHERE token = ?').run(token)
    return undefined
  }
  const account = db.prepare('SELECT * FROM brand_accounts WHERE handle = ?').get(row.handle) as
    | BrandAccountRow
    | undefined
  if (!account) return undefined
  return {
    token: row.token,
    handle: row.handle,
    brandId: account.brand_id,
    brandName: account.brand_name,
    expiresAt: row.expires_at,
  }
}

export function logoutBrandSession(db: Database.Database, token: string): boolean {
  const result = db.prepare('DELETE FROM brand_sessions WHERE token = ?').run(token)
  return result.changes > 0
}

export function getBrandAccount(db: Database.Database, handle: string): BrandAccount | undefined {
  const normalized = assertHandle(handle)
  const row = db.prepare('SELECT * FROM brand_accounts WHERE handle = ?').get(normalized) as
    | BrandAccountRow
    | undefined
  return row ? toAccount(row) : undefined
}

export function updateBrandMind(
  db: Database.Database,
  handle: string,
  updates: Partial<Pick<RegisterBrandInput, 'industry' | 'targetPlatform' | 'collabFormat' | 'budgetTier' | 'guardrails'>>,
): void {
  const normalized = assertHandle(handle)
  const colMap: Record<string, string> = {
    industry: 'industry',
    targetPlatform: 'target_platform',
    collabFormat: 'collab_format',
    budgetTier: 'budget_tier',
    guardrails: 'guardrails',
  }
  for (const [key, val] of Object.entries(updates)) {
    if (typeof val !== 'string' || val.trim() === '') continue
    const col = colMap[key]
    if (!col) continue
    db.prepare(
      `UPDATE brand_accounts SET ${col} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE handle = ?`,
    ).run(val.trim(), normalized)
  }
}
