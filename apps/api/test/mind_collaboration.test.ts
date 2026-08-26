import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addCreatorMemory,
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  listCollaborationsForCreator,
  listCreatorMemories,
  listMindInteractions,
  migrate,
} from '@linkup/db'
import type { MindAdapter, MindContext } from '@linkup/db'
import { createApp } from '../src/app.js'
import {
  MAX_PROPOSAL_LENGTH,
  createMindCollaborationService,
} from '../src/services/mind_collaboration.js'

const FAKE_PROPOSAL = 'Co-host a pottery workshop series.'

interface RecordingAdapter extends MindAdapter {
  lastContext?: MindContext
  lastInput?: string
  calls: number
}

/** Adapter that records what it was given and returns a fixed proposal. */
function recordingAdapter(proposal: string = FAKE_PROPOSAL): RecordingAdapter {
  const adapter: RecordingAdapter = {
    calls: 0,
    async query(context, input) {
      adapter.lastContext = context
      adapter.lastInput = input
      adapter.calls += 1
      return proposal
    },
  }
  return adapter
}

function failingAdapter(message: string): MindAdapter {
  return {
    async query() {
      throw new Error(message)
    },
  }
}

/**
 * Seeds a matching graph where svc_alice matches svc_bob (pottery) and
 * svc_carol (hiking) at equal score, with svc_dave matching nobody.
 * Deterministic tie-break picks svc_bob as the top match.
 */
function seedMatchGraph(db: Database.Database): void {
  createCreatorProfile(db, { creatorId: 'svc_alice', displayName: 'Alice', bio: 'Loves pottery and hiking' })
  createCreatorProfile(db, { creatorId: 'svc_bob', displayName: 'Bob', bio: 'Pottery collector' })
  createCreatorProfile(db, { creatorId: 'svc_carol', displayName: 'Carol', bio: 'Hiking trails' })
  createCreatorProfile(db, { creatorId: 'svc_dave', displayName: 'Dave', bio: 'Rocket science' })
}

describe('mind collaboration service', () => {
  it('preview selects the top match with score, shared terms, and a drafted proposal', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const fake = recordingAdapter()
    const service = createMindCollaborationService({ db, adapter: fake })

    const preview = await service.preview('svc_alice')
    expect(preview.target.creatorId).toBe('svc_bob')
    expect(preview.score).toBe(1)
    expect(preview.sharedTerms).toEqual(['pottery'])
    expect(preview.proposal).toBe(FAKE_PROPOSAL)
    // The adapter received the creator's Mind context and an instruction that
    // names the target and the shared interests.
    expect(fake.lastContext?.creator.creatorId).toBe('svc_alice')
    expect(fake.lastInput).toContain('Bob')
    expect(fake.lastInput).toContain('pottery')
    db.close()
  })

  it('preview with an explicit target drafts for that target', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })

    const preview = await service.preview('svc_alice', { targetId: 'svc_carol' })
    expect(preview.target.creatorId).toBe('svc_carol')
    expect(preview.sharedTerms).toEqual(['hiking'])
    db.close()
  })

  it('preview throws for an unknown creator', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.preview('ghost')).rejects.toThrow('creator profile not found: ghost')
    db.close()
  })

  it('preview throws for a target that does not exist', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.preview('svc_alice', { targetId: 'ghost_target' })).rejects.toThrow(
      'creator profile not found: ghost_target',
    )
    db.close()
  })

  it('preview rejects the creator itself as target', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.preview('svc_alice', { targetId: 'svc_alice' })).rejects.toThrow(
      'initiatorId and targetId must be different',
    )
    db.close()
  })

  it('preview rejects a target that is not a compatible match', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.preview('svc_alice', { targetId: 'svc_dave' })).rejects.toThrow(
      'target svc_dave is not a compatible match for svc_alice',
    )
    db.close()
  })

  it('preview throws when the creator has no compatible creators', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_solo', displayName: 'Solo', bio: 'Standalone' })
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.preview('svc_solo')).rejects.toThrow('no compatible creators found for svc_solo')
    db.close()
  })

  it('preview is a dry run — nothing is persisted', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    addCreatorMemory(db, { id: 'mem_before', creatorId: 'svc_alice', category: 'preference', content: 'Prefers weekends' })
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })

    const collabsBefore = listCollaborationsForCreator(db, 'svc_alice')
    const historyBefore = listMindInteractions(db, 'svc_alice')
    const memoriesBefore = listCreatorMemories(db, { creatorId: 'svc_alice' })

    await service.preview('svc_alice')
    await service.preview('svc_alice', { targetId: 'svc_carol' })

    const collabsAfter = listCollaborationsForCreator(db, 'svc_alice')
    const historyAfter = listMindInteractions(db, 'svc_alice')
    const memoriesAfter = listCreatorMemories(db, { creatorId: 'svc_alice' })
    expect(collabsAfter.total).toBe(collabsBefore.total)
    expect(collabsAfter.collaborations).toEqual(collabsBefore.collaborations)
    expect(historyAfter.total).toBe(historyBefore.total)
    expect(memoriesAfter.map((m) => m.id)).toEqual(memoriesBefore.map((m) => m.id))
    db.close()
  })

  it('preview passes only the creator own context — no private data from others', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    addCreatorMemory(db, { id: 'alice_private', creatorId: 'svc_alice', category: 'preference', content: 'Prefers weekends' })
    addCreatorMemory(db, { id: 'bob_secret', creatorId: 'svc_bob', category: 'preference', content: 'Secret bob plan' })
    const fake = recordingAdapter()
    const service = createMindCollaborationService({ db, adapter: fake })

    const preview = await service.preview('svc_alice')
    // The target profile is public data only — no memory fields on it.
    expect(Object.keys(preview.target)).toEqual(['creatorId', 'displayName', 'bio', 'avatarUrl', 'createdAt', 'updatedAt'])
    // The adapter context carries alice's memory but never bob's secret.
    expect(fake.lastContext?.memories.some((m) => m.id === 'alice_private')).toBe(true)
    expect(fake.lastContext?.memories.some((m) => m.id === 'bob_secret')).toBe(false)
    expect(fake.lastContext?.memories.some((m) => m.content.includes('Secret bob'))).toBe(false)
    db.close()
  })

  it('preview propagates adapter failures and rejects invalid adapter replies', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)

    const boom = createMindCollaborationService({ db, adapter: failingAdapter('provider exploded') })
    await expect(boom.preview('svc_alice')).rejects.toThrow('provider exploded')

    const empty = createMindCollaborationService({ db, adapter: recordingAdapter('   ') })
    await expect(empty.preview('svc_alice')).rejects.toThrow('adapter returned an empty collaboration proposal')

    const overLong = createMindCollaborationService({ db, adapter: recordingAdapter('a'.repeat(MAX_PROPOSAL_LENGTH + 1)) })
    await expect(overLong.preview('svc_alice')).rejects.toThrow('adapter returned an over-long collaboration proposal')

    // Exactly at the limit is accepted.
    const atLimit = createMindCollaborationService({ db, adapter: recordingAdapter('a'.repeat(MAX_PROPOSAL_LENGTH)) })
    const preview = await atLimit.preview('svc_alice')
    expect(preview.proposal.length).toBe(MAX_PROPOSAL_LENGTH)
    db.close()
  })

  it('execute creates a pending collaboration with the drafted proposal', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const fake = recordingAdapter()
    const service = createMindCollaborationService({ db, adapter: fake })

    const collaboration = await service.execute('svc_alice', { targetId: 'svc_carol', confirm: true })
    expect(collaboration.initiatorId).toBe('svc_alice')
    expect(collaboration.targetId).toBe('svc_carol')
    expect(collaboration.status).toBe('pending')
    expect(collaboration.proposal).toBe(FAKE_PROPOSAL)
    expect(fake.lastContext?.creator.creatorId).toBe('svc_alice')

    const list = listCollaborationsForCreator(db, 'svc_alice')
    expect(list.collaborations.some((c) => c.id === collaboration.id)).toBe(true)
    db.close()
  })

  it('execute records the proposal and confirmation as Mind interactions without writing memories', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    addCreatorMemory(db, { id: 'mem_before', creatorId: 'svc_alice', category: 'preference', content: 'Prefers weekends' })
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })

    await service.execute('svc_alice', { targetId: 'svc_carol', confirm: true })

    const history = listMindInteractions(db, 'svc_alice')
    expect(history.total).toBe(2)
    expect(history.interactions[0]?.role).toBe('mind')
    expect(history.interactions[0]?.content).toBe(
      `Proposed collaboration with Carol (svc_carol): ${FAKE_PROPOSAL}`,
    )
    expect(history.interactions[1]?.role).toBe('user')
    expect(history.interactions[1]?.content).toBe('Confirmed collaboration with Carol (svc_carol)')

    // No automatic memory write-back: the only memory is the one seeded above.
    const memories = listCreatorMemories(db, { creatorId: 'svc_alice' })
    expect(memories.map((m) => m.id)).toEqual(['mem_before'])
    db.close()
  })

  it('execute requires explicit confirmation', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })

    await expect(service.execute('svc_alice', { targetId: 'svc_bob', confirm: false })).rejects.toThrow(
      'confirmation is required',
    )
    // Non-boolean confirm values are not accepted.
    await expect(
      service.execute('svc_alice', { targetId: 'svc_bob', confirm: 'true' as unknown as boolean }),
    ).rejects.toThrow('confirmation is required')
    await expect(
      service.execute('svc_alice', { targetId: 'svc_bob' } as { targetId: string; confirm: boolean }),
    ).rejects.toThrow('confirmation is required')
    // Nothing was created by the rejected attempts.
    expect(listCollaborationsForCreator(db, 'svc_alice').total).toBe(0)
    expect(listMindInteractions(db, 'svc_alice').total).toBe(0)
    db.close()
  })

  it('execute rejects the creator itself as target', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.execute('svc_alice', { targetId: 'svc_alice', confirm: true })).rejects.toThrow(
      'initiatorId and targetId must be different',
    )
    db.close()
  })

  it('execute rejects a target that is not a compatible match', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.execute('svc_alice', { targetId: 'svc_dave', confirm: true })).rejects.toThrow(
      'target svc_dave is not a compatible match for svc_alice',
    )
    db.close()
  })

  it('execute rejects an unknown creator and an unknown target', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })
    await expect(service.execute('ghost', { targetId: 'svc_bob', confirm: true })).rejects.toThrow(
      'creator profile not found: ghost',
    )
    await expect(service.execute('svc_alice', { targetId: 'ghost', confirm: true })).rejects.toThrow(
      'creator profile not found: ghost',
    )
    db.close()
  })

  it('execute creates another collaboration when one already exists', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    createCollaboration(db, {
      id: 'existing_collab',
      initiatorId: 'svc_alice',
      targetId: 'svc_bob',
      proposal: 'Already pending',
    })
    const service = createMindCollaborationService({ db, adapter: recordingAdapter() })

    const result = await service.execute('svc_alice', { targetId: 'svc_bob', confirm: true })
    expect(result.id).not.toBe('existing_collab')
    expect(listCollaborationsForCreator(db, 'svc_alice').total).toBe(2)
    db.close()
  })

  it('execute does not create anything when the adapter fails', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    const service = createMindCollaborationService({ db, adapter: failingAdapter('provider boom') })

    await expect(service.execute('svc_alice', { targetId: 'svc_bob', confirm: true })).rejects.toThrow(
      'provider boom',
    )
    expect(listCollaborationsForCreator(db, 'svc_alice').total).toBe(0)
    expect(listMindInteractions(db, 'svc_alice').total).toBe(0)
    db.close()
  })

  it('execute context is creator-scoped — no private data from the target', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedMatchGraph(db)
    addCreatorMemory(db, { id: 'alice_private', creatorId: 'svc_alice', category: 'preference', content: 'Prefers weekends' })
    addCreatorMemory(db, { id: 'bob_secret', creatorId: 'svc_bob', category: 'preference', content: 'Secret bob plan' })
    const fake = recordingAdapter()
    const service = createMindCollaborationService({ db, adapter: fake })

    await service.execute('svc_alice', { targetId: 'svc_bob', confirm: true })
    expect(fake.lastContext?.memories.some((m) => m.id === 'alice_private')).toBe(true)
    expect(fake.lastContext?.memories.some((m) => m.id === 'bob_secret')).toBe(false)
    expect(fake.lastContext?.memories.some((m) => m.content.includes('Secret bob'))).toBe(false)
    db.close()
  })
})

describe('mind collaboration API', () => {
  const db = createDatabase(':memory:')
  let fakeServer: Server
  let defaultServer: Server
  let fakeBase: string
  let defaultBase: string
  const fake = recordingAdapter()

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'api_alice', displayName: 'Alice', bio: 'Loves pottery and hiking' })
    createCreatorProfile(db, { creatorId: 'api_bob', displayName: 'Bob', bio: 'Pottery collector' })
    createCreatorProfile(db, { creatorId: 'api_carol', displayName: 'Carol', bio: 'Hiking trails' })
    createCreatorProfile(db, { creatorId: 'api_dave', displayName: 'Dave', bio: 'Rocket science' })
    createCreatorProfile(db, { creatorId: 'api_solo', displayName: 'Solo', bio: 'Standalone' })
    addCreatorMemory(db, {
      id: 'api_alice_private',
      creatorId: 'api_alice',
      category: 'preference',
      content: 'Prefers weekend workshops',
    })
    addCreatorMemory(db, {
      id: 'api_bob_secret',
      creatorId: 'api_bob',
      category: 'preference',
      content: 'Secret bob memory',
    })
    fakeServer = createApp({ db, mindAdapter: fake }).listen(0)
    defaultServer = createApp({ db }).listen(0)
    await Promise.all([
      new Promise<void>((r) => fakeServer.once('listening', r)),
      new Promise<void>((r) => defaultServer.once('listening', r)),
    ])
    fakeBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`
    defaultBase = `http://127.0.0.1:${(defaultServer.address() as AddressInfo).port}`
  })

  afterAll(() => {
    fakeServer.close()
    defaultServer.close()
    db.close()
  })

  const postPreview = async (creatorId: string, body?: unknown): Promise<Response> =>
    fetch(`${fakeBase}/api/creators/${creatorId}/mind/collaborations/preview`, {
      method: 'POST',
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })

  const postExecute = async (creatorId: string, body: Record<string, unknown>): Promise<Response> =>
    fetch(`${fakeBase}/api/creators/${creatorId}/mind/collaborations/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  describe('POST /api/creators/:creatorId/mind/collaborations/preview', () => {
    it('returns the selected target, score, shared terms, and proposal with 200', async () => {
      const res = await postPreview('api_alice')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        preview: { target: { creatorId: string }; score: number; sharedTerms: string[]; proposal: string }
      }
      expect(Object.keys(body)).toEqual(['preview'])
      expect(Object.keys(body.preview)).toEqual(['target', 'score', 'sharedTerms', 'proposal'])
      expect(body.preview.target.creatorId).toBe('api_bob')
      expect(body.preview.score).toBe(1)
      expect(body.preview.sharedTerms).toEqual(['pottery'])
      expect(body.preview.proposal).toBe(FAKE_PROPOSAL)
    })

    it('accepts an explicit targetId', async () => {
      const res = await postPreview('api_alice', { targetId: 'api_carol' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { preview: { target: { creatorId: string }; sharedTerms: string[] } }
      expect(body.preview.target.creatorId).toBe('api_carol')
      expect(body.preview.sharedTerms).toEqual(['hiking'])
    })

    it('returns 404 for an unknown creator', async () => {
      const res = await postPreview('ghost')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('creator profile not found: ghost')
    })

    it('returns 404 for a target that does not exist', async () => {
      const res = await postPreview('api_alice', { targetId: 'ghost' })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('creator profile not found: ghost')
    })

    it('returns 404 when the creator has no compatible creators', async () => {
      const res = await postPreview('api_solo')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('no compatible creators found for api_solo')
    })

    it('rejects the creator itself as target with 400', async () => {
      const res = await postPreview('api_alice', { targetId: 'api_alice' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('initiatorId and targetId must be different')
    })

    it('rejects a target that is not a compatible match with 400', async () => {
      const res = await postPreview('api_alice', { targetId: 'api_dave' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('target api_dave is not a compatible match for api_alice')
    })

    it('rejects a blank targetId with 400', async () => {
      const res = await postPreview('api_alice', { targetId: '   ' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('targetId must be a non-empty string')
    })

    it('rejects a non-object body with 400', async () => {
      // JSON primitives never reach the route: the JSON parser (strict mode)
      // rejects them before routing, which still yields a clean 400.
      const res = await postPreview('api_alice', 42)
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('request body')
    })

    it('never mutates state', async () => {
      const getJson = async (path: string): Promise<{ total?: number; memories?: unknown[] }> =>
        (await fetch(`${fakeBase}${path}`)).json() as Promise<{ total?: number; memories?: unknown[] }>
      const collabsBefore = await getJson('/api/creators/api_alice/collaborations')
      const historyBefore = await getJson('/api/creators/api_alice/mind/history')
      const memoriesBefore = await getJson('/api/creators/api_alice/memories')

      const res = await postPreview('api_alice')
      expect(res.status).toBe(200)
      const collabsAfter = await getJson('/api/creators/api_alice/collaborations')
      const historyAfter = await getJson('/api/creators/api_alice/mind/history')
      const memoriesAfter = await getJson('/api/creators/api_alice/memories')
      expect(collabsAfter.total).toBe(collabsBefore.total)
      expect(historyAfter.total).toBe(historyBefore.total)
      expect(memoriesAfter.memories?.length).toBe(memoriesBefore.memories?.length)
    })

    it('never leaks another creator private memories', async () => {
      const res = await postPreview('api_alice')
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).not.toContain('Secret bob')
      expect(text).not.toContain('api_bob_secret')
      const body = JSON.parse(text) as {
        preview: { target: Record<string, unknown>; proposal: string }
      }
      // The target is the public profile shape only — no memory or context fields.
      expect(Object.keys(body.preview.target)).toEqual([
        'creatorId',
        'displayName',
        'bio',
        'avatarUrl',
        'createdAt',
        'updatedAt',
      ])
      // The adapter received only the creator's own context.
      expect(fake.lastContext?.creator.creatorId).toBe('api_alice')
      expect(fake.lastContext?.memories.some((m) => m.id === 'api_alice_private')).toBe(true)
      expect(fake.lastContext?.memories.some((m) => m.id === 'api_bob_secret')).toBe(false)
    })

    it('returns 503 when no Minds adapter is configured', async () => {
      const res = await fetch(`${defaultBase}/api/creators/api_alice/mind/collaborations/preview`, {
        method: 'POST',
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('Minds adapter not configured')
    })

    it('returns 500 without leaking internals when the adapter fails', async () => {
      const failingDb = createDatabase(':memory:')
      migrate(failingDb)
      createCreatorProfile(failingDb, { creatorId: 'fail_alice', displayName: 'Alice', bio: 'Loves pottery' })
      createCreatorProfile(failingDb, { creatorId: 'fail_bob', displayName: 'Bob', bio: 'Pottery collector' })
      const failingApp = createApp({
        db: failingDb,
        mindAdapter: failingAdapter('secret internal boom with password 123'),
      }).listen(0)
      await new Promise<void>((r) => failingApp.once('listening', r))
      const base = `http://127.0.0.1:${(failingApp.address() as AddressInfo).port}`

      const res = await fetch(`${base}/api/creators/fail_alice/mind/collaborations/preview`, { method: 'POST' })
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('collaboration preview failed')
      expect(body.error).not.toContain('secret')
      expect(body.error).not.toContain('password')
      failingApp.close()
      failingDb.close()
    })
  })

  describe('POST /api/creators/:creatorId/mind/collaborations/execute', () => {
    it('creates a pending collaboration after confirmation with 201', async () => {
      const res = await postExecute('api_alice', { targetId: 'api_carol', confirm: true })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        collaboration: {
          id: string
          initiatorId: string
          targetId: string
          status: string
          proposal: string
        }
      }
      expect(Object.keys(body)).toEqual(['collaboration'])
      expect(body.collaboration.initiatorId).toBe('api_alice')
      expect(body.collaboration.targetId).toBe('api_carol')
      expect(body.collaboration.status).toBe('pending')
      expect(body.collaboration.proposal).toBe(FAKE_PROPOSAL)

      // The collaboration is visible on the creator's collaboration list.
      const list = (await (await fetch(`${fakeBase}/api/creators/api_alice/collaborations`)).json()) as {
        collaborations: Array<{ id: string }>
      }
      expect(list.collaborations.some((c) => c.id === body.collaboration.id)).toBe(true)

      // The Mind history records the proposal and the confirmation, and no
      // memory was written back automatically.
      const history = (await (await fetch(`${fakeBase}/api/creators/api_alice/mind/history`)).json()) as {
        interactions: Array<{ role: string; content: string }>
      }
      expect(
        history.interactions.some(
          (i) => i.role === 'mind' && i.content === `Proposed collaboration with Carol (api_carol): ${FAKE_PROPOSAL}`,
        ),
      ).toBe(true)
      expect(
        history.interactions.some(
          (i) => i.role === 'user' && i.content === 'Confirmed collaboration with Carol (api_carol)',
        ),
      ).toBe(true)
      const memories = (await (await fetch(`${fakeBase}/api/creators/api_alice/memories`)).json()) as {
        memories: Array<{ content: string }>
      }
      expect(memories.memories.some((m) => m.content.includes('Co-host'))).toBe(false)
    })

    it('requires an explicit confirmation with 400', async () => {
      const cases: Array<{ body: Record<string, unknown>; desc: string }> = [
        { body: { targetId: 'api_carol' }, desc: 'missing confirm' },
        { body: { targetId: 'api_carol', confirm: false }, desc: 'confirm false' },
        { body: { targetId: 'api_carol', confirm: 'true' }, desc: 'confirm string' },
      ]
      for (const { body, desc } of cases) {
        const res = await postExecute('api_alice', body)
        expect(res.status, desc).toBe(400)
        const b = (await res.json()) as { error: string }
        expect(b.error).toContain('confirmation is required')
      }
    })

    it('rejects a non-object body with 400', async () => {
      const res = await fetch(`${fakeBase}/api/creators/api_alice/mind/collaborations/execute`, {
        method: 'POST',
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('request body must be a JSON object')
    })

    it('rejects a missing or blank targetId with 400', async () => {
      const missing = await postExecute('api_alice', { confirm: true })
      expect(missing.status).toBe(400)
      expect(((await missing.json()) as { error: string }).error).toContain('targetId must be a non-empty string')

      const blank = await postExecute('api_alice', { targetId: '   ', confirm: true })
      expect(blank.status).toBe(400)
      expect(((await blank.json()) as { error: string }).error).toContain('targetId must be a non-empty string')
    })

    it('rejects the creator itself as target with 400', async () => {
      const res = await postExecute('api_alice', { targetId: 'api_alice', confirm: true })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('initiatorId and targetId must be different')
    })

    it('rejects a target that is not a compatible match with 400', async () => {
      const res = await postExecute('api_alice', { targetId: 'api_dave', confirm: true })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('target api_dave is not a compatible match for api_alice')
    })

    it('returns 404 for an unknown creator or target', async () => {
      const ghostCreator = await postExecute('ghost', { targetId: 'api_bob', confirm: true })
      expect(ghostCreator.status).toBe(404)
      expect(((await ghostCreator.json()) as { error: string }).error).toContain('creator profile not found')

      const ghostTarget = await postExecute('api_alice', { targetId: 'ghost', confirm: true })
      expect(ghostTarget.status).toBe(404)
      expect(((await ghostTarget.json()) as { error: string }).error).toContain('creator profile not found: ghost')
    })

    it('creates multiple collaborations successfully for the same creator pair', async () => {
      createCollaboration(db, {
        id: 'api_dup_collab',
        initiatorId: 'api_alice',
        targetId: 'api_bob',
        proposal: 'Already pending',
      })

      const res = await postExecute('api_alice', { targetId: 'api_bob', confirm: true })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { collaboration: { id: string } }
      expect(body.collaboration.id).not.toBe('api_dup_collab')
    })

    it('returns 503 when no Minds adapter is configured', async () => {
      const res = await fetch(`${defaultBase}/api/creators/api_alice/mind/collaborations/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'api_carol', confirm: true }),
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('Minds adapter not configured')
    })

    it('returns 500 without leaking internals and creates nothing on adapter failure', async () => {
      const failingDb = createDatabase(':memory:')
      migrate(failingDb)
      createCreatorProfile(failingDb, { creatorId: 'fail_alice', displayName: 'Alice', bio: 'Loves pottery' })
      createCreatorProfile(failingDb, { creatorId: 'fail_bob', displayName: 'Bob', bio: 'Pottery collector' })
      const failingApp = createApp({
        db: failingDb,
        mindAdapter: failingAdapter('secret internal boom with password 123'),
      }).listen(0)
      await new Promise<void>((r) => failingApp.once('listening', r))
      const base = `http://127.0.0.1:${(failingApp.address() as AddressInfo).port}`

      const res = await fetch(`${base}/api/creators/fail_alice/mind/collaborations/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'fail_bob', confirm: true }),
      })
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('collaboration execution failed')
      expect(body.error).not.toContain('secret')
      expect(body.error).not.toContain('password')

      const collabs = (await (await fetch(`${base}/api/creators/fail_alice/collaborations`)).json()) as {
        total: number
      }
      expect(collabs.total).toBe(0)
      failingApp.close()
      failingDb.close()
    })
  })
})
