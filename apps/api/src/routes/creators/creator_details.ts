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
import { INTERVIEW_QUESTIONS, applyInterviewAnswer } from '../../services/mind_interview.js'
import { isNonEmptyString, isNonEmptyStringArray } from './shared.js'

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
    ] as const
    for (const field of allowedFields) {
      const value = (body as Record<string, unknown>)[field]
      if (value !== undefined) {
        if (Array.isArray(value)) {
          if (!isNonEmptyStringArray(value)) {
            res.status(400).json({ error: `${field} must be a non-empty array of strings` })
            return
          }
          // @ts-expect-error dynamic field write
          updates[field] = value
        } else if (typeof value === 'string') {
          // @ts-expect-error dynamic field write
          updates[field] = value === '' ? null : value
        } else {
          res.status(400).json({ error: `${field} must be a string or string array` })
          return
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'update must contain at least one valid field' })
      return
    }

    try {
      const details = setProfileDetails(db, creatorId, updates)
      const completeness = profileDetailsCompleteness(db, creatorId)
      const total = totalDetailFields()
      res.json({ details, completeness, total })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      throw err
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
    const completeness = profileDetailsCompleteness(db, creatorId)
    // Find the first unanswered question
    const firstUnanswered = INTERVIEW_QUESTIONS.find((q) => {
      const details = getProfileDetails(db, creatorId)
      if (details === undefined) return true
      switch (q.field) {
        case 'niches':
          return details.niches.length === 0
        case 'platforms':
          return details.platforms.length === 0
        case 'audienceSize':
          return details.audienceSize === null
        case 'collabTypes':
          return details.collabTypes.length === 0
        case 'availability':
          return details.availability === null
        case 'location':
          return !details.location
        case 'goals':
          return details.goals.length === 0
        case 'dealbreakers':
          return !details.dealbreakers
        case 'portfolioUrl':
          return !details.portfolioUrl
      }
    })
    res.json({
      questions: INTERVIEW_QUESTIONS.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options ?? null,
      })),
      firstUnanswered: firstUnanswered?.id ?? null,
      completeness,
      total: totalDetailFields(),
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