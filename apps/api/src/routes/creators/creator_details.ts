import type { Router as ExpressRouter } from 'express'
import type Database from 'better-sqlite3'
import {
  getProfileDetails,
  getCreatorProfile,
  profileDetailsCompleteness,
  setProfileDetails,
  totalDetailFields,
  type ProfileDetailsUpdates,
} from '@linkup/db'
import {
  INTERVIEW_QUESTIONS,
  BRAND_INTERVIEW_QUESTIONS,
  applyInterviewAnswer,
} from '../../services/mind_interview.js'
import { isNonEmptyString } from './shared.js'

/**
 * HTTP routes for structured profile details (stored in profile_details side
 * table) and the Mind's guided interview (one question at a time, saved as
 * memories + details). Registered as a separate module to keep the Mind
 * router from growing unbounded.
 */
export function registerCreatorDetailsRoutes(
  router: ExpressRouter,
  db: Database.Database,
): void {
  // --- GET /profile-details -------------------------------------------------
  router.get('/:creatorId/profile-details', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const details = getProfileDetails(db, creatorId) ?? null
    const completeness = profileDetailsCompleteness(db, creatorId)
    const total = totalDetailFields()
    res.json({ details, completeness, total })
  })

  // --- PUT /profile-details -------------------------------------------------
  router.put('/:creatorId/profile-details', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }

    const updates: ProfileDetailsUpdates = {}
    const allowedFields = [
      'niches', 'platforms', 'audienceSize', 'collabTypes', 'availability',
      'location', 'goals', 'dealbreakers', 'portfolioUrl',
      'partnerMinAudience', 'partnerMaxAudience', 'partnerNiches',
      'minAvgViews', 'languages', 'preferredPlatforms', 'compensation',
      'minBudget', 'openToSmall', 'avgViews', 'contentFormat',
      'postingFrequency', 'editingSkills', 'equipment', 'audienceAge',
      'audienceRegions', 'collabExperience', 'growthStage', 'timezone',
    ] as const
    for (const key of allowedFields) {
      if (key in body) {
        ;(updates as Record<string, unknown>)[key] = (body as Record<string, unknown>)[key]
      }
    }

    try {
      setProfileDetails(db, creatorId, updates)
      const details = getProfileDetails(db, creatorId)
      const completeness = profileDetailsCompleteness(db, creatorId)
      res.json({ details, completeness })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(400).json({ error: message })
    }
  })

  // --- GET /mind/interview/questions ---------------------------------------
  router.get('/:creatorId/mind/interview/questions', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const isBrand = creatorId.startsWith('brand_')
    const questionBank = isBrand ? BRAND_INTERVIEW_QUESTIONS : INTERVIEW_QUESTIONS
    const completeness = profileDetailsCompleteness(db, creatorId)
    // Find the first unanswered question
    const firstUnanswered = questionBank.find((q) => {
      const details = getProfileDetails(db, creatorId)
      if (details === undefined) return true
      const val = (details as unknown as Record<string, unknown>)[q.field]
      if (val === null || val === undefined) return true
      if (Array.isArray(val)) return val.length === 0
      if (typeof val === 'string') return val.trim() === ''
      return false
    })
    res.json({
      questions: questionBank.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options ?? null,
      })),
      firstUnanswered: firstUnanswered?.id ?? null,
      completeness,
      total: questionBank.length,
    })
  })

  // --- POST /mind/interview/answer -----------------------------------------
  router.post('/:creatorId/mind/interview/answer', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { questionId, answer } = body as { questionId?: unknown; answer?: unknown }
    if (!isNonEmptyString(questionId)) {
      res.status(400).json({ error: 'questionId must be a non-empty string' })
      return
    }

    try {
      const result = applyInterviewAnswer(db, creatorId, {
        questionId: questionId as string,
        answer: answer as string | string[],
      })
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (
        message.includes('unknown interview question') ||
        message.includes('answer must be a non-empty') ||
        message.includes('creatorId is required')
      ) {
        res.status(400).json({ error: message })
        return
      }
      if (message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      throw err
    }
  })
}