import type Database from 'better-sqlite3'
import { getCreatorProfile } from './profiles.js'

export const MIND_INTERACTION_ROLES = ['user', 'mind'] as const
export type MindInteractionRole = (typeof MIND_INTERACTION_ROLES)[number]

export interface MindInteraction {
  id: string
  creatorId: string
  role: MindInteractionRole
  content: string
  createdAt: string
}

export interface NewMindInteraction {
  id: string
  creatorId: string
  role: MindInteractionRole
  content: string
}

export interface MindInteractionFilter {
  limit?: number
  offset?: number
}

export interface MindInteractionList {
  interactions: MindInteraction[]
  total: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

interface MindInteractionRow {
  id: string
  creator_id: string
  role: MindInteractionRole
  content: string
  created_at: string
}

const SELECT_COLUMNS = `
  id,
  creator_id,
  role,
  content,
  created_at
`

function toInteraction(row: MindInteractionRow): MindInteraction {
  return {
    id: row.id,
    creatorId: row.creator_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required and must be a non-empty string`)
  }
}

function assertRole(value: string): asserts value is MindInteractionRole {
  if (!MIND_INTERACTION_ROLES.includes(value as MindInteractionRole)) {
    throw new Error(`role must be one of: ${MIND_INTERACTION_ROLES.join(', ')}`)
  }
}

export function createMindInteraction(
  db: Database.Database,
  interaction: NewMindInteraction,
): MindInteraction {
  assertNonEmpty(interaction.id, 'id')
  assertNonEmpty(interaction.creatorId, 'creatorId')
  assertRole(interaction.role)
  assertNonEmpty(interaction.content, 'content')
  if (getCreatorProfile(db, interaction.creatorId) === undefined) {
    throw new Error(`creator profile not found: ${interaction.creatorId}`)
  }
  db.prepare(
    `INSERT INTO mind_interactions (id, creator_id, role, content)
     VALUES (@id, @creatorId, @role, @content)`,
  ).run(interaction)
  return getMindInteraction(db, interaction.id) as MindInteraction
}

export function getMindInteraction(
  db: Database.Database,
  id: string,
): MindInteraction | undefined {
  assertNonEmpty(id, 'id')
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM mind_interactions WHERE id = ?`)
    .get(id) as MindInteractionRow | undefined
  return row ? toInteraction(row) : undefined
}

export function listMindInteractions(
  db: Database.Database,
  creatorId: string,
  filter: MindInteractionFilter = {},
): MindInteractionList {
  assertNonEmpty(creatorId, 'creatorId')
  if (getCreatorProfile(db, creatorId) === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
  }
  const limit = filter.limit ?? DEFAULT_LIMIT
  const offset = filter.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer')
  }

  const { total } = db
    .prepare('SELECT COUNT(*) AS total FROM mind_interactions WHERE creator_id = ?')
    .get(creatorId) as { total: number }

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM mind_interactions
       WHERE creator_id = ?
       ORDER BY created_at ASC, rowid ASC
       LIMIT ? OFFSET ?`,
    )
    .all(creatorId, limit, offset) as MindInteractionRow[]

  return { interactions: rows.map(toInteraction), total }
}

export function deleteMindInteraction(db: Database.Database, id: string): boolean {
  assertNonEmpty(id, 'id')
  const result = db.prepare('DELETE FROM mind_interactions WHERE id = ?').run(id)
  return result.changes > 0
}
