import type Database from 'better-sqlite3'
import { getCreatorProfile } from './profiles.js'
import { listCreatorMemories, searchCreatorMemories } from './memories.js'
import { findCompatibleCreators } from './matching.js'
import { listCollaborationsForCreator } from './collaborations.js'
import { listFollowUpsForCollaboration } from './follow_ups.js'
import { listCollaborationProposals } from './collaboration_proposals.js'
import type { CreatorProfile } from './profiles.js'
import type { CreatorMemory } from './memories.js'
import type { CreatorMatchList } from './matching.js'
import type { CollaborationList } from './collaborations.js'
import type { FollowUp } from './follow_ups.js'
import type { CollaborationProposal } from './collaboration_proposals.js'

/**
 * Structured, deterministic context for a creator's Mind. Aggregates
 * existing data without redesigning the backend; intended as the
 * single input to a future Minds/AI adapter.
 */
export interface MindContext {
  creator: CreatorProfile
  memories: CreatorMemory[]
  matches: CreatorMatchList
  collaborations: CollaborationList
  followUps: FollowUp[]
  outcomes: CreatorMemory[]
  /** Ordered negotiation history across all of the creator's collaborations. */
  negotiationHistory: CollaborationProposal[]
  /**
   * Present only when the caller opted into a memory search via
   * `MindContextOptions.memorySearch`; carries the ranked results.
   */
  memorySearch?: MindMemorySearch
}

/**
 * Results of an opt-in semantic memory search attached to a Mind context.
 * `query` is the trimmed search query the results were produced for.
 */
export interface MindMemorySearch {
  query: string
  memories: CreatorMemory[]
  total: number
}

/** Options for `buildMindContext`. Omitted fields use defaults. */
export interface MindContextOptions {
  /**
   * When provided as a non-blank string, runs the deterministic memory
   * search over the creator's own memories and attaches the results as
   * `memorySearch`. A blank or absent value leaves `memorySearch` unset.
   */
  memorySearch?: string
}

/**
 * Builds a Mind context for `creatorId` from existing data. Pure and
 * deterministic: same DB state → same context. Throws
 * `creator profile not found: <id>` when the creator does not exist.
 *
 * - memories: all memories for the creator (ordered by createdAt, id)
 * - matches: compatible creators via existing matching (default limit 50)
 * - collaborations: collaborations where creator is initiator or target (newest first)
 * - followUps: pending follow-ups for those collaborations (ordered by dueAt)
 * - outcomes: memories with category `collaboration_outcome` for the creator
 * - memorySearch: only when `options.memorySearch` is a non-blank string —
 *   the deterministic search results for that query over the creator's own
 *   memories (see `MindMemorySearch`)
 */
export function buildMindContext(
  db: Database.Database,
  creatorId: string,
  options: MindContextOptions = {},
): MindContext {
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
  const creator = getCreatorProfile(db, creatorId)
  if (creator === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
  }

  const memories = listCreatorMemories(db, { creatorId })
  const matches = findCompatibleCreators(db, creatorId)
  const collaborations = listCollaborationsForCreator(db, creatorId)

  // Collect pending follow-ups for each collaboration; keep deterministic order by dueAt
  const followUps: FollowUp[] = []
  for (const collab of collaborations.collaborations) {
    const list = listFollowUpsForCollaboration(db, collab.id, { status: 'pending' })
    for (const fu of list.followUps) {
      followUps.push(fu)
    }
  }
  // Deterministic global sort by dueAt asc then id
  followUps.sort((a, b) => {
    if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const outcomes = memories.filter((m) => m.category === 'collaboration_outcome')

  // Collect negotiation history across all collaborations, ordered deterministically.
  // If the collaboration_proposals table does not exist yet (pre-0009 DB), leave empty.
  const negotiationHistory: CollaborationProposal[] = []
  for (const collab of collaborations.collaborations) {
    try {
      const proposals = listCollaborationProposals(db, collab.id)
      for (const p of proposals) negotiationHistory.push(p)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('no such table')) throw err
    }
  }
  // Global deterministic sort: collaborationId ASC, seq ASC, id ASC (seq already ordered per collaboration, but global sort ensures stable)
  negotiationHistory.sort((a, b) => {
    if (a.collaborationId !== b.collaborationId) return a.collaborationId < b.collaborationId ? -1 : 1
    if (a.seq !== b.seq) return a.seq - b.seq
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const context: MindContext = {
    creator,
    memories,
    matches,
    collaborations,
    followUps,
    outcomes,
    negotiationHistory,
  }

  if (options.memorySearch !== undefined && options.memorySearch.trim() !== '') {
    const searchQuery = options.memorySearch.trim()
    const result = searchCreatorMemories(db, creatorId, searchQuery)
    context.memorySearch = {
      query: searchQuery,
      memories: result.memories,
      total: result.total,
    }
  }

  return context
}

/**
 * Adapter boundary for future Minds/AI integration.
 * No SDK is present in this repo; this interface accepts the structured
 * MindContext rather than querying the DB directly, keeping the future
 * provider decoupled.
 *
 * When a Minds SDK is added, implement this interface in
 * `apps/api/src/services/mind_adapter.ts` and inject it.
 */
export interface MindAdapter {
  /**
   * Future: send the structured MindContext to the Minds provider.
   * Currently not implemented — throws if called.
   */
  query(context: MindContext, input: string): Promise<string>
}

/**
 * Stub adapter — clean boundary, no external call.
 * Throws `Minds adapter not configured` until a real SDK is integrated.
 */
export const stubMindAdapter: MindAdapter = {
  async query(): Promise<string> {
    throw new Error('Minds adapter not configured — no SDK present')
  },
}
