import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getCreatorProfile } from './profiles.js'

/** The allowed states for a collaboration. */
export const COLLABORATION_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
  'countered',
] as const

export type CollaborationStatus = (typeof COLLABORATION_STATUSES)[number]

/**
 * A collaboration between two creators. `id` is an opaque identifier
 * supplied at creation time; `initiatorId`/`targetId` are the two
 * participants; `status` is an explicit state machine; `proposal` holds
 * the original collaboration details; `counterProposal` holds the latest
 * counter-proposal (when the collaboration has been countered);
 * `proposedBy` is the creator who authored the latest proposal (initiator
 * for the original, the countering participant for each counter);
 * `createdAt`/`updatedAt` are managed by the database layer.
 */
export interface Collaboration {
  id: string
  initiatorId: string
  targetId: string
  status: CollaborationStatus
  proposal: string
  counterProposal: string | null
  proposedBy: string
  createdAt: string
  updatedAt: string
}

/** Fields that must/should be supplied when creating a collaboration. */
export interface NewCollaboration {
  id: string
  initiatorId: string
  targetId: string
  proposal: string
  status?: CollaborationStatus
}

/** Fields that can be updated on an existing collaboration. */
export interface CollaborationUpdates {
  proposal?: string
  status?: CollaborationStatus
}

/** Filter for `listCollaborationsForCreator`. Omitted fields are not applied. */
export interface CollaborationFilter {
  /** Filter by collaboration status. */
  status?: CollaborationStatus
  /** Maximum collaborations to return. Defaults to 50, capped at 100. */
  limit?: number
  /** Number of collaborations to skip. Defaults to 0. */
  offset?: number
}

/** A page of collaborations plus the total number of rows matching the filter. */
export interface CollaborationList {
  collaborations: Collaboration[]
  total: number
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

interface CollaborationRow {
  id: string
  initiator_id: string
  target_id: string
  status: CollaborationStatus
  proposal: string
  counter_proposal: string | null
  proposed_by: string | null
  created_at: string
  updated_at: string
}

const SELECT_COLUMNS = `
  id,
  initiator_id,
  target_id,
  status,
  proposal,
  counter_proposal,
  proposed_by,
  created_at,
  updated_at
`

function toCollaboration(row: CollaborationRow): Collaboration {
  return {
    id: row.id,
    initiatorId: row.initiator_id,
    targetId: row.target_id,
    status: row.status,
    proposal: row.proposal,
    counterProposal: row.counter_proposal,
    proposedBy: row.proposed_by ?? row.initiator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required and must be a non-empty string`)
  }
}

function assertStatus(value: string): asserts value is CollaborationStatus {
  if (!COLLABORATION_STATUSES.includes(value as CollaborationStatus)) {
    throw new Error(`status must be one of: ${COLLABORATION_STATUSES.join(', ')}`)
  }
}

/**
 * Returns true when a transition from `from` to `to` is allowed.
 * Terminal states (accepted, rejected, cancelled) have no outgoing
 * transitions. Pending and countered may move to any terminal state or
 * to countered (for negotiation).
 */
export function isValidCollaborationStatusTransition(
  from: CollaborationStatus,
  to: CollaborationStatus,
): boolean {
  const allowed: Record<CollaborationStatus, CollaborationStatus[]> = {
    pending: ['accepted', 'rejected', 'cancelled', 'countered'],
    countered: ['accepted', 'rejected', 'cancelled', 'countered'],
    accepted: [],
    rejected: [],
    cancelled: [],
  }
  return allowed[from].includes(to)
}

/**
 * Creates a collaboration between two existing creators. Throws an `Error`
 * when required fields are missing or invalid, when either creator does not
 * exist, when initiator and target are the same, when a collaboration with
 * the same `id` already exists (SQLite PRIMARY KEY constraint), or when an
 * active (pending) collaboration already exists between the two creators in
 * either direction.
 */
export function createCollaboration(
  db: Database.Database,
  collaboration: NewCollaboration,
): Collaboration {
  assertNonEmpty(collaboration.id, 'id')
  assertNonEmpty(collaboration.initiatorId, 'initiatorId')
  assertNonEmpty(collaboration.targetId, 'targetId')
  assertNonEmpty(collaboration.proposal, 'proposal')
  if (collaboration.initiatorId === collaboration.targetId) {
    throw new Error('initiatorId and targetId must be different')
  }
  if (collaboration.status !== undefined) {
    assertStatus(collaboration.status)
    if (collaboration.status !== 'pending') {
      throw new Error('collaboration must be created in pending status')
    }
  }
  if (getCreatorProfile(db, collaboration.initiatorId) === undefined) {
    throw new Error(`creator profile not found: ${collaboration.initiatorId}`)
  }
  if (getCreatorProfile(db, collaboration.targetId) === undefined) {
    throw new Error(`creator profile not found: ${collaboration.targetId}`)
  }

  const existing = db
    .prepare(
      `SELECT id FROM collaborations
       WHERE status IN ('pending', 'countered')
         AND ((initiator_id = ? AND target_id = ?) OR (initiator_id = ? AND target_id = ?))
       LIMIT 1`,
    )
    .get(
      collaboration.initiatorId,
      collaboration.targetId,
      collaboration.targetId,
      collaboration.initiatorId,
    ) as { id: string } | undefined
  if (existing !== undefined) {
    throw new Error(
      `active collaboration already exists between ${collaboration.initiatorId} and ${collaboration.targetId}`,
    )
  }

  const status: CollaborationStatus = collaboration.status ?? 'pending'
  db.prepare(
    `INSERT INTO collaborations (id, initiator_id, target_id, status, proposal, counter_proposal, proposed_by)
     VALUES (@id, @initiatorId, @targetId, @status, @proposal, NULL, @proposedBy)`,
  ).run({
    id: collaboration.id,
    initiatorId: collaboration.initiatorId,
    targetId: collaboration.targetId,
    status,
    proposal: collaboration.proposal,
    proposedBy: collaboration.initiatorId,
  })
  // Append-only history: seq=1 for the original proposal. Keep Phase 18 fields sync.
  // If the history table does not exist yet (pre-0009 DB), ignore.
  try {
    const nextSeq = (db
      .prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM collaboration_proposals WHERE collaboration_id = ?`)
      .get(collaboration.id) as { nextSeq: number }).nextSeq
    // For new collaborations nextSeq should be 1, but compute dynamically to be safe
    db.prepare(
      `INSERT INTO collaboration_proposals (id, collaboration_id, seq, author_id, proposal)
       VALUES (@id, @collaborationId, @seq, @authorId, @proposal)`,
    ).run({
      id: randomUUID(),
      collaborationId: collaboration.id,
      seq: nextSeq,
      authorId: collaboration.initiatorId,
      proposal: collaboration.proposal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('no such table')) throw err
  }
  return getCollaboration(db, collaboration.id) as Collaboration
}

/**
 * Returns the collaboration for `id`, or `undefined` when no such
 * collaboration exists.
 */
export function getCollaboration(
  db: Database.Database,
  id: string,
): Collaboration | undefined {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM collaborations WHERE id = ?`)
    .get(id) as CollaborationRow | undefined
  return row ? toCollaboration(row) : undefined
}

/**
 * Lists collaborations where `creatorId` is either initiator or target,
 * optionally filtered by status and paginated with `limit`/`offset`.
 * Ordered by `createdAt` (newest first) then `id` for a stable result.
 * Returns the page plus the total number of rows matching the filter.
 * Throws an `Error` when the creator does not exist or when `limit`,
 * `offset`, or `status` are not valid.
 */
export function listCollaborationsForCreator(
  db: Database.Database,
  creatorId: string,
  filter: CollaborationFilter = {},
): CollaborationList {
  assertNonEmpty(creatorId, 'creatorId')
  if (getCreatorProfile(db, creatorId) === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
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

  const clauses: string[] = ['(initiator_id = ? OR target_id = ?)']
  const params: (string | number)[] = [creatorId, creatorId]
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  const where = ` WHERE ${clauses.join(' AND ')}`

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM collaborations${where}`)
    .get(...params) as { total: number }

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM collaborations${where}
       ORDER BY created_at DESC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CollaborationRow[]

  return { collaborations: rows.map(toCollaboration), total }
}

/**
 * Transitions the collaboration's status. Throws an `Error` when the
 * collaboration does not exist, when the new status is not valid, or when
 * the transition is not allowed.
 */
export function updateCollaborationStatus(
  db: Database.Database,
  id: string,
  newStatus: CollaborationStatus,
): Collaboration {
  assertNonEmpty(id, 'id')
  assertStatus(newStatus)
  const existing = getCollaboration(db, id)
  if (existing === undefined) {
    throw new Error(`collaboration not found: ${id}`)
  }
  if (existing.status === newStatus) {
    return existing
  }
  if (!isValidCollaborationStatusTransition(existing.status, newStatus)) {
    throw new Error(`invalid status transition from ${existing.status} to ${newStatus}`)
  }
  db.prepare('UPDATE collaborations SET status = @newStatus WHERE id = @id').run({
    id,
    newStatus,
  })
  return getCollaboration(db, id) as Collaboration
}

/**
 * Updates the collaboration's proposal. Only allowed while the
 * collaboration is in `pending` status. Throws an `Error` when the
 * collaboration does not exist, when the proposal would be empty, or when
 * the status is not pending.
 */
export function updateCollaborationProposal(
  db: Database.Database,
  id: string,
  proposal: string,
): Collaboration {
  assertNonEmpty(id, 'id')
  assertNonEmpty(proposal, 'proposal')
  const existing = getCollaboration(db, id)
  if (existing === undefined) {
    throw new Error(`collaboration not found: ${id}`)
  }
  if (existing.status !== 'pending') {
    throw new Error(`cannot update proposal in status ${existing.status}`)
  }
  db.prepare('UPDATE collaborations SET proposal = @proposal WHERE id = @id').run({
    id,
    proposal,
  })
  return getCollaboration(db, id) as Collaboration
}

/**
 * Submits a counter-proposal for an existing collaboration.
 * Only allowed while the collaboration is in `pending` or `countered`
 * status (i.e., not terminal). Preserves the original `proposal`,
 * stores the latest counter in `counterProposal`, and tracks who
 * authored it in `proposedBy`. The status moves to `countered`.
 *
 * Throws an `Error` when the collaboration does not exist, when
 * `counterProposal` or `proposedBy` would be empty, when the
 * countering creator is not a participant, or when the status does
 * not allow a counter (terminal states). `proposedBy` must be an
 * existing creator profile.
 */
export function submitCounterProposal(
  db: Database.Database,
  id: string,
  counterProposal: string,
  proposedBy: string,
): Collaboration {
  assertNonEmpty(id, 'id')
  assertNonEmpty(counterProposal, 'counterProposal')
  assertNonEmpty(proposedBy, 'proposedBy')
  const existing = getCollaboration(db, id)
  if (existing === undefined) {
    throw new Error(`collaboration not found: ${id}`)
  }
  if (getCreatorProfile(db, proposedBy) === undefined) {
    throw new Error(`creator profile not found: ${proposedBy}`)
  }
  if (proposedBy !== existing.initiatorId && proposedBy !== existing.targetId) {
    throw new Error(`proposedBy must be a participant in the collaboration`)
  }
  if (existing.status === 'accepted' || existing.status === 'rejected' || existing.status === 'cancelled') {
    throw new Error(`invalid status transition from ${existing.status} to countered`)
  }
  if (!isValidCollaborationStatusTransition(existing.status, 'countered')) {
    // Covers any future invalid source; keeps error shape consistent
    throw new Error(`invalid status transition from ${existing.status} to countered`)
  }
  db.prepare(
    `UPDATE collaborations
     SET counter_proposal = @counterProposal,
         proposed_by = @proposedBy,
         status = 'countered'
     WHERE id = @id`,
  ).run({ id, counterProposal, proposedBy })
  // Append to history with next seq, keep Phase 18 fields synchronized
  try {
    const nextSeq = (db
      .prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM collaboration_proposals WHERE collaboration_id = ?`)
      .get(id) as { nextSeq: number }).nextSeq
    db.prepare(
      `INSERT INTO collaboration_proposals (id, collaboration_id, seq, author_id, proposal)
       VALUES (@id, @collaborationId, @seq, @authorId, @proposal)`,
    ).run({
      id: randomUUID(),
      collaborationId: id,
      seq: nextSeq,
      authorId: proposedBy,
      proposal: counterProposal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('no such table')) throw err
  }
  return getCollaboration(db, id) as Collaboration
}

export interface CollabEscrow {
  collaborationId: string
  amount: number
  currency: string
  status: 'locked' | 'submitted' | 'released' | 'disputed'
  disputeReason: string
  createdAt: string
  updatedAt: string
}

export interface CollabSubmission {
  id: string
  collaborationId: string
  creatorId: string
  deliverableUrl: string
  notes: string
  submittedAt: string
}

export function getCollabEscrow(db: Database.Database, collaborationId: string): CollabEscrow | null {
  try {
    const row = db
      .prepare('SELECT collaboration_id, amount, currency, status, dispute_reason, created_at, updated_at FROM collab_escrows WHERE collaboration_id = ?')
      .get(collaborationId) as { collaboration_id: string; amount: number; currency: string; status: string; dispute_reason: string; created_at: string; updated_at: string } | undefined
    if (!row) return null
    return {
      collaborationId: row.collaboration_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status as 'locked' | 'submitted' | 'released' | 'disputed',
      disputeReason: row.dispute_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function lockCollabEscrow(
  db: Database.Database,
  collaborationId: string,
  amount = 500,
  currency = 'USD',
): CollabEscrow {
  db.prepare(
    `INSERT INTO collab_escrows (collaboration_id, amount, currency, status)
     VALUES (?, ?, ?, 'locked')
     ON CONFLICT(collaboration_id) DO UPDATE SET
       amount = excluded.amount,
       currency = excluded.currency,
       status = 'locked',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(collaborationId, amount, currency)
  return getCollabEscrow(db, collaborationId)!
}

export function submitCollabDeliverable(
  db: Database.Database,
  collaborationId: string,
  creatorId: string,
  deliverableUrl: string,
  notes = '',
): { submission: CollabSubmission; escrow: CollabEscrow } {
  const collab = getCollaboration(db, collaborationId)
  if (!collab) throw new Error(`collaboration not found: ${collaborationId}`)
  if (collab.initiatorId !== creatorId && collab.targetId !== creatorId) {
    throw new Error('creator is not a participant in this collaboration')
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO collab_submissions (id, collaboration_id, creator_id, deliverable_url, notes)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, collaborationId, creatorId, deliverableUrl, notes)

  // Check how many distinct participants submitted
  const rows = db
    .prepare('SELECT DISTINCT creator_id FROM collab_submissions WHERE collaboration_id = ?')
    .all(collaborationId) as Array<{ creator_id: string }>
  
  const bothSubmitted = rows.length >= 2

  let escrow = getCollabEscrow(db, collaborationId)
  if (!escrow) {
    escrow = lockCollabEscrow(db, collaborationId)
  }

  if (bothSubmitted && escrow.status === 'locked') {
    // Auto-release when both sides have submitted deliverables
    db.prepare("UPDATE collab_escrows SET status = 'released', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE collaboration_id = ?")
      .run(collaborationId)
  } else if (!bothSubmitted && escrow.status === 'locked') {
    db.prepare("UPDATE collab_escrows SET status = 'submitted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE collaboration_id = ?")
      .run(collaborationId)
  }

  return {
    submission: {
      id,
      collaborationId,
      creatorId,
      deliverableUrl,
      notes,
      submittedAt: new Date().toISOString(),
    },
    escrow: getCollabEscrow(db, collaborationId)!,
  }
}

export function flagCollabDispute(
  db: Database.Database,
  collaborationId: string,
  creatorId: string,
  reason: string,
): CollabEscrow {
  const collab = getCollaboration(db, collaborationId)
  if (!collab) throw new Error(`collaboration not found: ${collaborationId}`)
  if (collab.initiatorId !== creatorId && collab.targetId !== creatorId) {
    throw new Error('creator is not a participant in this collaboration')
  }

  db.prepare(
    `UPDATE collab_escrows
     SET status = 'disputed', dispute_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE collaboration_id = ?`,
  ).run(reason, collaborationId)

  return getCollabEscrow(db, collaborationId)!
}

export function listCollabSubmissions(db: Database.Database, collaborationId: string): CollabSubmission[] {
  try {
    const rows = db
      .prepare('SELECT id, collaboration_id, creator_id, deliverable_url, notes, submitted_at FROM collab_submissions WHERE collaboration_id = ? ORDER BY submitted_at ASC')
      .all(collaborationId) as Array<{
        id: string
        collaboration_id: string
        creator_id: string
        deliverable_url: string
        notes: string
        submitted_at: string
      }>
    return rows.map((r) => ({
      id: r.id,
      collaborationId: r.collaboration_id,
      creatorId: r.creator_id,
      deliverableUrl: r.deliverable_url,
      notes: r.notes,
      submittedAt: r.submitted_at,
    }))
  } catch {
    return []
  }
}

