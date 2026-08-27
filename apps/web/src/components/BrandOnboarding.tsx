import { useState } from 'react'
import { brandRegister, brandLogin, type BrandAccountInfo } from '../brand_api'

const INDUSTRIES = [
  'Tech & AI', 'Gaming & Esports', 'Fashion & Beauty', 'Food & Beverage',
  'Fitness & Health', 'Finance & Fintech', 'Music & Entertainment', 'Education & EdTech',
  'Travel & Lifestyle', 'E-commerce & D2C', 'SaaS & Productivity', 'Other',
]

const PLATFORMS = [
  'Instagram', 'TikTok', 'YouTube', 'Twitter / X',
  'LinkedIn', 'Twitch', 'Multi-Platform',
]

const FORMATS = [
  'Dedicated 60s Reel / TikTok',
  'YouTube 90s Integration',
  'Full Dedicated Video',
  'Instagram Story + Link Sticker',
  'UGC Ad Creative Asset',
  'Multi-Platform Bundle',
]

const BUDGETS = [
  '$100 - $300 (Nano/Micro Tier)',
  '$300 - $1,000 (Mid-tier Growth)',
  '$1,000 - $5,000 (Macro Reach)',
  '$5,000+ (Premium Flagship)',
]

interface Props {
  onDone: (account: BrandAccountInfo) => void
}

type Mode = 'register' | 'login'

export default function BrandOnboarding({ onDone }: Props) {
  const [mode, setMode] = useState<Mode>('register')
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Auth fields
  const [handle, setHandle] = useState('')
  const [brandName, setBrandName] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')

  // Mind fields
  const [industry, setIndustry] = useState(INDUSTRIES[0]!)
  const [targetPlatform, setTargetPlatform] = useState(PLATFORMS[0]!)
  const [collabFormat, setCollabFormat] = useState(FORMATS[0]!)
  const [budgetTier, setBudgetTier] = useState(BUDGETS[1]!)
  const [guardrails, setGuardrails] = useState('Family-friendly content only')

  // Login fields
  const [loginHandle, setLoginHandle] = useState('')
  const [loginPin, setLoginPin] = useState('')

  const totalSteps = 6

  async function handleRegister() {
    setLoading(true)
    setError(null)
    try {
      const result = await brandRegister({ handle, pin, brandName, industry, targetPlatform, collabFormat, budgetTier, guardrails })
      onDone(result.account)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin() {
    setLoading(true)
    setError(null)
    try {
      const account = await brandLogin(loginHandle, loginPin)
      onDone(account)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function nextStep() {
    setError(null)
    if (step === 0) {
      if (!brandName.trim()) { setError('Brand name is required'); return }
      if (!/^[a-z0-9_]{3,24}$/.test(handle)) { setError('Username must be 3-24 lowercase letters/numbers/underscores'); return }
      if (!/^\d{4,12}$/.test(pin)) { setError('PIN must be 4-12 digits'); return }
      if (pin !== pinConfirm) { setError('PINs do not match'); return }
    }
    setStep((s) => Math.min(s + 1, totalSteps - 1))
  }

  function prevStep() {
    setError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  // LOGIN MODE
  if (mode === 'login') {
    return (
      <div className="brand-onboarding">
        <div className="card onboarding" style={{ maxWidth: '28rem', margin: '3rem auto' }}>
          <p className="card-kicker">Brand Portal — Sign In</p>
          <h2 className="card-title">Welcome Back</h2>
          <div className="onboarding-form" style={{ marginTop: '1.2rem' }}>
            <label className="field">
              <span className="field-label">Brand Username</span>
              <input
                className="field-input"
                placeholder="your_brand_handle"
                value={loginHandle}
                onChange={(e) => setLoginHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              />
            </label>
            <label className="field">
              <span className="field-label">4-Digit PIN</span>
              <input
                className="field-input"
                type="password"
                inputMode="numeric"
                placeholder="••••"
                maxLength={12}
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button
              className="btn btn-block"
              onClick={() => void handleLogin()}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
            <button
              className="btn btn-ghost btn-block"
              onClick={() => { setMode('register'); setError(null) }}
            >
              ← New Brand? Register Here
            </button>
          </div>
        </div>
      </div>
    )
  }

  // REGISTER MODE — 6-step wizard
  const progressPct = Math.round(((step + 1) / totalSteps) * 100)

  return (
    <div className="brand-onboarding">
      <div className="brand-onboarding-hero">
        <p className="hero-kicker" style={{ justifyContent: 'center' }}>N°Brand — Brand Portal</p>
        <h1 className="brand-onboarding-title">Activate Your Brand Mind</h1>
        <p className="brand-onboarding-sub">
          Set up your Brand Identity in 6 steps. Your AI Brand Mind will autonomously
          negotiate deals with creators on your behalf.
        </p>
      </div>

      <div className="card onboarding brand-onboarding-card">
        {/* Progress bar */}
        <div className="brand-ob-progress">
          <div className="brand-ob-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="brand-ob-step-label">
          Step {step + 1} of {totalSteps}
        </p>

        {/* Step 0: Brand Identity + Auth */}
        {step === 0 && (
          <div className="onboarding-form">
            <p className="card-kicker">Identity & Access</p>
            <h2 className="card-title">Brand Details</h2>
            <label className="field">
              <span className="field-label">Brand / Product Name *</span>
              <input
                className="field-input"
                placeholder="e.g. OpenAI, Gymshark, Notion"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">Brand Username *  <span className="field-hint">(unique @handle, lowercase)</span></span>
              <input
                className="field-input"
                placeholder="e.g. acme_corp"
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field-label">4-12 Digit PIN *</span>
                <input
                  className="field-input"
                  type="password"
                  inputMode="numeric"
                  placeholder="••••"
                  maxLength={12}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label className="field">
                <span className="field-label">Confirm PIN *</span>
                <input
                  className="field-input"
                  type="password"
                  inputMode="numeric"
                  placeholder="••••"
                  maxLength={12}
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                />
              </label>
            </div>
          </div>
        )}

        {/* Step 1: Industry */}
        {step === 1 && (
          <div className="onboarding-form">
            <p className="card-kicker">Question 1 of 5</p>
            <h2 className="card-title">Brand Industry</h2>
            <p className="card-body">What industry or category is your brand in?</p>
            <div className="chips">
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind}
                  type="button"
                  className={`chip ${industry === ind ? 'chip--selected' : ''}`}
                  onClick={() => setIndustry(ind)}
                >
                  {ind}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Target Platform */}
        {step === 2 && (
          <div className="onboarding-form">
            <p className="card-kicker">Question 2 of 5</p>
            <h2 className="card-title">Target Platform</h2>
            <p className="card-body">Where do you primarily want creator content to run?</p>
            <div className="chips">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip ${targetPlatform === p ? 'chip--selected' : ''}`}
                  onClick={() => setTargetPlatform(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Ad Format */}
        {step === 3 && (
          <div className="onboarding-form">
            <p className="card-kicker">Question 3 of 5</p>
            <h2 className="card-title">Ad Deliverable Format</h2>
            <p className="card-body">What type of creator content do you need?</p>
            <div className="chips-col">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chip ${collabFormat === f ? 'chip--selected' : ''}`}
                  onClick={() => setCollabFormat(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Budget */}
        {step === 4 && (
          <div className="onboarding-form">
            <p className="card-kicker">Question 4 of 5</p>
            <h2 className="card-title">Budget Tier per Creator</h2>
            <p className="card-body">How much are you willing to pay per creator sponsorship?</p>
            <div className="chips-col">
              {BUDGETS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`chip ${budgetTier === b ? 'chip--selected' : ''}`}
                  onClick={() => setBudgetTier(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Guardrails */}
        {step === 5 && (
          <div className="onboarding-form">
            <p className="card-kicker">Question 5 of 5</p>
            <h2 className="card-title">Safety Rules & Guardrails</h2>
            <p className="card-body">What content rules must creators follow? Your Mind will enforce these automatically.</p>
            <label className="field">
              <span className="field-label">Mandatory brand guardrails</span>
              <textarea
                className="field-input"
                rows={4}
                placeholder="e.g. Family-friendly only. No competitor mentions. Must disclose #ad. Avoid political topics."
                value={guardrails}
                onChange={(e) => setGuardrails(e.target.value)}
              />
            </label>

            {/* Final summary */}
            <div style={{ marginTop: '0.5rem', padding: '0.9rem', background: 'var(--bg)', border: '1.5px solid var(--ink)', fontSize: '0.78rem', lineHeight: 1.5 }}>
              <p style={{ margin: '0 0 0.3rem', fontWeight: 800, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontSize: '0.65rem' }}>Brand Mind Summary</p>
              <p style={{ margin: '0.15rem 0' }}>🏷️ <strong>{brandName}</strong> (@{handle})</p>
              <p style={{ margin: '0.15rem 0' }}>🏭 {industry} · 📱 {targetPlatform}</p>
              <p style={{ margin: '0.15rem 0' }}>🎬 {collabFormat}</p>
              <p style={{ margin: '0.15rem 0' }}>💰 {budgetTier}</p>
            </div>
          </div>
        )}

        {error && <p className="form-error" style={{ marginTop: '0.8rem' }}>{error}</p>}

        {/* Navigation */}
        <div className="brand-ob-nav">
          {step > 0 && (
            <button className="btn btn-ghost" onClick={prevStep} disabled={loading}>
              ← Back
            </button>
          )}
          {step < totalSteps - 1 ? (
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={nextStep}>
              Next →
            </button>
          ) : (
            <button
              className="btn"
              style={{ marginLeft: 'auto', background: 'var(--accent)' }}
              onClick={() => void handleRegister()}
              disabled={loading}
            >
              {loading ? 'Activating…' : 'Activate Brand Mind ⚡'}
            </button>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Already registered?{' '}
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', fontSize: 'inherit', padding: 0 }}
            onClick={() => { setMode('login'); setError(null) }}
          >
            Sign In →
          </button>
        </p>
      </div>
    </div>
  )
}
