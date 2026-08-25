/**
 * Seeds the demo database with pre-made creator accounts so Find Creators
 * and Mind proposals have rich, realistic matches on a fresh install.
 *
 * Usage: npx tsx scripts/seed-demo-creators.ts
 * Idempotent: creators that already exist are skipped (by creatorId).
 */
import { createDatabase, defaultDatabasePath, migrate } from '../packages/db/src/index.js'
import { createCreatorProfile } from '../packages/db/src/profiles.js'
import { setProfileDetails } from '../packages/db/src/profile_details.js'
import { addCreatorMemory } from '../packages/db/src/memories.js'
import { setOpenCollab } from '../packages/db/src/open_collabs.js'
import type Database from 'better-sqlite3'

interface SeedCreator {
  creatorId: string
  displayName: string
  bio: string
  details: Record<string, unknown>
  memories: string[]
  /** Open-collab card terms. */
  openCollab: { myFollowers: number; minPartnerFollowers: number; languages: string[] }
}

/** Follower numbers matching each seed's audienceSize bucket. */
const OPEN_CARDS: Record<string, SeedCreator['openCollab']> = {
  'seed-arif-beats': { myFollowers: 10000, minPartnerFollowers: 0, languages: ['bn', 'en'] },
  'seed-nusrat-cooks': { myFollowers: 150000, minPartnerFollowers: 50000, languages: ['bn'] },
  'seed-devon-tech': { myFollowers: 200000, minPartnerFollowers: 0, languages: ['en'] },
  'seed-maria-fitness': { myFollowers: 900, minPartnerFollowers: 0, languages: ['es', 'en'] },
  'seed-tanvir-art': { myFollowers: 120, minPartnerFollowers: 0, languages: ['bn', 'en'] },
  'seed-priya-streams': { myFollowers: 25000, minPartnerFollowers: 0, languages: ['en', 'hi'] },
  'seed-kwame-comedy': { myFollowers: 40000, minPartnerFollowers: 0, languages: ['en'] },
  'seed-sara-writes': { myFollowers: 3000, minPartnerFollowers: 0, languages: ['en', 'fr'] },
}

const SEEDS: SeedCreator[] = [
  {
    creatorId: 'seed-arif-beats',
    displayName: 'Arif Beats',
    bio: 'Bangla hip-hop producer and beatmaker from Dhaka. Free-type collabs welcome.',
    details: {
      niches: ['Music'],
      platforms: ['YouTube', 'Instagram'],
      audienceSize: '~10k',
      avgViews: '1k-10k',
      languages: ['Bangla', 'English'],
      collabTypes: ['co-create', 'cross-promote'],
      availability: '~5 hrs/week',
      location: 'Dhaka',
      goals: ['Find collab partners', 'Grow my audience'],
      compensation: ['barter', 'revenue-share'],
      minBudget: null,
      openToSmall: 'yes',
      dealbreakers: 'no explicit lyrics',
    },
    memories: ['I make Bangla hip-hop beats and want vocalists to feature.'],
  },
  {
    creatorId: 'seed-nusrat-cooks',
    displayName: 'Nusrat Cooks',
    bio: 'Food storyteller — Bangla recipes with cinematic shorts. Paid gigs only.',
    details: {
      niches: ['Food', 'Video'],
      platforms: ['YouTube', 'TikTok'],
      audienceSize: '~100k+',
      avgViews: '10k-100k',
      languages: ['Bangla'],
      collabTypes: ['guest-appearance', 'series'],
      availability: '~10+ hrs/week',
      location: 'Chattogram',
      goals: ['Make money creating'],
      compensation: ['paid'],
      minBudget: '$100 per video minimum',
      openToSmall: 'no',
      dealbreakers: 'no alcohol brands',
    },
    memories: ['I host a monthly guest-chef series on my channel.'],
  },
  {
    creatorId: 'seed-devon-tech',
    displayName: 'Devon Tech',
    bio: 'Tech reviews and dev-log videos in English. Revenue-share collabs.',
    details: {
      niches: ['Tech', 'Education'],
      platforms: ['YouTube', 'Newsletter'],
      audienceSize: '~100k+',
      avgViews: '10k-100k',
      languages: ['English'],
      collabTypes: ['co-create', 'cross-promote', 'series'],
      availability: '~5 hrs/week',
      location: 'Singapore',
      goals: ['Make money creating', 'Level up my craft'],
      compensation: ['revenue-share', 'paid'],
      minBudget: '$250 per sponsored segment',
      openToSmall: 'yes',
    },
    memories: ['I love co-reviewing gadgets with smaller tech creators.'],
  },
  {
    creatorId: 'seed-maria-fitness',
    displayName: 'Maria Fit',
    bio: 'Home-workout coach on TikTok and Instagram. Barter-friendly.',
    details: {
      niches: ['Fitness'],
      platforms: ['TikTok', 'Instagram'],
      audienceSize: '~1k',
      avgViews: '<1k',
      languages: ['Spanish', 'English'],
      collabTypes: ['cross-promote', 'shoutout'],
      availability: '~1 hr/week',
      location: 'Mexico City',
      goals: ['Grow my audience', 'Find collab partners'],
      compensation: ['barter', 'free'],
      openToSmall: 'yes',
    },
    memories: ['Just starting out but very consistent — daily posts.'],
  },
  {
    creatorId: 'seed-tanvir-art',
    displayName: 'Tanvir Draws',
    bio: 'Digital artist doing speedpaints and art challenges. Just starting out.',
    details: {
      niches: ['Art'],
      platforms: ['Instagram', 'YouTube'],
      audienceSize: 'Just starting',
      avgViews: '<1k',
      languages: ['Bangla', 'English'],
      collabTypes: ['co-create', 'shoutout'],
      availability: '~10+ hrs/week',
      location: 'Dhaka',
      goals: ['Grow my audience', 'Level up my craft'],
      compensation: ['free', 'barter'],
      openToSmall: 'yes',
    },
    memories: ['Looking for musicians to animate music videos for free exposure.'],
  },
  {
    creatorId: 'seed-priya-streams',
    displayName: 'Priya Plays',
    bio: 'Variety streamer — cozy games and just-chatting. Live-event collabs.',
    details: {
      niches: ['Gaming', 'Streaming'],
      platforms: ['Twitch', 'YouTube'],
      audienceSize: '~10k',
      avgViews: '1k-10k',
      languages: ['English', 'Hindi'],
      collabTypes: ['live-event', 'guest-appearance'],
      availability: 'Full-time',
      location: 'Mumbai',
      goals: ['Make money creating', 'Find collab partners'],
      compensation: ['paid', 'revenue-share'],
      minBudget: '$50 per stream shoutout',
      openToSmall: 'yes',
    },
    memories: ['I run a weekend co-stream event and always need guests.'],
  },
  {
    creatorId: 'seed-kwame-comedy',
    displayName: 'Kwame Komics',
    bio: 'Sketch comedy in English and Pidgin. Shout-for-shout barter king.',
    details: {
      niches: ['Comedy', 'Video'],
      platforms: ['TikTok', 'X'],
      audienceSize: '~10k',
      avgViews: '10k-100k',
      languages: ['English'],
      collabTypes: ['cross-promote', 'shoutout', 'co-create'],
      availability: '~5 hrs/week',
      location: 'Lagos',
      goals: ['Grow my audience'],
      compensation: ['barter'],
      openToSmall: 'yes',
    },
    memories: ['I trade skits — you appear in mine, I appear in yours.'],
  },
  {
    creatorId: 'seed-sara-writes',
    displayName: 'Sara Stories',
    bio: 'Short-fiction podcaster and newsletter writer. Loves narrating others’ work.',
    details: {
      niches: ['Writing', 'Podcast'],
      platforms: ['Podcast', 'Newsletter'],
      audienceSize: '~1k',
      avgViews: '1k-10k',
      languages: ['English', 'French'],
      collabTypes: ['series', 'guest-appearance'],
      availability: '~1 hr/week',
      location: 'Paris',
      goals: ['Level up my craft', 'Find collab partners'],
      compensation: ['free', 'revenue-share'],
      openToSmall: 'yes',
    },
    memories: ['I narrate short stories — send me your writing and I may feature it.'],
  },
]

function seed(db: Database.Database): void {
  const existing = db
    .prepare('SELECT COUNT(*) AS n FROM creator_profiles')
    .get() as { n: number }
  let created = 0
  for (const seedCreator of SEEDS) {
    const exists = db
      .prepare('SELECT 1 FROM creator_profiles WHERE creator_id = ?')
      .get(seedCreator.creatorId)
    if (exists === undefined) {
      // new profile — created below
    } else {
      // profile exists: still ensure the open-collab card is present
      const hasCard = db
        .prepare('SELECT 1 FROM open_collabs WHERE creator_id = ?')
        .get(seedCreator.creatorId)
      if (hasCard === undefined) {
        const card = OPEN_CARDS[seedCreator.creatorId]
        if (card !== undefined) {
          setOpenCollab(db, {
            creatorId: seedCreator.creatorId,
            openToCollab: true,
            myFollowers: card.myFollowers,
            minPartnerFollowers: card.minPartnerFollowers,
            languages: card.languages,
            topics: [],
          })
        }
      }
      continue
    }
    createCreatorProfile(db, {
      creatorId: seedCreator.creatorId,
      displayName: seedCreator.displayName,
      bio: seedCreator.bio,
      avatarUrl: '',
    })
    setProfileDetails(db, seedCreator.creatorId, seedCreator.details as never)
    for (const content of seedCreator.memories) {
      addCreatorMemory(db, {
        id: crypto.randomUUID(),
        creatorId: seedCreator.creatorId,
        category: 'preference',
        content,
      })
    }
    const card = OPEN_CARDS[seedCreator.creatorId]
    if (card !== undefined) {
      setOpenCollab(db, {
        creatorId: seedCreator.creatorId,
        openToCollab: true,
        myFollowers: card.myFollowers,
        minPartnerFollowers: card.minPartnerFollowers,
        languages: card.languages,
        topics: [],
      })
    }
    created += 1
  }
  console.log(
    existing.n > 0
      ? `seeded ${created} new creators (${existing.n} profiles already existed)`
      : `seeded ${created} new creators`,
  )
}

const db = createDatabase(defaultDatabasePath)
migrate(db)
seed(db)
db.close()
