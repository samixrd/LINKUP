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

describe('weighted matching', () => {
  it('exposes weightedScore alongside score on every match', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Music producer.' })
    createCreatorProfile(db, { creatorId: 'partner', displayName: 'Partner', bio: 'Music producer.' })

    const result = findCompatibleCreators(db, 'subject')
    expect(result.total).toBe(1)
    const match = result.matches[0]
    expect(match?.score).toBe(2)
    expect(typeof match?.weightedScore).toBe('number')
    expect(match?.weightedScore).toBeGreaterThan(0)
    db.close()
  })

  it('ranks rare-term matches above common-term matches with the same raw score', () => {
    // Both candidates share exactly 1 term with the subject. "pottery" is
    // unique to candidate_rare; "music" is shared across many creators so its
    // IDF is lower. Weighted ranking must put the rare term first even though
    // raw `score` ties.
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Pottery music.' })
    createCreatorProfile(db, { creatorId: 'filler_1', displayName: 'F1', bio: 'Music fan.' })
    createCreatorProfile(db, { creatorId: 'filler_2', displayName: 'F2', bio: 'Music fan.' })
    createCreatorProfile(db, { creatorId: 'filler_3', displayName: 'F3', bio: 'Music fan.' })
    createCreatorProfile(db, { creatorId: 'common', displayName: 'Common', bio: 'Music critic.' })
    createCreatorProfile(db, { creatorId: 'rare', displayName: 'Rare', bio: 'Pottery expert.' })

    const result = findCompatibleCreators(db, 'subject')
    expect(result.matches.slice(0, 2).map((m) => m.creator.creatorId)).toEqual(['rare', 'common'])
    expect(result.matches[0]?.score).toBe(1)
    expect(result.matches[1]?.score).toBe(1)
    expect(result.matches[0]?.sharedTerms).toEqual(['pottery'])
    expect(result.matches[0]?.weightedScore).toBeGreaterThan(
      result.matches[1]?.weightedScore ?? 0,
    )
    db.close()
  })

  it('boosts terms backed by preference/goal memories over bio-only terms', () => {
    // Two candidates share exactly one term each. Candidate_pref's shared term
    // comes from a high-signal memory (goal); the other's is bio-only.
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Zebra quilting.' })
    addCreatorMemory(db, {
      id: 's_goal',
      creatorId: 'subject',
      category: 'goal',
      content: 'Wants zebra collabs.',
    })
    createCreatorProfile(db, { creatorId: 'pref', displayName: 'Pref', bio: 'Zebra keeper.' })
    addCreatorMemory(db, {
      id: 'p_goal',
      creatorId: 'pref',
      category: 'preference',
      content: 'Loves zebra art.',
    })
    createCreatorProfile(db, { creatorId: 'plain', displayName: 'Plain', bio: 'Quilting circle.' })

    const result = findCompatibleCreators(db, 'subject')
    expect(result.matches.map((m) => m.creator.creatorId)).toEqual(['pref', 'plain'])
    expect(result.matches[0]?.score).toBe(1)
    expect(result.matches[0]?.weightedScore).toBeGreaterThan(
      result.matches[1]?.weightedScore ?? 0,
    )
    db.close()
  })

  it('remains deterministic across repeated calls', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Music pottery.' })
    createCreatorProfile(db, { creatorId: 'a', displayName: 'Alice', bio: 'Music.' })
    createCreatorProfile(db, { creatorId: 'b', displayName: 'Bob', bio: 'Pottery.' })
    addCreatorMemory(db, { id: 'g1', creatorId: 'a', category: 'goal', content: 'More music.' })

    const first = findCompatibleCreators(db, 'subject')
    const second = findCompatibleCreators(db, 'subject')
    expect(first).toEqual(second)
    db.close()
  })
})
