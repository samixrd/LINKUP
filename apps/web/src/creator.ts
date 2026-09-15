import type { CreatorProfile } from './api'

/** localStorage key that holds the signed-in creator's id. */
export const CREATOR_ID_STORAGE_KEY = 'linkup.creatorId'
export const CREATOR_PROFILE_STORAGE_KEY = 'linkup.creatorProfile'

/** Returns the stored creator id, or `null` when this browser is not set up yet. */
export function getStoredCreatorId(): string | null {
  return localStorage.getItem(CREATOR_ID_STORAGE_KEY)
}

/** Persists the creator id for future visits. */
export function storeCreatorId(creatorId: string): void {
  localStorage.setItem(CREATOR_ID_STORAGE_KEY, creatorId)
}

/** Removes a stored creator id, e.g. when it no longer exists server-side. */
export function clearStoredCreatorId(): void {
  localStorage.removeItem(CREATOR_ID_STORAGE_KEY)
}

/** Returns the stored creator profile, or `null` when not cached. */
export function getStoredCreatorProfile(): CreatorProfile | null {
  try {
    const raw = localStorage.getItem(CREATOR_PROFILE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CreatorProfile) : null
  } catch {
    return null
  }
}

/** Persists the creator profile for future visits. */
export function storeCreatorProfile(profile: CreatorProfile): void {
  try {
    localStorage.setItem(CREATOR_PROFILE_STORAGE_KEY, JSON.stringify(profile))
  } catch {}
}

/** Removes the cached creator profile. */
export function clearStoredCreatorProfile(): void {
  localStorage.removeItem(CREATOR_PROFILE_STORAGE_KEY)
}

/** Generates a fresh, opaque creator id. */
export function newCreatorId(): string {
  return crypto.randomUUID()
}

