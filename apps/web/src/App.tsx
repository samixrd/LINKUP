import { useEffect, useRef, useState } from 'react'
import { fetchMe, logoutAccount } from './api'
import type { CreatorProfile } from './api'
import { clearStoredCreatorId, getStoredCreatorId, storeCreatorId } from './creator'
import Onboarding from './components/Onboarding'
import Shell from './components/Shell'
import { QrSticker, SmileySticker, StarSticker } from './components/Stickers'
import MindPage from './pages/MindPage'
import BrandPage from './pages/BrandPage'

type View =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'ready'; profile: CreatorProfile }

function isMindRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/mind'
}

function isBrandRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/brand'
}

/**
 * The animated LINKUP wordmark. It bobs gently on its own and tilts in 3D
 * toward the cursor, so the big name feels alive and moveable. The tilt is
 * driven by CSS custom properties so the motion stays in CSS-land; pointer
 * and reduced-motion preferences are respected.
 */
function HeroWordmark() {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    const onMove = (event: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width
      const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height
      el.style.setProperty('--ry', `${(dx * 8).toFixed(2)}deg`)
      el.style.setProperty('--rx', `${(dy * -6).toFixed(2)}deg`)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])
  return (
    <h1 className="display" ref={ref}>
      <span className="display-inner">
        LINKUP<span className="display-star" aria-hidden="true">*</span>
      </span>
    </h1>
  )
}

export default function App() {
  // Session-first: the cookie decides. The old localStorage creator id is
  // still honored as a migration path for existing users.
  const [view, setView] = useState<View>({ name: 'loading' })

  useEffect(() => {
    if (isMindRoute() || isBrandRoute()) return
    let cancelled = false
    async function boot() {
      try {
        const me = await fetchMe()
        if (!cancelled && me?.profile) {
          storeCreatorId(me.creatorId)
          setView({ name: 'ready', profile: me.profile })
          return
        }
      } catch {
        // fall through to legacy/localStorage check
      }
      const legacy = getStoredCreatorId()
      if (!cancelled) setView(legacy === null ? { name: 'onboarding' } : { name: 'loading' })
      if (legacy !== null) {
        // No valid session but a legacy local creator — send to onboarding's
        // sign-in card by clearing stale identity.
        clearStoredCreatorId()
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  if (isBrandRoute()) {
    return <BrandPage />
  }

  if (isMindRoute()) {
    return <MindPage />
  }

  function handleOnboarded(result: { creatorId: string; displayName: string }) {
    storeCreatorId(result.creatorId)
    setView({
      name: 'ready',
      profile: {
        creatorId: result.creatorId,
        displayName: result.displayName,
        bio: '',
        avatarUrl: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
  }

  async function handleLogout() {
    await logoutAccount()
    clearStoredCreatorId()
    setView({ name: 'onboarding' })
  }

  return (
    <Shell>
      <main className="landing">
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-kicker">N°001 — Creator network</p>
            <HeroWordmark />
            <p className="tagline">
              A <span className="hl">persistent Mind</span> for creators — remember, connect,
              collaborate.
            </p>
            <ul className="hero-feats" aria-label="What LINKUP provides">
              <li>Memory</li>
              <li>Matching</li>
              <li>Collaboration</li>
            </ul>

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href="#features">
                Explore Features ↓
              </a>
              <a className="btn btn-ghost" href="/brand">
                Brand & Ads Portal ↗
              </a>
            </div>
          </div>

          <div className="hero-side">
            <SmileySticker className="sticker sticker--smiley" />
            <StarSticker className="sticker sticker--star" />
            <QrSticker className="sticker sticker--qr" />

            {view.name === 'onboarding' && <Onboarding onDone={handleOnboarded} />}

            {view.name === 'ready' && (
              <section className="card" aria-label="Your Mind is ready">
                <p className="card-kicker">Your Mind is ready</p>
                <h2 className="card-title">{view.profile.displayName}</h2>
                {view.profile.bio !== '' && <p className="card-body">{view.profile.bio}</p>}
                <p className="card-meta">
                  Creator id: <code>{view.profile.creatorId}</code>
                </p>
                <a className="btn btn-block" href="/mind">
                  Open Mind Chat →
                </a>
                <button className="btn btn-ghost btn-block" onClick={handleLogout}>
                  Sign out
                </button>
              </section>
            )}

            {view.name === 'loading' && (
              <section className="card card--loading" aria-label="Loading your Mind" aria-busy="true">
                <div className="skeleton">
                  <div className="skeleton-line" style={{ width: '45%' }} />
                  <div className="skeleton-line" style={{ width: '70%' }} />
                  <div className="skeleton-line" style={{ width: '90%' }} />
                </div>
              </section>
            )}
          </div>
        </section>

        {/* SECTION 2: HOW IT WORKS & ARCHITECTURE */}
        <section id="features" className="landing-section">
          <div className="landing-section-header">
            <p className="hero-kicker">N°002 — How It Works</p>
            <h2 className="landing-section-title">Autonomous Mind-vs-Mind Architecture</h2>
            <p className="landing-section-sub">
              No manual DMs or endless back-and-forth. Each creator deploys a personal AI Mind that guards rates, evaluates creative compatibility, and executes deals.
            </p>
          </div>

          <div className="landing-grid-3">
            <div className="card landing-feature-card">
              <div className="landing-card-num">01</div>
              <p className="card-kicker">Cognitive Layer</p>
              <h3 className="card-title">Persistent Memory & Guardrails</h3>
              <p className="card-body">
                Your Mind remembers your niche, minimum payout floors, preferred formats, and strict redlines. Context stays alive across sessions.
              </p>
              <div className="landing-badge-list">
                <span className="badge">Audience Thresholds</span>
                <span className="badge">Format Preferences</span>
                <span className="badge">Niche Scoring</span>
              </div>
            </div>

            <div className="card landing-feature-card">
              <div className="landing-card-num">02</div>
              <p className="card-kicker">Multi-Agent Protocol</p>
              <h3 className="card-title">Mind-to-Mind Negotiation</h3>
              <p className="card-body">
                When matched, both creator Minds autonomously dialogue over deliverables, revenue splits, and timeline terms up to 3 strategic rounds.
              </p>
              <div className="landing-badge-list">
                <span className="badge">Agreement Score %</span>
                <span className="badge">Deliverable Alignment</span>
                <span className="badge">Counter-Offers</span>
              </div>
            </div>

            <div className="card landing-feature-card">
              <div className="landing-card-num">03</div>
              <p className="card-kicker">Execution Layer</p>
              <h3 className="card-title">Escrow & Mutual Signing</h3>
              <p className="card-body">
                Contracts only finalize when both creators sign the AI-synthesized blueprint. Escrow deposits lock automatically until proof of delivery.
              </p>
              <div className="landing-badge-list">
                <span className="badge">Dual Cryptographic Sign</span>
                <span className="badge">Automated Escrow</span>
                <span className="badge">Live Follow-Ups</span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: KEY CAPABILITIES & COMPARISON */}
        <section className="landing-section landing-section--alt">
          <div className="landing-section-header">
            <p className="hero-kicker">N°003 — Engine Capabilities</p>
            <h2 className="landing-section-title">Built for Modern Creator Ecosystems</h2>
            <p className="landing-section-sub">
              A high-precision matchmaking and autonomous deal settlement protocol built from ground up.
            </p>
          </div>

          <div className="landing-stats-row">
            <div className="card landing-stat-card">
              <div className="landing-stat-val">30s</div>
              <div className="landing-stat-lbl">Autonomous Follow-Up Scan</div>
              <p className="card-body" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Background worker scans pending deadlines and alerts your Mind proactively.
              </p>
            </div>

            <div className="card landing-stat-card">
              <div className="landing-stat-val">100%</div>
              <div className="landing-stat-lbl">Creator Privacy & Isolation</div>
              <p className="card-body" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Your private guardrails are never leaked to counter-parties during negotiation.
              </p>
            </div>

            <div className="card landing-stat-card">
              <div className="landing-stat-val">17+</div>
              <div className="landing-stat-lbl">Relational DB Migrations</div>
              <p className="card-body" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Strict ACID relational models powering escrow, verification, memories & proposals.
              </p>
            </div>

            <div className="card landing-stat-card">
              <div className="landing-stat-val">568</div>
              <div className="landing-stat-lbl">Automated Test Suites</div>
              <p className="card-body" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Full coverage across API, cognitive adapters, UI flows, and SQLite schemas.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 4: BRAND & SPONSORSHIP DISCOVERY */}
        <section className="landing-section">
          <div className="card landing-brand-banner">
            <div className="landing-brand-content">
              <p className="hero-kicker">N°004 — Brand Portal</p>
              <h2 className="landing-section-title">
                Direct Brand Ad Sponsorships
              </h2>
              <p className="landing-section-sub">
                Brands can filter verified creators by niche, audience reach, language, and content formats to dispatch instant AI-negotiated sponsorship proposals directly into creator Minds.
              </p>
              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <a className="btn btn-primary" href="/brand">
                  Launch Brand Campaign Builder ⚡
                </a>
                <a className="btn btn-ghost" href="/mind">
                  Enter Creator Workspace →
                </a>
              </div>
            </div>
            <div className="landing-brand-badges">
              <div className="badge" style={{ padding: '0.6rem 1rem', fontSize: '0.8rem' }}>⚡ Multi-Platform (YouTube / TikTok / IG)</div>
              <div className="badge" style={{ padding: '0.6rem 1rem', fontSize: '0.8rem' }}>🎯 Follower Floor & Target Views</div>
              <div className="badge" style={{ padding: '0.6rem 1rem', fontSize: '0.8rem' }}>🔒 Escrow Milestone Protection</div>
            </div>
          </div>
        </section>
      </main>
    </Shell>
  )
}
