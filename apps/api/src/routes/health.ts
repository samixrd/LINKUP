import { Router } from 'express'
import type Database from 'better-sqlite3'
import { ping } from '@linkup/db'

const SERVICE_VERSION = '0.1.0'

export function createHealthRouter(db: Database.Database): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const database = ping(db)
    const healthy = database.ok
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'linkup-api',
      version: SERVICE_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database,
    })
  })

  return router
}
