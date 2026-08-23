import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App.tsx'

function stubFetch(routes: Array<{ method: 'GET' | 'POST'; url: string; status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET') as 'GET' | 'POST'
      const route = routes.find((r) => r.method === method && r.url === url)
      if (!route) {
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response
      }
      return {
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: async () => route.body,
      } as unknown as Response
    }),
  )
}

function renderAppAt(path: string) {
  window.history.pushState({}, '', path)
  const container = document.getElementById('root')
  if (!container) throw new Error('root missing')
  createRoot(container).render(<App />)
}

const mindContext = (creatorId = 'creator-mind') => ({
  creator: { creatorId, displayName: 'Ada Lovelace', bio: 'Loves pottery', avatarUrl: '', createdAt: '', updatedAt: '' },
  memories: [],
  matches: { matches: [], total: 0 },
  collaborations: { collaborations: [], total: 0 },
  followUps: [],
  outcomes: [],
})

const historyWithMessages = {
  interactions: [
    { id: 'int_user', creatorId: 'creator-mind', role: 'user', content: 'Hello history', createdAt: '2026-08-20T00:00:00.000Z' },
    { id: 'int_mind', creatorId: 'creator-mind', role: 'mind', content: 'Hi history', createdAt: '2026-08-20T00:01:00.000Z' },
  ],
  total: 2,
}

describe('mind history + save', () => {
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

  it('existing history renders', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/mind/history?limit=100', status: 200, body: historyWithMessages },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    expect(document.body.textContent).toContain('Hello history')
    expect(document.body.textContent).toContain('Hi history')
  })

  it('empty history shows suggestions', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/mind/history?limit=100', status: 200, body: { interactions: [], total: 0 } },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})
    expect(document.body.textContent).toContain('What kind of creators are a good fit for me?')
  })

  it('new query persists and appears, reload retrieves history', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    let historyCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = (init?.method ?? 'GET') as 'GET' | 'POST'
        if (url === '/api/creators/creator-mind/mind' && method === 'GET') {
          return { ok: true, status: 200, json: async () => mindContext() } as unknown as Response
        }
        if (url === '/api/creators/creator-mind/mind/history?limit=100' && method === 'GET') {
          historyCalls += 1
          if (historyCalls === 1) {
            return { ok: true, status: 200, json: async () => ({ interactions: [], total: 0 }) } as unknown as Response
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              interactions: [
                { id: 'int_user', creatorId: 'creator-mind', role: 'user', content: 'New query', createdAt: '2026-08-20T00:00:00.000Z' },
                { id: 'int_mind', creatorId: 'creator-mind', role: 'mind', content: 'Persisted answer', createdAt: '2026-08-20T00:01:00.000Z' },
              ],
              total: 2,
            }),
          } as unknown as Response
        }
        if (url === '/api/creators/creator-mind/mind/query' && method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ answer: 'Persisted answer' }) } as unknown as Response
        }
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response
      }),
    )
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'New query')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('form')?.requestSubmit()
    })
    await act(async () => {})
    // Wait for history refresh
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('New query')
    expect(document.body.textContent).toContain('Persisted answer')
  })

  it('Save to Mind button exists for mind messages', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'GET',
        url: '/api/creators/creator-mind/mind/history?limit=100',
        status: 200,
        body: historyWithMessages,
      },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const saveBtn = document.querySelector<HTMLButtonElement>('.mind-save-btn')
    expect(saveBtn).not.toBeNull()
    expect(saveBtn?.textContent).toContain('Save to Mind')
  })

  it('Save to Mind opens form and explicit save creates memory', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/mind/history?limit=100', status: 200, body: historyWithMessages },
      { method: 'POST', url: '/api/creators/creator-mind/mind/memory', status: 201, body: { id: 'mem1', category: 'preference', content: 'Saved' } },
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const saveBtn = document.querySelector<HTMLButtonElement>('.mind-save-btn')!
    await act(async () => {
      saveBtn.click()
    })
    expect(document.body.textContent).toContain('Save to Mind')
    expect(document.querySelector<HTMLSelectElement>('select')).not.toBeNull()

    const select = document.querySelector<HTMLSelectElement>('select')!
    await act(async () => {
      select.value = 'goal'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const textarea = document.querySelector<HTMLTextAreaElement>('.mind-save-form textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(textarea, 'Saved content')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveForm = document.querySelector<HTMLFormElement>('.mind-save-form')!
    await act(async () => {
      saveForm.requestSubmit()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Saved to Mind')
  })

  it('save error shows', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      { method: 'GET', url: '/api/creators/creator-mind/mind/history?limit=100', status: 200, body: historyWithMessages },
      { method: 'POST', url: '/api/creators/creator-mind/mind/memory', status: 400, body: { error: 'category must be one of' } },
    ])
    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.mind-save-btn')?.click()
    })
    await act(async () => {})

    const form = document.querySelector<HTMLFormElement>('.mind-save-form')!
    await act(async () => {
      form.requestSubmit()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('category must be one of')
  })

  it('no automatic memory save after querying', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        calls.push(`${method} ${url}`)
        if (url === '/api/creators/creator-mind/mind' && method === 'GET') {
          return { ok: true, status: 200, json: async () => mindContext() } as unknown as Response
        }
        if (url === '/api/creators/creator-mind/mind/history?limit=100' && method === 'GET') {
          return { ok: true, status: 200, json: async () => ({ interactions: [], total: 0 }) } as unknown as Response
        }
        if (url === '/api/creators/creator-mind/mind/query' && method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ answer: 'hi' }) } as unknown as Response
        }
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response
      }),
    )

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const input = document.querySelector<HTMLTextAreaElement>('#mind-query')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'test')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('form')?.requestSubmit()
    })
    await act(async () => {})

    expect(calls.some((c) => c.includes('/mind/memory'))).toBe(false)
    expect(calls.some((c) => c.includes('/memories') && c.startsWith('POST'))).toBe(false)
  })
})
