import type Database from 'better-sqlite3'
import { getCreatorProfile } from './profiles.js'
import { normalizeTerms } from './matching.js'

/** The supported categories for a creator memory. */
export const MEMORY_CATEGORIES = [
  'preference',
  'goal',
  'relationship',
  'collaboration_outcome',
  'lesson',
  'constraint',
  'interaction',
] as const

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

/**
 * A single recorded fact about a creator. `id` and `creatorId` are opaque,
 * application-chosen identifiers; `createdAt`/`updatedAt` are managed by the
 * database layer.
 */
export interface CreatorMemory {
  id: string
  creatorId: string
  category: MemoryCategory
  content: string
  createdAt: string
  updatedAt: string
}

/** Fields that must be supplied when adding a memory. */
export type NewCreatorMemory = Pick<CreatorMemory, 'id' | 'creatorId' | 'category' | 'content'>

/** Fields that can be updated on an existing memory. */
export type CreatorMemoryUpdates = Partial<Pick<CreatorMemory, 'category' | 'content'>>

/** Filter for `listCreatorMemories`. Omitted fields are not applied. */
export interface CreatorMemoryFilter {
  creatorId?: string
  category?: MemoryCategory
}

interface MemoryRow {
  id: string
  creator_id: string
  category: MemoryCategory
  content: string
  created_at: string
  updated_at: string
}

const SELECT_COLUMNS = `
  id,
  creator_id,
  category,
  content,
  created_at,
  updated_at
`

function toMemory(row: MemoryRow): CreatorMemory {
  return {
    id: row.id,
    creatorId: row.creator_id,
    category: row.category,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assertId(value: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('id is required and must be a non-empty string')
  }
}

function assertCreatorId(value: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
}

function assertCategory(value: MemoryCategory): void {
  if (!MEMORY_CATEGORIES.includes(value)) {
    throw new Error(`category must be one of: ${MEMORY_CATEGORIES.join(', ')}`)
  }
}

function assertContent(value: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('content is required and must be a non-empty string')
  }
}

/**
 * Adds a memory for a creator. Throws an `Error` when required fields are
 * missing or invalid, when the creator profile does not exist, and when a
 * memory with the same `id` already exists (SQLite PRIMARY KEY constraint).
 */
export function addCreatorMemory(db: Database.Database, memory: NewCreatorMemory): CreatorMemory {
  assertId(memory.id)
  assertCreatorId(memory.creatorId)
  assertCategory(memory.category)
  assertContent(memory.content)
  if (getCreatorProfile(db, memory.creatorId) === undefined) {
    throw new Error(`creator profile not found: ${memory.creatorId}`)
  }
  db.prepare(
    `INSERT INTO creator_memories (id, creator_id, category, content)
     VALUES (@id, @creatorId, @category, @content)`,
  ).run(memory)
  return getCreatorMemory(db, memory.id) as CreatorMemory
}

/**
 * Lists memories, optionally narrowed to a single creator and/or category.
 * Ordered by `createdAt` (then `id`) for a stable result.
 */
export function listCreatorMemories(
  db: Database.Database,
  filter: CreatorMemoryFilter = {},
): CreatorMemory[] {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.creatorId !== undefined) {
    assertCreatorId(filter.creatorId)
    clauses.push('creator_id = ?')
    params.push(filter.creatorId)
  }
  if (filter.category !== undefined) {
    assertCategory(filter.category)
    clauses.push('category = ?')
    params.push(filter.category)
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM creator_memories${where} ORDER BY created_at, id`)
    .all(...params) as MemoryRow[]
  return rows.map(toMemory)
}

/**
 * A page of search results plus the total number of memories that matched.
 */
export interface MemorySearchList {
  memories: CreatorMemory[]
  total: number
}

/** Options for `searchCreatorMemories`. Omitted fields use defaults. */
export interface MemorySearchOptions {
  /** Maximum memories to return. Defaults to 50, capped at 100. */
  limit?: number
  /** Number of memories to skip. Defaults to 0. */
  offset?: number
}

const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 100

/**
 * Deterministic, local search over a creator's own memories. The query and
 * each memory's content are normalized into terms (lowercased, split on
 * non-alphanumeric runs, with tokens shorter than 3 characters and stopwords
 * removed — the same tokenizer matching uses); a memory matches when its
 * content contains at least one query term, and is scored by the number of
 * distinct query terms it contains. Results are ordered by score (descending),
 * then by `createdAt`/`id` for a stable result, and paginated with
 * `limit`/`offset`; `total` is the number of matching memories before
 * pagination. Throws an `Error` when the creator does not exist, when `query`
 * is empty, or when `limit`/`offset` are not valid.
 */
export function searchCreatorMemories(
  db: Database.Database,
  creatorId: string,
  query: string,
  options: MemorySearchOptions = {},
): MemorySearchList {
  assertCreatorId(creatorId)
  if (getCreatorProfile(db, creatorId) === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
  }
  if (typeof query !== 'string' || query.trim() === '') {
    throw new Error('query is required and must be a non-empty string')
  }

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer')
  }

  const queryTerms = normalizeTerms(query)
  const scored: Array<{ memory: CreatorMemory; score: number }> = []
  for (const memory of listCreatorMemories(db, { creatorId })) {
    const contentTerms = normalizeTerms(memory.content)
    let score = 0
    for (const term of queryTerms) {
      if (contentTerms.has(term)) score += 1
    }
    if (score > 0) scored.push({ memory, score })
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    // Ties fall back to the standard listing order for a stable result.
    if (a.memory.createdAt !== b.memory.createdAt) {
      return a.memory.createdAt < b.memory.createdAt ? -1 : 1
    }
    if (a.memory.id !== b.memory.id) return a.memory.id < b.memory.id ? -1 : 1
    return 0
  })

  return {
    memories: scored.slice(offset, offset + limit).map((entry) => entry.memory),
    total: scored.length,
  }
}

/**
 * Returns the memory for `id`, or `undefined` when no such memory exists.
 */
export function getCreatorMemory(
  db: Database.Database,
  id: string,
): CreatorMemory | undefined {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM creator_memories WHERE id = ?`)
    .get(id) as MemoryRow | undefined
  return row ? toMemory(row) : undefined
}

/**
 * Updates the given fields of an existing memory and returns the updated
 * memory. Throws an `Error` when the memory does not exist, when a provided
 * field would be invalid, or when the update contains no fields.
 */
export function updateCreatorMemory(
  db: Database.Database,
  id: string,
  updates: CreatorMemoryUpdates,
): CreatorMemory {
  assertId(id)
  if (getCreatorMemory(db, id) === undefined) {
    throw new Error(`creator memory not found: ${id}`)
  }
  if (updates.category !== undefined) {
    assertCategory(updates.category)
  }
  if (updates.content !== undefined) {
    assertContent(updates.content)
  }

  const entries = Object.entries(updates)
  if (entries.length === 0) {
    throw new Error('update must contain at least one field')
  }

  const columnMap: Record<string, string> = {
    category: 'category',
    content: 'content',
  }
  const assignments = entries.map(([key]) => `${columnMap[key]} = @${key}`)
  const params: Record<string, string> = { id }
  for (const [key, value] of entries) {
    params[key] = value as string
  }

  db.prepare(`UPDATE creator_memories SET ${assignments.join(', ')} WHERE id = @id`).run(params)
  return getCreatorMemory(db, id) as CreatorMemory
}

/**
 * Deletes the memory for `id`. Returns `true` when a memory was deleted,
 * `false` when no such memory existed.
 */
export function deleteCreatorMemory(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM creator_memories WHERE id = ?').run(id)
  return result.changes > 0
}
