import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  listCollaborationsForCreator,
  listCreatorMemories,
  listMindInteractions,
  migrate,
  updateCollaborationStatus,
} from '@linkup/db'
import type { MindAdapter, MindContext } from '@linkup/db'
import { createApp } from '../src/app.js'
import { createMindNegotiationService, MAX_COUNTER_PROPOSAL_LENGTH } from '../src/services/mind_negotiation.js'

const FAKE_COUNTER = 'How about a joint live stream instead?'

interface RecordingAdapter extends MindAdapter {
  lastContext?: MindContext
  lastInput?: string
  calls: number
}

function recordingAdapter(proposal: string = FAKE_COUNTER): RecordingAdapter {
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

function seedGraph(db: Database.Database) {
  createCreatorProfile(db, { creatorId: 'neg_mind_a', displayName: 'Alice', bio: 'Loves pottery' })
  createCreatorProfile(db, { creatorId: 'neg_mind_b', displayName: 'Bob', bio: 'Pottery collector' })
  createCreatorProfile(db, { creatorId: 'neg_mind_c', displayName: 'Carol', bio: 'Hiking' })
}

describe('mind negotiation service', () => {
  it('previewCounter drafts a counter-proposal without mutating', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_preview', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    const fake = recordingAdapter()
    const service = createMindNegotiationService({ db, adapter: fake })
    const collabsBefore = listCollaborationsForCreator(db, 'neg_mind_a')
    const historyBefore = listMindInteractions(db, 'neg_mind_a')

    const preview = await service.previewCounter('neg_mind_a', 'collab_preview')
    expect(preview.collaborationId).toBe('collab_preview')
    expect(preview.originalProposal).toBe('Original')
    expect(preview.currentProposal).toBe('Original')
    expect(preview.proposal).toBe(FAKE_COUNTER)
    expect(fake.lastContext?.creator.creatorId).toBe('neg_mind_a')
    expect(fake.lastInput).toContain('Original')

    const collabsAfter = listCollaborationsForCreator(db, 'neg_mind_a')
    const historyAfter = listMindInteractions(db, 'neg_mind_a')
    expect(collabsAfter.total).toBe(collabsBefore.total)
    expect(historyAfter.total).toBe(historyBefore.total)
    db.close()
  })

  it('previewCounter throws for non-participant and unknown collaboration', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_iso', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    const service = createMindNegotiationService({ db, adapter: recordingAdapter() })
    await expect(service.previewCounter('neg_mind_c', 'collab_iso')).rejects.toThrow('collaboration not found')
    await expect(service.previewCounter('neg_mind_a', 'ghost')).rejects.toThrow('collaboration not found: ghost')
    db.close()
  })

  it('previewCounter throws when collaboration is terminal', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_term', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    updateCollaborationStatus(db, 'collab_term', 'accepted')
    const service = createMindNegotiationService({ db, adapter: recordingAdapter() })
    await expect(service.previewCounter('neg_mind_a', 'collab_term')).rejects.toThrow('cannot counter proposal in status accepted')
    db.close()
  })

  it('previewCounter propagates adapter failures and empty/over-long', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_fail', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    const boom = createMindNegotiationService({ db, adapter: failingAdapter('provider boom') })
    await expect(boom.previewCounter('neg_mind_a', 'collab_fail')).rejects.toThrow('provider boom')

    const empty = createMindNegotiationService({ db, adapter: recordingAdapter('   ') })
    await expect(empty.previewCounter('neg_mind_a', 'collab_fail')).rejects.toThrow('adapter returned an empty counter-proposal')

    const overLong = createMindNegotiationService({ db, adapter: recordingAdapter('a'.repeat(MAX_COUNTER_PROPOSAL_LENGTH + 1)) })
    await expect(overLong.previewCounter('neg_mind_a', 'collab_fail')).rejects.toThrow('adapter returned an over-long counter-proposal')
    db.close()
  })

  it('executeCounter requires explicit confirmation and records history', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_exec', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    const service = createMindNegotiationService({ db, adapter: recordingAdapter() })
    await expect(service.executeCounter('neg_mind_a', 'collab_exec', { confirm: false } as never)).rejects.toThrow('confirmation is required')
    // valid execute by target
    const updated = await service.executeCounter('neg_mind_b', 'collab_exec', { confirm: true })
    expect(updated.status).toBe('countered')
    expect(updated.counterProposal).toBe(FAKE_COUNTER)
    expect(updated.proposedBy).toBe('neg_mind_b')
    expect(updated.proposal).toBe('Original')
    const history = listMindInteractions(db, 'neg_mind_b')
    expect(history.total).toBe(2)
    expect(history.interactions[0]?.content).toContain('Drafted counter-proposal')
    expect(history.interactions[1]?.content).toContain('Confirmed counter-proposal')
    const memories = listCreatorMemories(db, { creatorId: 'neg_mind_b' })
    expect(memories.length).toBe(0) // no auto memory
    db.close()
  })

  it('executeCounter does not create anything when adapter fails', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_adapter_fail', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    const service = createMindNegotiationService({ db, adapter: failingAdapter('boom') })
    await expect(service.executeCounter('neg_mind_b', 'collab_adapter_fail', { confirm: true })).rejects.toThrow('boom')
    expect(listMindInteractions(db, 'neg_mind_b').total).toBe(0)
    const collab = listCollaborationsForCreator(db, 'neg_mind_a').collaborations[0]
    expect(collab?.status).toBe('pending')
    db.close()
  })

  it('executeCounter respects terminal protection', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_term_exec', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    updateCollaborationStatus(db, 'collab_term_exec', 'cancelled')
    const service = createMindNegotiationService({ db, adapter: recordingAdapter() })
    await expect(service.executeCounter('neg_mind_b', 'collab_term_exec', { confirm: true })).rejects.toThrow('cannot counter proposal in status cancelled')
    db.close()
  })

  it('context is creator-scoped for negotiation', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seedGraph(db)
    createCollaboration(db, { id: 'collab_scope', initiatorId: 'neg_mind_a', targetId: 'neg_mind_b', proposal: 'Original' })
    const { addCreatorMemory } = await import('@linkup/db')
    addCreatorMemory(db, { id: 'alice_mem', creatorId: 'neg_mind_a', category: 'preference', content: 'Alice secret' })
    addCreatorMemory(db, { id: 'bob_mem', creatorId: 'neg_mind_b', category: 'preference', content: 'Bob secret' })
    const fake = recordingAdapter()
    const service = createMindNegotiationService({ db, adapter: fake })
    await service.previewCounter('neg_mind_a', 'collab_scope')
    expect(fake.lastContext?.memories.some((m) => m.id === 'alice_mem')).toBe(true)
    expect(fake.lastContext?.memories.some((m) => m.id === 'bob_mem')).toBe(false)
    db.close()
  })
})

describe('mind negotiation API', () => {
  const db = createDatabase(':memory:')
  let fakeServer: Server
  let defaultServer: Server
  let fakeBase: string
  let defaultBase: string
  const fake = recordingAdapter()

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'api_neg_a', displayName: 'Alice', bio: 'Loves pottery' })
    createCreatorProfile(db, { creatorId: 'api_neg_b', displayName: 'Bob', bio: 'Pottery collector' })
    createCreatorProfile(db, { creatorId: 'api_neg_c', displayName: 'Carol', bio: 'Hiking' })
    createCollaboration(db, { id: 'api_neg_collab', initiatorId: 'api_neg_a', targetId: 'api_neg_b', proposal: 'Lets collaborate' })
    createCollaboration(db, { id: 'api_neg_terminal', initiatorId: 'api_neg_a', targetId: 'api_neg_c', proposal: 'Terminal' })
    updateCollaborationStatus(db, 'api_neg_terminal', 'accepted')
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

  const postPreview = (creatorId: string, collabId: string) =>
    fetch(`${fakeBase}/api/creators/${creatorId}/mind/collaborations/${collabId}/negotiate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

  const postCounter = (creatorId: string, collabId: string, body: Record<string, unknown>) =>
    fetch(`${fakeBase}/api/creators/${creatorId}/mind/collaborations/${collabId}/negotiate/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('preview returns drafted counter and does not mutate', async () => {
    const before = (await (await fetch(`${fakeBase}/api/creators/api_neg_a/collaborations/api_neg_collab`)).json()) as { counterProposal: string | null }
    const res = await postPreview('api_neg_b', 'api_neg_collab')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { preview: { proposal: string; collaborationId: string } }
    expect(body.preview.proposal).toBe(FAKE_COUNTER)
    expect(body.preview.collaborationId).toBe('api_neg_collab')
    const after = (await (await fetch(`${fakeBase}/api/creators/api_neg_a/collaborations/api_neg_collab`)).json()) as { counterProposal: string | null }
    expect(after.counterProposal).toBe(before.counterProposal)
  })

  it('preview returns 404 for non-participant or unknown', async () => {
    const unknown = await postPreview('api_neg_c', 'api_neg_collab')
    expect(unknown.status).toBe(404)
    const ghostCollab = await postPreview('api_neg_a', 'ghost')
    expect(ghostCollab.status).toBe(404)
  })

  it('preview returns 400 for terminal status', async () => {
    const res = await postPreview('api_neg_a', 'api_neg_terminal')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('cannot counter proposal in status')
  })

  it('preview returns 503 when no adapter', async () => {
    const res = await fetch(`${defaultBase}/api/creators/api_neg_a/mind/collaborations/api_neg_collab/negotiate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(503)
  })

  it('preview returns 500 without leaking on adapter failure', async () => {
    const failingDb = createDatabase(':memory:')
    migrate(failingDb)
    createCreatorProfile(failingDb, { creatorId: 'fail_a', displayName: 'A', bio: 'Loves pottery' })
    createCreatorProfile(failingDb, { creatorId: 'fail_b', displayName: 'B', bio: 'Pottery' })
    createCollaboration(failingDb, { id: 'fail_collab', initiatorId: 'fail_a', targetId: 'fail_b', proposal: 'Hi' })
    const app = createApp({ db: failingDb, mindAdapter: failingAdapter('secret boom') }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/fail_b/mind/collaborations/fail_collab/negotiate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('negotiation preview failed')
    expect(body.error).not.toContain('secret')
    app.close()
    failingDb.close()
  })

  it('counter requires confirmation', async () => {
    const missing = await postCounter('api_neg_b', 'api_neg_collab', {})
    expect(missing.status).toBe(400)
    const falseConfirm = await postCounter('api_neg_b', 'api_neg_collab', { confirm: false })
    expect(falseConfirm.status).toBe(400)
  })

  it('counter creates counter-proposal with human confirmation and records history', async () => {
    const res = await postCounter('api_neg_b', 'api_neg_collab', { confirm: true })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { collaboration: { counterProposal: string; proposedBy: string; status: string } }
    expect(body.collaboration.counterProposal).toBe(FAKE_COUNTER)
    expect(body.collaboration.proposedBy).toBe('api_neg_b')
    expect(body.collaboration.status).toBe('countered')
    const history = (await (await fetch(`${fakeBase}/api/creators/api_neg_b/mind/history`)).json()) as { interactions: { content: string }[] }
    expect(history.interactions.some((i) => i.content.includes('Drafted counter-proposal'))).toBe(true)
    expect(history.interactions.some((i) => i.content.includes('Confirmed counter-proposal'))).toBe(true)
  })

  it('counter returns 404 for non-participant', async () => {
    const res = await postCounter('api_neg_c', 'api_neg_collab', { confirm: true })
    expect(res.status).toBe(404)
  })

  it('counter returns 503 when no adapter', async () => {
    const res = await fetch(`${defaultBase}/api/creators/api_neg_b/mind/collaborations/api_neg_collab/negotiate/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    expect(res.status).toBe(503)
  })

  it('counter does not mutate on adapter failure', async () => {
    const failingDb = createDatabase(':memory:')
    migrate(failingDb)
    createCreatorProfile(failingDb, { creatorId: 'fail_a', displayName: 'A', bio: 'Loves pottery' })
    createCreatorProfile(failingDb, { creatorId: 'fail_b', displayName: 'B', bio: 'Pottery' })
    createCollaboration(failingDb, { id: 'fail_collab2', initiatorId: 'fail_a', targetId: 'fail_b', proposal: 'Hi' })
    const app = createApp({ db: failingDb, mindAdapter: failingAdapter('secret boom') }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/fail_b/mind/collaborations/fail_collab2/negotiate/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    expect(res.status).toBe(500)
    const collab = (await (await fetch(`${base}/api/creators/fail_a/collaborations/fail_collab2`)).json()) as { status: string }
    expect(collab.status).toBe('pending')
    app.close()
    failingDb.close()
  })

  it('no mutation without explicit confirmation via preview', async () => {
    // preview already tested to not mutate; ensure counter without confirm fails and does not mutate
    const before = (await (await fetch(`${fakeBase}/api/creators/api_neg_a/mind/history`)).json()) as { total: number }
    const res = await fetch(`${fakeBase}/api/creators/api_neg_a/mind/collaborations/api_neg_collab/negotiate/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const after = (await (await fetch(`${fakeBase}/api/creators/api_neg_a/mind/history`)).json()) as { total: number }
    expect(after.total).toBe(before.total)
  })
})
