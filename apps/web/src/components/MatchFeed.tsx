import { useEffect, useMemo, useState } from 'react'
import { getMatches } from '../api'
import type { CreatorProfile, ProfileDetails } from '../api'

/**
 * Tinder-style match feed: compatibility matches rendered as swipeable
 * cards. "Collab" proposes a Mind-drafted collaboration with that creator;
 * "Skip" moves on. Cards animate out in the chosen direction.
 */

export interface MatchCard {
  creator: CreatorProfile
  details?: ProfileDetails
  score: number
  sharedTerms: string[]
  weightedScore?: number
}

interface Props {
  creatorId: string
  onCollab: (match: MatchCard) => void
  onLiveNegotiate?: (match: MatchCard) => void
}

/**
 * Info-rich stats strip on a match card: audience, avg views, platforms,
 * languages, and deal terms — everything the interview now captures.
 */
function MatchStats({ details }: { details: ProfileDetails }) {
  const chips: string[] = []
  if (details.audienceSize) chips.push(`👥 ${details.audienceSize}`)
  if (details.avgViews) chips.push(`👁 ${details.avgViews} avg views`)
  if (details.platforms.length > 0) chips.push(details.platforms.join(' · '))
  if (details.languages && details.languages.length > 0) {
    chips.push(`🗣 ${details.languages.join(', ')}`)
  }
  if (details.location) chips.push(`📍 ${details.location}`)
  if (details.compensation && details.compensation.length > 0) {
    chips.push(`💰 ${details.compensation.join(' / ')}`)
  }
  if (chips.length === 0) return null
  return (
    <ul className="match-stats" aria-label="Creator stats">
      {chips.map((chip) => (
        <li key={chip} className="match-stat">
          {chip}
        </li>
      ))}
    </ul>
  )
}

export default function MatchFeed({ creatorId, onCollab, onLiveNegotiate }: Props) {
  const [matches, setMatches] = useState<MatchCard[]>([])
  const [index, setIndex] = useState(0)
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getMatches(creatorId)
      .then((body) => {
        if (cancelled) return
        setMatches(
          body.matches.map((m) => ({
            creator: m.creator,
            details: m.details,
            score: m.score,
            sharedTerms: m.sharedTerms,
            weightedScore: (m as unknown as { weightedScore?: number }).weightedScore,
          })),
        )
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load matches.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [creatorId])

  const current = useMemo(() => matches[index], [matches, index])
  const upNext = useMemo(() => matches[index + 1], [matches, index])

  function decide(direction: 'left' | 'right') {
    if (!current || exitDir) return
    setExitDir(direction)
    setTimeout(() => {
      if (direction === 'right') onCollab(current)
      setExitDir(null)
      setIndex((i) => i + 1)
    }, 260)
  }

  if (loading) return <p className="feed-status">Finding creators for you…</p>
  if (error !== '') return <p className="feed-status">{error}</p>
  if (!current) {
    return (
      <div className="feed-empty">
        <h3 className="card-title">No more matches</h3>
        <p className="card-body">
          You've seen everyone LINKUP can match you with right now. As you and other creators add
          memories, new matches appear here automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="feed">
      {/* Stack shadow card */}
      {upNext !== undefined && (
        <article className="match-card match-card--behind" aria-hidden="true">
          <span className="match-avatar">{upNext.creator.displayName.charAt(0).toUpperCase()}</span>
        </article>
      )}

      <article
        className={`match-card ${exitDir === 'left' ? 'match-card--exit-left' : ''} ${
          exitDir === 'right' ? 'match-card--exit-right' : ''
        }`}
        data-testid="match-card"
      >
        <span className="match-avatar" aria-hidden="true">
          {current.creator.displayName.charAt(0).toUpperCase()}
        </span>
        <h3 className="match-name">{current.creator.displayName}</h3>
        {current.creator.bio !== '' && <p className="match-bio">{current.creator.bio}</p>}
        {current.details && <MatchStats details={current.details} />}
        <p className="match-score">
          <strong>{current.weightedScore ?? current.score} match strength</strong> —{' '}
          {current.sharedTerms.length} shared {current.sharedTerms.length === 1 ? 'interest' : 'interests'}
        </p>
        <ul className="match-terms" aria-label="Shared interests">
          {current.sharedTerms.slice(0, 8).map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      </article>

      <div className="feed-actions">
        <button
          className="btn btn-skip"
          onClick={() => decide('left')}
          disabled={exitDir !== null}
          aria-label={`Skip ${current.creator.displayName}`}
        >
          ✕ Skip
        </button>
        <button
          className="btn btn-collab"
          onClick={() => decide('right')}
          disabled={exitDir !== null}
          aria-label={`Propose collaboration to ${current.creator.displayName}`}
        >
          ✦ Collab
        </button>
      </div>
      {onLiveNegotiate !== undefined && (
        <button
          className="btn btn-ghost btn-block"
          disabled={exitDir !== null}
          onClick={() => onLiveNegotiate(current)}
          aria-label={`Watch Minds negotiate live with ${current.creator.displayName}`}
        >
          ⚡ Watch Minds negotiate live
        </button>
      )}
      <p className="feed-count">
        {index + 1} / {matches.length}
      </p>
    </div>
  )
}
