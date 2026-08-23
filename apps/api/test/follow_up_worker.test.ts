import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  createFollowUp,
  getFollowUp,
  listMindInteractions,
  migrate,
} from '@linkup/db'
import { createFollowUpWorker } from '../src/services/follow_up_worker.js'

function testDb() {
  const db: Database.Database = createDatabase(':memory:')
  migrate(db)
  return db
}

/** Adapter that always succeeds with a canned draft. */
const goodAdapter = {
  async query(_context: unknown, input: string): Promise<string> {
    return `Draft nudge re: ${input.slice(0, 40)}`
  },
}

/** Adapter that simulates provider failure. */
const badAdapter = {
  async query(): Promise<string> {
    throw new Error('provider down')
  },
}

async function seedAcceptedCollab(db: Database.Database, id = 'c_auto'): Promise<void> {
  createCreatorProfile(db, { creatorId: 'init', displayName: 'Initiator' })
  createCreatorProfile(db, { creatorId: 'targ', displayName: 'Target' })
  createCollaboration(db, { id, initiatorId: 'init', targetId: 'targ', proposal: 'Joint stream' })
  createFollowUp(db, {
    id: `${id}-fu`,
    collaborationId: id,
    dueAt: '2026-01-01T00:00:00Z', // already due
  })
}

describe('autonomous follow-up worker', () => {
  it('processes a due follow-up end to end: drafts, records interactions, completes', async () => {
    const db = testDb()
    await seedAcceptedCollab(db)

    const worker = createFollowUpWorker({ db, adapter: goodAdapter })
    const result = await worker.tick(new Date('2026-09-01T00:00:00Z'))

    expect(result.processed).toBe(1)
    expect(result.completed).toBe(1)
    expect(getFollowUp(db, 'c_auto-fu')?.status).toBe('completed')

    // Persistence: both turns of the autonomous exchange are recorded.
    const interactions = listMindInteractions(db, 'init')
    expect(interactions.interactions.length).toBeGreaterThanOrEqual(2)
    expect(interactions.interactions.some((i) => i.content.includes('[autonomous follow-up]'))).toBe(true)
    db.close()
  })

  it('retries on adapter failure and cancels after max attempts', async () => {
    const db = testDb()
    await seedAcceptedCollab(db, 'c_fail')

    const worker = createFollowUpWorker({
      db,
      adapter: badAdapter,
      maxAttempts: 2,
      retryDelayMs: 1000,
    })
    const now = new Date('2026-09-01T00:00:00Z')

    const first = await worker.tick(now)
    expect(first.retried).toBe(1)
    expect(getFollowUp(db, 'c_fail-fu')?.status).toBe('pending')

    // Second failure hits maxAttempts -> cancelled.
    const second = await worker.tick(new Date(now.getTime() + 2000))
    expect(second.retried).toBe(1)
    expect(getFollowUp(db, 'c_fail-fu')?.status).toBe('cancelled')

    // Cancelled follow-ups never come back.
    const third = await worker.tick(new Date(now.getTime() + 4000))
    expect(third.processed).toBe(0)
    db.close()
  })

  it('does nothing when the queue is empty', async () => {
    const db = testDb()
    const worker = createFollowUpWorker({ db, adapter: goodAdapter })
    const result = await worker.tick()
    expect(result.processed).toBe(0)
    db.close()
  })
})
