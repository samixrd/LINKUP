import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  buildMindContext,
  createCollaboration,
  createMindInteraction,
  getCreatorProfile,
  type Collaboration,
  type CreatorMatch,
  type CreatorProfile,
  type MindAdapter,
  type MindContext,
} from '@linkup/db'

/**
 * Mind collaboration service. The Mind (the injected `MindAdapter`) selects a
 * compatible creator from the deterministic matching results and drafts a
 * collaboration proposal; a human must explicitly confirm before anything is
 * created.
 *
 * - `preview` is a dry run: it returns the selected target, compatibility
 *   score/shared terms, and the drafted proposal without writing anything.
 * - `execute` re-drafts the proposal from the current Mind context and creates
 *   the collaboration through the existing state machine, but only when the
 *   caller confirms with `confirm: true`. The proposal and the confirmation
 *   are recorded as Mind interactions so the creator's history stays
 *   continuous — no memories are ever written back automatically.
 *
 * The adapter is injected exactly like Phase 14's `createMindQueryService`:
 * the service never touches a provider directly and only ever hands it a
 * structured `MindContext` built by `buildMindContext` (creator-scoped, so
 * another creator's private memories are never exposed).
 */

/** Upper bound on a Mind-drafted proposal, in characters (abuse hardening). */
export const MAX_PROPOSAL_LENGTH = 10_000

/** A dry-run collaboration the Mind would propose, with why it matches. */
export interface MindCollaborationPreview {
  target: CreatorProfile
  /** Number of shared compatibility terms between the two creators. */
  score: number
  /** The normalized terms both creators share, sorted for a stable result. */
  sharedTerms: string[]
  /** The collaboration proposal drafted by the Mind. */
  proposal: string
}

export interface MindCollaborationPreviewOptions {
  /**
   * Draft for a specific compatible creator instead of the top-ranked match.
   * The target must be one of the creator's deterministic matches.
   */
  targetId?: string
}

export interface MindCollaborationExecuteOptions {
  /** The compatible creator to propose to. Must be a deterministic match. */
  targetId: string
  /**
   * Explicit human approval. The collaboration is created only when this is
   * exactly `true`.
   */
  confirm: boolean
}

export interface MindCollaborationService {
  preview(creatorId: string, options?: MindCollaborationPreviewOptions): Promise<MindCollaborationPreview>
  execute(creatorId: string, options: MindCollaborationExecuteOptions): Promise<Collaboration>
}

export interface MindCollaborationServiceOptions {
  db: Database.Database
  adapter: MindAdapter
}

export function createMindCollaborationService({
  db,
  adapter,
}: MindCollaborationServiceOptions): MindCollaborationService {
  return {
    async preview(creatorId: string, options: MindCollaborationPreviewOptions = {}): Promise<MindCollaborationPreview> {
      assertCreatorId(creatorId)
      // Validates existence via buildMindContext (throws creator profile not found)
      const context = buildMindContext(db, creatorId)
      const match = selectMatch(db, context, creatorId, options.targetId)
      const proposal = await draftProposal(adapter, context, match)
      return {
        target: match.creator,
        score: match.score,
        sharedTerms: match.sharedTerms,
        proposal,
      }
    },

    async execute(creatorId: string, options: MindCollaborationExecuteOptions): Promise<Collaboration> {
      assertCreatorId(creatorId)
      if (options.confirm !== true) {
        throw new Error('confirmation is required — set "confirm": true to create the collaboration')
      }
      const context = buildMindContext(db, creatorId)
      const match = selectMatch(db, context, creatorId, options.targetId)
      // Draft the proposal from the current context so the persisted history
      // reflects exactly what the collaboration says.
      const proposal = await draftProposal(adapter, context, match)

      // The collaboration and its history record are one unit: if the state
      // machine rejects the creation (e.g. a pending collaboration already
      // exists), the transaction rolls back and nothing is persisted.
      return db.transaction(() => {
        const collaboration = createCollaboration(db, {
          id: randomUUID(),
          initiatorId: creatorId,
          targetId: match.creator.creatorId,
          proposal,
        })
        createMindInteraction(db, {
          id: randomUUID(),
          creatorId,
          role: 'mind',
          content: `Proposed collaboration with ${match.creator.displayName} (${match.creator.creatorId}): ${proposal}`,
        })
        createMindInteraction(db, {
          id: randomUUID(),
          creatorId,
          role: 'user',
          content: `Confirmed collaboration with ${match.creator.displayName} (${match.creator.creatorId})`,
        })
        return collaboration
      })()
    },
  }
}

function assertCreatorId(creatorId: string): void {
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
}

/**
 * Picks the collaboration target. With no explicit `targetId`, the top-ranked
 * deterministic match is selected. An explicit target must exist, must not be
 * the creator itself, and must be one of the creator's compatible matches.
 */
function selectMatch(
  db: Database.Database,
  context: MindContext,
  creatorId: string,
  targetId: string | undefined,
): CreatorMatch {
  if (targetId === undefined) {
    const top = context.matches.matches[0]
    if (top === undefined) {
      throw new Error(`no compatible creators found for ${creatorId}`)
    }
    return top
  }
  if (typeof targetId !== 'string' || targetId.trim() === '') {
    throw new Error('targetId must be a non-empty string')
  }
  if (targetId === creatorId) {
    // Same message as the collaboration state machine, so clients see one
    // contract regardless of which endpoint they use.
    throw new Error('initiatorId and targetId must be different')
  }
  if (getCreatorProfile(db, targetId) === undefined) {
    throw new Error(`creator profile not found: ${targetId}`)
  }
  const match = context.matches.matches.find((m) => m.creator.creatorId === targetId)
  if (match === undefined) {
    throw new Error(`target ${targetId} is not a compatible match for ${creatorId}`)
  }
  return match
}

/**
 * Asks the Mind to draft a collaboration proposal for the selected target.
 * The instruction is a fixed template (no client-supplied text reaches it)
 * and directs the Mind to output only the proposal. A blank or over-long
 * reply is treated as an invalid adapter response.
 */
async function draftProposal(
  adapter: MindAdapter,
  context: MindContext,
  match: CreatorMatch,
): Promise<string> {
  const target = match.creator
  const instruction = [
    `Draft a collaboration proposal from ${singleLine(context.creator.displayName)} to ${singleLine(target.displayName)}.`,
    `They are a compatible match sharing these interests: ${match.sharedTerms.join(', ')}.`,
    'Describe one concrete collaboration the two creators could do together.',
    'Output only the proposal text — no greeting, no preamble, no markdown, no quotes.',
  ].join('\n')
  const reply = await adapter.query(context, instruction)
  const proposal = typeof reply === 'string' ? reply.trim() : ''
  if (proposal === '') {
    throw new Error('adapter returned an empty collaboration proposal')
  }
  if (proposal.length > MAX_PROPOSAL_LENGTH) {
    throw new Error('adapter returned an over-long collaboration proposal')
  }
  return proposal
}

/** Collapses whitespace/newlines in creator-supplied names for prompt safety. */
function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
