import type Database from 'better-sqlite3'
import { getCollaboration } from './collaborations.js'
import { getCreatorProfile } from './profiles.js'
import { addCreatorMemory, getCreatorMemory } from './memories.js'
import type { CreatorMemory } from './memories.js'

const TERMINAL_STATUSES = new Set(['accepted', 'rejected', 'cancelled'])

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Deterministic memory id for a collaboration outcome.
 * Includes collaboration id and creator id to avoid duplicate outcome
 * memories when the same terminal state is processed repeatedly.
 */
export function collaborationOutcomeMemoryId(collaborationId: string, creatorId: string): string {
  return `outcome:${collaborationId}:${creatorId}`
}

/**
 * Deterministic, explainable content for a collaboration outcome memory.
 * Includes collaboration id, outcome status, the other participant's name,
 * and the original proposal so the learning signal is traceable and the
 * resulting terms influence future matching.
 */
export function collaborationOutcomeContent(
  collaboration: { id: string; proposal: string; status: string },
  otherDisplayName: string,
  otherCreatorId: string,
): string {
  return `Collaboration ${collaboration.id} ${collaboration.status} with ${otherDisplayName} (${otherCreatorId}): ${collaboration.proposal}`
}

/**
 * Records a `collaboration_outcome` memory for each participant when the
 * collaboration is in a terminal state (accepted, rejected, cancelled).
 * The memories are deterministic (fixed id and content) and idempotent:
 * calling this repeatedly for the same terminal collaboration does not
 * create duplicate memories.
 *
 * Throws an Error when the collaboration does not exist (`collaboration not
 * found: <id>`) or when it is not yet terminal (`collaboration is not in a
 * terminal state: <status>`).
 *
 * Returns the outcome memories that exist for this collaboration (newly
 * created or previously existing), ordered by creatorId for stability.
 */
export function recordCollaborationOutcome(
  db: Database.Database,
  collaborationId: string,
): CreatorMemory[] {
  if (typeof collaborationId !== 'string' || collaborationId.trim() === '') {
    throw new Error('collaborationId is required and must be a non-empty string')
  }
  const collaboration = getCollaboration(db, collaborationId)
  if (collaboration === undefined) {
    throw new Error(`collaboration not found: ${collaborationId}`)
  }
  if (!isTerminalStatus(collaboration.status)) {
    throw new Error(`collaboration is not in a terminal state: ${collaboration.status}`)
  }

  const initiator = getCreatorProfile(db, collaboration.initiatorId)
  const target = getCreatorProfile(db, collaboration.targetId)
  // Profiles must exist due to FK, but guard defensively
  if (initiator === undefined || target === undefined) {
    throw new Error('creator profile not found for collaboration participants')
  }

  const participants: Array<{ creatorId: string; otherName: string; otherId: string }> = [
    { creatorId: initiator.creatorId, otherName: target.displayName, otherId: target.creatorId },
    { creatorId: target.creatorId, otherName: initiator.displayName, otherId: initiator.creatorId },
  ]

  const result: CreatorMemory[] = []
  for (const p of participants) {
    const memoryId = collaborationOutcomeMemoryId(collaborationId, p.creatorId)
    const existing = getCreatorMemory(db, memoryId)
    if (existing !== undefined) {
      result.push(existing)
      continue
    }
    const content = collaborationOutcomeContent(
      { id: collaboration.id, proposal: collaboration.proposal, status: collaboration.status },
      p.otherName,
      p.otherId,
    )
    try {
      const created = addCreatorMemory(db, {
        id: memoryId,
        creatorId: p.creatorId,
        category: 'collaboration_outcome',
        content,
      })
      result.push(created)
    } catch (err) {
      // Handle race / duplicate id idempotently: return existing if constraint
      if (isSqliteConstraintError(err)) {
        const again = getCreatorMemory(db, memoryId)
        if (again !== undefined) {
          result.push(again)
          continue
        }
      }
      throw err
    }
  }

  // Ensure deterministic order
  result.sort((a, b) => (a.creatorId < b.creatorId ? -1 : a.creatorId > b.creatorId ? 1 : 0))
  return result
}

function isSqliteConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as Error & { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')
}
