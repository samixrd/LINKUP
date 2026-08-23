import { describe, expect, it } from 'vitest'
import {
  addCreatorMemory,
  createCreatorProfile,
  createDatabase,
  findCompatibleCreators,
  migrate,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  return db
}

function seededDb() {
  const db = testDb()
  createCreatorProfile(db, {
    creatorId: 'subject',
    displayName: 'Ada Lovelace',
    bio: 'Music producer and painter.',
  })
  createCreatorProfile(db, {
    creatorId: 'match_high',
    displayName: 'Grace Hopper',
    bio: 'Music producer.',
  })
  createCreatorProfile(db, {
    creatorId: 'match_low',
    displayName: 'Alan Turing',
    bio: 'Plays guitar in a band.',
  })
  addCreatorMemory(db, {
    id: 'm1',
    creatorId: 'subject',
    category: 'preference',
    content: 'Loves electronic music.',
  })
  addCreatorMemory(db, {
    id: 'm2',
    creatorId: 'subject',
    category: 'goal',
    content: 'Plays guitar.',
  })
  addCreatorMemory(db, {
    id: 'm3',
    creatorId: 'match_high',
    category: 'preference',
    content: 'Enjoys electronic music.',
  })
  return db
}

describe('findCompatibleCreators', () => {
  it('ranks creators by shared terms from bio and memories', () => {
    const db = seededDb()
    const result = findCompatibleCreators(db, 'subject')

    expect(result.total).toBe(2)
    expect(result.matches.map((m) => m.creator.creatorId)).toEqual([
      'match_high',
      'match_low',
    ])
    expect(result.matches[0]?.score).toBe(3)
    expect(result.matches[1]?.score).toBe(2)
    db.close()
  })

  it('reports the shared terms that produced the score, sorted', () => {
    const db = seededDb()
    const result = findCompatibleCreators(db, 'subject')

    expect(result.matches[0]?.sharedTerms).toEqual(['electronic', 'music', 'producer'])
    expect(result.matches[1]?.sharedTerms).toEqual(['guitar', 'plays'])
    db.close()
  })

  it('includes the full creator profile on each match', () => {
    const db = seededDb()
    const result = findCompatibleCreators(db, 'subject')
    const match = result.matches[0]?.creator

    expect(match).toMatchObject({
      creatorId: 'match_high',
      displayName: 'Grace Hopper',
      bio: 'Music producer.',
    })
    expect(match?.createdAt).toBeTruthy()
    expect(match?.updatedAt).toBeTruthy()
    db.close()
  })

  it('excludes the subject creator', () => {
    const db = seededDb()
    const result = findCompatibleCreators(db, 'subject')

    expect(result.matches.some((m) => m.creator.creatorId === 'subject')).toBe(false)
    db.close()
  })

  it('breaks ties by displayName (case-insensitive) then creatorId', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Music lover.' })
    createCreatorProfile(db, { creatorId: 'tie_a', displayName: 'Zoe', bio: 'Loves music.' })
    createCreatorProfile(db, { creatorId: 'tie_b', displayName: 'alice', bio: 'Loves music.' })
    createCreatorProfile(db, { creatorId: 'tie_c', displayName: 'Zoe', bio: 'Loves music.' })

    const result = findCompatibleCreators(db, 'subject')
    expect(result.matches.map((m) => m.creator.creatorId)).toEqual([
      'tie_b',
      'tie_a',
      'tie_c',
    ])
    db.close()
  })

  it('returns no matches when the subject has no bio or memories', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'quiet', displayName: 'Quiet' })
    createCreatorProfile(db, { creatorId: 'loud', displayName: 'Loud', bio: 'Loves music.' })

    expect(findCompatibleCreators(db, 'quiet')).toEqual({ matches: [], total: 0 })
    db.close()
  })

  it('returns no matches when nobody shares a term', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Loves music.' })
    createCreatorProfile(db, {
      creatorId: 'other',
      displayName: 'Other',
      bio: 'Builds furniture.',
    })

    const result = findCompatibleCreators(db, 'subject')
    expect(result.matches).toEqual([])
    expect(result.total).toBe(0)
    db.close()
  })

  it('paginates with limit and offset and reports the full total', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Music.' })
    createCreatorProfile(db, { creatorId: 'p_1', displayName: 'One', bio: 'Music lover.' })
    createCreatorProfile(db, { creatorId: 'p_2', displayName: 'Two', bio: 'Music maker.' })
    createCreatorProfile(db, { creatorId: 'p_3', displayName: 'Three', bio: 'Music fan.' })

    const first = findCompatibleCreators(db, 'subject', { limit: 2 })
    expect(first.matches.map((m) => m.creator.creatorId)).toEqual(['p_1', 'p_3'])
    expect(first.total).toBe(3)

    const second = findCompatibleCreators(db, 'subject', { limit: 2, offset: 2 })
    expect(second.matches.map((m) => m.creator.creatorId)).toEqual(['p_2'])
    expect(second.total).toBe(3)

    const pastEnd = findCompatibleCreators(db, 'subject', { limit: 2, offset: 10 })
    expect(pastEnd.matches).toEqual([])
    expect(pastEnd.total).toBe(3)
    db.close()
  })

  it('rejects invalid limit and offset values', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Music.' })

    expect(() => findCompatibleCreators(db, 'subject', { limit: 0 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => findCompatibleCreators(db, 'subject', { limit: 101 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => findCompatibleCreators(db, 'subject', { limit: 1.5 })).toThrow()
    expect(() => findCompatibleCreators(db, 'subject', { limit: -1 })).toThrow()
    expect(() => findCompatibleCreators(db, 'subject', { offset: -1 })).toThrow(
      'offset must be a non-negative integer',
    )
    expect(() => findCompatibleCreators(db, 'subject', { offset: 0.5 })).toThrow()
    db.close()
  })

  it('throws when the subject creator does not exist', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'other', displayName: 'Other', bio: 'Music.' })

    expect(() => findCompatibleCreators(db, 'ghost')).toThrow(
      'creator profile not found: ghost',
    )
    db.close()
  })
})
