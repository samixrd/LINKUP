import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addCreatorMemory,
  createCreatorProfile,
  createDatabase,
  deleteCreatorMemory,
  deleteCreatorProfile,
  getCreatorMemory,
  listCreatorMemories,
  migrate,
  searchCreatorMemories,
  updateCreatorMemory,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  createCreatorProfile(db, { creatorId: 'creator_a', displayName: 'Ada Lovelace' })
  createCreatorProfile(db, { creatorId: 'creator_b', displayName: 'Grace Hopper' })
  return db
}

function addPreference() {
  return {
    id: 'memory_01',
    creatorId: 'creator_a',
    category: 'preference' as const,
    content: 'Prefers async text over sync calls.',
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('creator memories', () => {
  it('creates and retrieves a memory', () => {
    const db = testDb()
    const created = addCreatorMemory(db, addPreference())

    expect(created).toMatchObject(addPreference())
    expect(created.createdAt).toBeTruthy()
    expect(created.updatedAt).toBeTruthy()

    const fetched = getCreatorMemory(db, 'memory_01')
    expect(fetched).toEqual(created)
    db.close()
  })

  it('returns undefined for a non-existent memory', () => {
    const db = testDb()
    expect(getCreatorMemory(db, 'missing')).toBeUndefined()
    db.close()
  })

  it('updates fields and refreshes updatedAt', async () => {
    const db = testDb()
    const created = addCreatorMemory(db, addPreference())
    await delay(5)

    const updated = updateCreatorMemory(db, 'memory_01', {
      category: 'lesson',
      content: 'Learned: async text works best.',
    })

    expect(updated.category).toBe('lesson')
    expect(updated.content).toBe('Learned: async text works best.')
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt > created.updatedAt).toBe(true)

    const fetched = getCreatorMemory(db, 'memory_01')
    expect(fetched).toEqual(updated)
    db.close()
  })

  it('deletes a memory', () => {
    const db = testDb()
    addCreatorMemory(db, addPreference())

    expect(deleteCreatorMemory(db, 'memory_01')).toBe(true)
    expect(getCreatorMemory(db, 'memory_01')).toBeUndefined()
    expect(deleteCreatorMemory(db, 'memory_01')).toBe(false)
    db.close()
  })

  it('filters by category', () => {
    const db = testDb()
    addCreatorMemory(db, addPreference())
    addCreatorMemory(db, {
      id: 'memory_02',
      creatorId: 'creator_a',
      category: 'goal',
      content: 'Ship the memory feature.',
    })
    addCreatorMemory(db, {
      id: 'memory_03',
      creatorId: 'creator_a',
      category: 'goal',
      content: 'Land a second feature.',
    })

    const goals = listCreatorMemories(db, { category: 'goal' })
    expect(goals.map((m) => m.id)).toEqual(['memory_02', 'memory_03'])

    const preferences = listCreatorMemories(db, { category: 'preference' })
    expect(preferences.map((m) => m.id)).toEqual(['memory_01'])
    db.close()
  })

  it('filters by creatorId, alone and combined with category', () => {
    const db = testDb()
    addCreatorMemory(db, addPreference())
    addCreatorMemory(db, {
      id: 'memory_02',
      creatorId: 'creator_b',
      category: 'goal',
      content: 'Hopper goal.',
    })
    addCreatorMemory(db, {
      id: 'memory_03',
      creatorId: 'creator_a',
      category: 'goal',
      content: 'Ada goal.',
    })

    const adaGoals = listCreatorMemories(db, { creatorId: 'creator_a', category: 'goal' })
    expect(adaGoals.map((m) => m.id)).toEqual(['memory_03'])
    db.close()
  })

  it('rejects an unknown category filter', () => {
    const db = testDb()
    expect(() => listCreatorMemories(db, { category: 'bogus' as never })).toThrow(
      'category must be one of: preference, goal, relationship, collaboration_outcome, lesson, constraint, interaction',
    )
    db.close()
  })

  it('isolates memories between creators', () => {
    const db = testDb()
    addCreatorMemory(db, addPreference())
    addCreatorMemory(db, {
      id: 'memory_02',
      creatorId: 'creator_b',
      category: 'goal',
      content: 'Hopper goal.',
    })

    const adaMemories = listCreatorMemories(db, { creatorId: 'creator_a' })
    expect(adaMemories.map((m) => m.id)).toEqual(['memory_01'])

    const hopperMemories = listCreatorMemories(db, { creatorId: 'creator_b' })
    expect(hopperMemories.map((m) => m.id)).toEqual(['memory_02'])
    db.close()
  })

  it('enforces the foreign key to the creator profile', () => {
    const db = testDb()
    expect(() =>
      addCreatorMemory(db, {
        id: 'memory_orphan',
        creatorId: 'missing_creator',
        category: 'goal',
        content: 'Orphaned.',
      }),
    ).toThrow('creator profile not found: missing_creator')

    expect(() =>
      db
        .prepare(
          `INSERT INTO creator_memories (id, creator_id, category, content)
           VALUES (?, ?, ?, ?)`,
        )
        .run('memory_orphan', 'missing_creator', 'goal', 'Orphaned.'),
    ).toThrow(/FOREIGN KEY/i)
    db.close()
  })

  it('cascades memory deletion with its creator', () => {
    const db = testDb()
    addCreatorMemory(db, {
      id: 'memory_02',
      creatorId: 'creator_b',
      category: 'goal',
      content: 'Hopper goal.',
    })

    expect(deleteCreatorProfile(db, 'creator_b')).toBe(true)
    expect(getCreatorMemory(db, 'memory_02')).toBeUndefined()
    expect(listCreatorMemories(db, { creatorId: 'creator_b' })).toEqual([])
    expect(listCreatorMemories(db)).toEqual([])
    db.close()
  })

  it('persists across a database close and reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linkup-memories-'))
    try {
      const dbPath = join(dir, 'test.db')

      const first = createDatabase(dbPath)
      migrate(first)
      createCreatorProfile(first, { creatorId: 'creator_p', displayName: 'Persistent' })
      addCreatorMemory(first, {
        id: 'memory_p',
        creatorId: 'creator_p',
        category: 'lesson',
        content: 'Survives restarts.',
      })
      first.close()

      const second = createDatabase(dbPath)
      migrate(second)
      const fetched = getCreatorMemory(second, 'memory_p')
      expect(fetched).toMatchObject({
        id: 'memory_p',
        creatorId: 'creator_p',
        category: 'lesson',
        content: 'Survives restarts.',
      })
      expect(fetched?.createdAt).toBeTruthy()
      expect(fetched?.updatedAt).toBeTruthy()
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates required fields on create', () => {
    const db = testDb()
    expect(() => addCreatorMemory(db, { ...addPreference(), id: '   ' })).toThrow(
      'id is required and must be a non-empty string',
    )
    expect(() => addCreatorMemory(db, { ...addPreference(), creatorId: '' })).toThrow(
      'creatorId is required and must be a non-empty string',
    )
    expect(() =>
      addCreatorMemory(db, { ...addPreference(), category: 'bogus' as never }),
    ).toThrow(
      'category must be one of: preference, goal, relationship, collaboration_outcome, lesson, constraint, interaction',
    )
    expect(() => addCreatorMemory(db, { ...addPreference(), content: '   ' })).toThrow(
      'content is required and must be a non-empty string',
    )
    expect(getCreatorMemory(db, 'memory_01')).toBeUndefined()
    db.close()
  })

  it('validates fields on update', () => {
    const db = testDb()
    addCreatorMemory(db, addPreference())

    expect(() => updateCreatorMemory(db, 'missing', { content: 'nope' })).toThrow(
      'creator memory not found: missing',
    )
    expect(() => updateCreatorMemory(db, 'memory_01', {})).toThrow(
      'update must contain at least one field',
    )
    expect(() => updateCreatorMemory(db, 'memory_01', { content: '' })).toThrow(
      'content is required and must be a non-empty string',
    )
    expect(() =>
      updateCreatorMemory(db, 'memory_01', { category: 'bogus' as never }),
    ).toThrow(
      'category must be one of: preference, goal, relationship, collaboration_outcome, lesson, constraint, interaction',
    )

    const fetched = getCreatorMemory(db, 'memory_01')
    expect(fetched?.content).toBe('Prefers async text over sync calls.')
    db.close()
  })

  it('rejects a duplicate memory id', () => {
    const db = testDb()
    addCreatorMemory(db, addPreference())
    expect(() => addCreatorMemory(db, { ...addPreference(), content: 'Duplicate.' })).toThrow()
    db.close()
  })
})

describe('searchCreatorMemories', () => {
  /** A subject creator whose memories have distinct term coverage. */
  function searchDb() {
    const db = testDb()
    addCreatorMemory(db, {
      id: 'search_high',
      creatorId: 'creator_a',
      category: 'preference',
      content: 'Loves electronic music production.',
    })
    addCreatorMemory(db, {
      id: 'search_mid',
      creatorId: 'creator_a',
      category: 'goal',
      content: 'Enjoys electronic music.',
    })
    addCreatorMemory(db, {
      id: 'search_low',
      creatorId: 'creator_a',
      category: 'preference',
      content: 'Produces electronic beats for fun.',
    })
    addCreatorMemory(db, {
      id: 'search_none',
      creatorId: 'creator_a',
      category: 'constraint',
      content: 'Prefers quiet studio sessions.',
    })
    return db
  }

  it('ranks matching memories by the number of query terms they contain', () => {
    const db = searchDb()
    const result = searchCreatorMemories(db, 'creator_a', 'electronic music production')

    expect(result.total).toBe(3)
    expect(result.memories.map((m) => m.id)).toEqual([
      'search_high',
      'search_mid',
      'search_low',
    ])
    db.close()
  })

  it('returns the full memory objects', () => {
    const db = searchDb()
    const result = searchCreatorMemories(db, 'creator_a', 'electronic')

    expect(result.memories[0]).toMatchObject({
      id: 'search_high',
      creatorId: 'creator_a',
      category: 'preference',
      content: 'Loves electronic music production.',
    })
    expect(result.memories[0]?.createdAt).toBeTruthy()
    expect(result.memories[0]?.updatedAt).toBeTruthy()
    db.close()
  })

  it('matches case-insensitively', () => {
    const db = searchDb()
    const result = searchCreatorMemories(db, 'creator_a', 'ELECTRONIC MUSIC')

    expect(result.memories.map((m) => m.id)).toEqual([
      'search_high',
      'search_mid',
      'search_low',
    ])
    db.close()
  })

  it('ignores stopwords and short tokens in the query', () => {
    const db = searchDb()
    const result = searchCreatorMemories(db, 'creator_a', 'the and of music')

    expect(result.memories.map((m) => m.id)).toEqual(['search_high', 'search_mid'])
    db.close()
  })

  it('only searches the creator’s own memories', () => {
    const db = searchDb()
    addCreatorMemory(db, {
      id: 'search_other',
      creatorId: 'creator_b',
      category: 'preference',
      content: 'Loves electronic music production.',
    })

    const result = searchCreatorMemories(db, 'creator_a', 'electronic music production')
    expect(result.memories.every((m) => m.creatorId === 'creator_a')).toBe(true)
    expect(result.memories.some((m) => m.id === 'search_other')).toBe(false)
    expect(result.total).toBe(3)
    db.close()
  })

  it('returns no results when nothing matches', () => {
    const db = searchDb()
    expect(searchCreatorMemories(db, 'creator_a', 'zebra unicorn')).toEqual({
      memories: [],
      total: 0,
    })
    db.close()
  })

  it('returns no results for a query with no searchable terms', () => {
    const db = searchDb()
    // All stopwords: normalizes to an empty term set, so nothing can match.
    expect(searchCreatorMemories(db, 'creator_a', 'the and of')).toEqual({
      memories: [],
      total: 0,
    })
    db.close()
  })

  it('requires a whole-token match (no stemming)', () => {
    const db = searchDb()
    // 'loved' does not match 'loves', 'production' does not match 'produces', etc.
    const result = searchCreatorMemories(db, 'creator_a', 'loved')
    expect(result.total).toBe(0)
    db.close()
  })

  it('paginates with limit and offset and reports the full total', () => {
    const db = searchDb()

    // 'electronic music' scores high 2, mid 2, low 1 — no timing-dependent ties.
    const first = searchCreatorMemories(db, 'creator_a', 'electronic music', { limit: 1 })
    expect(first.memories.map((m) => m.id)).toEqual(['search_high'])
    expect(first.total).toBe(3)

    const second = searchCreatorMemories(db, 'creator_a', 'electronic music', {
      limit: 1,
      offset: 1,
    })
    expect(second.memories.map((m) => m.id)).toEqual(['search_mid'])
    expect(second.total).toBe(3)

    const pastEnd = searchCreatorMemories(db, 'creator_a', 'electronic music', {
      limit: 1,
      offset: 10,
    })
    expect(pastEnd.memories).toEqual([])
    expect(pastEnd.total).toBe(3)
    db.close()
  })

  it('orders equal-score results by createdAt then id', async () => {
    const db = testDb()
    addCreatorMemory(db, {
      id: 'search_first',
      creatorId: 'creator_a',
      category: 'goal',
      content: 'Loves music.',
    })
    await delay(5)
    addCreatorMemory(db, {
      id: 'search_second',
      creatorId: 'creator_a',
      category: 'goal',
      content: 'Enjoys music.',
    })

    const result = searchCreatorMemories(db, 'creator_a', 'music')
    expect(result.memories.map((m) => m.id)).toEqual(['search_first', 'search_second'])
    expect(result.memories).toHaveLength(2)
    expect(result.memories[0]!.createdAt < result.memories[1]!.createdAt).toBe(true)
    db.close()
  })

  it('rejects invalid limit and offset values', () => {
    const db = searchDb()
    expect(() => searchCreatorMemories(db, 'creator_a', 'electronic', { limit: 0 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => searchCreatorMemories(db, 'creator_a', 'electronic', { limit: 101 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => searchCreatorMemories(db, 'creator_a', 'electronic', { limit: 1.5 })).toThrow()
    expect(() => searchCreatorMemories(db, 'creator_a', 'electronic', { limit: -1 })).toThrow()
    expect(() => searchCreatorMemories(db, 'creator_a', 'electronic', { offset: -1 })).toThrow(
      'offset must be a non-negative integer',
    )
    expect(() => searchCreatorMemories(db, 'creator_a', 'electronic', { offset: 0.5 })).toThrow()
    db.close()
  })

  it('throws when the creator does not exist', () => {
    const db = searchDb()
    expect(() => searchCreatorMemories(db, 'ghost', 'music')).toThrow(
      'creator profile not found: ghost',
    )
    db.close()
  })

  it('throws for an empty query', () => {
    const db = searchDb()
    expect(() => searchCreatorMemories(db, 'creator_a', '')).toThrow(
      'query is required and must be a non-empty string',
    )
    expect(() => searchCreatorMemories(db, 'creator_a', '   ')).toThrow(
      'query is required and must be a non-empty string',
    )
    // @ts-expect-error non-string query
    expect(() => searchCreatorMemories(db, 'creator_a', 123)).toThrow(
      'query is required and must be a non-empty string',
    )
    db.close()
  })
})
