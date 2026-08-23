import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  listFollowUpsForCollaboration,
  migrate,
  stubMindAdapter,
  updateCollaborationStatus,
} from '@linkup/db'
import { createApp } from '../src/app.js'

function testApp() {
  const db: Database.Database = createDatabase(':memory:')
  migrate(db)
  const app = createApp({ db, mindAdapter: stubMindAdapter })
  return { app, db }
}

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as { port: number }
  return `http://127.0.0.1:${port}`
}

async function seedAccepted(db: Database.Database): Promise<void> {
  createCreatorProfile(db, { creatorId: 'ga', displayName: 'GA' })
  createCreatorProfile(db, { creatorId: 'gb', displayName: 'GB' })
  createCollaboration(db, { id: 'g1', initiatorId: 'ga', targetId: 'gb', proposal: 'Collab x' })
  updateCollaborationStatus(db, 'g1', 'accepted')
}

describe('growth outcome API', () => {
  it('records metrics, returns summary, and persists growth memory', async () => {
    const { app, db } = testApp()
    await seedAccepted(db)
    const baseUrl = await listen(app)

    const res = await fetch(`${baseUrl}/api/creators/ga/collaborations/g1/growth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metrics: [
          { metric: 'followers', valueBefore: 1000, valueAfter: 1150 },
          { metric: 'views', valueBefore: 20000, valueAfter: 26000 },
        ],
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      recorded: unknown[]
      summary: { metrics: Array<{ metric: string; delta: number }>; totalDelta: number }
    }
    expect(body.recorded).toHaveLength(2)
    expect(body.summary.metrics.find((m) => m.metric === 'followers')?.delta).toBe(150)
    expect(body.summary.totalDelta).toBe(6150)

    // Per-collaboration listing
    const listRes = await fetch(`${baseUrl}/api/creators/ga/collaborations/g1/growth`)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { outcomes: unknown[] }
    expect(list.outcomes).toHaveLength(2)

    // Creator summary endpoint
    const summaryRes = await fetch(`${baseUrl}/api/creators/ga/growth/summary`)
    expect(summaryRes.status).toBe(200)
    const summary = (await summaryRes.json()) as { totalDelta: number }
    expect(summary.totalDelta).toBe(6150)

    // Growth memory persisted for the learning loop
    const memoriesRes = await fetch(`${baseUrl}/api/creators/ga/memories?category=collaboration_outcome`)
    const memories = (await memoriesRes.json()) as { memories: Array<{ content: string }> }
    expect(memories.memories.some((m) => m.content.includes('grew by 150'))).toBe(true)
    db.close()
  })

  it('rejects non-participants with 400 and unknown collabs with 404', async () => {
    const { app, db } = testApp()
    await seedAccepted(db)
    const baseUrl = await listen(app)

    const forbidden = await fetch(`${baseUrl}/api/creators/gb/collaborations/g1/growth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metric: 'followers', valueBefore: 1, valueAfter: 2 }),
    })
    // gb IS a participant — should succeed
    expect(forbidden.status).toBe(201)

    const missing = await fetch(`${baseUrl}/api/creators/ga/collaborations/nope/growth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metric: 'followers', valueBefore: 1, valueAfter: 2 }),
    })
    expect(missing.status).toBe(404)

    const bad = await fetch(`${baseUrl}/api/creators/ga/collaborations/g1/growth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metric: 'followers', valueBefore: -5, valueAfter: 2 }),
    })
    expect(bad.status).toBe(400)
    db.close()
  })

  it('auto-schedules a follow-up when a collaboration is accepted', async () => {
    const { app, db } = testApp()
    createCreatorProfile(db, { creatorId: 'sa', displayName: 'SA' })
    createCreatorProfile(db, { creatorId: 'sb', displayName: 'SB' })
    createCollaboration(db, { id: 's1', initiatorId: 'sa', targetId: 'sb', proposal: 'Collab' })
    const baseUrl = await listen(app)

    const patch = await fetch(`${baseUrl}/api/creators/sa/collaborations/s1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    })
    expect(patch.status).toBe(200)

    // Exactly one follow-up was scheduled autonomously.
    const followUps = listFollowUpsForCollaboration(db, 's1')
    expect(followUps.total).toBe(1)
    expect(followUps.followUps[0]?.status).toBe('pending')

    // PATCHing again (idempotent path) must not double-schedule.
    await fetch(`${baseUrl}/api/creators/sa/collaborations/s1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    })
    expect(listFollowUpsForCollaboration(db, 's1').total).toBe(1)
    db.close()
  })
})
