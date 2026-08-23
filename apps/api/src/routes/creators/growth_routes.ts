import type { Router as ExpressRouter } from 'express'
import type Database from 'better-sqlite3'
import {
  getCollaboration,
  getCreatorProfile,
  growthSummaryForCreator,
  listGrowthOutcomesForCollaboration,
  recordCollaborationOutcome,
  recordGrowthOutcome,
} from '@linkup/db'
import { isNonEmptyString } from './shared.js'

/** Upper bound on a metric name, in characters. */
const MAX_METRIC_LENGTH = 64

/**
 * HTTP layer for the growth outcome layer (Track 1: audience growth):
 *
 * - POST /:creatorId/collaborations/:id/growth — record before/after
 *   audience metrics for a collaboration. When the collaboration is in a
 *   terminal state this also writes deterministic `growth_outcome`
 *   memories, so the learning loop prefers partners whose collaborations
 *   historically grew audiences.
 * - GET  /:creatorId/collaborations/:id/growth — per-collaboration metrics.
 * - GET  /:creatorId/growth/summary — aggregated per-metric deltas.
 */
export function registerCreatorGrowthRoutes(router: ExpressRouter, db: Database.Database): void {
  router.post('/:creatorId/collaborations/:collaborationId/growth', (req, res) => {
    const creatorId = req.params.creatorId
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(creatorId) || !isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'creatorId and collaborationId must be non-empty strings' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const existing = getCollaboration(db, collaborationId)
    if (existing === undefined || (existing.initiatorId !== creatorId && existing.targetId !== creatorId)) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const rawEntries = Array.isArray((body as { metrics?: unknown }).metrics)
      ? (body as { metrics: unknown[] }).metrics
      : [body]
    try {
      const recorded = rawEntries.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
          throw new Error('each metric must be a JSON object')
        }
        const { metric, valueBefore, valueAfter, before, after } = entry as Record<string, unknown>
        const vBefore = valueBefore ?? before
        const vAfter = valueAfter ?? after
        if (!isNonEmptyString(metric)) {
          throw new Error('metric is required and must be a non-empty string')
        }
        if (metric.length > MAX_METRIC_LENGTH) {
          throw new Error(`metric must be at most ${MAX_METRIC_LENGTH} characters`)
        }
        if (!Number.isInteger(vBefore) || (vBefore as number) < 0) {
          throw new Error('valueBefore must be a non-negative integer')
        }
        if (!Number.isInteger(vAfter) || (vAfter as number) < 0) {
          throw new Error('valueAfter must be a non-negative integer')
        }
        const result = recordGrowthOutcome(db, {
          collaborationId,
          creatorId,
          metric,
          valueBefore: vBefore as number,
          valueAfter: vAfter as number,
        })
        // Ensure the standard outcome memories exist too (idempotent).
        recordCollaborationOutcome(db, collaborationId)
        return result
      })
      res.status(201).json({
        recorded,
        summary: growthSummaryForCreator(db, creatorId),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (
        message.includes('must be') ||
        message.includes('not a participant') ||
        message.includes('is required')
      ) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.get('/:creatorId/collaborations/:collaborationId/growth', (req, res) => {
    const creatorId = req.params.creatorId
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(creatorId) || !isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'creatorId and collaborationId must be non-empty strings' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const existing = getCollaboration(db, collaborationId)
    if (
      existing === undefined ||
      (existing.initiatorId !== creatorId && existing.targetId !== creatorId)
    ) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    res.json({ outcomes: listGrowthOutcomesForCollaboration(db, collaborationId) })
  })

  router.get('/:creatorId/growth/summary', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    try {
      res.json(growthSummaryForCreator(db, creatorId))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      throw err
    }
  })
}
