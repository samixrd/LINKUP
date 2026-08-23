import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { defaultDatabasePath } from './paths.js'

/**
 * Opens (and if needed creates) the SQLite database. Pass ':memory:' for an
 * ephemeral database, e.g. in tests.
 */
export function createDatabase(path: string = defaultDatabasePath): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  if (path !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }
  return db
}

export interface DatabasePing {
  ok: boolean
  latencyMs: number
  error?: string
}

/**
 * Cheap connectivity probe used by the API health endpoint. Never throws.
 */
export function ping(db: Database.Database): DatabasePing {
  const started = performance.now()
  try {
    db.prepare('SELECT 1 AS ok').get()
    return { ok: true, latencyMs: roundMs(performance.now() - started) }
  } catch (err) {
    return {
      ok: false,
      latencyMs: roundMs(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100
}
