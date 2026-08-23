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

function setFieldValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function clickButtonWithText(text: string): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
  const target = buttons.find((b) => b.textContent?.includes(text))
  if (!target) throw new Error(`button not found: ${text}`)
  target.click()
}

async function walkOnboardingToIdentity(): Promise<void> {
  clickButtonWithText('Start')
  await act(async () => {})
  // Step craft
  clickButtonWithText('Music')
  await act(async () => {})
  clickButtonWithText('Continue →')
  await act(async () => {})
  // Step platforms
  clickButtonWithText('YouTube')
  await act(async () => {})
  clickButtonWithText('Continue →')
  await act(async () => {})
  // Step audience
  clickButtonWithText('~1k')
  await act(async () => {})
  clickButtonWithText('Continue →')
  await act(async () => {})
  // Step goal
  clickButtonWithText('Grow my audience')
  await act(async () => {})
  clickButtonWithText('Continue →')
  await act(async () => {})
  // Step vibe
  clickButtonWithText('Experimental')
  await act(async () => {})
  clickButtonWithText('Last step →')
  await act(async () => {})
}

const meBody = (creatorId: string, displayName: string) => ({
  handle: creatorId.replace(/^u_/, ''),
  creatorId,
  profile: {
    creatorId,
    displayName,
    bio: '',
    avatarUrl: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
})

describe('auth onboarding flow', () => {
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
    stubFetch([{ method: 'GET', url: '/api/auth/me', status: 401, body: { error: 'not signed in' } }])
    await act(async () => {
      renderApp()
    })
    expect(document.body.textContent).toContain('LINKUP')
    expect(document.body.textContent).toContain('persistent Mind')
  })

  it('shows the Mind intro card when no session exists', async () => {
    stubFetch([{ method: 'GET', url: '/api/auth/me', status: 401, body: { error: 'not signed in' } }])
    await act(async () => {
      renderApp()
    })
    expect(document.body.textContent).toContain('Meet your Mind')
    expect(document.body.textContent).toContain('Start — it takes 60 seconds')
  })

  it('walks the steps, registers with memories, and shows the ready state', async () => {
    const calls = stubFetch([
      { method: 'GET', url: '/api/auth/me', status: 401, body: { error: 'not signed in' } },
      {
        method: 'POST',
        url: '/api/auth/register',
        status: 201,
        body: { ...meBody('u_ada', 'ada'), seededMemories: 3 },
      },
    ])

    await act(async () => {
      renderApp()
    })
    await act(async () => {
      await walkOnboardingToIdentity()
    })

    // Identity step inputs
    const nameInput = document.querySelector<HTMLInputElement>('input[placeholder^="How should we know"]')
    if (!nameInput) throw new Error('name input missing')
    setFieldValue(nameInput, 'Ada Lovelace')
    const handleInput = document.querySelector<HTMLInputElement>('input[placeholder*="lowercase"]')
    if (!handleInput) throw new Error('handle input missing')
    setFieldValue(handleInput, 'ada')
    const pinInput = document.querySelector<HTMLInputElement>('input[type="password"]')
    if (!pinInput) throw new Error('pin input missing')
    setFieldValue(pinInput, '1234')

    await act(async () => {
      clickButtonWithText('Create my Mind')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Your Mind is ready')
    expect(document.body.textContent).toContain('Ada Lovelace')

    const registerCall = calls.find((c) => c.url === '/api/auth/register')
    expect(registerCall).toBeDefined()
    const posted = JSON.parse((registerCall?.init?.body as string) ?? '{}') as {
      handle: string
      pin: string
      displayName: string
      memories: Array<{ category: string; content: string }>
    }
    expect(posted.handle).toBe('ada')
    expect(posted.displayName).toBe('Ada Lovelace')
    // Structured memories were seeded for the Mind
    expect(posted.memories.length).toBeGreaterThanOrEqual(3)
    expect(posted.memories.some((m) => m.category === 'goal')).toBe(true)
  })

  it('signs in an existing account via the login card', async () => {
    stubFetch([
      { method: 'GET', url: '/api/auth/me', status: 401, body: { error: 'not signed in' } },
      { method: 'POST', url: '/api/auth/login', status: 200, body: meBody('u_grace', 'grace') },
    ])

    await act(async () => {
      renderApp()
    })
    await act(async () => {
      clickButtonWithText('I already have an account')
    })

    const handleInput = document.querySelector<HTMLInputElement>('input[placeholder="your_handle"]')
    if (!handleInput) throw new Error('login handle input missing')
    setFieldValue(handleInput, 'grace')
    const pinInput = document.querySelector<HTMLInputElement>('input[type="password"]')
    if (!pinInput) throw new Error('login pin input missing')
    setFieldValue(pinInput, '1234')

    await act(async () => {
      clickButtonWithText('Sign in')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Your Mind is ready')
  })

  it('shows a login error and stays on the card when credentials are wrong', async () => {
    stubFetch([
      { method: 'GET', url: '/api/auth/me', status: 401, body: { error: 'not signed in' } },
      { method: 'POST', url: '/api/auth/login', status: 401, body: { error: 'invalid handle or pin' } },
    ])

    await act(async () => {
      renderApp()
    })
    await act(async () => {
      clickButtonWithText('I already have an account')
    })
    const handleInput = document.querySelector<HTMLInputElement>('input[placeholder="your_handle"]')
    if (!handleInput) throw new Error('missing input')
    setFieldValue(handleInput, 'ghost')
    const pinInput = document.querySelector<HTMLInputElement>('input[type="password"]')
    if (!pinInput) throw new Error('missing pin')
    setFieldValue(pinInput, '0000')

    await act(async () => {
      clickButtonWithText('Sign in')
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Wrong handle or PIN')
    expect(document.body.textContent).toContain('Welcome back')
  })

  it('restores the session from the cookie on boot', async () => {
    stubFetch([{ method: 'GET', url: '/api/auth/me', status: 200, body: meBody('u_hopper', 'Grace Hopper') }])

    await act(async () => {
      renderApp()
    })
    await act(async () => {})

    expect(document.body.textContent).toContain('Your Mind is ready')
    expect(document.body.textContent).toContain('Grace Hopper')
  })
})
