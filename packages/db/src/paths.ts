import { fileURLToPath } from 'node:url'

/**
 * Default location of the SQLite database file, resolved relative to this
 * package so the API can run from any working directory. Overridable via the
 * DATABASE_PATH environment variable.
 */
export const defaultDatabasePath = fileURLToPath(new URL('../data/linkup.db', import.meta.url))
