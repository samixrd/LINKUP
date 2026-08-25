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
  const targetId =
    collaboration.initiatorId === context.creator.creatorId ? collaboration.targetId : collaboration.initiatorId
  const targetName = targetProfile?.displayName ?? targetId
  lines.push(`Hey — I need your read on a negotiation I'm in with ${singleLine(targetName)}.`)
  if (context.creator.bio) lines.push(`Quick context on me: ${singleLine(context.creator.bio)}`)
  lines.push(`Here's the back-and-forth so far:`)
  if (history.length > 0) {
    for (const entry of history) {
      lines.push(`${entry.seq}. by ${singleLine(entry.authorId)}: "${singleLine(entry.proposal)}"`)
    }
  } else {
    lines.push(`1. by ${singleLine(collaboration.initiatorId)}: "${singleLine(collaboration.proposal)}"`)
    if (collaboration.counterProposal) {
      lines.push(`2. by ${singleLine(collaboration.proposedBy)}: "${singleLine(collaboration.counterProposal)}"`)
    }
  }
  lines.push(`The latest offer on the table: "${singleLine(collaboration.counterProposal ?? collaboration.proposal)}".`)
  lines.push(`Should I accept it, reject it, or counter it? Give me your honest take in a sentence or two,`)
  lines.push(`then reply with just a JSON object like: {"action": "accept"|"reject"|"counter", "reasoning": "your reasoning", "counterProposal": "only when action is counter"}`)
  return lines.join('\n')
}

function parseDecision(raw: string): MindNegotiationDecision {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed === '') {
    throw new Error('invalid decision format — empty response')
  }
  // The Mind sometimes adds a sentence before or after the JSON. Extract the
  // first {...} block before parsing; fall back to strict full-string parse.
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first === -1 || last === -1 || last <= first) {
      throw new Error('invalid decision format — not valid JSON')
    }
    try {
      parsed = JSON.parse(trimmed.slice(first, last + 1))
    } catch {
      throw new Error('invalid decision format — not valid JSON')
    }
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
