import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getHealth } from '../api'

type ApiStatus = 'checking' | 'online' | 'offline'

/** Polls the API health endpoint so the footer status chip reflects the real backend. */
function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('checking')
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      try {
        await getHealth()
        if (!cancelled) setStatus('online')
      } catch {
        if (!cancelled) setStatus('offline')
      }
      if (!cancelled) timer = setTimeout(() => void check(), 30_000)
    }
    void check()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  return status
}

/** Wall-clock timestamp for the footer meta bar, refreshed every second. */
function useClockTick(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function formatStamp(now: Date): string {
  const date = now
    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .toUpperCase()
  const time = now.toLocaleTimeString('en-US', { hour12: false })
  return `${date} — ${time}`
}

/**
 * Shared page chrome: the thin viewport frame, the header (logo + primary nav)
 * and the footer meta bar with a live API status chip. Contains no forms or
 * text inputs so it never interferes with page-level query selectors.
 */
export default function Shell({ children }: { children: ReactNode }) {
  const apiStatus = useApiStatus()
  const now = useClockTick()
  const onMind = typeof window !== 'undefined' && window.location.pathname === '/mind'
  const statusLabel =
    apiStatus === 'online' ? 'API online' : apiStatus === 'offline' ? 'API offline' : 'API checking'
  return (
    <div className="shell">
      <header className="site-header">
        <a className="site-logo" href="/" aria-label="LINKUP home">
          LINKUP<span className="site-logo-star" aria-hidden="true">*</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="/" className={onMind ? undefined : 'is-active'} aria-current={onMind ? undefined : 'page'}>
            Setup
          </a>
          <a href="/mind" className={onMind ? 'is-active' : undefined} aria-current={onMind ? 'page' : undefined}>
            Mind Chat
          </a>
        </nav>
      </header>
      {children}
      <footer className="site-footer">
        <span className="site-footer-cell">{formatStamp(now)}</span>
        <span className="site-footer-cell site-footer-cell--center">Creator network — v1</span>
        <span className={`status status--${apiStatus}`}>
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </footer>
    </div>
  )
}
