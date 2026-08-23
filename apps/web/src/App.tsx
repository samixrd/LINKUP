import { useEffect, useRef, useState } from 'react'
import { fetchMe, logoutAccount } from './api'
import type { CreatorProfile } from './api'
import { clearStoredCreatorId, getStoredCreatorId, storeCreatorId } from './creator'
import Onboarding from './components/Onboarding'
import Shell from './components/Shell'
import { QrSticker, SmileySticker, StarSticker } from './components/Stickers'
import MindPage from './pages/MindPage'

type View =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'ready'; profile: CreatorProfile }

function isMindRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/mind'
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
    if (isMindRoute()) return
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
      </main>
    </Shell>
  )
}
