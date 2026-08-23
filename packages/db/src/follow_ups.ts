import type Database from 'better-sqlite3'
import { getCollaboration } from './collaborations.js'

/** The allowed states for a follow-up. */
export const FOLLOW_UP_STATUSES = ['pending', 'completed', 'cancelled'] as const

export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number]

/**
 * A follow-up tied to a collaboration. `id` is an opaque identifier
 * supplied at creation time; `collaborationId` references the parent
 * collaboration; `dueAt` is an ISO-8601 timestamp; `status` is an explicit
 * state machine; `attempts` counts delivery tries; `createdAt`/`updatedAt`
 * are managed by the database layer.
 */
export interface FollowUp {
  id: string
  collaborationId: string
  dueAt: string
  status: FollowUpStatus
  attempts: number
  createdAt: string
  updatedAt: string
}

/** Fields that must be supplied when creating a follow-up. */
export interface NewFollowUp {
  id: string
  collaborationId: string
  dueAt: string
  status?: FollowUpStatus
  attempts?: number
}

/** Filter for `listFollowUpsForCollaboration`. Omitted fields are not applied. */
export interface FollowUpFilter {
  /** Filter by follow-up status. */
  status?: FollowUpStatus
  /** Maximum follow-ups to return. Defaults to 50, capped at 100. */
  limit?: number
  /** Number of follow-ups to skip. Defaults to 0. */
  offset?: number
}

/** A page of follow-ups plus the total number of rows matching the filter. */
export interface FollowUpList {
  followUps: FollowUp[]
  total: number
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

interface FollowUpRow {
  id: string
  collaboration_id: string
  due_at: string
  status: FollowUpStatus
  attempts: number
  created_at: string
  updated_at: string
}

const SELECT_COLUMNS = `
  id,
  collaboration_id,
  due_at,
  status,
  attempts,
  created_at,
  updated_at
`

function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    collaborationId: row.collaboration_id,
    dueAt: row.due_at,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required and must be a non-empty string`)
  }
}

function assertDueAt(value: string): void {
  assertNonEmpty(value, 'dueAt')
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    throw new Error('dueAt must be a valid ISO 8601 date string')
  }
}

function assertStatus(value: string): asserts value is FollowUpStatus {
  if (!FOLLOW_UP_STATUSES.includes(value as FollowUpStatus)) {
    throw new Error(`status must be one of: ${FOLLOW_UP_STATUSES.join(', ')}`)
  }
}

function assertAttempts(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('attempts must be a non-negative integer')
  }
}

/**
 * Returns true when a transition from `from` to `to` is allowed.
 * Terminal states (completed, cancelled) have no outgoing transitions.
 * Pending may move to any terminal state.
 */
export function isValidFollowUpStatusTransition(
  from: FollowUpStatus,
  to: FollowUpStatus,
): boolean {
  const allowed: Record<FollowUpStatus, FollowUpStatus[]> = {
    pending: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  }
  return allowed[from].includes(to)
}

/**
 * Creates a follow-up for an existing collaboration. Throws an `Error`
 * when required fields are missing or invalid, when the collaboration does
 * not exist, or when a follow-up with the same `id` already exists
 * (SQLite PRIMARY KEY constraint).
 */
export function createFollowUp(
  db: Database.Database,
  followUp: NewFollowUp,
): FollowUp {
  assertNonEmpty(followUp.id, 'id')
  assertNonEmpty(followUp.collaborationId, 'collaborationId')
  assertDueAt(followUp.dueAt)
  if (followUp.status !== undefined) {
    assertStatus(followUp.status)
    if (followUp.status !== 'pending') {
      throw new Error('follow-up must be created in pending status')
    }
  }
  if (followUp.attempts !== undefined) {
    assertAttempts(followUp.attempts)
    if (followUp.attempts !== 0) {
      throw new Error('follow-up must be created with 0 attempts')
    }
  }
  if (getCollaboration(db, followUp.collaborationId) === undefined) {
    throw new Error(`collaboration not found: ${followUp.collaborationId}`)
  }

  const status: FollowUpStatus = followUp.status ?? 'pending'
  const attempts = followUp.attempts ?? 0
  db.prepare(
    `INSERT INTO follow_ups (id, collaboration_id, due_at, status, attempts)
     VALUES (@id, @collaborationId, @dueAt, @status, @attempts)`,
  ).run({
    id: followUp.id,
    collaborationId: followUp.collaborationId,
    dueAt: followUp.dueAt,
    status,
    attempts,
  })
  return getFollowUp(db, followUp.id) as FollowUp
}

/**
 * Returns the follow-up for `id`, or `undefined` when no such follow-up
 * exists.
 */
export function getFollowUp(db: Database.Database, id: string): FollowUp | undefined {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM follow_ups WHERE id = ?`)
    .get(id) as FollowUpRow | undefined
  return row ? toFollowUp(row) : undefined
}

/**
 * Lists follow-ups for a collaboration, optionally filtered by status and
 * paginated with `limit`/`offset`. Ordered by `dueAt` (earliest first)
 * then `id` for a stable result. Returns the page plus the total count.
 * Throws an `Error` when the collaboration does not exist or when `limit`,
 * `offset`, or `status` are not valid.
 */
export function listFollowUpsForCollaboration(
  db: Database.Database,
  collaborationId: string,
  filter: FollowUpFilter = {},
): FollowUpList {
  assertNonEmpty(collaborationId, 'collaborationId')
  if (getCollaboration(db, collaborationId) === undefined) {
    throw new Error(`collaboration not found: ${collaborationId}`)
  }

  const limit = filter.limit ?? DEFAULT_LIST_LIMIT
  const offset = filter.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer')
  }
  if (filter.status !== undefined) {
    assertStatus(filter.status)
  }

  const clauses: string[] = ['collaboration_id = ?']
  const params: (string | number)[] = [collaborationId]
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  const where = ` WHERE ${clauses.join(' AND ')}`

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM follow_ups${where}`)
    .get(...params) as { total: number }

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM follow_ups${where}
       ORDER BY due_at ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as FollowUpRow[]

  return { followUps: rows.map(toFollowUp), total }
}

/**
 * Transitions the follow-up's status. Throws an `Error` when the follow-up
 * does not exist, when the new status is not valid, or when the transition
 * is not allowed.
 */
export function updateFollowUpStatus(
  db: Database.Database,
  id: string,
  newStatus: FollowUpStatus,
): FollowUp {
  assertNonEmpty(id, 'id')
  assertStatus(newStatus)
  const existing = getFollowUp(db, id)
  if (existing === undefined) {
    throw new Error(`follow-up not found: ${id}`)
  }
  if (existing.status === newStatus) {
    return existing
  }
  if (!isValidFollowUpStatusTransition(existing.status, newStatus)) {
    throw new Error(`invalid status transition from ${existing.status} to ${newStatus}`)
  }
  db.prepare('UPDATE follow_ups SET status = @newStatus WHERE id = @id').run({
    id,
    newStatus,
  })
  return getFollowUp(db, id) as FollowUp
}

/**
 * Increments the follow-up's `attempts` by one. Throws an `Error` when the
 * follow-up does not exist.
 */
export function incrementFollowUpAttempts(
  db: Database.Database,
  id: string,
): FollowUp {
  assertNonEmpty(id, 'id')
  const existing = getFollowUp(db, id)
  if (existing === undefined) {
    throw new Error(`follow-up not found: ${id}`)
  }
  db.prepare('UPDATE follow_ups SET attempts = attempts + 1 WHERE id = @id').run({ id })
  return getFollowUp(db, id) as FollowUp
}
