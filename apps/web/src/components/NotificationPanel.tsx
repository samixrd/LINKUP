import { useEffect, useState } from 'react'
import { getStoredCreatorId } from '../creator'

export interface NotificationItem {
  id: string
  type: 'match' | 'negotiation' | 'agreement' | 'dispute'
  title: string
  message: string
  timeAgo: string
  read: boolean
  actionLabel?: string
  actionSection?: 'matches' | 'negotiations' | 'chat' | 'open'
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelectSection?: (section: 'matches' | 'negotiations' | 'chat' | 'open') => void
  onUnreadChange?: (count: number) => void
}

export default function NotificationPanel({ isOpen, onClose, onSelectSection, onUnreadChange }: Props) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const creatorId = getStoredCreatorId()
    if (!creatorId) {
      setNotifications([])
      if (onUnreadChange) onUnreadChange(0)
      return
    }

    let cancelled = false
    const apiBase = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''
    fetch(`${apiBase}/api/creators/${encodeURIComponent(creatorId)}/mind`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const notifs: NotificationItem[] = []

        // Real pending collaborations ready to review/sign
        const collabs = data.collaborations?.collaborations || []
        for (const c of collabs) {
          if (c.status === 'accepted' || c.status === 'pending') {
            notifs.push({
              id: `collab_${c.id}`,
              type: c.status === 'accepted' ? 'agreement' : 'negotiation',
              title: c.status === 'accepted' ? 'Collaboration Accepted' : 'Active Proposal',
              message: c.proposal || 'Collaboration terms updated by Mind.',
              timeAgo: 'Recent',
              read: readIds.has(`collab_${c.id}`),
              actionLabel: 'View Collaboration',
              actionSection: 'negotiations',
            })
          }
        }

        // Real autonomous follow-ups
        const followUps = data.followUps || []
        for (const f of followUps) {
          if (f.status === 'pending') {
            notifs.push({
              id: `fu_${f.id}`,
              type: 'match',
              title: 'Autonomous Follow-Up Due',
              message: `Your Mind scheduled a reminder for collaboration ${f.collaborationId.slice(0, 10)}.`,
              timeAgo: 'Scheduled',
              read: readIds.has(`fu_${f.id}`),
              actionLabel: 'Check Status',
              actionSection: 'negotiations',
            })
          }
        }

        setNotifications(notifs)
        const unread = notifs.filter((n) => !readIds.has(n.id)).length
        if (onUnreadChange) onUnreadChange(unread)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [isOpen, readIds])

  if (!isOpen) return null

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length

  function markAllAsRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  function handleAction(notif: NotificationItem) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)),
    )
    if (notif.actionSection && onSelectSection) {
      onSelectSection(notif.actionSection)
      onClose()
    }
  }

  return (
    <div className="notif-dropdown" role="dialog" aria-label="Notifications Panel">
      <div className="notif-header">
        <div className="notif-title-row">
          <span className="notif-heading">Notifications</span>
          {unreadCount > 0 && <span className="badge badge-accent">{unreadCount} New</span>}
        </div>
        <div className="notif-actions">
          {unreadCount > 0 && (
            <button type="button" className="btn-text" onClick={markAllAsRead}>
              Mark all read
            </button>
          )}
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close notifications">
            ✕
          </button>
        </div>
      </div>

      <div className="notif-list">
        {notifications.length === 0 ? (
          <div style={{ padding: '2rem 1.2rem', textAlign: 'center', color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>📭</div>
            <strong>No new notifications</strong>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem' }}>
              Your Mind will alert you when you have new matches, proposals, or follow-ups.
            </p>
          </div>
        ) : (
          notifications.map((item) => (
            <div key={item.id} className={`notif-item ${item.read ? 'is-read' : ''}`}>
              <div className="notif-item-header">
                <span className={`notif-tag notif-tag--${item.type}`}>{item.type}</span>
                <span className="notif-time">{item.timeAgo}</span>
              </div>
              <h4 className="notif-title">{item.title}</h4>
              <p className="notif-msg">{item.message}</p>
              {item.actionLabel && (
                <button
                  type="button"
                  className="notif-action-btn"
                  onClick={() => {
                    if (item.actionSection && onSelectSection) {
                      onSelectSection(item.actionSection)
                      onClose()
                    }
                  }}
                >
                  {item.actionLabel} →
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
