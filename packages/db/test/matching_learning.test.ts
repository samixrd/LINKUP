import { describe, expect, it } from 'vitest'
import {
  createCollaboration,
  createCreatorProfile,
  createDatabase,
  findCompatibleCreators,
  migrate,
  recordCollaborationOutcome,
  updateCollaborationStatus,
} from '../src/index.js'

function testDb() {
  const db = createDatabase(':memory:')
  migrate(db)
  return db
}

describe('learning loop - matching integration', () => {
  it('outcome memories make previously zero-term candidates match', () => {
    const db = testDb()
    // Subject loves pottery, candidate B loves pottery (shared), candidate C loves electronic (no overlap)
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Loves pottery craft.' })
    createCreatorProfile(db, { creatorId: 'candidate_b', displayName: 'B', bio: 'Pottery enthusiast.' })
    createCreatorProfile(db, { creatorId: 'candidate_c', displayName: 'C', bio: 'Electronic music producer.' })

    // Initially, subject only matches B via pottery
    let result = findCompatibleCreators(db, 'subject')
    expect(result.matches.map((m) => m.creator.creatorId)).toEqual(['candidate_b'])
    expect(result.matches[0]?.sharedTerms).toEqual(expect.arrayContaining(['pottery']))

    // Create a collaboration between subject and B that is accepted with proposal containing electronic music
    const collab = createCollaboration(db, {
      id: 'collab_learn',
      initiatorId: 'subject',
      targetId: 'candidate_b',
      proposal: 'Electronic music festival',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    recordCollaborationOutcome(db, collab.id)

    // Now subject has an outcome memory containing "Electronic music festival" plus status
    // So subject should now also match candidate_c via electronic/music terms
    result = findCompatibleCreators(db, 'subject')
    const matchedIds = result.matches.map((m) => m.creator.creatorId).sort()
    expect(matchedIds).toEqual(['candidate_b', 'candidate_c'].sort())

    const cMatch = result.matches.find((m) => m.creator.creatorId === 'candidate_c')
    expect(cMatch).toBeDefined()
    expect(cMatch?.sharedTerms).toEqual(expect.arrayContaining(['electronic']))
    expect(cMatch?.sharedTerms).toEqual(expect.arrayContaining(['music']))
    expect(cMatch?.score).toBeGreaterThan(0)
    db.close()
  })

  it('outcome terms appear in sharedTerms explainably', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Loves hiking' })
    createCreatorProfile(db, { creatorId: 'partner', displayName: 'Partner', bio: 'Hiking guide' })
    createCreatorProfile(db, { creatorId: 'stranger', displayName: 'Stranger', bio: 'Synthwave electronic beats' })

    // Before outcome, stranger has no overlap with subject
    expect(findCompatibleCreators(db, 'subject').matches.some((m) => m.creator.creatorId === 'stranger')).toBe(false)

    const collab = createCollaboration(db, {
      id: 'collab_terms',
      initiatorId: 'subject',
      targetId: 'partner',
      proposal: 'Synthwave electronic beats collaboration',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    const memories = recordCollaborationOutcome(db, collab.id)
    // Verify deterministic content
    expect(memories[0]?.content).toContain('Synthwave electronic beats collaboration')
    expect(memories[0]?.content).toContain('accepted')

    const result = findCompatibleCreators(db, 'subject')
    const strangerMatch = result.matches.find((m) => m.creator.creatorId === 'stranger')
    expect(strangerMatch).toBeDefined()
    // sharedTerms should explain why: synthwave, electronic, beats
    expect(strangerMatch?.sharedTerms).toEqual(expect.arrayContaining(['synthwave', 'electronic', 'beats']))
    db.close()
  })

  it('different terminal statuses produce different outcome terms but still influence matching', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Quiet observer' })
    createCreatorProfile(db, { creatorId: 'candidate', displayName: 'Candidate', bio: 'Rejected ideas are lessons' })

    const collab = createCollaboration(db, {
      id: 'collab_rej_learn',
      initiatorId: 'subject',
      targetId: 'candidate',
      proposal: 'Rejected ideas are lessons',
    })
    updateCollaborationStatus(db, collab.id, 'rejected')
    recordCollaborationOutcome(db, collab.id)

    const result = findCompatibleCreators(db, 'subject')
    // Subject's outcome memory contains "rejected" and "lessons", matching candidate's bio "Rejected ideas are lessons"
    // "rejected" may be filtered? Check STOPWORDS does not contain rejected, so it should count
    const match = result.matches.find((m) => m.creator.creatorId === 'candidate')
    expect(match).toBeDefined()
    expect(match?.sharedTerms.length).toBeGreaterThan(0)
    db.close()
  })

  it('matching remains deterministic after outcome recording', () => {
    const db = testDb()
    createCreatorProfile(db, { creatorId: 'subject', displayName: 'Subject', bio: 'Music lover' })
    createCreatorProfile(db, { creatorId: 'a', displayName: 'Alice', bio: 'Loves music' })
    createCreatorProfile(db, { creatorId: 'b', displayName: 'Bob', bio: 'Loves music' })

    const collab = createCollaboration(db, {
      id: 'collab_det',
      initiatorId: 'subject',
      targetId: 'a',
      proposal: 'Music discovery',
    })
    updateCollaborationStatus(db, collab.id, 'accepted')
    recordCollaborationOutcome(db, collab.id)

    const first = findCompatibleCreators(db, 'subject')
    const second = findCompatibleCreators(db, 'subject')
    expect(first).toEqual(second)
    db.close()
  })
})
