import { Router } from 'express'
import type Database from 'better-sqlite3'
import {
  createCollaboration,
  getCollaboration,
  getCreatorProfile,
  getOpenCollab,
  listOpenCollabs,
  findThresholdMatches,
  setOpenCollab,
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
 * - POST /api/open-collabs/:collaborationId/sign
 *        body: { creatorId, accept, reason? }  — both must sign -> accepted
 */
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
      })
      res.json(card)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) res.status(404).json({ error: message })
      else res.status(400).json({ error: message })
    }
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
    if (
      getCreatorProfile(db, creatorId) === undefined ||
      getCreatorProfile(db, targetId) === undefined
    ) {
      res.status(404).json({ error: 'creator not found' })
      return
    }

    // Threshold gate before any cognition is spent.
    const mine = getOpenCollab(db, creatorId)
    const theirs = getOpenCollab(db, targetId)
    if (mine === undefined || theirs === undefined || !mine.openToCollab || !theirs.openToCollab) {
      res.status(409).json({ error: 'both creators need an open-to-collab card first' })
      return
    }
    if (
      mine.myFollowers < theirs.minPartnerFollowers ||
      theirs.myFollowers < mine.minPartnerFollowers
    ) {
      res.status(409).json({
        error:
          'threshold mismatch: one side requires more followers than the other currently has',
      })
      return
    }

    try {
      const collab = createCollaboration(db, {
        id: `neg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        initiatorId: creatorId,
        targetId,
        proposal: proposalText,
      })
      const state = await runNegotiation({ db, adapter }, collab.id)
      res.status(201).json({
        collaborationId: collab.id,
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
      res.status(500).json({ error: 'negotiation failed' })
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
      res.json({ ...result, collaborationStatus: collab?.status })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) res.status(404).json({ error: message })
      else if (message.includes('not a participant')) res.status(403).json({ error: message })
      else res.status(500).json({ error: 'signing failed' })
    }
  })

  return router
}
