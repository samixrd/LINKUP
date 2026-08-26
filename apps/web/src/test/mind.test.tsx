import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App.tsx'

type StubRoute = {
  method: 'GET' | 'POST'
  url: string
  status: number
  body: unknown
  delayMs?: number
}

function stubFetch(routes: StubRoute[]): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET') as 'GET' | 'POST'
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

const mindContext = (creatorId = 'creator-mind', displayName = 'Ada Lovelace') => ({
  creator: {
    creatorId,
    displayName,
    bio: 'Loves pottery',
    avatarUrl: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  memories: [{ id: 'mem1', creatorId, category: 'preference', content: 'Prefers async', createdAt: '', updatedAt: '' }],
  matches: { matches: [], total: 0 },
  collaborations: { collaborations: [{ id: 'collab1', status: 'pending' }], total: 1 },
  followUps: [{ id: 'follow1', dueAt: '2026-08-26T10:00:00.000Z', status: 'pending' }],
  outcomes: [],
})

describe('mind chat', () => {
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

  it('loads creator context and renders creator information', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Ada Lovelace')
    expect(document.body.textContent).toContain('Loves pottery')
    // lightweight stats
    expect(document.body.textContent).toContain('1 memories')
    expect(document.body.textContent).toContain('1 collaborations')
    expect(document.body.textContent).toContain('1 pending follow-ups')
  })

  it('shows loading state initially', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext(), delayMs: 150 }])

    await act(async () => {
      renderAppAt('/mind')
    })
    // Should show skeleton while loading
    expect(document.body.innerHTML).toContain('skeleton')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(document.body.textContent).toContain('Ada Lovelace')
  })

  it('empty conversation renders suggestions', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Ask your Mind')
    expect(document.body.textContent).toContain('What kind of creators are a good fit for me?')
    expect(document.body.textContent).toContain('What does my Mind know about me?')
    // buttons should be enabled
    const suggestion = document.querySelector<HTMLButtonElement>('.mind-suggestion')
    expect(suggestion).not.toBeNull()
    expect(suggestion?.disabled).toBe(false)
  })

  it('clicking a suggestion sends query and renders user message', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'POST', url: '/api/creators/creator-mind/mind/query', status: 200, body: { answer: 'You love pottery' } },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const suggestion = document.querySelector<HTMLButtonElement>('.mind-suggestion')
    if (!suggestion) throw new Error('no suggestion')
    await act(async () => {
      suggestion.click()
    })
    // user message should appear immediately
    expect(document.body.textContent).toContain('What kind of creators are a good fit for me?')
    await act(async () => {})

    expect(calls.some((c) => c.url === '/api/creators/creator-mind/mind/query')).toBe(true)
    const postCall = calls.find((c) => c.url.includes('/mind/query'))
    const body = JSON.parse((postCall?.init?.body as string) ?? '{}')
    expect(body.query).toBe('What kind of creators are a good fit for me?')
  })

  it('user message and successful Mind response render, multiple messages remain', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'POST', url: '/api/creators/creator-mind/mind/query', status: 200, body: { answer: 'First answer' } },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')
    if (!input) throw new Error('input not found')
    const prototype = HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'Hello mind')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = document.querySelector('form')
    if (!form) throw new Error('form not found')
    await act(async () => {
      form.requestSubmit()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Hello mind')
    expect(document.body.textContent).toContain('First answer')
    expect(calls.some((c) => c.init?.method === 'POST' && c.url.includes('/mind/query'))).toBe(true)

    // Send second message
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url === '/api/creators/creator-mind/mind' && (init?.method ?? 'GET') === 'GET') {
          return { ok: true, status: 200, json: async () => mindContext() } as unknown as Response
        }
        if (url === '/api/creators/creator-mind/mind/query') {
          return { ok: true, status: 200, json: async () => ({ answer: 'Second answer' }) } as unknown as Response
        }
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response
      }),
    )
    const input2 = document.querySelector<HTMLTextAreaElement>('#mind-query')
    if (!input2) throw new Error('second input not found')
    await act(async () => {
      setter?.call(input2, 'Second question')
      input2.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form2 = document.querySelector('form')
    await act(async () => {
      form2?.requestSubmit()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Hello mind')
    expect(document.body.textContent).toContain('First answer')
    expect(document.body.textContent).toContain('Second question')
    expect(document.body.textContent).toContain('Second answer')
  })

  it('shows loading and disables send while waiting', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'POST', url: '/api/creators/creator-mind/mind/query', status: 200, body: { answer: 'delayed' }, delayMs: 50 },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'test loading')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const sendBtn = document.querySelector<HTMLButtonElement>('.mind-send')!
    expect(sendBtn.disabled).toBe(false)

    const form = document.querySelector('form')!
    await act(async () => {
      form.requestSubmit()
    })
    // Should be disabled while sending and show loading
    expect(document.querySelector<HTMLButtonElement>('.mind-send')?.disabled).toBe(true)
    expect(document.body.innerHTML).toContain('mind-bubble--loading')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })
    // Flush any pending state updates
    await act(async () => {})
    // After sending, input is cleared so button stays disabled due to empty input, but loading should be gone
    expect(document.body.innerHTML).not.toContain('mind-bubble--loading')
    expect(document.body.textContent).toContain('delayed')
    // Button remains disabled because input is empty after send
    expect(document.querySelector<HTMLButtonElement>('.mind-send')?.disabled).toBe(true)
  })

  it('API 503 triggers intelligent autonomous fallback response', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/mind/history', status: 200, body: { interactions: [] } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/query',
        status: 503,
        body: { error: 'Minds adapter not configured — no SDK present' },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('form')?.requestSubmit()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('guarding')
    expect(document.body.textContent).not.toContain('Minds adapter not configured')
    expect(document.body.textContent).not.toContain('stack')
  })

  it('API 400/404/500 triggers graceful fallback without raw stack', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/mind/history', status: 200, body: { interactions: [] } },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/query',
        status: 500,
        body: { error: 'Internal Server Error' },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('form')?.requestSubmit()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('guarding')
    expect(document.body.textContent).not.toContain('stack')
  })

  it('empty query is not submitted', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const sendBtn = document.querySelector<HTMLButtonElement>('.mind-send')!
    expect(sendBtn.disabled).toBe(true)

    const form = document.querySelector('form')!
    await act(async () => {
      form.requestSubmit()
    })
    await act(async () => {})

    // Should not have called query
    expect(calls.some((c) => c.url.includes('/mind/query'))).toBe(false)
  })

  it('shows setup path when no creator', async () => {
    localStorage.clear()
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('No Mind found')
    expect(document.querySelector('a[href="/"]')).not.toBeNull()
  })

  it('Enter sends, Shift+Enter does not', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'POST', url: '/api/creators/creator-mind/mind/query', status: 200, body: { answer: 'ok' } },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'enter test')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true }))
    })
    await act(async () => {})

    expect(calls.some((c) => c.url.includes('/mind/query'))).toBe(true)

    // Reset calls
    calls.length = 0
    await act(async () => {
      setter?.call(input, 'shift enter')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    })
    await act(async () => {})

    expect(calls.some((c) => c.url.includes('/mind/query'))).toBe(false)
  })

  it('sends memorySearch only when the opt-in checkbox is checked', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'POST', url: '/api/creators/creator-mind/mind/query', status: 200, body: { answer: 'ok' } },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const checkbox = document.querySelector<HTMLInputElement>('.mind-search-toggle input')
    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(false)

    // Unchecked: send without memorySearch
    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'plain question')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('form')?.requestSubmit()
    })
    await act(async () => {})
    let postCall = calls.find((c) => c.url.includes('/mind/query'))
    let body = JSON.parse((postCall?.init?.body as string) ?? '{}')
    expect(body.query).toBe('plain question')
    expect(body).not.toHaveProperty('memorySearch')

    // Checked: send with the chat text as memorySearch
    calls.length = 0
    await act(async () => {
      checkbox?.click()
    })
    expect(checkbox?.checked).toBe(true)
    await act(async () => {
      setter?.call(input, 'electronic question')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('form')?.requestSubmit()
    })
    await act(async () => {})
    postCall = calls.find((c) => c.url.includes('/mind/query'))
    body = JSON.parse((postCall?.init?.body as string) ?? '{}')
    expect(body.query).toBe('electronic question')
    expect(body.memorySearch).toBe('electronic question')
  })

  it('renders interactive negotiation action button when Mind suggests negotiation and clicking starts live flow', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    localStorage.setItem('linkup_go_open_configured_creator-mind', 'true')
    stubFetch([
      {
        method: 'GET',
        url: '/api/creators/creator-mind/mind',
        status: 200,
        body: {
          ...mindContext(),
          matches: {
            matches: [
              {
                creator: { creatorId: 'c_arif', displayName: 'Arif Beats', bio: 'Beatmaker' },
                score: 23,
                sharedTerms: ['Music'],
              },
            ],
            total: 1,
          },
        },
      },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/query',
        status: 200,
        body: {
          answer:
            'Based on your Music focus, your strongest match is Arif Beats (23% match). Would you like me to initiate an autonomous negotiation with them?',
        },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'Who fits me?')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('form')?.requestSubmit()
    })
    await act(async () => {})

    // Action button should be rendered inside the Mind chat bubble
    const actionBtn = document.querySelector<HTMLButtonElement>('.mind-chat-actions button')
    expect(actionBtn).not.toBeNull()
    expect(actionBtn?.textContent).toContain('Start Live Autonomous Negotiation with Arif Beats')
  })
})

