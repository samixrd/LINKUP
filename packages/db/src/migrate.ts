import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'

/**
 * Directory holding ordered SQL migration files (e.g. 0001_baseline.sql).
 * Resolved relative to this package so it works from source and from dist.
 */
export const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url))

/**
 * Applies any not-yet-applied SQL migrations from `dir`, in filename order.
 * Tracks applied versions in the schema_migrations table. Returns the names
 * of the migrations that were applied by this call. Idempotent.
 */
export function migrate(db: Database.Database, dir: string = migrationsDirectory): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (row) => row.version,
    ),
  )

  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  const appliedNow: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file)
    })()
    appliedNow.push(file)
  }
  return appliedNow
}
