import { describe, expect, it } from 'vitest'
import {
  createCreatorProfile,
  createDatabase,
  deleteCreatorProfile,
  getCreatorProfile,
  listCreatorProfiles,
  migrate,
  updateCreatorProfile,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  return db
}

describe('creator profiles', () => {
  it('creates and retrieves a profile', () => {
    const db = testDb()
    const created = createCreatorProfile(db, {
      creatorId: 'creator_01',
      displayName: 'Ada Lovelace',
      bio: 'First programmer.',
      avatarUrl: 'https://example.com/ada.png',
    })

    expect(created.creatorId).toBe('creator_01')
    expect(created.displayName).toBe('Ada Lovelace')
    expect(created.bio).toBe('First programmer.')
    expect(created.avatarUrl).toBe('https://example.com/ada.png')
    expect(created.createdAt).toBeTruthy()
    expect(created.updatedAt).toBeTruthy()

    const fetched = getCreatorProfile(db, 'creator_01')
    expect(fetched).toEqual(created)
    db.close()
  })

  it('defaults bio and avatarUrl to empty strings', () => {
    const db = testDb()
    const created = createCreatorProfile(db, {
      creatorId: 'creator_02',
      displayName: 'Grace Hopper',
    })

    expect(created.bio).toBe('')
    expect(created.avatarUrl).toBe('')
    db.close()
  })

  it('returns undefined for a non-existent profile', () => {
    const db = testDb()
    expect(getCreatorProfile(db, 'missing')).toBeUndefined()
    db.close()
  })

  it('updates fields and refreshes updatedAt', () => {
    const db = testDb()
    const created = createCreatorProfile(db, {
      creatorId: 'creator_03',
      displayName: 'Alan Turing',
      bio: 'Original bio.',
    })
    const originalUpdatedAt = created.updatedAt

    const updated = updateCreatorProfile(db, 'creator_03', {
      displayName: 'Alan M. Turing',
      bio: 'Revised bio.',
    })

    expect(updated.displayName).toBe('Alan M. Turing')
    expect(updated.bio).toBe('Revised bio.')
    expect(updated.avatarUrl).toBe('')
    expect(updated.updatedAt >= originalUpdatedAt).toBe(true)

    const fetched = getCreatorProfile(db, 'creator_03')
    expect(fetched).toEqual(updated)
    db.close()
  })

  it('rejects an update for a non-existent profile', () => {
    const db = testDb()
    expect(() => updateCreatorProfile(db, 'missing', { bio: 'nope' })).toThrow(
      'creator profile not found: missing',
    )
    db.close()
  })

  it('rejects an empty update', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'creator_04', displayName: 'Edsger Dijkstra' })
    expect(() => updateCreatorProfile(db, 'creator_04', {})).toThrow(
      'update must contain at least one field',
    )
    db.close()
  })

  it('rejects a blank display name on create', () => {
    const db = testDb()
    expect(() =>
      createCreatorProfile(db, { creatorId: 'creator_05', displayName: '   ' }),
    ).toThrow('displayName is required and must be a non-empty string')
    expect(getCreatorProfile(db, 'creator_05')).toBeUndefined()
    db.close()
  })

  it('rejects a blank display name on update', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'creator_06', displayName: 'Barbara Liskov' })
    expect(() => updateCreatorProfile(db, 'creator_06', { displayName: '' })).toThrow(
      'displayName must be a non-empty string',
    )
    const fetched = getCreatorProfile(db, 'creator_06')
    expect(fetched?.displayName).toBe('Barbara Liskov')
    db.close()
  })

  it('rejects a duplicate creatorId', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'creator_07', displayName: 'Donald Knuth' })
    expect(() =>
      createCreatorProfile(db, { creatorId: 'creator_07', displayName: 'Second Try' }),
    ).toThrow()
    db.close()
  })

  it('deletes a profile', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'creator_08', displayName: 'Linus Torvalds' })

    expect(deleteCreatorProfile(db, 'creator_08')).toBe(true)
    expect(getCreatorProfile(db, 'creator_08')).toBeUndefined()
    expect(deleteCreatorProfile(db, 'creator_08')).toBe(false)
    db.close()
  })
})

describe('listCreatorProfiles', () => {
  function seededDb() {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'c_1', displayName: 'Bob' })
    createCreatorProfile(db, { creatorId: 'c_2', displayName: 'alice' })
    createCreatorProfile(db, { creatorId: 'c_3', displayName: 'Zoe', bio: 'Loves synthwave music.' })
    createCreatorProfile(db, { creatorId: 'c_4', displayName: 'Alice' })
    createCreatorProfile(db, { creatorId: 'c_5', displayName: 'Top 100% Creator' })
    createCreatorProfile(db, {
      creatorId: 'c_6',
      displayName: 'Underscore Fan',
      bio: 'a_b special.',
    })
    return db
  }

  it('returns an empty list for an empty database', () => {
    const db = testDb()
    expect(listCreatorProfiles(db)).toEqual({ creators: [], total: 0 })
    db.close()
  })

  it('lists all creators ordered by displayName (case-insensitive) then creatorId', () => {
    const db = seededDb()
    const { creators, total } = listCreatorProfiles(db)

    expect(total).toBe(6)
    expect(creators.map((c) => c.creatorId)).toEqual(['c_2', 'c_4', 'c_1', 'c_5', 'c_6', 'c_3'])
    db.close()
  })

  it('filters by displayName case-insensitively', () => {
    const db = seededDb()
    const { creators, total } = listCreatorProfiles(db, { query: 'ALICE' })

    expect(total).toBe(2)
    expect(creators.map((c) => c.creatorId)).toEqual(['c_2', 'c_4'])
    db.close()
  })

  it('filters by bio case-insensitively', () => {
    const db = seededDb()
    const { creators, total } = listCreatorProfiles(db, { query: 'SYNTHWAVE' })

    expect(total).toBe(1)
    expect(creators[0]?.creatorId).toBe('c_3')
    db.close()
  })

  it('treats % in the query literally', () => {
    const db = seededDb()

    const literal = listCreatorProfiles(db, { query: '100%' })
    expect(literal.total).toBe(1)
    expect(literal.creators[0]?.creatorId).toBe('c_5')

    // An unescaped % would match every row; a literal % must not.
    const bare = listCreatorProfiles(db, { query: '%' })
    expect(bare.total).toBe(1)
    expect(bare.creators[0]?.creatorId).toBe('c_5')
    db.close()
  })

  it('treats _ in the query literally', () => {
    const db = seededDb()
    const { creators, total } = listCreatorProfiles(db, { query: '_' })

    expect(total).toBe(1)
    expect(creators[0]?.creatorId).toBe('c_6')
    db.close()
  })

  it('paginates with limit and offset and reports the full total', () => {
    const db = seededDb()

    const first = listCreatorProfiles(db, { limit: 2 })
    expect(first.creators.map((c) => c.creatorId)).toEqual(['c_2', 'c_4'])
    expect(first.total).toBe(6)

    const second = listCreatorProfiles(db, { limit: 2, offset: 2 })
    expect(second.creators.map((c) => c.creatorId)).toEqual(['c_1', 'c_5'])
    expect(second.total).toBe(6)

    const pastEnd = listCreatorProfiles(db, { limit: 2, offset: 10 })
    expect(pastEnd.creators).toEqual([])
    expect(pastEnd.total).toBe(6)
    db.close()
  })

  it('defaults limit to 50 and caps it at 100', () => {
    const db = testDb()
    for (let i = 0; i < 55; i += 1) {
      createCreatorProfile(db, {
        creatorId: `bulk_${String(i).padStart(2, '0')}`,
        displayName: `Creator ${String(i).padStart(2, '0')}`,
      })
    }

    const { creators, total } = listCreatorProfiles(db)
    expect(total).toBe(55)
    expect(creators.length).toBe(50)
    expect(creators[0]?.creatorId).toBe('bulk_00')

    const capped = listCreatorProfiles(db, { limit: 100 })
    expect(capped.creators.length).toBe(55)
    db.close()
  })

  it('rejects invalid limit and offset values', () => {
    const db = seededDb()

    expect(() => listCreatorProfiles(db, { limit: 0 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => listCreatorProfiles(db, { limit: 101 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => listCreatorProfiles(db, { limit: 1.5 })).toThrow()
    expect(() => listCreatorProfiles(db, { limit: -1 })).toThrow()
    expect(() => listCreatorProfiles(db, { offset: -1 })).toThrow(
      'offset must be a non-negative integer',
    )
    expect(() => listCreatorProfiles(db, { offset: 0.5 })).toThrow()
    db.close()
  })
})
