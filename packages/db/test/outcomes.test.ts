import { describe, expect, it } from 'vitest'
import {
  addCreatorMemory,
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  getCreatorMemory,
  listCreatorMemories,
  migrate,
  recordCollaborationOutcome,
  updateCollaborationStatus,
  collaborationOutcomeMemoryId,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  createCreatorProfile(db, { creatorId: 'creator_a', displayName: 'Ada Lovelace' })
  createCreatorProfile(db, { creatorId: 'creator_b', displayName: 'Grace Hopper' })
  createCreatorProfile(db, { creatorId: 'creator_c', displayName: 'Alan Turing' })
  return db
}

describe('learning loop - outcomes', () => {
  it('records collaboration_outcome memories for both participants when accepted', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_outcome',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Electronic music stream',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')

    const memories = recordCollaborationOutcome(db, collab.id)
    expect(memories).toHaveLength(2)
    expect(memories.map((m) => m.creatorId).sort()).toEqual(['creator_a', 'creator_b'])
    for (const m of memories) {
      expect(m.category).toBe('collaboration_outcome')
      expect(m.content).toContain(collab.id)
      expect(m.content).toContain('accepted')
      expect(m.content).toContain('Electronic music stream')
    }

    // Check that memories are retrievable via creator memories
    const aMems = listCreatorMemories(db, { creatorId: 'creator_a', category: 'collaboration_outcome' })
    expect(aMems.map((m) => m.id)).toContain(collaborationOutcomeMemoryId(collab.id, 'creator_a'))
    const bMems = listCreatorMemories(db, { creatorId: 'creator_b', category: 'collaboration_outcome' })
    expect(bMems.map((m) => m.id)).toContain(collaborationOutcomeMemoryId(collab.id, 'creator_b'))

    // Content is deterministic and explainable
    const aMem = getCreatorMemory(db, collaborationOutcomeMemoryId(collab.id, 'creator_a'))
    expect(aMem?.content).toBe(`Collaboration ${collab.id} accepted with Grace Hopper (creator_b): Electronic music stream`)
    const bMem = getCreatorMemory(db, collaborationOutcomeMemoryId(collab.id, 'creator_b'))
    expect(bMem?.content).toBe(`Collaboration ${collab.id} accepted with Ada Lovelace (creator_a): Electronic music stream`)
    db.close()
  })

  it('records outcome for rejected and cancelled', () => {
    const db = testDb()
    const collab1 = createCollaboration(db, {
      id: 'collab_rej',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Rejected idea',
    })
    updateCollaborationStatus(db, collab1.id, 'rejected')
    const rejMems = recordCollaborationOutcome(db, collab1.id)
    expect(rejMems.every((m) => m.content.includes('rejected'))).toBe(true)

    const collab2 = createCollaboration(db, {
      id: 'collab_can',
      initiatorId: 'creator_a',
      targetId: 'creator_c',
      proposal: 'Cancelled idea',
    })
    updateCollaborationStatus(db, collab2.id, 'cancelled')
    const canMems = recordCollaborationOutcome(db, collab2.id)
    expect(canMems.every((m) => m.content.includes('cancelled'))).toBe(true)
    db.close()
  })

  it('avoids duplicate outcome memories on repeated processing', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_dup',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Repeat',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')

    const first = recordCollaborationOutcome(db, collab.id)
    const second = recordCollaborationOutcome(db, collab.id)
    expect(first.map((m) => m.id).sort()).toEqual(second.map((m) => m.id).sort())
    expect(first.map((m) => m.content)).toEqual(second.map((m) => m.content))

    // DB should still have exactly 2 outcome memories for this collab
    const all = listCreatorMemories(db, { category: 'collaboration_outcome' })
    expect(all.filter((m) => m.content.includes(collab.id))).toHaveLength(2)
    db.close()
  })

  it('throws when collaboration is not terminal', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_pending',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Pending',
    })
    expect(() => recordCollaborationOutcome(db, collab.id)).toThrow(
      'collaboration is not in a terminal state: pending',
    )
    expect(listCreatorMemories(db, { category: 'collaboration_outcome' })).toEqual([])
    db.close()
  })

  it('throws when collaboration does not exist', () => {
    const db = testDb()
    expect(() => recordCollaborationOutcome(db, 'ghost')).toThrow('collaboration not found: ghost')
    db.close()
  })

  it('isolates outcome memories per creator', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_iso',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Isolated',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    recordCollaborationOutcome(db, collab.id)

    const aMems = listCreatorMemories(db, { creatorId: 'creator_a' })
    const bMems = listCreatorMemories(db, { creatorId: 'creator_b' })
    const cMems = listCreatorMemories(db, { creatorId: 'creator_c' })

    expect(aMems.some((m) => m.category === 'collaboration_outcome')).toBe(true)
    expect(bMems.some((m) => m.category === 'collaboration_outcome')).toBe(true)
    expect(cMems.some((m) => m.category === 'collaboration_outcome')).toBe(false)
    expect(cMems.filter((m) => m.content.includes(collab.id))).toEqual([])
    db.close()
  })

  it('produces deterministic explainable memories for each terminal', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_det',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Deterministic proposal',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    const mems1 = recordCollaborationOutcome(db, collab.id)
    // Fetch again via get
    const mems2 = listCreatorMemories(db, { category: 'collaboration_outcome' })
    expect(mems1.map((m) => m.content).sort()).toEqual(
      mems2.filter((m) => m.content.includes('collab_det')).map((m) => m.content).sort(),
    )
    // Content includes collaboration id, status, other name, proposal
    for (const m of mems1) {
      expect(m.content).toMatch(/Collaboration collab_det accepted with .* \(creator_.*\): Deterministic proposal/)
    }
    db.close()
  })

  it('does not interfere with existing memories of other categories', () => {
    const db = testDb()
    addCreatorMemory(db, {
      id: 'pref_1',
      creatorId: 'creator_a',
      category: 'preference',
      content: 'Prefers quiet',
    })
    const collab = createCollaboration(db, {
      id: 'collab_other_mem',
      initiatorId: 'creator_a',
      targetId: 'creator_b',
      proposal: 'Test',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    recordCollaborationOutcome(db, collab.id)

    const allA = listCreatorMemories(db, { creatorId: 'creator_a' })
    expect(allA.map((m) => m.category).sort()).toEqual(['collaboration_outcome', 'preference'].sort())
    db.close()
  })
})
