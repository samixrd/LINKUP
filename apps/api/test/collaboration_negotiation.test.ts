import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'

interface CollabBody {
  id: string
  initiatorId: string
  targetId: string
  status: string
  proposal: string
  counterProposal: string | null
  proposedBy: string
  createdAt: string
  updatedAt: string
}

describe('collaboration negotiation API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'negotiator_a', displayName: 'Ada' })
    createCreatorProfile(db, { creatorId: 'negotiator_b', displayName: 'Grace' })
    createCreatorProfile(db, { creatorId: 'negotiator_c', displayName: 'Alan' })
    createCreatorProfile(db, { creatorId: 'negotiator_isolated', displayName: 'Isolated' })
    createCreatorProfile(db, { creatorId: 'negotiator_d', displayName: 'D' })
    createCreatorProfile(db, { creatorId: 'negotiator_e', displayName: 'E' })
    createCreatorProfile(db, { creatorId: 'negotiator_f', displayName: 'F' })
    createCreatorProfile(db, { creatorId: 'negotiator_g', displayName: 'G' })
    createCreatorProfile(db, { creatorId: 'negotiator_h', displayName: 'H' })
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

  const postCounterScoped = (creatorId: string, collabId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collabId}/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const postCounterGlobal = (collabId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/collaborations/${collabId}/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const patchScoped = (creatorId: string, collabId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collabId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const getScoped = (creatorId: string, collabId: string) =>
    fetch(`${baseUrl}/api/creators/${creatorId}/collaborations/${collabId}`)

  const getGlobal = (collabId: string) => fetch(`${baseUrl}/api/collaborations/${collabId}`)

  it('valid counter proposal via scoped endpoint preserves original and sets counter', async () => {
    const createRes = await postCollab('negotiator_a', {
      id: 'negotiation_valid_counter',
      targetId: 'negotiator_b',
      proposal: 'Original proposal',
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as CollabBody
    expect(created.proposal).toBe('Original proposal')
    expect(created.counterProposal).toBeNull()
    expect(created.proposedBy).toBe('negotiator_a')

    const counterRes = await postCounterScoped('negotiator_b', 'negotiation_valid_counter', {
      counterProposal: 'Counter by Grace',
    })
    expect(counterRes.status).toBe(200)
    const countered = (await counterRes.json()) as CollabBody
    expect(countered.status).toBe('countered')
    expect(countered.proposal).toBe('Original proposal')
    expect(countered.counterProposal).toBe('Counter by Grace')
    expect(countered.proposedBy).toBe('negotiator_b')
    expect(countered.updatedAt > created.updatedAt).toBe(true)

    // retrieving current negotiation state shows both
    const getRes = await getScoped('negotiator_a', 'negotiation_valid_counter')
    expect(getRes.status).toBe(200)
    const fetched = (await getRes.json()) as CollabBody
    expect(fetched.counterProposal).toBe('Counter by Grace')
    expect(fetched.proposal).toBe('Original proposal')

    const globalRes = await getGlobal('negotiation_valid_counter')
    expect(globalRes.status).toBe(200)
    const globalFetched = (await globalRes.json()) as CollabBody
    expect(globalFetched.proposedBy).toBe('negotiator_b')
  })

  it('counter can be chained: countered -> countered', async () => {
    const createRes = await postCollab('negotiator_a', {
      id: 'negotiation_chain',
      targetId: 'negotiator_c',
      proposal: 'Original',
    })
    expect(createRes.status).toBe(201)
    const c1 = await postCounterScoped('negotiator_c', 'negotiation_chain', { counterProposal: 'First counter' })
    expect(c1.status).toBe(200)
    const b1 = (await c1.json()) as CollabBody
    expect(b1.counterProposal).toBe('First counter')
    expect(b1.proposedBy).toBe('negotiator_c')

    const c2 = await postCounterScoped('negotiator_a', 'negotiation_chain', { counterProposal: 'Second counter' })
    expect(c2.status).toBe(200)
    const b2 = (await c2.json()) as CollabBody
    expect(b2.counterProposal).toBe('Second counter')
    expect(b2.proposedBy).toBe('negotiator_a')
    expect(b2.proposal).toBe('Original')
  })

  it('invalid transitions: counter from terminal fails', async () => {
    const createRes = await postCollab('negotiator_b', {
      id: 'negotiation_terminal',
      targetId: 'negotiator_c',
      proposal: 'Terminal test',
    })
    expect(createRes.status).toBe(201)
    // accept to terminal
    const acceptRes = await patchScoped('negotiator_b', 'negotiation_terminal', { status: 'accepted' })
    expect(acceptRes.status).toBe(200)
    const counterAfterAccept = await postCounterScoped('negotiator_c', 'negotiation_terminal', {
      counterProposal: 'Should fail',
    })
    expect(counterAfterAccept.status).toBe(400)
    const body = (await counterAfterAccept.json()) as { error: string }
    expect(body.error).toContain('invalid status transition')

    // also patch to countered directly should be blocked
    const directPatch = await patchScoped('negotiator_b', 'negotiation_terminal', { status: 'countered' as string })
    expect(directPatch.status).toBe(400)
  })

  it('terminal-state protection: cannot transition accepted to anything', async () => {
    const createRes = await postCollab('negotiator_isolated', {
      id: 'negotiation_terminal_protect',
      targetId: 'negotiator_d',
      proposal: 'Protect',
    })
    expect(createRes.status).toBe(201)
    const counterRes = await postCounterScoped('negotiator_d', 'negotiation_terminal_protect', {
      counterProposal: 'Counter',
    })
    expect(counterRes.status).toBe(200)
    const acceptRes = await patchScoped('negotiator_isolated', 'negotiation_terminal_protect', { status: 'accepted' })
    expect(acceptRes.status).toBe(200)
    const afterAcceptPatch = await patchScoped('negotiator_isolated', 'negotiation_terminal_protect', { status: 'rejected' })
    expect(afterAcceptPatch.status).toBe(400)
    const afterAcceptCounter = await postCounterScoped('negotiator_d', 'negotiation_terminal_protect', {
      counterProposal: 'Another',
    })
    expect(afterAcceptCounter.status).toBe(400)
  })

  it('proposal history preservation via API: original unchanged after counter', async () => {
    const createRes = await postCollab('negotiator_e', {
      id: 'negotiation_history',
      targetId: 'negotiator_f',
      proposal: 'Original 123',
    })
    expect(createRes.status).toBe(201)
    await postCounterScoped('negotiator_f', 'negotiation_history', { counterProposal: 'Counter 456' })
    const fetched = (await (await getScoped('negotiator_e', 'negotiation_history')).json()) as CollabBody
    expect(fetched.proposal).toBe('Original 123')
    expect(fetched.counterProposal).toBe('Counter 456')
    // try to update proposal directly while countered should fail
    const hack = await patchScoped('negotiator_e', 'negotiation_history', { proposal: 'Hacked' })
    expect(hack.status).toBe(400)
  })

  it('creator isolation: non-participant cannot counter or fetch', async () => {
    const createRes = await postCollab('negotiator_g', {
      id: 'negotiation_isolation',
      targetId: 'negotiator_h',
      proposal: 'Secret',
    })
    expect(createRes.status).toBe(201)
    const counterByIsolated = await postCounterScoped('negotiator_isolated', 'negotiation_isolation', {
      counterProposal: 'Hacked',
    })
    expect(counterByIsolated.status).toBe(404)
    const fetchByIsolated = await getScoped('negotiator_isolated', 'negotiation_isolation')
    expect(fetchByIsolated.status).toBe(404)
    const patchByIsolated = await patchScoped('negotiator_isolated', 'negotiation_isolation', { status: 'accepted' })
    expect(patchByIsolated.status).toBe(404)
    // valid participant succeeds
    const valid = await postCounterScoped('negotiator_h', 'negotiation_isolation', { counterProposal: 'Valid' })
    expect(valid.status).toBe(200)
  })

  it('accept counter proposal', async () => {
    const createRes = await postCollab('negotiator_d', {
      id: 'negotiation_accept',
      targetId: 'negotiator_e',
      proposal: 'Original',
    })
    expect(createRes.status).toBe(201)
    await postCounterScoped('negotiator_e', 'negotiation_accept', { counterProposal: 'Countered proposal' })
    const acceptRes = await patchScoped('negotiator_d', 'negotiation_accept', { status: 'accepted' })
    expect(acceptRes.status).toBe(200)
    const body = (await acceptRes.json()) as CollabBody
    expect(body.status).toBe('accepted')
    expect(body.counterProposal).toBe('Countered proposal')
    expect(body.proposal).toBe('Original')
  })

  it('reject counter proposal', async () => {
    const createRes = await postCollab('negotiator_d', {
      id: 'negotiation_reject',
      targetId: 'negotiator_f',
      proposal: 'Original',
    })
    expect(createRes.status).toBe(201)
    await postCounterScoped('negotiator_f', 'negotiation_reject', { counterProposal: 'Countered proposal' })
    const rejectRes = await patchScoped('negotiator_f', 'negotiation_reject', { status: 'rejected' })
    expect(rejectRes.status).toBe(200)
    const body = (await rejectRes.json()) as CollabBody
    expect(body.status).toBe('rejected')
    expect(body.counterProposal).toBe('Countered proposal')
  })

  it('duplicate/invalid requests: empty, missing, wrong fields', async () => {
    const createRes = await postCollab('negotiator_e', {
      id: 'negotiation_invalid',
      targetId: 'negotiator_g',
      proposal: 'Original',
    })
    expect(createRes.status).toBe(201)

    const emptyCounter = await postCounterScoped('negotiator_g', 'negotiation_invalid', {
      counterProposal: '   ',
    })
    expect(emptyCounter.status).toBe(400)

    const missingBody = await fetch(`${baseUrl}/api/creators/negotiator_g/collaborations/negotiation_invalid/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(missingBody.status).toBe(400)

    const missingCollab = await postCounterScoped('negotiator_g', 'ghost', {
      counterProposal: 'Hello',
    })
    expect(missingCollab.status).toBe(404)

    const missingCreator = await postCounterScoped('ghost', 'negotiation_invalid', {
      counterProposal: 'Hello',
    })
    expect(missingCreator.status).toBe(404)

    // proposal alias also accepted
    const aliasRes = await postCounterScoped('negotiator_g', 'negotiation_invalid', {
      proposal: 'Alias counter',
    })
    expect(aliasRes.status).toBe(200)

    // global endpoint requires proposedBy
    const globalMissingProposedBy = await postCounterGlobal('negotiation_invalid', {
      counterProposal: 'Hi',
    })
    expect(globalMissingProposedBy.status).toBe(400)

    const globalEmpty = await postCounterGlobal('negotiation_invalid', {
      counterProposal: '   ',
      proposedBy: 'negotiator_g',
    })
    expect(globalEmpty.status).toBe(400)

    const globalValid = await postCounterGlobal('negotiation_invalid', {
      counterProposal: 'Global counter',
      proposedBy: 'negotiator_g',
    })
    // after previous alias counter, status is countered, so global counter should still succeed (countered->countered)
    expect(globalValid.status).toBe(200)
  })

  it('retrieving current negotiation state via both endpoints', async () => {
    const createRes = await postCollab('negotiator_h', {
      id: 'negotiation_retrieve',
      targetId: 'negotiator_d',
      proposal: 'Retrieve test',
    })
    expect(createRes.status).toBe(201)
    await postCounterScoped('negotiator_d', 'negotiation_retrieve', { counterProposal: 'Retrieved counter' })
    const scoped = await getScoped('negotiator_h', 'negotiation_retrieve')
    expect(scoped.status).toBe(200)
    const scopedBody = (await scoped.json()) as CollabBody
    expect(scopedBody.status).toBe('countered')
    expect(scopedBody.counterProposal).toBe('Retrieved counter')
    expect(scopedBody.proposedBy).toBe('negotiator_d')

    const global = await getGlobal('negotiation_retrieve')
    expect(global.status).toBe(200)
    const globalBody = (await global.json()) as CollabBody
    expect(globalBody.counterProposal).toBe('Retrieved counter')
  })

  it('MindContext negotiation data includes counter fields', async () => {
    // Use existing negotiation_valid_counter which is between a and b and countered
    const res = await fetch(`${baseUrl}/api/creators/negotiator_a/mind`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      collaborations: { collaborations: CollabBody[] }
    }
    const collab = body.collaborations.collaborations.find((c) => c.id === 'negotiation_valid_counter')
    expect(collab).toBeDefined()
    expect(collab?.proposal).toBe('Original proposal')
    expect(collab?.counterProposal).toBe('Counter by Grace')
    expect(collab?.proposedBy).toBe('negotiator_b')
    expect(collab?.status).toBe('countered')
  })

  it('allows multiple collaborations between creators', async () => {
    const createRes = await postCollab('negotiator_h', {
      id: 'negotiation_dup_active',
      targetId: 'negotiator_f',
      proposal: 'First',
    })
    expect(createRes.status).toBe(201)
    await postCounterScoped('negotiator_f', 'negotiation_dup_active', { counterProposal: 'Counter' })
    const dup = await postCollab('negotiator_h', {
      targetId: 'negotiator_f',
      proposal: 'Second attempt allowed',
    })
    expect(dup.status).toBe(201)
  })

  it('global counter endpoint respects creator isolation via proposedBy', async () => {
    const createRes = await postCollab('negotiator_f', {
      id: 'negotiation_global_isolation',
      targetId: 'negotiator_g',
      proposal: 'Global iso',
    })
    expect(createRes.status).toBe(201)
    const counterByIsolated = await postCounterGlobal('negotiation_global_isolation', {
      counterProposal: 'Hacked',
      proposedBy: 'negotiator_isolated',
    })
    expect(counterByIsolated.status).toBe(400)
    const body = (await counterByIsolated.json()) as { error: string }
    expect(body.error).toContain('must be a participant')
    const valid = await postCounterGlobal('negotiation_global_isolation', {
      counterProposal: 'Valid global',
      proposedBy: 'negotiator_g',
    })
    expect(valid.status).toBe(200)
  })
})
