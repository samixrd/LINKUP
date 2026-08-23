import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp } from '../src/app.js'

interface MemoryBody {
  id: string
  creatorId: string
  category: string
  content: string
  createdAt: string
  updatedAt: string
}

describe('creators API', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, {
      creatorId: 'creator_a',
      displayName: 'Ada Lovelace',
      bio: 'First programmer.',
    })
    createCreatorProfile(db, { creatorId: 'creator_b', displayName: 'Grace Hopper' })
    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  const postMemory = async (
    creatorId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/creators/${creatorId}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  describe('POST /api/creators', () => {
    const postCreator = async (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    it('creates a profile and returns it with 201', async () => {
      const res = await postCreator({
        creatorId: 'creator_posted',
        displayName: 'Katherine Johnson',
        bio: 'Calculated the trajectory.',
      })
      expect(res.status).toBe(201)

      const body = (await res.json()) as {
        creatorId: string
        displayName: string
        bio: string
        avatarUrl: string
        createdAt: string
        updatedAt: string
      }
      expect(body.creatorId).toBe('creator_posted')
      expect(body.displayName).toBe('Katherine Johnson')
      expect(body.bio).toBe('Calculated the trajectory.')
      expect(body.avatarUrl).toBe('')
      expect(body.createdAt).toBeTruthy()
      expect(body.updatedAt).toBeTruthy()
    })

    it('defaults bio and avatarUrl to empty strings', async () => {
      const res = await postCreator({
        creatorId: 'creator_minimal',
        displayName: 'Minimal',
      })
      expect(res.status).toBe(201)

      const body = (await res.json()) as { bio: string; avatarUrl: string }
      expect(body.bio).toBe('')
      expect(body.avatarUrl).toBe('')
    })

    it('returns 409 when the creatorId is already taken', async () => {
      const res = await postCreator({
        creatorId: 'creator_a',
        displayName: 'Duplicate Ada',
      })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('creator_a')
    })

    it('rejects invalid bodies with 400', async () => {
      const cases: Record<string, unknown>[] = [
        {},
        { creatorId: 'x' },
        { displayName: 'x' },
        { creatorId: '   ', displayName: 'x' },
        { creatorId: 'x', displayName: '   ' },
        { creatorId: 42, displayName: 'x' },
        { creatorId: 'x', displayName: 42 },
        { creatorId: 'x', displayName: 'x', bio: '   ' },
      ]
      for (const body of cases) {
        const res = await postCreator(body)
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })
  })

  describe('GET /api/creators/:creatorId', () => {
    it('returns the profile for an existing creator', async () => {
      const res = await fetch(`${baseUrl}/api/creators/creator_a`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as {
        creatorId: string
        displayName: string
        bio: string
        createdAt: string
      }
      expect(body.creatorId).toBe('creator_a')
      expect(body.displayName).toBe('Ada Lovelace')
      expect(body.bio).toBe('First programmer.')
      expect(body.createdAt).toBeTruthy()
    })

    it('returns 404 for an unknown creator', async () => {
      const res = await fetch(`${baseUrl}/api/creators/ghost`)
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('ghost')
    })
  })

  describe('GET /api/creators/:creatorId/memories', () => {
    it('returns an empty list before any memories exist', async () => {
      const res = await fetch(`${baseUrl}/api/creators/creator_a/memories`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { memories: MemoryBody[] }
      expect(body.memories).toEqual([])
    })

    it('returns 404 for an unknown creator', async () => {
      const res = await fetch(`${baseUrl}/api/creators/ghost/memories`)
      expect(res.status).toBe(404)
    })

    it('lists memories created through the API', async () => {
      const created = (await (
        await postMemory('creator_a', { category: 'preference', content: 'Async over sync.' })
      ).json()) as MemoryBody

      const res = await fetch(`${baseUrl}/api/creators/creator_a/memories`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { memories: MemoryBody[] }
      expect(body.memories.map((m) => m.id)).toContain(created.id)
    })

    it('filters by category and rejects unknown categories', async () => {
      await postMemory('creator_a', { category: 'lesson', content: 'Lesson one.' })

      const res = await fetch(`${baseUrl}/api/creators/creator_a/memories?category=lesson`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { memories: MemoryBody[] }
      expect(body.memories.length).toBeGreaterThan(0)
      for (const memory of body.memories) {
        expect(memory.category).toBe('lesson')
      }

      const bad = await fetch(`${baseUrl}/api/creators/creator_a/memories?category=bogus`)
      expect(bad.status).toBe(400)
    })
  })

  describe('POST /api/creators/:creatorId/memories', () => {
    it('creates a memory with a server-generated id', async () => {
      const res = await postMemory('creator_a', {
        category: 'goal',
        content: 'Ship Phase 3A.',
      })
      expect(res.status).toBe(201)

      const body = (await res.json()) as MemoryBody
      expect(body.id).toBeTruthy()
      expect(body.creatorId).toBe('creator_a')
      expect(body.category).toBe('goal')
      expect(body.content).toBe('Ship Phase 3A.')
      expect(body.createdAt).toBeTruthy()
      expect(body.updatedAt).toBeTruthy()
    })

    it('accepts a client-chosen id', async () => {
      const res = await postMemory('creator_a', {
        id: 'memory_custom',
        category: 'constraint',
        content: 'Never call after 9pm.',
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as MemoryBody
      expect(body.id).toBe('memory_custom')
    })

    it('returns 409 when the id is already taken', async () => {
      const res = await postMemory('creator_a', {
        id: 'memory_custom',
        category: 'goal',
        content: 'Duplicate.',
      })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('memory_custom')
    })

    it('returns 404 for an unknown creator', async () => {
      const res = await postMemory('ghost', { category: 'goal', content: 'x' })
      expect(res.status).toBe(404)
    })

    it('rejects invalid bodies with 400', async () => {
      const cases: Record<string, unknown>[] = [
        { category: 'bogus', content: 'x' },
        { content: 'x' },
        { category: 'goal' },
        { category: 'goal', content: '   ' },
        { id: '   ', category: 'goal', content: 'x' },
      ]
      for (const body of cases) {
        const res = await postMemory('creator_a', body)
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })
  })

  describe('PATCH /api/creators/:creatorId/memories/:memoryId', () => {
    it('updates a memory and returns it', async () => {
      await postMemory('creator_a', { id: 'memory_patch', category: 'lesson', content: 'Old.' })

      const res = await fetch(`${baseUrl}/api/creators/creator_a/memories/memory_patch`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'constraint', content: 'New.' }),
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as MemoryBody
      expect(body.id).toBe('memory_patch')
      expect(body.category).toBe('constraint')
      expect(body.content).toBe('New.')
      expect(body.creatorId).toBe('creator_a')
    })

    it('rejects invalid bodies with 400', async () => {
      const url = `${baseUrl}/api/creators/creator_a/memories/memory_patch`
      const cases: Record<string, unknown>[] = [
        {},
        { category: 'bogus' },
        { content: '   ' },
        { content: 42 },
      ]
      for (const body of cases) {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })

    it('returns 404 for an unknown creator, memory, or another creator’s memory', async () => {
      const ghostCreator = await fetch(
        `${baseUrl}/api/creators/ghost/memories/memory_patch`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      expect(ghostCreator.status).toBe(404)

      const ghostMemory = await fetch(
        `${baseUrl}/api/creators/creator_a/memories/missing`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      expect(ghostMemory.status).toBe(404)

      const bMemory = (await (
        await postMemory('creator_b', { category: 'goal', content: 'Hopper.' })
      ).json()) as MemoryBody

      const cross = await fetch(
        `${baseUrl}/api/creators/creator_a/memories/${bMemory.id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      expect(cross.status).toBe(404)
    })
  })

  describe('DELETE /api/creators/:creatorId/memories/:memoryId', () => {
    it('deletes a memory and returns 404 afterwards', async () => {
      await postMemory('creator_a', { id: 'memory_delete', category: 'goal', content: 'Gone.' })

      const del = await fetch(`${baseUrl}/api/creators/creator_a/memories/memory_delete`, {
        method: 'DELETE',
      })
      expect(del.status).toBe(204)

      const listRes = await fetch(`${baseUrl}/api/creators/creator_a/memories`)
      const listBody = (await listRes.json()) as { memories: MemoryBody[] }
      expect(listBody.memories.some((m) => m.id === 'memory_delete')).toBe(false)

      const again = await fetch(`${baseUrl}/api/creators/creator_a/memories/memory_delete`, {
        method: 'DELETE',
      })
      expect(again.status).toBe(404)
    })

    it('cannot delete another creator’s memory', async () => {
      const bMemory = (await (
        await postMemory('creator_b', { category: 'preference', content: 'Hopper pref.' })
      ).json()) as MemoryBody

      const cross = await fetch(`${baseUrl}/api/creators/creator_a/memories/${bMemory.id}`, {
        method: 'DELETE',
      })
      expect(cross.status).toBe(404)

      const listRes = await fetch(`${baseUrl}/api/creators/creator_b/memories`)
      const listBody = (await listRes.json()) as { memories: MemoryBody[] }
      expect(listBody.memories.some((m) => m.id === bMemory.id)).toBe(true)
    })
  })

  describe('GET /api/creators', () => {
    interface CreatorBody {
      creatorId: string
      displayName: string
      bio: string
      avatarUrl: string
      createdAt: string
      updatedAt: string
    }
    interface ListBody {
      creators: CreatorBody[]
      total: number
    }

    const postCreator = async (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    beforeAll(async () => {
      for (const [id, name] of [
        ['creator_discovery_1', 'Discovery Alice'],
        ['creator_discovery_2', 'Discovery Bob'],
        ['creator_discovery_3', 'Discovery Carol'],
      ]) {
        await postCreator({ creatorId: id, displayName: name })
      }
    })

    it('lists all creators with a total', async () => {
      const res = await fetch(`${baseUrl}/api/creators`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListBody
      expect(body.total).toBeGreaterThanOrEqual(3)
      const ids = body.creators.map((c) => c.creatorId)
      expect(ids).toContain('creator_discovery_1')
      expect(ids).toContain('creator_discovery_2')
      expect(ids).toContain('creator_discovery_3')
    })

    it('sorts creators by displayName (case-insensitive)', async () => {
      const res = await fetch(`${baseUrl}/api/creators`)
      const body = (await res.json()) as ListBody

      const names = body.creators.map((c) => c.displayName.toLowerCase())
      const sorted = [...names].sort()
      expect(names).toEqual(sorted)
    })

    it('searches by displayName case-insensitively', async () => {
      const res = await fetch(`${baseUrl}/api/creators?q=discovery`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListBody
      expect(body.total).toBe(3)
      const ids = body.creators.map((c) => c.creatorId).sort()
      expect(ids).toEqual(['creator_discovery_1', 'creator_discovery_2', 'creator_discovery_3'])
    })

    it('searches by bio', async () => {
      const res = await fetch(`${baseUrl}/api/creators?q=programmer`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListBody
      expect(body.creators.some((c) => c.creatorId === 'creator_a')).toBe(true)
    })

    it('paginates with limit and offset', async () => {
      const first = await fetch(`${baseUrl}/api/creators?q=discovery&limit=2&offset=0`)
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as ListBody
      expect(firstBody.creators.length).toBe(2)
      expect(firstBody.total).toBe(3)

      const second = await fetch(`${baseUrl}/api/creators?q=discovery&limit=2&offset=2`)
      expect(second.status).toBe(200)
      const secondBody = (await second.json()) as ListBody
      expect(secondBody.creators.length).toBe(1)
      expect(secondBody.total).toBe(3)
    })

    it('rejects invalid limit and offset with 400', async () => {
      const invalidQueries = [
        'limit=0',
        'limit=101',
        'limit=abc',
        'limit=1.5',
        'limit=-1',
        'offset=-1',
        'offset=1.5',
        'offset=abc',
      ]
      for (const query of invalidQueries) {
        const res = await fetch(`${baseUrl}/api/creators?${query}`)
        expect(res.status, query).toBe(400)
      }
    })

    it('rejects a repeated q parameter with 400', async () => {
      const res = await fetch(`${baseUrl}/api/creators?q=a&q=b`)
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/creators/:creatorId/matches', () => {
    interface MatchBody {
      creator: {
        creatorId: string
        displayName: string
        bio: string
        avatarUrl: string
        createdAt: string
        updatedAt: string
      }
      score: number
      sharedTerms: string[]
    }
    interface MatchesBody {
      matches: MatchBody[]
      total: number
    }

    const postCreator = async (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    beforeAll(async () => {
      await postCreator({
        creatorId: 'match_subject',
        displayName: 'Match Subject',
        bio: 'Music producer and painter.',
      })
      await postCreator({
        creatorId: 'match_partner',
        displayName: 'Match Partner',
        bio: 'Music producer.',
      })
      await postCreator({
        creatorId: 'match_stranger',
        displayName: 'Match Stranger',
        bio: 'Builds furniture.',
      })
      await postMemory('match_partner', {
        category: 'preference',
        content: 'Loves electronic music.',
      })
    })

    it('returns ranked matches with score and shared terms', async () => {
      const res = await fetch(`${baseUrl}/api/creators/match_subject/matches`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as MatchesBody
      expect(body.total).toBe(1)
      expect(body.matches[0]?.creator.creatorId).toBe('match_partner')
      expect(body.matches[0]?.score).toBe(2)
      expect(body.matches[0]?.sharedTerms).toEqual(['music', 'producer'])
      expect(body.matches[0]?.creator.bio).toBe('Music producer.')
    })

    it('excludes the subject creator and zero-term strangers', async () => {
      const res = await fetch(`${baseUrl}/api/creators/match_subject/matches`)
      const body = (await res.json()) as MatchesBody

      for (const match of body.matches) {
        expect(match.creator.creatorId).not.toBe('match_subject')
        expect(match.creator.creatorId).not.toBe('match_stranger')
        expect(match.sharedTerms.length).toBeGreaterThan(0)
      }
    })

    it('returns 404 for an unknown creator', async () => {
      const res = await fetch(`${baseUrl}/api/creators/ghost/matches`)
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('ghost')
    })

    it('rejects invalid limit and offset with 400', async () => {
      const invalidQueries = [
        'limit=0',
        'limit=101',
        'limit=abc',
        'limit=1.5',
        'limit=-1',
        'offset=-1',
        'offset=1.5',
        'offset=abc',
      ]
      for (const query of invalidQueries) {
        const res = await fetch(`${baseUrl}/api/creators/match_subject/matches?${query}`)
        expect(res.status, query).toBe(400)
      }
    })

    it('paginates with limit and offset', async () => {
      const res = await fetch(`${baseUrl}/api/creators/match_subject/matches?limit=1&offset=0`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as MatchesBody
      expect(body.matches.length).toBe(1)
      expect(body.total).toBe(1)
    })
  })

  describe('GET /api/creators/:creatorId/memories/search', () => {
    interface SearchBody {
      memories: MemoryBody[]
      total: number
    }

    const postCreator = async (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${baseUrl}/api/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const search = async (creatorId: string, query: string): Promise<Response> =>
      fetch(`${baseUrl}/api/creators/${creatorId}/memories/search?q=${encodeURIComponent(query)}`)

    beforeAll(async () => {
      await postCreator({ creatorId: 'search_subject', displayName: 'Search Subject' })
      await postCreator({ creatorId: 'search_other', displayName: 'Search Other' })
      await postMemory('search_subject', {
        id: 'api_search_high',
        category: 'preference',
        content: 'Loves electronic music production.',
      })
      await postMemory('search_subject', {
        id: 'api_search_mid',
        category: 'goal',
        content: 'Enjoys electronic music.',
      })
      await postMemory('search_subject', {
        id: 'api_search_none',
        category: 'constraint',
        content: 'Prefers quiet studio sessions.',
      })
      // A memory owned by someone else with the same terms must not leak.
      await postMemory('search_other', {
        id: 'api_search_other',
        category: 'preference',
        content: 'Loves electronic music production.',
      })
    })

    it('returns ranked matching memories with a total', async () => {
      const res = await search('search_subject', 'electronic music production')
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchBody
      expect(body.total).toBe(2)
      expect(body.memories.map((m) => m.id)).toEqual(['api_search_high', 'api_search_mid'])
      for (const memory of body.memories) {
        expect(memory.creatorId).toBe('search_subject')
        expect(memory.createdAt).toBeTruthy()
        expect(memory.updatedAt).toBeTruthy()
      }
    })

    it('returns an empty page when nothing matches', async () => {
      const res = await search('search_subject', 'zebra unicorn')
      expect(res.status).toBe(200)
      const body = (await res.json()) as SearchBody
      expect(body).toEqual({ memories: [], total: 0 })
    })

    it('never returns another creator’s matching memories', async () => {
      const res = await search('search_subject', 'electronic')
      expect(res.status).toBe(200)
      const body = (await res.json()) as SearchBody
      expect(body.memories.some((m) => m.id === 'api_search_other')).toBe(false)
      expect(body.memories.every((m) => m.creatorId === 'search_subject')).toBe(true)
    })

    it('paginates with limit and offset', async () => {
      const first = await fetch(
        `${baseUrl}/api/creators/search_subject/memories/search?q=electronic&limit=1&offset=0`,
      )
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as SearchBody
      expect(firstBody.memories.length).toBe(1)
      expect(firstBody.total).toBe(2)

      const second = await fetch(
        `${baseUrl}/api/creators/search_subject/memories/search?q=electronic&limit=1&offset=1`,
      )
      expect(second.status).toBe(200)
      const secondBody = (await second.json()) as SearchBody
      expect(secondBody.memories.length).toBe(1)
      expect(secondBody.total).toBe(2)
    })

    it('rejects a missing, empty, or repeated q with 400', async () => {
      const cases = [
        `${baseUrl}/api/creators/search_subject/memories/search`,
        `${baseUrl}/api/creators/search_subject/memories/search?q=`,
        `${baseUrl}/api/creators/search_subject/memories/search?q=${encodeURIComponent('   ')}`,
        `${baseUrl}/api/creators/search_subject/memories/search?q=a&q=b`,
      ]
      for (const url of cases) {
        const res = await fetch(url)
        expect(res.status, url).toBe(400)
      }
    })

    it('rejects invalid limit and offset with 400', async () => {
      const invalidQueries = [
        'limit=0',
        'limit=101',
        'limit=abc',
        'limit=1.5',
        'limit=-1',
        'offset=-1',
        'offset=1.5',
        'offset=abc',
      ]
      for (const query of invalidQueries) {
        const res = await fetch(
          `${baseUrl}/api/creators/search_subject/memories/search?q=music&${query}`,
        )
        expect(res.status, query).toBe(400)
      }
    })

    it('returns 404 for an unknown creator', async () => {
      const res = await fetch(`${baseUrl}/api/creators/ghost/memories/search?q=music`)
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('ghost')
    })
  })

  it('never exposes another creator’s memories in a list', async () => {
    await postMemory('creator_b', { category: 'goal', content: 'Hopper secret.' })

    const res = await fetch(`${baseUrl}/api/creators/creator_a/memories`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { memories: MemoryBody[] }
    for (const memory of body.memories) {
      expect(memory.creatorId).toBe('creator_a')
    }
    expect(body.memories.some((m) => m.content === 'Hopper secret.')).toBe(false)
  })
})
