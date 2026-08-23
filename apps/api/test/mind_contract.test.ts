import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MindsApiError } from '@animocabrands/minds-client-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCollaboration, createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import type { MindAdapter } from '@linkup/db'
import { createApp } from '../src/app.js'

function jsonDecision(action: string, reasoning: string, counterProposal?: string) {
  const o: Record<string, unknown> = { action, reasoning }
  if (counterProposal !== undefined) o.counterProposal = counterProposal
  return JSON.stringify(o)
}

describe('mocked-provider contract - all Mind flows', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'contract_a', displayName: 'Alice', bio: 'Pottery and hiking' })
    createCreatorProfile(db, { creatorId: 'contract_b', displayName: 'Bob', bio: 'Pottery collector' })
    createCreatorProfile(db, { creatorId: 'contract_c', displayName: 'Carol', bio: 'Hiking trails' })
    createCollaboration(db, { id: 'contract_collab', initiatorId: 'contract_a', targetId: 'contract_b', proposal: 'Original' })
    // Import here to avoid circular
    const { submitCounterProposal } = await import('@linkup/db')
    submitCounterProposal(db, 'contract_collab', 'Counter 2', 'contract_b')

    const adapter: MindAdapter = {
      async query(_context, input) {
        // Route based on input content to simulate different flows
        if (input.includes('Draft a collaboration proposal')) {
          return 'Contract collaboration proposal'
        }
        if (input.includes('Draft a thoughtful counter-proposal')) {
          return 'Contract counter proposal'
        }
        if (input.includes('MUST output ONLY a JSON object')) {
          return jsonDecision('accept', 'Contract reasoning')
        }
        return 'Hello from Mind'
      },
    }
    server = createApp({ db, mindAdapter: adapter }).listen(0)
    await new Promise<void>((r) => server.once('listening', r))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  it('query success returns 200 with answer', async () => {
    const res = await fetch(`${baseUrl}/api/creators/contract_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { answer: string }
    expect(body.answer).toBe('Hello from Mind')
  })

  it('collaboration preview success returns 200 with proposal', async () => {
    const res = await fetch(`${baseUrl}/api/creators/contract_a/mind/collaborations/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { preview: { proposal: string } }
    expect(body.preview.proposal).toBe('Contract collaboration proposal')
  })

  it('negotiation preview success returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/creators/contract_a/mind/collaborations/contract_collab/negotiate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { preview: { proposal: string } }
    expect(body.preview.proposal).toBe('Contract counter proposal')
  })

  it('decision success returns structured decision', async () => {
    const res = await fetch(`${baseUrl}/api/creators/contract_a/mind/collaborations/contract_collab/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decision: { action: string; reasoning: string } }
    expect(body.decision.action).toBe('accept')
    expect(body.decision.reasoning).toBe('Contract reasoning')
  })

  it('timeout is mapped to 500 without leaking', async () => {
    const timeoutDb = createDatabase(':memory:')
    migrate(timeoutDb)
    createCreatorProfile(timeoutDb, { creatorId: 'timeout_a', displayName: 'Timeout' })
    const timeoutAdapter: MindAdapter = {
      async query() {
        throw new Error('Minds provider timed out waiting for a reply')
      },
    }
    const app = createApp({ db: timeoutDb, mindAdapter: timeoutAdapter }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/timeout_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('mind query failed')
    expect(body.error).not.toContain('timed out')
    app.close()
    timeoutDb.close()
  })

  it('malformed response (empty) is handled for collaboration preview', async () => {
    const emptyDb = createDatabase(':memory:')
    migrate(emptyDb)
    createCreatorProfile(emptyDb, { creatorId: 'empty_a', displayName: 'Empty' })
    createCreatorProfile(emptyDb, { creatorId: 'empty_b', displayName: 'EmptyB', bio: 'Pottery' })
    // Need a match, so create memory for pottery
    const { addCreatorMemory } = await import('@linkup/db')
    addCreatorMemory(emptyDb, { id: 'mem_a', creatorId: 'empty_a', category: 'preference', content: 'Pottery is fun' })
    addCreatorMemory(emptyDb, { id: 'mem_b', creatorId: 'empty_b', category: 'preference', content: 'Pottery collector' })
    const emptyAdapter: MindAdapter = {
      async query() {
        return '   '
      },
    }
    const app = createApp({ db: emptyDb, mindAdapter: emptyAdapter }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/empty_a/mind/collaborations/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('adapter returned an empty')
    app.close()
    emptyDb.close()
  })

  it('malformed decision JSON is 400 without leaking', async () => {
    const badDb = createDatabase(':memory:')
    migrate(badDb)
    createCreatorProfile(badDb, { creatorId: 'bad_a', displayName: 'Bad' })
    createCreatorProfile(badDb, { creatorId: 'bad_b', displayName: 'BadB' })
    createCollaboration(badDb, { id: 'bad_collab', initiatorId: 'bad_a', targetId: 'bad_b', proposal: 'Hi' })
    const badAdapter: MindAdapter = {
      async query() {
        return 'not json at all'
      },
    }
    const app = createApp({ db: badDb, mindAdapter: badAdapter }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/bad_a/mind/collaborations/bad_collab/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('invalid decision format')
    expect(body.error).not.toContain('not json')
    app.close()
    badDb.close()
  })

  it('provider MindsApiError is mapped to clean 500 without leaking key', async () => {
    const errDb = createDatabase(':memory:')
    migrate(errDb)
    createCreatorProfile(errDb, { creatorId: 'err_a', displayName: 'Err' })
    const errAdapter: MindAdapter = {
      async query() {
        throw new MindsApiError({ status: 401, code: 'unauthorized', message: 'invalid key sk-secret-123' })
      },
    }
    const app = createApp({ db: errDb, mindAdapter: errAdapter }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/err_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('mind query failed')
    expect(body.error).not.toContain('sk-secret')
    expect(body.error).not.toContain('unauthorized')
    app.close()
    errDb.close()
  })

  it('empty provider response for negotiation preview is 400', async () => {
    const emptyDb = createDatabase(':memory:')
    migrate(emptyDb)
    createCreatorProfile(emptyDb, { creatorId: 'empty2_a', displayName: 'Empty2' })
    createCreatorProfile(emptyDb, { creatorId: 'empty2_b', displayName: 'Empty2B' })
    createCollaboration(emptyDb, { id: 'empty2_collab', initiatorId: 'empty2_a', targetId: 'empty2_b', proposal: 'Hi' })
    const emptyAdapter: MindAdapter = {
      async query() {
        return '   '
      },
    }
    const app = createApp({ db: emptyDb, mindAdapter: emptyAdapter }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/empty2_a/mind/collaborations/empty2_collab/negotiate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('adapter returned an empty')
    app.close()
    emptyDb.close()
  })

  it('all mutation paths require explicit human confirmation', async () => {
    const mutDb = createDatabase(':memory:')
    migrate(mutDb)
    createCreatorProfile(mutDb, { creatorId: 'mut_a', displayName: 'MutA', bio: 'Pottery' })
    createCreatorProfile(mutDb, { creatorId: 'mut_b', displayName: 'MutB', bio: 'Pottery' })
    const { addCreatorMemory } = await import('@linkup/db')
    addCreatorMemory(mutDb, { id: 'mut_mem_a', creatorId: 'mut_a', category: 'preference', content: 'Pottery' })
    addCreatorMemory(mutDb, { id: 'mut_mem_b', creatorId: 'mut_b', category: 'preference', content: 'Pottery' })
    const adapter: MindAdapter = {
      async query(_context, input) {
        if (typeof input === 'string' && input.includes('MUST output ONLY a JSON object')) {
          return JSON.stringify({ action: 'accept', reasoning: 'ok' })
        }
        return 'Proposal'
      },
    }
    const app = createApp({ db: mutDb, mindAdapter: adapter }).listen(0)
    await new Promise<void>((r) => app.once('listening', r))
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`

    // preview is dry-run, no confirm needed, should not mutate
    const previewRes = await fetch(`${base}/api/creators/mut_a/mind/collaborations/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(previewRes.status).toBe(200)
    let list = (await (await fetch(`${base}/api/creators/mut_a/collaborations`)).json()) as { total: number }
    expect(list.total).toBe(0)

    // execute without confirm should 400
    const noConfirm = await fetch(`${base}/api/creators/mut_a/mind/collaborations/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'mut_b', confirm: false }),
    })
    expect(noConfirm.status).toBe(400)

    // execute with confirm should 201
    const exec = await fetch(`${base}/api/creators/mut_a/mind/collaborations/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'mut_b', confirm: true }),
    })
    expect(exec.status).toBe(201)
    list = (await (await fetch(`${base}/api/creators/mut_a/collaborations`)).json()) as { total: number }
    expect(list.total).toBe(1)
    const collabId = ((await exec.json()) as { collaboration: { id: string } }).collaboration.id

    // negotiation counter without confirm should 400 and not mutate history
    const beforeHistory = (await (await fetch(`${base}/api/creators/mut_a/collaborations/${collabId}/negotiate/history`)).json()) as { total: number }
    const noConfirmCounter = await fetch(`${base}/api/creators/mut_a/mind/collaborations/${collabId}/negotiate/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    })
    expect(noConfirmCounter.status).toBe(400)
    const afterHistory = (await (await fetch(`${base}/api/creators/mut_a/collaborations/${collabId}/negotiate/history`)).json()) as { total: number }
    expect(afterHistory.total).toBe(beforeHistory.total)

    // decision is read-only
    const beforeTotal = (await (await fetch(`${base}/api/creators/mut_a/collaborations`)).json()) as { total: number }
    const decisionRes = await fetch(`${base}/api/creators/mut_a/mind/collaborations/${collabId}/negotiate/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(decisionRes.status).toBe(200)
    const afterTotal = (await (await fetch(`${base}/api/creators/mut_a/collaborations`)).json()) as { total: number }
    expect(afterTotal.total).toBe(beforeTotal.total)

    app.close()
    mutDb.close()
  })
})
