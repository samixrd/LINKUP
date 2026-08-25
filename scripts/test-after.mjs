/* Tests the 'after' param behavior on getHistory */
import { readFileSync } from 'node:fs'
import { createMindsClient } from '@animocabrands/minds-client-lib'

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
  if (!key) { console.log('NO API KEY'); return }
  const client = createMindsClient({ builderApiKey: key })
  const alias = process.argv[2]
  if (!alias) { console.log('usage: node scripts/test-after.mjs <alias>'); return }
  
  // Get full history
  const full = await client.getHistory(alias, { limit: 50 })
  console.log(`--- FULL (${full.length}) ---`)
  for (const m of full) {
    console.log(`  ${m.fingerprint} | st=${m.senderType} | ${(m.messageText??'').slice(0,80).replace(/\n/g,' ')}`)
  }
  
  if (full.length < 2) { console.log('need at least 2 messages'); return }
  const middleFp = full[Math.floor(full.length / 2)].fingerprint
  console.log(`\n--- AFTER fingerprint: ${middleFp} (message ${Math.floor(full.length/2)}) ---`)
  const after = await client.getHistory(alias, { after: middleFp, limit: 50 })
  for (const m of after) {
    console.log(`  ${m.fingerprint} | st=${m.senderType} | ${(m.messageText??'').slice(0,80).replace(/\n/g,' ')}`)
  }
  console.log(`\nResult: ${after.length} messages after cursor`)
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })