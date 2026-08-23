import { describe, expect, it } from 'vitest'
import {
  COLLABORATION_STATUSES,
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  getCollaboration,
  isValidCollaborationStatusTransition,
  listCollaborationsForCreator,
  migrate,
  submitCounterProposal,
  updateCollaborationStatus,
  updateCollaborationProposal,
  buildMindContext,
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

describe('collaboration negotiation foundation', () => {
  it('valid counter proposal: pending -> countered, preserves original, updates proposedBy and updatedAt', async () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_counter_valid',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original proposal',
    })
    expect(created.status).toBe('pending')
    expect(created.counterProposal).toBeNull()
    expect(created.proposedBy).toBe('creator_a')
    await delay(5)
    const countered = submitCounterProposal(db, created.id, 'Revised by Grace', 'creator_b')
    expect(countered.status).toBe('countered')
    expect(countered.proposal).toBe('Original proposal')
    expect(countered.counterProposal).toBe('Revised by Grace')
    expect(countered.proposedBy).toBe('creator_b')
    expect(countered.updatedAt > created.updatedAt).toBe(true)
    // original recoverable
    expect(countered.proposal).toBe('Original proposal')
    // latest identifiable
    const latest = countered.counterProposal ?? countered.proposal
    expect(latest).toBe('Revised by Grace')
    db.close()
  })

  it('counter proposal can be chained: countered -> countered overwrites latest but preserves original', async () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_chain',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    const c1 = submitCounterProposal(db, created.id, 'Counter 1 by B', 'creator_b')
    expect(c1.counterProposal).toBe('Counter 1 by B')
    expect(c1.proposedBy).toBe('creator_b')
    await delay(5)
    const c2 = submitCounterProposal(db, created.id, 'Counter 2 by A', 'creator_a')
    expect(c2.counterProposal).toBe('Counter 2 by A')
    expect(c2.proposedBy).toBe('creator_a')
    expect(c2.proposal).toBe('Original')
    expect(c2.status).toBe('countered')
    expect(c2.updatedAt > c1.updatedAt).toBe(true)
    db.close()
  })

  it('invalid transitions: counter from terminal states throws', () => {
    const db = testDb()
    const terminals: Array<'accepted' | 'rejected' | 'cancelled'> = ['accepted', 'rejected', 'cancelled']
    for (const terminal of terminals) {
      const collab = createCollaboration(db, {
        id: `collab_terminal_${terminal}`,
        initiatorId: 'creator_a',
        targetId: 'creator_b',
        proposal: 'Original',
      })
      updateCollaborationStatus(db, collab.id, terminal)
      expect(() => submitCounterProposal(db, collab.id, 'Should fail', 'creator_b')).toThrow(
        `invalid status transition from ${terminal} to countered`,
      )
      expect(() => updateCollaborationStatus(db, collab.id, 'countered')).toThrow(
        `invalid status transition from ${terminal} to countered`,
      )
    }
    db.close()
  })

  it('terminal-state protection: accepted/rejected/cancelled have no outgoing transitions', () => {
    expect(isValidCollaborationStatusTransition('accepted', 'countered')).toBe(false)
    expect(isValidCollaborationStatusTransition('accepted', 'accepted')).toBe(false)
    expect(isValidCollaborationStatusTransition('rejected', 'pending')).toBe(false)
    expect(isValidCollaborationStatusTransition('cancelled', 'countered')).toBe(false)
    expect(isValidCollaborationStatusTransition('pending', 'countered')).toBe(true)
    expect(isValidCollaborationStatusTransition('countered', 'countered')).toBe(true)
    expect(isValidCollaborationStatusTransition('countered', 'accepted')).toBe(true)
    expect(COLLABORATION_STATUSES).toContain('countered')
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_term_protect',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    submitCounterProposal(db, collab.id, 'Counter', 'creator_b')
    const accepted = updateCollaborationStatus(db, collab.id, 'accepted')
    expect(accepted.status).toBe('accepted')
    expect(() => updateCollaborationStatus(db, accepted.id, 'rejected')).toThrow('invalid status transition from accepted to rejected')
    expect(() => submitCounterProposal(db, accepted.id, 'Another', 'creator_b')).toThrow('invalid status transition from accepted to countered')
    db.close()
  })

  it('proposal history preservation: original remains, latest is counterProposal', async () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_history',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original 123',
    })
    const countered = submitCounterProposal(db, created.id, 'Counter 456', 'creator_b')
    expect(countered.proposal).toBe('Original 123')
    expect(countered.counterProposal).toBe('Counter 456')
    // fetch again
    const fetched = getCollaboration(db, created.id)
    expect(fetched?.proposal).toBe('Original 123')
    expect(fetched?.counterProposal).toBe('Counter 456')
    // original not overwritten by proposal update attempt on countered
    expect(() => updateCollaborationProposal(db, created.id, 'Hacked')).toThrow('cannot update proposal in status countered')
    db.close()
  })

  it('creator isolation: only participants can counter', () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_isolation',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Hello',
    })
    expect(() => submitCounterProposal(db, created.id, 'By C', 'creator_c')).toThrow('proposedBy must be a participant')
    expect(() => submitCounterProposal(db, created.id, 'By ghost', 'ghost')).toThrow('creator profile not found: ghost')
    // valid participant succeeds
    const ok = submitCounterProposal(db, created.id, 'By B', 'creator_b')
    expect(ok.proposedBy).toBe('creator_b')
    db.close()
  })

  it('accept counter proposal: countered -> accepted', async () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_accept_counter',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    submitCounterProposal(db, created.id, 'Countered proposal', 'creator_b')
    await delay(5)
    const before = getCollaboration(db, created.id)!
    const accepted = updateCollaborationStatus(db, created.id, 'accepted')
    expect(accepted.status).toBe('accepted')
    expect(accepted.proposal).toBe('Original')
    expect(accepted.counterProposal).toBe('Countered proposal')
    expect(accepted.updatedAt > before.updatedAt).toBe(true)
    // original still recoverable after accept
    expect(accepted.proposal).toBe('Original')
    db.close()
  })

  it('reject counter proposal: countered -> rejected', () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_reject_counter',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    submitCounterProposal(db, created.id, 'Countered proposal', 'creator_b')
    const rejected = updateCollaborationStatus(db, created.id, 'rejected')
    expect(rejected.status).toBe('rejected')
    expect(rejected.counterProposal).toBe('Countered proposal')
    // terminal remains
    expect(() => updateCollaborationStatus(db, rejected.id, 'accepted')).toThrow('invalid status transition from rejected to accepted')
    db.close()
  })

  it('duplicate/invalid requests: empty counter, missing collaboration, duplicate active', () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_invalid',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    expect(() => submitCounterProposal(db, 'missing', 'Counter', 'creator_b')).toThrow('collaboration not found: missing')
    expect(() => submitCounterProposal(db, created.id, '   ', 'creator_b')).toThrow('counterProposal is required and must be a non-empty string')
    expect(() => submitCounterProposal(db, created.id, 'Counter', '   ')).toThrow('proposedBy is required and must be a non-empty string')
    expect(() => submitCounterProposal(db, '   ', 'Counter', 'creator_b')).toThrow('id is required and must be a non-empty string')
    // duplicate active blocks create even when countered
    submitCounterProposal(db, created.id, 'Counter', 'creator_b')
    expect(() =>
      createCollaboration(db, {
        id: 'collab_dup_after_counter',
        initiatorId: 'creator_a',
        targetId: 'creator_b',
        proposal: 'Duplicate',
      }),
    ).toThrow('active collaboration already exists between creator_a and creator_b')
    expect(() =>
      createCollaboration(db, {
        id: 'collab_dup_reverse_counter',
        initiatorId: 'creator_b',
        targetId: 'creator_a',
        proposal: 'Reverse',
      }),
    ).toThrow('active collaboration already exists between creator_b and creator_a')
    // but after terminal, new allowed
    updateCollaborationStatus(db, created.id, 'cancelled')
    const second = createCollaboration(db, {
      id: 'collab_second_after_cancel',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Second',
    })
    expect(second.status).toBe('pending')
    db.close()
  })

  it('MindContext negotiation data: contains collaboration with negotiation fields', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_mind_ctx',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Lets collaborate on music',
    })
    submitCounterProposal(db, 'collab_mind_ctx', 'Lets make it a live set', 'creator_b')
    const ctx = buildMindContext(db, 'creator_a')
    const collab = ctx.collaborations.collaborations.find((c) => c.id === 'collab_mind_ctx')
    expect(collab).toBeDefined()
    expect(collab?.proposal).toBe('Lets collaborate on music')
    expect(collab?.counterProposal).toBe('Lets make it a live set')
    expect(collab?.proposedBy).toBe('creator_b')
    expect(collab?.status).toBe('countered')
    // MindContext isolates per creator — creator_c should not see this
    const ctxC = buildMindContext(db, 'creator_c')
    expect(ctxC.collaborations.collaborations.some((c) => c.id === 'collab_mind_ctx')).toBe(false)
    // pending also visible with null counter
    const ctxB = buildMindContext(db, 'creator_b')
    const collabB = ctxB.collaborations.collaborations.find((c) => c.id === 'collab_mind_ctx')
    expect(collabB?.counterProposal).toBe('Lets make it a live set')
    db.close()
  })

  it('updatedAt changes on counter and accept', async () => {
    const db = testDb()
    const created = createCollaboration(db, {
      id: 'collab_updated_at',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Original',
    })
    await delay(5)
    const countered = submitCounterProposal(db, created.id, 'Counter', 'creator_b')
    expect(countered.updatedAt > created.updatedAt).toBe(true)
    await delay(5)
    const accepted = updateCollaborationStatus(db, countered.id, 'accepted')
    expect(accepted.updatedAt > countered.updatedAt).toBe(true)
    db.close()
  })

  it('list filtering by countered and creator isolation remains enforced', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_pending_a_b',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Pending',
    })
    const c2 = createCollaboration(db, {
      id: 'collab_to_counter',
      initiatorId: 'creator_a',
      targetId: 'creator_c',
      proposal: 'To counter',
    })
    submitCounterProposal(db, c2.id, 'Counter', 'creator_c')
    const pending = listCollaborationsForCreator(db, 'creator_a', { status: 'pending' })
    expect(pending.collaborations.map((c) => c.id)).toEqual(['collab_pending_a_b'])
    const countered = listCollaborationsForCreator(db, 'creator_a', { status: 'countered' })
    expect(countered.collaborations.map((c) => c.id)).toEqual(['collab_to_counter'])
    // isolation: creator_b cannot see a_c collaboration
    const bList = listCollaborationsForCreator(db, 'creator_b')
    expect(bList.collaborations.some((c) => c.id === 'collab_to_counter')).toBe(false)
    db.close()
  })

  it('getCollaboration returns negotiation fields with defaults', () => {
    const db = testDb()
    createCollaboration(db, {
      id: 'collab_get',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Hello',
    })
    const fetched = getCollaboration(db, 'collab_get')!
    expect(fetched.counterProposal).toBeNull()
    expect(fetched.proposedBy).toBe('creator_a')
    expect(fetched.proposal).toBe('Hello')
    db.close()
  })
})
