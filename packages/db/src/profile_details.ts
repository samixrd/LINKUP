import type Database from 'better-sqlite3'
import { getCreatorProfile } from './profiles.js'

/**
 * Structured creator profile details: the fields that make matching and
 * Mind-drafted proposals genuinely informative (niche, platforms, audience,
 * collab types, availability, location, goals, dealbreakers, portfolio).
 * Stored in a side table so the core `creator_profiles` shape is unchanged;
 * every field is optional and null means "not yet provided".
 */

export const AUDIENCE_BUCKETS = [
  'Just starting',
  '~1k',
  '~10k',
  '~100k+',
  '~1M+',
] as const

export const COLLAB_TYPES = [
  'co-create',
  'cross-promote',
  'guest-appearance',
  'shoutout',
  'series',
  'live-event',
] as const

export const AVAILABILITY_BUCKETS = [
  '~1 hr/week',
  '~5 hrs/week',
  '~10+ hrs/week',
  'Full-time',
] as const

export type AudienceBucket = (typeof AUDIENCE_BUCKETS)[number]
export type CollabType = (typeof COLLAB_TYPES)[number]
export type AvailabilityBucket = (typeof AVAILABILITY_BUCKETS)[number]

/** Buckets for the minimum audience a creator wants in a partner. */
export const PARTNER_MIN_AUDIENCES = ['any', '~1k', '~10k', '~100k+'] as const

/** Buckets for the maximum audience a creator is comfortable with. */
export const PARTNER_MAX_AUDIENCES = ['no-limit', '~10k', '~100k+', '~1M+'] as const

/** Buckets for a creator's (or their partner's expected) average views. */
export const AVG_VIEW_BUCKETS = ['<1k', '1k-10k', '10k-100k', '100k+'] as const

/** Deal compensation types a creator will accept. */
export const COMPENSATION_TYPES = ['paid', 'barter', 'revenue-share', 'free'] as const

export type PartnerMinAudience = (typeof PARTNER_MIN_AUDIENCES)[number]
export type PartnerMaxAudience = (typeof PARTNER_MAX_AUDIENCES)[number]
export type AvgViewBucket = (typeof AVG_VIEW_BUCKETS)[number]
export type CompensationType = (typeof COMPENSATION_TYPES)[number]

/** Full structured profile details. All fields optional; null = unset. */
export interface ProfileDetails {
  creatorId: string
  niches: string[]
  platforms: string[]
  audienceSize: AudienceBucket | null
  collabTypes: CollabType[]
  availability: AvailabilityBucket | null
  location: string | null
  goals: string[]
  dealbreakers: string | null
  portfolioUrl: string | null
  /** Minimum partner audience bucket ('any' when unset). */
  partnerMinAudience: PartnerMinAudience | null
  /** Maximum partner audience bucket ('no-limit' when unset). */
  partnerMaxAudience: PartnerMaxAudience | null
  /** Niches acceptable in a partner; empty = any. */
  partnerNiches: string[]
  /** Expected minimum average views for a partner. */
  minAvgViews: AvgViewBucket | null
  /** Languages the creator can collaborate in. */
  languages: string[]
  /** Platforms wanted in a partner; empty = any. */
  preferredPlatforms: string[]
  /** Accepted deal compensations; empty = undecided. */
  compensation: CompensationType[]
  /** Free-text minimum budget, e.g. '$50 per video'. */
  minBudget: string | null
  /** Whether the creator collaborates with 0-follower creators ('yes'/'no'). */
  openToSmall: string | null
  /** The creator's own average views bucket. */
  avgViews: AvgViewBucket | null
  contentFormat: string[]
  postingFrequency: string | null
  editingSkills: string | null
  equipment: string | null
  audienceAge: string | null
  audienceRegions: string | null
  collabExperience: string | null
  growthStage: string | null
  timezone: string | null
  updatedAt: string
}

/** The subset of fields a client may write. */
export type ProfileDetailsUpdates = Partial<
  Pick<
    ProfileDetails,
    | 'niches'
    | 'platforms'
    | 'audienceSize'
    | 'collabTypes'
    | 'availability'
    | 'location'
    | 'goals'
    | 'dealbreakers'
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
>

interface DetailsRow {
  creator_id: string
  niches: string | null
  platforms: string | null
  audience_size: string | null
  collab_types: string | null
  availability: string | null
  location: string | null
  goals: string | null
  dealbreakers: string | null
  portfolio_url: string | null
  partner_min_audience: string | null
  partner_max_audience: string | null
  partner_niches: string | null
  min_avg_views: string | null
  languages: string | null
  preferred_platforms: string | null
  compensation: string | null
  min_budget: string | null
  open_to_small: string | null
  avg_views: string | null
  content_format: string | null
  posting_frequency: string | null
  editing_skills: string | null
  equipment: string | null
  audience_age: string | null
  audience_regions: string | null
  collab_experience: string | null
  growth_stage: string | null
  timezone: string | null
  updated_at: string
}

const SELECT_COLUMNS = `
  creator_id,
  niches,
  platforms,
  audience_size,
  collab_types,
  availability,
  location,
  goals,
  dealbreakers,
  portfolio_url,
  partner_min_audience,
  partner_max_audience,
  partner_niches,
  min_avg_views,
  languages,
  preferred_platforms,
  compensation,
  min_budget,
  open_to_small,
  avg_views,
  content_format,
  posting_frequency,
  editing_skills,
  equipment,
  audience_age,
  audience_regions,
  collab_experience,
  growth_stage,
  timezone,
  updated_at
`

function parseStringArray(raw: string | null): string[] {
  if (raw === null || raw === '') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function toDetails(row: DetailsRow): ProfileDetails {
  return {
    creatorId: row.creator_id,
    niches: parseStringArray(row.niches),
    platforms: parseStringArray(row.platforms),
    audienceSize: (row.audience_size as AudienceBucket | null) ?? null,
    collabTypes: parseStringArray(row.collab_types) as CollabType[],
    availability: (row.availability as AvailabilityBucket | null) ?? null,
    location: row.location,
    goals: parseStringArray(row.goals),
    dealbreakers: row.dealbreakers,
    portfolioUrl: row.portfolio_url,
    partnerMinAudience: (row.partner_min_audience as PartnerMinAudience | null) ?? null,
    partnerMaxAudience: (row.partner_max_audience as PartnerMaxAudience | null) ?? null,
    partnerNiches: parseStringArray(row.partner_niches),
    minAvgViews: (row.min_avg_views as AvgViewBucket | null) ?? null,
    languages: parseStringArray(row.languages),
    preferredPlatforms: parseStringArray(row.preferred_platforms),
    compensation: parseStringArray(row.compensation) as CompensationType[],
    minBudget: row.min_budget,
    openToSmall: row.open_to_small,
    avgViews: (row.avg_views as AvgViewBucket | null) ?? null,
    contentFormat: parseStringArray(row.content_format),
    postingFrequency: row.posting_frequency,
    editingSkills: row.editing_skills,
    equipment: row.equipment,
    audienceAge: row.audience_age,
    audienceRegions: row.audience_regions,
    collabExperience: row.collab_experience,
    growthStage: row.growth_stage,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  }
}

/** Returns the structured details for `creatorId`, or `undefined` if unset. */
export function getProfileDetails(
  db: Database.Database,
  creatorId: string,
): ProfileDetails | undefined {
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM creator_profile_details WHERE creator_id = ?`)
    .get(creatorId) as DetailsRow | undefined
  return row ? toDetails(row) : undefined
}

/** The number of structured fields a creator has filled in (0–19). */
export function profileDetailsCompleteness(
  db: Database.Database,
  creatorId: string,
): number {
  const details = getProfileDetails(db, creatorId)
  if (details === undefined) return 0
  let count = 0
  if (details.niches.length > 0) count += 1
  if (details.platforms.length > 0) count += 1
  if (details.audienceSize !== null) count += 1
  if (details.collabTypes.length > 0) count += 1
  if (details.availability !== null) count += 1
  if (details.location !== null && details.location.trim() !== '') count += 1
  if (details.goals.length > 0) count += 1
  if (details.dealbreakers !== null && details.dealbreakers.trim() !== '') count += 1
  if (details.portfolioUrl !== null && details.portfolioUrl.trim() !== '') count += 1
  if (details.partnerMinAudience !== null) count += 1
  if (details.partnerMaxAudience !== null) count += 1
  if (details.partnerNiches.length > 0) count += 1
  if (details.minAvgViews !== null) count += 1
  if (details.languages.length > 0) count += 1
  if (details.preferredPlatforms.length > 0) count += 1
  if (details.compensation.length > 0) count += 1
  if (details.minBudget !== null && details.minBudget.trim() !== '') count += 1
  if (details.openToSmall !== null && details.openToSmall.trim() !== '') count += 1
  if (details.avgViews !== null) count += 1
  if (details.contentFormat.length > 0) count += 1
  if (details.postingFrequency !== null) count += 1
  if (details.editingSkills !== null) count += 1
  if (details.equipment !== null && details.equipment.trim() !== '') count += 1
  if (details.audienceAge !== null) count += 1
  if (details.audienceRegions !== null && details.audienceRegions.trim() !== '') count += 1
  if (details.collabExperience !== null) count += 1
  if (details.growthStage !== null) count += 1
  if (details.timezone !== null && details.timezone.trim() !== '') count += 1
  return count
}

const TOTAL_DETAIL_FIELDS = 28

/** Returns the number of structured fields (9) so the UI can render progress. */
export function totalDetailFields(): number {
  return TOTAL_DETAIL_FIELDS
}

function stringifyArray(values: string[] | undefined): string | null {
  if (values === undefined) return undefined as unknown as string | null
  return values.length === 0 ? '[]' : JSON.stringify(values)
}

/**
 * Creates or replaces the structured details for a creator. Returns the
 * stored details. Throws when the creator does not exist. Only the provided
 * fields are updated; omitted fields are left untouched (null means "unset").
 */
export function setProfileDetails(
  db: Database.Database,
  creatorId: string,
  updates: ProfileDetailsUpdates,
): ProfileDetails {
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new Error('creatorId is required and must be a non-empty string')
  }
  if (getCreatorProfile(db, creatorId) === undefined) {
    throw new Error(`creator profile not found: ${creatorId}`)
  }
  const entries = Object.entries(updates)
  if (entries.length === 0) {
    throw new Error('update must contain at least one field')
  }

  const existing = getProfileDetails(db, creatorId)
  const next: ProfileDetails = existing ?? {
    creatorId,
    niches: [],
    platforms: [],
    audienceSize: null,
    collabTypes: [],
    availability: null,
    location: null,
    goals: [],
    dealbreakers: null,
    portfolioUrl: null,
    partnerMinAudience: null,
    partnerMaxAudience: null,
    partnerNiches: [],
    minAvgViews: null,
    languages: [],
    preferredPlatforms: [],
    compensation: [],
    minBudget: null,
    openToSmall: null,
    avgViews: null,
    contentFormat: [],
    postingFrequency: null,
    editingSkills: null,
    equipment: null,
    audienceAge: null,
    audienceRegions: null,
    collabExperience: null,
    growthStage: null,
    timezone: null,
    updatedAt: '',
  }

  if (updates.niches !== undefined) next.niches = updates.niches
  if (updates.platforms !== undefined) next.platforms = updates.platforms
  if (updates.audienceSize !== undefined) next.audienceSize = updates.audienceSize
  if (updates.collabTypes !== undefined) next.collabTypes = updates.collabTypes
  if (updates.availability !== undefined) next.availability = updates.availability
  if (updates.location !== undefined) next.location = updates.location
  if (updates.goals !== undefined) next.goals = updates.goals
  if (updates.dealbreakers !== undefined) next.dealbreakers = updates.dealbreakers
  if (updates.portfolioUrl !== undefined) next.portfolioUrl = updates.portfolioUrl
  if (updates.partnerMinAudience !== undefined) next.partnerMinAudience = updates.partnerMinAudience
  if (updates.partnerMaxAudience !== undefined) next.partnerMaxAudience = updates.partnerMaxAudience
  if (updates.partnerNiches !== undefined) next.partnerNiches = updates.partnerNiches
  if (updates.minAvgViews !== undefined) next.minAvgViews = updates.minAvgViews
  if (updates.languages !== undefined) next.languages = updates.languages
  if (updates.preferredPlatforms !== undefined) next.preferredPlatforms = updates.preferredPlatforms
  if (updates.compensation !== undefined) next.compensation = updates.compensation
  if (updates.minBudget !== undefined) next.minBudget = updates.minBudget
  if (updates.openToSmall !== undefined) next.openToSmall = updates.openToSmall
  if (updates.avgViews !== undefined) next.avgViews = updates.avgViews
  if (updates.contentFormat !== undefined) next.contentFormat = updates.contentFormat
  if (updates.postingFrequency !== undefined) next.postingFrequency = updates.postingFrequency
  if (updates.editingSkills !== undefined) next.editingSkills = updates.editingSkills
  if (updates.equipment !== undefined) next.equipment = updates.equipment
  if (updates.audienceAge !== undefined) next.audienceAge = updates.audienceAge
  if (updates.audienceRegions !== undefined) next.audienceRegions = updates.audienceRegions
  if (updates.collabExperience !== undefined) next.collabExperience = updates.collabExperience
  if (updates.growthStage !== undefined) next.growthStage = updates.growthStage
  if (updates.timezone !== undefined) next.timezone = updates.timezone

  const values = {
    creatorId,
    niches: stringifyArray(next.niches),
    platforms: stringifyArray(next.platforms),
    audienceSize: next.audienceSize,
    collabTypes: stringifyArray(next.collabTypes),
    availability: next.availability,
    location: next.location,
    goals: stringifyArray(next.goals),
    dealbreakers: next.dealbreakers,
    portfolioUrl: next.portfolioUrl,
    partnerMinAudience: next.partnerMinAudience,
    partnerMaxAudience: next.partnerMaxAudience,
    partnerNiches: stringifyArray(next.partnerNiches),
    minAvgViews: next.minAvgViews,
    languages: stringifyArray(next.languages),
    preferredPlatforms: stringifyArray(next.preferredPlatforms),
    compensation: stringifyArray(next.compensation),
    minBudget: next.minBudget,
    openToSmall: next.openToSmall,
    avgViews: next.avgViews,
    contentFormat: stringifyArray(next.contentFormat),
    postingFrequency: next.postingFrequency,
    editingSkills: next.editingSkills,
    equipment: next.equipment,
    audienceAge: next.audienceAge,
    audienceRegions: next.audienceRegions,
    collabExperience: next.collabExperience,
    growthStage: next.growthStage,
    timezone: next.timezone,
  }

  db.prepare(
    `INSERT INTO creator_profile_details (
       creator_id, niches, platforms, audience_size, collab_types,
       availability, location, goals, dealbreakers, portfolio_url,
       partner_min_audience, partner_max_audience, partner_niches,
       min_avg_views, languages, preferred_platforms, compensation,
       min_budget, open_to_small, avg_views,
       content_format, posting_frequency, editing_skills, equipment,
       audience_age, audience_regions, collab_experience, growth_stage, timezone
     ) VALUES (
       @creatorId, @niches, @platforms, @audienceSize, @collabTypes,
       @availability, @location, @goals, @dealbreakers, @portfolioUrl,
       @partnerMinAudience, @partnerMaxAudience, @partnerNiches,
       @minAvgViews, @languages, @preferredPlatforms, @compensation,
       @minBudget, @openToSmall, @avgViews,
       @contentFormat, @postingFrequency, @editingSkills, @equipment,
       @audienceAge, @audienceRegions, @collabExperience, @growthStage, @timezone
     )
     ON CONFLICT(creator_id) DO UPDATE SET
       niches = excluded.niches,
       platforms = excluded.platforms,
       audience_size = excluded.audience_size,
       collab_types = excluded.collab_types,
       availability = excluded.availability,
       location = excluded.location,
       goals = excluded.goals,
       dealbreakers = excluded.dealbreakers,
       portfolio_url = excluded.portfolio_url,
       partner_min_audience = excluded.partner_min_audience,
       partner_max_audience = excluded.partner_max_audience,
       partner_niches = excluded.partner_niches,
       min_avg_views = excluded.min_avg_views,
       languages = excluded.languages,
       preferred_platforms = excluded.preferred_platforms,
       compensation = excluded.compensation,
       min_budget = excluded.min_budget,
       open_to_small = excluded.open_to_small,
       avg_views = excluded.avg_views,
       content_format = excluded.content_format,
       posting_frequency = excluded.posting_frequency,
       editing_skills = excluded.editing_skills,
       equipment = excluded.equipment,
       audience_age = excluded.audience_age,
       audience_regions = excluded.audience_regions,
       collab_experience = excluded.collab_experience,
       growth_stage = excluded.growth_stage,
       timezone = excluded.timezone`,
  ).run(values)

  return getProfileDetails(db, creatorId) as ProfileDetails
}
