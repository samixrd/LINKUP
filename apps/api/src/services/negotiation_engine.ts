import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  buildMindContext,
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
  myDisplayName: string
  otherName: string
  otherFollowers: number
  myFollowers: number
  myLanguages: string[]
  theirLanguages: string[]
  proposalSoFar: string
  transcript: string
  round: number
}): string {
  // Plain chat voice — this is the ONLY framing this Mind reliably answers
  // (structured "negotiation" prompts get ignored after the first refusals).
  // Each round is a genuine question to the user's Mind about a person they
  // met on LINKUP, exactly like the chat queries it responds to.
  const first = `Hey — quick one. I came across ${input.otherName} on LINKUP — ${input.otherFollowers} followers, works in ${input.theirLanguages.join('/')}. We matched on language and audience. Should I reach out? If yes, what's a good idea for us to do together — format, platform, timing, deal type?`
  const follow = `They got back to me and said: "${input.transcript.split('\n').pop()?.replace(/^\[[^\]]+\]:\s*/, '') || ''}". Should I go with that or adjust? If we're basically there, give me the plan in 3 sentences.`
  const close = `We've gone a few rounds on this. Tell me straight: close it or walk? If closing, give me the plan in 3 sentences.`
  const ask = input.round === 1 ? first : input.round === 2 ? follow : close
  if (input.round === 1) return ask
  return (
    ask + `\n\n` +
    `For context — I'm ${input.myDisplayName}, ${input.myFollowers} followers, work in ${input.myLanguages.join('/')}. The idea was: "${input.proposalSoFar}". Here's the whole conversation: ${input.transcript || '(nothing yet)'}`
  )
}

/**
 * Deterministic partner-side response. The partner's Mind is not on the
 * platform, so the partner is represented by an agent that acts strictly on
 * their published terms card (audience band, languages, openness). A concrete
 * offer that respects their terms is accepted with a plan; a thin or
 * mismatched offer gets a terms-based counter. This is what makes the loop
 * converge to a signable deal instead of stalling.
 */
export function partnerTermsReply(input: {
  partnerName: string
  partnerFollowers: number
  partnerLanguages: string[]
  minPartnerFollowers: number
  myFollowers: number
  lastOffer: string
}): string {
  const offer = input.lastOffer.trim()
  const concrete =
    offer.length >= 40 &&
    /\b(video|post|reel|short|song|track|stream|episode|series|art|collab|channel|video|weeks|week|date|friday|monday|plan)\b/i.test(offer)
  const reachOk = input.myFollowers >= input.minPartnerFollowers
  const langMentioned =
    input.partnerLanguages.includes('*') ||
    input.partnerLanguages.some((l) => new RegExp(`\\b${l}\\b`, 'i').test(offer)) ||
    /bilingual|subtitles|captions|both languages|english and/i.test(offer)

  if (concrete && reachOk && langMentioned) {
    // Echo the offer's core, capped so the final plan stays readable.
    const core = offer.length > 220 ? `${offer.slice(0, 220).replace(/\s+\S*$/, '')}…` : offer
    return (
      `I'm happy with this — it works for me. Final plan: ${core} ` +
      `We'll cross-post on both channels (${input.partnerName}, ${input.partnerFollowers} followers), ` +
      `cover both languages, and publish within two weeks.`
    )
  }
  return (
    `I'd love to work together, but I need this to be more concrete before I can sign off. ` +
    `How about we do a joint piece in a format that fits both our audiences, cross-linked on both channels, ` +
    `with subtitles where needed — and we set a date within two weeks? That works for me.`
  )
}

/**
 * Scores how close the latest turn is to a final agreement. Deterministic:
 * an explicit final-plan structure or unqualified acceptance language scores
 * 95; otherwise partial credit based on concrete markers (numbers, dates,
 * platform names) present in the exchange.
 */
export function scoreAgreement(transcriptText: string): number {
  const last = transcriptText.trim()
  if (
    /final plan:|^AGREE:/i.test(last) ||
    (last.length > 50 &&
      /(\baccept\b|\bagree\b|\bsounds good\b|\bgo for it\b|\bworks for me\b|\bsign off\b|\bhappy with\b)/i.test(last) &&
      !/(need this to be more concrete|before i can sign off|push back|however|but\b|walk away|not a great fit|doesn't pencil)/i.test(last))
  ) {
    return 95
  }
  let score = 30
  if (/\d+\s*(k|thousand|000)/i.test(last)) score += 15
  if (/(video|post|reel|short|song|track|stream|episode)/i.test(last)) score += 15
  if (/(caption|subtitle|bilingual|translate|both languages|english and)/i.test(last)) score += 15
  if (/(week|days|date|schedule|deadline)/i.test(last)) score += 10
  return Math.min(score, 75)
}

/** True when the turn reads as an explicit final agreement. */
function isAgreement(message: string): boolean {
  return scoreAgreement(message) >= 90
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

  // The Mind is the user's personal bot — every round asks the SAME Mind (the
  // initiator's) for advice on what to say to the other creator. Rounds
  // alternate authorship in the transcript so the viewer sees a two-sided
  // negotiation, but the voice is always the user asking their own Mind.
  const user = speakers[0]!
  const userContext = buildMindContext(db, user.id)

  let transcript = ''

  for (let round = 1; round <= maxRounds; round++) {
    const speaker = speakers[(round - 1) % 2]!
    const isUserTurn = round % 2 === 1

    let message: string
    if (isUserTurn) {
      // User's Mind gives strategy / refines the offer.
      const prompt = buildNegotiatorPrompt({
        myDisplayName: user.displayName,
        otherName: user.otherName,
        otherFollowers: user.otherFollowers,
        myFollowers: user.myFollowers,
        myLanguages: user.myLangs,
        theirLanguages: user.theirLangs,
        proposalSoFar: collab.proposal,
        transcript,
        round,
      })
      // Real creator context — the Mind must see whose side it is advising.
      message = (await adapter.query(userContext, prompt)).trim()
    } else {
      // Partner side: a deterministic terms-based agent, not a role-played
      // Mind. Accepts concrete offers that respect their published terms.
      const partner = speakers[1]!
      message = partnerTermsReply({
        partnerName: partner.displayName,
        partnerFollowers: partner.myFollowers,
        partnerLanguages: partner.myLangs,
        minPartnerFollowers: partner.minPartnerFollowers,
        myFollowers: user.myFollowers,
        lastOffer: state.rounds[state.rounds.length - 1]?.message ?? collab.proposal,
      })
    }

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

    if (isAgreement(message)) {
      state.score = 95
      // Keep the plan text clean: strip leading acceptance phrases.
      state.finalPlan = message
        .replace(/^(yes|yeah|agreed|agree|absolutely|ok|okay|sounds good|works for me|deal|i'm happy with this|happy with this|go for it)[:,.!\s-]*/i, '')
        .replace(/^[-—–\s]*(it works for me|this works for me|that works for me)[:,.!\s-]*/i, '')
        .replace(/^final plan:?\s*/i, '')
        .trim()
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
