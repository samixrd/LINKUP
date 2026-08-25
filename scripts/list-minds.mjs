/* Lists available Minds and the configured one, WITHOUT printing the API key. */
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
  const configuredMindId = env.MINDS_MIND_ID
  if (!key) { console.log('NO API KEY in .env'); return }
  console.log('configured MINDS_MIND_ID:', configuredMindId || '(none)')
  const client = createMindsClient({ builderApiKey: key })
  const minds = await client.listMinds()
  console.log('--- available Minds ---')
  for (const m of minds) {
    const isCfg = m.mindId === configuredMindId ? '  <-- CONFIGURED' : ''
    console.log(`${m.mindId} | ${m.name ?? '(unnamed)'} | enabled=${m.isEnabled}${isCfg}`)
  }
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
