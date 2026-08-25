import { useState } from 'react'
import {
  ApiError,
  executeMindCollaboration,
  previewMindCollaboration,
  type Collaboration,
  type CreatorProfile,
  type MindCollaborationPreview,
} from '../api'

/** A deterministic match returned inside the Mind context. */
export interface CreatorMatch {
  creator: CreatorProfile
  score: number
  sharedTerms: string[]
}

interface ProposeCollaborationPanelProps {
  creatorId: string
  matches: CreatorMatch[]
  onCreated: (collaboration: Collaboration) => void
  onClose: () => void
}

/** Maps collaboration API errors to friendly messages (no raw stacks). */
function friendlyCollabError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503 && err.message.toLowerCase().includes('not configured')) {
      return 'Minds is not connected yet.'
    }
    if (err.status === 409) return 'A collaboration with this creator is already pending.'
    if (err.status === 404) {
      return err.message.includes('no compatible creators')
        ? 'No compatible creators found. Add memories about your interests to unlock matches.'
        : 'Creator profile not found.'
    }
    if (err.status === 400) return err.message
    if (err.status === 500) return 'Something went wrong. Please try again.'
    return err.message
  }
  return 'Could not reach the LINKUP API. Please try again.'
}

/**
 * "Propose Collaboration" flow for the Mind page. The Mind drafts a proposal
 * for a chosen compatible creator; nothing is created until the user reviews
 * the preview and explicitly confirms.
 */
export default function ProposeCollaborationPanel({
  creatorId,
  matches,
  onCreated,
  onClose,
}: ProposeCollaborationPanelProps) {
  const [targetId, setTargetId] = useState<string>(matches[0]?.creator.creatorId ?? '')
  const [preview, setPreview] = useState<MindCollaborationPreview | null>(null)
  const [collaboration, setCollaboration] = useState<Collaboration | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')

  const busy = previewing || executing

  async function handlePreview() {
    if (previewing) return
    setError('')
    setPreview(null)
    setCollaboration(null)
    setConfirmed(false)
    setPreviewing(true)
    try {
      const res = await previewMindCollaboration(creatorId, targetId || undefined)
      setPreview(res.preview)
    } catch (err) {
      setError(friendlyCollabError(err))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleExecute() {
    // The previewed target is executed only after explicit confirmation.
    if (executing || !preview || !confirmed) return
    setError('')
    setExecuting(true)
    try {
      const res = await executeMindCollaboration(creatorId, preview.target.creatorId)
      setCollaboration(res.collaboration)
      onCreated(res.collaboration)
    } catch (err) {
      setError(friendlyCollabError(err))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <section className="collab-panel" aria-label="Propose collaboration">
      <p className="collab-panel-kicker" aria-hidden="true">
        N°004 — Collaboration
      </p>
      <h2 className="collab-panel-title">Propose Collaboration</h2>
      <p className="collab-panel-note">
        Pick a compatible creator and let your Mind draft a proposal. Nothing is sent until you confirm.
      </p>

      {collaboration ? (
        <div className="collab-created" role="status">
          <p className="collab-created-title">Collaboration created</p>
          <p className="collab-created-line">
            Proposal sent to <strong>{preview?.target.displayName ?? 'your match'}</strong>.
            <span className="badge">{collaboration.status}</span>
          </p>
          <p className="collab-created-meta">ID: {collaboration.id}</p>
        </div>
      ) : (
        <>
          {matches.length > 0 ? (
            <label className="field">
              <span className="field-label">Compatible creator</span>
              <select
                className="field-input"
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value)
                  setPreview(null)
                  setConfirmed(false)
                  setError('')
                }}
                disabled={busy}
                aria-label="Compatible creator"
              >
                {matches.map((m, i) => (
                  <option key={m.creator.creatorId} value={m.creator.creatorId}>
                    {i === 0 ? 'Top match — ' : ''}
                    {m.creator.displayName} · {m.score} shared {m.score === 1 ? 'term' : 'terms'}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="collab-panel-note">
              No compatible creators found yet. Add memories about your interests to unlock matches.
            </p>
          )}

          <div>
            <button type="button" className="btn collab-preview-btn" onClick={() => void handlePreview()} disabled={busy}>
              {previewing ? 'Drafting…' : 'Preview proposal'}
            </button>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {preview && (
            <div className="collab-preview">
              <div className="collab-preview-target">
                <span className="collab-preview-name">{preview.target.displayName}</span>
                <span className="collab-score">{preview.score} shared terms</span>
              </div>
              {preview.target.bio && <p className="collab-preview-bio">{preview.target.bio}</p>}
              {preview.targetDetails && (
                <ul className="match-stats" aria-label="Target creator stats" style={{ justifyContent: 'flex-start' }}>
                  {(
                    [
                      preview.targetDetails.audienceSize ? `👥 ${preview.targetDetails.audienceSize}` : '',
                      preview.targetDetails.avgViews ? `👁 ${preview.targetDetails.avgViews} avg views` : '',
                      preview.targetDetails.languages && preview.targetDetails.languages.length > 0 ? `🗣 ${preview.targetDetails.languages.join(', ')}` : '',
                      preview.targetDetails.compensation && preview.targetDetails.compensation.length > 0 ? `💰 ${preview.targetDetails.compensation.join(' / ')}` : '',
                      preview.targetDetails.minBudget ? `🏷 ${preview.targetDetails.minBudget}` : '',
                    ] as string[]
                  )
                    .filter((chip) => chip !== '')
                    .map((chip) => (
                      <li key={chip} className="match-stat">
                        {chip}
                      </li>
                    ))}
                </ul>
              )}
              {preview.sharedTerms.length > 0 && (
                <ul className="collab-terms" aria-label="Shared terms">
                  {preview.sharedTerms.map((term) => (
                    <li key={term} className="collab-term">
                      {term}
                    </li>
                  ))}
                </ul>
              )}
              <p className="collab-proposal">{preview.proposal}</p>

              <label className="collab-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                  aria-label="Confirm collaboration request"
                />
                I confirm I want to send this collaboration request to {preview.target.displayName}.
              </label>

              <div className="mind-save-actions">
                <button
                  type="button"
                  className="btn collab-confirm-btn"
                  onClick={() => void handleExecute()}
                  disabled={!confirmed || busy}
                >
                  {executing ? 'Creating…' : 'Confirm & send'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mind-save-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
    </section>
  )
}
