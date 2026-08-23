import type Database from 'better-sqlite3'
import { getCreatorProfile } from './profiles.js'

/**
 * Open collaborations: a creator publishes their availability + terms
 * (follower band, minimum partner size, languages, topics). Two creators are
 * THRESHOLD-COMPATIBLE when each side's follower count satisfies the other's
 * minimum and they share at least one language ('*' = any). This is what lets
 * a 1M-follower creator openly accept a 100-follower creator — or demand
 * 900k+ — with the match decided by mutual terms, not popularity.
 */

export interface OpenCollab {
  creatorId: string
  openToCollab: boolean
  myFollowers: number
  minPartnerFollowers: number
  languages: string[]
  topics: string[]
  createdAt: string
  updatedAt: string
}

export interface NewOpenCollab {
  creatorId: string
  openToCollab: boolean
  myFollowers: number
  minPartnerFollowers: number
  languages?: string[]
  topics?: string[]
}

export interface ThresholdMatch {
  me: OpenCollab
  them: OpenCollab
  /** True when both sides' follower requirements are mutually satisfied. */
  sizeCompatible: boolean
  sharedLanguages: string[]
}

interface Row {
  creator_id: string
  open_to_collab: number
  my_followers: number
  min_partner_followers: number
  languages: string
  topics: string
  created_at: string
  updated_at: string
}

const SELECT_COLUMNS = `
  creator_id,
  open_to_collab,
  my_followers,
  min_partner_followers,
  languages,
  topics,
  created_at,
  updated_at
`

function toOpenCollab(row: Row): OpenCollab {
  return {
    creatorId: row.creator_id,
    openToCollab: row.open_to_collab === 1,
    myFollowers: row.my_followers,
    minPartnerFollowers: row.min_partner_followers,
    languages: row.languages.split(',').map((l) => l.trim()).filter((l) => l !== ''),
    topics: row.topics.split(',').map((t) => t.trim()).filter((t) => t !== ''),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assertCounts(input: NewOpenCollab): void {
  if (!Number.isInteger(input.myFollowers) || input.myFollowers < 0) {
    throw new Error('myFollowers must be a non-negative integer')
  }
  if (!Number.isInteger(input.minPartnerFollowers) || input.minPartnerFollowers < 0) {
    throw new Error('minPartnerFollowers must be a non-negative integer')
  }
  for (const lang of input.languages ?? []) {
    if (typeof lang !== 'string' || !/^[a-zA-Z*]{1,12}$/.test(lang)) {
      throw new Error('languages must be short codes like "en", "bn", or "*"')
    }
  }
}

/** Upserts the caller's open-collab card. */
export function setOpenCollab(db: Database.Database, input: NewOpenCollab): OpenCollab {
  if (typeof input.creatorId !== 'string' || input.creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
  if (getCreatorProfile(db, input.creatorId) === undefined) {
    throw new Error(`creator profile not found: ${input.creatorId}`)
  }
  assertCounts(input)
  const languages = (input.languages && input.languages.length > 0 ? input.languages : ['en'])
    .map((l) => l.toLowerCase())
    .join(',')
  const topics = (input.topics ?? []).join(',')

  db.prepare(
    `INSERT INTO open_collabs (creator_id, open_to_collab, my_followers, min_partner_followers, languages, topics)
     VALUES (@creatorId, @openToCollab, @myFollowers, @minPartnerFollowers, @languages, @topics)
     ON CONFLICT(creator_id) DO UPDATE SET
       open_to_collab = excluded.open_to_collab,
       my_followers = excluded.my_followers,
       min_partner_followers = excluded.min_partner_followers,
       languages = excluded.languages,
       topics = excluded.topics`,
  ).run({
    creatorId: input.creatorId,
    openToCollab: input.openToCollab ? 1 : 0,
    myFollowers: input.myFollowers,
    minPartnerFollowers: input.minPartnerFollowers,
    languages,
    topics,
  })
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM open_collabs WHERE creator_id = ?`)
    .get(input.creatorId) as Row
  return toOpenCollab(row)
}

export function getOpenCollab(db: Database.Database, creatorId: string): OpenCollab | undefined {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM open_collabs WHERE creator_id = ?`)
    .get(creatorId) as Row | undefined
  return row === undefined ? undefined : toOpenCollab(row)
}

/**
 * All creators currently open to collabs (excluding the caller), as cards.
 */
export function listOpenCollabs(db: Database.Database, excludeCreatorId: string): OpenCollab[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM open_collabs
       WHERE open_to_collab = 1 AND creator_id != ?
       ORDER BY my_followers DESC, creator_id ASC`,
    )
    .all(excludeCreatorId) as Row[]
  return rows.map(toOpenCollab)
}

function sharesLanguage(a: string[], b: string[]): string[] {
  if (a.includes('*') || b.includes('*')) {
    const concrete = [...a, ...b].filter((l) => l !== '*' && l !== '')
    // Wildcard matches everything; report the concrete overlap when present.
    const overlap = concrete.filter((l) => a.includes(l) && b.includes(l))
    return overlap.length > 0 ? overlap : ['*']
  }
  return a.filter((l) => b.includes(l))
}

/**
 * Evaluates threshold compatibility between two cards. Both directions must
 * pass: my followers >= their minimum AND their followers >= my minimum.
 */
export function evaluateThreshold(me: OpenCollab, them: OpenCollab): ThresholdMatch {
  const sizeCompatible =
    me.myFollowers >= them.minPartnerFollowers &&
    them.myFollowers >= me.minPartnerFollowers
  return {
    me,
    them,
    sizeCompatible,
    sharedLanguages: sharesLanguage(me.languages, them.languages),
  }
}

/**
 * Finds every open creator who is threshold-compatible with the caller:
 * mutual follower bands satisfied AND at least one shared language.
 * Ordered by combined reach descending for a stable feed.
 */
export function findThresholdMatches(
  db: Database.Database,
  creatorId: string,
): ThresholdMatch[] {
  const mine = getOpenCollab(db, creatorId)
  if (mine === undefined || !mine.openToCollab) return []
  const results: ThresholdMatch[] = []
  for (const theirs of listOpenCollabs(db, creatorId)) {
    const match = evaluateThreshold(mine, theirs)
    if (match.sizeCompatible && match.sharedLanguages.length > 0) {
      results.push(match)
    }
  }
  results.sort(
    (a, b) =>
      b.them.myFollowers + b.me.myFollowers - (a.them.myFollowers + a.me.myFollowers),
  )
  return results
}
