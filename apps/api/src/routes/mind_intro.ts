import { Router } from 'express'
import type Database from 'better-sqlite3'
import { createMindInteraction, listMindInteractions } from '@linkup/db'

/**
 * POST /api/creators/:creatorId/mind/intro
 *
 * Generates the Mind's first message to its creator right after onboarding,
 * derived deterministically from the seeded onboarding memories (no provider
 * call needed — the intro is a structured greeting, and it demonstrates
 * persistence: the Mind "already knows" the creator at first contact).
 * Idempotent: only writes when the creator has no mind interactions yet.
 */
export function registerMindIntroRoute(router: Router, db: Database.Database): void {
  router.post('/:creatorId/mind/intro', (req, res) => {
    const creatorId = req.params.creatorId
    if (typeof creatorId !== 'string' || creatorId.trim() === '') {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    const profile = db
      .prepare('SELECT creator_id, display_name, bio FROM creator_profiles WHERE creator_id = ?')
      .get(creatorId) as { creator_id: string; display_name: string; bio: string } | undefined
    if (profile === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }

    // Idempotency: an intro already exists -> return it unchanged.
    const existing = listMindInteractions(db, creatorId, { limit: 50 })
    const priorIntro = existing.interactions.find(
      (i) => i.role === 'mind' && i.content.startsWith('[intro]'),
    )
    if (priorIntro !== undefined) {
      res.json({ interaction: priorIntro, created: false })
      return
    }

    const memories = db
      .prepare('SELECT category, content FROM creator_memories WHERE creator_id = ? ORDER BY created_at, id')
      .all(creatorId) as Array<{ category: string; content: string }>

    const goals = memories.filter((m) => m.category === 'goal').map((m) => m.content)
    const prefs = memories.filter((m) => m.category === 'preference').map((m) => m.content)

    const parts: string[] = []
    parts.push(`Hey ${profile.display_name} — I'm your Mind. I already know a few things about you:`)
    if (profile.bio) parts.push(`• ${profile.bio}`)
    for (const g of goals) parts.push(`• Your goal: ${g}`)
    for (const p of prefs) parts.push(`• ${p}`)
    if (goals.length + prefs.length === 0 && !profile.bio) {
      parts.push('• …actually, nothing yet! Tell me about yourself and I will remember it.')
    }
    parts.push(
      'I will remember everything you tell me, find creators who match your goals, negotiate collaborations for you, and follow up on my own. Ask me anything.',
    )
    const content = `[intro] ${parts.join('\n')}`

    const interaction = createMindInteraction(db, {
      id: `intro_${creatorId}_${Date.now()}`,
      creatorId,
      role: 'mind',
      content,
    })
    res.status(201).json({ interaction, created: true })
  })
}
