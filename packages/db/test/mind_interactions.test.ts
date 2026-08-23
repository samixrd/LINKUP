import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCreatorProfile,
  createDatabase,
  createMindInteraction,
  deleteCreatorProfile,
  getMindInteraction,
  listMindInteractions,
  migrate,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  createCreatorProfile(db, { creatorId: 'creator_a', displayName: 'Ada' })
  createCreatorProfile(db, { creatorId: 'creator_b', displayName: 'Bob' })
  return db
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('mind_interactions', () => {
  it('creates user and mind interactions', () => {
    const db = testDb()
    const user = createMindInteraction(db, { id: 'int_1', creatorId: 'creator_a', role: 'user', content: 'Hello' })
    expect(user.role).toBe('user')
    expect(user.content).toBe('Hello')
    expect(user.createdAt).toBeTruthy()

    const mind = createMindInteraction(db, { id: 'int_2', creatorId: 'creator_a', role: 'mind', content: 'Hi there' })
    expect(mind.role).toBe('mind')
    db.close()
  })

  it('retrieves interaction', () => {
    const db = testDb()
    createMindInteraction(db, { id: 'int_1', creatorId: 'creator_a', role: 'user', content: 'Hello' })
    const fetched = getMindInteraction(db, 'int_1')
    expect(fetched?.content).toBe('Hello')
    expect(getMindInteraction(db, 'missing')).toBeUndefined()
    db.close()
  })

  it('chronological ordering created_at ASC, id ASC', async () => {
    const db = testDb()
    createMindInteraction(db, { id: 'b', creatorId: 'creator_a', role: 'user', content: 'second' })
    await delay(5)
    createMindInteraction(db, { id: 'a', creatorId: 'creator_a', role: 'user', content: 'first' })
    // Both have different created_at, but test with same timestamp via direct insert?
    // Instead test that ordering is by created_at asc
    const list = listMindInteractions(db, 'creator_a')
    // b was created first, even though id a < b, should be b first due to created_at
    expect(list.interactions[0]?.id).toBe('b')
    expect(list.interactions[1]?.id).toBe('a')

    // Test id tie-breaker: same created_at, order by id
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO mind_interactions (id, creator_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      'id_1',
      'creator_a',
      'user',
      'same time 1',
      now,
    )
    db.prepare(`INSERT INTO mind_interactions (id, creator_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      'id_2',
      'creator_a',
      'user',
      'same time 2',
      now,
    )
    const list2 = listMindInteractions(db, 'creator_a')
    const ids = list2.interactions.filter((i) => i.id.startsWith('id_')).map((i) => i.id)
    expect(ids).toEqual(['id_1', 'id_2'])
    db.close()
  })

  it('pagination and total count', () => {
    const db = testDb()
    for (let i = 0; i < 5; i++) {
      createMindInteraction(db, { id: `int_${i}`, creatorId: 'creator_a', role: 'user', content: `msg ${i}` })
    }
    const p1 = listMindInteractions(db, 'creator_a', { limit: 2, offset: 0 })
    expect(p1.interactions).toHaveLength(2)
    expect(p1.total).toBe(5)
    expect(p1.interactions[0]?.id).toBe('int_0')

    const p2 = listMindInteractions(db, 'creator_a', { limit: 2, offset: 2 })
    expect(p2.interactions[0]?.id).toBe('int_2')
    expect(p2.total).toBe(5)

    const p3 = listMindInteractions(db, 'creator_a', { limit: 2, offset: 10 })
    expect(p3.interactions).toEqual([])
    expect(p3.total).toBe(5)
    db.close()
  })

  it('creator isolation', () => {
    const db = testDb()
    createMindInteraction(db, { id: 'a1', creatorId: 'creator_a', role: 'user', content: 'A hello' })
    createMindInteraction(db, { id: 'b1', creatorId: 'creator_b', role: 'user', content: 'B hello' })

    const listA = listMindInteractions(db, 'creator_a')
    expect(listA.interactions.map((i) => i.id)).toEqual(['a1'])
    expect(listA.total).toBe(1)

    const listB = listMindInteractions(db, 'creator_b')
    expect(listB.interactions.map((i) => i.id)).toEqual(['b1'])

    // get still returns regardless of creator, but list isolates
    expect(getMindInteraction(db, 'b1')?.creatorId).toBe('creator_b')
    db.close()
  })

  it('validates role', () => {
    const db = testDb()
    expect(() =>
      createMindInteraction(db, { id: 'x', creatorId: 'creator_a', role: 'invalid' as never, content: 'hi' }),
    ).toThrow('role must be one of')
    db.close()
  })

  it('validates empty content', () => {
    const db = testDb()
    expect(() =>
      createMindInteraction(db, { id: 'x', creatorId: 'creator_a', role: 'user', content: '' }),
    ).toThrow('content is required')
    expect(() =>
      createMindInteraction(db, { id: 'x', creatorId: 'creator_a', role: 'user', content: '   ' }),
    ).toThrow('content is required')
    db.close()
  })

  it('validates missing creator', () => {
    const db = testDb()
    expect(() =>
      createMindInteraction(db, { id: 'x', creatorId: 'ghost', role: 'user', content: 'hi' }),
    ).toThrow('creator profile not found')
    expect(() => listMindInteractions(db, 'ghost')).toThrow('creator profile not found')
    expect(() => getMindInteraction(db, '')).toThrow('id is required')
    db.close()
  })

  it('persistence after close/reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mind-int-'))
    try {
      const dbPath = join(dir, 'test.db')
      const db1 = createDatabase(dbPath)
      migrate(db1)
      createCreatorProfile(db1, { creatorId: 'persist_a', displayName: 'Persist' })
      createMindInteraction(db1, { id: 'int_p', creatorId: 'persist_a', role: 'user', content: 'persist hello' })
      db1.close()

      const db2 = createDatabase(dbPath)
      migrate(db2)
      const fetched = getMindInteraction(db2, 'int_p')
      expect(fetched?.content).toBe('persist hello')
      db2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cascade delete with creator', () => {
    const db = testDb()
    createMindInteraction(db, { id: 'int_cascade', creatorId: 'creator_a', role: 'user', content: 'to be deleted' })
    expect(deleteCreatorProfile(db, 'creator_a')).toBe(true)
    expect(getMindInteraction(db, 'int_cascade')).toBeUndefined()
    // list should throw because creator gone
    expect(() => listMindInteractions(db, 'creator_a')).toThrow('creator profile not found')
    db.close()
  })

  it('duplicate ID', () => {
    const db = testDb()
    createMindInteraction(db, { id: 'dup', creatorId: 'creator_a', role: 'user', content: 'first' })
    expect(() =>
      createMindInteraction(db, { id: 'dup', creatorId: 'creator_a', role: 'user', content: 'second' }),
    ).toThrow()
    db.close()
  })

  it('invalid limit/offset', () => {
    const db = testDb()
    expect(() => listMindInteractions(db, 'creator_a', { limit: 0 })).toThrow('limit must be')
    expect(() => listMindInteractions(db, 'creator_a', { limit: 101 })).toThrow('limit must be')
    expect(() => listMindInteractions(db, 'creator_a', { limit: 1.5 as unknown as number })).toThrow()
    expect(() => listMindInteractions(db, 'creator_a', { offset: -1 })).toThrow('offset must be')
    db.close()
  })
})
