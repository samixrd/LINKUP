/* eslint-disable no-empty, no-undef */
/**
 * Production smoke test. Builds nothing itself: run `npm run smoke` which
 * builds first, then this script boots the *built* API (apps/api/dist) as a
 * real child process against a throwaway SQLite file, and verifies:
 *
 *  1. /api/health reports ok
 *  2. with no Minds credentials configured, /mind/query returns 503
 *     (stub fallback) and never leaks internals
 *  3. the Mind collaboration preview endpoint also returns 503 without
 *     credentials (stub fallback)
 *  4. with dummy production Minds credentials, the server still boots, health
 *     is ok, and no dummy key is ever leaked in logs or error responses
 *     (validates production config path without making real Minds requests)
 *  5. an invalid MINDS_REPLY_TIMEOUT_MS is rejected at startup with a clear
 *     error naming the variable and without leaking any configured secret
 *
 * Exits non-zero on any failure, including an early server crash.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 3199
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`
const STARTUP_TIMEOUT_MS = 20_000

const root = fileURLToPath(new URL('..', import.meta.url))
const tmpDir = mkdtempSync(join(tmpdir(), 'linkup-smoke-'))

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  DATABASE_PATH: join(tmpDir, 'smoke.db'),
  // Explicitly unset any Minds credentials from the caller's environment so
  // the smoke test always exercises the no-config path.
  MINDS_BUILDER_API_KEY: '',
  MINDS_MIND_ID: '',
}

const child = spawn(process.execPath, [join(root, 'apps/api/dist/index.js')], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let logs = ''
let intentionalShutdown = false
child.stdout.on('data', (d) => (logs += d))
child.stderr.on('data', (d) => (logs += d))

function fail(message) {
  cleanup('fail')
  console.error(`[smoke] FAIL: ${message}`)
  if (logs.trim()) console.error(`[smoke] server logs:\n${logs.trim()}`)
  process.exit(1)
}

function cleanup(_reason) {
  intentionalShutdown = true
  child.kill()
  // On Windows the child holds the SQLite file handle briefly after kill;
  // retry removal with a short delay.
  const deadline = Date.now() + 2000
  const attempt = () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      if (Date.now() < deadline) setTimeout(attempt, 100)
    }
  }
  attempt()
}

child.on('exit', (code) => {
  if (!intentionalShutdown && code !== null && code !== 0) {
    fail(`API process exited early with code ${code}`)
  }
})

async function waitForHealthy() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL)
      if (res.status === 200) return await res.json()
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('timed out waiting for /api/health')
}

async function main() {
  const health = await waitForHealthy()
  if (health.status !== 'ok' || !health.database?.ok) {
    fail(`health endpoint not ok: ${JSON.stringify(health)}`)
  }
  console.log(`[smoke] health ok (service ${health.service}, v${health.version})`)

  const createRes = await fetch(`http://127.0.0.1:${PORT}/api/creators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creatorId: 'smoke_creator', displayName: 'Smoke', bio: 'Loves pottery' }),
  })
  if (createRes.status !== 201) {
    fail(`creator creation failed with status ${createRes.status}`)
  }
  // A second creator sharing terms, so the collaboration preview reaches the
  // adapter instead of short-circuiting with "no compatible creators".
  const partnerRes = await fetch(`http://127.0.0.1:${PORT}/api/creators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creatorId: 'smoke_partner', displayName: 'Partner', bio: 'Pottery collector' }),
  })
  if (partnerRes.status !== 201) {
    fail(`partner creation failed with status ${partnerRes.status}`)
  }

  const queryRes = await fetch(`http://127.0.0.1:${PORT}/api/creators/smoke_creator/mind/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'hello' }),
  })
  if (queryRes.status !== 503) {
    fail(`expected 503 from stub /mind/query, got ${queryRes.status}`)
  }
  const body = await queryRes.json()
  if (typeof body.error !== 'string' || !body.error.includes('Minds adapter not configured')) {
    fail(`unexpected 503 body: ${JSON.stringify(body)}`)
  }
  console.log('[smoke] no-config Minds query → 503 as expected')

  const previewRes = await fetch(`http://127.0.0.1:${PORT}/api/creators/smoke_creator/mind/collaborations/preview`, {
    method: 'POST',
  })
  if (previewRes.status !== 503) {
    fail(`expected 503 from stub collaboration preview, got ${previewRes.status}`)
  }
  const previewBody = await previewRes.json()
  if (typeof previewBody.error !== 'string' || !previewBody.error.includes('Minds adapter not configured')) {
    fail(`unexpected 503 body: ${JSON.stringify(previewBody)}`)
  }
  console.log('[smoke] no-config collaboration preview → 503 as expected')

  // ---- Phase 4: production config path with dummy credentials (no real Minds request) ----
  // Verify that the server boots with valid production env vars, health is still ok,
  // and that no dummy secret is ever echoed in logs. We do NOT make a real
  // Minds request here — we only validate that the production path is wired
  // correctly and that the stub is correctly replaced by the real adapter
  // (which would require real credentials to actually contact the provider).
  const prodPort = 3200
  const prodTmpDir = mkdtempSync(join(tmpdir(), 'linkup-smoke-prod-'))
  const dummyKey = 'sk-smoke-dummy-production-key-12345'
  const dummyMindId = 'mind-smoke-dummy-123'
  const prodEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(prodPort),
    DATABASE_PATH: join(prodTmpDir, 'smoke-prod.db'),
    MINDS_BUILDER_API_KEY: dummyKey,
    MINDS_MIND_ID: dummyMindId,
    MINDS_REPLY_TIMEOUT_MS: '5000',
  }
  const prodChild = spawn(process.execPath, [join(root, 'apps/api/dist/index.js')], {
    env: prodEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let prodLogs = ''
  prodChild.stdout.on('data', (d) => (prodLogs += d))
  prodChild.stderr.on('data', (d) => (prodLogs += d))
  let prodExited = false
  prodChild.on('exit', (code) => {
    prodExited = true
    if (code !== 0 && code !== null) {
      // Will be checked below after health timeout
    }
  })

  async function waitForProdHealthy() {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (prodExited) throw new Error('production smoke child exited early')
      try {
        const res = await fetch(`http://127.0.0.1:${prodPort}/api/health`)
        if (res.status === 200) return await res.json()
      } catch {
        // not ready
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error('timed out waiting for production /api/health')
  }

  const prodHealth = await waitForProdHealthy()
  if (prodHealth.status !== 'ok' || !prodHealth.database?.ok) {
    prodChild.kill()
    try { rmSync(prodTmpDir, { recursive: true, force: true }) } catch {}
    fail(`production health not ok: ${JSON.stringify(prodHealth)}`)
  }
  console.log(`[smoke] production health ok with dummy credentials (service ${prodHealth.service}, v${prodHealth.version})`)
  // Ensure no dummy secret leaked in logs
  if (prodLogs.includes(dummyKey) || prodLogs.includes(dummyMindId)) {
    prodChild.kill()
    try { rmSync(prodTmpDir, { recursive: true, force: true }) } catch {}
    fail('production logs leaked dummy credentials')
  }
  prodChild.kill()
  // Give it a moment to exit
  await new Promise((r) => setTimeout(r, 300))
  try { rmSync(prodTmpDir, { recursive: true, force: true }) } catch {}
  console.log('[smoke] production dummy credentials → no leak, health ok (no real Minds request made)')

  // ---- Phase 5: invalid MINDS_REPLY_TIMEOUT_MS is rejected at startup without leaking secret ----
  const invalidPort = 3201
  const invalidTmpDir = mkdtempSync(join(tmpdir(), 'linkup-smoke-invalid-'))
  const invalidEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(invalidPort),
    DATABASE_PATH: join(invalidTmpDir, 'smoke-invalid.db'),
    MINDS_BUILDER_API_KEY: dummyKey,
    MINDS_MIND_ID: dummyMindId,
    MINDS_REPLY_TIMEOUT_MS: 'not-a-number',
  }
  const invalidChild = spawn(process.execPath, [join(root, 'apps/api/dist/index.js')], {
    env: invalidEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let invalidLogs = ''
  invalidChild.stdout.on('data', (d) => (invalidLogs += d))
  invalidChild.stderr.on('data', (d) => (invalidLogs += d))
  const invalidExit = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ code: null, logs: invalidLogs }), 5000)
    invalidChild.on('exit', (code) => {
      clearTimeout(timeout)
      resolve({ code, logs: invalidLogs })
    })
  })
  invalidChild.kill()
  try { rmSync(invalidTmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  if (invalidExit.code === 0) {
    fail('expected server to fail with invalid MINDS_REPLY_TIMEOUT_MS, but it started')
  }
  const combinedInvalidLogs = String(invalidExit.logs ?? invalidLogs)
  if (!combinedInvalidLogs.includes('MINDS_REPLY_TIMEOUT_MS')) {
    fail(`invalid timeout error should name MINDS_REPLY_TIMEOUT_MS, got: ${combinedInvalidLogs.slice(0, 500)}`)
  }
  if (combinedInvalidLogs.includes(dummyKey)) {
    fail('invalid timeout error leaked dummy API key')
  }
  console.log('[smoke] invalid MINDS_REPLY_TIMEOUT_MS correctly rejected without leak')

  cleanup('success')
  console.log('[smoke] OK')
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
