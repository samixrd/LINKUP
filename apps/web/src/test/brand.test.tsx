import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import BrandPage from '../pages/BrandPage.tsx'

describe('BrandPage E2E', () => {
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
    container = null
    vi.unstubAllGlobals()
  })

  it('renders header with LINKUP* logo image and brand campaign specs', async () => {
    const mockAccount = {
      handle: 'brand_partner',
      brandId: 'brand_brand_partner',
      brandName: 'Brand Partner',
      industry: 'Tech & AI',
      targetPlatform: 'Instagram',
      collabFormat: 'Dedicated 60s Reel / TikTok',
      budgetTier: '$300 - $1,000 (Mid-tier Growth)',
      guardrails: 'Family-friendly content only',
      createdAt: '2026-08-28T00:00:00.000Z',
    }
    const mockCreators = [
      {
        creatorId: 'u_nusrat_vlogs',
        myFollowers: 125000,
        minPartnerFollowers: 0,
        languages: ['bn', 'en'],
        topics: ['Lifestyle', 'Vlogs'],
        platform: 'YouTube',
        niche: 'Lifestyle & Vlogs',
        minRate: 400,
        brandMinRate: 800,
        guardrails: 'Minimum budget $400',
        openForBrands: true,
      },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/brands/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ account: mockAccount }),
          } as Response
        }
        if (url.includes('/api/open-collabs/brands/creators')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ creators: mockCreators, total: 1 }),
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }),
    )

    const root = createRoot(container!)
    await act(async () => {
      root.render(<BrandPage />)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    // 1. Verify header logo image
    const logoImg = container!.querySelector('img.site-logo-img') as HTMLImageElement
    expect(logoImg).not.toBeNull()
    expect(logoImg.src).toContain('/linkup-logo.jpg')
    expect(logoImg.alt).toBe('LINKUP*')

    // 2. Verify portal header and Brand Mind summary from the session account
    expect(container!.textContent).toContain('Find High-Performing Creators for Paid Ads')
    expect(container!.textContent).toContain('Campaign Specs')
    expect(container!.textContent).toContain('Your Brand Mind')
    expect(container!.textContent).toContain('Tech & AI')
    expect(container!.textContent).toContain('@brand_partner')

    // 3. Verify creator feed renders with min ad rate
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(container!.textContent).toContain('nusrat_vlogs')
    expect(container!.textContent).toContain('$800')
    expect(container!.textContent).toContain('Send Sponsorship Offer ⚡')
  })

  it('full E2E flow: specs setup, creator filtering, pitch customization, dispatch and live deal room', async () => {
    const mockCreators = [
      {
        creatorId: 'u_nusrat_vlogs',
        myFollowers: 125000,
        minPartnerFollowers: 0,
        languages: ['bn', 'en'],
        topics: ['Lifestyle'],
        platform: 'YouTube',
        niche: 'Lifestyle & Vlogs',
        minRate: 400,
        brandMinRate: 800,
        guardrails: 'Minimum budget $400 • Quality audio required',
        openForBrands: true,
      },
    ]

    let negotiatedBody: Record<string, unknown> | null = null
    const queryParamsHistory: string[] = []
    const mockAccount = {
      handle: 'notion',
      brandId: 'brand_notion',
      brandName: 'Notion',
      industry: 'Tech & AI',
      targetPlatform: 'Instagram',
      collabFormat: 'Dedicated 60s Reel / TikTok',
      budgetTier: '$300 - $1,000 (Mid-tier Growth)',
      guardrails: 'Family-friendly content only',
      createdAt: '2026-08-28T00:00:00.000Z',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/brands/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ account: mockAccount }),
          } as Response
        }
        if (url.includes('/api/open-collabs/brands/creators')) {
          queryParamsHistory.push(url)
          return {
            ok: true,
            status: 200,
            json: async () => ({ creators: mockCreators, total: 1 }),
          } as Response
        }
        if (url.includes('/api/open-collabs/negotiate')) {
          negotiatedBody = JSON.parse(String(init?.body))
          return {
            ok: true,
            status: 201,
            json: async () => ({
              collaborationId: 'neg_brand_123',
              targetId: 'u_nusrat_vlogs',
              targetName: 'Nusrat Jahan',
              status: 'ready',
              rounds: [
                { round: 1, authorId: 'brand_notion', message: 'Pitch: 60s integration on YouTube' },
                { round: 2, authorId: 'u_nusrat_vlogs', message: 'AGREE: Approved 60s integration with custom discount link.' },
              ],
              score: 95,
              finalPlan: '60s integration on YouTube with custom discount link.',
              readyForSigning: true,
            }),
          } as Response
        }
        if (url.includes('/sign')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'signed', collaborationStatus: 'accepted' }),
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }),
    )

    const root = createRoot(container!)
    await act(async () => {
      root.render(<BrandPage />)
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    // 1. Verify the brand portal loaded from session (not onboarding)
    expect(container!.textContent).toContain('Notion')
    expect(container!.textContent).toContain('Your Brand Mind')

    // 2. Set Campaign Angle & Brief
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    const titleInput = container!.querySelector('input[placeholder*="Summer AI Tool Launch"]') as HTMLInputElement
    const briefTextarea = container!.querySelector('textarea[placeholder*="Key message"]') as HTMLTextAreaElement

    await act(async () => {
      inputSetter?.call(titleInput, 'Notion AI Launch')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
      titleInput.dispatchEvent(new Event('change', { bubbles: true }))

      textareaSetter?.call(briefTextarea, 'Feature 1-click summary button in video')
      briefTextarea.dispatchEvent(new Event('input', { bubbles: true }))
      briefTextarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // 3. Open Proposal Modal
    const sendOfferBtn = Array.from(container!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Send Sponsorship Offer'),
    )
    expect(sendOfferBtn).not.toBeUndefined()

    await act(async () => {
      sendOfferBtn?.click()
    })

    // 4. Verify Modal content & pre-populated values
    expect(container!.textContent).toContain('Pitch to nusrat_vlogs')
    expect(container!.textContent).toContain('Dedicated 60s Reel / TikTok')

    const offerPriceInput = container!.querySelector('.escrow-modal input[type="number"]') as HTMLInputElement
    expect(offerPriceInput.value).toBe('800') // creator.brandMinRate

    // 5. Customize Offer Price to $1000
    await act(async () => {
      inputSetter?.call(offerPriceInput, '1000')
      offerPriceInput.dispatchEvent(new Event('input', { bubbles: true }))
      offerPriceInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // 6. Confirm & Dispatch to Creator Mind
    const confirmBtn = Array.from(container!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Confirm & Dispatch to Creator Mind'),
    )
    expect(confirmBtn).not.toBeUndefined()

    await act(async () => {
      confirmBtn?.click()
    })

    // 7. Verify Payload sent to backend
    const sentBody = (negotiatedBody ?? {}) as Record<string, unknown>
    expect(sentBody.creatorId).toBe('brand_notion')
    expect(sentBody.brandName).toBe('Notion')
    expect(sentBody.targetId).toBe('u_nusrat_vlogs')
    expect(String(sentBody.proposal)).toContain('1000')
    expect(String(sentBody.proposal)).toContain('Notion AI Launch')

    // 8. Live deal room opens automatically
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300))
    })

    expect(container!.textContent).toContain('Autonomous Negotiation')
    expect(container!.textContent).toContain('Your Mind × nusrat_vlogs')
  })
})
