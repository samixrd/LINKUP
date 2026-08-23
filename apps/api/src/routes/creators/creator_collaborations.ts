import { randomUUID } from 'node:crypto'
import type { Router as ExpressRouter } from 'express'
import type Database from 'better-sqlite3'
import {
  COLLABORATION_STATUSES,
  createCollaboration,
  getCollaboration,
  getCreatorProfile,
  listCollaborationsForCreator,
  listFollowUpsForCollaboration,
  recordCollaborationOutcome,
  scheduleFollowUp,
  submitCounterProposal,
  updateCollaborationProposal,
  updateCollaborationStatus,
} from '@linkup/db'
import type { CollaborationStatus } from '@linkup/db'
import { isCollaborationStatus, isIntegerString, isNonEmptyString, isSqliteConstraintError } from './shared.js'

/**
 * HTTP layer for human-managed collaborations: direct creation, listing,
 * status/proposal updates (with outcome recording on terminal states),
 * counter-proposals, and explicit outcome recording.
 */
export function registerCreatorCollaborationRoutes(router: ExpressRouter, db: Database.Database): void {
  router.post('/:creatorId/collaborations', (req, res) => {
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
    const { targetId, proposal, id } = body as {
      targetId?: unknown
      proposal?: unknown
      id?: unknown
    }
    if (!isNonEmptyString(targetId)) {
      res.status(400).json({ error: 'targetId must be a non-empty string' })
      return
    }
    if (!isNonEmptyString(proposal)) {
      res.status(400).json({ error: 'proposal must be a non-empty string' })
      return
    }
    if (id !== undefined && !isNonEmptyString(id)) {
      res.status(400).json({ error: 'id must be a non-empty string' })
      return
    }
    if (creatorId === targetId) {
      res.status(400).json({ error: 'initiatorId and targetId must be different' })
      return
    }
    if (getCreatorProfile(db, targetId) === undefined) {
      res.status(404).json({ error: `creator not found: ${targetId}` })
      return
    }
    const collaborationId = id ?? randomUUID()
    try {
      const collaboration = createCollaboration(db, {
        id: collaborationId,
        initiatorId: creatorId,
        targetId,
        proposal,
      })
      res.status(201).json(collaboration)
    } catch (err) {
      if (isSqliteConstraintError(err)) {
        res.status(409).json({ error: `collaboration already exists: ${collaborationId}` })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('active collaboration already exists')) {
        res.status(409).json({ error: message })
        return
      }
      if (message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (
        message.includes('must be a non-empty string') ||
        message.includes('must be different') ||
        message.includes('must be created in pending')
      ) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.get('/:creatorId/collaborations', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const rawStatus = req.query.status
    if (rawStatus !== undefined) {
      if (typeof rawStatus !== 'string' || !isCollaborationStatus(rawStatus)) {
        res.status(400).json({ error: `status must be one of: ${COLLABORATION_STATUSES.join(', ')}` })
        return
      }
    }
    const status = rawStatus as CollaborationStatus | undefined

    const rawLimit = req.query.limit
    if (rawLimit !== undefined && !isIntegerString(rawLimit)) {
      res.status(400).json({ error: 'limit must be an integer between 1 and 100' })
      return
    }
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined
    if (limit !== undefined && (limit < 1 || limit > 100)) {
      res.status(400).json({ error: 'limit must be an integer between 1 and 100' })
      return
    }

    const rawOffset = req.query.offset
    if (rawOffset !== undefined && !isIntegerString(rawOffset)) {
      res.status(400).json({ error: 'offset must be a non-negative integer' })
      return
    }
    const offset = rawOffset !== undefined ? Number(rawOffset) : undefined

    try {
      res.json(listCollaborationsForCreator(db, creatorId, { status, limit, offset }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (
        message.includes('limit must be') ||
        message.includes('offset must be') ||
        message.includes('status must be')
      ) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.get('/:creatorId/collaborations/:collaborationId', (req, res) => {
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
    const collaboration = getCollaboration(db, collaborationId)
    if (collaboration === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    if (collaboration.initiatorId !== creatorId && collaboration.targetId !== creatorId) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    res.json(collaboration)
  })

  router.patch('/:creatorId/collaborations/:collaborationId', (req, res) => {
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
    if (existing === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    if (existing.initiatorId !== creatorId && existing.targetId !== creatorId) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { status, proposal } = body as { status?: unknown; proposal?: unknown }
    if (status === undefined && proposal === undefined) {
      res.status(400).json({ error: 'update must contain at least one field' })
      return
    }
    if (status !== undefined && !isCollaborationStatus(status)) {
      res.status(400).json({ error: `status must be one of: ${COLLABORATION_STATUSES.join(', ')}` })
      return
    }
    if (status === 'countered') {
      res.status(400).json({ error: 'use counter endpoint to submit a counter-proposal' })
      return
    }
    if (proposal !== undefined && !isNonEmptyString(proposal)) {
      res.status(400).json({ error: 'proposal must be a non-empty string' })
      return
    }

    try {
      let updated = existing
      if (proposal !== undefined) {
        updated = updateCollaborationProposal(db, collaborationId, proposal)
      }
      if (status !== undefined) {
        // If proposal was just updated, fetch fresh for status transition check
        updated = updateCollaborationStatus(db, collaborationId, status as CollaborationStatus)
        if (
          updated.status === 'accepted' ||
          updated.status === 'rejected' ||
          updated.status === 'cancelled'
        ) {
          try {
            recordCollaborationOutcome(db, collaborationId)
          } catch {
            // idempotent, ignore
          }
        }
        // Autonomous layer: acceptance schedules the Mind's own follow-up
        // (default due in 3 days). Idempotent per collaboration via the
        // deterministic check below.
        if (updated.status === 'accepted' && !hasFollowUp(db, collaborationId)) {
          try {
            scheduleFollowUp(db, collaborationId)
          } catch {
            // scheduling is best-effort; never block the PATCH
          }
        }
      }
      res.json(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('collaboration not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (
        message.includes('invalid status transition') ||
        message.includes('cannot update proposal') ||
        message.includes('status must be one of') ||
        message.includes('proposal is required')
      ) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.post('/:creatorId/collaborations/:collaborationId/counter', (req, res) => {
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
    if (existing === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    if (existing.initiatorId !== creatorId && existing.targetId !== creatorId) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { counterProposal, proposal } = body as { counterProposal?: unknown; proposal?: unknown }
    const rawCounter = counterProposal ?? proposal
    if (!isNonEmptyString(rawCounter)) {
      res.status(400).json({ error: 'counterProposal must be a non-empty string' })
      return
    }
    try {
      const updated = submitCounterProposal(db, collaborationId, rawCounter, creatorId)
      res.json(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('collaboration not found') || message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (
        message.includes('invalid status transition') ||
        message.includes('must be a participant') ||
        message.includes('is required and must be a non-empty string') ||
        message.includes('status must be one of')
      ) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.post('/:creatorId/collaborations/:collaborationId/outcome', (req, res) => {
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
    if (existing === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    if (existing.initiatorId !== creatorId && existing.targetId !== creatorId) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    try {
      const memories = recordCollaborationOutcome(db, collaborationId)
      res.status(200).json({ memories })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('collaboration not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (message.includes('not in a terminal state')) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

}

/** True when the collaboration already has at least one follow-up (any status). */
function hasFollowUp(db: Database.Database, collaborationId: string): boolean {
  return listFollowUpsForCollaboration(db, collaborationId).total > 0
}
