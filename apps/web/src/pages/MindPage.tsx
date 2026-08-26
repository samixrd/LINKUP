import { useEffect, useRef, useState } from 'react'
import { ApiError, getMindContext, listMindHistory, queryMind, saveMindMemory } from '../api'
import type { MindContext, MindInteraction, MemoryCategory } from '../api'
import { MEMORY_CATEGORIES } from '../api'
import { getStoredCreatorId } from '../creator'
import Shell from '../components/Shell'
import CollaborationNegotiationPanel from '../components/CollaborationNegotiationPanel'
import ProposeCollaborationPanel from '../components/ProposeCollaborationPanel'
import MatchFeed from '../components/MatchFeed'
import NegotiationLive from '../components/NegotiationLive'
import GoOpenPanel from '../components/GoOpenPanel'
import DashboardView from '../components/DashboardView'

type Message = { id?: string; role: 'user' | 'mind'; content: string; time?: string }

const SUGGESTIONS = [
  'What kind of creators are a good fit for me?',
  'What does my Mind know about me?',
  'What collaborations should I consider?',
  'What should I avoid in a collaboration?',
]

const QUICK_PROMPTS = [
  'Which deal is best for me right now?',
  'Show my current negotiations and terms',
  'What are my non-negotiable guardrails?',
  'What kind of creators are a good fit for me?',
  'What collaborations should I avoid?',
]

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503 && err.message.toLowerCase().includes('not configured')) {
      return 'Minds is not connected yet.'
    }
    if (err.status === 404) return 'Mind not found. Please set up your creator profile again.'
    if (err.status === 400) return err.message
    if (err.status === 500) return 'Something went wrong. Please try again.'
    return err.message
  }
  return 'Could not reach the LINKUP API. Please try again.'
}

export default function MindPage() {
  const creatorId = getStoredCreatorId()
  const [context, setContext] = useState<MindContext | null>(null)
  const [loadingMind, setLoadingMind] = useState(() => !!creatorId)
  const [mindError, setMindError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(() => !!creatorId)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [saveTargetId, setSaveTargetId] = useState<string | null>(null)
  const [saveCategory, setSaveCategory] = useState<MemoryCategory>('preference')
  const [saveContent, setSaveContent] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')
  const [memorySearchEnabled, setMemorySearchEnabled] = useState(false)
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const [section, setSection] = useState<'dashboard' | 'chat' | 'matches' | 'negotiations' | 'open'>('chat')
  const [proposeOpen, setProposeOpen] = useState(false)
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null)
  const [liveNegotiation, setLiveNegotiation] = useState<{ targetId?: string; targetName?: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  function refreshMindContext() {
    if (!creatorId) return
    getMindContext(creatorId)
      .then((ctx) => setContext(ctx))
      .catch(() => {})
  }

  useEffect(() => {
    if (!creatorId) return
    let cancelled = false
    getMindContext(creatorId)
      .then((ctx) => {
        if (!cancelled) setContext(ctx)
      })
      .catch((err) => {
        if (!cancelled) setMindError(friendlyError(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingMind(false)
      })
    return () => {
      cancelled = true
    }
  }, [creatorId])

  useEffect(() => {
    if (!creatorId) return
    let cancelled = false
    listMindHistory(creatorId, { limit: 100 })
      .then((res) => {
        if (cancelled) return
        const msgs: Message[] = res.interactions.map((i: MindInteraction) => ({
          id: i.id,
          role: i.role,
          content: i.content,
          time: new Date(i.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }))
        setMessages(msgs)
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [creatorId])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, sending])

  async function sendQuery(text: string) {
    const trimmed = text.trim()
    if (trimmed === '' || sending || !creatorId) return
    setQueryError('')
    setSaveSuccess('')
    setShowQuickMenu(false)
    const nowStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setMessages((prev) => [...prev, { role: 'user', content: trimmed, time: nowStamp }])
    setInput('')
    setSending(true)
    try {
      const res = await queryMind(creatorId, trimmed, {
        memorySearch: memorySearchEnabled ? trimmed : undefined,
      })
      setMessages((prev) => [...prev, { role: 'mind', content: res.answer, time: nowStamp }])
      try {
        const history = await listMindHistory(creatorId, { limit: 100 })
        const msgs: Message[] = history.interactions.map((i) => ({
          id: i.id,
          role: i.role,
          content: i.content,
          time: new Date(i.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }))
        setMessages(msgs)
      } catch {
        // Keep optimistic messages
      }
    } catch (err) {
      setQueryError(friendlyError(err))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function clearChat() {
    setMessages([])
    setShowQuickMenu(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void sendQuery(input)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendQuery(input)
    }
  }

  function openSave(id: string | undefined, content: string) {
    if (!id) return
    setSaveTargetId(id)
    setSaveCategory('preference')
    setSaveContent(content)
    setSaveError('')
    setSaveSuccess('')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!creatorId || !saveTargetId) return
    if (saveContent.trim() === '') {
      setSaveError('content is required and must be a non-empty string')
      return
    }
    setSaveLoading(true)
    setSaveError('')
    setSaveSuccess('')
    try {
      await saveMindMemory(creatorId, {
        interactionId: saveTargetId,
        category: saveCategory,
        content: saveContent.trim(),
      })
      setSaveSuccess('Saved to Mind')
      try {
        const ctx = await getMindContext(creatorId)
        setContext(ctx)
      } catch {
        // ignore
      }
    } catch (err) {
      setSaveError(friendlyError(err))
    } finally {
      setSaveLoading(false)
    }
  }

  if (!creatorId) {
    return (
      <Shell>
        <main className="mind-page">
          <div className="mind-empty">
            <p className="mind-empty-kicker" aria-hidden="true">
              N°404 — No Mind found
            </p>
            <h2>No Mind found</h2>
            <p>Set up your creator profile to create your Mind.</p>
            <a className="btn" href="/">
              Go to setup →
            </a>
          </div>
        </main>
      </Shell>
    )
  }

  if (loadingMind) {
    return (
      <Shell>
        <main className="mind-page" aria-busy="true" aria-label="Loading Mind">
          <div className="mind-header skeleton">
            <div className="skeleton-line" style={{ width: '40%' }} />
            <div className="skeleton-line" style={{ width: '60%' }} />
          </div>
          <div className="mind-chat skeleton-chat">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" style={{ width: '80%' }} />
          </div>
        </main>
      </Shell>
    )
  }

  if (mindError) {
    return (
      <Shell>
        <main className="mind-page">
          <div className="mind-error" role="alert">
            <p>{mindError}</p>
            <a className="btn" href="/">
              Back to setup →
            </a>
          </div>
        </main>
      </Shell>
    )
  }

  if (!context) return null

  const creator = context.creator

  return (
    <Shell onNavigateTab={(sec) => setSection(sec)}>
      <main className="mind-page">
        <header className="mind-header">
          <div className="mind-id">
            <span className="mind-monogram" aria-hidden="true">
              {creator.displayName.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <div className="mind-id-text">
              <div className="mind-title-row">
                <h1 className="mind-title">{creator.displayName}</h1>
                <span className="badge">Mind</span>
                <span className="mind-status-indicator">● Online & Matching</span>
              </div>
              {creator.bio && <p className="mind-bio">{creator.bio}</p>}
            </div>
          </div>
          <div className="mind-stats" aria-label="Mind summary">
            <span className="stat-chip">{context.memories.length} memories</span>
            <span className="stat-chip">{context.matches.total} matches</span>
            <span className="stat-chip">{context.collaborations.total} collaborations</span>
            <span className="stat-chip">{context.followUps.length} pending follow-ups</span>
          </div>
          <div className="mind-header-actions">
            <button
              type="button"
              className="btn collab-open-btn"
              onClick={() => setLiveNegotiation({})}
              aria-label="Let your Mind find a collab"
            >
              Find Collab ⚡
            </button>
            <button
              type="button"
              className="btn collab-open-btn"
              onClick={() => {
                setSection('negotiations')
                setProposeOpen(true)
              }}
              aria-label="Propose collaboration"
            >
              Propose Collaboration ↗
            </button>
          </div>
        </header>

        <nav className="mind-tabs" aria-label="Mind sections">
          {(
            [
              ['chat', 'Chat'],
              ['dashboard', 'Dashboard'],
              ['matches', 'Matches'],
              ['negotiations', 'Negotiations'],
              ['open', 'Go Open'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`mind-tab${section === key && liveNegotiation === null ? ' is-active' : ''}`}
              onClick={() => {
                setSection(key)
                setLiveNegotiation(null)
              }}
              aria-pressed={section === key && liveNegotiation === null}
            >
              {label}
            </button>
          ))}
        </nav>

        {liveNegotiation !== null ? (
          <section className="collab-section">
            <NegotiationLive
              targetId={liveNegotiation.targetId}
              targetName={liveNegotiation.targetName}
              onClose={() => {
                setLiveNegotiation(null)
                refreshMindContext()
              }}
              onCompleted={() => {
                refreshMindContext()
              }}
            />
          </section>
        ) : (
          <>
            {section === 'dashboard' && (
              <DashboardView
                creatorId={creatorId}
                context={context}
                onOpenGoOpen={() => setSection('open')}
                onOpenLiveNegotiation={(tId, tName) => {
                  setLiveNegotiation({ targetId: tId, targetName: tName })
                }}
                onOpenChat={() => setSection('chat')}
                onRefreshContext={refreshMindContext}
              />
            )}

            {section === 'matches' && (
              <section className="collab-section">
                <MatchFeed
                  creatorId={creatorId}
                  onCollab={(match) => {
                    setSection('negotiations')
                    setProposeOpen(true)
                    setPendingMatchId(match.creator.creatorId)
                  }}
                  onLiveNegotiate={(match) => {
                    setLiveNegotiation({ targetId: match.creator.creatorId, targetName: match.creator.displayName })
                  }}
                />
              </section>
            )}

            {section === 'negotiations' && (
              <section className="collab-section">
                {proposeOpen && (
                  <ProposeCollaborationPanel
                    key={pendingMatchId ?? 'default'}
                    creatorId={creatorId}
                    matches={
                      pendingMatchId
                        ? [...context.matches.matches].sort((a, b) =>
                            a.creator.creatorId === pendingMatchId
                              ? -1
                              : b.creator.creatorId === pendingMatchId
                                ? 1
                                : 0,
                          )
                        : context.matches.matches
                    }
                    onCreated={() => {
                      refreshMindContext()
                    }}
                    onClose={() => setProposeOpen(false)}
                  />
                )}

                <CollaborationNegotiationPanel
                  creatorId={creatorId}
                  collaborations={context.collaborations.collaborations}
                  onChanged={refreshMindContext}
                />
              </section>
            )}

            {section === 'open' && (
              <section className="collab-section">
                <GoOpenPanel
                  creatorId={creatorId}
                  onClose={() => setSection('dashboard')}
                  onSavedAndMatch={() => {
                    setLiveNegotiation({})
                  }}
                />
              </section>
            )}

            {section === 'chat' && (
              <section className="mind-chat card" aria-label="Own Mind Conversation">
                {/* Own-Mind Header */}
                <div className="own-mind-header">
                  <div className="own-mind-id-row">
                    <span className="own-mind-avatar">
                      {creator.displayName.trim().charAt(0).toUpperCase() || 'M'}
                    </span>
                    <div>
                      <h3 className="own-mind-title">{creator.displayName}&apos;s Mind</h3>
                      <span className="own-mind-status">● Online & Ready for Decision Support</span>
                    </div>
                  </div>
                  <div className="own-mind-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setShowQuickMenu((prev) => !prev)}
                    >
                      ⚡ Quick Prompts ▾
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={clearChat}
                      disabled={messages.length === 0}
                    >
                      Clear Chat
                    </button>
                  </div>
                </div>

                {/* Quick Prompts Dropdown */}
                {showQuickMenu && (
                  <div className="quick-prompts-menu" role="menu">
                    <p className="quick-prompts-title">Decision Support Prompts:</p>
                    {QUICK_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="quick-prompt-item"
                        onClick={() => void sendQuery(prompt)}
                        disabled={sending}
                      >
                        → {prompt}
                      </button>
                    ))}
                  </div>
                )}

                {historyLoading ? (
                  <div className="mind-messages" aria-label="Loading history">
                    <div className="skeleton-line" />
                    <div className="skeleton-line" style={{ width: '80%' }} />
                  </div>
                ) : (
                  <div className="mind-messages" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
                    {messages.length === 0 ? (
                      <div className="mind-empty-chat">
                        <p className="mind-empty-kicker" aria-hidden="true">
                          N°003 — Decision Support
                        </p>
                        <p className="mind-empty-title">Ask your Personal Mind</p>
                        <p className="mind-empty-subtitle">
                          Your Mind remembers your guardrails, negotiates on your behalf, and advises you on which deal to pick.
                        </p>
                        <ul className="mind-suggestions" aria-label="Suggested questions">
                          {SUGGESTIONS.map((q, i) => (
                            <li key={q}>
                              <button
                                type="button"
                                className="mind-suggestion"
                                onClick={() => void sendQuery(q)}
                                disabled={sending}
                              >
                                <span className="mind-suggestion-index" aria-hidden="true">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                {q}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      messages.map((m, i) => (
                        <div key={m.id ?? `${m.role}-${i}`} className={`mind-message mind-message--${m.role}`}>
                          <div className="mind-bubble">
                            <p className="mind-bubble-text">{m.content}</p>
                            <div className="mind-bubble-footer">
                              {m.time && <span className="mind-bubble-time">{m.time}</span>}
                              {m.role === 'mind' && m.id && (
                                <button
                                  type="button"
                                  className="mind-save-btn"
                                  onClick={() => openSave(m.id, m.content)}
                                  aria-label={`Save to Mind: ${m.content.slice(0, 30)}`}
                                >
                                  Save to Mind
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {sending && (
                      <div className="mind-message mind-message--mind">
                        <div className="mind-bubble mind-bubble--loading mind-typing-indicator" aria-label="Mind is typing…">
                          <span className="typing-text">Mind is typing</span>
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {saveTargetId && (
                  <form className="mind-save-form" onSubmit={handleSave} aria-label="Save to Mind">
                    <h3 className="mind-save-title">Save to Mind Memory</h3>
                    <label className="field">
                      <span className="field-label">Category</span>
                      <select
                        className="field-input"
                        value={saveCategory}
                        onChange={(e) => setSaveCategory(e.target.value as MemoryCategory)}
                        aria-label="Memory category"
                      >
                        {MEMORY_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">Content</span>
                      <textarea
                        className="field-input"
                        value={saveContent}
                        onChange={(e) => setSaveContent(e.target.value)}
                        rows={3}
                        maxLength={10000}
                        aria-label="Memory content"
                      />
                    </label>
                    {saveError && (
                      <p className="form-error" role="alert">
                        {saveError}
                      </p>
                    )}
                    {saveSuccess && (
                      <p className="form-success" role="status">
                        {saveSuccess}
                      </p>
                    )}
                    <div className="mind-save-actions">
                      <button type="submit" className="btn btn-primary" disabled={saveLoading}>
                        {saveLoading ? 'Saving…' : 'Save Memory'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setSaveTargetId(null)}
                        disabled={saveLoading}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {queryError && (
                  <p className="mind-query-error" role="alert">
                    {queryError}
                  </p>
                )}

                <form className="mind-input-row" onSubmit={handleSubmit} aria-label="Ask your Mind">
                  <label htmlFor="mind-query" className="sr-only">
                    Ask your Mind
                  </label>
                  <textarea
                    id="mind-query"
                    ref={inputRef}
                    className="mind-input"
                    placeholder="Ask your Mind… (e.g. Which deal is best? What are my guardrails?)"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    maxLength={10000}
                    disabled={sending}
                    aria-label="Ask your Mind"
                  />
                  <button
                    type="submit"
                    className="btn btn-primary mind-send"
                    disabled={sending || input.trim() === ''}
                    aria-label="Send query"
                  >
                    {sending ? 'Sending…' : 'Send ↗'}
                  </button>
                </form>
                <div className="mind-bottom-row">
                  <label className="mind-search-toggle">
                    <input
                      type="checkbox"
                      checked={memorySearchEnabled}
                      onChange={(e) => setMemorySearchEnabled(e.target.checked)}
                      aria-label="Search my memories for this question"
                    />
                    Search my memories for this question
                  </label>
                  <p className="mind-hint">Enter to send · Shift+Enter for newline</p>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </Shell>
  )
}
