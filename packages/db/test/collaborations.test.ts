import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COLLABORATION_STATUSES,
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  deleteCreatorProfile,
  getCollaboration,
  isValidCollaborationStatusTransition,
  listCollaborationsForCreator,
  migrate,
  updateCollaborationProposal,
  updateCollaborationStatus,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  createCreatorProfile(db, { creatorId: 'creator_a', displayName: 'Ada Lovelace' })
  createCreatorProfile(db, { creatorId: 'creator_b', displayName: 'Grace Hopper' })
  createCreatorProfile(db, { creatorId: 'creator_c', displayName: 'Alan Turing' })
  return db
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('collaborations', () => {
  it('creates and retrieves a collaboration', () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_01',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Lets co-host a stream.',
    })

    expect(created.id).toBe('collab_01')
    expect(created.initiatorId).toBe('creator_a')
    expect(created.targetId).toBe('creator_b')
    expect(created.status).toBe('pending')
    expect(created.proposal).toBe('Lets co-host a stream.')
    expect(created.createdAt).toBeTruthy()
    expect(created.updatedAt).toBeTruthy()

    const fetched = getCollaboration(db, 'collab_01')
    expect(fetched).toEqual(created)
    db.close()
  })

  it('returns undefined for a non-existent collaboration', () => {
    const db = testDb()
    expect(getCollaboration(db, 'missing')).toBeUndefined()
    db.close()
  })

  it('lists collaborations for initiator and target', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_a_b',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'A to B',
    })
    createCollaboration(db, {
      id: 'collab_b_c',
      initiatorId: 'creator_b',
      targetId: 'creator_c',
      proposal: 'B to C',
    })

    const aList = listCollaborationsForCreator(db, 'creator_a')
    expect(aList.collaborations.map((c) => c.id)).toEqual(['collab_a_b'])
    expect(aList.total).toBe(1)

    const bList = listCollaborationsForCreator(db, 'creator_b')
    const bIds = bList.collaborations.map((c) => c.id).sort()
    expect(bIds).toEqual(['collab_a_b', 'collab_b_c'])
    expect(bList.total).toBe(2)

    const cList = listCollaborationsForCreator(db, 'creator_c')
    expect(cList.collaborations.map((c) => c.id)).toEqual(['collab_b_c'])
    db.close()
  })

  it('isolates collaborations between creators', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_01',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Secret',
    })

    const cList = listCollaborationsForCreator(db, 'creator_c')
    expect(cList.collaborations).toEqual([])
    expect(cList.total).toBe(0)
    db.close()
  })

  it('rejects when creator does not exist', () => {
    const db = testDb()
    expect(() =>
      createCollaboration(db, {
        id: 'collab_x',
        initiatorId: 'missing',
        targetId: 'creator_b',
        proposal: 'Hello',
      }),
    ).toThrow('creator profile not found: missing')
    expect(() =>
      createCollaboration(db, {
        id: 'collab_x',
        initiatorId: 'creator_a',
        targetId: 'missing',
        proposal: 'Hello',
      }),
    ).toThrow('creator profile not found: missing')
    expect(() => listCollaborationsForCreator(db, 'missing')).toThrow(
      'creator profile not found: missing',
    )
    db.close()
  })

  it('rejects self-collaboration', () => {
    const db = testDb()
    expect(() =>
      createCollaboration(db, {
        id: 'collab_self',
        initiatorId: 'creator_a',
        targetId: 'creator_a',
        proposal: 'Self',
      }),
    ).toThrow('initiatorId and targetId must be different')
    db.close()
  })

  it('rejects empty proposal', () => {
    const db = testDb()
    expect(() =>
      createCollaboration(db, {
        id: 'collab_empty',
        initiatorId: 'creator_a',
        targetId: 'creator_b',
        proposal: '   ',
      }),
    ).toThrow('proposal is required and must be a non-empty string')

    const pending = createCollaboration(db, {
      id: 'collab_ok',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Valid',
    })
    expect(() => updateCollaborationProposal(db, pending.id, '   ')).toThrow(
      'proposal is required and must be a non-empty string',
    )
    db.close()
  })

  it('rejects missing collaboration on update', () => {
    const db = testDb()
    expect(() => updateCollaborationStatus(db, 'missing', 'accepted')).toThrow(
      'collaboration not found: missing',
    )
    expect(() => updateCollaborationProposal(db, 'missing', 'New proposal')).toThrow(
      'collaboration not found: missing',
    )
    db.close()
  })

  it('transitions through valid states', () => {
    const db = testDb()
    const pending = createCollaboration(db, {
      id: 'collab_trans',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Propose',
    })
    expect(pending.status).toBe('pending')

    const accepted = updateCollaborationStatus(db, pending.id, 'accepted')
    expect(accepted.status).toBe('accepted')
    expect(accepted.id).toBe(pending.id)

    // Terminal states cannot transition
    expect(() => updateCollaborationStatus(db, pending.id, 'rejected')).toThrow(
      'invalid status transition from accepted to rejected',
    )
    db.close()
  })

  it('rejects invalid status transitions', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_invalid_trans',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Hello',
    })

    // No transition to pending (already pending) is no-op
    expect(updateCollaborationStatus(db, collab.id, 'pending').status).toBe('pending')

    // Valid: pending -> cancelled
    const cancelled = updateCollaborationStatus(db, collab.id, 'cancelled')
    expect(cancelled.status).toBe('cancelled')

    // Terminal cannot go anywhere
    expect(() => updateCollaborationStatus(db, collab.id, 'accepted')).toThrow(
      'invalid status transition from cancelled to accepted',
    )
    expect(() => updateCollaborationStatus(db, collab.id, 'pending')).toThrow(
      'invalid status transition from cancelled to pending',
    )

    // Separate pending -> rejected
    const collab2 = createCollaboration(db, {
      id: 'collab_reject',
      initiatorId: 'creator_a',
      targetId: 'creator_c',
      proposal: 'Another',
    })
    const rejected = updateCollaborationStatus(db, collab2.id, 'rejected')
    expect(rejected.status).toBe('rejected')
    expect(() => updateCollaborationStatus(db, collab2.id, 'accepted')).toThrow(
      'invalid status transition from rejected to accepted',
    )
    db.close()
  })

  it('validates status values', () => {
    const db = testDb()
    expect(() =>
      createCollaboration(db, {
        id: 'collab_bad_status',
        initiatorId: 'creator_a',
        targetId: 'creator_b',
        proposal: 'Hi',
        status: 'bogus' as never,
      }),
    ).toThrow('status must be one of: pending, accepted, rejected, cancelled, countered')

    const collab = createCollaboration(db, {
      id: 'collab_ok2',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Hi',
    })
    expect(() => updateCollaborationStatus(db, collab.id, 'bogus' as never)).toThrow(
      'status must be one of: pending, accepted, rejected, cancelled, countered',
    )
    expect(() => listCollaborationsForCreator(db, 'creator_a', { status: 'bogus' as never })).toThrow(
      'status must be one of: pending, accepted, rejected, cancelled, countered',
    )
    db.close()
  })

  it('rejects non-pending status on create', () => {
    const db = testDb()
    expect(() =>
      createCollaboration(db, {
        id: 'collab_nonpending',
        initiatorId: 'creator_a',
        targetId: 'creator_b',
        proposal: 'Hi',
        status: 'accepted',
      }),
    ).toThrow('collaboration must be created in pending status')
    db.close()
  })

  it('updates proposal while pending and refreshes updatedAt', async () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_proposal',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    await delay(5)
    const updated = updateCollaborationProposal(db, created.id, 'Revised proposal')
    expect(updated.proposal).toBe('Revised proposal')
    expect(updated.status).toBe('pending')
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt > created.updatedAt).toBe(true)
    const fetched = getCollaboration(db, created.id)
    expect(fetched).toEqual(updated)
    db.close()
  })

  it('rejects proposal update when not pending', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_no_proposal',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    expect(() => updateCollaborationProposal(db, collab.id, 'New')).toThrow(
      'cannot update proposal in status accepted',
    )
    const fetched = getCollaboration(db, collab.id)
    expect(fetched?.proposal).toBe('Original')
    db.close()
  })

  it('refreshes updatedAt on status change', async () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_ts',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'TS',
    })
    await delay(5)
    const updated = updateCollaborationStatus(db, created.id, 'cancelled')
    expect(updated.updatedAt > created.updatedAt).toBe(true)
    db.close()
  })

  it('persists across a database close and reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linkup-collab-'))
    try {
      const dbPath = join(dir, 'test.db')
      const first = createDatabase(dbPath)
      migrate(first)
      createCreatorProfile(first, { creatorId: 'creator_p', displayName: 'Persistent' })
      createCreatorProfile(first, { creatorId: 'creator_q', displayName: 'Other' })
      createCollaboration(first, {
        id: 'collab_p',
        initiatorId: 'creator_p',
        targetId: 'creator_q',
        proposal: 'Persist me',
      })
      first.close()

      const second = createDatabase(dbPath)
      migrate(second)
      const fetched = getCollaboration(second, 'collab_p')
      expect(fetched).toMatchObject({
        id: 'collab_p',
        initiatorId: 'creator_p',
        targetId: 'creator_q',
        proposal: 'Persist me',
        status: 'pending',
      })
      expect(fetched?.createdAt).toBeTruthy()
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cascades deletion with its creator', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_cascade',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Cascade',
    })
    expect(deleteCreatorProfile(db, 'creator_a')).toBe(true)
    expect(getCollaboration(db, 'collab_cascade')).toBeUndefined()
    expect(listCollaborationsForCreator(db, 'creator_b')).toEqual({ collaborations: [], total: 0 })
    db.close()
  })

  it('cascades when target is deleted', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_cascade_target',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Cascade target',
    })
    expect(deleteCreatorProfile(db, 'creator_b')).toBe(true)
    expect(getCollaboration(db, 'collab_cascade_target')).toBeUndefined()
    db.close()
  })

  it('allows multiple collaborations between creators', () => {
    const db = testDb()
    const first = createCollaboration(db, {
      id: 'collab_first',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'First',
    })
    const second = createCollaboration(db, {
      id: 'collab_second',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Second',
    })
    const reverse = createCollaboration(db, {
      id: 'collab_reverse',
      initiatorId: 'creator_b',
      targetId: 'creator_a',
      proposal: 'Reverse',
    })
    expect(first.id).toBe('collab_first')
    expect(second.id).toBe('collab_second')
    expect(reverse.id).toBe('collab_reverse')
    db.close()
  })

  it('allows new collaboration after previous is no longer pending', () => {
    const db = testDb()
    const first = createCollaboration(db, {
      id: 'collab_first',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'First',
    })
    updateCollaborationStatus(db, first.id, 'accepted')
    const second = createCollaboration(db, {
      id: 'collab_second',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Second',
    })
    expect(second.id).toBe('collab_second')
    expect(second.status).toBe('pending')
    db.close()
  })

  it('rejects duplicate id', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_dup_id',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'First',
    })
    expect(() =>
      createCollaboration(db, {
        id: 'collab_dup_id',
        initiatorId: 'creator_a',
        targetId: 'creator_c',
        proposal: 'Second',
      }),
    ).toThrow()
    db.close()
  })

  it('lists with deterministic ordering and pagination', async () => {
    const db = testDb()
    // Create three collaborations with slight delay to ensure distinct created_at
    createCollaboration(db, {
      id: 'collab_1',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'One',
    })
    await delay(5)
    createCollaboration(db, {
      id: 'collab_2',
      initiatorId: 'creator_a',
      targetId: 'creator_c',
      proposal: 'Two',
    })
    await delay(5)
    // This will be pending, then rejected to avoid duplicate block for creator_a->creator_b pair
    // Use creator_b as initiator to creator_c for third
    createCollaboration(db, {
      id: 'collab_3',
      initiatorId: 'creator_b',
      targetId: 'creator_c',
      proposal: 'Three',
    })

    // creator_b participates in collab_1 and collab_3
    const all = listCollaborationsForCreator(db, 'creator_b')
    expect(all.total).toBe(2)
    // Ordered by created_at DESC, so most recent first
    expect(all.collaborations[0]?.id).toBe('collab_3')
    expect(all.collaborations[1]?.id).toBe('collab_1')

    const first = listCollaborationsForCreator(db, 'creator_b', { limit: 1 })
    expect(first.collaborations.map((c) => c.id)).toEqual(['collab_3'])
    expect(first.total).toBe(2)

    const second = listCollaborationsForCreator(db, 'creator_b', { limit: 1, offset: 1 })
    expect(second.collaborations.map((c) => c.id)).toEqual(['collab_1'])
    expect(second.total).toBe(2)

    const pastEnd = listCollaborationsForCreator(db, 'creator_b', { limit: 1, offset: 10 })
    expect(pastEnd.collaborations).toEqual([])
    expect(pastEnd.total).toBe(2)
    db.close()
  })

  it('filters by status', () => {
    const db = testDb()
    const c1 = createCollaboration(db, {
      id: 'collab_pending',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Pending',
    })
    const c2 = createCollaboration(db, {
      id: 'collab_to_accept',
      initiatorId: 'creator_a',
      targetId: 'creator_c',
      proposal: 'To accept',
    })
    updateCollaborationStatus(db, c2.id, 'accepted')

    const pending = listCollaborationsForCreator(db, 'creator_a', { status: 'pending' })
    expect(pending.collaborations.map((c) => c.id)).toEqual(['collab_pending'])
    expect(pending.total).toBe(1)

    const accepted = listCollaborationsForCreator(db, 'creator_a', { status: 'accepted' })
    expect(accepted.collaborations.map((c) => c.id)).toEqual(['collab_to_accept'])
    expect(accepted.total).toBe(1)

    const all = listCollaborationsForCreator(db, 'creator_a')
    expect(all.total).toBe(2)
    // Most recent first: collab_to_accept was created second, but status doesn't affect order
    // So order is still by created_at DESC
    void c1
    db.close()
  })

  it('rejects invalid limit and offset', () => {
    const db = testDb()
    expect(() => listCollaborationsForCreator(db, 'creator_a', { limit: 0 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => listCollaborationsForCreator(db, 'creator_a', { limit: 101 })).toThrow(
      'limit must be an integer between 1 and 100',
    )
    expect(() => listCollaborationsForCreator(db, 'creator_a', { limit: 1.5 })).toThrow()
    expect(() => listCollaborationsForCreator(db, 'creator_a', { offset: -1 })).toThrow(
      'offset must be a non-negative integer',
    )
    expect(() => listCollaborationsForCreator(db, 'creator_a', { offset: 0.5 })).toThrow()
    db.close()
  })

  it('validates required fields on create', () => {
    const db = testDb()
    expect(() =>
      createCollaboration(db, { id: '   ', initiatorId: 'creator_a', targetId: 'creator_b', proposal: 'Hi' }),
    ).toThrow('id is required and must be a non-empty string')
    expect(() =>
      createCollaboration(db, { id: 'collab_x', initiatorId: '', targetId: 'creator_b', proposal: 'Hi' }),
    ).toThrow('initiatorId is required and must be a non-empty string')
    expect(() =>
      createCollaboration(db, { id: 'collab_x', initiatorId: 'creator_a', targetId: '', proposal: 'Hi' }),
    ).toThrow('targetId is required and must be a non-empty string')
    expect(() =>
      createCollaboration(db, { id: 'collab_x', initiatorId: 'creator_a', targetId: 'creator_b', proposal: '' }),
    ).toThrow('proposal is required and must be a non-empty string')
    db.close()
  })

  it('enforces foreign keys at the database level', () => {
    const db = testDb()
    expect(() =>
      db
        .prepare(
          `INSERT INTO collaborations (id, initiator_id, target_id, status, proposal)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('collab_fk', 'missing', 'creator_b', 'pending', 'Hello'),
    ).toThrow(/FOREIGN KEY/i)
    db.close()
  })

  it('validates collaboration status helper', () => {
    expect(isValidCollaborationStatusTransition('pending', 'accepted')).toBe(true)
    expect(isValidCollaborationStatusTransition('pending', 'rejected')).toBe(true)
    expect(isValidCollaborationStatusTransition('pending', 'cancelled')).toBe(true)
    expect(isValidCollaborationStatusTransition('pending', 'countered')).toBe(true)
    expect(isValidCollaborationStatusTransition('pending', 'pending')).toBe(false)
    expect(isValidCollaborationStatusTransition('countered', 'accepted')).toBe(true)
    expect(isValidCollaborationStatusTransition('countered', 'rejected')).toBe(true)
    expect(isValidCollaborationStatusTransition('countered', 'cancelled')).toBe(true)
    expect(isValidCollaborationStatusTransition('countered', 'countered')).toBe(true)
    expect(isValidCollaborationStatusTransition('countered', 'pending')).toBe(false)
    expect(isValidCollaborationStatusTransition('accepted', 'pending')).toBe(false)
    expect(isValidCollaborationStatusTransition('accepted', 'cancelled')).toBe(false)
    expect(isValidCollaborationStatusTransition('accepted', 'countered')).toBe(false)
    expect(isValidCollaborationStatusTransition('rejected', 'accepted')).toBe(false)
    expect(isValidCollaborationStatusTransition('cancelled', 'rejected')).toBe(false)
    expect(COLLABORATION_STATUSES).toEqual(['pending', 'accepted', 'rejected', 'cancelled', 'countered'])
  })
})
