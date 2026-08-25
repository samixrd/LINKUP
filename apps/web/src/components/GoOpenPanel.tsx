import { useEffect, useState } from 'react'

/**
 * "Go Open" panel: publish or update the creator's open-collab card —
 * follower count, the minimum partner size they accept (0 = anyone,
 * even brand-new creators), and working languages. This card is what
 * powers threshold matching and the Mind-vs-Mind negotiation loop.
 */

export interface OpenCollabCard {
  creatorId: string
  openToCollab: boolean
  myFollowers: number
  minPartnerFollowers: number
  languages: string[]
  topics: string[]
}

interface Props {
  creatorId: string
  onClose: () => void
}

const LANGUAGE_CODES = ['en', 'bn', 'hi', 'es', 'pt', 'ar', 'fr', '*']

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  bn: 'Bangla',
  hi: 'Hindi',
  es: 'Spanish',
  pt: 'Portuguese',
  ar: 'Arabic',
  fr: 'French',
  '*': 'Any language',
}

export default function GoOpenPanel({ creatorId, onClose }: Props) {
  const [openToCollab, setOpenToCollab] = useState(true)
  const [myFollowers, setMyFollowers] = useState('')
  const [minPartner, setMinPartner] = useState('0')
  const [languages, setLanguages] = useState<string[]>(['en'])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Load existing card when opened.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/open-collabs/${encodeURIComponent(creatorId)}`)
        if (!res.ok) return // no card yet — keep defaults
        const card = (await res.json()) as OpenCollabCard
        if (cancelled) return
        setOpenToCollab(card.openToCollab)
        setMyFollowers(String(card.myFollowers))
        setMinPartner(String(card.minPartnerFollowers))
        setLanguages(card.languages.length > 0 ? card.languages : ['en'])
        setLoaded(true)
      } catch {
        /* defaults are fine */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [creatorId])

  function toggleLanguage(code: string) {
    setLanguages((prev) =>
      prev.includes(code) ? prev.filter((l) => l !== code) : [...prev.filter((l) => l !== '*'), code],
    )
  }

  async function handleSave() {
    if (saving) return
    setError('')
    const followers = Number(myFollowers === '' ? '0' : myFollowers)
    const minP = Number(minPartner === '' ? '0' : minPartner)
    if (!Number.isInteger(followers) || followers < 0) {
      setError('Follower count must be a whole number (0 or more).')
      return
    }
    if (!Number.isInteger(minP) || minP < 0) {
      setError('Minimum partner followers must be a whole number (0 or more).')
      return
    }
    if (languages.length === 0) {
      setError('Pick at least one language.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/open-collabs/${encodeURIComponent(creatorId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openToCollab,
          myFollowers: followers,
          minPartnerFollowers: minP,
          languages,
          topics: [],
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Could not save your open-collab card.')
        return
      }
      setSaved(true)
    } catch {
      setError('Could not reach the LINKUP API.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="collab-panel" aria-label="Go open for collaborations">
      <p className="collab-panel-kicker" aria-hidden="true">
        N°005 — Open Collab
      </p>
      <h2 className="collab-panel-title">Go Open ✦</h2>
      <p className="collab-panel-note">
        Publish your collab terms. Other Minds see this card and can start a negotiation with you.
        Set minimum partner followers to <strong>0</strong> to say &ldquo;I&apos;ll collab with anyone — even
        0-follower creators.&rdquo;
      </p>

      {saved && (
        <div className="collab-created" role="status">
          <p className="collab-created-title">
            {openToCollab ? "You're open for collaborations!" : 'Open collab paused'}
          </p>
          <p className="collab-created-line">
            {openToCollab
              ? `Your Mind accepts partners with ${Number(minPartner || 0).toLocaleString()}+ followers.`
              : 'Your card is saved but closed to new negotiations.'}
          </p>
        </div>
      )}

      <label className="collab-confirm" style={{ marginBottom: '0.8rem' }}>
        <input
          type="checkbox"
          checked={openToCollab}
          onChange={(e) => {
            setOpenToCollab(e.target.checked)
            setSaved(false)
          }}
          aria-label="Open to collaborations"
        />
        I&apos;m open to collaboration negotiations
      </label>

      <label className="field">
        <span className="field-label">My follower count</span>
        <input
          className="field-input"
          type="number"
          min={0}
          placeholder="e.g. 1000000"
          value={myFollowers}
          onChange={(e) => {
            setMyFollowers(e.target.value)
            setSaved(false)
          }}
          disabled={saving}
          aria-label="My follower count"
        />
      </label>

      <label className="field">
        <span className="field-label">Minimum partner followers (0 = anyone)</span>
        <input
          className="field-input"
          type="number"
          min={0}
          placeholder="e.g. 900000 for big creators only, 0 for anyone"
          value={minPartner}
          onChange={(e) => {
            setMinPartner(e.target.value)
            setSaved(false)
          }}
          disabled={saving}
          aria-label="Minimum partner followers"
        />
      </label>

      <div className="field">
        <span className="field-label">Languages I work in</span>
        <div className="match-terms" role="group" aria-label="Languages">
          {LANGUAGE_CODES.map((code) => (
            <button
              key={code}
              type="button"
              className={`chip ${languages.includes(code) ? 'chip--on' : ''}`}
              onClick={() => {
                toggleLanguage(code)
                setSaved(false)
              }}
              disabled={saving}
              aria-pressed={languages.includes(code)}
            >
              {LANGUAGE_LABELS[code] ?? code}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="mind-save-actions">
        <button type="button" className="btn collab-confirm-btn" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : loaded ? 'Update my terms' : 'Publish my terms'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Close
        </button>
      </div>
    </section>
  )
}
