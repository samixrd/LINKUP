import { COLLABORATION_STATUSES, MEMORY_CATEGORIES } from '@linkup/db'
import type { Response } from 'express'

/** Upper bound on a memory content payload, in characters (abuse hardening). */
export const MAX_MEMORY_CONTENT_LENGTH = 10_000

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** True for a string of one or more ASCII digits (e.g. "0", "42"). */
export function isIntegerString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value)
}

export function isMemoryCategory(value: unknown): value is MemoryCategory {
  return isNonEmptyString(value) && MEMORY_CATEGORIES.includes(value as MemoryCategory)
}

export function isCollaborationStatus(value: unknown): value is CollaborationStatus {
  return isNonEmptyString(value) && COLLABORATION_STATUSES.includes(value as CollaborationStatus)
}

export function isSqliteConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as Error & { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')
}

import type { CollaborationStatus, MemoryCategory } from '@linkup/db'

/** Maps Mind collaboration service errors to appropriate HTTP status codes. */
export function respondWithMindCollaborationError(res: Response, err: unknown, fallback: string): void {
  if (isSqliteConstraintError(err)) {
    res.status(409).json({ error: 'collaboration already exists' })
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('creator profile not found') || message.includes('no compatible creators found')) {
    res.status(404).json({ error: message })
    return
  }
  if (
    message.includes('must be a non-empty string') ||
    message.includes('must be different') ||
    message.includes('targetId') ||
    message.includes('is not a compatible match') ||
    message.includes('confirmation is required') ||
    message.includes('adapter returned an empty') ||
    message.includes('adapter returned an over-long')
  ) {
    res.status(400).json({ error: message })
    return
  }
  if (message.includes('active collaboration already exists')) {
    res.status(409).json({ error: message })
    return
  }
  if (message.includes('Minds adapter not configured')) {
    res.status(503).json({ error: message })
    return
  }
  res.status(500).json({ error: fallback })
}

export function respondWithMindNegotiationError(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('creator profile not found') || message.includes('collaboration not found')) {
    res.status(404).json({ error: message })
    return
  }
  if (
    message.includes('must be a non-empty string') ||
    message.includes('confirmation is required') ||
    message.includes('cannot counter proposal in status') ||
    message.includes('invalid status transition') ||
    message.includes('adapter returned an empty') ||
    message.includes('adapter returned an over-long') ||
    message.includes('must be a participant')
  ) {
    res.status(400).json({ error: message })
    return
  }
  if (message.includes('Minds adapter not configured')) {
    res.status(503).json({ error: message })
    return
  }
  res.status(500).json({ error: fallback })
}

export function respondWithMindDecisionError(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('creator profile not found') || message.includes('collaboration not found')) {
    res.status(404).json({ error: message })
    return
  }
  if (
    message.includes('must be a non-empty string') ||
    message.includes('invalid action') ||
    message.includes('invalid decision format') ||
    message.includes('reasoning is required') ||
    message.includes('counterProposal is required') ||
    message.includes('must be at most') ||
    message.includes('must be one of')
  ) {
    res.status(400).json({ error: message })
    return
  }
  if (message.includes('Minds adapter not configured')) {
    res.status(503).json({ error: message })
    return
  }
  res.status(500).json({ error: fallback })
}
