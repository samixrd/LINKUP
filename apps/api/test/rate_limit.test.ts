import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createCreatorProfile, createDatabase, migrate, stubMindAdapter } from '@linkup/db'
import { createApp } from '../src/app.js'

function testApp() {
  const db: Database.Database = createDatabase(':memory:')
  migrate(db)
  const app = createApp({ db, mindAdapter: stubMindAdapter })
  return { app, db }
}

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as { port: number }
  return `http://127.0.0.1:${port}`
}

describe('mind endpoint rate limiting', () => {
  it('allows normal usage and returns clean errors from the handler below the limit', async () => {
    const { app, db } = testApp()
    createCreatorProfile(db, { creatorId: 'rl_user', displayName: 'RL User' })
    const baseUrl = await listen(app)

    // A handful of requests must all reach the real handler (404/400/503
    // domain errors — not 429).
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/creators/rl_user/mind/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'hello' }),
      })
      expect(res.status).not.toBe(429)
    }
    db.close()
  })

  it('returns 429 with Retry-After after the per-creator budget is exhausted', async () => {
    const { app, db } = testApp()
    createCreatorProfile(db, { creatorId: 'rl_spam', displayName: 'RL Spam' })
    const baseUrl = await listen(app)

    // The stub adapter 503s on mind/query; each attempt still counts.
    let saw429 = false
    let retryAfter: string | null = null
    let errorBody: unknown = null
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${baseUrl}/api/creators/rl_spam/mind/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'hello' }),
      })
      if (res.status === 429) {
        saw429 = true
        retryAfter = res.headers.get('retry-after')
        errorBody = (await res.json()) as unknown
        break
      }
    }
    expect(saw429).toBe(true)
    expect(retryAfter).toBeTruthy()
    expect(errorBody).toMatchObject({ error: expect.stringContaining('too many requests') })
    db.close()
  })

  it('does not throttle non-Mind endpoints', async () => {
    const { app, db } = testApp()
    const baseUrl = await listen(app)

    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${baseUrl}/api/health`)
      expect(res.status).toBe(200)
    }
    db.close()
  })
})
