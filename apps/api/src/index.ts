import { createDatabase, migrate } from '@linkup/db'
import { createApp } from './app.js'
import { loadConfig, loadDotEnv } from './config.js'
import { resolveMindAdapter } from './services/mind_provider.js'
import { assertSupportedNodeVersion } from './runtime.js'

function main(): void {
  assertSupportedNodeVersion()
  loadDotEnv()
  const config = loadConfig()

  const db = createDatabase(config.databasePath)
  const applied = migrate(db)
  if (applied.length > 0) {
    console.log(`[db] applied migrations: ${applied.join(', ')}`)
  }

  // Real Minds provider only when env config is present; stub otherwise.
  const mindAdapter = resolveMindAdapter(config.minds)

  const app = createApp({ db, mindAdapter })
  const server = app.listen(config.port, () => {
    console.log(`[api] LINKUP API listening on http://localhost:${config.port} (${config.nodeEnv})`)
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`[api] received ${signal}, shutting down`)
    server.close(() => {
      db.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main()
