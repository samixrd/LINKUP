import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type Database from 'better-sqlite3'
import {
  COLLABORATION_STATUSES,
  FOLLOW_UP_STATUSES,
  createFollowUp,
  getCollaboration,
  getFollowUp,
  listFollowUpsForCollaboration,
  recordCollaborationOutcome,
  submitCounterProposal,
  updateCollaborationProposal,
  updateCollaborationStatus,
  updateFollowUpStatus,
} from '@linkup/db'
import type { CollaborationStatus, FollowUpStatus } from '@linkup/db'

/**
 * HTTP layer for collaborations accessed by global id. Mirrors the
 * creator-scoped collaboration endpoints but without ownership checks;
 * ownership is enforced on the creator-scoped routes. Both routers share
 * the same underlying DB functions.
 */
export function createCollaborationsRouter(db: Database.Database): Router {
  const router = Router()

  router.get('/:collaborationId', (req, res) => {
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'collaborationId must be a non-empty string' })
      return
    }
    const collaboration = getCollaboration(db, collaborationId)
    if (collaboration === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    res.json(collaboration)
  })

  router.patch('/:collaborationId', (req, res) => {
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'collaborationId must be a non-empty string' })
      return
    }
    const existing = getCollaboration(db, collaborationId)
    if (existing === undefined) {
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
        updated = updateCollaborationStatus(db, collaborationId, status as CollaborationStatus)
        // Learning loop: deterministically record outcome when collaboration becomes terminal
        if (updated.status === 'accepted' || updated.status === 'rejected' || updated.status === 'cancelled') {
          try {
            recordCollaborationOutcome(db, collaborationId)
          } catch {
            // outcome recording is idempotent; ignore if already exists or not terminal yet
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

  router.post('/:collaborationId/counter', (req, res) => {
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'collaborationId must be a non-empty string' })
      return
    }
    const existing = getCollaboration(db, collaborationId)
    if (existing === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { counterProposal, proposal, proposedBy } = body as {
      counterProposal?: unknown
      proposal?: unknown
      proposedBy?: unknown
    }
    const rawCounter = counterProposal ?? proposal
    if (!isNonEmptyString(rawCounter)) {
      res.status(400).json({ error: 'counterProposal must be a non-empty string' })
      return
    }
    if (!isNonEmptyString(proposedBy)) {
      res.status(400).json({ error: 'proposedBy must be a non-empty string' })
      return
    }
    try {
      const updated = submitCounterProposal(db, collaborationId, rawCounter, proposedBy)
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

  router.post('/:collaborationId/outcome', (req, res) => {
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'collaborationId must be a non-empty string' })
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
      if (message.includes('must be a non-empty string')) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.post('/:collaborationId/follow-ups', (req, res) => {
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'collaborationId must be a non-empty string' })
      return
    }
    if (getCollaboration(db, collaborationId) === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { dueAt, id, status, attempts } = body as {
      dueAt?: unknown
      id?: unknown
      status?: unknown
      attempts?: unknown
    }
    if (!isNonEmptyString(dueAt)) {
      res.status(400).json({ error: 'dueAt must be a non-empty string' })
      return
    }
    if (Number.isNaN(Date.parse(dueAt))) {
      res.status(400).json({ error: 'dueAt must be a valid ISO 8601 date string' })
      return
    }
    if (id !== undefined && !isNonEmptyString(id)) {
      res.status(400).json({ error: 'id must be a non-empty string' })
      return
    }
    if (status !== undefined && !isFollowUpStatus(status)) {
      res.status(400).json({ error: `status must be one of: ${FOLLOW_UP_STATUSES.join(', ')}` })
      return
    }
    if (status !== undefined && status !== 'pending') {
      res.status(400).json({ error: 'follow-up must be created in pending status' })
      return
    }
    if (attempts !== undefined) {
      res.status(400).json({ error: 'attempts must not be provided on create' })
      return
    }

    const followUpId = id ?? randomUUID()
    try {
      const followUp = createFollowUp(db, {
        id: followUpId,
        collaborationId,
        dueAt,
        ...(status !== undefined ? { status: status as FollowUpStatus } : {}),
      })
      res.status(201).json(followUp)
    } catch (err) {
      if (isSqliteConstraintError(err)) {
        res.status(409).json({ error: `follow-up already exists: ${followUpId}` })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('collaboration not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (
        message.includes('dueAt must be') ||
        message.includes('must be a non-empty string') ||
        message.includes('must be created in pending') ||
        message.includes('status must be one of')
      ) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.get('/:collaborationId/follow-ups', (req, res) => {
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'collaborationId must be a non-empty string' })
      return
    }
    if (getCollaboration(db, collaborationId) === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }

    const rawStatus = req.query.status
    if (rawStatus !== undefined) {
      if (typeof rawStatus !== 'string' || !isFollowUpStatus(rawStatus)) {
        res.status(400).json({ error: `status must be one of: ${FOLLOW_UP_STATUSES.join(', ')}` })
        return
      }
    }
    const status = rawStatus as FollowUpStatus | undefined

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
      res.json(listFollowUpsForCollaboration(db, collaborationId, { status, limit, offset }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('collaboration not found')) {
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

  router.patch('/:collaborationId/follow-ups/:followUpId', (req, res) => {
    const collaborationId = req.params.collaborationId
    const followUpId = req.params.followUpId
    if (!isNonEmptyString(collaborationId) || !isNonEmptyString(followUpId)) {
      res.status(400).json({ error: 'collaborationId and followUpId must be non-empty strings' })
      return
    }
    if (getCollaboration(db, collaborationId) === undefined) {
      res.status(404).json({ error: `collaboration not found: ${collaborationId}` })
      return
    }
    const existing = getFollowUp(db, followUpId)
    if (existing === undefined || existing.collaborationId !== collaborationId) {
      res.status(404).json({ error: `follow-up not found: ${followUpId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { status } = body as { status?: unknown }
    if (status === undefined) {
      res.status(400).json({ error: 'update must contain at least one field' })
      return
    }
    if (!isFollowUpStatus(status)) {
      res.status(400).json({ error: `status must be one of: ${FOLLOW_UP_STATUSES.join(', ')}` })
      return
    }

    try {
      const updated = updateFollowUpStatus(db, followUpId, status as FollowUpStatus)
      res.json(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('follow-up not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (
        message.includes('invalid status transition') ||
        message.includes('status must be one of')
      ) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  return router
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isCollaborationStatus(value: unknown): value is CollaborationStatus {
  return isNonEmptyString(value) && COLLABORATION_STATUSES.includes(value as CollaborationStatus)
}

function isFollowUpStatus(value: unknown): value is FollowUpStatus {
  return isNonEmptyString(value) && FOLLOW_UP_STATUSES.includes(value as FollowUpStatus)
}

function isIntegerString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value)
}

function isSqliteConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as Error & { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')
}
