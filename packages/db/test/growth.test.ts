import { describe, expect, it } from 'vitest'
import {
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  createFollowUp,
  getFollowUp,
  growthSummaryForCreator,
  listDueFollowUps,
  listGrowthOutcomesForCollaboration,
  migrate,
  recordGrowthOutcome,
  updateFollowUpStatus,
  updateCollaborationStatus,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  return db
}

describe('growth outcomes', () => {
  it('records a before/after metric and returns the outcome', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'a', displayName: 'Alice' })
    createCreatorProfile(db, { creatorId: 'b', displayName: 'Bob' })
    createCollaboration(db, {
      id: 'c1',
      initiatorId: 'a',
      targetId: 'b',
      proposal: 'Joint video',
    })
    updateCollaborationStatus(db, 'c1', 'accepted')

    const { outcome } = recordGrowthOutcome(db, {
      collaborationId: 'c1',
      creatorId: 'a',
      metric: 'followers',
      valueBefore: 1000,
      valueAfter: 1200,
    })
    expect(outcome.collaborationId).toBe('c1')
    expect(outcome.valueBefore).toBe(1000)
    expect(outcome.valueAfter).toBe(1200)

    const all = listGrowthOutcomesForCollaboration(db, 'c1')
    expect(all).toHaveLength(1)
    db.close()
  })

  it('writes a deterministic growth memory on terminal collaborations (idempotent)', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'a', displayName: 'Alice' })
    createCreatorProfile(db, { creatorId: 'b', displayName: 'Bob' })
    createCollaboration(db, { id: 'c2', initiatorId: 'a', targetId: 'b', proposal: 'Podcast' })
    updateCollaborationStatus(db, 'c2', 'accepted')

    const first = recordGrowthOutcome(db, {
      collaborationId: 'c2',
      creatorId: 'a',
      metric: 'followers',
      valueBefore: 500,
      valueAfter: 750,
    })
    // Re-record same triple -> idempotent update, not duplicate.
    const second = recordGrowthOutcome(db, {
      collaborationId: 'c2',
      creatorId: 'a',
      metric: 'followers',
      valueBefore: 500,
      valueAfter: 800,
    })

    expect(first.memory?.content).toContain('grew by 250')
    expect(second.memory?.id).toBe(first.memory?.id)
    expect(second.memory?.content).toContain('grew by 300')
    db.close()
  })

  it('rejects non-participants and invalid values', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'a', displayName: 'Alice' })
    createCreatorProfile(db, { creatorId: 'b', displayName: 'Bob' })
    createCollaboration(db, { id: 'c3', initiatorId: 'a', targetId: 'b', proposal: 'X' })

    expect(() =>
      recordGrowthOutcome(db, { collaborationId: 'c3', creatorId: 'ghost', metric: 'followers', valueBefore: 0, valueAfter: 10 }),
    ).toThrow(/not a participant/)
    expect(() =>
      recordGrowthOutcome(db, { collaborationId: 'c3', creatorId: 'a', metric: 'followers', valueBefore: -1, valueAfter: 10 }),
    ).toThrow(/valueBefore must be a non-negative integer/)
    db.close()
  })

  it('summarizes per-metric deltas for a creator', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'a', displayName: 'Alice' })
    createCreatorProfile(db, { creatorId: 'b', displayName: 'Bob' })
    createCollaboration(db, { id: 'c4', initiatorId: 'a', targetId: 'b', proposal: 'X' })
    updateCollaborationStatus(db, 'c4', 'accepted')

    recordGrowthOutcome(db, { collaborationId: 'c4', creatorId: 'a', metric: 'followers', valueBefore: 1000, valueAfter: 1100 })
    recordGrowthOutcome(db, { collaborationId: 'c4', creatorId: 'a', metric: 'views', valueBefore: 50000, valueAfter: 65000 })

    const summary = growthSummaryForCreator(db, 'a')
    expect(summary.metrics).toHaveLength(2)
    const followers = summary.metrics.find((m) => m.metric === 'followers')
    expect(followers?.delta).toBe(100)
    expect(followers?.percentChange).toBeCloseTo(10)
    expect(summary.totalDelta).toBe(15100)
    db.close()
  })
})

describe('due follow-ups queue', () => {
  it('returns only pending follow-ups whose due date has passed', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'a', displayName: 'Alice' })
    createCreatorProfile(db, { creatorId: 'b', displayName: 'Bob' })
    createCollaboration(db, { id: 'c5', initiatorId: 'a', targetId: 'b', proposal: 'X' })

    const now = new Date('2026-09-01T12:00:00Z')
    createFollowUp(db, { id: 'fu_past', collaborationId: 'c5', dueAt: '2026-08-30T00:00:00Z' })
    createFollowUp(db, { id: 'fu_future', collaborationId: 'c5', dueAt: '2026-09-05T00:00:00Z' })

    const due = listDueFollowUps(db, now)
    expect(due.map((f) => f.id)).toEqual(['fu_past'])

    // Completing removes it from the queue.
    updateFollowUpStatus(db, 'fu_past', 'completed')
    expect(listDueFollowUps(db, now)).toEqual([])
    expect(getFollowUp(db, 'fu_future')?.status).toBe('pending')
    db.close()
  })
})
