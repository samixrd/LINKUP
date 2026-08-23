import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createCreatorProfile,
  createDatabase,
  evaluateThreshold,
  findThresholdMatches,
  getOpenCollab,
  migrate,
  setOpenCollab,
} from '../src/index.js'

function testDb() {
  const db: Database.Database = createDatabase(':memory:')
  migrate(db)
  return db
}

describe('open collabs & threshold matching', () => {
  it('stores and returns a terms card', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'big', displayName: 'BigShot' })
    setOpenCollab(db, {
      creatorId: 'big',
      openToCollab: true,
      myFollowers: 1_000_000,
      minPartnerFollowers: 100,
      languages: ['en'],
      topics: ['music', 'gaming'],
    })
    const card = getOpenCollab(db, 'big')
    expect(card?.myFollowers).toBe(1_000_000)
    expect(card?.minPartnerFollowers).toBe(100)
    expect(card?.openToCollab).toBe(true)
    db.close()
  })

  it('lets a 1M creator accept a 100-follower creator (low bar)', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'mega', displayName: 'MegaStar' })
    createCreatorProfile(db, { creatorId: 'tiny', displayName: 'SmallFish' })
    setOpenCollab(db, {
      creatorId: 'mega',
      openToCollab: true,
      myFollowers: 1_000_000,
      minPartnerFollowers: 100,
      languages: ['en'],
    })
    setOpenCollab(db, {
      creatorId: 'tiny',
      openToCollab: true,
      myFollowers: 100,
      minPartnerFollowers: 0,
      languages: ['en'],
    })
    const matches = findThresholdMatches(db, 'tiny')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.them.creatorId).toBe('mega')
    db.close()
  })

  it('blocks when one side demands 900k+ but the other has less', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'picky', displayName: 'PickyStar' })
    createCreatorProfile(db, { creatorId: 'mid', displayName: 'MidCreator' })
    setOpenCollab(db, {
      creatorId: 'picky',
      openToCollab: true,
      myFollowers: 950_000,
      minPartnerFollowers: 900_000,
      languages: ['en'],
    })
    setOpenCollab(db, {
      creatorId: 'mid',
      openToCollab: true,
      myFollowers: 400_000,
      minPartnerFollowers: 0,
      languages: ['en'],
    })
    expect(findThresholdMatches(db, 'mid')).toHaveLength(0)
    expect(findThresholdMatches(db, 'picky')).toHaveLength(0)

    // Direct evaluation explains why
    const picky = getOpenCollab(db, 'picky')!
    const mid = getOpenCollab(db, 'mid')!
    expect(evaluateThreshold(mid, picky).sizeCompatible).toBe(false)
    db.close()
  })

  it('matches once the smaller creator crosses the threshold', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'star', displayName: 'Star' })
    createCreatorProfile(db, { creatorId: 'riser', displayName: 'Riser' })
    setOpenCollab(db, {
      creatorId: 'star',
      openToCollab: true,
      myFollowers: 1_000_000,
      minPartnerFollowers: 900_000,
      languages: ['en'],
    })
    const riser = { creatorId: 'riser', openToCollab: true, myFollowers: 899_999, minPartnerFollowers: 0, languages: ['en'] }
    setOpenCollab(db, riser)
    expect(findThresholdMatches(db, 'star')).toHaveLength(0)

    setOpenCollab(db, { ...riser, myFollowers: 900_001 })
    const matches = findThresholdMatches(db, 'star')
    expect(matches).toHaveLength(1)
    db.close()
  })

  it('requires a shared language ("*" matches any)', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'en_only', displayName: 'EnglishOnly' })
    createCreatorProfile(db, { creatorId: 'bn_only', displayName: 'BanglaOnly' })
    createCreatorProfile(db, { creatorId: 'any_lang', displayName: 'Polyglot' })
    setOpenCollab(db, { creatorId: 'en_only', openToCollab: true, myFollowers: 5000, minPartnerFollowers: 0, languages: ['en'] })
    setOpenCollab(db, { creatorId: 'bn_only', openToCollab: true, myFollowers: 5000, minPartnerFollowers: 0, languages: ['bn'] })
    setOpenCollab(db, { creatorId: 'any_lang', openToCollab: true, myFollowers: 7000, minPartnerFollowers: 0, languages: ['*'] })

    const enMatches = findThresholdMatches(db, 'en_only')
    expect(enMatches.map((m) => m.them.creatorId)).toEqual(['any_lang'])
    db.close()
  })

  it('excludes closed cards from the feed', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'me', displayName: 'Me' })
    createCreatorProfile(db, { creatorId: 'closed', displayName: 'BusyOne' })
    setOpenCollab(db, { creatorId: 'me', openToCollab: true, myFollowers: 100, minPartnerFollowers: 0, languages: ['*'] })
    setOpenCollab(db, { creatorId: 'closed', openToCollab: false, myFollowers: 999_999, minPartnerFollowers: 0, languages: ['*'] })
    expect(findThresholdMatches(db, 'me')).toHaveLength(0)
    db.close()
  })

  it('rejects invalid follower values', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'v', displayName: 'V' })
    expect(() =>
      setOpenCollab(db, { creatorId: 'v', openToCollab: true, myFollowers: -5, minPartnerFollowers: 0 }),
    ).toThrow(/non-negative/)
    expect(() =>
      setOpenCollab(db, { creatorId: 'ghost', openToCollab: true, myFollowers: 1, minPartnerFollowers: 0 }),
    ).toThrow(/not found/)
    db.close()
  })
})
