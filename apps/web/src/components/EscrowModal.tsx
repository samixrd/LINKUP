import { useEffect, useState } from 'react'
import { getStoredCreatorId } from '../creator'

export interface EscrowState {
  collaborationId: string
  amount: number
  currency: string
  status: 'locked' | 'submitted' | 'released' | 'disputed'
  disputeReason?: string
  createdAt: string
  updatedAt: string
}

export interface Submission {
  id: string
  collaborationId: string
  creatorId: string
  deliverableUrl: string
  notes: string
  submittedAt: string
}

interface Props {
  collaborationId: string
  otherCreatorName?: string
  onClose: () => void
  onUpdated?: () => void
}

export default function EscrowModal({
  collaborationId,
  otherCreatorName = 'Creator',
  onClose,
  onUpdated,
}: Props) {
  const creatorId = getStoredCreatorId()
  const [escrow, setEscrow] = useState<EscrowState | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [deliverableUrl, setDeliverableUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [disputeReason, setDisputeReason] = useState('')
  const [showDisputeForm, setShowDisputeForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/open-collabs/${encodeURIComponent(collaborationId)}/escrow`)
        if (!res.ok) return
        const body = (await res.json()) as { escrow: EscrowState | null; submissions: Submission[] }
        if (cancelled) return
        setEscrow(body.escrow)
        setSubmissions(body.submissions ?? [])
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [collaborationId])

  async function submitDeliverable(e: React.FormEvent) {
    e.preventDefault()
    if (!creatorId || !deliverableUrl.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/open-collabs/${encodeURIComponent(collaborationId)}/submit-deliverable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId,
          deliverableUrl: deliverableUrl.trim(),
          notes: notes.trim(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Failed to submit deliverable')
      }
      const data = (await res.json()) as { submission: Submission; escrow: EscrowState }
      setSubmissions((prev) => [...prev, data.submission])
      setEscrow(data.escrow)
      setDeliverableUrl('')
      setNotes('')
      if (onUpdated) onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function raiseDispute(e: React.FormEvent) {
    e.preventDefault()
    if (!creatorId || !disputeReason.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/open-collabs/${encodeURIComponent(collaborationId)}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId,
          reason: disputeReason.trim(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Failed to flag dispute')
      }
      const data = (await res.json()) as { escrow: EscrowState }
      setEscrow(data.escrow)
      setShowDisputeForm(false)
      if (onUpdated) onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dispute flag failed')
    } finally {
      setSubmitting(false)
    }
  }

  const mySubmission = submissions.find((s) => s.creatorId === creatorId)
  const otherSubmission = submissions.find((s) => s.creatorId !== creatorId)

  return (
    <div className="escrow-modal-overlay">
      <div className="escrow-modal card">
        <header className="escrow-modal-header">
          <div>
            <p className="card-kicker">Agreement & Escrow Flow</p>
            <h3 className="card-title">Escrow Vault: {otherCreatorName}</h3>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        {loading ? (
          <p className="escrow-loading">Checking escrow state…</p>
        ) : (
          <div className="escrow-body">
            {/* Future Feature Roadmap Badge */}
            <div style={{ background: 'var(--yellow)', border: '2px solid var(--ink)', padding: '0.8rem 1rem', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.8rem', boxShadow: '3px 3px 0 var(--ink)' }}>
              <span style={{ fontSize: '1.4rem' }}>🚧</span>
              <div>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', color: 'var(--ink)' }}>
                  Service Not Available — Future Roadmap
                </strong>
                <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                  Automated smart contract and on-chain escrow release is currently in active development for Phase 2.
                </span>
              </div>
            </div>

            {/* Escrow Status Banner */}
            <div className={`escrow-status-box escrow-status--${escrow?.status ?? 'locked'}`}>
              <div className="escrow-badge-row">
                <span className="badge badge-accent">
                  {escrow?.status === 'released'
                    ? '✓ Escrow Released'
                    : escrow?.status === 'disputed'
                      ? '⚠️ Under Dispute / Manual Review'
                      : escrow?.status === 'submitted'
                        ? '● Submission Pending Partner'
                        : '🔒 Funds Locked in Escrow'}
                </span>
                <span className="escrow-amount">
                  ${escrow?.amount ?? 500} {escrow?.currency ?? 'USD'}
                </span>
              </div>
              <p className="escrow-status-desc">
                {escrow?.status === 'released'
                  ? 'Both creator submissions were verified! Funds have auto-released successfully.'
                  : escrow?.status === 'disputed'
                    ? `Dispute Flagged: "${escrow.disputeReason}". The Mind verifies proof of submission occurred, but quality dispute has been routed for human review.`
                    : escrow?.status === 'submitted'
                      ? 'One party submitted deliverables. Waiting for the second submission to trigger auto-release.'
                      : 'Funds are securely locked in the Mind-managed escrow container until deliverable verification.'}
              </p>
            </div>

            {/* Checklist Step Indicator */}
            <div className="escrow-steps-flow">
              <div className="escrow-step is-complete">
                <span className="escrow-step-num">1</span>
                <span>Match & AI Negotiation</span>
              </div>
              <div className="escrow-step is-complete">
                <span className="escrow-step-num">2</span>
                <span>2-Party Sign-off</span>
              </div>
              <div className="escrow-step is-complete">
                <span className="escrow-step-num">3</span>
                <span>Escrow Lock</span>
              </div>
              <div className={`escrow-step ${submissions.length > 0 ? 'is-complete' : 'is-active'}`}>
                <span className="escrow-step-num">4</span>
                <span>Deliverables Submit</span>
              </div>
              <div className={`escrow-step ${escrow?.status === 'released' ? 'is-complete' : escrow?.status === 'disputed' ? 'is-dispute' : ''}`}>
                <span className="escrow-step-num">5</span>
                <span>Auto-Release / Review</span>
              </div>
            </div>

            {/* Deliverable Submissions Check */}
            <div className="escrow-deliverables-section">
              <h4 className="escrow-subhead">Deliverables Checklist</h4>
              <div className="submissions-grid">
                <div className="submission-card">
                  <div className="submission-title-row">
                    <span className="submission-creator">Your Submission</span>
                    <span className={`badge ${mySubmission ? 'badge-ok' : 'badge-muted'}`}>
                      {mySubmission ? 'Submitted' : 'Pending'}
                    </span>
                  </div>
                  {mySubmission ? (
                    <div className="submission-info">
                      <a href={mySubmission.deliverableUrl} target="_blank" rel="noreferrer" className="submission-link">
                        🔗 {mySubmission.deliverableUrl}
                      </a>
                      {mySubmission.notes && <p className="submission-notes">“{mySubmission.notes}”</p>}
                    </div>
                  ) : (
                    <p className="submission-empty">You have not submitted your deliverable link yet.</p>
                  )}
                </div>

                <div className="submission-card">
                  <div className="submission-title-row">
                    <span className="submission-creator">{otherCreatorName}&apos;s Submission</span>
                    <span className={`badge ${otherSubmission ? 'badge-ok' : 'badge-muted'}`}>
                      {otherSubmission ? 'Submitted' : 'Pending'}
                    </span>
                  </div>
                  {otherSubmission ? (
                    <div className="submission-info">
                      <a href={otherSubmission.deliverableUrl} target="_blank" rel="noreferrer" className="submission-link">
                        🔗 {otherSubmission.deliverableUrl}
                      </a>
                      {otherSubmission.notes && <p className="submission-notes">“{otherSubmission.notes}”</p>}
                    </div>
                  ) : (
                    <p className="submission-empty">{otherCreatorName} has not submitted deliverables yet.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Submission Form (if not yet submitted) */}
            {!mySubmission && escrow?.status !== 'released' && (
              <form className="escrow-submit-form" onSubmit={submitDeliverable}>
                <h4 className="escrow-subhead">Submit Your Deliverables</h4>
                <label className="field">
                  <span className="field-label">Deliverable URL (Post, Video, Track, Drive link)</span>
                  <input
                    type="url"
                    className="field-input"
                    placeholder="https://instagram.com/p/... or https://youtube.com/watch?v=..."
                    value={deliverableUrl}
                    onChange={(e) => setDeliverableUrl(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Submission Notes (Optional)</span>
                  <input
                    type="text"
                    className="field-input"
                    placeholder="Posted with tagged co-author and hashtags"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={submitting}
                  />
                </label>
                <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Deliverable & Verify 🚀'}
                </button>
              </form>
            )}

            {/* Dispute Guardrail Form */}
            {escrow?.status !== 'released' && escrow?.status !== 'disputed' && (
              <div className="escrow-dispute-container">
                {!showDisputeForm ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowDisputeForm(true)}
                  >
                    Flag Quality Dispute / Request Human Review ⚠️
                  </button>
                ) : (
                  <form className="escrow-dispute-form" onSubmit={raiseDispute}>
                    <h5 className="dispute-title">Flag Quality Dispute</h5>
                    <p className="dispute-note">
                      The Mind verifies that deliverable submission occurred, but will NOT judge quality unilaterally.
                      Flagging a dispute pauses auto-release and alerts both parties for human review.
                    </p>
                    <textarea
                      className="field-input"
                      rows={2}
                      placeholder="Explain the dispute issue (e.g. deliverable incomplete, contract terms breached)..."
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      required
                    />
                    <div className="btn-row" style={{ marginTop: '0.5rem' }}>
                      <button type="submit" className="btn btn-error" disabled={submitting}>
                        Confirm Dispute
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setShowDisputeForm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {error && <p className="form-error">{error}</p>}
          </div>
        )}

        <footer className="escrow-modal-footer">
          <button type="button" className="btn btn-block" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
