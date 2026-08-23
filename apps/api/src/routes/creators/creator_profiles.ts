import type { Router as ExpressRouter } from 'express'
import type Database from 'better-sqlite3'
import {
  buildMindContext,
  createCreatorProfile,
  findCompatibleCreators,
  getCreatorProfile,
  listCreatorProfiles,
} from '@linkup/db'
import { isIntegerString, isNonEmptyString, isSqliteConstraintError } from './shared.js'

/**
 * HTTP layer for creator profile discovery: listing/searching profiles,
 * creating a profile, fetching one, compatibility matches, and the Mind
 * context view.
 */
export function registerCreatorProfileRoutes(router: ExpressRouter, db: Database.Database): void {
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

}
