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

const CRAFTS = ['Music & Audio', 'Video & Cinema', 'Digital Art & 3D', 'Writing & Essays', 'Live Streaming', 'Street & Film Photo', 'Gaming & Esports', 'Comedy & Skits', 'Science & Education', 'Fitness & Wellness', 'Culinary & Food', 'Tech & AI Coding']
const PLATFORMS = ['YouTube (Long)', 'TikTok', 'Instagram Reels', 'Twitch', 'X (Twitter)', 'Apple/Spotify Podcast', 'Substack Newsletter', 'Discord Community']
const AUDIENCE = ['Under 1K (Early Stage)', '1K - 10K (Micro-Creator)', '10K - 50K (Rising Voice)', '50K - 250K (Established)', '250K - 1M+ (Major Platform)']
const AVIEWS = ['< 1K views', '1K - 10K views', '10K - 50K views', '50K - 200K views', '200K+ viral reach']
const LANGS = ['English', 'Bangla (বাংলা)', 'Hindi (हिंदी)', 'Spanish (Español)', 'Arabic (العربية)', 'Portuguese (Português)', 'French (Français)']
const FORMATS = ['Viral Short-Form (Reels/Shorts)', 'Deep-Dive Long Form Video', 'Co-Hosted Live Stream / Podcast', 'Interactive Challenge & Collab Quest', 'Written Editorial & Case Study']
const FREQ = ['Daily High-Velocity', '2-3 Times a Week (Consistent)', 'Weekly Deep-Dives', 'Monthly Masterpieces / Episodic']
const GOALS = [
  { label: '🚀 Rapid Audience Cross-Pollination', memory: 'My primary goal: explosive audience growth — my Mind should actively find creators in complementary niches for high-converting cross-promotion and shared series.' },
  { label: '💰 High-Ticket Monetization & Brands', memory: 'My primary goal: maximize creator revenue — prioritize high-budget paid collabs, brand sponsorships, and structured rev-share deals.' },
  { label: '🤝 Long-Term Co-Creation Partner', memory: 'My primary goal: build recurring co-creation partnerships — find synergistic creators to launch recurring joint shows, podcasts, or digital products.' },
  { label: '⚡ Creative Mastery & Mentorship', memory: 'My primary goal: level up production and storytelling craft — partner with technical masters or slightly bigger creators who elevate my content quality.' },
]
const VIBES = [
  { label: '🎯 Precise, Deadline-Driven & Pro', memory: 'Collaboration style: highly professional, clear timelines, zero ghosting, contract-backed deliverables.' },
  { label: '🌊 Chill, Organic & Spontaneous', memory: 'Collaboration style: low-pressure, organic chemistry, flexible creative flow without rigid scripts.' },
  { label: '🧪 Wildly Experimental & Boundary-Pushing', memory: 'Collaboration style: unconventional concepts, crazy creative risks, avant-garde formats.' },
  { label: '📈 Fast-Paced, Trend-Jacking & Viral', memory: 'Collaboration style: high energy, fast turnaround, meme and algorithm-optimized execution.' },
]
const DEALS = [
  { label: '💵 Paid Collaborations Only (Set Rate)', memory: 'Deal terms policy: strictly paid engagements — my Mind will decline unpaid offers and enforce my minimum rate.' },
  { label: '🔄 50/50 Revenue Share & Split Royalties', memory: 'Deal terms policy: 50/50 revenue share on all joint production, ad revenue, or affiliate conversions.' },
  { label: '⚡ Pure Barter & Audience Exchange (S4S)', memory: 'Deal terms policy: barter & shoutout exchange — equal value cross-features, guest appearances, and mutual shoutouts.' },
  { label: '🆓 Free Creative Playground (Impact First)', memory: 'Deal terms policy: open creative collaboration — focus on portfolio, impact, and reach, no monetary exchange needed.' },
  { label: '🌐 Dynamic / Mind-Negotiated Custom Terms', memory: 'Deal terms policy: flexible hybrid terms — let my Mind negotiate the best mix of cash, rev-share, and cross-promo per deal.' },
]
const SMALLS = [
  { label: '🌟 Absolutely — Brilliant Ideas Over Size', memory: 'Partner policy: open to new/smaller creators regardless of follower count if their concept and talent are elite.' },
  { label: '⚖️ Peer-Level Only (Similar Follower Range)', memory: 'Partner policy: equal-tier collaborators only — minimum partner audience should match my current scale.' },
  { label: '🏆 Verified / Established Creators Only', memory: 'Partner policy: selective gatekeeping — only partner with established channels with proven high engagement.' },
]

type Phase =
  | 'welcome' | 'craft' | 'platforms' | 'audience' | 'avgViews' | 'langs'
  | 'format' | 'freq' | 'goal' | 'deal' | 'small' | 'vibe' | 'identity' | 'login'

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
  const [avgViews, setAvgViews] = useState('')
  const [langs, setLangs] = useState<string[]>([])
  const [format, setFormat] = useState('')
  const [freq, setFreq] = useState('')
  const [goal, setGoal] = useState<{ label: string; memory: string } | null>(null)
  const [deal, setDeal] = useState<{ label: string; memory: string } | null>(null)
  const [small, setSmall] = useState<{ label: string; memory: string } | null>(null)
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
      const memories: Array<{ category: 'goal' | 'preference' | 'constraint'; content: string }> = []
      if (crafts.length > 0) {
        memories.push({ category: 'preference', content: `Primary creative niche: ${crafts.join(', ')}` })
      }
      if (platforms.length > 0) {
        memories.push({
          category: 'preference',
          content: `Active distribution platforms: ${platforms.join(', ')}${audience ? ` (scale: ${audience})` : ''}`,
        })
      }
      if (audience) memories.push({ category: 'preference', content: `Current creator audience size: ${audience}` })
      if (avgViews) memories.push({ category: 'preference', content: `Average retention / view velocity: ${avgViews}` })
      if (langs.length > 0) memories.push({ category: 'preference', content: `Languages created in: ${langs.join(', ')}` })
      if (format) memories.push({ category: 'preference', content: `Signature content format: ${format}` })
      if (freq) memories.push({ category: 'preference', content: `Production & posting cadence: ${freq}` })
      if (goal) memories.push({ category: 'goal', content: goal.memory })
      if (deal) memories.push({ category: 'constraint', content: deal.memory })
      if (small) memories.push({ category: 'constraint', content: small.memory })
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
    { welcome: 0, craft: 1, platforms: 2, audience: 3, avgViews: 4, langs: 5, format: 6, freq: 7, goal: 8, deal: 9, small: 10, vibe: 11, identity: 12, login: 12 }[phase]
  const TOTAL_STEPS = 12

  return (
    <section className="card onboarding" aria-label="Set up your Mind">
      <p className="card-kicker">
        {phase === 'login' ? 'Welcome back' : `Step ${stepIndex} of ${TOTAL_STEPS}`}
      </p>

      {phase === 'welcome' && (
        <>
          <h2 className="card-title">Meet Your Creative Mind</h2>
          <p className="card-body">
            12 quick insights — LINKUP builds a persistent AI Mind that knows your voice,
            negotiates deal terms on your behalf, and auto-discovers high-fit collaborators.
          </p>
          <div className="btn-stack">
            <NextButton disabled={false} onClick={() => setPhase('craft')} label="Initialize Mind (60s) →" />
            <button className="btn btn-ghost btn-block" onClick={() => setPhase('login')}>
              I already have an account
            </button>
          </div>
        </>
      )}

      {/* Step 1: Creative Domain */}
      {phase === 'craft' && (
        <>
          <h2 className="card-title">What is your primary craft?</h2>
          <p className="card-body">Select all niches where you produce or publish content.</p>
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

      {/* Step 2: Distribution Platforms */}
      {phase === 'platforms' && (
        <>
          <h2 className="card-title">Where do you broadcast?</h2>
          <p className="card-body">Your Mind connects with creators whose audience lives on these channels.</p>
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

      {/* Step 3: Audience Scale */}
      {phase === 'audience' && (
        <>
          <h2 className="card-title">What is your total audience size?</h2>
          <p className="card-body">Helps your Mind gauge equal-tier reach and calculate fair revenue splits.</p>
          <div className="chips chips-col">
            {AUDIENCE.map((a) => (
              <Chip key={a} active={audience === a} onClick={() => setAudience(a)}>
                {a}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!audience} onClick={() => setPhase('avgViews')} label="Continue →" />
        </>
      )}

      {/* Step 4: Typical View Velocity */}
      {phase === 'avgViews' && (
        <>
          <h2 className="card-title">Average impressions per release?</h2>
          <p className="card-body">Your Mind uses actual view velocity to defend your rates during negotiation.</p>
          <div className="chips chips-col">
            {AVIEWS.map((v) => (
              <Chip key={v} active={avgViews === v} onClick={() => setAvgViews(v)}>
                {v}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!avgViews} onClick={() => setPhase('langs')} label="Continue →" />
        </>
      )}

      {/* Step 5: Working Languages */}
      {phase === 'langs' && (
        <>
          <h2 className="card-title">Which languages do you speak?</h2>
          <p className="card-body">Your Mind ensures language parity or auto-proposes bilingual subtitle clauses.</p>
          <div className="chips">
            {LANGS.map((l) => (
              <Chip key={l} active={langs.includes(l)} onClick={() => toggle(langs, l, setLangs)}>
                {l}
              </Chip>
            ))}
          </div>
          <NextButton disabled={langs.length === 0} onClick={() => setPhase('format')} label="Continue →" />
        </>
      )}

      {/* Step 6: Core Content Format */}
      {phase === 'format' && (
        <>
          <h2 className="card-title">Your signature content format?</h2>
          <p className="card-body">Shapes the collaboration blueprints generated during autonomous dealmaking.</p>
          <div className="chips chips-col">
            {FORMATS.map((f) => (
              <Chip key={f} active={format === f} onClick={() => setFormat(f)}>
                {f}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!format} onClick={() => setPhase('freq')} label="Continue →" />
        </>
      )}

      {/* Step 7: Release Cadence */}
      {phase === 'freq' && (
        <>
          <h2 className="card-title">How frequently do you ship?</h2>
          <p className="card-body">Ensures partner timelines align with your production schedule.</p>
          <div className="chips chips-col">
            {FREQ.map((f) => (
              <Chip key={f} active={freq === f} onClick={() => setFreq(f)}>
                {f}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!freq} onClick={() => setPhase('goal')} label="Continue →" />
        </>
      )}

      {/* Step 8: #1 Strategic Objective */}
      {phase === 'goal' && (
        <>
          <h2 className="card-title">What is your #1 growth priority?</h2>
          <p className="card-body">Your Mind aligns every negotiation strategy to fulfill this exact goal.</p>
          <div className="chips chips-col">
            {GOALS.map((g) => (
              <Chip key={g.label} active={goal?.label === g.label} onClick={() => setGoal(g)}>
                {g.label}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!goal} onClick={() => setPhase('deal')} label="Continue →" />
        </>
      )}

      {/* Step 9: Deal Structure & Terms */}
      {phase === 'deal' && (
        <>
          <h2 className="card-title">What compensation model do you prefer?</h2>
          <p className="card-body">Your Mind will strictly protect these commercial guardrails during deals.</p>
          <div className="chips chips-col">
            {DEALS.map((d) => (
              <Chip key={d.label} active={deal?.label === d.label} onClick={() => setDeal(d)}>
                {d.label}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!deal} onClick={() => setPhase('small')} label="Continue →" />
        </>
      )}

      {/* Step 10: Partner Scale Preference */}
      {phase === 'small' && (
        <>
          <h2 className="card-title">What is your partner size policy?</h2>
          <p className="card-body">Controls whether your Mind filters for established peers or welcomes rising talent.</p>
          <div className="chips chips-col">
            {SMALLS.map((s) => (
              <Chip key={s.label} active={small?.label === s.label} onClick={() => setSmall(s)}>
                {s.label}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!small} onClick={() => setPhase('vibe')} label="Continue →" />
        </>
      )}

      {/* Step 11: Creative Chemistry & Work Vibe */}
      {phase === 'vibe' && (
        <>
          <h2 className="card-title">What is your collaboration workstyle?</h2>
          <p className="card-body">Matches you with creators who share your exact operational rhythm.</p>
          <div className="chips chips-col">
            {VIBES.map((v) => (
              <Chip key={v.label} active={vibe?.label === v.label} onClick={() => setVibe(v)}>
                {v.label}
              </Chip>
            ))}
          </div>
          <NextButton disabled={!vibe} onClick={() => setPhase('identity')} label="Final Step: Claim Identity →" />
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
