import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createCreatorProfile,
  createDatabase,
  getCollaboration,
  getOpenCollab,
  migrate,
  setOpenCollab,
} from '@linkup/db'
import { createApp } from '../src/app.js'

/**
 * Fake adapter that plays a scripted negotiation. Each call returns the next
 * scripted line; when the script runs out it agrees (AGREE: ...), so tests
 * always terminate with a ready deal.
 */
function scriptedAdapter(lines: string[]) {
  let i = 0
  return {
    async query(): Promise<string> {
      const line = i < lines.length ? lines[i]! : 'AGREE: Final bilingual video plan agreed by both sides.'
      i += 1
      return line
    },
  }
}

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as { port: number }
  return `http://127.0.0.1:${port}`
}

function seedPair(db: Database.Database) {
  createCreatorProfile(db, { creatorId: 'u_big', displayName: 'BigStar' })
  createCreatorProfile(db, { creatorId: 'u_small', displayName: 'SmallFish' })
  setOpenCollab(db, {
    creatorId: 'u_big',
    openToCollab: true,
    myFollowers: 1_000_000,
    minPartnerFollowers: 100,
    languages: ['en'],
  })
  setOpenCollab(db, {
    creatorId: 'u_small',
    openToCollab: true,
    myFollowers: 100,
    minPartnerFollowers: 0,
    languages: ['en'],
  })
}

describe('open collab negotiation API', () => {
  it('runs the Mind-vs-Mind loop, reaches agreement, and both sign -> accepted', async () => {
    const db: Database.Database = createDatabase(':memory:')
    migrate(db)
    seedPair(db)
    // Round 1 raises a conflict; round 2 resolves it and agrees.
    const adapter = scriptedAdapter([
      'I work only in English but you seem Bangla-first — proposal: I post the main video, you add Bangla subtitles.',
      'AGREE: Main video in English on my channel, Bangla-subtitled mirror on yours, cross-linked, next Friday.',
    ])
    const app = createApp({ db, mindAdapter: adapter as never })
    const baseUrl = await listen(app)

    // Threshold matches should include u_big for u_small
    const matchRes = await fetch(`${baseUrl}/api/open-collabs/u_small/matches`)
    const matches = (await matchRes.json()) as { total: number }
    expect(matches.total).toBe(1)

    // Start negotiation
    const negRes = await fetch(`${baseUrl}/api/open-collabs/negotiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorId: 'u_small', targetId: 'u_big', proposal: 'Cross-promo collab' }),
    })
    expect(negRes.status).toBe(201)
    const neg = (await negRes.json()) as {
      collaborationId: string
      status: string
      rounds: Array<{ authorId: string; message: string }>
      score: number
      finalPlan?: string
      readyForSigning: boolean
    }
    expect(neg.status).toBe('ready')
    expect(neg.rounds.length).toBe(2)
    expect(neg.readyForSigning).toBe(true)
    expect(neg.finalPlan).toContain('Bangla')

    // First signature -> waiting for the other side
    const sign1 = await fetch(`${baseUrl}/api/open-collabs/${neg.collaborationId}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorId: 'u_small', accept: true }),
    })
    const s1 = (await sign1.json()) as { status: string; waitingFor: string[] }
    expect(s1.status).toBe('waiting')
    expect(s1.waitingFor).toEqual(['u_big'])

    // Second signature -> contract executed, collaboration accepted
    const sign2 = await fetch(`${baseUrl}/api/open-collabs/${neg.collaborationId}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorId: 'u_big', accept: true }),
    })
    const s2 = (await sign2.json()) as { status: string; collaborationStatus: string }
    expect(s2.status).toBe('signed')
    expect(s2.collaborationStatus).toBe('accepted')
    expect(getCollaboration(db, neg.collaborationId)?.status).toBe('accepted')
    db.close()
  })

  it('a rejection by either side cancels the deal', async () => {
    const db: Database.Database = createDatabase(':memory:')
    migrate(db)
    seedPair(db)
    const app = createApp({ db, mindAdapter: scriptedAdapter([]) as never })
    const baseUrl = await listen(app)

    const negRes = await fetch(`${baseUrl}/api/open-collabs/negotiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorId: 'u_big', targetId: 'u_small' }),
    })
    const neg = (await negRes.json()) as { collaborationId: string }

    const reject = await fetch(`${baseUrl}/api/open-collabs/${neg.collaborationId}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorId: 'u_small', accept: false, reason: 'schedule conflict' }),
    })
    const result = (await reject.json()) as { status: string; collaborationStatus: string }
    expect(result.status).toBe('rejected')
    expect(result.collaborationStatus).toBe('cancelled')
    db.close()
  })

  it('blocks negotiation when thresholds do not mutually pass', async () => {
    const db: Database.Database = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'u_picky', displayName: 'Picky' })
    createCreatorProfile(db, { creatorId: 'u_small2', displayName: 'Tiny' })
    setOpenCollab(db, { creatorId: 'u_picky', openToCollab: true, myFollowers: 900_000, minPartnerFollowers: 900_000, languages: ['en'] })
    setOpenCollab(db, { creatorId: 'u_small2', openToCollab: true, myFollowers: 50, minPartnerFollowers: 0, languages: ['en'] })

    const app = createApp({ db, mindAdapter: scriptedAdapter([]) as never })
    const baseUrl = await listen(app)

    const res = await fetch(`${baseUrl}/api/open-collabs/negotiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorId: 'u_small2', targetId: 'u_picky' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('threshold mismatch')
    db.close()
  })

  it('publishes and updates terms cards via PUT', async () => {
    const db: Database.Database = createDatabase(':memory:')
    migrate(db)
    seedPair(db)
    const app = createApp({ db, mindAdapter: scriptedAdapter([]) as never })
    const baseUrl = await listen(app)

    const put = await fetch(`${baseUrl}/api/open-collabs/u_big`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        openToCollab: true,
        myFollowers: 1_200_000,
        minPartnerFollowers: 500,
        languages: ['en', 'bn'],
        topics: ['music'],
      }),
    })
    expect(put.status).toBe(200)
    const card = (await put.json()) as { myFollowers: number; languages: string[] }
    expect(card.myFollowers).toBe(1_200_000)
    expect(card.languages).toContain('bn')
    expect(getOpenCollab(db, 'u_big')?.minPartnerFollowers).toBe(500)
    db.close()
  })
})
