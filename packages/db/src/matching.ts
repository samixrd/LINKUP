import type Database from 'better-sqlite3'
import { getCreatorProfile } from './profiles.js'
import type { CreatorProfile } from './profiles.js'

/**
 * A potential collaboration partner and why they were matched. `score` is the
 * number of terms the partner's profile + memories share with the subject
 * creator; `sharedTerms` are those terms, sorted for a stable result.
 * `weightedScore` refines the raw count: rarer terms count for more
 * (smoothed inverse document frequency across the candidate pool) and shared
 * terms coming from high-signal memory categories (preference/goal) weigh
 * more than generic ones. Ranking uses `weightedScore`; `score` is kept for
 * explainability and API stability.
 */
export interface CreatorMatch {
  creator: CreatorProfile
  score: number
  weightedScore: number
  sharedTerms: string[]
}

/** A page of matches plus the total number of creators that matched. */
export interface CreatorMatchList {
  matches: CreatorMatch[]
  total: number
}

/** Options for `findCompatibleCreators`. Omitted fields use defaults. */
export interface CreatorMatchOptions {
  /** Maximum matches to return. Defaults to 50, capped at 100. */
  limit?: number
  /** Number of matches to skip. Defaults to 0. */
  offset?: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * Common function words that carry no compatibility signal. Kept small: the
 * minimum token length already drops most short words; these are the longer
 * words that would otherwise inflate every score.
 */
const STOPWORDS = new Set([
  'about',
  'above',
  'after',
  'again',
  'against',
  'also',
  'among',
  'and',
  'any',
  'are',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'can',
  'could',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'her',
  'here',
  'him',
  'his',
  'how',
  'into',
  'its',
  'just',
  'more',
  'most',
  'much',
  'not',
  'now',
  'off',
  'only',
  'other',
  'our',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'too',
  'under',
  'until',
  'very',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
])

interface ProfileRow {
  creator_id: string
  display_name: string
  bio: string
  avatar_url: string
  created_at: string
  updated_at: string
}

const PROFILE_COLUMNS = `
  creator_id,
  display_name,
  bio,
  avatar_url,
  created_at,
  updated_at
`

function toProfile(row: ProfileRow): CreatorProfile {
  return {
    creatorId: row.creator_id,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Normalizes a piece of text into a set of comparison terms: lowercased,
 * split on non-alphanumeric runs, with tokens shorter than 3 characters and
 * stopwords removed. Shared with the memory search so matching and search
 * tokenize identically.
 */
export function normalizeTerms(text: string): Set<string> {
  const terms = new Set<string>()
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length < 3 || STOPWORDS.has(token)) continue
    terms.add(token)
  }
  return terms
}

/** The union of `normalizeTerms` over the given texts. */
function termsFor(texts: string[]): Set<string> {
  const terms = new Set<string>()
  for (const text of texts) {
    for (const term of normalizeTerms(text)) {
      terms.add(term)
    }
  }
  return terms
}

/** The terms present in both sets, sorted for a stable result. */
function sharedTermsBetween(subject: Set<string>, candidate: Set<string>): string[] {
  const shared: string[] = []
  for (const term of subject) {
    if (candidate.has(term)) shared.push(term)
  }
  return shared.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * High-signal memory categories. A shared term sourced from one of these
 * counts more than one appearing only in bios or generic memories, because
 * preference/goal statements describe what a creator actively wants.
 */
const HIGH_SIGNAL_CATEGORIES = new Set(['preference', 'goal'])

interface WeightedMemory {
  content: string
  highSignal: boolean
}

/**
 * Computes smoothed IDF weights for the subject's terms across the candidate
 * pool: `log(1 + N / (1 + df))` where `df` is how many creators' term sets
 * contain the term. Terms everyone shares trend toward ~0; rare terms toward
 * `log(1 + N)`. Fully deterministic for a given database state.
 */
function idfWeights(subjectTerms: Set<string>, candidateTermSets: Array<Set<string>>): Map<string, number> {
  const n = candidateTermSets.length
  const weights = new Map<string, number>()
  for (const term of subjectTerms) {
    let df = 0
    for (const terms of candidateTermSets) {
      if (terms.has(term)) df += 1
    }
    weights.set(term, Math.log(1 + n / (1 + df)))
  }
  return weights
}

/** Rounds to 6 decimal places so equal inputs always compare exactly equal. */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Ranks every other creator by compatibility with the subject creator.
 * Compatibility has two layers:
 *
 * - `score` — the number of normalized terms the other creator's bio +
 *   memories share with the subject's bio + memories (kept from v1 for
 *   explainability and API stability).
 * - `weightedScore` — the ranking signal: each shared term is weighted by
 *   smoothed IDF (rare terms matter more than terms everyone shares) and a
 *   ×1.5 boost when the term also appears in either side's high-signal
 *   memories (preference/goal). Ranking uses this; only creators sharing at
 *   least one term are returned. Both scores are rounded, so ties are exact
 *   and deterministic.
 *
 * Ties are broken by displayName (case-insensitive), then creatorId, for a
 * stable result. Throws an `Error` when the subject creator does not exist or
 * when `limit` or `offset` are not valid.
 */
export function findCompatibleCreators(
  db: Database.Database,
  creatorId: string,
  options: CreatorMatchOptions = {},
): CreatorMatchList {
  const subject = getCreatorProfile(db, creatorId)
  if (subject === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
  }

  const limit = options.limit ?? DEFAULT_LIMIT
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer')
  }

  const profiles = db
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM creator_profiles`)
    .all() as ProfileRow[]

  // Learning loop: collaboration_outcome memories are included here so
  // terminal collaboration outcomes deterministically influence future
  // compatibility scores via their proposal/status terms.
  const memoryRows = db
    .prepare('SELECT creator_id, category, content FROM creator_memories')
    .all() as Array<{ creator_id: string; category: string; content: string }>

  const memoriesByCreator = new Map<string, WeightedMemory[]>()
  for (const memory of memoryRows) {
    const weighted: WeightedMemory = {
      content: memory.content,
      highSignal: HIGH_SIGNAL_CATEGORIES.has(memory.category),
    }
    const existing = memoriesByCreator.get(memory.creator_id)
    if (existing === undefined) {
      memoriesByCreator.set(memory.creator_id, [weighted])
    } else {
      existing.push(weighted)
    }
  }

  const subjectMemories = memoriesByCreator.get(creatorId) ?? []
  const subjectTerms = termsFor([subject.bio, ...subjectMemories.map((m) => m.content)])
  const subjectHighSignalTerms = termsFor(
    subjectMemories.filter((m) => m.highSignal).map((m) => m.content),
  )

  const candidateTermSets: Array<Set<string>> = []
  for (const profile of profiles) {
    if (profile.creator_id === creatorId) continue
    const memories = memoriesByCreator.get(profile.creator_id) ?? []
    candidateTermSets.push(
      termsFor([profile.bio, ...memories.map((m) => m.content)]),
    )
  }
  const weights = idfWeights(subjectTerms, candidateTermSets)

  const matches: CreatorMatch[] = []
  let candidateIndex = 0
  for (const profile of profiles) {
    if (profile.creator_id === creatorId) continue
    const candidateTerms = candidateTermSets[candidateIndex]
    candidateIndex += 1
    if (candidateTerms === undefined) continue
    const memories = memoriesByCreator.get(profile.creator_id) ?? []
    const candidateHighSignalTerms = termsFor(
      memories.filter((m) => m.highSignal).map((m) => m.content),
    )

    const shared = sharedTermsBetween(subjectTerms, candidateTerms)
    if (shared.length === 0) continue

    let weightedScore = 0
    for (const term of shared) {
      const weight = weights.get(term) ?? 0
      const boosted =
        subjectHighSignalTerms.has(term) || candidateHighSignalTerms.has(term)
          ? weight * 1.5
          : weight
      weightedScore += boosted
    }

    matches.push({
      creator: toProfile(profile),
      score: shared.length,
      weightedScore: round6(weightedScore),
      sharedTerms: shared,
    })
  }

  matches.sort((a, b) => {
    if (a.weightedScore !== b.weightedScore) return b.weightedScore - a.weightedScore
    if (a.score !== b.score) return b.score - a.score
    const nameA = a.creator.displayName.toLowerCase()
    const nameB = b.creator.displayName.toLowerCase()
    if (nameA !== nameB) return nameA < nameB ? -1 : 1
    if (a.creator.creatorId !== b.creator.creatorId) {
      return a.creator.creatorId < b.creator.creatorId ? -1 : 1
    }
    return 0
  })

  return { matches: matches.slice(offset, offset + limit), total: matches.length }
}
