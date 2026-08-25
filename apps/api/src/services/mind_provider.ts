import { createHash } from 'node:crypto'
import {
  MindsApiError,
  createMindsClient,
  type Conversation,
  type SendMessageBody,
  type WaitForReplyOptions,
  type WaitForReplyOutcome,
} from '@animocabrands/minds-client-lib'
import type { MindAdapter, MindContext } from '@linkup/db'
import { stubMindAdapter } from '@linkup/db'
import { DEFAULT_MINDS_REPLY_TIMEOUT_MS, type GroqConfig, type MindsConfig } from '../config.js'

/**
 * Real Minds provider adapter. Sends the structured MindContext (serialized
 * to a text prompt) to a Hello Minds Mind over an alias-based conversation,
 * waits for the Mind's reply, and returns its text. Implements the same
 * `MindAdapter` contract as the stub, so the API route and service are
 * unchanged.
 */

/** Alias prefix — each creator gets a stable, isolated conversation. Bumping the version starts every creator on a fresh Mind thread (old threads stay archived on the provider). */
const ALIAS_PREFIX = 'linkup-v9'

/** Cap on the sanitized creator part of an alias, to bound alias length. */
const MAX_ALIAS_SAFE_LENGTH = 32

/**
 * Narrow messaging surface the adapter needs. The SDK's `MindsClient`
 * satisfies it structurally; tests inject fakes against this interface.
 */
export interface MindsMessagingClient {
  ensureConversation(alias: string, mindId: string): Promise<Conversation>
  getHistory(alias: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<Array<{ fingerprint?: string | null; messageText?: string | null }>>
  sendMessage(body: SendMessageBody): Promise<Record<string, unknown>>
  waitForReply(opts: WaitForReplyOptions): Promise<WaitForReplyOutcome>
}

export interface MindsProviderOptions {
  builderApiKey: string
  mindId: string
  /** Milliseconds to wait for a Mind reply. Defaults to 120000. Must be a positive integer. */
  timeoutMs?: number
  /** Test seam — defaults to the real SDK client. */
  client?: MindsMessagingClient
}

/**
 * Creates the real Minds provider adapter. Throws a "Minds adapter not
 * configured" error (mapped to 503 by the route) when required config is
 * missing; use `resolveMindAdapter` to fall back to the stub instead.
 * `timeoutMs` must be a positive integer when provided.
 */
export function createMindsProviderAdapter(options: MindsProviderOptions): MindAdapter {
  const builderApiKey = options.builderApiKey.trim()
  const mindId = options.mindId.trim()
  if (!builderApiKey) {
    throw new Error('Minds adapter not configured — MINDS_BUILDER_API_KEY is required')
  }
  if (!mindId) {
    throw new Error('Minds adapter not configured — MINDS_MIND_ID is required')
  }
  const client = options.client ?? createMindsClient({ builderApiKey })
  const timeoutMs = options.timeoutMs ?? DEFAULT_MINDS_REPLY_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`Minds provider timeoutMs must be a positive integer, got ${JSON.stringify(options.timeoutMs)}`)
  }
  return new MindsProviderAdapter(client, mindId, timeoutMs)
}

/**
 * Groq fallback adapter. Talks to Groq's OpenAI-compatible chat completions
 * API as a "virtual Mind": the MindContext (profile, details, memories,
 * matches) becomes the system prompt, and the user's input is the message.
 * Used when the real Minds provider is out of credit, slow, or unconfigured.
 */
export function createGroqFallbackAdapter(groq: GroqConfig): MindAdapter {
  return {
    async query(context: MindContext, input: string): Promise<string> {
      const system = buildGroqSystemPrompt(context)
      const reply = await groqChatCompletions(groq, system, input.trim())
      const text = reply.trim()
      if (!text) throw new Error('Groq fallback returned an empty reply')
      return text
    },
  }
}

/** Builds the system prompt for the Groq virtual Mind from the MindContext. */
export function buildGroqSystemPrompt(context: MindContext): string {
  const profile = context.creator
  const d = context.details
  const lines: string[] = []
  lines.push(
    `You are the Mind for ${profile.displayName} on LINKUP, a creator collaboration platform.`,
  )
  lines.push(
    `You are ${profile.displayName}'s personal AI agent: you know their profile, memories, matches and collaborations, and you give honest, direct, practical advice on collab strategy, fit, proposals and negotiations.`,
  )
  lines.push(`Never role-play as ${profile.displayName} or as any other creator — you are their agent, not them.`)
  if (profile.bio) lines.push(`Creator bio: ${profile.bio}`)
  if (d) {
    const facts: string[] = []
    if (d.niches.length > 0) facts.push(`makes ${d.niches.join(' and ')} content`)
    if (d.platforms.length > 0) facts.push(`on ${d.platforms.join(' and ')}`)
    if (d.audienceSize) facts.push(`audience ${d.audienceSize}`)
    if (d.avgViews) facts.push(`${d.avgViews} avg views`)
    if (d.languages && d.languages.length > 0) facts.push(`works in ${d.languages.join(' & ')}`)
    if (d.location) facts.push(`based in ${d.location}`)
    if (d.availability) facts.push(`${d.availability} free for collabs`)
    if (d.goals.length > 0) facts.push(`main goal: ${d.goals.join(', ')}`)
    if (d.compensation && d.compensation.length > 0) facts.push(`deal types: ${d.compensation.join(', ')}`)
    if (facts.length > 0) lines.push(`Creator details: ${facts.join('; ')}`)
  }
  const memories = context.memories
    .filter((m) => m.category !== 'interaction')
    .slice(-5)
    .map((m) => m.content)
  if (memories.length > 0) {
    lines.push(`Notes from ${profile.displayName}: ${memories.join(' | ')}`)
  }
  if (context.matches.matches.length > 0) {
    const names = context.matches.matches
      .slice(0, 5)
      .map((m) => `${m.creator.displayName} (${m.score})`)
      .join(', ')
    lines.push(`LINKUP matches: ${names}`)
  }
  lines.push('Reply in plain, warm, honest language, as a helpful personal assistant.')
  return lines.join('\n')
}

/** Calls Groq chat completions with a bounded timeout and no secret leaking. */
export async function groqChatCompletions(
  groq: GroqConfig,
  system: string,
  user: string,
): Promise<string> {
  let res: Response
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groq.apiKey}`,
      },
      body: JSON.stringify({
        model: groq.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    throw new Error(`Groq fallback request failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    throw new Error(`Groq fallback request failed (status ${res.status})`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Groq fallback returned no content')
  }
  return content
}

/**
 * Wraps the primary adapter with a Groq fallback: any provider failure
 * (out of credit, timeout, refused reply) is answered by the fallback so the
 * demo never stalls. If the fallback also fails, the ORIGINAL error surfaces.
 */
export function withGroqFallback(primary: MindAdapter, fallback: MindAdapter): MindAdapter {
  return {
    async query(context: MindContext, input: string): Promise<string> {
      try {
        return await primary.query(context, input)
      } catch (primaryErr) {
        try {
          return await fallback.query(context, input)
        } catch {
          throw primaryErr
        }
      }
    },
  }
}

/**
 * Resolves the adapter for production:
 * 1. Real Minds provider when Minds config is present (wrapped with the Groq
 *    fallback when a Groq key exists — Minds credit runs out fast).
 * 2. Groq-only virtual Mind when Minds is absent but Groq is configured.
 * 3. The stub otherwise (safe default, 503 on query).
 */
export function resolveMindAdapter(minds: MindsConfig, groq: GroqConfig): MindAdapter {
  const groqAdapter = groq.apiKey !== '' ? createGroqFallbackAdapter(groq) : undefined
  if (minds.builderApiKey && minds.mindId) {
    const primary = createMindsProviderAdapter({
      builderApiKey: minds.builderApiKey,
      mindId: minds.mindId,
      // When a Groq fallback exists, cap the Minds wait so a slow/refusing
      // Mind hands over to the fallback instead of stalling the demo.
      timeoutMs:
        groqAdapter !== undefined ? Math.min(minds.replyTimeoutMs, 60_000) : minds.replyTimeoutMs,
    })
    return groqAdapter !== undefined ? withGroqFallback(primary, groqAdapter) : primary
  }
  if (groqAdapter !== undefined) return groqAdapter
  return stubMindAdapter
}

/**
 * Stable conversation alias for a creator. The sanitized creator ID alone is
 * not a safe identity — distinct IDs can sanitize to the same string (e.g.
 * "a/b" and "a_b"), which would merge two creators' conversations into one
 * Mind conversation. A short SHA-256 suffix over the raw ID keeps aliases
 * stable across restarts while making collisions practically impossible.
 */
export function aliasForCreator(creatorId: string): string {
  const safe = creatorId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ALIAS_SAFE_LENGTH)
    .replace(/-+$/g, '')
  const digest = createHash('sha256').update(creatorId).digest('hex').slice(0, 8)
  return `${ALIAS_PREFIX}-${safe || 'creator'}-${digest}`
}

/**
 * Serializes the structured MindContext into a natural, first-person message
 * for the Mind. The message reads like a real person messaging a friend, not
 * a platform dispatch — the Mind's Identity Firewall rejects templated
 * wrappers, and the Mind itself told us: "tell me in your own words who's
 * involved and what you're trying to figure out. Just you, talking."
 *
 * First message in a conversation: includes a natural intro with profile
 * context woven in as plain sentences. Subsequent messages: just the user's
 * query with minimal contextual nudge when needed — no re-intro, no template,
 * no signature block, no bullet lists.
 */
export function buildMindPrompt(context: MindContext, input: string, firstMessage?: boolean): string {
  const trimmedInput = input.trim()
  // Long inputs (proposal drafts, negotiation turns, decision asks) are
  // already written as self-contained, first-person messages — wrapping them
  // again would double-intro and look templated. Only short user chat queries
  // get the conversational framing.
  if (trimmedInput.length > 400) return trimmedInput
  const profile = context.creator
  if (!profile) return trimmedInput
  const d = context.details

  if (firstMessage) {
    // First message: natural intro, profile woven in conversationally.
    // Vary the opening so it never looks like a template dispatch.
    const openers = [
      `Hey! Quick question — ${trimmedInput}`,
      `Hi! ${trimmedInput}`,
      `Hey there — ${trimmedInput}`,
    ]
    const opener = openers[Math.floor(Math.random() * openers.length)]!

    const lines: string[] = [opener, '']

    // Profile context — natural sentences, never bullet lists.
    const contextLines: string[] = []
    if (profile.bio) contextLines.push(profile.bio)
    if (d) {
      const niche = d.niches.length > 0 ? d.niches.join(' and ') : ''
      const platform = d.platforms.length > 0 ? `on ${d.platforms.join(' and ')}` : ''
      const audience = d.audienceSize ? ` — ${d.audienceSize} followers` : ''
      if (niche) contextLines.push(`I make ${niche} content${platform}${audience}.`)
      if (d.location) contextLines.push(`Based in ${d.location}.`)
      if (d.languages && d.languages.length > 0) contextLines.push(`I work in ${d.languages.join(' & ')}.`)
      if (d.availability) contextLines.push(`I've got about ${d.availability} free for collabs.`)
      if (d.goals.length > 0) contextLines.push(`Main goal right now: ${d.goals[0]}.`)
    }
    if (contextLines.length > 0) {
      lines.push(`By the way, quick context on me — ${contextLines.join(' ')} Just set up on LINKUP, a platform for creator collabs.`)
    }

    // Memories — only if they exist, phrased as notes, not asserted facts.
    const memories = context.memories
      .filter((m) => m.category !== 'interaction')
      .slice(-3)
    if (memories.length > 0) {
      const notes = memories.map((m) => m.content).join('; ')
      lines.push(`I jotted down a few notes about myself: ${notes}.`)
    }

    // Matches — only when the query is about matching/finding partners.
    if (context.matches.matches.length > 0 && /match|fit|partner|collab|who|find|someone|creator|suggest/i.test(trimmedInput)) {
      const names = context.matches.matches.slice(0, 3).map((m) => m.creator.displayName).join(', ')
      lines.push(`I came across a few creators on LINKUP — ${names}. Curious if you think any of them could be a good fit.`)
    }

    lines.push('')
    lines.push(`What do you think?`)
    return lines.join('\n')
  }

  // Subsequent messages: just the user's query, naturally.
  const lines: string[] = [trimmedInput]

  // Minimal contextual nudge — only when the query references matching
  // specifically, so the Mind has the names in front of it.
  if (
    context.matches.matches.length > 0 &&
    /match|fit|partner|collab|who|find|someone|creator|suggest|that|this|them|they/i.test(trimmedInput)
  ) {
    const names = context.matches.matches
      .slice(0, 3)
      .map((m) => m.creator.displayName)
      .join(', ')
    lines.push('')
    lines.push(`(By the way — the LINKUP creators I mentioned earlier were ${names}. Still thinking about reaching out to any of them.)`)
  }

  return lines.join('\n')
}

class MindsProviderAdapter implements MindAdapter {
  constructor(
    private readonly client: MindsMessagingClient,
    private readonly mindId: string,
    private readonly timeoutMs: number,
  ) {}

  async query(context: MindContext, input: string): Promise<string> {
    const alias = aliasForCreator(context.creator.creatorId)

    try {
      await this.client.ensureConversation(alias, this.mindId)
      // Detect whether this is the first message in the thread: a brand-new
      // conversation has no history yet. First messages get a natural intro
      // with profile context; follow-ups get just the query (the Mind already
      // holds the thread).
      let isFirstMessage = false
      try {
        const history = await this.client.getHistory(alias, { limit: 1 })
        isFirstMessage = history.length === 0
      } catch {
        isFirstMessage = false
      }
      const messageText = buildMindPrompt(context, input, isFirstMessage)
      // NOTE: the SDK's getLatestHistoryFingerprint assumes oldest-first
      // history paging, but the histories API returns newest-first — it would
      // hand back the OLDEST message's fingerprint, so waitForReply matches a
      // stale reply. Take the newest message's fingerprint directly instead.
      let afterFingerprint: string | undefined
      try {
        const rows = await this.client.getHistory(alias, { limit: 1 })
        afterFingerprint = rows[0]?.fingerprint ?? undefined
      } catch {
        afterFingerprint = undefined
      }
      await this.client.sendMessage({ alias, messageText })
      const outcome = await this.client.waitForReply({
        alias,
        timeoutMs: this.timeoutMs,
        afterFingerprint,
        sentMessageText: messageText,
      })
      if (outcome.timedOut) {
        throw new Error('Minds provider timed out waiting for a reply')
      }
      const replyText = outcome.reply.messageText?.trim()
      if (!replyText) {
        throw new Error('Minds provider returned an empty reply')
      }
      // The provider sometimes wraps replies in HTML paragraphs; the UI is
      // plain-text. Strip tags + decode the handful of entities that appear.
      return stripHtml(replyText)
    } catch (err) {
      throw toServiceError(err)
    }
  }
}

/**
 * Maps provider failures to clean service-level errors. `MindsApiError`
 * becomes a generic message with status/code only — no request bodies and no
 * API keys are ever surfaced. Other errors pass through unchanged.
 */
function toServiceError(err: unknown): Error {
  if (err instanceof MindsApiError) {
    return new Error(`Minds provider request failed (status ${err.status}, code ${err.code})`)
  }
  if (err instanceof Error) return err
  return new Error('Minds provider request failed')
}

/** Strips HTML tags and decodes common entities from a Mind reply. */
export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
