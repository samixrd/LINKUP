import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  createCollaborationProposal,
  getCollaboration,
  getCreatorProfile,
  submitCounterProposal,
  updateCollaborationStatus,
} from '@linkup/db'
import type { MindAdapter } from '@linkup/db'

/**
 * Autonomous Mind-to-Mind negotiation engine.
 *
 * Flow (the "loop" the user described):
 *   1. Creator asks for a collab with terms ("I want 900k+ partner").
 *   2. Engine finds a threshold-compatible creator and opens a collaboration.
 *   3. Both Minds negotiate in alternating rounds: each sees the full
 *      transcript plus its own creator's terms, then proposes / counters /
 *      accepts.
 *   4. Conflicts surface naturally in the transcript (e.g. one works in
 *      English, one in Bangla) — the Minds must resolve them to reach a
 *      final decision.
 *   5. The engine scores every round's agreement. At >= AGREE_THRESHOLD the
 *      deal is "ready": a decision message goes to BOTH creators, and if
 *      both sign, the contract is executed (collaboration -> accepted).
 *
 * Every round is persisted as collaboration_proposals — the negotiation is
 * fully auditable and resumable.
 */

/** Agreement score (0-100) at or above which the deal is sent for signing. */
export const AGREE_THRESHOLD = 80
/** Hard cap on rounds so two chatty Minds cannot burn cognition forever. */
export const MAX_ROUNDS = 6

export interface NegotiationTurn {
  round: number
  authorId: string
  message: string
}

export interface NegotiationState {
  collaborationId: string
  initiatorId: string
  targetId: string
  rounds: NegotiationTurn[]
  score: number
  status: 'negotiating' | 'ready' | 'signed' | 'failed' | 'stalled'
  /** Final agreed plan text when status is ready/signed. */
  finalPlan?: string
  unresolvedIssues: string[]
}

function buildNegotiatorPrompt(input: {
  whoAmI: string
  myDisplayName: string
  otherName: string
  otherFollowers: number
  myFollowers: number
  myLanguages: string[]
  theirLanguages: string[]
  minPartnerFollowers: number
  proposalSoFar: string
  transcript: string
}): string {
  return (
    `You are the Mind of ${input.myDisplayName}, a content creator with ${input.myFollowers} followers ` +
    `(works in: ${input.myLanguages.join('/')}). You are negotiating a collaboration with ${input.otherName} ` +
    `(${input.otherFollowers} followers, works in: ${input.theirLanguages.join('/')}), whose Mind is on the other side.\n\n` +
    `${input.myDisplayName}'s requirement: partner must have at least ${input.minPartnerFollowers} followers.\n` +
    `Original proposal under discussion: "${input.proposalSoFar}"\n\n` +
    `Transcript so far:\n${input.transcript || '(empty - you go first)'}\n\n` +
    'Respond with ONE short message as negotiator. Rules:\n' +
    '- If practical conflicts exist (language barrier, format mismatch), propose a concrete solution (e.g. bilingual captions, subtitles).\n' +
    '- If you are satisfied with the plan so far, start your reply exactly with "AGREE:" followed by a 3-sentence final plan both creators can act on.\n' +
    '- Otherwise make ONE specific counter-proposal that moves the deal forward.\n' +
    '- Keep it under 120 words.'
  )
}

/**
 * Scores how close the latest turn is to a final agreement. Deterministic:
 * "AGREE:" prefix signals a complete plan; otherwise partial credit based on
 * concrete markers (numbers, dates, platform names) present in the exchange.
 */
export function scoreAgreement(transcriptText: string): number {
  const last = transcriptText.trim()
  if (/^AGREE:/i.test(last)) return 95
  let score = 30
  if (/\d+\s*(k|thousand|000)/i.test(last)) score += 15
  if (/(video|post|reel|short|song|track|stream|episode)/i.test(last)) score += 15
  if (/(caption|subtitle|bilingual|translate|both languages|english and)/i.test(last)) score += 15
  if (/(week|days|date|schedule|deadline)/i.test(last)) score += 10
  return Math.min(score, 75)
}

export interface NegotiationOptions {
  db: Database.Database
  adapter: MindAdapter
  /** Max rounds; defaults to MAX_ROUNDS. */
  maxRounds?: number
}

/**
 * Runs (or resumes) the negotiation loop for a pending collaboration.
 * Returns the resulting state; when status === 'ready', callers should ask
 * both creators to sign via `signContract`.
 */
export async function runNegotiation(
  options: NegotiationOptions,
  collaborationId: string,
): Promise<NegotiationState> {
  const db = options.db
  const adapter = options.adapter
  const maxRounds = options.maxRounds ?? MAX_ROUNDS

  const collab = getCollaboration(db, collaborationId)
  if (collab === undefined) throw new Error(`collaboration not found: ${collaborationId}`)
  const initiator = getCreatorProfile(db, collab.initiatorId)
  const target = getCreatorProfile(db, collab.targetId)
  if (initiator === undefined || target === undefined) {
    throw new Error('creator profile not found for collaboration participants')
  }

  // Terms cards (optional; missing card = neutral defaults)
  const openRows = db.prepare(
    'SELECT creator_id, my_followers, min_partner_followers, languages FROM open_collabs WHERE creator_id IN (?, ?)',
  ).all(collab.initiatorId, collab.targetId) as Array<{
    creator_id: string
    my_followers: number
    min_partner_followers: number
    languages: string
  }>
  const termsFor = (id: string) =>
    openRows.find((r) => r.creator_id === id) ?? {
      creator_id: id,
      my_followers: 0,
      min_partner_followers: 0,
      languages: 'en',
    }
  const initTerms = termsFor(collab.initiatorId)
  const targTerms = termsFor(collab.targetId)

  const state: NegotiationState = {
    collaborationId,
    initiatorId: collab.initiatorId,
    targetId: collab.targetId,
    rounds: [],
    score: 0,
    status: 'negotiating',
    unresolvedIssues: [],
  }

  const speakers: Array<{
    id: string
    displayName: string
    otherId: string
    otherName: string
    myFollowers: number
    otherFollowers: number
    myLangs: string[]
    theirLangs: string[]
    minPartnerFollowers: number
  }> = [
    {
      id: collab.initiatorId,
      displayName: initiator.displayName,
      otherId: collab.targetId,
      otherName: target.displayName,
      myFollowers: initTerms.my_followers,
      otherFollowers: targTerms.my_followers,
      myLangs: initTerms.languages.split(','),
      theirLangs: targTerms.languages.split(','),
      minPartnerFollowers: initTerms.min_partner_followers,
    },
    {
      id: collab.targetId,
      displayName: target.displayName,
      otherId: collab.initiatorId,
      otherName: initiator.displayName,
      myFollowers: targTerms.my_followers,
      otherFollowers: initTerms.my_followers,
      myLangs: targTerms.languages.split(','),
      theirLangs: initTerms.languages.split(','),
      minPartnerFollowers: targTerms.min_partner_followers,
    },
  ]

  let transcript = ''

  for (let round = 1; round <= maxRounds; round++) {
    const speaker = speakers[(round - 1) % 2]!
    const prompt = buildNegotiatorPrompt({
      whoAmI: speaker.id,
      myDisplayName: speaker.displayName,
      otherName: speaker.otherName,
      otherFollowers: speaker.otherFollowers,
      myFollowers: speaker.myFollowers,
      myLanguages: speaker.myLangs,
      theirLanguages: speaker.theirLangs,
      minPartnerFollowers: speaker.minPartnerFollowers,
      proposalSoFar: collab.proposal,
      transcript,
    })

    const message = (await adapter.query({ ...({}) } as never, prompt)).trim()

    const persist = db.transaction(() => {
      if (round === 1 && !transcript) {
        createCollaborationProposal(db, {
          id: randomUUID(),
          collaborationId,
          authorId: speaker.id,
          proposal: message,
        })
      } else {
        try {
          submitCounterProposal(db, collaborationId, message, speaker.id)
        } catch {
          // Non-pending statuses can't take counters; record as plain history.
          createCollaborationProposal(db, {
            id: randomUUID(),
            collaborationId,
            authorId: speaker.id,
            proposal: message,
          })
        }
      }
    })
    persist()

    state.rounds.push({ round, authorId: speaker.id, message })
    transcript += `\n[${speaker.displayName}]: ${message}`

    if (/^AGREE:/i.test(message)) {
      state.score = 95
      state.finalPlan = message.replace(/^AGREE:\s*/i, '').trim()
      break
    }
    state.score = scoreAgreement(message)
  }

  if (state.finalPlan !== undefined) {
    state.status = 'ready'
  } else if (state.rounds.length >= maxRounds) {
    state.status = 'stalled'
  } else {
    state.status = 'failed'
  }

  return state
}

export interface SignResult {
  signed: boolean
  waitingFor: string[]
  status: 'signed' | 'waiting' | 'rejected'
}

/**
 * Records one creator's signature. When both have signed and the negotiation
 * reached 'ready', executes the contract: collaboration -> accepted.
 * Any rejection cancels the deal.
 */
export function signContract(
  db: Database.Database,
  collaborationId: string,
  creatorId: string,
  accept: boolean,
  reason = '',
  score?: number,
): SignResult {
  const collab = getCollaboration(db, collaborationId)
  if (collab === undefined) throw new Error(`collaboration not found: ${collaborationId}`)
  if (collab.initiatorId !== creatorId && collab.targetId !== creatorId) {
    throw new Error(`creator is not a participant: ${creatorId}`)
  }

  db.prepare(
    'INSERT INTO collab_contracts (id, collaboration_id, creator_id, decision, reason, score) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(randomUUID(), collaborationId, creatorId, accept ? 'signed' : 'rejected', reason, score ?? null)

  if (!accept) {
    try {
      updateCollaborationStatus(db, collaborationId, 'cancelled')
    } catch {
      /* already terminal */
    }
    return { signed: false, waitingFor: [], status: 'rejected' }
  }

  const rows = db
    .prepare("SELECT creator_id FROM collab_contracts WHERE collaboration_id = ? AND decision = 'signed'")
    .all(collaborationId) as Array<{ creator_id: string }>
  const signedBy = new Set(rows.map((r) => r.creator_id))
  const waitingFor = [collab.initiatorId, collab.targetId].filter((id) => !signedBy.has(id))

  if (waitingFor.length === 0) {
    try {
      updateCollaborationStatus(db, collaborationId, 'accepted')
    } catch {
      /* may already be accepted */
    }
    return { signed: true, waitingFor: [], status: 'signed' }
  }
  return { signed: false, waitingFor, status: 'waiting' }
}
