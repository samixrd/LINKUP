import { Router } from 'express'
import type Database from 'better-sqlite3'
import { stubMindAdapter } from '@linkup/db'
import type { MindAdapter } from '@linkup/db'
import { registerCreatorProfileRoutes } from './creator_profiles.js'
import { registerCreatorMindRoutes } from './creator_mind.js'
import { registerCreatorMemoryRoutes } from './creator_memories.js'
import { registerCreatorCollaborationRoutes } from './creator_collaborations.js'

/**
 * HTTP layer for creator profiles and their memories. Composes the focused
 * route modules (profiles, Mind flows, memories, collaborations); every
 * module registers onto the same shared Express router, so all paths are
 * unchanged from the pre-split single-file router. All data access goes
 * through the @linkup/db repository functions; this layer only validates
 * input, checks existence/ownership, and maps results to HTTP responses.
 */
export function createCreatorsRouter(
  db: Database.Database,
  mindAdapter: MindAdapter = stubMindAdapter,
): Router {
  const router = Router()
  registerCreatorProfileRoutes(router, db)
  registerCreatorMindRoutes(router, db, mindAdapter)
  registerCreatorMemoryRoutes(router, db)
  registerCreatorCollaborationRoutes(router, db)
  return router
}
