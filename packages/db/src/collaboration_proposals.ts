import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getCreatorProfile } from './profiles.js'
import { getCollaboration } from './collaborations.js'

export interface CollaborationProposal {
  id: string
  collaborationId: string
  seq: number
  authorId: string
  proposal: string
  createdAt: string
}

export interface NewCollaborationProposal {
  id: string
  collaborationId: string
  authorId: string
  proposal: string
}

export interface CollaborationProposalRow {
  id: string
  collaboration_id: string
  seq: number
  author_id: string
  proposal: string
  created_at: string
}

const SELECT_COLUMNS = `
  id,
  collaboration_id,
  seq,
  author_id,
  proposal,
  created_at
`

function toProposal(row: CollaborationProposalRow): CollaborationProposal {
  return {
    id: row.id,
    collaborationId: row.collaboration_id,
    seq: row.seq,
    authorId: row.author_id,
    proposal: row.proposal,
    createdAt: row.created_at,
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required and must be a non-empty string`)
  }
}

/**
 * Creates a proposal history entry for a collaboration.
 * Validates that the collaboration exists, that the author is a participant,
 * that the proposal is non-empty, and that the collaboration is not terminal.
 * Sequence is assigned deterministically as MAX(seq)+1 for the collaboration
 * to keep the history append-only and ordered.
 * Throws `collaboration not found`, `creator profile not found`,
 * `proposedBy must be a participant`, `cannot append proposal in status X`,
 * or SQLite constraint errors for duplicate id.
 */
export function createCollaborationProposal(
  db: Database.Database,
  proposal: NewCollaborationProposal,
): CollaborationProposal {
  assertNonEmpty(proposal.id, 'id')
  assertNonEmpty(proposal.collaborationId, 'collaborationId')
  assertNonEmpty(proposal.authorId, 'authorId')
  assertNonEmpty(proposal.proposal, 'proposal')

  const collaboration = getCollaboration(db, proposal.collaborationId)
  if (collaboration === undefined) {
    throw new Error(`collaboration not found: ${proposal.collaborationId}`)
  }
  if (getCreatorProfile(db, proposal.authorId) === undefined) {
    throw new Error(`creator profile not found: ${proposal.authorId}`)
  }
  if (proposal.authorId !== collaboration.initiatorId && proposal.authorId !== collaboration.targetId) {
    throw new Error(`authorId must be a participant in the collaboration`)
  }
  if (
    collaboration.status === 'accepted' ||
    collaboration.status === 'rejected' ||
    collaboration.status === 'cancelled'
  ) {
    throw new Error(`cannot append proposal in status ${collaboration.status}`)
  }

  // Determine next seq atomically within the caller transaction if any;
  // here we compute it directly. Callers that need atomicity should wrap
  // this in a transaction with the collaboration update.
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM collaboration_proposals WHERE collaboration_id = ?`,
    )
    .get(proposal.collaborationId) as { nextSeq: number }
  const nextSeq = row.nextSeq

  db.prepare(
    `INSERT INTO collaboration_proposals (id, collaboration_id, seq, author_id, proposal)
     VALUES (@id, @collaborationId, @seq, @authorId, @proposal)`,
  ).run({
    id: proposal.id,
    collaborationId: proposal.collaborationId,
    seq: nextSeq,
    authorId: proposal.authorId,
    proposal: proposal.proposal,
  })

  return getCollaborationProposal(db, proposal.id) as CollaborationProposal
}

/**
 * Returns the proposal for `id`, or `undefined` when no such proposal exists.
 */
export function getCollaborationProposal(
  db: Database.Database,
  id: string,
): CollaborationProposal | undefined {
  assertNonEmpty(id, 'id')
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM collaboration_proposals WHERE id = ?`)
    .get(id) as CollaborationProposalRow | undefined
  return row ? toProposal(row) : undefined
}

/**
 * Lists proposals for a collaboration, ordered deterministically by `seq ASC, id ASC`.
 * Throws `collaboration not found` when the collaboration does not exist.
 */
export function listCollaborationProposals(
  db: Database.Database,
  collaborationId: string,
): CollaborationProposal[] {
  assertNonEmpty(collaborationId, 'collaborationId')
  const collaboration = getCollaboration(db, collaborationId)
  if (collaboration === undefined) {
    throw new Error(`collaboration not found: ${collaborationId}`)
  }
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM collaboration_proposals
       WHERE collaboration_id = ?
       ORDER BY seq ASC, id ASC`,
    )
    .all(collaborationId) as CollaborationProposalRow[]
  return rows.map(toProposal)
}

/**
 * Helper to create a history entry with an auto-generated id when the caller
 * does not need to control the id (e.g. from `createCollaboration` and
 * `submitCounterProposal`). Returns the created proposal.
 */
export function appendCollaborationProposal(
  db: Database.Database,
  collaborationId: string,
  authorId: string,
  proposal: string,
): CollaborationProposal {
  return createCollaborationProposal(db, {
    id: randomUUID(),
    collaborationId,
    authorId,
    proposal,
  })
}
