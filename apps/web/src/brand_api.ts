/**
 * Brand-specific API client for LINKUP brand auth + dispatch.
 * Uses the same API_BASE as the main api.ts but targets /api/brands/*
 */

const API_BASE: string =
  typeof __API_BASE__ !== 'undefined' ? (__API_BASE__ as string) : ''

export interface BrandAccountInfo {
  handle: string
  brandId: string
  brandName: string
  industry: string
  targetPlatform: string
  collabFormat: string
  budgetTier: string
  guardrails: string
  createdAt: string
}

export interface RegisterBrandPayload {
  handle: string
  pin: string
  brandName: string
  industry: string
  targetPlatform: string
  collabFormat: string
  budgetTier: string
  guardrails: string
}

async function brandFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

export async function brandRegister(
  payload: RegisterBrandPayload,
): Promise<{ account: BrandAccountInfo; brandId: string }> {
  const res = await brandFetch('/api/brands/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = (await res.json()) as { error?: string }
    throw new Error(err.error ?? 'Registration failed')
  }
  return res.json() as Promise<{ account: BrandAccountInfo; brandId: string }>
}

export async function brandLogin(handle: string, pin: string): Promise<BrandAccountInfo> {
  const res = await brandFetch('/api/brands/login', {
    method: 'POST',
    body: JSON.stringify({ handle, pin }),
  })
  if (!res.ok) {
    const err = (await res.json()) as { error?: string }
    throw new Error(err.error ?? 'Login failed')
  }
  const data = (await res.json()) as { account: BrandAccountInfo }
  return data.account
}

export async function brandMe(): Promise<BrandAccountInfo | null> {
  try {
    const res = await brandFetch('/api/brands/me')
    if (res.status === 401) return null
    if (!res.ok) return null
    const data = (await res.json()) as { account: BrandAccountInfo }
    return data.account ?? null
  } catch {
    return null
  }
}

export async function brandLogout(): Promise<void> {
  await brandFetch('/api/brands/logout', { method: 'POST' })
}

export async function brandUpdateMind(
  updates: Partial<{
    industry: string
    targetPlatform: string
    collabFormat: string
    budgetTier: string
    guardrails: string
  }>,
): Promise<BrandAccountInfo> {
  const res = await brandFetch('/api/brands/mind', {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update Brand Mind')
  const data = (await res.json()) as { account: BrandAccountInfo }
  return data.account
}

export interface BulkDispatchResult {
  dispatched: number
  skipped: number
  targets: string[]
  message: string
}

export async function brandBulkDispatch(params: {
  niche?: string
  platform?: string
  minFollowers?: number
  message?: string
}): Promise<BulkDispatchResult> {
  const res = await brandFetch('/api/brands/bulk-dispatch', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = (await res.json()) as { error?: string }
    throw new Error(err.error ?? 'Bulk dispatch failed')
  }
  return res.json() as Promise<BulkDispatchResult>
}
