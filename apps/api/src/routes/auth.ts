import { Router } from 'express'
import type Database from 'better-sqlite3'
import {
  getAccountProfile,
  getCreatorProfile,
  loginWithPin,
  logoutSession,
  registerAccount,
  resolveSession,
} from '@linkup/db'

/** Cookie name for the session token. */
export const SESSION_COOKIE = 'linkup_session'

function parseCookies(req: { headers: { cookie?: string } }): Record<string, string> {
  const header = req.headers.cookie
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

/**
 * Auth routes: POST /register (handle + pin + displayName [+ bio] +
 * onboarding memories), POST /login, POST /logout, GET /me.
 * The session cookie is httpOnly + sameSite=lax; secure in production.
 */
export function createAuthRouter(db: Database.Database): Router {
  const router = Router()

  router.post('/register', (req, res) => {
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { handle, pin, displayName, bio } = body as Record<string, unknown>
    try {
      const { account, profile } = registerAccount(db, {
        handle: handle as string,
        pin: pin as string,
        displayName: displayName as string,
        ...(typeof bio === 'string' && bio.trim() !== '' ? { bio } : {}),
      })

      // Onboarding memories (optional, structured): the Tinder-style flow
      // sends these as [{category, content}] so the Mind starts with context.
      const memories = Array.isArray((body as { memories?: unknown }).memories)
        ? (body as { memories: Array<{ category?: unknown; content?: unknown }> }).memories
        : []
      let seeded = 0
      for (const memory of memories.slice(0, 12)) {
        if (typeof memory !== 'object' || memory === null) continue
        const { category, content } = memory as Record<string, unknown>
        if (
          typeof category !== 'string' ||
          !['goal', 'preference'].includes(category) ||
          typeof content !== 'string' ||
          content.trim() === '' ||
          content.length > 500
        ) {
          continue
        }
        db.prepare(
          'INSERT INTO creator_memories (id, creator_id, category, content) VALUES (?, ?, ?, ?)',
        ).run(
          `seed_${account.creatorId}_${seeded}_${Date.now()}`,
          account.creatorId,
          category,
          content.trim(),
        )
        seeded += 1
      }

      const session = loginWithPin(db, handle as string, pin as string)
      res.cookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      res.status(201).json({
        handle: account.handle,
        creatorId: account.creatorId,
        profile,
        seededMemories: seeded,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('already taken')) {
        res.status(409).json({ error: message })
        return
      }
      if (message.includes('must be')) {
        res.status(400).json({ error: message })
        return
      }
      throw err
    }
  })

  router.post('/login', (req, res) => {
    const body = req.body
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { handle, pin } = body as Record<string, unknown>
    try {
      const session = loginWithPin(db, handle as string, pin as string)
      res.cookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      const profile = getCreatorProfile(db, session.creatorId)
      res.json({ handle: session.handle, creatorId: session.creatorId, profile })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('invalid') || message.includes('must be')) {
        res.status(401).json({ error: 'invalid handle or pin' })
        return
      }
      throw err
    }
  })

  router.post('/logout', (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE]
    if (token !== undefined) logoutSession(db, token)
    res.clearCookie(SESSION_COOKIE)
    res.json({ ok: true })
  })

  router.get('/me', (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE]
    const session = token !== undefined ? resolveSession(db, token) : undefined
    if (session === undefined) {
      res.status(401).json({ error: 'not signed in' })
      return
    }
    const profile =
      getCreatorProfile(db, session.creatorId) ??
      getAccountProfile(db, session.handle)
    res.json({ handle: session.handle, creatorId: session.creatorId, profile })
  })

  return router
}
