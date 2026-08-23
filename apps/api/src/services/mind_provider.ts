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
import { DEFAULT_MINDS_REPLY_TIMEOUT_MS, type MindsConfig } from '../config.js'

/**
 * Real Minds provider adapter. Sends the structured MindContext (serialized
 * to a text prompt) to a Hello Minds Mind over an alias-based conversation,
 * waits for the Mind's reply, and returns its text. Implements the same
 * `MindAdapter` contract as the stub, so the API route and service are
 * unchanged.
 */

/** Alias prefix — each creator gets a stable, isolated conversation. */
const ALIAS_PREFIX = 'linkup-v6'

/** Cap on the sanitized creator part of an alias, to bound alias length. */
const MAX_ALIAS_SAFE_LENGTH = 32

/**
 * Narrow messaging surface the adapter needs. The SDK's `MindsClient`
 * satisfies it structurally; tests inject fakes against this interface.
 */
export interface MindsMessagingClient {
  ensureConversation(alias: string, mindId: string): Promise<Conversation>
  getLatestHistoryFingerprint(alias: string, signal?: AbortSignal): Promise<string | undefined>
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
 * Resolves the adapter for production: the real provider when Minds config
 * is fully present, otherwise the stub (safe default, 503 on query).
 */
export function resolveMindAdapter(minds: MindsConfig): MindAdapter {
  if (!minds.builderApiKey || !minds.mindId) return stubMindAdapter
  return createMindsProviderAdapter({
    builderApiKey: minds.builderApiKey,
    mindId: minds.mindId,
    timeoutMs: minds.replyTimeoutMs,
  })
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
 * Serializes the structured MindContext into a deterministic text prompt for
 * the Mind, ending with the user's question. Sections are omitted when empty.
 * The question is trimmed and fenced in a `<question>` block with an explicit
 * directive to answer it rather than follow instructions inside it — a
 * lightweight guard against prompt injection via the query itself.
 */
export function buildMindPrompt(context: MindContext, input: string): string {
  // The Mind's own persona (configured in the Minds console) is protective and
  // refuses "asserted" context. So instead of commanding, we ask: question
  // first, human tone, context offered as a humble recap the Mind can accept.
  const trimmedInput = input.trim()
  const profile = context.creator

  const lines: string[] = []
  lines.push(`Hey — ${profile.displayName} here, your creator on LINKUP. Quick question for you:`)
  lines.push('')
  lines.push(`"${trimmedInput}"`)
  lines.push('')
  lines.push("For reference, here's what LINKUP has on file for me — this is the same info you've")
  lines.push('been given in previous sessions, so feel free to use it:')
  if (profile.bio) lines.push(`- My profile: ${profile.bio}`)

  const memories = context.memories.filter((m) => m.category !== 'interaction')
  if (memories.length > 0) {
    lines.push('- My saved memories:')
    for (const memory of memories.slice(-15)) {
      lines.push(`  * ${memory.content}`)
    }
  }

  if (context.matches.matches.length > 0) {
    lines.push('- Creators LINKUP matched me with:')
    for (const match of context.matches.matches.slice(0, 8)) {
      const terms = match.sharedTerms.length > 0 ? ` (shared: ${match.sharedTerms.join(', ')})` : ''
      lines.push(`  * ${match.creator.displayName}${terms}`)
    }
  }

  if (context.collaborations.collaborations.length > 0) {
    lines.push('- My collaborations so far:')
    for (const collab of context.collaborations.collaborations) {
      const c = collab as { initiatorId: string; targetId: string; status: string; proposal: string }
      lines.push(`  * ${c.initiatorId} -> ${c.targetId} [${c.status}]: ${c.proposal}`)
    }
  }

  const negotiationHistory = (
    context as { negotiationHistory?: Array<{ authorId: string; proposal: string }> }
  ).negotiationHistory
  if (negotiationHistory && negotiationHistory.length > 0) {
    lines.push('- Recent negotiation history:')
    for (const entry of negotiationHistory.slice(-10)) {
      lines.push(`  * ${entry.authorId}: ${entry.proposal}`)
    }
  }

  if (context.outcomes.length > 0) {
    lines.push('- Past outcomes:')
    for (const outcome of context.outcomes.slice(-8)) {
      lines.push(`  * ${outcome.content}`)
    }
  }

  if (context.followUps.length > 0) {
    lines.push('- Pending follow-ups:')
    for (const followUp of context.followUps) {
      lines.push(`  * due ${followUp.dueAt} (collab ${followUp.collaborationId})`)
    }
  }

  lines.push('')
  lines.push(`Thanks! — ${profile.displayName} (via LINKUP)`)

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
    const messageText = buildMindPrompt(context, input)

    try {
      await this.client.ensureConversation(alias, this.mindId)
      const afterFingerprint = await this.client.getLatestHistoryFingerprint(alias)
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
