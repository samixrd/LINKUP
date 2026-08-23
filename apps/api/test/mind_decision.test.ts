import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  listCollaborationProposals,
  listCollaborationsForCreator,
  listCreatorMemories,
  listMindInteractions,
  migrate,
} from '@linkup/db'
import type { MindAdapter, MindContext } from '@linkup/db'
import { createApp } from '../src/app.js'
import {
  createMindDecisionService,
  MAX_COUNTER_PROPOSAL_LENGTH,
} from '../src/services/mind_decision.js'

function recordingAdapter(response: string): MindAdapter & { lastContext?: MindContext; lastInput?: string; calls: number } {
  const adapter: MindAdapter & { lastContext?: MindContext; lastInput?: string; calls: number } = {
    calls: 0,
    async query(context, input) {
      adapter.lastContext = context
      adapter.lastInput = input
      adapter.calls += 1
      return response
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

function jsonDecision(action: string, reasoning: string, counterProposal?: string) {
  const obj: Record<string, unknown> = { action, reasoning }
  if (counterProposal !== undefined) obj.counterProposal = counterProposal
  return JSON.stringify(obj)
}

function seed(db: Database.Database) {
  createCreatorProfile(db, { creatorId: 'dec_a', displayName: 'Alice', bio: 'Pottery' })
  createCreatorProfile(db, { creatorId: 'dec_b', displayName: 'Bob', bio: 'Pottery' })
  createCreatorProfile(db, { creatorId: 'dec_c', displayName: 'Carol', bio: 'Hiking' })
}

describe('mind decision service - structured parsing', () => {
  it('parses accept decision', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_dec_accept', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(jsonDecision('accept', 'Looks good'))
    const service = createMindDecisionService({ db, adapter })
    const decision = await service.decide('dec_a', 'collab_dec_accept')
    expect(decision.action).toBe('accept')
    expect(decision.reasoning).toBe('Looks good')
    expect(decision.counterProposal).toBeUndefined()
    db.close()
  })

  it('parses reject decision', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_dec_reject', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(jsonDecision('reject', 'Not aligned'))
    const service = createMindDecisionService({ db, adapter })
    const decision = await service.decide('dec_a', 'collab_dec_reject')
    expect(decision.action).toBe('reject')
    expect(decision.reasoning).toBe('Not aligned')
    db.close()
  })

  it('parses counter decision with proposal', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_dec_counter', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(jsonDecision('counter', 'Needs tweak', 'How about we do X instead?'))
    const service = createMindDecisionService({ db, adapter })
    const decision = await service.decide('dec_a', 'collab_dec_counter')
    expect(decision.action).toBe('counter')
    expect(decision.reasoning).toBe('Needs tweak')
    expect(decision.counterProposal).toBe('How about we do X instead?')
    db.close()
  })

  it('rejects invalid action', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_invalid_action', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(jsonDecision('maybe', 'Reason'))
    const service = createMindDecisionService({ db, adapter })
    await expect(service.decide('dec_a', 'collab_invalid_action')).rejects.toThrow('invalid action')
    db.close()
  })

  it('rejects malformed JSON', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_malformed', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter('not json at all')
    const service = createMindDecisionService({ db, adapter })
    await expect(service.decide('dec_a', 'collab_malformed')).rejects.toThrow('invalid decision format')
    db.close()
  })

  it('rejects counter without proposal', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_counter_no_proposal', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(jsonDecision('counter', 'Reason only'))
    const service = createMindDecisionService({ db, adapter })
    await expect(service.decide('dec_a', 'collab_counter_no_proposal')).rejects.toThrow('counterProposal is required')
    db.close()
  })

  it('rejects empty reasoning', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_no_reason', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(jsonDecision('accept', '   '))
    const service = createMindDecisionService({ db, adapter })
    await expect(service.decide('dec_a', 'collab_no_reason')).rejects.toThrow('reasoning is required')
    db.close()
  })

  it('rejects overlong counter', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_overlong', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const long = 'a'.repeat(MAX_COUNTER_PROPOSAL_LENGTH + 1)
    const adapter = recordingAdapter(jsonDecision('counter', 'Reason', long))
    const service = createMindDecisionService({ db, adapter })
    await expect(service.decide('dec_a', 'collab_overlong')).rejects.toThrow('must be at most')
    db.close()
  })

  it('ignores arbitrary fields and only returns allowed keys', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_extra', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(JSON.stringify({ action: 'accept', reasoning: 'ok', extra: 'evil', counterProposal: 'should be ignored' }))
    const service = createMindDecisionService({ db, adapter })
    const decision = await service.decide('dec_a', 'collab_extra')
    expect((decision as unknown as Record<string, unknown>).extra).toBeUndefined()
    expect(decision.action).toBe('accept')
    // accept should not have counterProposal even if provided
    expect(decision.counterProposal).toBeUndefined()
    db.close()
  })

  it('includes full negotiation history in prompt deterministically', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_hist_prompt', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'One' })
    const { submitCounterProposal } = await import('@linkup/db')
    submitCounterProposal(db, 'collab_hist_prompt', 'Two', 'dec_b')
    submitCounterProposal(db, 'collab_hist_prompt', 'Three', 'dec_a')
    const adapter = recordingAdapter(jsonDecision('accept', 'ok'))
    const service = createMindDecisionService({ db, adapter })
    await service.decide('dec_a', 'collab_hist_prompt')
    const input = (adapter as { lastInput?: string }).lastInput ?? ''
    expect(input).toContain('One')
    expect(input).toContain('Two')
    expect(input).toContain('Three')
    expect(input).toContain('hist_prompt') // collaboration id
    expect(input).toContain('Full negotiation history')
    // order check
    const idx1 = input.indexOf('One')
    const idx2 = input.indexOf('Two')
    const idx3 = input.indexOf('Three')
    expect(idx1 < idx2 && idx2 < idx3).toBe(true)
    // target context
    expect(input).toContain('Target creator')
    expect(input).toContain('Bob')
    db.close()
  })

  it('creator isolation: non-participant cannot get decision', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_iso', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const adapter = recordingAdapter(jsonDecision('accept', 'ok'))
    const service = createMindDecisionService({ db, adapter })
    await expect(service.decide('dec_c', 'collab_iso')).rejects.toThrow('collaboration not found')
    db.close()
  })

  it('decision is read-only: does not mutate collaboration, history, memories, interactions', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    seed(db)
    createCollaboration(db, { id: 'collab_readonly', initiatorId: 'dec_a', targetId: 'dec_b', proposal: 'Original' })
    const beforeCollab = listCollaborationProposals(db, 'collab_readonly').length
    const beforeMems = listCreatorMemories(db, { creatorId: 'dec_a' }).length
    const beforeInter = listMindInteractions(db, 'dec_a').total
    const beforeCollabs = listCollaborationsForCreator(db, 'dec_a').total

    const adapter = recordingAdapter(jsonDecision('counter', 'needs change', 'New proposal'))
    const service = createMindDecisionService({ db, adapter })
    const decision = await service.decide('dec_a', 'collab_readonly')
    expect(decision.action).toBe('counter')

    expect(listCollaborationProposals(db, 'collab_readonly')).toHaveLength(beforeCollab)
    expect(listCollaborationsForCreator(db, 'dec_a').total).toBe(beforeCollabs)
    expect(listCreatorMemories(db, { creatorId: 'dec_a' })).toHaveLength(beforeMems)
    expect(listMindInteractions(db, 'dec_a').total).toBe(beforeInter)
    // collaboration status unchanged
    const { getCollaboration } = await import('@linkup/db')
    expect(getCollaboration(db, 'collab_readonly')!.status).toBe('pending')
    db.close()
  })
})

describe('mind decision API - read-only and isolation', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string
  let fakeServer: Server
  let fakeBase: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'api_dec_a', displayName: 'Alice', bio: 'Pottery' })
    createCreatorProfile(db, { creatorId: 'api_dec_b', displayName: 'Bob', bio: 'Pottery' })
    createCreatorProfile(db, { creatorId: 'api_dec_c', displayName: 'Carol', bio: 'Hiking' })
    createCollaboration(db, { id: 'api_dec_collab', initiatorId: 'api_dec_a', targetId: 'api_dec_b', proposal: 'Lets collab' })
    createCollaboration(db, { id: 'api_dec_chain', initiatorId: 'api_dec_a', targetId: 'api_dec_c', proposal: 'Chain One' })
    const { submitCounterProposal } = await import('@linkup/db')
    submitCounterProposal(db, 'api_dec_chain', 'Chain Two', 'api_dec_c')
    submitCounterProposal(db, 'api_dec_chain', 'Chain Three', 'api_dec_a')

    const fakeAdapter = recordingAdapter(jsonDecision('accept', 'Good to go'))
    fakeServer = createApp({ db, mindAdapter: fakeAdapter }).listen(0)
    server = createApp({ db }).listen(0)
    await Promise.all([
      new Promise<void>((r) => fakeServer.once('listening', r)),
      new Promise<void>((r) => server.once('listening', r)),
    ])
    fakeBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    fakeServer.close()
    server.close()
    db.close()
  })

  const postDecision = (creatorId: string, collabId: string, base = fakeBase) =>
    fetch(`${base}/api/creators/${creatorId}/mind/collaborations/${collabId}/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

  it('returns structured decision for accept/reject/counter', async () => {
    const res = await postDecision('api_dec_a', 'api_dec_collab')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decision: { action: string; reasoning: string } }
    expect(body.decision.action).toBe('accept')
    expect(body.decision.reasoning).toBe('Good to go')
  })

  it('isolates creator: non-participant gets 404', async () => {
    const res = await postDecision('api_dec_c', 'api_dec_collab')
    expect(res.status).toBe(404)
  })

  it('returns 404 for unknown collaboration', async () => {
    const res = await postDecision('api_dec_a', 'ghost')
    expect(res.status).toBe(404)
  })

  it('is read-only: does not mutate collaboration, history, memories, interactions', async () => {
    const beforeCollab = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/collaborations/api_dec_collab`)).json()) as { status: string }
    const beforeHistory = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/collaborations/api_dec_collab/negotiate/history`)).json()) as { total: number }
    const beforeMems = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/memories`)).json()) as { memories: unknown[] }
    const beforeInter = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/mind/history`)).json()) as { total: number }

    const res = await postDecision('api_dec_a', 'api_dec_collab')
    expect(res.status).toBe(200)

    const afterCollab = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/collaborations/api_dec_collab`)).json()) as { status: string }
    const afterHistory = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/collaborations/api_dec_collab/negotiate/history`)).json()) as { total: number }
    const afterMems = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/memories`)).json()) as { memories: unknown[] }
    const afterInter = (await (await fetch(`${fakeBase}/api/creators/api_dec_a/mind/history`)).json()) as { total: number }

    expect(afterCollab.status).toBe(beforeCollab.status)
    expect(afterHistory.total).toBe(beforeHistory.total)
    expect(afterMems.memories.length).toBe(beforeMems.memories.length)
    expect(afterInter.total).toBe(beforeInter.total)
  })

  it('returns 400 for invalid action from provider', async () => {
    const badDb = createDatabase(':memory:')
    migrate(badDb)
    createCreatorProfile(badDb, { creatorId: 'bad_a', displayName: 'A', bio: 'Pottery' })
    createCreatorProfile(badDb, { creatorId: 'bad_b', displayName: 'B', bio: 'Pottery' })
    createCollaboration(badDb, { id: 'bad_collab', initiatorId: 'bad_a', targetId: 'bad_b', proposal: 'Hi' })
    const badAdapter = recordingAdapter(jsonDecision('maybe', 'reason'))
    const badApp = createApp({ db: badDb, mindAdapter: badAdapter }).listen(0)
    await new Promise<void>((r) => badApp.once('listening', r))
    const base = `http://127.0.0.1:${(badApp.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/bad_a/mind/collaborations/bad_collab/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('invalid action')
    badApp.close()
    badDb.close()
  })

  it('returns 400 for counter without proposal', async () => {
    const badDb = createDatabase(':memory:')
    migrate(badDb)
    createCreatorProfile(badDb, { creatorId: 'bad_a', displayName: 'A', bio: 'Pottery' })
    createCreatorProfile(badDb, { creatorId: 'bad_b', displayName: 'B', bio: 'Pottery' })
    createCollaboration(badDb, { id: 'bad_collab2', initiatorId: 'bad_a', targetId: 'bad_b', proposal: 'Hi' })
    const badAdapter = recordingAdapter(jsonDecision('counter', 'reason'))
    const badApp = createApp({ db: badDb, mindAdapter: badAdapter }).listen(0)
    await new Promise<void>((r) => badApp.once('listening', r))
    const base = `http://127.0.0.1:${(badApp.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/bad_a/mind/collaborations/bad_collab2/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('counterProposal is required')
    badApp.close()
    badDb.close()
  })

  it('returns 400 for overlong counter', async () => {
    const badDb = createDatabase(':memory:')
    migrate(badDb)
    createCreatorProfile(badDb, { creatorId: 'bad_a', displayName: 'A', bio: 'Pottery' })
    createCreatorProfile(badDb, { creatorId: 'bad_b', displayName: 'B', bio: 'Pottery' })
    createCollaboration(badDb, { id: 'bad_collab3', initiatorId: 'bad_a', targetId: 'bad_b', proposal: 'Hi' })
    const long = 'a'.repeat(MAX_COUNTER_PROPOSAL_LENGTH + 1)
    const badAdapter = recordingAdapter(jsonDecision('counter', 'reason', long))
    const badApp = createApp({ db: badDb, mindAdapter: badAdapter }).listen(0)
    await new Promise<void>((r) => badApp.once('listening', r))
    const base = `http://127.0.0.1:${(badApp.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/bad_a/mind/collaborations/bad_collab3/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('must be at most')
    badApp.close()
    badDb.close()
  })

  it('returns 500 without leaking on provider failure', async () => {
    const failDb = createDatabase(':memory:')
    migrate(failDb)
    createCreatorProfile(failDb, { creatorId: 'fail_a', displayName: 'A', bio: 'Pottery' })
    createCreatorProfile(failDb, { creatorId: 'fail_b', displayName: 'B', bio: 'Pottery' })
    createCollaboration(failDb, { id: 'fail_collab', initiatorId: 'fail_a', targetId: 'fail_b', proposal: 'Hi' })
    const failApp = createApp({ db: failDb, mindAdapter: failingAdapter('secret boom') }).listen(0)
    await new Promise<void>((r) => failApp.once('listening', r))
    const base = `http://127.0.0.1:${(failApp.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/fail_a/mind/collaborations/fail_collab/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('negotiation decision failed')
    expect(body.error).not.toContain('secret')
    failApp.close()
    failDb.close()
  })

  it('returns 503 when adapter not configured', async () => {
    const res = await fetch(`${baseUrl}/api/creators/api_dec_a/mind/collaborations/api_dec_collab/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toContain('Minds adapter not configured')
  })

  it('full negotiation history included in prompt for decision', async () => {
    const histDb = createDatabase(':memory:')
    migrate(histDb)
    createCreatorProfile(histDb, { creatorId: 'prompt_a', displayName: 'Alice', bio: 'Pottery' })
    createCreatorProfile(histDb, { creatorId: 'prompt_b', displayName: 'Bob', bio: 'Pottery' })
    createCollaboration(histDb, { id: 'prompt_collab', initiatorId: 'prompt_a', targetId: 'prompt_b', proposal: 'One' })
    const { submitCounterProposal } = await import('@linkup/db')
    submitCounterProposal(histDb, 'prompt_collab', 'Two', 'prompt_b')
    submitCounterProposal(histDb, 'prompt_collab', 'Three', 'prompt_a')
    const adapter = recordingAdapter(jsonDecision('accept', 'ok'))
    const service = createMindDecisionService({ db: histDb, adapter })
    await service.decide('prompt_a', 'prompt_collab')
    const input = (adapter as { lastInput?: string }).lastInput ?? ''
    expect(input).toContain('One')
    expect(input).toContain('Two')
    expect(input).toContain('Three')
    expect(input).toContain('Full negotiation history')
    histDb.close()
  })
})
