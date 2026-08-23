import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  buildMindContext,
  createMindInteraction,
  getCollaboration,
  getCreatorProfile,
  incrementFollowUpAttempts,
  listDueFollowUps,
  updateFollowUpStatus,
} from '@linkup/db'
import type { FollowUp } from '@linkup/db'

/**
 * Autonomous follow-up worker.
 *
 * This is the "acts without constant human prompting" half of the Mind
 * loop: a timer-driven tick that drains the due follow-up queue, asks the
 * injected Mind adapter to draft each nudge from live context, records the
 * exchange as mind interactions (persistence), and reschedules or
 * completes each follow-up. No handler runs it — the API boots one
 * interval at startup; humans only observe.
 *
 * Per follow-up lifecycle:
 *   pending + due -> draft via adapter -> interaction recorded ->
 *   completed (or attempts+1 and stays pending if drafting failed)
 */

export interface FollowUpWorkerOptions {
  db: Database.Database
  adapter: import('@linkup/db').MindAdapter
  /** How often to scan for due follow-ups. Default 30s. */
  intervalMs?: number
  /** Delay before a failed follow-up becomes due again. Default 60s. */
  retryDelayMs?: number
  /** Give up after this many attempts. Default 3. */
  maxAttempts?: number
}

export interface FollowUpTickResult {
  processed: number
  completed: number
  retried: number
}

const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_RETRY_DELAY_MS = 60_000
const DEFAULT_MAX_ATTEMPTS = 3

export function createFollowUpWorker(options: FollowUpWorkerOptions) {
  const db = options.db
  const adapter = options.adapter
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  let timer: ReturnType<typeof setInterval> | undefined

  /**
   * Processes every due follow-up once. Errors while processing one item do
   * not abort the batch — that item gets attempts+1 and a new due time, the
   * rest continue.
   */
  async function tick(now: Date = new Date()): Promise<FollowUpTickResult> {
    const due = listDueFollowUps(db, now)
    let completed = 0
    let retried = 0
    for (const fu of due) {
      try {
        await processOne(fu, now)
        completed += 1
      } catch {
        incrementFollowUpAttempts(db, fu.id)
        retried += 1
        const updated = requireFollowUp(db, fu.id)
        if (updated.attempts >= maxAttempts) {
          updateFollowUpStatus(db, fu.id, 'cancelled')
        } else {
          const nextDue = new Date(now.getTime() + retryDelayMs).toISOString()
          reschedule(db, fu.id, nextDue)
        }
      }
    }
    return { processed: due.length, completed, retried }
  }

  async function processOne(fu: FollowUp, now: Date): Promise<void> {
    const collaboration = getCollaboration(db, fu.collaborationId)
    if (collaboration === undefined) {
      throw new Error(`collaboration not found: ${fu.collaborationId}`)
    }
    // The Mind acts on behalf of the initiator.
    const creatorId = collaboration.initiatorId
    const target = getCreatorProfile(db, collaboration.targetId)

    const context = buildMindContext(db, creatorId)
    const prompt =
      `Time to follow up on collaboration ${collaboration.id} with ` +
      `${target?.displayName ?? collaboration.targetId}. Original proposal: ` +
      `"${collaboration.proposal}". Status: ${collaboration.status}. ` +
      `Draft a short, friendly check-in message to keep this collaboration moving.`

    const answer = await adapter.query(context, prompt)
    if (typeof answer !== 'string' || answer.trim() === '') {
      throw new Error('adapter returned an empty follow-up draft')
    }

    const persist = db.transaction(() => {
      createMindInteraction(db, {
        id: randomUUID(),
        creatorId,
        role: 'user',
        content: `[autonomous follow-up] ${prompt}`,
      })
      createMindInteraction(db, {
        id: randomUUID(),
        creatorId,
        role: 'mind',
        content: answer,
      })
      updateFollowUpStatus(db, fu.id, 'completed')
    })
    persist()
    void now
  }

  function start(): void {
    if (timer !== undefined) return
    timer = setInterval(() => {
      void tick().catch(() => {
        /* tick-level failure is non-fatal; next interval retries */
      })
    }, intervalMs)
    // Do not hold the event loop open just for the worker.
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  return { tick, start, stop }
}

function requireFollowUp(db: Database.Database, id: string): FollowUp {
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(id) as
    | { id: string; attempts: number }
    | undefined
  if (row === undefined) {
    throw new Error(`follow-up not found: ${id}`)
  }
  return row as unknown as FollowUp
}

function reschedule(db: Database.Database, id: string, dueAt: string): void {
  db.prepare('UPDATE follow_ups SET due_at = @dueAt WHERE id = @id AND status = \'pending\'').run({
    id,
    dueAt,
  })
}
