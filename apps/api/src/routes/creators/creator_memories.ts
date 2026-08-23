import { randomUUID } from 'node:crypto'
import type { Router as ExpressRouter } from 'express'
import type Database from 'better-sqlite3'
import {
  MEMORY_CATEGORIES,
  addCreatorMemory,
  getCreatorProfile,
  deleteCreatorMemory,
  getCreatorMemory,
  getMindInteraction,
  listCreatorMemories,
  searchCreatorMemories,
  updateCreatorMemory,
} from '@linkup/db'
import type { CreatorMemoryUpdates, MemoryCategory } from '@linkup/db'
import { isIntegerString, isMemoryCategory, isNonEmptyString, isSqliteConstraintError, MAX_MEMORY_CONTENT_LENGTH } from './shared.js'

/**
 * HTTP layer for creator memories: manual add (with optional interaction
 * linkage), listing, semantic-ish search, update, and delete.
 */
export function registerCreatorMemoryRoutes(router: ExpressRouter, db: Database.Database): void {
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

}
