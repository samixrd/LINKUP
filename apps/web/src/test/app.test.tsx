import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App.tsx'

interface StubRoute {
  method: 'GET' | 'POST'
  url: string
  status: number
  body: unknown
}

function renderApp(): void {
  const container = document.getElementById('root')
  if (!container) throw new Error('test root container missing')
  createRoot(container).render(<App />)
}

/** Stubs global fetch with per-route responses and records the calls made. */
function stubFetch(routes: StubRoute[]): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      calls.push({ url, init })
      const route = routes.find((r) => r.method === method && r.url === url)
      if (!route) {
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
      }
      return {
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: async () => route.body,
      }
    }),
  )
  return calls
}

function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function fillAndSubmitForm(displayName: string, bio = ''): void {
  const nameInput = document.querySelector<HTMLInputElement>('input[type="text"]')
  if (!nameInput) throw new Error('display name input not found')
  setFieldValue(nameInput, displayName)
  const bioInput = document.querySelector<HTMLTextAreaElement>('textarea')
  if (bioInput) setFieldValue(bioInput, bio)
  const form = document.querySelector('form')
  if (!form) throw new Error('form not found')
  form.requestSubmit()
}

const profile = (creatorId: string, displayName: string, bio = '') => ({
  creatorId,
  displayName,
  bio,
  avatarUrl: '',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
})

describe('onboarding flow', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('renders the LINKUP landing content', async () => {
    await act(async () => {
      renderApp()
    })
    expect(document.body.textContent).toContain('LINKUP')
    expect(document.body.textContent).toContain('persistent Mind')
  })

  it('shows the onboarding form when no creator is stored', async () => {
    await act(async () => {
      renderApp()
    })
    expect(document.body.textContent).toContain('Set up your Mind')
    expect(document.querySelector<HTMLInputElement>('input[type="text"]')).not.toBeNull()
    expect(document.querySelector('textarea')).not.toBeNull()
  })

  it('creates a profile, stores the creator id, and shows the ready state', async () => {
    const calls = stubFetch([
      {
        method: 'POST',
        url: '/api/creators',
        status: 201,
        body: profile('creator-1', 'Ada Lovelace', 'First programmer.'),
      },
    ])

    await act(async () => {
      renderApp()
    })
    await act(async () => {
      fillAndSubmitForm('Ada Lovelace', 'First programmer.')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Your Mind is ready')
    expect(document.body.textContent).toContain('Ada Lovelace')
    expect(localStorage.getItem('linkup.creatorId')).toBe('creator-1')
    expect(calls).toContainEqual(
      expect.objectContaining({ url: '/api/creators', init: expect.objectContaining({ method: 'POST' }) }),
    )
    const postCall = calls.find((call) => call.init?.method === 'POST')
    const posted = JSON.parse((postCall?.init?.body as string) ?? '{}') as {
      displayName: string
      bio: string
      creatorId: string
    }
    expect(posted.displayName).toBe('Ada Lovelace')
    expect(posted.bio).toBe('First programmer.')
    expect(posted.creatorId).toBeTruthy()
  })

  it('shows an error and stays on the form when creation fails', async () => {
    stubFetch([
      {
        method: 'POST',
        url: '/api/creators',
        status: 409,
        body: { error: 'creator already exists: creator-1' },
      },
    ])

    await act(async () => {
      renderApp()
    })
    await act(async () => {
      fillAndSubmitForm('Ada Lovelace')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('creator already exists')
    expect(document.body.textContent).toContain('Set up your Mind')
    expect(localStorage.getItem('linkup.creatorId')).toBeNull()
  })

  it('shows the stored profile when a creator id is already present', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-7')
    stubFetch([
      {
        method: 'GET',
        url: '/api/creators/creator-7',
        status: 200,
        body: profile('creator-7', 'Grace Hopper'),
      },
    ])

    await act(async () => {
      renderApp()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Your Mind is ready')
    expect(document.body.textContent).toContain('Grace Hopper')
    expect(document.body.textContent).toContain('creator-7')
  })

  it('returns to onboarding when the stored profile no longer exists', async () => {
    localStorage.setItem('linkup.creatorId', 'creator-ghost')
    stubFetch([
      {
        method: 'GET',
        url: '/api/creators/creator-ghost',
        status: 404,
        body: { error: 'creator not found: creator-ghost' },
      },
    ])

    await act(async () => {
      renderApp()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Set up your Mind')
    expect(localStorage.getItem('linkup.creatorId')).toBeNull()
  })
})
