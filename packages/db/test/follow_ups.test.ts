import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FOLLOW_UP_STATUSES,
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  createFollowUp,
  deleteCreatorProfile,
  getCollaboration,
  getFollowUp,
  incrementFollowUpAttempts,
  isValidFollowUpStatusTransition,
  listFollowUpsForCollaboration,
  migrate,
  updateFollowUpStatus,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  createCreatorProfile(db, { creatorId: 'creator_a', displayName: 'Ada' })
  createCreatorProfile(db, { creatorId: 'creator_b', displayName: 'Grace' })
  createCreatorProfile(db, { creatorId: 'creator_c', displayName: 'Alan' })
  return db
}

function collabIn(db: ReturnType<typeof testDb>, id = 'collab_01') {
  // helper to create a collaboration if not exists
  const existing = getCollaboration(db, id)
  if (existing) return existing
  return createCollaboration(db, {
    id,
    initiatorId: 'creator_a',
    targetId: 'creator_b',
    proposal: 'Test collab',
  })
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('follow-ups', () => {
  it('creates and retrieves a follow-up', () => {
    const db = testDb()
    const collab = collabIn(db)
    const dueAt = '2026-08-25T10:00:00.000Z'
    const created = createFollowUp(db, {
      id: 'follow_01',
      collaborationId: collab.id,
      dueAt,
    })

    expect(created.id).toBe('follow_01')
    expect(created.collaborationId).toBe(collab.id)
    expect(created.dueAt).toBe(dueAt)
    expect(created.status).toBe('pending')
    expect(created.attempts).toBe(0)
    expect(created.createdAt).toBeTruthy()
    expect(created.updatedAt).toBeTruthy()

    const fetched = getFollowUp(db, 'follow_01')
    expect(fetched).toEqual(created)
    db.close()
  })

  it('returns undefined for a non-existent follow-up', () => {
    const db = testDb()
    expect(getFollowUp(db, 'missing')).toBeUndefined()
    db.close()
  })

  it('lists follow-ups for a collaboration ordered by dueAt', async () => {
    const db = testDb()
    const collab = collabIn(db)
    createFollowUp(db, {
      id: 'follow_1',
      collaborationId: collab.id,
      dueAt: '2026-08-26T10:00:00.000Z',
    })
    createFollowUp(db, {
      id: 'follow_2',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    createFollowUp(db, {
      id: 'follow_3',
      collaborationId: collab.id,
      dueAt: '2026-08-27T10:00:00.000Z',
    })

    const list = listFollowUpsForCollaboration(db, collab.id)
    expect(list.total).toBe(3)
    expect(list.followUps.map((f) => f.id)).toEqual(['follow_2', 'follow_1', 'follow_3'])
    db.close()
  })

  it('isolates follow-ups between collaborations', () => {
    const db = testDb()
    const collab1 = collabIn(db, 'collab_1')
    const collab2 = createCollaboration(db, {
      id: 'collab_2',
      initiatorId: 'creator_a',
      targetId: 'creator_c',
      proposal: 'Second',
    })
    createFollowUp(db, {
      id: 'follow_a',
      collaborationId: collab1.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    createFollowUp(db, {
      id: 'follow_b',
      collaborationId: collab2.id,
      dueAt: '2026-08-26T10:00:00.000Z',
    })

    const list1 = listFollowUpsForCollaboration(db, collab1.id)
    expect(list1.followUps.map((f) => f.id)).toEqual(['follow_a'])
    const list2 = listFollowUpsForCollaboration(db, collab2.id)
    expect(list2.followUps.map((f) => f.id)).toEqual(['follow_b'])
    db.close()
  })

  it('rejects when collaboration does not exist', () => {
    const db = testDb()
    expect(() =>
      createFollowUp(db, {
        id: 'follow_x',
        collaborationId: 'missing',
        dueAt: '2026-08-25T10:00:00.000Z',
      }),
    ).toThrow('collaboration not found: missing')
    expect(() => listFollowUpsForCollaboration(db, 'missing')).toThrow(
      'collaboration not found: missing',
    )
    db.close()
  })

  it('validates dueAt', () => {
    const db = testDb()
    const collab = collabIn(db)
    expect(() =>
      createFollowUp(db, { id: 'follow_bad', collaborationId: collab.id, dueAt: '' }),
    ).toThrow('dueAt is required and must be a non-empty string')
    expect(() =>
      createFollowUp(db, { id: 'follow_bad', collaborationId: collab.id, dueAt: '   ' }),
    ).toThrow('dueAt is required and must be a non-empty string')
    expect(() =>
      createFollowUp(db, {
        id: 'follow_bad',
        collaborationId: collab.id,
        dueAt: 'not-a-date',
      }),
    ).toThrow('dueAt must be a valid ISO 8601 date string')
    db.close()
  })

  it('validates status on create and update', () => {
    const db = testDb()
    const collab = collabIn(db)
    expect(() =>
      createFollowUp(db, {
        id: 'follow_bad_status',
        collaborationId: collab.id,
        dueAt: '2026-08-25T10:00:00.000Z',
        status: 'bogus' as never,
      }),
    ).toThrow('status must be one of: pending, completed, cancelled')
    expect(() =>
      createFollowUp(db, {
        id: 'follow_nonpending',
        collaborationId: collab.id,
        dueAt: '2026-08-25T10:00:00.000Z',
        status: 'completed',
      }),
    ).toThrow('follow-up must be created in pending status')

    const follow = createFollowUp(db, {
      id: 'follow_ok',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    expect(() => updateFollowUpStatus(db, follow.id, 'bogus' as never)).toThrow(
      'status must be one of: pending, completed, cancelled',
    )
    expect(() => listFollowUpsForCollaboration(db, collab.id, { status: 'bogus' as never })).toThrow(
      'status must be one of: pending, completed, cancelled',
    )
    db.close()
  })

  it('rejects non-zero attempts on create', () => {
    const db = testDb()
    const collab = collabIn(db)
    expect(() =>
      createFollowUp(db, {
        id: 'follow_attempts',
        collaborationId: collab.id,
        dueAt: '2026-08-25T10:00:00.000Z',
        attempts: 1,
      }),
    ).toThrow('follow-up must be created with 0 attempts')
    db.close()
  })

  it('rejects missing follow-up on update', () => {
    const db = testDb()
    expect(() => updateFollowUpStatus(db, 'missing', 'completed')).toThrow(
      'follow-up not found: missing',
    )
    expect(() => incrementFollowUpAttempts(db, 'missing')).toThrow(
      'follow-up not found: missing',
    )
    db.close()
  })

  it('transitions through valid statuses', () => {
    const db = testDb()
    const collab = collabIn(db)
    const follow = createFollowUp(db, {
      id: 'follow_trans',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    expect(follow.status).toBe('pending')

    const completed = updateFollowUpStatus(db, follow.id, 'completed')
    expect(completed.status).toBe('completed')
    expect(() => updateFollowUpStatus(db, follow.id, 'cancelled')).toThrow(
      'invalid status transition from completed to cancelled',
    )
    db.close()
  })

  it('rejects invalid status transitions and allows idempotent pending', () => {
    const db = testDb()
    const collab = collabIn(db)
    const follow = createFollowUp(db, {
      id: 'follow_invalid',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    expect(updateFollowUpStatus(db, follow.id, 'pending').status).toBe('pending')
    const cancelled = updateFollowUpStatus(db, follow.id, 'cancelled')
    expect(cancelled.status).toBe('cancelled')
    expect(() => updateFollowUpStatus(db, follow.id, 'completed')).toThrow(
      'invalid status transition from cancelled to completed',
    )
    expect(() => updateFollowUpStatus(db, follow.id, 'pending')).toThrow(
      'invalid status transition from cancelled to pending',
    )
    db.close()
  })

  it('increments attempts and refreshes updatedAt', async () => {
    const db = testDb()
    const collab = collabIn(db)
    const created = createFollowUp(db, {
      id: 'follow_attempts_inc',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    expect(created.attempts).toBe(0)
    await delay(5)
    const inc1 = incrementFollowUpAttempts(db, created.id)
    expect(inc1.attempts).toBe(1)
    expect(inc1.updatedAt > created.updatedAt).toBe(true)
    const inc2 = incrementFollowUpAttempts(db, created.id)
    expect(inc2.attempts).toBe(2)
    db.close()
  })

  it('refreshes updatedAt on status change', async () => {
    const db = testDb()
    const collab = collabIn(db)
    const created = createFollowUp(db, {
      id: 'follow_ts',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    await delay(5)
    const updated = updateFollowUpStatus(db, created.id, 'completed')
    expect(updated.updatedAt > created.updatedAt).toBe(true)
    db.close()
  })

  it('persists across a database close and reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linkup-follow-'))
    try {
      const dbPath = join(dir, 'test.db')
      const first = createDatabase(dbPath)
      migrate(first)
      createCreatorProfile(first, { creatorId: 'creator_p', displayName: 'P' })
      createCreatorProfile(first, { creatorId: 'creator_q', displayName: 'Q' })
      const collab = createCollaboration(first, {
        id: 'collab_p',
        initiatorId: 'creator_p',
        targetId: 'creator_q',
        proposal: 'Persist',
      })
      createFollowUp(first, {
        id: 'follow_p',
        collaborationId: collab.id,
        dueAt: '2026-08-25T10:00:00.000Z',
      })
      first.close()

      const second = createDatabase(dbPath)
      migrate(second)
      const fetched = getFollowUp(second, 'follow_p')
      expect(fetched).toMatchObject({
        id: 'follow_p',
        collaborationId: 'collab_p',
        dueAt: '2026-08-25T10:00:00.000Z',
        status: 'pending',
        attempts: 0,
      })
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cascades deletion with its collaboration', () => {
    const db = testDb()
    const collab = collabIn(db, 'collab_cascade')
    createFollowUp(db, {
      id: 'follow_cascade',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    // delete collaboration via deleting creator cascades collab then follow_up
    expect(deleteCreatorProfile(db, 'creator_a')).toBe(true)
    expect(getFollowUp(db, 'follow_cascade')).toBeUndefined()
    db.close()
  })

  it('cascades when collaboration is deleted directly', () => {
    const db = testDb()
    const collab = collabIn(db, 'collab_del')
    createFollowUp(db, {
      id: 'follow_del',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    db.prepare('DELETE FROM collaborations WHERE id = ?').run(collab.id)
    expect(getFollowUp(db, 'follow_del')).toBeUndefined()
    db.close()
  })

  it('rejects duplicate id', () => {
    const db = testDb()
    const collab = collabIn(db)
    createFollowUp(db, {
      id: 'follow_dup',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    expect(() =>
      createFollowUp(db, {
        id: 'follow_dup',
        collaborationId: collab.id,
        dueAt: '2026-08-26T10:00:00.000Z',
      }),
    ).toThrow()
    db.close()
  })

  it('lists with pagination and filters by status', async () => {
    const db = testDb()
    const collab = collabIn(db, 'collab_paginate')
    createFollowUp(db, {
      id: 'follow_1',
      collaborationId: collab.id,
      dueAt: '2026-08-25T10:00:00.000Z',
    })
    createFollowUp(db, {
      id: 'follow_2',
      collaborationId: collab.id,
      dueAt: '2026-08-26T10:00:00.000Z',
    })
    createFollowUp(db, {
      id: 'follow_3',
      collaborationId: collab.id,
      dueAt: '2026-08-27T10:00:00.000Z',
    })
    updateFollowUpStatus(db, 'follow_2', 'completed')

    const pending = listFollowUpsForCollaboration(db, collab.id, { status: 'pending' })
    expect(pending.followUps.map((f) => f.id)).toEqual(['follow_1', 'follow_3'])
    expect(pending.total).toBe(2)

    const completed = listFollowUpsForCollaboration(db, collab.id, { status: 'completed' })
    expect(completed.followUps.map((f) => f.id)).toEqual(['follow_2'])

    const first = listFollowUpsForCollaboration(db, collab.id, { limit: 1 })
    expect(first.followUps.map((f) => f.id)).toEqual(['follow_1'])
    expect(first.total).toBe(3)

    const second = listFollowUpsForCollaboration(db, collab.id, { limit: 1, offset: 1 })
    expect(second.followUps.map((f) => f.id)).toEqual(['follow_2'])

    const pastEnd = listFollowUpsForCollaboration(db, collab.id, { limit: 1, offset: 10 })
    expect(pastEnd.followUps).toEqual([])
    expect(pastEnd.total).toBe(3)
    db.close()
  })

  it('rejects invalid limit and offset', () => {
    const db = testDb()
    const collab = collabIn(db)
    expect(() => listFollowUpsForCollaboration(db, collab.id, { limit: 0 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => listFollowUpsForCollaboration(db, collab.id, { limit: 101 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => listFollowUpsForCollaboration(db, collab.id, { limit: 1.5 })).toThrow()
    expect(() => listFollowUpsForCollaboration(db, collab.id, { offset: -1 })).toThrow(
      'offset must be a non-negative integer',
    )
    expect(() => listFollowUpsForCollaboration(db, collab.id, { offset: 0.5 })).toThrow()
    db.close()
  })

  it('validates required fields on create', () => {
    const db = testDb()
    const collab = collabIn(db)
    expect(() =>
      createFollowUp(db, { id: '   ', collaborationId: collab.id, dueAt: '2026-08-25T10:00:00.000Z' }),
    ).toThrow('id is required and must be a non-empty string')
    expect(() =>
      createFollowUp(db, { id: 'follow_x', collaborationId: '', dueAt: '2026-08-25T10:00:00.000Z' }),
    ).toThrow('collaborationId is required and must be a non-empty string')
    expect(() =>
      createFollowUp(db, { id: 'follow_x', collaborationId: collab.id, dueAt: '' }),
    ).toThrow('dueAt is required and must be a non-empty string')
    db.close()
  })

  it('enforces foreign keys at the database level', () => {
    const db = testDb()
    expect(() =>
      db
        .prepare(
          `INSERT INTO follow_ups (id, collaboration_id, due_at, status, attempts)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('follow_fk', 'missing', '2026-08-25T10:00:00.000Z', 'pending', 0),
    ).toThrow(/FOREIGN KEY/i)
    db.close()
  })

  it('validates follow-up status helper', () => {
    expect(isValidFollowUpStatusTransition('pending', 'completed')).toBe(true)
    expect(isValidFollowUpStatusTransition('pending', 'cancelled')).toBe(true)
    expect(isValidFollowUpStatusTransition('pending', 'pending')).toBe(false)
    expect(isValidFollowUpStatusTransition('completed', 'pending')).toBe(false)
    expect(isValidFollowUpStatusTransition('completed', 'cancelled')).toBe(false)
    expect(isValidFollowUpStatusTransition('cancelled', 'completed')).toBe(false)
    expect(FOLLOW_UP_STATUSES).toEqual(['pending', 'completed', 'cancelled'])
  })
})
