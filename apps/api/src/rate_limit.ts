import type { NextFunction, Request, Response } from 'express'

/**
 * Dependency-free fixed-window rate limiter for the Mind endpoints. Every
 * Mind request is forwarded to an external paid provider, so unbounded
 * traffic would translate directly into cost and provider-side throttling.
 *
 * Design notes:
 * - Keyed by `creatorId` when present (the natural per-actor unit here),
 *   falling back to the client IP for paths without one.
 * - Fixed window per key: cheap O(1) bookkeeping, expired windows are
 *   pruned lazily on each hit.
 * - Returns 429 with a plain `error` body and `Retry-After` — consistent
 *   with the API's no-internals error contract.
 * - In-memory only: appropriate for the single-process deployment; a
 *   multi-process rollout should move the counter to shared storage.
 */
export interface RateLimiterOptions {
  /** Maximum requests allowed per window per key. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
}

interface WindowState {
  count: number
  resetAt: number
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { max, windowMs } = options
  const windows = new Map<string, WindowState>()

  function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now()
    const key = rateLimitKey(req)
    const existing = windows.get(key)

    if (existing === undefined || existing.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    if (existing.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      res.set('Retry-After', String(retryAfterSeconds))
      res.status(429).json({ error: 'too many requests — slow down and retry shortly' })
      return
    }

    existing.count += 1

    // Lazy prune so idle keys cannot accumulate forever.
    if (windows.size > 10_000) {
      for (const [k, state] of windows) {
        if (state.resetAt <= now) windows.delete(k)
      }
    }

    next()
  }

  return rateLimitMiddleware
}

/** Extracts `/api/creators/:creatorId/mind/...` creatorId, else client IP. */
function rateLimitKey(req: Request): string {
  const match = /^\/api\/creators\/([^/]+)\/mind/.exec(req.path)
  if (match !== null && match[1] !== '') {
    return `creator:${match[1]}`
  }
  return `ip:${req.ip ?? 'unknown'}`
}
