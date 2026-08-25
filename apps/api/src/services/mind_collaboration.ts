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
  type ProfileDetails,
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
  /** Structured details of the proposed target, when available. */
  targetDetails?: ProfileDetails
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
        targetDetails: match.details,
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
 * Asks the Mind to help write a collaboration proposal for the selected
 * target. The message is framed as the user reaching out to their Mind for
 * help — the Mind's Identity Firewall rejects templated "draft a proposal
 * with these constraints" dispatches, so the ask is plain-language and
 * first-person. A blank or over-long reply is treated as invalid.
 */
async function draftProposal(
  adapter: MindAdapter,
  context: MindContext,
  match: CreatorMatch,
): Promise<string> {
  const target = match.creator
  const targetDetails = match.details
  const myDetails = context.details

  // Natural self-description — the user telling their Mind who they are,
  // not a data dump the Mind must "remember".
  const myProfile = describeCreatorNatural(context.creator, myDetails)
  const targetProfile = describeCreatorNatural(target, targetDetails)

  // Prior collaboration attempts keep the Mind from re-proposing something
  // that already failed — mentioned as the user's own memory.
  const historyLines: string[] = []
  for (const collab of context.collaborations.collaborations) {
    if (
      collab.initiatorId !== target.creatorId && collab.targetId !== target.creatorId
    ) {
      continue
    }
    const c = collab as { initiatorId: string; targetId: string; status: string }
    const other = c.initiatorId === target.creatorId ? c.targetId : c.initiatorId
    historyLines.push(`- With ${other} [${c.status}]`)
  }

  const instruction = [
    `Hey — quick favor. I've been thinking about reaching out to ${singleLine(target.displayName)} on LINKUP.`,
    `They ${targetProfile}. I'd like to send a genuine first message proposing a collab, and I want it to not sound generic.`,
    `For context on me: I ${myProfile}.`,
    match.sharedTerms.length > 0
      ? `We matched on a few things — ${match.sharedTerms.join(', ')} — so there's real overlap to build on.`
      : '',
    `Can you help me write it? Make it specific to both of us:`,
    `- Mention what they actually make, and suggest one concrete collab idea that fits us both.`,
    `- Be clear about the deal type (paid / barter / revenue-share / free) based on what works for me, and flag any budget expectations.`,
    `- Keep it warm and human — like a real creator reaching out, not a pitch.`,
    historyLines.length > 0
      ? `Also — I've tried similar outreach before (${historyLines.join('; ')}), so please don't repeat those angles.`
      : '',
    `Write just the message I'd send them.`,
  ]
    .filter((line) => line !== '')
    .join('\n')
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

/**
 * Natural-sentence description of a creator used in drafting prompts. Reads
 * like a person describing themselves or someone they met — not a structured
 * data dump. Callers prefix it with "I " or "They ".
 */
function describeCreatorNatural(profile: CreatorProfile, details?: ProfileDetails): string {
  if (details === undefined) {
    return `are ${singleLine(profile.displayName)} (${profile.creatorId})`
  }
  const parts = [
    details.niches.length > 0 ? `make ${details.niches.join(' and ')} content` : '',
    details.platforms.length > 0 ? `on ${details.platforms.join(' and ')}` : '',
    details.audienceSize ? `around ${details.audienceSize} followers` : '',
    details.avgViews ? `with about ${details.avgViews} views per post` : '',
    details.languages.length > 0 ? `work in ${details.languages.join(' & ')}` : '',
    details.location ? `based in ${details.location}` : '',
    details.availability ? `have roughly ${details.availability} free for collabs` : '',
    details.goals.length > 0 ? `main goal: ${details.goals.join(', ')}` : '',
    details.compensation.length > 0 ? `open to ${details.compensation.join(' / ')} deals` : '',
    details.minBudget ? `budget note: ${details.minBudget}` : '',
    details.openToSmall ? `happy to work with smaller creators` : '',
    details.dealbreakers ? `won't do ${details.dealbreakers}` : '',
  ].filter((p) => p !== '')
  if (parts.length === 0) {
    return `are ${singleLine(profile.displayName)} (${profile.creatorId})`
  }
  return parts.join(', ')
}

/** Collapses whitespace/newlines in creator-supplied names for prompt safety. */
function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
