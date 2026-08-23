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

/** A match with a specific creator for collaboration testing. */
const matchCreator = (id: string, name: string, bio: string, score: number, terms: string[]) => ({
  creator: { creatorId: id, displayName: name, bio, avatarUrl: '', createdAt: '', updatedAt: '' },
  score,
  sharedTerms: terms,
})

const mindContext = (
  creatorId = 'creator-mind',
  displayName = 'Ada Lovelace',
  matches: ReturnType<typeof matchCreator>[] = [
    matchCreator('match-one', 'Marie Curie', 'Loves radium', 3, ['science', 'curiosity', 'radium']),
  ],
) => ({
  creator: {
    creatorId,
    displayName,
    bio: 'Loves pottery',
    avatarUrl: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  memories: [
    { id: 'mem1', creatorId, category: 'preference', content: 'Prefers async', createdAt: '', updatedAt: '' },
  ],
  matches: { matches, total: matches.length },
  collaborations: { collaborations: [{ id: 'collab1', status: 'pending' }], total: 1 },
  followUps: [{ id: 'follow1', dueAt: '2026-08-26T10:00:00.000Z', status: 'pending' }],
  outcomes: [],
})

describe('mind collaboration panel', () => {
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

  it('renders the Propose Collaboration button in the header', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Propose Collaboration')
    const btn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    expect(btn).not.toBeNull()
  })

  it('opens the collaboration panel on button click', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    expect(openBtn).not.toBeNull()
    await act(async () => {
      openBtn?.click()
    })

    expect(document.body.textContent).toContain('N°004 — Collaboration')
    expect(document.body.textContent).toContain('Propose Collaboration')
    expect(document.body.textContent).toContain('Top match')
    expect(document.body.textContent).toContain('Marie Curie')
  })

  it('shows match selector with top match highlighted', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Compatible creator"]')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('match-one')
    expect(select?.options.length).toBe(1)
    expect(select?.options[0]?.text).toContain('Top match')
    expect(select?.options[0]?.text).toContain('Marie Curie')
  })

  it('preview request is sent and preview data is displayed', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 200,
        body: {
          preview: {
            target: {
              creatorId: 'match-one',
              displayName: 'Marie Curie',
              bio: 'Loves radium',
              avatarUrl: '',
              createdAt: '',
              updatedAt: '',
            },
            score: 3,
            sharedTerms: ['science', 'curiosity', 'radium'],
            proposal: 'Co-author a research paper on the properties of radium.',
          },
        },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    const previewBtn = document.querySelector<HTMLButtonElement>('.collab-preview-btn')
    expect(previewBtn).not.toBeNull()
    await act(async () => {
      previewBtn?.click()
    })
    await act(async () => {})

    // Preview data should be visible
    expect(document.body.textContent).toContain('Marie Curie')
    expect(document.body.textContent).toContain('3 shared terms')
    expect(document.body.textContent).toContain('Loves radium')
    expect(document.body.textContent).toContain('science')
    expect(document.body.textContent).toContain('curiosity')
    expect(document.body.textContent).toContain('radium')
    expect(document.body.textContent).toContain('Co-author a research paper on the properties of radium.')
  })

  it('requires confirmation checkbox before execute', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 200,
        body: {
          preview: {
            target: {
              creatorId: 'match-one',
              displayName: 'Marie Curie',
              bio: 'Loves radium',
              avatarUrl: '',
              createdAt: '',
              updatedAt: '',
            },
            score: 3,
            sharedTerms: ['science'],
            proposal: 'Co-author a paper.',
          },
        },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    // Click preview
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.click()
    })
    await act(async () => {})

    // Confirm button should be disabled because checkbox is not checked
    const confirmBtn = document.querySelector<HTMLButtonElement>('.collab-confirm-btn')
    expect(confirmBtn).not.toBeNull()
    expect(confirmBtn?.disabled).toBe(true)

    // Check the confirmation checkbox
    const checkbox = document.querySelector<HTMLInputElement>('.collab-confirm input')
    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(false)
    await act(async () => {
      checkbox?.click()
    })
    expect(checkbox?.checked).toBe(true)

    // Confirm button should now be enabled
    expect(confirmBtn?.disabled).toBe(false)
    expect(document.body.textContent).toContain('I confirm I want to send')
  })

  it('execute request on confirmation creates collaboration', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 200,
        body: {
          preview: {
            target: {
              creatorId: 'match-one',
              displayName: 'Marie Curie',
              bio: 'Loves radium',
              avatarUrl: '',
              createdAt: '',
              updatedAt: '',
            },
            score: 3,
            sharedTerms: ['science'],
            proposal: 'Co-author a paper.',
          },
        },
      },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/execute',
        status: 201,
        body: {
          collaboration: {
            id: 'collab-new',
            initiatorId: 'creator-mind',
            targetId: 'match-one',
            status: 'pending',
            proposal: 'Co-author a paper.',
            createdAt: '2026-08-21T00:00:00.000Z',
            updatedAt: '2026-08-21T00:00:00.000Z',
          },
        },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    // Preview
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.click()
    })
    await act(async () => {})

    // Check confirmation
    await act(async () => {
      document.querySelector<HTMLInputElement>('.collab-confirm input')?.click()
    })

    // Execute
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-confirm-btn')?.click()
    })
    await act(async () => {})

    // Should show success
    expect(document.body.textContent).toContain('Collaboration created')
    expect(document.body.textContent).toContain('Marie Curie')
    expect(document.body.textContent).toContain('pending')
    expect(document.body.textContent).toContain('collab-new')
  })

  it('duplicate pending collaboration shows friendly 409 error', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 200,
        body: {
          preview: {
            target: {
              creatorId: 'match-one',
              displayName: 'Marie Curie',
              bio: 'Loves radium',
              avatarUrl: '',
              createdAt: '',
              updatedAt: '',
            },
            score: 3,
            sharedTerms: ['science'],
            proposal: 'Co-author a paper.',
          },
        },
      },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/execute',
        status: 409,
        body: { error: 'active collaboration already exists for this pair' },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    // Preview
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.click()
    })
    await act(async () => {})

    // Check confirmation
    await act(async () => {
      document.querySelector<HTMLInputElement>('.collab-confirm input')?.click()
    })

    // Execute
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-confirm-btn')?.click()
    })
    await act(async () => {})

    // Should show friendly 409 error
    expect(document.body.textContent).toContain('A collaboration with this creator is already pending.')
    // Should not show the raw error
    expect(document.body.textContent).not.toContain('active collaboration already exists')
    // Success state should NOT be shown
    expect(document.body.textContent).not.toContain('Collaboration created')
  })

  it('provider unavailable shows friendly 503 error', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 503,
        body: { error: 'Minds adapter not configured — no SDK present' },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    // Try to preview
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.click()
    })
    await act(async () => {})

    // Should show friendly 503 message
    expect(document.body.textContent).toContain('Minds is not connected yet.')
    // Should not leak raw error
    expect(document.body.textContent).not.toContain('Minds adapter not configured')
  })

  it('preview failure shows friendly error', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 500,
        body: { error: 'collaboration preview failed' },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.click()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Something went wrong. Please try again.')
    expect(document.body.textContent).not.toContain('collaboration preview failed')
  })

  it('no accidental execution without confirmation', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    const calls = stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 200,
        body: {
          preview: {
            target: {
              creatorId: 'match-one',
              displayName: 'Marie Curie',
              bio: 'Loves radium',
              avatarUrl: '',
              createdAt: '',
              updatedAt: '',
            },
            score: 3,
            sharedTerms: ['science'],
            proposal: 'Co-author a paper.',
          },
        },
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    // Preview
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.click()
    })
    await act(async () => {})

    // Confirm button is disabled, try clicking it anyway
    const confirmBtn = document.querySelector<HTMLButtonElement>('.collab-confirm-btn')
    expect(confirmBtn?.disabled).toBe(true)
    await act(async () => {
      confirmBtn?.click()
    })
    await act(async () => {})

    // Should NOT have called execute
    expect(calls.some((c) => c.url.includes('/collaborations/execute'))).toBe(false)
  })

  it('shows loading/disabled states while previewing', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      { method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() },
      {
        method: 'POST',
        url: '/api/creators/creator-mind/mind/collaborations/preview',
        status: 200,
        body: { preview: { target: mindContext().creator, score: 1, sharedTerms: [], proposal: 'test' } },
        delayMs: 50,
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    const previewBtn = document.querySelector<HTMLButtonElement>('.collab-preview-btn')
    expect(previewBtn?.disabled).toBe(false)
    expect(previewBtn?.textContent).toContain('Preview proposal')

    await act(async () => {
      previewBtn?.click()
    })

    // Should be disabled while loading
    expect(document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.disabled).toBe(true)
    expect(document.body.textContent).toContain('Drafting')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    await act(async () => {})

    // After loading, button should be enabled again
    expect(document.querySelector<HTMLButtonElement>('.collab-preview-btn')?.disabled).toBe(false)
    expect(document.body.textContent).not.toContain('Drafting')
  })

  it('creator isolation: matches are scoped to the current creator', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    // Only one match
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Compatible creator"]')
    expect(select).not.toBeNull()
    // Only the creators in this context's matches should show
    expect(select?.options.length).toBe(1)
    expect(select?.options[0]?.text).toContain('Marie Curie')
    // No other creator should appear
    expect(select?.options[0]?.text).not.toContain('Ada')
  })

  it('shows no-matches message when there are no compatible creators', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([
      {
        method: 'GET',
        url: '/api/creators/creator-mind/mind',
        status: 200,
        body: mindContext('creator-mind', 'Ada Lovelace', []),
      },
    ])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    expect(document.body.textContent).toContain('No compatible creators found yet')
    // Preview button should still be visible but less relevant
    expect(document.body.textContent).toContain('Preview proposal')
  })

  it('closes panel when close button is clicked', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-mind')
    stubFetch([{ method: 'GET', url: '/api/creators/creator-mind/mind', status: 200, body: mindContext() }])

    await act(async () => {
      renderAppAt('/mind')
    })
    await act(async () => {})

    const openBtn = document.querySelector<HTMLButtonElement>('.collab-open-btn')
    await act(async () => {
      openBtn?.click()
    })

    expect(document.body.textContent).toContain('N°004 — Collaboration')

    // Click close
    const closeBtns = document.querySelectorAll<HTMLButtonElement>('.btn-ghost')
    // There may be multiple .btn-ghost elements; find the one in the collab panel
    const closeBtnsArray = Array.from(closeBtns)
    // The close button is the last one visible in the panel
    await act(async () => {
      closeBtnsArray[closeBtnsArray.length - 1]?.click()
    })

    expect(document.body.textContent).not.toContain('N°004 — Collaboration')
  })
})