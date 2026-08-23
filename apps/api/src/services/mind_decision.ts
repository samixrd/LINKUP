import type Database from 'better-sqlite3'
import {
  buildMindContext,
  getCollaboration,
  getCreatorProfile,
  listCollaborationProposals,
  type Collaboration,
  type MindAdapter,
  type MindContext,
} from '@linkup/db'

export const MAX_COUNTER_PROPOSAL_LENGTH = 10_000
export const MAX_REASONING_LENGTH = 5_000

export type DecisionAction = 'accept' | 'reject' | 'counter'

export interface MindNegotiationDecision {
  action: DecisionAction
  reasoning: string
  counterProposal?: string
}

export interface MindDecisionService {
  decide(creatorId: string, collaborationId: string): Promise<MindNegotiationDecision>
}

export interface MindDecisionServiceOptions {
  db: Database.Database
  adapter: MindAdapter
}

export function createMindDecisionService({
  db,
  adapter,
}: MindDecisionServiceOptions): MindDecisionService {
  return {
    async decide(creatorId: string, collaborationId: string): Promise<MindNegotiationDecision> {
      assertCreatorId(creatorId)
      assertCollaborationId(collaborationId)
      const collaboration = assertParticipant(db, creatorId, collaborationId)
      // No mutation - read-only decision. Allow any non-terminal status; even terminal we can still decide? But spec says decision should be for active negotiation.
      // We allow decision for pending/countered; if terminal, we still return decision but it will be based on history.
      // However we should not throw for terminal, just let Mind decide.
      const context = buildMindContext(db, creatorId)
      const history = (() => {
        try {
          return listCollaborationProposals(db, collaborationId)
        } catch {
          return []
        }
      })()

      const targetId =
        collaboration.initiatorId === creatorId ? collaboration.targetId : collaboration.initiatorId
      const targetProfile = getCreatorProfile(db, targetId)

      const prompt = buildDecisionPrompt(context, collaboration, history, targetProfile)
      const raw = await adapter.query(context, prompt)
      const decision = parseDecision(raw)
      return decision
    },
  }
}

function assertCreatorId(creatorId: string): void {
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
}

function assertCollaborationId(id: string): void {
  if (typeof id !== 'string' || id.trim() === '') {
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
    throw new Error(`collaboration not found: ${collaborationId}`)
  }
  return collaboration
}

function buildDecisionPrompt(
  context: MindContext,
  collaboration: Collaboration,
  history: Array<{ seq: number; authorId: string; proposal: string }>,
  targetProfile: ReturnType<typeof getCreatorProfile>,
): string {
  const lines: string[] = []
  lines.push(`You are the Mind for ${singleLine(context.creator.displayName)} (${context.creator.creatorId}).`)
  if (context.creator.bio) lines.push(`Creator bio: ${singleLine(context.creator.bio)}`)
  if (targetProfile) {
    lines.push(`Target creator: ${singleLine(targetProfile.displayName)} (${targetProfile.creatorId})`)
    if (targetProfile.bio) lines.push(`Target bio: ${singleLine(targetProfile.bio)}`)
  } else {
    lines.push(`Target creator: ${collaboration.initiatorId === context.creator.creatorId ? collaboration.targetId : collaboration.initiatorId}`)
  }
  // Include matches relevant to target if available
  const targetMatch = context.matches.matches.find(
    (m) => m.creator.creatorId === (collaboration.initiatorId === context.creator.creatorId ? collaboration.targetId : collaboration.initiatorId),
  )
  if (targetMatch) {
    lines.push(`Shared terms with target: ${targetMatch.sharedTerms.join(', ') || 'none'}`)
  }
  lines.push(`Collaboration id: ${collaboration.id}`)
  lines.push(`Status: ${collaboration.status}`)
  if (history.length > 0) {
    lines.push(`Full negotiation history (ordered by seq):`)
    for (const entry of history) {
      lines.push(`${entry.seq}. by ${entry.authorId}: "${singleLine(entry.proposal)}"`)
    }
  } else {
    lines.push(`Negotiation history: 1. by ${collaboration.initiatorId}: "${singleLine(collaboration.proposal)}"`)
    if (collaboration.counterProposal) {
      lines.push(`2. by ${collaboration.proposedBy}: "${singleLine(collaboration.counterProposal)}"`)
    }
  }
  lines.push(`Original proposal: "${singleLine(collaboration.proposal)}"`)
  const currentProposal = collaboration.counterProposal ?? collaboration.proposal
  lines.push(`Current proposal: "${singleLine(currentProposal)}"`)
  lines.push(`Current proposed by: ${collaboration.proposedBy}`)
  lines.push(`\nTask: Analyze the collaboration and the full negotiation history above.`)
  lines.push(`Decide whether to accept the current proposal, reject it, or propose a counter.`)
  lines.push(`You MUST output ONLY a JSON object with this exact shape, no markdown, no extra text, no preamble:`)
  lines.push(`{"action": "accept"|"reject"|"counter", "reasoning": "string (1-5000 chars)", "counterProposal": "string (required if action is counter)"}`)
  lines.push(`Constraints:`)
  lines.push(`- action must be exactly one of accept, reject, counter`)
  lines.push(`- reasoning must be a non-empty string (trimmed, 1-5000 chars)`)
  lines.push(`- if action is counter, counterProposal must be a non-empty string (trimmed, 1-10000 chars)`)
  lines.push(`- if action is accept or reject, counterProposal must be omitted`)
  lines.push(`- Output ONLY the JSON object.`)
  return lines.join('\n')
}

function parseDecision(raw: string): MindNegotiationDecision {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed === '') {
    throw new Error('invalid decision format — empty response')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Try to extract JSON object if Mind added extra whitespace or newlines but still JSON
    // Do not try to be overly permissive; strict JSON required.
    throw new Error('invalid decision format — not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid decision format — expected JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const action = obj.action
  if (action !== 'accept' && action !== 'reject' && action !== 'counter') {
    throw new Error('invalid action — must be one of: accept, reject, counter')
  }
  const reasoningRaw = obj.reasoning
  if (typeof reasoningRaw !== 'string' || reasoningRaw.trim() === '') {
    throw new Error('reasoning is required and must be a non-empty string')
  }
  const reasoning = reasoningRaw.trim()
  if (reasoning.length > MAX_REASONING_LENGTH) {
    throw new Error(`reasoning must be at most ${MAX_REASONING_LENGTH} characters`)
  }

  // Never trust arbitrary fields - only allow action, reasoning, counterProposal
  if (action === 'counter') {
    const cpRaw = obj.counterProposal
    if (typeof cpRaw !== 'string' || cpRaw.trim() === '') {
      throw new Error('counterProposal is required and must be a non-empty string when action is counter')
    }
    const counterProposal = cpRaw.trim()
    if (counterProposal.length > MAX_COUNTER_PROPOSAL_LENGTH) {
      throw new Error(`counterProposal must be at most ${MAX_COUNTER_PROPOSAL_LENGTH} characters`)
    }
    return { action, reasoning, counterProposal }
  } else {
    // accept/reject must not have counterProposal, but if present we ignore it (never trust arbitrary fields)
    // However if counterProposal is present and non-empty, we treat as error? Spec says counter requires, but for accept/reject it should be omitted.
    // We will ignore extra fields but also ensure not to require it.
    return { action, reasoning }
  }
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
