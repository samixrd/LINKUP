import { useEffect, useState } from 'react'
import {
  ApiError,
  counterCollaboration,
  executeMindCounter,
  getMindDecision,
  getNegotiationHistory,
  previewMindCounter,
  updateCollaborationStatus,
  type Collaboration,
  type CollaborationProposal,
  type MindNegotiationDecision,
  type MindNegotiationPreview,
} from '../api'
import EscrowModal from './EscrowModal'

interface CollaborationNegotiationPanelProps {
  creatorId: string
  collaborations: Collaboration[]
  onChanged: () => void
}

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503 && err.message.toLowerCase().includes('not configured')) {
      return 'Minds is not connected yet.'
    }
    if (err.status === 404) return 'Collaboration not found or you are not a participant.'
    if (err.status === 400) return err.message
    if (err.status === 500) return 'Something went wrong. Please try again.'
    return err.message
  }
  return 'Could not reach the LINKUP API. Please try again.'
}

export default function CollaborationNegotiationPanel({
  creatorId,
  collaborations,
  onChanged,
}: CollaborationNegotiationPanelProps) {
  if (collaborations.length === 0) {
    return (
      <section className="collab-negotiation" aria-label="Collaborations">
        <p className="collab-panel-kicker">N°005 — Negotiation</p>
        <h2 className="collab-panel-title">Collaborations</h2>
        <p className="collab-panel-note">No collaborations yet.</p>
      </section>
    )
  }

  return (
    <section className="collab-negotiation" aria-label="Collaborations">
      <p className="collab-panel-kicker">N°005 — Negotiation</p>
      <h2 className="collab-panel-title">Collaborations</h2>
      <ul className="collab-list" aria-label="Collaboration list">
        {collaborations.map((collab) => (
          <CollaborationRow key={collab.id} creatorId={creatorId} collab={collab} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  )
}

function CollaborationRow({
  creatorId,
  collab,
  onChanged,
}: {
  creatorId: string
  collab: Collaboration
  onChanged: () => void
}) {
  const [counterText, setCounterText] = useState('')
  const [preview, setPreview] = useState<MindNegotiationPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState('')
  const [history, setHistory] = useState<CollaborationProposal[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [decision, setDecision] = useState<MindNegotiationDecision | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  const busy = loading || previewing || executing || deciding
  const isActive = collab.status === 'pending' || collab.status === 'countered'
  const isTerminal = collab.status === 'accepted' || collab.status === 'rejected' || collab.status === 'cancelled'
  const currentProposal = collab.counterProposal ?? collab.proposal
  const showCounter = collab.counterProposal !== null && collab.counterProposal !== undefined

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading reset for new collaboration
    setHistoryLoading(true)
    getNegotiationHistory(creatorId, collab.id)
      .then((res) => {
        if (!cancelled) setHistory(res.proposals ?? res.history ?? [])
      })
      .catch(() => {
        if (!cancelled) setHistory(null)
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [creatorId, collab.id, collab.updatedAt])

  async function handleAccept() {
    if (busy) return
    setError('')
    setAction('accept')
    setLoading(true)
    try {
      await updateCollaborationStatus(creatorId, collab.id, 'accepted')
      onChanged()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
      setAction('')
    }
  }

  async function handleReject() {
    if (busy) return
    setError('')
    setAction('reject')
    setLoading(true)
    try {
      await updateCollaborationStatus(creatorId, collab.id, 'rejected')
      onChanged()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
      setAction('')
    }
  }

  async function handleCounter() {
    if (busy) return
    const trimmed = counterText.trim()
    if (trimmed === '') {
      setError('counterProposal must be a non-empty string')
      return
    }
    setError('')
    setAction('counter')
    setLoading(true)
    try {
      await counterCollaboration(creatorId, collab.id, trimmed)
      setCounterText('')
      setPreview(null)
      onChanged()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
      setAction('')
    }
  }

  async function handlePreviewMind() {
    if (busy) return
    setError('')
    setPreview(null)
    setPreviewing(true)
    try {
      const res = await previewMindCounter(creatorId, collab.id)
      setPreview(res.preview)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleExecuteMind() {
    if (busy || !preview) return
    setError('')
    setExecuting(true)
    try {
      await executeMindCounter(creatorId, collab.id)
      setPreview(null)
      onChanged()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setExecuting(false)
    }
  }

  async function handleAskDecision() {
    if (busy) return
    setDecisionError('')
    setDecision(null)
    setDeciding(true)
    try {
      const res = await getMindDecision(creatorId, collab.id)
      setDecision(res.decision)
    } catch (err) {
      setDecisionError(friendlyError(err))
    } finally {
      setDeciding(false)
    }
  }

  async function handleExecuteDecision() {
    if (busy || !decision) return
    setError('')
    setDecisionError('')
    if (decision.action === 'accept') {
      await handleAccept()
    } else if (decision.action === 'reject') {
      await handleReject()
    } else if (decision.action === 'counter' && decision.counterProposal) {
      setAction('counter')
      setLoading(true)
      try {
        await counterCollaboration(creatorId, collab.id, decision.counterProposal)
        setCounterText('')
        setPreview(null)
        onChanged()
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setLoading(false)
        setAction('')
      }
    }
  }

  const [showEscrow, setShowEscrow] = useState(false)

  return (
    <li className="collab-row" aria-label={`Collaboration ${collab.id}`}>
      <div className="collab-row-header">
        <span className="collab-row-id">{collab.id}</span>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-sm btn-escrow-open"
            style={{ padding: '0.2rem 0.6rem', fontSize: '0.72rem', borderColor: 'var(--ink)', background: 'transparent' }}
            onClick={() => setShowEscrow(true)}
          >
            🔒 Escrow & Deliverables
          </button>
          <span className="badge">{collab.status}</span>
        </div>
      </div>

      {showEscrow && (
        <EscrowModal
          collaborationId={collab.id}
          creatorId={creatorId}
          onClose={() => setShowEscrow(false)}
        />
      )}
      <p className="collab-row-participants">
        {collab.initiatorId} → {collab.targetId} {collab.proposedBy ? <span>· proposed by {collab.proposedBy}</span> : null}
      </p>
      <div className="collab-row-proposal">
        <p className="collab-row-label">Original proposal:</p>
        <p className="collab-proposal">{collab.proposal}</p>
      </div>
      {showCounter ? (
        <div className="collab-row-counter">
          <p className="collab-row-label">Counter-proposal (by {collab.proposedBy}):</p>
          <p className="collab-proposal collab-proposal--counter">{collab.counterProposal}</p>
        </div>
      ) : null}
      <div className="collab-row-current">
        <p className="collab-row-label">Current proposal:</p>
        <p className="collab-proposal collab-proposal--current">{currentProposal}</p>
      </div>

      {historyLoading ? (
        <p className="collab-history-loading" aria-label="Loading history">
          Loading history…
        </p>
      ) : history && history.length > 0 ? (
        <div className="collab-timeline" aria-label="Negotiation timeline">
          <p className="collab-row-label">Negotiation timeline ({history.length} proposals):</p>
          <ol className="collab-history" aria-label="Negotiation history">
            {history.map((p) => (
              <li key={p.id} className="collab-history-item">
                <span className="collab-history-seq">#{p.seq}</span> by <strong>{p.authorId}</strong>: {p.proposal}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="collab-decision-section">
        <button
          type="button"
          className="btn collab-ask-mind-btn"
          onClick={() => void handleAskDecision()}
          disabled={busy}
          aria-label={`Ask Mind for ${collab.id}`}
        >
          {deciding ? 'Asking Mind…' : 'Ask Mind'}
        </button>
        {decisionError && (
          <p className="form-error" role="alert">
            {decisionError}
          </p>
        )}
        {decision && (
          <div className="collab-decision" aria-label="Mind decision">
            <p className="collab-decision-recommendation">
              Recommendation: <strong>{decision.action}</strong>
            </p>
            <p className="collab-decision-reasoning">Reasoning: {decision.reasoning}</p>
            {decision.counterProposal && (
              <p className="collab-decision-counter">Proposed counter: {decision.counterProposal}</p>
            )}
            <div className="mind-save-actions">
              {decision.action === 'accept' && (
                <button
                  type="button"
                  className="btn collab-execute-accept-btn"
                  onClick={() => void handleExecuteDecision()}
                  disabled={busy}
                  aria-label={`Execute accept for ${collab.id}`}
                >
                  Execute accept
                </button>
              )}
              {decision.action === 'reject' && (
                <button
                  type="button"
                  className="btn collab-execute-reject-btn"
                  onClick={() => void handleExecuteDecision()}
                  disabled={busy}
                  aria-label={`Execute reject for ${collab.id}`}
                >
                  Execute reject
                </button>
              )}
              {decision.action === 'counter' && decision.counterProposal && (
                <button
                  type="button"
                  className="btn collab-execute-counter-btn"
                  onClick={() => void handleExecuteDecision()}
                  disabled={busy}
                  aria-label={`Execute counter for ${collab.id}`}
                >
                  Send Mind&apos;s counter
                </button>
              )}
              <button type="button" className="btn" onClick={() => setDecision(null)} disabled={busy}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {isActive && !isTerminal && (
        <div className="collab-row-actions">
          <button
            type="button"
            className="btn collab-accept-btn"
            onClick={() => void handleAccept()}
            disabled={busy}
            aria-label={`Accept ${collab.id}`}
          >
            {loading && action === 'accept' ? 'Accepting…' : 'Accept'}
          </button>
          <button
            type="button"
            className="btn collab-reject-btn"
            onClick={() => void handleReject()}
            disabled={busy}
            aria-label={`Reject ${collab.id}`}
          >
            {loading && action === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      )}

      {isActive && (
        <div className="collab-counter-section">
          <label className="field">
            <span className="field-label">Counter-proposal</span>
            <textarea
              className="field-input"
              value={counterText}
              onChange={(e) => setCounterText(e.target.value)}
              rows={2}
              placeholder="Revise the proposal…"
              disabled={busy}
              aria-label={`Counter proposal for ${collab.id}`}
            />
          </label>
          <div className="mind-save-actions">
            <button
              type="button"
              className="btn collab-counter-btn"
              onClick={() => void handleCounter()}
              disabled={busy || counterText.trim() === ''}
              aria-label={`Submit counter for ${collab.id}`}
            >
              {loading && action === 'counter' ? 'Submitting…' : 'Submit counter'}
            </button>
            <button
              type="button"
              className="btn collab-preview-mind-btn"
              onClick={() => void handlePreviewMind()}
              disabled={busy}
              aria-label={`Draft counter with Mind for ${collab.id}`}
            >
              {previewing ? 'Drafting…' : 'Draft with Mind'}
            </button>
          </div>
          {preview && (
            <div className="collab-preview" aria-label="Mind counter preview">
              <p className="collab-proposal">{preview.proposal}</p>
              <div className="mind-save-actions">
                <button
                  type="button"
                  className="btn collab-confirm-btn"
                  onClick={() => void handleExecuteMind()}
                  disabled={busy}
                  aria-label={`Confirm Mind counter for ${collab.id}`}
                >
                  {executing ? 'Submitting…' : 'Confirm & send counter'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPreview(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}
