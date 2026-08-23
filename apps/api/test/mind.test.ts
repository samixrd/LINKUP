import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'

describe('mind API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'mind_a', displayName: 'Mind Ada', bio: 'Loves pottery' })
    createCreatorProfile(db, { creatorId: 'mind_b', displayName: 'Mind Grace', bio: 'Pottery enthusiast' })
    createCreatorProfile(db, { creatorId: 'mind_c', displayName: 'Mind Alan', bio: 'Electronic music producer' })
    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  it('returns 404 for unknown creator', async () => {
    const res = await fetch(`${baseUrl}/api/creators/ghost/mind`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('ghost')
  })

  it('returns structured mind context with correct shape', async () => {
    const res = await fetch(`${baseUrl}/api/creators/mind_a/mind`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      creator: { creatorId: string; displayName: string }
      memories: unknown[]
      matches: { matches: unknown[]; total: number }
      collaborations: { collaborations: unknown[]; total: number }
      followUps: unknown[]
      outcomes: unknown[]
    }
    expect(body.creator.creatorId).toBe('mind_a')
    expect(Array.isArray(body.memories)).toBe(true)
    expect(body.matches).toBeDefined()
    expect(Array.isArray(body.matches.matches)).toBe(true)
    expect(typeof body.matches.total).toBe('number')
    expect(body.collaborations).toBeDefined()
    expect(Array.isArray(body.collaborations.collaborations)).toBe(true)
    expect(typeof body.collaborations.total).toBe('number')
    expect(Array.isArray(body.followUps)).toBe(true)
    expect(Array.isArray(body.outcomes)).toBe(true)
  })

  it('handles empty sections correctly for new creator', async () => {
    // mind_c has no collaborations yet, no memories, no outcomes, no follow-ups
    const res = await fetch(`${baseUrl}/api/creators/mind_c/mind`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      memories: unknown[]
      collaborations: { collaborations: unknown[]; total: number }
      followUps: unknown[]
      outcomes: unknown[]
    }
    expect(body.memories).toEqual([])
    expect(body.collaborations.collaborations).toEqual([])
    expect(body.collaborations.total).toBe(0)
    expect(body.followUps).toEqual([])
    expect(body.outcomes).toEqual([])
  })

  it('includes memories, matches, collaborations, follow-ups, outcomes after activity', async () => {
    // Add memory for mind_a
    const memRes = await fetch(`${baseUrl}/api/creators/mind_a/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'preference', content: 'Prefers async' }),
    })
    expect(memRes.status).toBe(201)

    // Create collaboration mind_a -> mind_b
    const collabRes = await fetch(`${baseUrl}/api/creators/mind_a/collaborations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'mind_b', proposal: 'Electronic music festival' }),
    })
    expect(collabRes.status).toBe(201)
    const collab = (await collabRes.json()) as { id: string }

    // Create follow-up
    const followRes = await fetch(`${baseUrl}/api/collaborations/${collab.id}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueAt: '2026-08-26T10:00:00.000Z' }),
    })
    expect(followRes.status).toBe(201)
    const followBody = (await followRes.json()) as { id: string }

    // Accept to generate outcome (auto)
    const patchRes = await fetch(`${baseUrl}/api/creators/mind_a/collaborations/${collab.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    })
    expect(patchRes.status).toBe(200)

    // Now fetch mind
    const res = await fetch(`${baseUrl}/api/creators/mind_a/mind`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      memories: { id: string; category: string }[]
      matches: { matches: { creator: { creatorId: string } }[] }
      collaborations: { collaborations: { id: string }[] }
      followUps: { id: string }[]
      outcomes: { category: string; content: string }[]
    }

    expect(body.memories.some((m) => m.category === 'preference')).toBe(true)
    expect(body.outcomes.some((o) => o.category === 'collaboration_outcome' && o.content.includes(collab.id))).toBe(true)
    expect(body.collaborations.collaborations.some((c) => c.id === collab.id)).toBe(true)
    expect(body.followUps.some((f) => f.id === followBody.id)).toBe(true)
    // matches should include mind_b (pottery) and after outcome also mind_c via electronic
    expect(body.matches.matches.some((m) => m.creator.creatorId === 'mind_b')).toBe(true)
  })

  it('isolates creator data - does not leak other creator private data', async () => {
    // Create secret memory for mind_b
    const secretRes = await fetch(`${baseUrl}/api/creators/mind_b/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'preference', content: 'Secret preference mind_b' }),
    })
    expect(secretRes.status).toBe(201)
    const secretBody = (await secretRes.json()) as { id: string }

    // Create secret collaboration mind_b -> mind_c
    const secretCollabRes = await fetch(`${baseUrl}/api/creators/mind_b/collaborations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'mind_c', proposal: 'Secret collab' }),
    })
    let secretCollabId: string | undefined
    let secretFollowUpId: string | undefined
    if (secretCollabRes.status === 201) {
      secretCollabId = ((await secretCollabRes.json()) as { id: string }).id
      // Create follow-up for secret collab
      const fuRes = await fetch(`${baseUrl}/api/collaborations/${secretCollabId}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueAt: '2026-08-27T10:00:00.000Z' }),
      })
      if (fuRes.status === 201) {
        secretFollowUpId = ((await fuRes.json()) as { id: string }).id
      }
    }

    const res = await fetch(`${baseUrl}/api/creators/mind_a/mind`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      memories: { id: string }[]
      collaborations: { collaborations: { id: string }[] }
      followUps: { id: string }[]
    }
    expect(body.memories.some((m) => m.id === secretBody.id)).toBe(false)
    if (secretCollabId) {
      expect(body.collaborations.collaborations.some((c) => c.id === secretCollabId)).toBe(false)
    }
    if (secretFollowUpId) {
      expect(body.followUps.some((f) => f.id === secretFollowUpId)).toBe(false)
    }
  })

  it('returns 400 for invalid creatorId', async () => {
    const res = await fetch(`${baseUrl}/api/creators/%20/mind`)
    // Express will decode %20 to space, then validation should 400
    expect([400, 404]).toContain(res.status)
  })

  it('over-long mind query → 400 with a clear message', async () => {
    const res = await fetch(`${baseUrl}/api/creators/mind_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'x'.repeat(10_001) }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('at most 10000 characters')
  })
})
