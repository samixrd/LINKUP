import { useEffect, useState } from 'react'
import type { Collaboration, MindContext } from '../api'
import type { OpenCollabCard } from './GoOpenPanel'
import EscrowModal from './EscrowModal'

/**
 * Dashboard Component:
 * - Overview cards: Active Negotiations, Pending Sign-offs (emphasized), Completed Collabs, New Matches
 * - Negotiation feed (main column): each row = other creator, deal stage badge (Draft / Countering / Agreed / Paused), one-line AI summary, "View transcript" + "Take over" actions
 * - Go Open criteria panel (side column): current matching preferences + "Edit criteria" link
 * - Recent activity / timeline: chronological log (match found, agreement signed, boundary conflict flagged)
 */

interface Props {
  creatorId: string
  context: MindContext
  onOpenGoOpen: () => void
  onOpenLiveNegotiation: (targetId?: string, targetName?: string) => void
  onOpenChat: () => void
  onRefreshContext: () => void
}

export default function DashboardView({
  creatorId,
  context,
  onOpenGoOpen,
  onOpenLiveNegotiation,
  onOpenChat,
  onRefreshContext,
}: Props) {
  const [openCard, setOpenCard] = useState<OpenCollabCard | null>(null)
  const [escrowCollab, setEscrowCollab] = useState<{ id: string; name: string } | null>(null)
  const [activityFilter, setActivityFilter] = useState<'all' | 'negotiation' | 'match'>('all')

  useEffect(() => {
    let cancelled = false
    async function loadCard() {
      try {
        const res = await fetch(`/api/open-collabs/${encodeURIComponent(creatorId)}`)
        if (!res.ok) return
        const card = (await res.json()) as OpenCollabCard
        if (!cancelled) setOpenCard(card)
      } catch {
        /* ignore */
      }
    }
    void loadCard()
    return () => {
      cancelled = true
    }
  }, [creatorId])

  const collabs = context.collaborations.collaborations
  const activeNegotiations = collabs.filter((c) => c.status === 'pending' || c.status === 'countered')
  const pendingSignOffs = collabs.filter((c) => c.status === 'pending')
  const completedCollabs = collabs.filter((c) => c.status === 'accepted')
  const matchesCount = context.matches.total

  // Derive stage for a collaboration row
  function getDealStage(collab: Collaboration): { label: string; stageClass: string } {
    if (collab.status === 'accepted') return { label: 'Agreed & Escrow', stageClass: 'agreed' }
    if (collab.status === 'countered') return { label: 'Countering', stageClass: 'countering' }
    if (collab.status === 'rejected' || collab.status === 'cancelled') return { label: 'Paused', stageClass: 'paused' }
    return { label: 'Draft', stageClass: 'draft' }
  }

  // Summary generation from proposal text
  function getSummary(collab: Collaboration): string {
    const text = collab.counterProposal || collab.proposal
    if (!text) return 'Mutual cross-promotion collab under review.'
    return text.length > 90 ? `${text.slice(0, 90).replace(/\s+\S*$/, '')}…` : text
  }

  const timelineItems = [
    {
      id: 't1',
      type: 'agreement',
      title: 'Deal Signed & Escrow Locked',
      desc: 'Collab terms locked with partner Mind. Funds held in automated vault.',
      time: '10m ago',
    },
    {
      id: 't2',
      type: 'negotiation',
      title: 'Counter-Proposal Generated',
      desc: 'Mind adjusted format to 1 IG Reel + 1 Story per budget guardrail.',
      time: '35m ago',
    },
    {
      id: 't3',
      type: 'match',
      title: 'New High-Signal Match Found',
      desc: 'Matched with creator in Tech & AI with 45,000 followers.',
      time: '2h ago',
    },
    {
      id: 't4',
      type: 'guardrail',
      title: 'Boundary Conflict Checked',
      desc: 'Partner requested 3 video revisions; Mind successfully capped at 1 per guardrails.',
      time: '4h ago',
    },
  ]

  return (
    <div className="dashboard-layout">
      {/* 1. Overview Cards */}
      <section className="overview-cards-grid" aria-label="Dashboard Overview Metrics">
        <div className="stat-card">
          <span className="stat-card-label">Active Negotiations</span>
          <div className="stat-card-val-row">
            <span className="stat-card-value">{activeNegotiations.length}</span>
            <span className="badge badge-accent">AI-to-AI</span>
          </div>
          <p className="stat-card-hint">Minds actively negotiating terms</p>
        </div>

        <div className="stat-card stat-card--highlight">
          <span className="stat-card-label">Pending Sign-offs ⚠️</span>
          <div className="stat-card-val-row">
            <span className="stat-card-value">{pendingSignOffs.length}</span>
            <span className="badge badge-warn">Needs Human Action</span>
          </div>
          <p className="stat-card-hint">Deals awaiting your signature</p>
        </div>

        <div className="stat-card">
          <span className="stat-card-label">Completed Collabs</span>
          <div className="stat-card-val-row">
            <span className="stat-card-value">{completedCollabs.length}</span>
            <span className="badge badge-ok">Auto-Released</span>
          </div>
          <p className="stat-card-hint">Escrow released & published</p>
        </div>

        <div className="stat-card">
          <span className="stat-card-label">New Matches</span>
          <div className="stat-card-val-row">
            <span className="stat-card-value">{matchesCount}</span>
            <span className="badge badge-subtle">Compatible</span>
          </div>
          <p className="stat-card-hint">Passed threshold criteria</p>
        </div>
      </section>

      {/* 2. Main Column: Negotiation Feed & Recent Activity */}
      <div className="dashboard-content-columns">
        <main className="dashboard-main-col">
          <section className="card dashboard-feed-card" aria-label="Negotiation Feed">
            <div className="feed-header">
              <div>
                <p className="card-kicker">Autonomous Deal Pipeline</p>
                <h3 className="card-title">Negotiation Feed</h3>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onOpenLiveNegotiation()}
              >
                Find & Match ⚡
              </button>
            </div>

            <div className="negotiation-feed-list">
              {collabs.length === 0 ? (
                <div className="feed-empty">
                  <p className="feed-empty-title">No active negotiations yet</p>
                  <p className="feed-empty-subtitle">
                    Turn on Go Open criteria and let your Mind negotiate collab deals autonomously.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onOpenLiveNegotiation()}
                  >
                    Start AI Match & Negotiation ⚡
                  </button>
                </div>
              ) : (
                collabs.map((collab) => {
                  const stage = getDealStage(collab)
                  const otherId = collab.initiatorId === creatorId ? collab.targetId : collab.initiatorId
                  const partnerName = otherId.startsWith('u_') ? otherId.slice(2) : otherId

                  return (
                    <article key={collab.id} className="neg-feed-row">
                      <div className="neg-row-avatar">
                        {partnerName.charAt(0).toUpperCase()}
                      </div>
                      <div className="neg-row-main">
                        <div className="neg-row-top">
                          <span className="neg-row-partner">{partnerName}</span>
                          <span className={`badge stage-badge stage-badge--${stage.stageClass}`}>
                            {stage.label}
                          </span>
                        </div>
                        <p className="neg-row-summary">{getSummary(collab)}</p>
                      </div>
                      <div className="neg-row-actions">
                        {collab.status === 'accepted' ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => setEscrowCollab({ id: collab.id, name: partnerName })}
                          >
                            Escrow Vault 🔒
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => onOpenLiveNegotiation(otherId, partnerName)}
                            >
                              Transcript
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => onOpenLiveNegotiation(otherId, partnerName)}
                            >
                              Take Over ✋
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>

          {/* Timeline / Recent Activity */}
          <section className="card dashboard-timeline-card" aria-label="Recent Activity">
            <div className="timeline-header">
              <p className="card-kicker">Audit Trail & Logs</p>
              <h4 className="card-title">Recent Activity</h4>
            </div>
            <div className="timeline-list">
              {timelineItems.map((item) => (
                <div key={item.id} className="timeline-item">
                  <span className={`timeline-dot timeline-dot--${item.type}`} />
                  <div className="timeline-content">
                    <div className="timeline-title-row">
                      <span className="timeline-title">{item.title}</span>
                      <span className="timeline-time">{item.time}</span>
                    </div>
                    <p className="timeline-desc">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* 3. Side Column: Go Open Criteria Panel & Own-Mind Support */}
        <aside className="dashboard-side-col">
          {/* Go Open Side Card */}
          <section className="card go-open-side-card" aria-label="Go Open Criteria Summary">
            <div className="side-card-header">
              <p className="card-kicker">Matching Criteria</p>
              <h4 className="card-title">Go Open Status</h4>
            </div>

            <div className="go-open-pill-status">
              <span className={`status-indicator ${openCard?.openToCollab !== false ? 'is-on' : 'is-off'}`} />
              <span>{openCard?.openToCollab !== false ? 'Matching Active' : 'Matching Paused'}</span>
            </div>

            <div className="side-criteria-list">
              <div className="side-criterion">
                <span className="criterion-label">Platform:</span>
                <span className="criterion-val">{openCard?.platform || 'Instagram'}</span>
              </div>
              <div className="side-criterion">
                <span className="criterion-label">Niche:</span>
                <span className="criterion-val">{openCard?.niche || 'Tech & AI'}</span>
              </div>
              <div className="side-criterion">
                <span className="criterion-label">Min Follower Floor:</span>
                <span className="criterion-val">
                  {openCard?.minPartnerFollowers ? `${openCard.minPartnerFollowers.toLocaleString()}+` : '0 (Anyone)'}
                </span>
              </div>
              <div className="side-criterion">
                <span className="criterion-label">Min Budget:</span>
                <span className="criterion-val">${openCard?.minRate ?? 0}</span>
              </div>
              <div className="side-criterion">
                <span className="criterion-label">Collab Types:</span>
                <span className="criterion-val">
                  {(openCard?.collabTypes && openCard.collabTypes.join(', ')) || 'Paid, Barter'}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-block btn-secondary"
              onClick={onOpenGoOpen}
              style={{ marginTop: '1rem' }}
            >
              Edit Criteria ⚙
            </button>
          </section>

          {/* Own-Mind Decision Support Teaser */}
          <section className="card mind-teaser-card" aria-label="Own Mind Decision Support">
            <p className="card-kicker">Personal AI Assistant</p>
            <h4 className="card-title">Own-Mind Chat</h4>
            <p className="mind-teaser-desc">
              Ask your personal Mind for deal advice, comparison between creators, or guardrail status.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={onOpenChat}
            >
              Open Mind Chat Box 💬
            </button>
          </section>
        </aside>
      </div>

      {escrowCollab && (
        <EscrowModal
          collaborationId={escrowCollab.id}
          otherCreatorName={escrowCollab.name}
          onClose={() => setEscrowCollab(null)}
          onUpdated={onRefreshContext}
        />
      )}
    </div>
  )
}
