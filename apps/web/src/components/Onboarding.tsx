import { useState } from 'react'
import type { FormEvent } from 'react'
import { loginAccount, registerAccount } from '../api'

/**
 * Tinder-style multi-step onboarding. Each step is one card with big tap
 * targets; answers become structured memories so the Mind starts with real
 * context, and the matching engine gets high-signal terms.
 */

export interface OnboardingResult {
  creatorId: string
  handle: string
  displayName: string
}

interface Props {
  onDone: (result: OnboardingResult) => void
}

const CRAFTS = ['Music', 'Video', 'Art', 'Writing', 'Streaming', 'Photography']
const PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'Twitch', 'X']
const AUDIENCE = ['Just starting', '~1k', '~10k', '~100k+']
const GOALS = [
  { label: 'Grow my audience', memory: 'Grow my audience and reach new viewers' },
  { label: 'Make money creating', memory: 'Monetize my content and find paid opportunities' },
  { label: 'Find collab partners', memory: 'Find creators to collaborate with regularly' },
  { label: 'Level up my craft', memory: 'Improve my creative skills through collaboration' },
]
const VIBES = [
  { label: 'Chill & flexible', memory: 'Prefers chill, low-pressure collaborators' },
  { label: 'Serious & consistent', memory: 'Prefers serious, consistent collaborators' },
  { label: 'Experimental', memory: 'Loves experimental, out-there ideas' },
  { label: 'Trendy & fast', memory: 'Wants fast-moving trend-driven collaborations' },
]

type Phase = 'welcome' | 'craft' | 'platforms' | 'audience' | 'goal' | 'vibe' | 'identity' | 'login'

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" className={`chip ${active ? 'chip--on' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

function NextButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button className="btn btn-block" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
}

export default function Onboarding({ onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('welcome')
  const [crafts, setCrafts] = useState<string[]>([])
  const [platforms, setPlatforms] = useState<string[]>([])
  const [audience, setAudience] = useState('')
  const [goal, setGoal] = useState<{ label: string; memory: string } | null>(null)
  const [vibe, setVibe] = useState<{ label: string; memory: string } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [pin, setPin] = useState('')
  const [loginHandle, setLoginHandle] = useState('')
  const [loginPin, setLoginPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggle(list: string[], value: string, setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])
  }

  async function finish(event?: FormEvent) {
    event?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const memories: Array<{ category: 'goal' | 'preference'; content: string }> = []
      if (crafts.length > 0) {
        memories.push({ category: 'preference', content: `I create: ${crafts.join(', ')}` })
      }
      if (platforms.length > 0) {
        memories.push({
          category: 'preference',
          content: `My platforms: ${platforms.join(', ')}${audience ? ` (audience ${audience})` : ''}`,
        })
      }
      if (goal) memories.push({ category: 'goal', content: goal.memory })
      if (vibe) memories.push({ category: 'preference', content: vibe.memory })

      const result = await registerAccount({
        handle: handle.trim().toLowerCase(),
        pin,
        displayName: displayName.trim(),
        memories,
      })
      onDone({
        creatorId: result.creatorId,
        handle: result.handle,
        displayName: displayName.trim(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  async function doLogin(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const me = await loginAccount(loginHandle.trim().toLowerCase(), loginPin)
      onDone({
        creatorId: me.creatorId,
        handle: me.handle,
        displayName: me.profile?.displayName ?? me.handle,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setBusy(false)
    }
  }

  // --- Card shells -------------------------------------------------------

  const stepIndex =
    { welcome: 0, craft: 1, platforms: 2, audience: 3, goal: 4, vibe: 5, identity: 6, login: 6 }[phase]

  
  return (
    <section className="card onboarding" aria-label="Set up your Mind">
      <p className="card-kicker">
        {phase === 'login' ? 'Welcome back' : `Step ${stepIndex} of 6`}
      </p>

      {phase === 'welcome' && (
        <>
          <h2 className="card-title">Meet your Mind</h2>
          <p className="card-body">
            Answer a few quick questions — LINKUP builds a persistent Mind that remembers you,
            matches you with the right creators, and follows up for you.
          </p>
          <div className="btn-stack">
            <NextButton disabled={false} onClick={() => setPhase('craft')} label="Start — it takes 60 seconds →" />
            <button className="btn btn-ghost btn-block" onClick={() => setPhase('login')}>
              I already have an account
            </button>
          </div>
        </>
      )}

      {phase === 'craft' && (
        <>
          <h2 className="card-title">What do you create?</h2>
          <div className="chips">
            {CRAFTS.map((c) => (
              <Chip key={c} active={crafts.includes(c)} onClick={() => toggle(crafts, c, setCrafts)}>
                {c}
              </Chip>
            ))}
          </div>
          <NextButton
            disabled={crafts.length === 0}
            onClick={() => setPhase('platforms')}
            label="Continue →"
          />
        </>
      )}

      {phase === 'platforms' && (
        <>
          <h2 className="card-title">Where do you post?</h2>
          <div className="chips">
            {PLATFORMS.map((p) => (
              <Chip key={p} active={platforms.includes(p)} onClick={() => toggle(platforms, p, setPlatforms)}>
                {p}
              </Chip>
            ))}
          </div>
          <NextButton
            disabled={platforms.length === 0}
            onClick={() => setPhase('audience')}
            label="Continue →"
          />
        </>
      )}

      {phase === 'audience' && (
        <>
          <h2 className="card-title">Audience size?</h2>
          <p className="card-body">No wrong answer — this helps match you fairly.</p>
          <div className="chips chips-col">
            {AUDIENCE.map((a) => (
              <Chip key={a} active={audience === a} onClick={() => setAudience(a)}>
                {a}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!audience} onClick={() => setPhase('goal')} label="Continue →" />
        </>
      )}

      {phase === 'goal' && (
        <>
          <h2 className="card-title">#1 goal right now?</h2>
          <div className="chips chips-col">
            {GOALS.map((g) => (
              <Chip key={g.label} active={goal?.label === g.label} onClick={() => setGoal(g)}>
                {g.label}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!goal} onClick={() => setPhase('vibe')} label="Continue →" />
        </>
      )}

      {phase === 'vibe' && (
        <>
          <h2 className="card-title">Your ideal collab partner is…</h2>
          <div className="chips chips-col">
            {VIBES.map((v) => (
              <Chip key={v.label} active={vibe?.label === v.label} onClick={() => setVibe(v)}>
                {v.label}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!vibe} onClick={() => setPhase('identity')} label="Last step →" />
        </>
      )}

      {phase === 'identity' && (
        <form onSubmit={finish}>
          <h2 className="card-title">Claim your handle</h2>
          <p className="card-body">
            Your Mind is ready to meet you. Pick a handle and a 4-digit PIN — that's your whole
            login.
          </p>
          <label className="field">
            <span className="field-label">Display name</span>
            <input
              className="field-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How should we know you?"
              maxLength={120}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Handle</span>
            <input
              className="field-input"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="lowercase_letters_only"
              maxLength={24}
              pattern="[a-z0-9_]{3,24}"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">PIN (4+ digits)</span>
            <input
              className="field-input"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              maxLength={12}
              minLength={4}
              required
            />
          </label>
          {error !== '' && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="btn-stack">
            <button className="btn btn-block" type="submit" disabled={busy}>
              {busy ? 'Building your Mind…' : 'Create my Mind ✨'}
            </button>
            <button
              className="btn btn-ghost btn-block"
              type="button"
              onClick={() => setPhase('welcome')}
              disabled={busy}
            >
              Back
            </button>
          </div>
        </form>
      )}

      {phase === 'login' && (
        <form onSubmit={doLogin}>
          <h2 className="card-title">Welcome back</h2>
          <label className="field">
            <span className="field-label">Handle</span>
            <input
              className="field-input"
              value={loginHandle}
              onChange={(e) => setLoginHandle(e.target.value.toLowerCase())}
              placeholder="your_handle"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">PIN</span>
            <input
              className="field-input"
              type="password"
              inputMode="numeric"
              value={loginPin}
              onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ''))}
              maxLength={12}
              required
            />
          </label>
          {error !== '' && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="btn-stack">
            <button className="btn btn-block" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in →'}
            </button>
            <button
              className="btn btn-ghost btn-block"
              type="button"
              onClick={() => setPhase('welcome')}
              disabled={busy}
            >
              Back
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
