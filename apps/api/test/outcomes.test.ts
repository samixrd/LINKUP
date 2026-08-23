import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'

describe('learning loop - outcomes API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string
  let collabId: string
  let pendingCollabId: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'outcome_a', displayName: 'Outcome Ada' })
    createCreatorProfile(db, { creatorId: 'outcome_b', displayName: 'Outcome Grace' })
    createCreatorProfile(db, { creatorId: 'outcome_c', displayName: 'Outcome Alan' })
    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    // Create a pending collaboration for outcome tests
    const res = await fetch(`${baseUrl}/api/creators/outcome_a/collaborations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'outcome_b', proposal: 'Outcome proposal electronic music' }),
    })
    const body = (await res.json()) as { id: string }
    collabId = body.id

    // Create another pending for invalid state test
    const res2 = await fetch(`${baseUrl}/api/creators/outcome_a/collaborations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'outcome_c', proposal: 'Pending proposal' }),
    })
    const body2 = (await res2.json()) as { id: string }
    pendingCollabId = body2.id
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  const patchCollab = async (creatorId: string, collaborationId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collaborationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const postOutcomeGlobal = async (collaborationId: string) =>
    fetch(`${baseUrl}/api/collaborations/${collaborationId}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

  const postOutcomeScoped = async (creatorId: string, collaborationId: string) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collaborationId}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

  describe('POST /api/collaborations/:collaborationId/outcome', () => {
    it('returns 400 when collaboration is not terminal', async () => {
      const res = await postOutcomeGlobal(pendingCollabId)
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('not in a terminal state')
    })

    it('records outcome after collaboration becomes accepted (auto + manual)', async () => {
      // Transition to accepted via scoped PATCH (should auto-record)
      const patch = await patchCollab('outcome_a', collabId, { status: 'accepted' })
      expect(patch.status).toBe(200)

      // Verify outcome memories exist via creator memories
      const memResA = await fetch(`${baseUrl}/api/creators/outcome_a/memories?category=collaboration_outcome`)
      expect(memResA.status).toBe(200)
      const memBodyA = (await memResA.json()) as { memories: { id: string; content: string; category: string }[] }
      expect(memBodyA.memories.some((m) => m.content.includes(collabId) && m.content.includes('accepted'))).toBe(true)

      const memResB = await fetch(`${baseUrl}/api/creators/outcome_b/memories?category=collaboration_outcome`)
      expect(memResB.status).toBe(200)
      const memBodyB = (await memResB.json()) as { memories: { content: string }[] }
      expect(memBodyB.memories.some((m) => m.content.includes(collabId))).toBe(true)

      // Explicit POST should be idempotent and return same memories
      const postRes = await postOutcomeGlobal(collabId)
      expect(postRes.status).toBe(200)
      const postBody = (await postRes.json()) as { memories: { id: string }[] }
      expect(postBody.memories).toHaveLength(2)
      // Second POST should not create duplicates
      const postRes2 = await postOutcomeGlobal(collabId)
      expect(postRes2.status).toBe(200)
      const postBody2 = (await postRes2.json()) as { memories: { id: string }[] }
      expect(postBody2.memories.map((m) => m.id).sort()).toEqual(postBody.memories.map((m) => m.id).sort())

      // Verify still only 2 outcome memories for this collab
      const memResA2 = await fetch(`${baseUrl}/api/creators/outcome_a/memories?category=collaboration_outcome`)
      const memBodyA2 = (await memResA2.json()) as { memories: { content: string }[] }
      expect(memBodyA2.memories.filter((m) => m.content.includes(collabId))).toHaveLength(1)
    })

    it('returns 404 for unknown collaboration', async () => {
      const res = await postOutcomeGlobal('ghost')
      expect(res.status).toBe(404)
    })

    it('rejects duplicate outcome via idempotent 200 not 409', async () => {
      // Already tested above, but explicit
      const res = await postOutcomeGlobal(collabId)
      expect(res.status).toBe(200)
    })
  })

  describe('POST /api/creators/:creatorId/collaborations/:collaborationId/outcome', () => {
    it('records outcome via scoped endpoint and enforces ownership', async () => {
      // Create a new collaboration for scoped test
      const createRes = await fetch(`${baseUrl}/api/creators/outcome_b/collaborations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'outcome_c', proposal: 'Scoped outcome proposal' }),
      })
      const collab = (await createRes.json()) as { id: string }
      const scopedId = collab.id
      // Make it accepted
      const patch = await patchCollab('outcome_b', scopedId, { status: 'accepted' })
      expect(patch.status).toBe(200)

      // Scoped POST by participant should succeed (idempotent since auto-record already happened)
      const scopedPost = await postOutcomeScoped('outcome_b', scopedId)
      expect(scopedPost.status).toBe(200)
      const scopedBody = (await scopedPost.json()) as { memories: unknown[] }
      expect(scopedBody.memories).toHaveLength(2)

      // Scoped POST by non-participant should 404
      const nonParticipant = await postOutcomeScoped('outcome_a', scopedId)
      expect(nonParticipant.status).toBe(404)

      // Unknown creator 404
      const ghostCreator = await postOutcomeScoped('ghost', scopedId)
      expect(ghostCreator.status).toBe(404)

      // Unknown collaboration 404
      const ghostCollab = await postOutcomeScoped('outcome_a', 'ghost')
      expect(ghostCollab.status).toBe(404)
    })

    it('returns 400 when scoped collaboration is not terminal', async () => {
      const res = await postOutcomeScoped('outcome_a', pendingCollabId)
      expect(res.status).toBe(400)
    })
  })

  describe('isolation of outcome memories', () => {
    it('does not expose outcome memories to unrelated creator', async () => {
      const res = await fetch(`${baseUrl}/api/creators/outcome_c/memories?category=collaboration_outcome`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { memories: { content: string }[] }
      // outcome_c was not part of collabId (outcome_a <-> outcome_b), so should not have that collab's outcome
      expect(body.memories.some((m) => m.content.includes(collabId))).toBe(false)
    })
  })

  describe('matching reflects outcome', () => {
    it('outcome terms make new candidate match', async () => {
      // Create a candidate who shares outcome proposal terms "electronic music"
      const candRes = await fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: 'outcome_candidate', displayName: 'Candidate', bio: 'Electronic music lover' }),
      })
      expect(candRes.status).toBe(201)

      // Subject outcome_a now has outcome memory containing "electronic music" via collabId
      // Check that candidate appears in matches for outcome_a
      const matchRes = await fetch(`${baseUrl}/api/creators/outcome_a/matches`)
      expect(matchRes.status).toBe(200)
      const matchBody = (await matchRes.json()) as { matches: { creator: { creatorId: string }; sharedTerms: string[] }[] }
      const candidateMatch = matchBody.matches.find((m) => m.creator.creatorId === 'outcome_candidate')
      expect(candidateMatch).toBeDefined()
      expect(candidateMatch?.sharedTerms).toEqual(expect.arrayContaining(['electronic', 'music']))
    })
  })
})
