import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCollaboration, createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'

interface FollowUpBody {
  id: string
  collaborationId: string
  dueAt: string
  status: string
  attempts: number
  createdAt: string
  updatedAt: string
}

describe('follow-ups API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string
  let collabId: string
  let otherCollabId: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'follow_creator_a', displayName: 'Ada' })
    createCreatorProfile(db, { creatorId: 'follow_creator_b', displayName: 'Grace' })
    const collab = createCollaboration(db, {
      id: 'follow_collab',
      initiatorId: 'follow_creator_a',
      targetId: 'follow_creator_b',
      proposal: 'Follow-up collab',
    })
    collabId = collab.id
    createCreatorProfile(db, { creatorId: 'follow_creator_c', displayName: 'Alan' })
    const collab2 = createCollaboration(db, {
      id: 'follow_collab_2',
      initiatorId: 'follow_creator_a',
      targetId: 'follow_creator_c',
      proposal: 'Second collab',
    })
    otherCollabId = collab2.id

    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  const postFollowUp = async (
    collaborationId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/collaborations/${collaborationId}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const getFollowUps = async (collaborationId: string, query = ''): Promise<Response> =>
    fetch(`${baseUrl}/api/collaborations/${collaborationId}/follow-ups${query}`)

  const patchFollowUp = async (
    collaborationId: string,
    followUpId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/collaborations/${collaborationId}/follow-ups/${followUpId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  describe('POST /api/collaborations/:collaborationId/follow-ups', () => {
    it('creates a follow-up with 201', async () => {
      const dueAt = '2026-08-25T10:00:00.000Z'
      const res = await postFollowUp(collabId, { dueAt })
      expect(res.status).toBe(201)
      const body = (await res.json()) as FollowUpBody
      expect(body.collaborationId).toBe(collabId)
      expect(body.dueAt).toBe(dueAt)
      expect(body.status).toBe('pending')
      expect(body.attempts).toBe(0)
      expect(body.id).toBeTruthy()
      expect(body.createdAt).toBeTruthy()
    })

    it('accepts a client-chosen id', async () => {
      const res = await postFollowUp(collabId, {
        id: 'follow_custom',
        dueAt: '2026-08-26T10:00:00.000Z',
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as FollowUpBody
      expect(body.id).toBe('follow_custom')
    })

    it('returns 409 when id is already taken', async () => {
      const res = await postFollowUp(collabId, {
        id: 'follow_custom',
        dueAt: '2026-08-27T10:00:00.000Z',
      })
      expect(res.status).toBe(409)
    })

    it('returns 404 for unknown collaboration', async () => {
      const res = await postFollowUp('ghost', { dueAt: '2026-08-25T10:00:00.000Z' })
      expect(res.status).toBe(404)
    })

    it('rejects invalid bodies with 400', async () => {
      const cases: Record<string, unknown>[] = [
        {},
        { dueAt: '' },
        { dueAt: '   ' },
        { dueAt: 'not-a-date' },
        { dueAt: '2026-08-25T10:00:00.000Z', status: 'completed' },
        { dueAt: '2026-08-25T10:00:00.000Z', status: 'bogus' },
        { dueAt: '2026-08-25T10:00:00.000Z', id: '   ' },
        { dueAt: '2026-08-25T10:00:00.000Z', attempts: 1 },
      ]
      for (const body of cases) {
        const res = await postFollowUp(collabId, body)
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })
  })

  describe('GET /api/collaborations/:collaborationId/follow-ups', () => {
    it('lists follow-ups ordered by dueAt', async () => {
      // Create two more with distinct dueAt for ordering
      await postFollowUp(otherCollabId, { id: 'follow_other_1', dueAt: '2026-09-01T00:00:00.000Z' })
      await postFollowUp(otherCollabId, { id: 'follow_other_2', dueAt: '2026-08-20T00:00:00.000Z' })

      const res = await getFollowUps(otherCollabId)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { followUps: FollowUpBody[]; total: number }
      expect(body.total).toBe(2)
      expect(body.followUps.map((f) => f.id)).toEqual(['follow_other_2', 'follow_other_1'])
    })

    it('isolates follow-ups between collaborations', async () => {
      const res = await getFollowUps(collabId)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { followUps: FollowUpBody[] }
      const ids = body.followUps.map((f) => f.id)
      expect(ids).not.toContain('follow_other_1')
      expect(ids).not.toContain('follow_other_2')
    })

    it('filters by status and paginates', async () => {
      // Create a pending and then complete one
      await postFollowUp(collabId, { id: 'follow_filter', dueAt: '2026-08-30T00:00:00.000Z' })
      const patchRes = await patchFollowUp(collabId, 'follow_filter', { status: 'completed' })
      expect(patchRes.status).toBe(200)

      const pendingRes = await getFollowUps(collabId, '?status=pending')
      expect(pendingRes.status).toBe(200)
      const pendingBody = (await pendingRes.json()) as { followUps: FollowUpBody[] }
      for (const f of pendingBody.followUps) expect(f.status).toBe('pending')
      expect(pendingBody.followUps.some((f) => f.id === 'follow_filter')).toBe(false)

      const completedRes = await getFollowUps(collabId, '?status=completed')
      expect(completedRes.status).toBe(200)
      const completedBody = (await completedRes.json()) as { followUps: FollowUpBody[] }
      expect(completedBody.followUps.some((f) => f.id === 'follow_filter')).toBe(true)

      const paginated = await getFollowUps(collabId, '?limit=1&offset=0')
      expect(paginated.status).toBe(200)
      const paginatedBody = (await paginated.json()) as { followUps: FollowUpBody[]; total: number }
      expect(paginatedBody.followUps.length).toBe(1)
      expect(paginatedBody.total).toBeGreaterThanOrEqual(2)
    })

    it('returns 404 for unknown collaboration', async () => {
      const res = await getFollowUps('ghost')
      expect(res.status).toBe(404)
    })

    it('rejects invalid status, limit, offset with 400', async () => {
      const invalid = ['status=bogus', 'limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'offset=1.5']
      for (const q of invalid) {
        const res = await getFollowUps(collabId, `?${q}`)
        expect(res.status, q).toBe(400)
      }
    })
  })

  describe('PATCH /api/collaborations/:collaborationId/follow-ups/:followUpId', () => {
    it('updates status to completed', async () => {
      const createRes = await postFollowUp(collabId, {
        id: 'follow_patch',
        dueAt: '2026-08-28T10:00:00.000Z',
      })
      expect(createRes.status).toBe(201)

      const res = await patchFollowUp(collabId, 'follow_patch', { status: 'completed' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as FollowUpBody
      expect(body.status).toBe('completed')
      expect(body.id).toBe('follow_patch')
    })

    it('rejects invalid status transition', async () => {
      const res = await patchFollowUp(collabId, 'follow_patch', { status: 'cancelled' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('invalid status transition')
    })

    it('rejects invalid status and empty body', async () => {
      const cases: Record<string, unknown>[] = [{}, { status: 'bogus' }, { status: '' }, { status: 42 }]
      for (const body of cases) {
        const res = await patchFollowUp(collabId, 'follow_patch', body)
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })

    it('returns 404 for unknown collaboration', async () => {
      const res = await patchFollowUp('ghost', 'follow_patch', { status: 'completed' })
      expect(res.status).toBe(404)
    })

    it('returns 404 for unknown follow-up', async () => {
      const res = await patchFollowUp(collabId, 'ghost', { status: 'completed' })
      expect(res.status).toBe(404)
    })

    it('returns 404 when follow-up belongs to another collaboration (isolation)', async () => {
      // follow_other_1 belongs to otherCollabId, try to patch via collabId
      const res = await patchFollowUp(collabId, 'follow_other_1', { status: 'completed' })
      expect(res.status).toBe(404)
      // also list isolation already tested, but verify get via wrong collab not possible (PATCH is proxy)
      const res2 = await patchFollowUp(otherCollabId, 'follow_patch', { status: 'cancelled' })
      expect(res2.status).toBe(404)
    })

    it('allows idempotent pending update', async () => {
      const createRes = await postFollowUp(collabId, {
        id: 'follow_idempotent',
        dueAt: '2026-08-29T10:00:00.000Z',
      })
      expect(createRes.status).toBe(201)
      const res = await patchFollowUp(collabId, 'follow_idempotent', { status: 'pending' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as FollowUpBody
      expect(body.status).toBe('pending')
    })
  })
})
