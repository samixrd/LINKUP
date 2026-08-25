import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'
import { buildMindPrompt } from '../src/services/mind_provider.js'
import { buildMindContext } from '@linkup/db'

describe('collaboration proposals API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'hist_a', displayName: 'Alice', bio: 'Pottery' })
    createCreatorProfile(db, { creatorId: 'hist_b', displayName: 'Bob', bio: 'Pottery' })
    createCreatorProfile(db, { creatorId: 'hist_c', displayName: 'Carol', bio: 'Hiking' })
    createCreatorProfile(db, { creatorId: 'hist_d', displayName: 'Dave', bio: 'Art' })
    createCreatorProfile(db, { creatorId: 'hist_e', displayName: 'Eve', bio: 'Music' })
    createCreatorProfile(db, { creatorId: 'hist_f', displayName: 'Frank', bio: 'Dance' })
    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  const postCollab = (creatorId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const postCounter = (creatorId: string, collabId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collabId}/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const getHistory = (creatorId: string, collabId: string) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collabId}/negotiate/history`)

  it('initial proposal creates seq=1 and history is deterministic', async () => {
    const res = await postCollab('hist_a', { id: 'hist_init', targetId: 'hist_b', proposal: 'First proposal' })
    expect(res.status).toBe(201)
    const historyRes = await getHistory('hist_a', 'hist_init')
    expect(historyRes.status).toBe(200)
    const body = (await historyRes.json()) as { proposals: Array<{ seq: number; proposal: string; authorId: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.proposals).toHaveLength(1)
    expect(body.proposals[0]!.seq).toBe(1)
    expect(body.proposals[0]!.proposal).toBe('First proposal')
    expect(body.proposals[0]!.authorId).toBe('hist_a')
  })

  it('chained counters create seq=2,3,4 and history remains ordered', async () => {
    const res = await postCollab('hist_a', { id: 'hist_chain', targetId: 'hist_c', proposal: 'One' })
    expect(res.status).toBe(201)
    await postCounter('hist_c', 'hist_chain', { counterProposal: 'Two' })
    await postCounter('hist_a', 'hist_chain', { counterProposal: 'Three' })
    await postCounter('hist_c', 'hist_chain', { counterProposal: 'Four' })
    const historyRes = await getHistory('hist_a', 'hist_chain')
    expect(historyRes.status).toBe(200)
    const body = (await historyRes.json()) as { proposals: Array<{ seq: number; proposal: string; authorId: string }>; total: number }
    expect(body.proposals.map((p) => p.seq)).toEqual([1, 2, 3, 4])
    expect(body.proposals.map((p) => p.proposal)).toEqual(['One', 'Two', 'Three', 'Four'])
    expect(body.proposals.map((p) => p.authorId)).toEqual(['hist_a', 'hist_c', 'hist_a', 'hist_c'])
    // deterministic ordering: seq ASC, id ASC already ensured by repository
  })

  it('old counter_proposal remains synchronized with history', async () => {
    const res = await postCollab('hist_b', { id: 'hist_sync', targetId: 'hist_c', proposal: 'Original' })
    expect(res.status).toBe(201)
    const c1 = await postCounter('hist_c', 'hist_sync', { counterProposal: 'Counter 2' })
    expect(c1.status).toBe(200)
    const collab1 = (await c1.json()) as { counterProposal: string; proposedBy: string }
    expect(collab1.counterProposal).toBe('Counter 2')
    let history = (await (await getHistory('hist_b', 'hist_sync')).json()) as { proposals: Array<{ proposal: string }> }
    expect(history.proposals[1]!.proposal).toBe('Counter 2')

    const c2 = await postCounter('hist_b', 'hist_sync', { counterProposal: 'Counter 3' })
    expect(c2.status).toBe(200)
    const collab2 = (await c2.json()) as { counterProposal: string }
    expect(collab2.counterProposal).toBe('Counter 3')
    history = (await (await getHistory('hist_b', 'hist_sync')).json()) as { proposals: Array<{ proposal: string }> }
    expect(history.proposals.map((p) => p.proposal)).toEqual(['Original', 'Counter 2', 'Counter 3'])
  })

  it('terminal collaboration cannot append', async () => {
    const res = await postCollab('hist_a', { id: 'hist_term', targetId: 'hist_d', proposal: 'Term' })
    expect(res.status).toBe(201)
    const patch = await fetch(`${baseUrl}/api/creators/hist_a/collaborations/hist_term`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    })
    expect(patch.status).toBe(200)
    const counterRes = await postCounter('hist_d', 'hist_term', { counterProposal: 'Should fail' })
    expect(counterRes.status).toBe(400)
    const historyRes = await getHistory('hist_a', 'hist_term')
    expect(historyRes.status).toBe(200)
    const body = (await historyRes.json()) as { total: number }
    expect(body.total).toBe(1)
  })

  it('history endpoint isolation and 404', async () => {
    const res = await postCollab('hist_b', { id: 'hist_iso', targetId: 'hist_d', proposal: 'Secret' })
    expect(res.status).toBe(201)
    const iso = await getHistory('hist_c', 'hist_iso')
    expect(iso.status).toBe(404)
    const ghostCollab = await getHistory('hist_b', 'ghost')
    expect(ghostCollab.status).toBe(404)
    const ghostCreator = await getHistory('ghost', 'hist_iso')
    expect(ghostCreator.status).toBe(404)
    const valid = await getHistory('hist_d', 'hist_iso')
    expect(valid.status).toBe(200)
  })

  it('Mind context contains complete negotiation history', async () => {
    const res = await postCollab('hist_c', { id: 'hist_mind', targetId: 'hist_d', proposal: 'Mind One' })
    expect(res.status).toBe(201)
    await postCounter('hist_d', 'hist_mind', { counterProposal: 'Mind Two' })
    await postCounter('hist_c', 'hist_mind', { counterProposal: 'Mind Three' })
    const ctxRes = await fetch(`${baseUrl}/api/creators/hist_c/mind`)
    expect(ctxRes.status).toBe(200)
    const body = (await ctxRes.json()) as { negotiationHistory: Array<{ seq: number; proposal: string; collaborationId: string }> }
    expect(Array.isArray(body.negotiationHistory)).toBe(true)
    const relevant = body.negotiationHistory.filter((p) => p.collaborationId === 'hist_mind')
    expect(relevant.map((p) => p.seq)).toEqual([1, 2, 3])
    expect(relevant.map((p) => p.proposal)).toEqual(['Mind One', 'Mind Two', 'Mind Three'])
  })

  it('Mind prompt keeps the creator question and stays personal (history lives in MindContext, not the chat prompt)', async () => {
    const collabRes = await postCollab('hist_a', { id: 'hist_prompt', targetId: 'hist_e', proposal: 'Prompt One' })
    expect(collabRes.status).toBe(201)
    await postCounter('hist_e', 'hist_prompt', { counterProposal: 'Prompt Two' })
    await postCounter('hist_a', 'hist_prompt', { counterProposal: 'Prompt Three' })
    const ctx = buildMindContext(db, 'hist_a')
    // The structured context still carries the full ordered history for
    // deterministic consumers; the chat prompt itself is now conversational.
    const relevant = ctx.negotiationHistory.filter((h) => h.collaborationId === 'hist_prompt')
    expect(relevant.map((h) => h.proposal)).toEqual(['Prompt One', 'Prompt Two', 'Prompt Three'])
    const prompt = buildMindPrompt(ctx, 'What is next?')
    expect(prompt).toContain('What is next?')
  })

  it('deterministic ordering: history always seq ASC', async () => {
    const res = await postCollab('hist_b', { id: 'hist_order', targetId: 'hist_e', proposal: 'A' })
    expect(res.status).toBe(201)
    await postCounter('hist_e', 'hist_order', { counterProposal: 'B' })
    await postCounter('hist_b', 'hist_order', { counterProposal: 'C' })
    const historyRes = await getHistory('hist_b', 'hist_order')
    const body = (await historyRes.json()) as { proposals: Array<{ seq: number }> }
    const seqs = body.proposals.map((p) => p.seq)
    const sorted = [...seqs].sort((a, b) => a - b)
    expect(seqs).toEqual(sorted)
  })
})
