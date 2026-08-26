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

      let niches: string[] = []
      let platforms: string[] = []
      let audienceSize: string = '~1k'

      let languages: string[] = ['en']
      let format: string = 'Viral Short-Form'
      let freq: string = '2-3 Times a Week'
      let goals: string[] = []
      let collabStyle: string = 'Pro'
      let dealPolicy: string = 'Hybrid'
      let partnerRule: string = 'open'

      for (const memory of memories.slice(0, 16)) {
        if (typeof memory !== 'object' || memory === null) continue
        const { category, content } = memory as Record<string, unknown>
        if (
          typeof category !== 'string' ||
          !['goal', 'preference', 'constraint'].includes(category) ||
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

        const text = content.trim()
        if (text.startsWith('Primary creative niche: ')) {
          niches = text.replace('Primary creative niche: ', '').split(',').map((s) => s.trim())
        } else if (text.startsWith('Active distribution platforms: ')) {
          platforms = (text.replace('Active distribution platforms: ', '').split('(')[0] ?? '').split(',').map((s) => s.trim())
        } else if (text.startsWith('Current creator audience size: ')) {
          audienceSize = text.replace('Current creator audience size: ', '').trim()
        } else if (text.startsWith('Languages created in: ')) {
          languages = text.replace('Languages created in: ', '').split(',').map((s) => s.trim().split(' ')[0] ?? s.trim())
        } else if (text.startsWith('Signature content format: ')) {
          format = text.replace('Signature content format: ', '').trim()
        } else if (text.startsWith('Production & posting cadence: ')) {
          freq = text.replace('Production & posting cadence: ', '').trim()
        } else if (text.startsWith('My primary goal: ') || category === 'goal') {
          goals.push(text.replace('My primary goal: ', '').trim())
        } else if (text.startsWith('Collaboration style: ')) {
          collabStyle = text.replace('Collaboration style: ', '').trim()
        } else if (text.startsWith('Deal terms policy: ')) {
          dealPolicy = text.replace('Deal terms policy: ', '').trim()
        } else if (text.startsWith('Partner policy: ')) {
          partnerRule = text.replace('Partner policy: ', '').trim()
        }
      }

      // Automatically populate creator_profile_details from 12 steps
      try {
        db.prepare(`
          INSERT INTO creator_profile_details (
            creator_id, niches, platforms, audience_size, collab_types,
            availability, location, goals, dealbreakers, languages,
            partner_min_audience, open_to_small, compensation, content_format, posting_frequency
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(creator_id) DO UPDATE SET
            niches = excluded.niches,
            platforms = excluded.platforms,
            audience_size = excluded.audience_size,
            languages = excluded.languages,
            goals = excluded.goals,
            dealbreakers = excluded.dealbreakers,
            content_format = excluded.content_format,
            posting_frequency = excluded.posting_frequency
        `).run(
          account.creatorId,
          JSON.stringify(niches.length > 0 ? niches : ['Creative Media']),
          JSON.stringify(platforms.length > 0 ? platforms : ['YouTube']),
          audienceSize,
          JSON.stringify(['co-create', 'cross-promote']),
          freq || '~5 hrs/week',
          'Global',
          JSON.stringify(goals.length > 0 ? goals : ['Audience growth and collaborative creative impact']),
          dealPolicy || 'Fair terms and quality deliverables',
          JSON.stringify(languages.length > 0 ? languages : ['English']),
          partnerRule.includes('Peer') ? '~1k' : 'any',
          partnerRule.includes('Verified') ? 'no' : 'yes',
          JSON.stringify(['paid', 'barter', 'revenue-share']),
          JSON.stringify([format]),
          freq,
        )

        // Automatically set initial Go Open card
        const approxFollowers =
          audienceSize.includes('1M') ? 1_000_000 :
          audienceSize.includes('250K') ? 250_000 :
          audienceSize.includes('50K') ? 50_000 :
          audienceSize.includes('10K') ? 10_000 :
          audienceSize.includes('1K') ? 1_000 : 500

        db.prepare(`
          INSERT INTO open_collabs (
            creator_id, open_to_collab, my_followers, min_partner_followers,
            languages, topics, platform, niche, min_rate, collab_types,
            open_for_brands, brand_min_rate, guardrails
          )
          VALUES (?, 1, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(creator_id) DO UPDATE SET
            open_to_collab = 1,
            my_followers = excluded.my_followers,
            languages = excluded.languages,
            topics = excluded.topics,
            platform = excluded.platform,
            niche = excluded.niche,
            guardrails = excluded.guardrails
        `).run(
          account.creatorId,
          approxFollowers,
          languages.join(','),
          (niches.length > 0 ? niches : ['Collab']).join(','),
          platforms[0] || 'YouTube',
          niches[0] || 'Creative Media',
          150,
          'co-create,cross-promote',
          300,
          `Style: ${collabStyle} • Goal: ${goals[0] || 'Growth'}`,
        )
      } catch (profileErr) {
        console.warn('[auth] failed to sync profile details/open_collabs on registration:', profileErr)
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
