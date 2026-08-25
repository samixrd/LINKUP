/* Reproduces the stale-reply bug: two rapid queries on a fresh alias. */
import { readFileSync } from 'node:fs'
import { createMindsClient } from '@animocabrands/minds-client-lib'
import { createDatabase, migrate, createCreatorProfile, addCreatorMemory, buildMindContext } from '@linkup/db'
import { createMindsProviderAdapter, aliasForCreator } from '../apps/api/src/services/mind_provider.js'

function loadEnv(path) {
  const env = {}
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* missing */ }
  return env
}

async function main() {
  const env = { ...loadEnv('.env'), ...loadEnv('apps/api/.env') }
  const key = env.MINDS_BUILDER_API_KEY
  const mindId = env.MINDS_MIND_ID
  if (!key || !mindId) { console.log('NO MINDS CONFIG'); return }

  const db = createDatabase(':memory:')
  migrate(db)
  const cid = 'dbg_' + Date.now().toString(36)
  createCreatorProfile(db, { creatorId: cid, displayName: 'Debug Creator' })
  addCreatorMemory(db, { id: 'dbg_m1', creatorId: cid, category: 'preference', content: 'Prefers async collabs' })

  const adapter = createMindsProviderAdapter({ builderApiKey: key, mindId })
  const context = buildMindContext(db, cid)
  const alias = aliasForCreator(cid)
  console.log('ALIAS:', alias)

  console.log('\n=== QUERY 1 ===')
  const a1 = await adapter.query(context, 'what kind of creators fit me?')
  console.log('REPLY 1:', a1.slice(0, 120))

  console.log('\n=== QUERY 2 (5s later) ===')
  await new Promise((r) => setTimeout(r, 5000))
  const a2 = await adapter.query(context, 'I make lofi beats on YouTube, 10k followers')
  console.log('REPLY 2:', a2.slice(0, 120))

  console.log('\n=== THREAD AFTER ===')
  const client = createMindsClient({ builderApiKey: key })
  const history = await client.getHistory(alias, { limit: 50 })
  for (const m of history) {
    console.log(`${m.fingerprint} | st=${m.senderType} | ${(m.messageText ?? '').slice(0, 80).replace(/\n/g, ' ')}`)
  }
  db.close()
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })