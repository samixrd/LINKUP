import { useEffect, useState } from 'react'
import Shell from '../components/Shell'
import NegotiationLive from '../components/NegotiationLive'
import type { OpenCollabCard } from '../components/GoOpenPanel'

const NICHES = [
  'All Niches',
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

const CONTENT_TYPES = [
  'Dedicated 60s Reel / TikTok',
  'YouTube 90s Integration',
  'Full Dedicated Video',
  'Instagram Story + Link Sticker',
  'UGC Ad Creative Asset',
  'Multi-Platform Bundle',
]

const LANGUAGES = [
  { code: '*', label: 'Any Language' },
  { code: 'en', label: 'English' },
  { code: 'bn', label: 'Bangla' },
  { code: 'hi', label: 'Hindi' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
]

interface BrandInterviewState {
  industry: string
  targetPlatform: string
  collabFormat: string
  budgetTier: string
  guardrails: string
}

export default function BrandPage() {
  const [brandName, setBrandName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('linkup.brandName') || ''
    }
    return ''
  })
  const [campaignTitle, setCampaignTitle] = useState('')
  const [selectedNiche, setSelectedNiche] = useState('All Niches')
  const [selectedPlatform, setSelectedPlatform] = useState('All Platforms')
  const [minFollowers, setMinFollowers] = useState('0')
  const [minViews, setMinViews] = useState('5000')
  const [contentType, setContentType] = useState(CONTENT_TYPES[0])
  const [selectedLanguage, setSelectedLanguage] = useState('*')
  const [budgetPerCreator, setBudgetPerCreator] = useState('250')
  const [campaignBrief, setCampaignBrief] = useState('')
  const [creators, setCreators] = useState<OpenCollabCard[]>([])
  const [loadingCreators, setLoadingCreators] = useState(true)
  const [proposalSentId, setProposalSentId] = useState<string | null>(null)
  const [activeModalCreator, setActiveModalCreator] = useState<OpenCollabCard | null>(null)
  const [offerText, setOfferText] = useState('')
  const [offerPrice, setOfferPrice] = useState('250')
  const [sendingProposal, setSendingProposal] = useState(false)
  const [proposalStatus, setProposalStatus] = useState<string | null>(null)
  const [liveNegotiation, setLiveNegotiation] = useState<{ targetId?: string; targetName?: string } | null>(null)

  // Brand Mind 5-Question Setup State
  const [showInterviewModal, setShowInterviewModal] = useState(false)
  const [brandMindReady, setBrandMindReady] = useState(false)
  const [interviewAnswers, setInterviewAnswers] = useState<BrandInterviewState>({
    industry: 'Tech & AI',
    targetPlatform: 'Instagram',
    collabFormat: 'Dedicated 60s Reel / TikTok',
    budgetTier: '$300 - $1,000',
    guardrails: 'Family-friendly content only',
  })
  const [answeredCount, setAnsweredCount] = useState(5)

  useEffect(() => {
    const bName = brandName.trim() || (typeof window !== 'undefined' ? localStorage.getItem('linkup.brandName') : '')
    if (bName && bName.trim()) {
      setBrandMindReady(true)
      setAnsweredCount(5)
    } else {
      setBrandMindReady(false)
      setAnsweredCount(0)
    }
  }, [brandName])

  function handleBrandNameChange(val: string) {
    setBrandName(val)
    if (typeof window !== 'undefined') {
      localStorage.setItem('linkup.brandName', val)
      const bId = `brand_${val.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'partner'}`
      localStorage.setItem('linkup.brandId', bId)
    }
    if (val.trim()) {
      setBrandMindReady(true)
      setAnsweredCount(5)
    } else {
      setBrandMindReady(false)
      setAnsweredCount(0)
    }
  }

  function handleSaveBrandMind(answers: BrandInterviewState) {
    setInterviewAnswers(answers)
    setSelectedNiche(answers.industry)
    if (answers.targetPlatform !== 'Multi-Platform') {
      setSelectedPlatform(answers.targetPlatform)
    }
    setContentType(answers.collabFormat)
    setCampaignBrief(`Brand Guardrails: ${answers.guardrails} | Preferred format: ${answers.collabFormat}`)
    setBrandMindReady(true)
    setAnsweredCount(5)
    setShowInterviewModal(false)
  }

  // Fetch open creators filtered for brands
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingCreators(true)
      try {
        const queryParams = new URLSearchParams()
        if (selectedNiche !== 'All Niches') queryParams.set('niche', selectedNiche)
        if (selectedPlatform !== 'All Platforms') queryParams.set('platform', selectedPlatform)
        if (Number(minFollowers) > 0) queryParams.set('minFollowers', minFollowers)
        if (selectedLanguage !== '*') queryParams.set('language', selectedLanguage)

        const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
        const res = await fetch(`${apiBase}/api/open-collabs/brands/creators?${queryParams.toString()}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          setCreators(data.creators ?? [])
        }
      } catch {
        // network error fallback
      } finally {
        if (!cancelled) setLoadingCreators(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selectedNiche, selectedPlatform, minFollowers, selectedLanguage])

  function handleOpenProposal(creator: OpenCollabCard) {
    if (!brandMindReady) {
      setShowInterviewModal(true)
      return
    }
    setActiveModalCreator(creator)
    const suggestedPrice = creator.brandMinRate && creator.brandMinRate > 0 ? creator.brandMinRate : Number(budgetPerCreator) > 0 ? Number(budgetPerCreator) : 250
    setOfferPrice(String(suggestedPrice))
    const bName = brandName.trim() || 'Brand Partner'
    const titleSnippet = campaignTitle.trim() ? ` for "${campaignTitle.trim()}"` : ''
    const briefSnippet = campaignBrief.trim() ? ` Key Focus: ${campaignBrief.trim()}` : ''
    setOfferText(`Hey! We'd love to sponsor a ${contentType}${titleSnippet} for our brand (${bName}).${briefSnippet} Let's collaborate!`)
    setProposalStatus(null)
  }

  async function handleSendProposal() {
    if (!activeModalCreator) return
    setSendingProposal(true)
    setProposalStatus(null)

    try {
      const bName = brandName.trim() || 'Brand Partner'
      const bId = `brand_${bName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
      if (typeof window !== 'undefined') {
        localStorage.setItem('linkup.brandId', bId)
        localStorage.setItem('linkup.creatorId', bId)
      }
      const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
      const briefNote = campaignBrief.trim() ? ` | Brief: ${campaignBrief.trim()}` : ''
      const res = await fetch(`${apiBase}/api/open-collabs/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: bId,
          brandName: bName,
          targetId: activeModalCreator.creatorId,
          proposal: `[BRAND SPONSORSHIP - $${offerPrice}] ${offerText} | Deliverable: ${contentType}${briefNote}`,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to dispatch proposal')
      }

      setProposalSentId(activeModalCreator.creatorId)
      setProposalStatus('⚡ Sponsorship proposal dispatched to Creator Mind! Opening live deal room…')
      const target = activeModalCreator
      setTimeout(() => {
        setActiveModalCreator(null)
        setLiveNegotiation({
          targetId: target.creatorId,
          targetName: target.creatorId.replace('u_', ''),
        })
      }, 1200)
    } catch (err) {
      setProposalStatus(err instanceof Error ? err.message : 'Failed to send proposal.')
    } finally {
      setSendingProposal(false)
    }
  }

  const brandDisplayName = brandName.trim() || 'Brand Partner'
  const brandDisplayId = `brand_${brandDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`

  return (
    <Shell>
      <main className="brand-page">
        {/* Brand Portal Hero Header */}
        <section className="brand-header">
          <div className="brand-header-copy">
            <span className="badge badge-accent">Link Up — Brand Ads Portal</span>
            <h1 className="brand-title">Find High-Performing Creators for Paid Ads</h1>
            <p className="brand-subtitle">
              Connect directly with verified creators who are <strong>Open for Brand Deals</strong>. Set your follower floor, content format, and budget — let AI negotiate deal terms autonomously.
            </p>
          </div>
          <div className="brand-header-stats">
            <div className="stat-pill">
              <span className="stat-num">{creators.length}</span>
              <span className="stat-txt">Available Creators</span>
            </div>
            <div className="stat-pill">
              <span className="stat-num">100%</span>
              <span className="stat-txt">Escrow Protected</span>
            </div>
            <div className="stat-pill">
              <span className="stat-num">AI-AI</span>
              <span className="stat-txt">Fast Deal Closure</span>
            </div>
          </div>
        </section>

        {/* 2-Column Portal: Campaign Builder (Left) & Matching Creators Feed (Right) */}
        <div className="brand-portal-grid">
          {/* Left: Campaign Brief & Filter Form */}
          <aside className="card brand-campaign-card" aria-label="Brand Campaign Setup">
            <p className="card-kicker">Brand Campaign Brief</p>
            <h2 className="card-title">Campaign Specs</h2>

            {/* Brand Mind Identity Status & 5-Question Interview Banner */}
            <div
              className="brand-mind-banner"
              style={{
                background: brandMindReady ? 'var(--paper, #f7f9fa)' : 'rgba(255, 193, 7, 0.08)',
                border: brandMindReady ? '1.5px solid var(--ink)' : '1.5px dashed var(--accent, #f59e0b)',
                padding: '0.75rem 0.85rem',
                marginBottom: '1.1rem',
                borderRadius: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700 }}>
                  🏷️ Mind: {brandDisplayName} ({brandDisplayId})
                </span>
                <span className={`badge ${brandMindReady ? 'badge-accent' : 'badge-warn'}`} style={{ fontSize: '0.68rem' }}>
                  {brandMindReady ? '● Mind Active' : '⚠️ Setup Needed'}
                </span>
              </div>
              <p style={{ fontSize: '0.74rem', color: brandMindReady ? 'var(--ink-soft)' : '#b45309', marginTop: '0.35rem', marginBottom: '0.45rem' }}>
                {brandMindReady
                  ? '● Autonomous Brand Negotiator Active & Ready for Creator Deals'
                  : `⚠️ Collab Locked: Answer 5 core Brand Mind questions to send offers to creators.`}
              </p>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{
                  fontSize: '0.72rem',
                  padding: '0.2rem 0.6rem',
                  width: '100%',
                  textAlign: 'center',
                  background: brandMindReady ? 'rgba(0,0,0,0.03)' : 'var(--ink)',
                  color: brandMindReady ? 'var(--ink)' : '#fff',
                }}
                onClick={() => setShowInterviewModal(true)}
              >
                {brandMindReady ? '⚙️ Review Brand Mind Setup (5/5 Complete)' : '⚡ Complete 5-Question Brand Mind Setup →'}
              </button>
            </div>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Brand / Product Name</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. OpenAI / Notion / Gymshark"
                  value={brandName}
                  onChange={(e) => handleBrandNameChange(e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">Campaign Title / Angle</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. Summer AI Tool Launch Q3"
                  value={campaignTitle}
                  onChange={(e) => setCampaignTitle(e.target.value)}
                />
              </label>

              <div className="field-row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Target Niche</span>
                  <select
                    className="field-input"
                    value={selectedNiche}
                    onChange={(e) => setSelectedNiche(e.target.value)}
                  >
                    {NICHES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Platform</span>
                  <select
                    className="field-input"
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value)}
                  >
                    <option value="All Platforms">All Platforms</option>
                    <option value="Instagram">Instagram</option>
                    <option value="YouTube">YouTube</option>
                    <option value="TikTok">TikTok</option>
                    <option value="Twitch">Twitch</option>
                  </select>
                </label>
              </div>

              <div className="field-row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Min Followers</span>
                  <input
                    className="field-input"
                    type="number"
                    min="0"
                    step="1000"
                    placeholder="0"
                    value={minFollowers}
                    onChange={(e) => setMinFollowers(e.target.value)}
                  />
                </label>

                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Target Avg Views</span>
                  <input
                    className="field-input"
                    type="number"
                    min="0"
                    step="1000"
                    placeholder="5000"
                    value={minViews}
                    onChange={(e) => setMinViews(e.target.value)}
                  />
                </label>
              </div>

              <label className="field">
                <span className="field-label">Content Ad Format</span>
                <select
                  className="field-input"
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                >
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <div className="field-row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Language</span>
                  <select
                    className="field-input"
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Budget / Creator ($)</span>
                  <input
                    className="field-input"
                    type="number"
                    min="0"
                    step="50"
                    placeholder="250"
                    value={budgetPerCreator}
                    onChange={(e) => setBudgetPerCreator(e.target.value)}
                  />
                </label>
              </div>

              <label className="field">
                <span className="field-label">Creative Brief / Key Talking Points</span>
                <textarea
                  className="field-input"
                  rows={3}
                  placeholder="Key message, CTA discount code, product link, compliance requirements..."
                  value={campaignBrief}
                  onChange={(e) => setCampaignBrief(e.target.value)}
                />
              </label>
            </div>
          </aside>

          {/* Right: Matching Creators List */}
          <main className="brand-creators-feed" aria-label="Available Creators Feed">
            <div className="feed-header">
              <div>
                <p className="card-kicker">High-Match Creators</p>
                <h2 className="card-title">Open for Brand Deals</h2>
              </div>
              <span className="badge badge-ok">{creators.length} Creators Ready</span>
            </div>

            {loadingCreators ? (
              <div className="skeleton-line" style={{ height: '8rem' }} />
            ) : creators.length === 0 ? (
              <div className="card brand-empty-feed">
                <p className="mind-empty-title">No matching creators found</p>
                <p className="mind-empty-subtitle">
                  Try lowering the minimum follower requirement or selecting "All Niches" to find more creators open to brand deals.
                </p>
              </div>
            ) : (
              <div className="brand-creator-cards-grid">
                {creators.map((c) => {
                  const name = c.creatorId.startsWith('u_') ? c.creatorId.slice(2) : c.creatorId
                  const isSent = proposalSentId === c.creatorId

                  return (
                    <article key={c.creatorId} className="card brand-creator-card">
                      <div className="creator-card-top">
                        <div className="brand-creator-avatar">
                          {name.charAt(0).toUpperCase()}
                        </div>
                        <div className="creator-meta">
                          <h3 className="creator-name">{name}</h3>
                          <div className="creator-badges">
                            <span className="badge">{c.platform || 'Instagram'}</span>
                            <span className="badge badge-accent">{c.niche || 'General'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="creator-stats-row">
                        <div className="creator-stat">
                          <span className="stat-label">Followers</span>
                          <span className="stat-val">{c.myFollowers.toLocaleString()}</span>
                        </div>
                        <div className="creator-stat">
                          <span className="stat-label">Min Ad Rate</span>
                          <span className="stat-val">
                            {c.brandMinRate && c.brandMinRate > 0
                              ? `$${c.brandMinRate}`
                              : c.minRate && c.minRate > 0
                                ? `$${c.minRate}`
                                : 'Flexible'}
                          </span>
                        </div>
                        <div className="creator-stat">
                          <span className="stat-label">Languages</span>
                          <span className="stat-val">{c.languages.join(', ').toUpperCase()}</span>
                        </div>
                      </div>

                      {c.guardrails && (
                        <p className="creator-guardrail-snippet">
                          🛡️ <em>"{c.guardrails.slice(0, 70)}..."</em>
                        </p>
                      )}

                      <div className="creator-card-actions">
                        <button
                          type="button"
                          className={`btn btn-block ${isSent ? 'btn-ghost' : 'btn-primary'}`}
                          onClick={() => handleOpenProposal(c)}
                        >
                          {isSent ? '✓ Proposal Sent' : 'Send Sponsorship Offer ⚡'}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </main>
        </div>

        {/* Modal for sending personalized sponsorship proposal */}
        {activeModalCreator && (
          <div className="escrow-modal-overlay" role="dialog" aria-modal="true">
            <div className="card escrow-modal">
              <div className="escrow-modal-header">
                <div>
                  <p className="card-kicker">Instant Sponsorship Pitch</p>
                  <h3 className="card-title">Pitch to {activeModalCreator.creatorId}</h3>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setActiveModalCreator(null)}
                >
                  ✕
                </button>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Sponsorship Offer Amount ($)</span>
                  <input
                    className="field-input"
                    type="number"
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                    disabled={sendingProposal}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Deliverable Format</span>
                  <input className="field-input" type="text" value={contentType} readOnly disabled />
                </label>

                <label className="field">
                  <span className="field-label">Message / Terms for Creator's Mind</span>
                  <textarea
                    className="field-input"
                    rows={4}
                    value={offerText}
                    onChange={(e) => setOfferText(e.target.value)}
                    disabled={sendingProposal}
                  />
                </label>

                {proposalStatus && (
                  <p className={proposalStatus.includes('⚡') ? 'form-success' : 'form-error'}>
                    {proposalStatus}
                  </p>
                )}

                <div className="mind-save-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSendProposal}
                    disabled={sendingProposal || offerText.trim() === ''}
                  >
                    {sendingProposal ? 'Sending Pitch…' : 'Confirm & Dispatch to Creator Mind ⚡'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setActiveModalCreator(null)}
                    disabled={sendingProposal}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Brand Mind 5-Question Guided Setup Modal */}
        {showInterviewModal && (
          <div className="escrow-modal-overlay" role="dialog" aria-modal="true">
            <div className="card escrow-modal" style={{ maxWidth: '38rem', width: '100%' }}>
              <div className="escrow-modal-header">
                <div>
                  <span className="badge badge-accent">Brand Mind Setup (5 Core Questions)</span>
                  <h3 className="card-title" style={{ marginTop: '0.4rem' }}>Train Your Autonomous Brand Mind</h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', margin: 0 }}>
                    Just like creators, your Brand Mind needs core context (industry, target platforms, formats, budget & safety rules) before it can negotiate deals.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowInterviewModal(false)}
                >
                  ✕
                </button>
              </div>

              <div className="form-grid" style={{ marginTop: '0.8rem' }}>
                <label className="field">
                  <span className="field-label">1. Brand Industry / Category</span>
                  <select
                    className="field-input"
                    value={interviewAnswers.industry}
                    onChange={(e) =>
                      setInterviewAnswers((prev) => ({ ...prev, industry: e.target.value }))
                    }
                  >
                    {NICHES.filter((n) => n !== 'All Niches').map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">2. Target Platform for Creator Content</span>
                  <select
                    className="field-input"
                    value={interviewAnswers.targetPlatform}
                    onChange={(e) =>
                      setInterviewAnswers((prev) => ({ ...prev, targetPlatform: e.target.value }))
                    }
                  >
                    <option value="Instagram">Instagram</option>
                    <option value="YouTube">YouTube</option>
                    <option value="TikTok">TikTok</option>
                    <option value="Twitch">Twitch</option>
                    <option value="Multi-Platform">Multi-Platform</option>
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">3. Desired Deliverable / Ad Format</span>
                  <select
                    className="field-input"
                    value={interviewAnswers.collabFormat}
                    onChange={(e) =>
                      setInterviewAnswers((prev) => ({ ...prev, collabFormat: e.target.value }))
                    }
                  >
                    {CONTENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">4. Sponsor Budget Tier per Creator</span>
                  <select
                    className="field-input"
                    value={interviewAnswers.budgetTier}
                    onChange={(e) =>
                      setInterviewAnswers((prev) => ({ ...prev, budgetTier: e.target.value }))
                    }
                  >
                    <option value="$100 - $300">$100 – $300 (Micro / Emerging)</option>
                    <option value="$300 - $1,000">$300 – $1,000 (Mid-tier Growth)</option>
                    <option value="$1,000 - $5,000">$1,000 – $5,000 (Established Pro)</option>
                    <option value="$5,000+">$5,000+ (High Reach / Macro)</option>
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">5. Brand Safety Rules & Mandatory Guardrails</span>
                  <input
                    className="field-input"
                    type="text"
                    placeholder="e.g. Family-friendly only, 30-day competitor exclusivity, FTC tags..."
                    value={interviewAnswers.guardrails}
                    onChange={(e) =>
                      setInterviewAnswers((prev) => ({ ...prev, guardrails: e.target.value }))
                    }
                  />
                </label>

                <div className="mind-save-actions" style={{ marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleSaveBrandMind(interviewAnswers)}
                  >
                    Save & Activate Brand Mind ⚡
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setShowInterviewModal(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live Autonomous Negotiation Viewer for Brand Deals */}
        {liveNegotiation !== null && (
          <div className="escrow-modal-overlay" role="dialog" aria-modal="true">
            <div style={{ maxWidth: '44rem', width: '100%', margin: '1.5rem auto' }}>
              <NegotiationLive
                targetId={liveNegotiation.targetId}
                targetName={liveNegotiation.targetName}
                onClose={() => setLiveNegotiation(null)}
                onCompleted={() => {
                  setLiveNegotiation(null)
                }}
              />
            </div>
          </div>
        )}
      </main>
    </Shell>
  )
}