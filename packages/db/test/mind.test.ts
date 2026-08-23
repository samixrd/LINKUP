import { describe, expect, it } from 'vitest'
import {
  addCreatorMemory,
  buildMindContext,
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  createFollowUp,
  migrate,
  recordCollaborationOutcome,
  updateCollaborationStatus,
  updateFollowUpStatus,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  createCreatorProfile(db, { creatorId: 'mind_a', displayName: 'Mind Ada', bio: 'Loves pottery' })
  createCreatorProfile(db, { creatorId: 'mind_b', displayName: 'Mind Grace', bio: 'Pottery enthusiast' })
  createCreatorProfile(db, { creatorId: 'mind_c', displayName: 'Mind Alan', bio: 'Electronic music producer' })
  return db
}

describe('mind context', () => {
  it('builds context with all sections for a creator', () => {
    const db = testDb()
    addCreatorMemory(db, { id: 'mem_1', creatorId: 'mind_a', category: 'preference', content: 'Prefers async' })
    const collab = createCollaboration(db, {
      id: 'collab_mind',
      initiatorId: 'mind_a',
      targetId: 'mind_b',
      proposal: 'Electronic music festival',
    })
    createFollowUp(db, { id: 'follow_mind', collaborationId: collab.id, dueAt: '2026-08-26T10:00:00.000Z' })
    updateCollaborationStatus(db, collab.id, 'accepted')
    recordCollaborationOutcome(db, collab.id)

    const ctx = buildMindContext(db, 'mind_a')

    expect(ctx.creator.creatorId).toBe('mind_a')
    expect(ctx.creator.displayName).toBe('Mind Ada')
    expect(ctx.memories.some((m) => m.id === 'mem_1')).toBe(true)
    expect(ctx.memories.some((m) => m.category === 'collaboration_outcome')).toBe(true)
    expect(ctx.outcomes.length).toBeGreaterThan(0)
    expect(ctx.outcomes.every((m) => m.category === 'collaboration_outcome')).toBe(true)
    expect(ctx.collaborations.collaborations.some((c) => c.id === collab.id)).toBe(true)
    expect(ctx.followUps.some((f) => f.id === 'follow_mind')).toBe(true)
    expect(ctx.matches).toBeDefined()
    expect(typeof ctx.matches.total).toBe('number')
    db.close()
  })

  it('includes matching information', () => {
    const db = testDb()
    // mind_a loves pottery, mind_b also, mind_c electronic
    // Without extra, mind_a should match mind_b
    let ctx = buildMindContext(db, 'mind_a')
    expect(ctx.matches.matches.some((m) => m.creator.creatorId === 'mind_b')).toBe(true)

    // Create outcome that adds electronic terms to mind_a via collaboration
    const collab = createCollaboration(db, {
      id: 'collab_match',
      initiatorId: 'mind_a',
      targetId: 'mind_b',
      proposal: 'Electronic music festival',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    recordCollaborationOutcome(db, collab.id)

    ctx = buildMindContext(db, 'mind_a')
    // Now mind_a should also match mind_c via electronic
    expect(ctx.matches.matches.some((m) => m.creator.creatorId === 'mind_c')).toBe(true)
    const cMatch = ctx.matches.matches.find((m) => m.creator.creatorId === 'mind_c')
    expect(cMatch?.sharedTerms).toEqual(expect.arrayContaining(['electronic']))
    db.close()
  })

  it('includes collaboration and follow-up information', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_follow',
      initiatorId: 'mind_a',
      targetId: 'mind_b',
      proposal: 'Follow-up test',
    })
    createFollowUp(db, { id: 'follow_1', collaborationId: collab.id, dueAt: '2026-08-26T10:00:00.000Z' })
    createFollowUp(db, { id: 'follow_2', collaborationId: collab.id, dueAt: '2026-08-27T10:00:00.000Z' })
    let ctx = buildMindContext(db, 'mind_a')
    expect(ctx.followUps.map((f) => f.id).sort()).toEqual(['follow_1', 'follow_2'].sort())

    // After completing one, followUps should only contain pending
    updateFollowUpStatus(db, 'follow_1', 'completed')
    ctx = buildMindContext(db, 'mind_a')
    expect(ctx.followUps.map((f) => f.id)).toEqual(['follow_2'])
    db.close()
  })

  it('includes outcome information only for that creator', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_outcome_iso',
      initiatorId: 'mind_a',
      targetId: 'mind_b',
      proposal: 'Isolated outcome',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    recordCollaborationOutcome(db, collab.id)

    const ctxA = buildMindContext(db, 'mind_a')
    const ctxB = buildMindContext(db, 'mind_b')
    const ctxC = buildMindContext(db, 'mind_c')

    expect(ctxA.outcomes.some((m) => m.content.includes(collab.id))).toBe(true)
    expect(ctxB.outcomes.some((m) => m.content.includes(collab.id))).toBe(true)
    expect(ctxC.outcomes.some((m) => m.content.includes(collab.id))).toBe(false)
    expect(ctxC.outcomes).toEqual([])
    db.close()
  })

  it('handles empty sections correctly', () => {
    const db = testDb()
    // mind_c has no collaborations, no follow-ups, no outcomes (only bio), but has profile
    const ctx = buildMindContext(db, 'mind_c')
    expect(ctx.creator.creatorId).toBe('mind_c')
    expect(ctx.memories).toEqual([])
    expect(ctx.collaborations.collaborations).toEqual([])
    expect(ctx.collaborations.total).toBe(0)
    expect(ctx.followUps).toEqual([])
    expect(ctx.outcomes).toEqual([])
    // matches may be empty or contain pottery lovers? mind_c electronic, others pottery, so no matches
    expect(ctx.matches.matches).toEqual([])
    expect(ctx.matches.total).toBe(0)
    db.close()
  })

  it('throws for missing creator', () => {
    const db = testDb()
    expect(() => buildMindContext(db, 'ghost')).toThrow('creator profile not found: ghost')
    expect(() => buildMindContext(db, '')).toThrow('creatorId is required')
    db.close()
  })

  it('is deterministic', () => {
    const db = testDb()
    const collab = createCollaboration(db, {
      id: 'collab_det',
      initiatorId: 'mind_a',
      targetId: 'mind_b',
      proposal: 'Deterministic',
    })
    createFollowUp(db, { id: 'follow_det', collaborationId: collab.id, dueAt: '2026-08-26T10:00:00.000Z' })

    const ctx1 = buildMindContext(db, 'mind_a')
    const ctx2 = buildMindContext(db, 'mind_a')
    expect(ctx1).toEqual(ctx2)
    db.close()
  })

  it('creator isolation - does not leak other creator data', () => {
    const db = testDb()
    addCreatorMemory(db, { id: 'secret', creatorId: 'mind_b', category: 'preference', content: 'Secret preference' })
    const collab = createCollaboration(db, {
      id: 'collab_secret',
      initiatorId: 'mind_b',
      targetId: 'mind_c',
      proposal: 'Secret collab',
    })
    createFollowUp(db, { id: 'secret_follow', collaborationId: collab.id, dueAt: '2026-08-26T10:00:00.000Z' })

    const ctxA = buildMindContext(db, 'mind_a')
    // Should not contain B's secret memory or follow-up
    expect(ctxA.memories.some((m) => m.id === 'secret')).toBe(false)
    expect(ctxA.followUps.some((f) => f.id === 'secret_follow')).toBe(false)
    expect(ctxA.collaborations.collaborations.some((c) => c.id === 'collab_secret')).toBe(false)
    expect(ctxA.outcomes.some((m) => m.content.includes('collab_secret'))).toBe(false)
    db.close()
  })

  it('includes memory search results only when opted in', () => {
    const db = testDb()
    addCreatorMemory(db, {
      id: 'mem_search_high',
      creatorId: 'mind_a',
      category: 'preference',
      content: 'Loves electronic music production.',
    })
    addCreatorMemory(db, {
      id: 'mem_search_mid',
      creatorId: 'mind_a',
      category: 'goal',
      content: 'Enjoys electronic music.',
    })
    addCreatorMemory(db, {
      id: 'mem_search_none',
      creatorId: 'mind_a',
      category: 'constraint',
      content: 'Prefers quiet studio sessions.',
    })
    // Another creator's matching memory must not leak into the search
    addCreatorMemory(db, {
      id: 'mem_search_other',
      creatorId: 'mind_b',
      category: 'preference',
      content: 'Loves electronic music production.',
    })

    // Absent or blank option → no memorySearch field
    expect(buildMindContext(db, 'mind_a').memorySearch).toBeUndefined()
    expect(buildMindContext(db, 'mind_a', {}).memorySearch).toBeUndefined()
    expect(buildMindContext(db, 'mind_a', { memorySearch: '   ' }).memorySearch).toBeUndefined()

    const ctx = buildMindContext(db, 'mind_a', { memorySearch: 'electronic music production' })
    expect(ctx.memorySearch).toBeDefined()
    expect(ctx.memorySearch?.query).toBe('electronic music production')
    expect(ctx.memorySearch?.total).toBe(2)
    // Ranked by distinct query terms: high scores 3, mid scores 2
    expect(ctx.memorySearch?.memories.map((m) => m.id)).toEqual(['mem_search_high', 'mem_search_mid'])
    // Only mind_a's own memories appear
    expect(ctx.memorySearch?.memories.some((m) => m.id === 'mem_search_other')).toBe(false)
    db.close()
  })
})
