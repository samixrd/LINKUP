import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  addCreatorMemory,
  getProfileDetails,
  setProfileDetails,
  profileDetailsCompleteness,
  type MemoryCategory,
  type ProfileDetails,
  type ProfileDetailsUpdates,
} from '@linkup/db'

/**
 * The Mind's guided onboarding interview. The Mind asks structured questions
 * one at a time (chips + free text); each answer is written both as a memory
 * (so the Mind's chat history and matching engine see it) and into the
 * creator's structured profile details (so match cards and proposals are
 * info-rich). The question bank is deterministic — the live demo never
 * depends on LLM flakiness for profiling.
 */

export interface InterviewOption {
  value: string
  label: string
}

export interface InterviewQuestion {
  id: string
  /** The question the Mind asks, in its own voice. */
  prompt: string
  /** Multi-select chips when set; otherwise free-text answer. */
  options?: InterviewOption[]
  /** The profile details field this answer writes to. */
  field: keyof Pick<
    ProfileDetails,
    | 'niches'
    | 'platforms'
    | 'audienceSize'
    | 'collabTypes'
    | 'availability'
    | 'goals'
    | 'dealbreakers'
    | 'location'
    | 'portfolioUrl'
    | 'partnerMinAudience'
    | 'partnerMaxAudience'
    | 'partnerNiches'
    | 'minAvgViews'
    | 'languages'
    | 'preferredPlatforms'
    | 'compensation'
    | 'minBudget'
    | 'openToSmall'
    | 'avgViews'
    | 'contentFormat'
    | 'postingFrequency'
    | 'editingSkills'
    | 'equipment'
    | 'audienceAge'
    | 'audienceRegions'
    | 'collabExperience'
    | 'growthStage'
    | 'timezone'
    >
  /** Memory category the answer is persisted as. */
  memoryCategory: MemoryCategory
  /** Template for the memory text; {answer} is replaced with the joined answer. */
  memoryTemplate: string
}

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'niches',
    prompt: 'First things first — what do you create? Pick every craft that fits.',
    options: [
      { value: 'Music', label: 'Music' },
      { value: 'Video', label: 'Video' },
      { value: 'Art', label: 'Art' },
      { value: 'Writing', label: 'Writing' },
      { value: 'Streaming', label: 'Streaming' },
      { value: 'Photography', label: 'Photography' },
      { value: 'Gaming', label: 'Gaming' },
      { value: 'Comedy', label: 'Comedy' },
      { value: 'Education', label: 'Education' },
      { value: 'Fitness', label: 'Fitness' },
      { value: 'Food', label: 'Food' },
      { value: 'Tech', label: 'Tech' },
    ],
    field: 'niches',
    memoryCategory: 'preference',
    memoryTemplate: 'I create: {answer}',
  },
  {
    id: 'platforms',
    prompt: 'Where do you post? Your audience lives somewhere — tell me where.',
    options: [
      { value: 'YouTube', label: 'YouTube' },
      { value: 'TikTok', label: 'TikTok' },
      { value: 'Instagram', label: 'Instagram' },
      { value: 'Twitch', label: 'Twitch' },
      { value: 'X', label: 'X' },
      { value: 'Podcast', label: 'Podcast' },
      { value: 'Newsletter', label: 'Newsletter' },
    ],
    field: 'platforms',
    memoryCategory: 'preference',
    memoryTemplate: 'My platforms: {answer}',
  },
  {
    id: 'audience',
    prompt: 'How big is your audience right now? No wrong answer — it helps me match you fairly.',
    options: [
      { value: 'Just starting', label: 'Just starting' },
      { value: '~1k', label: '~1k followers' },
      { value: '~10k', label: '~10k followers' },
      { value: '~100k+', label: '~100k+ followers' },
      { value: '~1M+', label: '~1M+ followers' },
    ],
    field: 'audienceSize',
    memoryCategory: 'preference',
    memoryTemplate: 'My audience size: {answer}',
  },
  {
    id: 'collab_types',
    prompt: 'What kinds of collaborations actually interest you? Pick all that sound good.',
    options: [
      { value: 'co-create', label: 'Co-create something new' },
      { value: 'cross-promote', label: 'Cross-promote each other' },
      { value: 'guest-appearance', label: 'Guest appearance' },
      { value: 'shoutout', label: 'Shoutout / feature' },
      { value: 'series', label: 'Ongoing series together' },
      { value: 'live-event', label: 'Live event / stream' },
    ],
    field: 'collabTypes',
    memoryCategory: 'goal',
    memoryTemplate: 'Interested in collaborations: {answer}',
  },
  {
    id: 'availability',
    prompt: 'How much time can you realistically put into a collaboration?',
    options: [
      { value: '~1 hr/week', label: '~1 hour a week' },
      { value: '~5 hrs/week', label: '~5 hours a week' },
      { value: '~10+ hrs/week', label: '10+ hours a week' },
      { value: 'Full-time', label: 'Full-time creator' },
    ],
    field: 'availability',
    memoryCategory: 'constraint',
    memoryTemplate: 'Available for collaborations: {answer}',
  },
  {
    id: 'goals',
    prompt: "What's the #1 thing you want out of collaborating right now?",
    options: [
      { value: 'Grow my audience', label: 'Grow my audience' },
      { value: 'Make money creating', label: 'Make money creating' },
      { value: 'Find collab partners', label: 'Find collab partners' },
      { value: 'Level up my craft', label: 'Level up my craft' },
    ],
    field: 'goals',
    memoryCategory: 'goal',
    memoryTemplate: 'My goal: {answer}',
  },
  {
    id: 'dealbreakers',
    prompt: 'Anything you will absolutely NOT do in a collaboration? (brands, topics, formats…)',
    field: 'dealbreakers',
    memoryCategory: 'constraint',
    memoryTemplate: 'Dealbreaker: {answer}',
  },
  {
    id: 'location',
    prompt: 'Where are you based? (City is enough — helps with timezones and live collabs.)',
    field: 'location',
    memoryCategory: 'preference',
    memoryTemplate: 'Based in: {answer}',
  },
  {
    id: 'portfolio',
    prompt: 'Drop a link to your best work so partners can see what you do.',
    field: 'portfolioUrl',
    memoryCategory: 'preference',
    memoryTemplate: 'My best work: {answer}',
  },
  // ---- Partner preferences section --------------------------------------
  {
    id: 'avg_views',
    prompt: "Roughly how many views does a typical post of yours get? Helps partners size the deal.",
    options: [
      { value: '<1k', label: 'Under 1k views' },
      { value: '1k-10k', label: '1k – 10k views' },
      { value: '10k-100k', label: '10k – 100k views' },
      { value: '100k+', label: '100k+ views' },
    ],
    field: 'avgViews',
    memoryCategory: 'preference',
    memoryTemplate: 'My average views: {answer}',
  },
  {
    id: 'partner_niches',
    prompt: "What kind of creators do you want to collaborate with? Pick the niches that excite you.",
    options: [
      { value: 'Music', label: 'Music' },
      { value: 'Video', label: 'Video' },
      { value: 'Art', label: 'Art' },
      { value: 'Writing', label: 'Writing' },
      { value: 'Streaming', label: 'Streaming' },
      { value: 'Photography', label: 'Photography' },
      { value: 'Gaming', label: 'Gaming' },
      { value: 'Comedy', label: 'Comedy' },
      { value: 'Education', label: 'Education' },
      { value: 'Fitness', label: 'Fitness' },
      { value: 'Food', label: 'Food' },
      { value: 'Tech', label: 'Tech' },
    ],
    field: 'partnerNiches',
    memoryCategory: 'goal',
    memoryTemplate: 'I want partners who create: {answer}',
  },
  {
    id: 'partner_min_audience',
    prompt: "How big should a partner's audience be, at minimum?",
    options: [
      { value: 'any', label: "Any size is fine" },
      { value: '~1k', label: 'At least ~1k followers' },
      { value: '~10k', label: 'At least ~10k followers' },
      { value: '~100k+', label: 'At least ~100k followers' },
    ],
    field: 'partnerMinAudience',
    memoryCategory: 'constraint',
    memoryTemplate: 'Minimum partner audience: {answer}',
  },
  {
    id: 'min_avg_views',
    prompt: "What's the smallest average-views level you'd accept from a partner?",
    options: [
      { value: '<1k', label: "Views don't matter" },
      { value: '1k-10k', label: '1k+ avg views' },
      { value: '10k-100k', label: '10k+ avg views' },
      { value: '100k+', label: '100k+ avg views' },
    ],
    field: 'minAvgViews',
    memoryCategory: 'constraint',
    memoryTemplate: 'Minimum partner avg views: {answer}',
  },
  {
    id: 'languages',
    prompt: 'What languages can you create content in for a collaboration?',
    options: [
      { value: 'English', label: 'English' },
      { value: 'Bangla', label: 'Bangla' },
      { value: 'Hindi', label: 'Hindi' },
      { value: 'Spanish', label: 'Spanish' },
      { value: 'Portuguese', label: 'Portuguese' },
      { value: 'Arabic', label: 'Arabic' },
      { value: 'French', label: 'French' },
    ],
    field: 'languages',
    memoryCategory: 'preference',
    memoryTemplate: 'My collaboration languages: {answer}',
  },
  {
    id: 'preferred_platforms',
    prompt: "Which platforms should a partner be active on? (Where would the collab live?)",
    options: [
      { value: 'YouTube', label: 'YouTube' },
      { value: 'TikTok', label: 'TikTok' },
      { value: 'Instagram', label: 'Instagram' },
      { value: 'Twitch', label: 'Twitch' },
      { value: 'X', label: 'X' },
      { value: 'Podcast', label: 'Podcast' },
      { value: 'Newsletter', label: 'Newsletter' },
      { value: 'any', label: "Any platform works" },
    ],
    field: 'preferredPlatforms',
    memoryCategory: 'preference',
    memoryTemplate: 'Preferred partner platforms: {answer}',
  },
  {
    id: 'compensation',
    prompt: 'Now the money talk 💰 — what deal types will you actually accept?',
    options: [
      { value: 'paid', label: 'Paid gig' },
      { value: 'barter', label: 'Barter / shout-for-shout' },
      { value: 'revenue-share', label: 'Revenue share' },
      { value: 'free', label: 'Free — just for fun & reach' },
    ],
    field: 'compensation',
    memoryCategory: 'constraint',
    memoryTemplate: 'Accepted deal types: {answer}',
  },
  {
    id: 'open_to_small',
    prompt: "Would you collab with a smaller creator just starting out — even 0 followers — if the idea is great? And what's the minimum you'd need to be paid, if anything?",
    field: 'openToSmall',
    memoryCategory: 'constraint',
    memoryTemplate: 'Open to small creators / budget note: {answer}',
  },
  // ---- Creator depth section ---------------------------------------------
  {
    id: 'content_format',
    prompt: 'What format does your content usually take? Pick all that apply.',
    options: [
      { value: 'short-form', label: 'Short-form (Reels/TikTok/Shorts)' },
      { value: 'long-form', label: 'Long-form video' },
      { value: 'live', label: 'Live streams' },
      { value: 'audio', label: 'Audio / podcast' },
      { value: 'written', label: 'Written / newsletter' },
      { value: 'visual', label: 'Static art / photo posts' },
    ],
    field: 'contentFormat',
    memoryCategory: 'preference',
    memoryTemplate: 'My content formats: {answer}',
  },
  {
    id: 'posting_frequency',
    prompt: 'How often do you post?',
    options: [
      { value: 'daily', label: 'Daily' },
      { value: 'few-per-week', label: 'A few times a week' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'irregular', label: "Irregular — when inspiration hits" },
    ],
    field: 'postingFrequency',
    memoryCategory: 'preference',
    memoryTemplate: 'I post: {answer}',
  },
  {
    id: 'editing_skills',
    prompt: 'How good are you at editing?',
    options: [
      { value: 'none', label: "No editing — raw content" },
      { value: 'basic', label: 'Basic cuts and captions' },
      { value: 'pro', label: 'Pro-level editing & motion graphics' },
    ],
    field: 'editingSkills',
    memoryCategory: 'preference',
    memoryTemplate: 'My editing level: {answer}',
  },
  {
    id: 'equipment',
    prompt: 'What gear do you have? (camera, mic, lights, software — anything)',
    field: 'equipment',
    memoryCategory: 'constraint',
    memoryTemplate: 'My equipment: {answer}',
  },
  {
    id: 'audience_age',
    prompt: "What's your audience's dominant age group?",
    options: [
      { value: 'under-18', label: 'Under 18' },
      { value: '18-24', label: '18–24' },
      { value: '25-34', label: '25–34' },
      { value: '35+', label: '35+' },
      { value: 'mixed', label: 'Really mixed' },
    ],
    field: 'audienceAge',
    memoryCategory: 'preference',
    memoryTemplate: 'My audience age group: {answer}',
  },
  {
    id: 'audience_regions',
    prompt: "Where does most of your audience live? (countries or regions)",
    field: 'audienceRegions',
    memoryCategory: 'preference',
    memoryTemplate: 'My audience regions: {answer}',
  },
  {
    id: 'collab_experience',
    prompt: 'Have you collaborated with other creators before?',
    options: [
      { value: 'never', label: 'Never — this would be my first' },
      { value: 'a-few', label: 'Yes, a few times' },
      { value: 'many', label: 'Lots of times' },
    ],
    field: 'collabExperience',
    memoryCategory: 'preference',
    memoryTemplate: 'Collab experience: {answer}',
  },
  {
    id: 'growth_stage',
    prompt: 'Where are you in your creator journey right now?',
    options: [
      { value: 'finding-niche', label: 'Still finding my niche' },
      { value: 'growing', label: 'Growing steadily' },
      { value: 'established', label: 'Established' },
    ],
    field: 'growthStage',
    memoryCategory: 'preference',
    memoryTemplate: 'My growth stage: {answer}',
  },
  {
    id: 'timezone',
    prompt: "What's your timezone? (e.g. UTC+6, or just your city — helps schedule live collabs)",
    field: 'timezone',
    memoryCategory: 'constraint',
    memoryTemplate: 'My timezone: {answer}',
  },
]

export interface InterviewAnswerInput {
  questionId: string
  /** Free-text answer, or the selected chip value(s). */
  answer: string | string[]
}

export interface InterviewAnswerResult {
  questionId: string
  /** The next unanswered question, or null when the interview is complete. */
  nextQuestion: InterviewQuestion | null
  /** Index of the answered question in the bank. */
  answeredIndex: number
  /** Structured details after the write. */
  details: ProfileDetails
  /** Number of structured fields filled (0–9). */
  completeness: number
}

/** Validates and applies a single interview answer; returns next question. */
export function applyInterviewAnswer(
  db: Database.Database,
  creatorId: string,
  input: InterviewAnswerInput,
): InterviewAnswerResult {
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
  const question = INTERVIEW_QUESTIONS.find((q) => q.id === input.questionId)
  if (question === undefined) {
    throw new Error(`unknown interview question: ${input.questionId}`)
  }

  const rawAnswer = input.answer
  const values = Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer]
  const cleaned = values
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v !== '')
  if (cleaned.length === 0) {
    throw new Error('answer must be a non-empty string or a non-empty array of strings')
  }
  // A single-value field takes the first selected value.
  const singleValue = cleaned[0]

  // 1) Write the structured details field.
  const updates: ProfileDetailsUpdates = {} as ProfileDetailsUpdates
  if (question.options !== undefined) {
    // Multi-select: keep all selected values, deduped, in bank order.
    const ordered = question.options
      .map((o) => o.value)
      .filter((v) => cleaned.includes(v))
    ;(updates as Record<string, unknown>)[question.field] =
      ordered.length > 0 ? ordered : cleaned
  } else {
    // Single-value field takes the first non-empty value.
    ;(updates as Record<string, unknown>)[question.field] = singleValue
  }
  if (question.field === 'goals') {
    // Goals are multi-select even though the UI shows one pick per answer;
    // merging keeps earlier goal answers.
    const existing = db
      .prepare('SELECT goals FROM creator_profile_details WHERE creator_id = ?')
      .get(creatorId) as { goals: string | null } | undefined
    const previous: string[] = existing?.goals ? JSON.parse(existing.goals) : []
    const merged = Array.from(new Set([...previous, ...(updates.goals as string[])]))
    updates.goals = merged
  }

  db.transaction(() => {
    setProfileDetails(db, creatorId, updates)
    addCreatorMemory(db, {
      id: randomUUID(),
      creatorId,
      category: question.memoryCategory,
      content: question.memoryTemplate.replace(
        '{answer}',
        Array.isArray(rawAnswer)
          ? rawAnswer.map((v) => String(v).trim()).filter((v) => v !== '').join(', ')
          : String(rawAnswer).trim(),
      ),
    })
  })()

  const details = getProfileDetails(db, creatorId) as ProfileDetails
  const completeness = profileDetailsCompleteness(db, creatorId)
  const answeredIndex = INTERVIEW_QUESTIONS.findIndex((q) => q.id === input.questionId)
  const nextQuestion = nextUnanswered(db, creatorId, answeredIndex + 1)

  return { questionId: input.questionId, nextQuestion, answeredIndex, details, completeness }
}

/** Returns the next unanswered question starting at `fromIndex`, else null. */
function nextUnanswered(
  db: Database.Database,
  creatorId: string,
  fromIndex: number,
): InterviewQuestion | null {
  for (let i = fromIndex; i < INTERVIEW_QUESTIONS.length; i += 1) {
    const q = INTERVIEW_QUESTIONS[i]
    if (q === undefined) continue
    if (!isAnswered(db, creatorId, q)) return q
  }
  return null
}

function isAnswered(db: Database.Database, creatorId: string, q: InterviewQuestion): boolean {
  const row = db
    .prepare(
      `SELECT ${q.field} AS value FROM creator_profile_details WHERE creator_id = ?`,
    )
    .get(creatorId) as { value: string | null } | undefined
  if (row === undefined || row.value === null) return false
  if (q.options !== undefined) {
    try {
      const parsed = JSON.parse(row.value) as unknown
      return Array.isArray(parsed) && parsed.length > 0
    } catch {
      return false
    }
  }
  return row.value.trim() !== ''
}
