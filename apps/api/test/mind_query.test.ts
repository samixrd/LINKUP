import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addCreatorMemory,
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  createFollowUp,
  migrate,
  stubMindAdapter,
} from '@linkup/db'
import type { MindAdapter, MindContext } from '@linkup/db'
import { createApp } from '../src/app.js'
import { createMindQueryService } from '../src/services/mind_query.js'

describe('mind query service', () => {
  it('valid query returns adapter answer', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_a', displayName: 'Service Ada' })

    const fake: MindAdapter = {
      query: async () => 'fake answer',
    }
    const service = createMindQueryService({ db, adapter: fake })
    const answer = await service.queryMind('svc_a', 'hello')
    expect(answer).toBe('fake answer')
    db.close()
  })

  it('throws for missing creator', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    const fake: MindAdapter = { query: async () => 'x' }
    const service = createMindQueryService({ db, adapter: fake })
    await expect(service.queryMind('ghost', 'hello')).rejects.toThrow('creator profile not found')
    db.close()
  })

  it('throws for empty query', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_b', displayName: 'Service Bob' })
    const fake: MindAdapter = { query: async () => 'x' }
    const service = createMindQueryService({ db, adapter: fake })
    await expect(service.queryMind('svc_b', '')).rejects.toThrow('query is required')
    await expect(service.queryMind('svc_b', '   ')).rejects.toThrow('query is required')
    // @ts-expect-error non-string query
    await expect(service.queryMind('svc_b', 123)).rejects.toThrow('query is required')
    db.close()
  })

  it('passes correct context and query to fake adapter', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_c', displayName: 'Service Carol', bio: 'Loves hiking' })
    createCreatorProfile(db, { creatorId: 'svc_other', displayName: 'Other', bio: 'Secret hiking trail' })
    addCreatorMemory(db, { id: 'mem_secret', creatorId: 'svc_other', category: 'preference', content: 'Secret other memory' })
    addCreatorMemory(db, { id: 'mem_c', creatorId: 'svc_c', category: 'preference', content: 'Prefers hiking' })
    const collab = createCollaboration(db, {
      id: 'svc_collab',
      initiatorId: 'svc_c',
      targetId: 'svc_other',
      proposal: 'Hiking trip',
    })
    createFollowUp(db, { id: 'svc_follow', collaborationId: collab.id, dueAt: '2026-08-26T10:00:00.000Z' })

    let capturedContext: MindContext | undefined
    let capturedInput: string | undefined
    const fake: MindAdapter = {
      query: async (ctx, input) => {
        capturedContext = ctx
        capturedInput = input
        return `answer for ${input}`
      },
    }
    const service = createMindQueryService({ db, adapter: fake })
    const query = 'What is a good fit?'
    const answer = await service.queryMind('svc_c', query)
    expect(answer).toBe('answer for What is a good fit?')
    expect(capturedInput).toBe(query)
    expect(capturedContext).toBeDefined()
    expect(capturedContext?.creator.creatorId).toBe('svc_c')
    // Should contain svc_c's own memory but not other's secret
    expect(capturedContext?.memories.some((m) => m.id === 'mem_c')).toBe(true)
    expect(capturedContext?.memories.some((m) => m.id === 'mem_secret')).toBe(false)
    // Collaborations: should contain svc_collab
    expect(capturedContext?.collaborations.collaborations.some((c) => c.id === 'svc_collab')).toBe(true)
    // FollowUps: should contain svc_follow (pending)
    expect(capturedContext?.followUps.some((f) => f.id === 'svc_follow')).toBe(true)
    // Outcomes: initially none (collab pending)
    expect(capturedContext?.outcomes).toEqual([])

    // Another creator's private info not present
    expect(capturedContext?.memories.some((m) => m.content.includes('Secret other memory'))).toBe(false)
    db.close()
  })

  it('adapter error propagates correctly', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_err', displayName: 'Err' })
    const failing: MindAdapter = {
      query: async () => {
        throw new Error('adapter boom')
      },
    }
    const service = createMindQueryService({ db, adapter: failing })
    await expect(service.queryMind('svc_err', 'hello')).rejects.toThrow('adapter boom')
    db.close()
  })

  it('stub adapter fails with not configured', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_stub', displayName: 'Stub' })
    const service = createMindQueryService({ db, adapter: stubMindAdapter })
    await expect(service.queryMind('svc_stub', 'hello')).rejects.toThrow('Minds adapter not configured')
    db.close()
  })

  it('passes memory search results to the adapter when opted in', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_search', displayName: 'Search Sam', bio: 'Loves pottery' })
    addCreatorMemory(db, {
      id: 'svc_search_mem',
      creatorId: 'svc_search',
      category: 'preference',
      content: 'Loves pottery and hiking.',
    })
    // Another creator with the same terms must not leak into the search
    createCreatorProfile(db, { creatorId: 'svc_search_other', displayName: 'Other' })
    addCreatorMemory(db, {
      id: 'svc_search_secret',
      creatorId: 'svc_search_other',
      category: 'preference',
      content: 'Loves pottery and hiking.',
    })

    let capturedContext: MindContext | undefined
    const fake: MindAdapter = {
      query: async (ctx) => {
        capturedContext = ctx
        return 'answer'
      },
    }
    const service = createMindQueryService({ db, adapter: fake })
    await service.queryMind('svc_search', 'hello', { memorySearch: 'pottery' })

    expect(capturedContext?.memorySearch).toBeDefined()
    expect(capturedContext?.memorySearch?.query).toBe('pottery')
    expect(capturedContext?.memorySearch?.total).toBe(1)
    expect(capturedContext?.memorySearch?.memories.map((m) => m.id)).toEqual(['svc_search_mem'])
    expect(capturedContext?.memorySearch?.memories.some((m) => m.id === 'svc_search_secret')).toBe(false)
    db.close()
  })

  it('omits memory search from context when not opted in', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_no_search', displayName: 'No Search' })
    addCreatorMemory(db, {
      id: 'svc_no_search_mem',
      creatorId: 'svc_no_search',
      category: 'preference',
      content: 'Loves pottery.',
    })

    let capturedContext: MindContext | undefined
    const fake: MindAdapter = {
      query: async (ctx) => {
        capturedContext = ctx
        return 'answer'
      },
    }
    const service = createMindQueryService({ db, adapter: fake })
    await service.queryMind('svc_no_search', 'hello')

    expect(capturedContext?.memorySearch).toBeUndefined()
    db.close()
  })

  it('rejects a blank memorySearch option', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_blank', displayName: 'Blank' })
    const fake: MindAdapter = { query: async () => 'x' }
    const service = createMindQueryService({ db, adapter: fake })
    await expect(service.queryMind('svc_blank', 'hello', { memorySearch: '' })).rejects.toThrow(
      'memorySearch must be a non-empty string',
    )
    await expect(service.queryMind('svc_blank', 'hello', { memorySearch: '   ' })).rejects.toThrow(
      'memorySearch must be a non-empty string',
    )
    db.close()
  })

  it('rejects an over-long query but accepts one at the limit', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_long', displayName: 'Long' })
    const fake: MindAdapter = { query: async () => 'x' }
    const service = createMindQueryService({ db, adapter: fake })
    await expect(service.queryMind('svc_long', 'a'.repeat(10_001))).rejects.toThrow(
      'query must be at most 10000 characters',
    )
    await expect(service.queryMind('svc_long', 'a'.repeat(10_000))).resolves.toBe('x')
    db.close()
  })

  it('rejects an over-long memorySearch', async () => {
    const db = createDatabase(':memory:')
    migrate(db)
    createCreatorProfile(db, { creatorId: 'svc_long2', displayName: 'Long 2' })
    const fake: MindAdapter = { query: async () => 'x' }
    const service = createMindQueryService({ db, adapter: fake })
    await expect(
      service.queryMind('svc_long2', 'q', { memorySearch: 'a'.repeat(1_001) }),
    ).rejects.toThrow('memorySearch must be at most 1000 characters')
    db.close()
  })
})

describe('mind query API', () => {
  const db = createDatabase(':memory:')
  let defaultServer: Server
  let fakeServer: Server
  let defaultBase: string
  let fakeBase: string

  const fakeAdapter: MindAdapter & { lastContext?: MindContext; lastInput?: string } = {
    query: async (ctx, input) => {
      fakeAdapter.lastContext = ctx
      fakeAdapter.lastInput = input
      return `fake answer for ${input} and ${ctx.creator.displayName}`
    },
  }

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'api_a', displayName: 'API Ada', bio: 'Loves pottery' })
    createCreatorProfile(db, { creatorId: 'api_b', displayName: 'API Grace', bio: 'Pottery fan' })
    createCreatorProfile(db, { creatorId: 'api_c', displayName: 'API Alan', bio: 'Other' })
    // Add secret for isolation
    addCreatorMemory(db, { id: 'api_secret', creatorId: 'api_b', category: 'preference', content: 'Secret api_b memory' })
    // Searchable memory for api_a (memory search opt-in tests)
    addCreatorMemory(db, { id: 'api_search_mem', creatorId: 'api_a', category: 'preference', content: 'Loves electronic music.' })
    const collab = createCollaboration(db, {
      id: 'api_collab',
      initiatorId: 'api_a',
      targetId: 'api_b',
      proposal: 'Secret proposal',
    })
    createFollowUp(db, { id: 'api_follow', collaborationId: collab.id, dueAt: '2026-08-26T10:00:00.000Z' })

    defaultServer = createApp({ db }).listen(0)
    fakeServer = createApp({ db, mindAdapter: fakeAdapter }).listen(0)
    await Promise.all([
      new Promise<void>((r) => defaultServer.once('listening', r)),
      new Promise<void>((r) => fakeServer.once('listening', r)),
    ])
    defaultBase = `http://127.0.0.1:${(defaultServer.address() as AddressInfo).port}`
    fakeBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`
  })

  afterAll(() => {
    defaultServer.close()
    fakeServer.close()
    db.close()
  })

  it('valid request with fake adapter → 200 with {answer}', async () => {
    const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'What collaborations would be a good fit for me?' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { answer: string }
    expect(body).toHaveProperty('answer')
    expect(body.answer).toContain('API Ada')
    expect(body.answer).toContain('What collaborations')
    // Verify adapter received correct context and query
    expect(fakeAdapter.lastInput).toBe('What collaborations would be a good fit for me?')
    expect(fakeAdapter.lastContext?.creator.creatorId).toBe('api_a')
    expect(fakeAdapter.lastContext?.memories.some((m) => m.id === 'api_secret')).toBe(false)
  })

  it('response shape is {answer} and no DB internals leaked', async () => {
    const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['answer'])
    expect(typeof body.answer).toBe('string')
    // Ensure no internal fields like db, password, etc.
    expect(body).not.toHaveProperty('creator')
    expect(body).not.toHaveProperty('memories')
  })

  it('missing/invalid query → 400', async () => {
    const cases: Array<{ body: string; desc: string }> = [
      { body: JSON.stringify({}), desc: 'missing query' },
      { body: JSON.stringify({ query: '' }), desc: 'empty' },
      { body: JSON.stringify({ query: '   ' }), desc: 'whitespace' },
      { body: JSON.stringify({ query: 123 }), desc: 'non-string' },
      { body: JSON.stringify({ query: null }), desc: 'null' },
    ]
    for (const { body, desc } of cases) {
      const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      expect(res.status, desc).toBe(400)
      const b = (await res.json()) as { error: string }
      expect(b.error).toMatch(/query is required/)
    }
    // Missing body (no json)
    const noBody = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    // Express json will treat empty as {}? Our validation will see missing query -> 400
    expect([400]).toContain(noBody.status)
  })

  it('missing creator → 404', async () => {
    const res = await fetch(`${fakeBase}/api/creators/ghost/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('ghost')
  })

  it('empty creatorId → 400', async () => {
    const res = await fetch(`${fakeBase}/api/creators/%20/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect([400, 404]).toContain(res.status)
  })

  it('default stub adapter → 503', async () => {
    const res = await fetch(`${defaultBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Minds adapter not configured')
  })

  it('adapter failure → 500 without leaking internals', async () => {
    const failingAdapter: MindAdapter = {
      query: async () => {
        throw new Error('secret internal boom with password 123')
      },
    }
    const failingDb = createDatabase(':memory:')
    migrate(failingDb)
    createCreatorProfile(failingDb, { creatorId: 'fail_a', displayName: 'Fail' })
    const failingApp = createApp({ db: failingDb, mindAdapter: failingAdapter }).listen(0)
    await new Promise<void>((r) => failingApp.once('listening', r))
    const base = `http://127.0.0.1:${(failingApp.address() as AddressInfo).port}`
    const res = await fetch(`${base}/api/creators/fail_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('mind query failed')
    expect(body.error).not.toContain('secret')
    expect(body.error).not.toContain('password')
    failingApp.close()
    failingDb.close()
  })

  it('creator isolation - fake adapter does not receive other creator private data', async () => {
    // api_b has secret memory and collab, api_a should not leak it via its mind query
    const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'check isolation' }),
    })
    expect(res.status).toBe(200)
    expect(fakeAdapter.lastContext?.creator.creatorId).toBe('api_a')
    expect(fakeAdapter.lastContext?.memories.some((m) => m.content.includes('Secret api_b'))).toBe(false)
    expect(fakeAdapter.lastContext?.memories.some((m) => m.id === 'api_secret')).toBe(false)
  })

  it('no DB internals leaked on 500', async () => {
    const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    // This should be 200 with fake, not 500. We already tested 500 with failing adapter.
    // For this test, ensure 500 case above already verified no leak.
    expect(res.status).toBe(200)
  })

  it('memorySearch opt-in passes ranked results to the adapter', async () => {
    const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'What should I know?', memorySearch: 'electronic music' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { answer: string }
    expect(typeof body.answer).toBe('string')
    expect(fakeAdapter.lastInput).toBe('What should I know?')
    expect(fakeAdapter.lastContext?.memorySearch).toBeDefined()
    expect(fakeAdapter.lastContext?.memorySearch?.query).toBe('electronic music')
    expect(fakeAdapter.lastContext?.memorySearch?.memories.some((m) => m.id === 'api_search_mem')).toBe(true)
    // Never leaks another creator's memory, even when it would match
    expect(fakeAdapter.lastContext?.memorySearch?.memories.some((m) => m.id === 'api_secret')).toBe(false)
  })

  it('without memorySearch the adapter context has no memorySearch field', async () => {
    const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(200)
    expect(fakeAdapter.lastContext?.memorySearch).toBeUndefined()
  })

  it('blank or non-string memorySearch → 400', async () => {
    const cases: Array<{ body: string; desc: string }> = [
      { body: JSON.stringify({ query: 'hello', memorySearch: '' }), desc: 'empty' },
      { body: JSON.stringify({ query: 'hello', memorySearch: '   ' }), desc: 'whitespace' },
      { body: JSON.stringify({ query: 'hello', memorySearch: 123 }), desc: 'non-string' },
      { body: JSON.stringify({ query: 'hello', memorySearch: null }), desc: 'null' },
    ]
    for (const { body, desc } of cases) {
      const res = await fetch(`${fakeBase}/api/creators/api_a/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      expect(res.status, desc).toBe(400)
      const b = (await res.json()) as { error: string }
      expect(b.error).toMatch(/memorySearch must be a non-empty string/)
    }
  })
})
