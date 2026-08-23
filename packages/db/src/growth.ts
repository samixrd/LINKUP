import type Database from 'better-sqlite3'
import { getCollaboration } from './collaborations.js'
import { getCreatorProfile } from './profiles.js'
import { addCreatorMemory, getCreatorMemory } from './memories.js'
import type { CreatorMemory } from './memories.js'

/**
 * Growth outcome layer: measurable audience evidence for a collaboration.
 *
 * Each row records one metric (e.g. "followers", "reach") for one
 * participant, before and after the collaboration. Deltas feed a
 * deterministic `growth_outcome` memory so the learning loop can prefer
 * collaborators whose partnerships historically grew the audience.
 */

export interface GrowthOutcome {
  id: string
  collaborationId: string
  creatorId: string
  metric: string
  valueBefore: number
  valueAfter: number
  createdAt: string
  updatedAt: string
}

export interface NewGrowthOutcome {
  id?: string
  collaborationId: string
  creatorId: string
  metric: string
  valueBefore: number
  valueAfter: number
}

export interface GrowthDelta {
  metric: string
  valueBefore: number
  valueAfter: number
  delta: number
  percentChange: number | null
}

interface GrowthRow {
  id: string
  collaboration_id: string
  creator_id: string
  metric: string
  value_before: number
  value_after: number
  created_at: string
  updated_at: string
}

const SELECT_COLUMNS = `
  id,
  collaboration_id,
  creator_id,
  metric,
  value_before,
  value_after,
  created_at,
  updated_at
`

function toGrowthOutcome(row: GrowthRow): GrowthOutcome {
  return {
    id: row.id,
    collaborationId: row.collaboration_id,
    creatorId: row.creator_id,
    metric: row.metric,
    valueBefore: row.value_before,
    valueAfter: row.value_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Deterministic memory id for a growth outcome (idempotent per creator+collab+metric). */
export function growthOutcomeMemoryId(
  collaborationId: string,
  creatorId: string,
  metric: string,
): string {
  return `growth:${collaborationId}:${creatorId}:${metric}`
}

/**
 * Deterministic, explainable content for a growth outcome memory. The
 * percentage and partner name make the learning signal traceable: future
 * matching can prefer partners whose collabs historically grew the creator.
 */
export function growthOutcomeContent(
  input: {
    collaborationId: string
    status: string
    otherDisplayName: string
    otherCreatorId: string
    metric: string
    valueBefore: number
    valueAfter: number
  },
): string {
  const delta = input.valueAfter - input.valueBefore
  const percent =
    input.valueBefore > 0
      ? ` (${((delta / input.valueBefore) * 100).toFixed(1)}%)`
      : ''
  const direction = delta > 0 ? `grew by ${delta}` : delta < 0 ? `changed by ${delta}` : 'stayed flat'
  return `Audience ${input.metric} ${direction}${percent} after ${input.status} collaboration ${input.collaborationId} with ${input.otherDisplayName} (${input.otherCreatorId})`
}

function assertNonEmpty(value: string, field: string, max = 255): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required and must be a non-empty string`)
  }
  if (value.length > max) {
    throw new Error(`${field} must be at most ${max} characters`)
  }
}

function assertMetric(value: string): void {
  assertNonEmpty(value, 'metric', 64)
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error('metric must contain only letters, numbers, dashes, or underscores')
  }
}

function assertCount(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`)
  }
}

/**
 * Records a growth measurement for one participant of a collaboration.
 * Idempotent per (collaboration, creator, metric): re-recording the same
 * triple updates the existing row rather than duplicating it. When the
 * collaboration is in a terminal state, also writes/updates the
 * deterministic `growth_outcome` memory for the creator so the learning
 * loop picks it up. Throws an `Error` when the collaboration or creator
 * does not exist, when the creator is not a participant, or when fields
 * are invalid.
 */
export function recordGrowthOutcome(
  db: Database.Database,
  input: NewGrowthOutcome,
): { outcome: GrowthOutcome; memory: CreatorMemory | undefined } {
  assertNonEmpty(input.collaborationId, 'collaborationId')
  assertNonEmpty(input.creatorId, 'creatorId')
  assertMetric(input.metric)
  assertCount(input.valueBefore, 'valueBefore')
  assertCount(input.valueAfter, 'valueAfter')

  const collaboration = getCollaboration(db, input.collaborationId)
  if (collaboration === undefined) {
    throw new Error(`collaboration not found: ${input.collaborationId}`)
  }
  if (
    collaboration.initiatorId !== input.creatorId &&
    collaboration.targetId !== input.creatorId
  ) {
    throw new Error(`creator is not a participant: ${input.creatorId}`)
  }
  if (getCreatorProfile(db, input.creatorId) === undefined) {
    throw new Error(`creator profile not found: ${input.creatorId}`)
  }

  const otherId =
    collaboration.initiatorId === input.creatorId
      ? collaboration.targetId
      : collaboration.initiatorId
  const other = getCreatorProfile(db, otherId)
  const otherName = other?.displayName ?? otherId

  const id =
    input.id ??
    `growth:${input.collaborationId}:${input.creatorId}:${input.metric}`

  const existingRow = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM growth_outcomes WHERE id = ?`)
    .get(id) as GrowthRow | undefined

  let outcome: GrowthOutcome
  if (existingRow !== undefined) {
    db.prepare(
      `UPDATE growth_outcomes
       SET value_before = @valueBefore, value_after = @valueAfter
       WHERE id = @id`,
    ).run({ id, valueBefore: input.valueBefore, valueAfter: input.valueAfter })
    outcome = toGrowthOutcome(
      db.prepare(`SELECT ${SELECT_COLUMNS} FROM growth_outcomes WHERE id = ?`).get(id) as GrowthRow,
    )
  } else {
    db.prepare(
      `INSERT INTO growth_outcomes (id, collaboration_id, creator_id, metric, value_before, value_after)
       VALUES (@id, @collaborationId, @creatorId, @metric, @valueBefore, @valueAfter)`,
    ).run({
      id,
      collaborationId: input.collaborationId,
      creatorId: input.creatorId,
      metric: input.metric,
      valueBefore: input.valueBefore,
      valueAfter: input.valueAfter,
    })
    outcome = toGrowthOutcome(
      db.prepare(`SELECT ${SELECT_COLUMNS} FROM growth_outcomes WHERE id = ?`).get(id) as GrowthRow,
    )
  }

  // Terminal collabs feed the learning loop via a deterministic memory.
  let memory: CreatorMemory | undefined
  const terminal = new Set(['accepted', 'rejected', 'cancelled'])
  if (terminal.has(collaboration.status)) {
    const memoryId = growthOutcomeMemoryId(input.collaborationId, input.creatorId, input.metric)
    const content = growthOutcomeContent({
      collaborationId: collaboration.id,
      status: collaboration.status,
      otherDisplayName: otherName,
      otherCreatorId: otherId,
      metric: input.metric,
      valueBefore: input.valueBefore,
      valueAfter: input.valueAfter,
    })
    const existingMemory = getCreatorMemory(db, memoryId)
    if (existingMemory !== undefined) {
      db.prepare('UPDATE creator_memories SET content = @content WHERE id = @id').run({
        id: memoryId,
        content,
      })
      memory = getCreatorMemory(db, memoryId)
    } else {
      memory = addCreatorMemory(db, {
        id: memoryId,
        creatorId: input.creatorId,
        category: 'collaboration_outcome',
        content,
      })
    }
  }

  return { outcome, memory }
}

/**
 * Lists growth measurements for a collaboration, ordered by creator then
 * metric for stability.
 */
export function listGrowthOutcomesForCollaboration(
  db: Database.Database,
  collaborationId: string,
): GrowthOutcome[] {
  assertNonEmpty(collaborationId, 'collaborationId')
  if (getCollaboration(db, collaborationId) === undefined) {
    throw new Error(`collaboration not found: ${collaborationId}`)
  }
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM growth_outcomes
       WHERE collaboration_id = ?
       ORDER BY creator_id ASC, metric ASC`,
    )
    .all(collaborationId) as GrowthRow[]
  return rows.map(toGrowthOutcome)
}

/**
 * Aggregated growth summary for one creator: per-metric deltas across all
 * of their collaborations, plus a total delta. Ordered by metric name.
 */
export function growthSummaryForCreator(
  db: Database.Database,
  creatorId: string,
): { metrics: GrowthDelta[]; totalDelta: number } {
  assertNonEmpty(creatorId, 'creatorId')
  if (getCreatorProfile(db, creatorId) === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
  }
  const rows = db
    .prepare(
      `SELECT metric, value_before, value_after FROM growth_outcomes
       WHERE creator_id = ?
       ORDER BY metric ASC, created_at ASC`,
    )
    .all(creatorId) as Array<{ metric: string; value_before: number; value_after: number }>

  const byMetric = new Map<string, { before: number; after: number }>()
  for (const row of rows) {
    const entry = byMetric.get(row.metric) ?? { before: 0, after: 0 }
    entry.before += row.value_before
    entry.after += row.value_after
    byMetric.set(row.metric, entry)
  }

  const metrics: GrowthDelta[] = []
  let totalDelta = 0
  for (const metric of [...byMetric.keys()].sort()) {
    const entry = byMetric.get(metric)
    if (entry === undefined) continue
    const delta = entry.after - entry.before
    totalDelta += delta
    metrics.push({
      metric,
      valueBefore: entry.before,
      valueAfter: entry.after,
      delta,
      percentChange: entry.before > 0 ? (delta / entry.before) * 100 : null,
    })
  }
  return { metrics, totalDelta }
}
