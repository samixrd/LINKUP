import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'
import type { MindAdapter } from '@linkup/db'

describe('mind history and memory write-back API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string
  let fakeServer: Server
  let fakeBase: string

  const fakeAdapter: MindAdapter = {
    query: async (_ctx, input) => `Answer: ${input}`,
  }

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'hist_a', displayName: 'Hist Ada' })
    createCreatorProfile(db, { creatorId: 'hist_b', displayName: 'Hist Bob' })
    server = createApp({ db }).listen(0)
    fakeServer = createApp({ db, mindAdapter: fakeAdapter }).listen(0)
    await Promise.all([
      new Promise<void>((r) => server.once('listening', r)),
      new Promise<void>((r) => fakeServer.once('listening', r)),
    ])
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    fakeBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    fakeServer.close()
    db.close()
  })

  describe('GET /api/creators/:creatorId/mind/history', () => {
    it('200 empty history', async () => {
      const res = await fetch(`${baseUrl}/api/creators/hist_a/mind/history`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { interactions: unknown[]; total: number }
      expect(body.interactions).toEqual([])
      expect(body.total).toBe(0)
    })

    it('ordering chronological and pagination', async () => {
      // Create history via fake query
      const q1 = await fetch(`${fakeBase}/api/creators/hist_a/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'first query' }),
      })
      expect(q1.status).toBe(200)
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 5))
      const q2 = await fetch(`${fakeBase}/api/creators/hist_a/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'second query' }),
      })
      expect(q2.status).toBe(200)

      const res = await fetch(`${baseUrl}/api/creators/hist_a/mind/history`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { interactions: { role: string; content: string; createdAt: string; id: string }[]; total: number }
      expect(body.total).toBe(4) // 2 queries * 2 (user+mind)
      expect(body.interactions[0]?.role).toBe('user')
      expect(body.interactions[0]?.content).toBe('first query')
      expect(body.interactions[1]?.role).toBe('mind')
      expect(body.interactions[2]?.content).toBe('second query')
      // Pagination
      const paged = await fetch(`${baseUrl}/api/creators/hist_a/mind/history?limit=2&offset=1`)
      expect(paged.status).toBe(200)
      const pagedBody = (await paged.json()) as { interactions: { id: string }[]; total: number }
      expect(pagedBody.interactions).toHaveLength(2)
      expect(pagedBody.total).toBe(4)
      expect(pagedBody.interactions[0]?.id).toBe(body.interactions[1]?.id)
    })

    it('404 missing creator', async () => {
      const res = await fetch(`${baseUrl}/api/creators/ghost/mind/history`)
      expect(res.status).toBe(404)
    })

    it('400 invalid params', async () => {
      const cases = ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'offset=abc']
      for (const q of cases) {
        const res = await fetch(`${baseUrl}/api/creators/hist_a/mind/history?${q}`)
        expect(res.status, q).toBe(400)
      }
    })

    it('isolation', async () => {
      // hist_b has no history yet
      const res = await fetch(`${baseUrl}/api/creators/hist_b/mind/history`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { interactions: unknown[] }
      // Should not contain hist_a's interactions
      expect(body.interactions).toEqual([])
      // Create history for hist_b
      await fetch(`${fakeBase}/api/creators/hist_b/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hist_b query' }),
      })
      const resA = await fetch(`${baseUrl}/api/creators/hist_a/mind/history`)
      const bodyA = (await resA.json()) as { interactions: { content: string }[] }
      expect(bodyA.interactions.some((i) => i.content === 'hist_b query')).toBe(false)
    })
  })

  describe('POST /api/creators/:creatorId/mind/query persistence', () => {
    it('successful query persists user + mind', async () => {
      // Create a fresh creator for clean count
      const createRes = await fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: 'persist_test', displayName: 'Persist' }),
      })
      // Might already exist, ignore
      if (createRes.status !== 201 && createRes.status !== 409) throw new Error('create failed')

      const before = await fetch(`${baseUrl}/api/creators/persist_test/mind/history`)
      const beforeBody = (await before.json()) as { total: number }

      const qRes = await fetch(`${fakeBase}/api/creators/persist_test/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'persist query' }),
      })
      expect(qRes.status).toBe(200)

      const after = await fetch(`${baseUrl}/api/creators/persist_test/mind/history`)
      const afterBody = (await after.json()) as { interactions: { role: string; content: string }[]; total: number }
      expect(afterBody.total).toBe(beforeBody.total + 2)
      expect(afterBody.interactions.slice(-2).map((i) => i.role)).toEqual(['user', 'mind'])
      expect(afterBody.interactions.slice(-2).map((i) => i.content)).toContain('persist query')
    })

    it('adapter failure does not persist mind answer', async () => {
      const failingAdapter: MindAdapter = { query: async () => { throw new Error('boom') } }
      const failingDb = createDatabase(':memory:')
      migrate(failingDb)
      createCreatorProfile(failingDb, { creatorId: 'fail_persist', displayName: 'Fail' })
      const failApp = createApp({ db: failingDb, mindAdapter: failingAdapter }).listen(0)
      await new Promise<void>((r) => failApp.once('listening', r))
      const base = `http://127.0.0.1:${(failApp.address() as AddressInfo).port}`

      const before = await fetch(`${base}/api/creators/fail_persist/mind/history`)
      const beforeBody = (await before.json()) as { total: number }

      const qRes = await fetch(`${base}/api/creators/fail_persist/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'will fail' }),
      })
      expect(qRes.status).toBe(500)

      const after = await fetch(`${base}/api/creators/fail_persist/mind/history`)
      const afterBody = (await after.json()) as { total: number }
      // Should not have persisted user or mind (avoid inconsistent)
      expect(afterBody.total).toBe(beforeBody.total)

      failApp.close()
      failingDb.close()
    })

    it('existing 400/404/503/500 behavior remains', async () => {
      // 400
      const r400 = await fetch(`${fakeBase}/api/creators/hist_a/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '' }),
      })
      expect(r400.status).toBe(400)
      // 404
      const r404 = await fetch(`${fakeBase}/api/creators/ghost/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hello' }),
      })
      expect(r404.status).toBe(404)
      // 503 default stub
      const r503 = await fetch(`${baseUrl}/api/creators/hist_a/mind/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hello' }),
      })
      expect(r503.status).toBe(503)
    })
  })

  describe('POST /api/creators/:creatorId/mind/memory', () => {
    it('valid interaction → memory created', async () => {
      // Get a valid interaction for hist_a
      const hist = await fetch(`${baseUrl}/api/creators/hist_a/mind/history?limit=1`)
      const histBody = (await hist.json()) as { interactions: { id: string }[] }
      const interactionId = histBody.interactions[0]?.id
      expect(interactionId).toBeTruthy()

      const res = await fetch(`${baseUrl}/api/creators/hist_a/mind/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactionId, category: 'preference', content: 'Saved from chat' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { id: string; category: string; content: string }
      expect(body.category).toBe('preference')
      expect(body.content).toBe('Saved from chat')

      // Verify via memories
      const memRes = await fetch(`${baseUrl}/api/creators/hist_a/memories?category=preference`)
      const memBody = (await memRes.json()) as { memories: { id: string }[] }
      expect(memBody.memories.some((m) => m.id === body.id)).toBe(true)
    })

    it('creator isolation', async () => {
      const hist = await fetch(`${baseUrl}/api/creators/hist_a/mind/history?limit=1`)
      const histBody = (await hist.json()) as { interactions: { id: string }[] }
      const interactionId = histBody.interactions[0]?.id

      const res = await fetch(`${baseUrl}/api/creators/hist_b/mind/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactionId, category: 'preference', content: 'try steal' }),
      })
      expect(res.status).toBe(404)
    })

    it('interaction isolation', async () => {
      // interaction from hist_b should not be usable for hist_a
      const histB = await fetch(`${baseUrl}/api/creators/hist_b/mind/history?limit=1`)
      const histBBody = (await histB.json()) as { interactions: { id: string }[] }
      const bInteractionId = histBBody.interactions[0]?.id
      if (bInteractionId) {
        const res = await fetch(`${baseUrl}/api/creators/hist_a/mind/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interactionId: bInteractionId, category: 'preference', content: 'steal' }),
        })
        expect(res.status).toBe(404)
      }
    })

    it('invalid category, empty content, missing interaction, duplicate', async () => {
      const hist = await fetch(`${baseUrl}/api/creators/hist_a/mind/history?limit=1`)
      const histBody = (await hist.json()) as { interactions: { id: string }[] }
      const validId = histBody.interactions[0]?.id

      const cases: Array<{ body: Record<string, unknown>; expect: number }> = [
        { body: { interactionId: validId, category: 'bogus', content: 'hi' }, expect: 400 },
        { body: { interactionId: validId, category: 'preference', content: '' }, expect: 400 },
        { body: { interactionId: validId, category: 'preference', content: '   ' }, expect: 400 },
        { body: { category: 'preference', content: 'hi' }, expect: 400 },
        { body: { interactionId: 'ghost', category: 'preference', content: 'hi' }, expect: 404 },
        { body: { interactionId: validId, content: 'hi' }, expect: 400 },
      ]
      for (const c of cases) {
        const res = await fetch(`${baseUrl}/api/creators/hist_a/mind/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c.body),
        })
        expect(res.status, JSON.stringify(c.body)).toBe(c.expect)
      }
    })

    it('missing creator 404', async () => {
      const res = await fetch(`${baseUrl}/api/creators/ghost/mind/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactionId: 'x', category: 'preference', content: 'hi' }),
      })
      expect(res.status).toBe(404)
    })

    it('over-long content → 400', async () => {
      const hist = await fetch(`${baseUrl}/api/creators/hist_a/mind/history?limit=1`)
      const histBody = (await hist.json()) as { interactions: { id: string }[] }
      const interactionId = histBody.interactions[0]?.id
      expect(interactionId).toBeTruthy()

      const res = await fetch(`${baseUrl}/api/creators/hist_a/mind/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactionId, category: 'preference', content: 'x'.repeat(10_001) }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('at most 10000 characters')
    })
  })
})
