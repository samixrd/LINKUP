import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import type Database from 'better-sqlite3'
import { createCollaborationsRouter } from './routes/collaborations.js'
import { createHealthRouter } from './routes/health.js'
import { createCreatorsRouter } from './routes/creators/index.js'
import { createRateLimiter } from './rate_limit.js'
import { createAuthRouter } from './routes/auth.js'
import { registerMindIntroRoute } from './routes/mind_intro.js'
import { createOpenCollabRouter } from './routes/open_collabs.js'
import type { MindAdapter } from '@linkup/db'
import { stubMindAdapter } from '@linkup/db'

/** Built frontend output, served statically in production. */
const webDistDirectory = fileURLToPath(new URL('../../web/dist', import.meta.url))

export interface AppOptions {
  db: Database.Database
  mindAdapter?: MindAdapter
}

export function createApp({ db, mindAdapter = stubMindAdapter }: AppOptions): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '100kb' }))

  app.use('/api/health', createHealthRouter(db))
  app.use('/api/auth', createAuthRouter(db))
  // Mind endpoints hit the external paid Minds provider — rate limit them
  // per creator (30 requests / minute) before they reach any handler.
  const mindRateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 })
  app.use('/api/creators/:creatorId/mind', mindRateLimiter)
  app.use('/api/open-collabs', createOpenCollabRouter(db, mindAdapter))
  const creatorsRouter = createCreatorsRouter(db, mindAdapter)
  registerMindIntroRoute(creatorsRouter, db)
  app.use('/api/creators', creatorsRouter)
  app.use('/api/collaborations', createCollaborationsRouter(db))

  if (existsSync(join(webDistDirectory, 'index.html'))) {
    app.use(express.static(webDistDirectory))
    // SPA fallback: serve the landing page for non-API GETs.
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(join(webDistDirectory, 'index.html'))
        return
      }
      next()
    })
  }

  // Last line of defense: malformed JSON and unexpected errors return clean
  // JSON with no internals, stack traces, or request content.
  app.use(jsonErrorHandler)

  return app
}

/**
 * Terminal error handler: maps body-parser failures to 400/413 and everything
 * else to a generic 500. Never echoes error internals to the client.
 */
export function jsonErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (isJsonParseError(err)) {
    res.status(400).json({ error: 'request body must be valid JSON' })
    return
  }
  if (isPayloadTooLargeError(err)) {
    res.status(413).json({ error: 'request body too large' })
    return
  }
  res.status(500).json({ error: 'internal server error' })
}

function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError && (err as { type?: unknown }).type === 'entity.parse.failed'
}

function isPayloadTooLargeError(err: unknown): boolean {
  return err instanceof Error && (err as { type?: unknown }).type === 'entity.too.large'
}
