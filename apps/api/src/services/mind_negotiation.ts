import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  buildMindContext,
  createMindInteraction,
  getCollaboration,
  submitCounterProposal,
  type Collaboration,
  type MindAdapter,
  type MindContext,
} from '@linkup/db'

/**
 * Mind negotiation service. The Mind drafts a counter-proposal for an
 * existing collaboration; a human must explicitly confirm before anything
 * is written. This keeps the negotiation two-sided but human-approved.
 *
 * - `previewCounter` is a dry run: it drafts a counter-proposal without
 *   persisting anything.
 * - `executeCounter` re-drafts from the current Mind context and persists
 *   via `submitCounterProposal`, recording history. It only runs when
 *   `confirm: true`.
 *
 * No autonomous acceptance/rejection is performed — the Mind only drafts
 * text; the creator approves.
 */

export const MAX_COUNTER_PROPOSAL_LENGTH = 10_000

export interface MindNegotiationPreview {
  collaborationId: string
  originalProposal: string
  currentProposal: string
  counterProposal: string | null
  proposedBy: string
  status: string
  /** The counter-proposal drafted by the Mind. */
  proposal: string
}

export interface MindNegotiationCounterOptions {
  confirm: boolean
}

export interface MindNegotiationService {
  previewCounter(creatorId: string, collaborationId: string): Promise<MindNegotiationPreview>
  executeCounter(
    creatorId: string,
    collaborationId: string,
    options: MindNegotiationCounterOptions,
  ): Promise<Collaboration>
}

export interface MindNegotiationServiceOptions {
  db: Database.Database
  adapter: MindAdapter
}

export function createMindNegotiationService({
  db,
  adapter,
}: MindNegotiationServiceOptions): MindNegotiationService {
  return {
    async previewCounter(creatorId: string, collaborationId: string): Promise<MindNegotiationPreview> {
      assertCreatorId(creatorId)
      assertCollaborationId(collaborationId)
      const collaboration = assertParticipant(db, creatorId, collaborationId)
      assertNegotiable(collaboration)
      const context = buildMindContext(db, creatorId)
      const proposal = await draftCounterProposal(adapter, context, collaboration)
      const currentProposal = collaboration.counterProposal ?? collaboration.proposal
      return {
        collaborationId: collaboration.id,
        originalProposal: collaboration.proposal,
        currentProposal,
        counterProposal: collaboration.counterProposal,
        proposedBy: collaboration.proposedBy,
        status: collaboration.status,
        proposal,
      }
    },

    async executeCounter(
      creatorId: string,
      collaborationId: string,
      options: MindNegotiationCounterOptions,
    ): Promise<Collaboration> {
      assertCreatorId(creatorId)
      assertCollaborationId(collaborationId)
      if (options.confirm !== true) {
        throw new Error('confirmation is required — set "confirm": true to submit the counter-proposal')
      }
      const collaboration = assertParticipant(db, creatorId, collaborationId)
      assertNegotiable(collaboration)
      const context = buildMindContext(db, creatorId)
      const proposal = await draftCounterProposal(adapter, context, collaboration)
      return db.transaction(() => {
        const updated = submitCounterProposal(db, collaborationId, proposal, creatorId)
        createMindInteraction(db, {
          id: randomUUID(),
          creatorId,
          role: 'mind',
          content: `Drafted counter-proposal for ${updated.id}: ${proposal}`,
        })
        createMindInteraction(db, {
          id: randomUUID(),
          creatorId,
          role: 'user',
          content: `Confirmed counter-proposal for ${updated.id}`,
        })
        return updated
      })()
    },
  }
}

function assertCreatorId(creatorId: string): void {
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
}

function assertCollaborationId(collaborationId: string): void {
  if (typeof collaborationId !== 'string' || collaborationId.trim() === '') {
    throw new Error('collaborationId is required and must be a non-empty string')
  }
}

function assertParticipant(
  db: Database.Database,
  creatorId: string,
  collaborationId: string,
): Collaboration {
  const collaboration = getCollaboration(db, collaborationId)
  if (collaboration === undefined) {
    throw new Error(`collaboration not found: ${collaborationId}`)
  }
  if (collaboration.initiatorId !== creatorId && collaboration.targetId !== creatorId) {
    // Keep isolation message similar to collaboration not found to avoid leaking existence
    throw new Error(`collaboration not found: ${collaborationId}`)
  }
  return collaboration
}

function assertNegotiable(collaboration: Collaboration): void {
  if (collaboration.status !== 'pending' && collaboration.status !== 'countered') {
    throw new Error(`cannot counter proposal in status ${collaboration.status}`)
  }
}

async function draftCounterProposal(
  adapter: MindAdapter,
  context: MindContext,
  collaboration: Collaboration,
): Promise<string> {
  const otherId =
    collaboration.initiatorId === context.creator.creatorId ? collaboration.targetId : collaboration.initiatorId
  const otherName = getOtherDisplayName(context, otherId)
  const currentProposal = collaboration.counterProposal ?? collaboration.proposal
  // Build ordered history from MindContext (which already aggregates via repository)
  let historyLines: string[] = []
  const ctxHistory = (context as unknown as { negotiationHistory?: Array<{ collaborationId: string; seq: number; authorId: string; proposal: string }> }).negotiationHistory
  const relevant = ctxHistory?.filter((h) => h.collaborationId === collaboration.id).sort((a, b) => a.seq - b.seq) ?? []
  if (relevant.length > 0) {
    historyLines = relevant.map((h) => `${h.seq}. by ${displayNameFor(context, h.authorId)}: "${singleLine(h.proposal)}"`)
  }
  // Fallback to single if historyLines empty
  if (historyLines.length === 0) {
    historyLines = [`1. by ${displayNameFor(context, collaboration.initiatorId)}: "${singleLine(collaboration.proposal)}"`]
    if (collaboration.counterProposal) {
      historyLines.push(`2. by ${displayNameFor(context, collaboration.proposedBy)}: "${singleLine(collaboration.counterProposal)}"`)
    }
  }
  const instruction = [
    `Hey — I'm working out a collab with ${otherName} and could use your read on it.`,
    `Here's the conversation so far:`,
    ...historyLines.map((h) => `- ${h}`),
    `The latest offer on the table: "${singleLine(currentProposal)}".`,
    `Should I accept this, or push back on something? If I push back, help me write my reply — one specific counter-proposal that moves things forward.`,
    `Write just what I'd send back.`,
  ]
    .filter((line) => line !== '')
    .join('\n')
  const reply = await adapter.query(context, instruction)
  const proposal = typeof reply === 'string' ? reply.trim() : ''
  if (proposal === '') {
    throw new Error('adapter returned an empty counter-proposal')
  }
  if (proposal.length > MAX_COUNTER_PROPOSAL_LENGTH) {
    throw new Error('adapter returned an over-long counter-proposal')
  }
  return proposal
}

/** Resolves a creator's display name from the context's matches when possible. */
function getOtherDisplayName(
  context: MindContext,
  otherId: string,
): string {
  const match = context.matches.matches.find((m) => m.creator.creatorId === otherId)
  return match?.creator.displayName ?? otherId
}

/** Resolves a display name for a history author, falling back to the raw ID. */
function displayNameFor(context: MindContext, id: string): string {
  const match = context.matches.matches.find((m) => m.creator.creatorId === id)
  if (match) return match.creator.displayName
  return id === context.creator.creatorId ? context.creator.displayName : id
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
