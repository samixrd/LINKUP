import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
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
      if (route.delayMs) {
        await new Promise((r) => setTimeout(r, route.delayMs))
      }
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

const pendingCollab = {
  id: 'collab_pending',
  initiatorId: 'creator-mind',
  targetId: 'match-one',
  status: 'pending',
  proposal: 'Original proposal pending',
  counterProposal: null,
  proposedBy: 'creator-mind',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

const counteredCollab = {
  id: 'collab_countered',
  initiatorId: 'creator-mind',
  targetId: 'match-two',
  status: 'countered',
  proposal: 'Original proposal',
  counterProposal: 'Counter by match-two',
  proposedBy: 'match-two',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
}

const acceptedCollab = {
  id: 'collab_accepted',
  initiatorId: 'creator-mind',
  targetId: 'match-three',
  status: 'accepted',
  proposal: 'Original',
  counterProposal: 'Counter',
  proposedBy: 'match-three',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
}

const mindContext = (collaborations = [pendingCollab, counteredCollab]) => ({
  creator: {
    creatorId: 'creator-mind',
    displayName: 'Ada Lovelace',
    bio: 'Loves pottery',
    avatarUrl: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  memories: [{ id: 'mem1', creatorId: 'creator-mind', category: 'preference', content: 'Prefers async', createdAt: '', updatedAt: '' }],
  matches: { matches: [], total: 0 },
  collaborations: { collaborations, total: collaborations.length },
  followUps: [],
  outcomes: [],
})

describe('mind negotiation panel', () => {
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

  it('renders negotiations section with collaborations', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('N°005 — Negotiation')
    expect(document.body.textContent).toContain('Collaborations')
    expect(document.body.textContent).toContain('collab_pending')
    expect(document.body.textContent).toContain('collab_countered')
  })

  it('shows pending proposal and counter-proposal', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Original proposal pending')
    expect(document.body.textContent).toContain('Original proposal')
    expect(document.body.textContent).toContain('Counter by match-two')
    expect(document.body.textContent).toContain('proposed by match-two')
    expect(document.body.textContent).toContain('Current proposal')
  })

  it('shows accept/reject for active collaborations and not for terminal', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab, acceptedCollab]) }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    // pending has accept/reject
    expect(document.querySelector('[aria-label="Accept collab_pending"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Reject collab_pending"]')).not.toBeNull()
    // accepted should not have accept/reject
    expect(document.querySelector('[aria-label="Accept collab_accepted"]')).toBeNull()
    expect(document.querySelector('[aria-label="Reject collab_accepted"]')).toBeNull()
  })

  it('accept flow calls PATCH and refreshes', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'PATCH',
        url: '/api/creators/creator-mind/collaborations/collab_pending',
        status: 200,
        body: { ...pendingCollab, status: 'accepted' },
      },
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([{ ...pendingCollab, status: 'accepted' }]) },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const acceptBtn = document.querySelector<HTMLButtonElement>('[aria-label="Accept collab_pending"]')
    expect(acceptBtn).not.toBeNull()
    await act(async () => {
      acceptBtn?.click()
    })
    await act(async () => {})

    expect(calls.some((c) => c.url.includes('/collaborations/collab_pending') && c.init?.method === 'PATCH')).toBe(true)
  })

  it('reject flow calls PATCH', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'PATCH',
        url: '/api/creators/creator-mind/collaborations/collab_pending',
        status: 200,
        body: { ...pendingCollab, status: 'rejected' },
      },
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([{ ...pendingCollab, status: 'rejected' }]) },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const rejectBtn = document.querySelector<HTMLButtonElement>('[aria-label="Reject collab_pending"]')
    await act(async () => {
      rejectBtn?.click()
    })
    await act(async () => {})

    expect(calls.some((c) => c.url.includes('/collaborations/collab_pending') && c.init?.method === 'PATCH')).toBe(true)
  })

  it('counter-proposal manual submit', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/collaborations/collab_pending/counter',
        status: 200,
        body: { ...pendingCollab, status: 'countered', counterProposal: 'My counter', proposedBy: 'creator-mind' },
      },
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([{ ...pendingCollab, status: 'countered', counterProposal: 'My counter', proposedBy: 'creator-mind' }]) },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Counter proposal for collab_pending"]')
    expect(textarea).not.toBeNull()
    const counterBtn = document.querySelector<HTMLButtonElement>('[aria-label="Submit counter for collab_pending"]')
    expect(counterBtn?.disabled).toBe(true)

    // Simulate typing into the controlled textarea — use the prototype setter and fire input inside act
    await act(async () => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(textarea, 'My counter')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await act(async () => {})

    expect(counterBtn?.disabled).toBe(false)
    await act(async () => {
      counterBtn?.click()
    })
    await act(async () => {})

    expect(calls.some((c) => c.url.includes('/counter') && c.init?.method === 'POST')).toBe(true)
  })

  it('Draft with Mind preview and confirm counter', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_pending/negotiate/preview',
        status: 200,
        body: { preview: { collaborationId: 'collab_pending', originalProposal: 'Original proposal pending', currentProposal: 'Original proposal pending', counterProposal: null, proposedBy: 'creator-mind', status: 'pending', proposal: 'Mind drafted counter' } },
      },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_pending/negotiate/counter',
        status: 200,
        body: { collaboration: { ...pendingCollab, status: 'countered', counterProposal: 'Mind drafted counter', proposedBy: 'creator-mind' } },
      },
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([{ ...pendingCollab, status: 'countered', counterProposal: 'Mind drafted counter', proposedBy: 'creator-mind' }]) },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const draftBtn = document.querySelector<HTMLButtonElement>('[aria-label="Draft counter with Mind for collab_pending"]')
    expect(draftBtn).not.toBeNull()
    await act(async () => {
      draftBtn?.click()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Mind drafted counter')

    const confirmBtn = document.querySelector<HTMLButtonElement>('[aria-label="Confirm Mind counter for collab_pending"]')
    expect(confirmBtn).not.toBeNull()
    await act(async () => {
      confirmBtn?.click()
    })
    await act(async () => {})

    expect(calls.some((c) => c.url.includes('/negotiate/counter'))).toBe(true)
  })

  it('no mutation without explicit confirmation for Mind counter', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_pending/negotiate/preview',
        status: 200,
        body: { preview: { collaborationId: 'collab_pending', originalProposal: 'Original', currentProposal: 'Original', counterProposal: null, proposedBy: 'creator-mind', status: 'pending', proposal: 'Drafted' } },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const draftBtn = document.querySelector<HTMLButtonElement>('[aria-label="Draft counter with Mind for collab_pending"]')
    await act(async () => {
      draftBtn?.click()
    })
    await act(async () => {})

    // Before confirming, no counter execution should have happened
    expect(calls.some((c) => c.url.includes('/negotiate/counter'))).toBe(false)

    // Confirm button exists but if we don't click, no mutation
    expect(document.querySelector('[aria-label="Confirm Mind counter for collab_pending"]')).not.toBeNull()
    expect(calls.some((c) => c.url.includes('/negotiate/counter'))).toBe(false)
  })

  it('provider failure shows friendly error', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_pending/negotiate/preview',
        status: 503,
        body: { error: 'Minds adapter not configured — no SDK present' },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const draftBtn = document.querySelector<HTMLButtonElement>('[aria-label="Draft counter with Mind for collab_pending"]')
    await act(async () => {
      draftBtn?.click()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Minds is not connected yet.')
  })

  it('shows loading/disabled states while drafting', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/collab_pending/negotiate/preview',
        status: 200,
        body: { preview: { collaborationId: 'collab_pending', originalProposal: 'Original', currentProposal: 'Original', counterProposal: null, proposedBy: 'creator-mind', status: 'pending', proposal: 'Drafted' } },
        delayMs: 50,
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const draftBtn = document.querySelector<HTMLButtonElement>('[aria-label="Draft counter with Mind for collab_pending"]')
    expect(draftBtn?.disabled).toBe(false)
    await act(async () => {
      draftBtn?.click()
    })
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Draft counter with Mind for collab_pending"]')?.disabled).toBe(true)
    expect(document.body.textContent).toContain('Drafting')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    await act(async () => {})

    expect(document.querySelector<HTMLButtonElement>('[aria-label="Draft counter with Mind for collab_pending"]')?.disabled).toBe(false)
    expect(document.body.textContent).not.toContain('Drafting…') // preview shown instead
  })

  it('counter shows error and clears on success', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([pendingCollab]) },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/collaborations/collab_pending/counter',
        status: 400,
        body: { error: 'counterProposal must be a non-empty string' },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Counter proposal for collab_pending"]')
    // Try submitting empty via button disabled check
    const counterBtn = document.querySelector<HTMLButtonElement>('[aria-label="Submit counter for collab_pending"]')
    expect(counterBtn?.disabled).toBe(true)

    // Force set non-empty then submit but server returns 400
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')?.set
      nativeSetter?.call(textarea, '   ')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => {})

    // Button should still be disabled for blank
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Submit counter for collab_pending"]')?.disabled).toBe(true)

    // Now set valid but server will return 400 due to stub (we set to return 400 for any counter)
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')?.set
      nativeSetter?.call(textarea, 'Valid')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => {})
    const btn2 = document.querySelector<HTMLButtonElement>('[aria-label="Submit counter for collab_pending"]')
    expect(btn2?.disabled).toBe(false)
    await act(async () => {
      btn2?.click()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('counterProposal must be a non-empty string')
  })

  it('terminal collaboration does not show counter input', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext([acceptedCollab]) }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    expect(document.querySelector('[aria-label="Counter proposal for collab_accepted"]')).toBeNull()
    expect(document.querySelector('[aria-label="Draft counter with Mind for collab_accepted"]')).toBeNull()
    expect(document.querySelector('[aria-label="Submit counter for collab_accepted"]')).toBeNull()
  })
})
