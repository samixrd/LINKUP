import type { Router as ExpressRouter } from 'express'
import type Database from 'better-sqlite3'
import {
  getCollaboration,
  getCreatorProfile,
  listCollaborationProposals,
  listMindInteractions,
  stubMindAdapter,
} from '@linkup/db'
import type { MindAdapter } from '@linkup/db'
import { createMindQueryService, MAX_MEMORY_SEARCH_LENGTH, MAX_QUERY_LENGTH, type MindQueryOptions } from '../../services/mind_query.js'
import {
  createMindCollaborationService,
  type MindCollaborationPreviewOptions,
  type MindCollaborationExecuteOptions,
} from '../../services/mind_collaboration.js'
import { createMindNegotiationService } from '../../services/mind_negotiation.js'
import { createMindDecisionService } from '../../services/mind_decision.js'
import {
  isIntegerString,
  isNonEmptyString,
  respondWithMindCollaborationError,
  respondWithMindDecisionError,
  respondWithMindNegotiationError,
} from './shared.js'

/**
 * HTTP layer for all Mind-powered flows: queries against the injected
 * adapter, interaction history, autonomous collaboration preview/execute,
 * two-sided negotiation (preview/counter/history), and the structured
 * decision layer. All mutations remain human-confirmed.
 */
export function registerCreatorMindRoutes(
  router: ExpressRouter,
  db: Database.Database,
  mindAdapter: MindAdapter = stubMindAdapter,
): void {
  router.post('/:creatorId/mind/query', async (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { query, memorySearch } = body as { query?: unknown; memorySearch?: unknown }
    if (query === undefined) {
      res.status(400).json({ error: 'query is required and must be a non-empty string' })
      return
    }
    if (typeof query !== 'string' || query.trim() === '') {
      res.status(400).json({ error: 'query is required and must be a non-empty string' })
      return
    }
    if (query.length > MAX_QUERY_LENGTH) {
      res.status(400).json({ error: `query must be at most ${MAX_QUERY_LENGTH} characters` })
      return
    }
    if (memorySearch !== undefined && (typeof memorySearch !== 'string' || memorySearch.trim() === '')) {
      res.status(400).json({ error: 'memorySearch must be a non-empty string when provided' })
      return
    }
    if (typeof memorySearch === 'string' && memorySearch.length > MAX_MEMORY_SEARCH_LENGTH) {
      res.status(400).json({ error: `memorySearch must be at most ${MAX_MEMORY_SEARCH_LENGTH} characters` })
      return
    }

    // Use service layer with injected adapter; service validates creator existence via buildMindContext
    const service = createMindQueryService({ db, adapter: mindAdapter })
    try {
      const options: MindQueryOptions = {}
      if (typeof memorySearch === 'string' && memorySearch.trim() !== '') {
        options.memorySearch = memorySearch.trim()
      }
      const answer = await service.queryMind(creatorId, query, options)
      res.json({ answer })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (message.includes('query is required') || message.includes('memorySearch must be') || message.includes('must be at most')) {
        res.status(400).json({ error: message })
        return
      }
      if (message.includes('Minds adapter not configured')) {
        res.status(503).json({ error: message })
        return
      }
      // Unexpected adapter failure — do not leak internals
      res.status(500).json({ error: 'mind query failed' })
    }
  })

  router.post('/:creatorId/mind/collaborations/preview', async (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    // Body is optional: no body drafts for the top-ranked match.
    const body = (req.body ?? {}) as Record<string, unknown>
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { targetId } = body as { targetId?: unknown }
    if (targetId !== undefined && !isNonEmptyString(targetId)) {
      res.status(400).json({ error: 'targetId must be a non-empty string when provided' })
      return
    }
    const options: MindCollaborationPreviewOptions = {}
    if (typeof targetId === 'string' && targetId.trim() !== '') {
      options.targetId = targetId
    }
    const service = createMindCollaborationService({ db, adapter: mindAdapter })
    try {
      const preview = await service.preview(creatorId, options)
      res.json({ preview })
    } catch (err) {
      respondWithMindCollaborationError(res, err, 'collaboration preview failed')
    }
  })

  router.post('/:creatorId/mind/collaborations/execute', async (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { targetId, confirm } = body as { targetId?: unknown; confirm?: unknown }
    if (!isNonEmptyString(targetId)) {
      res.status(400).json({ error: 'targetId must be a non-empty string' })
      return
    }
    if (confirm !== true) {
      res.status(400).json({
        error: 'confirmation is required — set "confirm": true to create the collaboration',
      })
      return
    }
    const options: MindCollaborationExecuteOptions = { targetId, confirm: true }
    const service = createMindCollaborationService({ db, adapter: mindAdapter })
    try {
      const collaboration = await service.execute(creatorId, options)
      res.status(201).json({ collaboration })
    } catch (err) {
      respondWithMindCollaborationError(res, err, 'collaboration execution failed')
    }
  })

  router.post('/:creatorId/mind/collaborations/:collaborationId/negotiate/preview', async (req, res) => {
    const creatorId = req.params.creatorId
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(creatorId) || !isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'creatorId and collaborationId must be non-empty strings' })
      return
    }
    const service = createMindNegotiationService({ db, adapter: mindAdapter })
    try {
      const preview = await service.previewCounter(creatorId, collaborationId)
      res.json({ preview })
    } catch (err) {
      respondWithMindNegotiationError(res, err, 'negotiation preview failed')
    }
  })

  router.post('/:creatorId/mind/collaborations/:collaborationId/negotiate/counter', async (req, res) => {
    const creatorId = req.params.creatorId
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(creatorId) || !isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'creatorId and collaborationId must be non-empty strings' })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { confirm } = body as { confirm?: unknown }
    if (confirm !== true) {
      res.status(400).json({
        error: 'confirmation is required — set "confirm": true to submit the counter-proposal',
      })
      return
    }
    const service = createMindNegotiationService({ db, adapter: mindAdapter })
    try {
      const collaboration = await service.executeCounter(creatorId, collaborationId, { confirm: true })
      res.json({ collaboration })
    } catch (err) {
      respondWithMindNegotiationError(res, err, 'negotiation counter failed')
    }
  })

  router.get('/:creatorId/collaborations/:collaborationId/negotiate/history', (req, res) => {
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
    try {
      const proposals = listCollaborationProposals(db, collaborationId)
      res.json({ proposals, total: proposals.length, history: proposals })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('collaboration not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (message.includes('must be a non-empty string')) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.post('/:creatorId/mind/collaborations/:collaborationId/negotiate/decision', async (req, res) => {
    const creatorId = req.params.creatorId
    const collaborationId = req.params.collaborationId
    if (!isNonEmptyString(creatorId) || !isNonEmptyString(collaborationId)) {
      res.status(400).json({ error: 'creatorId and collaborationId must be non-empty strings' })
      return
    }
    // Body is optional but if provided must be an object (to keep API consistent)
    if (req.body !== undefined && (typeof req.body !== 'object' || req.body === null)) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const service = createMindDecisionService({ db, adapter: mindAdapter })
    try {
      const decision = await service.decide(creatorId, collaborationId)
      res.json({ decision })
    } catch (err) {
      respondWithMindDecisionError(res, err, 'negotiation decision failed')
    }
  })

  router.get('/:creatorId/mind/history', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
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
      const result = listMindInteractions(db, creatorId, { limit, offset })
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('creator profile not found')) {
        res.status(404).json({ error: message })
        return
      }
      if (message.includes('limit must be') || message.includes('offset must be')) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

}
