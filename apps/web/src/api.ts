/** Shape of the API health check response. */
export interface HealthStatus {
  status: 'ok' | 'degraded'
  service: string
  version: string
  uptimeSeconds: number
  timestamp: string
}

/** Checks whether the LINKUP API is reachable and healthy. */
export function getHealth(): Promise<HealthStatus> {
  return request('/api/health')
}

/** Shape of a creator profile as returned by the API. */
export interface CreatorProfile {
  creatorId: string
  displayName: string
  bio: string
  avatarUrl: string
  createdAt: string
  updatedAt: string
}

/** Structured profile details (optional fields; null = not yet provided). */
export interface ProfileDetails {
  creatorId: string
  niches: string[]
  platforms: string[]
  audienceSize: string | null
  collabTypes: string[]
  availability: string | null
  location: string | null
  goals: string[]
  dealbreakers: string | null
  portfolioUrl: string | null
  partnerMinAudience?: string | null
  partnerMaxAudience?: string | null
  partnerNiches?: string[]
  minAvgViews?: string | null
  languages?: string[]
  preferredPlatforms?: string[]
  compensation?: string[]
  minBudget?: string | null
  openToSmall?: string | null
  avgViews?: string | null
  updatedAt: string
}

/** Fetches structured profile details + completeness for a creator. */
export function getProfileDetails(
  creatorId: string,
): Promise<{ details: ProfileDetails | null; completeness: number; total: number }> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/profile-details`)
}

/** Updates structured profile details (partial). */
export function updateProfileDetails(
  creatorId: string,
  updates: Partial<ProfileDetails>,
): Promise<{ details: ProfileDetails; completeness: number; total: number }> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/profile-details`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

/** An interview question the Mind asks during onboarding. */
export interface InterviewQuestion {
  id: string
  prompt: string
  options: Array<{ value: string; label: string }> | null
}

/** Fetches the Mind's interview questions + the first unanswered one. */
export function getInterviewQuestions(
  creatorId: string,
): Promise<{
  questions: InterviewQuestion[]
  firstUnanswered: string | null
  completeness: number
  total: number
}> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind/interview/questions`)
}

/** Answers one interview question; returns the next question (or null when done). */
export function answerInterviewQuestion(
  creatorId: string,
  questionId: string,
  answer: string | string[],
): Promise<{
  questionId: string
  nextQuestion: InterviewQuestion | null
  answeredIndex: number
  details: ProfileDetails
  completeness: number
}> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind/interview/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, answer }),
  })
}

export const MEMORY_CATEGORIES = [
  'preference',
  'goal',
  'relationship',
  'collaboration_outcome',
  'lesson',
  'constraint',
  'interaction',
] as const

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

/** Shape of a creator memory as returned by the API. */
export interface CreatorMemory {
  id: string
  creatorId: string
  category: MemoryCategory
  content: string
  createdAt: string
  updatedAt: string
}

/** Thrown when the API responds with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let message = `request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

/** Fetches the profile for a creator. */
export function getProfile(creatorId: string): Promise<CreatorProfile> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}`)
}

/** Compatibility matches for a creator (ranked, with shared terms). */
export function getMatches(creatorId: string): Promise<{
  matches: Array<{
    creator: CreatorProfile
    details?: ProfileDetails
    score: number
    weightedScore?: number
    sharedTerms: string[]
  }>
  total: number
}> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/matches`)
}

/** Creates a creator profile and returns it. */
export function createProfile(input: {
  creatorId: string
  displayName: string
  bio?: string
  avatarUrl?: string
}): Promise<CreatorProfile> {
  return request('/api/creators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

// --- Passcode auth -----------------------------------------------------

export interface AuthMe {
  handle: string
  creatorId: string
  profile: CreatorProfile | null
}

async function authRequest(path: string, input: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Registers handle + pin + profile + onboarding memories; sets the session cookie. */
export async function registerAccount(input: {
  handle: string
  pin: string
  displayName: string
  bio?: string
  memories?: Array<{ category: 'goal' | 'preference' | 'constraint'; content: string }>
}): Promise<AuthMe & { seededMemories: number }> {
  const res = await authRequest('/api/auth/register', input)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Registration failed (${res.status})`)
  }
  return res.json()
}

export async function loginAccount(handle: string, pin: string): Promise<AuthMe> {
  const res = await authRequest('/api/auth/login', { handle, pin })
  if (!res.ok) {
    throw new Error('Wrong handle or PIN')
  }
  return res.json()
}

export async function logoutAccount(): Promise<void> {
  await authRequest('/api/auth/logout', {})
}

export async function fetchMe(): Promise<AuthMe | null> {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  if (!res.ok) return null
  return res.json()
}

/** Lists a creator's memories. */
export function listMemories(creatorId: string): Promise<CreatorMemory[]> {
  return request<{ memories: CreatorMemory[] }>(
    `/api/creators/${encodeURIComponent(creatorId)}/memories`,
  ).then((body) => body.memories)
}

/** Adds a memory to a creator's Mind. */
export function createMemory(
  creatorId: string,
  input: { category: MemoryCategory; content: string },
): Promise<CreatorMemory> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export interface CollaborationProposal {
  id: string
  collaborationId: string
  seq: number
  authorId: string
  proposal: string
  createdAt: string
}

export interface MindContext {
  creator: CreatorProfile
  details?: ProfileDetails
  memories: CreatorMemory[]
  matches: { matches: Array<{ creator: CreatorProfile; details?: ProfileDetails; score: number; sharedTerms: string[] }>; total: number }
  collaborations: {
    collaborations: Array<{
      id: string
      status: string
      proposal: string
      counterProposal: string | null
      proposedBy: string
      initiatorId: string
      targetId: string
      createdAt: string
      updatedAt: string
    }>
    total: number
  }
  followUps: Array<{ id: string; dueAt: string; status: string }>
  outcomes: CreatorMemory[]
  negotiationHistory: CollaborationProposal[]
}

export function getMindContext(creatorId: string): Promise<MindContext> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind`)
}

export function queryMind(
  creatorId: string,
  query: string,
  opts?: { memorySearch?: string },
): Promise<{ answer: string }> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      ...(opts?.memorySearch !== undefined ? { memorySearch: opts.memorySearch } : {}),
    }),
  })
}

export interface MindInteraction {
  id: string
  creatorId: string
  role: 'user' | 'mind'
  content: string
  createdAt: string
}

export function listMindHistory(
  creatorId: string,
  opts?: { limit?: number; offset?: number },
): Promise<{ interactions: MindInteraction[]; total: number }> {
  const params = new URLSearchParams()
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset))
  const qs = params.toString() ? `?${params.toString()}` : ''
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind/history${qs}`)
}

export function saveMindMemory(
  creatorId: string,
  input: { interactionId: string; category: MemoryCategory; content: string },
): Promise<CreatorMemory> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Shape of a Mind collaboration preview. */
export interface MindCollaborationPreview {
  target: CreatorProfile
  targetDetails?: ProfileDetails
  score: number
  sharedTerms: string[]
  proposal: string
}

/** Shape of a collaboration as returned by the API. */
export interface Collaboration {
  id: string
  initiatorId: string
  targetId: string
  status: string
  proposal: string
  counterProposal: string | null
  proposedBy: string
  createdAt: string
  updatedAt: string
}

/** Shape of a Mind negotiation preview. */
export interface MindNegotiationPreview {
  collaborationId: string
  originalProposal: string
  currentProposal: string
  counterProposal: string | null
  proposedBy: string
  status: string
  proposal: string
}

/** Dry-runs a Mind collaboration proposal for the given target (or top match). */
export function previewMindCollaboration(
  creatorId: string,
  targetId?: string,
): Promise<{ preview: MindCollaborationPreview }> {
  const body: Record<string, string> = {}
  if (targetId !== undefined) body.targetId = targetId
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind/collaborations/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Executes a Mind collaboration after human confirmation. */
export function executeMindCollaboration(
  creatorId: string,
  targetId: string,
): Promise<{ collaboration: Collaboration }> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/mind/collaborations/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId, confirm: true }),
  })
}

/** Lists a creator's collaborations. */
export function listCollaborations(
  creatorId: string,
  opts?: { status?: string; limit?: number; offset?: number },
): Promise<{ collaborations: Collaboration[]; total: number }> {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  const qs = params.toString() ? `?${params.toString()}` : ''
  return request(`/api/creators/${encodeURIComponent(creatorId)}/collaborations${qs}`)
}

/** Fetches a single collaboration for a creator (creator-isolated). */
export function getCollaborationForCreator(
  creatorId: string,
  collaborationId: string,
): Promise<Collaboration> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/collaborations/${encodeURIComponent(collaborationId)}`)
}

/** Submits a counter-proposal for a collaboration. */
export function counterCollaboration(
  creatorId: string,
  collaborationId: string,
  counterProposal: string,
): Promise<Collaboration> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/collaborations/${encodeURIComponent(collaborationId)}/counter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ counterProposal }),
  })
}

/** Updates a collaboration's status (accept/reject/cancel). */
export function updateCollaborationStatus(
  creatorId: string,
  collaborationId: string,
  status: string,
): Promise<Collaboration> {
  return request(`/api/creators/${encodeURIComponent(creatorId)}/collaborations/${encodeURIComponent(collaborationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

/** Mind-drafted counter-proposal preview (dry run). */
export function previewMindCounter(
  creatorId: string,
  collaborationId: string,
): Promise<{ preview: MindNegotiationPreview }> {
  return request(
    `/api/creators/${encodeURIComponent(creatorId)}/mind/collaborations/${encodeURIComponent(collaborationId)}/negotiate/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

/** Executes a Mind-drafted counter-proposal after human confirmation. */
export function executeMindCounter(
  creatorId: string,
  collaborationId: string,
): Promise<{ collaboration: Collaboration }> {
  return request(
    `/api/creators/${encodeURIComponent(creatorId)}/mind/collaborations/${encodeURIComponent(collaborationId)}/negotiate/counter`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    },
  )
}

/** Fetches the ordered negotiation history for a collaboration. */
export function getNegotiationHistory(
  creatorId: string,
  collaborationId: string,
): Promise<{ proposals: CollaborationProposal[]; total: number; history: CollaborationProposal[] }> {
  return request(
    `/api/creators/${encodeURIComponent(creatorId)}/collaborations/${encodeURIComponent(collaborationId)}/negotiate/history`,
  )
}

/** Shape of a structured Mind negotiation decision. */
export interface MindNegotiationDecision {
  action: 'accept' | 'reject' | 'counter'
  reasoning: string
  counterProposal?: string
}

/** Asks the Mind for a structured negotiation decision (read-only). */
export function getMindDecision(
  creatorId: string,
  collaborationId: string,
): Promise<{ decision: MindNegotiationDecision }> {
  return request(
    `/api/creators/${encodeURIComponent(creatorId)}/mind/collaborations/${encodeURIComponent(collaborationId)}/negotiate/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}
