import { describe, expect, it } from 'vitest'
import { createDatabase, migrate, ping } from '../src/index.js'

describe('database foundation', () => {
  it('applies pending migrations on a fresh database', () => {
    const db = createDatabase(':memory:')
    const applied = migrate(db)
    expect(applied).toEqual([
      '0001_baseline.sql',
      '0002_creator_profiles.sql',
      '0003_creator_memories.sql',
      '0004_creator_discovery.sql',
      '0005_creator_collaborations.sql',
      '0006_creator_follow_ups.sql',
      '0007_mind_interactions.sql',
      '0008_counter_proposal.sql',
      '0009_collaboration_proposals.sql',
      '0010_growth_outcomes.sql',
      '0011_accounts.sql',
    ])

    const rows = db.prepare('SELECT version FROM schema_migrations').all()
    expect(rows).toHaveLength(11)
    db.close()
  })

  it('is idempotent — a second migrate applies nothing', () => {
    const db = createDatabase(':memory:')
    migrate(db)
    expect(migrate(db)).toEqual([])
    db.close()
  })

  it('creates the baseline infrastructure table', () => {
    const db = createDatabase(':memory:')
    migrate(db)
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'system_meta'")
      .get()
    expect(table).toBeTruthy()
    db.close()
  })

  it('reports a healthy ping with latency', () => {
    const db = createDatabase(':memory:')
    const result = ping(db)
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    db.close()
  })
})
