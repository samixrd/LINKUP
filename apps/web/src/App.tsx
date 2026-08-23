import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, createProfile, getProfile } from './api'
import type { CreatorProfile } from './api'
import {
  clearStoredCreatorId,
  getStoredCreatorId,
  newCreatorId,
  storeCreatorId,
} from './creator'
import Shell from './components/Shell'
import { HandArrow, QrSticker, SmileySticker, StarSticker } from './components/Stickers'
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
  const [view, setView] = useState<View>(() =>
    getStoredCreatorId() === null ? { name: 'onboarding' } : { name: 'loading' },
  )
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isMindRoute()) return
    const creatorId = getStoredCreatorId()
    if (creatorId === null) return
    getProfile(creatorId)
      .then((profile) => setView({ name: 'ready', profile }))
      .catch(() => {
        // The stored identity no longer exists server-side; let the user set
        // up again instead of leaving them stuck on a broken profile.
        clearStoredCreatorId()
        setView({ name: 'onboarding' })
      })
  }, [])

  if (isMindRoute()) {
    return <MindPage />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const profile = await createProfile({
        creatorId: newCreatorId(),
        displayName: displayName.trim(),
        ...(bio.trim() !== '' ? { bio: bio.trim() } : {}),
      })
      storeCreatorId(profile.creatorId)
      setView({ name: 'ready', profile })
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the LINKUP API. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
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

            {view.name === 'onboarding' && (
              <>
                <div className="hand-note" aria-hidden="true">
                  <span className="hand-note-text">start here</span>
                  <HandArrow className="hand-note-arrow" />
                </div>
                <section className="card" aria-label="Set up your Mind">
                  <p className="card-kicker">N°002 — Onboarding</p>
                  <h2 className="card-title">Set up your Mind</h2>
                  <p className="card-body">
                    LINKUP keeps a persistent Mind of who you are, what you care about, and how you
                    like to collaborate.
                  </p>
                  <form className="onboarding-form" onSubmit={handleSubmit}>
                    <label className="field">
                      <span className="field-label">Display name</span>
                      <input
                        className="field-input"
                        type="text"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder="How should LINKUP know you?"
                        maxLength={120}
                        required
                        autoFocus
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">
                        Bio <span className="field-hint">(optional)</span>
                      </span>
                      <textarea
                        className="field-input"
                        value={bio}
                        onChange={(event) => setBio(event.target.value)}
                        placeholder="A line about you and your work."
                        rows={3}
                        maxLength={500}
                      />
                    </label>
                    {error !== '' && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="btn btn-block" type="submit" disabled={submitting}>
                      {submitting ? 'Creating your Mind…' : 'Create my Mind →'}
                    </button>
                  </form>
                </section>
              </>
            )}

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
