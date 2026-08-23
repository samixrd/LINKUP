import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createDatabase,
  getAccountProfile,
  loginWithPin,
  logoutSession,
  migrate,
  registerAccount,
  resolveSession,
} from '../src/index.js'

function testDb() {
  const db: Database.Database = createDatabase(':memory:')
  migrate(db)
  return db
}

describe('passcode auth', () => {
  it('registers an account with a creator profile in one step', () => {
    const db = testDb()
    const { account, profile } = registerAccount(db, {
      handle: 'alice_music',
      pin: '1234',
      displayName: 'Alice',
    })
    expect(account.handle).toBe('alice_music')
    expect(account.creatorId).toBe('u_alice_music')
    expect(profile.displayName).toBe('Alice')
    db.close()
  })

  it('rejects duplicate handles, bad handles, and bad pins', () => {
    const db = testDb()
    registerAccount(db, { handle: 'bob', pin: '0000', displayName: 'Bob' })

    expect(() => registerAccount(db, { handle: 'bob', pin: '1111', displayName: 'B2' })).toThrow(
      'handle already taken',
    )
    expect(() => registerAccount(db, { handle: 'AB', pin: '1111', displayName: 'X' })).toThrow(/handle/)
    expect(() => registerAccount(db, { handle: 'ok_handle', pin: '12', displayName: 'X' })).toThrow(/pin/)
    expect(() => registerAccount(db, { handle: 'ok_handle', pin: 'abcd', displayName: 'X' })).toThrow(/pin/)
    db.close()
  })

  it('logs in with the right pin and rejects wrong pin/handle identically', () => {
    const db = testDb()
    registerAccount(db, { handle: 'carol', pin: '4321', displayName: 'Carol' })

    const session = loginWithPin(db, 'CAROL', '4321') // case-insensitive handle
    expect(session.creatorId).toBe('u_carol')
    expect(session.token).toMatch(/^[a-f0-9]{64}$/)

    expect(() => loginWithPin(db, 'carol', '9999')).toThrow('invalid handle or pin')
    expect(() => loginWithPin(db, 'nobody', '1234')).toThrow('invalid handle or pin')
    db.close()
  })

  it('resolves sessions and deletes expired ones', async () => {
    const db = testDb()
    registerAccount(db, { handle: 'dave', pin: '1111', displayName: 'Dave' })
    const session = loginWithPin(db, 'dave', '1111')

    const resolved = resolveSession(db, session.token)
    expect(resolved?.creatorId).toBe('u_dave')

    // Force-expire
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z'").run()
    expect(resolveSession(db, session.token)).toBeUndefined()
    const count = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }
    expect(count.n).toBe(0)

    expect(resolveSession(db, 'garbage')).toBeUndefined()
    db.close()
  })

  it('logs out and invalidates the token', () => {
    const db = testDb()
    registerAccount(db, { handle: 'erin', pin: '2222', displayName: 'Erin' })
    const session = loginWithPin(db, 'erin', '2222')

    expect(logoutSession(db, session.token)).toBe(true)
    expect(resolveSession(db, session.token)).toBeUndefined()
    expect(logoutSession(db, session.token)).toBe(false)
    db.close()
  })

  it('stores only hashed pins (no plaintext in the DB)', () => {
    const db = testDb()
    registerAccount(db, { handle: 'frank', pin: '778899', displayName: 'Frank' })
    const row = db.prepare('SELECT pin_hash FROM accounts WHERE handle = ?').get('frank') as {
      pin_hash: string
    }
    expect(row.pin_hash).not.toContain('778899')
    expect(row.pin_hash.startsWith('scrypt:')).toBe(true)
    db.close()
  })

  it('links account to profile via getAccountProfile', () => {
    const db = testDb()
    registerAccount(db, { handle: 'gina', pin: '3333', displayName: 'Gina', bio: 'Vlogger' })
    const profile = getAccountProfile(db, 'gina')
    expect(profile?.displayName).toBe('Gina')
    expect(profile?.bio).toBe('Vlogger')
    db.close()
  })
})
