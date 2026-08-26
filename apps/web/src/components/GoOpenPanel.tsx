import { useEffect, useState } from 'react'

/**
 * "Go Open" Form (matching criteria) — Tinder-style creator collab platform:
 * - Language(s) — multi-select
 * - Minimum followers — number input, with platform dropdown (IG / YT / TikTok / Other)
 * - Niche / category
 * - Minimum rate / budget expectation
 * - Collab type — checkboxes (Paid / Barter / Affiliate / UGC)
 * - Availability window — date range
 * - Go Open on/off toggle — off = Mind stops matching
 * - Submit -> "Save & Start Matching"
 */

export interface OpenCollabCard {
  creatorId: string
  openToCollab: boolean
  myFollowers: number
  minPartnerFollowers: number
  languages: string[]
  topics: string[]
  platform?: string
  niche?: string
  minRate?: number
  collabTypes?: string[]
  startDate?: string
  endDate?: string
  guardrails?: string
  openForBrands?: boolean
  brandMinRate?: number
}

interface Props {
  creatorId: string
  onClose?: () => void
  onSaved?: () => void
  onSavedAndMatch?: () => void
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

const PLATFORMS = ['Instagram', 'YouTube', 'TikTok', 'Twitch', 'X (Twitter)', 'Other']

const NICHES = [
  'Tech & AI',
  'Gaming & Esports',
  'Music & Audio',
  'Art & Design',
  'Fitness & Health',
  'Comedy & Entertainment',
  'Education & Science',
  'Lifestyle & Vlogs',
  'Fashion & Beauty',
  'Food & Cooking',
]

const COLLAB_TYPES = ['Paid', 'Barter', 'Affiliate', 'UGC']

export default function GoOpenPanel({ creatorId, onClose, onSaved, onSavedAndMatch }: Props) {
  const [openToCollab, setOpenToCollab] = useState(true)
  const [platform, setPlatform] = useState('Instagram')
  const [myFollowers, setMyFollowers] = useState('')
  const [minPartner, setMinPartner] = useState('0')
  const [niche, setNiche] = useState('Tech & AI')
  const [minRate, setMinRate] = useState('0')
  const [collabTypes, setCollabTypes] = useState<string[]>(['Paid', 'Barter'])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [guardrails, setGuardrails] = useState('')
  const [openForBrands, setOpenForBrands] = useState(true)
  const [brandMinRate, setBrandMinRate] = useState('100')
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
        const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
        const res = await fetch(`${apiBase}/api/open-collabs/${encodeURIComponent(creatorId)}`)
        if (!res.ok) return // no card yet — keep defaults
        const card = (await res.json()) as OpenCollabCard
        if (cancelled) return
        setOpenToCollab(card.openToCollab)
        setMyFollowers(String(card.myFollowers ?? ''))
        setMinPartner(String(card.minPartnerFollowers ?? '0'))
        setLanguages(card.languages && card.languages.length > 0 ? card.languages : ['en'])
        if (card.platform) setPlatform(card.platform)
        if (card.niche) setNiche(card.niche)
        if (card.minRate !== undefined) setMinRate(String(card.minRate))
        if (card.collabTypes && card.collabTypes.length > 0) setCollabTypes(card.collabTypes)
        if (card.startDate) setStartDate(card.startDate)
        if (card.endDate) setEndDate(card.endDate)
        if (card.guardrails) setGuardrails(card.guardrails)
        if (card.openForBrands !== undefined) setOpenForBrands(card.openForBrands)
        if (card.brandMinRate !== undefined) setBrandMinRate(String(card.brandMinRate))
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

  function toggleCollabType(type: string) {
    setCollabTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }

  async function handleSave(startMatchAfter = false) {
    if (saving) return
    setError('')
    const followers = Number(myFollowers === '' ? '0' : myFollowers)
    const minP = Number(minPartner === '' ? '0' : minPartner)
    const rate = Number(minRate === '' ? '0' : minRate)
    const bMinRate = Number(brandMinRate === '' ? '0' : brandMinRate)

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
    if (collabTypes.length === 0) {
      setError('Select at least one collaboration type.')
      return
    }

    setSaving(true)
    try {
      const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
      const res = await fetch(`${apiBase}/api/open-collabs/${encodeURIComponent(creatorId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openToCollab,
          myFollowers: followers,
          minPartnerFollowers: minP,
          languages,
          topics: [niche],
          platform,
          niche,
          minRate: rate,
          collabTypes,
          startDate,
          endDate,
          guardrails,
          openForBrands,
          brandMinRate: bMinRate,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Could not save your open-collab card.')
        return
      }
      setSaved(true)
      if (onSaved) {
        onSaved()
      }
      if (startMatchAfter && onSavedAndMatch) {
        onSavedAndMatch()
      }
    } catch {
      setError('Could not reach the LINKUP API.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="collab-panel" aria-label="Go open for collaborations">
      <div className="collab-panel-header-row">
        <div>
          <p className="collab-panel-kicker" aria-hidden="true">
            N°005 — Open Collab
          </p>
          <h2 className="collab-panel-title">Go Open ✦</h2>
        </div>
        <div className="go-open-status-toggle">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={openToCollab}
              onChange={(e) => {
                setOpenToCollab(e.target.checked)
                setSaved(false)
              }}
              aria-label="Toggle Go Open matching"
            />
            <span className="toggle-slider" />
          </label>
          <span className={`toggle-label ${openToCollab ? 'text-ok' : 'text-muted'}`}>
            {openToCollab ? 'Matching Active' : 'Matching Paused'}
          </span>
        </div>
      </div>

      <p className="collab-panel-note">
        Set your criteria and guardrails. Your personal AI Mind negotiates deal terms with other creators&apos; Minds
        autonomously within these boundaries.
      </p>

      {saved && (
        <div className="collab-created" role="status">
          <p className="collab-created-title">
            {openToCollab ? "✓ You're Open & Matching!" : 'Open Collab Paused'}
          </p>
          <p className="collab-created-line">
            {openToCollab
              ? `Your Mind accepts ${platform} partners in ${niche} with ${Number(minPartner || 0).toLocaleString()}+ followers.`
              : 'Your card is saved but your Mind will not initiate new negotiations.'}
          </p>
        </div>
      )}

      <div className="form-grid">
        {/* Platform & Follower counts */}
        <div className="field-row">
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Primary Platform</span>
            <select
              className="field-input"
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value)
                setSaved(false)
              }}
              disabled={saving}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">My Follower Count</span>
            <input
              className="field-input"
              type="number"
              min={0}
              placeholder="e.g. 50000"
              value={myFollowers}
              onChange={(e) => {
                setMyFollowers(e.target.value)
                setSaved(false)
              }}
              disabled={saving}
              aria-label="My follower count"
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Niche / Category</span>
            <select
              className="field-input"
              value={niche}
              onChange={(e) => {
                setNiche(e.target.value)
                setSaved(false)
              }}
              disabled={saving}
            >
              {NICHES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Min Partner Followers (0 = Anyone)</span>
            <input
              className="field-input"
              type="number"
              min={0}
              placeholder="0 for anyone, 10000+ for established"
              value={minPartner}
              onChange={(e) => {
                setMinPartner(e.target.value)
                setSaved(false)
              }}
              disabled={saving}
              aria-label="Minimum partner followers"
            />
          </label>
        </div>

        {/* Rate & Availability */}
        <div className="field-row">
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Minimum Rate / Budget Expectation ($)</span>
            <input
              className="field-input"
              type="number"
              min={0}
              placeholder="0 (free/barter) or $ expectation"
              value={minRate}
              onChange={(e) => {
                setMinRate(e.target.value)
                setSaved(false)
              }}
              disabled={saving}
              aria-label="Minimum rate expectation"
            />
          </label>

          <div className="field" style={{ flex: 1 }}>
            <span className="field-label">Availability Window (Date Range)</span>
            <div className="date-range-row">
              <input
                className="field-input"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setSaved(false)
                }}
                disabled={saving}
                aria-label="Start date"
              />
              <span className="date-sep">to</span>
              <input
                className="field-input"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setSaved(false)
                }}
                disabled={saving}
                aria-label="End date"
              />
            </div>
          </div>
        </div>

        {/* Collab Types */}
        <div className="field">
          <span className="field-label">Collab Types Accepted</span>
          <div className="chips-row">
            {COLLAB_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`chip ${collabTypes.includes(type) ? 'chip--on' : ''}`}
                onClick={() => {
                  toggleCollabType(type)
                  setSaved(false)
                }}
                disabled={saving}
                aria-pressed={collabTypes.includes(type)}
              >
                {collabTypes.includes(type) ? '✓ ' : '+ '}
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Languages */}
        <div className="field">
          <span className="field-label">Languages I Work In</span>
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

        {/* Brand Sponsorship Toggle & Rate */}
        <div className="field" style={{ border: '2px dashed var(--accent)', padding: '0.85rem', background: '#f0f7ff' }}>
          <label className="collab-confirm" style={{ marginBottom: '0.6rem' }}>
            <input
              type="checkbox"
              checked={openForBrands}
              onChange={(e) => {
                setOpenForBrands(e.target.checked)
                setSaved(false)
              }}
              disabled={saving}
            />
            <span>
              <strong>⚡ Open for Brands too (Brand Ad Sponsorships)</strong>
              <br />
              <span className="field-hint">
                Allows verified brands to discover you in the Brand Portal and send paid sponsorship deals.
              </span>
            </span>
          </label>

          {openForBrands && (
            <label className="field" style={{ marginTop: '0.4rem' }}>
              <span className="field-label">Min Sponsorship Rate ($ for Brand Ads)</span>
              <input
                className="field-input"
                type="number"
                min="0"
                step="25"
                placeholder="100"
                value={brandMinRate}
                onChange={(e) => {
                  setBrandMinRate(e.target.value)
                  setSaved(false)
                }}
                disabled={saving}
              />
            </label>
          )}
        </div>

        {/* Guardrails */}
        <label className="field">
          <span className="field-label">Non-Negotiable Guardrails (Limits Mind cannot cross)</span>
          <input
            className="field-input"
            type="text"
            placeholder="e.g. No gambling/crypto sponsorships, minimum $200 for dedicated video, require 7 days notice"
            value={guardrails}
            onChange={(e) => {
              setGuardrails(e.target.value)
              setSaved(false)
            }}
            disabled={saving}
          />
        </label>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="mind-save-actions" style={{ marginTop: '1.2rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSave(true)}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save & Start Matching ⚡'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleSave(false)}
          disabled={saving}
        >
          {loaded ? 'Update Terms' : 'Save Criteria'}
        </button>
        {onClose && (
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
        )}
      </div>
    </section>
  )
}
