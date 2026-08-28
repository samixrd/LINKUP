import { Router } from 'express'
import type Database from 'better-sqlite3'
import {
  registerBrandAccount,
  loginBrand,
  resolveBrandSession,
  logoutBrandSession,
  getBrandAccount,
  updateBrandMind,
} from '@linkup/db'
import { listBrandOpenCreators } from '@linkup/db'

export const BRAND_SESSION_COOKIE = 'linkup_brand_session'

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

export function createBrandAuthRouter(db: Database.Database): Router {
  const router = Router()

  // POST /api/brands/register
  router.post('/register', (req, res) => {
    const body = req.body as Record<string, unknown>
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    const { handle, pin, brandName, industry, targetPlatform, collabFormat, budgetTier, guardrails } = body
    try {
      const { account, session } = registerBrandAccount(db, {
        handle: String(handle ?? ''),
        pin: String(pin ?? ''),
        brandName: String(brandName ?? ''),
        industry: String(industry ?? 'Tech & AI'),
        targetPlatform: String(targetPlatform ?? 'Instagram'),
        collabFormat: String(collabFormat ?? 'Dedicated 60s Reel / TikTok'),
        budgetTier: String(budgetTier ?? '$300 - $1,000 (Mid-tier Growth)'),
        guardrails: String(guardrails ?? 'Family-friendly content only'),
      })
      res.cookie(BRAND_SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      res.status(201).json({ account, brandId: session.brandId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already taken')) { res.status(409).json({ error: msg }); return }
      if (msg.includes('must be') || msg.includes('required')) { res.status(400).json({ error: msg }); return }
      throw err
    }
  })

  // POST /api/brands/login
  router.post('/login', (req, res) => {
    const body = req.body as Record<string, unknown>
    const { handle, pin } = body ?? {}
    try {
      const session = loginBrand(db, String(handle ?? ''), String(pin ?? ''))
      res.cookie(BRAND_SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      const account = getBrandAccount(db, session.handle)
      res.json({ handle: session.handle, brandId: session.brandId, brandName: session.brandName, account })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('invalid') || msg.includes('must be')) {
        res.status(401).json({ error: 'invalid handle or pin' })
        return
      }
      throw err
    }
  })

  // POST /api/brands/logout
  router.post('/logout', (req, res) => {
    const token = parseCookies(req)[BRAND_SESSION_COOKIE]
    if (token) logoutBrandSession(db, token)
    res.clearCookie(BRAND_SESSION_COOKIE)
    res.json({ ok: true })
  })

  // GET /api/brands/me
  router.get('/me', (req, res) => {
    const token = parseCookies(req)[BRAND_SESSION_COOKIE]
    const session = token ? resolveBrandSession(db, token) : undefined
    if (!session) { res.status(401).json({ error: 'not signed in' }); return }
    const account = getBrandAccount(db, session.handle)
    res.json({ handle: session.handle, brandId: session.brandId, brandName: session.brandName, account })
  })

  // PUT /api/brands/mind — update brand mind answers
  router.put('/mind', (req, res) => {
    const token = parseCookies(req)[BRAND_SESSION_COOKIE]
    const session = token ? resolveBrandSession(db, token) : undefined
    if (!session) { res.status(401).json({ error: 'not signed in' }); return }
    const body = req.body as Record<string, unknown>
    updateBrandMind(db, session.handle, {
      industry: typeof body.industry === 'string' ? body.industry : undefined,
      targetPlatform: typeof body.targetPlatform === 'string' ? body.targetPlatform : undefined,
      collabFormat: typeof body.collabFormat === 'string' ? body.collabFormat : undefined,
      budgetTier: typeof body.budgetTier === 'string' ? body.budgetTier : undefined,
      guardrails: typeof body.guardrails === 'string' ? body.guardrails : undefined,
    })
    const account = getBrandAccount(db, session.handle)
    res.json({ ok: true, account })
  })

  // POST /api/brands/bulk-dispatch — send proposals to ALL matching open creators
  router.post('/bulk-dispatch', async (req, res) => {
    const token = parseCookies(req)[BRAND_SESSION_COOKIE]
    const session = token ? resolveBrandSession(db, token) : undefined
    if (!session) { res.status(401).json({ error: 'not signed in' }); return }

    const account = getBrandAccount(db, session.handle)
    if (!account) { res.status(404).json({ error: 'brand account not found' }); return }

    const body = req.body as Record<string, unknown>
    const niche = typeof body.niche === 'string' ? body.niche : undefined
    const platform = typeof body.platform === 'string' ? body.platform : undefined
    const minFollowers = typeof body.minFollowers === 'number' ? body.minFollowers : 0
    const customMessage = typeof body.message === 'string' ? body.message.trim() : ''

    // Fetch matching creators
    const creators = listBrandOpenCreators(db, { niche, platform, minFollowers })

    if (creators.length === 0) {
      res.json({ dispatched: 0, skipped: 0, targets: [], message: 'No matching creators found' })
      return
    }

    const { createCollaboration } = await import('@linkup/db')
    const { randomUUID } = await import('node:crypto')
    const dispatched: string[] = []
    const skipped: string[] = []

    for (const creator of creators.slice(0, 20)) {
      try {
        const offerMsg = customMessage ||
          `[BRAND BULK OFFER] ${account.brandName} — a ${account.industry} brand — wants to sponsor a ${account.collabFormat} on ${account.targetPlatform}. Budget: ${account.budgetTier}. Mandatory guardrails: ${account.guardrails}`

        createCollaboration(db, {
          id: `bulk_${session.brandId}_${creator.creatorId}_${Date.now()}`,
          initiatorId: session.brandId,
          targetId: creator.creatorId,
          proposal: offerMsg,
        })
        dispatched.push(creator.creatorId)
      } catch {
        skipped.push(creator.creatorId)
      }
    }
    void randomUUID // imported for potential future use

    res.json({
      dispatched: dispatched.length,
      skipped: skipped.length,
      targets: dispatched,
      message: `Bulk dispatched to ${dispatched.length} creators. ${skipped.length} skipped (already in collab).`,
    })
  })

  return router
}
