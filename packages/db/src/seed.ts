import { randomBytes, scryptSync } from 'node:crypto'
import type Database from 'better-sqlite3'

export interface DemoCreatorSeed {
  handle: string
  displayName: string
  bio: string
  niche: string
  followers: number
  minRate: number
  topics: string[]
  lang: string[]
  platform: string
  location?: string
  goals?: string[]
  collabTypes?: string[]
  memories?: string[]
}

export const DEMO_CREATORS: DemoCreatorSeed[] = [
  {
    handle: 'alex_travels',
    displayName: 'Alex Rivera',
    bio: 'Documenting remote travel, solo backpacking & culture vlogs',
    niche: 'Travel & Adventure',
    followers: 85000,
    minRate: 400,
    topics: ['Travel', 'Adventure', 'Vlogs', 'Culture'],
    lang: ['en', 'es'],
    platform: 'YouTube',
    location: 'Lisbon / Remote',
    goals: ['Grow global audience', 'Co-create travel series'],
    collabTypes: ['co-create', 'cross-promote', 'series'],
    memories: ['I love exploring hidden travel spots and hosting guest creators on my trips.'],
  },
  {
    handle: 'maya_code',
    displayName: 'Maya Chen',
    bio: 'Full-stack AI engineer building open source and developer tools in public',
    niche: 'Tech & AI',
    followers: 62000,
    minRate: 500,
    topics: ['Tech', 'Coding', 'AI', 'Startups'],
    lang: ['en'],
    platform: 'YouTube',
    location: 'San Francisco',
    goals: ['Build developer community', 'Showcase real AI workflows'],
    collabTypes: ['co-create', 'cross-promote', 'guest-appearance'],
    memories: ['I build live AI agents and pair-program with other creators.'],
  },
  {
    handle: 'tanvir_gaming',
    displayName: 'Tanvir Ahmed',
    bio: 'Competitive FPS esports caster & variety gaming streamer from Dhaka',
    niche: 'Gaming & Esports',
    followers: 110000,
    minRate: 350,
    topics: ['Gaming', 'Esports', 'Twitch', 'Streaming'],
    lang: ['bn', 'en'],
    platform: 'Twitch',
    location: 'Dhaka',
    goals: ['Host cross-community tournament streams', 'Level up stream quality'],
    collabTypes: ['live-event', 'co-create', 'cross-promote'],
    memories: ['I host weekly live co-op battles and community showdowns.'],
  },
  {
    handle: 'priya_cooks',
    displayName: 'Priya Sharma',
    bio: 'Plant-based regional Indian street cuisine & quick fusion recipes',
    niche: 'Food & Cooking',
    followers: 48000,
    minRate: 200,
    topics: ['Food', 'Cooking', 'Vegan', 'Recipes'],
    lang: ['hi', 'en', 'bn'],
    platform: 'Instagram',
    location: 'Mumbai',
    goals: ['Publish cookbook series', 'Collaborate with food creators'],
    collabTypes: ['cross-promote', 'co-create', 'series'],
    memories: ['I run a monthly guest-chef fusion food series.'],
  },
  {
    handle: 'arif_beats',
    displayName: 'Arif Beats',
    bio: 'Bangla hip-hop & lofi producer creating beats and sound kits',
    niche: 'Music & Audio',
    followers: 25000,
    minRate: 150,
    topics: ['Music', 'Beats', 'HipHop', 'Production'],
    lang: ['bn', 'en'],
    platform: 'YouTube',
    location: 'Dhaka',
    goals: ['Find vocalists & rappers for collabs', 'Release collaborative EP'],
    collabTypes: ['co-create', 'cross-promote', 'series'],
    memories: ['Looking for vocalists and video creators to feature on my tracks.'],
  },
  {
    handle: 'nusrat_vlogs',
    displayName: 'Nusrat Jahan',
    bio: 'Lifestyle, university life & aesthetic day-in-the-life vlogs in Bangla & English',
    niche: 'Lifestyle & Vlogs',
    followers: 125000,
    minRate: 400,
    topics: ['Lifestyle', 'Vlogs', 'Fashion', 'StudentLife'],
    lang: ['bn', 'en'],
    platform: 'YouTube',
    location: 'Dhaka',
    goals: ['Brand sponsorships', 'Cross-promotional vlogs'],
    collabTypes: ['cross-promote', 'guest-appearance', 'shoutout'],
    memories: ['I love doing collaborative campus and city exploration vlogs.'],
  },
  {
    handle: 'samir_tech',
    displayName: 'Samir Chowdhury',
    bio: 'Tech reviews, smartphone comparisons & gadget teardowns',
    niche: 'Tech & Gadgets',
    followers: 78000,
    minRate: 300,
    topics: ['Tech', 'Gadgets', 'Reviews', 'Smartphones'],
    lang: ['bn', 'en'],
    platform: 'YouTube',
    location: 'Chattogram',
    goals: ['Co-review flagship gadgets', 'Grow tech audience'],
    collabTypes: ['co-create', 'cross-promote', 'series'],
    memories: ['I do joint tech debates and live unboxing events.'],
  },
  {
    handle: 'david_finance',
    displayName: 'David Miller',
    bio: 'Demystifying personal finance, index funds & smart investing for Gen Z',
    niche: 'Finance & Crypto',
    followers: 95000,
    minRate: 600,
    topics: ['Finance', 'Investing', 'Budgeting', 'Crypto'],
    lang: ['en'],
    platform: 'YouTube',
    location: 'New York',
    goals: ['Financial literacy outreach', 'Partner with educational creators'],
    collabTypes: ['co-create', 'guest-appearance', 'series'],
    memories: ['I love breaking down complex money concepts with creator guests.'],
  },
  {
    handle: 'sara_pottery',
    displayName: 'Sara Al-Mansoor',
    bio: 'Studio ceramicist, pottery tutorials & slow-living creator',
    niche: 'Design & Crafts',
    followers: 34000,
    minRate: 250,
    topics: ['Crafts', 'Art', 'Design', 'Pottery'],
    lang: ['en', 'ar'],
    platform: 'Instagram',
    location: 'Dubai',
    goals: ['Artisan collaborations', 'Showcase handmade art'],
    collabTypes: ['cross-promote', 'co-create'],
    memories: ['I make custom pottery collections and pair with artists.'],
  },
  {
    handle: 'lucas_fitness',
    displayName: 'Lucas Rossi',
    bio: 'Calisthenics athlete, bodyweight workout routines & mobility coaching',
    niche: 'Fitness & Health',
    followers: 72000,
    minRate: 300,
    topics: ['Fitness', 'Calisthenics', 'Health', 'Workout'],
    lang: ['en', 'es', 'pt'],
    platform: 'TikTok',
    location: 'Rio de Janeiro',
    goals: ['Fitness challenges with creators', 'Promote healthy living'],
    collabTypes: ['co-create', 'cross-promote', 'live-event'],
    memories: ['I love doing workout challenges and duets with other athletes.'],
  },
  {
    handle: 'zara_style',
    displayName: 'Zara Khan',
    bio: 'Thrift flips, minimalist fashion & capsule wardrobes',
    niche: 'Fashion & Style',
    followers: 56000,
    minRate: 350,
    topics: ['Fashion', 'Style', 'Thrifting', 'Sustainable'],
    lang: ['en', 'hi'],
    platform: 'Instagram',
    location: 'London',
    goals: ['Sustainable fashion awareness', 'Style swap videos'],
    collabTypes: ['cross-promote', 'co-create'],
    memories: ['I trade wardrobes and do thrift-styling battles.'],
  },
  {
    handle: 'elena_music',
    displayName: 'Elena Gomez',
    bio: 'Indie acoustic covers, original songwriting & vocal harmonies',
    niche: 'Music & Audio',
    followers: 41000,
    minRate: 200,
    topics: ['Music', 'Indie', 'Singing', 'Covers'],
    lang: ['en', 'es'],
    platform: 'YouTube',
    location: 'Madrid',
    goals: ['Collaborative acoustic duets', 'Release joint singles'],
    collabTypes: ['co-create', 'cross-promote'],
    memories: ['Always looking for guitarists, beatmakers and vocalists to duet.'],
  },
  {
    handle: 'liam_film',
    displayName: 'Liam Vance',
    bio: 'Cinematic colour grading, camera reviews & indie filmmaking tips',
    niche: 'Video & Cinema',
    followers: 68000,
    minRate: 450,
    topics: ['Video', 'Film', 'Cinematography', 'Editing'],
    lang: ['en'],
    platform: 'YouTube',
    location: 'Vancouver',
    goals: ['Direct creative shorts with creators', 'Test new cinema gear'],
    collabTypes: ['co-create', 'series', 'guest-appearance'],
    memories: ['I film and color-grade videos for other passionate creators.'],
  },
  {
    handle: 'dr_aravind',
    displayName: 'Dr. Aravind Menon',
    bio: 'Evidence-based neurobiology, deep work & productivity systems',
    niche: 'Science & Education',
    followers: 140000,
    minRate: 750,
    topics: ['Science', 'Productivity', 'Education', 'Health'],
    lang: ['en'],
    platform: 'YouTube',
    location: 'Boston',
    goals: ['Science education', 'Podcast interviews'],
    collabTypes: ['guest-appearance', 'series', 'co-create'],
    memories: ['I enjoy appearing on podcasts to discuss brain science and habit design.'],
  },
  {
    handle: 'nour_books',
    displayName: 'Nour Haddad',
    bio: 'Fantasy literature essays, worldbuilding analysis & book reviews',
    niche: 'Books & Literature',
    followers: 29000,
    minRate: 150,
    topics: ['Books', 'Fantasy', 'Reading', 'Storytelling'],
    lang: ['en', 'ar', 'fr'],
    platform: 'TikTok',
    location: 'Beirut',
    goals: ['Host book club collabs', 'Author interviews'],
    collabTypes: ['cross-promote', 'series'],
    memories: ['I run interactive book deep-dives and author Q&As.'],
  },
  {
    handle: 'chloe_comedy',
    displayName: 'Chloe Bennett',
    bio: 'Relatable creator culture sketches, satirical reels & comedy skits',
    niche: 'Comedy & Skits',
    followers: 210000,
    minRate: 600,
    topics: ['Comedy', 'Skits', 'Humor', 'Reels'],
    lang: ['en'],
    platform: 'TikTok',
    location: 'Los Angeles',
    goals: ['Viral sketch collabs', 'Cross-post comedy series'],
    collabTypes: ['co-create', 'cross-promote'],
    memories: ['I love doing comedy duets and acting in guest sketches.'],
  },
  {
    handle: 'marco_photo',
    displayName: 'Marco Silva',
    bio: 'Street photography in European old towns & cinematic film emulation',
    niche: 'Photography',
    followers: 51000,
    minRate: 300,
    topics: ['Photography', 'StreetPhoto', 'Film', 'Art'],
    lang: ['en', 'pt', 'es'],
    platform: 'Instagram',
    location: 'Porto',
    goals: ['Photo walks with local creators', 'Joint photo-storytelling'],
    collabTypes: ['co-create', 'cross-promote'],
    memories: ['I organize creator photo walks and portrait sessions.'],
  },
  {
    handle: 'anika_startups',
    displayName: 'Anika Roy',
    bio: 'Interviews with bootstrapped indie hacker founders & growth stories',
    niche: 'Business & Startups',
    followers: 88000,
    minRate: 550,
    topics: ['Business', 'Startups', 'IndieHacker', 'SaaS'],
    lang: ['en', 'bn'],
    platform: 'YouTube',
    location: 'Singapore',
    goals: ['Founder spotlight interviews', 'Podcast episodes'],
    collabTypes: ['guest-appearance', 'series'],
    memories: ['I interview founders and builders scaling from zero to revenue.'],
  },
  {
    handle: 'fatima_art',
    displayName: 'Fatima Zahra',
    bio: 'Digital illustrator & character animator doing speedpaints & art challenges',
    niche: 'Design & Crafts',
    followers: 38000,
    minRate: 200,
    topics: ['Art', 'Animation', 'Illustration', 'Design'],
    lang: ['en', 'ar', 'fr'],
    platform: 'Instagram',
    location: 'Casablanca',
    goals: ['Art collaborations', 'Animated music visuals'],
    collabTypes: ['co-create', 'cross-promote'],
    memories: ['I animate characters and album covers for music creators.'],
  },
  {
    handle: 'rahul_dev',
    displayName: 'Rahul Sen',
    bio: 'Web3 & open-source software engineer sharing tutorials & devlogs',
    niche: 'Tech & AI',
    followers: 45000,
    minRate: 250,
    topics: ['Coding', 'WebDev', 'Tech', 'OpenSource'],
    lang: ['en', 'bn', 'hi'],
    platform: 'YouTube',
    location: 'Kolkata',
    goals: ['Host tech hackathons & collab live streams', 'Open source projects'],
    collabTypes: ['co-create', 'live-event', 'cross-promote'],
    memories: ['I build live projects on stream and invite fellow developers to pair.'],
  },
]

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

/**
 * Seeds or updates demo creator accounts in the database with complete
 * profiles, passcodes (PIN: 1234), profile details, open-collab cards,
 * and initial memories.
 */
export function seedDemoAccounts(db: Database.Database): number {
  let count = 0
  for (const c of DEMO_CREATORS) {
    const creatorId = `u_${c.handle}`
    try {
      // 1. Creator Profile
      db.prepare(
        `INSERT INTO creator_profiles (creator_id, display_name, bio, avatar_url)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(creator_id) DO UPDATE SET
           display_name = excluded.display_name,
           bio = excluded.bio`,
      ).run(creatorId, c.displayName, c.bio, '')

      // 2. Auth Account (passcode login PIN: 1234)
      const pinHash = hashPin('1234')
      db.prepare(
        `INSERT INTO accounts (handle, creator_id, pin_hash)
         VALUES (?, ?, ?)
         ON CONFLICT(handle) DO UPDATE SET
           creator_id = excluded.creator_id`,
      ).run(c.handle, creatorId, pinHash)

      // 3. Profile Details
      const audienceBucket =
        c.followers >= 1000000
          ? '~1M+'
          : c.followers >= 100000
            ? '~100k+'
            : c.followers >= 10000
              ? '~10k'
              : c.followers >= 1000
                ? '~1k'
                : 'Just starting'

      db.prepare(
        `INSERT INTO creator_profile_details (
           creator_id, niches, platforms, audience_size, collab_types,
           availability, location, goals, dealbreakers, languages,
           partner_min_audience, open_to_small, compensation
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'any', 'yes', ?)
         ON CONFLICT(creator_id) DO UPDATE SET
           niches = excluded.niches,
           platforms = excluded.platforms,
           audience_size = excluded.audience_size,
           collab_types = excluded.collab_types,
           languages = excluded.languages`,
      ).run(
        creatorId,
        JSON.stringify([c.niche]),
        JSON.stringify([c.platform]),
        audienceBucket,
        JSON.stringify(c.collabTypes ?? ['co-create', 'cross-promote']),
        '~5 hrs/week',
        c.location ?? 'Global',
        JSON.stringify(c.goals ?? ['Find collab partners']),
        'Respectful terms & transparent communication',
        JSON.stringify(c.lang),
        JSON.stringify(['paid', 'barter', 'revenue-share']),
      )

      // 4. Open Collab Card (openToCollab = 1, minPartnerFollowers = 0)
      db.prepare(
        `INSERT INTO open_collabs (
           creator_id, open_to_collab, my_followers, min_partner_followers,
           languages, topics, platform, niche, min_rate, collab_types,
           open_for_brands, brand_min_rate, guardrails
         )
         VALUES (?, 1, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(creator_id) DO UPDATE SET
           open_to_collab = 1,
           my_followers = excluded.my_followers,
           min_partner_followers = 0,
           languages = excluded.languages,
           topics = excluded.topics,
           platform = excluded.platform,
           niche = excluded.niche,
           min_rate = excluded.min_rate,
           collab_types = excluded.collab_types,
           open_for_brands = 1,
           brand_min_rate = excluded.brand_min_rate,
           guardrails = excluded.guardrails`,
      ).run(
        creatorId,
        c.followers,
        c.lang.join(','),
        c.topics.join(','),
        c.platform,
        c.niche,
        c.minRate,
        (c.collabTypes ?? ['co-create', 'cross-promote']).join(','),
        c.minRate * 2,
        `Minimum budget $${c.minRate} • Open to barter and creative co-creation`,
      )

      // 5. Memories
      if (c.memories && c.memories.length > 0) {
        for (const mem of c.memories) {
          const memId = `mem_${c.handle}_${Buffer.from(mem.slice(0, 16)).toString('hex')}`
          db.prepare(
            `INSERT OR IGNORE INTO creator_memories (id, creator_id, category, content)
             VALUES (?, ?, 'preference', ?)`,
          ).run(memId, creatorId, mem)
        }
      }

      count++
    } catch (err) {
      console.warn(`[seed] failed to seed demo creator ${c.handle}:`, err)
    }
  }
  return count
}
