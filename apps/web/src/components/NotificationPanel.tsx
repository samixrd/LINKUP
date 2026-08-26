import { useState } from 'react'

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
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'n1',
    type: 'agreement',
    title: 'Agreement Ready to Sign',
    message: 'Your Mind and Alex Rivera agreed on 2 joint IG Reels with $400 budget terms.',
    timeAgo: 'Just now',
    read: false,
    actionLabel: 'Review & Sign ✍',
    actionSection: 'negotiations',
  },
  {
    id: 'n2',
    type: 'negotiation',
    title: 'Negotiation Update',
    message: 'Mind Countered: Resolved bilingual subtitle requirement with Maya Lin.',
    timeAgo: '12m ago',
    read: false,
    actionLabel: 'View Transcript',
    actionSection: 'negotiations',
  },
  {
    id: 'n3',
    type: 'match',
    title: 'New Match Found',
    message: 'Compatible creator found: Sarah Jenkins (YouTube • 120k followers).',
    timeAgo: '1h ago',
    read: true,
    actionLabel: 'View Match',
    actionSection: 'matches',
  },
]

export default function NotificationPanel({ isOpen, onClose, onSelectSection }: Props) {
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS)

  if (!isOpen) return null

  const unreadCount = notifications.filter((n) => !n.read).length

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
          <p className="notif-empty">No notifications yet.</p>
        ) : (
          notifications.map((n) => (
            <div key={n.id} className={`notif-card ${n.read ? 'is-read' : 'is-unread'}`}>
              <div className="notif-card-header">
                <span className={`notif-tag notif-tag--${n.type}`}>
                  {n.type === 'match' && '⚡ Match'}
                  {n.type === 'negotiation' && '💬 Negotiation'}
                  {n.type === 'agreement' && '✍ Agreement'}
                  {n.type === 'dispute' && '⚠️ Alert'}
                </span>
                <span className="notif-time">{n.timeAgo}</span>
              </div>
              <p className="notif-title">{n.title}</p>
              <p className="notif-desc">{n.message}</p>
              {n.actionLabel && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost notif-action-btn"
                  onClick={() => handleAction(n)}
                >
                  {n.actionLabel} →
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
