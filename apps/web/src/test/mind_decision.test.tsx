import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { clickTab } from './tabs.js'
import { createRoot } from 'react-dom/client'
import App from '../App.tsx'

type StubRoute = {
  method: 'GET' | 'POST' | 'PATCH'
  url: string
  status: number
  body: unknown
  delayMs?: number
}

function stubFetch(routes: StubRoute[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH'
      calls.push({ url, init })
      const route = routes.find((r) => r.method === method && r.url === url)
      if (!route) {
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as Response
      }
      if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs))
      return {
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: async () => route.body,
      } as unknown as Response
    }),
  )
  return calls
}

function renderAppAt(path: string) {
  window.history.pushState({}, '', path)
  const container = document.getElementById('root')
  if (!container) throw new Error('root missing')
  createRoot(container).render(<App />)
}

const pending = {
  id: 'collab_dec',
  initiatorId: 'creator-mind',
  targetId: 'match-one',
  status: 'pending',
  proposal: 'Original proposal',
  counterProposal: null,
  proposedBy: 'creator-mind',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

const mindContext = (collaborations = [pending]) => ({
  creator: { creatorId: 'creator-mind', displayName: 'Ada', bio: '', avatarUrl: '', createdAt: '', updatedAt: '' },
  memories: [],
  matches: { matches: [], total: 0 },
  collaborations: { collaborations, total: collaborations.length },
  followUps: [],
  outcomes: [],
  negotiationHistory: [
    { id: 'h1', collaborationId: 'collab_dec', seq: 1, authorId: 'creator-mind', proposal: 'Original proposal', createdAt: '2026-08-20T00:00:00.000Z' },
  ],
})

describe('mind decision panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    localStorage.clear()
    window.history.pushState({}, '', '/')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    localStorage.clear()
    window.history.pushState({}, '', '/')
  })

  it('displays Ask Mind button per collaboration', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    expect(document.querySelector('[aria-label="Ask Mind for collab_dec"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Ask Mind')
  })

  it('Ask Mind displays recommendation and reasoning for accept', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_dec/negotiate/decision',
        status: 200,
        body: { decision: { action: 'accept', reasoning: 'Looks good, accept it' } },
      },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    const askBtn = document.querySelector<HTMLButtonElement>('[aria-label="Ask Mind for collab_dec"]')
    await act(async () => {
      askBtn?.click()
    })
    await act(async () => {})
    expect(document.body.textContent).toContain('Recommendation:')
    expect(document.body.textContent).toContain('accept')
    expect(document.body.textContent).toContain('Looks good, accept it')
    expect(document.querySelector('[aria-label="Execute accept for collab_dec"]')).not.toBeNull()
  })

  it('Ask Mind displays counter with proposed counter', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_dec/negotiate/decision',
        status: 200,
        body: { decision: { action: 'counter', reasoning: 'Needs tweak', counterProposal: 'How about X?' } },
      },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    const askBtn = document.querySelector<HTMLButtonElement>('[aria-label="Ask Mind for collab_dec"]')
    await act(async () => {
      askBtn?.click()
    })
    await act(async () => {})
    expect(document.body.textContent).toContain('counter')
    expect(document.body.textContent).toContain('Needs tweak')
    expect(document.body.textContent).toContain('How about X?')
    expect(document.querySelector('[aria-label="Execute counter for collab_dec"]')).not.toBeNull()
  })

  it('no mutation before explicit confirmation', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_dec/negotiate/decision',
        status: 200,
        body: { decision: { action: 'accept', reasoning: 'ok' } },
      },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    const askBtn = document.querySelector<HTMLButtonElement>('[aria-label="Ask Mind for collab_dec"]')
    await act(async () => {
      askBtn?.click()
    })
    await act(async () => {})
    // After Ask Mind, no mutation should have happened (no PATCH/POST counter)
    expect(calls.some((c) => c.url.includes('/collaborations/collab_dec') && (c.init?.method === 'PATCH' || (c.url.includes('/counter') && c.init?.method === 'POST')))).toBe(false)
    expect(calls.some((c) => c.url.includes('/negotiate/decision'))).toBe(true)
  })

  it('executing accept requires explicit confirmation and calls PATCH', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_dec/negotiate/decision',
        status: 200,
        body: { decision: { action: 'accept', reasoning: 'ok' } },
      },
      { method: 'PATCH', url: '/api/creators/creator-mind/collaborations/collab_dec', status: 200, body: { ...pending, status: 'accepted' } },
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([{ ...pending, status: 'accepted' }]) },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    const askBtn = document.querySelector<HTMLButtonElement>('[aria-label="Ask Mind for collab_dec"]')
    await act(async () => {
      askBtn?.click()
    })
    await act(async () => {})
    const execBtn = document.querySelector<HTMLButtonElement>('[aria-label="Execute accept for collab_dec"]')
    expect(execBtn).not.toBeNull()
    await act(async () => {
      execBtn?.click()
    })
    await act(async () => {})
    expect(calls.some((c) => c.url.includes('/collaborations/collab_dec') && c.init?.method === 'PATCH')).toBe(true)
  })

  it('executing counter uses Mind\'s counter proposal', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_dec/negotiate/decision',
        status: 200,
        body: { decision: { action: 'counter', reasoning: 'tweak', counterProposal: 'Mind counter X' } },
      },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/collaborations/collab_dec/counter',
        status: 200,
        body: { ...pending, status: 'countered', counterProposal: 'Mind counter X', proposedBy: 'creator-mind' } as unknown as Record<string, unknown>,
      },
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([{ ...pending, status: 'countered', counterProposal: 'Mind counter X', proposedBy: 'creator-mind' } as unknown as typeof pending]) },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    const askBtn = document.querySelector<HTMLButtonElement>('[aria-label="Ask Mind for collab_dec"]')
    await act(async () => {
      askBtn?.click()
    })
    await act(async () => {})
    const execBtn = document.querySelector<HTMLButtonElement>('[aria-label="Execute counter for collab_dec"]')
    expect(execBtn).not.toBeNull()
    await act(async () => {
      execBtn?.click()
    })
    await act(async () => {})
    const counterCall = calls.find((c) => c.url.includes('/counter') && c.init?.method === 'POST')
    expect(counterCall).toBeDefined()
    expect(counterCall?.init?.body).toContain('Mind counter X')
  })

  it('shows loading and error states for decision', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_dec/negotiate/decision',
        status: 503,
        body: { error: 'Minds adapter not configured' },
      },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    const askBtn = document.querySelector<HTMLButtonElement>('[aria-label="Ask Mind for collab_dec"]')
    await act(async () => {
      askBtn?.click()
    })
    await act(async () => {})
    expect(document.body.textContent).toContain('Minds is not connected yet.')
  })

  it('provider failure does not mutate', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/collaborations/collab_dec/negotiate/history', status: 200, body: { proposals: mindContext().negotiationHistory, total: 1, history: mindContext().negotiationHistory } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_dec/negotiate/decision',
        status: 500,
        body: { error: 'negotiation decision failed' },
      },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    await act(async () => { clickTab('Negotiations') })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})
    const askBtn = document.querySelector<HTMLButtonElement>('[aria-label="Ask Mind for collab_dec"]')
    await act(async () => {
      askBtn?.click()
    })
    await act(async () => {})
    expect(document.body.textContent).toContain('Something went wrong')
    expect(calls.some((c) => c.url.includes('/counter') || (c.url.includes('/collaborations/collab_dec') && c.init?.method === 'PATCH'))).toBe(false)
  })
})
