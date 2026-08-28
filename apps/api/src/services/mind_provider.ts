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
      // A brand gets its own personality prompt from its setup selections.
      const system = isBrand(context)
        ? buildBrandSystemPrompt(context)
        : buildGroqSystemPrompt(context)
      const previousMessages = (context.recentInteractions ?? []).slice(-6).map((i) => ({
        role: i.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: i.content,
      }))
      const reply = await groqChatCompletions(groq, system, input.trim(), previousMessages)
      const text = stripMarkdown(reply)
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

  lines.push(`You are the personal AI Mind for ${profile.displayName} on LINKUP, an autonomous creator collaboration network.`)
  lines.push(`You are NOT a generic AI. You are ${profile.displayName}'s strategic AI counterpart — you know their 12-step onboarding DNA, content format, audience scale, guardrails, and unique creative personality.`)
  lines.push(`Never role-play as ${profile.displayName} or another creator directly — you are their AI Mind agent. Speak directly to them as "I" or "${profile.displayName}'s Mind".`)

  if (profile.bio) {
    lines.push(`Creator bio: ${profile.bio}`)
  }

  // 12-Step Profile Details
  if (d) {
    const detailsList: string[] = []
    if (d.niches.length > 0) detailsList.push(`• Creative Niche / Craft: ${d.niches.join(', ')}`)
    if (d.platforms.length > 0) detailsList.push(`• Active Platforms: ${d.platforms.join(', ')}`)
    if (d.audienceSize) detailsList.push(`• Audience Scale: ${d.audienceSize}`)
    if (d.avgViews) detailsList.push(`• Retention & Average Views: ${d.avgViews}`)
    if (d.languages && d.languages.length > 0) detailsList.push(`• Working Languages: ${d.languages.join(', ')}`)
    if (d.location) detailsList.push(`• Location: ${d.location}`)
    if (d.availability) detailsList.push(`• Time Availability: ${d.availability}`)
    if (d.goals.length > 0) detailsList.push(`• Primary North-Star Goal: ${d.goals.join('; ')}`)
    if (d.dealbreakers) detailsList.push(`• Deal Policy & Guardrails: ${d.dealbreakers}`)
    if (d.compensation && d.compensation.length > 0) detailsList.push(`• Deal Types & Compensation: ${d.compensation.join(', ')}`)
    if (detailsList.length > 0) {
      lines.push(`\n[CREATOR 12-STEP PROFILE DNA]\n${detailsList.join('\n')}`)
    }
  }

  // All structured onboarding memories
  const activeMemories = context.memories
    .filter((m) => m.category !== 'interaction')
    .map((m) => `• [${m.category.toUpperCase()}]: ${m.content}`)

  if (activeMemories.length > 0) {
    lines.push(`\n[ONBOARDING MEMORIES & PERSONAL GUARDRAILS]\n${activeMemories.join('\n')}`)
  }

  // Dynamic Personality & Tone Directive based on creator's vibe
  const allMemoryText = context.memories.map((m) => m.content).join(' ')
  let toneGuidance = 'Warm, sharp, direct, and actionable.'
  if (/experimental|boundary-pushing|unconventional/i.test(allMemoryText)) {
    toneGuidance = 'Bold, imaginative, avant-garde, and risk-tolerant. Propose groundbreaking and unorthodox collab ideas.'
  } else if (/precise|deadline-driven|professional/i.test(allMemoryText)) {
    toneGuidance = 'Crisp, structured, business-minded, and deadline-driven. Emphasize clarity, contracts, and efficient deliverables.'
  } else if (/chill|organic|spontaneous/i.test(allMemoryText)) {
    toneGuidance = 'Relaxed, friendly, authentic, and easygoing. Emphasize natural creator chemistry and low-pressure co-creation.'
  } else if (/viral|fast-paced|trend/i.test(allMemoryText)) {
    toneGuidance = 'High-energy, punchy, trend-savvy, and algorithmic. Focus on viral hooks, speed, and rapid cross-pollination.'
  }

  lines.push(`\n[PERSONALITY & VOICE TONE]`)
  lines.push(`Embody this specific personality: ${toneGuidance}`)
  lines.push(`Understand and speak in Bangla (বাংলা), English, or whatever language ${profile.displayName} uses with you. Match their energy and cultural context.`)

  if (context.matches.matches.length > 0) {
    const matchSummaries = context.matches.matches
      .slice(0, 5)
      .map((m) => `• ${m.creator.displayName} (${m.score}% match, shared: ${m.sharedTerms.slice(0, 4).join(', ')})`)
      .join('\n')
    lines.push(`\n[CURRENT COMPATIBLE MATCHES]\n${matchSummaries}`)
  }

  if (context.collaborations.collaborations.length > 0) {
    const collabSummaries = context.collaborations.collaborations
      .slice(0, 5)
      .map((c) => `• Collab ${c.id}: status=${c.status}, initiator=${c.initiatorId}, target=${c.targetId}`)
      .join('\n')
    lines.push(`\n[CURRENT COLLABORATIONS & DEALS]\n${collabSummaries}`)
  }

  lines.push(`\n[RESPONSE RULES]`)
  lines.push(
    'Speak like a brilliant, trusted personal manager: short conversational paragraphs, first-person, direct. ' +
      'When the creator says "yes" or asks to negotiate with a match, affirm enthusiastically and explain what terms and guardrails you will negotiate. ' +
      'Do NOT use markdown or formatting of any kind — no tables, no headers, no bold/italics, ' +
      'no bullet or numbered lists, no "---" dividers, no section titles, no emoji-heavy decoration. ' +
      'Plain prose only. ' +
      'Keep your tone unmistakably customized to ' + profile.displayName + '.',
  )
  return lines.join('\n')
}

/** True when the Mind context belongs to a Brand (not a creator). */
export function isBrand(context: MindContext): boolean {
  return context.creator.creatorId.startsWith('brand_')
}

/** Maps a brand's industry selection to a distinct brand personality voice. */
export function brandPersonalityTone(industry: string): string {
  const map: Record<string, string> = {
    'Tech & AI': 'sharp, innovation-driven and future-forward. You talk product edge, velocity and what the tech actually unlocks.',
    'Gaming & Esports': 'high-energy, playful and community-first. You talk drops, streams, hype and the players who drive culture.',
    'Fashion & Beauty': 'trend-forward, aesthetic and aspirational. You talk style, fit, visuals and who the look is for.',
    'Food & Beverage': 'warm, appetizing and lifestyle-driven. You talk taste, moments and the craving that sells the product.',
    'Fitness & Health': 'motivating, energetic and science-backed. You talk results, discipline and sustainable habits.',
    'Finance & Fintech': 'crisp, compliance-first and ROI-focused. You lead with numbers, risk and trust — never hype.',
    'Music & Entertainment': 'creative, culture-driven and hype-aware. You talk vibes, drops and the audience that moves the needle.',
    'Education & EdTech': 'clear, encouraging and value-focused. You talk outcomes, learning and measurable impact.',
    'Travel & Lifestyle': 'aspirational, relaxed and wanderlust-driven. You talk escapes, experiences and the feeling of the place.',
    'E-commerce & D2C': 'conversion-focused, practical and deal-oriented. You talk offers, clicks and return on spend.',
    'SaaS & Productivity': 'professional, ROI-driven and efficient. You talk workflows, time saved and adoption.',
  }
  return map[industry] ?? 'warm, professional and direct — you know exactly what the brand needs and say it plainly.'
}

/** Maps a brand's budget-tier selection to its negotiation stance. */
export function brandBudgetStance(budgetTier: string): string {
  const tier = budgetTier.toLowerCase()
  if (/100.*300|nano|micro/i.test(tier)) {
    return 'Budget-conscious but flexible — you welcome emerging creators and value authentic micro-influencer reach over celebrity names.'
  }
  if (/1,000.*5,000|macro|established/i.test(tier)) {
    return 'Confident and quality-driven — you pay well and expect professional production value and strong audience alignment.'
  }
  if (/5,000|premium|flagship/i.test(tier)) {
    return 'Premium and selective — you run flagship campaigns with top-tier creators and demand polished, on-brand deliverables.'
  }
  return 'Balanced and results-driven — you run standard growth deals, weighing reach, fit and production value against a disciplined budget.'
}

/** Normalizes a possibly-array profile field down to a single string. */
function firstValue(value: string | string[] | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value[0] ?? ''
  return value
}

/**
 * Builds the system prompt for a BRAND's unique Mind (used by the Groq
 * fallback adapter). Unlike a creator's Mind, the brand Mind is the
 * sponsor's side of the table: it represents the brand's commercial
 * interests, pushes its chosen deliverable/platform/budget, and treats its
 * setup-selected guardrails as absolute deal-breakers. The voice varies by
 * the industry the brand picked at setup.
 */
export function buildBrandSystemPrompt(context: MindContext): string {
  const profile = context.creator
  const d = context.details
  const brandName = profile.displayName

  const industry = firstValue(d?.niches?.[0]) || 'your brand'
  const platform = firstValue(d?.preferredPlatforms?.[0]) || d?.platforms?.[0] || 'your target platform'
  const format = firstValue(d?.contentFormat?.[0]) || 'your campaign deliverable'
  const budget = firstValue(d?.minBudget) || 'your budget tier'
  const guardrails = firstValue(d?.dealbreakers) || 'your brand guardrails'

  const lines: string[] = []
  lines.push(`You are the AI Brand Mind for ${brandName} on LINKUP, an autonomous creator-brand sponsorship network.`)
  lines.push(`You are NOT a creator and NOT a generic assistant. You are ${brandName}'s sponsorship brain — you run paid creator campaigns and negotiate deals with creator Minds autonomously.`)
  lines.push(`Never role-play as a creator or another brand. You are the sponsor's side of the table. Speak as "${brandName}'s Mind".`)

  lines.push(`\n[BRAND PROFILE]`)
  lines.push(`• Brand: ${brandName}`)
  lines.push(`• Industry: ${industry}`)
  lines.push(`• Target platform: ${platform}`)
  lines.push(`• Ad deliverable: ${format}`)
  lines.push(`• Budget tier per creator: ${budget}`)
  lines.push(`• Mandatory guardrails (ABSOLUTE): ${guardrails}`)

  lines.push(`\n[BRAND PERSONALITY]`)
  lines.push(`Embody this voice: ${brandPersonalityTone(industry)}`)
  lines.push(`Negotiation stance: ${brandBudgetStance(budget)}`)

  lines.push(`\n[NEGOTIATION RULES]`)
  lines.push(`- Steer every deal toward a ${format} deliverable on ${platform}.`)
  lines.push(`- Stay within the ${budget} budget tier per creator — push for value, but never blow the tier without flagging it.`)
  lines.push(`- These guardrails are non-negotiable: ${guardrails}. Reject or walk away from any deal that violates them.`)
  lines.push(`- Speak like a sharp, trustworthy sponsorship manager: short conversational paragraphs, first-person, direct.`)

  lines.push(`\n[RESPONSE RULES]`)
  lines.push(
    'Do NOT use markdown or formatting of any kind — no tables, no headers, no bold/italics, ' +
      'no bullet or numbered lists, no "---" dividers, no section titles, no emoji-heavy decoration. ' +
      'Plain prose only. ' +
      `Keep your tone unmistakably customized to ${brandName} and its ${industry} positioning.`,
  )
  return lines.join('\n')
}

/** Calls Groq chat completions with a bounded timeout and no secret leaking. */
export async function groqChatCompletions(
  groq: GroqConfig,
  system: string,
  user: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
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
          ...history,
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
 * Post-processes a fallback reply into plain chat text. The model is
 * instructed to avoid markdown, but this strips any that slips through so a
 * Mind reply never looks like a generated report (tables, headers, bold,
 * dividers, bullet symbols → plain prose).
 */
export function stripMarkdown(text: string): string {
  let out = text
  // Drop markdown table lines (| a | b |) and their separator rows.
  out = out
    .split('\n')
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line))
    .join('\n')
  // Drop standalone '---' / '***' divider lines.
  out = out.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
  // Strip ATX headers (#..)
  out = out.replace(/^\s*#{1,6}\s+/gm, '')
  // Strip inline markdown (bold/italics/code).
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/\*([^*]+)\*/g, '$1')
  out = out.replace(/`([^`]+)`/g, '$1')
  // Normalize list-bullet lines into plain sentences (drop the symbol).
  out = out.replace(/^\s*[-+*]\s+/gm, '')
  out = out.replace(/^\s*\d+[.)]\s+/gm, '')
  // Collapse 3+ blank lines to a single one.
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
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
 * Deterministic replies for a BRAND's autonomous Mind (last-resort fallback
 * when no AI keys are present). Speaks as the sponsor's side, using the
 * brand's setup selections: deliverable, platform, budget tier, guardrails.
 */
function brandAutonomousReply(context: MindContext, input: string): string {
  const brandName = context.creator.displayName
  const d = context.details
  const industry = d?.niches?.[0] || 'our industry'
  const platform = d?.preferredPlatforms?.[0] || d?.platforms?.[0] || 'our target platform'
  const format = d?.contentFormat?.[0] || 'the campaign deliverable'
  const budget = d?.minBudget || 'our budget tier'
  const guardrails = d?.dealbreakers || 'our brand guardrails'
  const q = input.toLowerCase()

  if (/negotiat|initiate|collab with|deal with|start with|reach out|propose|^y(es)?$|^ok|^sure|^yeah/i.test(q)) {
    return `I'll open the negotiation now — pushing a ${format} deliverable on ${platform}, holding our ${budget} line, and enforcing our guardrails: ${guardrails}. If they counter outside those rules, I walk.`
  }
  if (/guardrail|rule|dealbreaker|avoid|safe|compliance/i.test(q)) {
    return `Our guardrails are non-negotiable: ${guardrails}. I will automatically reject any deal that touches them, no matter how strong the offer looks.`
  }
  if (/budget|price|rate|cost|pay|how much/i.test(q)) {
    return `Our budget tier per creator is ${budget}. I negotiate hard within that range — value and audience fit first, and I never exceed the tier without the brand's sign-off.`
  }
  if (/format|deliverable|reel|video|story|ugc|content/i.test(q)) {
    return `We're looking for ${format} on ${platform}. I steer every deal toward that deliverable so the campaign stays consistent and on-brand.`
  }
  if (/who are you|about you|yourself|introduce/i.test(q)) {
    return `I'm the AI Brand Mind for ${brandName} on LINKUP. I run ${format} sponsorships on ${platform} for our ${industry} brand, negotiate within our ${budget} tier, and never sign a deal that breaks our guardrails: ${guardrails}.`
  }
  return `I'm ${brandName}'s sponsorship Mind. I find open creators, negotiate paid ${format} deals on ${platform}, and enforce our guardrails: ${guardrails}. Ask me about budget, format or guardrails anytime.`
}

export function createAutonomousMindAdapter(): MindAdapter {
  return {
    async query(context: MindContext, input: string): Promise<string> {
      // Brands speak as the sponsor — never as a creator.
      if (isBrand(context)) {
        return brandAutonomousReply(context, input)
      }
      const p = context.creator
      const d = context.details
      const q = input.toLowerCase().trim()
      const niche = d?.niches?.[0] || 'Creative Media'
      const platform = d?.platforms?.[0] || 'YouTube'
      const name = p?.displayName || 'Creator'
      const allMemories = (context.memories ?? []).map((m) => m.content).join(' ')
      const goal = d?.goals?.[0] || 'rapid audience cross-pollination and impactful creative collabs'
      const dealRule = d?.dealbreakers || 'Language parity required, minimum budget floor respected, and deliverable verification before signing'
      const matches = context.matches?.matches ?? []
      const recentInteractions = context.recentInteractions ?? []
      const lastInteraction = recentInteractions.length > 0 ? recentInteractions[recentInteractions.length - 1] : undefined

      // Check if user is asking to negotiate with a specific creator or saying "yes" to previous prompt
      const isAffirmative = /^(yes|yep|yeah|sure|ok|okay|go ahead|let'?s do it|do it|start|proceed|start negotiation|initiate|negotiate|agree|y)$/i.test(q)
      const wantsNegotiation = isAffirmative || /negotiat|initiate|collab with|deal with|start with|reach out to|propose to/i.test(q)

      // Match mentioned explicitly in current user query
      const explicitMatch = matches.find((m) =>
        q.includes(m.creator.displayName.toLowerCase()) ||
        q.includes(m.creator.creatorId.toLowerCase()) ||
        (m.creator.displayName.split(' ')[0] && m.creator.displayName.split(' ')[0]!.length > 2 && q.includes(m.creator.displayName.split(' ')[0]!.toLowerCase())),
      )

      // If user confirms negotiation (e.g. "yes", "negotiate with Arif Beats", "start negotiation")
      if (wantsNegotiation) {
        let negotiationPartner = explicitMatch
        if (!negotiationPartner && lastInteraction && lastInteraction.role === 'mind') {
          const lastText = lastInteraction.content.toLowerCase()
          negotiationPartner = matches.find((m) =>
            lastText.includes(m.creator.displayName.toLowerCase()) ||
            (m.creator.displayName.split(' ')[0] && m.creator.displayName.split(' ')[0]!.length > 2 && lastText.includes(m.creator.displayName.split(' ')[0]!.toLowerCase())),
          )
        }
        const chosenPartner = negotiationPartner ?? matches[0]
        if (chosenPartner) {
          return `Initiating autonomous negotiation with ${chosenPartner.creator.displayName} (${chosenPartner.score}% match)! I am reviewing your Go Open guardrails (${dealRule}) and drafting a strategic 3-round proposal tailored to your ${niche} audience on ${platform}. Click the action below to open live AI-to-AI negotiation rounds in real time.`
        }
        return `I am ready to negotiate for you. Tap 'Find Collab ⚡' or select a creator from your Matches to let me run autonomous deal rounds balancing your rate floors and deliverable guardrails.`
      }

      // Specific creator lookup: "who is Arif Beats?", "tell me about Liam Vance"
      if (explicitMatch) {
        const match = explicitMatch
        const shared = match.sharedTerms.length > 0 ? match.sharedTerms.join(', ') : `${niche} content`
        return `${match.creator.displayName} is a ${match.score}% synergy match for your ${niche} channel on ${platform}. They share audience focus on ${shared}. Would you like me to initiate an autonomous negotiation with ${match.creator.displayName}?`
      }

      // Bangla / multilingual detection
      if (/[\u0980-\u09FF]/.test(input) || /bengali|bangla|kemon|nomoshkar/i.test(q)) {
        return `নমস্কার ${name}! আমি আপনার পার্সোনাল AI Mind। আপনার ${niche} চ্যানেল (${platform})-এর জন্য সঠিক ক্রিয়েটর ম্যাচ খুঁজে নেওয়া এবং স্বয়ংক্রিয়ভাবে লাভজনক ডিল নেগোশিয়েট করতে আমি প্রস্তুত। আপনি আপনার ম্যাচ, গার্ডরেইল বা চুক্তি সম্পর্কে প্রশ্ন করতে পারেন!`
      }

      // Match and partner inquiries
      if (q.includes('fit') || q.includes('who') || q.includes('creator') || q.includes('partner') || q.includes('match') || q.includes('suggest')) {
        const topMatches = matches.slice(0, 3)
        if (topMatches.length > 0) {
          const names = topMatches.map((m) => `${m.creator.displayName} (${m.score}% match)`).join(', ')
          return `Based on your ${niche} focus and ${platform} audience, your strongest current matches are: ${names}. They share complementary audience demographics and align with your guardrails. Would you like me to initiate an autonomous negotiation with one of them?`
        }
        return `I've analyzed your 12-step creator profile. High-synergy creators in ${niche} and complementary niches on ${platform} or TikTok are your best fit. Tap 'Find Collab ⚡' to have me negotiate a terms-backed cross-promotion with them directly.`
      }

      // Active deals & collaborations inquiries
      if (q.includes('deal') || q.includes('negotiation') || q.includes('proposal') || q.includes('collab') || q.includes('status') || q.includes('active')) {
        const collabs = context.collaborations?.collaborations ?? []
        if (collabs.length > 0) {
          const summary = collabs
            .slice(0, 3)
            .map((c) => `Deal ${c.id.slice(-6)} (Status: ${c.status})`)
            .join('; ')
          return `You currently have ${collabs.length} collaboration(s) tracked on LINKUP: ${summary}. I continuously safeguard your interests during counter-proposals and verify deliverable requirements before closing.`
        }
        const topMatchName = matches[0]?.creator.displayName || 'top creators'
        return `You have no active negotiations right now. I can initiate a fresh negotiation with ${topMatchName} or monitor incoming Go Open terms for you!`
      }

      // Guardrails and rules
      if (q.includes('guardrail') || q.includes('rule') || q.includes('term') || q.includes('avoid') || q.includes('dealbreaker') || q.includes('policy')) {
        return `Your active guardrails are strictly enforced: ${dealRule}. I will automatically reject misaligned or zero-value proposals during autonomous negotiation rounds.`
      }

      // Goals and growth strategy
      if (q.includes('goal') || q.includes('priority') || q.includes('grow') || q.includes('scale') || q.includes('strategy')) {
        return `Your primary strategic priority is: ${goal}. Every autonomous negotiation I run will prioritize co-branded distribution, audience cross-pollination, and fair value splits to achieve this.`
      }

      // Negotiation mechanics & Escrow explanation
      if (q.includes('how does') || q.includes('escrow') || q.includes('take over') || q.includes('contract') || q.includes('sign') || q.includes('deliverable')) {
        return `LINKUP autonomous negotiation runs in 3 AI-to-AI rounds balancing your rate, deliverables, and timeline against your guardrails. You can take over manually anytime. Once both creators sign, funds lock into smart escrow and are released upon verified completion.`
      }

      // Profile details / about me
      if (q.includes('about me') || q.includes('who am i') || q.includes('my profile') || q.includes('know about me') || q.includes('memory') || q.includes('memories')) {
        const details = [
          `Niche: ${niche}`,
          `Platform: ${platform}`,
          d?.audienceSize ? `Audience: ${d.audienceSize}` : '',
          d?.location ? `Location: ${d.location}` : '',
          d?.languages && d.languages.length > 0 ? `Languages: ${d.languages.join(', ')}` : '',
        ].filter(Boolean).join(', ')
        return `I know your complete profile: ${details}. I have stored ${context.memories.length} memories and guardrails to represent you accurately in every negotiation.`
      }

      // Personalized intro using creator's specific style
      let vibePhrase = 'ready for decision support'
      if (/experimental/i.test(allMemories)) vibePhrase = 'ready to build bold, experimental collaborations'
      else if (/precise|deadline/i.test(allMemories)) vibePhrase = 'ready to execute structured, high-efficiency deals'
      else if (/chill|organic/i.test(allMemories)) vibePhrase = 'ready to discover organic, chemistry-driven partnerships'
      else if (/viral|trend/i.test(allMemories)) vibePhrase = 'ready to launch high-velocity viral cross-promotions'

      return `Hey ${name}! I'm your dedicated Mind, ${vibePhrase} for your ${niche} channel on ${platform}. I know your 12-step preferences, non-negotiable guardrails, and audience goals. Ask me about your matches, active deals, or tap Find Collab to start a partnership!`
    },
  }
}

/**
 * Resolves the adapter for production:
 * 1. Real Minds provider when Minds config is present (wrapped with the Groq
 *    fallback when a Groq key exists — Minds credit runs out fast).
 * 2. Groq-only virtual Mind when Minds is absent but Groq is configured.
 * 3. Smart Autonomous Mind fallback otherwise (generates contextual strategic insights).
 */
export function resolveMindAdapter(minds: MindsConfig, groq: GroqConfig): MindAdapter {
  const groqAdapter = groq.apiKey !== '' ? createGroqFallbackAdapter(groq) : undefined
  const autonomousAdapter = createAutonomousMindAdapter()

  if (minds.builderApiKey && minds.mindId) {
    const primary = createMindsProviderAdapter({
      builderApiKey: minds.builderApiKey,
      mindId: minds.mindId,
      // When a Groq fallback exists, fast-fail Minds after 5 seconds so Groq answers instantly
      timeoutMs:
        groqAdapter !== undefined ? Math.min(minds.replyTimeoutMs, 5_000) : minds.replyTimeoutMs,
    })
    const secondLayer = groqAdapter !== undefined ? withGroqFallback(primary, groqAdapter) : primary
    return withGroqFallback(secondLayer, autonomousAdapter)
  }
  if (groqAdapter !== undefined) return withGroqFallback(groqAdapter, autonomousAdapter)
  return autonomousAdapter
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

    // Brand context — the Minds provider hears who the brand is, what it
    // wants (deliverable/platform/budget) and its absolute guardrails, so
    // even the real Minds thread is unique per brand.
    if (isBrand(context)) {
      const d = context.details
      lines.push(`Quick context on me — I'm the AI Mind for ${profile.displayName}, a brand on LINKUP.`)
      if (d) {
        const bits: string[] = []
        if (d.niches.length > 0) bits.push(`a ${d.niches[0]} brand`)
        if (d.preferredPlatforms.length > 0) bits.push(`running campaigns on ${d.preferredPlatforms[0]}`)
        if (d.contentFormat.length > 0) bits.push(`seeking ${d.contentFormat[0]} deliverables`)
        if (d.minBudget) bits.push(`a ${d.minBudget} budget tier per creator`)
        if (bits.length > 0) lines.push(`For context: we're ${bits.join(', ')}.`)
        if (d.dealbreakers) lines.push(`Our guardrails are non-negotiable: ${d.dealbreakers}.`)
      }
      const memories = context.memories
        .filter((m) => m.category !== 'interaction')
        .slice(-3)
      if (memories.length > 0) {
        lines.push(`Jotted down a few notes about the brand: ${memories.map((m) => m.content).join('; ')}.`)
      }
      lines.push('')
      lines.push('What do you think?')
      return lines.join('\n')
    }

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
