import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'

interface CollaborationBody {
  id: string
  initiatorId: string
  targetId: string
  status: string
  proposal: string
  createdAt: string
  updatedAt: string
}

describe('collaborations API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'collab_creator_a', displayName: 'Ada' })
    createCreatorProfile(db, { creatorId: 'collab_creator_b', displayName: 'Grace' })
    createCreatorProfile(db, { creatorId: 'collab_creator_c', displayName: 'Alan' })
    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  const postCollab = async (
    creatorId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const getCreatorCollabs = async (
    creatorId: string,
    query = '',
  ): Promise<Response> => fetch(`${baseUrl}/api/creators/${creatorId}/collaborations${query}`)

  const getScopedCollab = async (
    creatorId: string,
    collabId: string,
  ): Promise<Response> => fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collabId}`)

  const patchScopedCollab = async (
    creatorId: string,
    collabId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collabId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const getGlobalCollab = async (collabId: string): Promise<Response> =>
    fetch(`${baseUrl}/api/collaborations/${collabId}`)

  const patchGlobalCollab = async (
    collabId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/collaborations/${collabId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  describe('POST /api/creators/:creatorId/collaborations', () => {
    it('creates a collaboration and returns it with 201', async () => {
      const res = await postCollab('collab_creator_a', {
        targetId: 'collab_creator_b',
        proposal: 'Co-host a live stream.',
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as CollaborationBody
      expect(body.initiatorId).toBe('collab_creator_a')
      expect(body.targetId).toBe('collab_creator_b')
      expect(body.status).toBe('pending')
      expect(body.proposal).toBe('Co-host a live stream.')
      expect(body.id).toBeTruthy()
      expect(body.createdAt).toBeTruthy()
      expect(body.updatedAt).toBeTruthy()
    })

    it('accepts a client-chosen id', async () => {
      const res = await postCollab('collab_creator_a', {
        id: 'collab_custom_id',
        targetId: 'collab_creator_c',
        proposal: 'Custom id proposal.',
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as CollaborationBody
      expect(body.id).toBe('collab_custom_id')
    })

    it('returns 409 for duplicate pending collaboration', async () => {
      // collab_custom_id already pending between a and c
      const res = await postCollab('collab_creator_a', {
        targetId: 'collab_creator_c',
        proposal: 'Duplicate attempt.',
      })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('active collaboration already exists')
    })

    it('returns 409 when reverse pending exists', async () => {
      const res = await postCollab('collab_creator_c', {
        targetId: 'collab_creator_a',
        proposal: 'Reverse duplicate.',
      })
      expect(res.status).toBe(409)
    })

    it('returns 404 for unknown initiator or target', async () => {
      const ghostInitiator = await postCollab('ghost', {
        targetId: 'collab_creator_b',
        proposal: 'Hello',
      })
      expect(ghostInitiator.status).toBe(404)

      const ghostTarget = await postCollab('collab_creator_a', {
        targetId: 'ghost',
        proposal: 'Hello',
      })
      expect(ghostTarget.status).toBe(404)
    })

    it('rejects invalid bodies with 400', async () => {
      const cases: Record<string, unknown>[] = [
        {},
        { targetId: 'collab_creator_b' },
        { proposal: 'Hello' },
        { targetId: '   ', proposal: 'Hello' },
        { targetId: 'collab_creator_b', proposal: '   ' },
        { targetId: 'collab_creator_b', proposal: 'Hello', id: '   ' },
        { targetId: 'collab_creator_a', proposal: 'Self' },
      ]
      for (const body of cases) {
        const res = await postCollab('collab_creator_a', body)
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })

    it('returns 409 when id is already taken', async () => {
      const res = await postCollab('collab_creator_b', {
        id: 'collab_custom_id',
        targetId: 'collab_creator_c',
        proposal: 'Duplicate id.',
      })
      expect(res.status).toBe(409)
    })
  })

  describe('GET /api/creators/:creatorId/collaborations', () => {
    it('lists collaborations for initiator and target', async () => {
      const aRes = await getCreatorCollabs('collab_creator_a')
      expect(aRes.status).toBe(200)
      const aBody = (await aRes.json()) as { collaborations: CollaborationBody[]; total: number }
      expect(aBody.total).toBeGreaterThanOrEqual(2)
      const aIds = aBody.collaborations.map((c) => c.id)
      expect(aIds).toContain('collab_custom_id')

      const bRes = await getCreatorCollabs('collab_creator_b')
      expect(bRes.status).toBe(200)
      const bBody = (await bRes.json()) as { collaborations: CollaborationBody[]; total: number }
      expect(bBody.collaborations.some((c) => c.initiatorId === 'collab_creator_a')).toBe(true)
    })

    it('isolates collaborations for unrelated creator', async () => {
      // Create a dedicated isolated pair
      const createRes = await fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: 'isolated_a', displayName: 'Isolated A' }),
      })
      expect(createRes.status).toBe(201)
      const createRes2 = await fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: 'isolated_b', displayName: 'Isolated B' }),
      })
      expect(createRes2.status).toBe(201)
      await fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: 'isolated_c', displayName: 'Isolated C' }),
      })
      const collabRes = await postCollab('isolated_a', {
        id: 'isolated_collab',
        targetId: 'isolated_b',
        proposal: 'Isolated proposal',
      })
      expect(collabRes.status).toBe(201)

      const listC = await getCreatorCollabs('isolated_c')
      expect(listC.status).toBe(200)
      const cBody = (await listC.json()) as { collaborations: CollaborationBody[]; total: number }
      expect(cBody.total).toBe(0)
      expect(cBody.collaborations).toEqual([])
      expect(cBody.collaborations.some((c) => c.id === 'isolated_collab')).toBe(false)

      const scoped = await getScopedCollab('isolated_c', 'isolated_collab')
      expect(scoped.status).toBe(404)
    })

    it('filters by status', async () => {
      // Accept one collaboration to have an accepted status
      const pendingList = await getCreatorCollabs('collab_creator_a', '?status=pending')
      expect(pendingList.status).toBe(200)
      const pendingBody = (await pendingList.json()) as {
        collaborations: CollaborationBody[]
        total: number
      }
      expect(pendingBody.collaborations.length).toBeGreaterThan(0)
      for (const c of pendingBody.collaborations) {
        expect(c.status).toBe('pending')
      }
    })

    it('paginates with limit and offset', async () => {
      const first = await getCreatorCollabs('collab_creator_a', '?limit=1&offset=0')
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as { collaborations: CollaborationBody[]; total: number }
      expect(firstBody.collaborations.length).toBe(1)
      expect(firstBody.total).toBeGreaterThanOrEqual(2)

      const second = await getCreatorCollabs('collab_creator_a', '?limit=1&offset=1')
      expect(second.status).toBe(200)
      const secondBody = (await second.json()) as { collaborations: CollaborationBody[]; total: number }
      expect(secondBody.collaborations.length).toBe(1)
      expect(firstBody.collaborations[0]?.id).not.toBe(secondBody.collaborations[0]?.id)
    })

    it('returns 404 for unknown creator', async () => {
      const res = await getCreatorCollabs('ghost')
      expect(res.status).toBe(404)
    })

    it('rejects invalid status, limit and offset with 400', async () => {
      const invalidQueries = [
        'status=bogus',
        'limit=0',
        'limit=101',
        'limit=abc',
        'limit=1.5',
        'offset=-1',
        'offset=1.5',
        'offset=abc',
      ]
      for (const query of invalidQueries) {
        const res = await getCreatorCollabs('collab_creator_a', `?${query}`)
        expect(res.status, query).toBe(400)
      }
    })
  })

  describe('GET /api/creators/:creatorId/collaborations/:collaborationId', () => {
    it('returns the collaboration when participant', async () => {
      const res = await getScopedCollab('collab_creator_a', 'collab_custom_id')
      expect(res.status).toBe(200)
      const body = (await res.json()) as CollaborationBody
      expect(body.id).toBe('collab_custom_id')
      expect(body.initiatorId).toBe('collab_creator_a')
    })

    it('returns the collaboration for the target participant', async () => {
      const res = await getScopedCollab('collab_creator_c', 'collab_custom_id')
      expect(res.status).toBe(200)
      const body = (await res.json()) as CollaborationBody
      expect(body.id).toBe('collab_custom_id')
    })

    it('returns 404 for unrelated creator', async () => {
      const res = await getScopedCollab('collab_creator_b', 'collab_custom_id')
      expect(res.status).toBe(404)
    })

    it('returns 404 for unknown collaboration', async () => {
      const res = await getScopedCollab('collab_creator_a', 'ghost')
      expect(res.status).toBe(404)
    })

    it('returns 404 for unknown creator', async () => {
      const res = await getScopedCollab('ghost', 'collab_custom_id')
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/creators/:creatorId/collaborations/:collaborationId', () => {
    it('updates proposal and status', async () => {
      // Create a fresh collaboration for this test
      const createRes = await postCollab('collab_creator_b', {
        id: 'patch_test_collab',
        targetId: 'collab_creator_c',
        proposal: 'Original proposal',
      })
      expect(createRes.status).toBe(201)

      const patchProposal = await patchScopedCollab('collab_creator_b', 'patch_test_collab', {
        proposal: 'Revised proposal',
      })
      expect(patchProposal.status).toBe(200)
      const patchedBody = (await patchProposal.json()) as CollaborationBody
      expect(patchedBody.proposal).toBe('Revised proposal')
      expect(patchedBody.status).toBe('pending')

      const patchStatus = await patchScopedCollab('collab_creator_c', 'patch_test_collab', {
        status: 'accepted',
      })
      expect(patchStatus.status).toBe(200)
      const acceptedBody = (await patchStatus.json()) as CollaborationBody
      expect(acceptedBody.status).toBe('accepted')
      expect(acceptedBody.proposal).toBe('Revised proposal')
    })

    it('rejects proposal update when not pending', async () => {
      const res = await patchScopedCollab('collab_creator_b', 'patch_test_collab', {
        proposal: 'Should fail',
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('cannot update proposal')
    })

    it('rejects invalid status transition', async () => {
      // patch_test_collab is now accepted, cannot go to rejected
      const res = await patchScopedCollab('collab_creator_b', 'patch_test_collab', {
        status: 'rejected',
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('invalid status transition')
    })

    it('rejects empty proposal and invalid status', async () => {
      // Create another pending with a fresh pair (b -> isolated_c is unused)
      const createRes = await postCollab('collab_creator_b', {
        id: 'patch_validation_collab',
        targetId: 'isolated_c',
        proposal: 'For validation',
      })
      expect(createRes.status).toBe(201)
      const emptyProposal = await patchScopedCollab('collab_creator_b', 'patch_validation_collab', {
        proposal: '   ',
      })
      expect(emptyProposal.status).toBe(400)

      const invalidStatus = await patchScopedCollab('collab_creator_b', 'patch_validation_collab', {
        status: 'bogus',
      })
      expect(invalidStatus.status).toBe(400)

      const emptyBody = await patchScopedCollab('collab_creator_b', 'patch_validation_collab', {})
      expect(emptyBody.status).toBe(400)
    })

    it('returns 404 for unrelated creator patch', async () => {
      const res = await patchScopedCollab('isolated_c', 'patch_test_collab', {
        status: 'cancelled',
      })
      expect(res.status).toBe(404)
    })

    it('rejects non-pending to pending transition', async () => {
      const res = await patchScopedCollab('collab_creator_b', 'patch_test_collab', {
        status: 'pending',
      })
      // Accepted -> pending is invalid, but code returns existing if same status? No, accepted != pending so throws
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/collaborations/:collaborationId', () => {
    it('returns the collaboration by global id', async () => {
      const res = await getGlobalCollab('collab_custom_id')
      expect(res.status).toBe(200)
      const body = (await res.json()) as CollaborationBody
      expect(body.id).toBe('collab_custom_id')
    })

    it('returns 404 for unknown collaboration', async () => {
      const res = await getGlobalCollab('ghost_global')
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/collaborations/:collaborationId', () => {
    it('updates via global endpoint', async () => {
      const createRes = await postCollab('isolated_a', {
        id: 'global_patch_collab',
        targetId: 'isolated_c',
        proposal: 'Global patch original',
      })
      // If pending duplicate, cancel previous isolated_collab first
      if (createRes.status === 409) {
        await patchScopedCollab('isolated_a', 'isolated_collab', { status: 'cancelled' })
        const retry = await postCollab('isolated_a', {
          id: 'global_patch_collab',
          targetId: 'isolated_c',
          proposal: 'Global patch original',
        })
        expect(retry.status).toBe(201)
      }
      const patchRes = await patchGlobalCollab('global_patch_collab', {
        proposal: 'Global revised',
      })
      expect(patchRes.status).toBe(200)
      const body = (await patchRes.json()) as CollaborationBody
      expect(body.proposal).toBe('Global revised')

      const statusRes = await patchGlobalCollab('global_patch_collab', { status: 'rejected' })
      expect(statusRes.status).toBe(200)
      const statusBody = (await statusRes.json()) as CollaborationBody
      expect(statusBody.status).toBe('rejected')
    })

    it('rejects invalid transition via global endpoint', async () => {
      const res = await patchGlobalCollab('global_patch_collab', { status: 'accepted' })
      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown collaboration', async () => {
      const res = await patchGlobalCollab('ghost_global', { status: 'accepted' })
      expect(res.status).toBe(404)
    })

    it('rejects empty body with 400', async () => {
      const res = await patchGlobalCollab('global_patch_collab', {})
      expect(res.status).toBe(400)
    })
  })

  it('allows new collaboration after previous is terminal', async () => {
    // isolated_a and isolated_b had isolated_collab cancelled via previous test? Check
    // Ensure we can create a new one after cancelled
    const res = await postCollab('isolated_a', {
      targetId: 'isolated_b',
      proposal: 'Second after cancelled',
    })
    // If still pending, need to cancel first
    if (res.status === 409) {
      await patchScopedCollab('isolated_a', 'isolated_collab', { status: 'cancelled' }).catch(() => {})
      const retry = await postCollab('isolated_a', {
        targetId: 'isolated_b',
        proposal: 'Second after cancelled',
      })
      expect(retry.status).toBe(201)
    } else {
      expect(res.status).toBe(201)
    }
  })
})
