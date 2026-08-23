import type Database from 'better-sqlite3'

/**
 * A creator's public profile. `creatorId` is the opaque, application-chosen
 * identifier of the creator; `createdAt`/`updatedAt` are managed by the
 * database layer.
 */
export interface CreatorProfile {
  creatorId: string
  displayName: string
  bio: string
  avatarUrl: string
  createdAt: string
  updatedAt: string
}

/**
 * Fields that may be supplied when creating a profile. `bio` and `avatarUrl`
 * default to empty strings. `createdAt`/`updatedAt` are always set by the
 * database.
 */
export type NewCreatorProfile = Pick<CreatorProfile, 'creatorId' | 'displayName'> &
  Partial<Pick<CreatorProfile, 'bio' | 'avatarUrl'>>

/** Fields that can be updated on an existing profile. */
export type CreatorProfileUpdates = Partial<
  Pick<CreatorProfile, 'displayName' | 'bio' | 'avatarUrl'>
>

/** Filter for `listCreatorProfiles`. Omitted fields are not applied. */
export interface CreatorProfileFilter {
  /** Case-insensitive substring match over `displayName` and `bio`. */
  query?: string
  /** Maximum creators to return. Defaults to 50, capped at 100. */
  limit?: number
  /** Number of creators to skip. Defaults to 0. */
  offset?: number
}

/** A page of creators plus the total number of rows matching the filter. */
export interface CreatorProfileList {
  creators: CreatorProfile[]
  total: number
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

interface ProfileRow {
  creator_id: string
  display_name: string
  bio: string
  avatar_url: string
  created_at: string
  updated_at: string
}

const SELECT_COLUMNS = `
  creator_id,
  display_name,
  bio,
  avatar_url,
  created_at,
  updated_at
`

function toProfile(row: ProfileRow): CreatorProfile {
  return {
    creatorId: row.creator_id,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Creates a creator profile. Throws an `Error` when required fields are
 * missing or empty, and when a profile with the same `creatorId` already
 * exists (SQLite UNIQUE constraint).
 */
export function createCreatorProfile(
  db: Database.Database,
  profile: NewCreatorProfile,
): CreatorProfile {
  const creatorId = profile.creatorId
  const displayName = profile.displayName
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    throw new Error('displayName is required and must be a non-empty string')
  }

  const bio = profile.bio ?? ''
  const avatarUrl = profile.avatarUrl ?? ''
  db.prepare(
    `INSERT INTO creator_profiles (creator_id, display_name, bio, avatar_url)
     VALUES (@creatorId, @displayName, @bio, @avatarUrl)`,
  ).run({ creatorId, displayName, bio, avatarUrl })
  return getCreatorProfile(db, creatorId) as CreatorProfile
}

/**
 * Returns the profile for `creatorId`, or `undefined` when no such profile
 * exists.
 */
export function getCreatorProfile(
  db: Database.Database,
  creatorId: string,
): CreatorProfile | undefined {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM creator_profiles WHERE creator_id = ?`)
    .get(creatorId) as ProfileRow | undefined
  return row ? toProfile(row) : undefined
}

/**
 * Lists creator profiles, optionally narrowed by a case-insensitive substring
 * search over `displayName` and `bio` (`%` and `_` in the query are treated
 * literally) and paginated with `limit`/`offset`. Ordered by `displayName`
 * (case-insensitive), then `creatorId`, for a stable result. Returns the page
 * of profiles plus the total number of rows matching the filter.
 * Throws an `Error` when `limit` or `offset` are not valid.
 */
export function listCreatorProfiles(
  db: Database.Database,
  filter: CreatorProfileFilter = {},
): CreatorProfileList {
  const limit = filter.limit ?? DEFAULT_LIST_LIMIT
  const offset = filter.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer')
  }

  const clauses: string[] = []
  const params: string[] = []
  if (typeof filter.query === 'string' && filter.query !== '') {
    const escaped = filter.query.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)
    clauses.push(
      `(LOWER(display_name) LIKE ? ESCAPE '\\' OR LOWER(bio) LIKE ? ESCAPE '\\')`,
    )
    params.push(`%${escaped}%`, `%${escaped}%`)
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM creator_profiles${where}`)
    .get(...params) as { total: number }

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM creator_profiles${where}
       ORDER BY display_name COLLATE NOCASE, creator_id
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ProfileRow[]

  return { creators: rows.map(toProfile), total }
}

/**
 * Updates the given fields of an existing profile and returns the updated
 * profile. Throws an `Error` when the profile does not exist, when a provided
 * `displayName` would be empty, or when the update contains no fields.
 */
export function updateCreatorProfile(
  db: Database.Database,
  creatorId: string,
  updates: CreatorProfileUpdates,
): CreatorProfile {
  if (getCreatorProfile(db, creatorId) === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
  }
  if (updates.displayName !== undefined && updates.displayName.trim() === '') {
    throw new Error('displayName must be a non-empty string')
  }

  const entries = Object.entries(updates)
  if (entries.length === 0) {
    throw new Error('update must contain at least one field')
  }

  const columnMap: Record<string, string> = {
    displayName: 'display_name',
    bio: 'bio',
    avatarUrl: 'avatar_url',
  }
  const assignments = entries.map(([key]) => `${columnMap[key]} = @${key}`)
  const params: Record<string, string> = { creatorId }
  for (const [key, value] of entries) {
    params[key] = value as string
  }

  db.prepare(
    `UPDATE creator_profiles SET ${assignments.join(', ')} WHERE creator_id = @creatorId`,
  ).run(params)
  return getCreatorProfile(db, creatorId) as CreatorProfile
}

/**
 * Deletes the profile for `creatorId`. Returns `true` when a profile was
 * deleted, `false` when no such profile existed.
 */
export function deleteCreatorProfile(db: Database.Database, creatorId: string): boolean {
  const result = db.prepare('DELETE FROM creator_profiles WHERE creator_id = ?').run(creatorId)
  return result.changes > 0
}
