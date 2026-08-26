import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getHealth } from '../api'
import NotificationPanel from './NotificationPanel'

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

interface ShellProps {
  children: ReactNode
  onNavigateTab?: (section: 'dashboard' | 'chat' | 'matches' | 'negotiations' | 'open') => void
}

/**
 * Shared page chrome with in-UI notification box/panel & navigation.
 */
export default function Shell({ children, onNavigateTab }: ShellProps) {
  const apiStatus = useApiStatus()
  const now = useClockTick()
  const onMind = typeof window !== 'undefined' && window.location.pathname === '/mind'
  const onBrand = typeof window !== 'undefined' && window.location.pathname === '/brand'
  const [notifsOpen, setNotifsOpen] = useState(false)
  const statusLabel =
    apiStatus === 'online' ? 'API online' : apiStatus === 'offline' ? 'API offline' : 'API checking'

  return (
    <div className="shell">
      <header className="site-header">
        <a className="site-logo" href="/" aria-label="LINKUP home">
          LINKUP<span className="site-logo-star" aria-hidden="true">*</span>
        </a>
        <div className="site-header-right">
          <nav className="site-nav" aria-label="Primary">
            <a href="/" className={!onMind && !onBrand ? 'is-active' : undefined} aria-current={!onMind && !onBrand ? 'page' : undefined}>
              Setup
            </a>
            <a href="/mind" className={onMind ? 'is-active' : undefined} aria-current={onMind ? 'page' : undefined}>
              Dashboard & Mind
            </a>
            <a href="/brand" className={onBrand ? 'is-active' : undefined} aria-current={onBrand ? 'page' : undefined}>
              Brand Portal ⚡
            </a>
          </nav>
          <div className="notif-anchor">
            <button
              type="button"
              className={`btn-notif ${notifsOpen ? 'is-active' : ''}`}
              onClick={() => setNotifsOpen((prev) => !prev)}
              aria-label="Toggle notifications panel"
            >
              🔔 <span className="notif-badge-pill">2</span>
            </button>
            <NotificationPanel
              isOpen={notifsOpen}
              onClose={() => setNotifsOpen(false)}
              onSelectSection={(sec) => {
                if (onNavigateTab) onNavigateTab(sec)
              }}
            />
          </div>
        </div>
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
