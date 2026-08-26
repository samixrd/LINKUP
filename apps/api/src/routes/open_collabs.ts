import { Router } from 'express'
import type Database from 'better-sqlite3'
import {
  createCollaboration,
  createCreatorProfile,
  getCollaboration,
  getCreatorProfile,
  getOpenCollab,
  getProfileDetails,
  listBrandOpenCreators,
  listOpenCollabs,
  findThresholdMatches,
  setOpenCollab,
  seedDemoAccounts,
  stubMindAdapter,
} from '@linkup/db'
import type { MindAdapter } from '@linkup/db'
import { AGREE_THRESHOLD, runNegotiation, signContract } from '../services/negotiation_engine.js'
import { isNonEmptyString } from './creators/shared.js'

/**
 * Open collaborations + autonomous Mind-to-Mind negotiation.
 *
 * - PUT  /api/open-collabs/:creatorId          — publish/update my terms card
 * - GET  /api/open-collabs                     — everyone open (excluding ?exclude=)
 * - GET  /api/open-collabs/:creatorId/matches  — threshold-compatible partners
 * - POST /api/open-collabs/negotiate           — start the Mind-vs-Mind loop
 *        body: { creatorId, targetId }         (creates pending collab, runs loop)
 * - POST /api/open-collabs/find-collab         — one-click autonomous flow
 *        body: { creatorId }                   (auto-publishes card if missing,
 *                                               picks the best open partner, runs loop)
 * - POST /api/open-collabs/:collaborationId/sign
 *        body: { creatorId, accept, reason? }  — both must sign -> accepted
 */

/** Maps an interview audience-size bucket to a follower number for the terms card. */
function followersFromAudienceSize(size: string | null | undefined): number {
  switch (size) {
    case 'Just starting':
      return 100
    case '~1k':
      return 1_000
    case '~10k':
      return 10_000
    case '~100k+':
      return 100_000
    case '~1M+':
      return 1_000_000
    default:
      return 0
  }
}

/** Maps an interview partner-minimum bucket to a follower threshold. */
function minPartnerFromAudienceSize(size: string | null | undefined): number {
  switch (size) {
    case '~1k':
      return 1_000
    case '~10k':
      return 10_000
    case '~100k+':
      return 100_000
    default:
      return 0 // any size
  }
}

/** Maps interview language names to the open-collab language codes. */
function languageCodeFromName(name: string): string {
  const map: Record<string, string> = {
    English: 'en',
    Bangla: 'bn',
    Hindi: 'hi',
    Spanish: 'es',
    Portuguese: 'pt',
    Arabic: 'ar',
    French: 'fr',
  }
  return map[name.trim()] ?? 'en'
}

export function createOpenCollabRouter(
  db: Database.Database,
  adapter: MindAdapter = stubMindAdapter,
): Router {
  const router = Router()

  router.put('/:creatorId', (req, res) => {
    const creatorId = req.params.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId must be a non-empty string' })
      return
    }
    const body = req.body as Record<string, unknown>
    if (typeof body !== 'object' || body === null) {
      res.status(400).json({ error: 'request body must be a JSON object' })
      return
    }
    try {
      const card = setOpenCollab(db, {
        creatorId,
        openToCollab: body.openToCollab === true,
        myFollowers: Number(body.myFollowers ?? 0),
        minPartnerFollowers: Number(body.minPartnerFollowers ?? 0),
        ...(Array.isArray(body.languages) ? { languages: body.languages as string[] } : {}),
        ...(Array.isArray(body.topics) ? { topics: body.topics as string[] } : {}),
        platform: typeof body.platform === 'string' ? body.platform : undefined,
        niche: typeof body.niche === 'string' ? body.niche : undefined,
        minRate: typeof body.minRate === 'number' ? body.minRate : Number(body.minRate ?? 0),
        collabTypes: Array.isArray(body.collabTypes) ? (body.collabTypes as string[]) : undefined,
        startDate: typeof body.startDate === 'string' ? body.startDate : undefined,
        endDate: typeof body.endDate === 'string' ? body.endDate : undefined,
        guardrails: typeof body.guardrails === 'string' ? body.guardrails : undefined,
        openForBrands: body.openForBrands === true,
        brandMinRate: typeof body.brandMinRate === 'number' ? body.brandMinRate : Number(body.brandMinRate ?? 0),
      })
      res.json(card)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) res.status(404).json({ error: message })
      else res.status(400).json({ error: message })
    }
  })

  router.get('/brands/creators', (req, res) => {
    // Ensure demo creators exist in the DB
    if (listBrandOpenCreators(db).length === 0) {
      seedDemoAccounts(db)
    }

    const niche = typeof req.query.niche === 'string' ? req.query.niche : undefined
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined
    const minFollowers = req.query.minFollowers ? Number(req.query.minFollowers) : undefined
    const maxRate = req.query.maxRate ? Number(req.query.maxRate) : undefined
    const language = typeof req.query.language === 'string' ? req.query.language : undefined

    const creators = listBrandOpenCreators(db, {
      niche,
      platform,
      minFollowers,
      maxRate,
      language,
    })
    res.json({ creators, total: creators.length })
  })

  router.get('/', (req, res) => {
    const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : ''
    res.json({ open: listOpenCollabs(db, exclude) })
  })

  router.get('/:creatorId', (req, res) => {
    const card = getOpenCollab(db, req.params.creatorId)
    if (card === undefined) {
      res.status(404).json({ error: `no open-collab card for ${req.params.creatorId}` })
      return
    }
    res.json(card)
  })

  router.get('/:creatorId/matches', (req, res) => {
    const matches = findThresholdMatches(db, req.params.creatorId)
    res.json({
      matches: matches.map((m) => ({
        them: m.them,
        sharedLanguages: m.sharedLanguages,
        combinedReach: m.them.myFollowers + m.me.myFollowers,
      })),
      total: matches.length,
    })
  })

  router.post('/negotiate', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>
      const creatorId = body.creatorId
      const targetId = body.targetId
      const proposalText =
        typeof body.proposal === 'string' && body.proposal.trim() !== ''
          ? body.proposal.trim()
          : 'Cross-promotion collaboration tailored to both creators.'

      if (!isNonEmptyString(creatorId) || !isNonEmptyString(targetId)) {
        res.status(400).json({ error: 'creatorId and targetId are required' })
        return
      }
      if (creatorId === targetId) {
        res.status(400).json({ error: 'cannot negotiate with yourself' })
        return
      }

      // Auto-seed if target creator is a demo account and not in DB yet
      if (getCreatorProfile(db, targetId) === undefined) {
        seedDemoAccounts(db)
      }

      // Auto-register Brand Sponsor profile if creatorId is a Brand
      if (getCreatorProfile(db, creatorId) === undefined) {
        if (creatorId.startsWith('brand_') || body.brandName) {
          const rawBrandName = typeof body.brandName === 'string' && body.brandName.trim()
            ? body.brandName.trim()
            : creatorId.replace(/^brand_/, '').replace(/_/g, ' ') || 'Brand Partner'
          const bDisplayName = rawBrandName.replace(/\b\w/g, (c) => c.toUpperCase())
          createCreatorProfile(db, {
            creatorId,
            displayName: bDisplayName,
            bio: typeof body.brandBio === 'string' && body.brandBio.trim() ? body.brandBio.trim() : `Official Brand Sponsor account for ${bDisplayName}`,
          })
        } else {
          seedDemoAccounts(db)
        }
      }

      if (
        getCreatorProfile(db, creatorId) === undefined ||
        getCreatorProfile(db, targetId) === undefined
      ) {
        res.status(404).json({ error: 'creator not found' })
        return
      }

      // Auto-create/publish cards if missing for smooth demo execution
      let mine = getOpenCollab(db, creatorId)
      if (mine === undefined) {
        if (creatorId.startsWith('brand_')) {
          mine = setOpenCollab(db, {
            creatorId,
            openToCollab: true,
            myFollowers: 1_000_000,
            minPartnerFollowers: 0,
            languages: ['en', 'bn'],
          })
        } else {
          const details = getProfileDetails(db, creatorId)
          mine = setOpenCollab(db, {
            creatorId,
            openToCollab: true,
            myFollowers: followersFromAudienceSize(details?.audienceSize) || 1000,
            minPartnerFollowers: 0,
            languages: (details?.languages ?? []).map(languageCodeFromName),
          })
        }
      }
      let theirs = getOpenCollab(db, targetId)
      if (theirs === undefined) {
        const details = getProfileDetails(db, targetId)
        theirs = setOpenCollab(db, {
          creatorId: targetId,
          openToCollab: true,
          myFollowers: followersFromAudienceSize(details?.audienceSize) || 50000,
          minPartnerFollowers: 0,
          languages: (details?.languages ?? []).map(languageCodeFromName),
        })
      }

      if (
        !creatorId.startsWith('brand_') &&
        ((theirs.minPartnerFollowers > 0 && mine.myFollowers < theirs.minPartnerFollowers) ||
          (mine.minPartnerFollowers > 0 && theirs.myFollowers < mine.minPartnerFollowers))
      ) {
        res.status(409).json({
          error:
            'threshold mismatch: one side requires more followers than the other currently has',
        })
        return
      }

      const collab = createCollaboration(db, {
        id: `neg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        initiatorId: creatorId,
        targetId,
        proposal: proposalText,
      })
      const state = await runNegotiation({ db, adapter }, collab.id)
      const targetProfile = getCreatorProfile(db, targetId)
      res.status(201).json({
        collaborationId: collab.id,
        targetId,
        targetName: targetProfile?.displayName ?? targetId,
        status: state.status,
        rounds: state.rounds,
        score: state.score,
        finalPlan: state.finalPlan,
        readyForSigning: state.score >= AGREE_THRESHOLD && state.finalPlan !== undefined,
      })
    } catch (err) {
      console.error('OPEN COLLABS NEGOTIATE ERROR:', err)
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('Minds adapter not configured')) {
        res.status(503).json({ error: message })
        return
      }
      res.status(500).json({ error: message || 'negotiation failed' })
    }
  })

  router.post('/find-collab', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const creatorId = body.creatorId
    if (!isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'creatorId is required' })
      return
    }
    if (getCreatorProfile(db, creatorId) === undefined) {
      res.status(404).json({ error: `creator not found: ${creatorId}` })
      return
    }

    try {
      // 1) Ensure there are demo creators in the database
      const existingOpen = listOpenCollabs(db, creatorId)
      if (existingOpen.length < 5) {
        seedDemoAccounts(db)
      }

      // 2) Auto-publish my terms card if missing, derived from the profile —
      //    one click, no forms. Existing cards are left untouched.
      const existing = getOpenCollab(db, creatorId)
      if (existing === undefined) {
        const details = getProfileDetails(db, creatorId)
        const myFollowers = followersFromAudienceSize(details?.audienceSize)
        const minPartnerFollowers = minPartnerFromAudienceSize(details?.partnerMinAudience)
        const languages = (details?.languages ?? []).map(languageCodeFromName)
        setOpenCollab(db, {
          creatorId,
          openToCollab: true,
          myFollowers,
          minPartnerFollowers,
          languages: languages.length > 0 ? languages : ['en'],
        })
      }

      // 3) Pick the best open partner. Re-rank for FIT: most shared languages
      //    first, then closest audience size.
      const matches = findThresholdMatches(db, creatorId)
      const myFollowers = getOpenCollab(db, creatorId)?.myFollowers ?? 0
      const ranked = [...matches].sort((a, b) => {
        const langDiff = (b.sharedLanguages.length - a.sharedLanguages.length)
        if (langDiff !== 0) return langDiff
        const reachDiffA = Math.abs(a.them.myFollowers - myFollowers)
        const reachDiffB = Math.abs(b.them.myFollowers - myFollowers)
        return reachDiffA - reachDiffB
      })

      let targetId = ranked[0]?.them.creatorId

      // Robust fallback if no match found
      if (!targetId) {
        const allOpen = listOpenCollabs(db, creatorId)
        if (allOpen.length > 0) {
          const sorted = [...allOpen].sort(
            (a, b) => Math.abs(a.myFollowers - myFollowers) - Math.abs(b.myFollowers - myFollowers),
          )
          targetId = sorted[0]?.creatorId
        }
      }

      // If database was somehow completely empty, seed right now and pick first partner
      if (!targetId) {
        seedDemoAccounts(db)
        const freshList = listOpenCollabs(db, creatorId)
        targetId = freshList[0]?.creatorId
      }

      if (!targetId) {
        res.status(409).json({ error: 'no compatible open creators right now — publish Go Open terms or try later' })
        return
      }

      // 4) Create the pending collaboration and let both Minds negotiate.
      const targetProfile = getCreatorProfile(db, targetId)
      const myProfile = getCreatorProfile(db, creatorId)
      const collab = createCollaboration(db, {
        id: `neg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        initiatorId: creatorId,
        targetId,
        proposal: `${myProfile?.displayName ?? creatorId} x ${targetProfile?.displayName ?? targetId} — cross-promotion collab, terms worked out by both Minds.`,
      })
      const state = await runNegotiation({ db, adapter }, collab.id)
      res.status(201).json({
        collaborationId: collab.id,
        targetId,
        targetName: targetProfile?.displayName ?? targetId,
        status: state.status,
        rounds: state.rounds,
        score: state.score,
        finalPlan: state.finalPlan,
        readyForSigning: state.score >= AGREE_THRESHOLD && state.finalPlan !== undefined,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('Minds adapter not configured')) {
        res.status(503).json({ error: message })
        return
      }
      res.status(500).json({ error: message || 'negotiation failed' })
    }
  })

  router.post('/:collaborationId/sign', (req, res) => {
    const collaborationId = req.params.collaborationId
    const body = req.body as Record<string, unknown>
    const creatorId = body.creatorId
    if (!isNonEmptyString(collaborationId) || !isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'collaborationId and creatorId are required' })
      return
    }
    if (typeof body.accept !== 'boolean') {
      res.status(400).json({ error: 'accept must be true or false' })
      return
    }
    try {
      const result = signContract(
        db,
        collaborationId,
        creatorId,
        body.accept,
        typeof body.reason === 'string' ? body.reason.slice(0, 500) : '',
        typeof body.score === 'number' ? Math.round(body.score) : undefined,
      )
      const collab = getCollaboration(db, collaborationId)
      // When both sign and collaboration becomes accepted, auto-lock escrow
      if (result.signed) {
        import('@linkup/db').then(({ lockCollabEscrow }) => {
          try {
            lockCollabEscrow(db, collaborationId, 500, 'USD')
          } catch {
            /* ignore */
          }
        })
      }
      res.json({ ...result, collaborationStatus: collab?.status })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) res.status(404).json({ error: message })
      else if (message.includes('not a participant')) res.status(403).json({ error: message })
      else res.status(500).json({ error: 'signing failed' })
    }
  })

  // --- Escrow & Deliverables demo endpoints ---

  router.get('/:collaborationId/escrow', async (req, res) => {
    const { getCollabEscrow, listCollabSubmissions } = await import('@linkup/db')
    const collaborationId = req.params.collaborationId
    const escrow = getCollabEscrow(db, collaborationId)
    const submissions = listCollabSubmissions(db, collaborationId)
    res.json({ escrow, submissions })
  })

  router.post('/:collaborationId/submit-deliverable', async (req, res) => {
    const { submitCollabDeliverable } = await import('@linkup/db')
    const collaborationId = req.params.collaborationId
    const body = req.body as Record<string, unknown>
    const creatorId = body.creatorId
    const deliverableUrl = typeof body.deliverableUrl === 'string' ? body.deliverableUrl : ''
    const notes = typeof body.notes === 'string' ? body.notes : ''

    if (!isNonEmptyString(collaborationId) || !isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'collaborationId and creatorId are required' })
      return
    }
    if (!deliverableUrl.trim()) {
      res.status(400).json({ error: 'deliverableUrl is required' })
      return
    }

    try {
      const result = submitCollabDeliverable(db, collaborationId, creatorId, deliverableUrl.trim(), notes)
      res.status(201).json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) res.status(404).json({ error: message })
      else if (message.includes('not a participant')) res.status(403).json({ error: message })
      else res.status(400).json({ error: message })
    }
  })

  router.post('/:collaborationId/dispute', async (req, res) => {
    const { flagCollabDispute } = await import('@linkup/db')
    const collaborationId = req.params.collaborationId
    const body = req.body as Record<string, unknown>
    const creatorId = body.creatorId
    const reason = typeof body.reason === 'string' ? body.reason : 'Deliverables disputed by creator'

    if (!isNonEmptyString(collaborationId) || !isNonEmptyString(creatorId)) {
      res.status(400).json({ error: 'collaborationId and creatorId are required' })
      return
    }

    try {
      const escrow = flagCollabDispute(db, collaborationId, creatorId, reason)
      res.json({ escrow })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) res.status(404).json({ error: message })
      else if (message.includes('not a participant')) res.status(403).json({ error: message })
      else res.status(400).json({ error: message })
    }
  })

  return router
}
