import { useEffect, useState } from 'react'
import Shell from '../components/Shell'
import NegotiationLive from '../components/NegotiationLive'
import BrandOnboarding from '../components/BrandOnboarding'
import { brandMe, brandLogout, brandBulkDispatch, type BrandAccountInfo, type BulkDispatchResult } from '../brand_api'
import type { OpenCollabCard } from '../components/GoOpenPanel'

const NICHES = [
  'All Niches', 'Tech & AI', 'Gaming & Esports', 'Music & Audio',
  'Art & Design', 'Fitness & Health', 'Comedy & Entertainment',
  'Education & Science', 'Lifestyle & Vlogs', 'Fashion & Beauty', 'Food & Cooking',
]

const CONTENT_TYPES = [
  'Dedicated 60s Reel / TikTok', 'YouTube 90s Integration', 'Full Dedicated Video',
  'Instagram Story + Link Sticker', 'UGC Ad Creative Asset', 'Multi-Platform Bundle',
]

const LANGUAGES = [
  { code: '*', label: 'Any Language' }, { code: 'en', label: 'English' },
  { code: 'bn', label: 'Bangla' }, { code: 'hi', label: 'Hindi' },
  { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' },
]

export default function BrandPage() {
  // ── Auth state ────────────────────────────────────────────────────────────
  const [authLoading, setAuthLoading] = useState(true)
  const [account, setAccount] = useState<BrandAccountInfo | null>(null)

  // ── Portal state ──────────────────────────────────────────────────────────
  const [campaignTitle, setCampaignTitle] = useState('')
  const [selectedNiche, setSelectedNiche] = useState('All Niches')
  const [selectedPlatform, setSelectedPlatform] = useState('All Platforms')
  const [minFollowers, setMinFollowers] = useState('0')
  const [minViews, setMinViews] = useState('5000')
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]!)
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

  // ── Bulk dispatch state ───────────────────────────────────────────────────
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkDispatchResult | null>(null)

  // ── Check session on mount ────────────────────────────────────────────────
  useEffect(() => {
    brandMe()
      .then((acc) => { setAccount(acc); setAuthLoading(false) })
      .catch(() => setAuthLoading(false))
  }, [])

  // Pre-fill campaign filters from brand account
  useEffect(() => {
    if (!account) return
    setContentType(account.collabFormat)
    setCampaignBrief(`Brand: ${account.brandName} | Industry: ${account.industry} | Guardrails: ${account.guardrails}`)
    const budgetNum = account.budgetTier.match(/\$(\d+)/)?.[1]
    if (budgetNum) setBudgetPerCreator(budgetNum)
  }, [account])

  // ── Fetch matching creators ───────────────────────────────────────────────
  useEffect(() => {
    if (!account) return
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
        const data = await res.json() as { creators?: OpenCollabCard[] }
        if (!cancelled) setCreators(data.creators ?? [])
      } catch { /* network error */ }
      finally { if (!cancelled) setLoadingCreators(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [account, selectedNiche, selectedPlatform, minFollowers, selectedLanguage])

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleOpenProposal(creator: OpenCollabCard) {
    if (!account) return
    setActiveModalCreator(creator)
    const suggestedPrice = creator.brandMinRate && creator.brandMinRate > 0
      ? creator.brandMinRate
      : Number(budgetPerCreator) > 0 ? Number(budgetPerCreator) : 250
    setOfferPrice(String(suggestedPrice))
    const titleSnippet = campaignTitle.trim() ? ` for "${campaignTitle.trim()}"` : ''
    setOfferText(`Hey! We'd love to sponsor a ${contentType}${titleSnippet} for ${account.brandName}. Budget: ${account.budgetTier}. Guardrails: ${account.guardrails}. Let's collaborate!`)
    setProposalStatus(null)
  }

  async function handleSendProposal() {
    if (!activeModalCreator || !account) return
    setSendingProposal(true)
    setProposalStatus(null)
    try {
      const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
      const res = await fetch(`${apiBase}/api/open-collabs/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          creatorId: account.brandId,
          brandName: account.brandName,
          targetId: activeModalCreator.creatorId,
          proposal: `[BRAND SPONSORSHIP - $${offerPrice}] ${offerText} | Deliverable: ${contentType}`,
        }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Failed')
      }
      setProposalSentId(activeModalCreator.creatorId)
      setProposalStatus('⚡ Dispatched to Creator Mind! Opening live deal room…')
      const target = activeModalCreator
      setTimeout(() => {
        setActiveModalCreator(null)
        setLiveNegotiation({ targetId: target.creatorId, targetName: target.creatorId.replace('u_', '') })
      }, 1200)
    } catch (err) {
      setProposalStatus(err instanceof Error ? err.message : 'Failed to send proposal.')
    } finally {
      setSendingProposal(false)
    }
  }

  async function handleBulkDispatch() {
    setBulkLoading(true)
    setBulkResult(null)
    try {
      const result = await brandBulkDispatch({
        niche: selectedNiche !== 'All Niches' ? selectedNiche : undefined,
        platform: selectedPlatform !== 'All Platforms' ? selectedPlatform : undefined,
        minFollowers: Number(minFollowers) > 0 ? Number(minFollowers) : undefined,
        message: campaignBrief.trim() || undefined,
      })
      setBulkResult(result)
    } catch (err) {
      setBulkResult({ dispatched: 0, skipped: 0, targets: [], message: err instanceof Error ? err.message : 'Dispatch failed' })
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleLogout() {
    await brandLogout()
    setAccount(null)
    setBulkResult(null)
    setCreators([])
  }

  // ── Loading screen ────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <Shell>
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem' }}>
          <div className="skeleton" style={{ width: '20rem' }}>
            <div className="skeleton-line" style={{ width: '60%' }} />
            <div className="skeleton-line" style={{ width: '80%' }} />
            <div className="skeleton-line" style={{ width: '50%' }} />
          </div>
        </main>
      </Shell>
    )
  }

  // ── Not logged in → show onboarding ──────────────────────────────────────
  if (!account) {
    return (
      <Shell>
        <BrandOnboarding onDone={(acc) => setAccount(acc)} />
      </Shell>
    )
  }

  // ── Logged in → full portal ───────────────────────────────────────────────
  return (
    <Shell>
      <main className="brand-page">
        {/* Identity bar — logged-in brand identity */}
        <div className="brand-identity-bar">
          <span>
            🏢 <strong>{account.brandName}</strong>
            <span style={{ opacity: 0.7, marginLeft: '0.5rem' }}>@{account.handle}</span>
            <span className="badge" style={{ marginLeft: '0.75rem', background: 'var(--ok)', color: '#fff', borderColor: 'var(--ok)', fontSize: '0.58rem' }}>
              ● Mind Active
            </span>
          </span>
          <button className="btn btn-sm" onClick={() => void handleLogout()}>
            Sign Out
          </button>
        </div>

        {/* Brand Portal Hero Header */}
        <section className="brand-header">
          <div className="brand-header-copy">
            <span className="badge badge-accent">Link Up — Brand Ads Portal</span>
            <h1 className="brand-title">Find High-Performing Creators for Paid Ads</h1>
            <p className="brand-subtitle">
              Your Brand Mind is <strong>Active</strong>. Filter creators by niche, platform, and budget —
              send individual proposals or <strong>Bulk Dispatch</strong> to all matching creators at once.
            </p>
          </div>
          <div className="brand-header-stats">
            <div className="stat-pill">
              <span className="stat-num">{creators.length}</span>
              <span className="stat-txt">Available</span>
            </div>
            <div className="stat-pill">
              <span className="stat-num">100%</span>
              <span className="stat-txt">Escrow</span>
            </div>
            <div className="stat-pill">
              <span className="stat-num">AI</span>
              <span className="stat-txt">Negotiation</span>
            </div>
          </div>
        </section>

        {/* Bulk Dispatch Banner */}
        <div className="bulk-dispatch-banner">
          <div>
            <p className="card-kicker">Auto Bulk Dispatch</p>
            <p className="bulk-dispatch-info">
              Send sponsorship proposals to <strong>all {creators.length} matching creators</strong> at once.
              Your Brand Mind will autonomously negotiate deals on your behalf using your guardrails and budget tier.
            </p>
            {bulkResult && (
              <p className="bulk-dispatch-result">
                {bulkResult.message}
              </p>
            )}
          </div>
          <button
            className="btn"
            style={{ background: 'var(--accent)', flexShrink: 0 }}
            onClick={() => void handleBulkDispatch()}
            disabled={bulkLoading || creators.length === 0}
          >
            {bulkLoading ? 'Dispatching…' : `⚡ Bulk Dispatch to All ${creators.length} Creators`}
          </button>
        </div>

        {/* 2-Column Portal */}
        <div className="brand-portal-grid">
          {/* Left: Campaign filters */}
          <aside className="card brand-campaign-card" aria-label="Brand Campaign Setup">
            <p className="card-kicker">Campaign Filters</p>
            <h2 className="card-title">Campaign Specs</h2>

            {/* Brand Mind summary chip */}
            <div style={{ background: 'var(--bg)', border: '1.5px solid var(--ink)', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.76rem', lineHeight: 1.5 }}>
              <p style={{ margin: '0 0 0.25rem', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 800, textTransform: 'uppercase' }}>Your Brand Mind</p>
              <p style={{ margin: '0.1rem 0' }}>🏭 {account.industry} · 📱 {account.targetPlatform}</p>
              <p style={{ margin: '0.1rem 0' }}>🎬 {account.collabFormat}</p>
              <p style={{ margin: '0.1rem 0' }}>💰 {account.budgetTier}</p>
              <p style={{ margin: '0.1rem 0', color: 'var(--muted)', fontSize: '0.68rem' }}>🛡️ {account.guardrails}</p>
            </div>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Campaign Title / Angle</span>
                <input className="field-input" placeholder="e.g. Summer AI Tool Launch Q3" value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} />
              </label>

              <div className="field-row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Target Niche</span>
                  <select className="field-input" value={selectedNiche} onChange={(e) => setSelectedNiche(e.target.value)}>
                    {NICHES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Platform</span>
                  <select className="field-input" value={selectedPlatform} onChange={(e) => setSelectedPlatform(e.target.value)}>
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
                  <input className="field-input" type="number" min="0" step="1000" placeholder="0" value={minFollowers} onChange={(e) => setMinFollowers(e.target.value)} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Avg Target Views</span>
                  <input className="field-input" type="number" min="0" step="1000" placeholder="5000" value={minViews} onChange={(e) => setMinViews(e.target.value)} />
                </label>
              </div>

              <div className="field-row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Language</span>
                  <select className="field-input" value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}>
                    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Budget / Creator ($)</span>
                  <input className="field-input" type="number" min="0" step="50" placeholder="250" value={budgetPerCreator} onChange={(e) => setBudgetPerCreator(e.target.value)} />
                </label>
              </div>

              <label className="field">
                <span className="field-label">Creative Brief / Key Talking Points</span>
                <textarea className="field-input" rows={3} placeholder="Key message, CTA, discount code, compliance requirements..." value={campaignBrief} onChange={(e) => setCampaignBrief(e.target.value)} />
              </label>
            </div>
          </aside>

          {/* Right: Matching Creators */}
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
                <p className="mind-empty-title">No Matching Creators Found</p>
                <p className="mind-empty-subtitle">Try lowering the minimum follower requirement or selecting "All Niches".</p>
              </div>
            ) : (
              <div className="brand-creator-cards-grid">
                {creators.map((c) => {
                  const name = c.creatorId.startsWith('u_') ? c.creatorId.slice(2) : c.creatorId
                  const isSent = proposalSentId === c.creatorId
                  return (
                    <article key={c.creatorId} className="card brand-creator-card">
                      <div className="creator-card-top">
                        <div className="brand-creator-avatar">{name.charAt(0).toUpperCase()}</div>
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
                          <span className="stat-label">Min Rate</span>
                          <span className="stat-val">
                            {c.brandMinRate && c.brandMinRate > 0 ? `$${c.brandMinRate}` : c.minRate && c.minRate > 0 ? `$${c.minRate}` : 'Flex'}
                          </span>
                        </div>
                        <div className="creator-stat">
                          <span className="stat-label">Lang</span>
                          <span className="stat-val">{c.languages.join(', ').toUpperCase()}</span>
                        </div>
                      </div>
                      {c.guardrails && (
                        <p className="creator-guardrail-snippet">🛡️ <em>"{c.guardrails.slice(0, 70)}..."</em></p>
                      )}
                      <div className="creator-card-actions">
                        <button
                          type="button"
                          className={`btn btn-block ${isSent ? 'btn-ghost' : ''}`}
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

        {/* Proposal Modal */}
        {activeModalCreator && (
          <div className="escrow-modal-overlay" role="dialog" aria-modal="true">
            <div className="card escrow-modal">
              <div className="escrow-modal-header">
                <div>
                  <p className="card-kicker">Instant Sponsorship Pitch</p>
                  <h3 className="card-title">Pitch to {activeModalCreator.creatorId.replace('u_', '')}</h3>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveModalCreator(null)}>✕</button>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Offer Amount ($)</span>
                  <input className="field-input" type="number" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} disabled={sendingProposal} />
                </label>
                <label className="field">
                  <span className="field-label">Deliverable</span>
                  <input className="field-input" value={contentType} readOnly disabled />
                </label>
                <label className="field">
                  <span className="field-label">Message to Creator's Mind</span>
                  <textarea className="field-input" rows={4} value={offerText} onChange={(e) => setOfferText(e.target.value)} disabled={sendingProposal} />
                </label>
                {proposalStatus && (
                  <p className={proposalStatus.includes('⚡') ? 'form-success' : 'form-error'}>{proposalStatus}</p>
                )}
                <div className="mind-save-actions">
                  <button type="button" className="btn" onClick={() => void handleSendProposal()} disabled={sendingProposal || offerText.trim() === ''}>
                    {sendingProposal ? 'Sending…' : 'Confirm & Dispatch to Creator Mind ⚡'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setActiveModalCreator(null)} disabled={sendingProposal}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live Negotiation Viewer */}
        {liveNegotiation !== null && (
          <div className="escrow-modal-overlay" role="dialog" aria-modal="true">
            <div style={{ maxWidth: '44rem', width: '100%', margin: '1.5rem auto' }}>
              <NegotiationLive
                targetId={liveNegotiation.targetId}
                targetName={liveNegotiation.targetName}
                onClose={() => setLiveNegotiation(null)}
                onCompleted={() => setLiveNegotiation(null)}
              />
            </div>
          </div>
        )}
      </main>
    </Shell>
  )
}
