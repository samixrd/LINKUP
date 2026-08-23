import { useEffect, useRef, useState } from 'react'
import { getStoredCreatorId } from '../creator'

/**
 * Live negotiation viewer: starts a Mind-vs-Mind negotiation and streams the
 * transcript round by round as it happens. The audience watches two Minds
 * argue, resolve conflicts (language, format), and land on an AGREE plan.
 */

interface Round {
  round: number
  authorId: string
  message: string
}

interface NegotiateResponse {
  collaborationId: string
  status: 'negotiating' | 'ready' | 'signed' | 'failed' | 'stalled'
  rounds: Round[]
  score: number
  finalPlan?: string
  readyForSigning: boolean
}

interface Props {
  targetId: string
  targetName: string
  onClose: () => void
}

/** Display name lookup is best-effort; falls back to the id. */
function shortName(id: string): string {
  if (id === (getStoredCreatorId() ?? '')) return 'Your Mind'
  return id.startsWith('u_') ? id.slice(2) : id
}

export default function NegotiationLive({ targetId, targetName, onClose }: Props) {
  const creatorId = getStoredCreatorId()
  const [rounds, setRounds] = useState<Round[]>([])
  const [status, setStatus] = useState<'running' | 'ready' | 'failed'>('running')
  const [finalPlan, setFinalPlan] = useState('')
  const [score, setScore] = useState(0)
  const [collaborationId, setCollaborationId] = useState('')
  const [signed, setSigned] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!creatorId) return
    let cancelled = false

    async function run() {
      try {
        const res = await fetch('/api/open-collabs/negotiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorId, targetId }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Negotiation failed (${res.status})`)
        }
        const body = (await res.json()) as NegotiateResponse
        if (cancelled) return
        // Reveal rounds one by one for drama — each ~900ms apart.
        for (let i = 0; i < body.rounds.length; i++) {
          await new Promise((r) => setTimeout(r, 900))
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
  }, [creatorId, targetId])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [rounds])

  async function sign(accept: boolean) {
    try {
      const res = await fetch(`/api/open-collabs/${collaborationId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, accept }),
      })
      if (!res.ok) throw new Error('Signing failed')
      const body = (await res.json()) as { status: string }
      if (body.status === 'rejected') {
        setError('You rejected the deal.')
      } else {
        setSigned(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed')
    }
  }

  return (
    <section className="neg-live" aria-label="Live negotiation">
      <header className="neg-live-header">
        <div>
          <p className="card-kicker">N°006 — Live negotiation</p>
          <h3 className="card-title">
            Your Mind × {targetName}
          </h3>
        </div>
        <span className={`neg-badge ${status}`}>
          {status === 'running' ? '● negotiating…' : status === 'ready' ? '✓ deal reached' : '✕ stalled'}
        </span>
      </header>

      <div className="neg-transcript" ref={listRef} role="log" aria-live="polite">
        {rounds.length === 0 && status === 'running' && (
          <p className="neg-thinking">Minds are connecting…</p>
        )}
        {rounds.map((r) => (
          <div key={r.round} className="neg-turn">
            <span className="neg-speaker">{shortName(r.authorId)}</span>
            <p className="neg-message">{r.message}</p>
          </div>
        ))}
        {status !== 'running' && score > 0 && (
          <p className="neg-score">Agreement score: {score}/100</p>
        )}
      </div>

      {status === 'ready' && finalPlan !== '' && (
        <div className="neg-plan">
          <p className="neg-plan-kicker">Final plan</p>
          <p className="neg-plan-text">{finalPlan}</p>
        </div>
      )}

      {error !== '' && <p className="form-error">{error}</p>}

      <div className="btn-stack">
        {status === 'ready' && !signed && !error.includes('rejected') && (
          <>
            <button className="btn btn-block" onClick={() => sign(true)}>
              Sign the contract ✍
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => sign(false)}>
              Reject deal
            </button>
          </>
        )}
        {signed && (
          <p className="neg-signed">
            ✓ Signed! Waiting for {targetName}'s signature. When both sides sign, the collab goes
            live and your Mind schedules the follow-up automatically.
          </p>
        )}
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  )
}
