import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import type Database from 'better-sqlite3'
import {
  COLLABORATION_STATUSES,
  MEMORY_CATEGORIES,
  addCreatorMemory,
  buildMindContext,
  createCollaboration,
  createCreatorProfile,
  deleteCreatorMemory,
  findCompatibleCreators,
  getCollaboration,
  getCreatorMemory,
  getCreatorProfile,
  getMindInteraction,
  listCollaborationProposals,
  listCollaborationsForCreator,
  listCreatorMemories,
  listCreatorProfiles,
  listMindInteractions,
  recordCollaborationOutcome,
  searchCreatorMemories,
  stubMindAdapter,
  submitCounterProposal,
  updateCollaborationProposal,
  updateCollaborationStatus,
  updateCreatorMemory,
} from '@linkup/db'
import type { CollaborationStatus, CreatorMemoryUpdates, MemoryCategory, MindAdapter } from '@linkup/db'
import { createMindQueryService, MAX_MEMORY_SEARCH_LENGTH, MAX_QUERY_LENGTH, type MindQueryOptions } from '../services/mind_query.js'
import {
  createMindCollaborationService,
  type MindCollaborationPreviewOptions,
  type MindCollaborationExecuteOptions,
} from '../services/mind_collaboration.js'
import { createMindNegotiationService } from '../services/mind_negotiation.js'
import { createMindDecisionService } from '../services/mind_decision.js'

/**
 * HTTP layer for creator profiles and their memories. All data access goes
 * through the @linkup/db repository functions; this router only validates
 * input, checks existence/ownership, and maps results to HTTP responses.
 */
export function createCreatorsRouter(
  db: Database.Database,
  mindAdapter: MindAdapter = stubMindAdapter,
): Router {
  const router = Router()

  router.get('/', (req, res) => {
    const rawQuery = req.query.q
    if (rawQuery !== undefined && typeof rawQuery !== 'string') {
      res.status(400).json({ error: 'q must be a string' })
      return
    }
    const query = rawQuery !== undefined && rawQuery.trim() !== '' ? rawQuery.trim() : undefined

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

    res.json(listCreatorProfiles(db, { query, limit, offset }))
  })

  router.post('/', (req, res) => {
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { creatorId, displayName, bio, avatarUrl } = body as {
      creatorId?: unknown
      displayName?: unknown
      bio?: unknown
      avatarUrl?: unknown
    }
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (!isNonEmptyString(displayName)) {
      res.status(400).json({ error: 'displayName must be a non-empty string' })
      return
    }
    if (bio !== undefined && !isNonEmptyString(bio)) {
      res.status(400).json({ error: 'bio must be a non-empty string' })
      return
    }
    if (avatarUrl !== undefined && !isNonEmptyString(avatarUrl)) {
      res.status(400).json({ error: 'avatarUrl must be a non-empty string' })
      return
    }

    try {
      const profile = createCreatorProfile(db, {
        creatorId,
        displayName,
        ...(bio !== undefined ? { bio } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      })
      res.status(201).json(profile)
    } catch (err) {
      if (isSqliteConstraintError(err)) {
        res.status(409).json({ error: `creator already exists: ${creatorId}` })
        return
      }
      throw err
    }
  })

  router.get('/:creatorId', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    const profile = getCreatorProfile(db, creatorId)
    if (profile === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    res.json(profile)
  })

  router.get('/:creatorId/matches', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
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

    res.json(findCompatibleCreators(db, creatorId, { limit, offset }))
  })

  router.get('/:creatorId/mind', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    try {
      const context = buildMindContext(db, creatorId)
      res.json(context)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('creator profile not found')) {
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

  router.post('/:creatorId/mind/memory', (req, res) => {
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
    const { interactionId, category, content } = body as {
      interactionId?: unknown
      category?: unknown
      content?: unknown
    }
    if (!isNonEmptyString(interactionId)) {
      res.status(400).json({ error: 'interactionId is required and must be a non-empty string' })
      return
    }
    if (!isMemoryCategory(category)) {
      res.status(400).json({ error: `category must be one of: ${MEMORY_CATEGORIES.join(', ')}` })
      return
    }
    if (!isNonEmptyString(content)) {
      res.status(400).json({ error: 'content is required and must be a non-empty string' })
      return
    }
    if (content.length > MAX_MEMORY_CONTENT_LENGTH) {
      res.status(400).json({ error: `content must be at most ${MAX_MEMORY_CONTENT_LENGTH} characters` })
      return
    }
    const interaction = getMindInteraction(db, interactionId)
    if (interaction === undefined || interaction.creatorId !== creatorId) {
      res.status(404).json({ error: `mind interaction not found: ${interactionId}` })
      return
    }
    try {
      const memory = addCreatorMemory(db, {
        id: randomUUID(),
        creatorId,
        category: category as MemoryCategory,
        content: content as string,
      })
      res.status(201).json(memory)
    } catch (err) {
      if (isSqliteConstraintError(err)) {
        res.status(409).json({ error: `memory already exists` })
        return
      }
      throw err
    }
  })

  router.get('/:creatorId/memories', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const category = req.query.category
    if (category !== undefined) {
      if (!isMemoryCategory(category)) {
        res.status(400).json({ error: `category must be one of: ${MEMORY_CATEGORIES.join(', ')}` })
        return
      }
      res.json({ memories: listCreatorMemories(db, { creatorId, category }) })
      return
    }
    res.json({ memories: listCreatorMemories(db, { creatorId }) })
  })

  router.get('/:creatorId/memories/search', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const rawQuery = req.query.q
    if (rawQuery === undefined || typeof rawQuery !== 'string' || rawQuery.trim() === '') {
      res.status(400).json({ error: 'q is required and must be a non-empty string' })
      return
    }
    const query = rawQuery.trim()

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
      res.json(searchCreatorMemories(db, creatorId, query, { limit, offset }))
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

  router.post('/:creatorId/memories', (req, res) => {
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
    const { id, category, content } = body as {
      id?: unknown
      category?: unknown
      content?: unknown
    }
    if (id !== undefined && !isNonEmptyString(id)) {
      res.status(400).json({ error: 'id must be a non-empty string' })
      return
    }
    if (!isMemoryCategory(category)) {
      res.status(400).json({ error: `category must be one of: ${MEMORY_CATEGORIES.join(', ')}` })
      return
    }
    if (!isNonEmptyString(content)) {
      res.status(400).json({ error: 'content must be a non-empty string' })
      return
    }

    const memoryId = id ?? randomUUID()
    try {
      const memory = addCreatorMemory(db, { id: memoryId, creatorId, category, content })
      res.status(201).json(memory)
    } catch (err) {
      if (isSqliteConstraintError(err)) {
        res.status(409).json({ error: `memory already exists: ${memoryId}` })
        return
      }
      throw err
    }
  })

  router.patch('/:creatorId/memories/:memoryId', (req, res) => {
    const creatorId = req.params.creatorId
    const memoryId = req.params.memoryId
    if (!isNonEmptyString(creatorId) || !isNonEmptyString(memoryId)) {
      res.status(400).json({ error: 'creatorId and memoryId must be non-empty strings' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const existing = getCreatorMemory(db, memoryId)
    if (existing === undefined || existing.creatorId !== creatorId) {
      res.status(404).json({ error: `creator memory not found: ${memoryId}` })
      return
    }
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { category, content } = body as { category?: unknown; content?: unknown }
    if (category === undefined && content === undefined) {
      res.status(400).json({ error: 'update must contain at least one field' })
      return
    }
    if (category !== undefined && !isMemoryCategory(category)) {
      res.status(400).json({ error: `category must be one of: ${MEMORY_CATEGORIES.join(', ')}` })
      return
    }
    if (content !== undefined && !isNonEmptyString(content)) {
      res.status(400).json({ error: 'content must be a non-empty string' })
      return
    }

    const updates: CreatorMemoryUpdates = {}
    if (category !== undefined) updates.category = category
    if (content !== undefined) updates.content = content
    res.json(updateCreatorMemory(db, memoryId, updates))
  })

  router.delete('/:creatorId/memories/:memoryId', (req, res) => {
    const creatorId = req.params.creatorId
    const memoryId = req.params.memoryId
    if (!isNonEmptyString(creatorId) || !isNonEmptyString(memoryId)) {
      res.status(400).json({ error: 'creatorId and memoryId must be non-empty strings' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }
    const existing = getCreatorMemory(db, memoryId)
    if (existing === undefined || existing.creatorId !== creatorId) {
      res.status(404).json({ error: `creator memory not found: ${memoryId}` })
      return
    }
    deleteCreatorMemory(db, memoryId)
    res.status(204).end()
  })

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

  return router
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** True for a string of one or more ASCII digits (e.g. "0", "42"). */
function isIntegerString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value)
}

function isMemoryCategory(value: unknown): value is MemoryCategory {
  return isNonEmptyString(value) && MEMORY_CATEGORIES.includes(value as MemoryCategory)
}

function isCollaborationStatus(value: unknown): value is CollaborationStatus {
  return isNonEmptyString(value) && COLLABORATION_STATUSES.includes(value as CollaborationStatus)
}

function isSqliteConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as Error & { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')
}

/** Maps Mind collaboration service errors to appropriate HTTP status codes. */
function respondWithMindCollaborationError(res: Response, err: unknown, fallback: string): void {
  if (isSqliteConstraintError(err)) {
    res.status(409).json({ error: 'collaboration already exists' })
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('creator profile not found') || message.includes('no compatible creators found')) {
    res.status(404).json({ error: message })
    return
  }
  if (
    message.includes('must be a non-empty string') ||
    message.includes('must be different') ||
    message.includes('targetId') ||
    message.includes('is not a compatible match') ||
    message.includes('confirmation is required') ||
    message.includes('adapter returned an empty') ||
    message.includes('adapter returned an over-long')
  ) {
    res.status(400).json({ error: message })
    return
  }
  if (message.includes('active collaboration already exists')) {
    res.status(409).json({ error: message })
    return
  }
  if (message.includes('Minds adapter not configured')) {
    res.status(503).json({ error: message })
    return
  }
  // Unexpected adapter failure — do not leak internals
  res.status(500).json({ error: fallback })
}

function respondWithMindNegotiationError(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('creator profile not found') || message.includes('collaboration not found')) {
    res.status(404).json({ error: message })
    return
  }
  if (
    message.includes('must be a non-empty string') ||
    message.includes('confirmation is required') ||
    message.includes('cannot counter proposal in status') ||
    message.includes('invalid status transition') ||
    message.includes('adapter returned an empty') ||
    message.includes('adapter returned an over-long') ||
    message.includes('must be a participant')
  ) {
    res.status(400).json({ error: message })
    return
  }
  if (message.includes('Minds adapter not configured')) {
    res.status(503).json({ error: message })
    return
  }
  res.status(500).json({ error: fallback })
}

function respondWithMindDecisionError(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('creator profile not found') || message.includes('collaboration not found')) {
    res.status(404).json({ error: message })
    return
  }
  if (
    message.includes('must be a non-empty string') ||
    message.includes('invalid action') ||
    message.includes('invalid decision format') ||
    message.includes('reasoning is required') ||
    message.includes('counterProposal is required') ||
    message.includes('must be at most') ||
    message.includes('must be one of')
  ) {
    res.status(400).json({ error: message })
    return
  }
  if (message.includes('Minds adapter not configured')) {
    res.status(503).json({ error: message })
    return
  }
  res.status(500).json({ error: fallback })
}

/** Upper bound on a memory content payload, in characters (abuse hardening). */
const MAX_MEMORY_CONTENT_LENGTH = 10_000
