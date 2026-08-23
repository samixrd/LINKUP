import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createCreatorProfile,
  createDatabase,
  migrate,
} from '@linkup/db'
import express, { Router } from 'express'
import { registerMindIntroRoute } from '../src/routes/mind_intro.js'

function testApp(db: Database.Database) {
  const app = express()
  app.use(express.json())
  const router = Router()
  registerMindIntroRoute(router, db)
  app.use('/api/creators', router)
  return app
}

async function listen(app: ReturnType<typeof testApp>): Promise<string> {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as { port: number }
  return `http://127.0.0.1:${port}`
}

function seedDb() {
  const db: Database.Database = createDatabase(':memory:')
  migrate(db)
  createCreatorProfile(db, { creatorId: 'intro_user', displayName: 'Ivy', bio: 'Musician' })
  db.prepare(
    "INSERT INTO creator_memories (id, creator_id, category, content) VALUES ('s1', 'intro_user', 'goal', 'Reach 10k listeners')",
  ).run()
  return db
}

describe('mind intro route', () => {
  it('creates a personalized intro from onboarding memories', async () => {
    const db = seedDb()
    const baseUrl = await listen(testApp(db))

    const res = await fetch(`${baseUrl}/api/creators/intro_user/mind/intro`, { method: 'POST' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { created: boolean; interaction: { content: string } }
    expect(body.created).toBe(true)
    expect(body.interaction.content).toContain('[intro]')
    expect(body.interaction.content).toContain('Hey Ivy')
    expect(body.interaction.content).toContain('Reach 10k listeners')
    db.close()
  })

  it('is idempotent — second call returns the same intro without creating', async () => {
    const db = seedDb()
    const baseUrl = await listen(testApp(db))

    await fetch(`${baseUrl}/api/creators/intro_user/mind/intro`, { method: 'POST' })
    const second = await fetch(`${baseUrl}/api/creators/intro_user/mind/intro`, { method: 'POST' })
    expect(second.status).toBe(200)
    const body = (await second.json()) as { created: boolean }
    expect(body.created).toBe(false)

    // Only one intro interaction exists
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM mind_interactions WHERE content LIKE '[intro]%'")
      .get() as { n: number }
    expect(rows.n).toBe(1)
    db.close()
  })

  it('404s for unknown creators', async () => {
    const db = seedDb()
    const baseUrl = await listen(testApp(db))
    const res = await fetch(`${baseUrl}/api/creators/nobody/mind/intro`, { method: 'POST' })
    expect(res.status).toBe(404)
    db.close()
  })
})
