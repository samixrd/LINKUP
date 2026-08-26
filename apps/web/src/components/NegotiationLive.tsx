import { useEffect, useRef, useState } from 'react'
import { getStoredCreatorId } from '../creator'
import EscrowModal from './EscrowModal'

/**
 * Live negotiation viewer:
 * - Shows real-time AI-to-AI negotiation transcript.
 * - Stage progression: Draft -> Countering -> Agreed / Paused.
 * - "Take Over" action allowing human creator to intervene and chat directly.
 * - Agreement signing & direct transition into Escrow Flow.
 */

interface Round {
  round: number
  authorId: string
  message: string
}

interface NegotiateResponse {
  collaborationId: string
  targetId?: string
  targetName?: string
  status: 'negotiating' | 'ready' | 'signed' | 'failed' | 'stalled'
  rounds: Round[]
  score: number
  finalPlan?: string
  readyForSigning: boolean
}

interface Props {
  targetId?: string
  targetName?: string
  onClose: () => void
  onCompleted?: () => void
}

function shortName(id: string): string {
  if (id === (getStoredCreatorId() ?? '')) return 'Your Mind (AI)'
  if (id === 'human_user') return 'You (Human Override)'
  return id.startsWith('u_') ? `${id.slice(2)}'s Mind (AI)` : `${id}'s Mind (AI)`
}

export default function NegotiationLive({
  targetId: presetTarget,
  targetName: presetName,
  onClose,
  onCompleted,
}: Props) {
  const creatorId = getStoredCreatorId()
  const [rounds, setRounds] = useState<Round[]>([])
  const [status, setStatus] = useState<'running' | 'ready' | 'failed'>('running')
  const [finalPlan, setFinalPlan] = useState('')
  const [score, setScore] = useState(0)
  const [collaborationId, setCollaborationId] = useState('')
  const [targetName, setTargetName] = useState(presetName ?? 'Creator')
  const [signed, setSigned] = useState(false)
  const [error, setError] = useState('')
  const [takingOver, setTakingOver] = useState(false)
  const [takeoverMessage, setTakeoverMessage] = useState('')
  const [showEscrowModal, setShowEscrowModal] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!creatorId) return
    let cancelled = false

    async function run() {
      try {
        const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
        const path = presetTarget ? `${apiBase}/api/open-collabs/negotiate` : `${apiBase}/api/open-collabs/find-collab`
        const payload = presetTarget ? { creatorId, targetId: presetTarget } : { creatorId }
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Negotiation failed (${res.status})`)
        }
        const body = (await res.json()) as NegotiateResponse
        if (cancelled) return
        if (body.targetName) setTargetName(body.targetName)
        
        // Reveal rounds progressively for drama
        for (let i = 0; i < body.rounds.length; i++) {
          await new Promise((r) => setTimeout(r, 800))
          if (cancelled) return
          setRounds(body.rounds.slice(0, i + 1))
        }
        setCollaborationId(body.collaborationId)
        setScore(body.score)
        setStatus(body.status === 'ready' ? 'ready' : 'failed')
        if (body.finalPlan) setFinalPlan(body.finalPlan)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Negotiation failed')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [creatorId, presetTarget])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [rounds])

  async function handleTakeoverSend(e: React.FormEvent) {
    e.preventDefault()
    if (!takeoverMessage.trim()) return
    const msg = takeoverMessage.trim()
    setTakeoverMessage('')
    setRounds((prev) => [
      ...prev,
      { round: prev.length + 1, authorId: 'human_user', message: msg },
    ])
    // Simulate partner response to human override
    setTimeout(() => {
      setRounds((prev) => [
        ...prev,
        {
          round: prev.length + 1,
          authorId: presetTarget || 'partner_mind',
          message: `[AI Partner]: Acknowledged your custom terms: "${msg}". Updating agreement accordingly.`,
        },
      ])
      setStatus('ready')
      setFinalPlan(`Adjusted Plan (Human Override): ${msg} — Cross-promoted on both channels within 2 weeks.`)
      setScore(98)
    }, 1000)
  }

  async function sign(accept: boolean) {
    try {
      const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
      const res = await fetch(`${apiBase}/api/open-collabs/${collaborationId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, accept }),
      })
      if (!res.ok) throw new Error('Signing failed')
      const body = (await res.json()) as { status: string; signed: boolean }
      if (body.status === 'rejected') {
        setError('You rejected the deal.')
      } else {
        setSigned(true)
        if (onCompleted) onCompleted()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed')
    }
  }

  const dealStage =
    status === 'running'
      ? rounds.length > 2
        ? 'Countering'
        : 'Draft'
      : status === 'ready'
        ? 'Agreed'
        : 'Paused'

  return (
    <section className="neg-live card" aria-label="Live negotiation">
      <header className="neg-live-header">
        <div>
          <div className="neg-stage-indicator">
            <span className="card-kicker">N°006 — Autonomous Negotiation</span>
            <span className={`badge stage-badge stage-badge--${dealStage.toLowerCase()}`}>
              Deal Stage: {dealStage}
            </span>
          </div>
          <h3 className="card-title">
            Your Mind × {targetName}
          </h3>
        </div>
        <div className="neg-header-actions">
          {!takingOver && status === 'running' && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setTakingOver(true)}
            >
              Take Over ✋
            </button>
          )}
          <span className={`neg-badge ${status}`}>
            {status === 'running' ? '● AI negotiating…' : status === 'ready' ? '✓ Agreed' : '✕ Stalled'}
          </span>
        </div>
      </header>

      {/* Guardrails summary */}
      <div className="neg-guardrails-bar">
        <span className="guardrail-label">🛡️ Active Guardrails:</span>
        <span className="guardrail-text">
          Language parity required • Minimum budget respected • Automated deliverable verification
        </span>
      </div>

      <div className="neg-transcript" ref={listRef} role="log" aria-live="polite">
        {rounds.length === 0 && status === 'running' && (
          <p className="neg-thinking">Connecting Minds and reviewing Go Open criteria…</p>
        )}
        {rounds.map((r) => (
          <div key={r.round} className={`neg-turn ${r.authorId === 'human_user' ? 'neg-turn--human' : ''}`}>
            <span className="neg-speaker">{shortName(r.authorId)}</span>
            <p className="neg-message">{r.message}</p>
          </div>
        ))}
        {status !== 'running' && score > 0 && (
          <p className="neg-score">Agreement score: {score}/100</p>
        )}
      </div>

      {/* Human Takeover Input */}
      {takingOver && (
        <form className="takeover-form" onSubmit={handleTakeoverSend}>
          <div className="takeover-banner">
            <span>✋ Human Takeover Mode active. Send message directly:</span>
            <button type="button" className="btn-text" onClick={() => setTakingOver(false)}>
              Hand back to Mind
            </button>
          </div>
          <div className="takeover-input-row">
            <input
              type="text"
              className="field-input"
              placeholder="Type custom terms or counter-proposal..."
              value={takeoverMessage}
              onChange={(e) => setTakeoverMessage(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn btn-primary">
              Send Direct
            </button>
          </div>
        </form>
      )}

      {status === 'ready' && finalPlan !== '' && (
        <div className="neg-plan">
          <p className="neg-plan-kicker">Agreed Deal Contract</p>
          <p className="neg-plan-text">{finalPlan}</p>
        </div>
      )}

      {error !== '' && <p className="form-error">{error}</p>}

      <div className="btn-stack" style={{ marginTop: '1rem' }}>
        {status === 'ready' && !signed && !error.includes('rejected') && (
          <>
            <button className="btn btn-primary btn-block" onClick={() => sign(true)}>
              Sign Final Agreement ✍
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => sign(false)}>
              Reject Deal
            </button>
          </>
        )}

        {signed && (
          <div className="signed-container">
            <p className="neg-signed">
              ✓ Signed! Both creators have locked in terms. Funds are moving to Mind-managed escrow.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => setShowEscrowModal(true)}
            >
              Open Escrow & Deliverables Vault 🔒
            </button>
          </div>
        )}

        <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>
          Close Transcript
        </button>
      </div>

      {showEscrowModal && collaborationId && (
        <EscrowModal
          collaborationId={collaborationId}
          otherCreatorName={targetName}
          onClose={() => setShowEscrowModal(false)}
        />
      )}
    </section>
  )
}
